// Electron: render the kit contact sheet.
// usage: env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe scripts/models/kit_sheet.cjs <out.png> <name,name,...>
const { app, BrowserWindow } = require('electron');
const path = require('path'), fs = require('fs');
const [out, names] = process.argv.slice(2).filter((a) => !a.startsWith('--') && !a.endsWith('kit_sheet.cjs') && a !== '.');
const LOG = (m) => fs.appendFileSync(out + '.log', m + '\n');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1840, height: 1840, webPreferences: { webSecurity: false, backgroundThrottling: false } });
  win.webContents.setAudioMuted(true);
  win.webContents.on('console-message', (e) => LOG('[page] ' + (e.message || '')));
  await win.loadURL('file:///' + path.join(__dirname, 'kit_sheet.html').replace(/\\/g, '/') + '?n=' + names);
  let info = null;
  for (let i = 0; i < 900 && !info; i++) { await new Promise((r) => setTimeout(r, 100)); info = await win.webContents.executeJavaScript('window.__done || null'); }
  if (!info) { LOG('timed out'); app.exit(1); return; }
  const png = await win.webContents.executeJavaScript(`document.getElementById('out').toDataURL('image/png')`);
  fs.writeFileSync(out, Buffer.from(png.split(',')[1], 'base64'));
  fs.writeFileSync(out + '.json', JSON.stringify(info));
  app.exit(0);
});
