// dfu_flasher.rs - Handle firmware flashing via DFU bootloader
// 
// The STM32G431 bootloader supports DFU (Device Firmware Update)
// We use dfu-util, which is well-tested and widely available

use std::process::Command;
use std::path::Path;

// Resolve the dfu-util binary at runtime.
//
// Search order:
//   1. src-tauri/binaries/dfu-util.exe  (project-local, works in both dev and prod
//      when the app is packaged with the binary alongside it)
//   2. Next to the running executable (production install)
//   3. "dfu-util" on PATH (last resort — relies on user's environment)
//
// To use the project-local copy, drop dfu-util.exe into:
//   iris-key-editor/src-tauri/binaries/
pub fn dfu_util_path() -> std::path::PathBuf {
    // 1. Project-local binaries/ — path baked in at compile time via CARGO_MANIFEST_DIR.
    let local = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(if cfg!(windows) { "dfu-util.exe" } else { "dfu-util" });
    if local.exists() { return local; }

    // 2. Same directory as the running executable (production bundle).
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let sibling = dir.join(if cfg!(windows) { "dfu-util.exe" } else { "dfu-util" });
            if sibling.exists() { return sibling; }
        }
    }

    // 3. Rely on PATH.
    std::path::PathBuf::from(if cfg!(windows) { "dfu-util.exe" } else { "dfu-util" })
}

pub fn flash_dfu(firmware_path: &str) -> Result<(), String> {
    // Verify file exists
    if !Path::new(firmware_path).exists() {
        return Err(format!("Firmware file not found: {}", firmware_path));
    }

    // Verify dfu-util is reachable before attempting the flash.
    let dfu = dfu_util_path();
    match Command::new(&dfu).arg("--version").output() {
        Ok(_) => {},
        Err(_) => {
            return Err(format!(
                "dfu-util not found at '{}'. \
                 Drop dfu-util.exe into src-tauri/binaries/ or install via: choco install dfu-util",
                dfu.display()
            ));
        }
    }

    // Flash the firmware
    // NEEDS_HW_TEST: Device VID/PID may need adjustment
    // Standard STM32G431 DFU: VID=0x0483 PID=0xDF11
    
    eprintln!("[INFO] Starting DFU flash of {}", firmware_path);
    eprintln!("[INFO] Make sure your Iris-LM is in bootloader mode!");

    // Raw .bin files need --dfuse-address to specify where in STM32 flash to write.
    // .hex files encode addresses internally so only need -R for reset.
    let mut cmd = Command::new(&dfu);
    cmd.arg("-d").arg("0483:df11").arg("-a").arg("0").arg("-D").arg(firmware_path);
    if firmware_path.ends_with(".bin") {
        // STM32 DfuSe raw binary: specify flash start address only.
        // Omitting :leave avoids a get_status error caused by dfu-util polling
        // the device after it has already rebooted into the new firmware.
        // User unplugs/replugs to boot the new firmware.
        cmd.arg("--dfuse-address").arg("0x08000000");
    } else {
        cmd.arg("-R");
    }
    let output = cmd.output().map_err(|e| format!("dfu-util execution failed: {}", e))?;

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

/// Check whether a DFU device (STM32 VID:0483 PID:DF11) is visible on USB.
///
/// dfu-util writes its device list to stderr on most builds, so we search both
/// stdout and stderr.  Returns Err only if dfu-util itself cannot be launched
/// (i.e. it is not installed / not on PATH).
pub fn detect_dfu_device() -> Result<bool, String> {
    let output = Command::new(dfu_util_path())
        .arg("-l")
        .output()
        .map_err(|e| format!("dfu-util not found — install it first: {}", e))?;

    // dfu-util prints the device list to stderr; stdout is usually empty.
    let out = String::from_utf8_lossy(&output.stdout).to_lowercase();
    let err = String::from_utf8_lossy(&output.stderr).to_lowercase();
    let combined = format!("{out}{err}");

    // Match both "0483:df11" and the individual tokens that appear in the listing.
    let found = combined.contains("0483:df11")
        || (combined.contains("0483") && combined.contains("df11"));

    Ok(found)
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
