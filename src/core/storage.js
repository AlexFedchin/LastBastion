// Settings, quality presets and the campaign save (localStorage).

export const QUALITY = {
  low: {
    label: 'LOW', volumetric: false, pixelRatio: 0.7, msaa: 0, bloomScale: 0.35, spotShadows: 0, shadowMap: 512,
    maxZombies: 900, corpses: 1500, particles: 4500, decals: 2000, gibs: 500, lights: 6, rain: 2500, texSize: 512, zombieShadows: false, grass: 5000,
  },
  medium: {
    label: 'MEDIUM', volumetric: true, pixelRatio: 0.85, msaa: 2, bloomScale: 0.45, spotShadows: 1, shadowMap: 1024,
    maxZombies: 1400, corpses: 2500, particles: 7000, decals: 3500, gibs: 900, lights: 8, rain: 4500, texSize: 1024, zombieShadows: true, grass: 12000,
  },
  high: {
    label: 'HIGH', volumetric: true, pixelRatio: 1, msaa: 4, bloomScale: 0.5, spotShadows: 2, shadowMap: 1024,
    maxZombies: 2000, corpses: 3500, particles: 10000, decals: 5000, gibs: 1200, lights: 9, rain: 6500, texSize: 1024, zombieShadows: true, grass: 20000,
  },
  ultra: {
    label: 'ULTRA', volumetric: true, pixelRatio: 1.5, msaa: 4, bloomScale: 0.6, spotShadows: 2, shadowMap: 2048,
    maxZombies: 2800, corpses: 5000, particles: 14000, decals: 7000, gibs: 1600, lights: 10, rain: 9000, texSize: 1024, zombieShadows: true, grass: 30000,
  },
};

export const DEFAULT_SETTINGS = {
  quality: 'high', sensitivity: 1, invertY: false, fov: 64,
  master: 0.8, music: 0.55, sfx: 0.9, showFps: false, gunSound: 'new',
  tips: true, // the first night's coaching (src/ui/coach.js); turns itself off once it has run
};

const SETTINGS_KEY = 'lastbastion.settings.v1';
const SAVE_KEY = 'lastbastion.save.v1';

function read(key) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or disabled */ }
}

export function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...(read(SETTINGS_KEY) || {}) };
}
export function saveSettings(s) { write(SETTINGS_KEY, s); }

export function loadSave() {
  const s = read(SAVE_KEY);
  return s && s.version === 1 ? s : null;
}
export function writeSave(run) {
  if (run.dev) return; // a developer-tools run never saves over the campaign
  write(SAVE_KEY, {
    version: 1,
    difficulty: run.difficulty,
    night: run.night,
    survivors: run.survivors,
    supplies: run.supplies,
    kills: run.kills,
    upgrades: run.upgrades,
    minesOwned: run.minesOwned,
    endless: run.endless,
    atShop: !!run.atShop,
    totals: run.totals,
    log: run.log.slice(-8),
  });
}
export function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ } }

// The endless record: the most nights held past the seventy-second hour (kills break ties).
const BEST_KEY = 'lastbastion.best.v1';
export function loadBest() { return read(BEST_KEY); }
/** Record an endless run's progress; returns true if it is a new record. */
export function recordBest(nights, kills, difficulty) {
  const b = read(BEST_KEY);
  if (b && (b.nights > nights || (b.nights === nights && b.kills >= kills))) return false;
  write(BEST_KEY, { nights, kills, difficulty, at: Date.now() });
  return true;
}
