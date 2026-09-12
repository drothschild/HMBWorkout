import { readFileSync } from 'fs';
import { join } from 'path';

const REPLACE_EXERCISE = join(__dirname, 'ReplaceExercise.tsx');

describe('ReplaceExercise local-library picker', () => {
  it('offers a searchable inline “Pick any exercise” path wired to the engine-guarded store action', () => {
    const source = readFileSync(REPLACE_EXERCISE, 'utf8');

    expect(source).toContain('Pick any exercise');
    expect(source).toContain('accessibilityLabel="Search exercises to replace with"');
    expect(source).toContain('filterExerciseLibraryItems');
    expect(source).toContain('chooseExisting(item.id)');
  });
});
