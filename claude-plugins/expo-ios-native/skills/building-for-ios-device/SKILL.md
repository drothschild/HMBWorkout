---
name: building-for-ios-device
description: Use when installing an Expo/React Native app on a physical iPhone or iPad - covers why `expo run:ios --device` fails under a beta toolchain, choosing the right DEVELOPMENT_TEAM, and building Release so the app works away from the Mac.
---

# Building for a Physical iOS Device

## Overview

Two decisions determine whether the build on the phone is usable:
**how you invoke the build** (the Expo CLI path is broken under a beta
toolchain) and **which configuration** (a Debug build is useless the moment the
phone leaves the Mac).

## `expo run:ios --device` does not work under a beta toolchain

It fails with:

```
Unexpected devicectl JSON version output from devicectl
No device UDID or name matching "..."
```

The Expo CLI cannot parse Xcode-beta's `devicectl` output, so it never reaches
a build. Go through `xcodebuild` directly, which bypasses that parsing.

```bash
xcrun devicectl list devices          # find the UDID
```

**`available (paired)` does not mean unreachable.** Check
`xcrun devicectl device info details` — it may report `Device State: connected`
with a tunnel IP. Query the device before concluding it is offline.

## DEVELOPMENT_TEAM must be explicit, and the obvious choice is often wrong

`prebuild --clean` regenerates the Xcode project **without a team** — that is a
local Xcode setting, not something `app.json` carries. The build then stops at:

```
Signing for "<Scheme>" requires a development team
```

A keychain typically holds more than one team id: one on the *Apple Development*
certificate and one on the *Distribution* certificates. **The Apple Development
one looks correct for a debug build and frequently is not** — it fails with
`No Account for Team "..."` plus `No profiles for '<bundle-id>' were found`.

List what you actually have and try the Distribution team first:

```bash
security find-identity -v -p codesigning
```

Record the working id in your project's `AGENTS.md` / `CLAUDE.md`. It is not
discoverable from the error message.

## Debug vs Release — pick by where the phone is going

**Debug loads its JS from Metro over the network.** It is right for iteration
and useless at the gym, on a plane, or anywhere off the Mac's network.

```bash
xcodebuild -workspace ios/<Scheme>.xcworkspace -scheme <Scheme> \
  -configuration Debug -destination 'id=<DEVICE-UDID>' \
  -allowProvisioningUpdates DEVELOPMENT_TEAM=<TEAM-ID> build
```

**Release embeds `main.jsbundle` into the `.app`** via Xcode's *Bundle React
Native code and images* phase. Nothing else about signing changes.

```bash
xcodebuild -workspace ios/<Scheme>.xcworkspace -scheme <Scheme> \
  -configuration Release -destination 'id=<DEVICE-UDID>' \
  -derivedDataPath /tmp/<name>-release \
  -allowProvisioningUpdates DEVELOPMENT_TEAM=<TEAM-ID> build

xcrun devicectl device install app --device <DEVICE-UDID> \
  /tmp/<name>-release/Build/Products/Release-iphoneos/<Scheme>.app
```

The explicit `-derivedDataPath` sidesteps the DerivedData trap below.

## Prove the Release build before trusting it

A Release build that silently fell back to Metro looks identical until it is
offline. Check in this order:

1. **`ls -la <App>.app/main.jsbundle`** — must exist and be substantial
   (megabytes). No bundle, no standalone use.
2. **Kill Metro entirely**, then
   `xcrun devicectl device process launch --device <UDID> <bundle-id>`.
3. **`xcrun devicectl device info processes --device <UDID> | grep <Scheme>`** —
   the PID must still be there seconds later.

Step 3 is the real test. `Launched application` is printed even when the app
crashes immediately on launch.

## Three things about Release that are not what you would guess

- **`get-task-allow` stays `true`**, so
  `xcrun devicectl device copy from --domain-type appDataContainer` still works.
  Going Release does not cost you on-device database inspection — see
  `reading-on-device-sqlite`.
- **A paid-account Team Provisioning Profile runs ~11 months**, not the 7 days a
  free account gives. Read the expiry with
  `security cms -D -i <App>.app/embedded.mobileprovision`.
- **The bundle is frozen at build time.** Later JS changes need a full rebuild
  and reinstall — the opposite of the Metro-served Debug build.

## In DerivedData, mtime does not imply completeness

Several `<Scheme>-*` directories accumulate, and the newest by mtime can be an
*empty* `.app` from an interrupted build — no binary, no `Info.plist`. Sorting
by mtime and taking the top hit reports "no build exists" while a working one
sits one entry down. **Check for the binary itself**, or pass an explicit
`-derivedDataPath` and skip the problem.

## Quick reference

| Goal | Configuration | Verified by |
|---|---|---|
| Iterate with hot reload, Mac nearby | Debug | App connects to Metro |
| Use the app away from the Mac | Release | `main.jsbundle` present + PID survives with Metro dead |
| Read the app's on-device data | Either | `devicectl device copy from` still works in Release |

## Common mistakes

| Mistake | Consequence |
|---|---|
| `expo run:ios --device` on a beta toolchain | Never reaches a build; misleading "no device" error |
| Omitting `DEVELOPMENT_TEAM` after a prebuild | "requires a development team" |
| Using the Apple Development team id | `No Account for Team` / no matching profiles |
| Shipping a Debug build for real-world use | Dead app the moment it leaves Metro's network |
| Treating `Launched application` as proof | Printed even for an immediate crash |
| Picking the newest DerivedData dir by mtime | May be an empty `.app` from an aborted build |
