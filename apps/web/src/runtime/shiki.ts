import type { HighlighterGeneric } from 'shiki';
import { GHOSTTY_DARK_SHIKI_THEME_NAME, ghosttyDarkShikiTheme } from './shiki-ghostty-theme';

let highlighterPromise: Promise<HighlighterGeneric<any, any>> | null = null;

const cache = new Map<string, string>();
const CACHE_MAX = 128;

function getHighlighter(): Promise<HighlighterGeneric<any, any>> {
  if (!highlighterPromise) {
    highlighterPromise = import('shiki/bundle/web').then(({ bundledLanguages, createHighlighter }) =>
      createHighlighter({
        themes: ['github-light-default', ghosttyDarkShikiTheme],
        // The web bundle lacks some of these (rust, go, swift, ruby, diff,
        // toml, dockerfile), and one unknown language makes createHighlighter
        // reject, which disables highlighting for every language. Load only
        // the ones the bundle has; the rest render as plain code.
        langs: [
          'javascript', 'typescript', 'tsx', 'jsx', 'html', 'css', 'json',
          'python', 'bash', 'shell', 'markdown', 'yaml', 'sql', 'rust',
          'go', 'java', 'c', 'cpp', 'swift', 'ruby', 'php', 'diff',
          'toml', 'xml', 'graphql', 'dockerfile',
        ].filter((lang) => lang in bundledLanguages),
      }),
    );
  }
  return highlighterPromise;
}

function isDarkMode(): boolean {
  if (typeof document === 'undefined') return false;
  const theme = document.documentElement.getAttribute('data-theme');
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export async function highlightCode(code: string, lang: string): Promise<string> {
  const dark = isDarkMode();
  const cacheKey = `${dark ? 'd' : 'l'}:${lang}:${code}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const highlighter = await getHighlighter();
  const loadedLangs = highlighter.getLoadedLanguages();
  if (!loadedLangs.includes(lang as any)) {
    return '';
  }

  const html = highlighter.codeToHtml(code, {
    lang,
    theme: dark ? GHOSTTY_DARK_SHIKI_THEME_NAME : 'github-light-default',
  });

  if (cache.size >= CACHE_MAX) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(cacheKey, html);
  return html;
}
