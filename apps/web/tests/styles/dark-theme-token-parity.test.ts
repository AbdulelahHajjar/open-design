// Dark-theme sync guard: every color token the light theme defines has a dark
// value. Upstream ships light-only, so a new upstream token arrives with no
// dark value and would paint its light color in the dark theme — the way the
// original upstream dark theme decayed. See src/styles/theme-dark/README.md.

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  colorLiterals,
  overlaySheets,
  declarations,
  definedCustomProperties,
  read,
  splitModuleDarkBlock,
  THEME_DARK_DIR,
  WEB_SRC,
} from '../helpers/dark-theme-scan';

/** Light tokens that are deliberately the same in both themes. */
const THEME_INDEPENDENT = new Set([
  // The send button and upgrade pill are a fixed brand mark (tokens.css).
  '--brand',
  '--send-ground',
  '--send-ink',
  '--upgrade-ground',
  '--upgrade-ink',
  // Controls over media, not over the app ground (material.css).
  '--material-dim',
  '--vibrancy-label-on-dim',
  // Sizing and shape tokens that happen to carry a color.
  '--share-ink-dark-sm',
  '--share-published-fg',
]);

const GLOBAL_TOKEN_SHEETS = [
  'styles/tokens.css',
  'styles/material.css',
  'styles/app-wash.css',
  'styles/share-tokens.css',
];

/** Component seams whose light tokens live on a module's root class. */
const MODULE_SEAMS = [
  { file: 'components/workspace/TerminalViewer.module.css', prefix: '--terminal-' },
  { file: 'components/chat/ChatRoot.module.css', prefix: '--chat-' },
];

function lightColorTokens(css: string, selector: string, prefix = '--'): string[] {
  return declarations(css)
    .filter(
      (decl) =>
        decl.selector.split(',').some((part) => part.trim() === selector) &&
        decl.property.startsWith(prefix),
    )
    .filter((decl) => colorLiterals(decl.value).length > 0 || decl.value.includes('url()'))
    .map((decl) => decl.property);
}

describe('dark theme token parity', () => {
  const overlayTokens = new Set(overlaySheets().flatMap((file) => [...definedCustomProperties(read(file))]));
  const darkTokens = new Set([
    ...definedCustomProperties(read(join(THEME_DARK_DIR, 'tokens.css'))),
    ...definedCustomProperties(read(join(THEME_DARK_DIR, 'palette.css'))),
  ]);

  it.each(GLOBAL_TOKEN_SHEETS)('gives every light color token in %s a dark value', (sheet) => {
    const light = lightColorTokens(read(join(WEB_SRC, sheet)), ':root');
    // The scan must see the sheet's tokens at all, or the guard passes vacuously.
    expect(light.length).toBeGreaterThan(0);
    const missing = light.filter((token) => !darkTokens.has(token) && !THEME_INDEPENDENT.has(token));

    expect(
      missing,
      'Add these to styles/theme-dark/tokens.css, or to THEME_INDEPENDENT here if they are deliberately the same in dark.',
    ).toEqual([]);
  });

  it.each(MODULE_SEAMS)('gives every light $prefix token in $file a dark value', ({ file, prefix }) => {
    const { upstream, dark } = splitModuleDarkBlock(read(join(WEB_SRC, file)));
    const light = lightColorTokens(upstream, '.root', prefix);
    expect(light.length).toBeGreaterThan(0);
    // A seam token may also be set from the overlay (e.g. theme-dark/chat.css
    // on `[data-chat-root]`) when upstream tests pin the module's own copies.
    const defined = new Set([...(dark ? definedCustomProperties(dark) : []), ...overlayTokens]);
    const missing = light.filter((token) => !defined.has(token));

    expect(missing, `Add these to the dark block at the end of ${file}.`).toEqual([]);
  });
});
