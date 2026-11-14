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
export const ZT = { SHAMBLER: 0, RUNNER: 1, BRUTE: 2, BLOATER: 3, GIANT: 4 };

export const ZOMBIE_TYPES = [
  { name: 'Shambler', hp: 27, speed: [1.9, 2.6], scale: [0.9, 1.08], radius: 0.34, weight: 1, supplies: 0.6, animK: 3.0, lean: [0.1, 0.32] },
  { name: 'Runner',   hp: 22, speed: [5.2, 6.6], scale: [0.88, 1.0], radius: 0.32, weight: 1, supplies: 1.2, animK: 2.35, lean: [0.42, 0.62] },
  { name: 'Brute',    hp: 330, speed: [1.55, 1.85], scale: [1.5, 1.66], radius: 0.36, weight: 3, supplies: 8, animK: 2.3, lean: [0.18, 0.28] },
  { name: 'Bloater',  hp: 95, speed: [1.35, 1.65], scale: [1.12, 1.24], radius: 0.42, weight: 2, supplies: 3, animK: 3.1, lean: [-0.08, 0.05] },
  // event boss only (never in the night mix): see EVENTS.giant
  { name: 'Giant',    hp: 14000, speed: [1.5, 1.6], scale: [3.9, 4.1], radius: 0.4, weight: 0, supplies: 120, animK: 2.3, lean: [0.32, 0.4] },
];

export const ZOMBIE_HEIGHT = 1.8;
export const HEADSHOT_FRAC = 0.83;
export const HEADSHOT_MULT = 2.4;

// Pile-up / breach
// Piles are mounds against the wall face: a half-cone whose base widens as it grows
// (radius R0 + SLOPE per metre of height). Height goes with the square root of the weight on it,
// so each metre costs more bodies than the last, and the crowd drifts toward a pile that has started.
export const PILE = {
  K: 0.74,                 // height = K * sqrt(weight on the mound)  -> ~90 bodies to reach the top
  R0: 2.6,                 // base radius of a fresh mound (m)
  SLOPE: 1.35,             // ...plus this much per metre of height (a wide, low pyramid)
  MIN_X: 24,               // no piles closer than this to the tower (|x|): the gunner has to see their feet
  SEED_D: 1.3,             // a zombie this close to the wall with no mound around starts one
  SPACING: 11,             // ...unless another mound's centre is this close along the wall
  MAX: 24,                 // mounds at once
  SEEK_D: 45,              // within this of the wall the crowd looks for a mound to join
  SEEK_RANGE: 30,          // ...up to this far along the wall from where it was heading
  RISE: 0.14,              // m/s at most: bodies have to clamber on (a mound takes ~50 s to top out)
  CLIMB_TIME: [1.6, 2.8],  // seconds on top of the pile before going over (shoot them!)
  MAX_CLIMBERS: 1,         // per section at once
  KNOCKDOWN: 3.0,          // each breach costs a life but knocks that pile down (m)
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
    // scavenging gets thinner as the nights go on: maxing everything out takes the whole siege
    supplyMul: 0.85 / (1 + 0.3 * k),
    speedMul: 1 + Math.min(0.016 * k, 0.2),
  };
}

// ── Player / weapon base stats (upgrades modify a copy) ─────────────────────
export function baseStats() {
  return {
    // M2HB .50 cal
    hmgDamage: 34, hmgRate: 10, hmgHeat: 0.033, hmgCool: 0.2, hmgCoolIdle: 0.55,
    hmgPen: 0, hmgIncendiary: 0, hmgHE: 0, hmgSpread: 0.0075, overheatLock: 3.5,
    // 105mm battery
    artyShells: 4, artyCooldown: 30, artyRadius: 13, artyDamage: 950,
    // Wall gunners
    // two crewed M240s are on the wall from the start; upgrades post the other two
    gunners: 2, gunnerRate: 2.4, gunnerDamage: 15, gunnerSpread: 0.034,
    // Molotovs: bottles per night, and the burning pool each one leaves
    molotovs: 6, molotovBurn: 9, molotovRadius: 5.4, molotovDps: 70,
    // Wire
    wireBands: 0, wireHp: 450,
    // Consumables per night
    grenades: 8,
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
  { id: 'hmgDmg', group: 'hmg', name: 'MATCH-GRADE BARREL', desc: 'Heavier, truer rounds.', total: (r) => `+${20 * r}% bullet damage`, costs: [140, 300, 560, 900],
    apply: (s, r) => { s.hmgDamage *= 1 + 0.2 * r; } },
  { id: 'hmgRate', group: 'hmg', name: 'BUFFER SPRING', desc: 'A stiffer spring cycles the bolt faster.', total: (r) => `+${12 * r}% rate of fire`, costs: [160, 340, 620, 950],
    apply: (s, r) => { s.hmgRate *= 1 + 0.12 * r; } },
  { id: 'hmgCool', group: 'hmg', name: 'WATER JACKET', desc: 'Water around the barrel carries the heat off.', total: (r) => `−${18 * r}% heat per shot, cools ${25 * r}% faster`, costs: [120, 260, 480],
    apply: (s, r) => { s.hmgHeat *= 1 - 0.18 * r; s.hmgCoolIdle *= 1 + 0.25 * r; } },
  { id: 'hmgPen', group: 'hmg', name: 'AP-T ROUNDS', desc: 'Armour-piercing tracer.', total: (r) => `each round goes through ${r} more ${r > 1 ? 'bodies' : 'body'}`, costs: [220, 480, 900],
    apply: (s, r) => { s.hmgPen = r; } },
  { id: 'hmgInc', group: 'hmg', name: 'INCENDIARY BELT', desc: 'Incendiary rounds in the belt.', total: (r) => `${12 * r}% chance a hit sets the target ablaze`, costs: [380, 760],
    apply: (s, r) => { s.hmgIncendiary = 0.12 * r; } },
  { id: 'hmgHE', group: 'hmg', name: 'HE-I MIX', desc: 'High-explosive incendiary. Bodies come apart.', total: () => 'every hit detonates', costs: [1500],
    apply: (s, r) => { s.hmgHE = r; } },
  // Artillery
  { id: 'artyShells', group: 'arty', unlock: 'artillery', name: 'SECOND GUN SECTION', desc: 'Another section of guns joins each mission.', total: (r) => `${4 + 2 * r} shells per fire mission`, costs: [220, 480, 850],
    apply: (s, r) => { s.artyShells += 2 * r; } },
  { id: 'artyCd', group: 'arty', unlock: 'artillery', name: 'FIRE DIRECTION CENTER', desc: 'Faster plotting, faster reloads.', total: (r) => `${Math.round(30 * (1 - 0.2 * r))} s between fire missions (−${20 * r}%)`, costs: [200, 420, 780],
    apply: (s, r) => { s.artyCooldown *= 1 - 0.2 * r; } },
  { id: 'artyHeavy', group: 'arty', unlock: 'artillery', name: 'HEAVY CHARGES', desc: 'Bigger powder charges.', total: (r) => `+${20 * r}% blast radius and damage`, costs: [320, 700],
    apply: (s, r) => { s.artyRadius *= 1 + 0.2 * r; s.artyDamage *= 1 + 0.2 * r; } },
  // Wall
  { id: 'gunners', group: 'wall', name: 'WALL GUNNERS', desc: 'Post another crewed M240 on the wall.', total: (r) => `${Math.min(4, 2 + r)} M240s on the wall`, costs: [420, 820],
    apply: (s, r) => { s.gunners = Math.min(4, 2 + r); } },
  { id: 'crews', group: 'wall', name: 'VETERAN CREWS', desc: 'Gunners fire faster, hit harder, aim truer.', total: (r) => `+${25 * r}% fire rate, +${15 * r}% damage, −${25 * r}% spread`, costs: [300, 700],
    apply: (s, r) => { s.gunnerRate *= 1 + 0.25 * r; s.gunnerSpread *= 1 - 0.25 * r; s.gunnerDamage *= 1 + 0.15 * r; } },
  { id: 'wire', group: 'wall', name: 'CONCERTINA WIRE', desc: 'Wire in the approach slows them and cuts them up.', total: (r) => ['', 'a wire band at 22 m', 'wire bands at 22 m and 45 m', 'double-strand bands at 22 m and 45 m'][r], costs: [160, 340, 560],
    apply: (s, r) => { s.wireBands = Math.min(r, 2); if (r >= 3) s.wireHp *= 2.2; } },
  // Support
  { id: 'grenades', group: 'support', unlock: 'grenades', name: 'GRENADE CRATE', desc: 'More grenades from the depot.', total: (r) => `${8 + 4 * r} grenades a night`, costs: [110, 240],
    apply: (s, r) => { s.grenades += 4 * r; } },
  { id: 'molotov', group: 'support', unlock: 'molotov', name: 'MOLOTOV CRATE', desc: 'More bottles and fuel.', total: (r) => `${6 + 3 * r} bottles a night`, costs: [180, 400],
    apply: (s, r) => { s.molotovs += 3 * r; } },
  { id: 'molotovFuel', group: 'support', unlock: 'molotov', name: 'THICKENED FUEL', desc: 'Sticky fuel that clings and spreads.', total: (r) => `fire ${25 * r}% wider, ${3 * r} s longer, ${20 * r}% hotter`, costs: [240, 520, 880],
    apply: (s, r) => { s.molotovRadius *= 1 + 0.25 * r; s.molotovBurn += 3 * r; s.molotovDps *= 1 + 0.2 * r; } },
];

// Consumable purchase
export const CLAYMORE = { cost: 150, perBuy: 6, max: 36, triggerR: 2.6, radius: 5.5, damage: 300 };

export const SUPPLY_BONUS = (night, survivors) => 150 + 15 * night + 3 * survivors;

// ── Abilities ────────────────────────────────────────────────────────────────
export const ABILITY = {
  // thrown one at a time (G), a short re-arm between throws
  grenade: { radius: 7.5, damage: 320, maxRange: 90, rearm: 0.45 },
  // E: light the rag, throw the bottle. What stands in the pool burns; what walks through it catches.
  molotov: { maxRange: 85, rearm: 0.75, light: 0.2, igniteSeconds: 5, igniteDps: 24, maxPools: 10 },
  dangerClose: { cost: 3, shells: 40, radius: 7.5, damage: 420 },
  // T: throw a red marker flare anywhere on the field; a bomber puts a 2000 lb bomb on it
  bomber: { cooldown: 75, firstDelay: 12, maxRange: 320, minWallDist: 16, radius: 24, damage: 1400,
    alt: 175, speed: 100, fall: 4.0, scale: 0.45 }, // B-36: 70 m span
};

// ── AC-130 gunship: circles the valley all night and works the field ─────────
export const GUNSHIP = {
  // a wide, slow orbit high over the valley: small in the sky, unhurried
  center: { x: 0, z: -170 }, radius: 360, alt: 220, speed: 46, scale: 0.75,
  // Spectre works the far field and leaves the wall to you (minWall = metres from the wall)
  engageMin: 8, engageMax: 15,           // seconds between engagements
  // GAU-12 25 mm Gatling: bursts of fixed length (one sound take each), rounds walked across the crowd
  gau: { rate: 40, bursts: [1.1, 1.6, 2.2], scatter: 3.2, damage: 75, radius: 2.8, minWall: 45 },
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

// Call signs and the radio traffic that has its own trigger in the game.
export const CALL = {
  kovac: 'SGT. KOVAC', aran: 'PVT. ARAN', command: 'COMMAND', unknown: 'UNKNOWN', battery: 'BATTERY',
  hammer: 'HAMMER 1-1', spectre: 'SPECTRE 2-1', spectre2: 'SPECTRE 2-2', hollis: 'LT. HOLLIS', reach: 'REACH 3-1', survivor: 'SURVIVOR',
  narrator: 'NARRATOR',
};
export const COMMS = {
  battery: {
    4: 'Shot, over. Four rounds HE, splash in three.',
    6: 'Shot, over. Six rounds HE, splash in three.',
    8: 'Shot, over. Eight rounds HE, splash in three.',
    10: 'Shot, over. Ten rounds HE, splash in three.',
  },
  markerOut: 'Red smoke out! Get your heads down!',
  dangerClose: 'Danger close! Everything on the wall line — God forgive us.',
  hammerIn: [
    'Hammer one-one, I have your red smoke. One GBU, danger close. Heads down, Bastion.',
    'Hammer one-one, tally your mark. Two-thousand pounder inbound, ten seconds.',
    'Copy red flare. Hammer one-one is in hot — keep your heads down.',
  ],
  hammerGood: [
    'Good effect on target. That\'s a lot of them down. Hammer one-one off and climbing.',
    'Shack. Direct hit on your mark. Hammer one-one off target.',
  ],
  hammerOff: ['Bomb impact. Hammer one-one off target, re-arming.'],
  spectreIntro: 'Bastion-7, Spectre two-one on station overhead. We\'ll work the crowds in the field — you hold that wall.',
  spectreIntro2: 'Bastion-7, Spectre two-two on station. Two-one were friends of ours. Let\'s make them pay for it.',
  spectre: [
    'Good hits, good hits. Lot of movement down there, Bastion.',
    'Shifting fire. Keep that fifty talking.',
    'Spectre still on station. We have you covered.',
    'Big group moving up the road — engaging.',
    'Sparkle on the treeline. Rounds away.',
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

// ── What you have, and when: one new tool a night so nobody drowns on night 1 ─
// (night 1 is the fifty and the two wall gunners)
export const UNLOCKS = {
  molotov: 2, grenades: 2, claymores: 2,
  artillery: 3, gunship: 3,
  bomber: 4,
  dangerClose: 5,
};
export const isUnlocked = (key, night) => night >= (UNLOCKS[key] ?? 1);
export const UNLOCK_INFO = {
  molotov: 'MOLOTOVS [E]', grenades: 'GRENADES [G]', claymores: 'CLAYMORES',
  artillery: '105MM BATTERY [Q]', gunship: 'SPECTRE',
  bomber: 'BOMBER [T]', dangerClose: 'DANGER CLOSE [B]',
};
export const UNLOCK_LINES = {
  2: [[CALL.kovac, 'Engineers found a crate of bottles and a jerrycan in the depot. E throws a Molotov — put it on the wall base and let them burn. And there\'s a crate of grenades at your feet. G, for anything climbing.']],
  3: [[CALL.command, 'Bastion-7, Command. You now have a one-oh-five battery on call. Q puts a fire mission wherever you are looking.']],
  4: [[CALL.hammer, 'Bastion-7, Hammer one-one is on call tonight. Throw a red flare where you want it — that\'s T — and keep your heads down.']],
  5: [[CALL.kovac, 'Listen. If it all goes wrong, B brings the guns down on our own wall line. It will cost us men. Use it only if the wall is lost.']],
};

// ── Night events: one signature event per night, random ones in endless ─────
// [event, when (fraction of the night's spawning window)]
export const NIGHT_EVENTS = {
  1: [['patrol', 0.4]],
  2: [['fog', 0.3], ['tanker', 0.62]],
  3: [['cliffs', 0.25], ['civilians', 0.55]],
  4: [['drop', 0.32]],
  5: [['giant', 0.42]],
  6: [['stampede', 0.4], ['cliffs', 0.72]],
  7: [['blackout', 0.3]],
  8: [['gunshipDown', 0.28], ['convoy', 0.58]],
  9: [['drop', 0.18], ['bloaters', 0.5]],
  10: [['behemoth', 0.5]],
};
export const ENDLESS_EVENTS = ['giant', 'stampede', 'bloaters', 'drop', 'fog', 'blackout', 'civilians', 'tanker', 'convoy', 'cliffs'];

export const EVENTS = {
  patrol: { count: 4, speed: [4.5, 4.9], chasers: 16, catchR: 1.05, reward: { survivors: 1, supplies: 40 } },
  civilians: { count: 6, speed: [3.8, 4.3], chasers: 20, catchR: 1.05, reward: { survivors: 1, supplies: 20 } },
  // the recovery team leaves the gate teamDelay s after the crate lands, rigs it for rig s,
  // and carries it home at carrySpeed[men still standing] m/s
  // the gate squad: four men step out of the gate to cover anyone of ours coming in
  cover: { men: 4, callD: 95, out: [7, 11], speed: 4.6, every: [0.22, 0.45], range: 55, hit: 0.55, damage: 30, catchR: 1.0, fallBack: 4.5, linger: 3 },
  drop: { teamDelay: 6, teamSpeed: [4.4, 4.8], rig: 3.5, carrySpeed: [0, 1.0, 1.7, 2.1, 2.4], catchR: 1.0,
    tear: 1.3, maxTearing: 6, pull: 32, reward: { grenades: 6, molotovs: 3, supplies: 150 } },
  giant: { name: 'GOLIATH', hpMul: 1, scale: 4.0, smash: 2.4 },
  behemoth: { name: 'BEHEMOTH', hpMul: 1.8, scale: 5.4, smash: 1.8 },
  stampede: { brutes: 14, speed: 1.75, runners: 20 },
  bloaters: { count: 45 },
  fog: { duration: 55 },
  // a fuel tanker on the road: hp = rounds through the tank before it goes up
  tanker: { z: [-125, -95], hp: 14, crowd: 70, radius: 16, damage: 1500, fireRadius: 9, fireBurn: 22, timeout: 75 },
  // survivors' truck running the road: speed m/s, slowed by the dead in front, torn by the dead on it
  convoy: { speed: 6.5, blockers: 40, chasers: 24, tear: 2.2, maxTearing: 8, reward: { survivors: 3, supplies: 120 } },
  // the dead coming down over the rocks at the end of a wing, over `over` seconds
  // high on the mountain past the wing end (|x|, metres out from the wall line, height up the slope);
  // steepSlow: how much a steep descent slows them (speed × 1.05 − drop·steepSlow, floor 0.55)
  cliffs: { count: 60, over: 22, spawnX: [98, 135], spawnOut: [15, 55], high: [14, 45], steepSlow: 0.45 },
  blackout: { duration: 45 },
};
// '@spectre' is whichever gunship crew is up that night
export const EVENT_LINES = {
  cover: {
    out: [[CALL.kovac, 'Gate squad, out! Cover them in!'], [CALL.kovac, 'Open the gate — squad out, bring them home!'], [CALL.kovac, 'Second squad, out the gate! Covering fire!']],
    back: [[CALL.kovac, 'Everybody in? Squad, back inside — shut the gate!'], [CALL.kovac, 'That\'s all of them. Gate squad, pull back!']],
    lost: [[CALL.kovac, 'Man down at the gate! Pull back, pull back!']],
  },
  patrol: {
    start: [[CALL.hollis, 'Bastion-7, this is Hollis, Recon Two. Four of us coming in hot down the road — they\'re right behind us. Cover us!']],
    follow: [[CALL.kovac, 'Friendlies on the road! Kill what\'s chasing them — and watch your fire!']],
    lost: [[CALL.hollis, 'Man down! Keep moving, keep moving!']],
    saved: [[CALL.hollis, 'We\'re through the gate. Thanks for the cover, Bastion. Recon Two will take a spot on the wall.']],
    some: [[CALL.kovac, 'Some of Recon Two made it in. Not all of them.']],
    none: [[CALL.kovac, 'Recon Two is gone. Eyes front.']],
  },
  civilians: {
    start: [[CALL.survivor, 'Bastion, we can see your lights! We\'re coming down the road — please, don\'t shoot!']],
    follow: [[CALL.kovac, 'Civilians on the road. Hold your fire on them and cover them all the way to the gate!']],
    lost: [[CALL.survivor, 'No! No, not him — keep running!']],
    saved: [[CALL.kovac, 'Got them. Every last one. Somebody find them some blankets.']],
    some: [[CALL.kovac, 'We got some of them in. Some.']],
    none: [[CALL.kovac, 'None of them made it. Eyes front.']],
  },
  drop: {
    start: [[CALL.reach, 'Bastion-7, Reach three-one, thirty seconds out with your resupply. Look for the strobe.']],
    away: [[CALL.reach, 'Load away, load away. Good chute. Reach three-one is clear — good luck down there.']],
    land: [[CALL.kovac, 'Crate\'s down in the field! Keep them off it until the recovery team gets out there!']],
    hurt: [[CALL.kovac, 'They\'re all over the crate — clear them off!']],
    saved: [[CALL.kovac, 'Recovery team has the crate! Flares, grenades, and the battery\'s reloaded.']],
    lost: [[CALL.kovac, 'They\'ve torn the crate apart. Damn it.']],
  },
  giant: {
    start: [[CALL.kovac, 'Something big coming down the road... my God, look at the size of it.']],
    spectre: [['@spectre', 'We see it, Bastion. Putting everything we have on the big one.']],
    wall: [[CALL.kovac, 'It\'s at the wall! It\'s tearing the wall apart — kill it!']],
    down: [[CALL.kovac, 'It\'s down! The big one is down!']],
  },
  behemoth: {
    start: [[CALL.kovac, 'That\'s not like the other one. That\'s bigger. Everything we have — put it on that thing!']],
    spectre: [['@spectre', 'We see it, Bastion. Putting everything we have on the big one.']],
    wall: [[CALL.kovac, 'It\'s at the wall! It\'s tearing the wall apart — kill it!']],
    down: [[CALL.kovac, 'It\'s down. Whatever that was, it\'s down.']],
  },
  tanker: {
    start: [[CALL.kovac, "There's a fuel tanker stalled out on the road. Let them crowd around it, then put a burst through the tank."]],
    boom: [[CALL.kovac, "The tanker's gone up! Look at them burn!"]],
    wasted: [[CALL.kovac, 'They walked right past the tanker. Waste of good fuel.']],
  },
  convoy: {
    start: [[CALL.hollis, "Bastion-7, Hollis! I've got a truck full of people from Halden and half the valley on my bumper. Open the gate!"]],
    follow: [[CALL.kovac, 'Truck on the road! Clear a path for it — shoot whatever is in front of it!']],
    saved: [[CALL.hollis, "We're in! We're in. Bastion-7, I owe every one of you a drink."]],
    lost: [[CALL.kovac, "The truck's stopped... they're all over it. God help them."]],
  },
  cliffs: {
    left: [[CALL.kovac, "They're coming over the rocks on the left! Swing that gun!"]],
    right: [[CALL.kovac, "They're coming over the rocks on the right! Swing that gun!"]],
  },
  stampede: {
    left: [[CALL.kovac, 'Brutes! A whole herd of them — left flank!']],
    right: [[CALL.kovac, 'Brutes! A whole herd of them — right flank!']],
  },
  bloaters: {
    start: [[CALL.kovac, 'Bloaters! A whole column of them on the road — pop them before they reach the wall!']],
  },
  fog: {
    start: [[CALL.command, 'Bastion-7, Command. Fog bank moving up the valley. Expect visibility near zero.']],
    spectre: [['@spectre', 'Spectre is blind in this soup. Holding fire until it clears.']],
    clear: [[CALL.kovac, 'Fog\'s lifting. Back to work.']],
  },
  blackout: {
    start: [[CALL.kovac, 'Generator\'s gone! We\'ve lost the lights — pop flares!']],
    spectre: [['@spectre', 'We have you on thermals, Bastion. We\'ll be your eyes.']],
    restored: [[CALL.kovac, 'Power\'s back. Thank God.']],
  },
  gunshipDown: {
    start: [[CALL.spectre, 'Mayday, mayday! Spectre two-one, fire in number three — we\'ve lost hydraulics — we\'re going down!']],
    down: [[CALL.kovac, 'Spectre\'s down... God rest them. We\'re on our own up here.']],
  },
};

// ── The chronicle: after every night, the story of it, told years later ──────
// Built at dawn from what actually happened (chronicle.js): how the night
// opened, how each of its events ended, one deed if the night had one, what it
// cost, and how the morning found us. Every fragment is voiced (CALL.narrator).
export const CHRONICLE = {
  title: {
    1: 'THE FIRST NIGHT', 2: 'THE FOG', 3: 'THE OVERPASS', 4: 'THE DROP', 5: 'GOLIATH',
    6: 'THE STAMPEDE', 7: 'LIGHTS OUT', 8: 'SPECTRE FALLS', 9: 'EVERYTHING WE HAD', 10: 'THE SEVENTY-SECOND HOUR',
    endless: 'NO RELIEF',
  },
  open: {
    1: 'On the first night, the dead came down the valley in their thousands. Bastion-7 answered them with one gun.',
    2: 'On the second night, word came that the bridge at Halden was down. The relief would be late. Only late, we told ourselves.',
    3: 'The third night began with a woman\'s voice on the radio, begging for help that we could not give.',
    4: 'On the fourth night, Command promised us an airdrop. The bloaters came down the valley to meet it.',
    5: 'On the fifth night, Bastion-3 fell, and Bastion-5 went silent. We were the last lights left on the line.',
    6: 'On the sixth night, the radio told us the relief column had been rerouted. Nobody on the wall believed it.',
    7: 'By the seventh night, Command had stopped answering. Out on the horizon, the city\'s fires were going out.',
    8: 'On the eighth night, a recorded voice told us that no one was listening anymore. We kept talking anyway.',
    9: 'On the ninth night, the biggest horde we had ever seen filled the valley from the wall to the ridge. We gave it everything.',
    10: 'The tenth night. The seventy-second hour. The last night — if the promises had ever meant anything at all.',
    endless: [
      'Another night came, as they always did, and the dead came with it.',
      'There were no more orders and no more promises. Only the wall, the night, and the gun.',
      'We had stopped counting the nights. The dead had not stopped coming.',
    ],
  },
  // how each night event ended (keys: see Chronicle.eventLine)
  events: {
    patrol: {
      all: 'Recon Two came down the road with half the valley at their heels. Every one of them made it through the gate.',
      some: 'Recon Two ran the last mile under our guns. Not all of them reached the gate, and the ones who did never spoke of the others.',
      none: 'Recon Two died on the road, a few hundred metres from the gate. We watched every moment of it through the sights.',
    },
    civilians: {
      all: 'The woman from the overpass found our lights. She brought every one of those children through the gate alive. For one night, the wall meant something.',
      some: 'The people from the overpass ran for our lights. Some of them made it inside. The mother would never say the names of the others.',
      none: 'The people from the overpass ran for our lights. None of them reached the gate. Their voices stopped, one by one, out on the open road.',
    },
    drop: {
      saved: 'The crate came down under a grey canopy, and we held the field around it until the recovery team dragged it home. Ammunition, bottles, and a little hope.',
      lost: 'The crate came down in the field, and the dead tore it open like a carcass. We watched our supplies scatter in the mud.',
    },
    giant: {
      field: 'Then the first giant came down the road, as tall as the wall itself. It fell in the open field, and the whole valley shook when it hit the ground.',
      wall: 'Then the first giant came. It reached the wall and tore at the concrete with its bare hands, and the bastion shook, until at last we brought it down.',
    },
    behemoth: {
      field: 'And then it came — the biggest of them all. We threw everything we had left at it, and somehow, out there in the field, it fell.',
      wall: 'And then it came — the biggest of them all. It reached our wall, and for a long moment I thought the whole line would come down with it. It didn\'t. It fell.',
    },
    tanker: {
      boom: 'A fuel tanker stood abandoned on the road. We waited until they crowded round it, and then we lit it, and for a moment it was day.',
      wasted: 'A fuel tanker stood abandoned on the road all night. The dead shuffled past it, and we never found the moment to light it.',
    },
    convoy: {
      saved: 'Hollis came back that night, driving a truck full of strangers from Halden. We cleared the road in front of him, and he drove it straight through the gate.',
      lost: 'Hollis came back that night with a truck full of strangers from Halden. The dead stopped it on the road, short of the gate, and we could not clear them fast enough.',
    },
    cliffs: { held: 'That night they found the way round, down over the rocks at the end of the wall, where nobody had thought to look.' },
    stampede: { held: 'A herd of brutes came down the flank in a stampede, and the wall shuddered under their weight. It held. Barely.' },
    bloaters: { held: 'A column of bloaters walked down the road like a funeral procession. We burst them in the field, one after another, and the valley stank of it for days.' },
    fog: { held: 'Then the fog rolled up the valley, thick as wet wool, and the dead walked out of it close enough to touch. We fired at shadows.' },
    blackout: { held: 'Then the generator died, and the lights went out all along the wall. We fought on in the dark, by flare-light and muzzle flash.' },
    gunshipDown: { down: 'Spectre went down that night. We watched it fall burning into the hills, and after that there was no one above us but God.' },
  },
  // at most one per night, in this order of precedence
  deeds: {
    danger: 'When the wall was lost, we called the guns down on our own heads. Three of ours died in that fire. The wall held.',
    fire: 'The wall base burned all night. The dead walked into the flames screaming, and kept on walking, until they didn\'t.',
    massacre: 'Somewhere past midnight the gun found its rhythm, and the dead went down in rows, like wheat before the scythe.',
  },
  // the cost, told per night: 'none' when nobody was lost, 'lost' otherwise (toll.heavy past that)
  tollNight: {
    1: {
      none: "We had all come through the first night alive. We thought, God help us, that it might always be like that.",
      lost: "The first names went on the list that night. Kovac wrote them himself, in pencil, so the rain wouldn't run them.",
    },
    2: {
      none: "Nobody was taken out of the fog that night. When it lifted, we counted heads twice to be sure.",
      lost: "In the fog, we only knew a man was gone when he stopped answering. We called their names until dawn.",
    },
    3: {
      none: "We lost no one on the wall that night. It didn't feel like a victory, with her voice still in our ears.",
      lost: "We buried our own beside the road that night, facing the overpass, as if they could still keep watch for her.",
    },
    4: {
      none: "Every man came back from the fourth night. The crows went hungry, for once.",
      lost: "We paid for the fourth night in men, not supplies. The crate came cheaper than they did.",
    },
    5: {
      none: "Not one of us fell on the giant's night. Afterwards we sat in the dark, too tired even to talk about it.",
      lost: "The giant took men off the wall like a child takes toys from a shelf. We stopped looking at the empty places.",
    },
    6: {
      none: "The stampede broke on the wall and never got over it. Every one of us was still there at roll call.",
      lost: "Some of the men who went down under the stampede never got back up. We heard the brutes long after they had stopped.",
    },
    7: {
      none: "We came through the dark without losing a soul. Kovac said it was the first good luck we'd had in a week.",
      lost: "We lost men in the dark that night, and in the dark we could not even see who. We found out at roll call.",
    },
    8: {
      none: "With Spectre gone, we lost no one else that night. It felt as if the dead were giving us a moment to mourn.",
      lost: "Spectre was not the only loss that night. By dawn, the wall had names of its own to add to theirs.",
    },
    9: {
      none: "Against everything the valley had, not one man fell. Aran swore it would be the story he told his children.",
      lost: "Everything we had, we gave. Some of us gave all of it. Their rifles stayed on the parapet where they fell.",
    },
    10: {
      none: "On the last night, every man who had made it this far made it to the end.",
      lost: "Some of us came so close to the end. Seventy-one hours, and then the night took them anyway.",
    },
  },
  // the night's deed, told per night (deeds.* for endless nights)
  deedNight: {
    massacre: {
      1: "Somewhere past midnight the gun found its rhythm. Kovac said he had never seen a fifty worked like that.",
      2: "They came out of the fog in columns, and the gun cut them down before they ever saw the wall.",
      3: "When the column from the overpass road came for the wall, the fifty swept the road clean from end to end.",
      4: "Around the strobe, the gun laid them down in a ring, row after row, like a fence made of the dead.",
      5: "Even with the giant on the field, the gun never stopped talking. The smaller dead fell in heaps around its feet.",
      6: "Under the stampede, the gun chewed through the runners until the barrel glowed like a stove.",
      7: "In the dark, the gun was our only light. Every time it spoke, a dozen of them stopped coming.",
      8: "With no one above us any more, the fifty did Spectre's work as well as its own. The field was grey with them.",
      9: "That night the gun fired until the belts ran out, and then we fed it more, and the valley went quiet in rows.",
      10: "On the last night the gun spoke for all of us, and whatever came down that valley did not go back up it.",
    },
    fire: {
      2: "We set the fog itself on fire. The bottles burst in the white, and the dead walked out of it burning.",
      3: "The overpass road burned all night. Whatever walked it to reach us burned with it.",
      4: "We ringed the drop zone with fire, and the dead walked into it rather than give up the crate.",
      5: "The wall base burned under the giant's feet. Even it screamed when the fuel caught.",
      6: "The brutes came through the fire without slowing. They just burned as they came.",
      7: "In the blackout, our fires were the only light on the field. We could watch them burn, and that was all we could see.",
      8: "With Spectre gone, the fire did its work for it. The foot of the wall burned from dusk until the sky went grey.",
      9: "We threw every bottle we had. The foot of the wall was one long fire, and still they kept walking into it.",
      10: "On the last night we set the valley floor alight, and it burned the way the city once had.",
    },
  },
  toll: {
    none: 'Not one name was added to the list that night. On that wall, it was as close to a miracle as we ever came.',
    few: 'We lost good men on the walkway that night. We buried them at first light, beside the others.',
    many: 'The wall took a terrible toll that night. By morning there were empty places all along the walkway, and nobody spoke of them.',
    heavy: 'By dawn there were so few of us left that we stood further apart, so that from the valley, the wall would still look manned.',
  },
  close: {
    1: 'When the sun came up, the valley was grey with bodies. Seventy-two hours, Command had said. Sixty-four to go.',
    2: 'At dawn the gate was still shut. Whatever we had heard out there in the dark, we never opened it.',
    3: 'By morning the radio was quiet. Kovac sat beside it for a long time, listening to the static.',
    4: 'The fourth dawn came up cold and red. The crows had learned where to find us.',
    5: 'That morning we understood that there was no line anymore. There was only us.',
    6: 'At dawn, Kovac loaded a fresh belt without a word. Nobody said rerouted out loud again.',
    7: 'That morning the city on the horizon lay dark and still. There was nothing left in it to burn.',
    8: 'When the sun came up, we said it to each other, one by one, all along the line. Bastion-7 is holding.',
    9: 'At dawn, Aran told the sergeant it had been an honour. Kovac told him to save it. One more night.',
    10: 'And then the sun rose on the seventy-second hour. No column came down the road. But we were still there.',
    endless: [
      'The sun rose again. It did not care who was still alive to see it.',
      'Dawn. We counted the living, then the dead, and then we stopped counting.',
      'Another morning on the wall. Tomorrow they would come again. So would we.',
    ],
  },
  fallen: [
    'Bastion-7 went quiet that night. The dead came over the wall like water through a broken dam, and the last light on the line went out.',
    'No one was left to write it down. The gun fell silent before the dawn, and in the morning, the valley belonged to the dead.',
  ],
};

/** Every chronicle fragment, flat. */
export function chronicleLines() {
  const C = CHRONICLE, out = [];
  const flat = (v) => (typeof v === 'string' ? [v] : Array.isArray(v) ? v : Object.values(v).flatMap(flat));
  for (const part of [C.open, C.events, C.deeds, C.deedNight, C.toll, C.tollNight, C.close, C.fallen]) out.push(...flat(part));
  return out;
}

/** Every voiced line, as [who, text]: the radio traffic and the chronicle (what the voice build records). */
export function allRadioLines() {
  const out = [];
  const add = (who, text) => { if (!out.some((l) => l[0] === who && l[1] === text)) out.push([who, text]); };
  for (const lines of Object.values(RADIO)) for (const [w, t] of lines) add(w, t);
  for (const lines of Object.values(BARKS)) for (const t of lines) add(CALL.kovac, t);
  for (const t of Object.values(COMMS.battery)) add(CALL.battery, t);
  add(CALL.kovac, COMMS.markerOut);
  add(CALL.kovac, COMMS.dangerClose);
  for (const t of [...COMMS.hammerIn, ...COMMS.hammerGood, ...COMMS.hammerOff]) add(CALL.hammer, t);
  for (const t of [COMMS.spectreIntro, ...COMMS.spectre]) add(CALL.spectre, t);
  for (const t of [COMMS.spectreIntro2, ...COMMS.spectre]) add(CALL.spectre2, t);
  for (const lines of Object.values(UNLOCK_LINES)) for (const [w, t] of lines) add(w, t);
  for (const ev of Object.values(EVENT_LINES)) {
    for (const lines of Object.values(ev)) {
      for (const [w, t] of lines) {
        if (w === '@spectre') { add(CALL.spectre, t); add(CALL.spectre2, t); } else add(w, t);
      }
    }
  }
  for (const t of chronicleLines()) add(CALL.narrator, t);
  return out;
}
