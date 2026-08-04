# On-Device Export Design (Vault Export)

## Summary

Replace the Mac-side HTTP bridge with on-device file export as the primary path for persisting workouts and routines to the user's vault. The app will serialize routines and exercise history (session sets) to the existing markdown format (`src/interop`) and offer export options: Files app (persistent), iCloud Drive, or share sheet (temporary). The bridge remains in place but unadvertised during this migration phase; removal is deferred to a separate ticket once the export path is proven. No changes touch the session engine, sync queue, or markdown contract grammar — only the *transport* moves from HTTP POST to device export.

**Staging strategy**: Build export as the primary UI path visible to all users. Leave bridge configuration accessible to existing users but do not advertise it. Deletion happens in a separate, later ticket once users have validated the export workflow.

## Definition of Done

1. Users can export routines and exercise history to Files app (iCloud Drive persistence) or via share sheet (one-time send).
2. Export uses existing `serializeRoutine` and session serialization code; no format changes.
3. Settings UI has export buttons; bridge configuration remains but is secondary/optional.
4. Exported files are human-readable markdown matching the vault contract.
5. Export is idempotent: re-exporting the same routine produces the same file.
6. Bridge remains in settings (labelled "Advanced" or hidden behind a toggle) for users who still need it; deprecation messaging is optional.
7. A follow-up ticket documents deletion of the bridge (settings fields, sync service health check, import UI).

## Acceptance Criteria

### export.AC1: Settings UI
- **export.AC1.1 Success:** "Export Routine" / "Export All Routines" buttons appear on settings screen and routine detail screens.
- **export.AC1.2 Success:** Export Routine from detail screen exports that routine only.
- **export.AC1.3 Success:** Export All Routines exports every routine in one batch operation.
- **export.AC1.4 Success:** Export History exports exercise history (all session sets grouped by exercise).
- **export.AC1.5 Edge:** Attempting export without permission shows OS file picker / permission request.
- **export.AC1.6 Edge:** Export with zero routines / zero history displays informative message.

### export.AC2: Export destination options
- **export.AC2.1 Success:** Files app save (iCloud Drive persistence) works on iOS 13+.
- **export.AC2.2 Success:** Share sheet (Mail, Messages, AirDrop, etc.) works for users without file picker consent.
- **export.AC2.3 Edge:** User can choose destination per-export (Files vs. share sheet).
- **export.AC2.4 Success:** Exported file has sensible name: `routine-{routineId}.md`, `export-routines-{date}.md`, `exercise-history-{date}.md`.

### export.AC3: Format and content
- **export.AC3.1 Success:** Exported routine markdown is identical to vault contract (frontmatter + workout block).
- **export.AC3.2 Success:** Exported session history follows the same markdown format (type: workout-session).
- **export.AC3.3 Success:** Exported files round-trip (parse correctly via `parseRoutine`/`parseSession`).
- **export.AC3.4 Success:** Metadata (date, id, tags) is populated correctly in frontmatter.

### export.AC4: Operational semantics
- **export.AC4.1 Success:** Export is fire-and-forget (no persistent queue; user initiates manually).
- **export.AC4.2 Success:** Errors (permission denied, disk full) surface as user-visible messages, not crashes.
- **export.AC4.3 Success:** Multiple routine exports write separate files (not concatenated).
- **export.AC4.4 Success:** Re-exporting the same routine overwrites or prompts for a new file name (configurable).

### export.AC5: Bridge deprecation (no removal yet)
- **export.AC5.1 Edge:** Bridge settings remain accessible but are not highlighted (e.g., behind "Advanced" section).
- **export.AC5.2 Edge:** No warning or deprecation banner in AC phase; bridge still works if configured.
- **export.AC5.3 Deferred:** Removal of bridge settings/sync/import happens in separate ticket.

### export.AC6: Session history export
- **export.AC6.1 Success:** "Export Exercise History" exports all completed sessions as individual markdown files.
- **export.AC6.2 Success:** Each exported session includes all logged sets, organized by exercise.
- **export.AC6.3 Success:** Session history export groups sessions by date for readability (optional).

## Glossary

- **Vault markdown contract**: The shared grammar in `src/interop/format.ts` (frontmatter + workout block) that the bridge and app both use. This design reuses it unchanged.
- **Routine export**: Serialization of a routine's metadata, exercises, and targets via `serializeRoutine`.
- **Session export**: Serialization of a completed session's logged sets and metadata via `serializeSession`.
- **Exercise history**: Aggregated view of all logged sets for each exercise across all completed sessions.
- **Files app**: iOS Files app; persistent storage to iCloud Drive or device.
- **Share sheet**: Native `UIActivityViewController` (wrapped by Expo) for one-time sends (Mail, AirDrop, etc.).
- **Idempotent**: Re-exporting the same routine produces identical content (useful for vault snapshots).

## Architecture

A new vertical slice in the imperative shell. The markdown contract, serializers, sync service, and session engine are untouched.

```
src/export/
  exportService.ts         — routine/session serialization + file write coordination
  exportOptions.ts         — abstraction over Files app vs. share sheet
  filesAppExporter.ts      — `expo-document-picker` backend
  shareSheetExporter.ts    — `expo-sharing` backend
  exportPresenter.ts       — derive user-visible data from routines/history for export (names, dates)
src/app/(tabs)/settings/
  export.tsx               — "Export" tab / section in settings (route or inline)
src/app/routine/
  [id].tsx                 — add "Export" button to routine detail screen (modal or direct)
```

**Packages — corrected 2026-08-04, the original claim here was wrong.** `expo-sharing`, `expo-file-system` and `expo-document-picker` are **not** currently installed: checked against `package.json` on `main`, which carries `expo-constants`, `expo-dev-client`, `expo-device`, `expo-font`, `expo-glass-effect`, `expo-image`, `expo-linking`, `expo-notifications`, `expo-router`, `expo-secure-store`, `expo-splash-screen`, `expo-status-bar`, `expo-symbols`, `expo-system-ui`, `expo-web-browser` — and none of the three above. Being *available in* SDK 57 is not the same as being *installed*.

They are also **native modules**, so adding any of them requires `npx expo prebuild -p ios --clean` and a dev-client rebuild before the feature will even link. That is a real cost, not a formality: PR #103 sat blocked behind exactly this step, and a tester running an unrelinked build sees the feature as broken rather than unlinked. Budget it into Phase 2 rather than discovering it there.

**Data flow.** Export button → select destination (Files vs. Share) → `exportService.serialize(routine/session)` → `filesAppExporter.save()` or `shareSheetExporter.share()` → OS UI (file picker or activity sheet) → user confirms → file written or sent.

**Entry points:**
- Settings tab: "Export All Routines", "Export Exercise History"
- Routine detail screen: "Export" button
- Optional: home/dashboard quick-export widget

**Contracts.** Serializers already exist; no new contracts introduced. Exported markdown is byte-identical to vault contract.

## Existing Patterns

Codebase investigation (2026-08-04) found the following patterns, all of which this design follows:

- **Serialization**: `serializeRoutine`/`serializeSession` already exist in `src/interop/serialize.ts` and are tested via roundtrip tests. This design calls them directly, no changes needed.
- **Settings**: Module-level cache + injectable secure-store backend (`src/state/settings.ts`). Export options can be stored as a user preference (default to "Files app") without adding new secure fields.
- **Error handling**: Bridge client uses typed errors (`BridgeUnreachable`, `BridgeHttpError`). Export service should follow the same pattern (`FileExportError`, `ShareSheetDismissed`).
- **Async operations**: Sync service uses fire-and-forget effects for HTTP. Export is different (modal/UI-driven), but follows a similar `try/catch` → display result pattern.
- **Screens**: expo-router Stack route, ThemedView/ThemedText, Spacing constants, SafeAreaView — per existing settings and routine screens.

**Divergence:** The export path is pull-based (user action) rather than push-based (automatic sync). The session state is read-only during export (no engine involvement).

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Export service and serialization
**Goal:** Serialize routines and sessions to markdown via existing serializers.

**Components:**
- `src/export/exportService.ts` — `exportRoutine(db, routineId)` and `exportSessionHistory(db)` which call `serializeRoutine`/`serializeSession` and coordinate file writes
- `src/export/exportPresenter.ts` — `getRoutineExportName(routine)`, `getSessionHistoryExportName()` for user-friendly file names

**Dependencies:** None (existing serializers).

**Covers:** export.AC3 (format/content), export.AC4.1 (fire-and-forget logic), export.AC4.3 (no concatenation)

**Done when:** Tests pass with LokiJS test DB: routine export produces valid markdown, session history export produces multiple session files, file names are sensible and unique, round-trip parsing succeeds.

**⚠️ Prerequisite the phase cannot skip (2026-08-04).** `jest.config.js`'s `testMatch` is `src/{engine,db,interop,state,sync,health,helpers,ai,theme,watch}/**/*.test.ts` — **`export` is not in it.** A new `src/export/` domain therefore gets **zero** coverage: the tests this phase's Done criterion depends on would be written, committed, and silently never run, and the suite would stay green regardless. AGENTS.md states this hazard directly ("A new `src/` domain gets no test coverage until it is added to that list"). **Add `export` to `testMatch` as the first commit of Phase 1**, and confirm the new tests actually execute (the count must rise) before trusting a green run.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Files app backend
**Goal:** Write exported routines to iOS Files app (iCloud Drive persistence).

**Components:**
- `src/export/filesAppExporter.ts` — `createFilesAppExporter()` wrapping `expo-document-picker` for iOS file save dialog; returns `{ success: boolean, path?: string, error?: string }`

**Dependencies:** Phase 1. New **native** packages — see the corrected Packages note above; requires `expo prebuild --clean` + dev-client rebuild.

**⚠️ Mechanism correction (2026-08-04).** `expo-document-picker` is a *picker* — it opens the Files UI to **read** a document the user chooses. It is not a save API, so it cannot implement this phase as written. On iOS there is no direct "save to Files" call; the working shape is to write the file into the app's documents directory with `expo-file-system` and then hand it to `expo-sharing`, whose share sheet includes **"Save to Files"** as a destination.

**Consequence for the phase plan:** Phases 2 and 3 are not two backends. On iOS they are one mechanism — write to disk, then present the share sheet — with "Files app" and "AirDrop/Mail" being two *choices the user makes inside the same OS sheet*, not two code paths the app selects between. Collapse them, and drop `exportOptions.ts`/`filesAppExporter.ts`/`shareSheetExporter.ts` down to a single exporter unless a genuine second path emerges.

**Covers:** export.AC2.1, AC2.4 (Files app destination, sensible names), export.AC4.2 (error handling)

**Done when:** Manual test on simulator: export routine → file picker opens → save to iCloud Drive (or local Simulator documents) → file appears → round-trip parsing succeeds.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Share sheet backend
**Goal:** Export via native share sheet (Mail, AirDrop, Messages, etc.).

**Components:**
- `src/export/shareSheetExporter.ts` — `createShareSheetExporter()` wrapping `expo-sharing`; handles multi-file sharing for batch exports

**Dependencies:** Phase 1. New package: `expo-sharing` (standard Expo SDK 57).

**Covers:** export.AC2.2, AC2.3 (share sheet destination, user choice)

**Done when:** Manual test on simulator: export routine → share sheet opens → dismiss or select Mail → optional: verify Mail draft received (or other destinations if testing on device).
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Settings export UI
**Goal:** Users can trigger export from settings.

**Components:**
- `src/app/(tabs)/settings/export.tsx` — new Stack route or inline section with "Export All Routines", "Export Exercise History", and destination picker (Files vs. Share)
- `src/app/(tabs)/settings/index.tsx` — add link/button to export screen (or inline component)
- `src/state/settings.ts` — optional: `exportPreference: 'files' | 'share'` stored in settings

**Dependencies:** Phases 1, 2, 3.

**Covers:** export.AC1 (settings buttons), export.AC2.3 (user chooses destination), export.AC1.6 (empty state)

**Done when:** Manual test on simulator: navigate to Settings → Export section → tap "Export All Routines" → destination picker (Files or Share) → operation completes → success or error message displays.
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: Routine detail export button
**Goal:** Single routine can be exported from its detail screen.

**Components:**
- `src/app/routine/[id].tsx` — add "Export" button (header or floating action); taps open export modal with destination choice
- Export modal re-uses Phase 4 destination logic

**Dependencies:** Phases 1–4.

**Covers:** export.AC1.2 (export single routine from detail)

**Done when:** Manual test on simulator: navigate to routine → tap "Export" button → destination picker → operation completes.
<!-- END_PHASE_5 -->

<!-- START_PHASE_6 -->
### Phase 6: Bridge deprecation UI (minimal)
**Goal:** Make bridge optional/secondary; export is now primary.

**Components:**
- `src/app/(tabs)/settings/bridge.tsx` — add visual distinction (collapsible section, "Advanced" label, or subtle styling) to de-emphasize
- No deprecation banner or warning yet (planned for removal ticket)
- No code changes to bridge logic; it remains functional

**Dependencies:** Phases 1–5 (export is primary by the time this runs).

**Covers:** export.AC5.1 (bridge remains but secondary)

**Done when:** Manual review of settings screen: export section is prominent, bridge section is less prominent (e.g., below export, labelled "Advanced", or collapsed).
<!-- END_PHASE_6 -->

<!-- START_PHASE_7 -->
### Phase 7: Integration and edge cases
**Goal:** Handle concurrent operations, large datasets, and error recovery.

**Components:**
- `src/export/exportService.ts` — add loading/progress state for large history exports (optional)
- `src/app/(tabs)/settings/export.tsx` — "Exporting..." UI state, cancel button (optional)
- Error messaging: distinguish permission denied, disk full, user cancelled

**Dependencies:** Phases 1–6.

**Covers:** export.AC4.2 (error messaging), export.AC1.5 (permissions)

**Done when:** Manual test: attempt export without file permission → OS permission prompt appears → accept → export proceeds; attempt export with no routines → informative message ("No routines to export").
<!-- END_PHASE_7 -->

## Additional Considerations

### Open Questions & Decisions Needed

1. **Batch export format**: Should "Export All Routines" create:
   - One zip file with multiple markdown files (easiest for sharing)?
   - One markdown file per routine (write individually to Files app)?
   - One concatenated markdown file (simplest, but harder to edit)?
   **Recommendation**: Start with individual files to Files app, defer zipping if needed.

2. **Session history scope**: Does "Export Exercise History" include:
   - Raw session files (one per completed session)?
   - Aggregated working-set history (e.g., "Bench Press: 8 sets logged across 10 sessions")?
   - Both options to the user?
   **Recommendation**: Export raw sessions first (reuse `serializeSession`). Aggregated reporting is a separate feature.

3. **Filename collision**: If user exports the same routine twice:
   - Overwrite the file (idempotent, simpler)?
   - Prompt for new name (safer, more friction)?
   - Append timestamp (automatic but clutters files)?
   **Recommendation**: Files app handles this via save dialog; let the OS handle collision. Share sheet doesn't overwrite, so no collision.

4. **Vault sync semantics**: Does on-device export affect `sync_status`?
   - Export does NOT flip `sync_status` (export is separate from sync).
   - Sessions remain `'local'` until bridge POST succeeds (if bridge is still in use during migration).
   - Sessions can be exported multiple times; `sync_status` is independent.
   **Recommendation**: Export is orthogonal to sync. No changes to sync queue logic.

5. **Bridge removal timeline**: Should removal ticket be:
   - Immediate follow-up PR (same sprint)?
   - Deferred until next sprint (users validate export first)?
   **Recommendation**: Deferred. Open the ticket, but don't block export on removal.

### Pre-existing constraints (inherited from architecture)

- **No new DB tables**: Export reads from existing tables only.
- **No session engine involvement**: Export is read-only; never dispatches events.
- **No markdown contract changes**: Exported format is byte-identical to vault contract.
- **Existing serializers are correct**: `serializeSession`/`serializeRoutine` are tested and must remain unchanged.

### Known limitations (acceptable for Phase 1)

- **No automatic sync**: Export is manual, not automatic. (Sync remains optional bridge-based.)
- **No push notification on export**: Exported files go to Files app silently; no confirmation ping to vault.
- **No conflict resolution**: If user exports a routine that was updated in the vault by another tool, no merge. (Same limitation as the bridge today.)
- **No scheduling**: Export does not support scheduled/periodic exports. (Future enhancement.)

## Removal Ticket Sketch

A separate PR will handle bridge removal. That ticket should:

1. **Remove bridge settings**: `src/app/(tabs)/settings/bridge.tsx` deleted; bridge URL/token fields removed from `AppSettings`.
2. **Simplify sync service**: `src/sync/syncService.ts` gutted to no-op or deleted. `health()` check removed (export does not need health).
3. **Remove bridge import**: "Import Routines" button and logic deleted. Users must now author routines in-app or hand-edit exported markdown and re-import via email/share.
4. **Audit references**: Search for `bridge`, `sync`, `BridgeClient` to catch any remaining ties.
5. **Update AGENTS.md**: Remove "Two-repo split" section; update Sync section to note bridge is deprecated.
6. **Add migration notes**: Link from deprecation docs or CHANGELOG.md explaining the export-first workflow.

**Estimated scope**: 2–3 small PRs, no complex refactoring.

## Risk Mitigation

1. **Testing**: Roundtrip tests for exported markdown (parse → validate → serialize again) catch format regressions.
2. **Staged rollout**: Export ships as primary UI while bridge remains; users can opt-in to export first.
3. **No format changes**: Reusing existing serializers eliminates format-related bugs.
4. **Backward compatibility**: Exported files conform to vault contract, so users can hand-edit and re-import if needed.

## Success Criteria (for MVP)

- Routine export to Files app produces valid markdown.
- Exercise history export produces valid session files.
- Share sheet export works.
- Settings UI is intuitive.
- No regression in existing sync/import functionality.
- Bridge remains functional for existing users (no removal in this PR).
