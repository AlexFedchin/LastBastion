// ─────────────────────────────────────────────────────────────────────────────
//  LAST BASTION — tunables. Everything gameplay-relevant lives here.
// ─────────────────────────────────────────────────────────────────────────────
import { clamp } from './core/util.js';

// ── World layout ─────────────────────────────────────────────────────────────
// The bastion sits at the apex of a V-shaped wall. Two wings run forward into
// the valley so the gunner nest can see along both wall faces.
export const WORLD = {
  WALL_H: 7.0,
  GATE_HALF: 8,          // |x| < 8 is the central tower (gun nest above it)
  WING_SLOPE: 0.55,      // dz/dx of each wing
  WING_END: 72,          // wings end at |x| = 72, then rock cliffs continue
  BASE_Z: -1.5,          // wall face z at the centre
  SECTIONS: 10,          // 5 per wing
  SECTION_W: 12.8,
  SPAWN_Z_NEAR: -205,
  SPAWN_Z_FAR: -240,
  SPAWN_X: 150,
  CAM: { x: 0, y: 13.2, z: -3.3 },
  TOWER_TOP: 11.6,
};

const COS_WING = 1 / Math.sqrt(1 + WORLD.WING_SLOPE * WORLD.WING_SLOPE);
export const WING_COS = COS_WING;
export const WING_SIN = WORLD.WING_SLOPE * COS_WING;

/** z of the wall face (or the cliff line beyond the wings) at a given x. */
export function wallZ(x) {
  const ax = x < 0 ? -x : x;
  return ax <= WORLD.GATE_HALF ? WORLD.BASE_Z : WORLD.BASE_Z - (ax - WORLD.GATE_HALF) * WORLD.WING_SLOPE;
}

/** Perpendicular distance of a point in front of the wall to the wall face. */
export function wallDist(x, z) {
  const ax = x < 0 ? -x : x;
  const dz = wallZ(x) - z;
  return ax <= WORLD.GATE_HALF ? dz : dz * COS_WING;
}

/** Inward wall normal (direction a zombie faces when clawing at the wall). */
export function wallFacing(x) {
  if (x > WORLD.GATE_HALF) return [WING_SIN, COS_WING];
  if (x < -WORLD.GATE_HALF) return [-WING_SIN, COS_WING];
  return [0, 1];
}

/** Wall section index (0..9) for x, or -1 for the central tower. */
export function sectionOf(x) {
  const { GATE_HALF, WING_END, SECTION_W } = WORLD;
  if (x < -GATE_HALF) return clamp(Math.floor((x + WING_END) / SECTION_W), 0, 4);
  if (x > GATE_HALF) return 5 + clamp(Math.floor((x - GATE_HALF) / SECTION_W), 0, 4);
  return -1;
}

/** Centre x of a section. */
export function sectionCenterX(s) {
  const { GATE_HALF, WING_END, SECTION_W } = WORLD;
  return s < 5 ? -WING_END + (s + 0.5) * SECTION_W : GATE_HALF + (s - 5 + 0.5) * SECTION_W;
}

// ── Zombies ──────────────────────────────────────────────────────────────────
export const ZT = { SHAMBLER: 0, RUNNER: 1, BRUTE: 2, BLOATER: 3 };

export const ZOMBIE_TYPES = [
  { name: 'Shambler', hp: 27, speed: [1.9, 2.6], scale: [0.9, 1.08], radius: 0.34, weight: 1, supplies: 0.6, animK: 3.0, lean: [0.1, 0.32] },
  { name: 'Runner',   hp: 22, speed: [5.2, 6.6], scale: [0.88, 1.0], radius: 0.32, weight: 1, supplies: 1.2, animK: 2.35, lean: [0.42, 0.62] },
  { name: 'Brute',    hp: 330, speed: [1.55, 1.85], scale: [1.5, 1.66], radius: 0.36, weight: 3, supplies: 8, animK: 2.3, lean: [0.18, 0.28] },
  { name: 'Bloater',  hp: 95, speed: [1.35, 1.65], scale: [1.12, 1.24], radius: 0.42, weight: 2, supplies: 3, animK: 3.1, lean: [-0.08, 0.05] },
];

export const ZOMBIE_HEIGHT = 1.8;
export const HEADSHOT_FRAC = 0.83;
export const HEADSHOT_MULT = 2.4;

// Pile-up / breach
export const PILE = {
  HEIGHT_PER_WEIGHT: 0.18, // metres of pile per unit of zombie weight in a section
  ZONE_BASE: 2.2,          // zombies this close to the wall count toward the pile
  ZONE_PER_M: 0.9,         // ...plus this much per metre of pile height
  CLIMB_TIME: [1.6, 2.8],  // seconds on top of the pile before going over (shoot them!)
  MAX_CLIMBERS: 1,         // per section at once
  KNOCKDOWN: 2.2,          // each breach costs a life but knocks that pile down (m)
  ACID_PER_BLOATER: 1.6,   // a bloater bursting on the wall melts a climbable ramp (m)
  ACID_MAX: 4.0,
  ACID_DECAY: 0.07,        // m/s
};

// ── Difficulty ───────────────────────────────────────────────────────────────
export const DIFFICULTY = {
  recruit:   { id: 'recruit',   label: 'RECRUIT',    spawnMul: 0.72, hpMul: 0.85, survivors: 40, supplyMul: 1.25, pileMul: 0.85, blurb: 'For those who want to see the end.' },
  veteran:   { id: 'veteran',   label: 'VETERAN',    spawnMul: 1.0,  hpMul: 1.0,  survivors: 30, supplyMul: 1.0,  pileMul: 1.0,  blurb: 'The intended experience. Hard, fair.' },
  laststand: { id: 'laststand', label: 'LAST STAND', spawnMul: 1.1,  hpMul: 1.08, survivors: 20, supplyMul: 0.9,  pileMul: 1.0,  blurb: 'Nobody walks out of this one.' },
};

export const FINAL_NIGHT = 10;

/** Everything the director needs to run night n. */
export function nightPlan(n, diff) {
  const k = n - 1;
  const duration = Math.min(110 + 9 * k, 220);
  const total = Math.round((520 + 340 * k + 78 * k * k) * diff.spawnMul);
  const runner = n >= 2 ? Math.min(0.4, 0.07 + 0.04 * (n - 2)) : 0;
  const brute = n >= 3 ? Math.min(0.07, 0.008 + 0.008 * (n - 3)) : 0;
  const bloater = n >= 4 ? Math.min(0.08, 0.03 + 0.007 * (n - 4)) : 0;
  return {
    night: n,
    duration,
    total,
    mix: [1 - runner - brute - bloater, runner, brute, bloater],
    surges: Math.min(2 + Math.floor(n / 2), 8),
    tide: Math.min(0.36, 0.18 + 0.018 * k),
    hpMul: diff.hpMul * (1 + 0.085 * k + 0.009 * k * k + (n > FINAL_NIGHT ? 0.06 * (n - FINAL_NIGHT) : 0)),
    // scavenging gets thinner as the nights go on
    supplyMul: 1 / (1 + 0.1 * k),
    speedMul: 1 + Math.min(0.016 * k, 0.2),
  };
}

// ── Player / weapon base stats (upgrades modify a copy) ─────────────────────
export function baseStats() {
  return {
    // M2HB .50 cal
    hmgDamage: 34, hmgRate: 10, hmgHeat: 0.033, hmgCool: 0.2, hmgCoolIdle: 0.55,
    hmgPen: 0, hmgIncendiary: 0, hmgHE: 0, hmgSpread: 0.0075, swapTime: 2.0, overheatLock: 3.5,
    // 105mm battery
    artyShells: 4, artyCooldown: 30, artyRadius: 7.5, artyDamage: 340,
    // Wall gunners
    gunners: 0, gunnerRate: 2.4, gunnerDamage: 19, gunnerSpread: 0.034,
    // Mortar pit
    mortar: 0, mortarInterval: 99, mortarShells: 1, mortarRadius: 5.5, mortarDamage: 240,
    // Napalm trench
    napalmDuration: 7, napalmCooldown: 50, napalmDps: 85,
    // Wire
    wireBands: 0, wireHp: 450,
    // Consumables per night
    flares: 2, grenades: 3,
  };
}

// ── Upgrades ─────────────────────────────────────────────────────────────────
export const UPGRADE_GROUPS = [
  { id: 'hmg', title: 'M2HB  .50 CAL', sub: 'Your gun. Your responsibility.' },
  { id: 'arty', title: '105MM BATTERY', sub: 'Two clicks behind the ridge.' },
  { id: 'wall', title: 'THE WALL', sub: 'Concrete, wire, fire, men.' },
  { id: 'support', title: 'SUPPORT', sub: 'Whatever is left in the depot.' },
];

export const UPGRADES = [
  // HMG
  { id: 'hmgDmg', group: 'hmg', name: 'MATCH-GRADE BARREL', desc: '+20% bullet damage per rank.', costs: [140, 300, 560, 900],
    apply: (s, r) => { s.hmgDamage *= 1 + 0.2 * r; } },
  { id: 'hmgRate', group: 'hmg', name: 'BUFFER SPRING', desc: '+12% rate of fire per rank.', costs: [160, 340, 620, 950],
    apply: (s, r) => { s.hmgRate *= 1 + 0.12 * r; } },
  { id: 'hmgCool', group: 'hmg', name: 'WATER JACKET', desc: '-18% heat per shot, faster cool-down.', costs: [120, 260, 480],
    apply: (s, r) => { s.hmgHeat *= 1 - 0.18 * r; s.hmgCoolIdle *= 1 + 0.25 * r; } },
  { id: 'hmgPen', group: 'hmg', name: 'AP-T ROUNDS', desc: 'Each round punches through +1 body.', costs: [220, 480, 900],
    apply: (s, r) => { s.hmgPen = r; } },
  { id: 'hmgInc', group: 'hmg', name: 'INCENDIARY BELT', desc: 'Rounds have a 12% chance per rank to set targets ablaze.', costs: [380, 760],
    apply: (s, r) => { s.hmgIncendiary = 0.12 * r; } },
  { id: 'hmgSwap', group: 'hmg', name: 'QUICK-CHANGE KIT', desc: 'Barrel swaps take 0.5 s less per rank.', costs: [100, 220],
    apply: (s, r) => { s.swapTime = 2.0 - 0.5 * r; } },
  { id: 'hmgHE', group: 'hmg', name: 'HE-I MIX', desc: 'Every hit detonates. Bodies come apart.', costs: [1500],
    apply: (s, r) => { s.hmgHE = r; } },
  // Artillery
  { id: 'artyShells', group: 'arty', name: 'SECOND GUN SECTION', desc: '+2 shells per fire mission.', costs: [220, 480, 850],
    apply: (s, r) => { s.artyShells += 2 * r; } },
  { id: 'artyCd', group: 'arty', name: 'FIRE DIRECTION CENTER', desc: '-20% time between fire missions.', costs: [200, 420, 780],
    apply: (s, r) => { s.artyCooldown *= 1 - 0.2 * r; } },
  { id: 'artyHeavy', group: 'arty', name: 'HEAVY CHARGES', desc: '+20% blast radius and damage.', costs: [320, 700],
    apply: (s, r) => { s.artyRadius *= 1 + 0.2 * r; s.artyDamage *= 1 + 0.2 * r; } },
  // Wall
  { id: 'gunners', group: 'wall', name: 'WALL GUNNERS', desc: 'Post another crewed M240 on the wall.', costs: [260, 480, 760, 1100],
    apply: (s, r) => { s.gunners = r; } },
  { id: 'crews', group: 'wall', name: 'VETERAN CREWS', desc: 'Gunners fire faster, hit harder, aim truer.', costs: [300, 700],
    apply: (s, r) => { s.gunnerRate *= 1 + 0.25 * r; s.gunnerSpread *= 1 - 0.25 * r; s.gunnerDamage *= 1 + 0.15 * r; } },
  { id: 'wire', group: 'wall', name: 'CONCERTINA WIRE', desc: 'Rank 1: wire band at 22 m. Rank 2: second band at 45 m. Rank 3: double strand.', costs: [160, 340, 560],
    apply: (s, r) => { s.wireBands = Math.min(r, 2); if (r >= 3) s.wireHp *= 2.2; } },
  { id: 'napalm', group: 'wall', name: 'NAPALM TRENCH', desc: 'Burns 3 s longer and refills 10 s faster per rank.', costs: [220, 480],
    apply: (s, r) => { s.napalmDuration += 3 * r; s.napalmCooldown -= 10 * r; s.napalmDps *= 1 + 0.25 * r; } },
  // Support
  { id: 'mortar', group: 'support', name: 'MORTAR PIT', desc: 'An 81 mm crew shells the thickest crowds. Ranks: faster, then twin tubes.', costs: [320, 560, 900],
    apply: (s, r) => { s.mortar = r; s.mortarInterval = [99, 6.5, 4.5, 3.4][r]; s.mortarShells = r >= 3 ? 2 : 1; } },
  { id: 'flares', group: 'support', name: 'FLARE CACHE', desc: '+1 illumination flare per night. Lit targets take +25% damage.', costs: [90, 180, 300],
    apply: (s, r) => { s.flares += r; } },
  { id: 'grenades', group: 'support', name: 'GRENADE CRATE', desc: '+2 grenade bundles per night.', costs: [110, 240],
    apply: (s, r) => { s.grenades += 2 * r; } },
];

// Consumable purchase
export const CLAYMORE = { cost: 150, perBuy: 6, max: 36, triggerR: 2.6, radius: 5.5, damage: 300 };

export const SUPPLY_BONUS = (night, survivors) => 200 + 30 * night + 4 * survivors;

// ── Abilities ────────────────────────────────────────────────────────────────
export const ABILITY = {
  grenade: { radius: 4.6, damage: 170, count: 3, maxRange: 70 },
  dangerClose: { cost: 3, shells: 40, radius: 7.5, damage: 420 },
  flare: { duration: 26, radius: 48, exposeMult: 1.25 },
  // T: throw a red marker flare anywhere on the field; a bomber puts a 2000 lb bomb on it
  bomber: { cooldown: 75, firstDelay: 12, maxRange: 320, minWallDist: 16, radius: 24, damage: 1400,
    alt: 110, speed: 100, fall: 3.2 },
};

// ── AC-130 gunship: circles the valley all night and works the field ─────────
export const GUNSHIP = {
  center: { x: 0, z: -135 }, radius: 245, alt: 160, speed: 68,
  engageMin: 5, engageMax: 11,           // seconds between engagements
  g25: { rate: 28, burst: [1.1, 2.0], scatter: 4.5, damage: 75, radius: 2.4, minWall: 8 },
  g40: { rounds: [3, 6], interval: 0.55, scatter: 3.5, damage: 240, radius: 4.8, minWall: 14 },
  g105: { damage: 560, radius: 9, minWall: 26, minCluster: 9 },
};

// ── Radio. The story is told in fragments. ───────────────────────────────────
export const RADIO = {
  1: [
    ['COMMAND', 'Bastion-7, this is Command. Relief column departs at dawn. Hold for seventy-two hours.'],
    ['SGT. KOVAC', 'You heard the man. Seventy-two hours. Keep that barrel cool and the wall clean.'],
  ],
  2: [
    ['COMMAND', 'Bastion-7, relief column delayed. Bridge at Halden is down. Keep the gate shut.'],
    ['SGT. KOVAC', 'Whatever you hear out there tonight — the gate stays shut.'],
  ],
  3: [
    ['UNKNOWN', '...anyone on this frequency... we\'re at the overpass, we have children with us, please—'],
    ['SGT. KOVAC', 'Overpass is forty klicks out. There\'s nothing we can do. Eyes front.'],
  ],
  4: [
    ['COMMAND', 'Bastion-7, airdrop of fuel and ammunition inbound at dawn. Mark your drop zone.'],
    ['SGT. KOVAC', 'Bloaters in the mix tonight. Don\'t let them touch the wall.'],
  ],
  5: [
    ['COMMAND', '...all stations, Bastion-3 has fallen. Bastion-5 is not responding.'],
    ['SGT. KOVAC', 'We\'re what\'s left on this line. Make it count.'],
  ],
  6: [
    ['COMMAND', 'Bastion-7... relief column has been... (static) ...rerouted. Hold position.'],
    ['SGT. KOVAC', 'Rerouted. Sure. Load the belt.'],
  ],
  7: [
    ['SGT. KOVAC', 'Command hasn\'t answered since 0300. I\'m sure it\'s the antenna.'],
    ['PVT. ARAN', 'Sarge... the city stopped burning.'],
  ],
  8: [
    ['AUTOMATED', 'This frequency is no longer monitored. This frequency is no longer monitored.'],
    ['SGT. KOVAC', 'Then we monitor it. Bastion-7 is holding. Say it.'],
  ],
  9: [
    ['SGT. KOVAC', 'Biggest one yet coming down the valley. Everything we have, tonight.'],
    ['PVT. ARAN', 'Sarge, if this is it... it was an honour.'],
  ],
  10: [
    ['SGT. KOVAC', 'Seventy-two hours. This is the last night. Whatever comes down that valley — we are still here.'],
    ['SGT. KOVAC', 'If anyone is listening: Bastion-7 is holding. Bastion-7 is holding.'],
  ],
  endless: [
    ['SGT. KOVAC', 'No relief. No orders. Just the night, and the gun.'],
    ['SGT. KOVAC', 'Count the survivors. Then count the dead out there. Keep counting.'],
    ['PVT. ARAN', 'I stopped writing their names down.'],
    ['SGT. KOVAC', 'They\'ll come again tomorrow. So will we.'],
  ],
};

export const BARKS = {
  surge: ['Big group coming down the valley!', 'Horde inbound! Get on them!', 'Here they come — dozens! Hundreds!', 'Movement on the ridge — it\'s a whole wave!'],
  pile: ['They\'re stacking on the wall!', 'They\'re climbing! Clear that section!', 'Wall\'s going — shoot the pile!'],
  breach: ['They\'re over the wall!', 'Breach! We lost someone!', 'Man down! They got in!'],
  overheat: ['Barrel\'s cooked!', 'Gun\'s too hot!'],
  dawn: ['Sun\'s up. We made it.', 'Dawn. Count the living.', 'Another night. Another dawn.'],
  massacre: ['Look at them burn!', 'That\'s a whole column gone!', 'Keep it up!'],
};
