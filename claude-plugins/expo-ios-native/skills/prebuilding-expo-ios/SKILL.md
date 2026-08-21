---
name: prebuilding-expo-ios
description: Use when a native dependency was added, app.json or an icon/splash asset changed, a config plugin was edited, or the app crashes at launch with "Cannot find native module X" - explains when `expo prebuild` is mandatory, how to recover a half-deleted ios/ tree, and how to prove the module actually linked.
---

# Prebuilding an Expo iOS Project

## Overview

In a bare-workflow Expo project, `ios/` is generated output. It is normally
gitignored, and **`npm run ios` does not refresh it once it exists on disk.**
Everything that produces `ios/` — icons, entitlements, `Info.plist` keys, the
Podfile — comes from `app.json` and the config plugins in `plugins/`. So a
change to any of those is invisible to the build until a prebuild runs.

The failure this causes is **a runtime crash, not a build error**, which is why
it survives every check you would normally trust.

## When a prebuild is mandatory

Run it after any of these:

- A new native dependency lands in `package.json` (including transitively).
- `app.json` changes — bundle id, plugins list, splash, icon, permissions.
- Any file under `plugins/` (an Expo config plugin) is edited.
- You pulled a branch that did either of the above.

```bash
LANG=en_US.UTF-8 npx expo prebuild -p ios --clean
```

The `LANG` override is for CocoaPods, which fails on a non-UTF-8 locale.
`--clean` is safe **provided every native customization lives in `app.json` or a
config plugin.** Hand edits under `ios/` do not survive; anything that must
persist belongs in a plugin.

## The failure mode that has no build error

A JS bundle can import a native module the binary does not contain. The app
then dies at launch:

```
Cannot find native module 'ExpoAudio'
```

`npm test`, `tsc --noEmit`, and lint all pass — none of them know what is in the
binary. Because `ios/` is gitignored, a plain `git pull` that brings in a native
dependency leaves the checkout silently mismatched: `package.json` has the
module, `ios/Podfile.lock` does not.

**Rule: after any native module lands, prebuild before running.**

Confirm the pod is actually there before spending time on a build:

```bash
grep -c ExpoAudio ios/Podfile.lock   # must be non-zero
```

## Recovering a failed `--clean`

`--clean` deletes `ios/` and then regenerates it. The delete intermittently
fails on `ios/Pods` with `ENOTEMPTY`, aborting **after** the tree is already
gone — leaving `ios/` unusable rather than absent.

Recovery is to finish the delete by hand and re-run. This is safe: `ios/` is
generated.

```bash
for i in 1 2 3; do rm -rf ios; done
LANG=en_US.UTF-8 npx expo prebuild -p ios --clean
```

## Proving a native module linked — do not read `Frameworks/`

Expo module pods build as **static** libraries. `ExpoAudio.framework` being
absent from `App.app/Frameworks/` is what a *correct* build looks like, so that
directory answers nothing.

The evidence is in the binary, and **the target differs by configuration.** A
Release build has no `.debug.dylib` at all, so checking the Debug path against a
Release build silently finds nothing and reads as "not linked":

```bash
strings <App>.app/<App>.debug.dylib | grep -c ExpoAudio   # Debug build
strings <App>.app/<App> | grep -c ExpoAudio               # Release build
```

Any non-zero count means linked. The absolute number is meaningless — do not
compare it against a remembered figure.

## When NOT to prebuild

**A JS-only change does not need one, even if `ios/` is missing or stale.** A
dev client loads its JS from Metro, so an already-installed dev-client build
will happily render a different worktree's code. Point it at your Metro and
skip the ~10-minute rebuild. See `driving-the-ios-simulator`.

## Quick reference

| Situation | Action |
|---|---|
| New native dep, changed `app.json`, edited config plugin | Prebuild, then verify `Podfile.lock` |
| `Cannot find native module` at launch | Prebuild; the JS/binary are mismatched |
| JS/style/layout change only | Do not prebuild — serve Metro to an existing dev client |
| `--clean` aborted with `ENOTEMPTY` | `rm -rf ios` in a loop, re-run |
| "Did the module link?" | `strings` the binary; pick the target matching your configuration |

## Common mistakes

| Mistake | Consequence |
|---|---|
| Hand-editing files under `ios/` | Lost on the next prebuild; belongs in a config plugin |
| Trusting `npm test` / `tsc` to catch a missing native module | They cannot see the binary; the app crashes at launch |
| Reading `App.app/Frameworks/` for evidence of linkage | Static pods are never there; proves nothing either way |
| Using the Debug `strings` path on a Release build | No `.debug.dylib` exists; reads as "not linked" |
| Prebuilding to verify a JS-only change | Trades 30 seconds of Metro for 10 minutes and an `ENOTEMPTY` risk |
