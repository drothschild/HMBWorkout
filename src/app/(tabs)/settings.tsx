import { StyleSheet, TextInput, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState, useEffect } from 'react';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { getSettings, setSettings } from '@/state/settings';
import { createBridgeClient } from '@/sync/bridgeClient';
import { createSyncService } from '@/sync/syncService';
import { database } from '@/db';
import { testBridgeConnection, runImportRoutines, runSync } from '@/helpers/settingsActions';
import { useColorScheme } from 'react-native';

export default function SettingsScreen() {
  const colorScheme = useColorScheme();
  const [baseUrl, setBaseUrl] = useState('');
  const [token, setToken] = useState('');
  const [connectionStatus, setConnectionStatus] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);
  const [importing, setImporting] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Load settings on mount
  useEffect(() => {
    const settings = getSettings();
    setBaseUrl(settings.baseUrl);
    setToken(settings.token);
  }, []);

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
        result.status === 'reachable'
          ? `✓ ${result.message}`
          : `✗ ${result.message}`
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
        result.status === 'success'
          ? `✓ ${result.message}`
          : `✗ ${result.message}`
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
        result.status === 'success'
          ? `✓ ${result.message}`
          : `✗ ${result.message}`
      );
    } finally {
      setSyncing(false);
    }
  };

  const textInputColor = colorScheme === 'dark' ? '#fff' : '#000';

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          <ThemedText type="title" style={styles.title}>
            Settings
          </ThemedText>

          <ThemedView style={styles.section}>
            <ThemedText type="subtitle">Bridge Configuration</ThemedText>

            <ThemedView style={styles.formGroup}>
              <ThemedText type="default" style={styles.label}>
                Bridge URL
              </ThemedText>
              <TextInput
                style={[styles.input, { color: textInputColor }]}
                placeholder="http://mac.local:3000"
                placeholderTextColor={colorScheme === 'dark' ? '#999' : '#ccc'}
                value={baseUrl}
                onChangeText={setBaseUrl}
                editable={!testingConnection && !importing && !syncing}
              />
            </ThemedView>

            <ThemedView style={styles.formGroup}>
              <ThemedText type="default" style={styles.label}>
                Bearer Token
              </ThemedText>
              <TextInput
                style={[styles.input, { color: textInputColor }]}
                placeholder="Enter your token"
                placeholderTextColor={colorScheme === 'dark' ? '#999' : '#ccc'}
                value={token}
                onChangeText={setToken}
                secureTextEntry
                editable={!testingConnection && !importing && !syncing}
              />
            </ThemedView>

            <Pressable
              style={[styles.button, styles.saveButton]}
              onPress={handleSaveSettings}
              disabled={testingConnection || importing || syncing}
            >
              <ThemedText type="default" style={styles.buttonText}>
                Save Settings
              </ThemedText>
            </Pressable>
          </ThemedView>

          <ThemedView style={styles.section}>
            <ThemedText type="subtitle">Bridge Connection</ThemedText>

            <Pressable
              style={[styles.button, styles.actionButton]}
              onPress={handleTestConnection}
              disabled={testingConnection || importing || syncing}
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
                  connectionStatus.startsWith('✓')
                    ? styles.successText
                    : styles.errorText,
                ]}
              >
                {connectionStatus}
              </ThemedText>
            )}
          </ThemedView>

          <ThemedView style={styles.section}>
            <ThemedText type="subtitle">Sync Operations</ThemedText>

            <Pressable
              style={[styles.button, styles.actionButton]}
              onPress={handleImportRoutines}
              disabled={importing || syncing || testingConnection}
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
                  importStatus.startsWith('✓')
                    ? styles.successText
                    : styles.errorText,
                ]}
              >
                {importStatus}
              </ThemedText>
            )}

            <Pressable
              style={[styles.button, styles.actionButton, { marginTop: Spacing.three }]}
              onPress={handleSync}
              disabled={syncing || importing || testingConnection}
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
                  syncStatus.startsWith('✓')
                    ? styles.successText
                    : styles.errorText,
                ]}
              >
                {syncStatus}
              </ThemedText>
            )}
          </ThemedView>
        </ScrollView>
      </SafeAreaView>
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
    alignItems: 'center',
    paddingBottom: BottomTabInset + Spacing.three,
    maxWidth: MaxContentWidth,
  },
  content: {
    alignItems: 'stretch',
    justifyContent: 'flex-start',
    width: '100%',
    gap: Spacing.four,
    paddingTop: Spacing.four,
  },
  title: {
    textAlign: 'center',
    marginBottom: Spacing.two,
  },
  section: {
    gap: Spacing.three,
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
    borderColor: '#ccc',
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
  },
  saveButton: {
    backgroundColor: '#208AEF',
  },
  actionButton: {
    backgroundColor: '#208AEF',
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
