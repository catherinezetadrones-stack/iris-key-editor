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

**Scroll bar uniformity** - on the firmware tab there are two scroll bars (Main scroll bar for the page and scroll bar inside the log). These should match the scroll bar design from the rest of the app. For example the scroll bars inside the Keys Panel on the editor tab.

**Add a copy button to the log on firmware tab** This one is pretty straight forward but I would like to add a copy button to the log so that I can provide feedback easier when debugging.

### New App Features

_More substantial additions to the app itself_

**Save directly on the imported profile. Standard (Open, New, Save, SaveAs, Undo, Redo) operations** -  I would like to change the file operations to be more comparable to working with a file. Import is equivalent to `Open` and Export is equivalent to `Save As`. Once a profile is imported we should view that file name under the keyboard indicator and above the export and import buttons. When changes are made we should save directly on this profile. `New` should open a directory picker and allow the user to save the default keymap in the directory of choice and then `Open` that file. Im not sure the best way to incorporate the undo and redo logic and honestly is a secondary concern if it isn't going to be a standard implementation. If you feel confident with how to incorporate undo and redo then include it in this feature.

**Update the `keymap.c` with my in App built keymap** - I want to do this so that when I compile the firmware and do the subsequent flash of the firmware the settings I just finished will be available on the keyboard immediately without me needing to reload a profile. This coupled with the previous  


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

