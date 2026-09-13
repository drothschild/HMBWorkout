// pattern: Functional Core
/**
 * The vocabulary of `exercises.image_source` and the one rule that decides
 * whether a resolver pass (re)resolves a row (#335). This predicate alone
 * drives the first-launch backfill, the first-view retry, and the
 * key-added retry — there is no separate mechanism for any of them.
 */

/** Directory under Paths.document that holds every downloaded exercise image. */
export const EXERCISE_IMAGE_DIR = 'exercise-images';

/** A bundled original catalog image, addressed by upstream catalog id rather than Documents path. */
export const BUNDLED_CATALOG_IMAGE_PREFIX = 'bundle:' as const;

export type ImageSource = `catalog:${string}` | `url:${string}` | `web:${string}` | 'none' | 'none:nokey';

/** No acceptable match. Final: never re-resolved by a pass. */
export const IMAGE_SOURCE_NONE = 'none';

/** The no-key name match missed the threshold. Re-resolved once an AI key exists. */
export const IMAGE_SOURCE_NONE_NOKEY = 'none:nokey';

export function catalogImageSource(catalogId: string): ImageSource {
  return `catalog:${catalogId}`;
}

export function bundledCatalogImagePath(catalogId: string): string {
  return `${BUNDLED_CATALOG_IMAGE_PREFIX}${catalogId}`;
}

export function isBundledCatalogImagePath(imagePath: string): boolean {
  return imagePath.startsWith(BUNDLED_CATALOG_IMAGE_PREFIX);
}

export function urlImageSource(url: string): ImageSource {
  return `url:${url}`;
}

/**
 * `exercise-images/<exerciseId>-<suffix>.jpg` — RELATIVE to the documents
 * directory, because iOS moves the app container on reinstall/restore and an
 * absolute `file://` path would go stale. The suffix makes every download a
 * NEW file, so an override never overwrites a file a render may be reading.
 * Any character outside [a-z0-9-] in the id (ids are slugs today) is replaced,
 * so the result can never contain '/' past the directory or start with one.
 */
export function buildImageRelativePath(exerciseId: string, suffix: string): string {
  const safe = (value: string) => value.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  return `${EXERCISE_IMAGE_DIR}/${safe(exerciseId)}-${safe(suffix)}.jpg`;
}

/**
 * True when a pass should (re)resolve this row: `image_source` is null (never
 * decided, or every earlier attempt failed transiently and wrote nothing), or
 * it is `none:nokey` and an AI key is configured NOW. `none`, `catalog:…` and
 * `url:…` are terminal. An unrecognised value is left alone rather than
 * overwritten — the resolver never destroys data it does not understand.
 *
 * Takes the raw column value (`string | null`), because that is what a row
 * carries; the design's `imagePath` field is not needed by the rule.
 */
export function isImageResolutionEligible(
  row: { readonly imageSource: string | null },
  hasAiKey: boolean
): boolean {
  if (row.imageSource === null) return true;
  return row.imageSource === IMAGE_SOURCE_NONE_NOKEY && hasAiKey;
}
