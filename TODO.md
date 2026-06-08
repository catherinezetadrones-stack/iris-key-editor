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

- **Macro recorder stops recording if 'enter' is hit** - when macro recording starts we need to remove focus from that the record button so that any key can be pressed during the recording without prematurely stopping the recording.


## Firmware Bugs

- **Scroll text only renders on right board** — `rgb_matrix_indicators_advanced_user` bounds-check
  fix was applied to `keymap.c` (removed `led_min`/`led_max` guard, marked params
  `__attribute__((unused))`) but the issue persists after compile/flash. Root cause unknown —
  may be a split transport timing issue or the secondary half not receiving the color updates
  correctly. Needs further investigation.


## Planned Features

### App UI / UX Improvements

_Straightforward changes to the existing interface_

**Move COPY / PASTE / CLEAR and EXPORT / IMPORT to the top** Currently, COPY, PASTE, and CLEAR sit as three buttons on the left side of a row that falls between the tab bar and the editor canvas. EXPORT PROFILE and IMPORT PROFILE sit on the right side of that same row. That entire row — including both sets of buttons and the bar element itself that spans the full width and creates a visual dividing line — should be removed from its current position.

Those buttons should be relocated into the top bar area, specifically in a second row directly beneath the existing first row (which contains the layer selectors, the centered title, and the connection status indicator), and above the tab bar. They do not merge into the first row — they form their own dedicated row just below it, maintaining the horizontal layout they already have.

**Default new layers to blank (KC_NO) instead of transparent** When you press `+` to add a layer, it currently inherits from the layer below (transparent). You want new layers to start empty so you're always intentional about what's on them, rather than accidentally inheriting keys you didn't mean to.

**Multi-key selection with Shift-click** Currently you can only select and edit one key at a time. Shift-clicking should let you select a range, so you can assign a color, keycode, or tap dance to multiple keys at once — a big time saver for things like lighting zones or layer-wide assignments.


### New App Features

_More substantial additions to the app itself_

**Add custom keycodes to the keycode library** Allow keycodes that are already defined and understood by the firmware — such as quantum keycodes or other valid QMK identifiers — to be added to the key picker panel so they appear alongside built-in keycodes and can be assigned to keys. Because the firmware operates on numeric keycode values, the app must handle the translation from the keycode's string name (e.g. `QK_BOOT`) to its corresponding numeric value before sending it to the keyboard. Arbitrary or unrecognized strings are not valid — the keycode must already exist in the firmware's keycode space.

**Macro recorder and editor** Extend the existing MACROS tab to support recording keystrokes in real-time (capture mode), then display them as an editable sequence. Currently macros likely have to be built manually step-by-step.

**Global diff / compilation status indicator** A persistent status somewhere in the UI (header or status bar) that tracks whether your current layout differs from what's been flashed to the keyboard — essentially a dirty flag. Pairs with the compilation feature below so you always know if a flash is needed.


### Firmware related App Features

_Require knowledge about firmware and may require web access for research_

**Remove the VIAL lock mode**  Having to unlock the keyboard in order to update combo or key test kind of slows things down. Can we unlock this feature in the firmware?


**In-app compilation (bundled, keyboard-specific)** The app already generates the QMK `.c` source files and writes them to the correct directories — that part is done. The goal here is to go one step further and bundle the minimal subset of the QMK build toolchain required specifically for the Iris LM-K, so the full compilation can happen inside the app without requiring a separate QMK environment installed on the user's machine.

The motivation for bundling rather than depending on a full QMK install is footprint: a standard QMK setup is around 5GB because it ships with configurations for every supported keyboard. Since this app targets only the Iris LM-K, only the toolchain components relevant to that board need to be included, making a much leaner self-contained package realistic.

The UI design and interaction flow for this already exists on the Firmware tab and should be referenced from there — the intent here is purely about making the compilation step work end-to-end within the app, not about redesigning how it's presented.

I would like this this to be a fully automated process for this app, including flashing the new firmware using the QMK's `QK_BOOT` keycode to finalize the update of the keyboard.

