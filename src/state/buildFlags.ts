// pattern: Functional Core
/**
 * Build-time feature flags (#397). Metro inlines only literal
 * `process.env.EXPO_PUBLIC_*` member accesses, so the default environment
 * names each variable explicitly instead of passing `process.env` whole.
 */
export type BuildFlagEnv = { readonly EXPO_PUBLIC_WEB_IMAGE_FALLBACK?: string | undefined };

export function currentBuildEnv(): BuildFlagEnv {
  return { EXPO_PUBLIC_WEB_IMAGE_FALLBACK: process.env.EXPO_PUBLIC_WEB_IMAGE_FALLBACK };
}

/** Web (Bing) exercise images are opt-in: only the exact value "1" enables them. */
export function webImageFallbackEnabled(env: BuildFlagEnv = currentBuildEnv()): boolean {
  return env.EXPO_PUBLIC_WEB_IMAGE_FALLBACK === '1';
}
