import { readFileSync } from 'fs';
import { join } from 'path';

const screenPath = join(__dirname, '..', 'app', 'exercise', '[id].tsx');

function source(): string {
  return readFileSync(screenPath, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/\s+/g, ' ');
}

describe('exercise detail history wiring', () => {
  it('loads history on focus with stale-result protection and visible states', () => {
    const text = source();
    const earlyReturn = text.indexOf('if (!id || loading)');

    expect(text).toContain("import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router'");
    expect(text).toContain("import { exerciseHistoryPresenter");
    expect(text.indexOf('useFocusEffect(')).toBeGreaterThan(-1);
    expect(text.indexOf('useFocusEffect(')).toBeLessThan(earlyReturn);
    expect(text).toContain('exerciseHistoryPresenter(database, id)');
    expect(text).toContain('cancelled = true');
    expect(text).toContain('Loading history…');
    expect(text).toContain('No completed workouts yet.');
    expect(text).toContain("Couldn't load exercise history.");
  });

  it('renders every workout group and its formatted set rows', () => {
    const text = source();

    expect(text).toContain('History');
    expect(text).toContain('history.map((workout) =>');
    expect(text).toContain('workout.dateLabel');
    expect(text).toContain('workout.sets.map((set) =>');
    expect(text).toContain('set.label');
    expect(text).toContain('set.line');
  });
});
