# HMB Workout

Last verified: 2026-08-13

Local-first React Native (Expo SDK 57, iOS) workout logger. Data lives on-device
(WatermelonDB). The session flow is driven by a pure functional Rill-lang state
machine. Routines can also be authored conversationally against Anthropic or OpenAI
APIs with a user-supplied key (`src/ai` with multi-provider routing via `src/ai/provider`).

## Expo version discipline

Expo SDK 57 changed APIs from prior majors. Read the exact versioned docs at
https://docs.expo.dev/versions/v57.0.0/ before writing Expo/RN code. Do not rely
on memory of older Expo/Router/Reanimated APIs.

## Tech stack

- Expo SDK ~57, React Native 0.86, React 19, expo-router (file-based, `src/app/`)
- WatermelonDB 0.28 (SQLite on device; LokiJS on web) — data layer
- rill-lang 1.1.1 (`file:../rill-lang/rill-lang-1.1.1.tgz`, packed tarball) — pure
  functional session engine. Its lib entry is platform-neutral as of 1.1.1; the
  Node-only `createFsResolver` lives behind the `rill-lang/fs-resolver` subpath
- Zustand 5 — active-session store (imperative shell)
- @kingstinct/react-native-healthkit — write-only workout export
- Anthropic Messages API — called over plain `fetch`, **no SDK dependency** (see AI
  Coach below)
- Jest + ts-jest (node env) — tests

## Commands

- `npm test` — Jest (node project only; see Testing gotchas below)
- `npm run ios` / `npm start` — run the app (requires dev client; WatermelonDB is native)
- `npm run lint` — expo lint

## Native iOS project (`ios/`)

`ios/` is generated output (`expo prebuild`), gitignored, and **not** refreshed by
`npm run ios` once it exists on disk. After changing `app.json`, icon/splash assets,
or config plugins, regenerate it or builds keep shipping the stale native assets
(the old blue app icon outlived the icon swap in PR #30 this way):

    LANG=en_US.UTF-8 npx expo prebuild -p ios --clean

(CocoaPods needs the `LANG` override.) `--clean` is safe here: every native
customization — scene lifecycle, HealthKit entitlements, splash — comes from
`app.json` plugins and is re-applied. Hand edits under `ios/` do not survive a
regeneration; anything that must persist belongs in a config plugin (`plugins/`).

**A new native dependency makes this mandatory, and the failure is a runtime
crash rather than a build error.** `expo-audio` landed in `package.json` while
the main checkout's `ios/` was five days old, so its `Podfile.lock` had zero
`ExpoAudio` entries. The JS bundle then imported a native module the binary did
not contain, and the app died at launch with `Cannot find native module
'ExpoAudio'` — traced through `SetLogger` → `ExerciseStopwatch` →
`timerSoundPlayer`. Nothing in `npm test`, `tsc`, or `lint` can catch this;
`ios/` is gitignored, so a `git pull` that brings in a native dep leaves the
checkout silently mismatched. **After any native module lands, prebuild before
running.**

### Building and installing

**`--clean` can fail partway and leave `ios/` unusable.** It deletes the tree
before regenerating, and `rmdir` on `ios/Pods` intermittently fails with
`ENOTEMPTY`, aborting after the delete. The recovery is to finish the delete by
hand and re-run — safe, since `ios/` is generated:

    for i in 1 2 3; do rm -rf ios; done
    LANG=en_US.UTF-8 npx expo prebuild -p ios --clean

Confirm the module actually linked before building — `grep -c ExpoAudio
ios/Podfile.lock` should be non-zero.

**Simulator** — `npm run ios` works. To build without touching Metro:

    xcodebuild -workspace ios/HMBWorkout.xcworkspace -scheme HMBWorkout \
      -configuration Debug -sdk iphonesimulator \
      -destination 'platform=iOS Simulator,id=<UDID>' \
      -derivedDataPath /tmp/<name> build
    xcrun simctl install <UDID> /tmp/<name>/Build/Products/Debug-iphonesimulator/HMBWorkout.app

**Physical device — `expo run:ios --device` does NOT work under this toolchain.**
It fails with `Unexpected devicectl JSON version output from devicectl`, then
`No device UDID or name matching "..."`, because the Expo CLI cannot parse
Xcode-beta's `devicectl` output. It never reaches a build. Go through
`xcodebuild` directly, which bypasses that parsing entirely:

    xcrun devicectl list devices                       # find the UDID
    xcodebuild -workspace ios/HMBWorkout.xcworkspace -scheme HMBWorkout \
      -configuration Debug -destination 'id=<DEVICE-UDID>' \
      -allowProvisioningUpdates DEVELOPMENT_TEAM=33ZKM6VFS4 build
    xcrun devicectl device install app --device <DEVICE-UDID> \
      ~/Library/Developer/Xcode/DerivedData/HMBWorkout-*/Build/Products/Debug-iphoneos/HMBWorkout.app

**`DEVELOPMENT_TEAM` must be passed explicitly, and the obvious choice is the
wrong one.** `prebuild --clean` regenerates the Xcode project without a team —
it is a local Xcode setting, not something `app.json` carries — so the build
stops at `Signing for "HMBWorkout" requires a development team`. The keychain
holds two: `N4W9M926BS` on the *Apple Development* cert and `33ZKM6VFS4` on the
Distribution certs. **Use `33ZKM6VFS4`.** `N4W9M926BS` looks correct for a debug
build and fails with `No Account for Team "N4W9M926BS"` plus `No profiles for
'com.davidr.hmbworkout' were found`.

**Physical device for REAL-WORLD use (gym, travel) — the Debug recipe above is
the wrong one.** A Debug build loads its JS from Metro over the network, so it
is useless the moment the phone leaves the Mac. Build **Release** instead: the
Xcode *Bundle React Native code and images* phase embeds `main.jsbundle` into
the `.app`, and nothing else changes about signing.

    xcodebuild -workspace ios/HMBWorkout.xcworkspace -scheme HMBWorkout \
      -configuration Release -destination 'id=<DEVICE-UDID>' \
      -derivedDataPath /tmp/hmb-release \
      -allowProvisioningUpdates DEVELOPMENT_TEAM=33ZKM6VFS4 build
    xcrun devicectl device install app --device <DEVICE-UDID> \
      /tmp/hmb-release/Build/Products/Release-iphoneos/HMBWorkout.app

The explicit `-derivedDataPath` sidesteps the mtime hazard below. Verified
2026-08-07 on an iPhone 15 Pro.

**Prove it before trusting it, in this order** — a Release build that silently
fell back to Metro looks identical until it is offline:

1. `ls -la <App>.app/main.jsbundle` — must exist (~4.6MB). No bundle, no gym.
2. Kill Metro entirely, then `xcrun devicectl device process launch --device
   <UDID> com.davidr.hmbworkout`.
3. `xcrun devicectl device info processes --device <UDID> | grep HMBWorkout` —
   the PID must still be there seconds later. `Launched application` is printed
   even when the app crashes immediately on launch, so step 3 is the real test,
   not step 2.

**Three things about the Release build that are not what you would guess:**

- **`get-task-allow` stays `true`**, so `xcrun devicectl device copy from
  --device <UDID> --domain-type appDataContainer --domain-identifier
  com.davidr.hmbworkout --source Documents --destination <dir>` still works.
  Going Release does **not** cost you on-device DB inspection. Use it to back up
  `hmbworkout.db` *before* replacing an existing install.
- **The Team Provisioning Profile runs ~11 months** (expires 2027-07-08), not
  the 7 days a free account gives. Read it with `security cms -D -i
  <App>.app/embedded.mobileprovision`.
- **The bundle is frozen at build time.** Later JS changes need a full rebuild
  and reinstall — the opposite of the Metro-served Debug build. Keep the Debug
  build for iteration; Release is for taking the phone away from the Mac.

**Verifying a native module actually linked — do not read `Frameworks/`.** Expo
module pods build as **static** libraries, so `ExpoAudio.framework` is legitimately
absent from a correct build. The evidence is in the binary, but **the target
differs by configuration** — a Release build has no `.debug.dylib` at all, so the
documented Debug path silently finds nothing and reads as "not linked":

    strings <App>.app/HMBWorkout.debug.dylib | grep -c ExpoAudio   # Debug:   38 when linked
    strings <App>.app/HMBWorkout | grep -c ExpoAudio               # Release: 31 when linked

Any non-zero count means linked; the exact numbers are just what was observed.

**In DerivedData, mtime does not imply completeness.** Several `HMBWorkout-*`
directories accumulate, and the newest by mtime can be an *empty* `.app` from an
interrupted build — no binary, no `Info.plist`. Sorting by mtime and taking the
top hit reports "no build exists" while a working one sits one entry down. Check
for the binary itself.

## Architecture: Functional Core / Imperative Shell (FCIS)

This is the load-bearing invariant. All session-flow logic lives in the pure core;
everything else only shapes payloads and runs side effects.

- **Core (`src/engine`)** — pure. The bundled `.lv` rules are the *only* place that
  decides phase transitions, advancement, validation, and which effects fire. A Rill
  `transition(state, event) → Result({state, effects})` is the single contract.
- **Shell (`src/state`, `src/components`, `src/app`, `src/ai`)** — imperative. The
  Zustand store owns injected effect executors and persistence; presenters derive view
  data from engine state. **No session-flow decisions belong in components or the
  store** — if you find yourself branching on `phase` to decide what happens next, it
  belongs in a `.lv` rule, not TS.
- The AI slice is shell-only and deliberately does not touch the engine: it authors
  *data* (routines, alternate exercises, descriptions), never session flow. A routine
  produced by the AI is indistinguishable from a hand-built one by the time the
  engine sees it. The one AI feature that changes a *running* session — the Replace
  button — still decides nothing shell-side: `exerciseReplaceStore` dispatches a
  `ReplaceExercise` event and the `.lv` rule alone decides whether the swap happens
  (see engine convention 7).

### Non-obvious engine conventions (will bite you)

These exist to work around Rill's type system and have no analog in ordinary TS:

1. **Typed effect variants, not a uniform record.** `Effect` is a tagged union
   declared in `types.lv` — `CreateSession`, `ScheduleRest`, `CancelRest`, `Notify`,
   `PersistSet`, `CompleteSession`, `DiscardSession` — mirrored by the TS `Effect`
   union in `engine/types.ts`. The host (`engine/index.ts`) maps each tag to a
   handler in the `rillExecutors` table, unpacking that variant's own payload and
   forwarding it to the matching `EffectExecutors` method inside a try/catch so one
   failing executor never crashes `dispatch`. Adding an effect means adding a variant
   to `types.lv` **and** `engine/types.ts`, plus a case in `rillExecutors` — there is
   no shared record shape left to widen. `DiscardSession` is its own variant rather
   than a case of `CompleteSession` on purpose: `CompleteSession` is what drives
   the HealthKit export, so an abandoned session (`AbandonSession`) must emit
   `DiscardSession` so the session is deleted instead of exported.

2. **`transition.lv` appends to `loggedSets` itself.** Rill does have a list-append
   builtin, and the `LogSet` rule uses it: `loggedSets: append(state.loggedSets,
   [theSet])` on the returned state, so the host never rebuilds the list. The same
   rule also writes `theSet` onto `lastLoggedSet`; `engine/index.ts` only carries
   that field across the sentinel boundary (rpe -1.0 ⇄ `undefined`, etc.) — nothing
   else in the codebase currently reads it.

3. **`idx` is 0-based order, host-assigned.** Rill indexed list access uses head/tail
   recursion, so entries must carry an explicit `idx`. Rill's own `RoutineEntry`
   alias (`types.lv`) has no `idx` field — `toRillRoutineEntry` strips it before an
   entry crosses into Rill — so the host supplies it on both sides of a `dispatch`
   call: `fromRillState` re-derives `idx` as array position after every transition
   returns (`entries.map((entry, idx) => ({ idx, ... }))`), and, going the other way,
   `startSessionFromRoutine.ts` assigns `idx: re._raw.order` — the DB's canonical
   0-based order, not a loop counter — when building a `StartSession` event's
   `routine.entries`, so it matches `routine_exercises.order` for `onPersistSet`'s
   later lookup. Callers pass routines *without* `idx`; never author `idx` by hand.

4. **Rules are inlined, not module-loaded.** `.lv` files are imported as strings
   (babel inline-import). Metro's transform cache keys on the *importing* TS file,
   not the `.lv` content — after editing any `.lv` file, restart Metro with
   `npx expo start --clear` or modules that inline the same rules can end up with
   mixed old/new copies (e.g. `loadRules.ts` validating different sources than
   `engine/index.ts` executes, since each file has its own `import ... from
   './rules/*.lv'` statements). `loadRules()` type-checks the bundled rules
   directly — `checkRuleSource(transitionSource, { resolve })`, where `resolve`
   serves the same inlined `types.lv`/`helpers.lv`/`transition.lv` sources
   `engine/index.ts` uses — it does not assemble or splice rule text together.
   `loadRules()` (the type-check gate) must run from the boot effect in
   `_layout.tsx`, **not** at module-init — a module-init throw crashes before the
   RuleErrorScreen can render. Keep it that way.

5. **State is fully JSON-serializable** (no Dates/functions) so it can be persisted and
   rehydrated after an app kill. `entries` is stored *in* the state for this reason.
   Rehydrating is a `hydrate` call, not a dispatch, and the boot path
   (`rehydrateActiveSession`, `src/state/sessionRehydrate.ts`) follows it with `Resume`
   **only when the saved phase is `paused` or `resting`** — the two phases where
   `transition.lv` defines a meaning for it. Paused resumes into a re-armed rest when
   one was frozen (`restRemainingMs`), otherwise back to `prePausePhase`. Resting is
   the kill-mid-rest case: a live deadline re-emits `ScheduleRest`, an expired one gets
   the same phase-from-position recovery `RestElapsed` would have made. That re-emit
   leans on a shell guarantee — rest alerts schedule under a fixed OS notification
   identifier (`REST_NOTIFICATION_ID` in `executors/restTimer.ts`), so the boot re-arm
   *replaces* the pre-kill alert rather than double-notifying, and `CancelRest` can
   silence an alert this process never scheduled. The pair is exhaustive by
   construction rather than enumeration: every rule writing `restDeadlineMs: Some(...)`
   also sets `phase: Resting`, and `PauseSession` clears it on the way out — no
   other phase can hold a deadline to reconcile. Every other phase returns
   `Err`, and rejections are never silent:
   any `Err` from `transition` surfaces as a thrown `TransitionError` that the store's
   `dispatch` catches into `lastError`, which `session.tsx` renders as an error banner.
   So an unconditional Resume at boot greets the user with a red banner rather than
   failing quietly — the same trap awaits any other event dispatched blind at rehydrate.
   The module sits outside `_layout.tsx` so the node jest project covers it (screens are
   not jest-covered), and it takes the store structurally rather than importing the
   global one, so tests can pass a `createActiveSessionStore` instance.
   The kill case is the only one the boot path owns. A warm foreground (backgrounded,
   not killed) past the deadline needs no `AppState` listener: `RestCountdown`
   (`src/components/RestCountdown.tsx`) derives remaining time from the wall clock
   (`deadlineMs - Date.now()`), ticks synchronously on mount and every 250ms while a
   rest is on screen, and dispatches `RestElapsed` on the first tick at or past the
   deadline. The session screen stays mounted across backgrounding, and a dismissed
   session modal re-ticks on remount, so every warm path reconciles as soon as a rest
   is visible again — and nothing outside the session screen reads the phase in the
   meantime. Do not "fix" the warm case with a foreground `Resume` dispatch:
   Resume-in-Paused would silently un-pause a deliberately paused workout on every
   app switch, and Resume in any other phase is the error-banner trap above.

   The *foreground* sibling of that boot path is `AppForegrounded`
   (`src/state/foregroundReconcile.ts`, wired to an AppState listener in
   `_layout.tsx`): an app backgrounded — not killed — past the rest deadline has no
   other reconcile path unless the session screen happens to be mounted. Unlike
   rehydrate, the shell dispatches it **blind** — no phase gate. The store's
   `sessionState` updates only after `dispatch`'s awaits, so a shell gate would read a
   stale phase and race the session screen's own dispatches; the engine applies
   transitions synchronously and is the only race-free authority. The event is
   therefore `Ok` in *every* phase: in `resting` it runs the same shared
   reconciliation as the boot Resume arm (`reconcile_resting_deadline` in
   `transition.lv`), everywhere else it is a no-op — in particular `paused` stays
   paused, because foregrounding the app is not the user asking to resume. The other
   half of that race: `RestCountdown` dispatches `RestElapsed` from a closure, so a
   straggler tick can land after the reconcile already recovered the phase —
   `RestElapsed` is benign (`Ok`, no effects) in `warmup`/`working`, the two phases
   recovery lands in, and still `Err`s everywhere else.

6. **Engine state carries ids, never display data.** The Rill `RoutineEntry` alias
   (`rules/types.lv`) is a closed record, and `toRillRoutineEntry`/`fromRillState`
   rebuild entries field-by-field in both directions — so an extra field such as
   `title` bolted onto the TS `RoutineEntry` survives until the first `dispatch` and
   then silently vanishes. Anything the UI needs beyond `exerciseId` must be resolved
   shell-side against the DB: `getExerciseTitles` (`src/db/repository.ts`) feeds the
   optional `exerciseTitles` map on `createSessionPresenter`, which exposes
   `currentExerciseTitle` and falls back to the raw id when an exercise is missing.
   The coach-prescribed weight is a per-entry plan datum that deliberately does **not**
   cross into `RoutineEntry` — no rule branches on load, and the Rill record is closed.
   It reaches `computeSetPrefill` as a caller-resolved argument, the same way
   `exerciseTitles` and `historyFallback` do.

7. **`ReplaceExercise` swaps a running entry's identity, under engine guards.** The
   event carries `{ idx, exerciseId }`; the rule requires `idx == exerciseIndex`
   (a pick made after the workout moved on is rejected, not misapplied),
   `setIndex == 0` (an entry with any logged or skipped set is committed), and
   phase `Warmup | Working`. The rule rebuilds `entries` with a position-counting
   `fold` using functional record update (`{ entry | exerciseId: ... }`), so the
   closed-record field-loss hazard in convention 6 cannot occur. The shell's write
   ordering around the dispatch is load-bearing: ensure the exercise record exists →
   dispatch → only on `Ok` re-point the routine row — a rejected swap must never
   leave the routine pointing where the session isn't.

8. **The shell reads sentinels, not `Option`s.** `fromRillState` re-sentinelizes on the
   way out — `rpe: undefined → -1`, `restDeadlineMs`/`restRemainingMs` → `0`,
   `prePausePhase`/`supersetGroup` → `""` — so TS read sites can stay non-nullable.
   `SENTINEL_TO_OPTION_MAP` in `engine/index.ts` is the authoritative list. Presenters
   must treat those values as *absent*: a plain null check passes `-1` through and
   renders `RPE: -1`. `formatLoggedSetLine` in `sessionPresenter.ts` is where the
   session screen's logged-set formatting (and that filtering) lives. The hazard
   class is wider than the sentinel map: a `null` `target_sets` column also reaches
   the shell as a plain `0` that display code must treat as *no plan* — see the
   zero-planned-set rule in Boundaries.

9. **A superset group round-robins by set, and `setIndex` becomes a
   group-shared round number while advancing through one.** A group is a
   contiguous run of entries sharing a `supersetGroup` label (`h.group_end_idx`
   in `helpers.lv`; a standalone entry is a group of one). Finishing a set
   hands off to the next group member still owed a set *this round*
   (`h.next_active_idx`, curried over `(afterIdx, groupEndIdx, round)`) with no
   rest; only when nobody after the current position qualifies does the group
   decide whether to loop back for another round or move on. A member with
   fewer prescribed sets than its partner is simply skipped once its own
   `warmupSets + targetSets` is exhausted — the round does *not* end early
   just because the round's last-*visited* member is done; every remaining
   member's sets still get logged. Because a member is visited every round up
   to its own completion and never after, its own count of *visits* always
   equals the shared round number for as long as it keeps being visited (this
   is a visit count, not strictly a logged-set count — `SetDone`/"Skip Set"
   still advances it without logging anything) — this is what keeps
   convention 7's `setIndex == 0` guard sound for a member reached only via a
   superset hop, with no extra state needed. `phase` is re-derived
   (`h.phase_for`) from whichever entry is actually landed on — never carried
   over from the entry being left — on all three ways `advance_after_set` can
   move: the same-round hop, the next-round loop-back, and advancing to a
   genuinely different exercise/group entirely (this last one applies to
   standalone entries too, not just superset groups: exhausting entry A and
   landing on B with `B.warmupSets > 0` now correctly reads `Warmup`, where
   the pre-round-robin code carried A's last phase over). `SkipExercise`
   existed once and was removed: its unconditional index-jump could land on a
   group member with real logged history while resetting `setIndex` to 0,
   which would have made that guard unsound with no clean fix (skip *this*
   member only, or the group's whole current round?) — removing the
   affordance was simpler than picking one.

10. **A zero-set entry is never *landed on*, only skipped past.** Convention
    9's `h.next_active_idx` refuses to hand off or loop back to a member whose
    own `warmupSets + targetSets` is 0 (`round < 0` is never true), but that
    only governs positions *inside* a group already being visited. The two
    sites that land on a *fresh* position — `StartSession`, and
    `advance_after_set`'s "this group is done, move on" branch — took
    `entries[0]` and `groupEndIdx + 1` on faith, so a zero-set entry reached
    either way was landed on and accepted one phantom `LogSet`/`SetDone`
    before the engine moved past it. Both now go through
    `h.next_active_landing(entries)(fromIdx)`, which returns the first index at
    or after `fromIdx` with a nonzero total **and** the true start of the
    contiguous `supersetGroup` run that index belongs to. Tracking that start
    is not redundant bookkeeping: a landing can skip an entire zero-set group
    to reach a later one whose own leading members are also zero-set, and
    `supersetPosition` has to be `idx - groupStart` for *that* group or the
    next `advance_after_set` rederives `groupStartIdx` — and so `groupEndIdx`
    — from a wrong origin. It is not a drop-in for `h.next_active_idx` at the
    within-group sites: it presumes `fromIdx` is itself a group boundary (0,
    or one past a prior group's end), which is the one thing both call sites
    guarantee and a within-group hop would not. `None` means every entry from
    `fromIdx` on plans zero sets. In `advance_after_set` that is the ordinary
    end of the workout — the existing end-of-routine arm, unchanged. At
    `StartSession` it is `Err`, not a special "instant completion": emitting
    `CreateSession` and `CompleteSession` in the same dispatch has no ordering
    guarantee the host can honor (`activeSession.ts` swaps in the new session
    state only after `dispatch` returns, so effects race against whatever
    session was current a moment earlier) — an earlier version of this fix
    tried the instant-completion arm and it either stranded the new session
    forever on a fresh store, or, starting from `phase: Done`, re-completed
    and re-exported to HealthKit whatever the *previous* session was. Rejecting
    an all-zero routine outright, the same as the empty-routine guard one line
    above, was simpler than teaching the host a new effect-ordering contract
    for a shape a real routine should not produce anyway.

    One more consequence: `landing.idx` is no longer necessarily adjacent to
    `groupEndIdx`, so the group-exhausted branch stopped calling
    `h.rest_duration` for its rest decision (deleted from helpers.lv — this
    was its only caller). `rest_duration`'s "same superset" check was a label
    comparison, sound only between genuinely adjacent entries — group labels
    are contiguous, not routine-unique (`h.group_end_idx`'s own docstring), so
    a landing that skips a zero-set entry can reach a *later* entry that
    happens to reuse an earlier group's label. Landing here already proves the
    current group is exhausted, so `currentEntry.restSeconds` applies
    unconditionally instead — the same value `rest_duration` always resolved
    to at this call site anyway, once nextEntry was guaranteed adjacent.

## The vault markdown contract (`src/interop`)

`format.ts` is the single source of truth for the grammar; `serialize.ts` and
`parse.ts` must stay symmetric. Roundtrip tests enforce this for the value ranges they
exercise — e.g., the test in `roundtrip.test.ts` that serializes a `reps: 0` set
pins the PR #89 regression: an earlier version of the zero-reps guard below was
unconditional, so `parseSession` rejected the `1x0` lines `serializeSession` correctly
emits for a set logged with zero reps. Not every value is exercised by existing
fixtures, so test coverage is incomplete by construction; add targeted roundtrip tests
when you discover or fix a case the current suite misses.

**`parse.ts` has no production caller and is kept deliberately (#262) — it is a
maintained contract, not dead code.** Vault import went away with #203 and
`src/export` uses `serialize` only, so a dead-code sweep finds nothing importing it
outside tests. It stays because it is still load-bearing twice over: it is the
mechanism that enforces the symmetry asserted in the paragraph above (delete it and
`serialize` can drift from the grammar with nothing to notice — 42 of the interop
suite's 59 tests involve parsing), and it is the test oracle for the one interop path
that *is* production-bound, since `exportService.test.ts` verifies `exportRoutine` by
parsing its output back rather than string-matching. The cost of that choice, and it
is a real one: a change to `format.ts` or `serialize.ts` must keep `parse.ts` in step
exactly as if it had callers.

One overload to know: the `<sets>x<reps>` slot means **target** sets×reps in a routine,
but in a logged session it is emitted as `1x<logged-reps>` (one logged set). Session
lines therefore expose honest aliases (`loggedReps`, `loggedDurationSeconds`) — read
those, not the `target*` fields, when consuming a parsed session. Contract violations
throw `ContractError`.

### Quoted flag values (#277)

**A flag value may be double-quoted, and the line tokenizer is quote-aware.** Before
this, the whole spec after the colon was split on `/\s+/`, so a value was one
whitespace-delimited token by construction — a routine exercise's `notes`, carried in
the `@hint` flag, lost everything after its first word *silently* (unknown non-flag
tokens hit a `continue`), and a note containing `=` was worse: the stray token reached
the `knownFlags` allowlist and threw. Every hint fixture in the suite was a single
token, which is why 59 interop tests never noticed.

`tokenizeFlagString` (`format.ts`) is now the one tokenizer, and `parse.ts` calls it
for the *whole* line spec — before the `<sets>x<reps>` scan, not just for the flag
tail. **That ordering is the load-bearing part**: a note reading `@"3x12 = the goal"`
would otherwise have its `3x12` grabbed as the sets slot. Flags then parse from tokens
(`parseFlagTokens`) simply because the caller already has them — that is *not* a
correctness requirement, and an earlier version of this section said it was.
`tokenizeFlagString(tokens.join(' ')) === tokens` is an identity on tokenizer output
(measured twice: 3,300 inputs in review, 3,402 independently), so `parseFlags(string)`
would behave identically at that call site. `parseFlags` has no production caller; it
is retained as the wrapper that keeps the two entry points symmetric, and
`format.test.ts` exercises it so its body stays mutation-visible.

Four rules that must stay true together:

- **Quoting is emitted only when needed** (`quoteFlagValue`: whitespace, `"`, `\`, or
  empty). A value that used to serialize bare still serializes bare, byte for byte, and
  a hand-authored `@word` keeps its meaning. An unquoted `@progressive overload` still
  means `hint: "progressive"` — that is backward compatibility, not a residual bug.
- **A `"` is significant only in value-opening position** — directly after the `@` of a
  hint, or directly after the *first* `=` of a `key=value` flag. Everywhere else it is
  an ordinary character (`opensQuotedValue`). This is not a refinement, it is what makes
  the previous rule true: a tokenizer that toggled on *any* quote turned an inch mark —
  `@Go 2" deep`, `@Use the 45" band`, unremarkable in a lifting note — into
  `Unterminated quoted value` and made the whole document unparseable, where the old
  whitespace tokenizer had merely truncated at the first space. **The exception, stated
  exactly: a legacy value that itself BEGINS with `"` now reads as a quoted value** —
  differently if its quotes balance, rejected if they do not. That is the entire
  residual; it is pinned by tests in `parse.test.ts` rather than left to be rediscovered.
  Documents the *new* serializer writes cannot exercise any of this, which is why the
  suite could not catch it — the check is to re-serialize with the pre-#277 code and
  parse the result.
- **Escapes inside quotes are `\\` `\"` `\n` `\r`, and nothing else.** An unterminated
  quote or an unrecognized escape throws `ContractError` rather than degrading — both
  mean the serializer wrote something it never writes. Rejected twice, by
  `tokenizeFlagString` and again by `decodeFlagValue`; the layers are tested separately
  or each hides the other's absence.
- **Newlines round-trip; they are not normalized.** `\n` inside a quoted value keeps a
  multi-line note (Hevy has them) intact while guaranteeing no literal newline ever
  appears inside a workout line, so the document stays line-based. A note that is
  *only* whitespace is treated as absent by `serializeRoutine` and emits no `@` at all.

**Both documents are emitted by `formatFlags`, and that is what keeps `superset=`
quoted.** `superset_group` is the session line's only free-text value and had the
identical truncation hazard, but `buildSessionSetLine` used to hand-roll its flag list,
so the routine path's quoting never reached it — the two paths had no shared code to
teach, and `superset='Group One'` truncated to `Group` while silently eating the
`rest=` that followed. It now builds a `ParsedFlags` and hands it to the same
formatter. **Anything a session line needs that a routine line does not belongs in
`formatFlags`, not back in the caller** — `set_type` is the live example: it is emitted
whenever present, `working` included, because a session's set type is a measurement
rather than a plan default, and a routine line never sets the field at all. Flag order
on a session line is `formatFlags`'s order as a result (rest, warmup, superset, kind,
duration, set_type, rpe, weight, distance, hint); parsing is order-insensitive, so this
is a byte-level change only.

### Parse context and validation strictness

`parseWorkoutLine` and the internal `parseDoc` take a context parameter
(`'routine' | 'session'`) that controls validation severity. It is deliberately not
exposed on the public API: `parseRoutine(markdown)` and `parseSession(markdown)` are
single-argument wrappers that each hardcode their own context, so no caller can parse
a routine with session strictness or vice versa. This distinction exists because the
`<sets>x<reps>` slot carries *different semantic meaning* in each context:
- In a **routine** (author-written targets): `3x0` means "3 sets of zero reps," which is
  semantically empty and therefore rejected.
- In a **session** (logged measurements): `1x0` means "one logged set in which the user
  performed zero repetitions," which is a real, valid action and therefore accepted.

Zero sets (`0x10`) is rejected unconditionally in both contexts, since
`serializeSession` hardcodes the sets slot to literal `1` and can never emit `0x...`.
Zero reps rejection is routine-only: `parseRoutine` passes `context: 'routine'` to
`parseDoc`, while `parseSession` passes `context: 'session'`, so `1x0` is valid in
logged sessions but `3x0` is rejected in routine targets.

`serializeSession` never emits a *partial* session: every logged set produces a line
or the call throws. That is stronger than it sounds, because the function is driven by
`routineExercises` and a set's row can be missing entirely — `upsertRoutine`'s drop
branch destroys the row when an exercise leaves a routine, while a finished session
keeps its sets. Those orphaned groups are emitted from the
`session_sets.exercise_id` stamp and appended after the row-ordered lines (no row means
no `order` to interleave by), without the row-supplied plan flags `superset`/`rest`,
which died with it. A set with neither a stamp nor a surviving row is genuinely
unidentifiable and throws, so no partial session document is ever produced and the
data stays intact on-device. That guarantee used to stop dead at the caller:
`exportService.exportSessionHistory` caught per session and continued, so the
*aggregate* export was silently short at session granularity — the very failure
this rule prevents at set granularity, one level up. Resolved in #212 by keeping
the resilience and deleting the silence: it returns `SessionHistoryExport`
(`{ markdown, failures }`), skipping a session that cannot be serialized but
naming it in `failures`. For a backup, 47 of 48 sessions beats 0 of 48; what was
wrong was that the caller could not tell. **A UI that writes `markdown` and drops
`failures` on the floor reinstates the bug** — a non-empty `failures` must reach
the user. Do not restore a `continue` on the unresolved-exercise path: silently
skipping a set is the data-loss bug itself.

`exportRoutine` took the opposite fix, because a single-item export has no
partial to salvage — it renders or it doesn't, so swallowing bought nothing and
cost the user a file that looked like an empty routine. Its blanket `catch` is
gone and failures propagate. "Routine not found" keeps its own distinct `''`,
now decided by an explicit `Q.where('id', ...)` query rather than by catching
`find()`'s rejection. Worth knowing why the two halves differ: `serialize.ts`
has exactly **one** `throw`, on the session path (`buildSessionSetLine`, an
unresolvable set identity). `serializeRoutine` cannot throw at all, so that
`catch` was only ever masking DB-layer errors.

Separately, every flag guard in that same line-building path (both the row-driven and
the orphaned-group path share `buildSessionSetLine`) must check `!= null`, not
`!== undefined`: WatermelonDB returns `null`, not `undefined`, for an unset optional
column, so every optional field read off a DB row — `reps`, `weightKg`, `distanceM`,
`durationSeconds`, `rpe` on `SessionSet`; `targetSets`, `targetReps`,
`targetDurationSeconds`, `restSeconds` on `RoutineExercise` — is subject to it.
`exportService.ts`'s row-to-serializer mapping normalizes the same hazard a second time
at the shell boundary (`?? undefined`, matching its pre-existing `exerciseId` handling,
and covering the `RoutineExercise` plan flags as well); **keep both layers.** A bad
guard would therefore only become reachable if that mapping ever stopped normalizing — at which
point it writes a `<flag>=null` line straight into the exported document, and nothing
downstream rejects it.

`upsertRoutine` defaults a duration-based entry's `targetSets` to 1 when it is undefined/null and
`warmupSets` is 0 (or undefined), so it doesn't reach the engine as zero-total. This is the only
enforcing layer. The default does **not** gate on `targetDurationSeconds` being set — an entry with
`targetSets` undefined and `warmupSets` 0 is zero-total whether it has duration or not (e.g., an
AI-drafted strength exercise with only title and kind) — but it fires only when `targetSets` is
*absent*, never on an explicit `0`. An AI draft with `targetSets: 0` is rejected upstream by
`validateRoutineDraft` (`src/ai/draftSchema.ts`), which enforces `targetSets >= 1` when present.
An entry with explicit `warmup=2` and no target sets still totals 2 and is never defaulted.
This mirrors the AI persona's own convention for duration-based exercises (`targetSets: 1`, see AI
Coach below), so a routine always has exercises that will actually be performed regardless of
whether it was authored by hand or drafted by the coach. A malformed `0x10` or `3x0` line would
never reach this layer anyway — `parseWorkoutLine` rejects both at parse time, under the
context-dependent rules in "Parse context and validation strictness" above — though that is
parser-layer behavior with no current production producer, since nothing outside tests calls
`parseRoutine`/`parseSession` now.

`serializeRoutine` **does not** emit `target_weight_kg` and the grammar was deliberately
not extended, because `serializeRoutine`, `exportRoutine` and all of `parse.ts` have no
production caller. Wiring an export path to a screen means adding a **distinct** flag key —
not reusing `weight=`, which already means logged kg on a session line. Related finding:
the "session sets only" restriction on `weight=` is a comment, not a rule. `parseFlags`
keeps one global `knownFlags` allowlist for both contexts (`format.ts:424`, moved from
:247 by the #277 quoting change), `parse.ts` consults its `context` parameter exactly
once (line 211, the zero-reps rule), and a routine line carrying `weight=60` parses
cleanly today.

## HealthKit (`src/health`)

Write-only. All HealthKit errors are logged and swallowed — a Health failure must
never affect DB state. Dependencies are injected (`HealthKitSaveDeps`) so the
save path is testable in the node jest project.

## AI Coach (`src/ai`)

Conversational routine authoring. The user brings their own API key (Anthropic or OpenAI);
requests go straight from the device to the chosen provider's API, and the chat is
never persisted. Provider selection is determined by `createAiClient` (`src/ai/provider/factory.ts`),
which reads `anthropicKey`, `openaiKey`, and `aiProvider` to resolve the active provider,
and route all four surfaces (chat, rest commentary, exercise question, alternates) to
the corresponding client factory.

The AI settings fields (`anthropicKey`, `openaiKey`, `aiProvider`, `aiModel`, `aiGoals`,
`aiEquipment`, `aiPersonality`) are persisted under the storage key `'bridge_settings'`,
alongside the profile and onboarding fields — do not rename this key, as it holds every
user's API key and onboarding state, and renaming it orphans existing users. `BridgeSettings`
in `src/state/settings.ts` is a misnomer — the blob holds AI, profile, and onboarding
settings, and no bridge settings at all — kept because renaming the *type* is churn and
renaming the *key* is forbidden.

**The settings split.** `/settings/ai-provider` (provider, key, models) and `/settings/ai`
(goals, equipment, coaching style, age, experience). The provider/key/model decisions live
in `src/state/aiProviderSettings.ts` and the screen holds none of them, because `src/app`
has no jest coverage — the patch/selection builders are `initialProviderSelection`,
`providerSwitchPlan`, `apiKeyPatch` and `modelSelectionPatch`.

**Model selection IS exposed, as two pickers over four surfaces.** `modelSelectionPatch`
has a production caller — `applyModelSelection` in `ai-provider.tsx` — and the screen
renders **Coach Model** and **Quick Replies Model**. (This paragraph previously said the
opposite, and stayed wrong for the whole of #246's life; the wiring landed in PR #251.)

The asymmetry is deliberate and is why the picker count does not match the surface count:
`AiModelConfig` has exactly two fields, `chat` and `oneShot`, so `applyModelSelection`'s
field union is `'chat' | 'oneShot'`. `chat` drives the conversation and routine drafting;
`oneShot` drives all three one-shot features (alternates, exercise question, rest
commentary) from a single choice. Adding a third picker means widening `AiModelConfig`
and `resolveModels`, not just adding UI.

**One key per install.** Switching provider clears the outgoing provider's key, to `''`
rather than `undefined` because `setSettings` persists through `JSON.stringify`, which drops
`undefined` and would leave no evidence of the clear in the blob. This is what keeps
`ProviderConfig`'s "Only one key is set per install" docstring true — the sentence is
load-bearing, not incidental, and must not be edited without changing the rule it describes.
The switch is confirmed only when the outgoing key is non-empty after trim. The write goes
through the screen's `queueSave` + `flush`, never a bare `setSettings`: a bare write leaves
a pending 500 ms autosave patch alive that fires afterwards and restores the key the user
just destroyed.

**`aiProvider` is written only from the picker.** Mounting the screen derives the displayed
value through `initialProviderSelection` and writes nothing, so installs that predate the
picker keep resolving implicitly in `factory.ts`. Nothing can test this — `src/app` is
uncovered and an automated fixture cannot distinguish "no write" from "wrote the derived
value" — so it rests on a structural criterion.

**The key is trimmed at one boundary on the way in**, `apiKeyPatch`; `factory.ts:61,65,101,105`
trims again at the wire (two guard sites and two forwarding sites, one pair per provider). **Keep both layers.** Note that the factory's trim makes an
untrimmed *store* invisible to every wire-level assertion, so `apiKeyPatch`'s own test is
the only cover.

**Key-format validation warns, never blocks**, and is one-directional: `sk-ant-` under an
OpenAI selection is flagged; nothing is flagged under Anthropic, because OpenAI has no
unmistakable marker and `sk-` is a prefix of `sk-ant-`.

**Chat error copy lives in `src/state/aiChatErrorCopy.ts`**, not in the screen, and names
the failing provider. The provider is a two-member union, so key material cannot reach the
banner by construction.

**The model list is constrained and its membership is governed by the fixed request contract.**
Every client sends a fixed request contract — `reasoning: { effort: 'none' }` on OpenAI,
`thinking: { type: 'disabled' }` on Anthropic, `output_config: { effort: 'low' }` on Anthropic
rest commentary — against fixed budgets (chat 4096, alternates 1024, exerciseQuestion 512,
restCommentary 256). A model that rejects those, or whose minimum reasoning effort exceeds
`none`, either 400s or returns `status: 'incomplete'` with no text and a bill — and every AI
failure here is swallowed, so the symptom is four silently dead features. **Adding an id
therefore requires one live call per surface returning rendered text; it is not a config
edit.** The `AI_MODEL_CHOICES` value-pinning test in `models.test.ts` is the only guard on
membership in the repo — its `toStrictEqual` is load-bearing, since a loose matcher
(`arrayContaining`) silently readmits unprobed ids. `resolveModels` ignores an id not on the selected provider's list and falls
back per field, without rewriting the setting.

The selection rule exists in three implementations: `settings.ts:137-159` (`resolveAiProvider`,
still zero production callers), `factory.ts:23-44` (`resolveProvider`), and
`aiProviderSettings.ts:63-72` (`initialProviderSelection`). All three are named in
AGENTS.md so a future reader recognizes the rule when editing one of them.

- **No SDK, on purpose.** `anthropicClient.ts` is a hand-rolled `fetch` POST to
  `/v1/messages` — non-streaming, `thinking: disabled`, structured output via
  `output_config.format.json_schema`. Adding `@anthropic-ai/sdk` is not an upgrade:
  the client must stay RN-bundle-safe and `fetchFn`-injectable so it tests in the node
  jest project. Network vs HTTP failures are distinct types (`AnthropicUnreachable` vs
  `AnthropicHttpError`). The cost: no SDK means nothing
  strips a `json_schema` of keywords the structured-output endpoint's subset doesn't
  support (array/string/number bounds) — one in `ALTERNATES_SCHEMA` made the Replace
  button 400 on every tap until it was caught (PR #71). Every schema handed to
  `output_config.format` must pass `expectStructuredOutputSafe`
  (`src/ai/structuredOutputSubset.ts`); put bounds in the validator instead, which is
  where the SDKs put the keywords they strip.
- **One turn shape, three declarations.** The `{ reply, draft?, settingsProposal? }`
  contract is stated in `AI_TURN_SCHEMA` (what the API enforces), in the
  `AiTurn`/`RoutineDraft`/`SettingsProposal` types plus `validateRoutineDraft` and
  `validateSettingsProposal` (what the app enforces), and in `personaSection()` prose in
  `contextBuilder.ts` (what the model reads). Changing either payload shape means
  changing all three — same hazard class as the copied markdown contract.
- **The persona restates the validator's rules, not just its shape.** `personaSection()`
  spells out the bounds `validateRoutineDraft` enforces (non-empty name, ≥1 exercise,
  title must slugify to something non-empty, `targetSets`/`targetReps` ≥ 1, and
  `warmupSets`/`targetDurationSeconds`/`restSeconds` ≥ 0), so a rejected draft reads as
  a model mistake rather than a surprise. `contextBuilder.test.ts` asserts those
  sentences as *exact strings*: loosening or tightening a bound in `draftSchema.ts`
  without rewording the prose fails those tests rather than silently drifting. Not
  every pinned sentence is a bound restatement: the `targetSets: 1` guidance for
  duration-based exercises has no validator counterpart — it steers the model away
  from the zero-planned-set drafts that force the display guards in Boundaries — so
  don't delete it as unenforced.
- **Validate twice; structured output is not a guarantee.** `parseAiTurn` validates on
  receipt and `acceptDraft` validates again before writing. Keep both.
- **Exercise identity is `slugifyTitle(title)`, and the accept path is create-only.**
  Exercises are global and shared by every routine, so `acceptDraft` creates a missing
  exercise but never updates an existing one's title, kind, or description — a draft
  must not rename or re-kind an exercise out from under other routines. Title reuse
  therefore maps to the same record, which is why the persona pushes the model toward
  existing titles.
- **Drafts are whole routines, never diffs.** `upsertRoutine` reconciles
  `routine_exercises` in place, not delete-and-recreate: entries claim existing
  rows by `exerciseId` (oldest `order` first, so duplicated exercises match
  deterministically) and survivors keep their row ids. That stability is
  load-bearing: `session_sets.routine_exercise_id` references those rows and
  `getExerciseWorkingSetHistory` joins by row id for pre-v3 sets (see the
  Boundaries stamp rule — stamped sets carry their own identity), so editing a
  routine never orphans logged history. An exercise the draft omits *is* deleted,
  which is why the persona demands the full exercise list; that row's
  still-unstamped sets are stamped with its outgoing `exercise_id` first, in the
  same transaction, so dropping an exercise from the *plan* never erases what was
  already *done*.
- **The conversation mode owns the routine id.** `acceptDraft(db, draft, mode)` mints
  `routine-<epoch>` in create mode and forces `mode.routineId` in edit *and debrief*
  mode; drafts carry no routine id. Accepting in either of those always overwrites the
  routine named by the route param.
- **A finished workout opens a debrief conversation.** The `debrief` mode carries the
  routine plus the session that was just performed, and the prompt gains a
  "Just-Finished Workout" section (every planned exercise against the sets actually
  logged, warmups included — unlike the history section). The coach speaks first:
  `aiChatStore.openDebrief` resets and sends `DEBRIEF_OPENING_MESSAGE` for the user,
  because the Messages API needs a user turn before a reply. The opening turn is
  flagged hidden and suppressed in the UI while staying byte-identical on the wire,
  so the user sees the coach's greeting as the first message. The hook is the *last*
  thing `onCompleteSession` does — after the session record is closed and the HealthKit
  write is under way — and every failure there is swallowed: finishing a
  workout must never depend on the chat. Effect executors are fire-and-forget, so a
  resolved `dispatch` does not mean the debrief has opened; tests must wait for it.
  `planPostWorkoutDebrief` (no key = no chat) and the route-param encoding live in
  `src/state/postWorkoutDebrief.ts` so they test in the node project;
  `debriefNavigation.ts` exists only to keep `expo-router` out of that file.
- **The prompt carries data, never secrets.** `buildSystem` composes goals, equipment,
  every routine, a `## Recent Workouts` section (the last `RECENT_WORKOUTS_IN_PROMPT`
  (10) completed sessions, one line each dated in UTC with weekday, preceded by a
  `Today:` anchor line so the model has a recency reference point), and working-set
  history (`HISTORY_SETS_PER_EXERCISE` most recent per exercise, warmups excluded,
  each set dated to the UTC day it was logged). `anthropicKey`/`token`/`baseUrl` must
  never appear — a regression test in `contextBuilder.test.ts` asserts this.
- **A `settingsProposal` is proposed, never applied.** The model may propose new
  `aiGoals`/`aiEquipment`/`aiPersonality` when the user asks, but
  `approveSettingsProposal` is the only path to `setSettings`, and it validates the
  proposal a second time first. Fields are full replacements, so the patch is built
  by checking each field's *value*, not its presence — only fields that are not
  `undefined` go into the patch. After normalization, OpenAI-style responses have
  all keys present but some as `undefined`, and spreading an explicit `undefined`
  would blank the other fields, so value checks guard the write (`if (goals !==
  undefined)`). Anthropic-style responses omit the keys entirely, which also works
  correctly. `declineSettingsProposal` writes nothing. The screen holds no approve/decline logic; it is not jest-covered.
- **`aiChatStore` is ephemeral, with two counters that are not interchangeable.**
  `generation` scopes the *conversation*: `reset(mode)` bumps it so a request resolving
  afterwards is discarded rather than appended. `systemEpoch` scopes the *prompt cache*
  alone and guards cache repopulation, so a `buildSystem` already in flight cannot write
  a stale prompt back. `reset` advances both; an approved settings write advances only
  `systemEpoch` — the cached prompt embeds goals, equipment, and coaching style and
  must be rebuilt, but the conversation continues and an in-flight response still
  lands. Collapsing the two back into one counter reintroduces exactly that bug. `acceptDraft` re-entry is latched
  in the store — a second same-frame call returns `null` instead of writing a duplicate
  routine; the screen's `accepting` state is cosmetic, so the latch also looks removable
  and is not. Deps are injected (`AiChatDeps`) so the whole turn path tests without
  network or DB.
- **Rest commentary has two remark shapes and the engine snapshot picks which.**
  `ScheduleRest` leaves `advance_after_set` from exactly two sites that differ in
  `setIndex`: the round-repeat rest writes `setIndex + 1` (always >= 1, position
  stays inside the superset group), the group-exhausted rest writes `0` and moves
  to a fresh landing. So during Resting, **`setIndex >= 1` means the rest landed
  inside an exercise/group and `setIndex === 0` means it landed between two** —
  a positional test, correct where an `exerciseId` comparison is not, since a
  routine may list the same exercise twice. `restCommentaryTarget` builds the
  `lastSet` shape from `lastLoggedSet` for the first and keeps the `upNext` shape
  for the second, and `buildRestCommentaryPrompt` carries the shape all the way
  through: the **whole system brief** is per-shape — `UP_NEXT_BRIEF` and
  `LAST_SET_BRIEF` differ in their opening sentence, their second paragraph and
  two of their rules — and the message heading switches with it (`## Last Set`
  vs `## Up Next`), because "comment on the exercise coming up" contradicts the
  data the `lastSet` message sends. The `lastSet` shape yields **silence** —
  never a fallback to `upNext` — on three guards: no `lastLoggedSet`, a
  `setType === 'warmup'` (the test must be `!== 'warmup'`, since transition.lv
  stamps the entry's own `kind` for cardio/stretch and an equality test kills the
  feature on every non-strength exercise), or a `lastLoggedSet` that does not
  belong to the entry the round just left. That last guard exists because
  `SetDone` ("Skip Set") never writes `lastLoggedSet`, so a rest reached by
  skipping still carries the previous set. It is **two layers, and both are
  needed**: the pure comparison against the performed entry catches the
  cross-member superset case, while the store's `claimLogIndex` latch (one remark
  per logged-set index, re-readable by the rest that owns it) catches the
  same-entry case, which no snapshot-only test can see. The cache key moved from
  `sessionId#entryIdx` to the rest's own position, `sessionId#exerciseIndex:setIndex`,
  so each working set gets its own remark — a deliberate ~4x call-count increase,
  accepted in #270. `restCommentaryKey` is exported and **`src/app/session.tsx`
  must call it** rather than rebuilding the key — **and** the screen's commentary
  effect must keep `commentaryKey` in its dep array, or the effect stops
  re-firing per working set and every set after the first silently re-serves the
  first one's remark. Those are two separate hazards and each has its own
  structural test in `restCommentaryStore.test.ts`: one asserts the screen calls
  the exported builder rather than a hand-rolled copy, the other asserts the
  dep-array entry is present. Both are structural reads of the source, the AC6.9
  precedent applied twice, because `src/app` is jest-invisible and nothing can
  load the screen to test either behaviourally.
- **Three one-shot AI features share the conversation slice's conventions without
  its store.** Rest commentary (`restCommentary*`), the exercise Question button
  (`exerciseQuestion*` — ephemeral per-entry cache keyed by
  `exerciseQuestionKey`, answer never persisted), and Replace-button alternates
  (`alternates*` + `acceptAlternate` — validate on receipt AND at swap; `kind`
  always from the entry, never the model; duplicate titles rejected at slug level)
  each have their own prompt builder, and their own client per provider. All follow the
  same rules: free text neutralized, immutable directives last, secret-leak regression
  tests, network-vs-HTTP failure types, every failure swallowed (a workout never depends
  on the AI), deps injected for the node jest project. Known accepted debt: `neutralizeForPrompt`
  exists in multiple copies and the POST/parse boilerplate is duplicated across both
  `anthropicClient.ts` and `openaiClient.ts` (plus the one-shot alternates and question
  clients for each provider, totaling 8 copies) — hoisting them is a tracked follow-up;
  don't add another of either. `buildOpenAiBody` (`src/ai/provider/requestBuilder.ts`)
  centralizes the Responses API body format to reduce drift; Anthropic clients build
  their own request bodies and prompt builders are kept per-surface.
- **Immutable directives must remain the last section of every system prompt.** They are placed
  after every section built from user-controlled free text (goals, equipment, personality,
  routine notes, exercise titles) to preserve their precedence against injection attempts.
  The placement is enforced in four builders: `buildSystem` (`src/ai/contextBuilder.ts`),
  `buildRestCommentaryPrompt` (`src/ai/restCommentaryPrompt.ts`), `buildAlternatesPrompt`
  (`src/ai/alternatesPrompt.ts`), and `buildExerciseQuestionPrompt` (`src/ai/exerciseQuestionPrompt.ts`);
  the directive text itself lives in `src/ai/coachDirectives.ts`.

## Testing gotchas

- Jest runs a **single `node` project** (`jest.config.js`), not jest-expo. Its
  `testMatch` covers `engine/db/interop/state/health/helpers/ai/theme/watch/components/export` — all pure TS, no
  RN runtime. A new `src/` domain gets no test coverage until it is added to that list.
  The commented-out `rn` project is intentional future work; don't assume RN-env tests
  run — screens (including `ai-coach.tsx`) are therefore untested by `npm test`.
- Because of that boundary, **layout in `src/components`/`src/app` is invisible to
  every suite**: a green run proves nothing about it (PR #66 shipped a 2pt-collapsed
  ScrollView past 159 passing tests — `flex: 1` inside an auto-height parent).
  Verify layout changes in the simulator, or model the node tree with Yoga, before
  calling them done.
- `watchman: false` is required — watchman's crawl hangs jest startup on this machine.
- **The intermittent "A worker process has failed to exit gracefully" warning is
  cosmetic, and the obvious explanation for it is measured-wrong.** WatermelonDB's
  `WorkQueue.enqueue` does register a 1500ms dev-mode timer on every *contended*
  enqueue that is never cleared or `.unref()`ed (`NODE_ENV !== 'production'`, and
  jest sets `test`), and it does hold a worker's event loop open ~1497ms — that
  much is proven (#186, `scripts/repro-workqueue-timer.mjs`). But it is **not**
  the source of the warning: a 16-run interleaved A/B of the full suite
  (`scripts/measure-worker-exit-warning.mjs`), load spanning 22–75, produced
  **0/8 warnings in both arms** — with and without the timer unref'ed. The
  harness was positive-controlled in the same session (a deliberately leaked
  ref'd timer makes it report 1/1 in both arms), so that is a real negative and
  not a dead detector. The 1497ms hold simply stays under jest's force-exit
  threshold. The warning is real but rare and tracks ambient machine load; its
  actual cause is unattributed and nothing is broken. Do **not** "fix" this by
  running jest with `NODE_ENV=production` — that gates 41 executed sites across
  20 files in WatermelonDB (schema, query, migration and model invariant checks;
  `scripts/count-watermelondb-node-env-gates.mjs` derives it), trading 40 dev-mode
  checks for one cosmetic message. See #129, closed with this measurement.
- ts-jest transform pins `useDefineForClassFields: false` + `experimentalDecorators`/
  `emitDecoratorMetadata`. WatermelonDB models rely on legacy decorator semantics;
  class-fields-define would shadow the `@field`/`@relation` getters and silently break
  the models. Do not "modernize" these compiler options.
- `npx tsc --noEmit` can report a false-positive route error on a **brand-new dynamic
  route** — e.g. an "argument of type `/workout/${string}` is not assignable to
  parameter of type ... 52 more ..." on a correct ``router.push(`/workout/${id}`)``.
  Expo Router's typed routes come from `.expo/types/router.d.ts`, which is gitignored
  and regenerated per-machine by Metro only when it notices the `src/app` route tree
  change; a checkout that hasn't run `npm start`/`npm run ios` since a new `[id].tsx`
  route landed is still type-checking against the old route set, so a structurally
  correct template-literal push (the established pattern — see the existing
  `/routine/${id}` and `/exercise/${id}` pushes) gets rejected as if the route didn't
  exist. There is no CI job running `tsc`, so this only ever surfaces locally. Before
  changing code to chase a route-shaped tsc error, regenerate types (run the dev
  server once, or copy a fresh `.expo/types/router.d.ts` from a checkout that has) and
  re-run `tsc --noEmit` — a stale cache, not the route push, is the usual cause.
- **A `tsc` error on a brand-new static route** — e.g. `/settings/ai-provider` on a checkout
  that hasn't run Metro since the route landed. `.expo/types/router.d.ts` enumerates
  static routes as literals, not templates, so a new route landing in a worktree shows
  as absent to `tsc` until Metro regenerates the file. The remedy is the same: run the
  dev server once or copy a fresh `router.d.ts` from a checkout that has, then re-run
  `tsc --noEmit`. A worktree with no `.expo/types/` at all type-checks everything because
  `expo-router` falls back to `string`.
- **Fire-and-forget DB writes need `flush()` before assertions, not a bare
  `setImmediate` or a bare `setTimeout(fn, 0)` alone — both of `flush()`'s
  two stages are load-bearing, and `flush()` itself only advances the queue
  by one extra step, not a full drain.** Effect executors like
  `onCompleteSession` dispatch side effects that return promises but do not
  await them. WatermelonDB's WorkQueue routes a write queued behind another
  via a real `setTimeout(fn, 0)` timer (not a microtask), scheduled from the
  promise continuation after the preceding item resolves. Call `flush()`
  (`src/db/test-helpers.ts`) the way every real call site does — synchronously,
  right after the writes, no special setup — and it catches a queue depth of *two*
  pending writes in the high-90s% of
  individual calls (~90% per run, measured as 46/51 fresh-process full-passes
  on a 10-trial measurement), where either a bare `setImmediate` or a bare
  `setTimeout(fn, 0)` alone catch it in 0% of runs. An earlier version of
  `test-helpers.test.ts` anchored its probe inside a nested `fs.readFile` I/O
  callback, reasoning that pinning a deterministic starting event-loop phase
  would make the test more reliable. That reasoning had it backwards for how
  this codebase actually calls `flush()`: anchoring inside a check-phase
  callback changes which of WorkQueue's timer and `flush()`'s own first-stage
  timer is queued first, which made that specific test unable to tell a real
  two-stage `flush()` apart from a one-stage `setTimeout(fn, 0)`-only
  implementation — both passed. The current test uses the plain, unanchored
  call shape instead, which matches every real usage and catches the round-5
  blind-spot mutation (the anchored test passed against a one-stage
  implementation, proving it was missing this detection). Since a single
  10-trial run is only ~90% reliable (individual `flush()` calls are ~99%
  reliable; one miss in ten trials is enough to fall short), the guard test
  itself retries the 10-trial measurement up to 3 times and passes as soon
  as any attempt reaches 10/10
  caught, giving the guard ~99.9% reliability (1 − 0.1³). A genuinely broken
  one-stage implementation stays 0% across all 3 attempts and still fails the
  test. `test-helpers.test.ts` is the actual source of truth for this
  contract — it repeats the probe and separately demonstrates (as documentation,
  not as the guard) that the two weaker alternatives never catch the write.

  `flush()` is not a guarantee for arbitrary queue depth — a sequence that
  queues three or more writes (e.g. `onCompleteSession` draining several
  pending set-persists and then doing its own `database.write`) needs the
  bounded-retry/poll-until-true idiom already used at `activeSession.test.ts:512,601`
  (the two `for (let attempt ...)` bounded-retry loops), not a single `flush()`
  call. Always check for this hazard when asserting on DB state
  after fire-and-forget writes, and reach for a bounded retry over a fixed
  number of `flush()` calls whenever the queue depth isn't obviously 1 or 2.

## Structure

- `src/engine/` — pure Rill core + host dispatch/effect mapping (`rules/*.lv`)
- `src/db/` — WatermelonDB schema, models, repository; `adapter.ts`/`adapter.web.ts`
  select SQLite vs LokiJS per platform
- `src/interop/` — vault markdown serializer/parser
- `src/export/` — the only production consumer of `src/interop/serialize` (nothing
  outside tests consumes `parse.ts`); maps DB rows to the serializer, normalizing
  WatermelonDB's `null` to `undefined` at the boundary. **Not yet wired to any
  screen** — it has no callers outside its own tests
- `src/state/` — Zustand stores (session + AI chat), presenters, settings,
  session start/rehydrate; `aiProviderSettings.ts` (provider/key/model pure functions),
  `aiChatErrorCopy.ts` (error messages with provider attribution)
- `src/health/` — HealthKit write-only export
- `src/ai/` — AI coach: turn/draft schema + validators, system-prompt builders,
  coach directives, draft→repository accept path, plus the one-shot features
  (rest commentary, exercise question, replace alternates)
- `src/ai/provider/` — multi-provider abstraction: `createAiClient` factory routes to
  Anthropic or OpenAI based on configured keys; unified `AiClient` interface; `buildOpenAiBody`
  centralizes the OpenAI Responses API format (Anthropic clients build requests inline);
  `models.ts` holds the constrained model list and per-surface resolution logic
- `src/theme/` — design tokens: `ActionButtonColor` (the four action hues,
  each darkened to clear WCAG AA 4.5:1 text contrast against both white and
  black backgrounds; also used on non-button solid fills like the AI chat
  bubble and kind tag) and `StatusColor` (danger; currently just the session
  error banner). `BackgroundColors` (light/dark element, error bubble) and
  `ThemedBackgroundText` (text colors for those non-white backgrounds).
  `ProgressBarColors` (`progressColors.ts`) — the session-screen progress
  bar's fill/track colors, deliberately its own theme token
  (`progressTrack`) rather than reusing the general-purpose
  `backgroundSelected` (~16 unrelated consumers: input borders, list
  separators, etc.) even though the values happen to coincide. Every text
  color pair here is verified by the `contrastRatio` pure function against
  its target background at the 4.5:1 text bar; `ProgressBarColors`'s
  fill/track pairs are additionally checked at the lower 3:1 graphical bar
  under WCAG 1.4.11 — that 3:1 check does not extend to every non-text
  graphical fill in the app (e.g. slider `minimumTrackTintColor` values are
  unchecked), only to this module's own fill/track pairs
- `src/app/` — expo-router screens

## Boundaries

- Safe to edit: `src/`
- Session-flow logic changes go in `src/engine/rules/*.lv`, never in the store/components
- A routine may list the same exercise more than once, so a routine *entry* is
  identified by its `routine_exercises` row id, never by `exercise_id` — React list
  keys, logged-set attribution (`session_sets.routine_exercise_id`), and
  `upsertRoutine`'s duplicate matching all depend on that row id. Presenters must
  therefore surface it (`ExerciseDetail.routineExerciseId`)
- **A set's performed exercise is its own `session_sets.exercise_id` (schema v3),
  not the row's.** The row's `exercise_id` is mutable (the Replace flow re-points
  it), so the row join is only the *legacy fallback* for pre-v3 sets whose stamp is
  null. `appendSet` stamps every new set from the engine entry (the value
  `onPersistSet` already verified), and every identity reader —
  `getExerciseWorkingSetHistory`, `getSessionExerciseLog`,
  `getRecentSessionSummaries`, the markdown export — resolves stamp-first,
  join-fallback. `updateRoutineExerciseExerciseId` is the ONLY path allowed to
  re-point a row, and the same layer-2 defense binds it and `upsertRoutine`'s
  drop branch — the only other path that invalidates the join: inside the same
  `database.write`, stamp every attached null-stamped set with the row's outgoing
  identity *before* re-pointing or destroying the row. Any future path that does
  either owes the same stamp. The *single-write* half of that is pinned
  behaviorally (#225), not just by review: WatermelonDB's writer is a
  serialization primitive over a FIFO queue rather than a rollback-capable
  transaction, so "one write" means "no other writer ever sees the row
  half-swapped" — and `replaceRoutineExercise.test.ts` asserts exactly that by
  queueing a competing writer behind an un-awaited swap. Hoisting any of the
  three effects (stamp, clear `target_weight_kg`, re-point) into a second
  `database.write` fails it; before that test all three splits left the suite
  green. `deleteRoutine` is exempt only because it
  deliberately retains the rows as history carriers rather than destroying them.
  A new reader that resolves a set's exercise through the row alone reintroduces
  the PR #65 history-corruption bug. One rendering consequence: a swapped row's
  sets can span two performed identities, so session-detail entries key on the
  `(routineExerciseId, exerciseId)` pair (`sessionDetailPresenter` exposes both;
  `workout/[id].tsx` keys on the pair), not the row id alone. Resolving identity
  stamp-first is necessary but **not sufficient**: a reader that *iterates*
  `routine_exercises` still loses sets whose row was destroyed —
  `upsertRoutine`'s drop branch is the only `destroyPermanently` on that table.
  Iterate the sets, or reconcile the leftovers, as `serializeSession` does
- `routine_exercises.target_weight_kg` is a coach-prescribed target load, nullable,
  added at schema v5. **It is stored in kg and the coach speaks lbs.** There is
  exactly one write-side conversion, `lbsToKg` in `acceptDraft`, and the read edges
  are `computeSetPrefill` (`kgToLbs`) and `formatExerciseLine` (`formatWeightLbs`).
  A second conversion site is how a value gets converted twice. The bound is a
  **positive multiple of 0.5 lbs**, enforced in `validateRoutineDraft` and stated
  in `personaSection()`. It is the first non-integer field in the draft contract,
  which is why the persona's numeric guidance carries an explicit exception.
  `AI_TURN_SCHEMA` declares it as `number` with **no** bound keyword — `minimum`
  and `multipleOf` are both on `UNSUPPORTED_SCHEMA_KEYWORDS`. A prescription
  **overrides** the history-derived prefill and is **outranked** by the exercise's
  own last set this session. It is scoped to the weight field: reps still come from
  history. `updateRoutineExerciseExerciseId` must also clear `target_weight_kg`,
  because sets/reps/rest are near-dimensionless across substitutes while load is
  not, and because a prescription overrides history rather than deferring to it, a
  stale one wins over the substitute's own correct numbers instead of quietly
  losing to them. Clearing the column is only half of it: the session screen's
  prefill effect and `applyAlternateToRoutine`'s write are independent async paths
  off the same dispatch, with no ordering between them, so `exerciseReplaceStore.routineRevision`
  is bumped **after** the write and the prefill effect depends on it. The contract
  has two halves: bump strictly after `applyToRoutine` resolves, and never on a
  rejected swap or a thrown write. **The store mechanism is pinned by AC6.7 tests in
  `src/state/exerciseReplaceStore.test.ts`. The screen's consumption of it —
  `session.tsx:303` depending on `routineRevision` — has zero automated cover: no
  test suite can load the screen, and deleting the dependency array entry passes all
  tests. AC6.9 is the only safeguard: a structural read verifying the entry is
  present.** Its scope is explicit and load-bearing: it bumps
  on exercise swaps only. `upsertRoutine` is the other writer of `target_weight_kg`,
  so a coach revising a routine through `acceptDraft` can change or clear a
  prescription and bump nothing — a session screen that stays mounted across such an
  edit keeps the stale value until it remounts. That is not a live defect (editing a
  routine mid-session is not a supported flow, and nothing outside the session
  screen's own prefill reads a prescription), and the name is deliberately about the
  *routine* so an `acceptDraft` bump can join the same counter later without a
  rename. Do not assume routine edits are covered today.
- A routine entry may plan zero sets — `target_sets` is nullable, the persona makes
  `targetSets` optional, and `startSessionFromRoutine` maps the `null` to 0 — so no
  display path may render "Set 1 of 0". `deriveSetPosition` (`sessionPresenter.ts`)
  feeds *two* independent label builders: `createSessionPresenter`'s
  `setPositionLabel`, and `setPosition` in `src/ai/restCommentaryPrompt.ts`, which
  reaches the derivation through `restCommentaryTarget` and never touches the
  presenter — so a guard on one does not cover the other. Both return `''` when
  `warmupSets + targetSets === 0`, and both consumers read that as *hide*
  (`SetLogger` skips the row; `buildRestCommentaryPrompt` drops the empty segment
  from its "Up Next" *and* "Last Set" line — one guard, both shapes, since the
  two share `setPosition`). The sum is the exact condition, not a conservative one:
  both activity predicates in `helpers.lv` key on that sum — `h.next_active_idx`
  treats an entry as active for round `r` iff `r < warmupSets + targetSets`, and
  `h.next_active_landing` iff the sum is nonzero — so only a zero total can reach a
  zero denominator. Engine convention 10 now keeps `exerciseIndex` off zero-set
  entries in the first place, which demotes these guards to a layer-2 defense but
  does **not** make them dead code: rehydrate restores a stored `exerciseIndex`
  through a `hydrate` call that no rule ever validates (convention 5), so a session
  persisted by a build predating that rule comes back sitting on exactly such an
  entry. `sessionDetailPresenter` is the
  third label site and needs no guard — it renders `Set N` with no total.
  `sessionPresenter.isLastSetOfExercise` is the fourth site that checks
  `warmupSets + targetSets` — it's the first one whose correctness depends specifically
  on convention 9's round-number semantics (not just "is this entry active"), so
  integration tests through mismatched-set-count supersets guard against future
  changes to `helpers.lv`'s `next_active_idx` predicate or `transition.lv`'s
  `setIndex` carry-over that could silently break the popup's timing
- Starting a session mirrors that same condition one layer up.
  `startSessionFromRoutine` refuses a routine where *every* entry has
  `warmupSets + targetSets === 0`, the same as it already refused one with no
  exercises at all — a routine can have exercises yet still have nothing for
  `h.next_active_landing` to land on. **The live source of such rows is history,
  not any current write path:** routines imported before `upsertRoutine` learned
  the zero-total default were left with `target_sets` null or 0, and with vault
  import gone there is no re-import to heal them. A stored `exerciseIndex` can
  also come back through `hydrate` pointing at such an entry (convention 5). Do
  not read these guards as dead just because no code still *creates* the shape.
  `hasActiveExercise` carries that sum-based check
  through `routineListPresenter` and `routineDetailPresenter` into
  `todayStartPresenter`'s `startable` flag and `routine/[id].tsx`'s start
  button, so a routine that can't actually be started never renders as
  startable — the engine's `Err` is a backstop for a case the shell should
  already have kept the user from reaching, not the only guard against it
- AI turn payload shapes *and* validation bounds must be mirrored across
  `AI_TURN_SCHEMA`, the validators, and the persona prompt (all in `src/ai`)
- The AI accept path may create exercises but must never mutate existing ones
- An AI-proposed settings change must be approved by the user before it is written
- Do not touch generated Rill dist or the `../rill-lang` tarball dependency by hand
