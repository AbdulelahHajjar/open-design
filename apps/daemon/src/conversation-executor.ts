import {
  executorFromRecordedAgentId,
  isByokChatProtocol,
  parseConversationExecutor,
  type AgentModelPrefs,
  type ConversationExecutor,
} from '@open-design/contracts';
import { BYOK_OPENCODE_AGENT_ID } from './runtimes/byok-opencode.js';

export interface ConversationExecutorRunDefaults {
  agentId?: string;
  model?: string;
  reasoning?: string;
  serviceTier?: string;
}

export type ConversationExecutorCliResult =
  | { ok: true; executor: ConversationExecutor | null | undefined }
  | { ok: false; message: string };

const AGENT_MODEL_KEYS = ['model', 'reasoning', 'serviceTier'] as const satisfies ReadonlyArray<
  keyof AgentModelPrefs
>;

/**
 * The run-request fields a conversation's stored Local CLI executor supplies
 * for a request that left them out, so a caller that only names the
 * conversation (the `od` CLI, an external agent) runs on the runtime the
 * conversation is pinned to instead of the app-wide default.
 *
 * Invariants:
 * - Whatever the request sent wins. A model choice counts as sent when its
 *   key is present at all, so an explicit `null` ("use the agent's default")
 *   is never overwritten. An agent id counts as sent only when it is a
 *   non-empty string, matching the run route's own agent fallback.
 * - Stored model choices belong to the stored agent: they are applied only
 *   when the run ends up on that same agent.
 * - Only `daemon` executors default anything, and never for a request that
 *   already carries a `byokProvider`. A BYOK executor names a provider
 *   protocol but no credentials, and the daemon holds no BYOK credentials of
 *   its own, so a BYOK-pinned conversation cannot be run from its executor
 *   alone; the client resolves the key and sends the provider itself.
 */
export function conversationExecutorRunDefaults(
  executor: ConversationExecutor | null | undefined,
  body: Record<string, unknown>,
): ConversationExecutorRunDefaults {
  if (executor?.mode !== 'daemon' || body.byokProvider !== undefined) return {};
  const defaults: ConversationExecutorRunDefaults = {};
  const requestedAgentId =
    typeof body.agentId === 'string' && body.agentId ? body.agentId : null;
  if (!requestedAgentId) defaults.agentId = executor.agentId;
  if ((requestedAgentId ?? executor.agentId) !== executor.agentId) return defaults;
  for (const key of AGENT_MODEL_KEYS) {
    const value = executor.agentModel?.[key];
    if (value && !Object.hasOwn(body, key)) defaults[key] = value;
  }
  return defaults;
}

/**
 * The executor a conversation runs on: its stored executor, else the one its
 * last assistant turn recorded. `null` means it follows the app-wide default.
 * Mirrors the web client's resolution so the UI and `od` agree.
 */
export function resolveStoredOrRecordedExecutor(
  stored: ConversationExecutor | null | undefined,
  lastAssistantAgentId: string | null,
): ConversationExecutor | null {
  return stored ?? executorFromRecordedAgentId(lastAssistantAgentId);
}

/**
 * The executor an accepted run is running on, in the form a conversation
 * stores: the BYOK provider it was sent with, else its Local CLI agent and the
 * model choices the request named. `null` when it names neither (the BYOK
 * runtime without a provider is not an executor of its own).
 */
export function conversationExecutorForRun(run: {
  agentId?: unknown;
  model?: unknown;
  reasoning?: unknown;
  serviceTier?: unknown;
  byokProvider?: unknown;
}): ConversationExecutor | null {
  const provider = run.byokProvider;
  if (provider && typeof provider === 'object') {
    const { protocol, model } = provider as { protocol?: unknown; model?: unknown };
    const parsed = parseConversationExecutor({ mode: 'api', apiProtocol: protocol, model });
    return parsed.ok ? parsed.executor : null;
  }
  if (typeof run.agentId !== 'string' || !run.agentId || run.agentId === BYOK_OPENCODE_AGENT_ID) {
    return null;
  }
  const agentModel: AgentModelPrefs = {};
  for (const key of AGENT_MODEL_KEYS) {
    const value = run[key];
    if (typeof value === 'string' && value.trim()) agentModel[key] = value;
  }
  const parsed = parseConversationExecutor({
    mode: 'daemon',
    agentId: run.agentId,
    ...(Object.keys(agentModel).length > 0 ? { agentModel } : {}),
  });
  return parsed.ok ? parsed.executor : null;
}

/**
 * Reads the executor flags shared by `od conversation new|update` and
 * `od chat new`:
 * - `--agent <id>` with optional `--model`, `--reasoning`, `--service-tier`
 *   pins a Local CLI agent;
 * - `--byok-protocol <protocol>` with optional `--model` pins a BYOK provider;
 * - `--clear-executor` clears the stored executor (`null`);
 * - none of them leaves the executor unchanged (`undefined`).
 *
 * Credentials are never part of an executor, so no key or base-URL flag is
 * read here.
 */
export function conversationExecutorFromCliFlags(
  flags: Record<string, unknown>,
): ConversationExecutorCliResult {
  const agent = cliString(flags.agent);
  const protocol = cliString(flags['byok-protocol']);
  const model = cliString(flags.model);
  const reasoning = cliString(flags.reasoning);
  const serviceTier = cliString(flags['service-tier']);
  const anySelection = [agent, protocol, model, reasoning, serviceTier].some(
    (value) => value !== undefined,
  );

  if (flags['clear-executor'] === true) {
    if (anySelection) {
      return failure(
        '--clear-executor cannot be combined with --agent, --byok-protocol, --model, --reasoning, or --service-tier',
      );
    }
    return { ok: true, executor: null };
  }
  if (agent !== undefined && protocol !== undefined) {
    return failure('--agent and --byok-protocol are mutually exclusive: pick a Local CLI agent or a BYOK provider');
  }
  if (protocol !== undefined) {
    if (reasoning !== undefined || serviceTier !== undefined) {
      return failure('--reasoning and --service-tier apply to a Local CLI agent (--agent), not to --byok-protocol');
    }
    if (!isByokChatProtocol(protocol)) {
      return failure('--byok-protocol must be anthropic, openai, azure, google, ollama, senseaudio or aihubmix');
    }
    return validated({ mode: 'api', apiProtocol: protocol, model });
  }
  if (agent !== undefined) {
    // Without model flags the conversation follows the app-wide model choices
    // for this agent; with any of them it holds its own.
    const namesModelChoice = [model, reasoning, serviceTier].some((value) => value !== undefined);
    return validated({
      mode: 'daemon',
      agentId: agent,
      ...(namesModelChoice ? { agentModel: { model, reasoning, serviceTier } } : {}),
    });
  }
  if (anySelection) {
    return failure('--model, --reasoning, and --service-tier need --agent <id> or --byok-protocol <protocol>');
  }
  return { ok: true, executor: undefined };
}

/** A short human label: the agent id, or `byok:<protocol>`. */
export function conversationExecutorLabel(executor: ConversationExecutor): string {
  return executor.mode === 'daemon' ? executor.agentId : `byok:${executor.apiProtocol}`;
}

function validated(candidate: Record<string, unknown>): ConversationExecutorCliResult {
  const parsed = parseConversationExecutor(candidate);
  if (!parsed.ok) return failure(`invalid executor flags: ${parsed.message}`);
  return { ok: true, executor: parsed.executor };
}

function failure(message: string): ConversationExecutorCliResult {
  return { ok: false, message };
}

function cliString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
