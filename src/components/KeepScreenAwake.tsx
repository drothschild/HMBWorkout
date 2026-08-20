// pattern: Imperative Shell
import { useKeepAwake } from 'expo-keep-awake';

interface KeepScreenAwakeProps {
  /**
   * Distinct per surface — see `KeepAwakeTag` in `@/state/keepAwake`. Passed
   * explicitly rather than relying on `useKeepAwake()`'s per-component default
   * so the two surfaces hold and release independently.
   */
  tag: string;
}

/**
 * Holds the iOS idle timer open for exactly as long as it is mounted, then
 * releases it (#312).
 *
 * Rendering nothing is the entire design. `useKeepAwake` cannot be called
 * conditionally — it is a hook — so the condition is expressed by *mounting*
 * this component instead:
 *
 *     {timerRunning && <KeepScreenAwake tag={KeepAwakeTag.restCountdown} />}
 *
 * Release then comes from React unmounting it, which covers all three cases
 * the issue requires without a hand-written effect: the timer stopping (the
 * flag flips false), the component unmounting (navigating away, the rest
 * ending, the session modal being dismissed), and the session ending (the
 * whole tree goes). The cleanup is expo-keep-awake's own, not ours, which is
 * the safest place for it given that a leaked lock is invisible to every test
 * suite in this repo.
 */
export function KeepScreenAwake({ tag }: KeepScreenAwakeProps) {
  useKeepAwake(tag);
  return null;
}
