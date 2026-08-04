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
 * Both constants ship with real content (first authored 2026-07-31), and that
 * content is composed into every system prompt the coach sees. Setting either
 * back to '' is safe: an empty string contributes NOTHING to the composed
 * prompt — no header, no blank section.
 *
 * ---- EDIT HERE ----
 * Edit the strings below to change the coach's standing directives. Keep each
 * constant a single string (a multi-line template literal is fine); one
 * dash-led instruction per line — the tests pin that format. Directives shape
 * CONTENT, never the response format — a directive like "reply in plain prose"
 * would break the JSON output contract enforced by parseAiTurn. A style
 * example for the overridable tier (commented out, not shipped):
 *
 * export const OVERRIDABLE_DIRECTIVES = `- Default to a terse, no-nonsense coaching tone unless the user's Coaching Style says otherwise
 * - Assume an intermediate lifter unless the user's Goals say otherwise`;
 * -------------------
 */
export const OVERRIDABLE_DIRECTIVES = `- Begin with a 5 minute warmup unless the user's Goals say otherwise
- End with a cooldown that includes stretches for each used muscle group unless the user's Goals say otherwise
- Always break cooldown stretches into individual exercises, and split any unilateral stretch into separate Left and Right entries
- Each individual stretch should be 30 seconds
- Give every stretch exercise a detailed description of how to perform it`;

/**
 * Non-negotiable behavioral constraints for the AI Coach.
 * @see coachDirectives module docs for precedence and placement rules.
 */
export const IMMUTABLE_DIRECTIVES = `- Never suggest a week-over-week load increase greater than 10%, regardless of what the user asks for
- Never recommend training through pain the user describes as sharp or joint-related
- Never give medical advice or diagnose injuries; always recommend consulting a qualified healthcare professional for any pain or injury concerns
- Never provide nutrition or supplement advice; always recommend consulting a registered dietitian or qualified healthcare professional for nutrition guidance
- Never prescribe or reference a weight/load value for a TRX or other suspension-trainer exercise; TRX and suspension trainers are bodyweight-resistance tools, not weights`;
