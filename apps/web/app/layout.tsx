import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { I18nProvider } from '../src/i18n';
import { AnalyticsProvider } from '../src/analytics/provider';
import '@excalidraw/excalidraw/index.css';
import '../src/index.css';
import '../src/styles/home/index.css';
// These hosts render from the client-only App entry. Keep their layout CSS in
// the root route stylesheet so Turbopack does not leave the lazy chunk as a
// preload-only resource after the host mounts.
import '../src/components/TestCampaignModal.module.css';
import '../src/components/HoverTouchpointOverlay.module.css';
import '../src/components/ProductionCampaignBadge.module.css';
import '../src/components/OnboardingWelcome.module.css';
// Dark theme overlay: last, so it follows every stylesheet it overrides.
import '../src/styles/theme-dark/index.css';
import { ThemeController } from './ThemeController';
import { THEME_INIT_SCRIPT } from './theme-init-script';

export const metadata: Metadata = {
  title: 'OpenDesign',
  icons: {
    icon: '/app-icon.png',
    apple: '/app-icon.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#f7f7f7',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang='en' suppressHydrationWarning>
      {/* eslint-disable-next-line @next/next/no-sync-scripts */}
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: intentional theme-init inline script to prevent FOUC */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body suppressHydrationWarning>
        <ThemeController />
        <I18nProvider>
          <AnalyticsProvider>{children}</AnalyticsProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
