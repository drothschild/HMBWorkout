/**
 * App state reconciler - on foreground, checks if past rest deadline
 * and dispatches RestElapsed if needed (for backgrounding past deadline case)
 */

export interface AppStateReconcilerDeps {
  getNowMs: () => number;
  isResting: () => boolean;
  getRestDeadlineMs: () => number | undefined;
  onRestElapsed: (nowMs: number) => Promise<void>;
}

export async function reconcileAppState(deps: AppStateReconcilerDeps) {
  if (!deps.isResting()) return;

  const deadline = deps.getRestDeadlineMs();
  if (!deadline) return;

  const now = deps.getNowMs();
  if (now >= deadline) {
    await deps.onRestElapsed(now);
  }
}
