// Assembles every app-generated firmware source file for the one-click
// Build & Flash pipeline. Filenames must match the whitelist in
// src-tauri/src/fw_env.rs and the #includes in the bundled keymap.c.

import { buildKeymapLayersCCode } from './keymapLayers';
import { buildPerKeyColorsCCode, NUM_LEDS } from './perKeyColors';
import { buildScrollCCode } from './scrollText';
import { buildTapDanceCCode } from './tapDanceKeys';
import { buildExtraMacroCCode } from '../extraMacroCodec';

export function buildAllSources({
  allKeymaps,
  layerCount,
  perKeyColors,
  scrollSettings,
  tapDanceKeys,
  extraMacros,
}) {
  const safePerKey = perKeyColors
    ?? Array.from({ length: layerCount }, () => Array(NUM_LEDS).fill(null));

  // The firmware supports one scroll text at a time. Unlike the Lighting tab's
  // Save-to-file (which writes whatever layer is being viewed), this picks the
  // first layer config with non-empty text; none configured → no-op stub.
  const scroll = (scrollSettings ?? []).find(s => s?.text?.trim());

  return [
    {
      name: 'keymap_layers.c',
      content: buildKeymapLayersCCode(allKeymaps, layerCount),
    },
    {
      name: 'per_key_colors.c',
      content: buildPerKeyColorsCCode(safePerKey, layerCount),
    },
    {
      name: 'scroll_text.c',
      content: scroll
        ? buildScrollCCode(
            scroll.text,
            scroll.target_layer,
            scroll.speed_ms,
            scroll.fg_hsv,
            scroll.bg_on ? scroll.bg_hsv : null,
          )
        : buildScrollCCode('', 0, 150, [0, 255, 100], null),
    },
    {
      name: 'tap_dance_keys.c',
      content: buildTapDanceCCode(tapDanceKeys ?? {}),
    },
    {
      name: 'extra_macros.c',
      content: buildExtraMacroCCode(extraMacros ?? []),
    },
  ];
}
