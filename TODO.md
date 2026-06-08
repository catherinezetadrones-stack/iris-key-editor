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


### New App Features

_More substantial additions to the app itself_

**Auto determine which tap dance entry we are creating or modifying** When we define a per key tap dance and save our profile, this in app defined tap dance is not associated with the tap dance keycode that will be brought in when we compile this into the firmware. It would be great if this determination was made in app and saved to our profile so that after that firmware is flashed to the device and we reload our profile the proper tap dance key code comes in without me manual intervention.


### Firmware related App Features

_Require knowledge about firmware and may require web access for research_

**Remove the VIAL lock mode**  Having to unlock the keyboard in order to update combo or key test kind of slows things down. Can we unlock this feature in the firmware?


**In-app compilation (bundled, keyboard-specific)** The app already generates the QMK `.c` source files and writes them to the correct directories — that part is done. The goal here is to go one step further and bundle the minimal subset of the QMK build toolchain required specifically for the Iris LM-K, so the full compilation can happen inside the app without requiring a separate QMK environment installed on the user's machine.

The motivation for bundling rather than depending on a full QMK install is footprint: a standard QMK setup is around 5GB because it ships with configurations for every supported keyboard. Since this app targets only the Iris LM-K, only the toolchain components relevant to that board need to be included, making a much leaner self-contained package realistic.

The UI design and interaction flow for this already exists on the Firmware tab and should be referenced from there — the intent here is purely about making the compilation step work end-to-end within the app, not about redesigning how it's presented.

I would like this this to be a fully automated process for this app, including flashing the new firmware using the QMK's `QK_BOOT` keycode to finalize the update of the keyboard.

