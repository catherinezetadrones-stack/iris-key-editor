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

- **Per-Key lighting not working on left keyboard** - despite having the same firmware on both keyboards the per-key LEDs aren't working on my left keyboard when powered from either keyboard. Powering from either keyboard does correctly activate the per-key LEDs on the right keyboard so I think its probably a mapping issue with LEDs on the left board. Or there there should be additional updates to config.h and/or rules.mk. It could be the same reason the scroll text insnt working either (although this use case is more important).

- **Scroll text only renders on right board** — `rgb_matrix_indicators_advanced_user` bounds-check
  fix was applied to `keymap.c` (removed `led_min`/`led_max` guard, marked params
  `__attribute__((unused))`) but the issue persists after compile/flash. Root cause unknown —
  may be a split transport timing issue or the secondary half not receiving the color updates
  correctly. Needs further investigation.


## Planned Features

### App UI / UX Improvements

_Straightforward changes to the existing interface_

**Macros action text type too wide** - When the action of text is added to a macro a scroll bar shows up at the bottom. I think this is caused by the 'Remove Action' "x" placement isn't the same as the other action types. It is outside of the action box where the other actions have the "x" inside the their own action box. I'm not really sure why as it looks like all actions share the same `.action-remove-btn` class.

**Scroll bar uniformity** - on the firmware tab there are two scroll bars (Main scroll bar for the page and scroll bar inside the log). These should match the scroll bar design from the rest of the app. For example the scroll bars inside the Keys Panel on the editor tab. If a global default style for these scroll bars makes sense then please add that.

**File name is NOT centered under App Title** - when a profile is opened it now shows the file name under the App title. Unfortunately, this is not centered with the title and makes it look wrong. Make sure the App title, App Subtitle, and opened file are directly in the center of the App

**Layer selection experience** - when I use the arrow button to access additional layers the arrow is then replaced with the newly selected layer. I know I can click that layer again to show the dropdown list again but this is not obvious. Can you add some visual indicator to that selection to let me know it is still a dropdown list?

**Custom description in macro editor** - I would like to add a custom description per macro on the Macros tab. I think the description entry can replace the `macro-center-title`. The description should be stored in the our keymap

**Recording Macros in Compile Macros mode** - I should still be able to record macros in the Compile Macro (QMK Macros) mode. The functionality already exists there is no real reason to remove it.

**Slots in the QMK Macros mode are overlapping** - Currently all 31 slots are overlapping in this mode. A small scroll bar on the left is fine (matching the dark preferences use in the Keys Panel)


### New App Features

_More substantial additions to the app itself_

### Firmware related App Features

_Require knowledge about firmware and may require web access for research_

**In-app compilation (bundled, keyboard-specific)**
_Phase 1 complete: compile via external QMK MSYS2 install with real-time log streaming in the Firmware tab._

Phase 2 goal: make the full compile → bootload → flash cycle self-contained and seamless — no additional software installs required on any Windows machine.

**Firmware tab UI:** The existing design works as-is; no major redesign needed. The step order should be: Compile → Select firmware file → Enter bootloader → Flash. Everything else the user already knows how to do.

**Longer term:** The real ambition is that a user never needs to visit the Firmware tab at all. Changes made in the editor (keymaps, lighting, tap dance, etc.) should be push-able to the keyboard in one action — compile, detect the bootloader port, and flash both halves automatically without the user having to navigate away.

- **Bundle the toolchain and QMK sources.** Ship the ARM toolchain and all QMK/vial-qmk source files needed for `keebio/iris_lm/k1 vial` directly inside the app. Our generated `.c` files (`keymap.c`, `per_key_colors.c`, `tap_dance_keys.c`, `scroll_text.c`) should be written into this bundled source tree before each compile so the output always reflects the current app state.
- **One-click compile → flash.** After a successful compile, auto-detect the keyboard's DFU bootloader port, invoke the bundled flash tool, and flash both halves without prompts. The user only needs to trigger bootloader mode.
- **Progress and error reporting.** Real-time streaming output (already in place for compile) should extend through the flash step, with clear per-half success/failure indicators.

