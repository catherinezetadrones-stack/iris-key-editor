// tap_dance_keys.c generator — moved from TapDanceKeyPanel.jsx unchanged.

import { keycodeToC } from '../keycodeToC';

export const TD_FIELDS = [
  { key: 'on_tap',        label: 'On Tap' },
  { key: 'on_hold',       label: 'On Hold' },
  { key: 'on_double_tap', label: 'Double Tap' },
  { key: 'on_tap_hold',   label: 'Tap + Hold' },
];

function keyIdToEnum(id) {
  return `TD_${id.replace(/-/g, '_').toUpperCase()}`;
}

// register_code16/unregister_code16 silently no-op on QMK layer-switch keycodes
// (process_record_quantum handles those, not the HID code path) — emit the
// equivalent layer_* call instead. release === null means nothing to undo.
function layerKeycodeAction(code) {
  if ((code & 0xFFF0) === 0x5220) {
    const n = code & 0xF;
    return { press: `layer_on(${n});`, release: `layer_off(${n});` };
  }
  if ((code & 0xFFF0) === 0x5230) {
    const n = code & 0xF;
    return { press: `layer_invert(${n});`, release: null };
  }
  if (code >= 0x5200 && code <= 0x521F) {
    const n = code & 0x1F;
    return { press: `layer_move(${n});`, release: null };
  }
  return null;
}

// Press / release statement for a configured action code.
function pressStmt(code) {
  const layerAction = layerKeycodeAction(code);
  return layerAction ? layerAction.press : `register_code16(${keycodeToC(code)});`;
}

function releaseStmt(code) {
  const layerAction = layerKeycodeAction(code);
  if (layerAction) return layerAction.release; // may be null — nothing to undo
  return `unregister_code16(${keycodeToC(code)});`;
}

// Always emitted (even with no TD keys): build_vial.mk defines
// TAPPING_TERM_PER_KEY whenever tap dance is enabled, and this keymap-level
// definition overrides the weak fallback in quantum/vial.c. Returns the
// per-key/per-layer term when set; everything else falls through to the same
// default vial.c would have used (the QMK Settings runtime value when
// QMK_SETTINGS is enabled, the compile-time TAPPING_TERM otherwise) so
// MT/LT/other tapping keys behave exactly as before.
function buildGetTappingTerm(tapDanceKeys, keyIds) {
  const tdCases = [...keyIds].map(id => {
    const layerCases = Object.entries(tapDanceKeys)
      .filter(([, layerObj]) => {
        const e = layerObj?.[id];
        return e && (e.tapping_term_ms ?? 0) > 0
          && TD_FIELDS.some(f => (e[f.key] ?? 0) !== 0);
      })
      .map(([layerIdx, layerObj]) => `                case ${layerIdx}: return ${layerObj[id].tapping_term_ms};`)
      .join('\n');
    if (!layerCases) return null;
    return `        case TD(${keyIdToEnum(id)}):
            switch (get_highest_layer(layer_state)) {
${layerCases}
                default: break;
            }
            break;`;
  }).filter(Boolean).join('\n');

  const fallback = `#ifdef QMK_SETTINGS
    return qs_get_tapping_term(keycode, record);
#else
    return TAPPING_TERM;
#endif`;

  const body = tdCases
    ? `    switch (keycode) {\n${tdCases}\n        default: break;\n    }\n${fallback}`
    : fallback;

  return `#ifdef QMK_SETTINGS
#include "qmk_settings.h"
#endif

uint16_t get_tapping_term(uint16_t keycode, keyrecord_t *record) {
    (void)record;
    (void)keycode;
${body}
}`;
}

export function buildTapDanceCCode(tapDanceKeys) {
  // Collect unique key IDs across all layers that have any config
  const keyIds = new Set();
  Object.values(tapDanceKeys).forEach(layerObj => {
    Object.entries(layerObj ?? {}).forEach(([keyId, e]) => {
      if (TD_FIELDS.some(f => (e[f.key] ?? 0) !== 0)) keyIds.add(keyId);
    });
  });

  if (keyIds.size === 0) {
    return `// No tap dance keys configured.

// TAPPING_TERM_PER_KEY is defined in config.h; provide the keymap-level
// override unconditionally so the build never depends on which generated
// sections are present.
${buildGetTappingTerm(tapDanceKeys, keyIds)}`;
  }

  const stateMap = ['TD_SINGLE_TAP', 'TD_SINGLE_HOLD', 'TD_DOUBLE_TAP', 'TD_DOUBLE_HOLD'];
  const enumValues = [...keyIds].map(id => `    ${keyIdToEnum(id)}`).join(',\n');

  // Layers (with entries) for one key id, as [layerIdx, entry] pairs.
  const configuredLayers = (id) => Object.entries(tapDanceKeys)
    .filter(([, layerObj]) => {
      const e = layerObj?.[id];
      return e && TD_FIELDS.some(f => (e[f.key] ?? 0) !== 0);
    })
    .map(([layerIdx, layerObj]) => [layerIdx, layerObj[id]]);

  const callbacks = [...keyIds].map(id => {
    const enumId = keyIdToEnum(id);
    const fnBase = enumId.toLowerCase();
    const varName = `${fnBase}_state`;

    // Per-layer cases
    const layerCases = configuredLayers(id)
      .map(([layerIdx, e]) => {
        const pressLines = TD_FIELDS
          .map(({ key }, i) => {
            const code = e[key] ?? 0;
            if (code === 0) return null;
            return `                case ${stateMap[i]}: ${pressStmt(code)} break;`;
          })
          .filter(Boolean).join('\n');
        return `        case ${layerIdx}:\n            switch (${varName}.state) {\n${pressLines}\n                default: break;\n            }\n            break;`;
      }).join('\n');

    const unregCases = configuredLayers(id)
      .map(([layerIdx, e]) => {
        const releaseLines = TD_FIELDS
          .map(({ key }, i) => {
            const code = e[key] ?? 0;
            if (code === 0) return null;
            const stmt = releaseStmt(code);
            return stmt ? `                case ${stateMap[i]}: ${stmt} break;` : null;
          })
          .filter(Boolean).join('\n');
        return `        case ${layerIdx}:\n            switch (${varName}.state) {\n${releaseLines}\n                default: break;\n            }\n            break;`;
      }).join('\n');

    // Early-finish on key release: QMK only resolves a dance after the tapping
    // term expires, which delays single taps by the full term and swallows
    // rapid re-taps. When the outcome is already unambiguous on release, fire
    // it immediately: setting state->finished makes the core run the reset
    // callback right after this one, so the matching unregister still happens.
    const releaseCases = configuredLayers(id)
      .map(([layerIdx, e]) => {
        const hasTap     = (e.on_tap ?? 0) !== 0;
        const hasDouble  = (e.on_double_tap ?? 0) !== 0;
        const hasTapHold = (e.on_tap_hold ?? 0) !== 0;
        const lines = [];
        // First release: only safe when no two-tap behavior exists, otherwise
        // the dance must keep waiting to see whether a second tap follows.
        if (hasTap && !hasDouble && !hasTapHold) {
          lines.push(`            if (!state->finished && state->count == 1) {
                ${varName}.state = TD_SINGLE_TAP;
                ${pressStmt(e.on_tap)}
                state->finished = true;
            }`);
        }
        // Second release: a release can never become a hold, so the outcome is
        // final — fire the double tap now (or just reset if none is configured).
        if (hasDouble) {
          lines.push(`            if (!state->finished && state->count >= 2) {
                ${varName}.state = TD_DOUBLE_TAP;
                ${pressStmt(e.on_double_tap)}
                state->finished = true;
            }`);
        } else {
          lines.push(`            if (!state->finished && state->count >= 2) {
                state->finished = true; // nothing bound to double tap — reset cleanly
            }`);
        }
        if (lines.length === 0) return null;
        return `        case ${layerIdx}:\n${lines.join('\n')}\n            break;`;
      })
      .filter(Boolean).join('\n');

    return `static td_tap_t ${varName} = {0};

void ${fnBase}_on_release(tap_dance_state_t *state, void *user_data) {
    uint8_t layer = get_highest_layer(layer_state);
    switch (layer) {
${releaseCases}
        default: break;
    }
}

// No early-out on state->finished here: the core sets finished = true right
// BEFORE invoking this callback (process_tap_dance_action_on_dance_finished),
// and it already skips the call entirely when on_release resolved the dance.
void ${fnBase}_finished(tap_dance_state_t *state, void *user_data) {
    ${varName}.state = cur_dance(state);
    uint8_t layer = get_highest_layer(layer_state);
    switch (layer) {
${layerCases}
        default: break;
    }
}

void ${fnBase}_reset(tap_dance_state_t *state, void *user_data) {
    uint8_t layer = get_highest_layer(layer_state);
    switch (layer) {
${unregCases}
        default: break;
    }
    ${varName}.state = TD_NONE;
}`;
  }).join('\n\n');

  const actionsTable = [...keyIds]
    .map(id => {
      const enumId = keyIdToEnum(id);
      const fnBase = enumId.toLowerCase();
      return `    [${enumId}] = ACTION_TAP_DANCE_FN_ADVANCED_WITH_RELEASE(NULL, ${fnBase}_on_release, ${fnBase}_finished, ${fnBase}_reset)`;
    }).join(',\n');

  return `// Tap Dance keys — generated by Iris Key Editor.
// Included by keymap.c after td_state_t / td_tap_t / cur_dance are defined.
// Use TD(ENUM_NAME) in keymap layers. TAP_DANCE_ENABLE = yes in rules.mk.

enum {
${enumValues}
};

${callbacks}

tap_dance_action_t tap_dance_actions[] = {
${actionsTable}
};

${buildGetTappingTerm(tapDanceKeys, keyIds)}`;
}
