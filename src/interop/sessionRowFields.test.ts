/**
 * Which fields the SESSION serializer actually reads off a `routine_exercises`
 * row — executed, not asserted in prose (#276 Phase 6 review).
 *
 * This exists because the prose was wrong three times running. `RoutineExerciseRow`
 * carried four dead aggregate fields that Phase 5 spotted as two; Phase 6
 * removed all four and left `order` and `notes`, which had never been
 * aggregates and were simply never read; and AGENTS.md asserted in the same
 * breath that the session path read `notes`. Every one of those was a claim of
 * the form "X reads only A, B, C" that nobody executed.
 *
 * So execute it. Each field gets a marker distinct enough to grep the output
 * for, and the test states which markers appear. A field added to the row type
 * and then read on this path fails the "reads nothing else" case; a field
 * whose reader is deleted fails its own case. Either way the type and its
 * readers cannot drift apart silently again.
 *
 * The routine document is a separate contract with a separate inline row type
 * (`serializeRoutine` is the reader of `notes`, as `@hint`), and is covered by
 * the roundtrip suite rather than here.
 */

import { serializeSession } from './serialize';
import type { SetType } from '@/db/models/SessionSet';
import type { ExerciseKind } from '@/db/models/Exercise';

const MARKERS = {
  id: 're-marker-id',
  exerciseId: 'exercise-marker-id',
  supersetGroup: 'SUPERSET_MARKER',
  restSeconds: 1234,
} as const;

/**
 * Serialize one logged set against a row carrying every marker, plus whatever
 * extra fields a caller wants to probe. `extra` is deliberately untyped: the
 * point is to hand the serializer fields the type does NOT declare and watch
 * them go unread.
 */
function serializeWithMarkers(extra: Record<string, unknown> = {}): string {
  return serializeSession(
    {
      id: 'sess-marker',
      routineId: 'ROUTINEID_MARKER',
      startedAt: new Date('2026-01-01T00:00:00Z'),
      endedAt: new Date('2026-01-01T01:00:00Z'),
      createdAt: new Date('2026-01-01T00:00:00Z'),
      customSyncStatus: 'SYNCSTATUS_MARKER',
    },
    [
      {
        routineExerciseId: MARKERS.id,
        exerciseId: MARKERS.exerciseId,
        setType: 'working' as SetType,
        reps: 5,
        weightKg: 60,
        position: 0,
      },
    ],
    [
      {
        id: MARKERS.id,
        exerciseId: MARKERS.exerciseId,
        supersetGroup: MARKERS.supersetGroup,
        restSeconds: MARKERS.restSeconds,
        ...extra,
      } as any,
    ],
    [{ id: MARKERS.exerciseId, title: 'Marker Exercise', kind: 'strength' as ExerciseKind }]
  );
}

describe('what serializeSession reads off a routine_exercises row', () => {
  it('reads supersetGroup and restSeconds onto the line', () => {
    const line = serializeWithMarkers()
      .split('\n')
      .find((l) => l.startsWith('- '))!;

    expect(line).toContain(`superset=${MARKERS.supersetGroup}`);
    // 1234s formatted by `formatFlags`'s m:ss rule.
    expect(line).toContain('rest=20:34');
  });

  it('reads the set`s own exercise_id stamp as the line identity', () => {
    const line = serializeWithMarkers()
      .split('\n')
      .find((l) => l.startsWith('- '))!;

    expect(line.startsWith(`- ${MARKERS.exerciseId}:`)).toBe(true);
  });

  it('reads NOTHING else off the row — `order` and `notes` in particular', () => {
    // Both were declared on `RoutineExerciseRow` and mapped in
    // `exportService.ts`, and AGENTS.md claimed `notes` was read here. Handed
    // in anyway, as fields the type no longer declares: neither reaches the
    // document. `notes` is the routine path's `@hint` and belongs to
    // `serializeRoutine`'s own row type.
    const markdown = serializeWithMarkers({
      order: 987654,
      notes: 'NOTES_MARKER',
      hint: 'HINT_MARKER',
    });

    expect(markdown).not.toContain('987654');
    expect(markdown).not.toContain('NOTES_MARKER');
    expect(markdown).not.toContain('HINT_MARKER');
  });

  it('reads neither `routineId` nor `customSyncStatus` off the session row', () => {
    // Two more fields declared on the session-row parameter with no reader.
    // Left in place rather than deleted alongside `order`/`notes`: unlike those,
    // a workout document that never names its routine looks more like a gap in
    // the grammar than dead weight, and deciding that is a contract change
    // rather than a sweep. Pinned here so the next reader does not have to
    // rediscover which of the two situations they are in.
    const markdown = serializeWithMarkers();

    expect(markdown).not.toContain('ROUTINEID_MARKER');
    expect(markdown).not.toContain('SYNCSTATUS_MARKER');
  });
});
