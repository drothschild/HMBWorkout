// pattern: Imperative Shell
import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * iOS fires the Will events as the keyboard starts animating in or out, so
 * anything that collapses on them gets out of the way before the keyboard
 * covers the focused field. Android never fires the Will events, only the Did
 * ones (see RN's Keyboard.addListener docs).
 */
const SHOW_EVENT = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
const HIDE_EVENT = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

/**
 * True while the software keyboard is open. The session screen's SetLogger
 * hides its exercise hero on it (#335), because that screen is a fixed column
 * with no outer ScrollView and the hero would otherwise push the set inputs
 * under the keyboard; session.tsx itself hides its Finish/Abandon footer and
 * the Replace button and clamps the routine notes to two lines on it, since
 * even without the hero that column overflowed on timed exercises.
 *
 * Seeded from `Keyboard.isVisible()` so a component that mounts while the
 * keyboard is already open starts out correct.
 */
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(() => Keyboard.isVisible());

  useEffect(() => {
    const show = Keyboard.addListener(SHOW_EVENT, () => setVisible(true));
    const hide = Keyboard.addListener(HIDE_EVENT, () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return visible;
}
