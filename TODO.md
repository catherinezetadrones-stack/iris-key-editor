# Iris Key Editor — TODO

## Working Through This List

Work through one section per session, not the full list at once. Start each session with:
Work through the [section name] section of TODO.md only.
Use the planner subagent first, then implement and review each task
before moving to the next. Stop when all items in the section are done
and summarize what changed.

**Session rules:**
- Always invoke the planner subagent before writing any code
- Always invoke the reviewer subagent after each task is complete
- A task is not done until the reviewer returns a clean report or all flagged issues are resolved
- Do not move to the next task until the current one is verified

---

## UI / UX Bugs
- **Keyboard overlay layer recognition on `TO(n)` assignments** - I noticed that for layers that I have set to stay on a layer without holding down a modifier dont stay selected in the in the visual key test. If I toggle or just go directly to a layer it should stay in sync with they layer the keyboard is outputting.

> [!Correction] related to previous bug
after we attempted to fix this bug above. Now the reponse in the Key Test is much slower and the recognition of my `TO(n)` layer still isnt recognized.

## Firmware Bugs
- **fw-env pack is missing the tap-dance companion patches** - A fresh install on a new computer fails to compile with `multiple definition of 'get_tapping_term'` (vial.o vs keymap_introspection.o). Root cause: the editor's tap-dance codegen emits a keymap-level `get_tapping_term` that is meant to override the one in `quantum/vial.c`, but vial.c's definition is **strong** by default. The working setup depends on two manual edits to the bundled fw-env tree that are **not tracked in the repo and are lost on every fresh unpack**: (1) `quantum/vial.c` `get_tapping_term` made `__attribute__((weak))`, and (2) `keymaps/vial/config.h` `#define TAPPING_TERM 200`. These were re-applied by hand on this machine to unblock the build. **Durable fix needed:** make these patches survive a fresh install — bake them into the pack so `scripts/build-fw-env-pack.ps1` always stages a patched `vial.c`/`config.h` (e.g. apply a patch step during staging, or build the pack from a source tree that already carries them), so the toolchain pack is self-sufficient and no manual fw-env edits are required after extraction.

- **Distributed fw-env pack is missing `libusb-1.0.dll`** - Automated Build & Flash fails on a fresh install ("dfu-util exited with an error" with no dfu-util output), while the manual flash button works. Root cause: the two flash paths run different `dfu-util.exe` copies — the wizard (`flash_firmware_streamed`) uses the pack's `fw-env\bin\dfu-util.exe`, the manual button (`flash_firmware`) uses `src-tauri\binaries\dfu-util.exe`. The pack's `bin\` shipped **only** `dfu-util.exe` + `zadig.exe`, with **no `libusb-1.0.dll`**. That dfu-util is the dynamic build and imports `libusb-1.0.dll`, so it dies on launch with `0xC0000135 STATUS_DLL_NOT_FOUND`; the manual copy works because `src-tauri\binaries\` has the DLL beside it. Copied the DLL into `fw-env\bin\` by hand to unblock this machine. **Note:** `scripts/build-fw-env-pack.ps1` (lines ~107-111) already copies `libusb-1.0.dll` when it sits next to the source `dfu-util.exe`, so the script is correct — the shipped pack zip just predates that logic (or was built from a `dfu-util` source without the DLL). **Durable fix needed:** rebuild + redistribute the pack zip (built from `src-tauri\binaries\dfu-util.exe`, which has the DLL) so fresh installs include it; consider hardening the script to **fail** (not just warn) when the DLL is missing next to a dynamic dfu-util, or ship `dfu-util-static.exe` to remove the dependency entirely.

- **fw-env pack's `keymap.c` is missing the bootloader-jump handler** - Automated Build & Flash compiles and reaches "jumping to bootloader…" but no DFU device ever appears ("Still no DFU device — re-sending bootloader jump"), so flashing can't start; the same automated process works on the original build machine. Root cause: the keymap builds with `-DVIAL_INSECURE`, which **compiles out** VIA's own `id_bootloader_jump` (0x0B) case in `quantum/via.c` (`#if defined(VIAL_ENABLE) && !defined(VIAL_INSECURE)`). The design (see `usb_handler.rs::jump_bootloader` comment) expects the hand-maintained `keymaps/vial/keymap.c` to override `raw_hid_receive_kb` and handle 0x0B → `bootloader_jump()`. The build machine's `keymap.c` had this; the shipped pack's `keymap.c` did not (it had no `raw_hid_receive_kb` at all). Added it by hand this session (alongside the 0x59 Key Test layer handler). **Note:** the running firmware must already contain this handler for the auto-jump to work, so the first flash onto a board lacking it still needs manual bootloader entry (PCB reset / key combo); after that, auto-jump works. **Durable fix:** the pack's `keymap.c` must ship with the `raw_hid_receive_kb` that handles both 0x0B (bootloader jump) and 0x59 (active layer).

- **Rebuild + ship a corrected fw-env pack** - Consolidating task for the pack defects above: produce and distribute a new `iris-fw-env-vN.zip` that is self-sufficient on a clean machine. It must (1) carry the `quantum/vial.c` weak `get_tapping_term` + `keymaps/vial/config.h` `#define TAPPING_TERM 200` patches in its `vial-qmk` snapshot, (2) ship `keymaps/vial/keymap.c` with the `raw_hid_receive_kb` handler for 0x0B (bootloader jump) + 0x59 (active layer), and (3) include `bin\libusb-1.0.dll` next to `dfu-util.exe`. Build it with `scripts/build-fw-env-pack.ps1` using `src-tauri\binaries\dfu-util.exe` as the dfu-util source (the DLL sits beside it), from a `vial-qmk` source tree that already has all the patches applied. Verify on a fresh extract: automated Build & Flash compiles (no `get_tapping_term` link error), auto-jumps into the bootloader, AND flashes (pack `dfu-util.exe --version` runs, exit 0). Then bump the pack version and replace the shipped zip so new installs work without any manual fw-env edits.

- **Build & Flash cancelling may not be working** - I started to manually flash my firmware and then changed my mind and started to use the automated process of Build & Flash, I clicked the button but then realized I was already in bootloader mode so then I hit the cancel button. I proceeded to unplug and plug back in my keyboard. I started the automated process again but then noticed in the log double lines for everything happening in the compilation. This leads me to believe the `Cancel` button is not actually working as intended to stop all processes in the Build & Flash automated process at the users discretion

## Planned Features

### App UI / UX Improvements

_Straightforward changes to the existing interface_

### New App Features

_More substantial additions to the app itself_

### Firmware related App Features

_Require knowledge about firmware and may require web access for research_
