import { describe, expect, it, vi } from 'vitest';

const nativeThemeMock = vi.hoisted(() => ({ shouldUseDarkColors: false }));
vi.mock('electron', () => ({ nativeTheme: nativeThemeMock }));

import {
  attachDebuggerIfDetached,
  loadInLightColorScheme,
  pinWindowToLightColorScheme,
  withLightColorScheme,
} from '../../src/main/export-color-scheme.js';

function fakeWindow(options: { attached?: boolean; attachThrows?: boolean } = {}) {
  let attached = options.attached ?? false;
  const debuggerStub = {
    attach: vi.fn(() => {
      if (options.attachThrows) throw new Error('Another debugger is already attached');
      attached = true;
    }),
    isAttached: vi.fn(() => attached),
    sendCommand: vi.fn(async () => ({})),
  };
  const webContents = { debugger: debuggerStub };
  return { window: { webContents } as never, webContents: webContents as never, debuggerStub };
}

describe('export color scheme', () => {
  it('pins an export window to the light color scheme', async () => {
    const { window, debuggerStub } = fakeWindow();

    await expect(pinWindowToLightColorScheme(window)).resolves.toBe(true);

    expect(debuggerStub.attach).toHaveBeenCalledWith('1.3');
    expect(debuggerStub.sendCommand).toHaveBeenCalledWith('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: 'light' }],
    });
  });

  it('keeps the pin when other emulation replaces the feature list', async () => {
    const { window, webContents } = fakeWindow();
    await pinWindowToLightColorScheme(window);

    expect(withLightColorScheme(webContents, [{ name: 'prefers-reduced-motion', value: 'reduce' }])).toEqual([
      { name: 'prefers-reduced-motion', value: 'reduce' },
      { name: 'prefers-color-scheme', value: 'light' },
    ]);
  });

  it('leaves unpinned windows untouched', () => {
    const { webContents } = fakeWindow();

    expect(withLightColorScheme(webContents, [{ name: 'prefers-reduced-motion', value: 'reduce' }])).toEqual([
      { name: 'prefers-reduced-motion', value: 'reduce' },
    ]);
  });

  it('lets capture code reuse the pinned session instead of attaching twice', async () => {
    const { window, debuggerStub } = fakeWindow();
    await pinWindowToLightColorScheme(window);

    expect(attachDebuggerIfDetached(debuggerStub)).toBe(false);
    expect(debuggerStub.attach).toHaveBeenCalledOnce();
  });

  it('exports in the app scheme rather than failing when the debugger is unavailable', async () => {
    const { window } = fakeWindow({ attachThrows: true });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(pinWindowToLightColorScheme(window)).resolves.toBe(false);

    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('loads once and never touches the debugger when windows already render light', async () => {
    nativeThemeMock.shouldUseDarkColors = false;
    const { window, debuggerStub } = fakeWindow();
    const load = vi.fn(async () => {});

    await loadInLightColorScheme(window, load);

    expect(load).toHaveBeenCalledOnce();
    expect(debuggerStub.attach).not.toHaveBeenCalled();
  });

  it('pins light and loads again when windows render dark, so authored scripts start under light', async () => {
    nativeThemeMock.shouldUseDarkColors = true;
    const { window, debuggerStub } = fakeWindow();
    const order: string[] = [];
    debuggerStub.sendCommand.mockImplementation(async () => {
      order.push('pin');
      return {};
    });
    const load = vi.fn(async () => {
      order.push('load');
    });

    await loadInLightColorScheme(window, load);

    expect(order).toEqual(['load', 'pin', 'load']);
    nativeThemeMock.shouldUseDarkColors = false;
  });

  it('keeps the single load when the pin cannot be set', async () => {
    nativeThemeMock.shouldUseDarkColors = true;
    const { window } = fakeWindow({ attachThrows: true });
    const load = vi.fn(async () => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await loadInLightColorScheme(window, load);

    expect(load).toHaveBeenCalledOnce();
    warn.mockRestore();
    nativeThemeMock.shouldUseDarkColors = false;
  });
});
