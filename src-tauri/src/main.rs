// main.rs - Iris-LM Editor (Tauri backend)
//
// The editor drives the keyboard's stock VIA support over raw HID. Remapping is
// live and persisted by the firmware's EEPROM — no custom firmware and no
// bootloader/flashing step is involved in everyday remapping.
//
// `flash_firmware` / `jump_bootloader` remain only for the occasional firmware
// *update* (via dfu-util); they are not part of the remapping flow.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod via_protocol;
mod usb_handler;
mod dfu_flasher;

use serde::{Deserialize, Serialize};
use tauri::api::dialog::blocking::FileDialogBuilder;
use usb_handler::{scan_devices, ViaKeyboard, VialRGBState};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceInfo {
    pub name: String,
    pub port: String,
    pub connected: bool,
    pub firmware_version: Option<String>,
    pub layout: Option<String>,
    pub num_layers: u8,
}

// --- Tauri commands --------------------------------------------------------

#[tauri::command]
fn detect_devices() -> Result<Vec<DeviceInfo>, String> {
    scan_devices()
}

#[tauri::command]
fn get_device_info() -> Result<DeviceInfo, String> {
    ViaKeyboard::open()?.info()
}

/// Returns the full MATRIX_ROWS x MATRIX_COLS keycode grid for a layer.
/// The frontend indexes it directly by each key's matrix (row, col).
#[tauri::command]
fn read_keymap(layer: u8) -> Result<Vec<Vec<u16>>, String> {
    ViaKeyboard::open()?.read_layer(layer)
}

#[tauri::command]
fn write_key(layer: u8, row: u8, col: u8, keycode: u16) -> Result<(), String> {
    ViaKeyboard::open()?.set_keycode(layer, row, col, keycode)
}

#[tauri::command]
fn get_layer_count() -> Result<u8, String> {
    ViaKeyboard::open()?.layer_count()
}

#[tauri::command]
fn jump_bootloader() -> Result<(), String> {
    ViaKeyboard::open()?.jump_bootloader()
}

/// Firmware *update* path only (not used for remapping). Wraps dfu-util.
#[tauri::command]
fn flash_firmware(firmware_path: String) -> Result<(), String> {
    dfu_flasher::flash_dfu(&firmware_path)
}

/// Open a native file-picker dialog filtered to .hex / .bin firmware files.
/// Returns the chosen path, or None if the dialog was cancelled.
#[tauri::command]
fn pick_firmware_file() -> Result<Option<String>, String> {
    let path = FileDialogBuilder::new()
        .set_title("Select Firmware File")
        .add_filter("Firmware", &["hex", "bin", "uf2"])
        .pick_file();
    Ok(path.map(|p| p.to_string_lossy().into_owned()))
}

/// Check whether a DFU bootloader device is visible on USB (0483:DF11).
#[tauri::command]
fn check_dfu_device() -> Result<bool, String> {
    dfu_flasher::detect_dfu_device()
}

/// Run `dfu-util -l` and return the combined stdout+stderr so the UI can show
/// exactly what the tool sees.  Returns an error string if dfu-util is missing.
#[tauri::command]
fn list_dfu_devices() -> Result<String, String> {
    use std::process::Command;
    let dfu = dfu_flasher::dfu_util_path();
    let output = Command::new(&dfu)
        .arg("-l")
        .output()
        .map_err(|_| format!(
            "dfu-util not found at '{}'. Drop dfu-util.exe into src-tauri/binaries/",
            dfu.display()
        ))?;
    let out = String::from_utf8_lossy(&output.stdout);
    let err = String::from_utf8_lossy(&output.stderr);
    Ok(format!("{}{}", out, err).trim().to_string())
}

/// Returns the live switch matrix state for the Key Test tab.
/// Rows × cols grid; true = key is currently pressed.
#[tauri::command]
fn get_matrix_state() -> Result<Vec<Vec<bool>>, String> {
    ViaKeyboard::open()?.get_matrix_state()
}

/// Write a full layer in bulk (much faster than per-key writes for copy/paste/import).
#[tauri::command]
fn write_layer(layer: u8, keymap: Vec<Vec<u16>>) -> Result<(), String> {
    ViaKeyboard::open()?.write_layer_buffer(layer, &keymap)
}

/// Read all layers at once (for export).
#[tauri::command]
fn read_all_layers() -> Result<Vec<Vec<Vec<u16>>>, String> {
    let kb = ViaKeyboard::open()?;
    let n = kb.layer_count()?;
    (0..n).map(|l| kb.read_layer(l)).collect()
}

// ── VIALRGB lighting ──────────────────────────────────────────────────────────

#[tauri::command]
fn get_lighting() -> Result<VialRGBState, String> {
    ViaKeyboard::open()?.get_lighting()
}

#[tauri::command]
fn set_lighting(state: VialRGBState) -> Result<(), String> {
    ViaKeyboard::open()?.set_lighting(&state)
}

#[tauri::command]
fn save_lighting() -> Result<(), String> {
    ViaKeyboard::open()?.save_lighting()
}

/// Set a single LED color via VIALRGB FASTSET. Keyboard must be in Direct mode (effect=1).
#[tauri::command]
fn fastset_led(led_index: u16, h: u8, s: u8, v: u8) -> Result<(), String> {
    ViaKeyboard::open()?.set_led_colors(led_index, &[(h, s, v)])
}

/// Apply per-key colors to all 68 LEDs via VIALRGB FASTSET (9 LEDs per packet).
/// `hsv_list` must be a flat list of [h, s, v] triples, one per LED index 0-67.
/// Switch to Direct mode (effect=1) before calling this.
#[tauri::command]
fn apply_led_colors(hsv_list: Vec<[u8; 3]>) -> Result<(), String> {
    let kb = ViaKeyboard::open()?;
    let total = hsv_list.len().min(68);
    let colors: Vec<(u8, u8, u8)> = hsv_list.iter()
        .take(total)
        .map(|c| (c[0], c[1], c[2]))
        .collect();
    let mut start = 0;
    while start < total {
        let end = (start + 9).min(total);
        kb.set_led_colors(start as u16, &colors[start..end])?;
        start = end;
    }
    Ok(())
}

// ── Profile file I/O ─────────────────────────────────────────────────────────
// A "profile" is a complete snapshot of the keyboard's EEPROM state:
// all layers, the full macro buffer, and per-layer lighting presets.

#[derive(Serialize, Deserialize)]
struct KeyboardProfile {
    version:  u32,
    keyboard: String,
    layers:   Vec<Vec<Vec<u16>>>,       // [layer][row][col] keycodes
    macros:   serde_json::Value,         // decoded action list per slot — human-readable
    #[serde(default, skip_serializing_if = "Option::is_none")]
    lighting:  Option<Vec<VialRGBState>>,  // one preset per layer; absent in older profiles
    #[serde(default, skip_serializing_if = "Option::is_none")]
    tap_dance: Option<Vec<TapDanceEntry>>, // all VIAL tap-dance slots; absent in older profiles
    #[serde(default, skip_serializing_if = "Option::is_none")]
    combos:    Option<Vec<ComboEntry>>,    // all VIAL combo slots; absent in older profiles
    #[serde(default, skip_serializing_if = "Option::is_none")]
    lighting_perkey:  Option<serde_json::Value>, // [layer][led] = [h,s,v] or null
    #[serde(default, skip_serializing_if = "Option::is_none")]
    scroll_settings:  Option<serde_json::Value>, // one entry per layer
}

#[tauri::command]
fn save_profile(profile: KeyboardProfile) -> Result<bool, String> {
    let path = FileDialogBuilder::new()
        .set_title("Save Iris Profile")
        .add_filter("Iris Profile", &["json"])
        .set_file_name("iris-profile.json")
        .save_file();
    match path {
        Some(p) => {
            let json = serde_json::to_string_pretty(&profile)
                .map_err(|e| format!("Serialize error: {e}"))?;
            std::fs::write(&p, json).map_err(|e| format!("Write error: {e}"))?;
            Ok(true)
        }
        None => Ok(false),
    }
}

#[tauri::command]
fn load_profile() -> Result<Option<KeyboardProfile>, String> {
    let path = FileDialogBuilder::new()
        .set_title("Load Iris Profile")
        .add_filter("Iris Profile", &["json"])
        .pick_file();
    match path {
        Some(p) => {
            let json = std::fs::read_to_string(&p)
                .map_err(|e| format!("Read error: {e}"))?;
            let profile: KeyboardProfile = serde_json::from_str(&json)
                .map_err(|e| format!("JSON parse error: {e}"))?;
            Ok(Some(profile))
        }
        None => Ok(None),
    }
}

// ── VIAL ─────────────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct VialStatus {
    supported:   bool,
    unlocked:    bool,
    in_progress: bool,
    unlock_keys: Vec<[u8; 2]>, // physical (row, col) pairs to hold for unlock combo
    td_count:    u8,
    combo_count: u8,
}

#[derive(Serialize, Deserialize, Clone)]
struct TapDanceEntry {
    on_tap:          u16,
    on_hold:         u16,
    on_double_tap:   u16,
    on_tap_hold:     u16,
    tapping_term_ms: u16, // 0 = use global tapping term
}

#[derive(Serialize, Deserialize, Clone)]
struct ComboEntry {
    keys:   [u16; 4], // input keycodes; unused slots are 0x0000 (KC_NO)
    output: u16,
}

#[derive(Serialize)]
struct UnlockPoll {
    unlocked:    bool,
    in_progress: bool,
    countdown:   u8,
}

/// Probe VIAL support and return unlock status + slot counts in one call.
#[tauri::command]
fn detect_vial() -> Result<VialStatus, String> {
    let kb = ViaKeyboard::open()?;
    match kb.detect_vial()? {
        None => Ok(VialStatus {
            supported: false, unlocked: false, in_progress: false,
            unlock_keys: vec![], td_count: 0, combo_count: 0,
        }),
        Some(_uid) => {
            let (unlocked, in_progress, combo_keys) =
                kb.vial_unlock_status().unwrap_or((true, false, vec![]));
            let (td_count, combo_count, _) =
                kb.vial_get_entry_counts().unwrap_or((0, 0, 0));
            Ok(VialStatus {
                supported: true,
                unlocked,
                in_progress,
                unlock_keys: combo_keys.iter().map(|&(r, c)| [r, c]).collect(),
                td_count,
                combo_count,
            })
        }
    }
}

#[tauri::command]
fn vial_unlock_start() -> Result<(), String> {
    ViaKeyboard::open()?.vial_unlock_start()
}

#[tauri::command]
fn vial_unlock_poll() -> Result<UnlockPoll, String> {
    let (unlocked, in_progress, countdown) = ViaKeyboard::open()?.vial_unlock_poll()?;
    Ok(UnlockPoll { unlocked, in_progress, countdown })
}

#[tauri::command]
fn vial_lock() -> Result<(), String> {
    ViaKeyboard::open()?.vial_lock()
}

#[tauri::command]
fn vial_get_all_tap_dance(count: u8) -> Result<Vec<TapDanceEntry>, String> {
    let kb = ViaKeyboard::open()?;
    (0..count).map(|i| {
        let d = kb.vial_get_tap_dance(i)?;
        Ok(TapDanceEntry {
            on_tap: d[0], on_hold: d[1], on_double_tap: d[2],
            on_tap_hold: d[3], tapping_term_ms: d[4],
        })
    }).collect()
}

#[tauri::command]
fn vial_set_tap_dance_entry(idx: u8, entry: TapDanceEntry) -> Result<(), String> {
    ViaKeyboard::open()?.vial_set_tap_dance(idx, [
        entry.on_tap, entry.on_hold, entry.on_double_tap,
        entry.on_tap_hold, entry.tapping_term_ms,
    ])
}

#[tauri::command]
fn vial_get_all_combos(count: u8) -> Result<Vec<ComboEntry>, String> {
    let kb = ViaKeyboard::open()?;
    (0..count).map(|i| {
        let (keys, output) = kb.vial_get_combo(i)?;
        Ok(ComboEntry { keys, output })
    }).collect()
}

#[tauri::command]
fn vial_set_combo_entry(idx: u8, entry: ComboEntry) -> Result<(), String> {
    ViaKeyboard::open()?.vial_set_combo(idx, entry.keys, entry.output)
}

#[tauri::command]
fn vial_qmk_settings_get(setting_id: u16) -> Result<u16, String> {
    ViaKeyboard::open()?.vial_qmk_settings_get_u16(setting_id)
}

#[tauri::command]
fn vial_qmk_settings_set(setting_id: u16, value: u16) -> Result<(), String> {
    ViaKeyboard::open()?.vial_qmk_settings_set_u16(setting_id, value)
}

// ── Macro buffer ─────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct MacroInfo {
    count: u8,
    buffer_size: u16,
}

#[tauri::command]
fn get_macro_info() -> Result<MacroInfo, String> {
    let kb = ViaKeyboard::open()?;
    Ok(MacroInfo {
        count:       kb.get_macro_count()?,
        buffer_size: kb.get_macro_buffer_size()?,
    })
}

/// Return the full raw macro buffer as a byte array.
#[tauri::command]
fn read_macros() -> Result<Vec<u8>, String> {
    let kb = ViaKeyboard::open()?;
    let size = kb.get_macro_buffer_size()? as usize;
    kb.read_macro_buffer(size)
}

/// Write the full raw macro buffer. The frontend is responsible for correct formatting.
#[tauri::command]
fn write_macros(data: Vec<u8>) -> Result<(), String> {
    ViaKeyboard::open()?.write_macro_buffer(&data)
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            detect_devices,
            get_device_info,
            read_keymap,
            write_key,
            get_layer_count,
            jump_bootloader,
            flash_firmware,
            get_matrix_state,
            write_layer,
            read_all_layers,
            save_profile,
            load_profile,
            get_macro_info,
            read_macros,
            write_macros,
            detect_vial,
            vial_unlock_start,
            vial_unlock_poll,
            vial_lock,
            vial_get_all_tap_dance,
            vial_set_tap_dance_entry,
            vial_get_all_combos,
            vial_set_combo_entry,
            vial_qmk_settings_get,
            vial_qmk_settings_set,
            get_lighting,
            set_lighting,
            save_lighting,
            fastset_led,
            apply_led_colors,
            pick_firmware_file,
            check_dfu_device,
            list_dfu_devices,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Iris-LM Editor");
}
