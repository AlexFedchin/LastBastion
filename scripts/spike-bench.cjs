// Final spike run: screenshots of the WebGL game and the WebGPU spike (with/without volumetrics)
// from the same cameras, and GPU timings at 1x and 2x pixel ratio, A/B interleaved.
// electron spike-final.cjs <repo> <outdir>
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const repo = process.argv[2], out = process.argv[3];
fs.mkdirSync(out, { recursive: true });
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.on('window-all-closed', () => {});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const CAMS = ['gun', 'wide', 'beam'];

async function open(file, query) {
  const win = new BrowserWindow({ width: 1920, height: 1080, useContentSize: true, show: true, frame: false, x: 0, y: 0,
    webPreferences: { backgroundThrottling: false, preload: path.join(repo, 'electron', 'preload.js'), contextIsolation: true } });
  win.webContents.setAudioMuted(true);
  win.webContents.on('console-message', (e) => { const m = e.message || ''; if (/\[spike\]|Error/.test(m) && !/readAsset/.test(m)) console.log('  [page]', m.slice(0, 300)); });
  for (let i = 0; ; i++) { try { await win.loadFile(path.join(repo, 'app', file), { query }); break; } catch (e) { if (i >= 3) throw e; await sleep(1500); } }
  return win;
}
const js = (win, code) => win.webContents.executeJavaScript(code, true);
async function waitFor(win, cond, ms = 180000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await js(win, `!!(${cond})`).catch(() => false)) return; await sleep(250); }
  throw new Error('timeout: ' + cond);
}
async function shot(win, name) {
  await win.webContents.capturePage(); await sleep(150);
  fs.writeFileSync(path.join(out, name + '.png'), (await win.webContents.capturePage()).toPNG());
}
const rec = (r) => { results.push(r); console.log(JSON.stringify(r)); };

const POSES = `({
  gun: (c) => { c.position.set(0, 10.6, -3.3); c.rotation.set(-0.16, 0, 0, 'YXZ'); },
  wide: (c) => { c.position.set(-38, 26, 24); c.lookAt(10, 2, -90); },
  beam: (c) => { c.position.set(52, 15, 7); c.lookAt(0, 3, -100); },
})`;

async function webgl() {
  const win = await open('index.html', { test: '1', quality: 'high' });
  await waitFor(win, `window.__LB && __LB.state === 'menu'`);
  await js(win, `(() => {
    const G = __LB; G.loop = () => {};
    G.horde.clear(); G.horde.syncRender();
    for (const el of document.body.children) if (el.tagName !== 'CANVAS') el.style.visibility = 'hidden';
    const P = ${POSES}, aims = [[-35, 0, -75], [40, 0, -105]];
    let t = 10;
    window.__H = {
      scale(s) { G.renderer.setPixelRatio(s); G.onResize(); },
      pose(k) { const c = G.camera; P[k](c); c.fov = 64; c.aspect = innerWidth / innerHeight; c.updateProjectionMatrix(); c.updateMatrixWorld(true); },
      step() {
        t += 1 / 60;
        G.env.update(1 / 60, t, null, null, null);
        G.env.searchlights.forEach((sl, k) => { sl.spot.target.position.set(...aims[k]); sl.spot.target.updateMatrixWorld();
          const d = sl.aim.set(...aims[k]).clone().sub(sl.spot.position).normalize();
          sl.beam.quaternion.setFromUnitVectors(new sl.aim.constructor(0, -1, 0), d);
          if (G.env.towerHousings[k]) G.env.towerHousings[k].lookAt(sl.aim); sl.spot.shadow.needsUpdate = true; });
        G.post.u.uLetterbox.value = 0; G.post.render(1 / 60, t);
      },
      frames(n) { return new Promise((d) => { const f = () => { this.step(); if (--n > 0) requestAnimationFrame(f); else setTimeout(d, 50); }; requestAnimationFrame(f); }); },
      async bench(frames = 150) {
        const gl = G.renderer.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
        const qs = [];
        for (let i = 0; i < 30; i++) this.step();
        for (let i = 0; i < frames; i++) {
          const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
          this.step();
          gl.endQuery(ext.TIME_ELAPSED_EXT); qs.push(q);
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
          if (i % 10 === 0) await new Promise((r) => setTimeout(r, 0));
        }
        const gpu = [];
        for (const q of qs) { for (let n = 0; n < 100 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); n++) await new Promise((r) => setTimeout(r, 5));
          if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); }
        const cpu = [];
        for (let i = 0; i < frames; i++) { const a = performance.now(); this.step(); cpu.push(performance.now() - a); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); }
        const frameMs = cpu.sort((x, y) => x - y)[cpu.length >> 1];
        const s = gpu.sort((x, y) => x - y);
        return { backend: 'WebGL (game)', w: gl.drawingBufferWidth, h: gl.drawingBufferHeight,
          gpuMs: s[s.length >> 1], gpuP10: s[(s.length * 0.1) | 0], gpuP90: s[(s.length * 0.9) | 0], frameMs, samples: s.length };
      },
    };
  })()`);
  for (const scale of [1, 2]) {
    await js(win, `__H.scale(${scale})`);
    for (const k of CAMS) {
      await js(win, `__H.pose('${k}'); __H.frames(8)`);
      if (scale === 1) await shot(win, `webgl_${k}`);
      rec({ label: 'webgl', scale, cam: k, ...(await js(win, `__H.bench(150)`)) });
    }
  }
  win.destroy(); await sleep(2000);
}

async function webgpu() {
  const win = await open('spike.html', { vol: '1', steps: '24', res: '0.5', still: '1' });
  await waitFor(win, `window.__SPIKE && (__SPIKE.ready || __SPIKE.error)`);
  const err = await js(win, `__SPIKE.error || null`);
  if (err) { console.log('SPIKE ERROR', err); win.destroy(); return; }
  await js(win, `document.getElementById('log').style.display = 'none'`);
  for (const scale of [1, 2]) {
    await js(win, `__SPIKE.renderer.setPixelRatio(${scale})`);
    for (const k of CAMS) {
      await js(win, `__SPIKE.setCam('${k}')`);
      if (scale === 1) for (const p of ['novol', 'vol']) {
        await js(win, `__SPIKE.usePipe('${p}'); __SPIKE.frames(8)`);
        await shot(win, `webgpu_${p}_${k}`);
      }
      // A/B/A/B so clock changes hit both alike
      const runs = { novol: [], vol: [] };
      for (let rep = 0; rep < 2; rep++) for (const p of ['novol', 'vol']) runs[p].push(await js(win, `__SPIKE.bench(150, '${p}')`));
      for (const p of ['novol', 'vol']) {
        const r = runs[p], avg = (f) => r.reduce((a, x) => a + x[f], 0) / r.length;
        rec({ label: `webgpu ${p}`, scale, cam: k, ...r[0], gpuMs: avg('gpuMs'), gpuP10: avg('gpuP10'), gpuP90: avg('gpuP90'), frameMs: avg('frameMs'), runs: r.map((x) => +x.gpuMs.toFixed(2)) });
      }
    }
  }
  win.destroy(); await sleep(1000);
}

app.whenReady().then(async () => {
  try {
    if (process.argv[4] !== 'gpu') await webgl();
    await webgpu();
  } catch (e) { console.log('HARNESS ERROR', e.stack || e); }
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
  app.quit();
});

