// Smoke tests: boots the real game offscreen in Electron (?test mode), drives it
// through the test hooks in src/main.js and checks that the important things
// still happen — that tracers and impacts actually draw, the gun kills, every
// night event runs to its end, unlocks, the HUD, the bomber, the log file.
//
//   npm run test:smoke                      # all tests
//   npm run test:smoke -- events hud        # only files whose name contains these
//   SMOKE_GL=swiftshader npm run test:smoke # software rendering (what CI uses)
//
// Screenshots and results.json go to tests/smoke/out/. Exit code 1 on failure.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { registerIpc } = require('../../electron/ipc');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, 'out');
const filters = process.argv.slice(2).filter((a) => !a.startsWith('-') && !a.endsWith('.js'));

app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (process.env.SMOKE_GL === 'swiftshader') {
  app.commandLine.appendSwitch('use-angle', 'swiftshader');
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
}
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
app.setPath('userData', path.join(OUT, 'userdata'));

let win = null;
const ipc = registerIpc({ ipcMain, app, getWindow: () => win, appDir: path.join(ROOT, 'app') });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class AssertionError extends Error {}

function makeContext(consoleErrors) {
  const js = (code) => win.webContents.executeJavaScript(code);
  const t = {
    js,
    /** Evaluate an expression in the page and return it as JSON-decoded data. */
    get: (expr) => js(`JSON.stringify(${expr})`).then((s) => (s === undefined ? undefined : JSON.parse(s))),
    sleep,
    /** Fresh run at night n with the live loop frozen; the test drives every frame. */
    start: async (night, opts = {}) => {
      const diff = opts.difficulty || 'veteran';
      await js(`(() => { const t = __LB.test; t.freeze(true); t.start(${night}, ${JSON.stringify(diff)}, ${JSON.stringify(opts.upgrades || {})});
        t.skipIntro(); t.advance(${opts.settle ?? 0.3}, 1/30, false); ${opts.keepEvents ? '' : '__LB.events.reset();'}
        ${opts.survivors ? `__LB.run.survivors = ${opts.survivors};` : ''} })()`);
    },
    /** Simulate (no rendering) for a number of seconds. */
    advance: (s, dt = 1 / 30) => js(`__LB.test.advance(${s}, ${dt}, false)`),
    shot: async (name) => {
      // let the compositor paint one live frame, then capture it
      await js('__LB.test.freeze(false)');
      await sleep(250);
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG());
      await js('__LB.test.freeze(true)');
    },
    assert: (cond, msg) => { if (!cond) throw new AssertionError(msg); },
    eq: (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new AssertionError(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); },
    log: (...a) => console.log('    ·', ...a),
    consoleErrors,
    telemetryFile: () => ipc.telemetryFile(),
    closeTelemetry: () => ipc.close(),
  };
  return t;
}

app.whenReady().then(async () => {
  win = new BrowserWindow({
    // SMOKE_SIZE=1600x900 for screenshots worth keeping
    ...(([w, h]) => ({ width: +w || 960, height: +h || 540 }))((process.env.SMOKE_SIZE || '').split('x')), show: false,
    webPreferences: { preload: path.join(ROOT, 'electron', 'preload.js'), contextIsolation: true, offscreen: true, backgroundThrottling: false },
  });
  win.webContents.setAudioMuted(true); // tests never make a sound
  const consoleErrors = [];
  win.webContents.on('console-message', (e, lvl, m) => {
    const level = e.level ?? lvl, msg = e.message ?? m ?? '';
    if (level === 'error' || level === 3) consoleErrors.push(msg);
  });
  win.webContents.on('render-process-gone', (_e, d) => { consoleErrors.push('renderer crashed: ' + d.reason); });

  const quality = process.env.SMOKE_QUALITY || 'low';
  await win.loadFile(path.join(ROOT, 'app', 'index.html'), { search: `test&quality=${quality}` });
  const t = makeContext(consoleErrors);
  let booted = false;
  for (let i = 0; i < 240; i++) {
    try { if (await t.js('!!(window.__LB && window.__LB.state === "menu")')) { booted = true; break; } } catch { /* page not ready */ }
    await sleep(500);
  }

  const files = fs.readdirSync(path.join(__dirname, 'tests')).filter((f) => f.endsWith('.test.js')).sort()
    .filter((f) => !filters.length || filters.some((x) => f.includes(x)));
  const results = [];
  if (!booted) results.push({ name: 'boot', ok: false, error: 'the game never reached the main menu' + (consoleErrors.length ? ': ' + consoleErrors.join(' | ').slice(0, 800) : ''), ms: 0 });
  else {
    await t.js('__LB.test.freeze(true)');
    for (const f of files) {
      const mod = require(path.join(__dirname, 'tests', f));
      const errBefore = consoleErrors.length;
      const t0 = Date.now();
      let ok = true, error = null;
      try {
        await Promise.race([mod.run(t), sleep(mod.timeout || 240000).then(() => { throw new Error('timed out'); })]);
        if (consoleErrors.length > errBefore) throw new AssertionError('console errors: ' + consoleErrors.slice(errBefore).join(' | ').slice(0, 600));
      } catch (err) {
        ok = false; error = err instanceof AssertionError ? err.message : String(err && err.stack || err);
        try { await t.shot('FAIL-' + f.replace('.test.js', '')); } catch { /* ignore */ }
      }
      const ms = Date.now() - t0;
      results.push({ name: f, ok, error, ms });
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${f}  (${(ms / 1000).toFixed(1)} s)${ok ? '' : '\n      ' + error}`);
    }
  }
  const failed = results.filter((r) => !r.ok).length;
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ quality, gl: process.env.SMOKE_GL || 'default', results }, null, 2));
  console.log(`\n${results.length - failed}/${results.length} smoke tests passed`);
  await ipc.close();
  app.exit(failed ? 1 : 0);
});
