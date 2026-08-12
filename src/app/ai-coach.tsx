import {
  StyleSheet,
  FlatList,
  TextInput,
  Pressable,
  View,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useEffect, useLayoutEffect, useMemo, useState, useRef, useCallback } from 'react';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useIsDark } from '@/hooks/use-is-dark';
import { ActionButtonColor, BackgroundColors, ThemedBackgroundText } from '@/theme/actionButtonColors';
import { getAiChatStore } from '@/state/aiChatStore';
import type { AiDisplayMessage, AiChatError } from '@/state/aiChatStore';
import { aiCoachModeFromParams } from '@/state/postWorkoutDebrief';
import { computeChatScrollTarget, ChatScrollTarget } from '@/state/chatScrollTarget';
import { getSettings, setSettings } from '@/state/settings';
import { optOutPatch } from '@/state/coachOnboarding';
import { RoutineDraft, DraftExercise, SettingsProposal } from '@/ai/draftSchema';

const HEADER_TITLES = {
  create: 'AI Coach',
  edit: 'Edit with AI Coach',
  debrief: 'Workout Debrief',
  onboarding: 'Meet Your Coach',
} as const;

export default function AiCoachScreen() {
  const router = useRouter();
  const theme = useTheme();
  const isDark = useIsDark();
  const { routineId, debriefSessionId, onboarding } = useLocalSearchParams<{
    routineId?: string;
    debriefSessionId?: string;
    onboarding?: string;
  }>();
  const store = getAiChatStore();
  // Stable per set of params, so it doubles as the identity of the conversation
  // these params ask for.
  const mode = useMemo(
    () => aiCoachModeFromParams({
      routineId,
      debriefSessionId,
      onboarding: onboarding === '1' ? '1' : undefined,
    }),
    [routineId, debriefSessionId, onboarding]
  );
  // Guard on a derived string key rather than useMemo object identity, which React
  // does not guarantee to cache. Use the key to detect when params change.
  const modeKey = `${mode.kind}:${routineId ?? ''}:${debriefSessionId ?? ''}:${onboarding ?? ''}`;
  const startedModeRef = useRef<string | null>(null);

  // Start the conversation before paint on first mount (and whenever the params
  // name a different one). A layout effect rather than a render-body write:
  // writing the store mid-render makes React 19 log a setState-during-render
  // error, while useLayoutEffect still runs before the frame paints, so no
  // stale conversation is ever visible.
  useLayoutEffect(() => {
    if (startedModeRef.current === modeKey) {
      return;
    }
    startedModeRef.current = modeKey;

    if (mode.kind === 'debrief') {
      // A debrief is the coach's conversation to open; the store sends the
      // first turn so the user arrives to a question, not a blank thread.
      void store.getState().openDebrief(mode);
    } else if (mode.kind === 'onboarding') {
      // Onboarding is also a coach-speaks-first conversation; the store sends
      // the opening turn so the user arrives to a question, not a blank thread.
      void store.getState().openOnboarding();
    } else {
      store.getState().reset(mode);
    }
  }, [modeKey, mode, store]);

  const messages = store((s) => s.messages);
  const pendingDraft = store((s) => s.pendingDraft);
  const pendingSettingsProposal = store((s) => s.pendingSettingsProposal);
  const status = store((s) => s.status);
  const error = store((s) => s.error);

  const [inputText, setInputText] = useState('');
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [hasMissingKey, setHasMissingKey] = useState(() => {
    const settings = getSettings();
    return !settings.anthropicKey || settings.anthropicKey.trim() === '';
  });
  const flatListRef = useRef<FlatList>(null);
  // The target actually applied by the auto-scroll effect below, so a
  // re-render that recomputes the identical target (e.g. declining a
  // settings proposal) can be told apart from one with genuinely new
  // content to anchor on. See chatScrollTarget.ts and issue #215 review C1.
  const lastScrollTargetRef = useRef<ChatScrollTarget | null>(null);
  // Bounds the onScrollToIndexFailed retry below (issue #215 review I2).
  const scrollRetryCountRef = useRef(0);
  // Tracks the previous state to detect when error surfaces appear or change.
  // Issue #222: must key on status transition to 'error', not error kind change,
  // because retry() clears and re-sets the same error in one commit (intermediate
  // null never observed). A turn that ends in error (status: sending → error)
  // must scroll even if the error value didn't change.
  const previousStatusRef = useRef(status);
  // Flag to scroll when error bubble is measured via onLayout. Using onLayout
  // instead of requestAnimationFrame because RAF fires before error bubble layout
  // completes, causing scrollToEnd to land short (true Heisenbug via logs).
  const pendingDeferredScrollRef = useRef(false);
  const textInputColor = theme.text;

  // Re-check the key on every focus, not just mount: the gate must lift when
  // the user returns from Settings after adding a key (this hook was once
  // deleted and that dead-ended the missing-key screen — keep it).
  useFocusEffect(
    useCallback(() => {
      const settings = getSettings();
      setHasMissingKey(!settings.anthropicKey || settings.anthropicKey.trim() === '');
    }, [])
  );

  // Auto-scroll after a turn. The decision (end vs. top-anchor-on-the-reply)
  // is a pure function (`computeChatScrollTarget`) so it's testable — see
  // its doc comment for why an unconditional scrollToEnd was wrong for long
  // coach replies (issue #215).
  //
  // When either error surface appears (a failed send, or local acceptError),
  // the ListFooterComponent grows. scrollToEnd on the same commit scrolls to
  // pre-growth height, leaving the error/Retry button below the fold
  // (issue #222). The fix: detect error appearance on BOTH surfaces and defer
  // the scroll to onContentSizeChange, which fires after layout settles.
  useEffect(() => {
    if (!flatListRef.current) {
      return;
    }

    // Detect when a turn just ended in error: status transitioned TO 'error'.
    // Retry clears and re-sets error in the same commit (intermediate null never
    // observed), so we can't detect error appearance by comparing error values.
    // Instead, key on status: sending → error means the turn failed, scroll needed.
    const turnJustEndedInError =
      previousStatusRef.current !== 'error' &&
      status === 'error' &&
      (error !== null || acceptError !== null);

    if (turnJustEndedInError) {
      previousStatusRef.current = status;
      // Set flag to scroll when error bubble is measured. requestAnimationFrame
      // is not reliable because the error bubble view may not be laid out yet —
      // onLayout fires exactly when *this specific view* is measured (issue #222).
      pendingDeferredScrollRef.current = true;
      return;
    }
    previousStatusRef.current = status;

    const target = computeChatScrollTarget(messages, lastScrollTargetRef.current);
    if (target.kind === 'none') {
      return;
    }
    lastScrollTargetRef.current = target;
    // A fresh target means a fresh scroll attempt, so any retry budget left
    // over from anchoring the previous target no longer applies.
    scrollRetryCountRef.current = 0;
    if (target.kind === 'end') {
      flatListRef.current.scrollToEnd({ animated: true });
      return;
    }
    flatListRef.current.scrollToIndex({ index: target.index, viewPosition: 0, animated: true });
  }, [messages, status, pendingDraft, pendingSettingsProposal, acceptError, error]);

  const handleSend = async () => {
    setAcceptError(null);
    if (inputText.trim() === '' || status === 'sending') {
      return;
    }
    const text = inputText.trim();
    setInputText('');
    await store.getState().send(text);
  };

  const handleRetry = async () => {
    setAcceptError(null);
    await store.getState().retry();
  };

  const handleAccept = async () => {
    if (accepting || status === 'sending' || pendingDraft === null) {
      return;
    }
    setAccepting(true);
    setAcceptError(null);
    try {
      const id = await store.getState().acceptDraft();
      if (id === null) {
        // A concurrent accept already owns this draft; that call navigates
        // (and clears `accepting`) when it settles.
        return;
      }
      setAccepting(false);
      router.push(`/routine/${id}`);
    } catch (err) {
      console.error('Failed to accept draft:', err);
      setAccepting(false);
      setAcceptError('Failed to save routine. Try again.');
    }
  };

  // Approval is the whole point of a proposal: nothing is written until this runs.
  const handleApproveSettings = () => {
    // Check live store state, not render snapshot: double-tap arriving after the
    // first approval completes would pass the stale render-snapshot guard and hit
    // the store's throw, which we'd misreport as a failure. Bail silently instead.
    if (store.getState().pendingSettingsProposal === null) {
      return;
    }
    setAcceptError(null);
    try {
      store.getState().approveSettingsProposal();
    } catch (err) {
      console.error('Failed to approve settings proposal:', err);
      setAcceptError('Could not apply those settings. Try again.');
    }
  };

  const handleDeclineSettings = () => {
    setAcceptError(null);
    store.getState().declineSettingsProposal();
  };

  // Build footer element to avoid remounting on each render
  const footerItems: React.ReactNode[] = [];

  if (status === 'sending') {
    footerItems.push(
      <View key="typing" style={styles.typingIndicatorContainer}>
        <ActivityIndicator size="small" color="#999" />
        <ThemedText type="small" style={styles.typingIndicatorText}>
          Coach is thinking…
        </ThemedText>
      </View>
    );
  }

  if (pendingDraft) {
    footerItems.push(<DraftCard key="draft" draft={pendingDraft} onAccept={handleAccept} accepting={accepting} sending={status === 'sending'} />);
  }

  if (pendingSettingsProposal) {
    const settings = getSettings();
    footerItems.push(
      <SettingsProposalCard
        key="settingsProposal"
        proposal={pendingSettingsProposal}
        currentGoals={settings.aiGoals}
        currentEquipment={settings.aiEquipment}
        currentPersonality={settings.aiPersonality}
        currentAge={settings.profileAge}
        currentExperience={settings.profileExperience}
        onApprove={handleApproveSettings}
        onDecline={handleDeclineSettings}
      />
    );
  }

  if (acceptError) {
    footerItems.push(
      <View
        key="acceptError"
        style={[
          styles.errorBubble,
          {
            backgroundColor: isDark
              ? BackgroundColors.errorBubbleDark
              : BackgroundColors.errorBubble,
          },
        ]}
      >
        <ThemedText
          type="default"
          style={[
            styles.errorMessage,
            {
              color: isDark
                ? ThemedBackgroundText.errorBubbleTextDark
                : ThemedBackgroundText.errorBubbleText,
            },
          ]}
        >
          {acceptError}
        </ThemedText>
      </View>
    );
  }

  if (error) {
    footerItems.push(
      <ErrorBubble
        key="error"
        error={error}
        onRetry={handleRetry}
        onLayout={() => {
          // AC6.9: This handler has zero jest coverage (src/app is untestable).
          // Deleting this callback silently reverts issue #222 — error bubbles
          // below the fold when they appear. Before refactoring, verify in simulator.
          if (pendingDeferredScrollRef.current && flatListRef.current) {
            pendingDeferredScrollRef.current = false;
            flatListRef.current.scrollToEnd({ animated: true });
          }
        }}
      />
    );
  }

  const footer = footerItems.length > 0 ? <View style={styles.footerContent}>{footerItems}</View> : null;

  const headerTitle = HEADER_TITLES[mode.kind];

  if (hasMissingKey) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.headerContainer}>
            <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
              <ThemedText type="default" style={styles.backButtonText}>
                ← Back
              </ThemedText>
            </Pressable>
            <ThemedText type="title" style={styles.title}>
              {headerTitle}
            </ThemedText>
            <View style={styles.backButtonPlaceholder} />
          </View>

          <View style={styles.missingKeyContainer}>
            <ThemedText type="title" style={styles.missingKeyTitle}>
              API Key Required
            </ThemedText>
            <ThemedText type="default" style={styles.missingKeyMessage}>
              Add your Anthropic API key in Settings to use the AI Coach
            </ThemedText>
            <Pressable style={({ pressed }) => [styles.settingsButton, pressed && styles.pressed]} onPress={() => router.push('/settings/ai')}>
              <ThemedText type="default" style={styles.settingsButtonText}>
                Open Settings
              </ThemedText>
            </Pressable>
          </View>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.headerContainer}>
          <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
            <ThemedText type="default" style={styles.backButtonText}>
              ← Back
            </ThemedText>
          </Pressable>
          <ThemedText type="title" style={styles.title}>
            {headerTitle}
          </ThemedText>
          <View style={styles.backButtonPlaceholder} />
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboardAvoidingView}
        >
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(_, index) => String(index)}
            renderItem={({ item }) => <MessageBubble message={item} />}
            ListFooterComponent={footer}
            contentContainerStyle={styles.messageListContent}
            scrollEnabled={true}
            onScrollToIndexFailed={(info) => {
              // No getItemLayout (bubbles are variable-height), so an index
              // outside the currently-measured window can't resolve
              // synchronously. Land approximately, then retry once the
              // target has had a chance to render and be measured.
              //
              // Bounded (issue #215 review I2): averageItemLength is a poor
              // estimator for this list (a one-word reply and a full
              // debrief summary are the same "item"), so the approximate
              // landing can itself fail to resolve the target and re-fire
              // this handler. Give up after a few attempts rather than
              // retrying indefinitely.
              //
              // Giving up does nothing further (issue #215 review round 2,
              // M3) rather than falling back to scrollToEnd: that fallback
              // is exactly the mid-reply-bottom landing this ticket exists
              // to remove, while the last scrollToOffset estimate below
              // already landed close to the target — for a reply taller
              // than average, on the correct (above-target) side of it —
              // which is closer to the ticket's intent than the list's
              // bottom would be.
              if (scrollRetryCountRef.current >= 3) {
                scrollRetryCountRef.current = 0;
                return;
              }
              scrollRetryCountRef.current += 1;
              flatListRef.current?.scrollToOffset({
                offset: info.averageItemLength * info.index,
                animated: false,
              });
              setTimeout(() => {
                // Read the currently-applied target rather than the `info.index`
                // closed over above (issue #215 review M3): if a new message
                // arrived during this 50ms window, the effect above already
                // re-anchored on it, and re-scrolling to the stale captured
                // index here would fight that newer, correct scroll.
                const current = lastScrollTargetRef.current;
                const index = current !== null && current.kind === 'top' ? current.index : info.index;
                flatListRef.current?.scrollToIndex({ index, viewPosition: 0, animated: true });
              }, 50);
            }}
          />

          <View style={styles.inputContainer}>
            <TextInput
              style={[styles.input, { color: textInputColor, borderColor: theme.backgroundSelected }]}
              placeholder="Ask the AI Coach..."
              placeholderTextColor={theme.textSecondary}
              value={inputText}
              onChangeText={setInputText}
              multiline
              returnKeyType="send"
              submitBehavior="submit"
              onSubmitEditing={handleSend}
              editable={status !== 'sending' && !accepting}
            />
            <Pressable
              style={({ pressed }) => [styles.sendButton, (status === 'sending' || inputText.trim() === '' || accepting) && styles.sendButtonDisabled, pressed && styles.pressed]}
              onPress={handleSend}
              disabled={status === 'sending' || inputText.trim() === '' || accepting}
            >
              <ThemedText type="default" style={styles.sendButtonText}>
                Send
              </ThemedText>
            </Pressable>
          </View>
        </KeyboardAvoidingView>

        {mode.kind === 'onboarding' && (
          <View style={[styles.optOutContainer, { borderTopColor: theme.backgroundSelected }]}>
            <Pressable
              style={({ pressed }) => [styles.optOutButton, pressed && styles.pressed]}
              onPress={() => {
                // Close the conversation FIRST. The opening turn is auto-sent on
                // mount and this button is live while it is still in flight —
                // which is exactly when an impatient user taps it. Without the
                // reset, that response lands afterwards, auto-applies in
                // onboarding mode, and writes both the profile patch and
                // `onboardingState: 'completed'` — silently reverting the
                // opt-out and overwriting settings for a user who just declined
                // the interview. reset() bumps `generation`, and the store's
                // existing guard discards the late response. That is what the
                // counter is for.
                store.getState().reset({ kind: 'create' });
                setSettings(optOutPatch(getSettings()));
                // replace, not push: this screen stays mounted under a pushed
                // route, so the settings screen's back control would return the
                // user to the abandoned, now-blank onboarding chat — still
                // headed "Meet Your Coach", but running create-mode turns.
                router.replace('/settings/ai');
              }}
            >
              <ThemedText style={styles.optOutButtonText}>I&apos;ll fill this in myself</ThemedText>
            </Pressable>
          </View>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

interface MessageBubbleProps {
  message: AiDisplayMessage;
}

function MessageBubble({ message }: MessageBubbleProps) {
  const theme = useTheme();

  if (message.hidden) {
    return null;
  }

  const isUser = message.role === 'user';

  return (
    <View style={[styles.messageBubbleContainer, isUser && styles.messageBubbleContainerUser]}>
      <View
        style={[
          styles.messageBubble,
          isUser ? styles.userBubble : { backgroundColor: theme.backgroundElement },
        ]}
      >
        <ThemedText type="default" style={isUser ? styles.userBubbleText : undefined}>
          {message.turn?.reply ?? message.content}
        </ThemedText>
      </View>
    </View>
  );
}

interface DraftCardProps {
  draft: RoutineDraft;
  onAccept: () => void;
  accepting: boolean;
  sending: boolean;
}

function DraftCard({ draft, onAccept, accepting, sending }: DraftCardProps) {
  const theme = useTheme();

  // Group exercises by supersetGroup
  const groupedExercises: Array<{
    label: string | null;
    exercises: DraftExercise[];
  }> = [];

  let currentGroup: { label: string | null; exercises: DraftExercise[] } | null = null;

  for (const exercise of draft.exercises) {
    const groupLabel = exercise.supersetGroup ?? null;
    if (currentGroup !== null && currentGroup.label === groupLabel) {
      currentGroup.exercises.push(exercise);
    } else {
      if (currentGroup) {
        groupedExercises.push(currentGroup);
      }
      currentGroup = { label: groupLabel, exercises: [exercise] };
    }
  }
  if (currentGroup) {
    groupedExercises.push(currentGroup);
  }

  return (
    <View style={[styles.draftCard, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="subtitle" style={styles.draftName}>
        {draft.name}
      </ThemedText>

      {draft.notes && <ThemedText type="default" style={styles.draftNotes}>{draft.notes}</ThemedText>}

      <View style={styles.draftExercisesContainer}>
        {groupedExercises.map((group, groupIdx) => (
          <View key={`group-${groupIdx}`}>
            {group.label && (
              <ThemedText type="smallBold" style={styles.supersetLabel}>
                Superset: {group.label}
              </ThemedText>
            )}
            {group.exercises.map((exercise, exIdx) => (
              <View key={`${groupIdx}-${exIdx}`} style={[styles.draftExerciseItem, group.label && styles.draftExerciseItemIndented]}>
                <View style={styles.exerciseTitleRow}>
                  <ThemedText type="default" style={styles.exerciseTitle}>
                    {exercise.title}
                  </ThemedText>
                  <View style={styles.kindTag}>
                    <ThemedText type="small" style={styles.kindTagText}>
                      {exercise.kind}
                    </ThemedText>
                  </View>
                </View>

                <ThemedText type="small" style={styles.exerciseDetails}>
                  {exercise.targetSets !== undefined && exercise.targetReps !== undefined && `${exercise.targetSets}x${exercise.targetReps}`}
                  {exercise.targetDurationSeconds !== undefined && exercise.targetDurationSeconds > 0 && `${Math.floor(exercise.targetDurationSeconds / 60)}:${String(exercise.targetDurationSeconds % 60).padStart(2, '0')}`}
                  {exercise.warmupSets !== undefined && exercise.warmupSets > 0 && ` | ${exercise.warmupSets}w`}
                  {exercise.restSeconds !== undefined && exercise.restSeconds > 0 && ` | Rest: ${exercise.restSeconds}s`}
                </ThemedText>
              </View>
            ))}
          </View>
        ))}
      </View>

      <Pressable
        style={({ pressed }) => [styles.acceptButton, (accepting || sending) && styles.acceptButtonDisabled, pressed && styles.pressed]}
        onPress={onAccept}
        disabled={accepting || sending}
      >
        <ThemedText type="default" style={styles.acceptButtonText}>
          {accepting ? 'Accepting...' : 'Accept'}
        </ThemedText>
      </Pressable>
    </View>
  );
}

interface SettingsProposalCardProps {
  proposal: SettingsProposal;
  currentGoals: string;
  currentEquipment: string;
  currentPersonality: string;
  currentAge: string;
  currentExperience: string;
  onApprove: () => void;
  onDecline: () => void;
}

function SettingsProposalCard({
  proposal,
  currentGoals,
  currentEquipment,
  currentPersonality,
  currentAge,
  currentExperience,
  onApprove,
  onDecline,
}: SettingsProposalCardProps) {
  const theme = useTheme();
  const isDark = useIsDark();

  const rows: { label: string; current: string; proposed: string }[] = [];

  if (proposal.goals !== undefined) {
    rows.push({ label: 'Goals', current: currentGoals, proposed: proposal.goals });
  }

  if (proposal.equipment !== undefined) {
    rows.push({ label: 'Equipment', current: currentEquipment, proposed: proposal.equipment });
  }

  if (proposal.personality !== undefined) {
    rows.push({ label: 'Coaching style', current: currentPersonality, proposed: proposal.personality });
  }

  if (proposal.age !== undefined) {
    rows.push({ label: 'Age', current: currentAge, proposed: proposal.age });
  }

  if (proposal.experience !== undefined) {
    rows.push({ label: 'Experience', current: currentExperience, proposed: proposal.experience });
  }

  return (
    <View style={[styles.draftCard, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="subtitle" style={styles.draftName}>
        Update coach settings
      </ThemedText>
      <ThemedText type="default" style={styles.draftNotes}>
        Nothing changes until you approve.
      </ThemedText>

      {rows.map((row) => (
        <View key={row.label} style={styles.proposalRow}>
          <ThemedText type="smallBold" style={styles.proposalLabel}>
            {row.label}
          </ThemedText>
          {row.current.trim() !== '' && (
            <ThemedText type="small" style={styles.proposalCurrent}>
              Now: {row.current}
            </ThemedText>
          )}
          <ThemedText type="default" style={styles.proposalProposed}>
            {row.proposed}
          </ThemedText>
        </View>
      ))}

      <View style={styles.proposalActions}>
        <Pressable
          style={({ pressed }) => [
            styles.declineButton,
            {
              borderColor: isDark
                ? ThemedBackgroundText.backgroundElementTextDark
                : ThemedBackgroundText.backgroundElementTextLight,
            },
            pressed && styles.pressed,
          ]}
          onPress={onDecline}
        >
          <ThemedText
            type="default"
            style={[
              styles.declineButtonText,
              {
                color: isDark
                  ? ThemedBackgroundText.backgroundElementTextDark
                  : ThemedBackgroundText.backgroundElementTextLight,
              },
            ]}
          >
            Decline
          </ThemedText>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.approveButton, pressed && styles.pressed]}
          onPress={onApprove}
        >
          <ThemedText type="default" style={styles.acceptButtonText}>
            Approve
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

interface ErrorBubbleProps {
  error: AiChatError;
  onRetry: () => void;
  onLayout?: () => void;
}

function ErrorBubble({ error, onRetry, onLayout }: ErrorBubbleProps) {
  const router = useRouter();
  const isDark = useIsDark();

  let errorMessage: string;
  let showRetry: boolean;

  switch (error.kind) {
    case 'missing_key':
      errorMessage = 'Add your Anthropic API key in Settings to use the AI Coach';
      showRetry = false;
      break;
    case 'unauthorized':
      errorMessage = 'API key rejected — check Settings';
      showRetry = true;
      break;
    case 'network':
      errorMessage = "Couldn't reach the AI service. Check your connection.";
      showRetry = true;
      break;
    case 'http':
      errorMessage = `The AI service returned an error (${error.status}). Try again.`;
      showRetry = true;
      break;
    case 'parse':
      errorMessage = 'Got an unreadable response. Try again.';
      showRetry = true;
      break;
    case 'unknown':
      errorMessage = 'Something went wrong. Try again.';
      showRetry = true;
      break;
    default:
      const _exhaustive: never = error;
      return _exhaustive;
  }

  const errorTextColor = isDark
    ? ThemedBackgroundText.errorBubbleTextDark
    : ThemedBackgroundText.errorBubbleText;
  const errorBubbleBackgroundColor = isDark
    ? BackgroundColors.errorBubbleDark
    : BackgroundColors.errorBubble;

  return (
    <View
      style={[
        styles.errorBubble,
        { backgroundColor: errorBubbleBackgroundColor },
      ]}
      onLayout={onLayout}
    >
      <ThemedText type="default" style={[styles.errorMessage, { color: errorTextColor }]}>
        {errorMessage}
      </ThemedText>
      {(error.kind === 'unauthorized' || error.kind === 'missing_key') && (
        <Pressable
          onPress={() => router.push('/settings/ai')}
          style={({ pressed }) => [styles.errorLink, pressed && styles.pressed]}
        >
          <ThemedText
            type="link"
            style={[
              styles.errorLinkText,
              { color: errorTextColor },
            ]}
          >
            Open Settings
          </ThemedText>
        </Pressable>
      )}
      {showRetry && (
        <Pressable onPress={onRetry} style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}>
          <ThemedText type="default" style={styles.retryButtonText}>
            Retry
          </ThemedText>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.6,
  },
  container: {
    flex: 1,
    justifyContent: 'flex-start',
    flexDirection: 'row',
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.three,
    maxWidth: MaxContentWidth,
    width: '100%',
  },
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.three,
    paddingTop: Spacing.two,
  },
  backButton: {
    padding: Spacing.two,
    marginLeft: -Spacing.two,
  },
  backButtonText: {
    color: ActionButtonColor.secondary,
    fontWeight: '500',
  },
  backButtonPlaceholder: {
    width: 40,
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    // 21 is 0.20pt short of LINE_HEIGHT_FLOOR × 18 (21.20). Exempted as an
    // element-specific glyph exception: modal header titles contain no descenders,
    // so the shortfall lands in the unused descent band. If `HEADER_TITLES` ever
    // gains an entry with a descender, raise to 22.
    lineHeight: 21,
    fontWeight: '700',
  },
  missingKeyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
  },
  missingKeyTitle: {
    marginBottom: Spacing.two,
    textAlign: 'center',
    fontSize: 20,
    // 24, not 23: SF's natural line height is LINE_HEIGHT_FLOOR (1.177734375),
    // so 20pt needs >=23.55 and 23 is 0.55pt short — the same defect this pass
    // exists to remove, just smaller. 24 clears by 0.45pt and also matches the
    // whole-number scale themed-text.tsx uses throughout. No glyph exemption
    // applies here — this renders 'API Key Required', which has a descender in 'Key'.
    lineHeight: 24,
  },
  missingKeyMessage: {
    textAlign: 'center',
    marginBottom: Spacing.four,
    opacity: 0.7,
  },
  settingsButton: {
    backgroundColor: ActionButtonColor.primary,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    borderRadius: 8,
    alignItems: 'center',
  },
  settingsButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  messageListContent: {
    paddingVertical: Spacing.two,
  },
  messageBubbleContainer: {
    flexDirection: 'row',
    marginVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    justifyContent: 'flex-start',
  },
  messageBubbleContainerUser: {
    justifyContent: 'flex-end',
  },
  messageBubble: {
    maxWidth: '80%',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 12,
  },
  userBubble: {
    backgroundColor: ActionButtonColor.primary,
  },
  userBubbleText: {
    color: '#fff',
  },
  typingIndicatorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
  },
  typingIndicatorText: {
    marginLeft: Spacing.two,
    opacity: 0.6,
  },
  footerContent: {
    paddingVertical: Spacing.two,
  },
  draftCard: {
    borderRadius: 12,
    padding: Spacing.three,
    marginVertical: Spacing.two,
    marginHorizontal: Spacing.two,
  },
  draftName: {
    marginBottom: Spacing.one,
    fontWeight: '600',
  },
  draftNotes: {
    marginBottom: Spacing.two,
    opacity: 0.7,
    fontSize: 13,
  },
  draftExercisesContainer: {
    marginVertical: Spacing.two,
  },
  supersetLabel: {
    fontStyle: 'italic',
    opacity: 0.7,
    marginTop: Spacing.one,
    marginBottom: Spacing.one,
    fontSize: 12,
  },
  draftExerciseItem: {
    marginBottom: Spacing.two,
  },
  draftExerciseItemIndented: {
    marginLeft: Spacing.three,
  },
  exerciseTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.one,
  },
  exerciseTitle: {
    flex: 1,
    fontWeight: '500',
  },
  kindTag: {
    backgroundColor: ActionButtonColor.secondary,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: Spacing.one,
  },
  kindTagText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
  },
  exerciseDetails: {
    opacity: 0.6,
    fontSize: 12,
  },
  acceptButton: {
    backgroundColor: ActionButtonColor.primary,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: Spacing.three,
  },
  acceptButtonDisabled: {
    opacity: 0.5,
  },
  acceptButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  proposalRow: {
    marginTop: Spacing.two,
  },
  proposalLabel: {
    opacity: 0.7,
    fontSize: 12,
    marginBottom: Spacing.one,
  },
  proposalCurrent: {
    opacity: 0.5,
    fontSize: 12,
    marginBottom: Spacing.one,
  },
  proposalProposed: {
    fontWeight: '500',
  },
  proposalActions: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.three,
  },
  approveButton: {
    flex: 1,
    backgroundColor: ActionButtonColor.primary,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    borderRadius: 8,
    alignItems: 'center',
  },
  declineButton: {
    flex: 1,
    borderWidth: 1,
    // borderColor is theme-resolved inline
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    borderRadius: 8,
    alignItems: 'center',
  },
  declineButtonText: {
    // color is theme-resolved inline
    fontWeight: '600',
  },
  errorBubble: {
    borderRadius: 8,
    padding: Spacing.three,
    marginVertical: Spacing.two,
    marginHorizontal: Spacing.two,
  },
  errorMessage: {
    marginBottom: Spacing.two,
    // color is theme-resolved inline
  },
  errorLink: {
    marginBottom: Spacing.one,
  },
  errorLinkText: {
    textDecorationLine: 'underline',
    // color is theme-resolved inline
  },
  retryButton: {
    backgroundColor: ActionButtonColor.primary,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: 6,
    alignItems: 'center',
  },
  retryButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingVertical: Spacing.two,
    paddingTop: Spacing.three,
    gap: Spacing.two,
  },
  input: {
    flex: 1,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    borderWidth: 1,
    // borderColor is theme-resolved inline
    borderRadius: 6,
    fontSize: 14,
    maxHeight: 100,
  },
  sendButton: {
    backgroundColor: ActionButtonColor.primary,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: 6,
    alignItems: 'center',
    minHeight: 40,
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  sendButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  optOutContainer: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderTopWidth: 1,
    // borderTopColor is theme-resolved inline — a hardcoded black at 10% is
    // invisible against the dark-mode background.
  },
  optOutButton: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: 6,
    backgroundColor: ActionButtonColor.secondary,
    alignItems: 'center',
  },
  optOutButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
});
