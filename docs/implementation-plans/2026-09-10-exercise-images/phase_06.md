# Exercise Images Implementation Plan — Phase 6: Paste-URL override

**Goal:** Let the user replace a wrong (or missing) image from the exercise detail screen by pasting an `http(s)` image URL.

**Architecture:** A pure `parseImageUrl` gate plus an injected-deps shell function `overrideExerciseImage` that downloads to a **new** file, writes the row unconditionally (the user's choice wins), and only then deletes the previous file. Its outcome is worded by a pure copy function the screen renders — the same presenter pattern as `exportOutcome` / `routineImportOutcome` in `src/app/(tabs)/settings/data.tsx`.

**Tech Stack:** TypeScript, WatermelonDB, expo-file-system 57 (via Phase 4's real deps), React Native `TextInput`.

**Scope:** Phase 6 of 7 from `docs/design-plans/2026-09-10-exercise-images.md`. Depends on Phase 5.

**Codebase verified:** 2026-09-10

---

## Context the executor needs

- Phase 4 already provides everything I/O-shaped this phase needs: `setExerciseImage(database, exerciseId, next)` in `src/db/repository.ts` (unconditional write, **returns the previous `image_path`**), `buildImageRelativePath` + `urlImageSource` in `src/state/exerciseImageState.ts`, and the real `downloadExerciseImage` / `deleteExerciseImage` / `makeExerciseImageSuffix` in `src/state/exerciseImageFiles.ts` (never imported by tests).
- The resolver's compare-and-set (Phase 4) is what keeps a pass that finishes *after* this write from overwriting it (AC4.5, already tested). This phase's write is deliberately **not** CAS: it is the user's explicit choice.
- **URL parsing uses a regex, not `new URL()`.** React Native's `URL` has historically thrown "not implemented" on property getters such as `protocol`; the scheme check is the whole requirement and a fixed anchored regex (no nested quantifiers — no ReDoS) is reliable on every runtime.
- `src/app/exercise/[id].tsx` after Phase 5 holds `imagePath` state kept live by `exercise.observe()`, and renders the hero under the title. The screen's existing input styles (`styles.input`, `textInputColor`, `placeholderColor`, `theme.backgroundSelected` border) and its error style (`styles.errorMessage`, `StatusColor.danger`) are the ones to reuse.

## Acceptance Criteria Coverage

### exercise-images.AC4: Identity and manual override
- **exercise-images.AC4.2 Success:** Pasting an `http(s)` URL downloads it to a new file, writes `image_source = url:<url>` and the new `image_path`, then deletes the previous file — deletion strictly after the row write.
- **exercise-images.AC4.3 Failure:** `parseImageUrl` rejects anything but `http:`/`https:` (`file:`, `data:`, `javascript:`, bare text); nothing is downloaded.
- **exercise-images.AC4.4 Failure:** When the override download fails, the user sees an error, and the row and the previous file are untouched.

---

<!-- START_SUBCOMPONENT_A (tasks 1-1) -->

<!-- START_TASK_1 -->
### Task 1: `parseImageUrl`, `overrideExerciseImage`, outcome copy

**Verifies:** exercise-images.AC4.2, exercise-images.AC4.3, exercise-images.AC4.4

**Files:**
- Create: `src/state/exerciseImageOverride.ts`
- Test: `src/state/exerciseImageOverride.test.ts` (unit for the pure parts; integration with LokiJS for the override)

**Implementation:**

```ts
// pattern: Imperative Shell
/**
 * The paste-an-image-URL override on the exercise detail screen (#335).
 *
 * Order is load-bearing: download to a NEW file → write the row → delete the
 * previous file. A failed download changes nothing (AC4.4); the old file is
 * deleted only once the row no longer points at it (AC4.2), so a render that
 * reads the row mid-override never sees a path to a deleted file.
 *
 * This write is unconditional — it is the user's explicit choice. The
 * resolver's compare-and-set is what stops a background pass that finishes
 * later from overwriting it (AC4.5).
 */
import type { Database } from '@nozbe/watermelondb';
import { setExerciseImage } from '@/db/repository';
import { buildImageRelativePath, urlImageSource } from './exerciseImageState';

// Anchored, no nested quantifiers. Scheme http/https, then at least one
// non-space character. Everything else — file:, data:, javascript:, bare text,
// protocol-relative '//x' — is rejected.
const HTTP_URL = /^https?:\/\/\S+$/i;

export type ParsedImageUrl = { readonly kind: 'ok'; readonly url: string } | { readonly kind: 'invalid' };

export function parseImageUrl(raw: string): ParsedImageUrl {
  const trimmed = raw.trim();
  return HTTP_URL.test(trimmed) ? { kind: 'ok', url: trimmed } : { kind: 'invalid' };
}

export type ExerciseImageOverrideDeps = {
  readonly database: Database;
  readonly download: (url: string, relativePath: string) => Promise<void>;
  readonly deleteFile: (relativePath: string) => Promise<void>;
  readonly makeImageSuffix: () => string;
  readonly log: (message: string, error?: unknown) => void;
};

export type ExerciseImageOverrideOutcome =
  | { readonly kind: 'saved'; readonly imagePath: string }
  | { readonly kind: 'invalid-url' }
  | { readonly kind: 'download-failed' };

export async function overrideExerciseImage(
  deps: ExerciseImageOverrideDeps,
  exerciseId: string,
  rawUrl: string
): Promise<ExerciseImageOverrideOutcome> {
  const parsed = parseImageUrl(rawUrl);
  if (parsed.kind === 'invalid') return { kind: 'invalid-url' };

  const imagePath = buildImageRelativePath(exerciseId, deps.makeImageSuffix());
  try {
    await deps.download(parsed.url, imagePath);
  } catch (error) {
    deps.log(`exercise image override: download failed for ${exerciseId}`, error);
    return { kind: 'download-failed' };
  }

  const previous = await setExerciseImage(deps.database, exerciseId, {
    imagePath,
    imageSource: urlImageSource(parsed.url),
  });
  if (previous !== null && previous !== imagePath) {
    await deps.deleteFile(previous).catch((error: unknown) =>
      deps.log(`exercise image override: deleting previous ${previous} failed`, error)
    );
  }
  return { kind: 'saved', imagePath };
}

// pattern note: the copy function below is pure; it lives here beside the
// outcome type it words, as exportOutcome/routineImportOutcome do.
export function exerciseImageOverrideMessage(outcome: ExerciseImageOverrideOutcome): string {
  switch (outcome.kind) {
    case 'saved':
      return 'Image updated.';
    case 'invalid-url':
      return 'Enter an image URL that starts with http:// or https://.';
    case 'download-failed':
      // parseImageUrl accepts http: (AC4.3), but iOS App Transport Security
      // blocks cleartext downloads, so a plain http:// link lands here too —
      // name https explicitly rather than a misleading "check the URL".
      return "Couldn't download that image. Use a direct https:// link to the image file.";
  }
}
```

If `setExerciseImage` rejects (e.g. the exercise was deleted), the error propagates to the screen, which reports it as a failure — see Task 2. Do not swallow it here: unlike a background pass, the user is waiting on this result.

**Testing** (`describe('exercise image override — #335')`):
- **AC4.3** (`parseImageUrl`, `it.each`): accepted — `'https://example.com/a.jpg'`, `'http://example.com/a'`, `'  https://x.y/z.png  '` (trimmed, returned trimmed), `'HTTPS://EXAMPLE.COM/A.JPG'`. Rejected — `'file:///var/mobile/a.jpg'`, `'data:image/png;base64,AAAA'`, `'javascript:alert(1)'`, `'example.com/a.jpg'`, `'just some text'`, `''`, `'https://'`, `'https:// spaced.com/a.jpg'`, `'//example.com/a.jpg'`.
- **AC4.3** through the override: `overrideExerciseImage(deps, id, 'javascript:alert(1)')` → `{ kind: 'invalid-url' }`, `download` never called, row unchanged.
- **AC4.2** (real LokiJS database; seed an exercise already holding `image_path = 'exercise-images/old-a.jpg'`, `image_source = 'catalog:X'` via `setExerciseImage`): with `makeImageSuffix` → `'n1'`, `download` resolving, and a `deleteFile` fake that **reads the row when it is called** (`await db.get('exercises').find(id)`) and records `{ path, rowPathAtDeleteTime }`: outcome is `{ kind: 'saved', imagePath: 'exercise-images/<id>-n1.jpg' }`; the row holds that path and `image_source === 'url:https://example.com/p.jpg'`; `download` got `('https://example.com/p.jpg', 'exercise-images/<id>-n1.jpg')`; `deleteFile` was called exactly once with `'exercise-images/old-a.jpg'`, and at that moment the row already pointed at the new path (**deletion strictly after the row write**). The new path differs from the old (a new file, never an overwrite).
- AC4.2 edge: an exercise with no previous image → saved, `deleteFile` never called.
- **AC4.4**: `download` rejects → `{ kind: 'download-failed' }`; the row still holds `exercise-images/old-a.jpg` / `catalog:X`; `deleteFile` never called; `log` recorded the failure.
- A `deleteFile` failure after a successful write still returns `saved` (logged, not thrown).
- `exerciseImageOverrideMessage` returns the three strings above (pin them — the screen shows exactly these).

**Verification:**
Run: `npx jest src/state/exerciseImageOverride.test.ts`
Expected: all pass.

**Commit:** `feat(#335): paste-URL image override with safe file replacement`
<!-- END_TASK_1 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_2 -->
### Task 2: URL field on the exercise detail screen

**Verifies:** exercise-images.AC4.4 (the user sees the error) — screen wiring, checked structurally + manually.

**Files:**
- Modify: `src/app/exercise/[id].tsx` — a form group under the hero, before the Description group
- Modify: `src/state/exerciseImageWiring.static.test.ts` (from Phase 5) — add the override wiring assertions

**Implementation:**
- Imports: `overrideExerciseImage`, `exerciseImageOverrideMessage` from `@/state/exerciseImageOverride`; `downloadExerciseImage`, `deleteExerciseImage`, `makeExerciseImageSuffix` from `@/state/exerciseImageFiles`.
- State — placed beside the screen's existing `useState`s at the top of the component, **above the early returns at `:94` (`if (!id || loading)`) and `:104` (`if (!exercise)`)**; a hook after an early return crashes the screen with "Rendered more hooks than during the previous render", and no test can render this screen: `const [imageUrl, setImageUrl] = useState('');`, `const [imageMessage, setImageMessage] = useState<{ text: string; isError: boolean } | null>(null);`, `const [savingImage, setSavingImage] = useState(false);`. The `applyImageUrl` handler below is a plain function (not a hook) and can sit anywhere before the JSX.
- Handler:
  ```tsx
  const applyImageUrl = async () => {
    if (!id || savingImage) return;
    setSavingImage(true);
    try {
      const outcome = await overrideExerciseImage(
        {
          database,
          download: downloadExerciseImage,
          deleteFile: deleteExerciseImage,
          makeImageSuffix: makeExerciseImageSuffix,
          log: (message, error) => console.warn(message, error),
        },
        id,
        imageUrl
      );
      setImageMessage({ text: exerciseImageOverrideMessage(outcome), isError: outcome.kind !== 'saved' });
      if (outcome.kind === 'saved') setImageUrl('');
    } catch (error) {
      console.error('Failed to save exercise image:', error);
      setImageMessage({ text: "Couldn't save that image. Try again.", isError: true });
    } finally {
      setSavingImage(false);
    }
  };
  ```
  (The hero updates by itself: Phase 5's `exercise.observe()` effect picks up the row write.)
- JSX, a `ThemedView style={styles.formGroup}` placed after the hero and before the Description group: a label "Image URL", a single-line `TextInput` reusing `styles.input` with `value={imageUrl}`, `onChangeText={setImageUrl}`, `placeholder="https://… (paste an image link to replace the picture)"`, `autoCapitalize="none"`, `autoCorrect={false}`, `keyboardType="url"`, `returnKeyType="done"`, `onSubmitEditing={applyImageUrl}`; a `Pressable` "Use this image" (disabled while `savingImage` or `imageUrl.trim() === ''`; follow the screen's existing button styling, e.g. the back button's `pressed` pattern, and an `ActionButtonColor` fill if other primary buttons use one); then `{imageMessage && <ThemedText type="small" style={imageMessage.isError ? styles.errorMessage : styles.caption}>{imageMessage.text}</ThemedText>}`.
- `keyboardShouldPersistTaps="handled"` is already on the `ScrollView`, so the button is tappable with the keyboard up.

**Testing** — extend `exerciseImageWiring.static.test.ts`:
- `exercise/[id].tsx` contains `overrideExerciseImage(`, `exerciseImageOverrideMessage(`, and passes `deleteFile: deleteExerciseImage` (whitespace-normalized) — so the screen cannot silently drop the delete-after-write path or render a hand-written message.
- **Hook placement**: extend Phase 5's before-the-early-return guard to the three new hooks. In the whitespace-stripped source, each of `const[imageUrl,setImageUrl]=useState`, `const[imageMessage,setImageMessage]=useState`, and `const[savingImage,setSavingImage]=useState` occurs exactly once and before the index of `if(!id||loading)`. Anchor on each hook's own declaration, never on a generic `useState(` fragment an existing hook already satisfies. Confirm once by moving one of them below the early return and watching the guard fail.

**Verification:**
- Run: `npx jest src/state/exerciseImageWiring.static.test.ts` — all pass.
- Run: `npx tsc --noEmit` and `npm run lint` — no new errors.
- Simulator (use the `running-in-simulator` skill): on an exercise detail screen, paste a working `https://` JPEG URL → hero changes, message "Image updated."; confirm in SQLite that `image_source` starts with `url:` and the old file is gone from `Documents/exercise-images/`. Paste `https://example.invalid/nope.jpg` → the error message shows, the hero and row are unchanged. Paste `file:///etc/hosts` → the invalid-URL message, nothing downloaded.

**Commit:** `feat(#335): paste an image URL on the exercise detail screen`
<!-- END_TASK_2 -->
