import { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { ThemedText } from './themed-text';

interface RestCountdownProps {
  deadlineMs: number | undefined;
  onRestElapsed: () => void;
}

/**
 * Display-only rest countdown timer
 * Renders max(0, deadline - now) at 1s intervals
 * At ≤0, dispatches RestElapsed event
 */
export function RestCountdown({ deadlineMs, onRestElapsed }: RestCountdownProps) {
  const [secondsRemaining, setSecondsRemaining] = useState<number>(0);
  const [hasElapsed, setHasElapsed] = useState<boolean>(false);

  useEffect(() => {
    if (!deadlineMs) return;

    const updateTimer = () => {
      const now = Date.now();
      const remaining = Math.max(0, deadlineMs - now);
      const seconds = Math.ceil(remaining / 1000);

      setSecondsRemaining(seconds);

      // M3: Dispatch RestElapsed once when deadline passes, not every second
      if (seconds <= 0 && !hasElapsed) {
        setHasElapsed(true);
        onRestElapsed();
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [deadlineMs, onRestElapsed, hasElapsed]);

  if (!deadlineMs) return null;

  const minutes = Math.floor(secondsRemaining / 60);
  const seconds = secondsRemaining % 60;

  return (
    <View style={styles.container}>
      <ThemedText type="subtitle">Rest Timer</ThemedText>
      <ThemedText style={styles.countdown}>
        {minutes}:{seconds < 10 ? `0${seconds}` : seconds}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    padding: 16,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
  },
  countdown: {
    fontSize: 32,
    fontWeight: 'bold',
    marginTop: 8,
  },
});
