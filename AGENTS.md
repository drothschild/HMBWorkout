# HMB Workout

Last verified: 2026-09-10 (instruction organization; detailed guidance retains its verification dates).

Local-first iOS workout logger: Expo SDK 57, React Native 0.86, React 19,
expo-router, WatermelonDB 0.28, Zustand 5 and a pure rill-lang 1.1.1 session engine.
The [dependency notes](docs/project-context/overview.md) explain exact pins and platform boundaries.

## Mandatory review and release gates

Apply these gates on every review round, including follow-up reviews after fixes.

Process the board continuously until every ticket is complete or requires human
interaction/QA. An open PR or an In review card is intermediate work, not a stop
condition. Continue independent tickets while a human gate is pending. Finish
approved merges and verify merged main. Independent review approval plus passing
required automated checks authorizes merging without a separate user permission
prompt. After those gates pass, merge the exact reviewed head automatically; do
not ask the user to approve the merge again. Respect repository branch protections
and required GitHub approvals. A human-interaction/QA gate still requires release
by the human before merging; review approval does not release that gate.

- Use independent subagents and the applicable review skills. Mutation-test each
  round: deliberately break the implementation and run the relevant individual
  tests. Record killed, surviving and invalid mutants separately; restore the
  source and verify green afterward. For documentation, corrupt the content or
  links in a copy and prove the preservation/link checks reject it.
- Execute at least one load-bearing claim from each agent report independently.
  Prefer a measured number and record the command, commit and result. A prior
  report or static inspection does not verify an execution claim.
- For claims shaped like “X only reads A, B and C,” execute X with a distinct
  marker in every field and inspect the reads and output. Do not infer exclusivity
  from reading the source or testing only the named fields.
- Any change touching layout, sound or native-module behavior stays a **draft PR**
  with its card in the existing **Require Human Inteteraction** column (the board
  spelling of Require Human Interaction). This is the human-QA gate; do not
  create a separate Needs Human QA column. Include concrete actions and expected
  results on the card, such as “four beeps on rest complete; music keeps playing.”
  Tests with injected native operations do not replace on-device verification.
  **No agent may move a card out of Require Human Inteteraction; only the human may do so.**
- Automatically prepare a runnable test build for every branch requiring human
  interaction/QA. Build the latest reviewed commit and put the artifact location,
  branch/commit, build date, install/run instructions and concrete checks on its
  card. Refresh the build after branch changes; identify failures explicitly.
  For iPhone QA, default to signed standalone Release builds with embedded JS
  (no Metro). Keep PR-labelled artifacts separate. Use a supported signing
  identity: provisioned separate test app IDs may coexist with production;
  otherwise use the existing app ID for one-at-a-time testing. Creating builds
  does not authorize replacing the installed app. Regenerate native projects
  when config or native dependencies change; verify the bundle and native links.
  Preparing a build does not release the human gate. Preserve production data
  before any explicitly requested replacement install.
- After each merge, fetch the actual merged `main` commit and run the
  relevant individual checks there. Record that commit and results before calling
  the work complete. A green branch does not establish that merged main is green.

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
