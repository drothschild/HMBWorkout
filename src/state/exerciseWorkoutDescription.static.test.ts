import fs from 'fs';
import path from 'path';

import { firstExerciseDescriptionLine } from './exerciseDescriptionSummary';

const ROOT = path.resolve(__dirname, '..');

describe('issue #357 active-workout exercise description cue', () => {
  test('uses only the first trimmed physical line of the stored description', () => {
    expect(firstExerciseDescriptionLine('  Brace hard, then squat.\nKeep the knees tracking over toes.  '))
      .toBe('Brace hard, then squat.');
    expect(firstExerciseDescriptionLine('Drive through the floor.\r\nPause at lockout.'))
      .toBe('Drive through the floor.');
  });

  test('treats a missing or whitespace-only description as no cue', () => {
    expect(firstExerciseDescriptionLine(null)).toBeUndefined();
    expect(firstExerciseDescriptionLine(undefined)).toBeUndefined();
    expect(firstExerciseDescriptionLine('  \n  ')).toBeUndefined();
  });

  test('wires the description cue into the existing blue callout for every exercise kind', () => {
    const sessionSource = fs.readFileSync(path.join(ROOT, 'app/session.tsx'), 'utf8');
    const setLoggerSource = fs.readFileSync(path.join(ROOT, 'components/SetLogger.tsx'), 'utf8');

    expect(sessionSource).toContain('getExerciseDescriptions');
    expect(sessionSource).toContain('exerciseDescriptions');
    expect(setLoggerSource).toContain('presenter.exerciseDescriptionLine');
    expect(setLoggerSource).not.toContain('presenter.progressionHint');
    expect(setLoggerSource).not.toMatch(
      /!isDurationBased\s*&&\s*presenter\.exerciseDescriptionLine/
    );
  });
});
