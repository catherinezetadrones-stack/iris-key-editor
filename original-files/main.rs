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
use usb_handler::{scan_devices, ViaKeyboard};

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
        ])
        .run(tauri::generate_context!())
        .expect("error while running Iris-LM Editor");
}
