---
name: running-in-simulator
description: Use when running, launching, or driving HMBWorkout in the iOS Simulator — to see a change live, walk a flow end-to-end, or verify behavior in the real app. Covers finding the dev-client build, Metro without stale bundles, deep-link navigation, taps/typing via computer-use (including the "No booted simulator found" MCP fallback), and reading ground truth from SQLite.
---

# Running HMBWorkout in the iOS Simulator

Last verified: 2026-08-06 (Xcode 27.0 beta build 27A5228h, Expo SDK 57, dev
client `com.davidr.hmbworkout`)

WatermelonDB is native, so the app runs only as a dev-client build plus Metro.
This Mac runs the Xcode-beta toolchain, which changes the standard tooling in
specific ways; every rule below was hit in practice.

## Constraints that cost an hour if ignored

- **`Simulator.app` no longer exists. Xcode 27 replaced it with *Device Hub*.**
  `open -a Simulator` fails outright with "Unable to find application named
  'Simulator'". The app is
  `/Applications/Xcode-beta.app/Contents/Applications/DeviceHub.app`, bundle id
  `com.apple.dt.Devices` — note `Contents/Applications/`, not the old
  `Contents/Developer/Applications/`. Front it with `open -a "Device Hub"`.
  `xcrun simctl` is completely unaffected and works as before. Driving the
  vanished "Simulator" app is the suspected cause of a long 2026-08-05
  incident where every synthetic click and keystroke silently no-oped.
- The iOS Simulator MCP reports "No booted simulator found" for every sim
  booted by beta `simctl` — any runtime version, not just betas. Skip the
  panel entirely: drive with `xcrun simctl` plus computer-use on the
  Device Hub window.
- Start Metro plain: `EXPO_NO_TELEMETRY=1 npx expo start --port <port>`.
  `CI=1` disables file watching and silently serves a stale bundle.
- **All text entry must go through the clipboard. `type` does not work at
  all** (measured 2026-08-06 against Device Hub, iOS 26.5): with the field
  focused and demonstrably editable, `type` lands *nothing* — not garbled
  text, nothing. Toggling Device Hub's **Capture Keyboard** button does not
  help. But `cmd+v` lands reliably and immediately, with no iOS Paste
  callout to click. So: `write_clipboard` (or `pbcopy`) → click the field →
  `cmd+v`. Control that proves it: pasting into a field where `type` had
  just silently failed appended correctly on the first try.
- Run your own Metro on a free port (8082+) from the checkout under test and
  connect the dev client to it explicitly (step 2). A Metro already on 8081
  may be serving a different checkout.

## 1. Find (or make) a dev-client build

Probe bundles directly — `simctl get_app_container` false-negatives on
shutdown sims:

    ls -d ~/Library/Developer/CoreSimulator/Devices/*/data/Containers/Bundle/Application/*/HMBWorkout.app

Map the device UDID to name/runtime with `xcrun simctl list devices
available`; prefer a stable-runtime iPhone. If no sim has the app,
`npm run ios` builds and installs one (simulator builds work under
Xcode-beta; only physical-device `expo run:ios --device` is broken under
this toolchain).

## 2. Boot, serve, connect

    xcrun simctl bootstatus <udid> -b
    open -a "Device Hub"
    EXPO_NO_TELEMETRY=1 npx expo start --port 8082    # background, from the checkout under test
    xcrun simctl launch <udid> com.davidr.hmbworkout
    xcrun simctl openurl <udid> "hmbworkout://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8082"

Launch the app before the openurl; from SpringBoard the link pops an Open-in
dialog that needs a manual tap. Confirm the bundle loaded with
`xcrun simctl io <udid> screenshot shot.png`.

## 3. Navigate headlessly

`xcrun simctl openurl <udid> "hmbworkout://<path>"` — known paths:
`ai-coach`, `history`, `routine/<id>`, `settings`, `settings/ai`.

## 4. Tap and type

Use the computer-use MCP on the **Device Hub** window (`request_access` with
"Device Hub" — *not* "Simulator", which no longer exists; it grants full tier):

- Re-front with `open_application` "Device Hub" before every action batch —
  focus drifts back to the Claude app between tool calls, and clicks after a
  focus change vanish silently. Confirm effects from the screen, not from
  the click returning success.
- If clicks and keystrokes are landing nowhere at all, check you are targeting
  Device Hub before concluding the host or the simulator is broken. A grant
  for "Simulator" now resolves to nothing.
- **Device Hub renders the device screen *inside* its own window, and its
  bottom toolbar OVERLAYS the device's dock and home-indicator strip.** A
  click aimed at the dock lands on a Device Hub control instead — aiming at
  the Settings search field hit Device Hub's Home button and bounced the
  device to SpringBoard. Target anything in the bottom ~15pt of the device
  screen by scrolling it upward first, or drive it with a deep link.
- Pick the device in the left sidebar; the screen only appears once it is
  selected. The toolbar's four magnifiers are fixed zoom levels — go to the
  largest before doing coordinate work, the default is small enough to make
  taps unreliable.
- `double_click` on a button delivers a genuine rapid double-tap
  (re-entrancy checks).
- The dev-menu gear bubble floats over the top-right of the header; click
  around it.
- Device-only frames: `xcrun simctl io <udid> screenshot <path>`.

## 5. Read ground truth from SQLite

Screens show state; the DB proves persistence:

    c=$(xcrun simctl get_app_container <udid> com.davidr.hmbworkout data)   # booted sims only
    sqlite3 "$c/Documents/hmbworkout.db" "select id, name from routines;"

Tables: `routines`, `routine_exercises`, `exercises`, `sessions`,
`session_sets`, `local_storage`.

## Gotchas

- Keychain survives uninstall: the Anthropic key (expo-secure-store)
  reappears after reinstall while the DB resets. Full wipe:
  `xcrun simctl keychain <udid> reset`.
- AI Coach turns call the real Anthropic API with the on-device key — real
  money; keep test prompts small.
- Network-failure testing: toggle the Mac's Wi-Fi
  (`networksetup -setairportpower en0 off`) — sims have no airplane mode,
  and localhost Metro keeps serving. Turn it back on afterward.
- After editing any `.lv` rule file, restart Metro with
  `npx expo start --clear` (Metro's transform cache misses inlined rules —
  see AGENTS.md).
