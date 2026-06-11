# IRIS-LM Editor

Tauri v1 + React (Vite) desktop app for configuring the **Iris LM-K Rev. 1** keyboard.
This app targets only the Iris LM-K — no other keyboard is in scope.

---

## What It Does

- Communicates with the keyboard over the VIA/HID protocol — no firmware flashing required for remapping
- Generates QMK `.c` source files and writes them to the correct build directories
- Compiles and flashes firmware in-app via a self-contained bundled toolchain (one-click Build & Flash in the Firmware tab)
- End-to-end verified on real hardware: device detection, keymap read, key remap via KeySelector, and EEPROM write all confirmed working

---

## Stack

- **Frontend:** Vite 4 + React (scaffolded with `create-vite@4` due to Node 18 constraint)
- **Backend:** Tauri v1 + Rust (`hidapi`, `via_protocol`, `usb_handler`, `dfu_flasher`, `fw_env`)
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
export PATH="$PATH:/c/Users/phbronson/.cargo/bin" && npm run tauri dev
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

**Firmware source tree (authoritative):**
- The bundled build environment at `%LOCALAPPDATA%\iris-key-editor\fw-env\vial-qmk\` is the authoritative firmware tree — all keymap/firmware edits go there (keymap dir: `keyboards\keebio\iris_lm\keymaps\vial\`)
- Do NOT edit `C:\Users\phbronson\vial-qmk\` — that older standalone checkout is no longer the source of truth
- `keymap.c` is hand-maintained in the bundled tree; the app only overwrites the generated sources (`keymap_layers.c`, `per_key_colors.c`, `scroll_text.c`, `tap_dance_keys.c`, `extra_macros.c`)
- The Build & Flash wizard compiles this tree via `compile_bundled` (bundled MSYS2 toolchain)

---

## Planned Features

Tracked in `TODO.md` in the project root — do not implement anything from it without explicit instruction.
Do not remove ANY items from `TODO.md` when task are complete - the user will manually remove items.

---

## Session Context Management

Long sessions degrade silently — context fills, important early details fall out of the window, and the session ends abruptly mid-implementation with no record of where things stand. This section governs how to handle that gracefully.

### Track context depth continuously

After completing each logical unit of work (a file, a function, a bug fix, a subagent invocation), pause and assess headroom. The session is approaching its limit when any of these are true:

- Multiple large files have been read or written this session
- Two or more subagent invocations have occurred
- The task still has significant work remaining and the conversation is already long
- You are about to start a new file or feature chunk and are uncertain you can finish it

When in doubt, stop early — an orderly handoff is always better than being cut off mid-function.

### Stop at a logical boundary

Never start a new file, function, or feature chunk without enough headroom to finish it. Complete the current atomic unit cleanly, then stop. A partial implementation left without documentation is worse than no implementation.

### Write RESUME.md before signaling the user

When stopping due to context pressure, write `RESUME.md` to the project root **before** telling the user. This file is the authoritative pickup document for the next session. Delete and rewrite it fresh each time — do not append to a previous version.

`RESUME.md` must contain all six sections below. Omitting any section defeats the purpose.

---

**1. Completed this session**
A concise, file-by-file list of every change made. Include the file path and a one-line description of what changed and why. If a subagent was used, note what it returned.

**2. Current state of in-progress work**
If anything was left unfinished, describe the exact file, the function or component, and the precise state it was left in. If nothing is in-progress, say so explicitly.

**3. Next steps — ordered and specific**
Not a summary. Actual instructions the next session can execute without re-reasoning. Each step should name the file, the action, and the expected outcome. Steps must be in dependency order.

**4. Decisions made this session**
Any architectural choices, tradeoffs, or "why we did it this way" notes that are not obvious from reading the code. The next session will not have this conversation's context — these notes replace it.

**5. Discoveries**
Bugs found but not yet fixed, edge cases identified, unexpected constraints, or anything that surprised you. Flag each with whether it blocks the next steps or can be deferred.

**6. Verification steps**
The exact commands the next session should run first to confirm the project is in the expected state before continuing (e.g. `npm run tauri dev`, a specific test, a build check).

---

### Signal the user

After writing `RESUME.md`, tell the user:

- That the session context is running low
- What was completed
- That `RESUME.md` has been written to the project root with full pickup instructions
- To start a new session, paste `RESUME.md` into the first message, and continue

Do not attempt any further implementation after this point. The next session will read `RESUME.md` and pick up from there.

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