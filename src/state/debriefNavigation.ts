import { router } from 'expo-router';

import { debriefRouteParams } from '@/state/postWorkoutDebrief';
import type { DebriefMode } from '@/ai/contextBuilder';

/**
 * Open the AI Coach on a debrief conversation.
 *
 * Deliberately thin, and the only reason this module exists: whether to open a
 * debrief and what it is about are decided in `postWorkoutDebrief.ts`, which
 * stays testable in the node jest project because it never imports the router.
 */
export function navigateToDebrief(mode: DebriefMode): void {
  router.push({ pathname: '/ai-coach', params: debriefRouteParams(mode) });
}
