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

- **Multi select functionality does not assign per-key colors** - I tested the multi select functionality and was able to assign a keycode to several keys at once. This same type of multi assignment does not work for per-key color.

- **Macro recorder stops recording if 'enter' is hit** - when macro recording starts we need to remove focus from that the record button so that any key can be pressed during the recording without prematurely stopping the recording.

- **Refined dirty flag** - If I change a key the dirty flag correctly shows there is a diff. However, if I manually revert the change back to the original, flag still shows there is a diff when there is nothing actually changed.


## Firmware Bugs

- **Build & Flash wizard does not auto-jump into bootloader mode** - During the one-click Build & Flash flow the "Waiting for half N in bootloader mode" step just sat there; the keyboard had to be put into bootloader mode manually (via the assigned key combo). The wizard's auto-jump path (`detect_devices` → `jump_bootloader` inside `flashHalf` in `FirmwarePanel.jsx`) needs investigation — e.g. whether `detect_devices` sees the board while the wizard is polling, whether the VIA HID handle is held open elsewhere, or whether the jump command needs a retry. Can be tested individually without a full Build & Flash run.


## Planned Features

### App UI / UX Improvements

_Straightforward changes to the existing interface_


### New App Features

_More substantial additions to the app itself_

### Firmware related App Features

_Require knowledge about firmware and may require web access for research_

**In-app compilation (bundled, keyboard-specific)**
_Phase 1 complete: compile via external QMK MSYS2 install with real-time log streaming in the Firmware tab._

Phase 2 goal: make the full compile → bootload → flash cycle self-contained and seamless — no additional software installs required on any Windows machine.

- **Bundle the toolchain and QMK sources.** Ship the ARM toolchain and all QMK/vial-qmk source files needed for `keebio/iris_lm/k1 vial` directly inside the app. Our generated `.c` files (`keymap.c`, `keymap_layers.c`, `per_key_colors.c`, `tap_dance_keys.c`, `scroll_text.c`, `extra_macros.c`) should be written into this bundled source tree before each compile so the output always reflects the current app state. All environment management and setup should be configured through the App.
- **One-click compile All custom `c.` code → flash.** After a successful compile, auto-detect the keyboard's DFU bootloader port, invoke the bundled flash tool, and flash the keyboard without intermediate prompts. If bootload mode can be automated this is preferred otherwise the user will only need to prompted to trigger bootloader mode.
- **Progress and error reporting.** Real-time streaming output (already in place for compile) should extend through the flash step, with clear per-half success/failure indicators.

