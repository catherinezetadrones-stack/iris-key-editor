// via_protocol.rs
//
// Talks the stock VIA protocol that already ships on the Iris-LM. No custom
// firmware, no reflash: remapping goes through VIA's raw-HID command set and is
// saved to EEPROM by the firmware itself.
//
// Command IDs and semantics are from QMK's quantum/via.h (VIA protocol v9+).
// All raw-HID reports are exactly 32 bytes in both directions.

#![allow(dead_code)]

// Raw-HID transport ---------------------------------------------------------

/// VIA/QMK raw-HID reports are always this size.
pub const REPORT_LEN: usize = 32;

/// QMK raw-HID interface is identified by this HID usage page + usage,
/// regardless of VID/PID. This is how we find the right interface.
pub const RAW_USAGE_PAGE: u16 = 0xFF60;
pub const RAW_USAGE: u16 = 0x61;

/// Keebio's USB vendor ID (0xCB10 per Iris-LM info.json in vial-kb/vial-qmk).
/// Used only as a soft fallback when HID usage-page info isn't populated.
pub const KEEBIO_VID: u16 = 0xCB10;

/// STM32 DFU bootloader identifiers (Iris-LM uses an STM32G431).
pub const DFU_VID: u16 = 0x0483;
pub const DFU_PID: u16 = 0xDF11;

pub const COMMAND_TIMEOUT_MS: i32 = 1000;

// VIA command IDs (quantum/via.h) -------------------------------------------

pub mod cmd {
    pub const GET_PROTOCOL_VERSION: u8 = 0x01;
    pub const GET_KEYBOARD_VALUE: u8 = 0x02;
    pub const SET_KEYBOARD_VALUE: u8 = 0x03;
    pub const DYNAMIC_KEYMAP_GET_KEYCODE: u8 = 0x04;
    pub const DYNAMIC_KEYMAP_SET_KEYCODE: u8 = 0x05;
    pub const DYNAMIC_KEYMAP_RESET: u8 = 0x06;
    pub const LIGHTING_SET_VALUE: u8 = 0x07;
    pub const LIGHTING_GET_VALUE: u8 = 0x08;
    pub const LIGHTING_SAVE: u8 = 0x09;
    pub const EEPROM_RESET: u8 = 0x0A;
    pub const BOOTLOADER_JUMP: u8 = 0x0B;
    // Macro buffer commands (VIA protocol, quantum/via.h id_macro_*)
    pub const MACRO_GET_COUNT: u8 = 0x0C;
    pub const MACRO_GET_BUFFER_SIZE: u8 = 0x0D;
    pub const MACRO_GET_BUFFER: u8 = 0x0E;
    pub const MACRO_SET_BUFFER: u8 = 0x0F;
    pub const MACRO_RESET: u8 = 0x10;
    pub const DYNAMIC_KEYMAP_GET_LAYER_COUNT: u8 = 0x11;
    pub const DYNAMIC_KEYMAP_GET_BUFFER: u8 = 0x12;
    pub const DYNAMIC_KEYMAP_SET_BUFFER: u8 = 0x13;
    // Custom command handled by this keyboard's raw_hid_receive_kb (keymap.c):
    // response r[1] == 0xA5 marker + r[2] = get_highest_layer(layer_state).
    // Old firmware echoes the request unchanged (r[1] stays 0x00).
    pub const GET_ACTIVE_LAYER: u8 = 0x59;
}

// VIALRGB extension — RGB Matrix control via VIA lighting commands (0x07/0x08).
//
// The Iris-LM firmware uses VIALRGB_ENABLE (vialrgb.c). Lighting get/set goes
// through VIA cmd 0x08/0x07 with VIALRGB sub-commands at data[1].
//
// Packet layout:
//   Get mode: [0x08, GET_MODE, 0..] → resp [_, _, mode_lo, mode_hi, speed, hue, sat, val]
//   Set mode: [0x07, SET_MODE, mode_lo, mode_hi, speed, hue, sat, val, ...]
//   Save:     [0x09, 0..] → flushes to EEPROM
//
// Source: quantum/vialrgb.h, quantum/vialrgb.c, quantum/vialrgb_effects.inc
pub mod vialrgb {
    // Sub-commands for LIGHTING_GET_VALUE (data[1])
    pub const GET_INFO:      u8 = 0x40; // resp: [_, _, version_lo, version_hi, max_brightness]
    pub const GET_MODE:      u8 = 0x41; // resp: [_, _, mode_lo, mode_hi, speed, hue, sat, val]
    pub const GET_SUPPORTED: u8 = 0x42; // resp: packed u16 list of supported effect IDs > gt

    // Sub-commands for LIGHTING_SET_VALUE (data[1])
    pub const SET_MODE:  u8 = 0x41; // [mode_lo, mode_hi, speed, hue, sat, val] at data[2..]
    pub const FASTSET:   u8 = 0x42; // direct per-key: [idx_lo, idx_hi, count, h, s, v, ...]

    // VIALRGB effect IDs (vialrgb_effects.inc, stable / never reordered).
    // 0 = off; IDs match what firmware reports in GET_MODE / expects in SET_MODE.
    pub const EFFECT_OFF:                    u16 = 0;
    pub const EFFECT_DIRECT:                 u16 = 1;
    pub const EFFECT_SOLID_COLOR:            u16 = 2;
    pub const EFFECT_ALPHAS_MODS:            u16 = 3;
    pub const EFFECT_GRADIENT_UP_DOWN:       u16 = 4;
    pub const EFFECT_GRADIENT_LEFT_RIGHT:    u16 = 5;
    pub const EFFECT_BREATHING:              u16 = 6;
    pub const EFFECT_BAND_SAT:               u16 = 7;
    pub const EFFECT_BAND_VAL:               u16 = 8;
    pub const EFFECT_BAND_PINWHEEL_SAT:      u16 = 9;
    pub const EFFECT_BAND_PINWHEEL_VAL:      u16 = 10;
    pub const EFFECT_BAND_SPIRAL_SAT:        u16 = 11;
    pub const EFFECT_BAND_SPIRAL_VAL:        u16 = 12;
    pub const EFFECT_CYCLE_ALL:              u16 = 13;
    pub const EFFECT_CYCLE_LEFT_RIGHT:       u16 = 14;
    pub const EFFECT_CYCLE_UP_DOWN:          u16 = 15;
    pub const EFFECT_RAINBOW_CHEVRON:        u16 = 16;
    pub const EFFECT_CYCLE_OUT_IN:           u16 = 17;
    pub const EFFECT_CYCLE_OUT_IN_DUAL:      u16 = 18;
    pub const EFFECT_CYCLE_PINWHEEL:         u16 = 19;
    pub const EFFECT_CYCLE_SPIRAL:           u16 = 20;
    pub const EFFECT_DUAL_BEACON:            u16 = 21;
    pub const EFFECT_RAINBOW_BEACON:         u16 = 22;
    pub const EFFECT_RAINBOW_PINWHEELS:      u16 = 23;
    pub const EFFECT_RAINDROPS:              u16 = 24;
    pub const EFFECT_JELLYBEAN_RAINDROPS:    u16 = 25;
    pub const EFFECT_HUE_BREATHING:          u16 = 26;
    pub const EFFECT_HUE_PENDULUM:           u16 = 27;
    pub const EFFECT_HUE_WAVE:              u16 = 28;
    pub const EFFECT_TYPING_HEATMAP:         u16 = 29;
    pub const EFFECT_DIGITAL_RAIN:           u16 = 30;
    pub const EFFECT_SOLID_REACTIVE_SIMPLE:  u16 = 31;
    pub const EFFECT_SOLID_REACTIVE:         u16 = 32;
    pub const EFFECT_SOLID_REACTIVE_WIDE:    u16 = 33;
    pub const EFFECT_SOLID_REACTIVE_MULTIWIDE: u16 = 34;
    pub const EFFECT_SOLID_REACTIVE_CROSS:   u16 = 35;
    pub const EFFECT_SOLID_REACTIVE_MULTICROSS: u16 = 36;
    pub const EFFECT_SOLID_REACTIVE_NEXUS:   u16 = 37;
    pub const EFFECT_SOLID_REACTIVE_MULTINEXUS: u16 = 38;
    pub const EFFECT_SPLASH:                 u16 = 39;
    pub const EFFECT_MULTISPLASH:            u16 = 40;
    pub const EFFECT_SOLID_SPLASH:           u16 = 41;
    pub const EFFECT_SOLID_MULTISPLASH:      u16 = 42;
    pub const EFFECT_PIXEL_RAIN:             u16 = 43;
    pub const EFFECT_PIXEL_FRACTAL:          u16 = 44;
}

// Sub-command IDs for GET_KEYBOARD_VALUE / SET_KEYBOARD_VALUE (via.h keyboard_value_id).
pub mod keyboard_value {
    pub const SWITCH_MATRIX_STATE: u8 = 0x03;
}

// VIAL protocol extension (vial-kb/vial-qmk, quantum/vial.h + quantum/vial.c).
//
// VIAL packets start with PREFIX (0xFE) at byte 0 and a sub-command at byte 1.
// Unlike VIA (which echoes the command byte at response byte 0), VIAL firmware
// OVERWRITES the packet from byte 0 when writing the response, so caller code
// must not assume any echo — read response data starting at resp[0].
pub mod vial {
    pub const PREFIX: u8 = 0xFE;

    // Top-level sub-commands (msg[1]).
    pub const GET_KEYBOARD_ID:    u8 = 0x00; // resp[0..3]=version, resp[4..11]=UID
    pub const GET_UNLOCK_STATUS:  u8 = 0x05;
    pub const UNLOCK_START:       u8 = 0x06;
    pub const UNLOCK_POLL:        u8 = 0x07;
    pub const LOCK:               u8 = 0x08;
    pub const QMK_SETTINGS_QUERY: u8 = 0x09;
    pub const QMK_SETTINGS_GET:   u8 = 0x0A; // id at msg[2..3] (LE); value at resp[0..]
    pub const QMK_SETTINGS_SET:   u8 = 0x0B; // id at msg[2..3]; value at msg[4..]
    pub const DYNAMIC_ENTRY_OP:   u8 = 0x0D; // sub-op at msg[2], index at msg[3]

    // Sub-ops for DYNAMIC_ENTRY_OP (msg[2]).
    pub const DYNAMIC_GET_ENTRIES: u8 = 0x00; // resp[0]=TD, resp[1]=combo, resp[2]=KO counts
    pub const DYNAMIC_TD_GET:      u8 = 0x01; // resp[0]=status, resp[1..10]=entry (5×u16 LE)
    pub const DYNAMIC_TD_SET:      u8 = 0x02; // msg[4..13]=entry (5×u16 LE); resp[0]=status
    pub const DYNAMIC_COMBO_GET:   u8 = 0x03; // resp[0]=status, resp[1..10]=entry (5×u16 LE)
    pub const DYNAMIC_COMBO_SET:   u8 = 0x04; // msg[4..13]=entry; resp[0]=status

    // Well-known QMK setting IDs (qmk_settings.h).  All are uint16 unless noted.
    pub const QS_COMBO_TERM:    u16 = 2;
    pub const QS_TAPPING_TERM:  u16 = 7;
    pub const QS_QUICK_TAP_TERM: u16 = 25;
}

// Iris-LM matrix shape ------------------------------------------------------
//
// The Iris family (incl. the LM) is a split 4x6 + 4 thumb keys per half, wired
// as a single logical matrix of 10 rows x 6 cols. Left half = rows 0-4, right
// half = rows 5-9. Source: keebio Iris keyboard.json `layout` matrix entries.
//
// NOTE: the MCU/bootloader differs between Iris revisions, but the logical key
// matrix is shared across the family. If a remap ever lands on the wrong key,
// confirm positions with VIA's Key Tester (Test Matrix mode) and adjust the
// table in KeyboardGrid.jsx — these two values rarely change.

pub const MATRIX_ROWS: u8 = 10;
pub const MATRIX_COLS: u8 = 6;

/// Bytes per layer in the dynamic-keymap buffer (2 bytes per key, big-endian).
pub const LAYER_BYTES: usize = (MATRIX_ROWS as usize) * (MATRIX_COLS as usize) * 2;

/// Byte offset of one key within the dynamic-keymap buffer.
pub fn key_offset(layer: u8, row: u8, col: u8) -> u16 {
    let per_layer = (MATRIX_ROWS as usize) * (MATRIX_COLS as usize);
    let idx = (layer as usize) * per_layer + (row as usize) * (MATRIX_COLS as usize) + (col as usize);
    (idx * 2) as u16
}
