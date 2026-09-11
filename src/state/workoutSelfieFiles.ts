import { Directory, File, Paths } from 'expo-file-system';
import type { WorkoutSelfieFiles } from './workoutDiary';

/** Native I/O stays out of the node-testable diary store. Selfies never leave this device via the coach. */
export const workoutSelfieFiles: WorkoutSelfieFiles = {
  async copy(uri) {
    const source = new File(uri);
    const extension = /^\.[a-zA-Z0-9]+$/.test(source.extension) ? source.extension : '.jpg';
    new Directory(Paths.document, 'workout-selfies').create({ intermediates: true, idempotent: true });
    const relativePath = `workout-selfies/${Date.now()}-${Math.random().toString(36).slice(2)}${extension}`;
    const destination = new File(Paths.document, relativePath);
    try {
      await source.copy(destination);
      return relativePath;
    } catch (error) {
      try { if (destination.exists) destination.delete(); } catch { /* Keep the copy failure. */ }
      throw error;
    }
  },
  async remove(relativePath) {
    const file = new File(Paths.document, relativePath);
    if (file.exists) file.delete();
  },
};

export function workoutSelfieUri(relativePath: string): string {
  return new File(Paths.document, relativePath).uri;
}
