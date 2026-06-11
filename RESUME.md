# RESUME — pick up here

Session date: 2026-06-11. Previous session completed all UI/UX + Firmware bugs from TODO.md, then the "profile is source of truth" change, and planned (but did not implement) the profile-cache-for-Save feature.

---

## 1. Completed this session

**TODO.md "UI / UX Bugs" + "Firmware Bugs" (all 4 items, each reviewer-verified):**

- `src/components/MacroEditor.jsx` — Record button blurs on every click (Enter/Space can't re-trigger it); all interactive controls disabled while recording (mode tabs, Add buttons, ActionRow select/inputs/buttons via new `disabled` prop); `startRecording` clears `activeAction`/`pickerRequest` so KeyPicker clicks can't edit actions mid-recording.
- `src/App.jsx` + `src/components/LightingPanel.jsx` — multi-select per-key color: compact LightingPanel receives `selectedKeys`, new `selectedLedIndices` memo maps all selected keys to LED indices, ColorPicker onChange/onClear loop over all of them (state + `fastset_led` preview). Picker renders when `selectedLedIndices.length > 0`; swatch shows anchor key's color.
- `src/App.jsx` — refined dirty flag: `isDirty` computed by a no-dep-array effect comparing a `stableStringify` snapshot (keymaps from `allKeymapsRef` + all profile-held state) against a baseline; baseline recaptured via `baselineToken` bump on connect/Save/SaveAs/New/Open and on mount. All 13 former `setIsDirty(true)` sites removed. Connect path pre-fills layer cache via `read_all_layers` so lazy layer loads don't false-diff.
- Bootloader auto-jump (firmware bug): root cause = `VIAL_INSECURE` compiles out VIA's `id_bootloader_jump` (0x0B) in `quantum/via.c`. Fix: `raw_hid_receive_kb()` override added to **`%LOCALAPPDATA%\iris-key-editor\fw-env\vial-qmk\keyboards\keebio\iris_lm\keymaps\vial\keymap.c`** (echo, wait_ms(100), bootloader_jump). Reviewer verified against bundled via.c: weak symbol, VIAL 0xFE traffic routed before default case, no double echo (bootloader_jump never returns). `src/components/FirmwarePanel.jsx` `flashHalf` re-sends jump every ~10s with attempt logging + diagnostic. `src-tauri/src/usb_handler.rs` doc comment (Ok(()) only means "sent").
  - **One-time bootstrap**: firmware currently on the halves lacks the handler — first flash after rebuild still needs manual bootloader entry. User was mid-validation of this.

**Profile is source of truth (user-requested, reviewer-verified clean):**

- `src/App.jsx` — `profileLoadedRef` set true in handleOpen/handleSaveAs/handleNew alongside `setCurrentFilePath`. `loadKeymap(layer, { fromHardware = !profileLoadedRef.current })`; read-back call sites (paste/clear/open) pass `{ fromHardware: true }`. Scan/connect effect: with profile loaded, skips `read_all_layers` pre-fill, `loadKeymap`, `setLayoutDirty(false)`, baseline bump (keeps dirty state across replug); `get_layer_count` and `applyPerKeyColors` (a push) stay unconditional.
- `src/components/FirmwarePanel.jsx` — new `profileLoaded` prop (passed as `currentFilePath !== null`); `generateSources` and `handleWriteKeymapC` skip the `read_all_layers` merge when profile loaded.
- `src/App.jsx` handleOpen — Gap 2 fix: resets to layer 0 (`setCurrentLayer(0); await loadKeymap(0, {fromHardware:true})`) so the post-open read-back can't pull a profile-undefined layer from stale hardware. **Implemented at end of session, NOT yet reviewer-verified** (trivial, but verify next session).

**Bundled dfu-util was broken — real cause of the wizard flash failures:** the fw-env pack's `bin\` shipped the dynamic `dfu-util.exe` WITHOUT `libusb-1.0.dll`, so it exited instantly with no output (detection still worked because `check_dfu_device` uses the Phase-1 search path → `src-tauri\binaries\dfu-util.exe`, which has the DLL). Fixed: DLL copied into `%LOCALAPPDATA%\iris-key-editor\fw-env\bin\` (verified `dfu-util -V` runs), and `scripts/build-fw-env-pack.ps1` now stages `libusb-1.0.dll` alongside dfu-util (warns if absent). The user still needs to re-run Build & Flash to confirm end-to-end.

**Flash race fix (reviewer-verified):** user's hardware test confirmed auto-jump works, but dfu-util failed instantly right after DFU detection (driver not yet bound). `flashHalf` in `src/components/FirmwarePanel.jsx` now waits 3s after first DFU detection ("driver settle"), then retries the flash up to 3 attempts with 3s spacing, aborting retries (and clearing the DFU badge) if the device disappears. Untested on hardware — the user should re-run Build & Flash to validate.

**Docs/memory:** CLAUDE.md updated (authoritative firmware tree = `%LOCALAPPDATA%\iris-key-editor\fw-env\vial-qmk\`, do NOT edit `C:\Users\phbronson\vial-qmk`; bash cargo PATH typo fixed; `fw_env` module + in-app compile bullet added). Memory `feedback_firmware_compile.md` rewritten accordingly.

**Nothing committed** — user reviews and approves commits personally.

## 2. Current state of in-progress work

No code is half-finished. The next feature (profile cache for Save — plan below) is **planned but not started**. All files compile-clean as far as edits go (no build was run this session; user was running the app and testing successfully mid-session).

## 3. Next steps — ordered and specific

Goal (user's words): "Both of the related gaps should be fixed by reading from the loaded profile, not the keyboard." Gap = `buildProfile()` (Save/SaveAs/Export-then-Clear) still reads layers/macros/lighting/tap_dance/combos from hardware, so saving with a stale half plugged in corrupts the profile. Everything IS in the v3 profile; the app just discards macros/lighting/tap_dance/combos after `handleOpen` writes them to hardware. Full planner output exists; condensed executable sequence:

1. **App.jsx**: add `profileHwSectionsRef = useRef({ macros: null, macroMeta: null /*{macroCount,bufferSize}*/, tap_dance: null, combos: null })` near `allKeymapsRef`. Lift LightingPanel's global `configs` state into App as `globalLightingConfigs` useState (copy `DEFAULT_STATE` from LightingPanel.jsx ~line 9), with layer-extension on `layerCount` growth (mirror LightingPanel's effect ~lines 91-96).
2. **App.jsx handleOpen**: after the restore blocks, seed `profileHwSectionsRef.current.macros = profile.macros ?? []`, `.tap_dance = profile.tap_dance ?? null`, `.combos = profile.combos ?? null`; `setGlobalLightingConfigs(profile.lighting ?? defaults)`. Note: `macroCount`/`bufferSize` are NOT in the profile — MacroEditor keeps calling `get_macro_info` (cheap) but skips `read_macros` when cache present. Do NOT bump profile version.
3. **App.jsx handleNew**: reset `profileHwSectionsRef.current` (macros `Array.from({length:32},()=>[])` or seed from hardware read if device connected, mirroring the existing `read_all_layers` refill; tap_dance/combos null) and `setGlobalLightingConfigs` to defaults.
4. **MacroEditor.jsx**: props `profileLoaded`, `viaMacrosCache`, `onViaMacrosChange`. `load()`: always `get_macro_info`; if `profileLoaded && cache`, populate from cache, skip `read_macros`; else read hardware then `onViaMacrosChange({macros, macroCount, bufferSize})`. `handleSave` (VIA): after successful `write_macros`, call `onViaMacrosChange`. NOTE: `reloadKey` bump from handleOpen forces reload — with profile loaded the cache was just seeded from the profile, so cache-read is correct there too.
5. **App.jsx**: wire MacroEditor props (callback writes into `profileHwSectionsRef.current.macros`/`macroMeta`).
6. **LightingPanel.jsx**: replace local `configs`/`setConfigs` with props `globalLightingConfigs`/`onGlobalLightingConfigsChange` (+ `profileLoaded`). `load()`: skip `get_lighting` when profile loaded and state seeded; else read + report up. `handleChange`/`handleSave`/`ensureDirectMode`/layer-extension all go through the prop setter. BOTH render sites in App.jsx (compact editor-mode instance and full Lighting tab) get the same props — this is the reason for lifting state (two instances must not diverge). Largest single task; review carefully.
7. **TapDanceEditor.jsx** and **CombosEditor.jsx**: props `profileLoaded`, `tapDanceCache`/`combosCache`, `onTapDanceChange`/`onCombosChange`. `load()`: keep `detect_vial` (lock status = session state); if profile loaded + cache, use it, skip `vial_get_all_*`; else hardware read + seed callback. `handleSave`: after `vial_set_*_entry`, mirror full entries array up. Wire props in App.jsx.
8. **App.jsx buildProfile()**: per-section — layers from `allKeymapsRef.current` (fill blanks `10×6 of 0x0000` for missing indices) when `profileLoadedRef.current`, else `read_all_layers`; macros/tap_dance/combos from cache when profile loaded and non-null, else hardware read + seed cache; lighting from `globalLightingConfigs` when loaded, else `get_lighting` + seed. Keep profile JSON shape identical (version 3).
9. **Reviewer subagent** (claude-sonnet-4-6) per CLAUDE.md rules, then manual test matrix: (a) no profile → Save As captures hardware; (b) Open → Save with no edits → reopen → identical sections; (c) Open → edit macro "Save to keyboard" → Save → persisted; (d) same for lighting slider, TD slot, combo slot; (e) Open profile with fewer layers than firmware → lands on layer 0, no stale pull; (f) New → Save As sane defaults (null tap_dance/combos OK — handleOpen already guards with `Array.isArray`).

Known risks called out by the planner: VIA-macro edits not yet "Saved to keyboard" are dropped from profile Save (consistent with today's semantics — flag, don't fix); two LightingPanel instances must share lifted state; `allKeymapsRef` gap-filling in buildProfile must not read `undefined`.

## 4. Decisions made this session

- Dirty flag: full replacement with computed compare (no sticky boolean); hardware-backed sections intentionally excluded from the baseline; reconnect rebaselines ONLY when no profile is loaded.
- `applyPerKeyColors` on reconnect stays unconditional (it pushes profile→keyboard, the desired direction).
- Bundled `%LOCALAPPDATA%` fw-env is the only firmware tree to edit (user rejected touching `C:\Users\phbronson\vial-qmk`); keymap.c there is hand-maintained, never app-overwritten.
- keymap.c handler keeps its own `raw_hid_send` (verified correct: via.c's trailing send never runs because `bootloader_jump()` doesn't return).
- Profile stays at version 3; `macroCount`/`bufferSize` come from `get_macro_info` rather than a schema bump.
- Profile-loaded == `currentFilePath !== null`; there is no "close profile" action, so `profileLoadedRef` is set-once-per-session.

## 5. Discoveries

- `MacroEditor`'s local `dirty` is never propagated to App's `isDirty` (pre-existing; unsaved VIA-macro edits don't show the header dot). Deferred — does not block next steps.
- `lightingPerKeyColors` is hardcoded to 4 layers while `layerCount` can reach 16 → `next[layer][ledIdx]` would throw for layer ≥ 4 (pre-existing, affects old and new code paths equally). Deferred.
- `stableStringify` sorts object keys so key insertion order can't fake a diff; arrays are order-sensitive by design.
- Firmware bootstrap constraint: auto-jump only works once both halves run firmware containing the new handler; first reflash is manual. Blocks the user's validation only until they reflash once.
- vial-qmk `rules.mk` sets `OPT_DEFS += -DVIAL_INSECURE` — any future VIA-command work must remember the secure-only command block is compiled out.

## 6. Verification steps

```powershell
# start the app (cargo not on PATH by default)
$env:PATH += ";$env:USERPROFILE\.cargo\bin"
npm run tauri dev
```
1. Confirm app builds and launches; connect keyboard; header shows device.
2. Quick regression of this session's work: change a key → dirty dot; revert it → dot clears. Shift-click two keys → assign color → both light. Record a macro → press Enter mid-recording → recording continues.
3. Open a profile, then replug the keyboard → log shows "Profile loaded — keeping editor state, not reading config from keyboard"; editor unchanged; after Open the app lands on Layer 0 (the un-reviewed Gap 2 edit — verify, then optionally run the reviewer on it).
4. Firmware validation (user was mid-pass): Build & Flash from the Firmware tab; first time, enter bootloader manually per half; afterwards "Jump to Bootloader" should produce a DFU device within ~20 s.
