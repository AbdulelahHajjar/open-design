import { useSyncExternalStore } from 'react';

/**
 * The user's theme choice, stored per browser under its own key.
 *
 * It deliberately does not live in `open-design:config`: `loadConfig()` coerces
 * `config.theme` to light on every read and writes the result back, so a
 * preference kept there would be erased on the next load. The document theme is
 * resolved from this key alone; `config.theme` is not read anywhere.
 */
export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_PREFERENCE_STORAGE_KEY = 'open-design:theme';
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system';
export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';

export function normalizeThemePreference(value: unknown): ThemePreference | null {
  return value === 'system' || value === 'light' || value === 'dark' ? value : null;
}

/**
 * The preference chosen in this document. It wins over storage, so a choice
 * still applies when storage rejects the write (blocked, or over quota).
 */
let chosenPreference: ThemePreference | null = null;

export function readThemePreference(): ThemePreference {
  if (chosenPreference) return chosenPreference;
  try {
    return (
      normalizeThemePreference(window.localStorage.getItem(THEME_PREFERENCE_STORAGE_KEY)) ??
      DEFAULT_THEME_PREFERENCE
    );
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
}

/**
 * Records the preference for this document and persists it, best effort.
 * Returns false when storage rejected the write.
 */
export function writeThemePreference(preference: ThemePreference): boolean {
  chosenPreference = preference;
  try {
    window.localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, preference);
    return true;
  } catch {
    return false;
  }
}

/** Drops this document's choice so the next read comes from storage (another window wrote it). */
export function forgetChosenThemePreference(): void {
  chosenPreference = null;
}

export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(DARK_SCHEME_QUERY).matches;
}

export function resolveTheme(preference: ThemePreference = readThemePreference()): ResolvedTheme {
  if (preference === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return preference;
}

/** Subscribes to OS appearance changes. Returns an unsubscribe function. */
export function subscribeToSystemTheme(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const media = window.matchMedia(DARK_SCHEME_QUERY);
  if (typeof media.addEventListener === 'function') {
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }
  media.addListener?.(onChange);
  return () => media.removeListener?.(onChange);
}

/**
 * The theme currently stamped on `<html data-theme>`. Readers use this rather
 * than re-resolving the preference so they always agree with the CSS that is
 * actually applied.
 */
export function readDocumentTheme(): ResolvedTheme {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

const themeListeners = new Set<() => void>();

/** Notifies subscribers that the stamped theme or the stored preference changed. */
export function emitThemeChange(): void {
  for (const listener of themeListeners) listener();
}

export function subscribeToThemeChanges(listener: () => void): () => void {
  themeListeners.add(listener);
  return () => {
    themeListeners.delete(listener);
  };
}

export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribeToThemeChanges, readDocumentTheme, () => 'light');
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(
    subscribeToThemeChanges,
    readThemePreference,
    () => DEFAULT_THEME_PREFERENCE,
  );
}
