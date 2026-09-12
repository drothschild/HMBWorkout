# Exercise Description Popup Implementation Plan

**Goal:** Show the full stored exercise description in a small floating popup when the active-workout description cue is tapped, and dismiss it from any tap on the modal screen.

**Architecture:** Extend the pure session presenter with the already-loaded full description, then keep popup visibility and rendering local to `SetLogger`. Use React Native's transparent `Modal` and one full-screen `Pressable`; do not add engine events, persistence, navigation, or database reads.

**Tech Stack:** TypeScript, React 19, React Native 0.86 `Modal` and `Pressable`, Expo SDK 57, Jest structural and pure tests.

---

### Task 1: Pin the presenter contract

**Files:**
- Modify: `src/state/exerciseWorkoutDescription.static.test.ts`
- Modify: `src/state/sessionPresenter.test.ts`
- Modify: `src/state/sessionPresenter.ts`

1. Add failing tests showing that the presenter exposes the trimmed full current description, preserves internal line breaks, returns `undefined` for blank input, and follows the current exercise after replacement.
2. Run `npm test -- --runTestsByPath src/state/sessionPresenter.test.ts src/state/exerciseWorkoutDescription.static.test.ts --runInBand` and verify the new assertions fail because the full field is absent.
3. Commit only the failing tests with `test: define workout description popup behavior`.
4. Add `exerciseDescription` to `SessionPresenterOutput`, deriving it from the same current exercise description map used for the cue.
5. Run the same targeted command and verify the presenter assertions pass while the structural popup assertion still fails.

### Task 2: Add the floating popup

**Files:**
- Modify: `src/components/SetLogger.tsx`
- Modify: `src/state/exerciseWorkoutDescription.static.test.ts`

1. Extend the structural test to require a pressable cue, a transparent fading modal, full-screen dismissal, `onRequestClose`, a compact themed card, and the full presenter description as content.
2. Verify the targeted structural test fails for the missing interaction.
3. Commit the completed failing interaction test if it was not included in Task 1.
4. Add local popup visibility state to `SetLogger`, wrap the cue in an accessible `Pressable`, and render the floating modal. Use a full-screen `Pressable` as the sole touch target and disable card pointer events so every modal tap dismisses.
5. Run `npm test -- --runTestsByPath src/state/exerciseWorkoutDescription.static.test.ts src/state/sessionPresenter.test.ts --runInBand` and verify both files pass.

### Task 3: Review and QA preparation

**Files:**
- Modify: issue #368 and PR #369 metadata
- Create after review: `.worktrees/qa-artifacts/pr369-<head>/HMBWorkout.app`

1. Run `npx tsc --noEmit` and `git diff --check`.
2. Execute safe in-memory trigger and dismiss-wiring mutants; record killed, surviving, and invalid counts, then verify the targeted tests green again.
3. Verify the popup in an iOS simulator in light and dark appearance, including taps inside and outside the card. Record that simulator evidence does not release the physical human-QA gate.
4. Commit and push implementation and documentation updates.
5. Request an independent review of the exact head and execute at least one load-bearing claim independently.
6. After review approval, build a signed standalone Release artifact with embedded JavaScript and add its exact commit, path, install instructions, and concrete checks to issue #368.
7. Keep PR #369 draft and move issue #368 only into the existing `Require Human Inteteraction` column. Prompt the user before beginning the physical human-verification workflow.
