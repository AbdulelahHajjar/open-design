import { describe, expect, it } from 'vitest';

import {
  clearHomeComposerSession,
  clearSentHomeComposerSession,
  homeComposerSessionRevision,
  peekHomeComposerSession,
  saveHomeComposerSession,
  type HomeComposerSession,
} from '../../src/state/home-composer-session';

const SESSION: HomeComposerSession = {
  active: null,
  activeSkill: null,
  activeSkillCatalogScope: null,
  selectedPluginContexts: [],
  selectedMcpContexts: [],
  selectedConnectorContexts: [],
  contextWorkspaceItems: [],
  workingDir: '/Users/me/site',
  workingDirToken: 'host-token',
  stagedFiles: [],
};

describe('home composer session', () => {
  it('hands back the saved composer on every read until it is cleared', () => {
    expect(peekHomeComposerSession()).toBeNull();
    saveHomeComposerSession(SESSION);
    expect(peekHomeComposerSession()).toBe(SESSION);
    expect(peekHomeComposerSession()).toBe(SESSION);
    clearHomeComposerSession();
    expect(peekHomeComposerSession()).toBeNull();
  });

  it('clears a sent composer only while nobody changed it', () => {
    saveHomeComposerSession(SESSION);
    const sent = homeComposerSessionRevision();
    // Saving the same picks again (a remount restoring them) is not a change.
    saveHomeComposerSession({ ...SESSION, stagedFiles: [...SESSION.stagedFiles] });
    clearSentHomeComposerSession(sent);
    expect(peekHomeComposerSession()).toBeNull();

    saveHomeComposerSession(SESSION);
    const sentAgain = homeComposerSessionRevision();
    const changed = { ...SESSION, workingDir: '/Users/me/other' };
    saveHomeComposerSession(changed);
    clearSentHomeComposerSession(sentAgain);
    expect(peekHomeComposerSession()).toBe(changed);
  });
});
