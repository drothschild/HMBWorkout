import { OVERRIDABLE_DIRECTIVES, IMMUTABLE_DIRECTIVES } from './coachDirectives';
import { directivesSections } from './contextBuilder';

describe('coachDirectives: shipped constants', () => {
  // The programmer has filled both sections in (2026-07-31). These tests pin
  // the format contract, not the wording: one instruction per line, dash-led,
  // no markdown headings (a '## ' line could restructure the prompt), and no
  // blank-line runs that would break the composed prompt's whitespace hygiene.
  it('ships well-formed OVERRIDABLE_DIRECTIVES content', () => {
    expect(OVERRIDABLE_DIRECTIVES.trim()).not.toBe('');
    for (const line of OVERRIDABLE_DIRECTIVES.trim().split('\n')) {
      expect(line.trimStart().startsWith('- ')).toBe(true);
    }
    expect(OVERRIDABLE_DIRECTIVES).not.toMatch(/^#{1,6} /m);
    expect(OVERRIDABLE_DIRECTIVES).not.toMatch(/\n{3,}/);
  });

  it('ships well-formed IMMUTABLE_DIRECTIVES content', () => {
    expect(IMMUTABLE_DIRECTIVES.trim()).not.toBe('');
    for (const line of IMMUTABLE_DIRECTIVES.trim().split('\n')) {
      expect(line.trimStart().startsWith('- ')).toBe(true);
    }
    expect(IMMUTABLE_DIRECTIVES).not.toMatch(/^#{1,6} /m);
    expect(IMMUTABLE_DIRECTIVES).not.toMatch(/\n{3,}/);
  });
});

describe('coachDirectives: TRX bodyweight-only rule', () => {
  // TRX is a bodyweight-resistance tool, not a weight, and this is a safety/
  // correctness rule the coach must never be argued out of — so it belongs in
  // IMMUTABLE_DIRECTIVES, not OVERRIDABLE_DIRECTIVES. Pins the actual
  // bodyweight-not-weight semantics (not just the substring "TRX"): a line
  // that merely mentions TRX without both the "never prescribe/reference a
  // weight/load value" rule and the "bodyweight, not a weight" rationale
  // still fails this test.
  it('forbids the coach from ever prescribing or referencing a weight/load value for TRX', () => {
    const trxLine = IMMUTABLE_DIRECTIVES.split('\n').find((line) => line.includes('TRX'));

    expect(trxLine).toBeDefined();
    expect(trxLine!.trimStart().startsWith('- Never')).toBe(true);
    expect(trxLine).toContain('weight/load value');
    expect(trxLine).toContain('bodyweight');
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
