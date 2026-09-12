# Exercise Detail History Implementation Plan

> **For HMBWorkout:** Execute with the repository's draft-PR-first TDD workflow.

**Goal:** Add complete, read-only exercise history to the exercise detail view.

**Architecture:** Add a repository identity query for all set types, then a
presenter that owns completed-session filtering, grouping, ordering, labels,
and formatting. Keep the React Native screen as an async shell over that read
model.

**Tech Stack:** TypeScript, WatermelonDB, React Native, Expo Router, Jest.

### Task 1: Specify repository and presenter behavior

**Files:**
- Modify: `src/db/repository.test.ts`
- Create: `src/state/exerciseHistoryPresenter.test.ts`

Add focused failing cases for all set types, stamped/legacy identity,
completed-only grouping, workout and set order, labels, and shared formatting.
Commit the red tests before production code.

### Task 2: Implement the read model

**Files:**
- Modify: `src/db/repository.ts`
- Create: `src/state/exerciseHistoryPresenter.ts`

Share the identity-query implementation without changing the existing
working-only API. Build the smallest presenter that makes the focused tests
green.

### Task 3: Specify and wire the screen

**Files:**
- Create: `src/state/exerciseHistoryWiring.static.test.ts`
- Modify: `src/app/exercise/[id].tsx`

Commit a failing structural screen test, then add focus refresh, stale-result
protection, state messages, and grouped cards. Keep every hook above the
screen's early returns.

### Task 4: Verify and prepare human QA

Run only the three focused test files plus TypeScript/diff checks. Mutation-test
the repository filters, presenter completion/order/formatting rules, and screen
wiring; restore the exact source and rerun green tests. Obtain an independent
review, then build and verify an exact-head signed standalone Release artifact.
Move the issue only into `Require Human Inteteraction` and publish concrete
iPhone checks without installing the app.
