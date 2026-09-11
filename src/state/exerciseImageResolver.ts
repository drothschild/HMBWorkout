// pattern: Imperative Shell
/**
 * Background exercise-image resolution (#335). Orchestration only: the
 * decisions live in exerciseImageMatch (pure) and exerciseImageState (pure);
 * this module gathers rows, calls them, and persists. Every dep is injected so
 * the whole path runs in the node jest project — the real deps are in
 * exerciseImageFiles.ts, which no test may import (expo-file-system is native).
 *
 * Nothing about a workout waits on this, and nothing here may throw out of
 * the scheduler: every failure is logged and swallowed (AC2.8). A failed row
 * writes nothing, stays eligible, and is retried by the next pass — which can
 * be any `exercises` write; see phase_04.md / AGENTS.md for that accepted cost.
 */
import type { Database } from '@nozbe/watermelondb';
import { buildCatalogPickPrompt, parseCatalogPick } from '@/ai/catalogPickPrompt';
import { IMMUTABLE_DIRECTIVES } from '@/ai/coachDirectives';
import { setExerciseImageIfSourceUnchanged } from '@/db/repository';
import type Exercise from '@/db/models/Exercise';
import { catalogImageUrl, type CatalogEntry } from './exerciseCatalog';
import {
  decideByScore,
  decideFromAiPick,
  type CatalogMatcher,
  type ImageDecision,
} from './exerciseImageMatch';
import {
  buildImageRelativePath,
  catalogImageSource,
  isImageResolutionEligible,
} from './exerciseImageState';

export type ExerciseImageResolverDeps = {
  readonly database: Database;
  readonly catalog: readonly CatalogEntry[];
  /** Read EXACTLY ONCE at the start of every pass. */
  readonly getAiKeyConfigured: () => boolean;
  /** Called only in a pass where getAiKeyConfigured() was true. */
  readonly ask: (request: { system: string; message: string }) => Promise<string>;
  /** Download `url` to `relativePath` under the documents directory. Rejects on failure. */
  readonly download: (url: string, relativePath: string) => Promise<void>;
  readonly deleteFile: (relativePath: string) => Promise<void>;
  readonly makeImageSuffix: () => string;
  readonly log: (message: string, error?: unknown) => void;
};

export type ExerciseImageResolver = {
  /** Queue a pass; coalesces while one is running. Never throws. */
  request(): void;
  /** Unsubscribe the table observer; later requests are ignored. Does not wait for an in-flight pass. */
  stop(): void;
};

async function decide(
  deps: ExerciseImageResolverDeps,
  matcher: CatalogMatcher,
  title: string,
  hasAiKey: boolean
): Promise<ImageDecision> {
  const hits = matcher.shortlist(title);
  if (hits.length === 0) return { kind: 'none' }; // AC1.6: no ask on an empty shortlist
  if (!hasAiKey) return decideByScore(hits, { aiConsulted: false });
  const reply = await deps.ask(
    buildCatalogPickPrompt({ title, candidates: hits.map((hit) => hit.entry), directives: IMMUTABLE_DIRECTIVES })
  ); // a rejection propagates: the row is left untouched and retried (AC2.3)
  return decideFromAiPick(hits, parseCatalogPick(reply, hits.map((hit) => hit.entry.id)));
}

async function resolveOne(
  deps: ExerciseImageResolverDeps,
  matcher: CatalogMatcher,
  exercise: { readonly id: string; readonly title: string; readonly imageSource: string | null },
  hasAiKey: boolean
): Promise<void> {
  const decision = await decide(deps, matcher, exercise.title, hasAiKey);
  let imagePath: string | null = null;
  if (decision.kind === 'catalog') {
    imagePath = buildImageRelativePath(exercise.id, deps.makeImageSuffix());
    await deps.download(catalogImageUrl(decision.entry), imagePath); // rejection → row untouched
  }
  const imageSource = decision.kind === 'catalog' ? catalogImageSource(decision.entry.id) : decision.kind;
  const applied = await setExerciseImageIfSourceUnchanged(deps.database, exercise.id, exercise.imageSource, {
    imagePath,
    imageSource,
  });
  if (!applied && imagePath !== null) {
    // Someone (a pasted URL) decided this row while we were downloading. Their
    // write wins; the file we fetched is now an orphan.
    const orphan = imagePath;
    await deps.deleteFile(orphan).catch((error: unknown) =>
      deps.log(`exercise image: deleting orphan ${orphan} failed`, error)
    );
  }
}

/** One pass over every currently eligible row, sequentially. Never throws per row. */
export async function runImageResolutionPass(
  deps: ExerciseImageResolverDeps,
  matcher: CatalogMatcher
): Promise<void> {
  const hasAiKey = deps.getAiKeyConfigured();
  const rows = (await deps.database.get('exercises').query().fetch()) as Array<Exercise>;
  for (const row of rows) {
    const imageSource = row.imageSource ?? null;
    if (!isImageResolutionEligible({ imageSource }, hasAiKey)) continue;
    try {
      await resolveOne(deps, matcher, { id: row.id, title: row.title, imageSource }, hasAiKey);
    } catch (error) {
      deps.log(`exercise image: resolving ${row.id} failed; will retry on a later pass`, error);
    }
  }
}
