// Iris-LM keyboard layout — exact physical→matrix positions from hardware scan.
//
// Matrix coordinates were measured by pressing every key in the Raw Matrix tab
// and recording which [row, col] the VIA firmware reported.  Do not use formulas
// here; the Iris-LM PCB wiring is non-sequential.

// ── Visual stagger (px margin-top per display column) ────────────────────────
// Higher value = key sits lower on screen.
// Profile peaks at the middle finger (d=3 left / d=2 right) and drops on
// both sides — matching the physical Iris-LM column stagger.
export const STAGGER_LEFT  = [23, 23, 8, 0, 5, 14];  // pinky-outer→index-inner
export const STAGGER_RIGHT = [14, 5, 0, 8, 23, 23];  // index-inner→pinky-outer

// ── Default legends (shown when no keymap is loaded) ─────────────────────────
// Order: physical left-to-right as seen looking at the keyboard.
const LEFT_ROWS = [
  ['ESC',  '1', '2', '3', '4', '5'],
  ['TAB',  'Q', 'W', 'E', 'R', 'T'],
  ['LSFT', 'A', 'S', 'D', 'F', 'G'],
  ['LCTL', 'Z', 'X', 'C', 'V', 'B'],
];
const RIGHT_ROWS = [
  ['6', '7', '8',  '9', '0', 'BSPC'],
  ['Y', 'U', 'I',  'O', ';', 'DEL' ],
  ['H', 'J', 'K',  'L', 'P', 'CAPS'],
  ['N', 'M', '.',  "'", '/', 'RALT' ],
];

const LEFT_THUMBS  = ['HOME', 'SFT·ENT', 'MO(1)', 'LGUI']; // visual slot 0→3: beside-G … below-V
const RIGHT_THUMBS = ['END',  'LT3·SP', 'MO(2)',   ','   ];

// ── Physical [row][col] → [matrixRow, matrixCol] ──────────────────────────────
// Confirmed by pressing each key and reading the Raw Matrix output.

// Matrix coordinates use the QMK logical matrix (rows 0-9, cols 0-5) as reported
// by the VIAL firmware via GET_KEYBOARD_VALUE(SWITCH_MATRIX_STATE).
// Left half = rows 0-4, right half = rows 5-9. Source: keyboard.json LAYOUT.

const LEFT_MATRIX = [
  // ESC   1      2      3      4      5
  [[0,0],[0,1],[0,2],[0,3],[0,4],[0,5]],
  // TAB   Q      W      E      R      T
  [[1,0],[1,1],[1,2],[1,3],[1,4],[1,5]],
  // LSFT  A      S      D      F      G
  [[2,0],[2,1],[2,2],[2,3],[2,4],[2,5]],
  // LCTL  Z      X      C      V      B
  [[3,0],[3,1],[3,2],[3,3],[3,4],[3,5]],
];

const RIGHT_MATRIX = [
  // 6      7      8      9      0      BSPC
  [[5,5],[5,4],[5,3],[5,2],[5,1],[5,0]],
  // Y      U      I      O      ;      DEL
  [[6,5],[6,4],[6,3],[6,2],[6,1],[6,0]],
  // H      J      K      L      P      CAPS
  [[7,5],[7,4],[7,3],[7,2],[7,1],[7,0]],
  // N      M      .      '      /      RALT
  [[8,5],[8,4],[8,3],[8,2],[8,1],[8,0]],
];

// Thumb clusters — visual slot order (0=inner/top … 3=outer/bottom) → [matrixRow, matrixCol]
const LEFT_THUMB_MATRIX  = [[4,5],[4,4],[4,3],[4,2]];
//                           HOME  SFT·ENT MO(1) LGUI

const RIGHT_THUMB_MATRIX = [[9,5],[9,4],[9,3],[9,2]];
//                           END   LT3·SP  MO(2)  ,

// ── CSS grid positions for thumb keys ────────────────────────────────────────
// col/row here are CSS grid-column / grid-row values (not matrix coords).
// Inner rotated keys (HOME/END) and outer keys (MO/LGUI) share the same row
// so they sit at the same height, matching the VIA image.
// col/row = CSS grid cell; xOff/yOff = px offset from that cell's top-left
// (set via the thumb-editor.html tool to match the physical keyboard shape).
const LEFT_THUMB_CELLS  = [
  { col: 7, row: 5, xOff:  -6, yOff: -26, rotation:  20 }, // HOME
  { col: 7, row: 5, xOff: -27, yOff:  32, rotation:  20 }, // SFT·ENT
  { col: 6, row: 5, xOff: -30, yOff:  17, rotation:   0 }, // MO(1)
  { col: 5, row: 5, xOff: -24, yOff:   3, rotation:   0 }, // LGUI
];
const RIGHT_THUMB_CELLS = [
  { col: 1, row: 5, xOff:   6, yOff: -26, rotation: -20 }, // END
  { col: 1, row: 5, xOff:  27, yOff:  32, rotation: -20 }, // LT3·SP
  { col: 2, row: 5, xOff:  30, yOff:  17, rotation:   0 }, // MO(2)
  { col: 3, row: 5, xOff:  24, yOff:   3, rotation:   0 }, // ,
];

// ── Layout builder ────────────────────────────────────────────────────────────

function buildHalf(side) {
  const rows       = side === 'left' ? LEFT_ROWS         : RIGHT_ROWS;
  const stagger    = side === 'left' ? STAGGER_LEFT      : STAGGER_RIGHT;
  const thumbs     = side === 'left' ? LEFT_THUMBS       : RIGHT_THUMBS;
  const matrix     = side === 'left' ? LEFT_MATRIX       : RIGHT_MATRIX;
  const tMatrix    = side === 'left' ? LEFT_THUMB_MATRIX : RIGHT_THUMB_MATRIX;
  const thumbCells = side === 'left' ? LEFT_THUMB_CELLS  : RIGHT_THUMB_CELLS;
  const colShift   = side === 'left' ? 1                 : 2;
  const keys       = [];

  rows.forEach((row, r) => {
    row.forEach((label, d) => {
      const [mr, mc] = matrix[r][d];
      // viaRow/viaCol index the VIA keymap buffer (used for read/write).
      // left:  flat index = r*6+d   → viaRow=r,   viaCol=d
      // right: flat index = 30+r*6+(5-d) → viaRow=5+r, viaCol=5-d
      const vr = side === 'left' ? r     : 5 + r;
      const vc = side === 'left' ? d     : 5 - d;
      keys.push({
        id: `${side}-m-${r}-${d}`,
        label,
        gridColumn: d + colShift,
        gridRow:    r + 1,
        marginTop:  stagger[d],
        matrixRow:  mr,
        matrixCol:  mc,
        viaRow:     vr,
        viaCol:     vc,
        thumb:      false,
      });
    });
  });

  thumbs.forEach((label, t) => {
    const [mr, mc] = tMatrix[t];
    // left thumb  visual slot t: VIA flat index 26+(3-t)  → viaRow=4, viaCol=5-t
    // right thumb visual slot t: VIA flat index 56+(3-t)  → viaRow=9, viaCol=5-t
    const vr = side === 'left' ? 4 : 9;
    const vc = 5 - t;
    keys.push({
      id:         `${side}-t-${t}`,
      label,
      gridColumn: thumbCells[t].col,
      gridRow:    thumbCells[t].row,
      marginTop:  thumbCells[t].yOff ?? 0,
      marginLeft: thumbCells[t].xOff ?? 0,
      rotation:   thumbCells[t].rotation,
      matrixRow:  mr,
      matrixCol:  mc,
      viaRow:     vr,
      viaCol:     vc,
      thumb:      true,
    });
  });

  return keys;
}

export const HALVES = {
  left:  buildHalf('left'),
  right: buildHalf('right'),
};

// ── Keycode → display name ────────────────────────────────────────────────────

export const KEYCODE_MAP = (() => {
  const m = {
    0x0000: '',    // KC_NO
    0x0001: '▽',  // KC_TRNS
  };
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (let i = 0; i < 26; i++) m[0x04 + i] = letters[i];
  const digits = '1234567890';
  for (let i = 0; i < 10; i++) m[0x1e + i] = digits[i];
  Object.assign(m, {
    0x28: 'ENT',  0x29: 'ESC',  0x2a: 'BSPC', 0x2b: 'TAB',  0x2c: 'SPC',
    0x2d: '-',    0x2e: '=',    0x2f: '[',     0x30: ']',    0x31: '\\',
    0x33: ';',    0x34: "'",    0x35: '`',     0x36: ',',    0x37: '.',
    0x38: '/',    0x39: 'CAPS',
    0x3a: 'F1',   0x3b: 'F2',   0x3c: 'F3',   0x3d: 'F4',
    0x3e: 'F5',   0x3f: 'F6',   0x40: 'F7',   0x41: 'F8',
    0x42: 'F9',   0x43: 'F10',  0x44: 'F11',  0x45: 'F12',
    0x46: 'PSCR', 0x47: 'SCRL', 0x48: 'PAUS',
    0x49: 'INS',  0x4a: 'HOME', 0x4b: 'PGUP', 0x4c: 'DEL',
    0x4d: 'END',  0x4e: 'PGDN',
    0x4f: 'RGHT', 0x50: 'LEFT', 0x51: 'DOWN', 0x52: 'UP',
    // Numpad
    0x53: 'NLCK', 0x54: 'P/',   0x55: 'P*',   0x56: 'P-',
    0x57: 'P+',   0x58: 'PEnt', 0x59: 'P1',   0x5a: 'P2',
    0x5b: 'P3',   0x5c: 'P4',   0x5d: 'P5',   0x5e: 'P6',
    0x5f: 'P7',   0x60: 'P8',   0x61: 'P9',   0x62: 'P0',
    0x63: 'P.',
    // Application / Menu key
    0x65: 'APP',
    // F13–F24
    0x68: 'F13', 0x69: 'F14', 0x6a: 'F15', 0x6b: 'F16',
    0x6c: 'F17', 0x6d: 'F18', 0x6e: 'F19', 0x6f: 'F20',
    0x70: 'F21', 0x71: 'F22', 0x72: 'F23', 0x73: 'F24',
    0xe0: 'LCTL', 0xe1: 'LSFT', 0xe2: 'LALT', 0xe3: 'LGUI',
    0xe4: 'RCTL', 0xe5: 'RSFT', 0xe6: 'RALT', 0xe7: 'RGUI',
    // Media / system (QMK ~0.10 consumer-page mapping)
    0x00a5: 'PWR',  0x00a6: 'SLEP', 0x00a7: 'WAKE',
    0x00a8: 'MUTE', 0x00a9: 'VOLU', 0x00aa: 'VOLD',
    0x00ab: 'MNXT', 0x00ac: 'MPRV', 0x00ad: 'MSTP', 0x00ae: 'MPLY',
    0x00af: 'MSEL', 0x00b0: 'EJCT',
    0x00b1: 'MAIL', 0x00b2: 'CALC', 0x00b3: 'MYCM',
    0x00b4: 'WSCH', 0x00b5: 'WHOM', 0x00b6: 'WBAK',
    0x00b7: 'WFWD', 0x00b8: 'WSTP', 0x00b9: 'WREF', 0x00ba: 'WFAV',
    0x00bb: 'BRIU', 0x00bc: 'BRID',
    // Mouse (QK_MOUSE range 0xCD–0xDF)
    0x00cd: 'MS_UP',   0x00ce: 'MS_DOWN', 0x00cf: 'MS_LEFT', 0x00d0: 'MS_RGHT',
    0x00d1: 'MS_BTN1', 0x00d2: 'MS_BTN2', 0x00d3: 'MS_BTN3',
    0x00d4: 'MS_BTN4', 0x00d5: 'MS_BTN5', 0x00d6: 'MS_BTN6',
    0x00d7: 'MS_BTN7', 0x00d8: 'MS_BTN8',
    0x00d9: 'MS_WHLU', 0x00da: 'MS_WHLD', 0x00db: 'MS_WHLL', 0x00dc: 'MS_WHLR',
    0x00dd: 'MS_ACL0', 0x00de: 'MS_ACL1', 0x00df: 'MS_ACL2',
    // QMK special
    0x7c00: 'QK_BOOT',
    // RGB Matrix keycodes (QK_RGB_MATRIX base = 0x7800)
    0x7800: 'RGB_TOG',  0x7801: 'RGB_MOD',  0x7802: 'RGB_RMOD',
    0x7803: 'RGB_HUI',  0x7804: 'RGB_HUD',
    0x7805: 'RGB_SAI',  0x7806: 'RGB_SAD',
    0x7807: 'RGB_VAI',  0x7808: 'RGB_VAD',
    0x7809: 'RGB_SPI',  0x780a: 'RGB_SPD',
    // Common shifted symbols (S(kc) = 0x0200 | kc)
    0x0220: '!', 0x0221: '@', 0x0222: '#', 0x0223: '$', 0x0224: '%',
    0x0225: '^', 0x0226: '(', 0x0227: ')', 0x0228: '{', 0x022d: '_',
    0x022e: '+', 0x022f: '{', 0x0230: '}', 0x0231: '|', 0x0233: ':',
    0x0234: '"', 0x0235: '~', 0x0236: '<', 0x0237: '>', 0x0238: '?',
  });
  // MO(n) = 0x5220 | n
  for (let n = 0; n < 16; n++) m[0x5220 + n] = `MO(${n})`;
  // Custom tap dance — TD(n) = 0x5700 | n
  for (let n = 0; n < 32; n++) m[0x5700 + n] = `TD(${n})`;
  return m;
})();

// ── Shifted (secondary) character for dual-legend keys ───────────────────────
// Shown in the top-right corner of a key, mirroring physical keycap printing.
const SECONDARY_MAP = {
  0x001e: '!', 0x001f: '@', 0x0020: '#', 0x0021: '$', 0x0022: '%',
  0x0023: '^', 0x0024: '&', 0x0025: '*', 0x0026: '(', 0x0027: ')',
  0x002d: '_', 0x002e: '+', 0x002f: '{', 0x0030: '}', 0x0031: '|',
  0x0033: ':', 0x0034: '"', 0x0035: '~', 0x0036: '<', 0x0037: '>',
  0x0038: '?',
};

export function getSecondary(code) {
  return SECONDARY_MAP[code] ?? null;
}

// Decode a keycode to a short display name.
// Returns null if the code is completely unknown (caller shows hex fallback).
export function decodeQuantum(code) {
  if (code === undefined || code === null) return null;
  const direct = KEYCODE_MAP[code];
  if (direct !== undefined) return direct;

  // QK_LAYER_TAP: 0x4000–0x4FFF → LT(layer, key)
  if ((code & 0xF000) === 0x4000) {
    const layer   = (code >> 8) & 0x0f;
    const basic   = code & 0x00ff;
    const keyName = KEYCODE_MAP[basic] ?? `0x${basic.toString(16)}`;
    return `LT${layer}·${keyName}`;
  }
  // QK_TAP_DANCE: 0x5700–0x577F → TD(n)
  if (code >= 0x5700 && code <= 0x577f) return `TD(${code - 0x5700})`;
  // QK_TO: 0x5200–0x521F → TO(n)
  if (code >= 0x5200 && code <= 0x521f) return `TO(${code & 0x1f})`;
  // QK_TOGGLE_LAYER: 0x5230–0x523F → TG(n)
  if ((code & 0xFFF0) === 0x5230) return `TG(${code & 0xf})`;
  // QK_LAYER_TAP_TOGGLE: 0x5240–0x524F → TT(n)
  if ((code & 0xFFF0) === 0x5240) return `TT(${code & 0xf})`;
  // QK_DEF_LAYER: 0x5250–0x525F → DF(n)
  if ((code & 0xFFF0) === 0x5250) return `DF(${code & 0xf})`;
  // QK_ONE_SHOT_LAYER: 0x5260–0x526F → OSL(n)
  if ((code & 0xFFF0) === 0x5260) return `OSL(${code & 0xf})`;
  // VIA dynamic macros: 0x7700–0x771F — must precede the MT range check below
  if (code >= 0x7700 && code <= 0x771f) return `M(${code - 0x7700})`;
  // QK_MOD_TAP: 0x6000–0x7FFF → MOD·key
  if (code >= 0x6000 && code <= 0x7fff) {
    const mod   = (code >> 8) & 0x1f;
    const basic = code & 0x00ff;
    const key   = KEYCODE_MAP[basic] ?? `0x${basic.toString(16)}`;
    const MOD_NAMES = {
      0x01: 'CTL',  0x02: 'SFT',  0x04: 'ALT',  0x08: 'GUI',
      0x11: 'RCTL', 0x12: 'RSFT', 0x14: 'RALT', 0x18: 'RGUI',
      0x07: 'MEH',  0x0f: 'HYPR', 0x1c: 'RAGR',
    };
    return `${MOD_NAMES[mod] ?? `MT${mod.toString(16)}`}·${key}`;
  }

  return null; // caller will show hex
}

// ── VIALRGB effect names ──────────────────────────────────────────────────────
// Maps VIALRGB effect ID (u16 from firmware) to a display name.
// IDs are stable/never reordered per vialrgb_effects.inc spec.
// Only IDs the Iris-LM firmware has compiled in will appear in GET_SUPPORTED;
// others are harmless to list here as labels.
export const VIALRGB_EFFECTS = {
   0: 'Off',
   1: 'Direct (per-key)',
   2: 'Solid Color',
   3: 'Alphas Mods',
   4: 'Gradient — Up/Down',
   5: 'Gradient — Left/Right',
   6: 'Breathing',
   7: 'Band Saturation',
   8: 'Band Value',
   9: 'Band Pinwheel Sat',
  10: 'Band Pinwheel Val',
  11: 'Band Spiral Sat',
  12: 'Band Spiral Val',
  13: 'Cycle All',
  14: 'Cycle Left/Right',
  15: 'Cycle Up/Down',
  16: 'Rainbow Chevron',
  17: 'Cycle Out-In',
  18: 'Cycle Out-In Dual',
  19: 'Cycle Pinwheel',
  20: 'Cycle Spiral',
  21: 'Dual Beacon',
  22: 'Rainbow Beacon',
  23: 'Rainbow Pinwheels',
  24: 'Raindrops',
  25: 'Jellybean Raindrops',
  26: 'Hue Breathing',
  27: 'Hue Pendulum',
  28: 'Hue Wave',
  29: 'Typing Heatmap',
  30: 'Digital Rain',
  31: 'Solid Reactive Simple',
  32: 'Solid Reactive',
  33: 'Solid Reactive Wide',
  34: 'Solid Reactive Multiwide',
  35: 'Solid Reactive Cross',
  36: 'Solid Reactive Multicross',
  37: 'Solid Reactive Nexus',
  38: 'Solid Reactive Multinexus',
  39: 'Splash',
  40: 'Multisplash',
  41: 'Solid Splash',
  42: 'Solid Multisplash',
  43: 'Pixel Rain',
  44: 'Pixel Fractal',
};

// ── Iris-LM per-key LED grid ──────────────────────────────────────────────────
// Each row is 6 LED indices matching physical columns left→right.
// -1 = empty cell (no key at that position).
// Left half: rows 0-3 are main keys, row 4 is the thumb cluster (cols 2-5 only).
// Right half: displayed mirrored so col 5 (inner/Y-H-N) is leftmost.
export const IRIS_LED_GRID = {
  left: [
    [ 0,  2,  3,  5,  6,  8],   // row 0 — col0..col5
    [14, 13, 12, 11, 10,  9],   // row 1
    [15, 16, 17, 18, 19, 20],   // row 2
    [28, 26, 25, 23, 22, 21],   // row 3
    [-1, -1, 33, 32, 30, 29],   // row 4 — thumb cluster (cols 2-5)
  ],
  right: [
    [42, 40, 39, 37, 36, 34],   // row 5 — col5→col0 (mirrored)
    [43, 44, 45, 46, 47, 48],   // row 6
    [54, 53, 52, 51, 50, 49],   // row 7
    [55, 56, 57, 59, 60, 62],   // row 8
    [67, 66, 64, 63, -1, -1],   // row 9 — thumb cluster (cols 5-2)
  ],
};

// ── Key ID → LED index lookup ─────────────────────────────────────────────────
// Used by the editor's lighting glow overlay to colour each key.
// Main key IDs are `{side}-m-{r}-{d}`; rows/cols map directly to IRIS_LED_GRID.
// Thumb IDs are `{side}-t-{t}` and are hardcoded (grid positions don't align).
// Declared after IRIS_LED_GRID to avoid temporal dead zone.
export const KEY_TO_LED = new Map([
  // Left main keys
  ...[...HALVES.left].filter(k => !k.thumb).map(k => {
    const [, , r, d] = k.id.split('-').map((x, i) => i >= 2 ? parseInt(x) : x);
    const idx = IRIS_LED_GRID.left[r]?.[d];
    return (idx != null && idx !== -1) ? [k.id, idx] : null;
  }).filter(Boolean),
  // Right main keys
  ...[...HALVES.right].filter(k => !k.thumb).map(k => {
    const [, , r, d] = k.id.split('-').map((x, i) => i >= 2 ? parseInt(x) : x);
    const idx = IRIS_LED_GRID.right[r]?.[d];
    return (idx != null && idx !== -1) ? [k.id, idx] : null;
  }).filter(Boolean),
  // Left thumb cluster (hardcoded — rotated keys don't align to the grid formula)
  ['left-t-0', 33],  // HOME
  ['left-t-1', 32],  // SFT·ENT
  ['left-t-2', 30],  // MO(1)
  ['left-t-3', 29],  // LGUI
  // Right thumb cluster
  ['right-t-0', 67], // END
  ['right-t-1', 66], // LT3·SP
  ['right-t-2', 64], // MO(2)
  ['right-t-3', 63], // ,
]);
