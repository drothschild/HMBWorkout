---
name: reading-on-device-sqlite
description: Use when copying or inspecting an app's SQLite database off a physical iPhone or a simulator - the main .db file alone is a stale snapshot under WAL journaling, so a copy that omits the -wal file loses recent data and can make a successful migration look failed.
---

# Reading an App's SQLite Database Off a Device

## Overview

React Native SQLite stacks (WatermelonDB, op-sqlite, expo-sqlite) run in **WAL
journal mode**. `app.db` on its own is whatever was last checkpointed — not
current state. Recent writes live in `app.db-wal` until a checkpoint folds them
in.

Two things go wrong when this is forgotten, and the second is the expensive one:

1. You report stale numbers as the device's contents.
2. You take a "backup" of `app.db` alone, which would lose everything in the WAL
   if it were ever restored.

A real instance: the main `.db` read schema **v3 / 1 record set**, while the
truth with a 2.1 MB `-wal` replayed was **v5 / 6 record sets**. That also made a
*successful* v3→v5 migration look like a failed one.

## Copy all three files, then checkpoint

```bash
DEV=<device-udid>; OUT=<dir>
for f in app.db app.db-wal app.db-shm; do
  xcrun devicectl device copy from --device "$DEV" \
    --domain-type appDataContainer --domain-identifier <bundle-id> \
    --source "Documents/$f" --destination "$OUT/$f"
done

sqlite3 "$OUT/app.db" "pragma wal_checkpoint(TRUNCATE);"
sqlite3 "$OUT/app.db" "pragma user_version;"   # only trustworthy after the checkpoint
```

`pragma user_version` is the real schema version for WatermelonDB, and reading
it before the checkpoint is exactly how a good migration gets reported as
broken.

## Copy files one at a time, not the whole directory

`--source Documents` fails with `CoreDevice.ControlChannelConnectionError` /
`NWError 54 connection reset` when the device is paired over the local network
(Wi-Fi tunnel) rather than cable. The per-file copy succeeds immediately. Retry
loops help.

## The device is probably reachable

`available (paired)` in `xcrun devicectl list devices` **does not mean
unreachable.** Check before concluding it is offline:

```bash
xcrun devicectl device info details --device <UDID>   # look for Device State: connected
```

## Simulator side

`xcrun simctl get_app_container <udid> <bundle-id> data` locates the container
and you read the file directly, so the WAL is less likely to bite — but it is
the same database in the same journal mode. Checkpoint before drawing
conclusions.

`get_app_container` false-negatives on **shutdown** simulators. Probe the
filesystem instead:

```
~/Library/Developer/CoreSimulator/Devices/*/data/Containers/Bundle/Application/*/*.app
```

## Backups

Installing over an existing app **preserves** the data container, so a backup is
a precaution rather than a requirement. Take a complete one anyway — all three
files — and **verify it** rather than assuming the copy is usable:

```bash
sqlite3 "$OUT/app.db" "pragma integrity_check;"
sqlite3 "$OUT/app.db" "select count(*) from <table>;"
```

A Release build still permits this: `get-task-allow` remains true, so
`devicectl device copy from` works. See `building-for-ios-device`.

## Do not infer settings state from the database

Secure storage (`expo-secure-store` and friends) lives in the **keychain**, not
in SQLite. An empty settings table is not evidence that no API key or preference
is configured. Check the UI, or exercise the feature.

## Quick reference

| Step | Command |
|---|---|
| Locate (simulator) | `xcrun simctl get_app_container <udid> <bundle-id> data` |
| Copy (device) | `devicectl device copy from --domain-type appDataContainer`, one file at a time |
| Fold in the WAL | `pragma wal_checkpoint(TRUNCATE);` |
| Read schema version | `pragma user_version;` — after the checkpoint |
| Verify a backup | `pragma integrity_check;` plus row counts |

## Common mistakes

| Mistake | Consequence |
|---|---|
| Copying `app.db` only | Stale snapshot; a restore would lose the WAL's contents |
| Reading `user_version` before checkpointing | A successful migration reads as failed |
| `--source Documents` over a Wi-Fi pairing | `NWError 54`; copy per file instead |
| Reading `available (paired)` as offline | Skips a device that is actually connected |
| Concluding "no API key" from an empty table | Secure storage is in the keychain, not SQLite |
