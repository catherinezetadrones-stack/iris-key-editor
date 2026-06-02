// dfu_flasher.rs - Handle firmware flashing via DFU bootloader
// 
// The STM32G431 bootloader supports DFU (Device Firmware Update)
// We use dfu-util, which is well-tested and widely available

use std::process::Command;
use std::path::Path;

pub fn flash_dfu(firmware_path: &str) -> Result<(), String> {
    // Verify file exists
    if !Path::new(firmware_path).exists() {
        return Err(format!("Firmware file not found: {}", firmware_path));
    }

    // Check if dfu-util is installed
    match Command::new("dfu-util").arg("--version").output() {
        Ok(_) => {},
        Err(_) => {
            return Err(
                "dfu-util not found. Install it via: choco install dfu-util (Windows) or apt install dfu-util (Linux)".to_string()
            );
        }
    }

    // Flash the firmware
    // NEEDS_HW_TEST: Device VID/PID may need adjustment
    // Standard STM32G431 DFU: VID=0x0483 PID=0xDF11
    
    eprintln!("[INFO] Starting DFU flash of {}", firmware_path);
    eprintln!("[INFO] Make sure your Iris-LM is in bootloader mode!");

    let output = Command::new("dfu-util")
        .arg("-d")
        .arg("0483:df11")  // NEEDS_HW_TEST: Verify VID:PID
        .arg("-a")
        .arg("0")          // Alternate interface 0 (main flash)
        .arg("-D")
        .arg(firmware_path)
        .arg("-R")         // Reset after flashing
        .output()
        .map_err(|e| format!("dfu-util execution failed: {}", e))?;

    if output.status.success() {
        eprintln!("[INFO] Flash successful!");
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let error_msg = format!(
            "DFU flash failed:\n{}",
            stderr
        );
        eprintln!("[ERROR] {}", error_msg);
        Err(error_msg)
    }
}

// Helper function to detect if device is in DFU mode
pub fn detect_dfu_device() -> Result<bool, String> {
    match Command::new("dfu-util")
        .arg("-l")  // List devices
        .output()
    {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let has_iris = stdout.contains("0483") && stdout.contains("df11");
            Ok(has_iris)
        }
        Err(e) => Err(format!("Failed to check DFU devices: {}", e))
    }
}

// =============================================================================
// SETUP INSTRUCTIONS (Windows)
// =============================================================================
//
// To use DFU flashing on Windows:
//
// 1. Install dfu-util via Chocolatey:
//    Open PowerShell as Administrator and run:
//    ```
//    choco install dfu-util
//    ```
//
// 2. Install Zadig USB driver (for first-time DFU):
//    a) Download Zadig from: https://zadig.akeo.ie/
//    b) Plug keyboard into bootloader mode (Bootmagic reset)
//    c) Open Zadig, select your device
//    d) Select "libusb-win32" driver
//    e) Click "Install Driver"
//
// 3. After this, dfu-util should work!
//
// Alternative: Use QMK Toolbox (GUI wrapper around dfu-util)
// - Download: https://github.com/qmk/qmk_toolbox/releases
// - Select .bin or .hex firmware file
// - Put keyboard in bootloader
// - Click "Flash"
//
// =============================================================================
// DEBUGGING DFU ISSUES
// =============================================================================
//
// Problem: "dfu-util: command not found"
// Solution: Ensure dfu-util is in PATH or install via package manager
//
// Problem: "No DFU devices found"
// Solution:
//   - Ensure keyboard is in bootloader mode (Bootmagic reset)
//   - Check USB cable and port
//   - May need driver installation (Zadig on Windows)
//
// Problem: "Lost device" during flashing
// Solution:
//   - USB cable may be loose
//   - Try a different USB port
//   - Ensure good USB cable (not charge-only)
