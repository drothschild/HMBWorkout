/**
 * Rest-screen coach commentary: the prompt half.
 *
 * This is deliberately NOT `buildSystem`. The commentary call runs against a
 * ticking rest countdown, so the prompt carries exactly one exercise, its
 * targets, and its own recent working sets — not every routine, every recent
 * workout, and every exercise's history.
 *
 * TWO SHAPES, chosen by the caller from where the rest landed (#270):
 *
 *  - `lastSet` — the rest sits inside an exercise or superset group, so the
 *    remark is about the set the athlete just finished: its own numbers, read
 *    against that exercise's recent history.
 *  - `upNext` — the rest sits between two different exercises, so there is no
 *    "just finished" set worth talking about in the same breath as what is
 *    coming; the remark previews the upcoming exercise instead.
 *
 * The system half changes with the shape too. The old rule line "Comment on the
 * exercise that is coming up, not the one they just finished" is true for
 * `upNext` and flatly contradicts the data `lastSet` sends, so it is now
 * per-shape rather than unconditional.
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

/**
 * The exercise the remark is about, resolved shell-side. For `upNext` that is
 * the exercise about to be performed; for `lastSet` it is the one the completed
 * set was performed on, which in a superset group is NOT the entry the engine
 * has already advanced to.
 */
export interface RestCommentaryExercise {
  title: string;
  kind: ExerciseKind;
  warmupSets: number;
  targetSets: number;
  targetReps: number;
  targetDurationSeconds: number;
  restSeconds: number;
  /** True when the set this remark is about is a warmup set of this entry. */
  isWarmupSet: boolean;
  /** 1-based position within the run of same-typed sets. */
  setNumber: number;
  /**
   * How many sets of that same type the entry prescribes — `setNumber`'s
   * denominator (#276 AC3.4).
   *
   * Supplied by the caller from `deriveSetPosition`, which returns the pair
   * together, rather than recomputed here: the numerator and the denominator
   * must come from one reading of the plan or a label can claim "Set 3 of 2".
   * 0 means the entry prescribes nothing at this position, and `setPosition`
   * drops the segment.
   */
  totalOfType: number;
}

/**
 * What the athlete actually recorded on the set just finished. Every metric is
 * optional — the engine's sentinels (`rpe: -1`) are resolved to null by the
 * caller, and `formatSetMetrics` guards them a second time.
 */
export interface RestCommentaryCompletedSet {
  reps?: number | null;
  weightKg?: number | null;
  durationSeconds?: number | null;
  rpe?: number | null;
}

/** Which of the two remarks this prompt asks for. */
export type RestCommentaryShape = 'upNext' | 'lastSet';

interface RestCommentaryPromptCommon {
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

export type RestCommentaryPromptInput =
  | (RestCommentaryPromptCommon & { shape: 'upNext' })
  | (RestCommentaryPromptCommon & {
      shape: 'lastSet';
      completedSet: RestCommentaryCompletedSet;
    });

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

/**
 * The SECOND, independent set-position label builder (AGENTS.md names both).
 * It reaches `deriveSetPosition` through `restCommentaryTarget` and never
 * touches `sessionPresenter`, so a guard added there does not cover this one.
 *
 * PER-SET (#276 AC3.5): the denominator is the count of same-typed sets in the
 * entry's own list, carried in as `totalOfType`, and the zero-total guard is
 * now the empty-list guard transported. Both `## Up Next` and `## Last Set`
 * build their line through here, so one guard covers both shapes; the caller
 * drops an empty segment rather than printing a dangling separator.
 */
function setPosition(exercise: RestCommentaryExercise): string {
  if (exercise.totalOfType <= 0) return '';
  return exercise.isWarmupSet
    ? `Warmup ${exercise.setNumber} of ${exercise.totalOfType}`
    : `Set ${exercise.setNumber} of ${exercise.totalOfType}`;
}

/**
 * Render whatever a set actually recorded — shared by the history list and by
 * the completed-set line, so the two can never disagree about how a set reads.
 * Every metric can be blank, in which case this is the empty string and the
 * caller drops the segment rather than printing a dangling separator.
 *
 * The `rpe > 0` half of the RPE guard is not redundant with `!= null`: a
 * completed set arrives from engine state where an unset RPE is the -1 sentinel
 * (AGENTS.md engine convention 8), and a plain null check would put "RPE -1"
 * in front of the coach. The caller normalizes it too; this is layer two.
 */
function formatSetMetrics(set: RestCommentaryCompletedSet): string {
  const parts: string[] = [];

  if (set.reps != null) parts.push(`${set.reps} reps`);
  // Storage is canonical kg; the prompt speaks the display lbs the user sees.
  if (set.weightKg != null) parts.push(`@ ${formatWeightLbs(set.weightKg)}`);
  if (set.durationSeconds != null) parts.push(`${set.durationSeconds}s`);
  if (set.rpe != null && set.rpe > 0) parts.push(`RPE ${set.rpe}`);

  return parts.join(' ');
}

/**
 * A history set is its metrics plus the day it was logged.
 */
function formatHistorySet(set: RestCommentaryHistorySet): string {
  const metrics = formatSetMetrics(set);
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
 * The coach's brief, one per shape. They share their skeleton — a framing
 * paragraph, a "reply with" paragraph, a rule list opening on the same three
 * output rules — but not their text: the opening sentence, the whole second
 * paragraph and the closing rules all change with the shape. Read them as two
 * briefs, not one brief with a swapped line.
 */
const UP_NEXT_BRIEF = `You are a strength-training coach in a workout-logging app. The athlete is resting between sets and is about to perform the exercise described in the next message.

Reply with 1-2 short sentences about that upcoming exercise: a cue, a target to hit, or a read on their recent numbers. Speak to them directly.

Rules:
- Plain text only. No headings, lists, markdown, quotation marks, or preamble.
- Two sentences at most. They are reading this on a countdown screen.
- Only reference numbers that appear in the next message. Never invent history.
- Comment on the exercise that is coming up, not the one they just finished.`;

const LAST_SET_BRIEF = `You are a strength-training coach in a workout-logging app. The athlete has just finished the set described in the next message and is resting before the next one.

Reply with 1-2 short sentences about that set: a read on the numbers they just put up, or a cue to carry into the next one. Speak to them directly.

Rules:
- Plain text only. No headings, lists, markdown, quotation marks, or preamble.
- Two sentences at most. They are reading this on a countdown screen.
- Only reference numbers that appear in the next message. Never invent history.
- Comment on the set they just finished, not on some other exercise.
- The recent-sets list is this same exercise's own history and may already contain the set above. A listed set identical to it is that same set, not a second one: do not count it twice or treat it as prior evidence for itself. Every other set in the list, today's earlier sets included, is fair to compare against.`;

/**
 * Build the one-shot commentary prompt for whichever remark the rest calls for.
 *
 * The system half is the coach's brief and the output contract; the message
 * half is the data. Splitting them this way keeps the stable part stable, so
 * the two are not re-mixed per exercise.
 */
export function buildRestCommentaryPrompt(input: RestCommentaryPromptInput): RestCommentaryPrompt {
  const personality = input.personality?.trim();
  const directives = input.directives?.trim();

  const sections = [
    input.shape === 'lastSet' ? LAST_SET_BRIEF : UP_NEXT_BRIEF,
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
    // The `lastSet` shape leads with what was actually recorded; the plan
    // (target, rest) follows it as context rather than being the subject.
    input.shape === 'lastSet' ? formatSetMetrics(input.completedSet) : '',
    targetSummary(exercise),
    `rest ${exercise.restSeconds}s`,
  ].filter((segment) => segment.length > 0);

  // Neutralize the title like personality/directives: model-authored titles
  // could contain newlines that fabricate prompt sections.
  const exerciseLine = [
    `${neutralizeForPrompt(exercise.title)} (${exercise.kind})`,
    ...metricSegments,
  ].join(' | ');

  const heading = input.shape === 'lastSet' ? '## Last Set' : '## Up Next';

  const message = `${heading}

${exerciseLine}

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
