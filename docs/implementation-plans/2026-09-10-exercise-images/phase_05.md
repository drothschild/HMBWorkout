# Exercise Images Implementation Plan — Phase 5: Display at four sites

**Goal:** Show the cached image wherever an exercise appears — exercise detail (hero), session screen (beside the title), routine detail rows, and a thumbnail strip on each Routines tab card — with a neutral placeholder when there is none.

**Architecture:** Presenters carry **relative paths only** (never URIs); one component, `ExerciseImage`, turns a path into a `file://` URI at render. Image paths are keyed on `exerciseId`, mirroring how `getExerciseTitles` / `exerciseTitles` already work (engine convention 6: display data is resolved shell-side, never in engine state) — which is what makes a Replace swap show the new exercise's image with no extra logic. The session screen re-reads paths on every `exercises` change so an image resolved mid-workout appears in place.

**Tech Stack:** React Native 0.86 / React 19, expo-image 57.0.3, expo-file-system 57, WatermelonDB, Jest (presenters + structural tests).

**Scope:** Phase 5 of 7 from `docs/design-plans/2026-09-10-exercise-images.md`. Depends on Phase 4.

**Codebase verified:** 2026-09-10

---

## Verified current state

- `getExerciseTitles(database, exerciseIds): Promise<Record<string, string>>` — `src/db/repository.ts:321-337`: loops ids, `find`s each, omits missing ones.
- `createSessionPresenter(sessionState, dispatch, progressionHint?, exerciseTitles?, routineDisplay?)` — `src/state/sessionPresenter.ts:610-621`; `currentExerciseTitle = exerciseTitles?.[currentExerciseId] || currentExerciseId` at `:621`. `SessionPresenterOutput` is the interface at `:22-125`. **Only one production caller**: `src/app/session.tsx:485-491` (positional). No test constructs a `SessionPresenterOutput` literal, so a new required output field breaks nothing. Its tests are `src/state/sessionPresenter.test.ts` (general) and `src/state/sessionPresenter.perSet.test.ts` (per-set labels).
- `session.tsx`: `getDatabase()` is a lazy `require('@/db')` helper (`:80-86`); titles load in an effect keyed `[sessionState?.sessionId, entryExerciseIdsKey]` (`:336-356`), where `entryExerciseIdsKey` joins entry exerciseIds with `|` — so a Replace swap already re-runs it.
- `SetLogger` (`src/components/SetLogger.tsx`): props interface `SetLoggerProps` (`:51-80`) takes `presenter: SessionPresenterOutput`; the title row is at `:152-167`; styles `exerciseTitleRow` (row, center, space-between), `exerciseTitle` (`flexShrink: 1`, 20/26, 600), `questionButton` (26×26) near `:427-450`.
- `routineDetailPresenter` (`src/state/routineDetailPresenter.ts`) already loads each exercise row into `exerciseMap` (`:101-111`) and builds `ExerciseDetail` in `toDetail` (`:120-135`). Test file: `src/state/routineDetailPresenter.test.ts`.
- `routineListPresenter` (`src/state/routineListPresenter.ts`) queries each routine's `routine_exercises` **without sorting** (`:37-40`). Test file: `src/state/routineListPresenter.test.ts`.
- `src/app/routine/[id].tsx`: `ExerciseRow` (`:26-69`) is a `Pressable` with style `exerciseItem` (`flexDirection: 'row'`, `alignItems: 'center'`) containing `<View style={styles.exerciseInfo}>` (`flex: 1`); loads via `useFocusEffect` (`:81-97`).
- `src/app/(tabs)/routines.tsx`: each card (`:110-133`) is a row `Pressable` with `<View style={styles.routineInfo}>` holding name + `"{n} exercises"`; the list reloads by **polling every 2000 ms** (`:48-54`) — so new thumbnails appear on their own.
- `src/app/exercise/[id].tsx`: hooks at the top — `useState`s (`:21-24`), the mount load effect (`:26-41`), `useRef`s (`:43-45`), `useCallback` flush/queueSave (`:50-~90`) — then **early returns** at `:94` (`if (!id || loading)`) and `:104` (`if (!exercise)`). Renders title (`:133-135`), kind, caption, then the Description form group (`:148-164`). **Every new hook in this screen goes above `:94`**, in that top block — a hook placed after an early return breaks the Rules of Hooks ("Rendered more hooks than during the previous render") on a screen no test can load.
- Theme: `useTheme()` from `@/hooks/use-theme`; `theme.backgroundElement` (light `#F0F0F3`, dark `#212225`) is the neutral fill. `expo-image` is already a linked native dependency (`src/components/animated-icon.tsx` imports it), and `expo-file-system` is used by `src/app/(tabs)/settings/data.tsx` — **no `expo prebuild` is needed for this phase.**
- `src/app` and `src/components` layout is invisible to jest (AGENTS.md "Testing gotchas"): verify layout on the simulator; gate wiring with structural tests.

## Acceptance Criteria Coverage

### exercise-images.AC2: Background resolution, retry, and backfill
- **exercise-images.AC2.9 Success:** Opening the exercise detail screen or the session screen on an exercise that has no image requests a pass. *(Structural test.)*

### exercise-images.AC3: Storage and display
- **exercise-images.AC3.4 Success:** `routineDetailPresenter` exposes `imagePath` on each `ExerciseDetail`, null when unresolved.
- **exercise-images.AC3.5 Success:** `routineListPresenter` exposes `thumbnailPaths`: at most 4, distinct by exercise, in routine order, skipping exercises without an image.
- **exercise-images.AC3.6 Success:** `createSessionPresenter` exposes `currentExerciseImagePath` from a caller-supplied `exerciseImagePaths` map, null when the exercise has none.
- **exercise-images.AC3.7 Success:** The session screen re-reads image paths when `exercises` changes, so an image resolved mid-workout appears without leaving the screen (structural test on the effect, plus simulator).
- **exercise-images.AC3.8 Success (manual):** All four sites render the image, and a placeholder where there's none.
- **exercise-images.AC3.10 Edge (manual):** With a long exercise name, the session header's controls stay on screen and tappable.

### exercise-images.AC4: Identity and manual override
- **exercise-images.AC4.1 Success:** After a Replace swap, the session and routine detail screens show the new exercise's image, because image paths are keyed on `exerciseId` (presenter test plus simulator).

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: `getExerciseImagePaths` repository read

**Verifies:** supports exercise-images.AC3.6 (the map's source)

**Files:**
- Modify: `src/db/repository.ts` — add after `getExerciseTitles` (`:321-337`)
- Test: `src/db/exerciseImageWrites.test.ts` (extend the Phase 4 file; it already has DB setup)

**Implementation:** mirror `getExerciseTitles` exactly:

```ts
/**
 * exerciseId → image_path (RELATIVE to the documents directory) for the given
 * ids (#335). Ids with no image, and ids whose exercise no longer exists, are
 * left out — the caller reads absence as "placeholder". The display-data twin
 * of getExerciseTitles (engine convention 6: engine state carries ids only).
 */
export async function getExerciseImagePaths(
  database: Database,
  exerciseIds: string[]
): Promise<Record<string, string>> {
  const paths: Record<string, string> = {};
  for (const exerciseId of exerciseIds) {
    try {
      const exercise = (await database.get('exercises').find(exerciseId)) as Exercise;
      if (exercise.imagePath) paths[exerciseId] = exercise.imagePath;
    } catch {
      // Exercise no longer exists; leave it out.
    }
  }
  return paths;
}
```

**Testing:** a resolved exercise appears with its path; an unresolved one (null path) is absent; an unknown id is absent and does not throw; duplicate ids are harmless.

**Verification:** `npx jest src/db/exerciseImageWrites.test.ts` — all pass.

**Commit:** `feat(#335): getExerciseImagePaths repository read`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Session presenter exposes `currentExerciseImagePath`

**Verifies:** exercise-images.AC3.6, exercise-images.AC4.1 (session presenter half)

**Files:**
- Modify: `src/state/sessionPresenter.ts` — `SessionPresenterOutput` (`:22-125`), `createSessionPresenter` signature and body (`:610-621`), and its JSDoc (`:600-609`)
- Test: `src/state/sessionPresenter.test.ts` — add a `describe('currentExerciseImagePath — #335')`

**Implementation:**
- Add a 6th optional positional parameter, after `routineDisplay`: `exerciseImagePaths?: Record<string, string>`. Positional keeps the one caller's shape; document it in the JSDoc exactly like `exerciseTitles` ("Optional exerciseId → relative image path map resolved by the caller (getExerciseImagePaths). Engine state carries only ids, so image paths must be looked up shell-side.").
- Add to `SessionPresenterOutput`: `/** Relative image path of the current exercise, or null (placeholder). Keyed on exerciseId, so a Replace swap follows the entry. */ currentExerciseImagePath: string | null;`
- In the body, next to `currentExerciseTitle`: `const currentExerciseImagePath = exerciseImagePaths?.[currentExerciseId] ?? null;` and include it in the returned object.

**Testing:**
- **AC3.6**: with `exerciseImagePaths = { 'bench-press': 'exercise-images/bench-press-a1.jpg' }` and the current entry on `bench-press` → `'exercise-images/bench-press-a1.jpg'`; with the map omitted → `null`; with the map present but lacking the current id → `null`.
- **AC4.1** (presenter half): build a session state whose current entry's `exerciseId` is `'bench-press'`, then the same state with that entry's `exerciseId` replaced by `'dumbbell-press'` (what a `ReplaceExercise` Ok leaves behind — engine convention 7), same map containing both ids → the output follows the entry: first `bench-press`'s path, then `dumbbell-press`'s. Reuse the session-state fixture builder `sessionPresenter.test.ts` already uses.

**Verification:** `npx jest src/state/sessionPresenter.test.ts` — all pass.

**Commit:** `feat(#335): session presenter exposes the current exercise's image path`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Routine presenters expose `imagePath` and `thumbnailPaths`

**Verifies:** exercise-images.AC3.4, exercise-images.AC3.5, exercise-images.AC4.1 (routine detail presenter half)

**Files:**
- Modify: `src/state/routineDetailPresenter.ts` — `ExerciseDetail` (`:6-30`), `exerciseMap` (`:101-111`), `toDetail` (`:120-135`)
- Modify: `src/state/routineListPresenter.ts` — `RoutineListItem` (`:5-23`) and the loop (`:35-56`)
- Test: `src/state/routineDetailPresenter.test.ts`, `src/state/routineListPresenter.test.ts`

**Implementation — detail:** add `/** Relative image path (#335), null while unresolved or when no image was found. */ imagePath: string | null;` to `ExerciseDetail`; widen `exerciseMap`'s value with `imagePath: string | null` read as `(exercise as any)._raw.image_path ?? null` (match the `description` line's style); set `imagePath: exerciseInfo?.imagePath ?? null` in `toDetail`. Because the map is keyed by the row's `exercise_id`, a re-pointed row (Replace) reads the new exercise's image.

**Implementation — list:** add `/** Up to 4 relative image paths (#335): distinct by exercise, in routine order, exercises without an image skipped. */ thumbnailPaths: string[];` to `RoutineListItem`. In the loop:
- Sort the fetched `routineExercises` by `_raw.order` ascending (they are currently unsorted — "routine order" needs it; `routineDetailPresenter` does the same at `:98`).
- Walk them in order, keeping a `Set` of seen `exercise_id`s; for each unseen id, `find` the exercise (wrap in try/catch — a missing exercise is skipped) and push its `image_path` if non-null; stop at 4. Mark the id seen **whether or not** it had an image (distinct by exercise, not by path).
- Export `const ROUTINE_THUMBNAIL_LIMIT = 4;` and use it.

**Testing:**
- **AC3.4** (detail): a routine with two exercises, one resolved (set via `setExerciseImage`) and one not → the resolved one's `ExerciseDetail.imagePath` is its path, the other's is `null`. Check both a standalone entry and a superset member (both code paths go through `toDetail`).
- **AC4.1** (detail half): after `updateRoutineExerciseExerciseId(db, rowId, 'new-exercise')` (the Replace path's routine re-point; see `src/db/replaceRoutineExercise.test.ts` for setup) where `new-exercise` has its own image, the row's `imagePath` is the new exercise's path.
- **AC3.5** (list): seed exercises `a`–`f` with `upsertExercise`, give `a`, `c`, `d`, `e`, `f` images via `setExerciseImage` (paths `pa`, `pc`, … ) and leave `b` without one. Create the routine and its `routine_exercises` rows **directly** in one `database.write` (the `_raw` style of `src/db/migrationV7ToV8.test.ts`'s `seedDropSet`), **creating them in this scrambled sequence** so creation order and `order` disagree: `e` (order 4), `a` (order 0), `f` (order 5), `c` (order 3), `b` (order 1), `a` again (order 2), `d` (order 6)… — i.e. routine order is `a, b, a, c, e, f, d`. Expected `thumbnailPaths` = `[pa, pc, pe, pf]`: `b` skipped (no image), the second `a` not repeated, `d` beyond the limit. Because creation order starts with `e`, an implementation that forgets to sort returns a different list — confirm this by temporarily removing the sort once and watching the test fail, then restore it. A routine with no images → `[]`.

**Verification:** `npx jest src/state/routineDetailPresenter.test.ts src/state/routineListPresenter.test.ts` — all pass.

**Commit:** `feat(#335): routine presenters expose exercise image paths`
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 4-6) -->

<!-- START_TASK_4 -->
### Task 4: `ExerciseImage` component

**Verifies:** None automated (rendering; covered by the simulator check in Task 6 — AC3.8).

**Files:**
- Create: `src/components/ExerciseImage.tsx`

**Implementation:**

```tsx
// pattern: Imperative Shell
/**
 * One exercise image, from the file the resolver stored under the documents
 * directory (#335). Takes a RELATIVE path and builds the file:// URI at render
 * time — never store the URI, iOS moves the container on reinstall/restore.
 * expo-image's own cache is evictable, which is why the app keeps its own file
 * and why this reads that file directly. Null, or a file that fails to load,
 * renders a neutral placeholder of the same size.
 */
import { Image } from 'expo-image';
import { File, Paths } from 'expo-file-system';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

export type ExerciseImageSize = 'hero' | 'row' | 'strip';

interface ExerciseImageProps {
  imagePath: string | null;
  size: ExerciseImageSize;
}

export function ExerciseImage({ imagePath, size }: ExerciseImageProps) {
  const theme = useTheme();
  const [failedPath, setFailedPath] = useState<string | null>(null);
  const frame = [styles.base, styles[size], { backgroundColor: theme.backgroundElement }];

  if (imagePath === null || failedPath === imagePath) {
    return <View style={frame} accessibilityLabel="No exercise image" />;
  }
  return (
    <Image
      style={frame}
      source={{ uri: new File(Paths.document, imagePath).uri }}
      contentFit="cover"
      recyclingKey={imagePath}
      onError={() => setFailedPath(imagePath)}
      accessibilityIgnoresInvertColors
    />
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: 6, overflow: 'hidden' },
  hero: { width: '100%', aspectRatio: 3 / 2 },
  row: { width: 48, height: 48 },
  strip: { width: 32, height: 32 },
});
```

Sizes: `hero` on the detail screen (3:2, full width); `row` (48 pt) on the session title row and routine detail rows (the design's "~48" and "~40" collapse to one size); `strip` (32 pt) on routine cards. Check how `useTheme` is typed (`src/hooks/use-theme.ts`) and that `backgroundElement` is a key; if `accessibilityIgnoresInvertColors` is not an `expo-image` prop in the installed d.ts, drop it.

**Verification:** `npx tsc --noEmit` and `npm run lint` — no new errors.

**Commit:** with Task 5.
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Render at the four sites; first-view retry; session re-read on `exercises` changes

**Verifies:** exercise-images.AC2.9, exercise-images.AC3.7 (structural halves)

**Files:**
- Modify: `src/components/SetLogger.tsx` — title row (`:152-167`) and styles (`~:427-450`)
- Modify: `src/app/session.tsx` — new state + effect beside the titles effect (`:336-356`); pass the map to `createSessionPresenter` (`:485-491`)
- Modify: `src/app/routine/[id].tsx` — `ExerciseRow` (`:26-69`)
- Modify: `src/app/(tabs)/routines.tsx` — routine card (`:110-133`) and styles
- Modify: `src/app/exercise/[id].tsx` — image state + observe effect in the top hook block (above `:94`), first-view request in the load effect, hero under the title (`:133-135`)
- Test: `src/state/exerciseImageWiring.static.test.ts` (structural)

**Implementation — `SetLogger.tsx`:** make the image the first child of `exerciseTitleRow`:
```tsx
<View style={styles.exerciseTitleRow}>
  <ExerciseImage imagePath={presenter.currentExerciseImagePath} size="row" />
  <ThemedText style={styles.exerciseTitle}>{presenter.currentExerciseTitle || 'Exercise'}</ThemedText>
  {showQuestionButton && ( /* unchanged */ )}
</View>
```
and change `exerciseTitle` from `flexShrink: 1` to `flex: 1` plus `marginLeft: Spacing.two`, so a long name wraps between a fixed-size image and a fixed-size `?` button (AC3.10) instead of pushing the button off screen. `justifyContent: 'space-between'` on the row has no effect once the middle child is `flex: 1`; leave or remove it.

**Implementation — `session.tsx`:** beside `exerciseTitles` (these hooks sit with the other top-level hooks, before the screen's own early return for "No active session"):
```tsx
const [exerciseImagePaths, setExerciseImagePaths] = useState<Record<string, string>>({});

// Exercise images (#335): re-read on EVERY `exercises` change, not just when
// the entry list changes, so an image the background resolver finishes
// mid-workout appears in place (AC3.7). withChangesForTables emits once on
// subscribe, so this is also the initial load. On that first load, if any
// entry's exercise has no image, ask for a pass (first-view retry, AC2.9).
useEffect(() => {
  if (!sessionState) {
    setExerciseImagePaths({});
    return;
  }
  const db = getDatabase();
  const ids = (sessionState.entries ?? []).map((entry: any) => entry.exerciseId);
  let cancelled = false;
  let latestRead = 0;
  let requestedPass = false;
  const subscription = db.withChangesForTables(['exercises']).subscribe(() => {
    const read = ++latestRead;
    getExerciseImagePaths(db, ids)
      .then((paths) => {
        // Reads can resolve out of order; only the newest may land, or a stale
        // map could stick with no later emission to correct it.
        if (cancelled || read !== latestRead) return;
        setExerciseImagePaths(paths);
        if (!requestedPass && ids.some((id: string) => !paths[id])) {
          requestedPass = true;
          requestExerciseImagePass();
        }
      })
      .catch((error) => console.error('Failed to load exercise images:', error));
  });
  return () => {
    cancelled = true;
    subscription.unsubscribe();
  };
}, [sessionState?.sessionId, entryExerciseIdsKey]);
```
(`requestedPass` is per effect run, so resolver writes that re-fire the subscription never re-request — no loop.) Add `exerciseImagePaths` as the 6th argument of the `createSessionPresenter(...)` call at `:485-491`. Import `getExerciseImagePaths` from `@/db/repository` and `requestExerciseImagePass` from `@/state/exerciseImageResolverRegistry`. Confirm the placement relative to the screen's "No active session" early return (`~:470-483`) — the new hooks must be above it, next to the titles effect.

**Implementation — `routine/[id].tsx`:** inside `ExerciseRow`'s `Pressable`, before `<View style={styles.exerciseInfo}>`: `<ExerciseImage imagePath={exercise.imagePath} size="row" />`, and give `exerciseInfo` `marginLeft: Spacing.two`.

**Implementation — `(tabs)/routines.tsx`:** inside `routineInfo`, after the `"{n} exercises"` text:
```tsx
{item.thumbnailPaths.length > 0 && (
  <View style={styles.thumbnailStrip}>
    {item.thumbnailPaths.map((path) => (
      <ExerciseImage key={path} imagePath={path} size="strip" />
    ))}
  </View>
)}
```
with `thumbnailStrip: { flexDirection: 'row', gap: Spacing.one, marginTop: Spacing.one }`. (Paths are distinct by construction, so `key={path}` is a stable unique key. A card with no images shows no strip rather than four placeholders.)

**Implementation — `exercise/[id].tsx`** — all hooks in the top block, **above the `:94` early return**:
- Beside the existing `useState`s (`:21-24`): `const [imagePath, setImagePath] = useState<string | null>(null);`
- In the existing load effect (`:26-41`), after `setExercise(found)`: `setImagePath(found.imagePath ?? null); if (!found.imagePath) requestExerciseImagePass();` (first-view retry, AC2.9).
- A new effect directly after the load effect (still above `:94`) keeps the hero live while the screen is open (the resolver may finish after mount):
  ```tsx
  useEffect(() => {
    if (!exercise) return;
    const subscription = exercise.observe().subscribe((record) => setImagePath(record.imagePath ?? null));
    return () => subscription.unsubscribe();
  }, [exercise]);
  ```
- Render `<ExerciseImage imagePath={imagePath} size="hero" />` directly under the title `ThemedText` (`:133-135`), with a small top margin.

**Testing — `src/state/exerciseImageWiring.static.test.ts`** (pattern: `sessionPrefillWiring.static.test.ts`; read sources with `readFileSync(join(__dirname, '..', 'app', 'session.tsx'), 'utf8')` etc.; normalize whitespace; anchor on identifiers; throw "re-anchor this gate" if a marker is missing):
- **AC3.7**: in `session.tsx`, locate the effect that contains `withChangesForTables(['exercises'])` (the region from that marker to the effect's closing dependency array); assert that region contains `getExerciseImagePaths(`, `setExerciseImagePaths(`, and `.unsubscribe()`; and its dependency array (use the template's `dependencyArrayAfter`-style extraction from the marker — the first `}, [ … ]);` after it) as a **set** equals `{'sessionState?.sessionId', 'entryExerciseIdsKey'}`.
- **AC3.6 wiring**: the `createSessionPresenter(` call's argument list contains `exerciseImagePaths`.
- **AC2.9**: `session.tsx` and `exercise/[id].tsx` each contain `requestExerciseImagePass()`; in `exercise/[id].tsx` it is guarded by the no-image check (assert the normalized source contains `if(!found.imagePath)requestExerciseImagePass();`).
- **Hook placement guard** for `exercise/[id].tsx` (whitespace-stripped source): anchor on the hook's **own declaration**, `const[imagePath,setImagePath]=useState`, and on `exercise.observe()`. Assert each occurs exactly once and that both indices are **less than** the index of the first early return `if(!id||loading)` — a structural stand-in for the Rules-of-Hooks crash no test can render. Do **not** anchor on `useState<string|null>(null)`: that text already exists at `:24` (`saveError`), so `indexOf` would find it first and pass regardless of where the new hook goes. Before committing, move the `imagePath` `useState` below the early return once, watch the guard fail, and restore.
- Rendering wiring (cheap and catches a dropped site): `SetLogger.tsx` contains `<ExerciseImage` with `presenter.currentExerciseImagePath`; `routine/[id].tsx` contains `imagePath={exercise.imagePath}`; `(tabs)/routines.tsx` contains `item.thumbnailPaths`; `exercise/[id].tsx` contains `size="hero"`.

**Verification:**
- Run: `npx jest src/state/exerciseImageWiring.static.test.ts` — all pass.
- Run: `npx tsc --noEmit` (see AGENTS.md for stale route-type false positives) and `npm run lint` — no new errors (`react-hooks/rules-of-hooks` is the second line of defence for hook placement).

**Commit:**
```bash
git add src/components/ExerciseImage.tsx src/components/SetLogger.tsx src/app/session.tsx 'src/app/routine/[id].tsx' 'src/app/(tabs)/routines.tsx' 'src/app/exercise/[id].tsx' src/state/exerciseImageWiring.static.test.ts
git commit -m "feat(#335): show exercise images at the four display sites"
```
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Simulator check (AC3.8, AC3.10, AC4.1)

**Verifies:** exercise-images.AC3.8, exercise-images.AC3.10, exercise-images.AC4.1 (manual, on the simulator)

**Files:** none (verification only).

**Steps:** Use the project's `running-in-simulator` skill (invoke it — it covers finding the dev-client build, starting one clean Metro, deep links, taps via computer-use when the simulator MCP can't see the device, and reading SQLite ground truth). Notes specific to this phase:
- No new native module was added (fuse.js is JS; expo-image and expo-file-system are already linked), so the existing dev-client build is fine; start Metro with `--clear` anyway.
- Seed: a routine with at least one well-matched title (e.g. "Romanian Deadlift"), one no-match title ("Couch Stretch"), and one **very long** title (e.g. "Single-Arm Half-Kneeling Landmine Press With Rotation Hold").
- Confirm in SQLite (per the skill) that `exercises.image_path` / `image_source` populate, and that the file exists under the app container's `Documents/exercise-images/`.
- **AC3.8**: exercise detail shows the hero; routine detail rows show 48-pt thumbnails; the Routines tab card shows the strip; the session screen shows the image beside the title; the no-match exercise shows the placeholder at all four sites.
- **AC3.10**: on the long-title exercise in a session, the `?` button stays on screen and tappable (tap it; the answer block expands).
- **AC4.1**: during a session, use Replace on an exercise to swap it for one with a different image; the session header and (after returning) routine detail show the new exercise's image.
- **AC3.7**: start a session on an exercise whose image is not yet resolved (e.g. clear its `image_source`/`image_path` in SQLite before starting); watch the image appear without leaving the screen.

Record results (pass/fail per AC, with a screenshot of each site) in the PR description. If anything fails, fix it before moving to Phase 6.
<!-- END_TASK_6 -->

<!-- END_SUBCOMPONENT_B -->
