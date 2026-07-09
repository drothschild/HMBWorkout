/**
 * Secure storage wrapper using expo-secure-store.
 * Provides the StorageBackend interface for settings persistence.
 * This file imports native modules; never import in tests.
 */

import * as SecureStore from 'expo-secure-store';

export const secureStorageBackend = {
  async getItemAsync(key: string): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(key);
    } catch (error) {
      console.error(`Failed to get item from secure store: ${key}`, error);
      return null;
    }
  },

  async setItemAsync(key: string, value: string): Promise<void> {
    try {
      await SecureStore.setItemAsync(key, value);
    } catch (error) {
      console.error(`Failed to set item in secure store: ${key}`, error);
    }
  },

  async deleteItemAsync(key: string): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch (error) {
      console.error(`Failed to delete item from secure store: ${key}`, error);
    }
  },
};
