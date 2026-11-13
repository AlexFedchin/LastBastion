// Electron: render a GLB contact sheet to PNG.
// usage: env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe scripts/models/preview.cjs <glb> <out.png> [viewsJSON] [zoom]
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const [glb, out, views, zoom] = process.argv.slice(2).filter((a) => !a.startsWith('--') && !a.endsWith('preview.cjs') && a !== '.');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1800, height: 900, webPreferences: { webSecurity: false, offscreen: false } });
  const q = new URLSearchParams({ f: 'file:///' + path.resolve(glb).replace(/\\/g, '/') });
  if (views) q.set('views', views);
  if (zoom) q.set('zoom', zoom);
  if (process.env.DEBUG) q.set('debug', process.env.DEBUG);
  win.webContents.on('console-message', (e) => console.log('[page]', e.message));
  await win.loadURL('file:///' + path.join(__dirname, 'preview.html').replace(/\\/g, '/') + '?' + q);
  let info = null;
  for (let i = 0; i < 300 && !info; i++) { await new Promise((r) => setTimeout(r, 100)); info = await win.webContents.executeJavaScript('window.__done || null'); }
  if (!info) { console.error('timed out'); app.exit(1); return; }
  const png = await win.webContents.executeJavaScript(`document.querySelector('canvas').toDataURL('image/png')`);
  fs.writeFileSync(out, Buffer.from(png.split(',')[1], 'base64'));
  console.log(JSON.stringify(info));
  app.exit(0);
});
