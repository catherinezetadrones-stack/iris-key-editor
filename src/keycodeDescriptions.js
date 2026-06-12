// Keycode → human-readable description, simplified from https://docs.qmk.fm/keycodes.
// Used by the Key Picker description header and the editor keyboard tooltips.
//
// This module only produces *generic* descriptions. Callers are responsible for
// applying profile-specific overrides (custom Macro/Tap Dance descriptions take
// precedence over the generic text returned here for M()/MU()/TD() keycodes).

import { KEYCODE_MAP } from './keyboardLayout';

export const DEFAULT_KEY_DESCRIPTION = 'Select or hover a key to see its description.';
const NO_DESCRIPTION = 'No description available.';

const MOD_NAMES = {
  0x01: 'Left Control', 0x02: 'Left Shift', 0x04: 'Left Alt',  0x08: 'Left GUI',
  0x11: 'Right Control', 0x12: 'Right Shift', 0x14: 'Right Alt', 0x18: 'Right GUI',
  0x07: 'Meh (Ctrl+Shift+Alt)', 0x0f: 'Hyper (Ctrl+Shift+Alt+GUI)', 0x1c: 'Right Alt+Ctrl+GUI',
};

// ── Fixed-code descriptions ───────────────────────────────────────────────────

const EXACT = (() => {
  const m = {
    0x0000: 'No operation — does nothing when pressed.',
    0x0001: 'Transparent — falls through to the same key on the layer below.',
    0x28: 'Enter / Return.',
    0x29: 'Escape.',
    0x2a: 'Backspace.',
    0x2b: 'Tab.',
    0x2c: 'Spacebar.',
    0x2d: 'Minus / underscore key.',
    0x2e: 'Equals / plus key.',
    0x2f: 'Left bracket / brace key.',
    0x30: 'Right bracket / brace key.',
    0x31: 'Backslash / pipe key.',
    0x33: 'Semicolon / colon key.',
    0x34: 'Apostrophe / quote key.',
    0x35: 'Grave accent / tilde key.',
    0x36: 'Comma / less-than key.',
    0x37: 'Period / greater-than key.',
    0x38: 'Slash / question mark key.',
    0x39: 'Caps Lock.',
    0x46: 'Print Screen.',
    0x47: 'Scroll Lock.',
    0x48: 'Pause / Break.',
    0x49: 'Insert.',
    0x4a: 'Home — move cursor to the start of the line.',
    0x4b: 'Page Up.',
    0x4c: 'Delete (forward delete).',
    0x4d: 'End — move cursor to the end of the line.',
    0x4e: 'Page Down.',
    0x4f: 'Right Arrow.',
    0x50: 'Left Arrow.',
    0x51: 'Down Arrow.',
    0x52: 'Up Arrow.',
    0x53: 'Num Lock.',
    0x54: 'Numpad / (divide).',
    0x55: 'Numpad * (multiply).',
    0x56: 'Numpad - (subtract).',
    0x57: 'Numpad + (add).',
    0x58: 'Numpad Enter.',
    0x63: 'Numpad . (delete on some layouts).',
    0x65: 'Application / Menu key — opens the context menu.',
    0xe0: 'Left Control (modifier — hold with another key).',
    0xe1: 'Left Shift (modifier — hold with another key).',
    0xe2: 'Left Alt (modifier — hold with another key).',
    0xe3: 'Left GUI / Windows / Command (modifier — hold with another key).',
    0xe4: 'Right Control (modifier — hold with another key).',
    0xe5: 'Right Shift (modifier — hold with another key).',
    0xe6: 'Right Alt / AltGr (modifier — hold with another key).',
    0xe7: 'Right GUI / Windows / Command (modifier — hold with another key).',
    // Media / system
    0x00a5: 'System Power — turns the system off.',
    0x00a6: 'System Sleep.',
    0x00a7: 'System Wake.',
    0x00a8: 'Mute audio.',
    0x00a9: 'Volume Up.',
    0x00aa: 'Volume Down.',
    0x00ab: 'Next track.',
    0x00ac: 'Previous track.',
    0x00ad: 'Stop playback.',
    0x00ae: 'Play / Pause.',
    0x00af: 'Launch default media player.',
    0x00b0: 'Eject.',
    0x00b1: 'Launch email client.',
    0x00b2: 'Launch calculator.',
    0x00b3: 'Launch file browser / My Computer.',
    0x00b4: 'Browser: Search.',
    0x00b5: 'Browser: Home.',
    0x00b6: 'Browser: Back.',
    0x00b7: 'Browser: Forward.',
    0x00b8: 'Browser: Stop.',
    0x00b9: 'Browser: Refresh.',
    0x00ba: 'Browser: Favorites.',
    0x00bb: 'Increase screen brightness.',
    0x00bc: 'Decrease screen brightness.',
    // Mouse
    0x00cd: 'Move mouse cursor up.',
    0x00ce: 'Move mouse cursor down.',
    0x00cf: 'Move mouse cursor left.',
    0x00d0: 'Move mouse cursor right.',
    0x00d1: 'Mouse button 1 (left click).',
    0x00d2: 'Mouse button 2 (right click).',
    0x00d3: 'Mouse button 3 (middle click).',
    0x00d4: 'Mouse button 4.',
    0x00d5: 'Mouse button 5.',
    0x00d6: 'Mouse button 6.',
    0x00d7: 'Mouse button 7.',
    0x00d8: 'Mouse button 8.',
    0x00d9: 'Mouse wheel up.',
    0x00da: 'Mouse wheel down.',
    0x00db: 'Mouse wheel left.',
    0x00dc: 'Mouse wheel right.',
    0x00dd: 'Mouse cursor acceleration: slowest.',
    0x00de: 'Mouse cursor acceleration: medium.',
    0x00df: 'Mouse cursor acceleration: fastest.',
    // QMK special
    0x7c00: 'Reboots the keyboard into bootloader mode for flashing new firmware.',
    // RGB Matrix
    0x7800: 'Toggles RGB lighting on/off.',
    0x7801: 'Cycles to the next RGB effect.',
    0x7802: 'Cycles to the previous RGB effect.',
    0x7803: 'Increases RGB hue.',
    0x7804: 'Decreases RGB hue.',
    0x7805: 'Increases RGB saturation.',
    0x7806: 'Decreases RGB saturation.',
    0x7807: 'Increases RGB brightness.',
    0x7808: 'Decreases RGB brightness.',
    0x7809: 'Increases RGB effect speed.',
    0x780a: 'Decreases RGB effect speed.',
  };

  // Letters A-Z (0x04-0x1d)
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (let i = 0; i < 26; i++) m[0x04 + i] = `Sends the letter "${letters[i]}".`;

  // Digits 1-0 (0x1e-0x27)
  const digits = '1234567890';
  for (let i = 0; i < 10; i++) m[0x1e + i] = `Sends the number "${digits[i]}".`;

  // F1-F12 (0x3a-0x45) and F13-F24 (0x68-0x73)
  for (let i = 0; i < 12; i++) m[0x3a + i] = `Function key F${i + 1}.`;
  for (let i = 0; i < 12; i++) m[0x68 + i] = `Function key F${i + 13}.`;

  // Numpad digits P1-P9, P0 (0x59-0x62)
  for (let i = 0; i < 9; i++) m[0x59 + i] = `Numpad ${i + 1}.`;
  m[0x62] = 'Numpad 0.';

  // Momentary layer keys MO(n) = 0x5220 | n
  for (let n = 0; n < 16; n++) {
    m[0x5220 + n] = `Momentarily activates layer ${n} while held.`;
  }

  // Shifted symbols S(kc) = 0x0200 | kc — sends the shifted character directly.
  // Described by the resulting character only (not the base key name) since
  // KEYCODE_MAP's 0x0220-0x0238 entries don't follow a consistent S(kc) numbering.
  for (const [codeStr, char] of Object.entries(KEYCODE_MAP)) {
    const code = Number(codeStr);
    if ((code & 0xff00) === 0x0200 && char) {
      m[code] = `Sends "${char}" (Shift + symbol).`;
    }
  }

  return m;
})();

// ── Description lookup ────────────────────────────────────────────────────────

// Returns a generic description for a keycode, or NO_DESCRIPTION if unrecognized.
// Mirrors the range checks in decodeQuantum() (src/keyboardLayout.js) so every
// keycode the picker can produce resolves to *some* description.
export function getKeycodeDescription(code) {
  if (code === undefined || code === null) return DEFAULT_KEY_DESCRIPTION;

  const exact = EXACT[code];
  if (exact !== undefined) return exact;

  // QK_MODS: 0x0100–0x1FFF → modifier(s) + basic key sent as one keypress.
  // Multiple mod bits may be set at once; bit 0x10 makes them all right-hand.
  // Shifted-symbol EXACT entries (0x0220 '!' etc.) take precedence above.
  if (code >= 0x0100 && code <= 0x1fff) {
    const mods  = (code >> 8) & 0x1f;
    const basic = code & 0x00ff;
    const right = (mods & 0x10) !== 0;
    const names = [];
    if (mods & 0x01) names.push(right ? 'Right Ctrl' : 'Ctrl');
    if (mods & 0x02) names.push(right ? 'Right Shift' : 'Shift');
    if (mods & 0x04) names.push(right ? 'Right Alt' : 'Alt');
    if (mods & 0x08) names.push(right ? 'Right Win' : 'Win');
    const keyName = KEYCODE_MAP[basic] || `0x${basic.toString(16)}`;
    if (names.length === 0) return getKeycodeDescription(basic);
    return `Sends ${[...names, keyName].join(' + ')} as a single keypress.`;
  }

  // QK_LAYER_TAP: 0x4000–0x4FFF → LT(layer, key)
  if ((code & 0xF000) === 0x4000) {
    const layer = (code >> 8) & 0x0f;
    const basic = code & 0x00ff;
    const keyName = KEYCODE_MAP[basic] ?? `0x${basic.toString(16)}`;
    return `Layer Tap — hold for layer ${layer}, tap for ${keyName}.`;
  }
  // QK_TAP_DANCE: 0x5700–0x577F → TD(n)
  if (code >= 0x5700 && code <= 0x577f) {
    return `Tap Dance ${code - 0x5700} — behavior defined in the Tap Dance tab.`;
  }
  // QK_TO: 0x5200–0x521F → TO(n)
  if (code >= 0x5200 && code <= 0x521f) {
    return `Activates layer ${code & 0x1f} and deactivates all other layers (except the default layer).`;
  }
  // QK_TOGGLE_LAYER: 0x5230–0x523F → TG(n)
  if ((code & 0xFFF0) === 0x5230) {
    return `Toggles layer ${code & 0xf} on or off.`;
  }
  // QK_LAYER_TAP_TOGGLE: 0x5240–0x524F → TT(n)
  if ((code & 0xFFF0) === 0x5240) {
    return `Hold to momentarily activate layer ${code & 0xf}; tap repeatedly to toggle it on.`;
  }
  // QK_DEF_LAYER: 0x5250–0x525F → DF(n)
  if ((code & 0xFFF0) === 0x5250) {
    return `Sets the default (base) layer to ${code & 0xf}.`;
  }
  // QK_ONE_SHOT_LAYER: 0x5260–0x526F → OSL(n)
  if ((code & 0xFFF0) === 0x5260) {
    return `One-shot layer — activates layer ${code & 0xf} for the next keypress only.`;
  }
  // Compile-time macros MU(n) = 0x7E40–0x7E5F — must precede the Mod-Tap range check below
  if (code >= 0x7E40 && code <= 0x7E5F) {
    return `Compile-time macro MU(${code - 0x7E40}) — defined in the Macros tab; requires a firmware rebuild.`;
  }
  // VIA dynamic macros: 0x7700–0x771F — must precede the Mod-Tap range check below
  if (code >= 0x7700 && code <= 0x771f) {
    return `VIA Macro M(${code - 0x7700}) — defined in the Macros tab.`;
  }
  // QK_MOD_TAP: 0x6000–0x7FFF → MOD·key
  if (code >= 0x6000 && code <= 0x7fff) {
    const mod = (code >> 8) & 0x1f;
    const basic = code & 0x00ff;
    const keyName = KEYCODE_MAP[basic] ?? `0x${basic.toString(16)}`;
    const modName = MOD_NAMES[mod] ?? `modifier 0x${mod.toString(16)}`;
    return `Mod-Tap — hold for ${modName}, tap for ${keyName}.`;
  }

  return NO_DESCRIPTION;
}

// Resolve the description shown to the user for a keycode, applying profile
// overrides: a custom Macro description (from the Macros tab) overrides the
// generic text for M(n)/MU(n), and a custom Tap Dance description overrides
// the generic text for TD(n). Falls back to getKeycodeDescription() otherwise.
export function resolveKeyDescription(code, macroDescriptions, tapDanceDescriptions) {
  if (code === undefined || code === null) return DEFAULT_KEY_DESCRIPTION;

  // VIA dynamic macros: M(n) = 0x7700–0x771F → macroDescriptions.via[n]
  if (code >= 0x7700 && code <= 0x771f) {
    const custom = macroDescriptions?.via?.[code - 0x7700];
    if (custom) return custom;
  }
  // Compile-time macros: MU(n) = 0x7E40–0x7E5F → macroDescriptions.qmk[n]
  if (code >= 0x7E40 && code <= 0x7E5F) {
    const custom = macroDescriptions?.qmk?.[code - 0x7E40];
    if (custom) return custom;
  }
  // Tap Dance: TD(n) = 0x5700–0x577F → tapDanceDescriptions[n]
  if (code >= 0x5700 && code <= 0x577f) {
    const custom = tapDanceDescriptions?.[code - 0x5700];
    if (custom) return custom;
  }

  return getKeycodeDescription(code);
}
