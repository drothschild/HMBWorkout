import type { Database } from '@nozbe/watermelondb';
import type Session from './models/Session';

export interface WorkoutDiary {
  diary: string | null;
  selfiePath: string | null;
  ready: boolean;
}

async function finishedSession(db: Database, sessionId: string): Promise<Session> {
  const session = await db.get<Session>('sessions').find(sessionId);
  if (session.endedAt == null) throw new Error('A diary requires a finished workout');
  return session;
}

export async function readWorkoutDiary(db: Database, sessionId: string): Promise<WorkoutDiary> {
  const session = await finishedSession(db, sessionId);
  return {
    diary: session.diaryEntry ?? null,
    selfiePath: session.selfiePath ?? null,
    ready: session.debriefReady === true,
  };
}

export async function saveWorkoutDiary(db: Database, sessionId: string, text: string): Promise<void> {
  const diary = text.trim();
  if (!diary) throw new Error('A diary entry cannot be blank');
  await db.write(async () => {
    const session = await finishedSession(db, sessionId);
    if (session.debriefReady) throw new Error('Workout diary is already completed');
    await session.update(row => { row.diaryEntry = diary; });
  });
}

export async function finishWorkoutDiary(db: Database, sessionId: string, selfiePath: string | null): Promise<void> {
  if (selfiePath !== null && !/^workout-selfies\/[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/.test(selfiePath)) {
    throw new Error('Invalid selfie path');
  }
  await db.write(async () => {
    const session = await finishedSession(db, sessionId);
    if (session.debriefReady) throw new Error('Workout diary is already completed');
    if (!session.diaryEntry?.trim()) throw new Error('Save a diary before continuing');
    await session.update(row => {
      row.selfiePath = selfiePath;
      row.debriefReady = true;
    });
  });
}
