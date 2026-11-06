// Dark-theme sync guard: flags hard-coded colors that arrive with an upstream
// sync. Upstream ships light-only, so a new literal color in a stylesheet or an
// inline style is usually a light-only surface the dark theme has not seen.
//
// The fixture is a snapshot of every literal at the time the dark theme last
// reviewed them. A new one fails this test until someone looks at it in dark,
// adds an override if it reads light (README rules), and re-snapshots:
//
//   UPDATE_DARK_COVERAGE=1 pnpm --filter @open-design/web exec vitest run tests/styles/dark-theme-coverage
//
// This is a review trigger, not proof of coverage. See
// src/styles/theme-dark/README.md.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  colorLiterals,
  declarations,
  read,
  repoPath,
  splitModuleDarkBlock,
  THEME_DARK_DIR,
  upstreamStylesheets,
  walk,
  WEB_SRC,
} from '../helpers/dark-theme-scan';

const FIXTURE = join(import.meta.dirname, 'fixtures/dark-theme-coverage.json');

/**
 * Sources whose colors are not app chrome: generated documents and exports
 * (authored content, always light), brand marks, and color pickers that show
 * a user's literal colors.
 */
const NOT_APP_CHROME = [
  'apps/web/src/runtime/',
  'apps/web/src/components/FileTypeIcon.tsx',
  'apps/web/src/components/support-brand-icons.tsx',
  'apps/web/src/utils/connectorBrandColor.ts',
];

const TS_COLOR = /(?:^|['"`(\s:,])(#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|(?:rgba?|hsla?)\()/;

function stylesheetFingerprints(file: string): string[] {
  const css = file.endsWith('.module.css') ? splitModuleDarkBlock(read(file)).upstream : read(file);
  return declarations(css)
    .filter((decl) => colorLiterals(decl.value).length > 0)
    .map((decl) => `${decl.selector} { ${decl.property}: ${decl.value} }`);
}

function sourceFingerprints(file: string): string[] {
  const out: string[] = [];
  let inBlockComment = false;
  for (const raw of read(file).split('\n')) {
    let line = raw.trim();
    if (inBlockComment) {
      if (line.includes('*/')) inBlockComment = false;
      continue;
    }
    if (line.startsWith('/*') && !line.includes('*/')) {
      inBlockComment = true;
      continue;
    }
    if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) continue;
    line = line.replace(/\s\/\/\s.*$/, '');
    if (TS_COLOR.test(line)) out.push(line.replace(/\s+/g, ' '));
  }
  return out;
}

function currentFingerprints(): Record<string, string[]> {
  const files = [
    ...upstreamStylesheets(),
    ...walk(WEB_SRC, (file) => /\.(tsx?)$/.test(file) && !file.startsWith(THEME_DARK_DIR)),
  ];
  const out: Record<string, string[]> = {};
  for (const file of files) {
    const path = repoPath(file);
    if (NOT_APP_CHROME.some((prefix) => path.startsWith(prefix))) continue;
    const prints = file.endsWith('.css') ? stylesheetFingerprints(file) : sourceFingerprints(file);
    if (prints.length) out[path] = [...new Set(prints)].sort();
  }
  return out;
}

describe('dark theme coverage fingerprints', () => {
  it('has no hard-coded colors the dark theme has not reviewed', () => {
    const current = currentFingerprints();
    if (process.env.UPDATE_DARK_COVERAGE === '1') {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, `${JSON.stringify(current, null, 2)}\n`);
    }
    expect(existsSync(FIXTURE), 'Missing fixture: snapshot it with UPDATE_DARK_COVERAGE=1.').toBe(true);
    const reviewed = JSON.parse(read(FIXTURE)) as Record<string, string[]>;

    const unreviewed: Record<string, string[]> = {};
    for (const [file, prints] of Object.entries(current)) {
      const known = new Set(reviewed[file] ?? []);
      const fresh = prints.filter((print) => !known.has(print));
      if (fresh.length) unreviewed[file] = fresh;
    }

    expect(
      unreviewed,
      'New hard-coded colors since the last dark-theme review. Check each in the dark theme, override it if it reads light, then re-snapshot with UPDATE_DARK_COVERAGE=1.',
    ).toEqual({});
  });
});
