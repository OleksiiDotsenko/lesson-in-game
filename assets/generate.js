#!/usr/bin/env node
'use strict';
/**
 * Generates the pixel-art SVG assets used by the repo landing page (README.md).
 * Pure Node, no dependencies. Re-run after tweaking colors or text:
 *
 *   node assets/generate.js
 *
 * Everything is drawn as crisp squares (shape-rendering: crispEdges) so it
 * reads as honest pixel art at any size, in light and dark GitHub themes.
 */

const fs = require('fs');
const path = require('path');

// ── the orange palette ──
const C = {
  bg: '#0f1220',
  tile: '#171c2a',
  tileBorder: '#f97316',
  o1: '#fdba74', // light
  o2: '#fb923c',
  o3: '#f97316', // core orange
  o4: '#ea580c',
  o5: '#c2410c', // deep
  shadow: '#431407',
  text: '#e8ecf5',
  mutet: '#9aa3b8',
  faint: '#64748b',
};
const TITLE_ROWS = [C.o1, C.o2, C.o3, C.o4, C.o5]; // vertical gradient, top→bottom

// ── 5×5 pixel font (only the glyphs the banner needs) ──
const FONT = {
  L: ['10000', '10000', '10000', '10000', '11111'],
  E: ['11111', '10000', '11110', '10000', '11111'],
  S: ['01111', '10000', '01110', '00001', '11110'],
  O: ['01110', '10001', '10001', '10001', '01110'],
  N: ['10001', '11001', '10101', '10011', '10001'],
  I: ['11111', '00100', '00100', '00100', '11111'],
  G: ['01111', '10000', '10011', '10001', '01110'],
  A: ['01110', '10001', '11111', '10001', '10001'],
  M: ['10001', '11011', '10101', '10001', '10001'],
  ' ': ['000', '000', '000', '000', '000'],
};

// ── pixel doodles ──
const HEART = ['0110110', '1111111', '1111111', '0111110', '0011100', '0001000'];
const STAR = ['000010000', '000111000', '000111000', '111111111', '011111110', '001111100', '011101110', '110000011'];
const PLAY = ['100000', '110000', '111100', '111111', '111100', '110000', '100000'];
const PAD_BODY = [
  '001111111100',
  '011111111110',
  '111111111111',
  '111111111111',
  '111111111111',
  '111111111111',
  '110111111011',
  '100011110001',
];
const PAD_DARK = [[3, 2], [2, 3], [3, 3], [4, 3], [3, 4], [8, 3], [10, 3]]; // d-pad + buttons

// flow icons, 11×11 (base shape) + dark overlay pixels
const ICONS = {
  tell: {
    base: [
      '01111111110',
      '11111111111',
      '11111111111',
      '11111111111',
      '11111111111',
      '11111111111',
      '01111111110',
      '00011000000',
      '00110000000',
      '00100000000',
      '00000000000',
    ],
    dark: [[3, 3], [5, 3], [7, 3]],
  },
  review: {
    base: [
      '00000000000',
      '00000000011',
      '00000000110',
      '00000001100',
      '10000011000',
      '11000110000',
      '01101100000',
      '00111000000',
      '00010000000',
      '00000000000',
      '00000000000',
    ],
    dark: [],
  },
  preview: {
    // a friendly bot head — preview mode fills the room with dummy students
    base: [
      '00000100000',
      '00000100000',
      '01111111110',
      '01111111110',
      '01111111110',
      '01111111110',
      '01111111110',
      '01111111110',
      '01111111110',
      '00000000000',
      '00000000000',
    ],
    dark: [[2, 4], [3, 4], [7, 4], [8, 4], [3, 6], [4, 6], [5, 6], [6, 6], [7, 6]],
  },
  play: {
    base: [
      '00111111100',
      '00111111100',
      '00111111100',
      '00111111100',
      '00111111100',
      '00111111100',
      '00111111100',
      '00111111100',
      '00111111100',
      '00111111100',
      '00111111100',
    ],
    dark: [
      // screen
      [3, 1], [4, 1], [5, 1], [6, 1], [7, 1],
      [3, 2], [4, 2], [6, 2], [7, 2],
      [3, 3], [4, 3], [6, 3], [7, 3],
      [3, 4], [4, 4], [5, 4], [6, 4], [7, 4],
      [3, 5], [4, 5], [5, 5], [6, 5], [7, 5],
      [3, 6], [4, 6], [5, 6], [6, 6], [7, 6],
      [3, 7], [4, 7], [5, 7], [6, 7], [7, 7],
      // home button
      [5, 9],
    ],
    // a mini QR pattern glowing on the screen
    accent: [[3, 1], [4, 1], [3, 2], [6, 1], [7, 1], [7, 2], [3, 5], [3, 6], [4, 6], [5, 3], [6, 4], [7, 6]],
  },
  learn: {
    base: [
      '00000000000',
      '00000000000',
      '00000000110',
      '00000000110',
      '00000110110',
      '00000110110',
      '00000110110',
      '01100110110',
      '01100110110',
      '01100110110',
      '11111111111',
    ],
    dark: [],
  },
};
const ARROW = ['0000100', '0000110', '1111111', '0000110', '0000100'];

// ── svg helpers ──
function px(x, y, s, color) {
  return `<rect x="${x}" y="${y}" width="${s}" height="${s}" fill="${color}"/>`;
}

/** Draw a bitmap (array of '01' strings). color may be a string or per-row array. */
function bitmap(rows, x0, y0, s, color) {
  const out = [];
  rows.forEach((row, ry) => {
    const c = Array.isArray(color) ? color[ry % color.length] : color;
    [...row].forEach((bit, rx) => {
      if (bit === '1') out.push(px(x0 + rx * s, y0 + ry * s, s, c));
    });
  });
  return out.join('');
}

function overlay(coords, x0, y0, s, color) {
  return coords.map(([rx, ry]) => px(x0 + rx * s, y0 + ry * s, s, color)).join('');
}

/** Render a string in the 5×5 font. Returns { svg, cols }. */
function pixelText(str, x0, y0, s, color) {
  let colCursor = 0;
  const parts = [];
  for (const ch of str) {
    const glyph = FONT[ch] || FONT[' '];
    parts.push(bitmap(glyph, x0 + colCursor * s, y0, s, color));
    colCursor += glyph[0].length + 1;
  }
  return { svg: parts.join(''), cols: colCursor - 1 };
}

function textCols(str) {
  let cols = 0;
  for (const ch of str) cols += (FONT[ch] || FONT[' '])[0].length + 1;
  return cols - 1;
}

/** Pixel-notched border: four strips, corners left transparent. */
function notchedBorder(x, y, w, h, t, color) {
  return [
    `<rect x="${x + t}" y="${y}" width="${w - 2 * t}" height="${t}" fill="${color}"/>`,
    `<rect x="${x + t}" y="${y + h - t}" width="${w - 2 * t}" height="${t}" fill="${color}"/>`,
    `<rect x="${x}" y="${y + t}" width="${t}" height="${h - 2 * t}" fill="${color}"/>`,
    `<rect x="${x + w - t}" y="${y + t}" width="${t}" height="${h - 2 * t}" fill="${color}"/>`,
  ].join('');
}

function svgDoc(w, h, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img">\n<g shape-rendering="crispEdges">${body}</g>\n</svg>\n`;
}

const MONO = `ui-monospace,SFMono-Regular,Menlo,Consolas,'Courier New',monospace`;

// ═══ 1. banner.svg ═══
function banner() {
  const W = 960, H = 240;
  const parts = [];
  parts.push(`<rect width="${W}" height="${H}" fill="${C.bg}"/>`);

  // confetti
  const confetti = [
    [130, 30, C.o4], [220, 22, C.o2], [300, 38, C.o5], [420, 18, C.o3], [540, 30, C.o1],
    [660, 20, C.o4], [740, 40, C.o2], [900, 52, C.o5], [40, 140, C.o5], [925, 150, C.o3],
    [180, 178, C.o5], [760, 182, C.o4], [500, 190, C.o5], [340, 184, C.o3],
  ];
  for (const [x, y, c] of confetti) parts.push(px(x, y, 6, c));

  // doodles
  parts.push(bitmap(PLAY, 66, 26, 5, C.o4));
  parts.push(bitmap(STAR, 838, 22, 5, C.o1));
  parts.push(bitmap(PAD_BODY, 40, 96, 7, C.o3));
  parts.push(overlay(PAD_DARK, 40, 96, 7, C.bg));
  parts.push(bitmap(HEART, 862, 96, 8, C.o2));

  // title with drop shadow
  const title = 'LESSON IN GAME';
  const s = 9;
  const cols = textCols(title);
  const x0 = Math.round((W - cols * s) / 2);
  const y0 = 56;
  parts.push(pixelText(title, x0 + 5, y0 + 5, s, C.shadow).svg);
  parts.push(pixelText(title, x0, y0, s, TITLE_ROWS).svg);

  // subtitles (real text, monospace)
  parts.push(`<text x="${W / 2}" y="148" text-anchor="middle" font-family="${MONO}" font-size="17" fill="${C.mutet}">any lesson ▸ a live multiplayer game on your students' phones</text>`);
  parts.push(`<text x="${W / 2}" y="174" text-anchor="middle" font-family="${MONO}" font-size="14" fill="${C.faint}">no code · no cloud · ready in 15 minutes</text>`);

  // pixel ground strip
  for (let i = 0; i < W / 12; i++) {
    const c = i % 7 === 3 ? C.o1 : i % 2 === 0 ? C.o4 : C.o5;
    parts.push(px(i * 12, H - 18, 12, c));
    if (i % 3 === 0) parts.push(px(i * 12, H - 30, 12, '#1d2435'));
  }

  fs.writeFileSync(path.join(__dirname, 'banner.svg'), svgDoc(W, H, parts.join('')));
}

// ═══ 2. flow.svg ═══
function flow() {
  const W = 1000, H = 175;
  const steps = [
    { icon: 'tell', label: '1 · TELL', caption: 'describe your lesson' },
    { icon: 'review', label: '2 · REVIEW', caption: 'you approve questions' },
    { icon: 'preview', label: '3 · PREVIEW', caption: 'bots test-drive it' },
    { icon: 'play', label: '4 · PLAY', caption: 'class joins by QR' },
    { icon: 'learn', label: '5 · LEARN', caption: 'get a reteach report' },
  ];
  const bw = 176, gap = 30, bh = 150, y = 8;
  const parts = [];
  steps.forEach((st, k) => {
    const x = k * (bw + gap);
    parts.push(`<rect x="${x + 3}" y="${y + 3}" width="${bw - 6}" height="${bh - 6}" fill="${C.tile}"/>`);
    parts.push(notchedBorder(x, y, bw, bh, 3, C.tileBorder));
    const icon = ICONS[st.icon];
    const isz = 6;
    const ix = x + Math.round((bw - 11 * isz) / 2);
    parts.push(bitmap(icon.base, ix, y + 14, isz, C.o3));
    parts.push(overlay(icon.dark, ix, y + 14, isz, C.tile));
    if (icon.accent) parts.push(overlay(icon.accent, ix, y + 14, isz, C.o2));
    parts.push(`<text x="${x + bw / 2}" y="${y + 108}" text-anchor="middle" font-family="${MONO}" font-size="15" font-weight="bold" fill="${C.o1}">${st.label}</text>`);
    parts.push(`<text x="${x + bw / 2}" y="${y + 130}" text-anchor="middle" font-family="${MONO}" font-size="12" fill="${C.mutet}">${st.caption}</text>`);
    if (k < steps.length - 1) {
      parts.push(bitmap(ARROW, x + bw + 1, y + 52, 4, C.o2));
    }
  });
  fs.writeFileSync(path.join(__dirname, 'flow.svg'), svgDoc(W, H, parts.join('')));
}

// ═══ 3. badges ═══
function badge(file, text) {
  const h = 34;
  const w = Math.round(text.length * 8.2) + 46;
  const parts = [];
  parts.push(`<rect x="2" y="2" width="${w - 4}" height="${h - 4}" fill="${C.tile}"/>`);
  parts.push(notchedBorder(0, 0, w, h, 2, C.tileBorder));
  parts.push(px(9, 8, 6, C.o1));
  parts.push(px(9, 15, 6, C.o3));
  parts.push(px(9, 22, 6, C.o5));
  parts.push(`<text x="24" y="22" font-family="${MONO}" font-size="13" font-weight="bold" fill="${C.o1}">${text}</text>`);
  fs.writeFileSync(path.join(__dirname, file), svgDoc(w, h, parts.join('')));
}

// ═══ 4. divider.svg ═══
function divider() {
  const W = 960, H = 12;
  const parts = [];
  for (let i = 0; i < W / 12; i++) {
    if (i % 2 === 0) parts.push(px(i * 12, 0, 12, i % 8 === 0 ? C.o1 : i % 4 === 0 ? C.o3 : C.o5));
  }
  fs.writeFileSync(path.join(__dirname, 'divider.svg'), svgDoc(W, H, parts.join('')));
}

banner();
flow();
badge('badge-phase.svg', 'PHASE 1 · PLAYABLE');
badge('badge-local.svg', 'LOCAL-FIRST · NO CLOUD');
badge('badge-lang.svg', 'УКРАЇНСЬКА + ENGLISH');
badge('badge-node.svg', 'NODE ≥ 18');
divider();
console.log('✓ assets generated:', fs.readdirSync(__dirname).filter((f) => f.endsWith('.svg')).join(', '));
