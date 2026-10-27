// The reader's own highlight colors (long press → Highlight). `fill` is drawn
// behind the text by the native reader (#AARRGGBB, translucent so the ink
// shows through); `swatch` is the solid dot in the toolbar's color row.
export const HIGHLIGHT_COLORS = [
    { key: 'yellow', fill: { light: '#66FFCF40', dark: '#5CB88A12' }, swatch: { light: '#F5C33B', dark: '#C99A1E' } },
    { key: 'green', fill: { light: '#5C86D96B', dark: '#5C3F8F3A' }, swatch: { light: '#6CC35A', dark: '#4E9E45' } },
    { key: 'blue', fill: { light: '#5C74B4FF', dark: '#5C2F6FB0' }, swatch: { light: '#5BA4F5', dark: '#3E7FC4' } },
    { key: 'pink', fill: { light: '#5CFF8FB1', dark: '#5CB04A6E' }, swatch: { light: '#F27DA3', dark: '#C25A80' } },
    { key: 'purple', fill: { light: '#5CB79CFF', dark: '#5C7255B8' }, swatch: { light: '#A98BF2', dark: '#8468C9' } },
    { key: 'orange', fill: { light: '#5CFFA94D', dark: '#5CB8661A' }, swatch: { light: '#F59A3E', dark: '#C77724' } },
];

export const DEFAULT_HIGHLIGHT_COLOR = 'yellow';

export const highlightColorFor = (key) => (
    HIGHLIGHT_COLORS.find((color) => color.key === key) || HIGHLIGHT_COLORS[0]
);
