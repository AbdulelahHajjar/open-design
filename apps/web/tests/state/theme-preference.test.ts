// @vitest-environment jsdom
//
// The theme is a per-browser preference (System / Light / Dark, default
// System) stored under its own key, outside `open-design:config` — whose
// `theme` field `loadConfig()` still coerces to light. These specs pin the
// three places the preference reaches the document: the runtime applier, the
// per-document controller (OS changes, other windows), and the pre-hydration
// script that paints before React mounts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { THEME_INIT_SCRIPT } from '../../app/theme-init-script';

const hostMock = vi.hoisted(() => ({ setTheme: vi.fn(), present: false }));

vi.mock('@open-design/host', () => ({
  getOpenDesignHost: () =>
    hostMock.present ? { appearance: { setTheme: hostMock.setTheme } } : null,
}));

const THEME_KEY = 'open-design:theme';
const CONFIG_KEY = 'open-design:config';
const ACCENT_VARS = ['--accent', '--accent-strong', '--accent-soft', '--accent-tint', '--accent-hover'];

const store = new Map<string, string>();
let storageThrows = false;

vi.stubGlobal('localStorage', {
  getItem: vi.fn((key: string) => {
    if (storageThrows) throw new Error('storage blocked');
    return store.get(key) ?? null;
  }),
  setItem: vi.fn((key: string, value: string) => {
    if (storageThrows) throw new Error('storage blocked');
    store.set(key, value);
  }),
  removeItem: vi.fn((key: string) => {
    store.delete(key);
  }),
  clear: vi.fn(() => {
    store.clear();
  }),
});

let osDark = false;
const mediaListeners = new Set<() => void>();

function installMatchMedia(): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      get matches() {
        return query.includes('prefers-color-scheme: dark') && osDark;
      },
      media: query,
      onchange: null,
      addListener: vi.fn((listener: () => void) => mediaListeners.add(listener)),
      removeListener: vi.fn((listener: () => void) => mediaListeners.delete(listener)),
      addEventListener: vi.fn((_type: string, listener: () => void) => mediaListeners.add(listener)),
      removeEventListener: vi.fn((_type: string, listener: () => void) =>
        mediaListeners.delete(listener),
      ),
      dispatchEvent: vi.fn(),
    })),
  );
}

function setOsDark(next: boolean): void {
  osDark = next;
  for (const listener of [...mediaListeners]) listener();
}

const root = () => document.documentElement;
const theme = () => root().getAttribute('data-theme');
const inlineAccent = () => root().style.getPropertyValue('--accent');

async function loadAppearance() {
  vi.resetModules();
  return import('../../src/state/appearance');
}

beforeEach(() => {
  store.clear();
  storageThrows = false;
  osDark = false;
  mediaListeners.clear();
  hostMock.present = false;
  hostMock.setTheme.mockReset();
  installMatchMedia();
});

afterEach(() => {
  root().removeAttribute('data-theme');
  for (const name of ACCENT_VARS) root().style.removeProperty(name);
  document.head.querySelector('meta[name="theme-color"]')?.remove();
});

describe('theme preference', () => {
  it('defaults to System and follows the OS', async () => {
    const { readThemePreference, resolveTheme } = await import('../../src/state/theme-preference');

    expect(readThemePreference()).toBe('system');
    expect(resolveTheme()).toBe('light');
    osDark = true;
    expect(resolveTheme()).toBe('dark');
  });

  it('ignores unknown stored values', async () => {
    store.set(THEME_KEY, 'sepia');
    const { readThemePreference } = await import('../../src/state/theme-preference');

    expect(readThemePreference()).toBe('system');
  });

  it('falls back to System when storage throws', async () => {
    storageThrows = true;
    osDark = true;
    const { readThemePreference, resolveTheme } = await import('../../src/state/theme-preference');

    expect(readThemePreference()).toBe('system');
    expect(resolveTheme()).toBe('dark');
  });
});

describe('applyAppearanceToDocument', () => {
  it('stamps the stored preference, ignoring the light-coerced config theme', async () => {
    store.set(THEME_KEY, 'dark');
    store.set(CONFIG_KEY, JSON.stringify({ theme: 'light' }));
    const { applyAppearanceToDocument } = await loadAppearance();

    applyAppearanceToDocument({ accentColor: undefined });

    expect(theme()).toBe('dark');
  });

  it('always stamps a concrete theme for System', async () => {
    const { applyAppearanceToDocument } = await loadAppearance();

    applyAppearanceToDocument({});
    expect(theme()).toBe('light');

    osDark = true;
    applyAppearanceToDocument({});
    expect(theme()).toBe('dark');
  });

  it('lets the dark tokens own the default accent', async () => {
    store.set(THEME_KEY, 'dark');
    const { applyAppearanceToDocument } = await loadAppearance();

    applyAppearanceToDocument({ accentColor: '#353535' });

    for (const name of ACCENT_VARS) expect(root().style.getPropertyValue(name)).toBe('');
  });

  it('drops a custom accent that is illegible on the dark surface', async () => {
    store.set(THEME_KEY, 'dark');
    const { applyAppearanceToDocument } = await loadAppearance();

    applyAppearanceToDocument({ accentColor: '#202020' });

    expect(inlineAccent()).toBe('');
  });

  it('keeps a custom accent that reads on the dark surface', async () => {
    store.set(THEME_KEY, 'dark');
    const { applyAppearanceToDocument } = await loadAppearance();

    applyAppearanceToDocument({ accentColor: '#FFBA12' });

    expect(inlineAccent()).toBe('#ffba12');
    expect(root().style.getPropertyValue('--accent-hover')).toContain('#ffba12');
  });

  it('keeps writing the default accent inline in light', async () => {
    store.set(THEME_KEY, 'light');
    const { applyAppearanceToDocument } = await loadAppearance();

    applyAppearanceToDocument({ accentColor: '#353535' });

    expect(inlineAccent()).toBe('#353535');
  });

  it('passes the preference, not the resolved theme, to the desktop host', async () => {
    hostMock.present = true;
    osDark = true;
    const { applyAppearanceToDocument } = await loadAppearance();

    applyAppearanceToDocument({});

    expect(hostMock.setTheme).toHaveBeenLastCalledWith('system');
  });

  it('updates the theme-color meta tag', async () => {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.content = '#f7f7f7';
    document.head.append(meta);
    store.set(THEME_KEY, 'dark');
    const { applyAppearanceToDocument } = await loadAppearance();

    applyAppearanceToDocument({});

    expect(meta.content).toBe('#05080d');
  });
});

describe('setThemePreference', () => {
  it('persists the choice and applies it at once, keeping the last accent', async () => {
    const { applyAppearanceToDocument, setThemePreference } = await loadAppearance();
    applyAppearanceToDocument({ accentColor: '#FFBA12' });

    setThemePreference('dark');

    expect(store.get(THEME_KEY)).toBe('dark');
    expect(theme()).toBe('dark');
    expect(inlineAccent()).toBe('#ffba12');

    setThemePreference('light');
    expect(theme()).toBe('light');
  });

  it('notifies theme subscribers', async () => {
    const appearance = await loadAppearance();
    const preference = await import('../../src/state/theme-preference');
    const listener = vi.fn();
    preference.subscribeToThemeChanges(listener);

    appearance.setThemePreference('dark');

    expect(listener).toHaveBeenCalled();
    expect(preference.readDocumentTheme()).toBe('dark');
  });
});

describe('setThemePreference when storage rejects writes', () => {
  it('still applies the choice for this document', async () => {
    const { setThemePreference } = await loadAppearance();
    storageThrows = true;

    setThemePreference('dark');

    expect(theme()).toBe('dark');
    const { readThemePreference } = await import('../../src/state/theme-preference');
    expect(readThemePreference()).toBe('dark');
  });
});

describe('installAppearanceController', () => {
  it('follows OS changes while the preference is System', async () => {
    const { installAppearanceController } = await loadAppearance();
    installAppearanceController();
    expect(theme()).toBe('light');

    setOsDark(true);
    expect(theme()).toBe('dark');

    setOsDark(false);
    expect(theme()).toBe('light');
  });

  it('ignores OS changes while a theme is pinned', async () => {
    store.set(THEME_KEY, 'light');
    const { installAppearanceController } = await loadAppearance();
    installAppearanceController();

    setOsDark(true);

    expect(theme()).toBe('light');
  });

  it('applies a preference changed in another window', async () => {
    const { installAppearanceController } = await loadAppearance();
    installAppearanceController();

    store.set(THEME_KEY, 'dark');
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_KEY, newValue: 'dark' }));

    expect(theme()).toBe('dark');
  });

  it('applies the stored accent in documents that never mount the app', async () => {
    store.set(THEME_KEY, 'light');
    store.set(CONFIG_KEY, JSON.stringify({ accentColor: '#1A74FF', configMigrationVersion: 3 }));
    const { installAppearanceController } = await loadAppearance();

    installAppearanceController();

    expect(inlineAccent()).toBe('#1a74ff');
  });
});

describe('pre-hydration script', () => {
  function runScript(): void {
    // eslint-disable-next-line no-new-func
    new Function(THEME_INIT_SCRIPT)();
  }

  it('paints the stored dark preference', () => {
    store.set(THEME_KEY, 'dark');

    runScript();

    expect(theme()).toBe('dark');
  });

  it('resolves System from the OS', () => {
    osDark = true;

    runScript();

    expect(theme()).toBe('dark');
  });

  it('pins light over a dark OS', () => {
    osDark = true;
    store.set(THEME_KEY, 'light');

    runScript();

    expect(theme()).toBe('light');
  });

  it('still resolves the theme from the OS when storage throws', () => {
    osDark = true;
    storageThrows = true;

    runScript();

    expect(theme()).toBe('dark');
  });

  it('stamps the theme even when the config JSON is malformed', () => {
    store.set(THEME_KEY, 'dark');
    store.set(CONFIG_KEY, '{not json');

    runScript();

    expect(theme()).toBe('dark');
  });

  it('leaves the default accent to the dark tokens', () => {
    store.set(THEME_KEY, 'dark');

    runScript();

    expect(inlineAccent()).toBe('');
  });

  it('writes a legible custom accent in dark and every accent in light', () => {
    store.set(THEME_KEY, 'dark');
    store.set(CONFIG_KEY, JSON.stringify({ accentColor: '#FFBA12', configMigrationVersion: 3 }));
    runScript();
    expect(inlineAccent()).toBe('#ffba12');

    for (const name of ACCENT_VARS) root().style.removeProperty(name);
    store.set(THEME_KEY, 'light');
    store.set(CONFIG_KEY, JSON.stringify({}));
    runScript();
    expect(inlineAccent()).toBe('#353535');
  });

  it('agrees with the runtime legibility rule', async () => {
    const { isAccentLegibleInDarkTheme } = await loadAppearance();
    for (const accent of ['#202020', '#848484', '#0d5400', '#1a74ff', '#ffba12', '#ff7528', '#f04142']) {
      for (const name of ACCENT_VARS) root().style.removeProperty(name);
      store.set(THEME_KEY, 'dark');
      store.set(CONFIG_KEY, JSON.stringify({ accentColor: accent, configMigrationVersion: 3 }));

      runScript();

      expect(inlineAccent() !== '').toBe(isAccentLegibleInDarkTheme(accent));
    }
  });
});
