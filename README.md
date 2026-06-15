# Iris-LM Editor

A desktop app for configuring the **Iris LM-K Rev. 1** split keyboard — remap keys,
build macros, tap dance, combos, and per-key lighting, then compile and flash firmware,
all from one window.

Built with Tauri v1 + React (Vite) for Windows.

---

## Features

- **Live remapping over VIA/HID** — change your keymap and write it to the keyboard's
  EEPROM with no firmware flash required.
- **One-click Build & Flash** — compiles QMK firmware and flashes it in-app via a
  self-contained bundled toolchain (no external QMK/MSYS2 install needed).
- **Full editor suite** — tabs for Editor, Macros, Tap Dance, Combos, Lighting,
  Firmware, Settings, and a Key Test view.
- **Complete keycode library** — all standard USB HID keycodes across 11 searchable
  categories, plus layer keys, F1–F24, full numpad, navigation, modifiers, and symbols.

End-to-end verified on real hardware: device detection, keymap read, key remap, and
EEPROM write all confirmed working.

---

## Install

1. Download the installer from the [latest Release](../../releases/latest) and run it.
2. The app is unsigned — Windows SmartScreen may warn on first run.
   Click **More info → Run anyway**.
3. Plug in your Iris LM-K and open the app; it should detect the device automatically.

> **Scope:** this app targets only the Iris LM-K Rev. 1. No other keyboard is supported.

---

## Building from source

Requires Node.js 18 and the Rust toolchain (Tauri v1). Cargo must be on your PATH.

```powershell
$env:PATH += ";$env:USERPROFILE\.cargo\bin"
npm install
npm run tauri dev      # run in development
npm run tauri build    # produce the installer in src-tauri/target/release/bundle/
```

---

## Tech stack

- **Frontend:** Vite 4 + React 18
- **Backend:** Tauri v1 + Rust (`hidapi`, VIA protocol, USB/DFU handling)
- **Firmware:** QMK (`vial-qmk`), compiled via a bundled MSYS2 toolchain
