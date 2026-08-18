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
 *
 * Returns `undefined` — "there is nothing to log" — when the result would
 * carry no measurement the session grammar can represent (#288). That return
 * type is the guard: `onLogSet` takes `SetInputValues`, so a call site cannot
 * forward this straight through without checking, and the compiler says so.
 * `setInputs.callSites.test.ts` covers the escape hatches (`!`, `?? {}`) that
 * would compile.
 *
 * The condition is `hasLoggableMetric` below, which mirrors
 * `buildSessionSetLine` (`src/interop/serialize.ts`) exactly and is no wider:
 * weight and rpe are flags on a line, not measurements, and cannot carry one
 * on their own — a strength line with a `weight=` flag and no `1x<reps>` slot
 * is refused by `parseSession` just as a bare one is. Before this, blanking
 * the reps field and tapping Log Set wrote such a set.
 *
 * What that cost is worth stating precisely, because the obvious reading is
 * wrong. `serializeSession` does **not** throw on a measurement-less set —
 * its only `throw` is for a set whose *exercise* cannot be resolved. It emits
 * `- bench-press: set_type=working` and returns normally, so the session
 * lands in the exported document and `exportSessionHistory` reports success
 * while producing markdown `parseSession` refuses. A silent bad document,
 * not a loud refusal, and the serializer still has no guard of its own.
 *
 * `setInputsSerializerMirror.test.ts` is the executable pin on the mirroring:
 * it drives this function's output through the real `serializeSession` and
 * `parseSession`, so a measurement added to one side and not the other goes
 * red rather than drifting.
 */
export function buildLogSetValues(input: SetInputTexts): SetInputValues | undefined {
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

  return hasLoggableMetric(values) ? values : undefined;
}

/**
 * True when these values carry a metric a logged-set line can actually state.
 *
 * The two arms mirror `buildSessionSetLine`'s own branch: `reps` becomes the
 * `1x<reps>` slot, and failing that `durationSeconds` becomes a `duration=`
 * flag. With neither, the emitted line has no measurement at all and
 * `parseSession` rejects it ("Strength exercise missing sets×reps").
 *
 * Both checks are `!== undefined`, never truthiness: `reps: 0` is a genuine
 * logged set of zero repetitions (PR #89, pinned by a roundtrip fixture) and
 * a `durationSeconds: 0` is the same shape. Collapsing zero into absent here
 * reinstates a regression this project already fixed once.
 *
 * **That preservation now holds end to end (fixed in #305).** `engine/index.ts`'s
 * `LogSet` conversion once applied three *undocumented* zero-sentinels —
 * `reps === 0`, `weightKg === 0` and `durationSeconds === 0` all became
 * `undefined` on the way into Rill — none of which were in
 * `SENTINEL_TO_OPTION_MAP`, the list convention 8 calls authoritative, so a
 * `reps: 0` this function correctly returns was persisted as a row with
 * neither reps nor duration: the #288 shape itself, arriving through a second
 * door. Those three fields now route through `toRillOptionalNumber` (only
 * null/undefined maps to Rill None), so a logged zero survives the boundary.
 * The end-to-end proof is in `setInputsSerializerMirror.test.ts` and
 * `engine/logSetZeroPreservation.test.ts`; the tests below still cover only
 * *this* boundary.
 *
 * `SetInputValues` has no distance field today, so a distance-only cardio set
 * — which the grammar would accept — is unreachable from these inputs. Widen
 * this predicate alongside the field if that ever changes.
 */
function hasLoggableMetric(values: SetInputValues): boolean {
  return values.reps !== undefined || values.durationSeconds !== undefined;
}
