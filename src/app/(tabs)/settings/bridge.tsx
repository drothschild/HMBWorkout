import {
  StyleSheet,
  TextInput,
  Pressable,
  ActivityIndicator,
  ScrollView,
  View,
} from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ActionButtonColor } from '@/theme/actionButtonColors';
import { getSettings, setSettings } from '@/state/settings';
import { createBridgeClient } from '@/sync/bridgeClient';
import { createSyncService } from '@/sync/syncService';
import { database } from '@/db';
import { testBridgeConnection, runImportRoutines, runSync } from '@/helpers/settingsActions';

export default function BridgeSettingsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const [baseUrl, setBaseUrl] = useState(() => getSettings().baseUrl);
  const [token, setToken] = useState(() => getSettings().token);
  const [connectionStatus, setConnectionStatus] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);
  const [importing, setImporting] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const handleSaveSettings = () => {
    setSettings({ baseUrl, token });
    setConnectionStatus(null);
    setImportStatus(null);
    setSyncStatus(null);
  };

  const handleTestConnection = async () => {
    if (!baseUrl) {
      setConnectionStatus('Please enter the bridge URL first');
      return;
    }

    setTestingConnection(true);
    try {
      const bridgeClient = createBridgeClient({ baseUrl, token });
      const result = await testBridgeConnection(bridgeClient);
      setConnectionStatus(
        result.status === 'reachable' ? `✓ ${result.message}` : `✗ ${result.message}`
      );
    } finally {
      setTestingConnection(false);
    }
  };

  const handleImportRoutines = async () => {
    if (!baseUrl) {
      setImportStatus('Please enter the bridge URL and save settings first');
      return;
    }

    setImporting(true);
    try {
      const bridgeClient = createBridgeClient({ baseUrl, token });
      const syncService = createSyncService(database, bridgeClient);
      const result = await runImportRoutines(syncService);
      setImportStatus(
        result.status === 'success' ? `✓ ${result.message}` : `✗ ${result.message}`
      );
    } finally {
      setImporting(false);
    }
  };

  const handleSync = async () => {
    if (!baseUrl) {
      setSyncStatus('Please enter the bridge URL and save settings first');
      return;
    }

    setSyncing(true);
    try {
      const bridgeClient = createBridgeClient({ baseUrl, token });
      const syncService = createSyncService(database, bridgeClient);
      const result = await runSync(syncService);
      setSyncStatus(
        result.status === 'success' ? `✓ ${result.message}` : `✗ ${result.message}`
      );
    } finally {
      setSyncing(false);
    }
  };

  const busy = testingConnection || importing || syncing;
  const textInputColor = theme.text;
  const placeholderColor = theme.textSecondary;

  return (
    <ThemedView style={styles.container}>
      <View style={styles.safeArea}>
        <View style={styles.headerContainer}>
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.navigate('/settings'))}
            style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
          >
            <ThemedText type="default" style={styles.backButtonText}>
              ← Settings
            </ThemedText>
          </Pressable>
        </View>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <ThemedText type="subtitle">Bridge Configuration</ThemedText>

          <ThemedView style={styles.formGroup}>
            <ThemedText type="default" style={styles.label}>
              Bridge URL
            </ThemedText>
            <TextInput
              style={[styles.input, { color: textInputColor, borderColor: theme.backgroundSelected }]}
              placeholder="http://mac.local:3000"
              placeholderTextColor={placeholderColor}
              value={baseUrl}
              onChangeText={setBaseUrl}
              editable={!busy}
            />
          </ThemedView>

          <ThemedView style={styles.formGroup}>
            <ThemedText type="default" style={styles.label}>
              Bearer Token
            </ThemedText>
            <TextInput
              style={[styles.input, { color: textInputColor, borderColor: theme.backgroundSelected }]}
              placeholder="Enter your token"
              placeholderTextColor={placeholderColor}
              value={token}
              onChangeText={setToken}
              secureTextEntry
              editable={!busy}
            />
          </ThemedView>

          <Pressable
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            onPress={handleSaveSettings}
            disabled={busy}
          >
            <ThemedText type="default" style={styles.buttonText}>
              Save Settings
            </ThemedText>
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            onPress={handleTestConnection}
            disabled={busy}
          >
            {testingConnection ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <ThemedText type="default" style={styles.buttonText}>
                Test Connection
              </ThemedText>
            )}
          </Pressable>

          {connectionStatus && (
            <ThemedText
              type="default"
              style={[
                styles.statusText,
                connectionStatus.startsWith('✓') ? styles.successText : styles.errorText,
              ]}
            >
              {connectionStatus}
            </ThemedText>
          )}

          <ThemedText type="subtitle" style={styles.sectionTitle}>
            Sync Operations
          </ThemedText>

          <Pressable
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            onPress={handleImportRoutines}
            disabled={busy}
          >
            {importing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <ThemedText type="default" style={styles.buttonText}>
                Import Routines
              </ThemedText>
            )}
          </Pressable>

          {importStatus && (
            <ThemedText
              type="default"
              style={[
                styles.statusText,
                importStatus.startsWith('✓') ? styles.successText : styles.errorText,
              ]}
            >
              {importStatus}
            </ThemedText>
          )}

          <Pressable
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            onPress={handleSync}
            disabled={busy}
          >
            {syncing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <ThemedText type="default" style={styles.buttonText}>
                Sync Sessions
              </ThemedText>
            )}
          </Pressable>

          {syncStatus && (
            <ThemedText
              type="default"
              style={[
                styles.statusText,
                syncStatus.startsWith('✓') ? styles.successText : styles.errorText,
              ]}
            >
              {syncStatus}
            </ThemedText>
          )}
        </ScrollView>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    flexDirection: 'row',
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.three,
    maxWidth: MaxContentWidth,
  },
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
    alignSelf: 'flex-start',
    padding: Spacing.two,
    marginLeft: -Spacing.two,
  },
  backButtonPressed: {
    opacity: 0.6,
  },
  backButtonText: {
    color: ActionButtonColor.secondary,
    fontWeight: '500',
  },
  scroll: {
    width: '100%',
  },
  content: {
    alignItems: 'stretch',
    justifyContent: 'flex-start',
    gap: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.four,
  },
  sectionTitle: {
    marginTop: Spacing.three,
  },
  formGroup: {
    gap: Spacing.one,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
  },
  input: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    borderWidth: 1,
    // borderColor is theme-resolved inline
    borderRadius: 6,
    fontSize: 14,
  },
  button: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 44,
    backgroundColor: ActionButtonColor.secondary,
  },
  buttonPressed: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  statusText: {
    fontSize: 13,
    marginTop: Spacing.one,
    paddingHorizontal: Spacing.two,
  },
  successText: {
    color: '#4CAF50',
  },
  errorText: {
    color: '#FF6B6B',
  },
});
