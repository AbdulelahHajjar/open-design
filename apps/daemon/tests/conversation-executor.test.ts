import type { ConversationExecutor } from '@open-design/contracts';
import { describe, expect, it } from 'vitest';

import {
  conversationExecutorForRun,
  conversationExecutorFromCliFlags,
  conversationExecutorLabel,
  conversationExecutorRunDefaults,
  resolveStoredOrRecordedExecutor,
} from '../src/conversation-executor.js';

const codexExecutor: ConversationExecutor = {
  mode: 'daemon',
  agentId: 'codex',
  agentModel: { model: 'gpt-5.5', reasoning: 'high', serviceTier: 'priority' },
};

describe('conversationExecutorRunDefaults', () => {
  it('fills the agent and every model choice the request left out', () => {
    expect(conversationExecutorRunDefaults(codexExecutor, { message: 'hi' })).toEqual({
      agentId: 'codex',
      model: 'gpt-5.5',
      reasoning: 'high',
      serviceTier: 'priority',
    });
  });

  it('treats an empty agent id as left out', () => {
    expect(conversationExecutorRunDefaults(codexExecutor, { agentId: '' })).toEqual({
      agentId: 'codex',
      model: 'gpt-5.5',
      reasoning: 'high',
      serviceTier: 'priority',
    });
  });

  it('leaves a model choice the request sent as null alone', () => {
    expect(conversationExecutorRunDefaults(codexExecutor, {
      model: null,
      reasoning: null,
    })).toEqual({ agentId: 'codex', serviceTier: 'priority' });
  });

  it('fills model choices for a request that names the same agent', () => {
    expect(conversationExecutorRunDefaults(codexExecutor, { agentId: 'codex' })).toEqual({
      model: 'gpt-5.5',
      reasoning: 'high',
      serviceTier: 'priority',
    });
  });

  it('never applies one agent\'s model choices to another agent', () => {
    expect(conversationExecutorRunDefaults(codexExecutor, { agentId: 'claude' })).toEqual({});
  });

  it('fills only the agent when the executor stores no model choices', () => {
    expect(conversationExecutorRunDefaults({ mode: 'daemon', agentId: 'claude' }, {}))
      .toEqual({ agentId: 'claude' });
  });

  it('does not default a request that carries a BYOK provider', () => {
    expect(conversationExecutorRunDefaults(codexExecutor, {
      byokProvider: { protocol: 'openai', apiKey: 'k' },
    })).toEqual({});
  });

  it('does not default from a BYOK executor', () => {
    expect(conversationExecutorRunDefaults(
      { mode: 'api', apiProtocol: 'openai', model: 'gpt-4o' },
      {},
    )).toEqual({});
  });

  it('does not default when the conversation stores no executor', () => {
    expect(conversationExecutorRunDefaults(null, {})).toEqual({});
    expect(conversationExecutorRunDefaults(undefined, {})).toEqual({});
  });
});

describe('conversationExecutorFromCliFlags', () => {
  it('returns no change when no executor flag is present', () => {
    expect(conversationExecutorFromCliFlags({ title: 'x', json: true }))
      .toEqual({ ok: true, executor: undefined });
  });

  it('builds a Local CLI executor from --agent and its model choices', () => {
    expect(conversationExecutorFromCliFlags({
      agent: 'codex',
      model: 'gpt-5.5',
      reasoning: 'high',
      'service-tier': 'priority',
    })).toEqual({
      ok: true,
      executor: {
        mode: 'daemon',
        agentId: 'codex',
        agentModel: { model: 'gpt-5.5', reasoning: 'high', serviceTier: 'priority' },
      },
    });
  });

  it('builds a Local CLI executor without model choices', () => {
    expect(conversationExecutorFromCliFlags({ agent: 'claude' }))
      .toEqual({ ok: true, executor: { mode: 'daemon', agentId: 'claude' } });
  });

  it('builds a BYOK executor from --byok-protocol and --model', () => {
    expect(conversationExecutorFromCliFlags({ 'byok-protocol': 'openai', model: 'gpt-4o' }))
      .toEqual({ ok: true, executor: { mode: 'api', apiProtocol: 'openai', model: 'gpt-4o' } });
  });

  it('clears the executor with --clear-executor', () => {
    expect(conversationExecutorFromCliFlags({ 'clear-executor': true }))
      .toEqual({ ok: true, executor: null });
  });

  it.each([
    ['--agent with --byok-protocol', { agent: 'codex', 'byok-protocol': 'openai' }, /--agent.*--byok-protocol/],
    ['--reasoning with --byok-protocol', { 'byok-protocol': 'openai', reasoning: 'high' }, /--reasoning/],
    ['--service-tier with --byok-protocol', { 'byok-protocol': 'openai', 'service-tier': 'fast' }, /--service-tier/],
    ['--model alone', { model: 'gpt-5.5' }, /--agent|--byok-protocol/],
    ['--reasoning alone', { reasoning: 'high' }, /--agent|--byok-protocol/],
    ['--service-tier alone', { 'service-tier': 'fast' }, /--agent|--byok-protocol/],
    ['--clear-executor with --agent', { 'clear-executor': true, agent: 'codex' }, /--clear-executor/],
    ['--clear-executor with --model', { 'clear-executor': true, model: 'x' }, /--clear-executor/],
    ['--clear-executor with --byok-protocol', { 'clear-executor': true, 'byok-protocol': 'openai' }, /--clear-executor/],
    ['an unknown BYOK protocol', { 'byok-protocol': 'carrier-pigeon' }, /--byok-protocol/],
    ['an empty agent id', { agent: '   ' }, /agent/],
  ])('rejects %s', (_label, flags, message) => {
    const result = conversationExecutorFromCliFlags(flags);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(message);
  });
});

describe('conversationExecutorLabel', () => {
  it('names a Local CLI executor by its agent and a BYOK executor by its protocol', () => {
    expect(conversationExecutorLabel(codexExecutor)).toBe('codex');
    expect(conversationExecutorLabel({ mode: 'api', apiProtocol: 'openai' })).toBe('byok:openai');
  });
});

describe('resolveStoredOrRecordedExecutor', () => {
  it('prefers the stored executor, then the recorded agent of the last reply', () => {
    expect(resolveStoredOrRecordedExecutor(codexExecutor, 'claude')).toBe(codexExecutor);
    expect(resolveStoredOrRecordedExecutor(null, 'claude')).toEqual({ mode: 'daemon', agentId: 'claude' });
    expect(resolveStoredOrRecordedExecutor(undefined, 'openai-api')).toEqual({ mode: 'api', apiProtocol: 'openai' });
    expect(resolveStoredOrRecordedExecutor(null, null)).toBeNull();
  });
});

describe('conversationExecutorForRun', () => {
  it('reads a Local CLI run with the model choices it named', () => {
    expect(conversationExecutorForRun({ agentId: 'codex', model: 'gpt-5.5', reasoning: null }))
      .toEqual({ mode: 'daemon', agentId: 'codex', agentModel: { model: 'gpt-5.5' } });
    expect(conversationExecutorForRun({ agentId: 'claude' })).toEqual({ mode: 'daemon', agentId: 'claude' });
  });

  it('reads a BYOK run from its provider without keeping credentials', () => {
    expect(conversationExecutorForRun({
      agentId: 'byok-opencode',
      byokProvider: { protocol: 'openai', apiKey: 'sk-secret', model: 'gpt-5.4' },
    })).toEqual({ mode: 'api', apiProtocol: 'openai', model: 'gpt-5.4' });
  });

  it('reads nothing from the BYOK runtime without a provider, or without an agent', () => {
    expect(conversationExecutorForRun({ agentId: 'byok-opencode' })).toBeNull();
    expect(conversationExecutorForRun({})).toBeNull();
  });
});
