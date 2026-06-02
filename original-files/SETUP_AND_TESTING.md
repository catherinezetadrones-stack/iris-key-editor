# Iris-LM Editor — Setup & Testing Guide

This walks you from nothing to a running app you can use to remap your Iris-LM
over the stock VIA protocol. No firmware flashing is involved in remapping.

Primary target is **Windows**; macOS/Linux notes are included where they differ.

---

## 0. What you'll install

| Tool | Why | 
|------|-----|
| Rust (via rustup) | Builds the Tauri backend |
| Node.js (LTS) | Builds the React frontend |
| Tauri OS prerequisites | Native webview + C/C++ toolchain |
| (optional) dfu-util | Only for firmware *updates*, not remapping |

Expect ~30–45 min the first time, mostly downloads and the first Rust build.

---

## 1. Install prerequisites

### 1a. Rust

**Windows**
1. Download and run the installer from <https://rustup.rs> (`rustup-init.exe`).
2. When prompted, choose **1) Proceed with standard installation**. This installs
   the MSVC toolchain, which Tauri needs on Windows.
3. Close and reopen your terminal so `PATH` updates.

**macOS / Linux**
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# accept the default installation, then:
source "$HOME/.cargo/env"
```

**Verify (all platforms):**
```bash
rustc --version
cargo --version
```
Both should print a version. If `cargo` isn't found, restart your terminal.

### 1b. Node.js
Install the **LTS** build from <https://nodejs.org>. Verify:
```bash
node --version
npm --version
```

### 1c. Tauri OS prerequisites

**Windows**
- **Microsoft C++ Build Tools**: download "Build Tools for Visual Studio" and in
  the installer check **Desktop development with C++**.
- **WebView2 Runtime**: pre-installed on Windows 11 and current Windows 10. If
  missing, get the Evergreen runtime from Microsoft.

**macOS**
```bash
xcode-select --install
```

**Linux (Debian/Ubuntu)**
```bash
sudo apt update
sudo apt install libwebkit2gtk-4.0-dev build-essential curl wget file \
  libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libudev-dev
```
(`libudev-dev` is needed for HID access.)

Full, up-to-date list: <https://tauri.app/v1/guides/getting-started/prerequisites>

---

## 2. Scaffold the project

We use Vite (React) for the frontend and Tauri **v1** for the shell, matching the
provided code.

```bash
# 1) Frontend scaffold
npm create vite@latest iris-editor -- --template react
cd iris-editor
npm install

# 2) Tauri v1 CLI + API (pin to v1 — the code uses v1 APIs)
npm install --save-dev @tauri-apps/cli@^1
npm install @tauri-apps/api@^1

# 3) Generate the Tauri shell (creates src-tauri/ with icons, build.rs, config)
npx tauri init
```

Answer `tauri init` like this:
- App name: `iris-editor`
- Window title: `Iris-LM Editor`
- Web assets location relative to `<src-tauri>/tauri.conf.json`: `../dist`
- Dev server URL: `http://localhost:5173`
- `beforeDevCommand`: `npm run dev`
- `beforeBuildCommand`: `npm run build`

---

## 3. Drop in the project files

Replace the scaffold's placeholder files with the delivered ones, using this map.
Create the `src/components/` folder if needed.

| Delivered file | Put it at |
|----------------|-----------|
| `index.html` | `index.html` (project root — overwrite Vite's) |
| `main.jsx` | `src/main.jsx` (overwrite) |
| `App.jsx` | `src/App.jsx` |
| `App.css` | `src/App.css` |
| `KeyboardGrid.jsx` | `src/components/KeyboardGrid.jsx` |
| `KeyboardGrid.css` | `src/components/KeyboardGrid.css` |
| `KeyButton.jsx` | `src/components/KeyButton.jsx` |
| `KeyButton.css` | `src/components/KeyButton.css` |
| `components/LayerPanel.jsx` | `src/components/LayerPanel.jsx` |
| `components/DevicePanel.jsx` | `src/components/DevicePanel.jsx` |
| `components/MacroEditor.jsx` | `src/components/MacroEditor.jsx` |
| `components/SettingsPanel.jsx` | `src/components/SettingsPanel.jsx` |
| `components/DebugConsole.jsx` | `src/components/DebugConsole.jsx` |
| `components/KeySelector.jsx` | `src/components/KeySelector.jsx` |
| `components/components.css` | `src/components/components.css` |
| `Cargo.toml` | `src-tauri/Cargo.toml` (overwrite) |
| `main.rs` | `src-tauri/src/main.rs` (overwrite) |
| `via_protocol.rs` | `src-tauri/src/via_protocol.rs` |
| `usb_handler.rs` | `src-tauri/src/usb_handler.rs` |
| `dfu_flasher.rs` | `src-tauri/src/dfu_flasher.rs` |

> The old `components-all.jsx`, `iris_lm_keymap.c`, `src-tauri-hid-protocol.rs`,
> and `src-tauri-usb-handler.rs` are **not used** — leave them out.

### 3a. Enable the file dialog (for the optional Flash button)
In `src-tauri/tauri.conf.json`, inside `tauri.allowlist`, allow the dialog (this
is the only frontend API permission needed):
```json
"allowlist": {
  "dialog": { "open": true }
}
```
If you'd rather not fuss with it during testing, you can temporarily use
`"allowlist": { "all": true }`. Remapping itself needs no allowlist entries.

---

## 4. First run (dev mode)

From the project root:
```bash
npm run tauri dev
```
The first build compiles the Rust backend and can take several minutes. When it
finishes, the app window opens with the staggered Iris-LM layout. Subsequent
runs are fast.

If you only want to check the UI without the backend, `npm run dev` serves the
frontend in a browser, but device features won't work there.

---

## 5. Test with your keyboard

1. **Close other VIA tools.** If `usevia.app` or the VIA desktop app is open and
   connected, it holds the HID device and this app won't be able to open it.
2. **Plug in the Iris-LM** with USB-C to your PC (the connected half is the
   master; it relays for both halves). No bootloader, no flashing.
3. In the app's **DEVICE** panel, your board should appear within ~2 seconds
   (it's found by VIA's HID usage page, not a guessed product ID). The DEBUG LOG
   shows "Found 1 device(s)" and "Loaded layer 0".
4. **Read check:** the keys should reflect your current layer-0 mapping.
5. **Write check:** click a key (say the visual **A**), pick a new code (e.g.
   `B`) in the selector, then focus any text field and press that physical key —
   it should now type the new value. Changes persist across unplugging because
   VIA writes them to EEPROM.

### 5a. Verify the matrix mapping (one-time, important)
The matrix coordinates are the standard Iris layout and almost certainly correct,
but confirm once so remaps never hit the wrong key:
- Easiest: remap one unmistakable key and confirm the right physical key changed.
- Thorough: open `usevia.app` → **Key Tester → Test Matrix**, press keys, and
  confirm the `(row, col)` that lights up matches the comments in
  `src/components/KeyboardGrid.jsx` (`buildHalf`). If a **thumb** key is off,
  reorder the `mc:` values in `thumbCells` — that's the only place to change.

---

## 6. Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| "No VIA keyboard found" | Another VIA app holds the device — close it. On Linux, add a udev rule for the QMK raw-HID interface, or run once with `sudo` to confirm it's a permissions issue. |
| App builds but no device shows | Confirm the board enumerates (Windows Device Manager → Human Interface Devices). Try a data-capable USB-C cable and a direct port. |
| `cargo`/`rustc` not found | Reopen the terminal after installing Rust; ensure `~/.cargo/bin` is on `PATH`. |
| Rust build fails on Windows with linker errors | Install the **Desktop development with C++** workload (step 1c). |
| Remap writes but doesn't stick | You're likely on a non-VIA custom firmware. Stock Iris-LM firmware is VIA-enabled; if you reflashed, re-enable VIA. |
| Flash button errors about `dfu-util` | Only needed for firmware updates: `choco install dfu-util` (Windows) / `apt install dfu-util` (Linux); first-time Windows DFU also needs the Zadig libusb driver. |

---

## 7. Optional: firmware updates (not remapping)

The **BOOTLOADER** and **FLASH FW** buttons exist only for updating firmware via
`dfu-util`. They're unrelated to remapping. The Iris-LM uses an STM32 DFU
bootloader (`0483:DF11`); on Windows the first DFU use needs the Zadig libusb
driver. You will not touch this for day-to-day key remapping.

---

## Quick reference
```bash
# install Rust:        https://rustup.rs
# run the app (dev):   npm run tauri dev
# build a release:     npm run tauri build
```
