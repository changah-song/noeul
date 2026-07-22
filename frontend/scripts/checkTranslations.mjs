// Guards i18n/translations.js against drift. Fails (exit 1) when:
//  - any language table is missing a key that `en` has, or has one `en` lacks
//  - a translation uses a {{placeholder}} that the `en` value does not provide
//    (translate() renders unknown params as empty strings)
// A translation MAY omit an en placeholder — the param just goes unused,
// which is normal for languages that fold it into grammar (e.g. Korean counters).
//
// Run from frontend/:  node scripts/checkTranslations.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { UI_TRANSLATIONS } = await import(path.join(here, '../i18n/translations.js'));

const en = UI_TRANSLATIONS.en;
const enKeys = new Set(Object.keys(en));
const placeholders = (s) => new Set([...String(s).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]));

const problems = [];

for (const [lang, table] of Object.entries(UI_TRANSLATIONS)) {
  if (lang === 'en') continue;
  for (const key of enKeys) {
    if (!(key in table)) {
      problems.push(`${lang}: missing key ${key}`);
      continue;
    }
    const allowed = placeholders(en[key]);
    for (const p of placeholders(table[key])) {
      if (!allowed.has(p)) {
        problems.push(`${lang}: ${key} uses {{${p}}} which en does not provide`);
      }
    }
  }
  for (const key of Object.keys(table)) {
    if (!enKeys.has(key)) problems.push(`${lang}: orphan key ${key} (not in en)`);
  }
}

if (problems.length) {
  console.error(`checkTranslations: ${problems.length} problem(s)`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`checkTranslations: OK — ${Object.keys(UI_TRANSLATIONS).length} languages × ${enKeys.size} keys`);
