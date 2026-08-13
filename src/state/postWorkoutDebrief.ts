/**
 * The handoff from a finished workout to a debrief conversation: whether one
 * opens at all, and how the mode survives the trip through the route.
 *
 * Pure decisions only — the navigation that acts on them is a one-liner in
 * `debriefNavigation.ts`, and the conversation itself belongs to `aiChatStore`.
 */

import type { AiCoachMode, DebriefMode } from '@/ai/contextBuilder';
import { hasAiKey } from '@/state/hasAiKey';

export interface FinishedWorkout {
  routineId: string;
  sessionId: string;
}

/**
 * The user's opening turn. The Messages API needs a user message before the
 * coach can speak, and this is a true statement of what just happened; the
 * persona is what makes the coach answer it by asking how the workout went.
 */
export const DEBRIEF_OPENING_MESSAGE = 'I just finished this workout.';

/**
 * Decide whether a finished workout opens a debrief, and about what.
 *
 * Returns null when the chat cannot or should not run — with no API key
 * configured there is nothing to talk to, and completion carries on exactly as before.
 */
export function planPostWorkoutDebrief(
  finished: FinishedWorkout,
  settings: { anthropicKey?: string; openaiKey?: string }
): DebriefMode | null {
  if (!hasAiKey(settings)) {
    return null;
  }

  // A debrief needs a session to summarise and a routine to revise; without
  // either there is nothing for the coach to work from.
  if (finished.routineId.trim() === '' || finished.sessionId.trim() === '') {
    return null;
  }

  return {
    kind: 'debrief',
    routineId: finished.routineId,
    sessionId: finished.sessionId,
  };
}

export interface AiCoachRouteParams {
  routineId?: string;
  debriefSessionId?: string;
  onboarding?: '1' | true;
}

/** Encode a debrief mode as route params for the ai-coach screen. */
export function debriefRouteParams(
  mode: DebriefMode
): { routineId: string; debriefSessionId: string } {
  return {
    routineId: mode.routineId,
    debriefSessionId: mode.sessionId,
  };
}

/**
 * Decode the ai-coach screen's route params back into a conversation mode.
 * Onboarding param takes priority over routineId branches, so ?onboarding=1&routineId=X
 * still yields onboarding mode.
 * A debrief needs both halves; a session id on its own names no routine to
 * revise, so it degrades to a fresh conversation rather than a broken debrief.
 */
export function aiCoachModeFromParams(params: AiCoachRouteParams): AiCoachMode {
  // Onboarding takes priority over routineId branches
  if (params.onboarding === '1' || params.onboarding === true) {
    return { kind: 'onboarding' };
  }

  const routineId = params.routineId;

  if (!routineId) {
    return { kind: 'create' };
  }

  if (params.debriefSessionId) {
    return { kind: 'debrief', routineId, sessionId: params.debriefSessionId };
  }

  return { kind: 'edit', routineId };
}
