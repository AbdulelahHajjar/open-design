// Dark-theme sync guards for the overlay itself: every class it overrides must
// still exist upstream (a rename after a sync would silently leave the light
// style in place), and its colors must come from tokens (so the palette stays
// tunable in one place and contrast stays checked). See
// src/styles/theme-dark/README.md.

import { basename } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  colorLiterals,
  declarations,
  LITERAL_SOURCES,
  overlaySheets,
  read,
  repoPath,
  selectorClasses,
  sourceIdentifiers,
  splitModuleDarkBlock,
  upstreamStylesheets,
} from '../helpers/dark-theme-scan';

const moduleDarkBlocks = upstreamStylesheets()
  .filter((file) => file.endsWith('.module.css'))
  .map((file) => ({ file, ...splitModuleDarkBlock(read(file)) }))
  .filter((entry): entry is { file: string; upstream: string; dark: string } => entry.dark !== null);

describe('dark theme overlay selectors', () => {
  const identifiers = sourceIdentifiers();

  it.each(overlaySheets().map((file) => [repoPath(file), file]))(
    'only overrides classes that still exist upstream: %s',
    (_name, file) => {
      const stale = new Set<string>();
      for (const decl of declarations(read(file))) {
        for (const name of selectorClasses(decl.selector, { skipGlobal: false })) {
          if (!identifiers.has(name)) stale.add(name);
        }
      }

      expect([...stale], 'Upstream renamed or removed these classes; retarget or delete their overrides.').toEqual([]);
    },
  );

  it('finds the CSS Module dark blocks it guards', () => {
    expect(moduleDarkBlocks.length).toBeGreaterThan(0);
  });

  it.each(moduleDarkBlocks.map((entry) => [repoPath(entry.file), entry]))(
    'only overrides local classes the module still defines: %s',
    (_name, { upstream, dark }) => {
      const local = new Set(
        declarations(upstream).flatMap((decl) => selectorClasses(decl.selector, { skipGlobal: true })),
      );
      const stale = new Set<string>();
      for (const decl of declarations(dark)) {
        for (const name of selectorClasses(decl.selector, { skipGlobal: true })) {
          if (!local.has(name)) stale.add(name);
        }
      }

      expect([...stale], 'The module no longer defines these classes; retarget or delete their dark rules.').toEqual([]);
    },
  );
});

describe('dark theme overlay colors', () => {
  it.each(
    overlaySheets()
      .filter((file) => !LITERAL_SOURCES.has(basename(file)))
      .map((file) => [repoPath(file), file]),
  )('uses only tokens: %s', (_name, file) => {
    const literals = declarations(read(file)).flatMap((decl) =>
      colorLiterals(decl.value).map((literal) => `${decl.selector} { ${decl.property}: ${decl.value} }  (${literal})`),
    );

    expect(literals, 'Use a token from theme-dark/tokens.css instead of a literal color.').toEqual([]);
  });

  it.each(moduleDarkBlocks.map((entry) => [repoPath(entry.file), entry]))(
    'uses only tokens in the module dark block: %s',
    (_name, { dark }) => {
      const literals = declarations(dark).flatMap((decl) =>
        colorLiterals(decl.value).map((literal) => `${decl.selector} { ${decl.property}: ${decl.value} }  (${literal})`),
      );

      expect(literals, 'Use a token from theme-dark/tokens.css instead of a literal color.').toEqual([]);
    },
  );
});
