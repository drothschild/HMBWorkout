> Project guidance, last verified 2026-09-10. [Reference index](README.md).
> Source paths are repository-relative; named sections and engine convention numbers
> refer to the files in the index, including references formerly described as “below”.

## Native iOS project (`ios/`)

`ios/` is generated output (`expo prebuild`), gitignored, and **not** refreshed by
`npm run ios` once it exists on disk. After changing `app.json`, icon/splash assets,
or config plugins, regenerate it or builds keep shipping the stale native assets
(the old blue app icon outlived the icon swap in PR #30 this way):

    LANG=en_US.UTF-8 npx expo prebuild -p ios --clean

(CocoaPods needs the `LANG` override.) `--clean` is safe here: every native
customization — scene lifecycle, HealthKit entitlements, splash — comes from
`app.json` plugins and is re-applied. Hand edits under `ios/` do not survive a
regeneration; anything that must persist belongs in a config plugin (`plugins/`).

**A new native dependency makes this mandatory, and the failure is a runtime
crash rather than a build error.** `expo-audio` landed in `package.json` while
the main checkout's `ios/` was five days old, so its `Podfile.lock` had zero
`ExpoAudio` entries. The JS bundle then imported a native module the binary did
not contain, and the app died at launch with `Cannot find native module
'ExpoAudio'` — traced through `SetLogger` → `ExerciseStopwatch` →
`timerSoundPlayer`. Nothing in `npm test`, `tsc`, or `lint` can catch this;
`ios/` is gitignored, so a `git pull` that brings in a native dep leaves the
checkout silently mismatched. **After any native module lands, prebuild before
running.**

### Building and installing

**`--clean` can fail partway and leave `ios/` unusable.** It deletes the tree
before regenerating, and `rmdir` on `ios/Pods` intermittently fails with
`ENOTEMPTY`, aborting after the delete. The recovery is to finish the delete by
hand and re-run — safe, since `ios/` is generated:

    for i in 1 2 3; do rm -rf ios; done
    LANG=en_US.UTF-8 npx expo prebuild -p ios --clean

Confirm the module actually linked before building — `grep -c ExpoAudio
ios/Podfile.lock` should be non-zero.

**Simulator** — `npm run ios` works. To build without touching Metro:

    xcodebuild -workspace ios/HMBWorkout.xcworkspace -scheme HMBWorkout \
      -configuration Debug -sdk iphonesimulator \
      -destination 'platform=iOS Simulator,id=<UDID>' \
      -derivedDataPath /tmp/<name> build
    xcrun simctl install <UDID> /tmp/<name>/Build/Products/Debug-iphonesimulator/HMBWorkout.app

**Physical device — `expo run:ios --device` does NOT work under this toolchain.**
It fails with `Unexpected devicectl JSON version output from devicectl`, then
`No device UDID or name matching "..."`, because the Expo CLI cannot parse
Xcode-beta's `devicectl` output. It never reaches a build. Go through
`xcodebuild` directly, which bypasses that parsing entirely:

    xcrun devicectl list devices                       # find the UDID
    xcodebuild -workspace ios/HMBWorkout.xcworkspace -scheme HMBWorkout \
      -configuration Debug -destination 'id=<DEVICE-UDID>' \
      -allowProvisioningUpdates DEVELOPMENT_TEAM=33ZKM6VFS4 build
    xcrun devicectl device install app --device <DEVICE-UDID> \
      ~/Library/Developer/Xcode/DerivedData/HMBWorkout-*/Build/Products/Debug-iphoneos/HMBWorkout.app

**`DEVELOPMENT_TEAM` must be passed explicitly, and the obvious choice is the
wrong one.** `prebuild --clean` regenerates the Xcode project without a team —
it is a local Xcode setting, not something `app.json` carries — so the build
stops at `Signing for "HMBWorkout" requires a development team`. The keychain
holds two: `N4W9M926BS` on the *Apple Development* cert and `33ZKM6VFS4` on the
Distribution certs. **Use `33ZKM6VFS4`.** `N4W9M926BS` looks correct for a debug
build and fails with `No Account for Team "N4W9M926BS"` plus `No profiles for
'com.davidr.hmbworkout' were found`.

**Physical device for REAL-WORLD use (gym, travel) — the Debug recipe above is
the wrong one.** A Debug build loads its JS from Metro over the network, so it
is useless the moment the phone leaves the Mac. Build **Release** instead: the
Xcode *Bundle React Native code and images* phase embeds `main.jsbundle` into
the `.app`, and nothing else changes about signing.

    xcodebuild -workspace ios/HMBWorkout.xcworkspace -scheme HMBWorkout \
      -configuration Release -destination 'id=<DEVICE-UDID>' \
      -derivedDataPath /tmp/hmb-release \
      -allowProvisioningUpdates DEVELOPMENT_TEAM=33ZKM6VFS4 build
    xcrun devicectl device install app --device <DEVICE-UDID> \
      /tmp/hmb-release/Build/Products/Release-iphoneos/HMBWorkout.app

The explicit `-derivedDataPath` sidesteps the mtime hazard below. Verified
2026-08-07 on an iPhone 15 Pro.

**Prove it before trusting it, in this order** — a Release build that silently
fell back to Metro looks identical until it is offline:

1. `ls -la <App>.app/main.jsbundle` — must exist (~4.6MB). No bundle, no gym.
2. Kill Metro entirely, then `xcrun devicectl device process launch --device
   <UDID> com.davidr.hmbworkout`.
3. `xcrun devicectl device info processes --device <UDID> | grep HMBWorkout` —
   the PID must still be there seconds later. `Launched application` is printed
   even when the app crashes immediately on launch, so step 3 is the real test,
   not step 2.

**Three things about the Release build that are not what you would guess:**

- **`get-task-allow` stays `true`**, so `xcrun devicectl device copy from
  --device <UDID> --domain-type appDataContainer --domain-identifier
  com.davidr.hmbworkout --source Documents --destination <dir>` still works.
  Going Release does **not** cost you on-device DB inspection. Use it to back up
  `hmbworkout.db` *before* replacing an existing install.
- **The Team Provisioning Profile runs ~11 months** (expires 2027-07-08), not
  the 7 days a free account gives. Read it with `security cms -D -i
  <App>.app/embedded.mobileprovision`.
- **The bundle is frozen at build time.** Later JS changes need a full rebuild
  and reinstall — the opposite of the Metro-served Debug build. Keep the Debug
  build for iteration; Release is for taking the phone away from the Mac.

**Verifying a native module actually linked — do not read `Frameworks/`.** Expo
module pods build as **static** libraries, so `ExpoAudio.framework` is legitimately
absent from a correct build. The evidence is in the binary, but **the target
differs by configuration** — a Release build has no `.debug.dylib` at all, so the
documented Debug path silently finds nothing and reads as "not linked":

    strings <App>.app/HMBWorkout.debug.dylib | grep -c ExpoAudio   # Debug:   38 when linked
    strings <App>.app/HMBWorkout | grep -c ExpoAudio               # Release: 31 when linked

Any non-zero count means linked; the exact numbers are just what was observed.

**That rule is true for static pods only, and the heading's "do not read
`Frameworks/`" was too broad.** Some Expo modules ship as **dynamic** frameworks:
`ExpoImage`, `ExpoFileSystem` and `ExpoFont` sit in `<App>.app/Frameworks/` as
`.framework` bundles, and `strings <binary> | grep -c ExpoImage` is **0 on a
correctly linked build** — the same zero that means "missing" for ExpoAudio.
Measured 2026-09-10 on both the Debug simulator build (`HMBWorkout.debug.dylib`:
ExpoImage 0, ExpoAudio 38) and the Release iphoneos build (`HMBWorkout`:
ExpoImage 0, ExpoAudio 31; `Frameworks/` holds `ExpoImage.framework`,
`ExpoFileSystem.framework`, `ExpoFont.framework`). Check **both** places before
calling a module missing:

    ls <App>.app/Frameworks | grep ExpoImage                       # dynamic: the .framework is the evidence
    strings <App>.app/HMBWorkout | grep -c ExpoAudio               # static: the binary is the evidence

**In DerivedData, mtime does not imply completeness.** Several `HMBWorkout-*`
directories accumulate, and the newest by mtime can be an *empty* `.app` from an
interrupted build — no binary, no `Info.plist`. Sorting by mtime and taking the
top hit reports "no build exists" while a working one sits one entry down. Check
for the binary itself.

