import type { AgentModelPrefs } from './app-config.js';
import type { ByokChatProtocol } from './chat.js';

/**
 * The executor a conversation runs on: which runtime answers its turns and
 * with which model choices. A conversation owns this value; the app-wide
 * execution settings are only the default a new conversation starts from.
 *
 * The value never carries credentials. A BYOK executor names its provider
 * protocol, and the host resolves the key and base URL for that protocol from
 * its own settings at send time.
 */
export type ConversationExecutor = DaemonConversationExecutor | ApiConversationExecutor;

export type ConversationExecutorMode = ConversationExecutor['mode'];

/**
 * A local CLI agent (Codex, Claude Code, OpenDesign cloud `amr`, …).
 * `agentModel` absent means the conversation follows the app-wide model
 * choices for this agent; present (even `{}`) means it holds its own, and an
 * empty object is an explicit "agent defaults".
 */
export interface DaemonConversationExecutor {
  mode: 'daemon';
  agentId: string;
  agentModel?: AgentModelPrefs;
}

/** A bring-your-own-key provider reached through the BYOK runtime. */
export interface ApiConversationExecutor {
  mode: 'api';
  apiProtocol: ByokChatProtocol;
  model?: string;
}

export type ConversationExecutorParseResult =
  | { ok: true; executor: ConversationExecutor | null }
  | { ok: false; message: string };

const BYOK_CHAT_PROTOCOLS: Record<ByokChatProtocol, true> = {
  anthropic: true,
  openai: true,
  azure: true,
  google: true,
  ollama: true,
  senseaudio: true,
  aihubmix: true,
};

/**
 * The agent id an assistant turn records when it ran on a BYOK provider (the
 * provider's identity, not the runtime that executed it).
 */
export const BYOK_RECORDED_AGENT_IDS: Record<ByokChatProtocol, string> = {
  anthropic: 'anthropic-api',
  openai: 'openai-api',
  azure: 'azure-openai-api',
  google: 'google-gemini-api',
  ollama: 'ollama-cloud-api',
  senseaudio: 'senseaudio-api',
  aihubmix: 'aihubmix-api',
};

/**
 * Recorded agent ids that do not name an executor: the runtime that executes
 * BYOK turns, and a provider BYOK chat no longer offers.
 */
const NON_EXECUTOR_RECORDED_AGENT_IDS: ReadonlySet<string> = new Set(['byok-opencode', 'bedrock-api']);

const MAX_AGENT_ID_LENGTH = 128;
const MAX_CHOICE_LENGTH = 256;
const AGENT_ID_PATTERN = /^[^\s\p{Cc}]+$/u;

export function isByokChatProtocol(value: unknown): value is ByokChatProtocol {
  return typeof value === 'string' && Object.hasOwn(BYOK_CHAT_PROTOCOLS, value);
}

/**
 * Validates an untrusted executor value and returns it in canonical form:
 * strings trimmed, empty choices dropped, unknown keys stripped. `null` is a
 * valid input that means "no stored executor". Because only known keys are
 * copied, a stored executor can never smuggle a credential through.
 */
export function parseConversationExecutor(value: unknown): ConversationExecutorParseResult {
  if (value === null) return { ok: true, executor: null };
  if (!isPlainObject(value)) {
    return { ok: false, message: 'executor must be an object or null' };
  }
  if (value.mode === 'daemon') {
    const agentId = typeof value.agentId === 'string' ? value.agentId.trim() : '';
    if (
      !agentId
      || agentId.length > MAX_AGENT_ID_LENGTH
      || !AGENT_ID_PATTERN.test(agentId)
    ) {
      return { ok: false, message: 'executor.agentId must be a non-empty agent id' };
    }
    const agentModel = parseAgentModel(value.agentModel);
    if (agentModel === false) {
      return {
        ok: false,
        message: 'executor.agentModel must be an object of model, reasoning, and serviceTier strings',
      };
    }
    return {
      ok: true,
      executor: agentModel === null ? { mode: 'daemon', agentId } : { mode: 'daemon', agentId, agentModel },
    };
  }
  if (value.mode === 'api') {
    if (!isByokChatProtocol(value.apiProtocol)) {
      return { ok: false, message: 'executor.apiProtocol must be a supported BYOK provider protocol' };
    }
    const model = parseChoiceString(value.model);
    if (model === false) {
      return { ok: false, message: 'executor.model must be a string' };
    }
    return {
      ok: true,
      executor: model
        ? { mode: 'api', apiProtocol: value.apiProtocol, model }
        : { mode: 'api', apiProtocol: value.apiProtocol },
    };
  }
  return { ok: false, message: "executor.mode must be 'daemon' or 'api'" };
}

/**
 * The executor an assistant turn ran on, read from the agent id it recorded.
 * Conversations that predate stored executors resolve their executor this way
 * from their last assistant turn. Model choices were never recorded on turns,
 * so the result carries none and follows the host's app-wide choices.
 */
export function executorFromRecordedAgentId(
  agentId: string | null | undefined,
): ConversationExecutor | null {
  const id = agentId?.trim();
  if (!id || NON_EXECUTOR_RECORDED_AGENT_IDS.has(id)) return null;
  const protocol = (Object.keys(BYOK_RECORDED_AGENT_IDS) as ByokChatProtocol[])
    .find((candidate) => BYOK_RECORDED_AGENT_IDS[candidate] === id);
  const parsed = parseConversationExecutor(
    protocol ? { mode: 'api', apiProtocol: protocol } : { mode: 'daemon', agentId: id },
  );
  return parsed.ok ? parsed.executor : null;
}

/** Structural equality over canonical executors; `null`/`undefined` compare equal. */
export function sameConversationExecutor(
  a: ConversationExecutor | null | undefined,
  b: ConversationExecutor | null | undefined,
): boolean {
  if (!a || !b) return !a && !b;
  if (a.mode === 'daemon' && b.mode === 'daemon') {
    return a.agentId === b.agentId
      && (a.agentModel === undefined) === (b.agentModel === undefined)
      && a.agentModel?.model === b.agentModel?.model
      && a.agentModel?.reasoning === b.agentModel?.reasoning
      && a.agentModel?.serviceTier === b.agentModel?.serviceTier;
  }
  if (a.mode === 'api' && b.mode === 'api') {
    return a.apiProtocol === b.apiProtocol && a.model === b.model;
  }
  return false;
}

/**
 * `null` = no choices of its own, `false` = invalid, otherwise the choices.
 * An object with no choices left is kept as `{}`: it records that the
 * conversation uses the agent's defaults rather than the app-wide choices.
 */
function parseAgentModel(value: unknown): AgentModelPrefs | null | false {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) return false;
  const model = parseChoiceString(value.model);
  const reasoning = parseChoiceString(value.reasoning);
  const serviceTier = parseChoiceString(value.serviceTier);
  if (model === false || reasoning === false || serviceTier === false) return false;
  const prefs: AgentModelPrefs = {};
  if (model) prefs.model = model;
  if (reasoning) prefs.reasoning = reasoning;
  if (serviceTier) prefs.serviceTier = serviceTier;
  return prefs;
}

/** `null` = absent or empty, `false` = invalid, string = trimmed value. */
function parseChoiceString(value: unknown): string | null | false {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_CHOICE_LENGTH) return false;
  return trimmed;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
