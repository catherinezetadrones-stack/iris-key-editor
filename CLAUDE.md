# IRIS-LM Editor

Tauri v1 + React (Vite) desktop app for configuring the **Iris LM-K Rev. 1** keyboard.
This app targets only the Iris LM-K — no other keyboard is in scope.

---

## What It Does

- Communicates with the keyboard over the VIA/HID protocol — no firmware flashing required for remapping
- Generates QMK `.c` source files and writes them to the correct build directories
- End-to-end verified on real hardware: device detection, keymap read, key remap via KeySelector, and EEPROM write all confirmed working

---

## Stack

- **Frontend:** Vite 4 + React (scaffolded with `create-vite@4` due to Node 18 constraint)
- **Backend:** Tauri v1 + Rust (`hidapi`, `via_protocol`, `usb_handler`, `dfu_flasher`)
- **Node.js:** v18.20.8 — do not use `create-vite@latest` if ever re-scaffolding; use `create-vite@4`

---

## Running the App

Cargo must be on PATH — it is not in the default shell PATH.

**PowerShell:**
```powershell
$env:PATH += ";$env:USERPROFILE\.cargo\bin"
npm run tauri dev
```

**Bash:**
```bash
export PATH="$PATH:/c/Users/phbronson/.cargo\bin" && npm run tauri dev
```

---

## Key Technical Details

**Keycodes:**
- `MO(n)` layer keys use `0x5220 | n` — confirmed working on real hardware
- All standard USB HID basic keycodes (`0x00–0xFF`) are present, organized into 11 categories with search
- F1–F24, full numpad, navigation, modifiers, and symbols all included
- Custom keycodes added to the library must already exist in the firmware's keycode space — the app is responsible for translating the keycode string name (e.g. `QK_BOOT`) to its corresponding numeric value; arbitrary or unrecognized strings are not valid

**Tabs currently in the app:**
`EDITOR` · `MACROS` · `TAP DANCE` · `COMBOS` · `LIGHTING` · `FIRMWARE` · `SETTINGS` · `KEY TEST`

**Code generation:**
- `.c` source file generation is already implemented and writes to the correct directories
- The Firmware tab UI for compilation is already designed — do not redesign it, only extend its functionality

---

## Planned Features

Tracked in `TODO.md` in the project root — do not implement anything from it without explicit instruction.

---

## Agent Rules

### Plan before implementing
For any task touching more than two files, invoke the `planner` subagent before writing any code.
For any task in the Firmware, QMK, or Research sections of TODO.md, use the `firmware-planner` subagent instead.
Do not begin implementation until the task list is returned and reviewed.

### Review after implementing
After completing any implementation task, invoke the `reviewer` subagent.
Pass it a one-paragraph description of what changed and why.
A task is not complete until the reviewer returns a clean report or all flagged issues are resolved.

The reviewer prompt must instruct the subagent to do all of the following — not just read the changed lines in isolation:

1. **Trace every call chain end-to-end.** For any new callback or event handler, follow the argument from the point it is created (e.g. a React synthetic event) through every wrapper function until it reaches the final consumer. Confirm each wrapper actually forwards the argument — `() => fn()` drops arguments silently while `(e) => fn(e)` does not.

2. **Check for undefined dereferences.** If a variable might be `undefined` at a call site (e.g. an event object passed through a wrapper that ignores its arguments), flag it as a bug even if it looks correct in isolation.

3. **Verify state consistency after every code path.** For new state variables, enumerate every path that modifies them and confirm the result is always consistent with dependent derived state or rendering logic.

4. **Read the files, do not reason from the summary alone.** The reviewer must read each changed file in full before reporting. Reasoning from a description without reading the code will miss implementation details.

### Keep subagents focused
Each subagent invocation must have a single, clearly scoped job.
Do not pass full conversation history to a subagent — summarize only what it needs.

### Model / cost discipline
- Subagent model: `claude-sonnet-4-6`
- Do not parallelize tasks that have dependencies — sequence them explicitly
- If a task requires reading more than 10 files, delegate the exploration to a subagent first and work from its summary