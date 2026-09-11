/**
 * #335 AC5.2: the engine never learns about exercise images.
 *
 * Images are display data, resolved shell-side against the database by
 * `exerciseId` (engine convention 6: engine state carries ids and the plan,
 * never display data). An image field on the Rill `RoutineEntry` or on the
 * engine state would also be silently dropped at the closed-record boundary,
 * so the only correct number of image references in the engine is zero.
 *
 * Regex choice: `/image/i`, the broadest form. None of the four files contains
 * the substring today (checked at authoring time), so the broad form costs
 * nothing and also catches spellings a narrow list would miss (`imageUri`,
 * `heroImage`, …).
 * If an unrelated identifier ever legitimately contains "image", narrow it to
 * `/imagePath|image_path|imageSource|image_source/`.
 *
 * No content-hash pin on the `.lv` files, deliberately. At authoring time the
 * three rule files were identical to `main` (`git diff main --
 * src/engine/rules/` empty; sha256 types.lv d97cb913…, helpers.lv 234a0da1…,
 * transition.lv 0c36cb3e…), which is the "no `.lv` change" evidence for this
 * feature. A pin committed here would outlive the feature and fire on every
 * future, legitimate engine change (#281-style rule work) with a failure that
 * has nothing to do with images, teaching the next author to rubber-stamp a new
 * constant. The regex is what AC5.2 names, and it keeps failing for exactly the
 * one reason this file exists.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const ENGINE = __dirname;

const FILES: { readonly path: string; readonly anchor: RegExp }[] = [
  { path: join(ENGINE, 'rules', 'types.lv'), anchor: /alias RoutineEntry\s*=/ },
  { path: join(ENGINE, 'rules', 'helpers.lv'), anchor: /let group_end_idx\s*=/ },
  { path: join(ENGINE, 'rules', 'transition.lv'), anchor: /let advance_after_set\s*=/ },
  { path: join(ENGINE, 'types.ts'), anchor: /export interface RoutineEntry\s*\{/ },
];

function read(path: string, anchor: RegExp): string {
  const source = readFileSync(path, 'utf8');
  if (!anchor.test(source)) {
    throw new Error(`${path} no longer matches ${anchor}; re-anchor this gate`);
  }
  return source;
}

describe('the engine carries no exercise-image field (#335 AC5.2)', () => {
  it.each(FILES.map((f) => [f.path.slice(ENGINE.length + 1), f] as const))(
    '%s mentions no image',
    (_name, file) => {
      const source = read(file.path, file.anchor);
      const hits = source.split('\n').filter((line) => /image/i.test(line));
      expect(hits).toStrictEqual([]);
    }
  );
});
