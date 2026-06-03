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

/// Keebio's USB vendor ID (used only as a soft preference, not a hard filter).
pub const KEEBIO_VID: u16 = 0x3434;

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
    pub const EEPROM_RESET: u8 = 0x0A;
    pub const BOOTLOADER_JUMP: u8 = 0x0B;
    pub const DYNAMIC_KEYMAP_GET_LAYER_COUNT: u8 = 0x11;
    pub const DYNAMIC_KEYMAP_GET_BUFFER: u8 = 0x12;
    pub const DYNAMIC_KEYMAP_SET_BUFFER: u8 = 0x13;
}

// Sub-command IDs for GET_KEYBOARD_VALUE / SET_KEYBOARD_VALUE (via.h keyboard_value_id).
pub mod keyboard_value {
    pub const SWITCH_MATRIX_STATE: u8 = 0x03;
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
