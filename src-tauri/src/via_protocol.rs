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
