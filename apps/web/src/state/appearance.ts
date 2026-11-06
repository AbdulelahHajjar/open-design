import { getOpenDesignHost } from '@open-design/host';
import type { AppTheme } from '../types';
import {
  emitThemeChange,
  forgetChosenThemePreference,
  readThemePreference,
  resolveTheme,
  subscribeToSystemTheme,
  THEME_PREFERENCE_STORAGE_KEY,
  writeThemePreference,
  type ResolvedTheme,
  type ThemePreference,
} from './theme-preference';

const ACCENT_VARS = [
  '--accent',
  '--accent-strong',
  '--accent-soft',
  '--accent-tint',
  '--accent-hover',
] as const;

export const DEFAULT_ACCENT_COLOR = '#353535';
export const ACCENT_SWATCHES = [
  DEFAULT_ACCENT_COLOR,
  '#202020',
  '#848484',
  '#87ea5c',
  '#0d5400',
  '#1A74FF',
  '#FFBA12',
  '#FF7528',
  '#F04142',
] as const;

/**
 * The darkest surface an accent sits on as text in the dark theme
 * (`--bg-elevated` in `styles/theme-dark/tokens.css`). Keep in sync with
 * `DARK_ACCENT_SURFACE` in `app/theme-init-script.ts`.
 */
const DARK_ACCENT_SURFACE = '#0f131a';
const MIN_DARK_ACCENT_CONTRAST = 4.5;

/** `<meta name="theme-color">` per theme; light matches `viewport.themeColor`. */
export const THEME_COLOR_META = { light: '#f7f7f7', dark: '#05080d' } as const;

export function normalizeAccentColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed.toLowerCase() : null;
}

export function resolveAccentColor(value: unknown): string {
  return normalizeAccentColor(value) ?? DEFAULT_ACCENT_COLOR;
}

function accentVars(accentColor: string): Record<(typeof ACCENT_VARS)[number], string> {
  return {
    '--accent': accentColor,
    // Keep these mix ratios in sync with the pre-hydration script in app/theme-init-script.ts.
    '--accent-strong': `color-mix(in srgb, ${accentColor} 82%, var(--text-strong))`,
    '--accent-soft': `color-mix(in srgb, ${accentColor} 12%, var(--bg-subtle))`,
    '--accent-tint': `color-mix(in srgb, ${accentColor} 6%, var(--bg-panel))`,
    '--accent-hover': `color-mix(in srgb, ${accentColor} 86%, var(--text-strong))`,
  };
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Whether a saved accent can stay inline in the dark theme. The accent doubles
 * as small text (links, active labels), so it must read on the darkest raised
 * surface. The default accent is a near-black that never qualifies; it and any
 * other illegible accent yield to the dark theme's own `--accent*` tokens.
 */
export function isAccentLegibleInDarkTheme(accentColor: string): boolean {
  if (accentColor === DEFAULT_ACCENT_COLOR) return false;
  return contrastRatio(accentColor, DARK_ACCENT_SURFACE) >= MIN_DARK_ACCENT_CONTRAST;
}

/**
 * The value `loadConfig()` coerces `config.theme` to.
 *
 * Upstream removed the in-config theme setting and rewrites every persisted
 * `config.theme` to this value on load. The document theme no longer comes from
 * config at all: it is the user's preference from `./theme-preference`, stored
 * under its own key so this coercion cannot erase it.
 */
export const FORCED_APP_THEME = 'light' as const;

/** Coerces a persisted `config.theme` for the config object only (see FORCED_APP_THEME). */
export function resolveAppTheme(persisted?: AppTheme | null): AppTheme {
  return persisted === FORCED_APP_THEME ? persisted : FORCED_APP_THEME;
}

let lastAccentColor: string | null = null;

/**
 * The accent saved in config, for documents that render without the main app
 * (the desktop pet window) and so never call `applyAppearanceToDocument`.
 * Mirrors the accent read in `app/theme-init-script.ts`.
 */
function readStoredAccentColor(): string {
  try {
    const parsed = JSON.parse(window.localStorage.getItem('open-design:config') || '{}') as {
      accentColor?: unknown;
      configMigrationVersion?: unknown;
    };
    const accent = resolveAccentColor(parsed.accentColor);
    if (parsed.configMigrationVersion !== 3 && (accent === '#87ea5c' || accent === '#c96442')) {
      return DEFAULT_ACCENT_COLOR;
    }
    return accent;
  } catch {
    return DEFAULT_ACCENT_COLOR;
  }
}

function applyAccent(root: HTMLElement, theme: ResolvedTheme, accentColor: string): void {
  if (theme === 'dark' && !isAccentLegibleInDarkTheme(accentColor)) {
    for (const name of ACCENT_VARS) root.style.removeProperty(name);
    return;
  }
  const vars = accentVars(accentColor);
  for (const name of ACCENT_VARS) root.style.setProperty(name, vars[name]);
}

function applyThemeColorMeta(theme: ResolvedTheme): void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  meta?.setAttribute('content', THEME_COLOR_META[theme]);
}

/**
 * Stamps the resolved theme and the accent on the document.
 *
 * `data-theme` is always present and always concrete (`light` or `dark`), even
 * for the System preference: every dark rule and JS theme reader keys off
 * `[data-theme='dark']`, and the legacy `html:not([data-theme])` media blocks
 * must stay inert.
 */
function applyResolvedAppearance(): void {
  const root = document.documentElement;
  const preference = readThemePreference();
  const theme = resolveTheme(preference);
  root.setAttribute('data-theme', theme);
  // Desktop shell: the native window appearance (macOS vibrancy glass, native
  // menus and dialogs) follows the preference. Passing `system` rather than
  // the resolved theme lets the shell track OS changes on its own.
  // Feature-detected — browsers and older host builds have no appearance
  // capability.
  getOpenDesignHost()?.appearance?.setTheme(preference);
  applyAccent(root, theme, lastAccentColor ?? readStoredAccentColor());
  applyThemeColorMeta(theme);
  emitThemeChange();
}

export function applyAppearanceToDocument({
  accentColor,
}: {
  accentColor?: string;
}): void {
  lastAccentColor = resolveAccentColor(accentColor);
  applyResolvedAppearance();
}

/** Saves the theme preference and applies it to this document immediately. */
export function setThemePreference(preference: ThemePreference): void {
  writeThemePreference(preference);
  applyResolvedAppearance();
}

let controllerInstalled = false;

/**
 * Keeps this document's theme in step with the OS (for the System preference)
 * and with preference changes made in other windows. Installed once per
 * document from the root layout, so every route — including the desktop pet
 * window, which never mounts the main app — follows the theme.
 */
export function installAppearanceController(): void {
  if (controllerInstalled || typeof window === 'undefined') return;
  controllerInstalled = true;
  subscribeToSystemTheme(() => {
    if (readThemePreference() === 'system') applyResolvedAppearance();
  });
  window.addEventListener('storage', (event) => {
    if (event.key === THEME_PREFERENCE_STORAGE_KEY || event.key === null) {
      forgetChosenThemePreference();
      applyResolvedAppearance();
    }
  });
  applyResolvedAppearance();
}
