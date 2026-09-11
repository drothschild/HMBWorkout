// pattern: Imperative Shell
/**
 * The paste-an-image-URL override on the exercise detail screen (#335).
 *
 * Order is load-bearing: download to a NEW file → write the row → delete the
 * previous file. A failed download changes nothing (AC4.4); the old file is
 * deleted only once the row no longer points at it (AC4.2), so a render that
 * reads the row mid-override never sees a path to a deleted file. A failed row
 * write deletes the NEW file (nothing points at it) and rethrows; the previous
 * file is never touched on that path.
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

  // A rejection here (e.g. the exercise was deleted) propagates: unlike a
  // background pass, the user is waiting on this result and the screen reports it.
  // The row never pointed at the file just downloaded, so it is deleted
  // best-effort first; a cleanup failure is logged and never replaces the
  // original error.
  let previous: string | null;
  try {
    previous = await setExerciseImage(deps.database, exerciseId, {
      imagePath,
      imageSource: urlImageSource(parsed.url),
    });
  } catch (error) {
    await deps.deleteFile(imagePath).catch((deleteError: unknown) =>
      deps.log(
        `exercise image override: row write failed for ${exerciseId}; deleting downloaded ${imagePath} failed`,
        deleteError
      )
    );
    throw error;
  }
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
