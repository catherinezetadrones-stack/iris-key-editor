import { KEYCODE_MAP } from './keyboardLayout';

// Convert QMK 16-bit keycode to C macro string
export function keycodeToC(code) {
  if (!code || code === 0) return 'KC_NO';
  if (code === 0x0001) return 'KC_TRNS';
  if (code <= 0x00FF) {
    const name = KEYCODE_MAP[code];
    if (name && name.length > 0 && name !== '▽' && name !== '') return `KC_${name}`;
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
