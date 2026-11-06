# Dark theme (fork overlay)

A dark theme built from the "Ghostty iTerm2 Dark" terminal palette. Upstream ships the app light-only, so this theme is a fork-owned overlay. It is built to survive regular `upstream/main` merges with few conflicts.

## How it is wired

- **Preference.** System / Light / Dark is stored per browser in `localStorage['open-design:theme']`, and defaults to System. It is handled by `src/state/theme-preference.ts` and `src/state/appearance.ts`.
  - Upstream's `config.theme`, which `loadConfig()` forces to light, is not read for the document theme.
- **Document.** `<html data-theme>` always carries a concrete `light` or `dark`; System is resolved in JS.
  - It is stamped before first paint by `app/theme-init-script.ts`.
  - It is kept in sync by `installAppearanceController()`, mounted from `app/ThemeController.tsx`, which handles OS changes and other windows.
- **Settings.** The control is `src/components/settings/AppearanceThemeField.tsx`, in Settings → General.
- **Styles.** This folder is imported once, last, from `app/layout.tsx`.

| File | Contents |
|---|---|
| `palette.css` | The raw Ghostty colors (`--ghostty-*`). |
| `tokens.css` | Semantic tokens in dark (`--bg`, `--text`, `--accent`, …), plus every token the codebase reads but never defines. |
| `base.css` | Selection, caret, primary controls, desktop glass. |
| `shell-home.css`, `workspace.css`, `viewer.css`, `chat.css`, `components.css` | Overrides for upstream's global stylesheets, one file per area. |
| `content.css` | Keeps authored content (previews, images) light, and adapts bundled black logos. |

- **CSS Modules** can't be reached from here, because their class names are hashed. Each module that needs dark styling ends with one block (see the rules below).

## Rules

1. **Never edit upstream global stylesheets** (`src/styles/**` outside this folder). Override them here.
2. **Selectors:**
   - Token declarations use `:where(html)[data-theme='dark']`, at specificity 0,1,0. They win over upstream's legacy `[data-theme="dark"]` blocks by load order, and deliberately lose to upstream's `html:root` reduced-transparency and no-backdrop fallbacks.
   - Component overrides use `html[data-theme='dark']` followed by the **full** upstream selector, including its state (`:hover`, `.active`, `:not(...)`, `:has(...)`). A base-class override does not beat a more specific upstream state rule.
   - `!important` is allowed only to beat an inline style or an upstream `!important`. Leave a one-line reason next to it.
3. **Colors come from tokens.**
   - Outside `palette.css` and `tokens.css`, use only `var(--…)`, `transparent`, `currentColor`, or `color-mix()` of tokens.
   - If no token fits, add one to `tokens.css`, check its contrast, and then use it.
4. **Fills need a matching ink.**
   - In dark, bright tokens (`--selected`, `--accent`, `--blue`, `--green`, `--red`, `--amber`) are light colors. Anything that paints one of them as a **background** must set the text to `--accent-contrast` (or another dark ink), never `#fff`.
   - Neutral `--purple` is light too.
5. **CSS Modules:** add one block at the **end** of the module file:
   ```css
   /* ── dark theme (fork) · see styles/theme-dark/README.md ── */
   :global(html[data-theme='dark']) .localClass { … }
   ```
   Keep everything in that single block. On a merge conflict, keep both sides.
6. **Authored content stays as authored.** User designs, previews, thumbnails and exports must not change with the app theme. Never restyle them. `content.css` pins their color scheme to light.

## Contrast budget

Every value below is the contrast ratio against `--bg-elevated` `#0f131a`, the darkest raised surface.

| Text token | Ratio |
|---|---|
| `--text-strong` | 16.9 |
| `--text` | 13.6 |
| `--text-muted` | 9.0 |
| `--text-soft` | 6.7 |
| `--text-faint` | 4.9 |

- `--text-faint` is the floor for readable text. Don't use anything lighter than that.
- Accent, green, red and amber text all clear 6:1.

## After syncing upstream

Run the guard tests:

```sh
pnpm --filter @open-design/web exec vitest run tests/styles/dark-theme
```

Each guard is a review trigger, not proof of coverage.

- **token parity:** upstream added a color token. Give it a dark value in `tokens.css`, or allowlist it if it is theme-independent on purpose.
- **overlay selectors:** upstream renamed or removed a class this folder overrides. Point the override at the new selector, or delete it.
- **literal-free:** an override here or in a module's dark block uses a raw color. Swap it for a token.
- **coverage fingerprints:** upstream added a hard-coded color to a stylesheet or an inline style.
  1. Look at it in dark mode, and add an override if it looks light.
  2. Re-snapshot with `UPDATE_DARK_COVERAGE=1` and the same command.
