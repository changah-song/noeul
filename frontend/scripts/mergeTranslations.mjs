// Merges a batch of translation keys into i18n/translations.js without
// hand-editing the 14 tables.
//
//   node scripts/mergeTranslations.mjs <batch.json>
//
// batch.json:
// {
//   "insertAfter": "tabs.learn",            // existing key the new block follows
//   "remove": ["home.bookPlural", ...],      // keys to delete from every table
//   "en": { "new.key": "English", ... },     // new keys, English source of truth
//   "locales": {
//     "fr": { "new": { "new.key": "…" }, "fixes": { "existing.key": "…" } },
//     ...
//   }
// }
//
// Every locale must translate every new key. The script rewrites only the
// affected lines, keeps each table in the en key order, then re-imports the
// result and verifies it against the batch.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const translationsPath = path.join(here, '../i18n/translations.js');
const batch = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

const loadTables = async (file) => {
  const copy = path.join(os.tmpdir(), `translations-${process.pid}-${Date.now()}.mjs`);
  fs.copyFileSync(file, copy);
  try {
    return (await import(pathToFileURL(copy).href)).UI_TRANSLATIONS;
  } finally {
    fs.unlinkSync(copy);
  }
};

const quote = (value) => `'${String(value)
  .replace(/\\/g, '\\\\')
  .replace(/'/g, "\\'")
  .replace(/\n/g, '\\n')}'`;
const entryLine = (key, value) => `    ${quote(key)}: ${quote(value)},`;

const before = await loadTables(translationsPath);
const languages = Object.keys(before);
const newKeys = Object.keys(batch.en);
const removed = new Set(batch.remove ?? []);

for (const language of languages.filter((code) => code !== 'en')) {
  const locale = batch.locales[language];
  if (!locale) throw new Error(`No translations for ${language}`);
  const missing = newKeys.filter((key) => typeof locale.new?.[key] !== 'string' || !locale.new[key].trim());
  if (missing.length) throw new Error(`${language} is missing ${missing.join(', ')}`);
  newKeys.filter((key) => key in before[language]).forEach((key) => {
    throw new Error(`${key} already exists in ${language}`);
  });
}

const lines = fs.readFileSync(translationsPath, 'utf8').split('\n');
const tableStart = /^  (?:'([\w-]+)'|([\w-]+)): \{$/;
const keyLine = /^    '((?:[^'\\]|\\.)+)': /;
const output = [];
let language = null;

for (const line of lines) {
  const start = tableStart.exec(line);
  if (start) {
    language = start[1] ?? start[2];
    output.push(line);
    continue;
  }
  if (line === '  },') {
    language = null;
  }
  const entry = language ? keyLine.exec(line) : null;
  if (!entry) {
    output.push(line);
    continue;
  }
  const key = entry[1].replace(/\\'/g, "'");
  if (removed.has(key)) {
    continue;
  }
  const fix = language === 'en' ? undefined : batch.locales[language]?.fixes?.[key];
  output.push(fix === undefined ? line : entryLine(key, fix));
  if (key === batch.insertAfter) {
    const values = language === 'en' ? batch.en : batch.locales[language].new;
    newKeys.forEach((newKey) => output.push(entryLine(newKey, values[newKey])));
  }
}

fs.writeFileSync(translationsPath, output.join('\n'));

// Verify: every table has en's keys in en's order, and carries the batch.
const after = await loadTables(translationsPath);
const enKeys = Object.keys(after.en);
for (const code of languages) {
  const table = after[code];
  if (Object.keys(table).join('\n') !== enKeys.join('\n')) throw new Error(`${code} key order differs from en`);
  [...removed].forEach((key) => { if (key in table) throw new Error(`${code} still has ${key}`); });
  const values = code === 'en' ? batch.en : { ...batch.locales[code].new, ...batch.locales[code].fixes };
  Object.entries(values).forEach(([key, value]) => {
    if (table[key] !== value) throw new Error(`${code}.${key} was not written`);
  });
}
console.log(`Merged ${newKeys.length} new keys, removed ${removed.size}, into ${languages.length} tables.`);
