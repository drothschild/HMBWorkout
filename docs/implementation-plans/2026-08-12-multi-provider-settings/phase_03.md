# Phase 3: The AI Provider screen and the settings split

**Design:** `docs/design-plans/2026-08-12-multi-provider-settings.md`
**Covers:** AC3.1 – AC3.11
**Gates:** AC7.1 (`tsc`), AC7.2 (`npm test`), AC7.3 (`lint` 0 errors)

---

## Read this before you write a line

**Nothing in this phase is testable.** `jest.config.js` runs one `node` project and `src/app` is not
in its `testMatch`. A green `npm test` at the end of this phase proves the *rest* of the app still
works and says **nothing** about the feature.

The real gates are:
- **five structural reads** (AC3.1 – AC3.5), recorded in the PR description with the grep output; and
- **six simulator scenarios** (AC3.6 – AC3.11), with screenshots.

Phase 2 exists so that every decision this screen makes already has a test. Your job here is to make
this screen contain **no decision of its own**. AC3.1 is the grep that enforces it.

---

## Investigation findings (done for you; re-check the ones marked ⚠)

1. **The screen to copy is `src/app/(tabs)/settings/ai.tsx`.** Its debounced-autosave block
   (`:34-75` — `pendingRef`, `timerRef`, `flush`, `queueSave`, the unmount effect, the
   `useFocusEffect` re-sync) is well-commented and battle-tested. Reuse it verbatim.
2. **The picker control is a `Pressable` + `Modal`, not `@expo/ui`.** `@expo/ui@57.0.4` is in
   `package.json` and ships a SwiftUI `Picker`, but `grep -rn "@expo/ui" src/` returns **nothing** —
   it is imported nowhere. Its first use would be the first native SwiftUI view in this app, and
   AGENTS.md is emphatic that a native module's failure mode is a **runtime crash at launch, not a
   build error**, with `ios/` gitignored so linkage cannot be established from a plan. The `Modal`
   pattern already ships twice: `src/components/ReplaceExercise.tsx:65-90` (backdrop + sheet +
   `animationType="slide"`) and `src/components/SetLogger.tsx`. Copy `ReplaceExercise.tsx`.
3. ⚠ **Expo Router typed-routes trap, verified.** `.expo/types/router.d.ts` is gitignored and
   regenerated per-machine by Metro. The main checkout's copy enumerates exactly `/settings` and
   `/settings/ai` as literals. So `router.push('/settings/ai-provider')` **will fail `tsc` in any
   checkout that has not run Metro since this route landed** — including a reviewer's. AGENTS.md
   documents this for *dynamic* routes; this is the static case, which that note does not cover.
   **Remedy:** run `npm start` once (or copy a fresh `router.d.ts`) before concluding the push is
   wrong. **Do not change correct code to chase a route-shaped `tsc` error.** Say so in the PR.
   ⚠ A git worktree with no `.expo/types` at all type-checks *everything* — `expo-router` falls back
   to `string`. A clean `tsc` in a worktree is not evidence here.
4. **`settings/index.tsx:9-21`** declares `interface SectionRow { href: '/settings/ai' }` — a
   single-member literal type — and one `SECTIONS` entry. Both widen.
5. **`settings/_layout.tsx`** is `<Stack screenOptions={{ headerShown: false }} />`. A new file in
   `src/app/(tabs)/settings/` is routed automatically; no layout change is needed.
6. **`ai.tsx` renders its own back button** (`:84-91`) pointing at `/settings`. Copy it.
7. **The `AiSettingsPatch` type** at `ai.tsx:13-20` lists `anthropicKey` first. Remove that member.

---

## Tasks

### Task 1 — `src/app/(tabs)/settings/ai-provider.tsx` (new)

Structure, top to bottom:

1. Back button → `/settings` (copy `ai.tsx:83-92`).
2. Title row: `AI Provider` + the `Changes save automatically.` caption.
3. **Provider row** — a `Pressable` showing `PROVIDER_LABEL[selectedProvider]` with a `›`, opening
   the modal.
4. **Key field** — `TextInput`, `secureTextEntry`, `autoCapitalize="none"`, `autoCorrect={false}`,
   label `` `${PROVIDER_LABEL[selectedProvider]} API Key` ``, placeholder
   `keyPlaceholder(selectedProvider)`.
5. **Warning line** — the string from `crossProviderKeyWarning`, rendered only when non-null.
6. The provider `Modal` — two rows from `AI_PROVIDERS`, current one marked.

#### State and the autosave

```tsx
import { Alert, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import {
  AI_PROVIDERS,
  PROVIDER_LABEL,
  apiKeyPatch,
  crossProviderKeyWarning,
  initialProviderSelection,
  keyPlaceholder,
  providerSwitchPlan,
  storedKeyFor,
} from '@/state/aiProviderSettings';
import { getSettings, setSettings } from '@/state/settings';

const AUTOSAVE_DELAY_MS = 500;

export default function AiProviderSettingsScreen() {
  // DISPLAY ONLY. Deriving the initial value must NOT write it — installs that
  // predate this screen have aiProvider undefined and resolve implicitly in
  // factory.ts. See AC3.2.
  const [provider, setProvider] = useState(() => initialProviderSelection(getSettings()));
  const [keyText, setKeyText] = useState(() => storedKeyFor(getSettings(), provider));
  const [pickerOpen, setPickerOpen] = useState(false);

  const pendingRef = useRef<Partial<BridgeSettings>>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // flush / queueSave / unmount effect / useFocusEffect: copied verbatim from
  // settings/ai.tsx:40-75.
}
```

⚠ `keyText` holds the **raw** input. Trimming happens only in `apiKeyPatch`. Trimming the `useState`
value makes the field impossible to type into normally.

#### The key field's onChange

```tsx
onChangeText={(value) => {
  setKeyText(value);
  queueSave(apiKeyPatch(provider, value));   // the single trim boundary
}}
```

⚠ **Never** `queueSave({ anthropicKey: value })`. That is the shape that shipped the untrimmed-key
regression in the previous phase of this work.

#### The provider switch — the one genuinely subtle piece

```tsx
function applySwitch(next: AiProvider) {
  const plan = providerSwitchPlan(getSettings(), next);

  const commit = () => {
    // CRITICAL: go through queueSave + flush, never setSettings directly.
    //
    // queueSave merges { ...pendingRef.current, ...patch }, so the patch's
    // cleared key OVERWRITES a key the user typed moments ago and has not been
    // flushed yet. A bare setSettings(plan.patch) leaves that pending patch
    // alive behind a live 500ms timer, which then fires and RESTORES the key
    // the user just destroyed — persisted, and invisible, because the field on
    // screen is empty. See AC3.3 and AC3.9.
    queueSave(plan.patch);
    flush();

    setProvider(next);
    setKeyText(currentKeyFor(getSettings(), next));
    setPickerOpen(false);
  };

  if (!plan.needsConfirmation) {
    commit();
    return;
  }

  Alert.alert(
    `Switch to ${PROVIDER_LABEL[next]}?`,
    `Your saved ${PROVIDER_LABEL[next === 'anthropic' ? 'openai' : 'anthropic']} API key will be removed. You'll need to paste it again to switch back.`,
    [
      { text: 'Cancel', style: 'cancel', onPress: () => setPickerOpen(false) },
      { text: 'Switch', style: 'destructive', onPress: commit },
    ]
  );
}
```

⚠ The confirmation copy must state that the key is **removed** and that switching back requires
re-pasting. The field is `secureTextEntry`; the user cannot read back what they are losing.

⚠ Cancel must leave everything untouched — no `setProvider`, no patch.

#### The modal

Copy `ReplaceExercise.tsx:65-90`'s backdrop + sheet. Two rows:

```tsx
{AI_PROVIDERS.map((p) => (
  <Pressable key={p} onPress={() => applySwitch(p)} style={/* … */}>
    <ThemedText>{PROVIDER_LABEL[p]}</ThemedText>
    {p === provider && <ThemedText>✓</ThemedText>}
  </Pressable>
))}
```

**Covers:** AC3.1, AC3.2, AC3.3

---

### Task 2 — Strip the key field from `src/app/(tabs)/settings/ai.tsx`

Delete:
- `anthropicKey` from `AiSettingsPatch` (`:14`);
- `const [anthropicKey, setAnthropicKey] = useState(...)` (`:27`);
- `setAnthropicKey(settings.anthropicKey)` in the focus effect (`:68`);
- the whole `ThemedView` form group at `:136-153`.

Leave everything else — goals, equipment, coaching style, age, experience, the Start/Redo button, the
long layout comment at `:93-119`, and all of `styles` — exactly as it is.

⚠ The layout comment at `:93-119` explains why the screen scrolls and why `minHeight: 88` exists.
Removing ~18pt of fixed content does **not** invalidate it — the column still overflows on every
phone. Do not delete or "correct" that comment.

**Verify:** `grep -n "anthropicKey" "src/app/(tabs)/settings/ai.tsx"` returns nothing.

**Covers:** AC3.4

---

### Task 3 — Add the row in `src/app/(tabs)/settings/index.tsx`

```ts
interface SectionRow {
  title: string;
  description: string;
  href: '/settings/ai' | '/settings/ai-provider';
}

const SECTIONS: SectionRow[] = [
  {
    title: 'AI Provider',
    description: 'Provider, API key, models',
    href: '/settings/ai-provider',
  },
  {
    title: 'AI Coach',
    description: 'Goals, equipment, coaching style',   // was: 'Anthropic API key, goals, equipment'
    href: '/settings/ai',
  },
];
```

Provider first: you need a key before the coach settings mean anything.

⚠ The AI Coach description **must** stop naming an API key — it is now the wrong screen for one.

**Covers:** AC3.5

---

### Task 4 — Fix `src/app/ai-coach.tsx`: no-key screen routes and provider hardcoding

**File:** `src/app/ai-coach.tsx`

The no-key state at `:341-352` (`title: 'API Key Required'`, button text `Add your Anthropic API key
in Settings`) and the Settings link in `ErrorBubble` at `:777` both push to `/settings/ai`, which after
this phase no longer has a key field. This lands in a dead end for users.

**Issue 1 — Route destination:** Both `:348` (no-key button) and `:777` (ErrorBubble Settings link)
push `/settings/ai`. Change both to push `/settings/ai-provider` so the user lands on the key field.

**Issue 2 — Hardcoded "Anthropic":** The no-key screen at `:346` says `Add your Anthropic API key in
Settings`. After Phase 3, OpenAI users see "Anthropic" and are sent to the Anthropic field, which is
wrong.

**Decision:** Make it generic — `Add your API key in Settings` — so it works for either provider.

**Rationale:**
- The no-key screen's job is to route the user to Settings, where the provider *choice happens*. Naming a provider before that choice is exactly the bug we are fixing.
- Option B (reading `settings.aiProvider ?? 'anthropic'`) reintroduces the defect in the default case: a user with unset `aiProvider` (legacy installs with only `anthropicKey`) would still be told "Anthropic" even if they later chose OpenAI, because the fallback runs before the choice.
- Option B also adds logic (`getSettings()` call and conditional copy) to `ai-coach.tsx`, a file with **zero jest coverage**. Generic copy is correct in every state and requires no new logic in an untestable file.

**Verification:** See Task 6, scenario 1.

**Simulator verification for this task:** Go through the "no-key" flow under an OpenAI selection
(Settings → set `aiProvider` to OpenAI → close → open coach with no key → tap "Open Settings" →
should land on the provider/key screen, not the AI Coach goals screen).

**Covers:** AC4.9 (the only AC directly touched here; the router fix keeps the destination valid)

---

### Task 5 — Structural reads (record all five in the PR)

```
# AC3.1 — no decision logic in the screen
grep -nE "sk-|\.trim\(\)|aiProvider ===|provider ===" "src/app/(tabs)/settings/ai-provider.tsx"
    → expected: EMPTY

# AC3.2 — aiProvider written in exactly one place, none of them an effect
grep -n "aiProvider" "src/app/(tabs)/settings/ai-provider.tsx"
    → expected: only the import line and, indirectly, providerSwitchPlan's call site.
      Read the file and confirm no useEffect / useFocusEffect writes it.

# AC3.3 — the only writer is flush()
grep -n "setSettings" "src/app/(tabs)/settings/ai-provider.tsx"
    → expected: the import, and exactly one call, inside flush().

# AC3.4
grep -n "anthropicKey" "src/app/(tabs)/settings/ai.tsx"
    → expected: EMPTY

# AC3.5
grep -n "href" "src/app/(tabs)/settings/index.tsx"
    → expected: a two-member union and two SECTIONS entries
```

⚠ **AC3.2 cannot be a test, and it is worth knowing why rather than shrugging.** A fixture that
mounted the screen and read `getSettings()` cannot distinguish "wrote nothing" from "wrote exactly the
value `initialProviderSelection` derives" — those are equal by construction, for *every* fixture. Only
an assertion on the storage backend's call count discriminates, and no jest project can mount the
screen to make one. A human step is no better: `expo-secure-store` is not queryable the way SQLite is,
and nothing user-visible differs. The structural read is the only cover. Do not skip it because it
"looks obvious from the code" — that is what it is.

**Covers:** AC3.1 – AC3.5

---

### Task 6 — Simulator verification (seven scenarios)

Read the `running-in-simulator` skill first. Screenshots for each.

| # | AC | Procedure | Why it discriminates |
|---|---|---|---|
| 1 | Task 4 / AC4.9 | **No-key flow with OpenAI selected:** Settings → `aiProvider: 'openai'` → close → open Coach with no key → tap "Open Settings" → land on provider/key screen (not AI Coach goals). | Proves the routed link goes to the correct screen and the user can enter their key. |
| 2 | AC3.6 | **Fresh install.** Pick OpenAI → paste a key → **force-quit** → relaunch → reopen. OpenAI selected, key populated. | The relaunch is what proves persistence rather than in-memory cache. |
| 3 | AC3.7 | With an Anthropic key configured: switch to OpenAI → confirm → **force-quit and relaunch** → switch back to Anthropic. The Anthropic field is **empty**. | ⚠ **The relaunch is the whole criterion.** Without it, "cleared on screen", "cleared in cache" and "cleared in storage" are indistinguishable — and the middle one is exactly the "user believes they removed a key and hasn't" failure. |
| 4 | AC3.8 | With **no** Anthropic key stored, switch to OpenAI. **No dialog appears.** | A step run only with a key present cannot fail. This is the negative half of `needsConfirmation`. |
| 5 | AC3.9 | Type a key, then switch provider **within 500 ms** — before the debounce fires. Wait 5s, force-quit, relaunch. The key is gone. | ⚠ **The timing is the test.** Switching after the debounce has flushed cannot fail: there is no pending patch left to resurrect the key. This is the only check on the `queueSave`-not-`setSettings` requirement. |
| 6 | AC3.10 | An **upgraded** (not fresh) Anthropic-only install: open the new screen. Anthropic pre-selected, key intact, coach still works without touching anything. | ⚠ **Install over the existing app; do not uninstall first.** Uninstalling destroys the legacy blob and turns this into a fresh-install test, which cannot exercise the `aiProvider: undefined` path this criterion is about. |
| 7 | AC3.11 | Tap the picker: exactly two options, current one marked. Dismiss without choosing → nothing changes (key intact, provider unchanged). | The dismiss half catches a modal that commits on open or on backdrop tap. |

⚠ For scenario 5, back up the device/simulator DB and settings first if the install carries real data.

**Covers:** AC3.6 – AC3.11

---

## Traps

1. **A stale `.expo/types/router.d.ts` rejecting `/settings/ai-provider`.** Verified: the main
   checkout's file enumerates only `/settings` and `/settings/ai`. Regenerate before changing code.
   The inverse also holds — a worktree with no generated types type-checks anything, so a clean `tsc`
   there is not evidence.
2. **`setSettings(plan.patch)` in the switch handler.** Looks correct, is immediate, is exactly the
   bug. A pending 500 ms patch holding the key the user just typed fires afterwards and restores it.
   Only AC3.9's fast-path scenario and AC3.3's grep can see it.
3. **Trimming `keyText` in `useState`.** Makes the field behave strangely while typing. Trim only in
   `apiKeyPatch`.
4. **Copying the warning rule or the `sk-ant-` placeholder into the screen.** AC3.1's grep exists for
   this. A second copy in an untestable file is how the tested one drifts.
5. **An unconditional confirmation dialog.** It announces the loss of nothing on a fresh install and
   trains the user to dismiss — at which point the one that matters gets dismissed too. Gate on
   `plan.needsConfirmation`.
6. **Cancel that still switches the picker.** The `Alert`'s cancel branch must leave `provider`,
   `keyText` and settings all untouched.
7. **Deleting `ai.tsx`'s layout comment** because the screen got shorter. It still overflows; the
   comment is still true and was written after a measurement.
8. **Introducing `@expo/ui`.** It is a dependency with zero imports; its first use needs a prebuild
   and its failure mode is a launch crash. Deferred deliberately, not overlooked.
9. **Reading a green `npm test` as evidence.** Nothing here is covered.

---

## Verification

```
npm start                       # ONCE, to regenerate .expo/types/router.d.ts
npx tsc --noEmit                # exit 0 — after the regeneration
npx jest                        # green (unchanged — nothing here is testable)
npm run lint                    # 0 errors; report warnings vs the 52 baseline
```

Plus: the five structural greps pasted into the PR, and six screenshots.

**In the PR description, state plainly:** *"AC3.1–AC3.5 are structural reads; AC3.6–AC3.11 are
simulator scenarios. No automated test covers any file changed in this phase."*
