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

- **Key Test Design - should match editor keyboard** - We should have the identical layout between the two keyboards (Editor and Key Test [Visual not raw matrix] ). All the colors, symbols, labels, and description too. Its basically a read only version of the editor keyboard...but key test just allows us to see our layers in real time. Which will hopefully help us on our new app feature.

### New App Features

_More substantial additions to the app itself_
- **Keyboard Overlay mode for key tester visual** - I want to be able to hit a button on the key test page and essentially, visually remove everything else in the entire app and just have a custom keyboard overlay for my computer with all the responsiveness that it currently has  - (It may need to be a separate window instead but not sure what would be best). It would be nice if I could resize the window for the key overlay so I can put it different part of my screen should I wish. I would be nice if the window was pinned 'On Top' of other windows...meaning that I could still interact with all other windows but see keyboard overlay. There should be an adjustable transparency for the background of overlay but default should be close to completely transparent. There should be a clear way to exit the overlay which should return you to the main App.

### Firmware related App Features

_Require knowledge about firmware and may require web access for research_
