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

- **Refined dirty flag** - If I change a key the dirty flag correctly shows there is a diff. However, if I manually revert the change back to the original, flag still shows there is a diff when there is nothing actually changed. If this is difficult, only report why it is difficult and what would be required...and we will do this item at another time.

- **Combos and Macros aren't loaded when I open a profile** - When on the combos or macros tab the configurations aren't visually loaded when I open a profile. I must navigate away to another tab and come back for the change to be seen.

- **Tap Dance Description on Main Keyboard layout** - If a key is assigned a tap dance then and that tap dance definition has a description, then the tooltip should show the tap dance description otherwise it falls back to its other options.

## Firmware Bugs

- **Build & Flash wizard does not auto-jump into bootloader mode** - During the one-click Build & Flash flow the "Waiting for half N in bootloader mode" step just sat there; the keyboard had to be put into bootloader mode manually (via the assigned key combo). The wizard's auto-jump path (`detect_devices` → `jump_bootloader` inside `flashHalf` in `FirmwarePanel.jsx`) needs investigation — e.g. whether `detect_devices` sees the board while the wizard is polling, whether the VIA HID handle is held open elsewhere, or whether the jump command needs a retry. Can be tested individually without a full Build & Flash run. This QMK doc may be a good resource to help solve this bug https://docs.qmk.fm/keycodes#quantum-keycodes

- **Loaded profile is source of truth** - When a profile is loaded (App.jsx state `currentFilePath !== null`), the profile is the source of truth — the app must NOT pull key configuration from the plugged-in keyboard. Only read configuration from the keyboard when NO profile is loaded. Concrete failure being fixed: during guided Build & Flash of this split keyboard, the user flashes one half, unplugs it, plugs in the OTHER half (which still has old config in EEPROM); the app detects the "new" device and pulls its stale keymap/macros into the editor state, so subsequently generated sources / saved profiles contain old data unless the user remembers to re-open the profile first.
The only time we should read key configuration from the keyboard is if there is no profile loaded

## Planned Features

### App UI / UX Improvements

_Straightforward changes to the existing interface_


### New App Features

_More substantial additions to the app itself_

### Firmware related App Features

_Require knowledge about firmware and may require web access for research_

**In-app compilation (bundled, keyboard-specific)**
_Phase 1 complete: compile via external QMK MSYS2 install with real-time log streaming in the Firmware tab._
