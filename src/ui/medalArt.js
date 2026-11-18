// The medals, drawn: SVG built from each medal's grade, ribbon and emblem (src/game/medals.js).
//
//   ribbon    a pentagonal suspension ribbon in the medal's own stripes, woven, shaded
//             where it folds, with a small metal star on it for gold and valour
//   bronze    a struck disc: raised rim, a ring of beads, the name round the edge
//   silver    a cross pattée, bevelled, the emblem on a roped medallion
//   gold      a sunburst of rays behind a medallion
//   valour    a faceted crimson-enamel star on a laurel wreath, a white enamel ring
// The emblem is struck in relief: a shadow, a highlight and the metal face, each a copy.
import { MEDALS } from '../game/medals.js';

const METAL = {
  bronze: ['#3b200c', '#8c5426', '#e3a465', '#a8662e', '#4a2a10'],
  silver: ['#3f4348', '#a9afb6', '#ffffff', '#8f959d', '#34373b'],
  gold: ['#4d3005', '#c08a24', '#fff0a8', '#b47e1a', '#3f2604'],
};
const FIELD = { bronze: ['#6a3d18', '#2f1806'], silver: ['#7b8087', '#30333a'], gold: ['#a77617', '#4a2e05'], valor: ['#b88420', '#4a2e05'] };
const FONT = '"Bahnschrift Condensed","Bahnschrift","Roboto Condensed","Arial Narrow",Arial,sans-serif';

const f1 = (v) => +v.toFixed(2);
const pt = (r, a) => [f1(r * Math.sin(a)), f1(-r * Math.cos(a))];

// ── emblems: drawn in a box about 52 across, centred on 0,0; %c the metal, %b the field ──
const ICONS = {
  dawn: `<path d="M-15 6A15 15 0 0 1 15 6Z" fill="%c"/><g stroke="%c" stroke-width="2.6" stroke-linecap="round">
    <path d="M0-14V-20M-11-9.5-15-14M11-9.5 15-14M-17 0H-22M17 0H22"/></g>
    <path d="M-24 8H24" stroke="%c" stroke-width="3" stroke-linecap="round"/><path d="M-18 13H18M-11 17.5H11" stroke="%c" stroke-width="2" stroke-linecap="round"/>`,
  crosshair: `<circle r="16" fill="none" stroke="%c" stroke-width="3.2"/><circle r="7" fill="none" stroke="%c" stroke-width="2"/>
    <path d="M0-24V-10M0 10V24M-24 0H-10M10 0H24" stroke="%c" stroke-width="3.2" stroke-linecap="round"/><circle r="2.2" fill="%c"/>`,
  shell: `<g transform="rotate(-30)"><path d="M-7.5-4C-7.5-14-2.5-21 0-24C2.5-21 7.5-14 7.5-4Z" fill="%c"/>
    <rect x="-7.5" y="-3" width="15" height="21" fill="%c"/><rect x="-9" y="18" width="18" height="4.5" rx="1" fill="%c"/>
    <path d="M-7.5 1H7.5M-7.5 4H7.5" stroke="%b" stroke-width="1.4"/></g>`,
  skull: `<path d="M-15 1C-15-11-8-18 0-18S15-11 15 1C15 6 12 8 11 10V15H-11V10C-12 8-15 6-15 1Z" fill="%c"/>
    <ellipse cx="-6" cy="0" rx="4.4" ry="5" fill="%b"/><ellipse cx="6" cy="0" rx="4.4" ry="5" fill="%b"/>
    <path d="M0 5L-2.4 9.5H2.4Z" fill="%b"/><path d="M-6 15V11M-2 15V11M2 15V11M6 15V11" stroke="%b" stroke-width="1.5"/>
    <path d="M-22 22-14 14M22 22 14 14M-22 22H-17M-22 22V17M22 22H17M22 22V17" stroke="%c" stroke-width="2.4" stroke-linecap="round"/>`,
  skullCrack: `<path d="M-16 0C-16-12-9-20 0-20S16-12 16 0C16 6 13 8 12 10V16H-12V10C-13 8-16 6-16 0Z" fill="%c"/>
    <path d="M-10-4-4-3-7 3Z" fill="%b"/><path d="M10-4 4-3 7 3Z" fill="%b"/><path d="M0 5L-2.4 9.5H2.4Z" fill="%b"/>
    <path d="M-7 16V11M-2.5 16V11M2.5 16V11M7 16V11" stroke="%b" stroke-width="1.6"/>
    <path d="M3-20 0-13 4-9 1-4" fill="none" stroke="%b" stroke-width="1.8" stroke-linejoin="round"/>`,
  people: `<g fill="%c"><circle cx="-12" cy="-10" r="4.6"/><path d="M-19 14V0C-19-4-16-5-12-5S-5-4-5 0V14Z"/>
    <circle cx="12" cy="-10" r="4.6"/><path d="M5 14V0C5-4 8-5 12-5S19-4 19 0V14Z"/>
    <circle cx="0" cy="-3" r="3.6"/><path d="M-5 16V7C-5 4-3 3 0 3S5 4 5 7V16Z"/></g>
    <path d="M-24 18H24" stroke="%c" stroke-width="2.4" stroke-linecap="round"/>`,
  wrench: `<g transform="rotate(-45)"><rect x="-3.6" y="-8" width="7.2" height="26" rx="2" fill="%c"/>
    <path d="M-9-15A10 10 0 1 0 9-15L4-11V-20H-4V-11Z" fill="%c"/><circle cy="15" r="2" fill="%b"/></g>
    <g transform="rotate(45)"><rect x="-2.6" y="-18" width="5.2" height="34" rx="1.5" fill="%c"/><rect x="-8" y="-22" width="16" height="8" rx="1.5" fill="%c"/></g>`,
  flame: `<path d="M0 22C-12 22-17 13-15 4C-13-4-6-8-5-18C1-12 3-6 2 0C6-3 7-8 7-12C14-4 16 4 14 11C12 18 7 22 0 22Z" fill="%c"/>
    <path d="M0 18C-5 18-7 13-5 8C-4 5-1 3 0-1C3 3 5 7 5 11C5 15 3 18 0 18Z" fill="%b"/>`,
  crate: `<path d="M-18-6C-18-20 18-20 18-6Z" fill="%c"/><path d="M-18-6-6 6M18-6 6 6M0-8V6M-9-7-3 6M9-7 3 6" stroke="%c" stroke-width="1.4"/>
    <rect x="-9" y="6" width="18" height="15" fill="%c"/><path d="M-9 13.5H9M0 6V21" stroke="%b" stroke-width="1.6"/>`,
  thermo: `<rect x="-4" y="-21" width="8" height="30" rx="4" fill="none" stroke="%c" stroke-width="2.6"/><circle cy="13" r="7" fill="%c"/>
    <rect x="-1.6" y="0" width="3.2" height="10" fill="%c"/><path d="M8-14H14M8-7H12M8 0H14" stroke="%c" stroke-width="2" stroke-linecap="round"/>
    <g stroke="%c" stroke-width="1.8" stroke-linecap="round"><path d="M-18-8V-22M-23-15H-13M-21.5-19.5-14.5-10.5M-21.5-10.5-14.5-19.5"/></g>`,
  shield: `<path d="M0-22L18-15V0C18 11 10 18 0 23C-10 18-18 11-18 0V-15Z" fill="%c"/>
    <path d="M-10-2 0-9 10-2M-10 7 0 0 10 7" fill="none" stroke="%b" stroke-width="3.2" stroke-linejoin="round"/>`,
  footprint: `<g fill="%c"><path d="M-9 0C-11-9-6-14 1-13C8-12 12-6 10 4C9 11 9 17 4 21C-1 24-6 21-6 15C-6 9-7 6-9 0Z"/>
    <ellipse cx="-9" cy="-17" rx="3.4" ry="4.2"/><ellipse cx="-2" cy="-21" rx="3" ry="3.8"/><ellipse cx="4.5" cy="-20.5" rx="2.6" ry="3.4"/>
    <ellipse cx="9.5" cy="-17.5" rx="2.3" ry="3"/><ellipse cx="13" cy="-13" rx="2" ry="2.6"/></g>`,
  burst: `<path d="${(() => { let d = ''; for (let i = 0; i < 24; i++) { const [x, y] = pt(i % 2 ? 11 : (i % 4 ? 20 : 25), i * Math.PI / 12); d += (i ? 'L' : 'M') + x + ' ' + y; } return d + 'Z'; })()}" fill="%c"/>
    <circle r="7" fill="%b"/><circle r="3.4" fill="%c"/>`,
  bomb: `<g transform="rotate(25)"><path d="M0 24C-7 18-8 8-8 0V-10H8V0C8 8 7 18 0 24Z" fill="%c"/>
    <path d="M-8-10-13-22H-3L-3-10M8-10 13-22H3L3-10" fill="%c"/><path d="M-8 2H8M-8 6H8" stroke="%b" stroke-width="1.4"/></g>
    <path d="M14 18 20 24M18 12 24 15M8 22 10 27" stroke="%c" stroke-width="1.8" stroke-linecap="round"/>`,
  truck: `<path d="M-24-8H4V10H-24Z" fill="%c"/><path d="M6-2H15L21 5V10H6Z" fill="%c"/><path d="M8 0H14L18 5H8Z" fill="%b"/>
    <circle cx="-15" cy="12" r="5" fill="%c"/><circle cx="13" cy="12" r="5" fill="%c"/><circle cx="-15" cy="12" r="2" fill="%b"/><circle cx="13" cy="12" r="2" fill="%b"/>
    <path d="M-20-4H0M-20 2H0" stroke="%b" stroke-width="1.2"/>`,
  target: `<circle r="21" fill="none" stroke="%c" stroke-width="2.6"/><circle r="14" fill="none" stroke="%c" stroke-width="2.6"/><circle r="7" fill="%c"/>
    <circle cx="2" cy="-1" r="1.8" fill="%b"/><circle cx="-3" cy="2" r="1.6" fill="%b"/><circle cx="1.5" cy="3.5" r="1.4" fill="%b"/>`,
  seventyTwo: `<text y="10" text-anchor="middle" font-family='${FONT}' font-weight="700" font-size="34" letter-spacing="-1" fill="%c">72</text>
    <text y="21" text-anchor="middle" font-family='${FONT}' font-weight="700" font-size="8" letter-spacing="2.5" fill="%c">HOURS</text>`,
  helicopter: `<path d="M-14-2C-14-9-7-11 2-11C10-11 14-7 14-2V4H-14Z" fill="%c"/><path d="M2-8H11L13-3H2Z" fill="%b"/>
    <path d="M-14-4H-26V0H-14Z" fill="%c"/><path d="M-27-9-24 4" stroke="%c" stroke-width="2.4"/>
    <path d="M-24-15H24" stroke="%c" stroke-width="2.6" stroke-linecap="round"/><path d="M0-15V-11" stroke="%c" stroke-width="2.6"/>
    <path d="M-12 10H14M-8 4V10M8 4V10" stroke="%c" stroke-width="2.2" stroke-linecap="round"/>`,
  mountain: `<path d="M-24 16-8-12-1-2 6-16 24 16Z" fill="%c"/><path d="M6-16 2-6 7-4 3 4" fill="none" stroke="%b" stroke-width="2" stroke-linejoin="round"/>
    <path d="M-14 1-8-12-3-4" fill="none" stroke="%b" stroke-width="1.4" opacity="0.7"/>`,
  tenK: `<text y="8" text-anchor="middle" font-family='${FONT}' font-weight="700" font-size="27" letter-spacing="-0.5" fill="%c">10K</text>
    <path d="M-18 15H18" stroke="%c" stroke-width="2" stroke-linecap="round"/><path d="M-12 19.5H12" stroke="%c" stroke-width="1.4" stroke-linecap="round"/>`,
  hourglass: `<path d="M-14-21H14M-14 21H14" stroke="%c" stroke-width="3.2" stroke-linecap="round"/>
    <path d="M-11-19H11C11-9 3-4 1 0C3 4 11 9 11 19H-11C-11 9-3 4-1 0C-3-4-11-9-11-19Z" fill="none" stroke="%c" stroke-width="2.2"/>
    <path d="M-7-14H7L0-2Z" fill="%c"/><path d="M0 4-8 16H8Z" fill="%c"/>`,
  wall: `<path d="M-24 18V-6H-18V-12H-11V-6H-4V-12H4V-6H11V-12H18V-6H24V18Z" fill="%c"/>
    <path d="M-24 0H24M-24 6H24M-24 12H24M-14-6V0M0-6V0M14-6V0M-7 0V6M7 0V6M21 0V6M-21 0V6M-14 6V12M0 6V12M14 6V12M-7 12V18M7 12V18" stroke="%b" stroke-width="1.1"/>`,
  laurelStar: `<path d="${(() => { let d = ''; for (let i = 0; i < 10; i++) { const [x, y] = pt(i % 2 ? 7 : 17, i * Math.PI / 5); d += (i ? 'L' : 'M') + x + ' ' + (y - 2); } return d + 'Z'; })()}" fill="%c"/>
    <g fill="%c">${[0, 1, 2, 3].map((k) => `<ellipse cx="${-15 - k * 1.2}" cy="${14 - k * 7}" rx="2" ry="4.4" transform="rotate(${-40 + k * 14} ${-15 - k * 1.2} ${14 - k * 7})"/><ellipse cx="${15 + k * 1.2}" cy="${14 - k * 7}" rx="2" ry="4.4" transform="rotate(${40 - k * 14} ${15 + k * 1.2} ${14 - k * 7})"/>`).join('')}</g>`,
  flag: `<path d="M-16-22V24" stroke="%c" stroke-width="3" stroke-linecap="round"/>
    <path d="M-14-20C-6-24 2-16 10-19C14-20 17-21 20-22V2C17 1 14 2 10 3C2 6-6-2-14 2Z" fill="%c"/>
    <path d="M-14-11C-6-15 2-7 10-10C14-11 17-12 20-13" fill="none" stroke="%b" stroke-width="1.6"/>`,
  gun: `<rect x="-6" y="-6" width="34" height="3" fill="%c" transform="translate(-8 0)"/><rect x="-4" y="-8.5" width="14" height="8" rx="1" fill="%c"/>
    <path d="M-26-9H-6V3H-26Z" fill="%c"/><path d="M-30-9V-2H-26M-30 2H-26" stroke="%c" stroke-width="2.4"/>
    <path d="M-1-4.5H9" stroke="%b" stroke-width="1" stroke-dasharray="1.4 1.2"/>
    <path d="M-14 3-22 20M-14 3-6 20M-14 3-14 21" stroke="%c" stroke-width="2.4" stroke-linecap="round"/><rect x="-20" y="-14" width="8" height="5" fill="%c"/>`,
  tower: `<path d="M-12 24-7-4H7L12 24M-9 10H9M-10.5 17H10.5M-7-4 9 24M7-4-9 24" fill="none" stroke="%c" stroke-width="2"/>
    <rect x="-10" y="-13" width="20" height="10" fill="%c"/><path d="M-13-13 0-21 13-13Z" fill="%c"/>
    <path d="M10-9 26-16V-2Z" fill="%c" opacity="0.55"/><rect x="-6" y="-11" width="5" height="4" fill="%b"/>`,
};

/** A small faceted star (a device on the ribbon), centred at x, y. */
function smallStar(x, y, r, light, dark) {
  let s = '';
  for (let i = 0; i < 5; i++) {
    const a = i * 2 * Math.PI / 5, [tx, ty] = pt(r, a), [lx, ly] = pt(r * 0.42, a - Math.PI / 5), [rx, ry] = pt(r * 0.42, a + Math.PI / 5);
    s += `<path d="M${x} ${y}L${x + lx} ${y + ly}L${x + tx} ${y + ty}Z" fill="${light}"/><path d="M${x} ${y}L${x + tx} ${y + ty}L${x + rx} ${y + ry}Z" fill="${dark}"/>`;
  }
  return s;
}

function gradient(id, stops, x1 = 0, y1 = 0, x2 = 1, y2 = 1) {
  return `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops.map((c, i) => `<stop offset="${f1(i / (stops.length - 1))}" stop-color="${c}"/>`).join('')}</linearGradient>`;
}

/** The emblem, struck in relief on a field. */
function emblem(name, metal, field, scale = 1) {
  const src = ICONS[name] || ICONS.crosshair;
  const as = (c, b) => src.replaceAll('%c', c).replaceAll('%b', b);
  return `<g transform="scale(${scale})">
    <g transform="translate(0.9 1.1)" opacity="0.75">${as('#000', 'transparent')}</g>
    <g transform="translate(-0.5 -0.6)" opacity="0.55">${as('#fff', 'transparent')}</g>
    ${as(`url(#${metal})`, field)}</g>`;
}

/** The ribbon's stripes across 100 units, mirrored about the centre. */
function stripes(list, x0, y0, h) {
  let out = '', x = 0;
  const parts = [...list, ...[...list].reverse()];
  for (const [c, w] of parts) { out += `<rect x="${f1(x0 + x)}" y="${y0}" width="${w + 0.3}" height="${h}" fill="${c}"/>`; x += w; }
  return out;
}

/** The full medal: ribbon and body, as an SVG string (viewBox 200 x 300). */
export function medalSVG(m, opts = {}) {
  const p = `md-${m.id}${opts.suffix || ''}`;
  const g = m.grade;
  const metalStops = METAL[g === 'valor' ? 'gold' : g];
  const fld = FIELD[g];
  const cy = 198;
  const defs = [
    gradient(`${p}-m`, metalStops),
    gradient(`${p}-m2`, [...metalStops].reverse(), 0, 0, 1, 1),
    `<radialGradient id="${p}-f" cx="0.38" cy="0.32" r="0.8"><stop offset="0" stop-color="${fld[0]}"/><stop offset="1" stop-color="${fld[1]}"/></radialGradient>`,
    `<radialGradient id="${p}-sheen" cx="0.3" cy="0.25" r="0.75"><stop offset="0" stop-color="#fff" stop-opacity="0.45"/><stop offset="0.45" stop-color="#fff" stop-opacity="0.06"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`,
    `<linearGradient id="${p}-fold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.35"/><stop offset="0.25" stop-color="#000" stop-opacity="0"/><stop offset="0.8" stop-color="#000" stop-opacity="0.05"/><stop offset="1" stop-color="#000" stop-opacity="0.45"/></linearGradient>`,
    `<linearGradient id="${p}-side" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity="0.35"/><stop offset="0.12" stop-color="#fff" stop-opacity="0.08"/><stop offset="0.5" stop-color="#fff" stop-opacity="0"/><stop offset="0.88" stop-color="#000" stop-opacity="0.05"/><stop offset="1" stop-color="#000" stop-opacity="0.4"/></linearGradient>`,
    `<pattern id="${p}-weave" width="2.4" height="2.4" patternUnits="userSpaceOnUse"><path d="M0 0.6H2.4" stroke="#000" stroke-opacity="0.16" stroke-width="0.6"/><path d="M0.6 0V2.4" stroke="#fff" stroke-opacity="0.07" stroke-width="0.5"/></pattern>`,
    `<clipPath id="${p}-rc"><path d="M50 8H150V86L100 114L50 86Z"/></clipPath>`,
    `<filter id="${p}-sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="1.5" dy="3" stdDeviation="2.4" flood-color="#000" flood-opacity="0.55"/></filter>`,
  ];
  if (g === 'valor') {
    defs.push(gradient(`${p}-en`, ['#ff5a4a', '#b0141a', '#5a0408']), gradient(`${p}-en2`, ['#c8202a', '#6a060c', '#3a0204']));
  }
  // the ribbon
  const ribbon = `<g filter="url(#${p}-sh)"><g clip-path="url(#${p}-rc)">
      ${stripes(m.stripes, 50, 8, 108)}
      <rect x="50" y="8" width="100" height="108" fill="url(#${p}-weave)"/>
      <rect x="50" y="8" width="100" height="108" fill="url(#${p}-side)"/>
      <rect x="50" y="8" width="100" height="108" fill="url(#${p}-fold)"/>
      <path d="M50 86L100 114L150 86" fill="none" stroke="#000" stroke-opacity="0.35" stroke-width="2"/>
    </g>
    <rect x="47" y="4" width="106" height="7" rx="2" fill="url(#${p}-m)"/><rect x="47" y="4" width="106" height="2.4" rx="1.2" fill="#fff" opacity="0.25"/>
    ${g === 'gold' || g === 'valor' ? smallStar(100, 52, 9, metalStops[2], metalStops[1]) : ''}
    <circle cx="100" cy="117" r="6" fill="none" stroke="url(#${p}-m)" stroke-width="3"/></g>`;

  let body = '';
  if (g === 'bronze') {
    let beads = '';
    for (let i = 0; i < 44; i++) { const [x, y] = pt(60, i * Math.PI * 2 / 44); beads += `<circle cx="${x}" cy="${y}" r="1.7" fill="url(#${p}-m)"/>`; }
    body = `<circle r="68" fill="url(#${p}-m)"/><circle r="64" fill="url(#${p}-m2)"/><circle r="56.5" fill="url(#${p}-f)"/>
      ${beads}
      <path id="${p}-arc" d="M-46 6A46 46 0 0 1 46 6" fill="none"/>
      <text font-family='${FONT}' font-weight="700" font-size="10.5" letter-spacing="2.2" fill="url(#${p}-m)"><textPath href="#${p}-arc" startOffset="50%" text-anchor="middle">${m.name}</textPath></text>
      <circle r="31" fill="none" stroke="url(#${p}-m)" stroke-width="1.6" opacity="0.8"/>
      <g transform="translate(0 9)">${emblem(m.icon, `${p}-m`, fld[1], 0.95)}</g>
      <circle r="68" fill="url(#${p}-sheen)"/>`;
  } else if (g === 'silver') {
    // cross pattée: arms flaring from 13 wide at the centre to 50 wide at the tips
    const arm = (s) => { let d = ''; for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2, P = (r, w) => { const [x, y] = pt(r, a), [px, py] = pt(w, a + Math.PI / 2); return `${f1(x + px)} ${f1(y + py)}`; }; d += `M${P(16 * s, -7 * s)}L${P(70 * s, -25 * s)}Q${P(64 * s, 0)} ${P(70 * s, 25 * s)}L${P(16 * s, 7 * s)}Z`; } return d; };
    body = `<path d="${arm(1)}" fill="url(#${p}-m)"/><path d="${arm(0.9)}" fill="url(#${p}-m2)" opacity="0.9"/>
      <path d="${arm(0.84)}" fill="url(#${p}-m)" opacity="0.7"/>
      <circle r="35" fill="url(#${p}-m)"/><circle r="31.5" fill="url(#${p}-f)"/>
      <circle r="33.3" fill="none" stroke="url(#${p}-m2)" stroke-width="2.6" stroke-dasharray="2 1.4"/>
      ${emblem(m.icon, `${p}-m`, fld[1], 0.92)}
      <path d="${arm(1)}" fill="url(#${p}-sheen)" opacity="0.8"/><circle r="35" fill="url(#${p}-sheen)" opacity="0.6"/>`;
  } else if (g === 'gold') {
    let rays = '';
    for (let i = 0; i < 32; i++) {
      const a = i * Math.PI / 16, r = i % 2 ? 60 : 74, w = i % 2 ? 0.07 : 0.09;
      const [tx, ty] = pt(r, a), [lx, ly] = pt(38, a - w), [rx, ry] = pt(38, a + w);
      rays += `<path d="M${lx} ${ly}L${tx} ${ty}L${rx} ${ry}Z" fill="url(#${p}-${i % 4 < 2 ? 'm' : 'm2'})"/>`;
    }
    body = `${rays}<circle r="44" fill="url(#${p}-m2)"/><circle r="41" fill="url(#${p}-m)"/><circle r="36" fill="url(#${p}-f)"/>
      ${emblem(m.icon, `${p}-m`, fld[1], 1.05)}
      <circle r="44" fill="url(#${p}-sheen)"/>`;
  } else {
    // valour: laurel, then a faceted enamel star with gold edges, a white enamel ring and a gold centre
    // the laurel: two branches from a tie at the bottom, up either side, leaves in pairs along each
    let laurel = '';
    const R = 64, deg = Math.PI / 180;
    for (const side of [-1, 1]) {
      const a0 = 172 * deg, a1 = 58 * deg;
      const [sx, sy] = pt(R, a0 * side), [ex, ey] = pt(R, a1 * side);
      laurel += `<path d="M${sx} ${sy}A${R} ${R} 0 0 ${side > 0 ? 0 : 1} ${ex} ${ey}" fill="none" stroke="url(#${p}-m2)" stroke-width="2.2"/>`;
      for (let k = 0; k < 8; k++) {
        const a = (a0 - (a0 - a1) * (k + 0.5) / 8) * side;
        // the branch's direction of growth here (towards the tip), and a leaf either side of it, raked forward
        const tang = Math.atan2(...(() => { const [x1, y1] = pt(R, a), [x2, y2] = pt(R, a - 0.05 * side); return [x2 - x1, -(y2 - y1)]; })());
        for (const off of [-1, 1]) {
          const [x, y] = pt(R + off * 5.5, a);
          const rot = f1(90 - tang / deg + off * side * 32);
          const len = 9.5 - k * 0.45;
          laurel += `<ellipse cx="${x}" cy="${y}" rx="${f1(len * 0.42)}" ry="${f1(len)}" transform="rotate(${rot} ${x} ${y})" fill="url(#${p}-${(k + (off > 0 ? 1 : 0)) % 2 ? 'm' : 'm2'})"/>`;
        }
      }
    }
    { const [tx, ty] = pt(R, Math.PI); laurel += `<path d="M${tx - 8} ${ty - 3}L${tx + 8} ${ty + 3}M${tx + 8} ${ty - 3}L${tx - 8} ${ty + 3}" stroke="url(#${p}-m)" stroke-width="3" stroke-linecap="round"/>`; }
    let star = '', edge = '';
    for (let i = 0; i < 5; i++) {
      const a = i * 2 * Math.PI / 5, [tx, ty] = pt(76, a), [lx, ly] = pt(31, a - Math.PI / 5), [rx, ry] = pt(31, a + Math.PI / 5);
      star += `<path d="M0 0L${lx} ${ly}L${tx} ${ty}Z" fill="url(#${p}-en)"/><path d="M0 0L${tx} ${ty}L${rx} ${ry}Z" fill="url(#${p}-en2)"/>`;
      edge += `${i ? 'L' : 'M'}${lx} ${ly}L${tx} ${ty}`;
    }
    body = `${laurel}<path d="${edge}Z" fill="url(#${p}-m)" transform="scale(1.07)"/>${star}
      <path d="${edge}Z" fill="none" stroke="url(#${p}-m)" stroke-width="1.4"/>
      <circle r="33" fill="url(#${p}-m)"/><circle r="30" fill="#e9e2cf"/><circle r="22" fill="url(#${p}-m2)"/><circle r="20" fill="url(#${p}-f)"/>
      <path id="${p}-arc" d="M-24.5 4A24.5 24.5 0 0 1 24.5 4" fill="none"/>
      <text font-family='${FONT}' font-weight="700" font-size="6.6" letter-spacing="1.3" fill="#7a1010"><textPath href="#${p}-arc" startOffset="50%" text-anchor="middle">FOR VALOUR</textPath></text>
      ${emblem(m.icon, `${p}-m`, fld[1], 0.62)}
      <path d="${edge}Z" fill="url(#${p}-sheen)" opacity="0.7"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300" class="medal-svg" role="img" aria-label="${m.name} (${g})">
    <defs>${defs.join('')}</defs>
    ${ribbon}
    <g transform="translate(100 ${cy})" filter="url(#${p}-sh)">${body}</g>
  </svg>`;
}

/** A ribbon bar for the rack (the medal's stripes, bevelled), viewBox 60 x 18. */
export function ribbonBar(m) {
  const p = `rb-${m.id}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 30" class="ribbon-bar" role="img" aria-label="${m.name} ribbon">
    <defs><linearGradient id="${p}-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.22"/><stop offset="0.4" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.4"/></linearGradient></defs>
    ${stripes(m.stripes, 0, 0, 30)}<rect width="100" height="30" fill="url(#${p}-b)"/>
    ${m.grade === 'gold' || m.grade === 'valor' ? smallStar(50, 15, 9, '#fff0a8', '#b47e1a') : ''}
    <rect x="0.5" y="0.5" width="99" height="29" fill="none" stroke="#000" stroke-opacity="0.5"/></svg>`;
}

export { MEDALS };
