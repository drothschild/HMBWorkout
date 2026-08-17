/**
 * Tests for parse.ts (Task 3).
 * AC3.3, AC3.4, AC8.1, AC8.3: parser validates and extracts structured data.
 */

import { parseRoutine, parseSession } from '../parse';
import { ContractError, WorkoutLine } from '../format';

describe('parse', () => {
  describe('AC3.3: Malformed block raises error', () => {
    test('throws ContractError on malformed workout block', () => {
      const markdown = `---
type: workout-routine
id: test-routine
created: 2026-07-08
updated: 2026-07-08
tags: []
---

\`\`\`workout
- bench-press-db: 1x6 @bad rest=notaduration
\`\`\`
`;

      expect(() => parseRoutine(markdown)).toThrow(ContractError);
    });

    test('throws ContractError on missing closing fence', () => {
      const markdown = `---
type: workout-routine
id: test-routine
created: 2026-07-08
updated: 2026-07-08
tags: []
---

\`\`\`workout
- bench-press-db: 1x6
`;

      expect(() => parseRoutine(markdown)).toThrow(ContractError);
    });

    test('throws ContractError on invalid sets×reps format', () => {
      const markdown = `---
type: workout-routine
id: test-routine
created: 2026-07-08
updated: 2026-07-08
tags: []
---

\`\`\`workout
- bench-press-db: 4x
\`\`\`
`;

      expect(() => parseRoutine(markdown)).toThrow(ContractError);
    });

    test('throws ContractError on zero sets in sets×reps (0x10)', () => {
      // 0x10 matches the \d+x\d+ regex (syntactically fine) but "zero sets of
      // 10 reps" is semantically nonsensical — reject it the same way cardio
      // with sets×reps or a missing sets×reps for strength is rejected below,
      // rather than silently laundering it into a routine the author never
      // actually specified.
      const markdown = `---
type: workout-routine
id: test-routine
created: 2026-07-08
updated: 2026-07-08
tags: []
---

\`\`\`workout
- bench-press-db: 0x10
\`\`\`
`;

      expect(() => parseRoutine(markdown)).toThrow(ContractError);
    });

    test('throws ContractError on a routine sets slot that is not 1 (3x8)', () => {
      // #276 Phase 5: a routine line IS a set, so the slot's first number is
      // always 1 — the `<target-sets>x<target-reps>` overload is gone. `3x8` is
      // the shape the pre-per-set serializer wrote, and reading it as one set
      // of 8 would silently discard two thirds of the plan. Loud beats silent.
      const markdown = `---
type: workout-routine
id: test-routine
created: 2026-07-08
updated: 2026-07-08
tags: []
---

\`\`\`workout
- bench-press-db: 3x8
\`\`\`
`;

      expect(() => parseRoutine(markdown)).toThrow(ContractError);
    });

    test('a routine line may prescribe zero reps (1x0), same as a session line', () => {
      // AC5.4: the context-dependent zero-reps rule is DELETED, not ported.
      // It existed because `3x0` meant "3 sets of nothing"; with the slot now
      // reading `1x<reps>` in both documents, `1x0` means the same thing in
      // both and there is nothing left for the contexts to disagree about.
      const markdown = `---
type: workout-routine
id: test-routine
created: 2026-07-08
updated: 2026-07-08
tags: []
---

\`\`\`workout
- bench-press-db: 1x0
\`\`\`
`;

      expect(() => parseRoutine(markdown)).not.toThrow();
      const exercise = parseRoutine(markdown).exercises[0] as any;
      expect(exercise.sets).toEqual([{ setType: 'normal', targetReps: 0 }]);
    });

    test('throws ContractError on invalid rpe (out of range)', () => {
      // A SESSION document: `rpe=` is a logged measurement and #276 Phase 5
      // scoped it to the session half of the allowlist, so parsing this as a
      // routine would now throw for the wrong reason (unknown key) and stop
      // exercising the scale at all.
      const markdown = `---
type: workout-session
id: test-session
date: 2026-07-08
created: 2026-07-08
tags: []
---

\`\`\`workout
- bench-press-db: 1x6 set_type=working rpe=11
\`\`\`
`;

      expect(() => parseSession(markdown)).toThrow(ContractError);
    });
  });

  describe('AC3.4: Prose outside block ignored', () => {
    test('ignores prose before and after workout block', () => {
      const markdown = `---
type: workout-routine
id: test-routine
created: 2026-07-08
updated: 2026-07-08
tags: []
---

This is a warm-up routine for chest day.

\`\`\`workout
- bench-press-db: 1x6
\`\`\`

Notes: This is optional coaching text. The parser should ignore it.
`;

      const result = parseRoutine(markdown);
      expect(result).toBeTruthy();
      expect(result.exercises).toHaveLength(1);
      expect(result.exercises[0]).toHaveProperty('exerciseId', 'bench-press-db');
    });

    test('extracts frontmatter correctly', () => {
      const markdown = `---
type: workout-routine
id: my-routine
created: 2026-07-08
updated: 2026-07-07
tags: [strength]
---

\`\`\`workout
- bench-press-db: 1x6
\`\`\`
`;

      const result = parseRoutine(markdown);
      expect(result.frontmatter.type).toBe('workout-routine');
      expect(result.frontmatter.id).toBe('my-routine');
      expect(result.frontmatter.created).toBe('2026-07-08');
      expect(result.frontmatter.updated).toBe('2026-07-07');
    });
  });

  describe('AC8.1: Superset grouping', () => {
    test('adjacent superset=A lines form one group', () => {
      const markdown = `---
type: workout-routine
id: test-routine
created: 2026-07-08
updated: 2026-07-08
tags: []
---

\`\`\`workout
- bench-press-db: 1x6 superset=A
- rear-delt-fly-db: 1x12 superset=A
- lateral-raise-db: 1x10
\`\`\`
`;

      const result = parseRoutine(markdown);
      expect(result.exercises).toHaveLength(2);

      // First should be a superset group
      const firstExercise = result.exercises[0];
      expect(firstExercise).toHaveProperty('supersetLabel', 'A');
      expect(firstExercise).toHaveProperty('exercises');
      expect((firstExercise as any).exercises).toHaveLength(2);
      expect((firstExercise as any).exercises[0].exerciseId).toBe('bench-press-db');
      expect((firstExercise as any).exercises[1].exerciseId).toBe('rear-delt-fly-db');

      // Second should be standalone
      const secondExercise = result.exercises[1];
      expect(secondExercise).toHaveProperty('exerciseId', 'lateral-raise-db');
    });

    test('non-adjacent superset=A lines do not group', () => {
      const markdown = `---
type: workout-routine
id: test-routine
created: 2026-07-08
updated: 2026-07-08
tags: []
---

\`\`\`workout
- bench-press-db: 1x6 superset=A
- lateral-raise-db: 1x10
- rear-delt-fly-db: 1x12 superset=A
\`\`\`
`;

      const result = parseRoutine(markdown);
      // Should have 3 separate entries (no grouping since they're not adjacent)
      expect(result.exercises).toHaveLength(3);
    });
  });

  describe('AC8.3: Cardio/stretch with duration', () => {
    test('parses kind=cardio with duration', () => {
      const markdown = `---
type: workout-routine
id: test-routine
created: 2026-07-08
updated: 2026-07-08
tags: []
---

\`\`\`workout
- cycling: kind=cardio duration=5:00
\`\`\`
`;

      const result = parseRoutine(markdown);
      expect(result.exercises).toHaveLength(1);
      const exercise = result.exercises[0] as any;
      expect(exercise.exerciseId).toBe('cycling');
      expect(exercise.kind).toBe('cardio');
      expect(exercise.sets).toEqual([{ setType: 'normal', targetDurationSeconds: 300 }]);
      expect(exercise.targetSets).toBeUndefined();
      expect(exercise.targetReps).toBeUndefined();
    });

    test('parses kind=stretch with duration', () => {
      const markdown = `---
type: workout-routine
id: test-routine
created: 2026-07-08
updated: 2026-07-08
tags: []
---

\`\`\`workout
- chest-stretch: kind=stretch duration=0:30
\`\`\`
`;

      const result = parseRoutine(markdown);
      expect(result.exercises).toHaveLength(1);
      const exercise = result.exercises[0] as any;
      expect(exercise.exerciseId).toBe('chest-stretch');
      expect(exercise.kind).toBe('stretch');
      expect(exercise.sets).toEqual([{ setType: 'normal', targetDurationSeconds: 30 }]);
      expect(exercise.targetSets).toBeUndefined();
      expect(exercise.targetReps).toBeUndefined();
    });

    test('rejects cardio/stretch with sets×reps', () => {
      // Fixture re-pointed from `1x1` to `3x8` (#293 review round 2). The
      // cardio/stretch sets-slot prohibition moved into the session-only tail,
      // so `1x1` on a ROUTINE line is now a legitimate one-set prescription —
      // and refusing it made `serializeRoutine` emit documents `parseRoutine`
      // threw on for 64 of the 192 storable `routine_sets` shapes. `3x8` is
      // still refused here, by the routine-only "a routine line is one set"
      // rule, which is the multi-set misread this grammar change exists to end.
      // The prohibition itself is still pinned on the session side below.
      const markdown = `---
type: workout-routine
id: test-routine
created: 2026-07-08
updated: 2026-07-08
tags: []
---

\`\`\`workout
- cycling: 3x8 kind=cardio duration=5:00
\`\`\`
`;

      expect(() => parseRoutine(markdown)).toThrow(ContractError);
    });

    test('a SESSION line still refuses cardio/stretch with a sets slot', () => {
      // The prohibition did not weaken, it relocated. On a session line the
      // slot means LOGGED reps, which a cardio measurement genuinely cannot
      // have, so `1x8` — the shape a routine now accepts — is still refused.
      const markdown = `---
type: workout-session
id: test-session
routine: test-routine
date: 2026-07-08
start: 2026-07-08T10:00:00Z
end: 2026-07-08T11:00:00Z
tags: []
---

\`\`\`workout
- cycling: 1x8 kind=cardio duration=5:00
\`\`\`
`;

      expect(() => parseSession(markdown)).toThrow(ContractError);
      expect(() => parseSession(markdown)).toThrow(/cannot have sets×reps/);
    });

    test('a ROUTINE line may prescribe cardio/stretch in reps', () => {
      // The 64-shape Critical, at the parser level: a cardio set carrying
      // `target_reps` is storable (`replaceRoutineSets` writes it, nothing
      // validates a set's fields against its exercise's kind) and must
      // therefore be readable. The round-trip through the real DB and the
      // production `exportRoutine` is in `exportService.test.ts`.
      const markdown = `---
type: workout-routine
id: test-routine
created: 2026-07-08
updated: 2026-07-08
tags: []
---

\`\`\`workout
- cat-cow: 1x5 kind=stretch
\`\`\`
`;

      const parsed = parseRoutine(markdown);
      const entry = parsed.exercises[0] as WorkoutLine;
      expect(entry.kind).toBe('stretch');
      expect(entry.sets).toEqual([{ setType: 'normal', targetReps: 5 }]);
    });
  });

  describe('Task 3: Flag parsing', () => {
    test('parses set_type=warmup, the per-set replacement for warmup=<count>', () => {
      const markdown = `---
type: workout-routine
id: test-routine
created: 2026-07-08
updated: 2026-07-08
tags: []
---

\`\`\`workout
- bench-press-db: 1x8 set_type=warmup
- bench-press-db: 1x6
\`\`\`
`;

      const result = parseRoutine(markdown);
      const exercise = result.exercises[0] as any;
      expect(exercise.sets).toEqual([
        { setType: 'warmup', targetReps: 8 },
        { setType: 'normal', targetReps: 6 },
      ]);
    });

    test('warmup=<count> is no longer a flag at all', () => {
      // Removed rather than accepted-and-ignored: silently dropping a count a
      // legacy document states is the failure mode this grammar change exists
      // to end.
      const markdown = `---
type: workout-routine
id: test-routine
created: 2026-07-08
updated: 2026-07-08
tags: []
---

\`\`\`workout
- bench-press-db: 1x6 warmup=2
\`\`\`
`;

      expect(() => parseRoutine(markdown)).toThrow(ContractError);
    });

    test('parses rest with seconds', () => {
      const markdown = `---
type: workout-routine
id: test-routine
created: 2026-07-08
updated: 2026-07-08
tags: []
---

\`\`\`workout
- bench-press-db: 1x6 rest=90
\`\`\`
`;

      const result = parseRoutine(markdown);
      const exercise = result.exercises[0] as any;
      expect(exercise.restSeconds).toBe(90);
    });

    test('parses rest with m:ss format', () => {
      const markdown = `---
type: workout-routine
id: test-routine
created: 2026-07-08
updated: 2026-07-08
tags: []
---

\`\`\`workout
- bench-press-db: 1x6 rest=1:30
\`\`\`
`;

      const result = parseRoutine(markdown);
      const exercise = result.exercises[0] as any;
      expect(exercise.restSeconds).toBe(90);
    });

    test('parses hint (@text)', () => {
      const markdown = `---
type: workout-routine
id: test-routine
created: 2026-07-08
updated: 2026-07-08
tags: []
---

\`\`\`workout
- bench-press-db: 1x6 @progressive
\`\`\`
`;

      const result = parseRoutine(markdown);
      const exercise = result.exercises[0] as any;
      expect(exercise.hint).toBe('progressive');
    });

    test('parses multiple flags', () => {
      const markdown = `---
type: workout-routine
id: test-routine
created: 2026-07-08
updated: 2026-07-08
tags: []
---

\`\`\`workout
- bench-press-db: 1x6 set_type=warmup rest=1:30 superset=A @progressive
\`\`\`
`;

      const result = parseRoutine(markdown);
      const exercise = result.exercises[0] as any;
      expect(exercise.sets).toEqual([{ setType: 'warmup', targetReps: 6 }]);
      expect(exercise.restSeconds).toBe(90);
      expect(exercise.supersetLabel).toBe('A');
      expect(exercise.hint).toBe('progressive');
    });
  });

  describe('Session parsing', () => {
    test('parseSession parses session with set_type and rpe', () => {
      const markdown = `---
type: workout-session
id: sess-001
date: 2026-07-08
created: 2026-07-08
tags: []
---

✅ 2026-07-08

\`\`\`workout
- bench-press-db: 1x6 set_type=warmup
- bench-press-db: 1x6 set_type=working rpe=8
\`\`\`
`;

      const result = parseSession(markdown);
      expect(result).toBeTruthy();
      expect(result.exercises).toHaveLength(2);

      const first = result.exercises[0] as any;
      expect(first.exerciseId).toBe('bench-press-db');
      expect(first.setType).toBe('warmup');

      const second = result.exercises[1] as any;
      expect(second.exerciseId).toBe('bench-press-db');
      expect(second.setType).toBe('working');
      expect(second.rpe).toBe(8);
    });

    test('parseSession preserves superset grouping', () => {
      const markdown = `---
type: workout-session
id: sess-002
date: 2026-07-08
created: 2026-07-08
tags: []
---

✅ 2026-07-08

\`\`\`workout
- bench-press-db: 1x6 set_type=working superset=A
- rear-delt-fly-db: 1x12 set_type=working superset=A
\`\`\`
`;

      const result = parseSession(markdown);
      expect(result.exercises).toHaveLength(1);
      expect((result.exercises[0] as any).supersetLabel).toBe('A');
    });

    test('parseSession rejects zero sets in sets×reps (0x6), same guard as parseRoutine', () => {
      // Session lines share parseWorkoutLine with routine lines (M2 overload:
      // "1x<logged-reps>" for a logged set), so the zero-sets guard must fire
      // through this entry point too, not just parseRoutine's.
      const markdown = `---
type: workout-session
id: sess-003
date: 2026-07-08
created: 2026-07-08
tags: []
---

✅ 2026-07-08

\`\`\`workout
- bench-press-db: 0x6 set_type=working
\`\`\`
`;

      expect(() => parseSession(markdown)).toThrow(ContractError);
    });

    test('parseSession accepts 1x0 (zero logged reps), even though parseRoutine rejects 3x0', () => {
      // The "sets×reps cannot have zero reps" guard applies to routine TARGETS
      // ("3x0" is an invalid plan), but in sessions the slot carries LOGGED reps
      // ("1x0" means the user performed 0 reps), which is a real, valid action.
      // This test ensures parseSession does NOT throw on 1x0 lines.
      const markdown = `---
type: workout-session
id: sess-004
date: 2026-07-08
created: 2026-07-08
tags: []
---

✅ 2026-07-08

\`\`\`workout
- bench-press-db: 1x0 set_type=working weight=30 rest=1:30
\`\`\`
`;

      // Should NOT throw; should parse successfully
      const result = parseSession(markdown);
      expect(result).toBeTruthy();
      expect(result.exercises).toHaveLength(1);
      const exercise = result.exercises[0] as any;
      expect(exercise.exerciseId).toBe('bench-press-db');
      expect(exercise.loggedReps).toBe(0);
    });

    /**
     * The session half of the two rules #276 Phase 5 made routine-only
     * (M1 and M2, #293 review).
     *
     * AC5.5 says the session document shape is untouched, and until now
     * nothing pinned the session side of either rule — both guards could lose
     * their `context === 'routine'` clause and no test would notice.
     */
    const sessionDoc = (spec: string): string => `---
type: workout-session
id: sess-ac55
date: 2026-08-16
created: 2026-08-16
tags: []
---

✅ 2026-08-16

\`\`\`workout
- bench-press-db: ${spec}
\`\`\`
`;

    test('a session line still accepts a sets slot other than 1', () => {
      // The "a routine line is one set, so the slot must be 1" rule is
      // routine-only on purpose: `serializeSession` has always hardcoded `1x`,
      // and tightening the session side would change a document shape this
      // phase is not touching.
      const line = parseSession(sessionDoc('3x8 set_type=working')).exercises[0] as any;
      expect(line.loggedReps).toBe(8);
      expect(line.targetSets).toBe(3);
    });

    test('a session line with nothing after the colon is still malformed', () => {
      // The routine relaxation — a line may prescribe as little as it likes —
      // is routine-only too. A session line is a measurement; a set that says
      // nothing about itself was not measured.
      expect(() => parseSession(sessionDoc(''))).toThrow(ContractError);
    });
  });

  describe('I1: unknown flags fail loud', () => {
    test('an unrecognized key=value flag throws ContractError', () => {
      const markdown = `---
type: workout-routine
id: typo-01
updated: 2026-07-08
---
\`\`\`workout
- bench-press-db: 1x6 resr=90
\`\`\`
`;
      expect(() => parseRoutine(markdown)).toThrow(ContractError);
    });
  });

  describe('M1: block-style YAML tags list (vault convention)', () => {
    test('tags as a block list parse, and following keys still parse', () => {
      const markdown = `---
type: workout-routine
id: block-tags-01
tags:
  - project
  - react-native
created: 2026-07-08
updated: 2026-07-08
---
\`\`\`workout
- bench-press-db: 1x6 rest=90
\`\`\`
`;
      const result = parseRoutine(markdown);
      expect(result.frontmatter.tags).toContain('project');
      expect(result.frontmatter.tags).toContain('react-native');
      expect(result.frontmatter.created).toBe('2026-07-08');
      expect(result.frontmatter.id).toBe('block-tags-01');
      expect(result.exercises).toHaveLength(1);
    });
  });

  // #277: a flag value may be double-quoted so it can hold whitespace, `=`, and
  // (escaped) newlines. The parser half of the grammar change.
  describe('#277: quoted flag values', () => {
    const docWith = (specLine: string): string => `---
type: workout-routine
id: quoted-01
created: 2026-07-08
updated: 2026-07-08
tags: []
---

\`\`\`workout
- bench-press-db: ${specLine}
\`\`\`
`;

    test('a quoted hint keeps its spaces, punctuation and = signs', () => {
      const result = parseRoutine(
        docWith('1x6 rest=90 @"↑ to 50 lb. You hit 45 lb x 12,12 at RPE 8"')
      );
      const exercise = result.exercises[0] as any;
      expect(exercise.hint).toBe('↑ to 50 lb. You hit 45 lb x 12,12 at RPE 8');
      expect(exercise.restSeconds).toBe(90);
    });

    test('a quoted hint holding a sets×reps token is not mistaken for the sets slot', () => {
      const result = parseRoutine(docWith('1x6 @"3x12 = the goal"'));
      const exercise = result.exercises[0] as any;
      expect(exercise.hint).toBe('3x12 = the goal');
      expect(exercise.sets).toEqual([{ setType: 'normal', targetReps: 6 }]);
    });

    test('escapes inside a quoted value are decoded', () => {
      const result = parseRoutine(docWith('1x6 @"say \\"hi\\" \\\\ then\\nrest"'));
      const exercise = result.exercises[0] as any;
      expect(exercise.hint).toBe('say "hi" \\ then\nrest');
    });

    test('flags may follow a quoted hint', () => {
      const result = parseRoutine(docWith('1x6 @"two words" rest=90 superset=B'));
      const exercise = result.exercises[0] as any;
      expect(exercise.hint).toBe('two words');
      expect(exercise.restSeconds).toBe(90);
      expect(exercise.supersetLabel).toBe('B');
    });

    test('a quoted superset label keeps its spaces', () => {
      const result = parseRoutine(docWith('1x6 superset="Group One"'));
      const exercise = result.exercises[0] as any;
      expect(exercise.supersetLabel).toBe('Group One');
    });

    test('an unterminated quote throws rather than swallowing the rest of the line', () => {
      expect(() => parseRoutine(docWith('1x6 @"never closed'))).toThrow(ContractError);
    });

    test('an unrecognized escape sequence throws', () => {
      expect(() => parseRoutine(docWith('1x6 @"bad \\q escape"'))).toThrow(ContractError);
    });

    test('a bare multi-token hint still parses as its first token (unchanged)', () => {
      // Backward compatibility with hand-authored documents: quoting is how a
      // note carries spaces, but an unquoted `@word more words` is still a
      // legal document meaning hint=word, exactly as before.
      const result = parseRoutine(docWith('1x6 @progressive overload'));
      const exercise = result.exercises[0] as any;
      expect(exercise.hint).toBe('progressive');
    });
  });

  /**
   * Documents shaped as the PRE-#277 serializer wrote them (#277 review, C2).
   *
   * That serializer emitted `notes` into `@…` and `superset_group` into
   * `superset=` verbatim, unquoted, so any character a user typed is sitting in
   * a legacy document today. The suite proper cannot notice a regression here,
   * because every other fixture is a document the NEW serializer wrote — which
   * is exactly how the first version of this change came to reject an inch mark.
   *
   * Each fixture below was generated by checking the pre-#277 serializer out of
   * `origin/main` and running it, then confirming the pre-#277 parser's answer;
   * the expectations are that measured answer, not a guess at it.
   *
   * #276 Phase 5 narrowed what these can claim, and the narrowing is stated
   * rather than left implicit. The sets slot moved from `<target-sets>x<reps>`
   * to `1x<reps>`, so the *exact bytes* those legacy documents carried
   * (`4x6 …`) no longer parse at all — deliberately, and loudly. What these
   * still pin, and the only thing they were ever really about, is the
   * TOKENIZER: an inch mark in a note must not have become significant. Each
   * spec below therefore keeps its legacy note verbatim and only its sets slot
   * updated. Do not read this block as "every prior document still parses".
   */
  describe('#277: documents written before the quoting change still tokenize the same way', () => {
    const legacyDoc = (specLine: string): string => `---
type: workout-routine
id: legacy-01
created: 2026-07-08
updated: 2026-07-08
tags: []
---

\`\`\`workout
- bench-press-db: ${specLine}
\`\`\`
`;

    const parseLine = (specLine: string): any =>
      parseRoutine(legacyDoc(specLine)).exercises[0] as any;

    test('an inch mark in a note truncates as it always did, rather than throwing', () => {
      // The regression this pins: `"` became significant in this change, so a
      // note with an odd number of them made the whole document unparseable.
      expect(parseLine('1x6 rest=1:30 @Go 2" deep').hint).toBe('Go');
      expect(parseLine('1x6 rest=1:30 @Bar at 6" above knee').hint).toBe('Bar');
      expect(parseLine('1x6 rest=1:30 @Use the 45" band').hint).toBe('Use');
    });

    test('the flags after an inch-mark note are still read', () => {
      // Truncating the note is the old (lossy) behaviour and is acceptable;
      // losing a real flag to it would not be.
      expect(parseLine('1x6 rest=1:30 @Go 2" deep').restSeconds).toBe(90);
    });

    test('a note with balanced quotes truncates as it always did', () => {
      // An even number of quotes survived even the first version of the change,
      // which is what made the odd-count failure easy to miss.
      expect(parseLine('1x6 rest=1:30 @say "go" now').hint).toBe('say');
      expect(parseLine('1x6 rest=1:30 @controlled').hint).toBe('controlled');
    });

    test('a superset label holding a quote parses, and the flags after it survive', () => {
      // `superset=` is emitted BEFORE `rest=` on a session line, so a throw or a
      // mis-tokenization here costs a real flag, not just the label's tail.
      const line = parseLine('1x6 superset=A"B rest=1:30');
      expect(line.supersetLabel).toBe('A"B');
      expect(line.restSeconds).toBe(90);

      const inches = parseLine('1x6 superset=2" pause rest=1:30');
      expect(inches.supersetLabel).toBe('2"');
      expect(inches.restSeconds).toBe(90);
    });

    /**
     * The exception, stated exactly rather than left to be discovered.
     *
     * A quote IS significant where a value begins, so a legacy note that itself
     * began with one now reads as a quoted value. This is the one shape whose
     * meaning the change alters, and it cannot be avoided while `"` opens a
     * value at all — the two tests below are the whole of the residual.
     */
    test('a legacy note that BEGINS with a quote is now read as a quoted value', () => {
      // Pre-#277 this truncated to `"squeeze`. It now reads the quoted span.
      expect(parseLine('1x6 rest=1:30 @"squeeze at the top" - coach').hint).toBe(
        'squeeze at the top'
      );
    });

    test('...and is rejected when that quote never closes', () => {
      // The other half of the same exception. Rejecting beats silently reading
      // a value whose extent the document does not actually define, and the
      // shape is far rarer than the inch mark above — but it IS a document the
      // old parser accepted, so it is pinned rather than claimed impossible.
      expect(() =>
        parseLine('1x6 rest=1:30 @"squeeze at the top - coach')
      ).toThrow(ContractError);
    });
  });

  /**
   * #276 Phase 5: the routine document is a list of SETS, and the parser puts
   * them back together.
   *
   * These are the parse half of the grammar change. The round-trip suite proves
   * serialize and parse agree; this proves the parser reads documents the
   * serializer did not necessarily write — hand-authored spacing, a lone
   * exercise line, an allowlist violation — which is the class of input a
   * round-trip can never reach.
   */
  describe('#276: per-set routine lines group into set lists', () => {
    const doc = (...lines: string[]): string => `---
type: workout-routine
id: per-set-01
created: 2026-08-16
updated: 2026-08-16
tags: []
---

\`\`\`workout
${lines.join('\n')}
\`\`\`
`;

    const entries = (...lines: string[]): any[] => parseRoutine(doc(...lines)).exercises;

    test('consecutive lines sharing an exercise id become one entry with an ordered set list', () => {
      const parsed = entries(
        '- bench-press-db: 1x5 set_type=warmup target_weight=9.07',
        '- bench-press-db: 1x5 set_type=warmup target_weight=11.34',
        '- bench-press-db: 1x8 reps_max=10 target_weight=22.68'
      );

      expect(parsed).toHaveLength(1);
      expect(parsed[0].sets).toEqual([
        { setType: 'warmup', targetReps: 5, targetWeightKg: 9.07 },
        { setType: 'warmup', targetReps: 5, targetWeightKg: 11.34 },
        { setType: 'normal', targetReps: 8, targetRepsMax: 10, targetWeightKg: 22.68 },
      ]);
    });

    test('a different exercise between them splits the run into three entries', () => {
      const parsed = entries(
        '- bench-press-db: 1x5',
        '- squat-bb: 1x5',
        '- bench-press-db: 1x5'
      );

      expect(parsed.map((e) => e.exerciseId)).toEqual([
        'bench-press-db',
        'squat-bb',
        'bench-press-db',
      ]);
      expect(parsed.every((e) => e.sets.length === 1)).toBe(true);
    });

    test('a different superset label splits the run even for the same exercise', () => {
      // Grouping keys on the superset label as well as the id, so a set list
      // can never straddle a superset boundary — which is what keeps
      // `groupSupersets`'s adjacency premise (helpers.lv:56, transition.lv:14
      // cite it by name) true after this change.
      const parsed = entries(
        '- bench-press-db: 1x5 superset=A',
        '- bench-press-db: 1x5 superset=B'
      );

      expect(parsed).toHaveLength(2);
      expect(parsed[0].supersetLabel).toBe('A');
      expect(parsed[1].supersetLabel).toBe('B');
    });

    test('an entry-level flag that disagrees across a run is a contract violation', () => {
      // The serializer writes rest/hint identically on every line of an entry,
      // so a disagreement means the document is describing two entries the
      // grouping cannot tell apart. Refusing beats silently keeping the first.
      expect(() =>
        entries('- bench-press-db: 1x5 rest=90', '- bench-press-db: 1x5 rest=120')
      ).toThrow(ContractError);

      expect(() =>
        entries('- bench-press-db: 1x5 @"cue one"', '- bench-press-db: 1x5 @"cue two"')
      ).toThrow(ContractError);

      // `kind` is in ENTRY_FLAGS too, and needs a pair that reaches the
      // conflict check to pin it (M3, #293 review): a `1x5 kind=cardio` line
      // throws earlier, on the rule that cardio has no sets slot, so a run
      // built from one proves nothing about the flag list.
      expect(() =>
        entries('- cycling: kind=cardio target_distance=100', '- cycling: 1x5')
      ).toThrow(ContractError);
    });

    test('a sets=0 line in a run contributes no set, from either side', () => {
      // M4 (#293 review). `sets: []` appends nothing in the fold, which is what
      // keeps the entry marker from inventing a phantom set when it sits beside
      // real ones. Both orders, because the fold treats them differently: the
      // first line seeds the entry, later ones extend it.
      expect(entries('- bench-press-db: sets=0', '- bench-press-db: 1x5')[0].sets).toEqual([
        { setType: 'normal', targetReps: 5 },
      ]);
      expect(entries('- bench-press-db: 1x5', '- bench-press-db: sets=0')[0].sets).toEqual([
        { setType: 'normal', targetReps: 5 },
      ]);
    });

    test('a stray token on a routine line is still malformed, not a zero-set entry', () => {
      // The zero-set arm only applies to a line the parser understands ENTIRELY.
      // `4x` is not a sets slot, not a flag and not a hint, and reading the line
      // as "prescribes nothing" would launder a typo into a plan.
      expect(() => entries('- bench-press-db: 4x')).toThrow(ContractError);
      expect(() => entries('- bench-press-db: rest=90 gibberish')).toThrow(ContractError);
    });

    test('a stray token is refused beside a load, a rep-range top, a set type or a distance', () => {
      // M8 (#293 review round 2). The guard's condition is reps-or-duration,
      // NOT "prescribes nothing across all five set fields" — the wider version
      // silently swallowed a typo'd sets slot on these four lines, which threw
      // before. The width is a deliberate choice and not forced by any test:
      // both widths pass the whole suite, and only making the guard
      // UNCONDITIONAL breaks the five #277 legacy-tokenizer fixtures. The
      // narrower one keeps `4x` loud in more places, which is the point of the
      // rule, so it is what is pinned here.
      expect(() => entries('- bench-press-db: target_weight=50 4x')).toThrow(ContractError);
      expect(() => entries('- bench-press-db: reps_max=10 4x')).toThrow(ContractError);
      expect(() => entries('- bench-press-db: set_type=warmup 4x')).toThrow(ContractError);
      expect(() => entries('- rower: kind=cardio target_distance=100 4x')).toThrow(ContractError);

      // The other side of the boundary, unchanged since before #276: a stray
      // token beside a line that DOES prescribe reps or a duration is still
      // ignored. Narrowing that is what breaks the #277 fixtures, whose whole
      // point is that a multi-token note truncates rather than throwing.
      expect(entries('- bench-press-db: 1x5 4x')[0].sets).toEqual([
        { setType: 'normal', targetReps: 5 },
      ]);
      expect(entries('- rower: kind=cardio duration=5:00 4x')[0].sets).toEqual([
        { setType: 'normal', targetDurationSeconds: 300 },
      ]);
    });

    test('an exercise line marked sets=0 is an entry with no sets', () => {
      const parsed = entries('- bench-press-db: sets=0');

      expect(parsed).toHaveLength(1);
      expect(parsed[0].exerciseId).toBe('bench-press-db');
      expect(parsed[0].sets).toEqual([]);
    });

    test('a sets=0 line keeps its entry-level flags', () => {
      const parsed = entries('- bench-press-db: sets=0 rest=1:30 @easy');

      expect(parsed[0].sets).toEqual([]);
      expect(parsed[0].restSeconds).toBe(90);
      expect(parsed[0].hint).toBe('easy');
    });

    test('a sets=0 line keeps its superset label, so it stays in its group', () => {
      // P19 (#293 review round 2). `finishRoutineLine` rebuilds the entry
      // field-by-field on the `sets=0` path, and dropping `supersetLabel` from
      // that return passed every test. It is not a cosmetic field: the marker
      // line is the ONLY line a zero-set entry has, `groupSupersets` keys on the
      // label, and `helpers.lv`'s `group_end_idx` rests on that grouping being
      // honest — so a zero-set entry silently leaving its group changes what the
      // engine reads as a contiguous run.
      const parsed = entries('- bench-press-db: sets=0 superset=A');
      expect(parsed[0].supersetLabel).toBe('A');

      // The consequence, not just the field: grouped with its partner rather
      // than emitted as a standalone entry beside it.
      const grouped = entries('- bench-press-db: sets=0 superset=A', '- row-db: 1x8 superset=A');
      expect(grouped).toHaveLength(1);
      expect(grouped[0].supersetLabel).toBe('A');
      expect(grouped[0].exercises.map((e: any) => e.exerciseId)).toEqual([
        'bench-press-db',
        'row-db',
      ]);
    });

    /**
     * The two Criticals of the #293 review, at the parse layer.
     *
     * `sets=0` exists because without it these two lines are the same string:
     * "this entry prescribes nothing" and "this set prescribes nothing in
     * particular". The parser guessed, and guessed wrong in both directions —
     * a bare cardio exercise line threw as a set missing its duration, and a
     * load-only set silently disappeared.
     */
    test('a routine line without sets=0 is a SET, however little it prescribes', () => {
      expect(entries('- bench-press-db: target_weight=50')[0].sets).toEqual([
        { setType: 'normal', targetWeightKg: 50 },
      ]);
      expect(entries('- bench-press-db: reps_max=12')[0].sets).toEqual([
        { setType: 'normal', targetRepsMax: 12 },
      ]);
      expect(entries('- bench-press-db: set_type=warmup')[0].sets).toEqual([{ setType: 'warmup' }]);
      // The floor of the family: a set with all five columns unset. One set in,
      // one set out — the entry that has NO sets is the other line.
      expect(entries('- bench-press-db:')[0].sets).toEqual([{ setType: 'normal' }]);
      expect(entries('- bench-press-db: rest=1:30')[0].sets).toEqual([{ setType: 'normal' }]);
    });

    test('a cardio or stretch routine line need not carry a duration', () => {
      // A prescribed cardio set may state a distance, a duration, or neither;
      // the duration requirement is the SESSION's, where a line is a
      // measurement. Applying it here is what made a bare cardio entry line —
      // the shape every routine in the app has today — unparseable.
      expect(entries('- rower: sets=0 kind=cardio')[0].sets).toEqual([]);
      expect(entries('- rower: kind=cardio target_distance=5000')[0].sets).toEqual([
        { setType: 'normal', targetDistanceM: 5000 },
      ]);
      expect(entries('- pigeon-pose: sets=0 kind=stretch')[0].sets).toEqual([]);
    });

    test('a sets=0 line that also prescribes a set is a contract violation', () => {
      // It asserts both that the entry has no sets and that here is one of
      // them. Refusing beats picking one of the two readings.
      expect(() => entries('- bench-press-db: sets=0 1x5')).toThrow(ContractError);
      expect(() => entries('- bench-press-db: sets=0 target_weight=50')).toThrow(ContractError);
      expect(() => entries('- bench-press-db: sets=0 set_type=warmup')).toThrow(ContractError);
      expect(() => entries('- rower: sets=0 kind=cardio duration=5:00')).toThrow(ContractError);

      // P23/P26 (#293 review round 2). The fixture above covers weight,
      // `set_type` and duration, so dropping either `targetRepsMax` or
      // `targetDistanceM` from SET_LEVEL_FIELDS survived every test. Every
      // member of that list needs a case or the list is only partly pinned.
      expect(() => entries('- bench-press-db: sets=0 reps_max=10')).toThrow(ContractError);
      expect(() => entries('- rower: sets=0 kind=cardio target_distance=100')).toThrow(
        ContractError
      );

    });

    test('a set COUNT is not a thing the marker can say', () => {
      // `sets=<n>` for nonzero n is the aggregate model this grammar replaced.
      // A count is spelled by writing that many lines, so anything but 0 is a
      // document written against a model that no longer exists — refused, the
      // same way `3x8` is, rather than reinterpreted.
      expect(() => entries('- bench-press-db: sets=3')).toThrow(ContractError);
      expect(() => entries('- bench-press-db: sets=1')).toThrow(ContractError);
    });

    test('sets=0 is refused on a session line', () => {
      const sessionDoc = `---
type: workout-session
id: sess-nosets-01
date: 2026-08-16
created: 2026-08-16
tags: []
---

\`\`\`workout
- bench-press-db: sets=0 set_type=working
\`\`\`
`;
      expect(() => parseSession(sessionDoc)).toThrow(ContractError);
    });

    test('a session line still requires its set content', () => {
      // The zero-set relaxation is routine-only: a session document records
      // what happened, and "an exercise with no sets" is not a measurement.
      const sessionDoc = `---
type: workout-session
id: sess-empty-01
date: 2026-08-16
created: 2026-08-16
tags: []
---

\`\`\`workout
- bench-press-db: set_type=working
\`\`\`
`;
      expect(() => parseSession(sessionDoc)).toThrow(ContractError);
    });

    test('a SESSION cardio or stretch line still requires its duration', () => {
      // P10 (#293 review round 2). This guard MOVED into the session-only tail
      // and its only coverage was routine-side, which no longer reaches it —
      // `if (false)` on the check passed all 238 interop/export tests. A logged
      // cardio set with no duration is a measurement that measured nothing, and
      // that is exactly the reading the routine side now deliberately allows,
      // so the two need separate pins.
      const sessionDoc = (spec: string): string => `---
type: workout-session
id: sess-cardio-01
date: 2026-08-16
created: 2026-08-16
tags: []
---

\`\`\`workout
- ${spec}
\`\`\`
`;

      expect(() => parseSession(sessionDoc('rower: kind=cardio distance=5000'))).toThrow(
        /cardio exercise missing duration/
      );
      expect(() => parseSession(sessionDoc('pigeon-pose: kind=stretch rpe=5'))).toThrow(
        /stretch exercise missing duration/
      );

      // And it is satisfied by a duration, not merely by any content — the
      // check has to be about the duration specifically or a `!== undefined`
      // flipped to `=== undefined` reads the same.
      expect(() =>
        parseSession(sessionDoc('rower: kind=cardio duration=20:00 distance=5000'))
      ).not.toThrow();
    });
  });

  /**
   * #276 Phase 5, AC5.3: the flag allowlist is context-aware.
   *
   * AGENTS.md recorded the leak this closes: "the 'session sets only'
   * restriction on `weight=` is a comment, not a rule … a routine line carrying
   * `weight=60` parses cleanly today." It no longer does, and the new
   * routine-side keys are refused on a session line by the same mechanism.
   */
  describe('#276: the flag allowlist is context-aware', () => {
    const routineDoc = (spec: string): string => `---
type: workout-routine
id: allow-01
created: 2026-08-16
updated: 2026-08-16
tags: []
---

\`\`\`workout
- bench-press-db: ${spec}
\`\`\`
`;

    const sessionDoc = (spec: string): string => `---
type: workout-session
id: allow-sess-01
date: 2026-08-16
created: 2026-08-16
tags: []
---

\`\`\`workout
- bench-press-db: ${spec}
\`\`\`
`;

    test.each(['weight=60', 'rpe=8', 'distance=100'])(
      'a session-only flag is refused on a routine line: %s',
      (spec) => {
        expect(() => parseRoutine(routineDoc(`1x6 ${spec}`))).toThrow(ContractError);
      }
    );

    test.each(['target_weight=60', 'reps_max=10', 'target_distance=100'])(
      'a routine-only flag is refused on a session line: %s',
      (spec) => {
        expect(() => parseSession(sessionDoc(`1x6 set_type=working ${spec}`))).toThrow(
          ContractError
        );
      }
    );

    test('the session-only flags are still accepted on a session line', () => {
      const parsed = parseSession(
        sessionDoc('1x6 set_type=working weight=60 rpe=8')
      ).exercises[0] as any;

      expect(parsed.weight).toBe(60);
      expect(parsed.rpe).toBe(8);
      expect(parsed.loggedReps).toBe(6);
    });

    test('the routine-only flags are still accepted on a routine line', () => {
      const parsed = parseRoutine(
        routineDoc('1x6 reps_max=10 target_weight=22.68')
      ).exercises[0] as any;

      expect(parsed.sets).toEqual([
        { setType: 'normal', targetReps: 6, targetRepsMax: 10, targetWeightKg: 22.68 },
      ]);
    });

    test('a negative target weight is refused, like every other measure on the line', () => {
      expect(() => parseRoutine(routineDoc('1x6 target_weight=-5'))).toThrow(ContractError);
      expect(() => parseRoutine(routineDoc('1x6 reps_max=-1'))).toThrow(ContractError);
      expect(() => parseRoutine(routineDoc('1x6 target_distance=-1'))).toThrow(ContractError);
    });
  });
});
