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
import { Directory, File, Paths } from 'expo-file-system';
import { createAiClient } from '@/ai/provider/factory';
import { EXERCISE_CATALOG } from './exerciseCatalog';
import { EXERCISE_IMAGE_DIR } from './exerciseImageState';
import type { ExerciseImageResolverDeps } from './exerciseImageResolver';
import { getSettings } from './settings';
import { hasAiKey } from './hasAiKey';

export async function downloadExerciseImage(url: string, relativePath: string): Promise<void> {
  // downloadFileAsync does not create parent directories (verified in the
  // iOS implementation), and rejects on non-2xx.
  new Directory(Paths.document, EXERCISE_IMAGE_DIR).create({ intermediates: true, idempotent: true });
  await File.downloadFileAsync(url, new File(Paths.document, relativePath));
}

export async function deleteExerciseImage(relativePath: string): Promise<void> {
  const file = new File(Paths.document, relativePath);
  if (file.exists) file.delete(); // delete() is synchronous and throws on a missing file
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
    download: downloadExerciseImage,
    deleteFile: deleteExerciseImage,
    makeImageSuffix: makeExerciseImageSuffix,
    log: (message, error) => console.warn(message, error),
  };
}
