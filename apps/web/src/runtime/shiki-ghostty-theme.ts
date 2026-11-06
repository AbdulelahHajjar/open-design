import type { ThemeRegistration } from 'shiki';

/**
 * Dark syntax theme for code blocks, built from the "Ghostty iTerm2 Dark"
 * terminal palette that the app's dark theme is derived from
 * (styles/theme-dark/palette.css). Bright ANSI slots carry the token colors;
 * comments use the dark theme's faint text (#7d838c), because palette 8
 * (#686868) falls under 4.5:1 on the code background.
 */
export const GHOSTTY_DARK_SHIKI_THEME_NAME = 'ghostty-dark';

const FG = '#dcdcdc';
const WHITE = '#c7c7c7';
const PUNCTUATION = '#b0b5bc';
const COMMENT = '#7d838c';
const RED = '#d07e78';
const GREEN = '#82e498';
const YELLOW = '#eae14a';
const BLUE = '#a8abed';
const MAGENTA = '#d483dc';
const CYAN = '#8efafd';
const CYAN_NORMAL = '#59c2c5';

export const ghosttyDarkShikiTheme: ThemeRegistration = {
  name: GHOSTTY_DARK_SHIKI_THEME_NAME,
  type: 'dark',
  colors: {
    'editor.background': '#080b10',
    'editor.foreground': FG,
  },
  tokenColors: [
    { settings: { foreground: FG } },
    {
      scope: ['comment', 'punctuation.definition.comment', 'string.comment'],
      settings: { foreground: COMMENT, fontStyle: 'italic' },
    },
    {
      scope: [
        'keyword',
        'keyword.control',
        'storage',
        'storage.type',
        'storage.modifier',
        'keyword.operator.new',
        'keyword.operator.expression',
        'keyword.operator.logical.python',
        'variable.language',
      ],
      settings: { foreground: MAGENTA },
    },
    { scope: ['keyword.operator', 'keyword.operator.assignment'], settings: { foreground: WHITE } },
    {
      scope: ['string', 'string.quoted', 'string.template', 'punctuation.definition.string'],
      settings: { foreground: GREEN },
    },
    { scope: ['string.regexp', 'constant.character.escape'], settings: { foreground: CYAN_NORMAL } },
    {
      scope: [
        'constant.numeric',
        'constant.language',
        'constant.character',
        'constant.other',
        'support.constant',
        'variable.other.constant',
        'variable.other.enummember',
      ],
      settings: { foreground: YELLOW },
    },
    {
      scope: [
        'entity.name.function',
        'support.function',
        'meta.function-call entity.name.function',
        'variable.function',
      ],
      settings: { foreground: CYAN },
    },
    {
      scope: [
        'entity.name.type',
        'entity.name.class',
        'entity.name.namespace',
        'entity.other.inherited-class',
        'support.type',
        'support.class',
        'storage.type.primitive',
        'support.type.property-name',
        'meta.object-literal.key',
      ],
      settings: { foreground: BLUE },
    },
    { scope: ['entity.name.tag', 'meta.tag.sgml', 'markup.deleted', 'invalid'], settings: { foreground: RED } },
    {
      scope: ['entity.other.attribute-name', 'support.constant.property-value'],
      settings: { foreground: YELLOW },
    },
    { scope: ['variable.parameter'], settings: { foreground: WHITE } },
    { scope: ['variable', 'variable.other'], settings: { foreground: FG } },
    {
      scope: ['punctuation', 'meta.brace', 'punctuation.separator', 'punctuation.terminator'],
      settings: { foreground: PUNCTUATION },
    },
    { scope: ['markup.heading', 'entity.name.section'], settings: { foreground: BLUE, fontStyle: 'bold' } },
    { scope: ['markup.bold'], settings: { fontStyle: 'bold' } },
    { scope: ['markup.italic'], settings: { fontStyle: 'italic' } },
    { scope: ['markup.inserted'], settings: { foreground: GREEN } },
    { scope: ['markup.changed'], settings: { foreground: YELLOW } },
    { scope: ['markup.inline.raw', 'markup.fenced_code'], settings: { foreground: CYAN_NORMAL } },
    { scope: ['markup.underline.link', 'string.other.link'], settings: { foreground: BLUE } },
  ],
};
