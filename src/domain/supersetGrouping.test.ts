import { groupBySupersetRuns, supersetRunEndIndex } from './supersetGrouping';

/** Minimal "thing with an optional superset label" for the pure fixtures. */
interface Item {
  id: string;
  label?: string | null;
  order?: number;
}

const keyOf = (item: Item) => item.label;
const ids = (runs: ReturnType<typeof groupBySupersetRuns<Item, string>>) =>
  runs.map((run) => ({ label: run.label, members: run.members.map((m) => m.id) }));

describe('groupBySupersetRuns', () => {
  it('joins a contiguous run of same-label items into one run', () => {
    const items: Item[] = [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'A' },
    ];

    expect(ids(groupBySupersetRuns(items, keyOf))).toEqual([
      { label: 'A', members: ['a', 'b'] },
    ]);
  });

  it('splits non-contiguous same-label runs rather than merging them (engine convention 9/10)', () => {
    // Labels are contiguous but NOT routine-unique: a later run may legitimately
    // reuse an earlier run's label. Merging them is the #268 bug.
    const items: Item[] = [
      { id: 'a', label: 'A' },
      { id: 'b', label: null },
      { id: 'c', label: 'A' },
      { id: 'd', label: null },
    ];

    expect(ids(groupBySupersetRuns(items, keyOf))).toEqual([
      { label: 'A', members: ['a'] },
      { label: null, members: ['b'] },
      { label: 'A', members: ['c'] },
      { label: null, members: ['d'] },
    ]);
  });

  it('keeps two ADJACENT runs with different labels separate', () => {
    // No standalone entry between them: the only thing that can split these is
    // the label comparison itself.
    const items: Item[] = [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'A' },
      { id: 'c', label: 'B' },
      { id: 'd', label: 'B' },
    ];

    expect(ids(groupBySupersetRuns(items, keyOf))).toEqual([
      { label: 'A', members: ['a', 'b'] },
      { label: 'B', members: ['c', 'd'] },
    ]);
  });

  it('returns a labelled run of one when a label appears exactly once', () => {
    const items: Item[] = [
      { id: 'a', label: null },
      { id: 'b', label: 'A' },
      { id: 'c', label: null },
    ];

    expect(ids(groupBySupersetRuns(items, keyOf))).toEqual([
      { label: null, members: ['a'] },
      { label: 'A', members: ['b'] },
      { label: null, members: ['c'] },
    ]);
  });

  it('treats an empty-string label as absent, agreeing with the engine sentinel', () => {
    // engine/types.ts: `supersetGroup: string; // "" means no superset`.
    // Two adjacent '' entries must NOT coalesce into a two-member superset.
    const items: Item[] = [
      { id: 'a', label: '' },
      { id: 'b', label: '' },
    ];

    expect(ids(groupBySupersetRuns(items, keyOf))).toEqual([
      { label: null, members: ['a'] },
      { label: null, members: ['b'] },
    ]);
  });

  it('unifies null, undefined and empty string as "no label", and never joins two of them', () => {
    const items: Item[] = [{ id: 'a', label: null }, { id: 'b' }, { id: 'c', label: '' }];

    expect(ids(groupBySupersetRuns(items, keyOf))).toEqual([
      { label: null, members: ['a'] },
      { label: null, members: ['b'] },
      { label: null, members: ['c'] },
    ]);
  });

  it('returns standalone entries as singleton runs, so a caller can render either shape', () => {
    // Copy 1 (getSupersetGroups) wanted singleton groups; copies 2 and 3 wanted
    // "not a group". A labelled singleton is both: `.members` gives the first,
    // `label === null` distinguishes the second.
    const items: Item[] = [{ id: 'a' }, { id: 'b' }];
    const runs = groupBySupersetRuns(items, keyOf);

    expect(runs.map((r) => r.members.length)).toEqual([1, 1]);
    expect(runs.every((r) => r.label === null)).toBe(true);
  });

  it('returns no runs for no items', () => {
    expect(groupBySupersetRuns([], keyOf)).toEqual([]);
  });

  it('groups by adjacency in the given array, not by the order field, so duplicate orders change nothing', () => {
    // The caller sorts; the helper never reads an order field. Two rows sharing
    // an `order` value must still group by their label and adjacency, and every
    // item must appear exactly once.
    const items: Item[] = [
      { id: 'a', label: 'A', order: 1 },
      { id: 'b', label: 'A', order: 1 },
      { id: 'c', label: null, order: 1 },
      { id: 'd', label: 'A', order: 1 },
    ];

    expect(ids(groupBySupersetRuns(items, keyOf))).toEqual([
      { label: 'A', members: ['a', 'b'] },
      { label: null, members: ['c'] },
      { label: 'A', members: ['d'] },
    ]);
  });

  it('preserves every input item exactly once, in order', () => {
    const items: Item[] = [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'A' },
      { id: 'c' },
      { id: 'd', label: 'B' },
    ];

    const flat = groupBySupersetRuns(items, keyOf).flatMap((run) => run.members);
    expect(flat).toEqual(items);
  });

  it('does not mutate the input array', () => {
    const items: Item[] = [{ id: 'a', label: 'A' }, { id: 'b' }];
    const snapshot = JSON.parse(JSON.stringify(items));

    groupBySupersetRuns(items, keyOf);

    expect(items).toEqual(snapshot);
    expect(items).toHaveLength(2);
  });

  describe('numeric keys (#276 would re-point superset_group at an integer id)', () => {
    interface NumItem {
      id: string;
      sid?: number | null;
    }
    const numKey = (item: NumItem) => item.sid;

    it('treats 0 as a real label, not as absent', () => {
      // A falsy check would silently split a group whose id is 0. The
      // normalization compares against null/undefined/'' explicitly for this.
      const items: NumItem[] = [
        { id: 'a', sid: 0 },
        { id: 'b', sid: 0 },
      ];
      const runs = groupBySupersetRuns(items, numKey);

      expect(runs).toHaveLength(1);
      expect(runs[0].label).toBe(0);
      expect(runs[0].members.map((m) => m.id)).toEqual(['a', 'b']);
    });

    it('splits adjacent numeric runs and keeps non-contiguous reuse distinct', () => {
      const items: NumItem[] = [
        { id: 'a', sid: 5 },
        { id: 'b', sid: 6 },
        { id: 'c', sid: null },
        { id: 'd', sid: 5 },
      ];

      expect(
        groupBySupersetRuns(items, numKey).map((r) => [r.label, r.members.map((m) => m.id)])
      ).toEqual([
        [5, ['a']],
        [6, ['b']],
        [null, ['c']],
        [5, ['d']],
      ]);
    });
  });
});

describe('supersetRunEndIndex', () => {
  const items: Item[] = [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'A' },
    { id: 'c', label: 'A' },
    { id: 'd', label: 'B' },
    { id: 'e' },
  ];

  it('returns the last index of the contiguous run that starts at the given index', () => {
    expect(supersetRunEndIndex(items, 0, keyOf)).toBe(2);
  });

  it('scans forward only, so a mid-run start reports that run’s end', () => {
    expect(supersetRunEndIndex(items, 1, keyOf)).toBe(2);
  });

  it('stops at a different adjacent label', () => {
    expect(supersetRunEndIndex(items, 3, keyOf)).toBe(3);
  });

  it('returns the start index for a standalone entry', () => {
    expect(supersetRunEndIndex(items, 4, keyOf)).toBe(4);
  });

  it('returns the start index for an empty-string label, which can never join a run', () => {
    const sentinelItems: Item[] = [{ id: 'a', label: '' }, { id: 'b', label: '' }];
    expect(supersetRunEndIndex(sentinelItems, 0, keyOf)).toBe(0);
  });

  it('never runs past the end of the array', () => {
    const allSame: Item[] = [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'A' },
    ];
    expect(supersetRunEndIndex(allSame, 0, keyOf)).toBe(1);
  });

  it('returns the start index when it is out of range', () => {
    expect(supersetRunEndIndex(items, 99, keyOf)).toBe(99);
  });
});
