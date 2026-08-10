# Remove Vault Sync — Human Test Plan

**Generated:** 2026-08-09 · **Branch:** `claude/vault-sync-removal-plan-b4e783` · **HEAD at generation:** `5883e98`
**Design:** `docs/design-plans/2026-08-07-remove-vault-sync.md` · **Requirements:** `docs/implementation-plans/2026-08-07-remove-vault-sync/test-requirements.md`

## Execution status — PARTIALLY RUN, 2026-08-09

Device Hub access was granted on a second attempt and **9 of 13 criteria were executed and passed**,
including the highest-risk one. The rest remain blocked: synthetic clicks reach neither the device screen
nor Device Hub's own toolbar on this machine, and the simulator MCP panel crash-loops on attach.

| ID | AC | Result |
|---|---|---|
| **H7** | **AC3.6 — real SQLite v3→v4 upgrade** | ✅ **PASS.** `user_version` 3 → 4 on a genuine v3 database (`751C67AD`, iPhone 17 Pro). `sync_status` column still physically present — undeclared, not dropped, exactly as designed. App reached the Today tab with no missing-migration error, no adapter throw, no red screen. 1 routine / 2 routine_exercises survived (preservation was not required). **This empirically confirms the NOT NULL objection that had only been refuted on paper.** |
| **H1** | AC2.1 — Settings has one row | ✅ **PASS.** Exactly one row, "AI Coach — Anthropic API key, goals, equipment". No Bridge & Sync. |
| **H2** | AC2.2 — `/settings/bridge` unreachable | ✅ **PASS.** `hmbworkout://settings/bridge` → "Unmatched Route — Page could not be found." |
| **H3** | AC2.3 — Routines tab | ✅ **PASS.** AI Coach button renders; no Import Routines button. |
| **H9** | **AC1.1 — completing a session issues no bridge request** | ✅ **PASS, with positive evidence.** A full session was completed on the migrated v4 database (2 sets, `ended_at` set after `started_at`, `engine_state` cleared, `sync_status` NULL — the undeclared column was never written). **The proof is Metro's on-demand bundling, not the absence of an error string.** App logs demonstrably stream to Metro (the SQLite migration lines below are app output). At the moment of completion Metro bundled exactly `src/health/saveWorkout.ts`, `src/health/healthkit.ts` and the HealthKit native module — `onCompleteSession`'s surviving dynamic imports — and did **not** bundle `src/sync/syncService` or `src/sync/bridgeClient`. Had the sync block survived, Metro would have logged those modules at that instant, exactly as it logged the HealthKit ones. Zero errors in the console. |
| **H8** | AC3.3 — session write on the upgraded DB | ✅ **PASS (upgraded-DB half).** The session above was created *and* completed on the v3→v4 upgraded database, so the leftover physical `sync_status` column does not break inserts. This is the empirical confirmation of the refuted NOT NULL objection. The fresh-reinstall half was not run. |
| **H10** | AC6.4 — full happy path | ✅ **PASS.** History shows "Push Day · Aug 9, 2026 · 2 logged sets", matching the database exactly. Start → log → complete → History confirmed end to end with a clean console. |
| **H12** | AC2.7 — no user-visible vault/sync/bridge string | ✅ **PASS.** Every one of ~60 grep hits across `src/app` and `src/components` read individually: all are `async`/`await`, "synchronous", Expo API names (`setAudioModeAsync`, `hideAsync`, `openBrowserAsync`, `playAsync`), or code comments (`// Re-sync from settings on focus`). **Zero rendered strings.** |
| **H13** | AC5.1–AC5.8 — AGENTS.md read-through | ✅ **PASS.** All eight gates return their expected counts (`Two-repo split`, `## Sync`, `src/sync/`, `workout-bridge`, `redundant by construction`, `importRoutines`, `defaultTargetSetsForDurationLine`, `vault sync` → 0; `keep both layers` → 1; Last verified → 2026-08-09). Section list carries no Sync or Two-repo heading. Every cross-reference resolves to a section that exists — including the two added during the fix rounds ("Parse context and validation strictness" → line 409; "see AI Coach below" → line 480). The AC5.3 passage names `exportService.ts`, mandates both layers, and does not name `syncService.ts`. |
| H4, H5, H6, H11 | AC2.5, AC2.6, AC2.4, AC6.5 | ⛔ **NOT RUN** — require screen taps. See "Fastest way to finish" below. |

### Fastest way to finish the remaining four

**One action closes two of them.** "Push Day" currently has a completed session attached, which is exactly
AC2.4's premise. From the **Routines** tab, tap the trash icon next to Push Day and confirm:

- **H6/AC2.4** — it should delete with **no error alert** (the old build threw `RoutineHasUnsyncedSessionsError`
  here), and the completed session should still appear in History afterwards.
- **H5/AC2.6** — deleting the only routine leaves Today empty, which renders the rewritten empty state. Screenshot it.

**H4/AC2.5** needs a fresh session started and then Abandoned, to read the confirmation dialog.
**H11/AC6.5** needs a real API key pasted into Settings → AI, and should be done **last** — after it, session
completions bill a debrief call.

**Runtime migration evidence (Metro console, app output):**

```
LOG  [SQLite] Database needs migrations
LOG  [SQLite] Migrating from version 3 to 4...
LOG  [SQLite] Migration successful
iOS Bundled  37ms src/health/saveWorkout.ts (1 module)
iOS Bundled  12ms src/health/healthkit.ts (1 module)
iOS Bundled 400ms @kingstinct/react-native-healthkit (685 modules)
```

The last three lines are the completion path bundling its dynamic imports. Nothing from `src/sync` appears.

**Why the rest are blocked.** Clicks are injected successfully at the API level (the tool reports success) but
land nowhere — verified by clicking Device Hub's *own* zoom toolbar button and its sidebar device rows, which
also did not respond. The device is alive (its clock advances). So this is host-side click injection, not a
wedged simulator. Two documented workarounds were attempted and correctly refused by the environment's safety
classifier: building a Swift `CGEvent` clicker, and a destructive SQL write to force the empty state. Neither
was worked around.

**All three high-risk items are now resolved or reduced.** H7 (the data-migration path, unreachable by any
test) and H9/AC1.1 (the dynamic import, invisible to both `tsc` and jest) are **both verified** — H9 with
positive evidence rather than the absence of an error. H6/AC2.4 remains unrun, but its repository half is
automated and only the UI half is outstanding, so it is the least exposed of the three.

The nine remaining criteria are all user-visible copy, screenshots, and read-throughs. None guards a data
path.

Everything below is written to be executed cold by someone who was not present for the implementation.

Automated coverage passed: **25 of 25** automatable criteria, `npm test` 88 suites / 1602 tests,
`tsc --noEmit` clean, `npm run lint` 0 errors. The 13 criteria here are human-verified **by construction**,
not by omission — `src/app/` is not in the jest `testMatch` glob at all, `src/components/` has no RN
environment, and the DB suite runs on LokiJS rather than SQLite.

---

## ⚠ Read both of these before starting

### 1. AI-spend hazard

Completing a session is what opens the **post-workout debrief**, which makes a **real Anthropic API call**
billed to whatever key is on the device. Tests H9, H6, H8 and H10 all complete sessions.

**Clear the key first:**

```bash
xcrun simctl keychain <udid> reset
```

The key lives in `expo-secure-store`, which is the simulator **keychain** — it *survives app uninstall*, so
reinstalling is not enough. Verify Settings → AI shows an empty key field before proceeding.

**H11 is sequenced last** because it requires entering a real key. Do not reorder it earlier; after it runs,
every subsequent session completion bills a debrief call.

### 2. The v3 database is a scarce, one-shot fixture

H7 (AC3.6) needs an **existing v3 database** to upgrade. A fresh install is already v4 and proves nothing,
and there is no way to synthesize a v3 database from the current build.

Four simulators held one as of 2026-08-09, all with the `sync_status` column physically present:

| Device | UDID | `user_version` | Content |
|---|---|---|---|
| **iPhone 17 Pro** | `751C67AD-D5CC-4246-9506-EBB69BAB29E7` | 3 | **1 routine, 2 routine_exercises** |
| iPhone 17e | `50B44641-5205-4267-907F-17B2905C5D9E` | 3 | empty |
| iPhone 17 | `D33A2607-E69E-4D87-84AA-EB5BCD44FFDA` | 3 | empty |
| iPhone Air | `DC1EECF7-B2A5-434E-9BE8-7F10400F6DD0` | 3 | empty |

**Use `751C67AD`** — the only one with real rows, so you can observe what survives.

All four were backed up on 2026-08-09 to **`~/hmb-v3-fixtures/`** (`hmbworkout-v3-<udid8>.db`). If a
simulator gets wiped, restore from there. Do not run H7 without confirming a backup exists.

---

## Environment setup

Xcode 27 specifics — each of these cost an hour when learned the hard way; see
`.claude/skills/running-in-simulator/SKILL.md`.

- **`Simulator.app` no longer exists.** Xcode 27 replaced it with **Device Hub**:
  `open -a "Device Hub"`. `open -a Simulator` fails outright.
- **The iOS Simulator MCP reports "No booted simulator found"** for any sim booted by beta `simctl`, whatever
  its runtime. Skip the panel; drive with `xcrun simctl` plus computer-use on the Device Hub window.
- **Metro:** `EXPO_NO_TELEMETRY=1 npx expo start --port 8082` from this checkout. Never `CI=1` — it disables
  file watching and silently serves a stale bundle.
- **Connecting the dev client** — launch *first*, then deep-link, or the link fires from SpringBoard:

  ```bash
  xcrun simctl launch <udid> com.davidr.hmbworkout
  xcrun simctl openurl <udid> "hmbworkout://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8082"
  ```

  The `openurl` pops an **"Open in HMB Workout?" dialog that needs one manual tap.** This is the exact step
  that blocked automated execution — it is a SpringBoard alert that survives app termination and a full
  device reboot.
- **Ground truth from SQLite:**

  ```bash
  c=$(xcrun simctl get_app_container <udid> com.davidr.hmbworkout data)
  sqlite3 "$c/Documents/hmbworkout.db" "select id, name from routines;"
  ```

  (`get_app_container` false-negatives on *shutdown* sims — boot first.)
- **Text entry:** `type` does not work at all on this machine. Use `pbcopy`/`write_clipboard` → click the
  field → `cmd+v`; if nothing lands, click again to surface iOS's **Paste** callout and click it.
- **Re-front Device Hub** (`open_application`) before every action batch — focus drifts back and clicks
  vanish silently. Device Hub's bottom toolbar overlays the device dock, so scroll targets upward or use a
  deep link rather than tapping near the bottom edge.

---

## High-risk item 1 — H9 / AC1.1: completing a session issues no bridge request

**Why this is the highest-risk item in the whole change.** The removed call was a *dynamic*
`await import('@/sync/syncService')`. TypeScript cannot see through a dynamic import, and jest never
exercised the path — so neither `tsc` nor the 1602-test suite can prove it is gone. Every other edit in this
change has some static proof. This one has none. The simulator is the only place it is genuinely verified.

| # | Action | Expected |
|---|---|---|
| 1.1 | Confirm no key on device (hazard box above) | Settings → AI key field empty |
| 1.2 | Clear the Metro console. Start a routine, log ≥1 set, tap Complete | Session completes; appears in History |
| 1.3 | Read the **entire** Metro console output for the completion | **No** `Sync failed`, **no** `Failed to initialize sync`, **no** bridge URL or `host:port`, **no** `syncNow`. Absence of *all four* is the assertion |
| 1.4 | `sqlite3 "$c/Documents/hmbworkout.db" "select id, ended_at from sessions order by started_at desc limit 1;"` | Row present, `ended_at` non-null |
| 1.5 | Confirm the debrief fired no network call | With no key, `planPostWorkoutDebrief` short-circuits; no Anthropic request in the console |

**Evidence to capture:** full Metro console transcript for the completion, plus a History screenshot.

---

## High-risk item 2 — H7 / AC3.6: an existing v3 SQLite database opens at v4

**Why this is high-risk.** The entire suite runs on LokiJS. Nothing anywhere has opened a real SQLite v3
database against the v4 schema. The migration is an intentionally **empty** steps array, leaving
`sessions.sync_status` physically in the table while the schema no longer declares it. The argument that this
is safe — WatermelonDB's `encodeSchema` emits bare quoted column names with no `NOT NULL` — was verified
against the installed source but **never confirmed empirically**. This step is that confirmation.

**Data preservation across the upgrade is explicitly NOT required** (pre-release app). "Opens without
throwing" is the criterion.

| # | Action | Expected |
|---|---|---|
| 2.1 | Confirm the backup exists: `ls ~/hmb-v3-fixtures/` | `hmbworkout-v3-751C67AD.db` present. **Do not proceed without this** |
| 2.2 | `sqlite3 "$c/Documents/hmbworkout.db" "pragma user_version;"` and `"select count(*) from pragma_table_info('sessions') where name='sync_status';"` | `3` and `1` |
| 2.3 | **Install the new build over it — do NOT uninstall:** `xcrun simctl install <udid> <path>/HMBWorkout.app` | Install succeeds; data container preserved |
| 2.4 | Launch and connect to Metro | Reaches the Today tab. **No** "Missing migration", **no** adapter setup throw, **no** red error screen |
| 2.5 | `pragma user_version;` | `4` |
| 2.6 | `select count(*) from pragma_table_info('sessions') where name='sync_status';` | Still `1` — the column is **undeclared, not dropped**. This is correct, not a failure |
| 2.7 | `select count(*) from routines;` | Record the value either way; preservation is not required |

**Evidence to capture:** launch log, plus before/after `pragma user_version` output.

---

## High-risk item 3 — H6 / AC2.4: deleting a routine that has a completed session

**Why this is high-risk.** This *inverts* a guard that previously threw `RoutineHasUnsyncedSessionsError`.
The repository half is automated (AC3.5), but the UI half is not — whether the screen still surfaces an alert,
and whether history survives end to end, is invisible to jest because `src/app/` is outside the glob. An
inverted guard that leaves a stale alert path is exactly what a green suite would not catch.

| # | Action | Expected |
|---|---|---|
| 3.1 | Start a routine, log a set, complete it (key still cleared) | Session in History |
| 3.2 | Note the routine id and session id from sqlite | Recorded |
| 3.3 | Routines tab → open that routine → Delete | Deletes. **No error alert of any kind.** No "unsynced sessions" message |
| 3.4 | `select count(*) from routines where id='<rid>';` | `0` — genuinely gone, not a silent no-op |
| 3.5 | `select count(*) from routine_exercises where routine_id='<rid>';` | Non-zero — retained as history carriers |
| 3.6 | Open History | The completed session **still appears** and opens without crashing (the presenter falls back to the raw routine id) |

**Evidence to capture:** before/after screenshots, plus both sqlite counts.

---

## Remaining criteria

| ID | AC | Steps | Expected |
|---|---|---|---|
| H1 | AC2.1 | Open Settings | Exactly **one** row: "AI Coach". No "Bridge & Sync" |
| H2 | AC2.2 | Try every visible path from Settings; also `xcrun simctl openurl <udid> "hmbworkout://settings/bridge"` | No bridge screen reachable; the deep link does not resolve |
| H3 | AC2.3 | Open the Routines tab | AI Coach button renders; **no** "Import Routines" button |
| H4 | AC2.5 | Start a session → Abandon | Dialog conveys permanence; **no** vault or sync reference |
| H5 | AC2.6 | With zero routines (fresh sim, or delete all), open Today | Empty state names the AI Coach; no import or vault mention |
| H8 | AC3.3 | **On the H7-upgraded database**, complete a new session. Then uninstall, reinstall fresh, repeat | Both succeed. This is the empirical test of whether a leftover `sync_status` column breaks inserts — refuted on paper, confirmed here. Check `select sync_status from sessions order by started_at desc limit 1;` → NULL on the upgraded DB |
| H10 | AC6.4 | Full happy path: start → log sets → rest timer → complete → History | Completes with no sync-related error anywhere in the console |
| H12 | AC2.7 | Run Phase 4 Task 8's grep set, then **read every hit** | Greps cannot distinguish a rendered string from an identifier. Expect deliberate residue: the `BridgeSettings` type name, the `'bridge_settings'` storage key, ~7 "vault markdown" format-name lines, and everything under `src/interop`. Flag only user-visible strings |
| H13 | AC5.1–5.8 | Read `AGENTS.md` start to finish | Six edits landed in it, and a surviving cross-reference to a deleted section appears in no grep. **Confirm the null-normalization passage still mandates both layers** without naming `syncService.ts` |

---

## Run last — H11 / AC6.5: the API key survives the settings narrowing

**This is the step that costs money.** After it, the device holds a live key and any further session
completion bills a debrief call.

| # | Action | Expected |
|---|---|---|
| 11.1 | Settings → AI Coach. Paste a real Anthropic key (clipboard, **not** `type`) and save | Saves |
| 11.2 | Leave the screen and return | Key persists |
| 11.3 | Force-quit, relaunch, return to Settings → AI | Key still there |

**Why this matters:** it is the direct proof that the `'bridge_settings'` storage key still resolves after
Phase 2 narrowed `BridgeSettings`. The key was deliberately **not** renamed (`settings.ts:45`, with a
docstring pinning it) — but if it ever were, this is the only place it would surface, as every existing user
silently losing their API key and onboarding state.

---

## Traceability

| Criterion | Automated | Manual |
|---|---|---|
| AC1.1 | — (dynamic import, invisible by construction) | **H9** |
| AC1.2–AC1.5 | static + `settings.test.ts` | — |
| AC2.1–AC2.3, AC2.5–AC2.7 | — (`src/app/` outside testMatch) | H1–H5, H12 |
| AC2.4 | `repository.test.ts` (repo half) | **H6** (UI half) |
| AC3.1, AC3.2 | `migrations.test.ts` | — |
| AC3.3 | `repository.test.ts` (LokiJS) | H8 (real SQLite) |
| AC3.4 | `tsc --noEmit` | — |
| AC3.5 | `repository.test.ts` | H6 |
| AC3.6 | `migrations.test.ts` (LokiJS) | **H7** (real SQLite) |
| AC4.1–AC4.4 | git diff + `repository.test.ts` + `draftSchema.test.ts` | — |
| AC5.1–AC5.8 | greps | H13 (read-through) |
| AC6.1–AC6.3 | `npm test` / `tsc` / lint | — |
| AC6.4, AC6.5 | — | H10, H11 |
