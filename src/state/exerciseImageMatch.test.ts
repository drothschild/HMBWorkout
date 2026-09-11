import {
  SHORTLIST_SIZE,
  NO_KEY_ACCEPT_SCORE,
  normalizeExerciseTitle,
  createCatalogMatcher,
  decideByScore,
  decideFromAiPick,
  type CatalogMatcher,
} from './exerciseImageMatch';
import { EXERCISE_CATALOG } from './exerciseCatalog';

describe('exercise image matching — #335', () => {
  let matcher: CatalogMatcher;

  beforeAll(() => {
    matcher = createCatalogMatcher(EXERCISE_CATALOG);
  });

  describe('normalizeExerciseTitle', () => {
    it("converts 'Farmer's Carry' to 'farmers carry'", () => {
      expect(normalizeExerciseTitle("Farmer's Carry")).toBe('farmers carry');
    });

    it("converts 'DB Bench Press' to 'dumbbell bench press'", () => {
      expect(normalizeExerciseTitle('DB Bench Press')).toBe(
        'dumbbell bench press'
      );
    });

    it("converts 'BB Row' to 'barbell row'", () => {
      expect(normalizeExerciseTitle('BB Row')).toBe('barbell row');
    });

    it("converts '  Pull-Up  ' to 'pull-up' (trims and preserves hyphens)", () => {
      expect(normalizeExerciseTitle('  Pull-Up  ')).toBe('pull-up');
    });

    it("converts '90/90 Hip Stretch' to '90 90 hip stretch'", () => {
      expect(normalizeExerciseTitle('90/90 Hip Stretch')).toBe(
        '90 90 hip stretch'
      );
    });

    it("converts empty string to empty string", () => {
      expect(normalizeExerciseTitle('')).toBe('');
    });

    it('expands KB abbreviation', () => {
      expect(normalizeExerciseTitle('KB Swing')).toBe('kettlebell swing');
    });

    it('expands DBS abbreviation', () => {
      expect(normalizeExerciseTitle('DBS Bench Press')).toBe(
        'dumbbell bench press'
      );
    });

    it('expands KBS abbreviation', () => {
      expect(normalizeExerciseTitle('KBS Squat')).toBe('kettlebell squat');
    });

    it('drops all punctuation except hyphens', () => {
      expect(normalizeExerciseTitle("Farmer's Carry")).not.toContain("'");
      expect(normalizeExerciseTitle('A-B-C')).toContain('-');
    });
  });

  describe('createCatalogMatcher.shortlist', () => {
    it('AC1.7: Romanian Deadlift has Romanian_Deadlift as first result', () => {
      const hits = matcher.shortlist('Romanian Deadlift');
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].entry.id).toBe('Romanian_Deadlift');
    });

    it('AC1.7: Back Squat shortlist contains Barbell_Squat', () => {
      const hits = matcher.shortlist('Back Squat');
      expect(hits.length).toBeGreaterThan(0);
      const ids = hits.map((h) => h.entry.id);
      expect(ids).toContain('Barbell_Squat');
    });

    it("AC1.7: Farmer's Carry shortlist contains Farmers_Walk", () => {
      const hits = matcher.shortlist("Farmer's Carry");
      expect(hits.length).toBeGreaterThan(0);
      const ids = hits.map((h) => h.entry.id);
      expect(ids).toContain('Farmers_Walk');
    });

    it('AC1.7: Cable Face Pull shortlist contains Face_Pull', () => {
      const hits = matcher.shortlist('Cable Face Pull');
      expect(hits.length).toBeGreaterThan(0);
      const ids = hits.map((h) => h.entry.id);
      expect(ids).toContain('Face_Pull');
    });

    it('AC1.7: Treadmill Incline Walk shortlist contains Walking_Treadmill', () => {
      const hits = matcher.shortlist('Treadmill Incline Walk');
      expect(hits.length).toBeGreaterThan(0);
      const ids = hits.map((h) => h.entry.id);
      expect(ids).toContain('Walking_Treadmill');
    });

    it('every shortlist has length <= 8 (SHORTLIST_SIZE)', () => {
      const testTitles = [
        'Romanian Deadlift',
        'Back Squat',
        "Farmer's Carry",
        'Cable Face Pull',
        'Treadmill Incline Walk',
        'Couch Stretch',
        'Plank',
      ];
      testTitles.forEach((title) => {
        const hits = matcher.shortlist(title);
        expect(hits.length).toBeLessThanOrEqual(SHORTLIST_SIZE);
      });
    });

    it('AC1.6: empty title returns empty shortlist', () => {
      expect(matcher.shortlist('')).toEqual([]);
    });

    it('AC1.6: title with only punctuation returns empty shortlist', () => {
      expect(matcher.shortlist('!!!')).toEqual([]);
    });
  });

  describe('decideByScore', () => {
    it('AC1.4: Romanian Deadlift shortlist with no AI consulted → catalog', () => {
      const hits = matcher.shortlist('Romanian Deadlift');
      const decision = decideByScore(hits, { aiConsulted: false });
      expect(decision.kind).toBe('catalog');
      if (decision.kind === 'catalog') {
        expect(decision.entry.id).toBe('Romanian_Deadlift');
      }
    });

    it('AC1.5: Couch Stretch shortlist with no AI consulted → none:nokey', () => {
      const hits = matcher.shortlist('Couch Stretch');
      expect(hits.length).toBeGreaterThan(0); // verify shortlist is non-empty
      const decision = decideByScore(hits, { aiConsulted: false });
      expect(decision.kind).toBe('none:nokey');
    });

    it('AC1.6: empty shortlist with no AI consulted → none', () => {
      const decision = decideByScore([], { aiConsulted: false });
      expect(decision.kind).toBe('none');
    });

    it('AC1.6: empty shortlist with AI consulted → none', () => {
      const decision = decideByScore([], { aiConsulted: true });
      expect(decision.kind).toBe('none');
    });

    it('AC1.3 fallback: Couch Stretch with AI consulted → terminal none, not none:nokey', () => {
      const hits = matcher.shortlist('Couch Stretch');
      expect(hits.length).toBeGreaterThan(0);
      const decision = decideByScore(hits, { aiConsulted: true });
      // Should be terminal 'none', not 'none:nokey'
      expect(decision.kind).toBe('none');
      expect(decision).not.toEqual({ kind: 'none:nokey' });
    });

    it('AC1.3 fallback: Romanian Deadlift with AI consulted → catalog', () => {
      const hits = matcher.shortlist('Romanian Deadlift');
      const decision = decideByScore(hits, { aiConsulted: true });
      expect(decision.kind).toBe('catalog');
      if (decision.kind === 'catalog') {
        expect(decision.entry.id).toBe('Romanian_Deadlift');
      }
    });
  });

  describe('margin fixture (corpus-relative guard)', () => {
    // Scores are TF-IDF and corpus-relative; if a catalog rebuild moves a row,
    // re-measure and re-pick NO_KEY_ACCEPT_SCORE deliberately — never loosen a row to make it pass.

    const acceptedCases: { title: string; expectedId: string }[] = [
      { title: 'Romanian Deadlift', expectedId: 'Romanian_Deadlift' },
      { title: 'Plank', expectedId: 'Plank' },
      { title: 'Goblet Squat', expectedId: 'Goblet_Squat' },
      { title: 'DB Bench Press', expectedId: 'Dumbbell_Bench_Press' },
      { title: 'Pull-Up', expectedId: 'Pullups' },
    ];

    const rejectedCases = [
      'Back Squat',
      'Couch Stretch',
      "Farmer's Carry",
      'Assault Bike',
      '90/90 Hip Stretch',
    ];

    it.each(acceptedCases)(
      '$title → $expectedId (accepted, score <= 0.15)',
      ({ title, expectedId }) => {
        const hits = matcher.shortlist(title);
        expect(hits.length).toBeGreaterThan(0);
        const decision = decideByScore(hits, { aiConsulted: false });
        expect(decision.kind).toBe('catalog');
        if (decision.kind === 'catalog') {
          expect(decision.entry.id).toBe(expectedId);
        }
        // Verify the score is actually <= threshold
        expect(hits[0].score).toBeLessThanOrEqual(NO_KEY_ACCEPT_SCORE);
      }
    );

    it.each(rejectedCases)('%s → none:nokey (rejected, score > 0.15)', (title) => {
      const hits = matcher.shortlist(title);
      expect(hits.length).toBeGreaterThan(0);
      const decision = decideByScore(hits, { aiConsulted: false });
      expect(decision.kind).toBe('none:nokey');
      // Verify the score is actually > threshold
      expect(hits[0].score).toBeGreaterThan(NO_KEY_ACCEPT_SCORE);
    });
  });

  describe('known limit (pinned, not hidden)', () => {
    it("'BB Row' is accepted but Bent_Over_Barbell_Row is in shortlist at position > 0", () => {
      const hits = matcher.shortlist('BB Row');
      expect(hits.length).toBeGreaterThan(0);

      // Top-1 should be accepted (score <= 0.15)
      const decision = decideByScore(hits, { aiConsulted: false });
      expect(decision.kind).toBe('catalog');

      // Verify Bent_Over_Barbell_Row is in the shortlist (but not at position 0)
      const ids = hits.map((h) => h.entry.id);
      expect(ids).toContain('Bent_Over_Barbell_Row');
      expect(ids[0]).not.toBe('Bent_Over_Barbell_Row');

      // Log the actual top-1 for reference
      console.log(`BB Row top-1: ${hits[0].entry.id} (score: ${hits[0].score})`);
    });
  });

  describe('decideFromAiPick', () => {
    it('AC1.1/AC1.2: trusted id pick on Romanian Deadlift → catalog Romanian_Deadlift', () => {
      const hits = matcher.shortlist('Romanian Deadlift');
      const pick = { kind: 'id' as const, id: 'Romanian_Deadlift' };
      const decision = decideFromAiPick(hits, pick);
      expect(decision.kind).toBe('catalog');
      if (decision.kind === 'catalog') {
        expect(decision.entry.id).toBe('Romanian_Deadlift');
      }
    });

    it('AC1.2: trusted id pick wins even when score would miss threshold', () => {
      const hits = matcher.shortlist('Cable Face Pull');
      const pick = { kind: 'id' as const, id: 'Face_Pull' };
      const decision = decideFromAiPick(hits, pick);
      expect(decision.kind).toBe('catalog');
      if (decision.kind === 'catalog') {
        expect(decision.entry.id).toBe('Face_Pull');
      }
      // Verify that the score would actually miss the threshold
      const faceHit = hits.find((h) => h.entry.id === 'Face_Pull');
      if (faceHit) {
        expect(faceHit.score).toBeGreaterThan(NO_KEY_ACCEPT_SCORE);
      }
    });

    it('none pick → none regardless of shortlist quality', () => {
      const hits = matcher.shortlist('Romanian Deadlift');
      const pick = { kind: 'none' as const };
      const decision = decideFromAiPick(hits, pick);
      expect(decision.kind).toBe('none');
    });

    it('AC1.3 untrusted on Romanian Deadlift → catalog (threshold hit)', () => {
      const hits = matcher.shortlist('Romanian Deadlift');
      const pick = { kind: 'untrusted' as const };
      const decision = decideFromAiPick(hits, pick);
      expect(decision.kind).toBe('catalog');
      if (decision.kind === 'catalog') {
        expect(decision.entry.id).toBe('Romanian_Deadlift');
      }
    });

    it('AC1.3 untrusted on Couch Stretch → terminal none, not none:nokey', () => {
      const hits = matcher.shortlist('Couch Stretch');
      expect(hits.length).toBeGreaterThan(0);
      const pick = { kind: 'untrusted' as const };
      const decision = decideFromAiPick(hits, pick);
      expect(decision.kind).toBe('none');
      expect(decision).not.toEqual({ kind: 'none:nokey' });
    });

    it('untrusted id (absent from shortlist) falls back to score', () => {
      const hits = matcher.shortlist('Cable Face Pull');
      // Use an id that is valid in the catalog but not in this shortlist
      const pick = { kind: 'id' as const, id: 'Romanian_Deadlift' };
      const decision = decideFromAiPick(hits, pick);
      // Should fall back to score rule with aiConsulted: true
      // Cable Face Pull's top hit has score > 0.15, so should be 'none'
      expect(decision.kind).toBe('none');
    });
  });
});
