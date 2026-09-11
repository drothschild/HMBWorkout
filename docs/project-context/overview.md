> Project guidance, last verified 2026-09-10. [Reference index](README.md).
> Source paths are repository-relative; named sections and engine convention numbers
> refer to the files in the index, including references formerly described as “below”.

# HMB Workout

Last verified: 2026-09-10

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
- fuse.js **7.5.0, exact pin** — exercise-title → catalog matching (#335). Not a
  caret range on purpose: `useTokenSearch` is new in 7.x, and the acceptance
  threshold was measured against 7.5.0's scores (see Exercise images below)
- expo-image (display) and expo-file-system's `File`/`Paths` API (storage) for
  exercise images (#335). Both were **already dependencies, and already in use,
  before #335** — `expo-image` by `animated-icon.tsx`, `expo-file-system` by the
  Settings → Data export — so #335 reuses them. **#335 added no native module**:
  its only new dependency is fuse.js, which is pure JS, so this feature does not
  by itself require an `expo prebuild`
- Anthropic Messages API — called over plain `fetch`, **no SDK dependency** (see AI
  Coach below)
- Jest + ts-jest (node env) — tests

## Commands

- `npm test` — Jest (node project only; see Testing gotchas below)
- `npm run ios` / `npm start` — run the app (requires dev client; WatermelonDB is native)
- `npm run lint` — expo lint

