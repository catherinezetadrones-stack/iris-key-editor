// Derived per-key display maps shared by the Editor keyboard and Key Test.
// Pure functions — both App.jsx (current editor layer) and KeyTest.jsx
// (live hardware-active layer) build the same Maps from the same state.

import { KEY_TO_LED } from './keyboardLayout';

// Map<keyId, cssColor> for per-key LED glow, or null when the layer has none.
// `colors` is one layer's array of 68 LED [h, s, v] entries (0-255 each).
export function buildKeyLedColors(colors) {
  if (!colors) return null;
  const map = new Map();
  KEY_TO_LED.forEach((ledIdx, keyId) => {
    const hsv = colors[ledIdx];
    if (!hsv) return;
    const [h, s, v] = hsv;
    const hDeg = Math.round((h / 255) * 360);
    const sP = Math.round((s / 255) * 100);
    const lP = Math.round((v / 255) * 50);
    map.set(keyId, `hsl(${hDeg}, ${sP}%, ${lP}%)`);
  });
  return map.size > 0 ? map : null;
}

// Map<keyId, 'TD'> badges for keys with any tap dance action on `layer`,
// or null when none.
export function buildTapDanceBadges(tapDanceKeys, layer) {
  const layerTD = tapDanceKeys?.[layer] ?? {};
  const map = new Map();
  Object.entries(layerTD).forEach(([keyId, e]) => {
    if (e.on_tap || e.on_hold || e.on_double_tap || e.on_tap_hold) map.set(keyId, 'TD');
  });
  return map.size > 0 ? map : null;
}
