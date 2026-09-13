# Manual routine editor — #388 and #389

## Scope and boundary

#388 lets an athlete create a local routine and add existing catalog exercises.
It does not create or mutate global exercises; that is #379 / PR #384. #389 is a
follow-up that edits the resulting routine: reorder, remove, and change contiguous
superset membership. Both operate on `routine_exercises`, but #389 must retain the
row id as the entry identity because history refers to it.

## Chosen interaction

The Routines tab gains a primary **New routine** action. It opens a native routine
editor with a required name, a quiet ordered exercise list, and **Add exercise**.
The picker is a searchable `FlatList` of the existing local catalog; selecting a
row appends it and returns to the editor. Creating saves one routine with explicit
default plans (one normal set) and opens its detail screen. An empty routine can be
saved and is visibly not startable, matching the existing engine guard.

```
Routine editor
< Routines                         Save
Routine name [__________________]

Exercises
  1   Bench Press                  ›
  2   Dumbbell row                 ›

     + Add exercise
```

This is a working notebook, not a dashboard: full-width rows make workout order
the dominant visual structure; no cards, gradients, or decorative metrics. The
editor uses the app's existing light/dark semantic theme colors and its strong blue
action color. Buttons and icon-only affordances have 44 pt minimum targets, sentence
case labels, useful VoiceOver labels, and disabled states that explain unavailable
save actions. On iOS, use SF Symbols where the project already supports them;
Android receives an equivalent native icon or text label.

## Data and tests

A pure state boundary will normalize the title, mint a routine id at submission,
append selected catalog ids in order, and produce `RoutineExerciseEntry[]` with
explicit default set plans. It validates the name before touching the database and
calls `upsertRoutine` once. Tests run in the Node Jest project against a real
in-memory Watermelon database; a structural test will pin the UI wiring because app
routes cannot render under Jest.

#389 may not reuse exercise id as entry identity: a routine can contain the same
exercise twice. Its edit command needs to address `routineExerciseId`, preserve
`session_sets` history, rewrite canonical zero-based order, and use
`groupBySupersetRuns` for any grouping read. A superset is a contiguous labelled
run; adding/removing a member must never silently merge equal labels across a gap.

## Alternatives rejected

- Creating exercises inside the editor would duplicate #379's validation and global
  ownership boundary.
- A modal card-builder or drag-and-drop grid obscures the primary signal (sequence),
  has poor VoiceOver affordance, and adds gesture complexity before #389.
- Treating supersets as a map keyed only by label would violate the existing
  contiguous-run engine contract.

## Human QA for the native editor

This route changes native layout and interaction, so PR #391 remains a draft in
**Require Human Inteteraction**. Do not merge, install, or replace an existing
phone build for this checklist.

1. In both light and dark appearance, open Routines and confirm **New routine**
   is a 44 pt primary action beside the quieter AI Coach entry point.
2. Open it, submit a whitespace-only name, and confirm the inline “Enter a
   routine name.” error keeps the editor open. Enter a name and leave the list
   empty; confirm the editor says it cannot be started yet, saving opens the
   routine detail, and its Start control is unavailable.
3. Create another routine. Select **Add exercise**, search for a catalog title,
   add it, and confirm the keyboard dismisses and the editor returns with the
   first ordered row. Add that same exercise again; both numbered rows must be
   present and save as distinct routine entries.
4. Save and confirm the routine detail opens with the selected exercise order.
   Return to Routines and confirm the routine appears once with the matching
   exercise count. Force-close/relaunch offline and confirm the saved routine
   persists.
5. With VoiceOver, verify labels for New routine, Routine name, Add exercise,
   Search exercises, each picker row, and the back controls; verify the icon
   actions never rely on the symbol alone.
