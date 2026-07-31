import { SetInputValues } from './sessionPresenter';

/**
 * Set-input text boundary: the session screen keeps the raw strings the user
 * typed and converts to numbers only here, on the way into the presenter.
 *
 * This shape exists because the previous wiring parsed every keystroke into
 * numeric state and rendered `state.toString()` back into the controlled
 * TextInput. A hardware keyboard bypasses decimal-pad, so a select-all-then-
 * type sequence could deliver a non-numeric string, `parseInt` it to NaN, and
 * render the literal "NaN" — after which every re-parse produced NaN again,
 * and because Object.is(NaN, NaN) is true, React treated each of those
 * setState calls as a no-op and never re-rendered, trapping the field.
 * Keeping text as text makes a rendered "NaN" structurally impossible; these
 * helpers are the only place set-input strings become numbers.
 */

/**
 * Parse one set-input field. Absent (`undefined`) — never NaN, and never a
 * coerced 0 — for anything that is not a plain non-negative number: empty or
 * whitespace text, non-numeric artifacts ("a", ".", "NaN5"), negatives, and
 * non-finite values. Trailing-garbage prefixes parse leniently ("5." is 5)
 * so mid-typing states stay usable.
 */
export function parseSetInputText(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;

  const parsed = parseFloat(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return parsed;
}

/**
 * Format a prefill (or any presenter-side number) for the text state.
 * Absent and non-finite values render as the empty string, so the
 * placeholder shows instead of "NaN"/"Infinity"/"0".
 */
export function formatSetInputValue(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '';
  return String(value);
}

export interface SetInputTexts {
  isDurationBased: boolean;
  repsText: string;
  weightText: string;
  durationText: string;
  rpe: number | undefined;
}

/**
 * Convert the raw input texts into the presenter's SetInputValues at the
 * Log Set boundary. Invalid or empty fields are omitted entirely (the host
 * treats absent metrics as "not logged"); reps and duration truncate to
 * whole numbers, weight keeps decimals; rpe passes through only when set
 * and positive, matching the slider's "cleared" state — and never at all
 * for duration-based (stretch/cardio) entries, which have no RPE concept.
 * This is defense in depth: the RPE UI is hidden for those entries too, but
 * a stray leftover value must never be logged even if it reaches here.
 */
export function buildLogSetValues(input: SetInputTexts): SetInputValues {
  const values: SetInputValues = {};

  if (input.isDurationBased) {
    const duration = parseSetInputText(input.durationText);
    if (duration !== undefined) values.durationSeconds = Math.trunc(duration);
  } else {
    const reps = parseSetInputText(input.repsText);
    if (reps !== undefined) values.reps = Math.trunc(reps);
    const weight = parseSetInputText(input.weightText);
    if (weight !== undefined) values.weightLbs = weight;

    if (input.rpe !== undefined && input.rpe > 0) values.rpe = input.rpe;
  }

  return values;
}
