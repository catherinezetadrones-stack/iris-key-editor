// Dev-only: exercise buildTapDanceCCode with a representative config and print
// the generated C. Bundle with esbuild before running (see td-codegen-test usage).
import { buildTapDanceCCode } from '../src/codegen/tapDanceKeys.js';

const sample = {
  // Layer 3: tap = Backspace, hold = Ctrl+Backspace, custom 150ms term
  3: {
    'left-m-4-3': {
      on_tap: 0x002a,
      on_hold: 0x012a, // LCTL(KC_BSPC)
      on_double_tap: 0,
      on_tap_hold: 0,
      tapping_term_ms: 150,
    },
    // Same layer, second key: tap + double tap, global term
    'right-m-2-2': {
      on_tap: 0x0029,
      on_hold: 0,
      on_double_tap: 0x5231, // TG(1)
      on_tap_hold: 0,
      tapping_term_ms: 0,
    },
  },
  // Same key also configured on layer 0 — multi-layer case
  0: {
    'left-m-4-3': {
      on_tap: 0x002c,
      on_hold: 0x5220, // MO(0)... layer action as hold
      on_double_tap: 0,
      on_tap_hold: 0,
      tapping_term_ms: 0,
    },
  },
};

if (process.argv[2] === '--populated-only') {
  process.stdout.write(buildTapDanceCCode(sample) + '\n');
} else {
  process.stdout.write(buildTapDanceCCode(sample));
  process.stdout.write('\n\n// ── empty config variant ──\n');
  process.stdout.write(buildTapDanceCCode({}));
  process.stdout.write('\n');
}
