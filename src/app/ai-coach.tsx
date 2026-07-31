import {
  StyleSheet,
  FlatList,
  TextInput,
  Pressable,
  View,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useEffect, useLayoutEffect, useMemo, useState, useRef, useCallback } from 'react';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getAiChatStore } from '@/state/aiChatStore';
import type { AiDisplayMessage, AiChatError } from '@/state/aiChatStore';
import { aiCoachModeFromParams } from '@/state/postWorkoutDebrief';
import { getSettings } from '@/state/settings';
import { RoutineDraft, DraftExercise, SettingsProposal } from '@/ai/draftSchema';

const HEADER_TITLES = {
  create: 'AI Coach',
  edit: 'Edit with AI Coach',
  debrief: 'Workout Debrief',
} as const;

export default function AiCoachScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const { routineId, debriefSessionId } = useLocalSearchParams<{
    routineId?: string;
    debriefSessionId?: string;
  }>();
  const store = getAiChatStore();
  // Stable per set of params, so it doubles as the identity of the conversation
  // these params ask for.
  const mode = useMemo(
    () => aiCoachModeFromParams({ routineId, debriefSessionId }),
    [routineId, debriefSessionId]
  );
  // Guard on a derived string key rather than useMemo object identity, which React
  // does not guarantee to cache. Use the key to detect when params change.
  const modeKey = `${mode.kind}:${routineId ?? ''}:${debriefSessionId ?? ''}`;
  const startedModeRef = useRef<string | null>(null);

  const [hasMissingKey, setHasMissingKey] = useState(() => {
    const settings = getSettings();
    return !settings.anthropicKey || settings.anthropicKey.trim() === '';
  });

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
  const flatListRef = useRef<FlatList>(null);
  const textInputColor = colorScheme === 'dark' ? '#fff' : '#000';

  // Check for missing key on mount and focus
  useFocusEffect(
    useCallback(() => {
      const settings = getSettings();
      const keyMissing = !settings.anthropicKey || settings.anthropicKey.trim() === '';
      setHasMissingKey(keyMissing);
      // If the key was missing and now exists, allow the conversation to start fresh
      if (!keyMissing && error?.kind === 'missing_key') {
        startedModeRef.current = null;
      }
    }, [error?.kind])
  );

  // Auto-scroll to end when messages change
  useEffect(() => {
    if (flatListRef.current && messages.length > 0) {
      flatListRef.current.scrollToEnd({ animated: true });
    }
  }, [messages, status, pendingDraft, pendingSettingsProposal, acceptError]);

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
        onApprove={handleApproveSettings}
        onDecline={handleDeclineSettings}
      />
    );
  }

  if (acceptError) {
    footerItems.push(
      <View key="acceptError" style={styles.errorBubble}>
        <ThemedText type="default" style={styles.errorMessage}>
          {acceptError}
        </ThemedText>
      </View>
    );
  }

  if (error) {
    footerItems.push(<ErrorBubble key="error" error={error} onRetry={handleRetry} />);
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
          />

          <View style={styles.inputContainer}>
            <TextInput
              style={[styles.input, { color: textInputColor }]}
              placeholder="Ask the AI Coach..."
              placeholderTextColor={colorScheme === 'dark' ? '#999' : '#ccc'}
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
      </SafeAreaView>
    </ThemedView>
  );
}

interface MessageBubbleProps {
  message: AiDisplayMessage;
}

function MessageBubble({ message }: MessageBubbleProps) {
  if (message.hidden) {
    return null;
  }

  const isUser = message.role === 'user';

  return (
    <View style={[styles.messageBubbleContainer, isUser && styles.messageBubbleContainerUser]}>
      <View style={[styles.messageBubble, isUser ? styles.userBubble : styles.assistantBubble]}>
        <ThemedText type="default" style={[styles.messageBubbleText, isUser && styles.userBubbleText]}>
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
  onApprove: () => void;
  onDecline: () => void;
}

function SettingsProposalCard({
  proposal,
  currentGoals,
  currentEquipment,
  onApprove,
  onDecline,
}: SettingsProposalCardProps) {
  const theme = useTheme();

  const rows: { label: string; current: string; proposed: string }[] = [];

  if (proposal.goals !== undefined) {
    rows.push({ label: 'Goals', current: currentGoals, proposed: proposal.goals });
  }

  if (proposal.equipment !== undefined) {
    rows.push({ label: 'Equipment', current: currentEquipment, proposed: proposal.equipment });
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
          style={({ pressed }) => [styles.declineButton, pressed && styles.pressed]}
          onPress={onDecline}
        >
          <ThemedText type="default" style={styles.declineButtonText}>
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
}

function ErrorBubble({ error, onRetry }: ErrorBubbleProps) {
  const router = useRouter();

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

  return (
    <View style={styles.errorBubble}>
      <ThemedText type="default" style={styles.errorMessage}>
        {errorMessage}
      </ThemedText>
      {(error.kind === 'unauthorized' || error.kind === 'missing_key') && (
        <Pressable onPress={() => router.push('/settings/ai')} style={({ pressed }) => [styles.errorLink, pressed && styles.pressed]}>
          <ThemedText type="link" style={styles.errorLinkText}>
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
    paddingBottom: BottomTabInset + Spacing.three,
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
    color: '#007AFF',
    fontWeight: '500',
  },
  backButtonPlaceholder: {
    width: 40,
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
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
  },
  missingKeyMessage: {
    textAlign: 'center',
    marginBottom: Spacing.four,
    opacity: 0.7,
  },
  settingsButton: {
    backgroundColor: '#007AFF',
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
    backgroundColor: '#007AFF',
  },
  assistantBubble: {
    backgroundColor: '#E5E5EA',
  },
  messageBubbleText: {
    color: '#000',
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
    backgroundColor: '#208AEF',
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
    backgroundColor: '#007AFF',
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
    backgroundColor: '#007AFF',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    borderRadius: 8,
    alignItems: 'center',
  },
  declineButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#007AFF',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    borderRadius: 8,
    alignItems: 'center',
  },
  declineButtonText: {
    color: '#007AFF',
    fontWeight: '600',
  },
  errorBubble: {
    backgroundColor: '#FFE5E5',
    borderRadius: 8,
    padding: Spacing.three,
    marginVertical: Spacing.two,
    marginHorizontal: Spacing.two,
  },
  errorMessage: {
    color: '#C00',
    marginBottom: Spacing.two,
  },
  errorLink: {
    marginBottom: Spacing.one,
  },
  errorLinkText: {
    color: '#007AFF',
  },
  retryButton: {
    backgroundColor: '#007AFF',
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
    borderColor: '#ccc',
    borderRadius: 6,
    fontSize: 14,
    maxHeight: 100,
  },
  sendButton: {
    backgroundColor: '#007AFF',
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
});
