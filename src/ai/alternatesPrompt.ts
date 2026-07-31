/**
 * Exercise alternates: the prompt half.
 *
 * Deliberately not `buildSystem`, for the same reason `restCommentaryPrompt`
 * is not: this is a one-shot question asked mid-workout about a single
 * exercise. It carries that exercise and the athlete's standing context, not
 * every routine, every recent workout, and every exercise's history.
 *
 * Like the rest of `src/ai` it carries data and never secrets — it is handed
 * goals, equipment and a personality string, and has no access to
 * `anthropicKey`/`token`/`baseUrl`. A regression test in
 * `src/state/exerciseReplaceStore.test.ts` asserts that at the wire.
 */

import type { ExerciseKind } from '@/engine/types';
import { ALTERNATE_TITLE_MAX_LENGTH, EXERCISE_ALTERNATES_MAX } from './alternatesSchema';

/**
 * How many alternates to ask for. Three is enough to be a choice and few
 * enough to read between sets; the validator's ceiling is the hard bound.
 */
export const EXERCISE_ALTERNATES_REQUESTED = 3;

/** The exercise being replaced, resolved shell-side (engine entries carry ids). */
export interface AlternatesPromptExercise {
  title: string;
  kind: ExerciseKind;
  warmupSets: number;
  targetSets: number;
  targetReps: number;
  targetDurationSeconds: number;
  restSeconds: number;
}

export interface AlternatesPromptInput {
  exercise: AlternatesPromptExercise;
  /** `aiGoals` from settings. */
  goals?: string;
  /** `aiEquipment` from settings — the binding constraint on a substitute. */
  equipment?: string;
  /** `aiPersonality` from settings. */
  personality?: string;
  /** Programmer behavioral directives; always rendered last. */
  directives?: string;
}

export interface AlternatesPrompt {
  system: string;
  message: string;
}

/**
 * User- and model-authored free text lands in a markdown-shaped prompt, so a
 * line starting with '#' would read as a section heading and could masquerade
 * as prompt structure. Same treatment `contextBuilder` gives routine notes and
 * `restCommentaryPrompt` gives titles.
 */
function neutralizeForPrompt(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*#+\s*/, ''))
    .join('\n');
}

function targetSummary(exercise: AlternatesPromptExercise): string {
  if (exercise.targetSets > 0 && exercise.targetReps > 0) {
    return `${exercise.targetSets}x${exercise.targetReps}`;
  }
  if (exercise.targetDurationSeconds > 0) {
    return `${exercise.targetSets > 0 ? `${exercise.targetSets} x ` : ''}${exercise.targetDurationSeconds}s`;
  }
  return 'no target recorded';
}

function section(heading: string, body?: string): string {
  const trimmed = body?.trim();
  return `## ${heading}\n\n${trimmed ? neutralizeForPrompt(trimmed) : 'Not specified.'}`;
}

/**
 * Build the one-shot alternates prompt.
 *
 * The system half is the brief and the output contract; the message half is
 * the exercise. Directives go last, after every section built from
 * user-controlled free text, so their precedence survives an injection attempt
 * planted in goals, equipment or personality — the placement `buildSystem`
 * uses, for the same reason.
 */
export function buildAlternatesPrompt(input: AlternatesPromptInput): AlternatesPrompt {
  const sections = [
    `You are a strength-training coach in a workout-logging app. The athlete is midway through a workout and wants to swap out the exercise described in the next message — the equipment is taken, it aggravates something, or they just want a different stimulus.

Propose ${EXERCISE_ALTERNATES_REQUESTED} substitutes, best first.

Rules:
- Every alternate must be the same kind of exercise as the original and train the same movement pattern and muscles.
- Do not change the sets, reps, duration or rest. Those belong to the plan, not to the exercise, and they carry over to whichever substitute is chosen.
- Prefer movements the athlete can do with the equipment listed below.
- Every alternate needs a non-empty title and a non-empty description.
- The title is the exercise name alone — no set or rep counts, and at most ${ALTERNATE_TITLE_MAX_LENGTH} characters.
- The description says how to perform it and why it substitutes for the original. Two or three sentences. This is all the athlete has to choose from, so make it concrete.
- Give ${EXERCISE_ALTERNATES_REQUESTED} options; never more than ${EXERCISE_ALTERNATES_MAX}.
- Every title must be different from the others. Two options with the same title are one option, and the response is rejected.`,
    section('Training Goals', input.goals),
    section('Available Equipment', input.equipment),
    section('Coaching Style', input.personality),
  ];

  const directives = input.directives?.trim();
  if (directives) {
    sections.push(`## Coaching Directives\n\n${neutralizeForPrompt(directives)}`);
  }

  const exercise = input.exercise;
  const warmupClause = exercise.warmupSets > 0 ? ` | ${exercise.warmupSets} warmup sets` : '';
  const line = [
    neutralizeForPrompt(exercise.title),
    `(${exercise.kind})`,
    '|',
    `target ${targetSummary(exercise)}`,
    `| rest ${exercise.restSeconds}s${warmupClause}`,
  ].join(' ');

  const message = `## Exercise To Replace\n\n${line}`;

  return { system: sections.join('\n\n'), message };
}
