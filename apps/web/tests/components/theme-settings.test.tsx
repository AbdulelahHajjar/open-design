// @vitest-environment jsdom
//
// The theme is a System / Light / Dark preference in Settings → General. It
// applies and persists the moment it is picked (no Save step), outside the
// Settings draft. The onboarding welcome page's old sun/moon toggle stays
// removed: Settings is the one place the theme is chosen.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EntryShell } from '../../src/components/EntryShell';
import { SettingsDialog } from '../../src/components/SettingsDialog';
import { I18nProvider } from '../../src/i18n';
import { DEFAULT_CONFIG } from '../../src/state/config';
import type { AgentInfo, AppConfig } from '../../src/types';

const analyticsMocks = vi.hoisted(() => ({
  track: vi.fn(),
}));

vi.mock('../../src/analytics/provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/analytics/provider')>();
  return {
    ...actual,
    useAnalytics: () => ({
      newRequestId: vi.fn(() => 'request-1'),
      setConfigureGlobals: vi.fn(),
      setConsent: vi.fn(),
      setIdentity: vi.fn(),
      track: analyticsMocks.track,
    }),
    useAppVersion: () => null,
  };
});

const AGENTS: AgentInfo[] = [
  { id: 'codex', name: 'Codex', bin: 'codex', available: true },
];

const THEME_CONTROL_LABELS = ['System', 'Light', 'Dark'];

const originalResizeObserver = globalThis.ResizeObserver;

class ResizeObserverMock {
  observe() {}
  disconnect() {}
  unobserve() {}
}

afterEach(() => {
  cleanup();
  globalThis.ResizeObserver = originalResizeObserver;
  analyticsMocks.track.mockReset();
});

beforeEach(() => {
  globalThis.ResizeObserver = ResizeObserverMock as typeof ResizeObserver;
  analyticsMocks.track.mockReset();
});

describe('Settings → General appearance', () => {
  function renderGeneralSettings() {
    return render(
      <I18nProvider initial="en">
        <SettingsDialog
          presentation="page"
          initial={{ ...DEFAULT_CONFIG }}
          agents={AGENTS}
          daemonLive
          appVersionInfo={null}
          initialSection="general"
          onPersist={vi.fn()}
          onPersistComposioKey={vi.fn()}
          onClose={vi.fn()}
          onRefreshAgents={vi.fn()}
        />
      </I18nProvider>,
    );
  }

  afterEach(() => {
    window.localStorage.removeItem('open-design:theme');
    document.documentElement.removeAttribute('data-theme');
  });

  it('offers System, Light and Dark with System selected by default', () => {
    renderGeneralSettings();

    const group = screen.getByRole('group', { name: 'Appearance' });
    for (const label of THEME_CONTROL_LABELS) {
      expect(within(group).getByRole('button', { name: label })).toBeTruthy();
    }
    expect(within(group).getByRole('button', { name: 'System' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('applies and persists a choice immediately', () => {
    renderGeneralSettings();
    const group = screen.getByRole('group', { name: 'Appearance' });

    fireEvent.click(within(group).getByRole('button', { name: 'Dark' }));

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem('open-design:theme')).toBe('dark');
    expect(within(group).getByRole('button', { name: 'Dark' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(within(group).getByRole('button', { name: 'Light' }));

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(window.localStorage.getItem('open-design:theme')).toBe('light');
  });

  it('keeps the neighbouring General settings intact', () => {
    renderGeneralSettings();

    expect(screen.getByRole('combobox', { name: 'Language' })).toBeTruthy();
  });
});

describe('Onboarding welcome (theme toggle removed)', () => {
  function baseConfig(overrides: Partial<AppConfig> = {}): AppConfig {
    return {
      mode: 'daemon',
      agentId: null,
      agentModels: {},
      apiProtocol: 'anthropic',
      apiProtocolConfigs: {},
      apiKey: '',
      baseUrl: '',
      model: '',
      ...overrides,
    } as AppConfig;
  }

  function renderOnboarding() {
    window.history.replaceState(null, '', '/onboarding');
    return render(
      <I18nProvider initial="en">
        <EntryShell
          skills={[]}
          designTemplates={[]}
          designSystems={[]}
          projects={[]}
          templates={[]}
          promptTemplates={[]}
          defaultDesignSystemId={null}
          connectors={[]}
          connectorsLoading={false}
          config={baseConfig()}
          agents={AGENTS}
          daemonLive
          onModeChange={vi.fn()}
          onAgentChange={vi.fn()}
          onAgentModelChange={vi.fn()}
          onApiProtocolChange={vi.fn()}
          onApiModelChange={vi.fn()}
          onConfigPersist={vi.fn()}
          onRefreshAgents={vi.fn(() => AGENTS)}
          onCreateProject={vi.fn()}
          onBeginProjectCreation={() => ({ projectId: 'optimistic-project', rollback: () => undefined })}
          onAmrBalanceGateBlockChange={() => undefined}
          onCreatePluginShareProject={vi.fn()}
          onImportClaudeDesign={vi.fn()}
          onOpenProject={vi.fn()}
          onOpenLiveArtifact={vi.fn()}
          onDeleteProject={vi.fn()}
          onRenameProject={vi.fn()}
          onChangeDefaultDesignSystem={vi.fn()}
          onPersistComposioKey={vi.fn()}
          onOpenSettings={vi.fn()}
          onCompleteOnboarding={vi.fn()}
        />
      </I18nProvider>,
    );
  }

  it('renders no sun/moon theme toggle on the welcome pane', () => {
    const { container } = renderOnboarding();

    expect(container.querySelector('.onboarding-cloud__pane')).not.toBeNull();
    expect(container.querySelector('.onboarding-cloud__theme')).toBeNull();
  });

  it('exposes no theme control by accessible name', () => {
    renderOnboarding();

    for (const label of THEME_CONTROL_LABELS) {
      expect(screen.queryByRole('button', { name: label })).toBeNull();
    }
  });
});
