// IPC between the game page and the Electron main process. Shared by the app
// (electron/main.js) and the smoke tests (tests/smoke/run.js), so the tests
// exercise the same asset loading and telemetry file sink the game ships with.
const path = require('path');
const fs = require('fs');

/**
 * @param {object} o
 * @param {Electron.IpcMain} o.ipcMain
 * @param {Electron.App} o.app
 * @param {Electron.Shell} [o.shell]
 * @param {() => Electron.BrowserWindow|null} o.getWindow
 * @param {string} o.appDir  folder holding index.html and audio/
 */
function registerIpc({ ipcMain, app, shell, getWindow, appDir }) {
  ipcMain.on('app:quit', () => app.quit());
  ipcMain.on('app:fullscreen', (_e, value) => {
    const win = getWindow();
    if (win) win.setFullScreen(typeof value === 'boolean' ? value : !win.isFullScreen());
  });
  ipcMain.handle('app:isFullscreen', () => { const win = getWindow(); return win ? win.isFullScreen() : false; });

  // Game audio lives in app/audio; the renderer asks for files by relative path.
  const AUDIO_DIR = path.join(appDir, 'audio');
  ipcMain.handle('app:readAsset', async (_e, rel) => {
    if (typeof rel !== 'string') throw new Error('bad asset path');
    const full = path.normalize(path.join(appDir, rel));
    if (!full.startsWith(AUDIO_DIR + path.sep)) throw new Error('asset outside app/audio: ' + rel);
    return fs.promises.readFile(full);
  });

  // Play-test telemetry: the game sends one JSON line per record; we append them
  // to userData/telemetry/session-<date>.jsonl (one file per launch).
  const dir = () => path.join(app.getPath('userData'), 'telemetry');
  let stream = null, file = null;
  const telemetryFile = () => {
    if (!file) {
      fs.mkdirSync(dir(), { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      file = path.join(dir(), `session-${stamp}.jsonl`);
    }
    return file;
  };
  ipcMain.on('app:telemetry', (_e, line) => {
    if (typeof line !== 'string' || line.length > 500000) return;
    try {
      if (!stream) stream = fs.createWriteStream(telemetryFile(), { flags: 'a' });
      stream.write(line + '\n');
    } catch { /* never let logging break the game */ }
  });
  ipcMain.handle('app:telemetryPath', () => telemetryFile());
  ipcMain.on('app:openTelemetry', () => {
    try { fs.mkdirSync(dir(), { recursive: true }); if (shell) shell.openPath(dir()); } catch { /* noop */ }
  });

  return {
    telemetryFile,
    /** Flush and close the log (before quitting). */
    close: () => new Promise((resolve) => { if (stream) stream.end(resolve); else resolve(); }),
  };
}

module.exports = { registerIpc };
