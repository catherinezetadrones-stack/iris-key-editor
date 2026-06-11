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

use crate::via_protocol::{cmd, keyboard_value, vial, vialrgb, key_offset, COMMAND_TIMEOUT_MS, DFU_PID,
                          DFU_VID, KEEBIO_VID, LAYER_BYTES, MATRIX_COLS, MATRIX_ROWS,
                          RAW_USAGE, RAW_USAGE_PAGE, REPORT_LEN};
use crate::DeviceInfo;

/// VIALRGB lighting state: effect (VIALRGB effect ID), speed, hue, sat, val (all 0–255).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VialRGBState {
    pub effect: u16,
    pub speed:  u8,
    pub hue:    u8,
    pub sat:    u8,
    pub val:    u8,
}

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
        const SCAN_ROWS: usize = MATRIX_ROWS as usize;
        let mut state = vec![vec![false; cols]; SCAN_ROWS];
        // QMK via.c packs one full byte per row (ceil(MATRIX_COLS/8) bytes, LSB = col 0).
        // For MATRIX_COLS <= 8: r[2+row] = row's column bitmask, bit c = col c.
        // Response layout: r[0]=cmd echo, r[1]=sub-cmd echo, r[2..]=row bytes.
        let bytes_per_row = (cols + 7) / 8;
        for row in 0..SCAN_ROWS {
            for col in 0..cols {
                let byte_idx = 2 + row * bytes_per_row + col / 8;
                let bit_pos  = col % 8;
                if byte_idx < REPORT_LEN {
                    state[row][col] = (r[byte_idx] >> bit_pos) & 1 == 1;
                }
            }
        }
        Ok(state)
    }

    /// Write a whole layer using the bulk SET_BUFFER command.
    /// `keycodes` must be MATRIX_ROWS × MATRIX_COLS; mismatched sizes are rejected.
    pub fn write_layer_buffer(&self, layer: u8, keycodes: &[Vec<u16>]) -> Result<(), String> {
        let expected_rows = MATRIX_ROWS as usize;
        let expected_cols = MATRIX_COLS as usize;
        if keycodes.len() != expected_rows || keycodes.iter().any(|r| r.len() != expected_cols) {
            return Err(format!(
                "write_layer_buffer: expected {}×{} grid, got {}×{}",
                expected_rows, expected_cols,
                keycodes.len(), keycodes.first().map_or(0, |r| r.len())
            ));
        }

        // Serialize to big-endian bytes.
        let mut bytes = Vec::with_capacity(LAYER_BYTES);
        for row in keycodes {
            for &kc in row {
                bytes.push((kc >> 8) as u8);
                bytes.push((kc & 0xFF) as u8);
            }
        }

        let start = (layer as usize) * LAYER_BYTES;
        const CHUNK: usize = REPORT_LEN - 4; // 28 bytes of data per HID packet
        let mut written = 0usize;
        while written < LAYER_BYTES {
            let offset = (start + written) as u16;
            let size = CHUNK.min(LAYER_BYTES - written);
            let mut payload = vec![
                cmd::DYNAMIC_KEYMAP_SET_BUFFER,
                (offset >> 8) as u8,
                (offset & 0xFF) as u8,
                size as u8,
            ];
            payload.extend_from_slice(&bytes[written..written + size]);
            self.command(&payload)?;
            written += size;
        }
        Ok(())
    }

    // ── Macro buffer ────────────────────────────────────────────────────────────
    // VIA macro format: flat EEPROM buffer divided into N null-terminated (0x00)
    // sequences. Special actions use the SS_QMK_PREFIX (0x01) escape byte:
    //   0x01 0x01 <hid-code>        = tap key
    //   0x01 0x02 <hid-code>        = key down
    //   0x01 0x03 <hid-code>        = key up
    //   0x01 0x04 <digits> 0x7C     = delay (ASCII ms digits, terminated by '|')
    // Any other byte is an ASCII character sent as a keystroke.

    pub fn get_macro_count(&self) -> Result<u8, String> {
        let r = self.command(&[cmd::MACRO_GET_COUNT])?;
        Ok(r[1])
    }

    pub fn get_macro_buffer_size(&self) -> Result<u16, String> {
        let r = self.command(&[cmd::MACRO_GET_BUFFER_SIZE])?;
        Ok(((r[1] as u16) << 8) | r[2] as u16)
    }

    /// Read the raw macro buffer in bulk.
    pub fn read_macro_buffer(&self, total_size: usize) -> Result<Vec<u8>, String> {
        let mut bytes = Vec::with_capacity(total_size);
        const CHUNK: usize = REPORT_LEN - 4;
        let mut read = 0usize;
        while read < total_size {
            let offset = read as u16;
            let size = CHUNK.min(total_size - read);
            let r = self.command(&[
                cmd::MACRO_GET_BUFFER,
                (offset >> 8) as u8,
                (offset & 0xFF) as u8,
                size as u8,
            ])?;
            bytes.extend_from_slice(&r[4..4 + size]);
            read += size;
        }
        Ok(bytes)
    }

    /// Write the raw macro buffer in bulk (always starts at offset 0).
    pub fn write_macro_buffer(&self, data: &[u8]) -> Result<(), String> {
        const CHUNK: usize = REPORT_LEN - 4;
        let mut written = 0usize;
        while written < data.len() {
            let offset = written as u16;
            let size = CHUNK.min(data.len() - written);
            let mut payload = vec![
                cmd::MACRO_SET_BUFFER,
                (offset >> 8) as u8,
                (offset & 0xFF) as u8,
                size as u8,
            ];
            payload.extend_from_slice(&data[written..written + size]);
            self.command(&payload)?;
            written += size;
        }
        Ok(())
    }

    // ── VIAL protocol extension ─────────────────────────────────────────────────
    // VIAL overlays an 0xFE-prefixed command namespace on top of VIA.  Unlike VIA,
    // VIAL firmware overwrites the packet from byte 0 in the response (no command
    // echo), so response data starts at resp[0].

    fn vial_cmd(&self, sub_cmd: u8, extra: &[u8]) -> Result<[u8; REPORT_LEN], String> {
        let mut payload = vec![vial::PREFIX, sub_cmd];
        payload.extend_from_slice(extra);
        self.command(&payload)
    }

    /// Returns the 8-byte keyboard UID if the firmware speaks VIAL, None otherwise.
    /// VIA-only keyboards return zeros for the UID region.
    pub fn detect_vial(&self) -> Result<Option<[u8; 8]>, String> {
        let r = self.vial_cmd(vial::GET_KEYBOARD_ID, &[])?;
        // resp[0..3] = VIAL protocol version (u32 LE); resp[4..11] = 8-byte UID
        let uid: [u8; 8] = r[4..12].try_into().map_err(|_| "UID slice error")?;
        Ok(if uid == [0u8; 8] { None } else { Some(uid) })
    }

    /// Returns (is_unlocked, unlock_in_progress, unlock_combo_keys[(row,col)]).
    /// Combo keys are the physical positions the user must hold to unlock VIAL.
    pub fn vial_unlock_status(&self) -> Result<(bool, bool, Vec<(u8, u8)>), String> {
        let r = self.vial_cmd(vial::GET_UNLOCK_STATUS, &[])?;
        // Firmware memsets packet to 0xFF then writes: [unlocked, in_progress, row0, col0, ...]
        let unlocked    = r[0] != 0;
        let in_progress = r[1] != 0;
        let mut keys = Vec::new();
        let mut i = 2usize;
        while i + 1 < REPORT_LEN {
            if r[i] == 0xFF { break; }
            keys.push((r[i], r[i + 1]));
            i += 2;
        }
        Ok((unlocked, in_progress, keys))
    }

    pub fn vial_unlock_start(&self) -> Result<(), String> {
        self.vial_cmd(vial::UNLOCK_START, &[])?;
        Ok(())
    }

    /// Poll unlock progress while user holds the unlock key combo.
    /// Returns (is_unlocked, in_progress, countdown) — countdown starts at 50, hits 0 when done.
    pub fn vial_unlock_poll(&self) -> Result<(bool, bool, u8), String> {
        let r = self.vial_cmd(vial::UNLOCK_POLL, &[])?;
        Ok((r[0] != 0, r[1] != 0, r[2]))
    }

    pub fn vial_lock(&self) -> Result<(), String> {
        self.vial_cmd(vial::LOCK, &[])?;
        Ok(())
    }

    /// Returns (tap_dance_count, combo_count, key_override_count).
    pub fn vial_get_entry_counts(&self) -> Result<(u8, u8, u8), String> {
        let r = self.vial_cmd(vial::DYNAMIC_ENTRY_OP, &[vial::DYNAMIC_GET_ENTRIES, 0])?;
        Ok((r[0], r[1], r[2]))
    }

    /// Returns [on_tap, on_hold, on_double_tap, on_tap_hold, tapping_term_ms] as u16 LE values.
    pub fn vial_get_tap_dance(&self, idx: u8) -> Result<[u16; 5], String> {
        let r = self.vial_cmd(vial::DYNAMIC_ENTRY_OP, &[vial::DYNAMIC_TD_GET, idx])?;
        // resp[0]=status, resp[1..10]=entry (5 × u16 LE)
        Ok([
            u16::from_le_bytes([r[1], r[2]]),   // on_tap
            u16::from_le_bytes([r[3], r[4]]),   // on_hold
            u16::from_le_bytes([r[5], r[6]]),   // on_double_tap
            u16::from_le_bytes([r[7], r[8]]),   // on_tap_hold
            u16::from_le_bytes([r[9], r[10]]),  // tapping_term_ms (0 = use global)
        ])
    }

    /// entry = [on_tap, on_hold, on_double_tap, on_tap_hold, tapping_term_ms].
    pub fn vial_set_tap_dance(&self, idx: u8, entry: [u16; 5]) -> Result<(), String> {
        let mut data = vec![vial::DYNAMIC_TD_SET, idx];
        for v in entry {
            data.extend_from_slice(&v.to_le_bytes());
        }
        self.vial_cmd(vial::DYNAMIC_ENTRY_OP, &data)?;
        Ok(())
    }

    /// Returns (input_keys[4], output_keycode).  Unused input slots are 0x0000.
    pub fn vial_get_combo(&self, idx: u8) -> Result<([u16; 4], u16), String> {
        let r = self.vial_cmd(vial::DYNAMIC_ENTRY_OP, &[vial::DYNAMIC_COMBO_GET, idx])?;
        // resp[0]=status, resp[1..10]=entry (4 input u16 LE + 1 output u16 LE)
        let keys = [
            u16::from_le_bytes([r[1], r[2]]),
            u16::from_le_bytes([r[3], r[4]]),
            u16::from_le_bytes([r[5], r[6]]),
            u16::from_le_bytes([r[7], r[8]]),
        ];
        let output = u16::from_le_bytes([r[9], r[10]]);
        Ok((keys, output))
    }

    pub fn vial_set_combo(&self, idx: u8, keys: [u16; 4], output: u16) -> Result<(), String> {
        let mut data = vec![vial::DYNAMIC_COMBO_SET, idx];
        for k in keys {
            data.extend_from_slice(&k.to_le_bytes());
        }
        data.extend_from_slice(&output.to_le_bytes());
        self.vial_cmd(vial::DYNAMIC_ENTRY_OP, &data)?;
        Ok(())
    }

    /// Get a QMK setting value (uint16). Returns Err if the setting isn't supported.
    pub fn vial_qmk_settings_get_u16(&self, setting_id: u16) -> Result<u16, String> {
        let r = self.vial_cmd(vial::QMK_SETTINGS_GET, &[
            (setting_id & 0xFF) as u8,
            (setting_id >> 8) as u8,
        ])?;
        if r[0] == 0xFF && r[1] == 0xFF {
            return Err(format!("QMK setting {setting_id} not supported"));
        }
        Ok(u16::from_le_bytes([r[0], r[1]]))
    }

    /// Set a QMK setting value (uint16).
    pub fn vial_qmk_settings_set_u16(&self, setting_id: u16, value: u16) -> Result<(), String> {
        self.vial_cmd(vial::QMK_SETTINGS_SET, &[
            (setting_id & 0xFF) as u8,
            (setting_id >> 8) as u8,
            (value & 0xFF) as u8,
            (value >> 8) as u8,
        ])?;
        Ok(())
    }

    /// Ask the keyboard to reboot into its bootloader (for firmware flashing).
    /// Remapping never needs this — it's only for firmware updates.
    ///
    /// Ok(()) only means the command was sent. VIAL_INSECURE firmware compiles out
    /// VIA's id_bootloader_jump handler, so unless the keymap overrides
    /// raw_hid_receive_kb to handle 0x0B (ours does, since 2026-06), the board just
    /// echoes the report back — byte-identical to the handled case, so the response
    /// can't tell us whether a reboot is coming. The only reliable confirmation is
    /// polling check_dfu_device afterwards, which is what the frontend does.
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

    // ── VIALRGB lighting ──────────────────────────────────────────────────────
    //
    // The Iris-LM firmware uses VIALRGB_ENABLE (quantum/vialrgb.c).  Lighting
    // control goes through VIA commands 0x07/0x08 with VIALRGB sub-commands at
    // data[1]; data[2..] carry the arguments.
    //
    // One packet atomically reads or writes: effect (u16 LE) + speed + hue + sat + val.

    /// Read current VIALRGB state from the keyboard.
    pub fn get_lighting(&self) -> Result<VialRGBState, String> {
        let mut payload = [0u8; REPORT_LEN];
        payload[0] = cmd::LIGHTING_GET_VALUE;
        payload[1] = vialrgb::GET_MODE;
        let r = self.command(&payload)?;
        Ok(VialRGBState {
            effect: (r[2] as u16) | ((r[3] as u16) << 8),
            speed:  r[4],
            hue:    r[5],
            sat:    r[6],
            val:    r[7],
        })
    }

    /// Apply a VIALRGB state (does not persist to EEPROM — call save_lighting after).
    pub fn set_lighting(&self, s: &VialRGBState) -> Result<(), String> {
        let mut payload = [0u8; REPORT_LEN];
        payload[0] = cmd::LIGHTING_SET_VALUE;
        payload[1] = vialrgb::SET_MODE;
        payload[2] = (s.effect & 0xFF) as u8;
        payload[3] = (s.effect >> 8) as u8;
        payload[4] = s.speed;
        payload[5] = s.hue;
        payload[6] = s.sat;
        payload[7] = s.val;
        self.command(&payload)?;
        Ok(())
    }

    /// Flush current VIALRGB state to EEPROM.
    pub fn save_lighting(&self) -> Result<(), String> {
        let mut payload = [0u8; REPORT_LEN];
        payload[0] = cmd::LIGHTING_SAVE;
        self.command(&payload)?;
        Ok(())
    }

    /// Set individual key colors in VIALRGB Direct mode.
    /// `leds` is a slice of (led_index, hue, sat, val) up to 9 per call.
    pub fn set_led_colors(&self, first_index: u16, colors: &[(u8, u8, u8)]) -> Result<(), String> {
        let mut payload = [0u8; REPORT_LEN];
        payload[0] = cmd::LIGHTING_SET_VALUE;
        payload[1] = vialrgb::FASTSET;
        payload[2] = (first_index & 0xFF) as u8;
        payload[3] = (first_index >> 8) as u8;
        payload[4] = colors.len().min(9) as u8;
        for (i, &(h, s, v)) in colors.iter().take(9).enumerate() {
            payload[5 + i * 3]     = h;
            payload[5 + i * 3 + 1] = s;
            payload[5 + i * 3 + 2] = v;
        }
        self.command(&payload)?;
        Ok(())
    }
}

/// Enumerate connected VIA keyboards (does not keep them open).
/// Deduplicates by VID:PID so a multi-interface keyboard only appears once.
pub fn scan_devices() -> Result<Vec<DeviceInfo>, String> {
    let api = HidApi::new().map_err(|e| format!("Failed to init HID: {e}"))?;

    let mut found: Vec<DeviceInfo> = Vec::new();

    let already = |found: &Vec<DeviceInfo>, port: &str| {
        found.iter().any(|d| d.port == port)
    };

    for d in api.device_list() {
        let is_via    = d.usage_page() == RAW_USAGE_PAGE && d.usage() == RAW_USAGE;
        let is_keebio = d.vendor_id() == KEEBIO_VID;
        let is_dfu    = d.vendor_id() == DFU_VID && d.product_id() == DFU_PID;
        let port      = format!("{:04x}:{:04x}", d.vendor_id(), d.product_id());

        if already(&found, &port) { continue; }

        if is_via || is_dfu {
            found.push(DeviceInfo {
                name: d.product_string()
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| if is_dfu { "STM32 DFU".into() } else { "Iris-LM".into() }),
                port,
                connected: !is_dfu,
                firmware_version: None,
                layout: if is_dfu { None } else { Some("Iris-LM 4x6 + thumbs".into()) },
                num_layers: 0,
            });
        } else if is_keebio {
            found.push(DeviceInfo {
                name: d.product_string().map(|s| s.to_string()).unwrap_or_else(|| "Iris-LM".into()),
                port,
                connected: true,
                firmware_version: None,
                layout: Some("Iris-LM 4x6 + thumbs".into()),
                num_layers: 0,
            });
        }
    }
    Ok(found)
}
