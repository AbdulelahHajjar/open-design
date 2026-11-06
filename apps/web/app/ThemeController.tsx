'use client';

import { useEffect } from 'react';
import { installAppearanceController } from '../src/state/appearance';

/** Keeps every document's theme following the OS and other windows. */
export function ThemeController(): null {
  useEffect(() => {
    installAppearanceController();
  }, []);
  return null;
}
