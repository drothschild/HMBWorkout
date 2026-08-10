# HMB Workout

A local-first iOS workout logger. Sessions are driven by a pure functional
state machine with data on-device. Routines can be authored conversationally
with an AI coach backed by the Anthropic API (bring your own key).

## Technologies

### App platform

- **[Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/) / React Native 0.86 / React 19** —
  iOS app built as a custom dev client (native modules rule out Expo Go).
- **[expo-router](https://docs.expo.dev/router/introduction/)** — file-based
  routing from `src/app/`: tabs (Today, Routines, Settings with nested
  sub-screens), routine detail, session modal, and the AI Coach chat screen.
- **TypeScript** throughout, `strict` mode.

### Data & state

- **[WatermelonDB](https://watermelondb.dev/) 0.28** — on-device database
  (SQLite on iOS, LokiJS on web/tests). Schema, models, and a repository layer
  live in `src/db/`.
- **rill-lang 1.1.1** (local packed tarball) — a pure functional
  rules language that runs the workout-session engine (`src/engine/rules/*.lv`).
  Every phase transition, validation, and effect decision is made by Rill
  rules; TypeScript hosts them and executes the resulting effects. This
  functional-core / imperative-shell split is the project's load-bearing
  architectural invariant.
- **[Zustand](https://zustand.docs.pmnd.rs/) 5** — imperative-shell stores:
  the active workout session and the ephemeral AI chat conversation.
- **expo-secure-store** — settings blob (AI key/goals/equipment) in the iOS Keychain.

### Integrations

- **Anthropic Messages API** — the AI Coach calls `claude-sonnet-5` over a
  hand-rolled `fetch` client with structured outputs (JSON schema-constrained
  turns). Deliberately **no `@anthropic-ai/sdk`** dependency: the client must
  stay React Native/Hermes-safe and injectable for tests. The user supplies
  their own API key; requests go directly to the API and conversations are
  never persisted.
- **[@kingstinct/react-native-healthkit](https://github.com/kingstinct/react-native-healthkit)** —
  write-only workout export to Apple Health; Health failures never affect app
  state.

### Tooling

- **Jest + ts-jest** — a single node test project covering the pure TS
  domains (engine, db, interop, state, health, helpers, ai, theme, watch,
  components, export). Screens have no RN-environment tests by design.
- **ESLint 9 (expo flat config)** — `npm run lint`.

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Run the app (custom dev client required — WatermelonDB is native)

   ```bash
   npm run ios
   ```

   or start the bundler alone with `npm start`.

3. Run tests and checks

   ```bash
   npm test
   npx tsc --noEmit
   npm run lint
   ```

## Structure

- `src/engine/` — pure Rill session core + host dispatch/effect mapping
- `src/db/` — WatermelonDB schema, models, repository
- `src/interop/` — vault markdown serializer/parser
- `src/state/` — Zustand stores, presenters, settings
- `src/health/` — HealthKit write-only export
- `src/ai/` — AI coach: draft schema/validators, Anthropic client,
  system-prompt builder, accept path
- `src/app/` — expo-router screens

See `AGENTS.md` for architecture invariants and contributor conventions, and
`docs/` for design plans, implementation plans, and test plans.
