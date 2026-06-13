import { KEYCODE_MAP } from './keyboardLayout';

// Basic keycodes (0x00–0xFF) whose KEYCODE_MAP entry is a display LABEL that is
// not a valid QMK constant suffix — punctuation, numpad symbols, KC_PENT. Without
// these, codegen emitted invalid identifiers like `KC_.` / `KC_P/`. (Letters,
// digits, F-keys, nav, etc. work because their label already equals the suffix.)
const KC_C_NAME_OVERRIDE = {
  0x2d: 'MINS', 0x2e: 'EQL',  0x2f: 'LBRC', 0x30: 'RBRC', 0x31: 'BSLS',
  0x33: 'SCLN', 0x34: 'QUOT', 0x35: 'GRV',  0x36: 'COMM', 0x37: 'DOT',  0x38: 'SLSH',
  0x54: 'PSLS', 0x55: 'PAST', 0x56: 'PMNS', 0x57: 'PPLS', 0x58: 'PENT', 0x63: 'PDOT',
};

// Convert QMK 16-bit keycode to C macro string
export function keycodeToC(code) {
  if (!code || code === 0) return 'KC_NO';
  if (code === 0x0001) return 'KC_TRNS';
  if (code <= 0x00FF) {
    const override = KC_C_NAME_OVERRIDE[code];
    if (override) return `KC_${override}`;
    const name = KEYCODE_MAP[code];
    // Only emit KC_<name> when <name> is a valid C identifier suffix; otherwise
    // fall back to the numeric keycode. For the 0x00–0xFF range the value IS the
    // keycode, so (uint16_t)0xNN is exactly equivalent and always compiles.
    if (name && /^[A-Za-z0-9_]+$/.test(name)) return `KC_${name}`;
    return `(uint16_t)0x${code.toString(16).padStart(4, '0')}`;
  }
  // QK_MODS: 0x0100–0x1FFF → nested modifier macros, e.g. LCTL(LSFT(KC_BSPC)).
  // Bit 0x10 selects right-hand variants for all active mods (QMK shares one
  // right-hand flag across the whole mod byte).
  if (code >= 0x0100 && code <= 0x1FFF) {
    const mods = (code >> 8) & 0x1F;
    const side = (mods & 0x10) ? 'R' : 'L';
    let out = keycodeToC(code & 0xFF);
    // Wrap GUI innermost → CTL outermost: LCTL(LSFT(LALT(LGUI(KC_X))))
    if (mods & 0x08) out = `${side}GUI(${out})`;
    if (mods & 0x04) out = `${side}ALT(${out})`;
    if (mods & 0x02) out = `${side}SFT(${out})`;
    if (mods & 0x01) out = `${side}CTL(${out})`;
    return out;
  }
  if ((code & 0xFFF0) === 0x5220) return `MO(${code & 0xF})`;
  if ((code & 0xF000) === 0x4000) {
    const layer = (code >> 8) & 0xF;
    return `LT(${layer}, ${keycodeToC(code & 0xFF)})`;
  }
  if ((code & 0xFFF0) === 0x5230) return `TG(${code & 0xF})`;
  if (code >= 0x5200 && code <= 0x521F) return `TO(${code & 0x1F})`;
  if ((code & 0xFFF0) === 0x5260) return `OSL(${code & 0xF})`;
  // Extra compile-time macros — MU(n) = QK_USER_n = 0x7E40 | n
  if (code >= 0x7E40 && code <= 0x7E5F) return `QK_USER_${code - 0x7E40}`;
  if (code >= 0x6000 && code <= 0x7FFF && !(code >= 0x7700 && code <= 0x771F)) {
    const mod = (code >> 8) & 0x1F;
    const MOD_MAP = {
      0x01: 'MOD_LCTL', 0x02: 'MOD_LSFT', 0x04: 'MOD_LALT', 0x08: 'MOD_LGUI',
      0x11: 'MOD_RCTL', 0x12: 'MOD_RSFT', 0x14: 'MOD_RALT', 0x18: 'MOD_RGUI',
    };
    return `MT(${MOD_MAP[mod] ?? `0x${mod.toString(16)}`}, ${keycodeToC(code & 0xFF)})`;
  }
  return `(uint16_t)0x${code.toString(16).padStart(4, '0')}`;
}
