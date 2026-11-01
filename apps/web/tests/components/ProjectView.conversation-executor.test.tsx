// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationExecutor, WorkspaceCollabContext } from '@open-design/contracts';

import { ProjectView } from '../../src/components/ProjectView';
import type { ProjectWorkspaceScopeState } from '../../src/collab/useProjectWorkspaceScope';
import type {
  AgentInfo,
  AppConfig,
  ChatMessage,
  Conversation,
  Project,
} from '../../src/types';

const listConversations = vi.fn();
const listMessages = vi.fn();
const patchConversation = vi.fn();
const createConversation = vi.fn();
const streamViaDaemon = vi.fn();
const avatarMenuProps = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }));
const collab = vi.hoisted(() => ({ viewerOnly: false }));

const workspaceScope = vi.hoisted(() => {
  const context = {
    workspaceId: 'workspace-personal',
    workspaceMemberId: 'member-personal',
    workspaceType: 'personal',
    role: 'owner',
    memberStatus: 'active',
    lifecycleState: 'active',
    billingState: 'active',
    planId: null,
    providerMode: 'platform_credits',
    seatSummary: { seatLimit: 1, usedSeats: 1, availableSeats: 0, isSeatFull: true },
    permissions: {
      canManageMembers: true,
      canManageBilling: true,
      canInviteMembers: true,
      canManageAutoRecharge: true,
      canShareProjects: true,
      canWriteSyncedFiles: true,
      canViewWorkspaceSettings: true,
      canManageSharedResources: true,
    },
  };
  return {
    state: {
      loading: false,
      scope: {
        kind: 'personal',
        projectId: 'project-1',
        workspaceId: 'workspace-personal',
        visibility: 'personal',
        context,
      },
    },
  };
});

vi.mock('../../src/analytics/provider', () => ({
  useAnalytics: () => ({ track: vi.fn() }),
}));
vi.mock('../../src/i18n', () => ({
  useI18n: () => ({ locale: 'en', setLocale: () => undefined, t: (key: string) => key }),
  useT: () => (key: string) => key,
}));
vi.mock('../../src/providers/anthropic', () => ({ streamMessage: vi.fn() }));
vi.mock('../../src/collab/useWorkspaceContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/collab/useWorkspaceContext')>()),
  useWorkspaceContext: () => ({ context: null as WorkspaceCollabContext | null, loading: false }),
  lastResolvedTeamProjects: () => [],
  lastResolvedWorkspaceContext: () => null,
  useWorkspaceBilling: () => null,
}));
vi.mock('../../src/collab/useProjectWorkspaceScope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/collab/useProjectWorkspaceScope')>()),
  useProjectWorkspaceScope: () => workspaceScope.state as unknown as ProjectWorkspaceScopeState,
}));
vi.mock('../../src/collab/useProjectCollab', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/collab/useProjectCollab')>()),
  useProjectCollab: () => ({
    enabled: false,
    member: null,
    present: [],
    publishedVersion: null,
    syncState: 'local_only',
    viewerOnly: collab.viewerOnly,
    isOwner: false,
    writerAuthority: 'allowed',
    downloadPending: false,
    reportChange: vi.fn(),
    requestPublish: vi.fn(),
    refreshPresence: vi.fn(),
    checkStatusNow: vi.fn(),
    applyContentTransferState: vi.fn(),
  }),
}));
vi.mock('../../src/providers/daemon', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/providers/daemon')>()),
  fetchChatRunStatus: vi.fn(async () => null),
  fetchVelaLoginStatus: vi.fn(async () => ({ loggedIn: false })),
  listActiveChatRuns: vi.fn(async () => []),
  listProjectRuns: vi.fn(async () => []),
  reattachDaemonRun: vi.fn(async () => new Promise<void>(() => {})),
  streamViaDaemon: (...args: unknown[]) => streamViaDaemon(...args),
}));
vi.mock('../../src/providers/project-events', () => ({ useProjectFileEvents: vi.fn() }));
vi.mock('../../src/providers/registry', () => ({
  deletePreviewComment: vi.fn(),
  fetchPreviewComments: vi.fn(async () => []),
  fetchDesignSystem: vi.fn(async () => null),
  fetchLiveArtifacts: vi.fn(async () => []),
  fetchProjectFiles: vi.fn(async () => []),
  fetchSkill: vi.fn(async () => null),
  patchPreviewCommentStatus: vi.fn(),
  upsertPreviewComment: vi.fn(),
  writeProjectTextFile: vi.fn(),
}));
vi.mock('../../src/router', () => ({ navigate: vi.fn() }));
vi.mock('../../src/state/projects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/state/projects')>()),
  registerQueuedSubmission: vi.fn(async (projectId, submission) => ({
    id: submission.id,
    projectId,
    conversationId: submission.conversationId,
    acceptedAt: submission.submittedAt,
  })),
  createConversation: (...args: unknown[]) => createConversation(...args),
  deleteConversation: vi.fn(),
  getTemplate: vi.fn(async () => null),
  listConversations: (...args: unknown[]) => listConversations(...args),
  listMessages: (...args: unknown[]) => listMessages(...args),
  loadTabs: vi.fn(async () => ({ tabs: [], active: null })),
  patchConversation: (...args: unknown[]) => patchConversation(...args),
  patchProject: vi.fn(),
  saveMessage: vi.fn(),
  saveTabs: vi.fn(),
  cacheTabsLocally: (_projectId: string, state: unknown) => state,
  persistTabsToDaemonNow: vi.fn(),
}));
vi.mock('../../src/components/AppChromeHeader', () => ({
  AppChromeHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
}));
vi.mock('../../src/components/AvatarMenu', () => ({
  AvatarMenu: (props: Record<string, unknown>) => {
    avatarMenuProps.current = props;
    const config = props.config as AppConfig;
    return (
      <output data-testid="composer-executor">
        {config.mode === 'api' ? `api:${config.apiProtocol}` : `daemon:${config.agentId}`}
      </output>
    );
  },
}));
vi.mock('../../src/components/FileWorkspace', () => ({
  DESIGN_SYSTEM_TAB: '__design_system__',
  FileWorkspace: () => null,
}));
vi.mock('../../src/components/Loading', () => ({ CenteredLoader: () => null }));
vi.mock('../../src/components/ChatPane', () => ({
  ChatPane: ({
    activeConversationId,
    conversations,
    sendDisabled,
    composerFooterAccessory,
    onSelectConversation,
    onSend,
  }: {
    activeConversationId: string | null;
    conversations: Conversation[];
    sendDisabled?: boolean;
    composerFooterAccessory?: ReactNode;
    onSelectConversation: (id: string) => void;
    onSend: (prompt: string, attachments: unknown[], commentAttachments: unknown[]) => void;
  }) => (
    <section>
      <output data-testid="active-conversation">{activeConversationId}</output>
      {composerFooterAccessory}
      {conversations.map((conversation) => (
        <button
          key={conversation.id}
          type="button"
          data-testid={`conversation-select-${conversation.id}`}
          onClick={() => onSelectConversation(conversation.id)}
        >
          {conversation.id}
        </button>
      ))}
      <button
        type="button"
        data-testid="send-message"
        disabled={sendDisabled}
        onClick={() => onSend('hello', [], [])}
      >
        send
      </button>
    </section>
  ),
}));

const project: Project = {
  id: 'project-1',
  name: 'Project',
  skillId: null,
  designSystemId: null,
  createdAt: 1,
  updatedAt: 1,
};

const agents: AgentInfo[] = [
  {
    id: 'claude',
    name: 'Claude',
    bin: 'claude',
    available: true,
    models: [{ id: 'claude-sonnet-4', label: 'Claude Sonnet 4' }],
  },
  {
    id: 'codex',
    name: 'Codex',
    bin: 'codex',
    available: true,
    models: [
      { id: 'gpt-5.5', label: 'GPT-5.5' },
      { id: 'gpt-5.4', label: 'GPT-5.4' },
    ],
  },
  { id: 'byok-opencode', name: 'BYOK OpenCode', bin: 'opencode', available: true, models: [] },
];

/** The app-wide default: Claude. Every test pins or derives something else. */
const globalConfig: AppConfig = {
  mode: 'daemon',
  apiKey: '',
  baseUrl: '',
  model: '',
  agentId: 'claude',
  agentModels: { claude: { model: 'claude-sonnet-4' } },
  skillId: null,
  designSystemId: null,
  // A BYOK key is saved for OpenAI, so a conversation can be pointed at it.
  apiProtocolConfigs: {
    openai: {
      apiKey: 'sk-openai-test',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.4',
      apiVersion: '',
      apiProviderBaseUrl: 'https://api.openai.com/v1',
    },
  },
};

const codexExecutor: ConversationExecutor = {
  mode: 'daemon',
  agentId: 'codex',
  agentModel: { model: 'gpt-5.5' },
};

function conversation(id: string, executor?: ConversationExecutor): Conversation {
  return {
    id,
    projectId: project.id,
    title: id,
    createdAt: 1,
    updatedAt: 1,
    ...(executor ? { executor } : {}),
  };
}

const codexTurn: ChatMessage = {
  id: 'assistant-codex',
  role: 'assistant',
  content: 'done',
  createdAt: 1,
  agentId: 'codex',
  agentName: 'Codex · gpt-5.5',
  runStatus: 'succeeded',
  endedAt: 2,
};

let messagesByConversation: Record<string, ChatMessage[]> = {};
const onAgentChange = vi.fn();
const onModeChange = vi.fn();
const onAgentModelChange = vi.fn();
const onApiModelChange = vi.fn();

function renderProjectView(routeConversationId: string) {
  return render(
    <ProjectView
      project={project}
      routeFileName={null}
      routeConversationId={routeConversationId}
      config={globalConfig}
      agents={agents}
      skills={[]}
      designTemplates={[]}
      designSystems={[]}
      daemonLive
      onModeChange={onModeChange}
      onAgentChange={onAgentChange}
      onAgentModelChange={onAgentModelChange}
      onApiModelChange={onApiModelChange}
      onRefreshAgents={() => {}}
      onOpenSettings={() => {}}
      onBack={() => {}}
      onClearPendingPrompt={() => {}}
      onTouchProject={() => {}}
      onProjectChange={() => {}}
      onProjectsRefresh={() => {}}
    />,
  );
}

async function sendAndReadRun(): Promise<Record<string, unknown>> {
  await waitFor(() => expect(screen.getByTestId('send-message')).toHaveProperty('disabled', false));
  fireEvent.click(screen.getByTestId('send-message'));
  await waitFor(() => expect(streamViaDaemon).toHaveBeenCalledTimes(1));
  return streamViaDaemon.mock.calls[0]?.[0] as Record<string, unknown>;
}

function composer() {
  const props = avatarMenuProps.current;
  if (!props) throw new Error('composer execution menu was not rendered');
  return props as {
    config: AppConfig;
    controlsDisabled?: boolean;
    onAgentChange: (agentId: string) => void;
    onAgentModelChange: (agentId: string, choice: { model?: string }) => void;
    onApiProtocolChange: (protocol: 'openai') => void;
  };
}

describe('ProjectView conversation executor', () => {
  beforeEach(() => {
    avatarMenuProps.current = null;
    collab.viewerOnly = false;
    messagesByConversation = {};
    listMessages.mockImplementation(async (_projectId: string, conversationId: string) =>
      messagesByConversation[conversationId] ?? []);
    patchConversation.mockImplementation(
      async (_projectId: string, conversationId: string, patch: Partial<Conversation>) => ({
        ...conversation(conversationId),
        ...patch,
      }),
    );
    streamViaDaemon.mockImplementation(async () => {});
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({})));
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('sends with the executor stored on the conversation, not the app-wide default', async () => {
    listConversations.mockResolvedValue([conversation('conv-a', codexExecutor)]);
    renderProjectView('conv-a');

    await waitFor(() => expect(screen.getByTestId('composer-executor').textContent).toBe('daemon:codex'));
    expect(await sendAndReadRun()).toMatchObject({ agentId: 'codex', model: 'gpt-5.5' });
    expect(patchConversation.mock.calls.filter(([, , patch]) => 'executor' in (patch as object)))
      .toEqual([]);
  });

  it('keeps an older conversation on the agent its history shows, and stores it', async () => {
    listConversations.mockResolvedValue([conversation('conv-a')]);
    messagesByConversation['conv-a'] = [codexTurn];
    renderProjectView('conv-a');

    await waitFor(() => expect(screen.getByTestId('composer-executor').textContent).toBe('daemon:codex'));
    expect(await sendAndReadRun()).toMatchObject({ agentId: 'codex' });
    await waitFor(() => expect(patchConversation).toHaveBeenCalledWith(
      project.id,
      'conv-a',
      { executor: { mode: 'daemon', agentId: 'codex' } },
      expect.anything(),
    ));
  });

  it('starts an empty conversation on the app-wide default and stores it at the first send', async () => {
    listConversations.mockResolvedValue([conversation('conv-new')]);
    renderProjectView('conv-new');

    await waitFor(() => expect(screen.getByTestId('composer-executor').textContent).toBe('daemon:claude'));
    expect(await sendAndReadRun()).toMatchObject({ agentId: 'claude', model: 'claude-sonnet-4' });
    await waitFor(() => expect(patchConversation).toHaveBeenCalledWith(
      project.id,
      'conv-new',
      { executor: { mode: 'daemon', agentId: 'claude', agentModel: { model: 'claude-sonnet-4' } } },
      expect.anything(),
    ));
  });

  it('applies a composer change to the open conversation only', async () => {
    listConversations.mockResolvedValue([conversation('conv-a'), conversation('conv-b')]);
    renderProjectView('conv-a');
    await waitFor(() => expect(screen.getByTestId('composer-executor').textContent).toBe('daemon:claude'));

    act(() => composer().onAgentChange('codex'));
    await waitFor(() => expect(screen.getByTestId('composer-executor').textContent).toBe('daemon:codex'));
    act(() => composer().onAgentModelChange('codex', { model: 'gpt-5.4' }));

    await waitFor(() => expect(patchConversation).toHaveBeenLastCalledWith(
      project.id,
      'conv-a',
      { executor: { mode: 'daemon', agentId: 'codex', agentModel: { model: 'gpt-5.4' } } },
      expect.anything(),
    ));
    expect(onAgentChange).not.toHaveBeenCalled();
    expect(onAgentModelChange).not.toHaveBeenCalled();
    expect(onModeChange).not.toHaveBeenCalled();
    expect(await sendAndReadRun()).toMatchObject({ agentId: 'codex', model: 'gpt-5.4' });

    fireEvent.click(screen.getByTestId('conversation-select-conv-b'));
    await waitFor(() => expect(screen.getByTestId('active-conversation').textContent).toBe('conv-b'));
    await waitFor(() => expect(screen.getByTestId('composer-executor').textContent).toBe('daemon:claude'));
  });

  it('puts the previous executor back when saving a composer change fails', async () => {
    listConversations.mockResolvedValue([conversation('conv-a', codexExecutor)]);
    patchConversation.mockResolvedValue(null);
    renderProjectView('conv-a');
    await waitFor(() => expect(screen.getByTestId('composer-executor').textContent).toBe('daemon:codex'));

    act(() => composer().onAgentChange('claude'));

    await waitFor(() => expect(patchConversation).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('composer-executor').textContent).toBe('daemon:codex'));
    expect(onAgentChange).not.toHaveBeenCalled();
  });
  it('points the open conversation at a BYOK provider without changing the app-wide default', async () => {
    listConversations.mockResolvedValue([conversation('conv-a')]);
    renderProjectView('conv-a');
    await waitFor(() => expect(screen.getByTestId('composer-executor').textContent).toBe('daemon:claude'));

    act(() => composer().onApiProtocolChange('openai'));

    await waitFor(() => expect(screen.getByTestId('composer-executor').textContent).toBe('api:openai'));
    expect(patchConversation).toHaveBeenLastCalledWith(
      project.id,
      'conv-a',
      { executor: { mode: 'api', apiProtocol: 'openai', model: 'gpt-5.4' } },
      expect.anything(),
    );
    expect(onModeChange).not.toHaveBeenCalled();
    const run = await sendAndReadRun();
    expect(run).toMatchObject({ agentId: 'byok-opencode', model: 'gpt-5.4' });
    expect(run.byokProvider).toMatchObject({ protocol: 'openai' });
  });

  it('does not change a read-only conversation\'s executor', async () => {
    collab.viewerOnly = true;
    listConversations.mockResolvedValue([conversation('conv-a', codexExecutor)]);
    renderProjectView('conv-a');
    await waitFor(() => expect(screen.getByTestId('composer-executor').textContent).toBe('daemon:codex'));
    expect(composer().controlsDisabled).toBe(true);

    act(() => composer().onAgentChange('claude'));

    expect(screen.getByTestId('composer-executor').textContent).toBe('daemon:codex');
    expect(patchConversation.mock.calls.filter(([, , patch]) => 'executor' in (patch as object)))
      .toEqual([]);
  });
  it('lands quick composer changes in order and falls back to the last saved one', async () => {
    listConversations.mockResolvedValue([conversation('conv-a', codexExecutor)]);
    const settles: Array<(value: Conversation | null) => void> = [];
    patchConversation.mockImplementation(() => new Promise((resolve) => { settles.push(resolve); }));
    renderProjectView('conv-a');
    await waitFor(() => expect(screen.getByTestId('composer-executor').textContent).toBe('daemon:codex'));

    act(() => composer().onAgentChange('claude'));
    await waitFor(() => expect(screen.getByTestId('composer-executor').textContent).toBe('daemon:claude'));
    act(() => composer().onAgentChange('codex'));

    // The second change waits for the first to land before it is sent.
    await waitFor(() => expect(settles).toHaveLength(1));
    const claudeSaved = { mode: 'daemon' as const, agentId: 'claude', agentModel: { model: 'claude-sonnet-4' } };
    await act(async () => { settles[0]!({ ...conversation('conv-a'), executor: claudeSaved }); });
    await waitFor(() => expect(settles).toHaveLength(2));
    await act(async () => { settles[1]!(null); });

    await waitFor(() => expect(screen.getByTestId('composer-executor').textContent).toBe('daemon:claude'));
  });
});
