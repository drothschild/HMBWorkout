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
    expect(overridableSection).toMatch(/preferences below/i);
    expect(overridableSection).toMatch(/may override/i);
    expect(immutableSection).toBe('');
  });

  it('formats a non-empty immutable directive with precedence-over-any-preference prose', () => {
    const [overridableSection, immutableSection] = directivesSections(
      '',
      '- Never suggest exceeding a doctor-imposed rep limit'
    );

    expect(immutableSection).toContain('- Never suggest exceeding a doctor-imposed rep limit');
    expect(immutableSection).toMatch(/precedence over ANY user preference/);
    expect(overridableSection).toBe('');
  });

  it('keeps overridable and immutable sections in a fixed order when both are present', () => {
    const sections = directivesSections('- overridable rule', '- immutable rule');

    expect(sections).toHaveLength(2);
    expect(sections[0]).toContain('overridable rule');
    expect(sections[0]).toMatch(/may override/i);
    expect(sections[1]).toContain('immutable rule');
    expect(sections[1]).toMatch(/precedence over ANY user preference/);
  });

  it('treats a whitespace-only directive as empty', () => {
    const sections = directivesSections('   \n  ', '  \t ');

    expect(sections).toEqual(['', '']);
  });
});
