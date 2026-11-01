// @vitest-environment jsdom
import { pickHomeTemplate } from '../helpers/home-template-picker';

import { StrictMode, type ComponentProps } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServerConfig, SkillSummary } from '@open-design/contracts';

vi.mock('../../src/components/home-hero/PlaceholderCarousel', () => ({
  PlaceholderCarousel: () => null,
}));

vi.mock('../../src/collab/useWorkspaceContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/collab/useWorkspaceContext')>();
  return {
    ...actual,
    useWorkspaceContext: () => ({
      context: null,
      loading: false,
      failure: 'unsupported' as const,
    }),
  };
});

vi.mock('@open-design/host', async () => {
  const actual = await vi.importActual<typeof import('@open-design/host')>('@open-design/host');
  return {
    ...actual,
    isOpenDesignHostAvailable: vi.fn(() => false),
    pickHostWorkingDir: vi.fn(),
  };
});

vi.mock('../../src/providers/registry', async () => {
  const actual = await vi.importActual<typeof import('../../src/providers/registry')>(
    '../../src/providers/registry',
  );
  return {
    ...actual,
    openFolderDialog: vi.fn(),
    fetchProjectFiles: vi.fn().mockResolvedValue([]),
    fetchRecentLinkedDirs: vi.fn().mockResolvedValue([]),
    pushRecentLinkedDir: vi.fn().mockResolvedValue([]),
    dirExists: vi.fn().mockResolvedValue(true),
  };
});

import { HomeView } from '../../src/components/HomeView';
import { isOpenDesignHostAvailable, pickHostWorkingDir } from '@open-design/host';
import { openFolderDialog } from '../../src/providers/registry';
import { resetPluginsCache } from '../../src/state/projects';
import { stashHomeComposerAttachments } from '../../src/state/home-composer-stash';
import { homeHeroPromptText, setHomeHeroPrompt } from '../helpers/home-hero-lexical';

const mockedIsHostAvailable = vi.mocked(isOpenDesignHostAvailable);
const mockedPickHostWorkingDir = vi.mocked(pickHostWorkingDir);
const mockedOpenFolderDialog = vi.mocked(openFolderDialog);

// Opening Settings (or a project) swaps App's `appMain` slot, so HomeView
// really unmounts and mounts again. Every case below drives that real
// teardown, wrapped in StrictMode like the app, and checks that what the
// user set up in the composer is still there when they come back.

const WEB_PROTOTYPE_PLUGIN = {
  id: 'example-web-prototype',
  title: 'Web Prototype',
  version: '0.1.0',
  trust: 'bundled' as const,
  sourceKind: 'bundled' as const,
  source: '/tmp/web-prototype',
  capabilitiesGranted: ['prompt:inject'],
  fsPath: '/tmp/web-prototype',
  installedAt: 0,
  updatedAt: 0,
  manifest: {
    name: 'example-web-prototype',
    title: 'Web Prototype',
    version: '0.1.0',
    description: 'General-purpose desktop web prototype.',
    od: {
      kind: 'scenario',
      taskKind: 'new-generation',
      useCase: { query: 'Build a web prototype.' },
    },
  },
};

const MCP_SERVER: McpServerConfig = {
  id: 'linear',
  label: 'Linear',
  transport: 'stdio',
  enabled: true,
  command: 'npx',
};

const SKILL: SkillSummary = {
  id: 'prototype-lab',
  name: 'Prototype Lab',
  description: 'Create a focused prototype.',
  triggers: ['prototype', 'flow'],
  mode: 'prototype',
  previewType: 'html',
  designSystemRequired: false,
  defaultFor: [],
  upstream: null,
  hasBody: true,
  examplePrompt: 'Design a focused onboarding prototype.',
  aggregatesExamples: false,
};

interface FetchState {
  pluginsResponse: 'ok' | 'fail' | 'hang';
  mcpServers: McpServerConfig[];
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function stubFetch(state: FetchState) {
  const fetchMock = vi.fn<typeof fetch>(async (url) => {
    if (url === '/api/plugins') {
      if (state.pluginsResponse === 'hang') return new Promise<Response>(() => undefined);
      if (state.pluginsResponse === 'fail') return json({ error: 'unavailable' }, 503);
      return json({ plugins: [WEB_PROTOTYPE_PLUGIN] });
    }
    if (url === '/api/mcp/servers') {
      return json({ servers: state.mcpServers, templates: [] });
    }
    throw new Error(`unexpected fetch ${String(url)}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function pluginReads(fetchMock: ReturnType<typeof stubFetch>): number {
  return fetchMock.mock.calls.filter(([url]) => url === '/api/plugins').length;
}

function renderHome(props: Partial<ComponentProps<typeof HomeView>> = {}) {
  return render(
    <StrictMode>
      <HomeView
        projects={[]}
        onSubmit={() => undefined}
        onOpenProject={() => undefined}
        {...props}
      />
    </StrictMode>,
  );
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function submit() {
  await waitFor(() => expect((screen.getByTestId('home-hero-submit') as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByTestId('home-hero-submit'));
}

function pasteFile(file: File) {
  fireEvent.paste(screen.getByTestId('home-hero-input'), {
    clipboardData: {
      files: [file],
      items: [{ kind: 'file', getAsFile: () => file }],
    },
  });
}

function templateTriggerText(): string {
  return screen.queryByTestId('home-hero-template-trigger')?.textContent ?? '';
}

describe('HomeView keeps the composer across a real unmount and remount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedIsHostAvailable.mockReturnValue(false);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      const id = window.setTimeout(() => cb(window.performance.now()), 0);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    cleanup();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('keeps the picked type when the plugin catalog cannot be read on return', async () => {
    const state: FetchState = { pluginsResponse: 'ok', mcpServers: [] };
    const fetchMock = stubFetch(state);
    const first = renderHome();
    await screen.findByTestId('home-hero-input');
    await pickHomeTemplate('prototype');
    await waitFor(() => expect(templateTriggerText()).toContain('Prototype'));
    first.unmount();

    // A Settings visit longer than the catalog cache's lifetime refetches the
    // catalog on return, and here that read fails.
    const realNow = Date.now.bind(Date);
    vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 60_000);
    state.pluginsResponse = 'fail';
    const readsBefore = pluginReads(fetchMock);
    renderHome();
    await screen.findByTestId('home-hero-input');
    await waitFor(() => expect(pluginReads(fetchMock)).toBeGreaterThan(readsBefore));
    await settle();

    expect(templateTriggerText()).toContain('Prototype');
  });

  it('keeps the picked type when Home is left again before the catalog loaded', async () => {
    const state: FetchState = { pluginsResponse: 'ok', mcpServers: [] };
    stubFetch(state);
    const first = renderHome();
    await screen.findByTestId('home-hero-input');
    await pickHomeTemplate('prototype');
    await waitFor(() => expect(templateTriggerText()).toContain('Prototype'));
    first.unmount();

    // Second visit: the catalog read never answers before the user leaves.
    resetPluginsCache();
    state.pluginsResponse = 'hang';
    const second = renderHome();
    await screen.findByTestId('home-hero-input');
    await settle();
    second.unmount();

    state.pluginsResponse = 'ok';
    renderHome();
    await screen.findByTestId('home-hero-input');
    await waitFor(() => expect(templateTriggerText()).toContain('Prototype'));
  });

  it('keeps linked local code', async () => {
    stubFetch({ pluginsResponse: 'ok', mcpServers: [] });
    mockedOpenFolderDialog.mockResolvedValue('/Users/me/code/storefront');
    const first = renderHome();
    await screen.findByTestId('home-hero-input');

    fireEvent.click(screen.getByTestId('home-hero-plus-trigger'));
    fireEvent.click(await screen.findByTestId('composer-plus-local-code'));
    await waitFor(() => expect(screen.getByTestId('working-dir-trigger').textContent).toContain('storefront'));
    first.unmount();

    const onSubmit = vi.fn();
    renderHome({ onSubmit });
    await screen.findByTestId('home-hero-input');
    expect(screen.getByTestId('working-dir-trigger').textContent).toContain('storefront');

    setHomeHeroPrompt('Refresh the checkout page.');
    await settle();
    await submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      linkedDirs: ['/Users/me/code/storefront'],
      initialRunContext: {
        workspaceItems: [expect.objectContaining({ kind: 'local-code', absolutePath: '/Users/me/code/storefront' })],
      },
    });
  });

  it('keeps the working folder and its desktop token', async () => {
    stubFetch({ pluginsResponse: 'ok', mcpServers: [] });
    mockedIsHostAvailable.mockReturnValue(true);
    mockedPickHostWorkingDir.mockResolvedValue({ ok: true, baseDir: '/Users/me/site', token: 'host-token-1' });
    const first = renderHome();
    await screen.findByTestId('home-hero-input');

    fireEvent.click(screen.getByTestId('working-dir-trigger'));
    fireEvent.click(screen.getByTestId('working-dir-pick'));
    await waitFor(() => expect(screen.getByTestId('working-dir-trigger').textContent).toContain('site'));
    first.unmount();

    const onSubmit = vi.fn();
    renderHome({ onSubmit });
    await screen.findByTestId('home-hero-input');
    expect(screen.getByTestId('working-dir-trigger').textContent).toContain('site');

    setHomeHeroPrompt('Add a pricing page.');
    await settle();
    await submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      workingDir: '/Users/me/site',
      workingDirToken: 'host-token-1',
    });
  });

  it('keeps pasted attachments', async () => {
    stubFetch({ pluginsResponse: 'ok', mcpServers: [] });
    const file = new File(['brief'], 'brief.pdf', { type: 'application/pdf' });
    const first = renderHome();
    await screen.findByTestId('home-hero-input');
    pasteFile(file);
    await waitFor(() => expect(screen.getByText('brief.pdf')).toBeTruthy());
    first.unmount();

    const onSubmit = vi.fn();
    renderHome({ onSubmit });
    await screen.findByTestId('home-hero-input');
    expect(screen.getByText('brief.pdf')).toBeTruthy();

    await submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ attachments: [file] });
  });

  it('keeps the picked skill and @-mentioned MCP server', async () => {
    stubFetch({ pluginsResponse: 'ok', mcpServers: [MCP_SERVER] });
    const first = renderHome({ skills: [SKILL] });
    await screen.findByTestId('home-hero-input');

    setHomeHeroPrompt('@proto');
    await settle();
    fireEvent.mouseDown(await screen.findByRole('option', { name: /prototype lab/i }));
    await waitFor(() => expect(screen.getByTestId('home-hero-active-skill')).toBeTruthy());
    setHomeHeroPrompt('@Prototype Lab @lin');
    await settle();
    fireEvent.mouseDown(await screen.findByRole('option', { name: /linear/i }));
    await waitFor(() => expect(homeHeroPromptText().trim()).toBe('@Prototype Lab @Linear'));
    first.unmount();

    const onSubmit = vi.fn();
    renderHome({ skills: [SKILL], onSubmit });
    await screen.findByTestId('home-hero-input');
    await waitFor(() => expect(screen.getByTestId('home-hero-active-skill')).toBeTruthy());

    await submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      skillId: SKILL.id,
      contextMcpServers: [expect.objectContaining({ id: 'linear' })],
    });
  });

  it('drops an @-mentioned MCP server that was removed while away', async () => {
    const state: FetchState = { pluginsResponse: 'ok', mcpServers: [MCP_SERVER] };
    stubFetch(state);
    const first = renderHome();
    await screen.findByTestId('home-hero-input');
    setHomeHeroPrompt('@lin');
    await settle();
    fireEvent.mouseDown(await screen.findByRole('option', { name: /linear/i }));
    await waitFor(() => expect(homeHeroPromptText().trim()).toBe('@Linear'));
    first.unmount();

    state.mcpServers = [];
    const onSubmit = vi.fn();
    renderHome({ onSubmit });
    await screen.findByTestId('home-hero-input');
    await settle();

    await submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ contextMcpServers: [] });
  });

  it('keeps an @-mentioned MCP server that was renamed while away', async () => {
    const state: FetchState = { pluginsResponse: 'ok', mcpServers: [MCP_SERVER] };
    stubFetch(state);
    const first = renderHome();
    await screen.findByTestId('home-hero-input');
    setHomeHeroPrompt('@lin');
    await settle();
    fireEvent.mouseDown(await screen.findByRole('option', { name: /linear/i }));
    await waitFor(() => expect(homeHeroPromptText().trim()).toBe('@Linear'));
    first.unmount();

    state.mcpServers = [{ ...MCP_SERVER, label: 'Linear Issues', command: 'npx-next' }];
    const onSubmit = vi.fn();
    renderHome({ onSubmit });
    await screen.findByTestId('home-hero-input');
    await settle();

    await submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      contextMcpServers: [expect.objectContaining({ id: 'linear', command: 'npx-next' })],
    });
  });

  it('hands the attachments of a failed send back once', async () => {
    stubFetch({ pluginsResponse: 'ok', mcpServers: [] });
    const file = new File(['brief'], 'brief.pdf', { type: 'application/pdf' });
    let finishSend: (accepted: boolean) => void = () => undefined;
    const onSubmit = vi.fn(() => new Promise<boolean>((resolve) => { finishSend = resolve; }));
    const first = renderHome({ onSubmit });
    await screen.findByTestId('home-hero-input');
    pasteFile(file);
    await waitFor(() => expect(screen.getByText('brief.pdf')).toBeTruthy());
    await submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    // The send opens the new project; its create then fails, so App rolls
    // back to Home and hands the staged files back.
    first.unmount();
    stashHomeComposerAttachments([file]);
    await act(async () => finishSend(false));

    renderHome();
    await screen.findByTestId('home-hero-input');
    expect(screen.getAllByText('brief.pdf')).toHaveLength(1);
  });

  it('keeps a composer changed on Home while its earlier send was still creating', async () => {
    stubFetch({ pluginsResponse: 'ok', mcpServers: [] });
    let finishSend: (accepted: boolean) => void = () => undefined;
    const onSubmit = vi.fn(() => new Promise<boolean>((resolve) => { finishSend = resolve; }));
    const first = renderHome({ onSubmit });
    await screen.findByTestId('home-hero-input');
    pasteFile(new File(['sent'], 'sent.pdf', { type: 'application/pdf' }));
    await waitFor(() => expect(screen.getByText('sent.pdf')).toBeTruthy());
    await submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    first.unmount();

    // Back on Home while the project is still being created.
    const second = renderHome();
    await screen.findByTestId('home-hero-input');
    pasteFile(new File(['next'], 'next.pdf', { type: 'application/pdf' }));
    await waitFor(() => expect(screen.getByText('next.pdf')).toBeTruthy());
    second.unmount();

    await act(async () => finishSend(true));
    renderHome();
    await screen.findByTestId('home-hero-input');
    expect(screen.getByText('next.pdf')).toBeTruthy();
  });

  it('clears a composer only revisited while its send was creating', async () => {
    stubFetch({ pluginsResponse: 'ok', mcpServers: [] });
    let finishSend: (accepted: boolean) => void = () => undefined;
    const onSubmit = vi.fn(() => new Promise<boolean>((resolve) => { finishSend = resolve; }));
    const first = renderHome({ onSubmit });
    await screen.findByTestId('home-hero-input');
    pasteFile(new File(['sent'], 'sent.pdf', { type: 'application/pdf' }));
    await waitFor(() => expect(screen.getByText('sent.pdf')).toBeTruthy());
    await submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    first.unmount();

    const second = renderHome();
    await screen.findByTestId('home-hero-input');
    await settle();
    second.unmount();

    await act(async () => finishSend(true));
    renderHome();
    await screen.findByTestId('home-hero-input');
    await settle();
    expect(screen.queryByText('sent.pdf')).toBeNull();
  });

  it('starts empty after the composer was sent', async () => {
    stubFetch({ pluginsResponse: 'ok', mcpServers: [] });
    mockedOpenFolderDialog.mockResolvedValue('/Users/me/code/storefront');
    const file = new File(['brief'], 'brief.pdf', { type: 'application/pdf' });
    const onSubmit = vi.fn(async () => true);
    const first = renderHome({ onSubmit });
    await screen.findByTestId('home-hero-input');
    await pickHomeTemplate('prototype');
    await waitFor(() => expect(templateTriggerText()).toContain('Prototype'));
    pasteFile(file);
    await waitFor(() => expect(screen.getByText('brief.pdf')).toBeTruthy());
    fireEvent.click(screen.getByTestId('home-hero-plus-trigger'));
    fireEvent.click(await screen.findByTestId('composer-plus-local-code'));
    await waitFor(() => expect(screen.getByTestId('working-dir-trigger').textContent).toContain('storefront'));

    await submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    await settle();
    first.unmount();

    renderHome();
    await screen.findByTestId('home-hero-input');
    await settle();
    expect(screen.queryByText('brief.pdf')).toBeNull();
    expect(screen.getByTestId('working-dir-trigger').textContent).not.toContain('storefront');
    expect(templateTriggerText()).not.toContain('Prototype');
  });

  it('never shares the page composer with a docked one', async () => {
    stubFetch({ pluginsResponse: 'ok', mcpServers: [] });
    const pageFile = new File(['page'], 'page.pdf', { type: 'application/pdf' });
    const page = renderHome();
    await screen.findByTestId('home-hero-input');
    pasteFile(pageFile);
    await waitFor(() => expect(screen.getByText('page.pdf')).toBeTruthy());
    page.unmount();

    const dock = renderHome({ variant: 'dock' });
    await screen.findByTestId('home-hero-input');
    await settle();
    expect(screen.queryByText('page.pdf')).toBeNull();
    pasteFile(new File(['dock'], 'dock.pdf', { type: 'application/pdf' }));
    await waitFor(() => expect(screen.getByText('dock.pdf')).toBeTruthy());
    dock.unmount();

    renderHome();
    await screen.findByTestId('home-hero-input');
    expect(screen.getByText('page.pdf')).toBeTruthy();
    expect(screen.queryByText('dock.pdf')).toBeNull();
  });
});
