// pattern: Imperative Shell
/**
 * Real I/O for exercise images (#335): expo-file-system and the AI client.
 * NO TEST MAY IMPORT THIS FILE — this jest project is plain ts-jest in node,
 * and expo-file-system requires its native module at import time. Everything
 * testable takes these as injected deps instead.
 *
 * Known edge: `getAiKeyConfigured` uses the canonical `hasAiKey`, while
 * `createAiClient` additionally needs a resolvable provider. With BOTH keys set
 * and no `aiProvider`, hasAiKey is true but every `ask` throws, so rows stay
 * null and retry. The one-key-per-install invariant (switching provider clears
 * the outgoing key — AGENTS.md "One key per install") makes that state
 * unreachable through the UI; it is documented rather than special-cased.
 */
import type { Database } from '@nozbe/watermelondb';
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import { createAiClient } from '@/ai/provider/factory';
import { EXERCISE_CATALOG } from './exerciseCatalog';
import { EXERCISE_IMAGE_DIR } from './exerciseImageState';
import type { ExerciseImageResolverDeps } from './exerciseImageResolver';
import { IMAGE_SIGNATURE_BYTES, looksLikeImageBytes, NotAnImageError } from './imageSignature';
import { getSettings } from './settings';
import { searchExerciseWebImages } from './exerciseWebImages';
import { hasAiKey } from './hasAiKey';

/**
 * Downloads `url` to `relativePath` and rejects unless the result is an image.
 *
 * `downloadFileAsync` rejects on non-2xx but never looks at the content type
 * (iOS FileSystemDownload.swift checks the status only), so a pasted page URL
 * succeeds with HTML. The magic-number check turns that into a rejection —
 * the override's `download-failed`, the resolver's untouched-and-retried row —
 * with the downloaded file deleted, so nothing ever points at it. Guarded
 * structurally by exerciseImageDownloadGuard.static.test.ts.
 */
export async function downloadExerciseImage(url: string, relativePath: string): Promise<void> {
  // downloadFileAsync does not create parent directories (verified in the
  // iOS implementation).
  new Directory(Paths.document, EXERCISE_IMAGE_DIR).create({ intermediates: true, idempotent: true });
  const destination = new File(Paths.document, relativePath);
  await File.downloadFileAsync(url, destination);
  let header: Uint8Array;
  try {
    header = readImageHeader(destination);
  } catch (error) {
    discardDownloadedFile(destination);
    throw error;
  }
  if (!looksLikeImageBytes(header)) {
    discardDownloadedFile(destination);
    throw new NotAnImageError(url);
  }
}

/** The first IMAGE_SIGNATURE_BYTES bytes, or fewer if the file is shorter (iOS `read(upToCount:)`). */
function readImageHeader(file: File): Uint8Array {
  const handle = file.open(FileMode.ReadOnly);
  try {
    return handle.readBytes(IMAGE_SIGNATURE_BYTES);
  } finally {
    handle.close();
  }
}

/** Best effort: the row never pointed at this file, and the caller's error is the one that matters. */
function discardDownloadedFile(destination: File): void {
  try {
    destination.delete();
  } catch {
    // An orphan in exercise-images/ is harmless; masking the rejection is not.
  }
}

export async function deleteExerciseImage(relativePath: string): Promise<void> {
  const file = new File(Paths.document, relativePath);
  if (file.exists) file.delete(); // delete() is synchronous and throws on a missing file
}

/** Copies a picker result from its temporary URI into app-owned exercise storage. */
export async function copyExerciseImage(uri: string, relativePath: string): Promise<void> {
  new Directory(Paths.document, EXERCISE_IMAGE_DIR).create({ intermediates: true, idempotent: true });
  const source = new File(uri);
  const destination = new File(Paths.document, relativePath);
  try {
    await source.copy(destination);
  } catch (error) {
    discardDownloadedFile(destination);
    throw error;
  }
}

export function makeExerciseImageSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

export function createExerciseImageResolverDeps(database: Database): ExerciseImageResolverDeps {
  return {
    database,
    catalog: EXERCISE_CATALOG,
    getAiKeyConfigured: () => hasAiKey(getSettings()),
    // Built per call, from settings at that moment: a key saved after boot is
    // used by the next pass with no restart.
    ask: (request) => createAiClient(getSettings()).ask(request),
    searchWebImages: searchExerciseWebImages,
    download: downloadExerciseImage,
    deleteFile: deleteExerciseImage,
    makeImageSuffix: makeExerciseImageSuffix,
    log: (message, error) => console.warn(message, error),
  };
}
