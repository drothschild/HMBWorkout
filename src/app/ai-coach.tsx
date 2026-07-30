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
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState, useRef } from 'react';
import { useColorScheme } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { getAiChatStore } from '@/state/aiChatStore';
import { getSettings } from '@/state/settings';
import { AiDisplayMessage, AiChatError } from '@/state/aiChatStore';
import { RoutineDraft, DraftExercise } from '@/ai/draftSchema';

export default function AiCoachScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const { routineId } = useLocalSearchParams<{ routineId?: string }>();
  const store = getAiChatStore();

  const messages = store((s) => s.messages);
  const pendingDraft = store((s) => s.pendingDraft);
  const status = store((s) => s.status);
  const error = store((s) => s.error);

  const [inputText, setInputText] = useState('');
  const [accepting, setAccepting] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const textInputColor = colorScheme === 'dark' ? '#fff' : '#000';

  // Mount reset
  useEffect(() => {
    store.getState().reset(routineId ? { kind: 'edit', routineId } : { kind: 'create' });
  }, [routineId]);

  // Auto-scroll to end when messages change
  useEffect(() => {
    if (flatListRef.current && messages.length > 0) {
      flatListRef.current.scrollToEnd({ animated: true });
    }
  }, [messages]);

  // Check for missing key on render
  const settings = getSettings();
  const hasMissingKey = !settings.anthropicKey || settings.anthropicKey.trim() === '';

  const handleSend = async () => {
    if (inputText.trim() === '' || status === 'sending') {
      return;
    }
    const text = inputText;
    setInputText('');
    await store.getState().send(text);
  };

  const handleRetry = async () => {
    await store.getState().retry();
  };

  const handleAccept = async () => {
    if (accepting || status === 'sending' || pendingDraft === null) {
      return;
    }
    setAccepting(true);
    try {
      const id = await store.getState().acceptDraft();
      router.push(`/routine/${id}`);
    } catch (err) {
      console.error('Failed to accept draft:', err);
      setAccepting(false);
    }
  };

  const isEditing = routineId !== undefined;
  const headerTitle = isEditing ? 'Edit with AI Coach' : 'AI Coach';

  if (hasMissingKey) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.headerContainer}>
            <Pressable onPress={() => router.back()} style={styles.backButton}>
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
            <Pressable style={styles.settingsButton} onPress={() => router.push('/settings')}>
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
          <Pressable onPress={() => router.back()} style={styles.backButton}>
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
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
        >
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(_, index) => String(index)}
            renderItem={({ item }) => <MessageBubble message={item} />}
            ListFooterComponent={() => {
              const items: React.ReactNode[] = [];

              if (status === 'sending') {
                items.push(
                  <View key="typing" style={styles.typingIndicatorContainer}>
                    <ActivityIndicator size="small" color="#999" />
                    <ThemedText type="small" style={styles.typingIndicatorText}>
                      Coach is thinking…
                    </ThemedText>
                  </View>
                );
              }

              if (pendingDraft) {
                items.push(<DraftCard key="draft" draft={pendingDraft} onAccept={handleAccept} accepting={accepting} sending={status === 'sending'} />);
              }

              if (error) {
                items.push(<ErrorBubble key="error" error={error} onRetry={handleRetry} />);
              }

              return items.length > 0 ? <View style={styles.footerContent}>{items}</View> : null;
            }}
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
              editable={status !== 'sending' && !accepting}
            />
            <Pressable
              style={[styles.sendButton, (status === 'sending' || inputText.trim() === '' || accepting) && styles.sendButtonDisabled]}
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
    <View style={styles.draftCard}>
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
                  {exercise.warmupSets !== undefined && exercise.warmupSets > 0 && `${exercise.warmupSets}w `}
                  {exercise.targetSets !== undefined && exercise.targetReps !== undefined && `${exercise.targetSets}x${exercise.targetReps}`}
                  {exercise.targetDurationSeconds !== undefined && exercise.targetDurationSeconds > 0 && `${Math.floor(exercise.targetDurationSeconds / 60)}min`}
                  {exercise.restSeconds !== undefined && exercise.restSeconds > 0 && ` | Rest: ${exercise.restSeconds}s`}
                </ThemedText>
              </View>
            ))}
          </View>
        ))}
      </View>

      <Pressable
        style={[styles.acceptButton, (accepting || sending) && styles.acceptButtonDisabled]}
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

interface ErrorBubbleProps {
  error: AiChatError;
  onRetry: () => void;
}

function ErrorBubble({ error, onRetry }: ErrorBubbleProps) {
  const router = useRouter();

  let errorMessage = 'Something went wrong. Try again.';
  let showRetry = true;

  if (error.kind === 'missing_key') {
    errorMessage = 'Add your Anthropic API key in Settings to use the AI Coach';
    showRetry = false;
  } else if (error.kind === 'unauthorized') {
    errorMessage = 'API key rejected — check Settings';
  } else if (error.kind === 'network') {
    errorMessage = "Couldn't reach the AI service. Check your connection.";
  } else if (error.kind === 'http') {
    errorMessage = `The AI service returned an error (${error.status}). Try again.`;
  } else if (error.kind === 'parse') {
    errorMessage = 'Got an unreadable response. Try again.';
  } else if (error.kind === 'unknown') {
    errorMessage = 'Something went wrong. Try again.';
  }

  return (
    <View style={styles.errorBubble}>
      <ThemedText type="default" style={styles.errorMessage}>
        {errorMessage}
      </ThemedText>
      {error.kind === 'unauthorized' && (
        <Pressable onPress={() => router.push('/settings')} style={styles.errorLink}>
          <ThemedText type="link" style={styles.errorLinkText}>
            Open Settings
          </ThemedText>
        </Pressable>
      )}
      {showRetry && (
        <Pressable onPress={onRetry} style={styles.retryButton}>
          <ThemedText type="default" style={styles.retryButtonText}>
            Retry
          </ThemedText>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
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
    backgroundColor: '#F0F0F3',
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
