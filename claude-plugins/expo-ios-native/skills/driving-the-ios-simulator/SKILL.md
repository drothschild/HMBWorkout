---
name: driving-the-ios-simulator
description: Use when verifying a React Native or Expo change in the iOS Simulator, or when simulator input appears broken - covers headless simctl driving, Metro without stale bundles, deep-link navigation, screenshots, text entry via the device pasteboard, and separating a frozen device from dead input.
---

# Driving the iOS Simulator

## Overview

**Prefer `xcrun simctl` for everything it can do.** It is unaffected by the
failure modes that make GUI automation flaky, it needs no screen-recording
permission, and it works when simulator-panel tooling reports no booted device.
Reach for synthetic clicks only for what genuinely needs a tap.

The most common waste on this path is misdiagnosis: an input problem that looks
like a broken simulator, or a stale bundle that looks like a broken feature.

## Start Metro correctly

```bash
EXPO_NO_TELEMETRY=1 npx expo start --port 8081
```

**Never use `CI=1` for live verification.** CI mode disables file watching, so
your edits silently serve a stale bundle and the change "doesn't render."

**Run one Metro at a time and kill it when done** (`lsof -ti:PORT | xargs kill`).
Instances left running per worktree accumulate, and cumulative CPU load makes
simulator input unreliable in a way that mimics a permissions bug. Before
debugging clicks, run `uptime` — load meaningfully above the core count is the
problem, and restarting the simulator only buys ~20 minutes if the load remains.

## A JS-only change needs no build at all

A dev client loads its JS from Metro, so **any already-installed dev-client
build will render a different worktree's code.** Serve Metro from your worktree
on a spare port and point the installed dev client at it. A missing or stale
`ios/` is irrelevant — it is needed to *build* a binary, not to feed one. This
turns a ~10-minute rebuild into a ~30-second Metro start.

**Confirm the dev client is serving your worktree before trusting a screenshot.**
A/B the constant under test and watch it hot-reload by the predicted amount,
then revert. Without that check you may be photographing `main`.

## Navigate headlessly with deep links

```bash
xcrun simctl openurl <udid> "<scheme>://settings"
```

Connect a dev client to Metro:

```bash
xcrun simctl launch <udid> <bundle-id>
xcrun simctl openurl <udid> \
  "<scheme>://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"
```

Deep links beat taps for anything reachable by route, and they sidestep the
whole input-injection problem.

## Screenshots

```bash
xcrun simctl io <udid> screenshot /tmp/shot.png
xcrun simctl ui <udid> appearance dark      # read current value first, restore after
```

`simctl io` captures the **device** and never touches the Mac's display, so it
keeps working when screen-capture tooling fails with a permission or
`SCContentFilter` error. Such a failure is not evidence that the simulator is
broken.

## Xcode 27 replaced Simulator.app with Device Hub

`open -a Simulator` fails outright — the app does not exist. The window to
target for clicks is **Device Hub**:

- `/Applications/Xcode-beta.app/Contents/Applications/DeviceHub.app`
  (note `Contents/Applications/`, not `Contents/Developer/Applications/`)
- bundle id `com.apple.dt.Devices`

Screen-automation tooling needs its own grant for *that* app. Requesting access
to "Simulator" fails and can short-circuit the whole call, which presents as
every click silently no-oping. `xcrun simctl` is completely unaffected.

**Device Hub's bottom toolbar overlays the device's home-indicator strip.** A
click aimed near the bottom of the screen can hit Device Hub's own Home button
and bounce the device to SpringBoard. Scroll the target up, or use a deep link.

## Text entry goes through the pasteboard, not keystrokes

Character typing frequently does not reach the device at all — not garbled,
*nothing lands* — with a hardware keyboard connected and the field demonstrably
focused. Modifier chords like `cmd+v` do land, because they are handled as menu
equivalents.

**The decisive precondition: the DEVICE pasteboard must have content.** `pbcopy`
populates only the Mac's. If the device pasteboard is empty, `cmd+v` no-ops
*and* the iOS callout offers only AutoFill with no Paste item — which reads
exactly like dead key events.

```bash
tr -d '\n' < file | xcrun simctl pbcopy <udid>
xcrun simctl pbpaste <udid> | wc -c        # verify it landed
```

Then: click the field → click again to raise the callout → click **Paste**.
Whether the callout is needed varies; try `cmd+v` first and keep the callout as
the fallback.

To **clear** a field: `triple_click` to select, then paste a single space.
Whitespace-only reads as empty to any code that trims.

Two coordinate traps:

- **Re-screenshot between clicks once a keyboard is up.** A `KeyboardAvoidingView`
  shifts the layout when the keyboard raises, so a coordinate computed from the
  pre-keyboard frame lands on a different control.
- **The Paste/AutoFill bubble appearing on a tap is not evidence that a
  keystroke reached the device.** It appears on any tap into an empty field when
  the pasteboard has content.

## Diagnosing "the simulator is broken"

Separate **device-frozen** from **input-dead** before escalating — different
fixes.

```bash
xcrun simctl spawn <udid> launchctl list | grep -i springboard   # a pid means alive
```

Comparing two screenshots taken seconds apart is *not* a reliable test: a static
screen with a minute-resolution clock legitimately yields identical bytes on a
healthy device. Differing bytes prove alive; identical bytes prove nothing.
(`simctl spawn <udid> date` does not work — that binary is not in the simulator
filesystem.)

A discriminator worth asking for early: **have the human click and type in the
simulator themselves.** If they can, the fault is confined to your input
injection and nothing on the machine needs fixing. Note that manual entry
succeeding does not distinguish typing from pasting — ask which they did.

Escalation ladder, cheapest first:

1. Toggle *I/O ▸ Keyboard ▸ Connect Hardware Keyboard*
2. Quit and relaunch the simulator UI app
3. `xcrun simctl shutdown <udid>` then `boot`
4. `killall -9 com.apple.CoreSimulator.CoreSimulatorService`
5. Mac restart — only this one needs the user

## Simulator-specific behaviours that void a test

- **Uninstall does not wipe secure storage.** Keychain-backed settings survive
  uninstall/reinstall. A full wipe needs `xcrun simctl keychain <udid> reset`.
  Corollary: **an empty application database is not evidence that no key or
  setting is configured** — look at the screen, or exercise the feature.
- **There is no airplane mode.** Test network failure by toggling the Mac's
  Wi-Fi (`networksetup -setairportpower en0 off`); localhost Metro keeps serving
  while external APIs fail. Turn it back on afterwards.
- **Simulators never auto-lock**, so anything depending on the idle timer or
  screen lock cannot be verified here at all. The simulator still buys a smoke
  test — mounts, no crash, clean log — but proving the lock is held *and
  released* needs a physical device.
- **Cold launches restore the navigation stack and re-fire route side effects.**
  A restored route can re-issue real network calls at boot. Park the app on a
  safe screen before terminating it.

## Injecting state instead of driving to it

For a screen that is expensive or destructive to reach, write the app's
persisted state directly and deep-link to it. With the app terminated, insert
the row into the app's SQLite database (`xcrun simctl get_app_container <udid>
<bundle-id> data` locates it), relaunch, and `openurl` the route.

Three things that make this work in practice:

- **Hand-writing the state JSON against its TypeScript type is usually enough** —
  generating one via a scratch test is optional.
- **Mutating one field is the cheapest possible A/B of a conditional.**
  `UPDATE ... SET state = replace(state, '"index": 1', '"index": 0')` flips
  between the positive and negative case with no re-injection.
- **Relaunch twice.** `simctl launch` right after `terminate` is flaky — the
  first launch reports a pid while the screen sits on SpringBoard. Then
  `openurl`; forgetting it lands you on the home route, which is not a failure
  of the injection.

Read `.schema <table>` rather than copying an INSERT from older notes — columns
drift. Clean up the injected rows afterwards and verify the count is back to
zero.

Temporarily editing a *real* row (e.g. renaming an entity to a long string for a
layout stress test) is cheaper and more realistic than seeding a fake one, since
real joins resolve normally. Restore the original value afterwards.

## Common mistakes

| Mistake | Consequence |
|---|---|
| `CI=1 npx expo start` | Silently serves a stale bundle; the change "doesn't render" |
| Leaving one Metro per worktree running | Cumulative load kills simulator input; mimics a permissions bug |
| Targeting "Simulator" on Xcode 27 | The app does not exist; every click no-ops |
| Assuming `pbcopy` reached the device | Only the Mac's pasteboard; `cmd+v` no-ops |
| Reusing click coordinates after the keyboard raises | Lands on a different control |
| Reading screenshot equality as "frozen" | A static screen is legitimately identical; use the SpringBoard pid |
| Treating a screen-capture permission error as a broken simulator | `simctl io screenshot` is unaffected |
| Trusting a screenshot without A/B-ing the change | You may be photographing `main` |
