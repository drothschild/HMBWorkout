/**
 * Static gate on `downloadExerciseImage`'s content check (#335).
 *
 * `File.downloadFileAsync` checks only the HTTP status (iOS
 * FileSystemDownload.swift accepts any 2xx), never the content type. Without
 * this check, a pasted page URL downloads HTML as `<id>-<suffix>.jpg`, the
 * override writes it to the row and deletes the previous, working image.
 *
 * `exerciseImageFiles.ts` holds the real expo-file-system deps and NO test may
 * import it (see exerciseImageResolverWiring.static.test.ts), so its behaviour
 * cannot be exercised here — only its shape. This gate reads it as text and
 * pins, by identifier: download → read the header of the downloaded file →
 * `if (!looksLikeImageBytes(header))` → discard the file → throw
 * `NotAnImageError`. `looksLikeImageBytes` itself is tested behaviourally in
 * imageSignature.test.ts; the override's handling of the rejection in
 * exerciseImageOverride.test.ts.
 *
 * The negative controls at the bottom apply each mutation to an in-memory copy
 * and require the gate to reject it, so a gate that silently stopped matching
 * anything fails too. On a missing anchor: re-anchor this gate against the new
 * source rather than deleting the check.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const FILES = join(__dirname, 'exerciseImageFiles.ts');

/** Comments and ALL whitespace removed, so formatting cannot move a match. Idempotent. */
const strip = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/\s+/g, '');

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

/** The brace-matched `{ ... }` block opening at the first `{` at or after `from`. */
function blockFrom(text: string, from: number): string | null {
  const open = text.indexOf('{', from);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(open, i + 1);
  }
  return null;
}

function bodyOf(text: string, header: string): string | null {
  const at = text.indexOf(header);
  return at === -1 ? null : blockFrom(text, at);
}

const DOWNLOAD_HEADER = 'exportasyncfunctiondownloadExerciseImage(';
const CHECK = 'if(!looksLikeImageBytes(header))';
const DISCARD = 'discardDownloadedFile(destination);';
const THROW = 'thrownewNotAnImageError(url);';

/** Every way the source falls short of the guard. Empty means the guard is intact. */
function guardViolations(source: string): string[] {
  const text = strip(source);
  const violations: string[] = [];

  const body = bodyOf(text, DOWNLOAD_HEADER);
  if (body === null) return [`re-anchor this gate: ${DOWNLOAD_HEADER} not found`];

  const downloadAt = body.indexOf('awaitFile.downloadFileAsync(url,destination)');
  const readAt = body.indexOf('header=readImageHeader(destination)');
  const checkAt = body.indexOf(CHECK);
  if (downloadAt === -1) violations.push('downloadExerciseImage must download into `destination`');
  if (readAt === -1) violations.push('downloadExerciseImage must read the header of the downloaded file');
  if (checkAt === -1) {
    violations.push('downloadExerciseImage must call looksLikeImageBytes on the header');
  } else {
    if (count(body, 'looksLikeImageBytes(') !== 1) violations.push('looksLikeImageBytes must be called exactly once');
    if (!(downloadAt < readAt && readAt < checkAt)) violations.push('order must be download → read header → check');
    const block = blockFrom(body, checkAt);
    const discardAt = block?.indexOf(DISCARD) ?? -1;
    const throwAt = block?.indexOf(THROW) ?? -1;
    if (discardAt === -1) violations.push('a non-image must delete the downloaded file');
    if (throwAt === -1) violations.push('a non-image must throw NotAnImageError');
    if (discardAt !== -1 && throwAt !== -1 && discardAt > throwAt) violations.push('delete must precede the throw');
  }

  const reader = bodyOf(text, 'functionreadImageHeader(');
  if (reader === null || !reader.includes('.readBytes(IMAGE_SIGNATURE_BYTES)')) {
    violations.push('readImageHeader must read IMAGE_SIGNATURE_BYTES bytes');
  }
  const discard = bodyOf(text, 'functiondiscardDownloadedFile(');
  if (discard === null || !discard.includes('.delete()')) {
    violations.push('discardDownloadedFile must delete the file');
  }
  return violations;
}

describe('downloadExerciseImage rejects non-image bytes (#335)', () => {
  const source = () => readFileSync(FILES, 'utf8');

  it('downloads, checks the header with looksLikeImageBytes, and deletes + throws on a non-image', () => {
    expect(guardViolations(source())).toStrictEqual([]);
  });

  it('imports the checker and the error from the pure module', () => {
    expect(strip(source())).toMatch(
      /import\{(?=[^}]*\blooksLikeImageBytes\b)(?=[^}]*\bNotAnImageError\b)(?=[^}]*\bIMAGE_SIGNATURE_BYTES\b)[^}]*\}from'\.\/imageSignature';/
    );
  });

  describe('negative controls: the gate rejects each mutant of an in-memory copy', () => {
    const mutate = (from: string, to: string): string => {
      const text = strip(source());
      // A mutant whose anchor misses is indistinguishable from a real gap.
      if (count(text, from) !== 1) throw new Error(`re-anchor this gate: mutant anchor ${from} is not unique`);
      return text.replace(from, to);
    };

    it.each([
      ['the looksLikeImageBytes call removed', CHECK, 'if(false)'],
      ['the delete-on-failure removed', `${CHECK}{${DISCARD}`, `${CHECK}{`],
      ['the throw removed', THROW, ''],
      ['the download call removed', 'awaitFile.downloadFileAsync(url,destination);', ''],
      ['discardDownloadedFile no longer deleting', 'destination.delete();', ''],
    ])('%s', (_name, from, to) => {
      expect(guardViolations(mutate(from, to))).not.toStrictEqual([]);
    });
  });
});
