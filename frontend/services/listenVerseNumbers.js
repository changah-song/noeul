// Verse numbers glued to the word after them ("26Then God said"). Bibles and
// other numbered texts often print the number with no space, and in an
// English book listen mode would read it as "twenty-six then". A number like
// that is turned to spaces, the same length, so the voice's offsets still
// match the words on the page.
//
// Kept apart from real words that start with a number: "2nd", "4th", "90s",
// "10am", "5km", "3D". Those end in a short suffix or unit, or in one capital
// letter, while a verse number runs into a full word ("Then", "and").

const UNITS = new Set([
    'st', 'nd', 'rd', 'th', 's', 'am', 'pm', 'x', 'k', 'm', 'g', 'h', 'd',
    'km', 'kg', 'mg', 'ml', 'cm', 'mm', 'lb', 'lbs', 'oz', 'ft', 'in', 'mi',
    'mph', 'kph', 'hr', 'hrs', 'min', 'mins', 'sec', 'secs', 'ms',
    'kb', 'mb', 'gb', 'tb', 'px', 'pt', 'fps', 'kw', 'kwh', 'hz', 'khz', 'mhz', 'ghz',
]);

// A number of up to three digits with no letter or digit before it, and the
// letters that follow straight after it.
const GLUED = /(^|[^\p{L}\p{N}])(\d{1,3})(\p{L}+)/gu;

const isVerseNumberBefore = (word) => {
    // "Then", "In": a capital and then small letters. Units are written
    // small, so "5In" is a verse even though "5in" is five inches.
    if (/^\p{Lu}\p{Ll}/u.test(word)) return true;
    // "and", "the": a small word of at least three letters that isn't a unit.
    return /^\p{Ll}{3,}$/u.test(word) && !UNITS.has(word);
};

/** `text` with verse numbers glued to English words turned to spaces. */
export const blankGluedVerseNumbers = (text) => {
    if (typeof text !== 'string' || !/\d\p{L}/u.test(text)) return text;
    return text.replace(GLUED, (match, before, digits, word) => (
        isVerseNumberBefore(word) ? `${before}${' '.repeat(digits.length)}${word}` : match
    ));
};
