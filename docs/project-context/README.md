# Project guidance reference index

Last verified: 2026-09-10 (organization only).

The former root `AGENTS.md` is split by its original section boundaries. All original
text is retained in these references; this reorganization does not re-verify or
change the underlying contracts. Paths in retained prose are relative to the
repository root unless explicitly qualified otherwise. Historical “above”/“below”
and section-name references refer to this map, not necessarily the current file.
“Engine convention N” means numbered item N in the engine reference.

Read only the reference needed for the current task. These files are not automatic
instruction imports. The root and scoped `AGENTS.md` entrypoints provide routing.

| Original section | Reference |
| --- | --- |
| HMB Workout, Expo version discipline, Tech stack, Commands | [Overview](overview.md) |
| Native iOS project; Building and installing | [Native iOS](native-ios.md) |
| Architecture: Functional Core / Imperative Shell; engine conventions 1–11 | [Engine](engine.md) |
| Schema migrations | [Database](database.md) |
| The vault markdown contract; Quoted flag values; Parse context | [Interop](interop.md) |
| HealthKit | [Health](health.md) |
| Exercise images | [Exercise images](exercise-images.md) |
| AI Coach | [AI Coach](ai-coach.md) |
| Testing gotchas | [Testing](testing.md) |
| Structure (including Hevy, theme, hooks and export wiring) | [Structure](structure.md) |
| Boundaries (supersets, identity, prescribed loads, prefill, zero sets) | [Boundaries](boundaries.md) |

For future updates, edit the reference that owns the contract. Add a scoped pointer
when a domain needs discovery, and add a reference when a topic needs separation;
keep detailed incident history and commands out of automatically loaded entrypoints.
