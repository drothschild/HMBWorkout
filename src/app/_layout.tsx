import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';
import { DatabaseProvider } from '@nozbe/watermelondb/react';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { database } from '@/db';
import { loadRules, RuleLoadError } from '@/engine/loadRules';
import { loadActiveEngineState } from '@/db/engineState';
import { getActiveSessionStore, injectRealExecutors } from '@/state/activeSession';
import { rehydrateActiveSession } from '@/state/sessionRehydrate';
import { loadSettings, injectSettingsStorage } from '@/state/settings';
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
