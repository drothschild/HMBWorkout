// pattern: Functional Core

/**
 * AI Coach error bubble colors, constrained by WCAG AA contrast (4.5:1
 * minimum for normal text).
 *
 * Text: #CC0000 (dark red) achieves 4.93:1 against background #FFE5E5,
 * clearing the 4.5:1 AA minimum. 6-digit hex form is required by the
 * contrastRatio() parser.
 */
export const AiCoachErrorColors = {
  bubbleBackground: '#FFE5E5',
  bubbleText: '#CC0000',
} as const;
