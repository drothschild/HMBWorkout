import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { AppState, Pressable, useColorScheme, View } from 'react-native';
import { DatabaseProvider } from '@nozbe/watermelondb/react';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { database } from '@/db';
import { loadRules, RuleLoadError } from '@/engine/loadRules';
import { clearEngineState, loadActiveEngineState } from '@/db/engineState';
import { getActiveSessionStore, injectRealExecutors } from '@/state/activeSession';
import { rehydrateActiveSession } from '@/state/sessionRehydrate';
import { reconcileForegroundedSession } from '@/state/foregroundReconcile';
import { loadSettings, injectSettingsStorage, getSettings, setSettings } from '@/state/settings';
import { shouldShowFirstRunKeyPrompt } from '@/state/firstRunKeyPrompt';
import {
  SCHEMA_RESET_NOTICE_BODY,
  SCHEMA_RESET_NOTICE_TITLE,
  liveSchemaVersionContext,
  needsSchemaVersionRecord,
  schemaVersionRecordPatch,
  shouldShowSchemaResetNotice,
} from '@/state/schemaResetNotice';
import { FirstRunKeyPrompt } from '@/components/FirstRunKeyPrompt';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { secureStorageBackend } from '@/storage/secureStorage';
import * as Notifications from 'expo-notifications';
import { createRestTimerExecutor } from '@/engine/executors/restTimer';
import { createRealNotificationApis, getDefaultNotificationHandler } from '@/engine/executors/notificationApis';
import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { BackgroundColors, ThemedBackgroundText } from '@/theme/actionButtonColors';

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

/**
 * The one-time "your saved data was reset" banner (#276 AC1.8).
 *
 * IN THE LAYOUT, NOT OVER IT. The first version was absolutely positioned at a
 * hardcoded `top: 60`, on the reasoning that an overlay cannot shift the tab
 * tree. In the simulator that landed squarely on the Today screen's
 * "Let's Get Started" onboarding card, hiding its title and body and the
 * settings gear while leaving its Start/Dismiss buttons poking out below — two
 * adjacent Dismiss buttons, one of them acting on a card whose text you could
 * not read. Nudging `top` only moves the collision, because that card is the
 * first thing in the scroll content and any top overlay lands on something.
 *
 * So the banner takes its own height above the navigator instead. It costs the
 * tab tree some vertical space for one launch, which is strictly better than
 * obscuring a control. `SafeAreaView edges={['top']}` supplies the notch inset
 * — the library's SafeAreaView is a native view and needs no SafeAreaProvider
 * ancestor, which is why session.tsx and routine/[id].tsx already use it that
 * way. Dismissible because the reset has already happened: there is nothing
 * here for the user to decide. Never rendered again after this launch — the
 * boot effect records the schema version it came up at.
 *
 * None of this is reachable by jest (`src/app` is outside every testMatch, and
 * PR #66's collapsed ScrollView shipped past 159 green tests), so it is checked
 * in the simulator. The structural half — no absolute positioning, no magic
 * offset, the inset actually asked for — is pinned in schemaResetNotice.test.ts.
 */
function SchemaResetBanner({
  dark,
  onDismiss,
}: {
  dark: boolean;
  onDismiss: () => void;
}) {
  // The errorBubble pair, because it is the app's one attention surface whose
  // text/background contrast is verified against WCAG AA by
  // src/theme/contrastRatio.test.ts. Picking fresh colours here would put an
  // unchecked pair on screen.
  const background = dark ? BackgroundColors.errorBubbleDark : BackgroundColors.errorBubble;
  const text = dark ? ThemedBackgroundText.errorBubbleTextDark : ThemedBackgroundText.errorBubbleText;

  return (
    // The background sits on the SafeAreaView rather than the inner View so it
    // fills the notch inset too, instead of leaving a bare strip above itself.
    <SafeAreaView edges={['top']} style={{ backgroundColor: background }}>
      <View accessibilityRole="alert" style={{ padding: 16 }}>
        <ThemedText type="smallBold" style={{ color: text }}>
          {SCHEMA_RESET_NOTICE_TITLE}
        </ThemedText>
        <ThemedText style={{ marginTop: 6, color: text }}>{SCHEMA_RESET_NOTICE_BODY}</ThemedText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss data reset notice"
          onPress={onDismiss}
          style={{
            alignSelf: 'flex-end',
            marginTop: 12,
            paddingVertical: 6,
            paddingHorizontal: 12,
          }}>
          <ThemedText type="smallBold" style={{ color: text }}>
            Dismiss
          </ThemedText>
        </Pressable>
      </View>
    </SafeAreaView>
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
  // #276 AC1.8. The v6 bump drops and recreates the database, and WatermelonDB
  // does it with nothing but a logger.warn — so without this the user opens the
  // app, finds their routines gone, and has been handed what looks exactly like
  // a bug. A dismissible banner, not a modal: the data is already gone by the
  // time anything renders, so a modal would buy friction rather than a decision.
  // The decision itself is `shouldShowSchemaResetNotice`, which jest covers;
  // this is only the placement.
  const [showSchemaResetNotice, setShowSchemaResetNotice] = useState(false);

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

        // Decide BEFORE recording: the record is what makes the notice
        // one-time, so writing it first would suppress the very launch the
        // notice exists for.
        const schemaContext = liveSchemaVersionContext();
        const settingsAtBoot = getSettings();
        setShowSchemaResetNotice(shouldShowSchemaResetNotice(settingsAtBoot, schemaContext));
        // Only when it would change something (#292). The patch is one
        // integer, but setSettings re-serialises the whole bridge_settings
        // blob — the user's API key included — into secure storage, and on
        // every launch but the one after a bump the value is already there.
        if (needsSchemaVersionRecord(settingsAtBoot, schemaContext)) {
          setSettings(schemaVersionRecordPatch(schemaContext));
        }

        // Load and validate rules
        loadRules();

        // Hydrate active session if one exists (restart recovery)
        const savedState = await loadActiveEngineState(database);
        if (savedState) {
          await rehydrateActiveSession(getActiveSessionStore(), savedState, Date.now(), {
            clearEngineState: (sessionId) => clearEngineState(database, sessionId),
          });
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
        {/*
          The banner and the navigator share one flex column, so the banner
          takes its own height and the navigator gets the rest — that is what
          makes it impossible for the notice to cover a control. The splash
          overlay stays outside it because it is absoluteFill'd at zIndex 1000
          and must keep covering both.
        */}
        <View style={{ flex: 1 }}>
          {showSchemaResetNotice ? (
            <SchemaResetBanner
              dark={colorScheme === 'dark'}
              onDismiss={() => setShowSchemaResetNotice(false)}
            />
          ) : null}
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
        </View>
      </ThemeProvider>
    </DatabaseProvider>
  );
}
