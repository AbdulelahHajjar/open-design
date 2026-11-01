import { describe, expect, it } from 'vitest';

import {
  applyExecutorToConfig,
  byokProtocolConfigured,
  executorAfterEdit,
  executorFromConfig,
  executorFromLegacyAgentId,
  lastAssistantAgentId,
  resolveConversationExecutor,
} from '../../../src/runtime/chat/conversation-executor';
import type { AppConfig, ChatMessage } from '../../../src/types';
import { API_PROTOCOL_AGENT_IDS } from '../../../src/utils/byokProvider';

const globalConfig: AppConfig = {
  mode: 'daemon',
  apiKey: 'sk-ant-global',
  apiProtocol: 'anthropic',
  apiVersion: '',
  baseUrl: 'https://api.anthropic.com',
  model: 'claude-sonnet-4-5',
  agentId: 'amr',
  skillId: null,
  designSystemId: null,
  onboardingCompleted: true,
  mediaProviders: {},
  agentModels: {
    amr: { model: 'glm-5' },
    codex: { model: 'gpt-5.5', reasoning: 'high' },
  },
  agentCliEnv: {},
  apiProtocolConfigs: {
    openai: {
      apiKey: 'sk-openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.4',
      apiVersion: '',
      apiProviderBaseUrl: 'https://api.openai.com/v1',
    },
  },
};

function message(partial: Partial<ChatMessage> & Pick<ChatMessage, 'role'>): ChatMessage {
  return { id: `m-${Math.random()}`, content: '', createdAt: 1, ...partial } as ChatMessage;
}

describe('executorFromConfig', () => {
  it('snapshots a Local CLI selection with its model choice', () => {
    expect(executorFromConfig({ ...globalConfig, agentId: 'codex' })).toEqual({
      mode: 'daemon',
      agentId: 'codex',
      agentModel: { model: 'gpt-5.5', reasoning: 'high' },
    });
  });

  it('snapshots a BYOK selection without its credentials', () => {
    expect(executorFromConfig({ ...globalConfig, mode: 'api' })).toEqual({
      mode: 'api',
      apiProtocol: 'anthropic',
      model: 'claude-sonnet-4-5',
    });
  });

  it('has nothing to snapshot before an agent is picked or for bedrock', () => {
    expect(executorFromConfig({ ...globalConfig, agentId: null })).toBeNull();
    expect(executorFromConfig({ ...globalConfig, mode: 'api', apiProtocol: 'bedrock' })).toBeNull();
  });
});

describe('executorFromLegacyAgentId', () => {
  it('reads a Local CLI agent id', () => {
    expect(executorFromLegacyAgentId('codex')).toEqual({ mode: 'daemon', agentId: 'codex' });
  });

  it('maps a recorded BYOK identity back to its protocol', () => {
    expect(executorFromLegacyAgentId('openai-api')).toEqual({ mode: 'api', apiProtocol: 'openai' });
  });

  it('reads every BYOK identity a turn records back to its provider', () => {
    for (const [protocol, agentId] of Object.entries(API_PROTOCOL_AGENT_IDS)) {
      if (protocol === 'bedrock') continue;
      expect(executorFromLegacyAgentId(agentId)).toEqual({ mode: 'api', apiProtocol: protocol });
    }
  });

  it.each([null, undefined, '', 'byok-opencode', 'bedrock-api'])(
    'does not read an executor from %p',
    (agentId) => {
      expect(executorFromLegacyAgentId(agentId)).toBeNull();
    },
  );
});

describe('lastAssistantAgentId', () => {
  it('reads the most recent assistant turn that recorded an agent', () => {
    expect(lastAssistantAgentId([
      message({ role: 'assistant', agentId: 'claude' }),
      message({ role: 'user' }),
      message({ role: 'assistant', agentId: 'codex' }),
      message({ role: 'user' }),
      message({ role: 'assistant' }),
    ])).toBe('codex');
    expect(lastAssistantAgentId([message({ role: 'user' })])).toBeNull();
  });
});

describe('resolveConversationExecutor', () => {
  const stored = { mode: 'daemon' as const, agentId: 'claude' };

  it('prefers the stored executor over history', () => {
    expect(resolveConversationExecutor({ stored, legacyAgentId: 'codex' }))
      .toEqual({ executor: stored, source: 'stored' });
  });

  it('falls back to the executor the history shows', () => {
    expect(resolveConversationExecutor({ stored: null, legacyAgentId: 'codex' }))
      .toEqual({ executor: { mode: 'daemon', agentId: 'codex' }, source: 'legacy' });
  });

  it('follows the app-wide default when neither is known', () => {
    expect(resolveConversationExecutor({ stored: undefined, legacyAgentId: 'byok-opencode' }))
      .toEqual({ executor: null, source: 'global' });
  });
});

describe('applyExecutorToConfig', () => {
  it('returns the app-wide config itself when there is no executor', () => {
    expect(applyExecutorToConfig(globalConfig, null)).toBe(globalConfig);
  });

  it('lays a Local CLI executor over the app-wide config without mutating it', () => {
    const before = structuredClone(globalConfig);
    const config = applyExecutorToConfig(globalConfig, {
      mode: 'daemon',
      agentId: 'codex',
      agentModel: { model: 'gpt-5.4' },
    });
    expect(config).toMatchObject({
      mode: 'daemon',
      agentId: 'codex',
      apiKey: 'sk-ant-global',
      agentModels: { amr: { model: 'glm-5' }, codex: { model: 'gpt-5.4' } },
    });
    expect(globalConfig).toEqual(before);
  });

  it('keeps the app-wide model choice for an executor that stored none', () => {
    const config = applyExecutorToConfig(globalConfig, { mode: 'daemon', agentId: 'codex' });
    expect(config.agentModels?.codex).toEqual({ model: 'gpt-5.5', reasoning: 'high' });
  });

  it('takes BYOK credentials from the protocol stored in the app-wide config', () => {
    const config = applyExecutorToConfig(globalConfig, {
      mode: 'api',
      apiProtocol: 'openai',
      model: 'gpt-5.5',
    });
    expect(config).toMatchObject({
      mode: 'api',
      apiProtocol: 'openai',
      apiKey: 'sk-openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.5',
      agentId: 'amr',
    });
  });
});

describe('executorAfterEdit', () => {
  const codexConfig = applyExecutorToConfig(globalConfig, {
    mode: 'daemon',
    agentId: 'codex',
    agentModel: { model: 'gpt-5.5', reasoning: 'high', serviceTier: 'priority' },
  });

  it('switches agent and starts from the app-wide choice for that agent', () => {
    expect(executorAfterEdit(codexConfig, { kind: 'agent', agentId: 'amr' }))
      .toEqual({ mode: 'daemon', agentId: 'amr', agentModel: { model: 'glm-5' } });
  });

  it('merges a model choice and drops a service tier set back to default', () => {
    expect(executorAfterEdit(codexConfig, {
      kind: 'agentModel',
      agentId: 'codex',
      choice: { model: 'gpt-5.4', serviceTier: undefined },
    })).toEqual({
      mode: 'daemon',
      agentId: 'codex',
      agentModel: { model: 'gpt-5.4', reasoning: 'high' },
    });
  });

  it('keeps a conversation on agent defaults when its last model choice is cleared', () => {
    const global = { ...globalConfig, agentModels: { codex: { serviceTier: 'priority' } } };
    const conversationConfig = applyExecutorToConfig(global, {
      mode: 'daemon',
      agentId: 'codex',
      agentModel: { serviceTier: 'priority' },
    });
    const cleared = executorAfterEdit(conversationConfig, {
      kind: 'agentModel',
      agentId: 'codex',
      choice: { serviceTier: undefined },
    });
    expect(cleared).toEqual({ mode: 'daemon', agentId: 'codex', agentModel: {} });
    expect(applyExecutorToConfig(global, cleared).agentModels?.codex).toEqual({});
  });

  it('switches to BYOK on the app-wide provider and back to the app-wide agent', () => {
    const byok = executorAfterEdit(codexConfig, { kind: 'mode', mode: 'api' });
    expect(byok).toEqual({ mode: 'api', apiProtocol: 'anthropic', model: 'claude-sonnet-4-5' });
    expect(executorAfterEdit(applyExecutorToConfig(globalConfig, byok), { kind: 'mode', mode: 'daemon' }))
      .toEqual({ mode: 'daemon', agentId: 'amr', agentModel: { model: 'glm-5' } });
  });

  it('switches BYOK provider and model', () => {
    const openai = executorAfterEdit(codexConfig, { kind: 'apiProtocol', protocol: 'openai' });
    expect(openai).toEqual({ mode: 'api', apiProtocol: 'openai', model: 'gpt-5.4' });
    expect(executorAfterEdit(applyExecutorToConfig(globalConfig, openai), {
      kind: 'apiModel',
      model: 'gpt-5.5',
    })).toEqual({ mode: 'api', apiProtocol: 'openai', model: 'gpt-5.5' });
  });

  it('leaves no executor when switching to Local CLI before any agent was picked', () => {
    expect(executorAfterEdit({ ...globalConfig, mode: 'api', agentId: null }, { kind: 'mode', mode: 'daemon' }))
      .toBeNull();
  });
});

describe('byokProtocolConfigured', () => {
  it('reports providers whose key is stored in the app-wide config', () => {
    expect(byokProtocolConfigured(globalConfig, 'anthropic')).toBe(true);
    expect(byokProtocolConfigured(globalConfig, 'openai')).toBe(true);
    expect(byokProtocolConfigured(globalConfig, 'google')).toBe(false);
  });
});
