// fw_env.rs - Bundled firmware build environment (Phase 2 in-app compilation).
//
// Manages a self-contained toolchain + vial-qmk source tree installed from a
// pack file (iris-fw-env-vN.zip, produced by scripts/build-fw-env-pack.ps1)
// into %LOCALAPPDATA%\iris-key-editor\fw-env\. Provides:
//   - pack install / status / remove (env-install-progress / env-install-done events)
//   - writing app-generated .c sources into the bundled keymap dir
//   - compiling with the bundled MSYS2 (compile-output / compile-done events,
//     same contract as the Phase 1 `compile_firmware` command)
//   - streamed dfu-util flashing (flash-output / flash-done events)
//   - launching the bundled Zadig for one-time WinUSB driver install

use serde::Serialize;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::Manager;

const KEYMAP_REL: &str = r"vial-qmk\keyboards\keebio\iris_lm\keymaps\vial";
const FIRMWARE_BIN_REL: &str = r"vial-qmk\.build\keebio_iris_lm_k1_vial.bin";

/// The only filenames the app may overwrite inside the bundled source tree.
/// keymap.c is deliberately absent — it is hand-maintained and ships in the pack.
const GENERATED_SOURCES: [&str; 5] = [
    "keymap_layers.c",
    "per_key_colors.c",
    "scroll_text.c",
    "tap_dance_keys.c",
    "extra_macros.c",
];

#[derive(Serialize, Clone)]
pub struct FwEnvStatus {
    pub installed: bool,
    pub version: Option<u64>,
    pub created: Option<String>,
    pub qmk_commit: Option<String>,
    pub path: String,
    pub size_mb: Option<u64>,
    pub has_dfu_util: bool,
    pub has_zadig: bool,
}

#[derive(Serialize, Clone)]
struct InstallProgress {
    done: usize,
    total: usize,
}

#[derive(Serialize, Clone)]
struct InstallDone {
    success: bool,
    message: String,
}

#[derive(Serialize, Clone)]
struct FlashDone {
    success: bool,
    message: String,
}

pub fn env_root() -> PathBuf {
    let base = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| r"C:\".into());
    Path::new(&base).join("iris-key-editor").join("fw-env")
}

fn dir_size_mb(path: &Path) -> u64 {
    fn walk(p: &Path) -> u64 {
        let mut total = 0;
        if let Ok(entries) = std::fs::read_dir(p) {
            for e in entries.flatten() {
                if let Ok(meta) = e.metadata() {
                    if meta.is_dir() {
                        total += walk(&e.path());
                    } else {
                        total += meta.len();
                    }
                }
            }
        }
        total
    }
    walk(path) / (1024 * 1024)
}

fn read_manifest(root: &Path) -> Option<serde_json::Value> {
    let raw = std::fs::read_to_string(root.join("manifest.json")).ok()?;
    // The pack builder writes UTF-8 with BOM; serde_json rejects a leading BOM.
    serde_json::from_str(raw.trim_start_matches('\u{feff}')).ok()
}

/// Free bytes available on the volume holding `path` (kernel32, no extra crate).
fn free_disk_bytes(path: &Path) -> Option<u64> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn GetDiskFreeSpaceExW(
            lpDirectoryName: *const u16,
            lpFreeBytesAvailableToCaller: *mut u64,
            lpTotalNumberOfBytes: *mut u64,
            lpTotalNumberOfFreeBytes: *mut u64,
        ) -> i32;
    }
    let mut dir = path.to_path_buf();
    while !dir.exists() {
        dir = dir.parent()?.to_path_buf();
    }
    let wide: Vec<u16> = dir.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let mut free = 0u64;
    let ok = unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &mut free, std::ptr::null_mut(), std::ptr::null_mut()) };
    if ok != 0 { Some(free) } else { None }
}

// ── Status / install / remove ─────────────────────────────────────────────────

#[tauri::command]
pub fn fw_env_status() -> Result<FwEnvStatus, String> {
    let root = env_root();
    let manifest = read_manifest(&root);
    let installed = manifest.is_some();
    Ok(FwEnvStatus {
        installed,
        version: manifest.as_ref().and_then(|m| m["version"].as_u64()),
        created: manifest.as_ref().and_then(|m| m["created"].as_str().map(String::from)),
        qmk_commit: manifest.as_ref().and_then(|m| m["qmk_commit"].as_str().map(String::from)),
        path: root.to_string_lossy().into_owned(),
        size_mb: if installed { Some(dir_size_mb(&root)) } else { None },
        has_dfu_util: root.join("bin").join("dfu-util.exe").exists(),
        has_zadig: root.join("bin").join("zadig.exe").exists(),
    })
}

/// Pick the pack zip with a native dialog. Separate from the install so the UI
/// can show the chosen file before kicking off the long extraction.
#[tauri::command]
pub fn fw_env_pick_pack() -> Result<Option<String>, String> {
    let path = tauri::api::dialog::blocking::FileDialogBuilder::new()
        .set_title("Select build environment pack (iris-fw-env-*.zip)")
        .add_filter("Environment pack", &["zip"])
        .pick_file();
    Ok(path.map(|p| p.to_string_lossy().into_owned()))
}

/// Extract a pack zip into the env root. Returns immediately; progress is
/// streamed as `env-install-progress` and completion as `env-install-done`.
#[tauri::command]
pub fn fw_env_install(app_handle: tauri::AppHandle, pack_path: String) -> Result<(), String> {
    let pack = PathBuf::from(&pack_path);
    if !pack.exists() {
        return Err(format!("Pack file not found: {pack_path}"));
    }

    std::thread::spawn(move || {
        let result = install_pack(&app_handle, &pack);
        let payload = match result {
            Ok(msg) => InstallDone { success: true, message: msg },
            Err(e) => InstallDone { success: false, message: e },
        };
        let _ = app_handle.emit_all("env-install-done", &payload);
    });
    Ok(())
}

fn install_pack(app_handle: &tauri::AppHandle, pack: &Path) -> Result<String, String> {
    let root = env_root();
    let tmp = root.with_extension("tmp");
    let parent = root.parent().ok_or("Invalid env root")?;
    std::fs::create_dir_all(parent).map_err(|e| format!("Cannot create {}: {e}", parent.display()))?;

    // Need room for the extracted tree (~5 GB) while the zip also exists.
    let pack_len = pack.metadata().map(|m| m.len()).unwrap_or(0);
    if let Some(free) = free_disk_bytes(parent) {
        let needed = pack_len.saturating_mul(5).max(6 * 1024 * 1024 * 1024);
        if free < needed {
            return Err(format!(
                "Not enough disk space: {:.1} GB free, ~{:.1} GB needed for extraction.",
                free as f64 / 1e9, needed as f64 / 1e9
            ));
        }
    }

    if tmp.exists() {
        std::fs::remove_dir_all(&tmp).map_err(|e| format!("Cannot clear previous temp dir: {e}"))?;
    }

    let file = std::fs::File::open(pack).map_err(|e| format!("Cannot open pack: {e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Not a valid zip: {e}"))?;

    // Reject anything that isn't an iris-fw-env pack before touching the disk.
    // Tolerate "./" prefixes (tar-style archives) alongside plain entry names.
    if archive.by_name("manifest.json").is_err() && archive.by_name("./manifest.json").is_err() {
        return Err("This zip has no manifest.json — not an iris-fw-env pack.".into());
    }

    let total = archive.len();
    for i in 0..total {
        let mut entry = archive.by_index(i).map_err(|e| format!("Zip read error: {e}"))?;
        let rel = match entry.enclosed_name() {
            Some(p) => p.to_path_buf(), // enclosed_name() rejects ../ traversal
            None => continue,
        };
        let out = tmp.join(rel);
        // .NET-built packs use '\' separators; dir entries end with '\' which
        // some zip-crate versions don't recognize as directories.
        let is_dir = entry.is_dir() || entry.name().ends_with('\\') || entry.name().ends_with('/');
        if is_dir {
            std::fs::create_dir_all(&out).map_err(|e| format!("mkdir failed: {e}"))?;
        } else {
            if let Some(dir) = out.parent() {
                std::fs::create_dir_all(dir).map_err(|e| format!("mkdir failed: {e}"))?;
            }
            let mut f = std::fs::File::create(&out)
                .map_err(|e| format!("Cannot create {}: {e}", out.display()))?;
            std::io::copy(&mut entry, &mut f).map_err(|e| format!("Extract failed: {e}"))?;
        }
        if i % 200 == 0 || i + 1 == total {
            let _ = app_handle.emit_all("env-install-progress", &InstallProgress { done: i + 1, total });
        }
    }

    // Sanity-check the extracted tree before swapping it in.
    for required in [r"toolchain\usr\bin\bash.exe", r"vial-qmk\Makefile", "manifest.json"] {
        if !tmp.join(required).exists() {
            let _ = std::fs::remove_dir_all(&tmp);
            return Err(format!("Pack is incomplete — missing {required}."));
        }
    }

    if root.exists() {
        std::fs::remove_dir_all(&root).map_err(|e| format!("Cannot remove previous install: {e}"))?;
    }
    std::fs::rename(&tmp, &root).map_err(|e| format!("Cannot finalize install: {e}"))?;

    let version = read_manifest(&root)
        .and_then(|m| m["version"].as_u64())
        .map(|v| format!("v{v}"))
        .unwrap_or_else(|| "unknown version".into());
    Ok(format!("Build environment {version} installed to {}", root.display()))
}

#[tauri::command]
pub fn fw_env_remove() -> Result<(), String> {
    let root = env_root();
    if root.exists() {
        std::fs::remove_dir_all(&root).map_err(|e| format!("Remove failed: {e}"))?;
    }
    Ok(())
}

// ── Generated sources ─────────────────────────────────────────────────────────

#[derive(serde::Deserialize)]
pub struct SourceFile {
    pub name: String,
    pub content: String,
}

/// Write app-generated .c files into the bundled keymap directory.
/// Only the whitelisted generated filenames are accepted.
#[tauri::command]
pub fn fw_env_write_sources(files: Vec<SourceFile>) -> Result<Vec<String>, String> {
    let keymap_dir = env_root().join(KEYMAP_REL);
    if !keymap_dir.exists() {
        return Err("Build environment is not installed.".into());
    }
    let mut written = Vec::new();
    for f in &files {
        if !GENERATED_SOURCES.contains(&f.name.as_str()) {
            return Err(format!("Refusing to write non-generated file: {}", f.name));
        }
        let path = keymap_dir.join(&f.name);
        std::fs::write(&path, &f.content).map_err(|e| format!("Write {} failed: {e}", f.name))?;
        written.push(f.name.clone());
    }
    Ok(written)
}

// ── Compile ───────────────────────────────────────────────────────────────────

/// Compile keebio/iris_lm/k1:vial with the bundled toolchain. Output streams as
/// `compile-output` lines and a final `compile-done` event (same contract as the
/// external-QMK `compile_firmware` command, so the frontend listeners are shared).
#[tauri::command]
pub fn compile_bundled(app_handle: tauri::AppHandle) -> Result<(), String> {
    use std::io::{BufRead, BufReader};

    let root = env_root();
    let bash = root.join(r"toolchain\usr\bin\bash.exe");
    if !bash.exists() {
        return Err("Build environment is not installed — install the pack in the Firmware tab first.".into());
    }

    let qmk_dir_msys = crate::windows_to_msys(&root.join("vial-qmk").to_string_lossy());
    // SKIP_GIT silences version lookups in the .git-less snapshot.
    let cmd = format!("cd '{qmk_dir_msys}' && make keebio/iris_lm/k1:vial SKIP_GIT=yes 2>&1");

    let mut child = Command::new(&bash)
        .args(["-l", "-c", &cmd])
        // Login shell + these vars reproduce the QMK MSYS environment without
        // touching (or depending on) the machine's own user profile.
        .env("MSYSTEM", "MINGW64")
        .env("CHERE_INVOKING", "1")
        .env("HOME", root.join(r"toolchain\home"))
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to launch bundled bash: {e}"))?;

    let stdout = child.stdout.take().expect("stdout was piped");
    let bin_path = root.join(FIRMWARE_BIN_REL);

    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().flatten() {
            let _ = app_handle.emit_all("compile-output", &line);
        }
        let success = child.wait().map(|s| s.success()).unwrap_or(false);
        // Same payload type as the external-QMK compile so JS listeners are shared.
        let _ = app_handle.emit_all("compile-done", &crate::CompileResult {
            success,
            output: String::new(),
            bin_path: bin_path.exists().then(|| bin_path.to_string_lossy().into_owned()),
        });
    });

    Ok(())
}

// ── Flash (streamed) ──────────────────────────────────────────────────────────

/// Prefer the pack's dfu-util, fall back to the Phase 1 search order.
fn dfu_util_exe() -> PathBuf {
    let bundled = env_root().join(r"bin\dfu-util.exe");
    if bundled.exists() { bundled } else { crate::dfu_flasher::dfu_util_path() }
}

/// Flash via dfu-util with output streamed as `flash-output` lines and a final
/// `flash-done { success, message }`. dfu-util redraws its progress bar with
/// `\r`, so output is split on both `\r` and `\n`.
#[tauri::command]
pub fn flash_firmware_streamed(app_handle: tauri::AppHandle, firmware_path: String) -> Result<(), String> {
    if !Path::new(&firmware_path).exists() {
        return Err(format!("Firmware file not found: {firmware_path}"));
    }

    let dfu = dfu_util_exe();
    let mut cmd = Command::new(&dfu);
    cmd.arg("-d").arg("0483:df11").arg("-a").arg("0").arg("-D").arg(&firmware_path);
    if firmware_path.ends_with(".bin") {
        // STM32 DfuSe raw binary: flash start address; no :leave (see dfu_flasher.rs)
        cmd.arg("--dfuse-address").arg("0x08000000");
    } else {
        cmd.arg("-R");
    }

    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to launch dfu-util at '{}': {e}", dfu.display()))?;

    let stdout = child.stdout.take().expect("stdout was piped");
    let stderr = child.stderr.take().expect("stderr was piped");

    // Forward a raw byte stream line-by-line, treating \r as a line break too.
    fn pump(mut src: impl Read, app: tauri::AppHandle) {
        let mut buf = [0u8; 512];
        let mut line = String::new();
        loop {
            match src.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    for &b in &buf[..n] {
                        if b == b'\n' || b == b'\r' {
                            if !line.trim().is_empty() {
                                let _ = app.emit_all("flash-output", &line);
                            }
                            line.clear();
                        } else {
                            line.push(b as char);
                        }
                    }
                }
            }
        }
        if !line.trim().is_empty() {
            let _ = app.emit_all("flash-output", &line);
        }
    }

    let app_out = app_handle.clone();
    let out_thread = std::thread::spawn(move || pump(stdout, app_out));
    let app_err = app_handle.clone();
    let err_thread = std::thread::spawn(move || pump(stderr, app_err));

    std::thread::spawn(move || {
        let _ = out_thread.join();
        let _ = err_thread.join();
        let success = child.wait().map(|s| s.success()).unwrap_or(false);
        let message = if success {
            "Flash successful — unplug and replug the keyboard to boot the new firmware.".into()
        } else {
            "dfu-util exited with an error — see the log above.".to_string()
        };
        let _ = app_handle.emit_all("flash-done", &FlashDone { success, message });
    });

    Ok(())
}

// ── Driver install ────────────────────────────────────────────────────────────

/// Launch the bundled Zadig so the user can install the WinUSB driver for the
/// STM32 DFU bootloader (0483:DF11). Zadig is a GUI and self-elevates, so this
/// just starts it and returns — the UI shows the two clicks needed inside Zadig.
#[tauri::command]
pub fn launch_zadig() -> Result<String, String> {
    let zadig = env_root().join(r"bin\zadig.exe");
    if !zadig.exists() {
        return Err("Zadig is not in the installed pack — install the driver manually (see the Windows Setup guide).".into());
    }
    Command::new(&zadig)
        .spawn()
        .map_err(|e| format!("Failed to launch Zadig: {e}"))?;
    Ok("Zadig launched. In Zadig: Options → List All Devices, select 'STM32 BOOTLOADER', choose WinUSB, click Replace Driver.".into())
}
