/**
 * Rest-screen coach commentary: the prompt half.
 *
 * This is deliberately NOT `buildSystem`. The commentary call runs against a
 * ticking rest countdown and is budgeted at one call per upcoming routine entry
 * per session, so the prompt carries exactly one exercise, its targets, and its
 * own recent working sets — not every routine, every recent workout, and every
 * exercise's history.
 *
 * Like `contextBuilder`, this prompt carries data and never secrets: it is
 * handed a personality string and a history list, and has no access to
 * `anthropicKey`. A regression test in
 * `src/state/restCommentaryStore.test.ts` asserts that at the wire.
 */

import type { ExerciseKind } from '@/engine/types';
import { formatWeightLbs } from '@/state/weightUnits';

/**
 * How many recent working sets ride along. Small on purpose — the model needs
 * enough to read a trend, not a training log.
 */
export const REST_COMMENTARY_HISTORY_SETS = 5;

/**
 * The longest comment the rest screen will render. A runaway response would
 * otherwise push the countdown and controls around mid-rest.
 */
export const REST_COMMENTARY_MAX_CHARS = 400;

/** One prior working set, flattened off the DB model by `restCommentaryHistory`. */
export interface RestCommentaryHistorySet {
  reps?: number | null;
  weightKg?: number | null;
  durationSeconds?: number | null;
  rpe?: number | null;
  /** The UTC day the set was logged (YYYY-MM-DD), or null when unknown. */
  loggedDate?: string | null;
}

/** The exercise the athlete is about to perform, resolved shell-side. */
export interface RestCommentaryExercise {
  title: string;
  kind: ExerciseKind;
  warmupSets: number;
  targetSets: number;
  targetReps: number;
  targetDurationSeconds: number;
  restSeconds: number;
  /** True when the upcoming set is a warmup set of this entry. */
  isWarmupSet: boolean;
  /** 1-based position within the warmup or working segment. */
  setNumber: number;
}

export interface RestCommentaryPromptInput {
  exercise: RestCommentaryExercise;
  /** Most recent first; anything past REST_COMMENTARY_HISTORY_SETS is dropped. */
  history: RestCommentaryHistorySet[];
  /** `aiPersonality` from settings. */
  personality?: string;
  /** `IMMUTABLE_DIRECTIVES` from `src/ai/coachDirectives.ts`. */
  directives?: string;
  /** `profileAge` from settings. */
  profileAge?: string;
  /** `profileExperience` from settings. */
  profileExperience?: string;
}

export interface RestCommentaryPrompt {
  system: string;
  message: string;
}

/**
 * User free text (personality, directives, exercise titles) is dropped into a
 * markdown-shaped prompt, so a line starting with '#' would read as a section
 * heading and could masquerade as prompt structure. Same treatment `contextBuilder`
 * gives routine notes.
 *
 * NOTE: This is duplicated from `src/ai/contextBuilder.ts:neutralizeNotesForPrompt`
 * and `src/ai/exerciseQuestionPrompt.ts:neutralizeForPrompt`. Hoisting all three
 * into a shared helper is tracked as accepted debt in AGENTS.md.
 */
function neutralizeForPrompt(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*#+\s*/, ''))
    .join('\n');
}

function targetSummary(exercise: RestCommentaryExercise): string {
  if (exercise.targetSets > 0 && exercise.targetReps > 0) {
    return `target ${exercise.targetSets}x${exercise.targetReps}`;
  }
  if (exercise.targetDurationSeconds > 0) {
    return `target ${exercise.targetDurationSeconds}s`;
  }
  return 'no target recorded';
}

function setPosition(exercise: RestCommentaryExercise): string {
  const totalPlanned = exercise.warmupSets + exercise.targetSets;
  if (totalPlanned === 0) return '';
  return exercise.isWarmupSet
    ? `Warmup ${exercise.setNumber} of ${exercise.warmupSets}`
    : `Set ${exercise.setNumber} of ${exercise.targetSets}`;
}

/**
 * Render whatever a prior set actually recorded. Every metric can be blank, in
 * which case this is the empty string and the caller drops the line rather than
 * printing a dangling separator.
 */
function formatHistorySet(set: RestCommentaryHistorySet): string {
  const parts: string[] = [];

  if (set.reps != null) parts.push(`${set.reps} reps`);
  // Storage is canonical kg; the prompt speaks the display lbs the user sees.
  if (set.weightKg != null) parts.push(`@ ${formatWeightLbs(set.weightKg)}`);
  if (set.durationSeconds != null) parts.push(`${set.durationSeconds}s`);
  if (set.rpe != null) parts.push(`RPE ${set.rpe}`);

  const metrics = parts.join(' ');
  if (metrics === '') return '';

  return set.loggedDate ? `${metrics} (${set.loggedDate})` : metrics;
}

function historySection(history: RestCommentaryHistorySet[]): string {
  const lines = history
    .slice(0, REST_COMMENTARY_HISTORY_SETS)
    .map(formatHistorySet)
    .filter((line) => line.length > 0)
    .map((line) => `  ${line}`);

  if (lines.length === 0) {
    return `## Recent Working Sets

No previous working sets logged for this exercise.`;
  }

  return `## Recent Working Sets

Most recent first. Warmups are excluded.
${lines.join('\n')}`;
}

/**
 * Build the one-shot commentary prompt for the upcoming exercise.
 *
 * The system half is the coach's brief and the output contract; the message
 * half is the data. Splitting them this way keeps the stable part stable, so
 * the two are not re-mixed per exercise.
 */
export function buildRestCommentaryPrompt(input: RestCommentaryPromptInput): RestCommentaryPrompt {
  const personality = input.personality?.trim();
  const directives = input.directives?.trim();

  const sections = [
    `You are a strength-training coach in a workout-logging app. The athlete is resting between sets and is about to perform the exercise described in the next message.

Reply with 1-2 short sentences about that upcoming exercise: a cue, a target to hit, or a read on their recent numbers. Speak to them directly.

Rules:
- Plain text only. No headings, lists, markdown, quotation marks, or preamble.
- Two sentences at most. They are reading this on a countdown screen.
- Only reference numbers that appear in the next message. Never invent history.
- Comment on the exercise that is coming up, not the one they just finished.`,
    `## Coaching Style

${personality ? neutralizeForPrompt(personality) : 'Not specified.'}`,
  ];

  // About-the-User section, before directives, only when profile has at least one field
  const profileParts: string[] = [];
  if (input.profileAge) profileParts.push(`Age: ${neutralizeForPrompt(input.profileAge)}`);
  if (input.profileExperience) profileParts.push(`Experience: ${neutralizeForPrompt(input.profileExperience)}`);

  if (profileParts.length > 0) {
    sections.push(`## About the User

${profileParts.join('\n')}`);
  }

  if (directives) {
    sections.push(`## Coaching Directives

${neutralizeForPrompt(directives)}`);
  }

  const exercise = input.exercise;
  const metricSegments = [
    setPosition(exercise),
    targetSummary(exercise),
    `rest ${exercise.restSeconds}s`,
  ].filter((segment) => segment.length > 0);

  // Neutralize the title like personality/directives: model-authored titles
  // could contain newlines that fabricate prompt sections.
  const upNext = [
    `${neutralizeForPrompt(exercise.title)} (${exercise.kind})`,
    ...metricSegments,
  ].join(' | ');

  const message = `## Up Next

${upNext}

${historySection(input.history)}`;

  return { system: sections.join('\n\n'), message };
}

/**
 * Squeeze a model response into something the rest screen can render: one
 * paragraph, no wrapping quotes, bounded length. Returns null when there is
 * nothing left — the caller treats that as "no commentary", never as an empty
 * bubble.
 */
export function normalizeCommentaryText(raw: string): string | null {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  // The model occasionally wraps the whole comment in quotes despite the rule.
  const unquoted = collapsed.replace(/^["'“”]+/, '').replace(/["'“”]+$/, '').trim();

  if (unquoted.length === 0) return null;
  if (unquoted.length <= REST_COMMENTARY_MAX_CHARS) return unquoted;

  return `${unquoted.slice(0, REST_COMMENTARY_MAX_CHARS - 1).trimEnd()}…`;
}
