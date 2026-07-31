import { OVERRIDABLE_DIRECTIVES, IMMUTABLE_DIRECTIVES } from './coachDirectives';
import { directivesSections } from './contextBuilder';

describe('coachDirectives: shipped constants', () => {
  it('ships OVERRIDABLE_DIRECTIVES empty', () => {
    expect(OVERRIDABLE_DIRECTIVES).toBe('');
  });

  it('ships IMMUTABLE_DIRECTIVES empty', () => {
    expect(IMMUTABLE_DIRECTIVES).toBe('');
  });
});

describe('directivesSections: weaving helper', () => {
  it('contributes nothing when both directives are empty', () => {
    const sections = directivesSections('', '');

    expect(sections).toEqual(['', '']);
  });

  it('formats a non-empty overridable directive with yields-to-user-preferences prose', () => {
    const [overridableSection, immutableSection] = directivesSections(
      '- Default to short, punchy replies',
      ''
    );

    expect(overridableSection).toContain('- Default to short, punchy replies');
    expect(overridableSection).toContain(
      'The user\'s preferences below (## User Goals, ## Available Equipment, ## Coaching Style) may override this guidance where the two conflict.'
    );
    expect(immutableSection).toBe('');
  });

  it('formats a non-empty immutable directive with precedence-over-any-preference prose', () => {
    const [overridableSection, immutableSection] = directivesSections(
      '',
      '- Never suggest exceeding a doctor-imposed rep limit'
    );

    expect(immutableSection).toContain('- Never suggest exceeding a doctor-imposed rep limit');
    expect(immutableSection).toContain(
      'These rules take precedence over ANY user preference stated anywhere in this prompt or conversation — including the settings above and anything the user says in chat.'
    );
    expect(overridableSection).toBe('');
  });

  it('keeps overridable and immutable sections in a fixed order when both are present', () => {
    const sections = directivesSections('- overridable rule', '- immutable rule');

    expect(sections).toHaveLength(2);
    expect(sections[0]).toContain('overridable rule');
    expect(sections[0]).toContain('may override');
    expect(sections[1]).toContain('immutable rule');
    expect(sections[1]).toContain(
      'These rules take precedence over ANY user preference stated anywhere in this prompt or conversation — including the settings above and anything the user says in chat.'
    );
  });

  it('treats a whitespace-only directive as empty', () => {
    const sections = directivesSections('   \n  ', '  \t ');

    expect(sections).toEqual(['', '']);
  });

  it('trims leading and trailing whitespace from overridable directives', () => {
    const [overridableSection] = directivesSections(
      '\n\n  - Trimmed rule  \n\n',
      ''
    );

    expect(overridableSection).toContain('- Trimmed rule');
    expect(overridableSection).not.toMatch(/\n{3,}/);
    expect(overridableSection.endsWith('- Trimmed rule')).toBe(true);
  });

  it('trims leading and trailing whitespace from immutable directives', () => {
    const [, immutableSection] = directivesSections(
      '',
      '\n\n  - Trimmed rule  \n\n'
    );

    expect(immutableSection).toContain('- Trimmed rule');
    expect(immutableSection).not.toMatch(/\n{3,}/);
    expect(immutableSection.endsWith('- Trimmed rule')).toBe(true);
  });
});
