# Migrating to the stock VIA protocol

This implements the recommendation from `CORRECTIONS.md` §3a: instead of a custom
HID protocol and custom firmware, the editor now drives the **VIA support the
Iris-LM already ships with**. You get the same remapping power without
reinventing anything — and without ever reflashing for a remap.

## Why this is better

- **No custom firmware.** The board's stock firmware already speaks VIA over raw
  HID. The previous design's custom `raw_hid_receive()` would have *conflicted*
  with VIA's own handler (QMK allows only one).
- **Remaps actually persist.** VIA's `set_keycode` writes to the dynamic keymap
  in **EEPROM**, so changes survive unplugging and follow the board to any
  machine. The old `SET_KEY` wrote to `keymaps[][][]`, which lives in flash and
  is read-only at runtime — it could never have worked.
- **No bootloader/flashing in the remap path.** Remapping is live over HID. The
  original "no manual bootloader mode" goal is met for free.

## How it works now

```
React UI ──(Tauri invoke)──> Rust backend ──(raw HID, VIA)──> Iris-LM (stock fw)
```

- `via_protocol.rs` — VIA command IDs, transport constants, and the Iris matrix shape.
- `usb_handler.rs` — finds the VIA interface and runs commands via `hidapi`:
  - `read_layer(layer)` uses the bulk `dynamic_keymap_get_buffer` command (fast).
  - `set_keycode(...)` uses `dynamic_keymap_set_keycode` (persisted to EEPROM).
  - `layer_count`, `protocol_version`, `jump_bootloader` round it out.
- `main.rs` — Tauri commands `detect_devices`, `read_keymap`, `write_key`,
  `get_layer_count`, `jump_bootloader`, `flash_firmware`.

The VIA interface is located by **HID usage page `0xFF60` / usage `0x61`**, not by
a guessed product ID — so it works for any VIA-enabled build (with a Keebio-VID
fallback for platforms that don't report usage info).

## The matrix mapping (the important part)

VIA addresses keys by `(layer, row, col)`, so a wrong mapping would remap the
wrong physical key. The Iris matrix is **10 rows × 6 cols** (from keebio's
`keyboard.json`):

- **Left half:** rows `0–3`, columns in display order (`0–5`).
- **Right half:** rows `5–8`, columns **reversed** (index finger → col `5`,
  pinky → col `0`).
- **Thumbs:** left row `4` cols `[5,4,3,2]`; right row `9` cols `[5,4,3,2]`,
  mapped inner→outer onto the four visual thumb keys.

These coordinates live in one place — `buildHalf()` in `KeyboardGrid.jsx` — so
they're trivial to adjust.

### Verify on hardware (one-time, ~1 minute)
The logical matrix is shared across the Iris family, so this is almost certainly
correct, but confirm before trusting it:
1. Open VIA (usevia.app) → **Key Tester → Test Matrix mode**, and press a few
   keys to confirm which `(row, col)` lights up — or
2. In this app, remap one obvious key (e.g. set the visual `A` to `B`), type it,
   and confirm the right key changed. If a thumb key maps to the wrong switch,
   reorder the `mc` values in `thumbCells` — that's the only place to touch.

## Build / setup

- `Cargo.toml` now enables `hidapi = "2.6"` (bundled backend; no system lib needed).
- **Windows:** raw-HID access needs no driver for VIA interfaces; the bundled
  backend works out of the box.
- The app polls `detect_devices` periodically (as before), so hot-plugging is
  picked up without the old custom event thread.

## Now obsolete (safe to delete)

- `iris_lm_keymap.c` — the custom firmware. Not needed; stock firmware is used.
- `src-tauri-hid-protocol.rs` — the bespoke protocol spec. Replaced by `via_protocol.rs`.
- `src-tauri-usb-handler.rs` — the stub handler. Replaced by `usb_handler.rs`.
- `src-tauri-main.rs` — replaced by `main.rs`.

`dfu_flasher.rs` is kept: it's still useful for the occasional firmware *update*,
which is separate from remapping.

## Files in this delivery
- `Cargo.toml`, `main.rs`, `via_protocol.rs`, `usb_handler.rs` — the VIA backend.
- `KeyboardGrid.jsx` — corrected matrix coordinates for VIA.
