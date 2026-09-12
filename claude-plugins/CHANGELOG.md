# Changelog

## expo-ios-native 0.1.0

Initial release. The iOS native workflow for a bare-workflow Expo project.

**New:**
- `prebuilding-expo-ios` — when a prebuild is mandatory, the `Cannot find native
  module` crash that no test or type check can catch, `ENOTEMPTY` recovery from a
  half-completed `--clean`, and proving linkage via `strings` on the
  configuration-correct binary target
- `building-for-ios-device` — why `expo run:ios --device` fails under a beta
  toolchain, why the Apple Development team id is usually the wrong
  `DEVELOPMENT_TEAM`, Debug vs Release, and the three-step check that a Release
  build is genuinely standalone
- `driving-the-ios-simulator` — simctl-first driving, Metro without stale
  bundles, Xcode 27's Device Hub replacing Simulator.app, text entry via the
  *device* pasteboard, separating a frozen device from dead input, and injecting
  persisted state instead of driving to it
- `reading-on-device-sqlite` — the WAL trio copy and checkpoint, without which a
  successful migration reads as a failed one

## watermelondb-safety 0.1.0

Initial release.

**New:**
- `migrating-watermelondb-schema` — the silent database wipe an uncovered version
  range causes, why `[]` and `null` mean opposite things, the gapped-list
  module-init throw, and the `NODE_ENV` asymmetry that makes Debug and Release
  fail differently
- `testing-watermelondb` — the two-stage `flush()` idiom and its depth limit, the
  anchoring trap that makes a flush test unable to detect a one-stage
  implementation, the decorator tsconfig pins, and two warnings that are not what
  they look like

## verification-discipline 0.1.0

Initial release. Five skills addressing unverified claims.

**New:**
- `verifying-claims-by-execution` — eight shipped claims and what each turned out
  to be, plus why verifying the claim that *was* made hides the claims that were
  not
- `discriminating-test-fixtures` — the dominant plan defect: an AC naming a
  condition its fixture cannot distinguish; write the AC by naming the wrong
  implementation it must kill
- `running-mutation-tests` — anchor uniqueness, compile checks, exit codes, and
  the three survivor buckets
- `writing-structural-criteria` — deleting a dependency-array entry passes 1,649
  tests; set comparison over `toContain`; push the mechanism into a covered module
- `capturing-api-ground-truth` — an MCP connector renamed a field and no import
  ever preserved a superset for any user
