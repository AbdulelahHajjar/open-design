// @vitest-environment jsdom
//
// Dark code blocks use the Ghostty palette theme; light keeps GitHub light.

import { afterEach, describe, expect, it } from 'vitest';

import { highlightCode } from '../../src/runtime/shiki';

afterEach(() => {
  document.documentElement.removeAttribute('data-theme');
});

describe('code highlighting theme', () => {
  it('paints dark code with the Ghostty palette', async () => {
    document.documentElement.setAttribute('data-theme', 'dark');

    const html = await highlightCode('const greeting = "hi"; // note', 'typescript');

    expect(html).toContain('#D483DC'); // keyword: bright magenta
    expect(html).toContain('#82E498'); // string: bright green
    expect(html).toContain('#7D838C'); // comment: faint text
  });

  it('keeps the GitHub light theme in light', async () => {
    document.documentElement.setAttribute('data-theme', 'light');

    const html = await highlightCode('const greeting = "hi";', 'typescript');

    expect(html).not.toContain('#D483DC');
    expect(html).toContain('github-light-default');
  });
});
