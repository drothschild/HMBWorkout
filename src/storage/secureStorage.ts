/**
 * Secure storage backend for settings persistence, loaded lazily and defensively.
 *
 * expo-secure-store is a native module. If it isn't present in the running binary
 * (e.g. the app was built before it was added, or on web), requiring it throws.
 * We must NEVER let that crash app boot — a missing persistence backend should
 * only mean "settings don't persist this session", not a white screen. So the
 * module is required lazily inside each method and every failure degrades to a
 * no-op / null.
 */

type SecureStoreModule = typeof import('expo-secure-store');

// undefined = not attempted yet; null = attempted and unavailable.
let cachedModule: SecureStoreModule | null | undefined;

function getModule(): SecureStoreModule | null {
  if (cachedModule === undefined) {
    try {
      // Lazy require so a missing native module is catchable here rather than
      // throwing at import time (which would brick the whole app on boot).
      cachedModule = require('expo-secure-store') as SecureStoreModule;
    } catch (error) {
      console.warn(
        'expo-secure-store native module unavailable — bridge settings will not persist this session. Rebuild the dev client to enable persistence.',
        error
      );
      cachedModule = null;
    }
  }
  return cachedModule;
}

export const secureStorageBackend = {
  async getItemAsync(key: string): Promise<string | null> {
    const mod = getModule();
    if (!mod) return null;
    try {
      return await mod.getItemAsync(key);
    } catch (error) {
      console.error(`Failed to get item from secure store: ${key}`, error);
      return null;
    }
  },

  async setItemAsync(key: string, value: string): Promise<void> {
    const mod = getModule();
    if (!mod) return;
    try {
      await mod.setItemAsync(key, value);
    } catch (error) {
      console.error(`Failed to set item in secure store: ${key}`, error);
    }
  },

  async deleteItemAsync(key: string): Promise<void> {
    const mod = getModule();
    if (!mod) return;
    try {
      await mod.deleteItemAsync(key);
    } catch (error) {
      console.error(`Failed to delete item from secure store: ${key}`, error);
    }
  },
};
