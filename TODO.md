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

- **Descriptions for Tap Dance** - I want to be able to add a description in the Tap Dance panel on the editor page. This should also be stored in the users keymap profile.

- **Descriptions for Combos** - I want to be able to add a description in the Combos tab, try to match the same position we did on the Macros tab. This should also be stored in the users keymap profile.

- **Descriptions on Keys in Key Picker** - In VIA they show descriptions for what keycodes. For example if `TO(0)` is selected, a description would be something like "Activates Layer, go 'TO' layer". We can use the QMK firmware docs to get the descriptions and then shorten or simplify them if it makes sense. The QMK keycodes are located here `https://docs.qmk.fm/keycodes`. This description should show in the key picker portion of the panel at the top, it should not scroll with the keys and it should have a default message if no key is selected.
The only overrides for these descriptions should be the descriptions we write to the user keymap profile for Macros and Tap Dance if they are present.

- **Enhanced Tooltips for editor keyboard** - Use the descriptions from the [previous task](Descriptions on Keys in Key Picker) to show as tooltip in the keyboard. Again, the only overrides to the descriptions are the custom ones we write to the user keymap profile for Macros and Tap Dance.


### New App Features

_More substantial additions to the app itself_

### Firmware related App Features

_Require knowledge about firmware and may require web access for research_

**In-app compilation (bundled, keyboard-specific)**
_Phase 1 complete: compile via external QMK MSYS2 install with real-time log streaming in the Firmware tab._
