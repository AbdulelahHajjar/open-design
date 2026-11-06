import type { CSSProperties } from 'react';
import { useT } from '../../i18n';
import { setThemePreference } from '../../state/appearance';
import {
  THEME_PREFERENCES,
  useThemePreference,
  type ThemePreference,
} from '../../state/theme-preference';
import { Icon } from '../Icon';
import styles from './AppearanceThemeField.module.css';

const OPTIONS: Record<
  ThemePreference,
  { labelKey: 'settings.themeSystem' | 'settings.themeLight' | 'settings.themeDark'; icon: 'sun-moon' | 'sun' | 'moon' }
> = {
  system: { labelKey: 'settings.themeSystem', icon: 'sun-moon' },
  light: { labelKey: 'settings.themeLight', icon: 'sun' },
  dark: { labelKey: 'settings.themeDark', icon: 'moon' },
};

/**
 * Settings → General theme picker. The choice applies and persists at once:
 * the theme is a per-browser preference outside the Settings draft, so it has
 * no Save step and closing Settings does not roll it back.
 */
export function AppearanceThemeField() {
  const t = useT();
  const current = useThemePreference();

  return (
    <div className="settings-general-field">
      <span className="settings-general-label">{t('settings.appearance')}</span>
      <div
        className={`seg-control ${styles.control}`}
        role="group"
        aria-label={t('settings.appearance')}
        style={{ '--seg-cols': THEME_PREFERENCES.length } as CSSProperties}
      >
        {THEME_PREFERENCES.map((preference) => {
          const { labelKey, icon } = OPTIONS[preference];
          const active = current === preference;
          return (
            <button
              key={preference}
              type="button"
              className={'seg-btn' + (active ? ' active' : '')}
              aria-pressed={active}
              onClick={() => setThemePreference(preference)}
            >
              <Icon name={icon} size={14} />
              <span className="seg-title">{t(labelKey)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
