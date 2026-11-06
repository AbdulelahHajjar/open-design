// Source scanning shared by the dark-theme sync guards
// (tests/styles/dark-theme-*.test.ts). See src/styles/theme-dark/README.md.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const REPO_ROOT = resolve(WEB_ROOT, '../..');
export const WEB_SRC = join(WEB_ROOT, 'src');
export const COMPONENTS_SRC = join(REPO_ROOT, 'packages/components/src');
export const THEME_DARK_DIR = join(WEB_SRC, 'styles/theme-dark');

/** The marker that opens a CSS Module's fork-owned dark block (README rule 5). */
export const MODULE_DARK_MARKER = '/* ── dark theme (fork)';

/** Overlay files that may hold color literals: the palette and the tokens. */
export const LITERAL_SOURCES = new Set(['palette.css', 'tokens.css']);

export function repoPath(file: string): string {
  return relative(REPO_ROOT, file).split('\\').join('/');
}

export function walk(dir: string, accept: (file: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'remixicon') continue;
      out.push(...walk(full, accept));
    } else if (accept(full)) {
      out.push(full);
    }
  }
  return out.sort();
}

export const read = (file: string): string => readFileSync(file, 'utf8');

export function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Upstream stylesheets: every app and shared-component sheet outside the overlay. */
export function upstreamStylesheets(): string[] {
  return [
    ...walk(WEB_SRC, (file) => file.endsWith('.css') && !file.startsWith(THEME_DARK_DIR)),
    ...walk(COMPONENTS_SRC, (file) => file.endsWith('.css')),
  ];
}

export function overlaySheets(): string[] {
  return walk(THEME_DARK_DIR, (file) => file.endsWith('.css'));
}

/** Splits a CSS Module into its upstream part and its fork-owned dark block. */
export function splitModuleDarkBlock(css: string): { upstream: string; dark: string | null } {
  const index = css.indexOf(MODULE_DARK_MARKER);
  if (index < 0) return { upstream: css, dark: null };
  return { upstream: css.slice(0, index), dark: css.slice(index) };
}

export type Declaration = {
  /** Innermost rule prelude, whitespace-normalised (`@media …` wrappers kept apart). */
  selector: string;
  property: string;
  value: string;
};

/** Declarations with the selector of the rule that holds them. */
export function declarations(css: string): Declaration[] {
  const source = stripComments(css).replace(/url\((?:[^()"']|"[^"]*"|'[^']*')*\)/g, 'url()');
  const out: Declaration[] = [];
  const stack: string[] = [];
  let buffer = '';
  for (const char of source) {
    if (char === '{') {
      stack.push(buffer.trim().replace(/\s+/g, ' '));
      buffer = '';
    } else if (char === '}') {
      pushDeclaration(buffer, stack, out);
      stack.pop();
      buffer = '';
    } else if (char === ';') {
      pushDeclaration(buffer, stack, out);
      buffer = '';
    } else {
      buffer += char;
    }
  }
  return out;
}

function pushDeclaration(text: string, stack: string[], out: Declaration[]): void {
  const colon = text.indexOf(':');
  if (colon < 0) return;
  const property = text.slice(0, colon).trim();
  if (!/^-?-?[a-zA-Z][\w-]*$/.test(property)) return;
  const selector = stack.filter((prelude) => !prelude.startsWith('@')).at(-1) ?? '';
  out.push({ selector, property, value: text.slice(colon + 1).trim().replace(/\s+/g, ' ') });
}

const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(|(?<![-\w])(?:white|black)(?![-\w])/gi;

/** Color literals in a declaration value, ignoring `var(--x, fallback)` fallbacks. */
export function colorLiterals(value: string): string[] {
  let withoutFallbacks = value;
  let previous = '';
  while (previous !== withoutFallbacks) {
    previous = withoutFallbacks;
    withoutFallbacks = withoutFallbacks.replace(/var\(\s*--[\w-]+\s*,(?:[^()]|\([^()]*\))*\)/g, 'var()');
  }
  return withoutFallbacks.match(COLOR_LITERAL) ?? [];
}

/** Custom properties a CSS block body defines. */
export function definedCustomProperties(css: string): Set<string> {
  const names = new Set<string>();
  for (const match of stripComments(css).matchAll(/(--[\w-]+)\s*:/g)) names.add(match[1]!);
  return names;
}

/** Every identifier-like token in the app and shared-component sources. */
export function sourceIdentifiers(): Set<string> {
  const files = [
    ...walk(WEB_SRC, (file) => /\.(tsx?|css)$/.test(file) && !file.startsWith(THEME_DARK_DIR)),
    ...walk(COMPONENTS_SRC, (file) => /\.(tsx?|css)$/.test(file)),
  ];
  const identifiers = new Set<string>();
  for (const file of files) {
    let text = read(file);
    if (file.endsWith('.css')) text = splitModuleDarkBlock(text).upstream;
    for (const match of text.matchAll(/[A-Za-z_][\w-]*/g)) identifiers.add(match[0]);
  }
  return identifiers;
}

/** Class names a selector list references, outside `:global()` wrappers and attribute values. */
export function selectorClasses(selector: string, { skipGlobal }: { skipGlobal: boolean }): string[] {
  let text = selector.replace(/\[[^\]]*\]/g, '[]');
  if (skipGlobal) {
    let previous = '';
    while (previous !== text) {
      previous = text;
      text = text.replace(/:global\((?:[^()]|\([^()]*\))*\)/g, '');
    }
  }
  return [...text.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((match) => match[1]!);
}
