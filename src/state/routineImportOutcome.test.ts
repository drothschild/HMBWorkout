import { routineImportOutcome } from './routineImportOutcome';

describe('routineImportOutcome', () => {
  it('names the routine it created', () => {
    const message = routineImportOutcome({ kind: 'imported', name: 'Push' });
    expect(message).toContain('Push');
  });

  it('says nothing at all when the user backed out of the picker', () => {
    // A cancelled pick is not an outcome to report; a banner reading "nothing
    // happened" is noise.
    expect(routineImportOutcome({ kind: 'cancelled' })).toBeNull();
  });

  it('surfaces the refusal message the pure importer produced', () => {
    const message = routineImportOutcome({
      kind: 'refused',
      error: {
        code: 'non-contiguous-superset',
        message: 'Superset "5" is split across the routine.',
      },
    });
    expect(message).toContain('Superset "5" is split across the routine.');
  });

  it('distinguishes a file it could not read from a file it could not parse', () => {
    const unreadable = routineImportOutcome({ kind: 'unreadable' });
    const refused = routineImportOutcome({
      kind: 'refused',
      error: { code: 'unparseable', message: 'Missing frontmatter (---)' },
    });
    expect(unreadable).not.toBeNull();
    expect(unreadable).not.toEqual(refused);
  });

  it('never reports a refusal as a success', () => {
    // The one substantive branch: a screen that rendered the same string for
    // both would tell the user a routine appeared when nothing was written.
    const imported = routineImportOutcome({ kind: 'imported', name: 'Push' });
    const refused = routineImportOutcome({
      kind: 'refused',
      error: { code: 'no-planned-sets', message: 'That routine plans no sets.' },
    });
    expect(imported).not.toEqual(refused);
    expect(refused).not.toContain('Push');
  });
});
