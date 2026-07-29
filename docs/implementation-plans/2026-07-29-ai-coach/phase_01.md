# AI Coach Implementation Plan — Phase 1: Settings extension

**Goal:** Users can store their Anthropic API key, exercise-goals paragraph, and available-equipment description in app settings, persisted via the existing secure-store-backed settings blob.

**Architecture:** Extend the existing module-level settings cache (`src/state/settings.ts`) with three new string fields under the same `'bridge_settings'` storage key. The existing merge-on-load pattern (`cache = { ...cache, ...parsed }`) makes old stored blobs load cleanly with new fields defaulting to `''`. Add an "AI Coach" section to the settings screen following the existing useState → TextInput → `setSettings` pattern.

**Tech Stack:** TypeScript, React Native (Expo SDK 57), expo-secure-store (existing adapter in `src/storage/secureStorage.ts`), Jest (node project, ts-jest).

**Scope:** Phase 1 of 6 from `docs/design-plans/2026-07-29-ai-coach.md`.

**Codebase verified:** 2026-07-29 (codebase-investigator against worktree `.worktrees/ai-coach`).

**Naming note:** The design document calls the settings record `AppSettings`; the codebase names it `BridgeSettings` (`src/state/settings.ts:6-9`). The two are the same record. This phase keeps the existing `BridgeSettings` name and adds fields — no rename, to avoid touching unknown import sites.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### ai-coach.AC1: Settings fields
- **ai-coach.AC1.1 Success:** Anthropic key, goals, and equipment save and survive app restart (reload from secure storage)
- **ai-coach.AC1.2 Success:** Pre-existing stored settings blobs (bridge URL/token only) load without error; new fields default to empty
- **ai-coach.AC1.3 Success:** Key input is masked (`secureTextEntry`); bridge settings remain unaffected by AI-field edits
- **ai-coach.AC1.4 Edge:** All three fields may be empty; app behaves normally

---

## Verified codebase state (inputs to this phase)

- `src/state/settings.ts` (87 lines): `interface BridgeSettings { baseUrl: string; token: string }` (lines 6-9); `StorageBackend` interface (lines 11-15); storage key `'bridge_settings'` (line 17); module cache initialized `{ baseUrl: '', token: '' }` (lines 20-23); `injectSettingsStorage` (line 31); `resetForTesting` (line 38); `loadSettings` merges `cache = { ...cache, ...parsed }` (line 57); `getSettings` returns a spread copy (line 69); `setSettings(newSettings: Partial<BridgeSettings>)` merges and fire-and-forget persists `JSON.stringify(cache)` (lines 77-86).
- `src/state/settings.test.ts` (115 lines, 8 tests): uses a fake in-memory `StorageBackend`, `injectSettingsStorage`, `resetForTesting` in `beforeEach`, covers defaults, cache updates, persistence, hydration, partial updates.
- `src/app/(tabs)/settings.tsx` (333 lines): `useState` per field (lines 17-18), load on mount from `getSettings()` (lines 27-31), save handler calls `setSettings({ baseUrl, token })` (lines 33-38). Token `TextInput` uses `secureTextEntry={true}` (line 143), styled by `styles.input` (lines 295-302). Sections are `<ThemedView style={styles.section}>` with `<ThemedText type="subtitle">` headers; last section (Sync Operations) ends at line 249, before `</ScrollView>` at line 250.
- Test command for a single file: `npx jest src/state/settings.test.ts` (jest config uses `watchman: false`; run individual tests only, per AGENTS.md).

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Extend the settings record with AI Coach fields (TDD)

**Verifies:** ai-coach.AC1.1, ai-coach.AC1.2, ai-coach.AC1.4, and the "bridge settings remain unaffected" half of ai-coach.AC1.3

**Files:**
- Modify: `src/state/settings.ts` (interface at lines 6-9, cache default at lines 20-23)
- Test: `src/state/settings.test.ts` (unit; extend the existing suite)

**Step 1: Write the failing tests**

Extend `src/state/settings.test.ts`, following its existing fake-`StorageBackend` + `resetForTesting()` + `injectSettingsStorage()` pattern. Add tests that verify:

- **AC1.1 (persist + reload):** `setSettings({ anthropicKey: 'sk-test', aiGoals: 'get strong', aiEquipment: 'dumbbells' })` writes all three values into the JSON blob stored under `'bridge_settings'` (await the fake backend's stored value and `JSON.parse` it); a fresh `resetForTesting()` + `loadSettings()` against a backend pre-seeded with that blob hydrates `getSettings()` with the same three values.
- **AC1.2 (back-compat):** pre-seed the fake backend with a legacy blob `JSON.stringify({ baseUrl: 'http://mac.local:3000', token: 'tok' })` (no AI fields); `loadSettings()` succeeds and `getSettings()` returns `anthropicKey: ''`, `aiGoals: ''`, `aiEquipment: ''` with bridge fields intact.
- **AC1.3 (isolation):** with bridge fields already set, `setSettings({ anthropicKey: 'sk-x' })` leaves `baseUrl`/`token` unchanged in both cache and persisted blob; conversely `setSettings({ baseUrl: 'http://new' })` leaves AI fields unchanged.
- **AC1.4 (empty):** defaults are `''` for all three new fields before any set; setting all three to `''` explicitly persists and reloads without error.

**Step 2: Run the tests to verify they fail**

Run: `npx jest src/state/settings.test.ts`
Expected: the new tests fail with TypeScript errors on the new field names (they don't exist on `BridgeSettings` yet); the 8 pre-existing tests still pass conceptually (compilation failure of the suite counts as the red state).

**Step 3: Commit the failing tests**

```bash
git add src/state/settings.test.ts
git commit -m "test(settings): add AI Coach settings field tests"
```

**Step 4: Implement**

In `src/state/settings.ts`:

```typescript
interface BridgeSettings {
  baseUrl: string;
  token: string;
  anthropicKey: string;
  aiGoals: string;
  aiEquipment: string;
}
```

and extend the module cache default:

```typescript
let cache: BridgeSettings = {
  baseUrl: '',
  token: '',
  anthropicKey: '',
  aiGoals: '',
  aiEquipment: '',
};
```

**Also update `resetForTesting()` (lines 38-41):** it hardcodes its own `cache = { baseUrl: '', token: '' }` reset object, which becomes a type error once the interface has five fields — and the AC1.4 defaults test runs after `resetForTesting()` in `beforeEach`, so a stale reset object would surface as `undefined` values. Extend that object with the three new fields set to `''` (or refactor both sites to share one `DEFAULT_SETTINGS` constant).

No other changes: `loadSettings`'s merge (`{ ...cache, ...parsed }`) already handles legacy blobs, `setSettings(Partial<BridgeSettings>)` already handles partial updates, and persistence already serializes the whole cache.

**Step 5: Run the tests to verify they pass**

Run: `npx jest src/state/settings.test.ts`
Expected: all tests pass (existing 8 + new ones), zero failures.

**Step 6: Commit**

```bash
git add src/state/settings.ts
git commit -m "feat(settings): add anthropicKey, aiGoals, aiEquipment fields"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: "AI Coach" section on the settings screen

**Verifies:** ai-coach.AC1.3 (masked key input — operational verification; UI screens have no RN-env tests per repo convention)

**Files:**
- Modify: `src/app/(tabs)/settings.tsx`

**Step 1: Implement the section**

Follow the exact patterns already in the file:

1. Add three `useState` hooks next to the existing ones (after line 18):
   ```typescript
   const [anthropicKey, setAnthropicKey] = useState('');
   const [aiGoals, setAiGoals] = useState('');
   const [aiEquipment, setAiEquipment] = useState('');
   ```
2. Hydrate them in the existing mount `useEffect` (lines 27-31) from `getSettings()`.
3. Add a save handler mirroring `handleSaveSettings` (lines 33-38):
   ```typescript
   const handleSaveAiSettings = () => {
     setSettings({ anthropicKey, aiGoals, aiEquipment });
   };
   ```
   (A separate handler keeps bridge-save side effects — clearing connection/import/sync statuses — out of the AI save path. A single combined handler is also acceptable if it saves all fields; do not clear bridge statuses from the AI path.)
4. Insert a new section after the Sync Operations section (after line 249, before `</ScrollView>` at line 250), matching the existing section markup:
   - `<ThemedView style={styles.section}>` wrapper, `<ThemedText type="subtitle">AI Coach</ThemedText>` header.
   - "Anthropic API Key" label + `TextInput` with `secureTextEntry={true}`, `autoCapitalize="none"`, `autoCorrect={false}`, placeholder `"sk-ant-..."`, `style={styles.input}` — mirror the token input at lines 137-146.
   - "Your goals" label + multiline `TextInput` (`multiline`, `numberOfLines={4}`, a taller style variant based on `styles.input` with `minHeight` and `textAlignVertical: 'top'`), placeholder e.g. `"e.g. Build strength, stay mobile, 3 sessions/week"`.
   - "Available equipment" label + identical multiline `TextInput`, placeholder e.g. `"e.g. Dumbbells up to 50lb, pull-up bar, bands"`.
   - A Save `Pressable` styled like the existing save button (line 148 area) calling `handleSaveAiSettings`.

**Step 2: Verify operationally**

Run: `npx tsc --noEmit`
Expected: exits 0 with no output (verified passing on the pre-change tree).

Do **not** run `npm run lint`: ESLint is not installed in this repo and `expo lint`'s auto-bootstrap fails with an ERESOLVE conflict, mutating `package.json` before it dies.

(Full manual verification — section renders, key is masked, values survive app restart — happens in the Phase 6 simulator run-through; the store-level behavior is already covered by Task 1's tests.)

**Step 3: Commit**

```bash
git add "src/app/(tabs)/settings.tsx"
git commit -m "feat(settings): AI Coach section with key, goals, equipment inputs"
```
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->
