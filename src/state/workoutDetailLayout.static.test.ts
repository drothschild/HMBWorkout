/**
 * Static gate for the plan-target label's placement on the workout-history
 * detail screen (`src/app/workout/[id].tsx`), #296.
 *
 * The bug: the exercise title and the target label shared one flex row, and a
 * real Hevy title takes the whole of it. The title renders at the `subtitle`
 * ramp — `fontSize: 32` (`src/theme/typography.ts`) — so `Bench Press
 * (Dumbbell)` alone is wider than the content column on a phone, and the label
 * beside it collapsed to its first character: the presenter's `1 warmup + 3×8`
 * reached the user as a meaningless `1`. `Bench` left room and rendered the
 * label in full, which is what makes it a layout defect and not a data one —
 * `sessionDetailPresenter` and `formatPlannedSetsSummary` are covered and
 * correct.
 *
 * The fix stacks them: the title gets the full width and wraps, the label sits
 * on its own line beneath it. Truncating the title instead was the other
 * option on the card and is rejected deliberately — Hevy's convention is
 * `<Movement> (<Equipment>)`, so the distinguishing token is the LAST one, and
 * tail truncation would turn `Bench Press (Dumbbell)` and `Bench Press
 * (Barbell)` into the same string.
 *
 * `src/app` is outside every jest project's testMatch (AGENTS.md, Testing
 * gotchas), so no suite can render this screen and measure a frame. A
 * structural read of the source is the criterion here, the precedent set by
 * `routineDetailKeys.static.test.ts` and AGENTS.md's AC6.9. It proves the two
 * texts are no longer competing for one line; whether the result LOOKS right
 * is a simulator check with a long title, and always will be.
 *
 * Every assertion below is anchored on a JSX use or a slice of the render
 * body, never a bare identifier — an import or a leftover style must not be
 * able to satisfy one.
 */

import * as fs from 'fs';
import * as path from 'path';

const SCREEN_PATH = path.resolve(__dirname, '../app/workout/[id].tsx');

describe('workout/[id].tsx target-label placement', () => {
  const source = fs.readFileSync(SCREEN_PATH, 'utf-8');

  const listStart = source.indexOf('detail.exercises.map(');
  const listEnd = source.indexOf('detail.otherSets.length');
  const list = source.slice(listStart, listEnd);

  const sectionAt = list.indexOf('style={styles.exerciseSection}');
  const nameAt = list.indexOf('style={styles.exerciseName}');
  const targetAt = list.indexOf('style={styles.exerciseTarget}');

  it('reads the per-exercise render body (a broken slice must not pass vacuously)', () => {
    expect(listStart).toBeGreaterThan(-1);
    expect(listEnd).toBeGreaterThan(listStart);
    expect(sectionAt).toBeGreaterThan(-1);
    expect(nameAt).toBeGreaterThan(sectionAt);
    expect(targetAt).toBeGreaterThan(nameAt);
  });

  it('puts the label on its own line: no container wraps the title and the label together', () => {
    // The defect was `<View style={styles.exerciseHeaderRow}>` opened here,
    // with `flexDirection: 'row'`. This rejects ANY wrapper, not only a row
    // one, and that over-reach is deliberate: a wrapper's flexDirection lives
    // in the stylesheet under a name this slice cannot follow, so "no shared
    // container" is the only claim a structural read can make honestly. The
    // cost is that a harmless plain `<View>` regrouping also fails here; the
    // benefit is that reintroducing the row under a fresh style name cannot
    // slip through.
    const betweenSectionAndLabel = list.slice(sectionAt, targetAt);
    expect(betweenSectionAndLabel).not.toContain('<View');
  });

  it('never truncates the title, because Hevy puts the distinguishing token last', () => {
    // `numberOfLines={1}` on the title is the other fix the card offered. It
    // would make `Bench Press (Dumbbell)` and `Bench Press (Barbell)` render
    // identically.
    const titleElement = list.slice(Math.max(0, nameAt - 200), nameAt + 200);
    expect(titleElement).not.toContain('numberOfLines');
    expect(titleElement).not.toContain('ellipsizeMode');
  });

  it('still hides the label when the row prescribes nothing, rather than showing "0 sets"', () => {
    // #276's convention: `formatPlannedSetsSummary` returns '' for an entry
    // with no prescribed sets and every caller hides the row. Restacking the
    // layout must not drop that gate.
    expect(list).toContain("targetLabel !== ''");
    expect(list).toContain('formatPlannedSetsSummary(exercise.plannedSets)');
  });

  it('leaves no row-direction header style behind for a future edit to re-adopt', () => {
    const stylesAt = source.indexOf('const styles = StyleSheet.create(');
    expect(stylesAt).toBeGreaterThan(-1);
    expect(source.slice(stylesAt)).not.toContain('exerciseHeaderRow');
  });
});
