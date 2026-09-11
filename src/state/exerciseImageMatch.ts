// pattern: Functional Core
/**
 * Title → catalog decision for exercise images (#335). No I/O.
 *
 * Tuning was measured, not guessed: fuse.js 7.5.0 token search with fuse
 * threshold 0.5 gives the recall AC1.7 names, and a no-key acceptance score of
 * 0.15 sits in the gap between every accepted match (≤ 0.046) and every
 * rejected one (≥ 0.252) on the pinned catalog. TF-IDF scores are
 * corpus-relative, so exerciseImageMatch.test.ts pins that margin table — a
 * catalog rebuild that moves it must fail there, not ship.
 */
import Fuse from 'fuse.js';
import type { CatalogEntry } from './exerciseCatalog';
import type { CatalogPick } from '@/ai/catalogPickPrompt';

export const SHORTLIST_SIZE = 8;
/** fuse score: 0 = perfect, 1 = total mismatch. A hit "clears" when score <= this. */
export const NO_KEY_ACCEPT_SCORE = 0.15;

const ABBREVIATIONS: Readonly<Record<string, string>> = {
  db: 'dumbbell',
  dbs: 'dumbbell',
  bb: 'barbell',
  kb: 'kettlebell',
  kbs: 'kettlebell',
};

export type ShortlistHit = { readonly entry: CatalogEntry; readonly score: number };

export type CatalogMatcher = {
  /** Up to SHORTLIST_SIZE hits, best first. Empty when nothing is close enough. */
  shortlist(title: string): readonly ShortlistHit[];
};

export type ImageDecision =
  | { readonly kind: 'catalog'; readonly entry: CatalogEntry }
  | { readonly kind: 'none' }
  | { readonly kind: 'none:nokey' };

/** Lowercase, drop apostrophes, punctuation → spaces (hyphens kept), expand DB/BB/KB. */
export function normalizeExerciseTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .map((word) => ABBREVIATIONS[word] ?? word)
    .join(' ');
}

export function createCatalogMatcher(catalog: readonly CatalogEntry[]): CatalogMatcher {
  const fuse = new Fuse([...catalog], {
    keys: [
      {
        name: 'name',
        getFn: (entry: CatalogEntry) => normalizeExerciseTitle(entry.name),
      },
    ],
    includeScore: true,
    ignoreLocation: true,
    threshold: 0.5,
    useTokenSearch: true,
  });
  return {
    shortlist(title: string): readonly ShortlistHit[] {
      const query = normalizeExerciseTitle(title);
      if (query.length === 0) return [];
      return fuse
        .search(query, { limit: SHORTLIST_SIZE })
        .map((result) => ({ entry: result.item, score: result.score ?? 1 }));
    },
  };
}

/**
 * The score rule. With no key it is the whole decision (AC1.4, AC1.5). With a
 * key it is the fallback for an untrusted AI reply (AC1.3) — and then a miss
 * is the TERMINAL 'none', never 'none:nokey': a key exists, so 'none:nokey'
 * would be eligible again at once and the resolver's own write would re-run
 * the pass forever (see phase_03.md, "Design deviation").
 */
export function decideByScore(
  hits: readonly ShortlistHit[],
  options: { readonly aiConsulted: boolean }
): ImageDecision {
  const top = hits[0];
  if (top === undefined) return { kind: 'none' };
  if (top.score <= NO_KEY_ACCEPT_SCORE) return { kind: 'catalog', entry: top.entry };
  return options.aiConsulted ? { kind: 'none' } : { kind: 'none:nokey' };
}

/**
 * AC1.1/AC1.2 when the model is trusted; AC1.3's fallback when it is not.
 * `pick` must have been parsed against these same hits' ids.
 */
export function decideFromAiPick(
  hits: readonly ShortlistHit[],
  pick: CatalogPick
): ImageDecision {
  if (pick.kind === 'none') return { kind: 'none' };
  if (pick.kind === 'id') {
    const hit = hits.find((candidate) => candidate.entry.id === pick.id);
    if (hit !== undefined) return { kind: 'catalog', entry: hit.entry };
  }
  return decideByScore(hits, { aiConsulted: true });
}
