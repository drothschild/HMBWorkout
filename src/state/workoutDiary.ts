import { create } from 'zustand';
import type { Database } from '@nozbe/watermelondb';
import { readWorkoutDiary, saveWorkoutDiary, finishWorkoutDiary } from '@/db/workoutDiary';

export interface WorkoutSelfieFiles {
  copy(uri: string): Promise<string>;
  remove(relativePath: string): Promise<void>;
}
interface DiaryState {
  stage: 'loading' | 'diary' | 'selfie' | 'ready';
  diary: string;
  busy: boolean;
  error: string | null;
  load(): Promise<void>;
  saveDiary(text: string): Promise<boolean>;
  complete(uri: string | null): Promise<boolean>;
}

/** Post-workout data collection only; no engine events or provider calls. */
export function createWorkoutDiaryStore(db: Database, sessionId: string, files: WorkoutSelfieFiles) {
  return create<DiaryState>((set, get) => ({
    stage: 'loading', diary: '', busy: false, error: null,
    async load() {
      if (get().busy) return;
      set({ busy: true, error: null });
      try {
        const saved = await readWorkoutDiary(db, sessionId);
        set({ diary: saved.diary ?? '', stage: saved.ready ? 'ready' : saved.diary ? 'selfie' : 'diary' });
      } catch {
        set({ error: 'Could not load your workout diary. Please try again.' });
      } finally { set({ busy: false }); }
    },
    async saveDiary(text) {
      if (get().busy || get().stage !== 'diary' || !text.trim()) return false;
      set({ busy: true, error: null });
      try {
        await saveWorkoutDiary(db, sessionId, text);
        set({ diary: text.trim(), stage: 'selfie' });
        return true;
      } catch {
        set({ error: 'Could not save your diary. Please try again.' });
        return false;
      } finally { set({ busy: false }); }
    },
    async complete(uri) {
      if (get().busy || get().stage !== 'selfie') return false;
      set({ busy: true, error: null });
      let ownedPath: string | null = null;
      try {
        if (uri !== null) ownedPath = await files.copy(uri);
        await finishWorkoutDiary(db, sessionId, ownedPath);
        set({ stage: 'ready' });
        return true;
      } catch {
        if (ownedPath !== null) await files.remove(ownedPath).catch(() => {});
        // Another mounted gate may have finished while this one copied a photo.
        // Its saved record wins; the losing copy is discarded and this gate can continue.
        const completedElsewhere = await readWorkoutDiary(db, sessionId).then(saved => saved.ready).catch(() => false);
        set(completedElsewhere
          ? { stage: 'ready', error: null }
          : { error: 'Could not save your selfie. Your diary is saved. Try again or skip.' });
        return false;
      } finally { set({ busy: false }); }
    },
  }));
}
