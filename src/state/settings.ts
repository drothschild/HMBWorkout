/**
 * Settings store for bridge configuration.
 * Holds bridge URL and API token.
 */

interface BridgeSettings {
  baseUrl: string;
  token: string;
}

// Simple module-level store (can be upgraded to Zustand if persistence needed)
let settings: BridgeSettings = {
  baseUrl: process.env.REACT_APP_BRIDGE_URL || 'http://localhost:3000',
  token: process.env.REACT_APP_BRIDGE_TOKEN || '',
};

/**
 * Get current bridge settings.
 */
export function getSettings(): BridgeSettings {
  return { ...settings };
}

/**
 * Update bridge settings.
 */
export function setSettings(newSettings: Partial<BridgeSettings>): void {
  settings = { ...settings, ...newSettings };
}
