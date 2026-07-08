# HMB Workout — Human Test Plan

On-device verification for the criteria that no in-repo test can exercise: the RN render
layer and native-runtime behaviors (process-kill, backgrounding, notifications, HealthKit,
real bridge over Tailscale). Automated logic coverage is green — app repo `npx jest` (292
tests) and bridge repo `npm test` (22 tests). This plan covers the remaining human/device
checks.

## Prerequisites
- iPhone with a dev/TestFlight build (native SQLite JSI, HealthKit, expo-notifications compiled in — not Expo Go).
- Bridge running on the Mac: `cd ~/Projects/workout-bridge && npm start`. Console prints the listen host:PORT and the vault sync dir (`2-Areas/Exercise/_sync`).
- iPhone + Mac on the same Tailscale tailnet; note the Mac's tailnet hostname/IP.
- App Settings configured with the bridge base URL (`http://<tailnet-host>:<PORT>`) and the bearer token matching the Mac's `.env` `BRIDGE_TOKEN`.
- At least one migrated Push/Pull/Legs routine present in `2-Areas/Exercise/_sync/`.

## Phase A — Boot & rule loading (AC10.2 render)
| Step | Action | Expected |
|------|--------|----------|
| A1 | Cold-launch the app | Boots to home/routines; no RuleErrorScreen / red error surface |
| A2 | (Optional negative) ship a type-broken `.lv` rule, relaunch | Boot RuleErrorScreen names the failing rule; never a mid-workout error. Restore the rule after |

## Phase B — Routine import over the real bridge (AC4.5 tailnet, AC7.2 semantics)
| Step | Action | Expected |
|------|--------|----------|
| B1 | From iPhone Safari hit `http://<tailnet-host>:<PORT>/health` | `{"ok":true}` |
| B2 | In the app, trigger "Import routines" | Push/Pull/Legs appear in the Routines list; no error |
| B3 | Open a migrated routine's detail | Exercises, target sets×reps, rest, superset grouping, warm-up counts match the source `_sync/*.md` (AC7.2, AC8.4 display) |

## Phase C — In-session logging, RPE, progression hint (AC2.2, AC9.1, hint render)
| Step | Action | Expected |
|------|--------|----------|
| C1 | Start a session from a routine with warm-ups | First exercise shows; warm-up sets before working sets |
| C2 | On a strength exercise with prior history (e.g. prior 3×8 @ 100kg, RPE 7–8), look below the exercise title | Progression hint (e.g. "Increase weight by 2.5 kg" / "Hold current weight") renders as display-only text |
| C3 | Enter reps + weight, open the RPE control | Offers 1–10 in 0.5 steps; blank = unrated |
| C4 | Pick RPE 7.5, tap "Log Set" | Set appears in the log showing RPE 7.5 |
| C5 | Tap "Log Set" several more times | Hint text persists and never changes which set/exercise is current (display-only) |
| C6 | Tap "Set Done" on an exercise with rest > 0 | UI advances to rest; a rest countdown/notification is scheduled |
| C7 | Advance through a superset pair | After the first partner's set, the app moves to the second superset exercise before resting (AC8.1) |
| C8 | Reach a stretch/cardio entry | Shows a duration input (no reps/weight); logging by duration advances (AC8.3) |

## Phase D — Rest alert, audible/haptic (AC2.1)
| Step | Action | Expected |
|------|--------|----------|
| D1 | Trigger a rest, lock the phone or leave the app, wait past the deadline | Local notification fires with sound + haptic; actually audible/felt |

## Phase E — Backgrounding & resume (AC2.3, AC10.4/10.6 reconciliation)
| Step | Action | Expected |
|------|--------|----------|
| E1 | Mid-session with several logged sets, background the app for several minutes past a rest deadline | — |
| E2 | Reopen the app | Session + all logged sets intact; expired rest reconciled (phase advanced past resting, next set shown); no timer drift |

## Phase F — Process-kill persistence (AC1.1, AC10.4 rehydration)
| Step | Action | Expected |
|------|--------|----------|
| F1 | Mid-session with logged sets, force-quit (swipe up in app-switcher) | App terminated |
| F2 | Relaunch | In-progress session + every logged set reappear via loadActiveEngineState→Resume; current phase/exercise correct |

## Phase G — HealthKit write (AC6.1, AC6.2)
| Step | Action | Expected |
|------|--------|----------|
| G1 | First completion: grant Health write authorization when prompted | Authorization dialog appears and is accepted |
| G2 | Finish a session | Completion succeeds |
| G3 | Apple Health → Browse → Activity → Workouts | A strength-training workout with start/end matching the session and active energy populated |
| G4 | (Optional, AC6.2) Deny the app's Health write access in Settings, complete another session | Session still saves locally and syncs; no crash — isolation holds against the real denied path |

## End-to-end — device → bridge → vault (AC7.1)
Proves the full real chain (device logging → HealthKit → bridge over tailnet → actual file on vault disk) that automated tests only mock.
1. Bridge up, iPhone on tailnet, Health authorized.
2. Import routines (Phase B), start one, log a full session including a warm-up, a working superset, an RPE, and a stretch.
3. Finish the session; trigger sync.
4. Confirm a `session-<id>.md` note appears in `2-Areas/Exercise/_sync/` on the Mac.
5. Sync again — confirm no duplicate file is created (idempotency, AC4.3/AC5.3 live).

## Sync resilience on-device (AC5.1)
With the bridge stopped (or tailnet off), finish a session — it stays `local`, no error. Restart the bridge / rejoin tailnet, sync again — the session posts and flips to `synced`; the `session-<id>.md` appears.

## Obsidian format spot-check (AC3.2, optional)
Open one exported `session-<id>.md` in Obsidian; confirm the Tasks plugin renders the `✅ YYYY-MM-DD` checkbox and the frontmatter (`type: workout-session`, `id`, `date`, `tags`, `created`) is recognized.
