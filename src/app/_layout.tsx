import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { AppState, useColorScheme } from 'react-native';
import { DatabaseProvider } from '@nozbe/watermelondb/react';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { database } from '@/db';
import { loadRules, RuleLoadError } from '@/engine/loadRules';
import { loadActiveEngineState } from '@/db/engineState';
import { getActiveSessionStore, injectRealExecutors } from '@/state/activeSession';
import { rehydrateActiveSession } from '@/state/sessionRehydrate';
import { reconcileForegroundedSession } from '@/state/foregroundReconcile';
import { loadSettings, injectSettingsStorage, getSettings } from '@/state/settings';
import { shouldShowFirstRunKeyPrompt } from '@/state/firstRunKeyPrompt';
import { FirstRunKeyPrompt } from '@/components/FirstRunKeyPrompt';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { secureStorageBackend } from '@/storage/secureStorage';
import * as Notifications from 'expo-notifications';
import { createRestTimerExecutor } from '@/engine/executors/restTimer';
import { createRealNotificationApis, getDefaultNotificationHandler } from '@/engine/executors/notificationApis';
import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';

SplashScreen.preventAutoHideAsync();

function RuleErrorScreen({ error }: { error: RuleLoadError }) {
  return (
    <ThemedView style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
      <ThemedText type="title" style={{ marginBottom: 20, color: 'red' }}>
        Rule Load Error
      </ThemedText>
      <ThemedText>{error.message}</ThemedText>
    </ThemedView>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [rulesLoaded, setRulesLoaded] = useState(false);
  const [ruleError, setRuleError] = useState<RuleLoadError | null>(null);
  // Launch-local, deliberately not persisted. Skipping the prompt writes
  // nothing (#168's "ask again next launch"), so this is the ONLY thing that
  // stops it re-appearing within a single launch. It also covers the save
  // path: setSettings does not re-render this component, so the gate below
  // would otherwise still read a keyless snapshot after a successful save.
  const [keyPromptAnswered, setKeyPromptAnswered] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        // Set up notification handler for foreground presentation
        Notifications.setNotificationHandler(getDefaultNotificationHandler());

        // Inject real executors into the store
        const notificationApis = createRealNotificationApis();
        const restTimerExecutor = createRestTimerExecutor(notificationApis);
        injectRealExecutors({
          onScheduleRest: restTimerExecutor.onScheduleRest,
          onCancelRest: restTimerExecutor.onCancelRest,
          onNotify: restTimerExecutor.onNotify,
        });

        // Inject storage backend and load settings (non-blocking)
        injectSettingsStorage(secureStorageBackend);
        await loadSettings();

        // Load and validate rules
        loadRules();

        // Hydrate active session if one exists (restart recovery)
        const savedState = await loadActiveEngineState(database);
        if (savedState) {
          await rehydrateActiveSession(getActiveSessionStore(), savedState, Date.now());
        }

        setRulesLoaded(true);
        await SplashScreen.hideAsync();
      } catch (error) {
        if (error instanceof RuleLoadError) {
          setRuleError(error);
        } else {
          setRuleError(new RuleLoadError('unknown', String(error)));
        }
      }
    })();
  }, []);

  // Foreground recovery: a rest whose deadline expired while the app was
  // backgrounded (not killed) has no other reconcile path unless the session
  // screen happens to be mounted. Subscribed only after boot, so a dispatch
  // can never precede loadRules() or the rehydrate above.
  useEffect(() => {
    if (!rulesLoaded) return;
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') {
        reconcileForegroundedSession(getActiveSessionStore(), Date.now()).catch((error) => {
          console.error('Foreground session reconcile failed:', error);
        });
      }
    });
    return () => subscription.remove();
  }, [rulesLoaded]);

  if (ruleError) {
    return (
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <RuleErrorScreen error={ruleError} />
      </ThemeProvider>
    );
  }

  // Gate children on the rules check: screens (and the session store's engine
  // construction) must not mount until loadRules() has passed, or a broken rule
  // throws from engine construction before RuleErrorScreen can render.
  if (!rulesLoaded) {
    return (
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AnimatedSplashOverlay />
      </ThemeProvider>
    );
  }

  // Ask for a provider key before the tabs mount. Placed after the rules gate
  // so it cannot precede loadSettings(), and before the Stack so a brand-new
  // user meets it instead of a coach that silently does nothing. The decision
  // itself lives in `shouldShowFirstRunKeyPrompt`, which jest covers; this is
  // only the placement.
  if (!keyPromptAnswered && shouldShowFirstRunKeyPrompt(getSettings())) {
    return (
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <SafeAreaProvider>
          <FirstRunKeyPrompt onDone={() => setKeyPromptAnswered(true)} />
        </SafeAreaProvider>
      </ThemeProvider>
    );
  }

  return (
    <DatabaseProvider database={database}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AnimatedSplashOverlay />
        <Stack
          screenOptions={{
            headerShown: false,
          }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="session"
            options={{
              headerShown: false,
              presentation: 'modal',
            }}
          />
          <Stack.Screen name="ai-coach" options={{ headerShown: false }} />
        </Stack>
      </ThemeProvider>
    </DatabaseProvider>
  );
}
