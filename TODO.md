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

## Firmware Bugs
- **Build & Flash cancelling may not be working** - I started to manually flash my firmware and then changed my mind and started to use the automated process of Build & Flash, I clicked the button but then realized I was already in bootloader mode so then I hit the cancel button. I proceeded to unplug and plug back in my keyboard. I started the automated process again but then noticed in the log double lines for everything happening in the compilation. This leads me to believe the `Cancel` button is not actually working as intended to stop all processes in the Build & Flash automated process at the users discretion

## Planned Features

### App UI / UX Improvements

_Straightforward changes to the existing interface_
- **Add ability to delete a single layer** - Currently, I dont have the ability to delete a layer in app. I think a good place for this is next to the buttons (copy, paste, clear). It should have a pop up warning just like the clear button...After the delete the user can then save the modified layout manually. I don't think we need a "Delete and Save" option inside the delete modal.

### New App Features

_More substantial additions to the app itself_

### Firmware related App Features

_Require knowledge about firmware and may require web access for research_

**In-app compilation (bundled, keyboard-specific)**
_Phase 1 complete: compile via external QMK MSYS2 install with real-time log streaming in the Firmware tab._
