import { describe, expect, it } from 'vitest';
import {
  executorFromRecordedAgentId,
  parseConversationExecutor,
  sameConversationExecutor,
} from '../src/api/conversation-executor';

describe('parseConversationExecutor', () => {
  it('treats null as clearing the stored executor', () => {
    expect(parseConversationExecutor(null)).toEqual({ ok: true, executor: null });
  });

  it('canonicalizes a local CLI executor', () => {
    expect(parseConversationExecutor({
      mode: 'daemon',
      agentId: '  codex ',
      agentModel: { model: ' gpt-5.5 ', reasoning: '', serviceTier: undefined },
    })).toEqual({
      ok: true,
      executor: { mode: 'daemon', agentId: 'codex', agentModel: { model: 'gpt-5.5' } },
    });
  });

  it('keeps an emptied agent model choice as an explicit "agent defaults"', () => {
    expect(parseConversationExecutor({ mode: 'daemon', agentId: 'claude', agentModel: { model: ' ' } }))
      .toEqual({ ok: true, executor: { mode: 'daemon', agentId: 'claude', agentModel: {} } });
    expect(parseConversationExecutor({ mode: 'daemon', agentId: 'claude' }))
      .toEqual({ ok: true, executor: { mode: 'daemon', agentId: 'claude' } });
  });

  it('canonicalizes a BYOK executor and never keeps credentials', () => {
    expect(parseConversationExecutor({
      mode: 'api',
      apiProtocol: 'openai',
      model: 'gpt-5.5',
      apiKey: 'sk-secret',
      baseUrl: 'https://example.invalid',
    })).toEqual({
      ok: true,
      executor: { mode: 'api', apiProtocol: 'openai', model: 'gpt-5.5' },
    });
  });

  it.each([
    ['a non-object', 'codex'],
    ['an array', []],
    ['an unknown mode', { mode: 'cloud', agentId: 'amr' }],
    ['an empty agent id', { mode: 'daemon', agentId: '  ' }],
    ['an agent id with whitespace', { mode: 'daemon', agentId: 'co dex' }],
    ['an oversized agent id', { mode: 'daemon', agentId: 'a'.repeat(129) }],
    ['a non-string model choice', { mode: 'daemon', agentId: 'codex', agentModel: { model: 5 } }],
    ['an oversized model', { mode: 'api', apiProtocol: 'openai', model: 'm'.repeat(257) }],
    ['bedrock, which BYOK chat does not offer', { mode: 'api', apiProtocol: 'bedrock' }],
    ['a missing protocol', { mode: 'api' }],
  ])('rejects %s', (_label, value) => {
    expect(parseConversationExecutor(value)).toMatchObject({ ok: false });
  });
});

describe('sameConversationExecutor', () => {
  it('compares executors by value', () => {
    expect(sameConversationExecutor(
      { mode: 'daemon', agentId: 'codex', agentModel: { model: 'gpt-5.5' } },
      { mode: 'daemon', agentId: 'codex', agentModel: { model: 'gpt-5.5' } },
    )).toBe(true);
    expect(sameConversationExecutor(
      { mode: 'daemon', agentId: 'codex', agentModel: { model: 'gpt-5.5' } },
      { mode: 'daemon', agentId: 'codex', agentModel: { model: 'gpt-5.4' } },
    )).toBe(false);
    expect(sameConversationExecutor(
      { mode: 'api', apiProtocol: 'openai' },
      { mode: 'daemon', agentId: 'openai' },
    )).toBe(false);
  });

  it('tells following the app-wide choices apart from explicit agent defaults', () => {
    expect(sameConversationExecutor(
      { mode: 'daemon', agentId: 'codex' },
      { mode: 'daemon', agentId: 'codex', agentModel: {} },
    )).toBe(false);
  });

  it('treats missing executors as equal to each other only', () => {
    expect(sameConversationExecutor(null, undefined)).toBe(true);
    expect(sameConversationExecutor(null, { mode: 'api', apiProtocol: 'google' })).toBe(false);
  });
});

describe('executorFromRecordedAgentId', () => {
  it('reads a Local CLI agent and a BYOK provider identity', () => {
    expect(executorFromRecordedAgentId('codex')).toEqual({ mode: 'daemon', agentId: 'codex' });
    expect(executorFromRecordedAgentId('openai-api')).toEqual({ mode: 'api', apiProtocol: 'openai' });
  });

  it.each([null, undefined, '', 'byok-opencode', 'bedrock-api', 'co dex'])(
    'reads no executor from %p',
    (agentId) => {
      expect(executorFromRecordedAgentId(agentId)).toBeNull();
    },
  );
});
