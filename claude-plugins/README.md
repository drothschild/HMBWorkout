# hmb-workbench

A Claude Code plugin marketplace of practices distilled from building this app —
a local-first Expo / React Native iOS project with an on-device database.

Everything here was learned by being wrong about it first. The skills state the
general rule and, where the rule is counter-intuitive, the measurement that
established it.

## Install

```
/plugin marketplace add drothschild/HMBWorkout
/plugin install expo-ios-native@hmb-workbench
```

## Plugins

### `expo-ios-native`

The iOS native workflow of a bare-workflow Expo project, where `ios/` is
generated output and the expensive failures are silent.

| Skill | Use when |
|---|---|
| `prebuilding-expo-ios` | A native dep, `app.json`, or a config plugin changed — or the app crashes with `Cannot find native module` |
| `building-for-ios-device` | Installing on a physical iPhone; choosing Debug vs Release; signing will not resolve |
| `driving-the-ios-simulator` | Verifying a change in the simulator, or simulator input appears broken |
| `reading-on-device-sqlite` | Copying or inspecting the app's database off a device |

### `watermelondb-safety`

| Skill | Use when |
|---|---|
| `migrating-watermelondb-schema` | Changing a schema or bumping `databaseSchema.version` |
| `testing-watermelondb` | A test cannot see a write that definitely happened, or models read `undefined` |

### `verification-discipline`

Not React Native specific. These address one failure: **a claim about an
artifact reads downstream as a measurement, and nobody re-checks it.**

| Skill | Use when |
|---|---|
| `verifying-claims-by-execution` | Writing any count, grep result, or completion claim into a plan, review, or PR |
| `discriminating-test-fixtures` | Writing an acceptance criterion or fixture; auditing a plan's ACs before code exists |
| `running-mutation-tests` | Hand-crafting mutants to check coverage |
| `writing-structural-criteria` | The property lives in code no suite can execute |
| `capturing-api-ground-truth` | Building a client, types, or fixtures against an external HTTP API |

## Layout

```
.claude-plugin/marketplace.json     # marketplace catalog (repo root)
claude-plugins/
  README.md
  CHANGELOG.md
  <plugin>/
    .claude-plugin/plugin.json
    skills/<skill>/SKILL.md
```

Two deliberate deviations from the conventional layout:

- **The plugin root is `claude-plugins/`, not `plugins/`.** This repo's
  `plugins/` already holds Expo *config* plugins and means something else.
- **`CHANGELOG.md` lives here rather than at the repo root**, where it would read
  as the application's changelog.

## Maintaining

Releasing a plugin version touches three files, which must agree:

1. `claude-plugins/<name>/.claude-plugin/plugin.json` → `version`
2. `.claude-plugin/marketplace.json` → that plugin entry's `version`
3. `claude-plugins/CHANGELOG.md` → an entry headed `## <name> X.Y.Z`

Then validate and commit all three together:

```bash
claude plugin validate . --strict
claude plugin validate claude-plugins/<name> --strict
claude plugin validate claude-plugins/<name>/skills --strict
```

## Provenance

Sources are this repo's `AGENTS.md` (native build, schema migration, and testing
sections) and knowledge accumulated across the fix board. Content is genericized:
bundle ids, scheme names, and team ids are placeholders, and app-specific facts
are stated as the general rule they instance.
