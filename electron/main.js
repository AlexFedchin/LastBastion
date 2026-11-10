// Last Bastion — Electron shell
const { app, BrowserWindow, ipcMain, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// Prefer the discrete GPU on dual-GPU laptops and never let the GPU blocklist
// drop us to software rendering.
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let win = null;

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const startFullscreen = !process.argv.includes('--windowed');

  win = new BrowserWindow({
    width: Math.min(1600, width),
    height: Math.min(900, height),
    minWidth: 1024,
    minHeight: 600,
    backgroundColor: '#050506',
    title: 'Last Bastion',
    show: false,
    fullscreen: startFullscreen,
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'app', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });

  win.setMenu(null);
  win.loadFile(path.join(__dirname, '..', 'app', 'index.html'));
  win.once('ready-to-show', () => win.show());

  // F11 toggles fullscreen, F12 opens devtools (handy when tweaking from VS Code).
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    } else if (input.key === 'F12') {
      win.webContents.toggleDevTools();
      event.preventDefault();
    } else if (input.control && input.key.toLowerCase() === 'r') {
      win.webContents.reloadIgnoringCache();
      event.preventDefault();
    }
  });

  win.on('closed', () => { win = null; });
}

ipcMain.on('app:quit', () => app.quit());
ipcMain.on('app:fullscreen', (_e, value) => {
  if (win) win.setFullScreen(typeof value === 'boolean' ? value : !win.isFullScreen());
});
ipcMain.handle('app:isFullscreen', () => (win ? win.isFullScreen() : false));

// Game audio lives in app/audio; the renderer asks for files by relative path.
const AUDIO_DIR = path.join(__dirname, '..', 'app', 'audio');
ipcMain.handle('app:readAsset', async (_e, rel) => {
  if (typeof rel !== 'string') throw new Error('bad asset path');
  const full = path.normalize(path.join(__dirname, '..', 'app', rel));
  if (!full.startsWith(AUDIO_DIR + path.sep)) throw new Error('asset outside app/audio: ' + rel);
  return fs.promises.readFile(full);
});

// Play-test telemetry: the game sends one JSON line per record; we append them
// to userData/telemetry/session-<date>.jsonl (one file per launch).
const TELEMETRY_DIR = () => path.join(app.getPath('userData'), 'telemetry');
let teleStream = null, teleFile = null;
function telemetryFile() {
  if (!teleFile) {
    fs.mkdirSync(TELEMETRY_DIR(), { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    teleFile = path.join(TELEMETRY_DIR(), `session-${stamp}.jsonl`);
  }
  return teleFile;
}
ipcMain.on('app:telemetry', (_e, line) => {
  if (typeof line !== 'string' || line.length > 500000) return;
  try {
    if (!teleStream) teleStream = fs.createWriteStream(telemetryFile(), { flags: 'a' });
    teleStream.write(line + '\n');
  } catch { /* never let logging break the game */ }
});
ipcMain.handle('app:telemetryPath', () => telemetryFile());
ipcMain.on('app:openTelemetry', () => { try { fs.mkdirSync(TELEMETRY_DIR(), { recursive: true }); shell.openPath(TELEMETRY_DIR()); } catch { /* noop */ } });
app.on('before-quit', () => { if (teleStream) teleStream.end(); });

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
