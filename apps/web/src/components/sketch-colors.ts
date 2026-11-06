export const DEFAULT_SKETCH_LIGHT_TOOL_COLOR = '#1c1b1a';
/**
 * Excalidraw stores light-mode colors and renders its dark theme by putting
 * `invert(93%) hue-rotate(180deg)` over the canvas. The dark-theme default
 * pen is therefore the same dark ink, which displays as near-white; a stored
 * white pen would display near-black on the dark canvas and export as white on
 * the white export background.
 */
export const DEFAULT_SKETCH_DARK_TOOL_COLOR = DEFAULT_SKETCH_LIGHT_TOOL_COLOR;

export function resolveDefaultSketchToolColor(
  theme: string | null,
  prefersDark: boolean,
): string {
  if (theme === 'dark') return DEFAULT_SKETCH_DARK_TOOL_COLOR;
  if (theme === 'light') return DEFAULT_SKETCH_LIGHT_TOOL_COLOR;
  return prefersDark ? DEFAULT_SKETCH_DARK_TOOL_COLOR : DEFAULT_SKETCH_LIGHT_TOOL_COLOR;
}

export function readDefaultSketchToolColor(): string {
  if (typeof document === 'undefined') return DEFAULT_SKETCH_LIGHT_TOOL_COLOR;
  const theme = document.documentElement.getAttribute('data-theme');
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
  return resolveDefaultSketchToolColor(theme, prefersDark);
}
