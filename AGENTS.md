# HMB Workout

Last verified: 2026-09-10 (instruction organization; detailed guidance retains its verification dates).

Local-first iOS workout logger: Expo SDK 57, React Native 0.86, React 19,
expo-router, WatermelonDB 0.28, Zustand 5 and a pure rill-lang 1.1.1 session engine.
The [dependency notes](docs/project-context/overview.md) explain exact pins and platform boundaries.

## Board, human QA and test builds

Board workflow, review, and merge gates are run by the fleet-board plugin; see .fleet-board.yml.

- Changes to layout, sound, or native-module behavior need human QA. They are
  covered by `human_qa_paths` in `.fleet-board.yml` or the `needs-human-qa`
  label. The board's human-QA column is **Require Human Inteteraction** (the board
  spelling of Require Human Interaction); there is no separate Needs Human QA column.
- Human-QA cards list concrete actions and expected results, such as “four beeps
  on rest complete; music keeps playing.” Tests with injected native operations
  do not replace on-device verification.
- Human-QA cards need a runnable test build. fleet-board has no `qa_build` for
  this project, so prepare builds by hand per
  [native iOS notes](docs/project-context/native-ios.md): build the latest
  reviewed commit and put the artifact location, branch/commit, build date,
  install/run instructions and concrete checks on its card. Refresh the build
  after branch changes; identify failures explicitly.
- For iPhone QA, default to signed standalone Release builds with embedded JS
  (no Metro). Keep PR-labelled artifacts separate. Use a supported signing
  identity: provisioned separate test app IDs may coexist with production;
  otherwise use the existing app ID for one-at-a-time testing. Creating builds
  does not authorize replacing the installed app. Regenerate native projects
  when config or native dependencies change; verify the bundle and native links.
  Preparing a build does not release the human gate. Preserve production data
  before any explicitly requested replacement install.

## Working here

- Before Expo/RN changes, read the exact SDK docs at
  https://docs.expo.dev/versions/v57.0.0/; APIs changed from earlier majors.
- `npm test -- --runTestsByPath <test-file>` runs an individual Jest file.
  Read [Testing gotchas](docs/project-context/testing.md) before writing or running tests.
- `npm run ios` / `npm start` requires a dev client; `npm run lint` runs Expo lint.
- `ios/` is generated and ignored. After native dependency, app configuration,
  icon/splash or config-plugin changes, regenerate before building. Read the
  [native iOS guide](docs/project-context/native-ios.md) before prebuild or deployment;
  it covers data backup, signing, Release builds and device verification.

## Architecture and boundaries

- Session transitions, advancement, validation and effects belong exclusively in
  `src/engine/rules/*.lv`. Stores and components shape payloads and run effects;
  they do not decide session flow. The contract is
  `transition(state, event) → Result({state, effects})`.
- The coach authors routine data. A running-session Replace dispatches an engine
  event; engine guards decide whether the swap is allowed.
- `src/domain/` is pure and imports nothing. App-side superset walks use
  `supersetGrouping.ts`; the markdown parser's named exception is documented below.
- Routine entry identity is the `routine_exercises` row id; performed-set identity
  is the set's own exercise stamp, with a legacy row fallback.
- Preserve the database migration chain; an uncovered schema version can erase data.
- Keep AI payloads, validators and prompt bounds synchronized. Accepting a draft
  creates missing exercises without mutating existing exercises. AI-proposed
  settings changes require user approval before writing.
- Safe to edit: `src/`. Leave generated Rill dist and the `../rill-lang` tarball alone.
- Read the applicable [cross-domain boundaries](docs/project-context/boundaries.md)
  before changing routine identity, supersets, prescriptions, prefill, zero-set plans
  or session-start eligibility.

## Read only the guidance relevant to the task

Scoped `src/*/AGENTS.md` files point to domain contracts. Read their applicable
references before editing that domain. References are ordinary Markdown links:
they are not imports and should not all be loaded at startup.

| Task | Detailed guidance |
| --- | --- |
| Native generation, build, signing, simulator or iPhone deployment | [Native iOS](docs/project-context/native-ios.md) |
| Session engine, effects, host boundary, rest, rehydrate or supersets | [Engine conventions](docs/project-context/engine.md) |
| Schema, migrations, persistence or history identity | [Database](docs/project-context/database.md), [Boundaries](docs/project-context/boundaries.md) |
| Markdown grammar, import, export or round trips | [Vault markdown contract](docs/project-context/interop.md) |
| Catalog, matching, downloads, observers or exercise-image layout | [Exercise images](docs/project-context/exercise-images.md) |
| Coach, providers, keys, models, prompts, drafts or one-shot features | [AI Coach](docs/project-context/ai-coach.md) |
| HealthKit export | [HealthKit](docs/project-context/health.md) |
| Tests, structural coverage, layout verification or TypeScript tooling | [Testing gotchas](docs/project-context/testing.md) |
| Locating code, Hevy import, theme, hooks or cross-domain dependencies | [Structure](docs/project-context/structure.md) |
| Dependency versions and rationale | [Tech stack](docs/project-context/overview.md) |

The [reference index](docs/project-context/README.md) maps the original section names
and numbered engine conventions. Update the owning reference when a contract changes;
keep root and scoped entrypoints short instead of copying the detailed guidance back.
