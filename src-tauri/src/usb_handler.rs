// usb_handler.rs
//
// Device discovery and communication using the stock VIA protocol over raw HID.
// Nothing here requires custom firmware — it drives the VIA support the Iris-LM
// already ships with, and writes are persisted to EEPROM by the firmware.
//
// Cross-platform notes:
//   * The VIA interface is found by HID usage page (0xFF60) + usage (0x61),
//     which is reliable on Windows and macOS. On Linux, recent hidapi (hidraw
//     backend) also reports usage info; if it doesn't, we fall back to the
//     Keebio VID.
//   * QMK raw HID uses report ID 0. hidapi's `write` expects the report ID as
//     the first byte, so every write is REPORT_LEN + 1 bytes with a leading 0.

use hidapi::{HidApi, HidDevice};

use crate::via_protocol::{cmd, keyboard_value, key_offset, COMMAND_TIMEOUT_MS, DFU_PID, DFU_VID,
                          KEEBIO_VID, LAYER_BYTES, MATRIX_COLS, MATRIX_ROWS, RAW_USAGE,
                          RAW_USAGE_PAGE, REPORT_LEN};
use crate::DeviceInfo;

/// An opened VIA keyboard ready for commands.
pub struct ViaKeyboard {
    device: HidDevice,
}

impl ViaKeyboard {
    /// Open the first connected VIA raw-HID interface.
    pub fn open() -> Result<Self, String> {
        let api = HidApi::new().map_err(|e| format!("Failed to init HID: {e}"))?;

        // Prefer a true VIA interface (usage page + usage). Fall back to the
        // Keebio VID if usage info isn't populated on this platform.
        let info = api
            .device_list()
            .find(|d| d.usage_page() == RAW_USAGE_PAGE && d.usage() == RAW_USAGE)
            .or_else(|| api.device_list().find(|d| d.vendor_id() == KEEBIO_VID))
            .ok_or_else(|| "No VIA keyboard found".to_string())?;

        let device = info
            .open_device(&api)
            .map_err(|e| format!("Failed to open device: {e}"))?;

        Ok(Self { device })
    }

    /// Send a 32-byte VIA command and return the 32-byte response.
    /// VIA echoes the request buffer back with any requested data filled in.
    fn command(&self, payload: &[u8]) -> Result<[u8; REPORT_LEN], String> {
        // Leading 0x00 is the HID report ID expected by hidapi's write().
        let mut report = [0u8; REPORT_LEN + 1];
        for (i, b) in payload.iter().take(REPORT_LEN).enumerate() {
            report[i + 1] = *b;
        }
        self.device
            .write(&report)
            .map_err(|e| format!("HID write failed: {e}"))?;

        let mut buf = [0u8; REPORT_LEN];
        let n = self
            .device
            .read_timeout(&mut buf, COMMAND_TIMEOUT_MS)
            .map_err(|e| format!("HID read failed: {e}"))?;
        if n == 0 {
            return Err("No response from keyboard (timeout)".into());
        }
        Ok(buf)
    }

    /// VIA protocol version (sanity check that we're talking to VIA firmware).
    pub fn protocol_version(&self) -> Result<u16, String> {
        let r = self.command(&[cmd::GET_PROTOCOL_VERSION])?;
        Ok(((r[1] as u16) << 8) | r[2] as u16)
    }

    /// Number of dynamic-keymap layers the firmware exposes.
    pub fn layer_count(&self) -> Result<u8, String> {
        let r = self.command(&[cmd::DYNAMIC_KEYMAP_GET_LAYER_COUNT])?;
        Ok(r[1])
    }

    /// Read a single keycode at (layer, row, col).
    pub fn get_keycode(&self, layer: u8, row: u8, col: u8) -> Result<u16, String> {
        let r = self.command(&[cmd::DYNAMIC_KEYMAP_GET_KEYCODE, layer, row, col])?;
        // Response: [0x04, layer, row, col, kc_hi, kc_lo]
        Ok(((r[4] as u16) << 8) | r[5] as u16)
    }

    /// Write a single keycode at (layer, row, col). Persisted to EEPROM by the
    /// firmware — survives unplugging and works across machines.
    pub fn set_keycode(&self, layer: u8, row: u8, col: u8, keycode: u16) -> Result<(), String> {
        let _ = key_offset(layer, row, col); // offset math also used for buffer reads
        self.command(&[
            cmd::DYNAMIC_KEYMAP_SET_KEYCODE,
            layer,
            row,
            col,
            (keycode >> 8) as u8,
            (keycode & 0xFF) as u8,
        ])?;
        Ok(())
    }

    /// Read a whole layer (MATRIX_ROWS x MATRIX_COLS) using the bulk buffer
    /// command, which is far faster than per-key reads.
    pub fn read_layer(&self, layer: u8) -> Result<Vec<Vec<u16>>, String> {
        let start = (layer as usize) * LAYER_BYTES;
        let mut bytes = Vec::with_capacity(LAYER_BYTES);

        // Each GET_BUFFER call carries up to (REPORT_LEN - 4) payload bytes.
        const CHUNK: usize = REPORT_LEN - 4;
        let mut read = 0usize;
        while read < LAYER_BYTES {
            let offset = (start + read) as u16;
            let size = CHUNK.min(LAYER_BYTES - read);
            let r = self.command(&[
                cmd::DYNAMIC_KEYMAP_GET_BUFFER,
                (offset >> 8) as u8,
                (offset & 0xFF) as u8,
                size as u8,
            ])?;
            // Response: [0x12, off_hi, off_lo, size, ...data]
            bytes.extend_from_slice(&r[4..4 + size]);
            read += size;
        }

        // Parse big-endian u16 keycodes into a rows x cols grid.
        let cols = MATRIX_COLS as usize;
        let rows = MATRIX_ROWS as usize;
        let mut grid = vec![vec![0u16; cols]; rows];
        for row in 0..rows {
            for col in 0..cols {
                let i = (row * cols + col) * 2;
                grid[row][col] = ((bytes[i] as u16) << 8) | bytes[i + 1] as u16;
            }
        }
        Ok(grid)
    }

    /// Read the live switch matrix state via GET_KEYBOARD_VALUE(id_switch_matrix_state).
    /// Returns a rows×cols grid; true means the physical key is currently pressed.
    /// Bit packing follows QMK via.c: sequential (row*cols+col), LSB-first within each byte.
    ///
    /// We scan SCAN_ROWS instead of MATRIX_ROWS because split firmware variants
    /// can place the right-half keys at row indices above the declared MATRIX_ROWS
    /// (e.g. rows 10-15 in a nominal "10-row" matrix).  The extra rows are always
    /// zero if the firmware didn't write them, so there are no false positives.
    pub fn get_matrix_state(&self) -> Result<Vec<Vec<bool>>, String> {
        let r    = self.command(&[cmd::GET_KEYBOARD_VALUE, keyboard_value::SWITCH_MATRIX_STATE])?;
        let cols = MATRIX_COLS as usize;
        const SCAN_ROWS: usize = 16; // generous upper bound; unused rows read as 0
        let mut state = vec![vec![false; cols]; SCAN_ROWS];
        for row in 0..SCAN_ROWS {
            for col in 0..cols {
                let bit_idx  = row * cols + col;
                let byte_idx = 2 + bit_idx / 8; // response data starts at offset 2
                let bit_pos  = bit_idx % 8;
                if byte_idx < REPORT_LEN {
                    state[row][col] = (r[byte_idx] >> bit_pos) & 1 == 1;
                }
            }
        }
        Ok(state)
    }

    /// Ask the keyboard to reboot into its bootloader (for firmware flashing).
    /// Remapping never needs this — it's only for firmware updates.
    pub fn jump_bootloader(&self) -> Result<(), String> {
        // Device resets and won't reply; ignore the (expected) read timeout.
        let _ = self.command(&[cmd::BOOTLOADER_JUMP]);
        Ok(())
    }

    pub fn info(&self) -> Result<DeviceInfo, String> {
        let version = self.protocol_version().ok();
        let layers = self.layer_count().unwrap_or(0);
        Ok(DeviceInfo {
            name: "Iris-LM".to_string(),
            port: "raw-hid".to_string(),
            connected: true,
            firmware_version: version.map(|v| format!("VIA protocol {v}")),
            layout: Some("Iris-LM 4x6 + thumbs".to_string()),
            num_layers: layers,
        })
    }
}

/// Enumerate connected VIA keyboards (does not keep them open).
pub fn scan_devices() -> Result<Vec<DeviceInfo>, String> {
    let api = HidApi::new().map_err(|e| format!("Failed to init HID: {e}"))?;

    let mut found = Vec::new();
    for d in api.device_list() {
        let is_via = d.usage_page() == RAW_USAGE_PAGE && d.usage() == RAW_USAGE;
        let is_keebio = d.vendor_id() == KEEBIO_VID;
        let is_dfu = d.vendor_id() == DFU_VID && d.product_id() == DFU_PID;
        if is_via || is_dfu {
            found.push(DeviceInfo {
                name: d
                    .product_string()
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| if is_dfu { "STM32 DFU".into() } else { "Iris-LM".into() }),
                port: format!("{:04x}:{:04x}", d.vendor_id(), d.product_id()),
                connected: !is_dfu,
                firmware_version: None,
                layout: if is_dfu { None } else { Some("Iris-LM 4x6 + thumbs".into()) },
                num_layers: 0,
            });
        } else if is_keebio {
            // VID match without usage info (e.g. some Linux setups).
            found.push(DeviceInfo {
                name: d.product_string().map(|s| s.to_string()).unwrap_or_else(|| "Iris-LM".into()),
                port: format!("{:04x}:{:04x}", d.vendor_id(), d.product_id()),
                connected: true,
                firmware_version: None,
                layout: Some("Iris-LM 4x6 + thumbs".into()),
                num_layers: 0,
            });
        }
    }
    Ok(found)
}
