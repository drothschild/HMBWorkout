// pattern: Functional Core
/**
 * The vocabulary of `exercises.image_source` and the one rule that decides
 * whether a resolver pass (re)resolves a row (#335). This predicate alone
 * drives the first-launch backfill, the first-view retry, and the
 * key-added retry — there is no separate mechanism for any of them.
 */

export type ImageSource = `catalog:${string}` | `url:${string}` | 'none' | 'none:nokey';

/** No acceptable match. Final: never re-resolved by a pass. */
export const IMAGE_SOURCE_NONE = 'none';

/** The no-key name match missed the threshold. Re-resolved once an AI key exists. */
export const IMAGE_SOURCE_NONE_NOKEY = 'none:nokey';

export function catalogImageSource(catalogId: string): ImageSource {
  return `catalog:${catalogId}`;
}

export function urlImageSource(url: string): ImageSource {
  return `url:${url}`;
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
