/**
 * Inline script that runs before React hydrates, so the first paint already
 * carries the right theme and accent (no flash of the wrong theme).
 *
 * It mirrors `applyResolvedAppearance()` in `src/state/appearance.ts` and
 * cannot import application modules, so keep these in sync:
 * - the theme preference key and its System resolution (`state/theme-preference.ts`)
 * - the accent mix ratios (`accentVars()`)
 * - the dark-theme accent legibility rule (`isAccentLegibleInDarkTheme()`,
 *   4.5:1 against `DARK_ACCENT_SURFACE` #0f131a)
 * - the theme-color values (`THEME_COLOR_META`)
 *
 * Each stage has its own try/catch: when storage throws, the theme still
 * resolves from the OS, and a malformed config cannot keep the theme from
 * being stamped. `data-theme` is always set to a concrete `light` or `dark`.
 */
export const THEME_INIT_SCRIPT = [
  '(function(){',
  'var d=document.documentElement;var dark=false;',
  "try{dark=!!(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);}catch(e){}",
  "try{var p=localStorage.getItem('open-design:theme');if(p==='light')dark=false;else if(p==='dark')dark=true;}catch(e){}",
  "d.setAttribute('data-theme',dark?'dark':'light');",
  "try{var m=document.querySelector('meta[name=\"theme-color\"]');if(m)m.setAttribute('content',dark?'#05080d':'#f7f7f7');}catch(e){}",
  'try{',
  "var c=JSON.parse(localStorage.getItem('open-design:config')||'{}');",
  "var a=typeof c.accentColor==='string'&&/^#[0-9a-fA-F]{6}$/.test(c.accentColor.trim())?c.accentColor.trim().toLowerCase():'#353535';",
  "if(c.configMigrationVersion!==3&&(a==='#87ea5c'||a==='#c96442'))a='#353535';",
  'if(dark){',
  'var lum=function(h){var r=0,i,v;var w=[0.2126,0.7152,0.0722];for(i=0;i<3;i++){v=parseInt(h.slice(1+i*2,3+i*2),16)/255;v=v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);r+=w[i]*v;}return r;};',
  "var la=lum(a),lb=lum('#0f131a');",
  "if(a==='#353535'||(Math.max(la,lb)+0.05)/(Math.min(la,lb)+0.05)<4.5)return;",
  '}',
  'var s=d.style;',
  "s.setProperty('--accent',a);",
  "s.setProperty('--accent-strong','color-mix(in srgb, '+a+' 82%, var(--text-strong))');",
  "s.setProperty('--accent-soft','color-mix(in srgb, '+a+' 12%, var(--bg-subtle))');",
  "s.setProperty('--accent-tint','color-mix(in srgb, '+a+' 6%, var(--bg-panel))');",
  "s.setProperty('--accent-hover','color-mix(in srgb, '+a+' 86%, var(--text-strong))');",
  '}catch(e){}',
  '})();',
].join('');
