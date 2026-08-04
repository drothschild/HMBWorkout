/**
 * Exercise-question coach prompt: the "?" button on the session screen's
 * current in-progress exercise.
 *
 * One-shot, like the rest-screen commentary this mirrors, but answering a
 * different question: not "what's coming up," but "how do I do this
 * exercise." The prompt carries exactly one exercise (title, kind, its own
 * existing description if any) plus the coach personality — no working-set
 * history, no other routine entries.
 *
 * Like `contextBuilder` and `restCommentaryPrompt`, this prompt carries data
 * and never secrets: it is handed a personality string and an exercise
 * description, and has no access to `anthropicKey`/`token`/`baseUrl`. A
 * regression test in `src/state/exerciseQuestionStore.test.ts` asserts that
 * at the wire, the same way `restCommentaryStore.test.ts` does for the rest
 * screen.
 */

import type { ExerciseKind } from '@/engine/types';

/**
 * The longest answer the inline expand block will render. A "detailed
 * how-to" runs longer than the rest screen's 1-2 sentences (see
 * `REST_COMMENTARY_MAX_CHARS` in `restCommentaryPrompt.ts`), but is still
 * bounded so a runaway response can't turn the session screen into a wall of
 * text.
 */
export const EXERCISE_QUESTION_MAX_CHARS = 2000;

/** The exercise the athlete tapped the question button on, resolved shell-side. */
export interface ExerciseQuestionExercise {
  title: string;
  kind: ExerciseKind;
  /** The exercise's own user-authored description, if any. Absent or null both read as "no notes". */
  description?: string | null;
}

export interface ExerciseQuestionPromptInput {
  exercise: ExerciseQuestionExercise;
  /** `aiPersonality` from settings. */
  personality?: string;
  /** `IMMUTABLE_DIRECTIVES` from `src/ai/coachDirectives.ts`. */
  directives?: string;
}

export interface ExerciseQuestionPrompt {
  system: string;
  message: string;
}

/**
 * User free text (personality, exercise titles, exercise descriptions) is
 * dropped into a markdown-shaped prompt, so a line starting with '#' would
 * read as a section heading and could masquerade as prompt structure. Same
 * treatment `contextBuilder` gives routine notes and `restCommentaryPrompt`
 * gives personality/directives/titles.
 *
 * NOTE: This is duplicated from `src/ai/contextBuilder.ts:neutralizeNotesForPrompt`
 * and `src/ai/restCommentaryPrompt.ts:neutralizeForPrompt`. A follow-up PR
 * should hoist all three into a shared helper.
 */
function neutralizeForPrompt(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*#+\s*/, ''))
    .join('\n');
}

/**
 * Build the one-shot "explain this exercise" prompt.
 *
 * The system half is the coach's brief and output contract; the message half
 * is the data (the exercise itself). Splitting them this way keeps the
 * stable part stable, matching `buildRestCommentaryPrompt`.
 */
export function buildExerciseQuestionPrompt(
  input: ExerciseQuestionPromptInput
): ExerciseQuestionPrompt {
  const personality = input.personality?.trim();
  const directives = input.directives?.trim();
  const exercise = input.exercise;
  // Neutralize the title like personality/description: a model-authored or
  // user-authored title could contain newlines that fabricate prompt sections.
  const title = neutralizeForPrompt(exercise.title);

  const sections = [
    `You are a strength-training coach in a workout-logging app. The athlete is mid-workout and tapped a question mark next to the exercise described in the next message because they want a detailed how-to.

Reply with a clear, detailed explanation of the exercise: setup, proper form and technique, breathing, and common mistakes to avoid. Write a few short paragraphs.

Rules:
- Plain text only. No markdown syntax (no #, *, **, backticks, numbered or bulleted lists).
- Only explain the exercise named in the next message. Never invent or substitute a different exercise.
- If the athlete's own notes are included, take them into account, but do not just repeat them verbatim.`,
    `## Coaching Style

${personality ? neutralizeForPrompt(personality) : 'Not specified.'}`,
  ];

  if (directives) {
    sections.push(`## Coaching Directives

${neutralizeForPrompt(directives)}`);
  }

  const system = sections.join('\n\n');

  const descriptionText = exercise.description?.trim();
  const message = `## Exercise

${title} (${exercise.kind})

## Existing Notes

${descriptionText ? neutralizeForPrompt(descriptionText) : 'No notes recorded for this exercise.'}`;

  return { system, message };
}

/**
 * Squeeze a model response into something the session screen can render
 * inline: no wrapping quotes, bounded length, paragraph breaks preserved
 * (unlike the rest-screen comment, this answer is long enough that
 * paragraph structure helps readability). Returns null when there is
 * nothing left — the caller treats that as "no answer", never as an empty
 * expanded block.
 */
export function normalizeExerciseAnswerText(raw: string): string | null {
  const trimmed = raw.trim();
  // The model occasionally wraps the whole answer in quotes despite the rule.
  const unquoted = trimmed.replace(/^["'“”]+/, '').replace(/["'“”]+$/, '').trim();

  if (unquoted.length === 0) return null;

  // Collapse runs of 2+ blank lines down to exactly one blank line (a single
  // paragraph break), so a verbose model doesn't leave big gaps.
  const collapsed = unquoted.replace(/\n{3,}/g, '\n\n');

  if (collapsed.length <= EXERCISE_QUESTION_MAX_CHARS) return collapsed;

  return `${collapsed.slice(0, EXERCISE_QUESTION_MAX_CHARS - 1).trimEnd()}…`;
}
