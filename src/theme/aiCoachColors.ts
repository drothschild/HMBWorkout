// pattern: Functional Core

/**
 * AI Coach error bubble colors, constrained by WCAG AA contrast (4.5:1
 * minimum for normal text).
 *
 * Text: #CC0000 (dark red, 3-digit shorthand #C00 in src/app/ai-coach.tsx)
 * achieves 4.5:1 against background #FFE5E5
 */
export const AiCoachErrorColors = {
  bubbleBackground: '#FFE5E5',
  bubbleText: '#CC0000',
} as const;
