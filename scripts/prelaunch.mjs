// Used by VS Code (F5) and the run scripts: installs dependencies on first run,
// then bundles the game. Safe to run repeatedly.
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

const needInstall =
  !existsSync(path.join(root, 'node_modules', 'three')) ||
  !existsSync(path.join(root, 'node_modules', 'esbuild')) ||
  !existsSync(path.join(root, 'node_modules', 'electron'));

if (needInstall) {
  console.log('[prelaunch] First run: installing dependencies (one time, ~1 min)...');
  execSync('npm install --no-audit --no-fund', { stdio: 'inherit' });
}

// Electron fetches its binary lazily; make sure it is present before launching.
try {
  execSync('node node_modules/electron/install.js', { stdio: 'inherit' });
} catch {
  console.warn('[prelaunch] Electron binary download failed - check your connection and retry.');
  process.exit(1);
}

console.log('[prelaunch] Bundling game...');
execSync('node scripts/build.mjs', { stdio: 'inherit' });
console.log('[prelaunch] Ready.');
