/**
 * Programmer-authored behavioral instructions for the AI Coach.
 *
 * This module is the *place* the person shipping the app writes standing
 * instructions for the coach's behavior, as opposed to `aiGoals`/
 * `aiEquipment`/`aiPersonality` (`src/state/settings.ts`), which are the
 * *user's own* preferences, editable from the AI Coach settings screen.
 *
 * `directivesSections` in `contextBuilder.ts` weaves these two constants into
 * the system prompt built by `buildSystem` — see that file's comment for how
 * placement is chosen so the precedence rules below actually hold for an LLM.
 *
 * Two constants, two precedence tiers:
 *
 * - `OVERRIDABLE_DIRECTIVES` — default behavior. The user's own goals,
 *   equipment, and coaching-style preferences (`aiGoals`/`aiEquipment`/
 *   `aiPersonality`) can override anything written here when they conflict.
 *   Use this for defaults the coach should follow only until the user says
 *   otherwise: a default coaching tone, a default assumption about
 *   experience level, a nudge toward a particular training philosophy.
 *   Never put a safety rule or a hard business constraint here — a user
 *   preference can, and is meant to, cancel it out.
 *
 * - `IMMUTABLE_DIRECTIVES` — non-negotiable. These rules hold no matter what
 *   `aiGoals`/`aiEquipment`/`aiPersonality` say, and no matter what the user
 *   types into the chat itself. Use this for safety constraints, business
 *   rules, or anything that must never be argued away by user input. Treat
 *   every user-controlled field and every chat turn as untrusted with
 *   respect to these rules — the same way a system prompt treats the
 *   contents of a user turn.
 *
 * Both ship empty ('') on purpose: this module is the place to write
 * directives, not a location for actual policy. An empty string contributes
 * NOTHING to the composed prompt — no header, no blank section — so the
 * shipped system prompt is byte-identical to what `buildSystem` produced
 * before this module existed.
 *
 * ---- EDIT HERE ----
 * Replace either empty string below to add directives. Keep each constant a
 * single string (a multi-line template literal is fine); one instruction per
 * line reads best once it lands in the composed prompt. Directives shape
 * CONTENT, never the response format — a directive like "reply in plain prose"
 * would break the JSON output contract enforced by parseAiTurn. For example
 * (commented out — this is style guidance, not shipped policy):
 *
 * export const OVERRIDABLE_DIRECTIVES = `- Default to a terse, no-nonsense coaching tone unless the user's Coaching Style says otherwise
 * - Assume an intermediate lifter unless the user's Goals say otherwise`;
 *
 * export const IMMUTABLE_DIRECTIVES = `- Never suggest a week-over-week load increase greater than 10%, regardless of what the user asks for
 * - Never recommend training through pain the user describes as sharp or joint-related`;
 * -------------------
 */
export const OVERRIDABLE_DIRECTIVES = '';

/**
 * Non-negotiable behavioral constraints for the AI Coach.
 * @see coachDirectives module docs for precedence and placement rules.
 */
export const IMMUTABLE_DIRECTIVES = '';
