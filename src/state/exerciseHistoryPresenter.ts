import { Database, Q } from '@nozbe/watermelondb';

import SessionSet from '@/db/models/SessionSet';
import { getExerciseSetHistory } from '@/db/repository';
import { formatSessionDate } from './sessionHistoryPresenter';
import { formatSetLine } from './sessionPresenter';

export interface ExerciseHistorySet {
  id: string;
  label: string;
  line: string;
  setType: string;
}

export interface ExerciseHistoryWorkout {
  sessionId: string;
  endedAt: number;
  dateLabel: string;
  sets: ExerciseHistorySet[];
}

function formatHistorySet(set: SessionSet, label: string): ExerciseHistorySet {
  return {
    id: set.id,
    label,
    setType: set.setType,
    line: formatSetLine(
      set.setType,
      set.reps ?? null,
      set.weightKg ?? null,
      set.durationSeconds ?? null,
      set.rpe ?? null
    ),
  };
}

/**
 * Build an exercise's complete read-only history from finished workouts.
 * Workouts are newest first; sets retain their logged order within a workout.
 */
export async function exerciseHistoryPresenter(
  db: Database,
  exerciseId: string
): Promise<ExerciseHistoryWorkout[]> {
  const sets = await getExerciseSetHistory(db, exerciseId);
  if (sets.length === 0) return [];

  const sessionIds = [...new Set(sets.map((set) => set.sessionId))];
  const sessions = (await db
    .get('sessions')
    .query(Q.and(Q.where('id', Q.oneOf(sessionIds)), Q.where('ended_at', Q.notEq(null))))
    .fetch()) as any[];

  const setsBySession = new Map<string, SessionSet[]>();
  for (const set of sets) {
    if (!setsBySession.has(set.sessionId)) setsBySession.set(set.sessionId, []);
    setsBySession.get(set.sessionId)!.push(set);
  }

  return sessions
    .map((session): ExerciseHistoryWorkout => {
      const sessionSets = setsBySession.get(session.id) ?? [];
      sessionSets.sort((a, b) => a.position - b.position);

      let warmupCount = 0;
      let regularCount = 0;
      const formattedSets = sessionSets.map((set) =>
        formatHistorySet(
          set,
          set.setType === 'warmup'
            ? `Warmup ${++warmupCount}`
            : `Set ${++regularCount}`
        )
      );
      const endedAt = session._raw.ended_at as number;

      return {
        sessionId: session.id,
        endedAt,
        dateLabel: formatSessionDate(endedAt),
        sets: formattedSets,
      };
    })
    .sort((a, b) => b.endedAt - a.endedAt);
}
