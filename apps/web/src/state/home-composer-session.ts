import type { LocalCatalogScope, WorkspaceContextItem } from '@open-design/contracts';
import type {
  ActivePlugin,
  SelectedConnectorContext,
  SelectedMcpContext,
  SelectedPluginContext,
} from '../components/HomeView';
import type { SkillSummary } from '../types';

/**
 * What the Home composer holds besides its prompt and design system.
 *
 * Settings and every project route swap App's single `appMain` slot, so
 * `HomeView` unmounts each time the user steps away from Home. The prompt,
 * design system and type survive restarts through their localStorage draft;
 * everything here lives in memory instead, because it is made of live values
 * that must not be serialized: catalogue records, `File` handles, MCP configs
 * whose `env`/headers carry secrets, and a short-lived desktop working-dir
 * token. It therefore lasts until the page reloads or the app restarts.
 */
export interface HomeComposerSession {
  active: ActivePlugin | null;
  activeSkill: SkillSummary | null;
  activeSkillCatalogScope: LocalCatalogScope | null;
  selectedPluginContexts: SelectedPluginContext[];
  selectedMcpContexts: SelectedMcpContext[];
  selectedConnectorContexts: SelectedConnectorContext[];
  contextWorkspaceItems: WorkspaceContextItem[];
  workingDir: string | null;
  workingDirToken: string | null;
  stagedFiles: File[];
}

let session: HomeComposerSession | null = null;
// Advances whenever the saved content changes, not on every save: a Home that
// mounts and saves back exactly what it restored leaves it alone.
let revision = 0;

/**
 * The composer as Home last left it, or null. Never mutates the slot: React
 * StrictMode runs state initializers twice and keeps one result.
 */
export function peekHomeComposerSession(): HomeComposerSession | null {
  return session;
}

export function saveHomeComposerSession(next: HomeComposerSession): void {
  if (!session || !sameHomeComposerSession(session, next)) revision += 1;
  session = next;
}

/** Identifies the session's current content; see `clearSentHomeComposerSession`. */
export function homeComposerSessionRevision(): number {
  return revision;
}

export function clearHomeComposerSession(): void {
  session = null;
  revision += 1;
}

/**
 * Drops the composer a send carried once that send is accepted, unless the
 * user changed the composer in the meantime. A Home send resolves only after
 * the project is created, and the user may come back to Home and keep working
 * before it does; that newer composer must not be cleared.
 */
export function clearSentHomeComposerSession(sentRevision: number): void {
  if (revision === sentRevision) clearHomeComposerSession();
}

// Compares what the user picked, not object identity: rebinding a pick to a
// fresher catalogue record, or a new apply snapshot, is not a change.
function sameHomeComposerSession(a: HomeComposerSession, b: HomeComposerSession): boolean {
  return sameActive(a.active, b.active)
    && a.activeSkill?.id === b.activeSkill?.id
    && a.activeSkillCatalogScope?.workspaceId === b.activeSkillCatalogScope?.workspaceId
    && a.activeSkillCatalogScope?.workspaceMemberId === b.activeSkillCatalogScope?.workspaceMemberId
    && a.workingDir === b.workingDir
    && a.workingDirToken === b.workingDirToken
    && sameItems(a.selectedPluginContexts, b.selectedPluginContexts, (item) => `${item.record.id}:${item.inlineBacked}`)
    && sameItems(a.selectedMcpContexts, b.selectedMcpContexts, (item) => `${item.server.id}:${item.inlineBacked}`)
    && sameItems(a.selectedConnectorContexts, b.selectedConnectorContexts, (item) => `${item.connector.id}:${item.inlineBacked}`)
    && sameItems(a.contextWorkspaceItems, b.contextWorkspaceItems, (item) => item.id)
    && sameItems(a.stagedFiles, b.stagedFiles, (file) => file);
}

function sameActive(a: ActivePlugin | null, b: ActivePlugin | null): boolean {
  if (!a || !b) return a === b;
  return a.record.id === b.record.id
    && a.chipId === b.chipId
    && a.prototypeSubtypeId === b.prototypeSubtypeId
    && a.explicitPick === b.explicitPick
    && a.examplePick === b.examplePick
    && JSON.stringify(a.inputs) === JSON.stringify(b.inputs);
}

function sameItems<T>(a: readonly T[], b: readonly T[], key: (item: T) => unknown): boolean {
  return a.length === b.length && a.every((item, index) => key(item) === key(b[index]!));
}
