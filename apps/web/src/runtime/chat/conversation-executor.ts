/**
 * Which executor a conversation runs on, and how that becomes the execution
 * config its turns are sent with.
 *
 * The app-wide execution settings (`AppConfig`) are only the default a new
 * conversation starts from. Once a conversation has an executor of its own,
 * every turn in it — and the composer's execution menu — uses that executor,
 * whatever the app-wide default has changed to since. The executor is applied
 * as an overlay on the app-wide config: credentials, CLI env, and every other
 * setting still come from the app-wide config, and the overlay is never
 * written back to it.
 *
 * Pure data: no DOM, no fetch.
 */
import {
  executorFromRecordedAgentId,
  parseConversationExecutor,
  sameConversationExecutor,
  type ConversationExecutor,
} from '@open-design/contracts';

import { byokPreflightBlockReason } from '../../components/byok/preflight';
import { mergeAgentModelChoice } from '../../components/agentModelSelection';
import {
  switchApiProtocolConfig,
  updateCurrentApiProtocolConfig,
} from '../../state/apiProtocolConfig';
import type { ApiProtocol, AppConfig, ChatMessage, ExecMode } from '../../types';

export type ConversationExecutorSource = 'stored' | 'legacy' | 'global';

export interface ResolvedConversationExecutor {
  /** `null` means the conversation follows the app-wide default. */
  executor: ConversationExecutor | null;
  source: ConversationExecutorSource;
}

/** One change made from the composer's execution menu. */
export type ConversationExecutorEdit =
  | { kind: 'mode'; mode: ExecMode }
  | { kind: 'agent'; agentId: string }
  | {
      kind: 'agentModel';
      agentId: string;
      choice: { model?: string; reasoning?: string; serviceTier?: string };
    }
  | { kind: 'apiProtocol'; protocol: ApiProtocol }
  | { kind: 'apiModel'; model: string };

/**
 * The executor an execution config currently describes, in canonical form —
 * what a conversation stores when it is pinned. `null` when the config does
 * not describe a runnable executor (no agent picked, or a protocol BYOK chat
 * does not offer).
 */
export function executorFromConfig(config: AppConfig): ConversationExecutor | null {
  const raw = config.mode === 'api'
    ? {
        mode: 'api',
        apiProtocol: config.apiProtocol ?? 'anthropic',
        model: config.model,
      }
    : {
        mode: 'daemon',
        agentId: config.agentId,
        agentModel: config.agentId ? config.agentModels?.[config.agentId] : undefined,
      };
  const parsed = parseConversationExecutor(raw);
  return parsed.ok ? parsed.executor : null;
}

/**
 * The executor a conversation that predates stored executors was running on,
 * read from the agent id its last assistant turn recorded (see
 * `executorFromRecordedAgentId`). Model choices were never recorded on
 * messages, so they follow the app-wide choice for that agent or provider.
 */
export function executorFromLegacyAgentId(
  agentId: string | null | undefined,
): ConversationExecutor | null {
  return executorFromRecordedAgentId(agentId);
}

/** The agent id recorded on the most recent assistant turn that has one. */
export function lastAssistantAgentId(messages: readonly ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role === 'assistant' && message.agentId) return message.agentId;
  }
  return null;
}

/**
 * The executor a conversation runs on: its stored executor, else the one its
 * history shows it was running on, else the app-wide default (`null`).
 */
export function resolveConversationExecutor(input: {
  stored: ConversationExecutor | null | undefined;
  legacyAgentId: string | null | undefined;
}): ResolvedConversationExecutor {
  if (input.stored) return { executor: input.stored, source: 'stored' };
  const legacy = executorFromLegacyAgentId(input.legacyAgentId);
  if (legacy) return { executor: legacy, source: 'legacy' };
  return { executor: null, source: 'global' };
}

/**
 * The execution config a conversation's turns are sent with: the app-wide
 * config with the conversation's executor laid over it. Returns the app-wide
 * config itself when the conversation has no executor or its executor is the
 * one the app-wide config already describes, so storing the default on a
 * conversation does not change the config identity callers memoize on. A Local
 * CLI executor without its own model choice keeps the app-wide choice for that
 * agent; a BYOK executor takes the key and base URL stored for its protocol in
 * the app-wide config.
 */
export function applyExecutorToConfig(
  globalConfig: AppConfig,
  executor: ConversationExecutor | null,
): AppConfig {
  if (!executor || sameConversationExecutor(executor, executorFromConfig(globalConfig))) {
    return globalConfig;
  }
  if (executor.mode === 'daemon') {
    return {
      ...globalConfig,
      mode: 'daemon',
      agentId: executor.agentId,
      agentModels: executor.agentModel !== undefined
        ? { ...(globalConfig.agentModels ?? {}), [executor.agentId]: executor.agentModel }
        : globalConfig.agentModels,
    };
  }
  const switched = switchApiProtocolConfig(globalConfig, executor.apiProtocol);
  return executor.model ? { ...switched, model: executor.model } : switched;
}

/**
 * The execution config a conversation's turns are sent with, from its stored
 * executor and its transcript (for conversations that predate stored
 * executors). One call for surfaces that hold both, such as Side Chat.
 */
export function conversationExecutionConfig(
  globalConfig: AppConfig,
  stored: ConversationExecutor | null | undefined,
  messages: readonly ChatMessage[],
): AppConfig {
  const { executor } = resolveConversationExecutor({
    stored,
    legacyAgentId: lastAssistantAgentId(messages),
  });
  return applyExecutorToConfig(globalConfig, executor);
}

/**
 * The executor a conversation moves to after one composer edit, computed with
 * the same transitions the app-wide settings use so a choice behaves the same
 * in both places. `config` is the conversation's current execution config.
 * `null` when the edit leaves no runnable executor (for example, switching to
 * Local CLI before any agent was ever picked).
 */
export function executorAfterEdit(
  config: AppConfig,
  edit: ConversationExecutorEdit,
): ConversationExecutor | null {
  switch (edit.kind) {
    case 'mode':
      return executorFromConfig({ ...config, mode: edit.mode });
    case 'agent':
      return executorFromConfig({ ...config, mode: 'daemon', agentId: edit.agentId });
    case 'agentModel':
      return executorFromConfig({
        ...config,
        mode: 'daemon',
        agentId: edit.agentId,
        agentModels: {
          ...(config.agentModels ?? {}),
          [edit.agentId]: mergeAgentModelChoice(config.agentModels?.[edit.agentId], edit.choice),
        },
      });
    case 'apiProtocol':
      return executorFromConfig(switchApiProtocolConfig(config, edit.protocol));
    case 'apiModel':
      return executorFromConfig(
        updateCurrentApiProtocolConfig({ ...config, mode: 'api' }, { model: edit.model }),
      );
  }
}

/**
 * Whether the app-wide config holds what a BYOK provider needs to run (key,
 * base URL) so a conversation can be pointed at it. A missing model does not
 * count against it: the model is picked per conversation.
 */
export function byokProtocolConfigured(globalConfig: AppConfig, protocol: ApiProtocol): boolean {
  const reason = byokPreflightBlockReason(switchApiProtocolConfig(globalConfig, protocol));
  return reason === null || reason === 'model_required' || reason === 'model_default';
}
