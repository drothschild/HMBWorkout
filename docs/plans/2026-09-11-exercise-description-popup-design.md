# Exercise Description Popup Design

## Goal

Let an athlete tap the one-line description cue during an active workout to read the exercise's full stored description in a small floating box. A tap anywhere on the modal screen dismisses it.

## Design

The session screen already loads full exercise descriptions and passes them into `createSessionPresenter`. The presenter will expose both the existing first-line cue and a trimmed full description for the current exercise. This keeps database access in the screen shell and display shaping in the presenter; the engine and persisted workout state remain unchanged.

`SetLogger` will turn the existing blue cue into a `Pressable`. Pressing it opens a transparent React Native `Modal` with a dimmed full-screen `Pressable` backdrop and a compact centered card. The card has pointer events disabled so a tap on either the backdrop or card reaches the same dismiss handler, making the user's “anywhere on the screen” requirement literal. Android's back action will use the same handler through `onRequestClose`.

The modal uses the current theme background and existing text components. It shows the complete normalized description, preserving internal line breaks. Missing or whitespace-only descriptions continue to render no cue and cannot open a modal.

## Verification

- Pure presenter tests prove the full description is trimmed, preserved, switched after exercise replacement, and absent for blank values.
- A structural test proves the existing cue is pressable, opens the modal, displays the full description, and wires backdrop/card/Android dismissal to the same state change.
- Safe in-memory mutations remove the trigger or dismissal wiring and must be rejected by the targeted test.
- Simulator verification checks centered floating-card layout, light/dark appearance, long text, and dismissal from both inside and outside the card.
- Because this changes interaction and layout, the PR stays draft in `Require Human Inteteraction` until the user releases the physical-device QA gate.
