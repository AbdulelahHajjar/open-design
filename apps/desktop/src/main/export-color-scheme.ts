import { nativeTheme, type BrowserWindow, type Debugger, type WebContents } from "electron";

export type EmulatedMediaFeature = { name: string; value: string };

type DebuggerLike = Pick<Debugger, "attach" | "sendCommand"> & Partial<Pick<Debugger, "isAttached">>;

const LIGHT_COLOR_SCHEME: EmulatedMediaFeature = {
  name: "prefers-color-scheme",
  value: "light",
};
const pinnedToLight = new WeakSet<WebContents>();

/**
 * Loads authored content into an offscreen export or capture window so it
 * renders in the light color scheme, whatever the app theme.
 *
 * An export is the user's design and must not depend on the app theme. Every
 * window's `prefers-color-scheme` follows the native appearance, which follows
 * the app theme (`nativeTheme.themeSource`), so a design with dark-mode CSS, or
 * a script that reads the scheme once at startup, would otherwise export its
 * dark branch whenever the app is dark.
 *
 * When the native appearance is already light, this is just `load()`. When it
 * is dark, the document loads, the window is pinned to light through a
 * DevTools emulation, and the document loads again so its scripts initialise
 * under light. The pin is set after a first load on purpose: a debugger
 * session attached before the window's first navigation stalls frame capture
 * in real Electron.
 *
 * The emulation lasts while the debugger stays attached, so the window keeps it
 * attached for its throwaway lifetime. Other capture code attaches through
 * `attachDebuggerIfDetached` and sets media through `withLightColorScheme`,
 * because `Emulation.setEmulatedMedia` replaces the whole feature list.
 *
 * Best effort: when the debugger is unavailable the export still runs, in the
 * app's color scheme.
 */
export async function loadInLightColorScheme(
  window: BrowserWindow,
  load: () => Promise<void>,
): Promise<void> {
  await load();
  if (!nativeAppearanceIsDark()) return;
  if (!(await pinWindowToLightColorScheme(window))) return;
  await load();
}

/**
 * Whether new windows render dark. Reads as light where Electron's native
 * theme is unavailable (test doubles of the `electron` module), which keeps
 * the plain load path.
 */
function nativeAppearanceIsDark(): boolean {
  try {
    return nativeTheme.shouldUseDarkColors === true;
  } catch {
    return false;
  }
}

/** Pins `window` to the light color scheme. Returns false when the debugger is unavailable. */
export async function pinWindowToLightColorScheme(window: BrowserWindow): Promise<boolean> {
  const target = window.webContents.debugger as DebuggerLike | undefined;
  if (!target || typeof target.attach !== "function") return false;
  try {
    attachDebuggerIfDetached(target);
    await target.sendCommand("Emulation.setEmulatedMedia", { features: [LIGHT_COLOR_SCHEME] });
    pinnedToLight.add(window.webContents);
    return true;
  } catch (error) {
    console.warn("[export] could not pin the light color scheme; rendering in the app's scheme:", error);
    return false;
  }
}

/** The media features to emulate on `contents`, keeping its light pin. */
export function withLightColorScheme(
  contents: WebContents,
  features: EmulatedMediaFeature[],
): EmulatedMediaFeature[] {
  if (!pinnedToLight.has(contents)) return features;
  return [...features.filter((feature) => feature.name !== LIGHT_COLOR_SCHEME.name), LIGHT_COLOR_SCHEME];
}

/**
 * Attaches the debugger unless something (the light pin) already holds it.
 * Returns true when this call attached it, and so owns detaching it. Throws
 * when attaching fails, like `attach` itself.
 */
export function attachDebuggerIfDetached(target: DebuggerLike): boolean {
  if (typeof target.isAttached === "function" && target.isAttached()) return false;
  target.attach("1.3");
  return true;
}
