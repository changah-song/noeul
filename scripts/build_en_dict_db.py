import gzip
import argparse
import json
import re
import sqlite3
import unicodedata
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "backend" / "en_dict.db"
JSONL_PATH = ROOT / "scripts" / "kaikki.org-dictionary-English.jsonl"
JSONL_GZ_PATH = ROOT / "scripts" / "kaikki.org-dictionary-English.jsonl.gz"
BATCH_SIZE = 10_000
WORD_PARTS_PARSER_VERSION = 3
MORPHEME_GLOSS_VERSION = 1
EN_AUDIO_TAGS = {
    "us": {"US", "General-American"},
    "uk": {"UK", "Received-Pronunciation"},
}
AFFIX_STRIP_MIN_PREFIX_BASE_LEN = 3
AFFIX_STRIP_MIN_SUFFIX_BASE_LEN = 4
AFFIX_STRIP_MIN_PREFIX_LEN = 2
AFFIX_STRIP_MIN_SUFFIX_LEN = 3
TIER3_MIN_PREFIX_EVIDENCE = 75
TIER3_MIN_SUFFIX_EVIDENCE = 100
TIER3_SHORT_PREFIX_ALLOWLIST = {"re", "un"}
TIER3_THREE_LETTER_PREFIX_ALLOWLIST = {
    "bio",
    "geo",
    "mid",
    "mis",
    "neo",
    "non",
    "out",
    "pre",
    "pro",
    "sub",
    "tri",
}
TIER3_SUFFIX_ALLOWLIST = {
    "ability",
    "able",
    "age",
    "al",
    "ation",
    "dom",
    "ee",
    "eer",
    "ess",
    "esque",
    "ful",
    "hood",
    "ial",
    "ibility",
    "ible",
    "ical",
    "ing",
    "ish",
    "ise",
    "ism",
    "ist",
    "ity",
    "ive",
    "ization",
    "ize",
    "less",
    "like",
    "ment",
    "ness",
    "oid",
    "ology",
    "ous",
    "ship",
    "some",
    "ward",
    "wards",
    "wise",
}
TIER3_SUFFIX_BLOCKLIST = {
    "ana",
    "an",
    "ant",
    "ar",
    "ed",
    "en",
    "ent",
    "er",
    "ers",
    "es",
    "ian",
    "ic",
    "in",
    "ion",
    "ling",
    "ly",
    "or",
    "s",
    "y",
}
TIER3_SHORT_E_RESTORED_BASE_ALLOWLIST = {"use"}
TIER3_TARGET_POS = {"noun", "verb", "adj", "adv"}
TIER3_BASE_POS = {"noun", "verb", "adj", "adv"}
WORD_PART_TEMPLATE_PRIORITY = [
    "surf",
    "af",
    "affix",
    "prefix",
    "pre",
    "suffix",
    "suf",
    "confix",
    "compound",
    "com",
    "blend",
]
SOURCE_GLOSS_DUMPS = [
    {
        "language": "Latin",
        "source": "kaikki_latin",
        "paths": [
            ROOT / "scripts" / "kaikki.org-dictionary-Latin.jsonl",
            ROOT / "scripts" / "kaikki.org-dictionary-Latin.jsonl.gz",
        ],
    },
    {
        "language": "Ancient Greek",
        "source": "kaikki_ancient_greek",
        "paths": [
            ROOT / "scripts" / "kaikki.org-dictionary-AncientGreek.jsonl",
            ROOT / "scripts" / "kaikki.org-dictionary-AncientGreek.jsonl.gz",
            ROOT / "scripts" / "kaikki.org-dictionary-Ancient Greek.jsonl",
            ROOT / "scripts" / "kaikki.org-dictionary-Ancient Greek.jsonl.gz",
            ROOT / "scripts" / "kaikki.org-dictionary-Ancient_Greek.jsonl",
            ROOT / "scripts" / "kaikki.org-dictionary-Ancient_Greek.jsonl.gz",
        ],
    },
]
SOURCE_GLOSS_POS = {
    "adj",
    "adv",
    "combining_form",
    "noun",
    "prefix",
    "suffix",
    "verb",
}
MORPHEME_GLOSS_TYPES = {
    "base",
    "bound_root",
    "combining_form",
    "prefix",
    "suffix",
}
MORPHEME_GLOSS_SOURCE_PRIORITIES = {
    "builtin_classical_seed": 90,
    "kaikki_latin": 80,
    "kaikki_ancient_greek": 80,
    "english_base_entry": 70,
    "english_affix_entry": 60,
    "parsed_word_parts": 50,
}
MORPHEME_GLOSS_CONFIDENCE_RANK = {
    "low": 1,
    "medium": 2,
    "high": 3,
}
CANONICAL_MORPHEME_GLOSSES = [
    {
        "key": "ab-",
        "display": "ab-",
        "type": "prefix",
        "language": "Latin",
        "meaning": "away from; from",
        "aliases": ["abs-"],
        "source": "builtin_classical_seed",
        "confidence": "medium",
    },
    {
        "key": "ad-",
        "display": "ad-",
        "type": "prefix",
        "language": "Latin",
        "meaning": "to; toward",
        "aliases": ["ac-", "af-", "ag-", "al-", "an-", "ap-", "ar-", "as-", "at-"],
        "source": "builtin_classical_seed",
        "confidence": "medium",
    },
    {
        "key": "ana-",
        "display": "ana-",
        "type": "prefix",
        "language": "Ancient Greek",
        "meaning": "up; back; again; throughout",
        "aliases": ["ἀνα-"],
        "source": "builtin_classical_seed",
        "confidence": "medium",
    },
    {
        "key": "battere",
        "display": "battere",
        "type": "bound_root",
        "language": "Latin",
        "meaning": "to beat; to hit",
        "aliases": ["battuere"],
        "source": "builtin_classical_seed",
        "confidence": "medium",
    },
    {
        "key": "condō",
        "display": "condō",
        "type": "bound_root",
        "language": "Latin",
        "meaning": "to put together; store; hide",
        "aliases": ["condo", "condere"],
        "source": "builtin_classical_seed",
        "confidence": "medium",
    },
    {
        "key": "horreō",
        "display": "horreō",
        "type": "bound_root",
        "language": "Latin",
        "meaning": "to bristle; shudder; stand aghast",
        "aliases": ["horreo"],
        "source": "builtin_classical_seed",
        "confidence": "medium",
    },
    {
        "key": "ludere",
        "display": "ludere",
        "type": "bound_root",
        "language": "Latin",
        "meaning": "to play",
        "aliases": ["lūdō", "ludo"],
        "source": "builtin_classical_seed",
        "confidence": "medium",
    },
    {
        "key": "negō",
        "display": "negō",
        "type": "bound_root",
        "language": "Latin",
        "meaning": "to deny; say no",
        "aliases": ["nego", "negare"],
        "source": "builtin_classical_seed",
        "confidence": "medium",
    },
    {
        "key": "prehendō",
        "display": "prehendō",
        "type": "bound_root",
        "language": "Latin",
        "meaning": "to grasp; seize; take",
        "aliases": ["prehendo", "prehendere"],
        "source": "builtin_classical_seed",
        "confidence": "medium",
    },
    {
        "key": "λόγος",
        "display": "λόγος",
        "type": "bound_root",
        "language": "Ancient Greek",
        "meaning": "word; speech; reason; reckoning",
        "aliases": ["logos", "lógos"],
        "source": "builtin_classical_seed",
        "confidence": "medium",
    },
]
INLINE_META_RE = re.compile(r"<([^:>]+):([^>]*)>")
INLINE_TAG_RE = re.compile(r"<[^>]+>")
PAREN_MEANING_RE = re.compile(r"\(([^()]+?)\)")
QUOTED_MEANING_RE = re.compile(r"[\"“”'‘’]([^\"“”'‘’]+)[\"“”'‘’]")
PROSE_PREFIX_MEANING_RE = re.compile(r"^prefix meaning\s+[\"“”'‘’]?(.+?)[\"“”'‘’]?$", re.IGNORECASE)
PROSE_LANGUAGE_PREFIX_RE = re.compile(
    r"^(?P<language>"
    r"Ancient Greek|Classical Latin|Ecclesiastical Latin|Late Latin|Medieval Latin|"
    r"Vulgar Latin|New Latin|Latin|Middle English|Old English|Middle French|"
    r"Old French|French|German|Greek|Proto-Indo-European|Proto-Germanic|"
    r"Proto-West Germanic"
    r")\s+(?P<term>.+)$",
    re.IGNORECASE,
)
PROSE_EXPRESSION_PATTERNS = [
    ("prose_surface_analysis", re.compile(
        r"\b(?:by surface analysis|surface form analy[sz]ed as)\s*,?\s*([^.;\n]+?\+[^.;\n]+)",
        re.IGNORECASE,
    )),
    ("prose_equivalent", re.compile(
        r"\b(?:equivalent to|analy[sz]able as|the English word is analysable as)\s+([^.;\n]+?\+[^.;\n]+)",
        re.IGNORECASE,
    )),
    ("prose_compound", re.compile(
        r"\bcompound of\s+([^.;\n]+?\+[^.;\n]+)",
        re.IGNORECASE,
    )),
    ("prose_from", re.compile(
        r"\b(?:formed from|from)\s+((?:(?!\s+from\s+|,\s+from\b|[.\n]).)+?\+[^.\n]+)",
        re.IGNORECASE,
    )),
]
PROSE_ALTERNATIVE_RE = re.compile(r"\s+\bor\b\s+", re.IGNORECASE)
LEADING_PROSE_FILLER_RE = re.compile(r"^(?:either|perhaps|probably|ultimately|directly)\s+", re.IGNORECASE)
TOKEN_EDGE_RE = re.compile(r"^[\s,;:()\[\]{}\"“”‘’]+|[\s,;:()\[\]{}\"“”‘’]+$")
PROSE_TOKEN_VARIANT_RE = re.compile(r"\s*(?:,|/|\bor\b)\s*", re.IGNORECASE)
TIER3_WORD_RE = re.compile(r"^[a-z][a-z-]*[a-z]$")
TIER3_DEFINITION_BLOCKLIST_RE = re.compile(
    r"^(?:"
    r"(?:a\s+)?surname\b|"
    r"(?:a\s+)?(?:male|female)?\s*given name\b|"
    r"(?:a\s+)?place name\b|"
    r"abbreviation of\b|"
    r"acronym of\b|"
    r"alternative (?:form|spelling) of\b|"
    r"archaic (?:form|spelling) of\b|"
    r"clipping of\b|"
    r"dated (?:form|spelling) of\b|"
    r"eye dialect (?:form|spelling) of\b|"
    r"initialism of\b|"
    r"misspelling of\b|"
    r"nonstandard (?:form|spelling) of\b|"
    r"obsolete (?:form|spelling) of\b|"
    r"plural of\b|"
    r"rare (?:form|spelling) of\b|"
    r"simple past\b|"
    r"third-person singular\b"
    r")",
    re.IGNORECASE,
)


def first_ipa(entry):
    return next(
        (sound.get("ipa") for sound in entry.get("sounds", []) if sound.get("ipa")),
        None,
    )


def has_audio_region_tag(sound, region):
    tags = sound.get("tags")
    if not isinstance(tags, list):
        return False

    wanted = EN_AUDIO_TAGS.get(region, set())
    return any(tag in wanted for tag in tags if isinstance(tag, str))


def first_audio_url(sound):
    for key in ("mp3_url", "ogg_url"):
        value = sound.get(key)
        if isinstance(value, str) and value.startswith("https://"):
            return value
    return None


def pronunciation_audio_urls(entry):
    audio = {"us": None, "uk": None}
    sounds = entry.get("sounds")
    if not isinstance(sounds, list):
        return audio

    for sound in sounds:
        if not isinstance(sound, dict):
            continue

        url = first_audio_url(sound)
        if not url:
            continue

        for region in audio:
            if not audio[region] and has_audio_region_tag(sound, region):
                audio[region] = url

        if audio["us"] and audio["uk"]:
            break

    return audio


def first_definition(entry):
    return next(
        (sense["glosses"][0] for sense in entry.get("senses", []) if sense.get("glosses")),
        None,
    )


def word_list(entry, key):
    return [
        item.get("word")
        for item in entry.get(key, [])
        if item.get("word")
    ][:20]


def open_dictionary_dump():
    if JSONL_PATH.exists():
        return JSONL_PATH.open(encoding="utf-8")
    if JSONL_GZ_PATH.exists():
        return gzip.open(JSONL_GZ_PATH, mode="rt", encoding="utf-8")
    raise SystemExit(f"Missing input JSONL: {JSONL_PATH} or {JSONL_GZ_PATH}")


def sqlite_table_columns(conn, table_name):
    return {
        row[1]
        for row in conn.execute(f"PRAGMA table_info({table_name})")
    }


def ensure_en_dictionary_audio_columns(conn):
    columns = sqlite_table_columns(conn, "en_dictionary")
    for column in ("audio_us", "audio_uk"):
        if column not in columns:
            conn.execute(f"ALTER TABLE en_dictionary ADD COLUMN {column} TEXT")


def strip_inline_tags(value):
    if not isinstance(value, str):
        return None

    cleaned = INLINE_TAG_RE.sub("", value).strip()
    return cleaned or None


def parse_inline_meta(raw_token):
    metadata = {}
    if not isinstance(raw_token, str):
        return metadata

    for key, value in INLINE_META_RE.findall(raw_token):
        cleaned_value = value.strip()
        if cleaned_value:
            metadata[key.strip()] = cleaned_value
    return metadata


def extract_part_meaning(args, part_ordinal, inline_meta):
    ordinal = part_ordinal + 1
    for key in (f"t{ordinal}", f"gloss{ordinal}", f"meaning{ordinal}"):
        meaning = strip_inline_tags(args.get(key))
        if meaning:
            return meaning

    inline_meaning = inline_meta.get("t") or inline_meta.get("gloss") or inline_meta.get("meaning")
    return inline_meaning.strip() if isinstance(inline_meaning, str) and inline_meaning.strip() else None


def extract_part_note(args, part_ordinal):
    ordinal = part_ordinal + 1
    return strip_inline_tags(args.get(f"pos{ordinal}"))


def assign_part_type(token, part_index, total_parts, template_name):
    if template_name in {"compound", "com"}:
        return "compound_component"
    if template_name == "blend":
        return "blend_component"
    if template_name == "confix":
        return "combining_form"

    if token.endswith("-"):
        return "prefix"
    if token.startswith("-"):
        return "suffix"

    if template_name in {"prefix", "pre"} and part_index == 0:
        return "prefix"
    if template_name in {"suffix", "suf"} and part_index == total_parts - 1:
        return "suffix"

    return "base"


def normalize_affix_text(value, part_type):
    if not value:
        return value
    if part_type == "prefix" and not value.endswith("-"):
        return f"{value}-"
    if part_type == "suffix" and not value.startswith("-"):
        return f"-{value}"
    return value


def normalize_language_name(value):
    cleaned = strip_inline_tags(value)
    if not cleaned:
        return ""

    normalized = re.sub(r"\s+", " ", cleaned).strip().casefold()
    if "latin" in normalized:
        return "Latin"
    if "greek" in normalized:
        return "Ancient Greek" if "ancient" in normalized else "Greek"
    return cleaned.strip()


def clean_gloss_meaning(value, max_length=180):
    cleaned = strip_inline_tags(value)
    if not cleaned:
        return None

    cleaned = re.sub(r"\s+", " ", cleaned).strip(" .;")
    if not cleaned:
        return None
    if len(cleaned) <= max_length:
        return cleaned

    truncated = cleaned[:max_length - 3].rsplit(" ", 1)[0].strip(" ,;")
    return f"{truncated}..." if truncated else cleaned[:max_length - 3] + "..."


def strip_diacritics(value):
    return "".join(
        char
        for char in unicodedata.normalize("NFKD", value)
        if not unicodedata.combining(char)
    )


def normalize_morpheme_key(value, part_type=None):
    cleaned = strip_inline_tags(value)
    if not cleaned:
        return None

    cleaned = cleaned.replace("−", "-").strip().strip("*")
    cleaned = TOKEN_EDGE_RE.sub("", cleaned)
    if not cleaned:
        return None

    if part_type in {"prefix", "suffix"}:
        cleaned = normalize_affix_text(cleaned, part_type)

    cleaned = unicodedata.normalize("NFKC", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip().casefold()
    return cleaned or None


def morpheme_key_candidates(value, part_type=None):
    key = normalize_morpheme_key(value, part_type)
    if not key:
        return []

    candidates = [key]
    folded = strip_diacritics(key)
    if folded and folded != key:
        candidates.append(folded)
    return candidates


def normalize_gloss_part_type(part_type):
    normalized = (part_type or "").strip().lower()
    if normalized in MORPHEME_GLOSS_TYPES:
        return normalized
    return None


def source_pos_to_gloss_part_type(pos):
    normalized = (pos or "").strip().lower()
    if normalized == "prefix":
        return "prefix"
    if normalized == "suffix":
        return "suffix"
    if normalized == "combining_form":
        return "combining_form"
    if normalized in SOURCE_GLOSS_POS:
        return "bound_root"
    return None


def morpheme_gloss_lookup_types(part_type):
    normalized = normalize_gloss_part_type(part_type)
    if normalized in {"prefix", "suffix", "combining_form"}:
        return [normalized]
    if normalized == "bound_root":
        return ["bound_root", "base"]
    if normalized == "base":
        return ["base", "bound_root"]
    return []


def create_morpheme_gloss_schema(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS en_morpheme_glosses (
            lookup_key TEXT NOT NULL,
            part_type TEXT NOT NULL,
            language TEXT NOT NULL DEFAULT '',
            display TEXT,
            meaning TEXT NOT NULL,
            source TEXT NOT NULL,
            source_word TEXT,
            source_pos TEXT,
            confidence TEXT NOT NULL CHECK(confidence IN ('high', 'medium', 'low')),
            source_priority INTEGER NOT NULL DEFAULT 0,
            parser_version INTEGER NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (lookup_key, part_type, language)
        )
    """)
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_en_morpheme_glosses_lookup "
        "ON en_morpheme_glosses(lookup_key, part_type)"
    )


def upsert_morpheme_gloss(
    conn,
    key,
    part_type,
    meaning,
    *,
    display=None,
    language=None,
    source,
    source_word=None,
    source_pos=None,
    confidence="medium",
):
    normalized_type = normalize_gloss_part_type(part_type)
    cleaned_meaning = clean_gloss_meaning(meaning)
    if not normalized_type or not cleaned_meaning:
        return 0

    language_name = normalize_language_name(language)
    source_priority = MORPHEME_GLOSS_SOURCE_PRIORITIES.get(source, 0)
    display_text = normalize_affix_text(display or key, normalized_type)
    source_word_text = normalize_affix_text(source_word or key, normalized_type)
    changed = 0

    for lookup_key in morpheme_key_candidates(key, normalized_type):
        before_changes = conn.total_changes
        conn.execute(
            """
            INSERT INTO en_morpheme_glosses
            (lookup_key, part_type, language, display, meaning, source, source_word,
             source_pos, confidence, source_priority, parser_version)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(lookup_key, part_type, language) DO UPDATE SET
                display = excluded.display,
                meaning = excluded.meaning,
                source = excluded.source,
                source_word = excluded.source_word,
                source_pos = excluded.source_pos,
                confidence = excluded.confidence,
                source_priority = excluded.source_priority,
                parser_version = excluded.parser_version
            WHERE excluded.source_priority >= en_morpheme_glosses.source_priority
            """,
            (
                lookup_key,
                normalized_type,
                language_name,
                display_text,
                cleaned_meaning,
                source,
                source_word_text,
                source_pos,
                confidence,
                source_priority,
                MORPHEME_GLOSS_VERSION,
            ),
        )
        if conn.total_changes > before_changes:
            changed += 1

    return changed


def populate_seed_morpheme_glosses(conn):
    changed = 0
    for item in CANONICAL_MORPHEME_GLOSSES:
        changed += upsert_morpheme_gloss(
            conn,
            item["key"],
            item["type"],
            item["meaning"],
            display=item.get("display"),
            language=item.get("language"),
            source=item.get("source", "builtin_classical_seed"),
            source_word=item.get("key"),
            confidence=item.get("confidence", "medium"),
        )
        for alias in item.get("aliases") or []:
            changed += upsert_morpheme_gloss(
                conn,
                alias,
                item["type"],
                item["meaning"],
                display=item.get("display") or item["key"],
                language=item.get("language"),
                source=item.get("source", "builtin_classical_seed"),
                source_word=item.get("key"),
                confidence=item.get("confidence", "medium"),
            )

    return changed


def populate_english_affix_morpheme_glosses(conn):
    changed = 0
    rows = conn.execute(
        """
        SELECT word, pos, definition
        FROM en_dictionary
        WHERE pos IN ('prefix', 'suffix')
          AND word IS NOT NULL
          AND definition IS NOT NULL
        """
    )
    for word, pos, definition in rows:
        changed += upsert_morpheme_gloss(
            conn,
            word,
            pos,
            definition,
            display=word,
            language="English",
            source="english_affix_entry",
            source_word=word,
            source_pos=pos,
            confidence="high",
        )
    return changed


def populate_english_base_morpheme_glosses(conn, needed_keys):
    needed_base_keys = {
        lookup_key
        for lookup_key, part_type in needed_keys
        if part_type == "base"
    }
    if not needed_base_keys:
        return 0

    changed = 0
    rows = conn.execute(
        """
        SELECT word, pos, definition
        FROM en_dictionary
        WHERE pos IN ('noun', 'verb', 'adj', 'adv')
          AND word IS NOT NULL
          AND definition IS NOT NULL
        """
    )
    for word, pos, definition in rows:
        if normalize_morpheme_key(word, "base") not in needed_base_keys:
            continue

        changed += upsert_morpheme_gloss(
            conn,
            word,
            "base",
            definition,
            display=word,
            language="English",
            source="english_base_entry",
            source_word=word,
            source_pos=pos,
            confidence="high",
        )

    return changed


def populate_existing_word_part_morpheme_glosses(conn):
    changed = 0
    rows = conn.execute(
        "SELECT word, parts_json FROM en_word_parts WHERE confidence IN ('high', 'medium')"
    )
    for word, parts_json in rows:
        try:
            word_parts = json.loads(parts_json)
        except (TypeError, json.JSONDecodeError):
            continue

        for part in word_parts.get("parts") or []:
            part_type = normalize_gloss_part_type(part.get("type"))
            if part_type not in {"bound_root", "combining_form"}:
                continue

            key = part.get("text") or part.get("display")
            meaning = part.get("meaning")
            if not key or not meaning:
                continue

            changed += upsert_morpheme_gloss(
                conn,
                key,
                part_type,
                meaning,
                display=part.get("display") or key,
                language=part.get("note"),
                source="parsed_word_parts",
                source_word=word,
                source_pos=part_type,
                confidence="medium",
            )
    return changed


def collect_missing_morpheme_gloss_keys(conn):
    needed = set()
    rows = conn.execute("SELECT parts_json FROM en_word_parts")
    for (parts_json,) in rows:
        try:
            word_parts = json.loads(parts_json)
        except (TypeError, json.JSONDecodeError):
            continue

        for part in word_parts.get("parts") or []:
            if clean_gloss_meaning(part.get("meaning")):
                continue

            for lookup_type in morpheme_gloss_lookup_types(part.get("type")):
                for value in (part.get("text"), part.get("display")):
                    for lookup_key in morpheme_key_candidates(value, lookup_type):
                        needed.add((lookup_key, lookup_type))

    return needed


def open_jsonl_file(path):
    if path.suffix == ".gz":
        return gzip.open(path, mode="rt", encoding="utf-8")
    return path.open(encoding="utf-8")


def first_existing_path(paths):
    return next((path for path in paths if path.exists()), None)


def populate_source_dump_morpheme_glosses(conn, needed_keys):
    changed = 0
    for dump in SOURCE_GLOSS_DUMPS:
        path = first_existing_path(dump["paths"])
        if not path:
            print(f"Skipping {dump['language']} morpheme gloss dump; no local JSONL file found")
            continue

        scanned = 0
        matched = 0
        with open_jsonl_file(path) as handle:
            for line in handle:
                scanned += 1
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue

                word = entry.get("word")
                pos = entry.get("pos")
                part_type = source_pos_to_gloss_part_type(pos)
                meaning = first_definition(entry)
                if not word or not part_type or not meaning:
                    continue

                if not any(
                    (lookup_key, part_type) in needed_keys
                    for lookup_key in morpheme_key_candidates(word, part_type)
                ):
                    continue

                if not looks_like_source_component(word):
                    continue

                changed += upsert_morpheme_gloss(
                    conn,
                    word,
                    part_type,
                    meaning,
                    display=word,
                    language=dump["language"],
                    source=dump["source"],
                    source_word=word,
                    source_pos=pos,
                    confidence="high",
                )
                matched += 1

                if matched and matched % BATCH_SIZE == 0:
                    conn.commit()
                    print(
                        f"Imported {matched:,} {dump['language']} morpheme glosses "
                        f"after scanning {scanned:,} source rows"
                    )

        conn.commit()
        print(
            f"Imported {matched:,} {dump['language']} morpheme glosses "
            f"after scanning {scanned:,} source rows"
        )

    return changed


def populate_morpheme_glosses(conn):
    create_morpheme_gloss_schema(conn)
    seed_changed = populate_seed_morpheme_glosses(conn)
    affix_changed = populate_english_affix_morpheme_glosses(conn)
    parsed_changed = populate_existing_word_part_morpheme_glosses(conn)
    conn.commit()

    needed_keys = collect_missing_morpheme_gloss_keys(conn)
    base_changed = populate_english_base_morpheme_glosses(conn, needed_keys)
    conn.commit()
    source_changed = populate_source_dump_morpheme_glosses(conn, needed_keys)
    conn.commit()
    total_changed = seed_changed + affix_changed + parsed_changed + base_changed + source_changed
    print(
        f"Morpheme gloss lookup ready. Upserted {total_changed:,} rows "
        f"({seed_changed:,} seed, {affix_changed:,} English affix, "
        f"{base_changed:,} English base, {parsed_changed:,} parsed roots, "
        f"{source_changed:,} source-dump)."
    )
    return total_changed


def load_morpheme_gloss_lookup(conn):
    lookup = {}
    rows = conn.execute(
        """
        SELECT lookup_key, part_type, language, display, meaning, source,
               confidence, source_priority
        FROM en_morpheme_glosses
        ORDER BY source_priority DESC
        """
    )
    for lookup_key, part_type, language, display, meaning, source, confidence, source_priority in rows:
        lookup.setdefault((lookup_key, part_type), []).append({
            "language": language or "",
            "display": display,
            "meaning": meaning,
            "source": source,
            "confidence": confidence,
            "source_priority": source_priority or 0,
        })
    return lookup


def select_best_morpheme_gloss(rows, part_language):
    if not rows:
        return None

    normalized_part_language = normalize_language_name(part_language)

    def row_score(row):
        row_language = normalize_language_name(row.get("language"))
        if normalized_part_language and row_language == normalized_part_language:
            language_score = 3
        elif normalized_part_language and not row_language:
            language_score = 2
        elif not normalized_part_language:
            language_score = 1
        else:
            language_score = 0

        return (
            language_score,
            row.get("source_priority") or 0,
            MORPHEME_GLOSS_CONFIDENCE_RANK.get(row.get("confidence"), 0),
        )

    return sorted(rows, key=row_score, reverse=True)[0]


def find_morpheme_gloss_for_part(part, lookup):
    rows = []
    for lookup_type in morpheme_gloss_lookup_types(part.get("type")):
        for value in (part.get("text"), part.get("display"), part.get("canonical")):
            for lookup_key in morpheme_key_candidates(value, lookup_type):
                rows.extend(lookup.get((lookup_key, lookup_type), []))

    return select_best_morpheme_gloss(rows, part.get("note"))


def enrich_word_parts_with_morpheme_glosses(conn):
    lookup = load_morpheme_gloss_lookup(conn)
    updated = 0
    scanned = 0
    rows = conn.execute("SELECT word, parts_json FROM en_word_parts")
    for word, parts_json in rows:
        scanned += 1
        try:
            word_parts = json.loads(parts_json)
        except (TypeError, json.JSONDecodeError):
            continue

        parts = word_parts.get("parts")
        if not isinstance(parts, list):
            continue

        changed = False
        for part in parts:
            if not isinstance(part, dict) or clean_gloss_meaning(part.get("meaning")):
                continue

            gloss = find_morpheme_gloss_for_part(part, lookup)
            if not gloss:
                continue

            part["meaning"] = gloss["meaning"]
            part["meaning_source"] = gloss["source"]
            part["meaning_confidence"] = gloss["confidence"]
            if gloss.get("language") and not part.get("note"):
                part["note"] = gloss["language"]

            canonical_display = gloss.get("display")
            if (
                canonical_display
                and canonical_display != part.get("display")
                and canonical_display != part.get("text")
                and not part.get("canonical")
            ):
                part["canonical"] = canonical_display
            changed = True

        if not changed:
            continue

        meta = word_parts.get("meta")
        if not isinstance(meta, dict):
            meta = {}
            word_parts["meta"] = meta
        meta["gloss_enrichment_version"] = MORPHEME_GLOSS_VERSION

        conn.execute(
            "UPDATE en_word_parts SET parts_json = ? WHERE word = ?",
            (json.dumps(word_parts, ensure_ascii=False), word),
        )
        updated += 1

        if scanned % BATCH_SIZE == 0:
            conn.commit()
            print(f"Gloss enrichment scanned {scanned:,} word-part rows; updated {updated:,}")

    conn.commit()
    print(f"Gloss enrichment complete. Scanned {scanned:,} word-part rows; updated {updated:,}")
    return updated


def populate_pronunciation_audio(conn):
    ensure_en_dictionary_audio_columns(conn)
    scanned = 0
    updated = 0

    with open_dictionary_dump() as handle:
        for line in handle:
            scanned += 1
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue

            if entry.get("lang_code") != "en":
                continue

            word = entry.get("word", "").strip().lower()
            if not word:
                continue

            audio = pronunciation_audio_urls(entry)
            if not audio["us"] and not audio["uk"]:
                continue

            before_changes = conn.total_changes
            conn.execute(
                """
                UPDATE en_dictionary
                SET audio_us = COALESCE(NULLIF(audio_us, ''), ?),
                    audio_uk = COALESCE(NULLIF(audio_uk, ''), ?)
                WHERE word = ?
                """,
                (audio["us"], audio["uk"], word),
            )
            if conn.total_changes > before_changes:
                updated += 1

            if scanned % BATCH_SIZE == 0:
                conn.commit()
                print(f"Audio scanned {scanned:,} dump rows; updated {updated:,} dictionary rows")

    conn.commit()
    print(f"Audio complete. Scanned {scanned:,} dump rows; updated {updated:,} dictionary rows")
    return updated


def parse_kaikki_meta_token(raw_token, args, part_ordinal, part_type):
    if not isinstance(raw_token, str) or not raw_token.strip():
        return None

    inline_meta = parse_inline_meta(raw_token)
    canonical_text = strip_inline_tags(raw_token)
    if not canonical_text:
        return None

    display = inline_meta.get("alt") or canonical_text
    note = extract_part_note(args, part_ordinal)
    if part_type == "combining_form" and note:
        normalized_note = note.lower()
        if "prefix" in normalized_note and not display.endswith("-"):
            display = f"{display}-"
        elif "suffix" in normalized_note and not display.startswith("-"):
            display = f"-{display}"

    part = {
        "text": normalize_affix_text(canonical_text, part_type),
        "display": normalize_affix_text(display, part_type),
        "type": part_type,
    }

    meaning = extract_part_meaning(args, part_ordinal, inline_meta)
    if meaning:
        part["meaning"] = meaning
    if note:
        part["note"] = note
    if raw_token.strip() != canonical_text:
        part["raw_text"] = raw_token.strip()

    return part


def parse_etymology_template(template_node):
    name = (template_node.get("name") or "").strip().lower()
    if name not in WORD_PART_TEMPLATE_PRIORITY:
        return None

    args = template_node.get("args") if isinstance(template_node.get("args"), dict) else {}
    part_keys = sorted(
        int(key)
        for key in args.keys()
        if isinstance(key, str) and key.isdigit() and int(key) > 1
    )
    raw_parts = [
        args.get(str(key))
        for key in part_keys
        if isinstance(args.get(str(key)), str) and args.get(str(key)).strip()
    ]
    if not raw_parts:
        return None

    parts = []
    total_parts = len(raw_parts)
    for part_index, raw_token in enumerate(raw_parts):
        cleaned_token = strip_inline_tags(raw_token) or ""
        part_type = assign_part_type(cleaned_token, part_index, total_parts, name)
        part = parse_kaikki_meta_token(raw_token, args, part_index, part_type)
        if part:
            parts.append(part)

    if not parts:
        return None

    source_text = template_node.get("expansion") or ""
    return {
        "parts": parts,
        "confidence": "high",
        "source": f"kaikki_template_{name}",
        "source_text": source_text,
        "meta": {
            "source_template": name,
            "parser_version": WORD_PARTS_PARSER_VERSION,
        },
    }


def parse_word_parts(entry):
    templates = entry.get("etymology_templates")
    if not isinstance(templates, list):
        return None

    for template_name in WORD_PART_TEMPLATE_PRIORITY:
        for template_node in templates:
            if not isinstance(template_node, dict):
                continue
            if (template_node.get("name") or "").strip().lower() != template_name:
                continue

            parsed = parse_etymology_template(template_node)
            if parsed:
                return parsed

    return None


def clean_prose_expression(value):
    if not isinstance(value, str):
        return ""

    expression = value.strip()
    expression = LEADING_PROSE_FILLER_RE.sub("", expression).strip()
    # Keep the first coordinated analysis before explanatory spillover.
    expression = re.split(
        r",\s+(?:either|alternatively|perhaps|probably)\s+from\b|"
        r",\s+from\b|"
        r"\s+\((?:ultimately\s+)?from\b|"
        r"\s+(?:compare|cognate|piecewise doublet|see also)\b",
        expression,
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0]
    return expression.strip(" .,;")


def split_prose_expression(expression):
    for alternative in PROSE_ALTERNATIVE_RE.split(expression):
        parts = [part.strip() for part in alternative.split("+")]
        parts = [part for part in parts if part and part != "-"]
        if len(parts) >= 2:
            yield parts


def strip_wrapping_quotes(value):
    if not isinstance(value, str):
        return None

    stripped = value.strip().strip("\"“”'‘’")
    return stripped or None


def looks_like_source_component(value):
    if not isinstance(value, str):
        return False

    stripped = value.strip()
    if len(stripped) < 2 or "#" in stripped:
        return False
    if not any(char.isalpha() for char in stripped):
        return False
    return all(char.isalpha() or char in "-*" for char in stripped)


def parse_prose_annotation(annotation, token_text):
    if not isinstance(annotation, str):
        return None, None

    cleaned = annotation.strip()
    if not cleaned:
        return None, None

    prefix_meaning_match = PROSE_PREFIX_MEANING_RE.match(cleaned)
    if prefix_meaning_match:
        return strip_wrapping_quotes(prefix_meaning_match.group(1)), None

    quoted_match = QUOTED_MEANING_RE.search(cleaned)
    if quoted_match:
        leading = cleaned[:quoted_match.start()].strip(" ,;")
        alt_text = leading if looks_like_source_component(leading) else None
        return strip_wrapping_quotes(quoted_match.group(1)), alt_text

    if any(ord(char) > 127 for char in token_text) and looks_like_source_component(cleaned):
        return None, cleaned

    return strip_wrapping_quotes(cleaned), None


def split_prose_token_annotation(original):
    open_index = original.find("(")
    close_index = original.rfind(")")
    if open_index == -1 or close_index <= open_index:
        return original, None, None

    token_text = f"{original[:open_index]} {original[close_index + 1:]}".strip()
    annotation = original[open_index + 1:close_index].strip()
    token_before_annotation = original[:open_index].strip()
    return token_text, annotation, token_before_annotation


def clean_prose_token(raw_token):
    if not isinstance(raw_token, str):
        return None

    original = raw_token.strip()
    if not original:
        return None

    meaning = None
    alt_text = None
    token_without_annotation, annotation, token_before_annotation = split_prose_token_annotation(original)
    if annotation:
        meaning, alt_text = parse_prose_annotation(
            annotation,
            token_before_annotation,
        )

    token = token_without_annotation
    token = strip_inline_tags(token) or ""
    token = TOKEN_EDGE_RE.sub("", token)
    token = LEADING_PROSE_FILLER_RE.sub("", token).strip()
    language_note = None

    language_match = PROSE_LANGUAGE_PREFIX_RE.match(token)
    if language_match:
        language_note = language_match.group("language")
        token = language_match.group("term").strip()

    token = TOKEN_EDGE_RE.sub("", token)
    if not token:
        return None

    return {
        "text": token,
        "alt_text": alt_text,
        "meaning": meaning or None,
        "note": language_note,
        "raw_text": original if original != token else None,
    }


def prose_token_candidates(token):
    candidates = []
    for value in (token.get("text"), token.get("alt_text")):
        if not isinstance(value, str) or not value.strip():
            continue
        for candidate in PROSE_TOKEN_VARIANT_RE.split(value):
            candidate = TOKEN_EDGE_RE.sub("", candidate.strip())
            if candidate and candidate not in candidates:
                candidates.append(candidate)
    return candidates


def classify_prose_token(token, word_set, prefix_set, suffix_set, allow_source_components):
    candidates = prose_token_candidates(token)
    if not candidates:
        return None, "", False

    for candidate in candidates:
        normalized = candidate.lower()
        prefix_form = normalized if normalized.endswith("-") else f"{normalized}-"
        suffix_form = normalized if normalized.startswith("-") else f"-{normalized}"

        if normalized.startswith("-") and suffix_form in suffix_set:
            return "suffix", suffix_form, True
        if normalized.endswith("-") and prefix_form in prefix_set:
            return "prefix", prefix_form, True
        if prefix_form in prefix_set:
            return "prefix", prefix_form, True
        if normalized in word_set:
            return "base", normalized, True

    if allow_source_components:
        # Historical etymology often writes source roots as condō, battere, prehendō,
        # or Greek terms with a transliteration. The expression is accepted only if
        # another part validates as a real affix, so these remain source-bound roots.
        for candidate in candidates:
            if looks_like_source_component(candidate):
                return "bound_root", candidate, False

    return None, candidates[0].lower(), False


def build_prose_word_part(token, part_type, normalized_text):
    display = normalized_text
    if part_type == "bound_root":
        display = token["text"]

    part = {
        "text": normalized_text,
        "display": display,
        "type": part_type,
    }
    if token.get("meaning"):
        part["meaning"] = token["meaning"]
    if token.get("note"):
        part["note"] = token["note"]
    if token.get("raw_text"):
        part["raw_text"] = token["raw_text"]
    return part


def parse_prose_parts_from_expression(
    expression,
    source,
    word_set,
    prefix_set,
    suffix_set,
):
    cleaned_expression = clean_prose_expression(expression)
    if not cleaned_expression:
        return None

    allow_source_components = source == "prose_from"
    for raw_parts in split_prose_expression(cleaned_expression):
        if len(raw_parts) > 5:
            continue

        parsed_tokens = [clean_prose_token(part) for part in raw_parts]
        if any(token is None for token in parsed_tokens):
            continue

        parts = []
        validated_count = 0
        invalid_count = 0
        non_affix_count = 0

        for token in parsed_tokens:
            part_type, normalized_text, is_validated = classify_prose_token(
                token,
                word_set,
                prefix_set,
                suffix_set,
                allow_source_components,
            )
            if not part_type:
                invalid_count += 1
                break

            if is_validated:
                validated_count += 1
            if part_type not in {"prefix", "suffix"}:
                non_affix_count += 1

            parts.append(build_prose_word_part(token, part_type, normalized_text))

        if invalid_count > 0 or len(parts) < 2 or non_affix_count == 0:
            continue

        all_parts_validated = validated_count == len(parts)
        has_validated_affix = any(part["type"] in {"prefix", "suffix"} for part in parts)
        if not all_parts_validated and not (allow_source_components and has_validated_affix):
            continue

        return {
            "parts": parts,
            "confidence": "medium",
            "source": source,
            "source_text": cleaned_expression,
            "meta": {
                "parser_version": WORD_PARTS_PARSER_VERSION,
            },
        }

    return None


def parse_prose_word_parts(
    etymology_text,
    word_set,
    prefix_set,
    suffix_set,
):
    if not isinstance(etymology_text, str) or "+" not in etymology_text:
        return None

    for source, pattern in PROSE_EXPRESSION_PATTERNS:
        for match in pattern.finditer(etymology_text):
            parsed = parse_prose_parts_from_expression(
                match.group(1),
                source,
                word_set,
                prefix_set,
                suffix_set,
            )
            if parsed:
                return parsed

    return None


def load_word_part_validation_sets(conn):
    word_set = {
        row[0]
        for row in conn.execute("SELECT word FROM en_dictionary WHERE word IS NOT NULL")
        if row[0]
    }
    prefix_set = {
        row[0]
        for row in conn.execute("SELECT word FROM en_dictionary WHERE pos = 'prefix' AND word IS NOT NULL")
        if row[0]
    }
    suffix_set = {
        row[0]
        for row in conn.execute("SELECT word FROM en_dictionary WHERE pos = 'suffix' AND word IS NOT NULL")
        if row[0]
    }
    return word_set, prefix_set, suffix_set


def count_word_parts(parts_json):
    try:
        parsed = json.loads(parts_json) if isinstance(parts_json, str) else parts_json
    except (TypeError, json.JSONDecodeError):
        return 0

    parts = parsed.get("parts") if isinstance(parsed, dict) else None
    return len(parts) if isinstance(parts, list) else 0


def is_incomplete_tier1_word_parts(confidence, source, parts_json):
    return (
        confidence == "high"
        and isinstance(source, str)
        and source.startswith("kaikki_template_")
        and count_word_parts(parts_json) < 2
    )


def is_refreshable_tier2_word_parts(confidence, source):
    return (
        confidence == "medium"
        and isinstance(source, str)
        and source.startswith("prose_")
    )


def is_lower_confidence_word_parts(confidence):
    return confidence == "low"


def insert_word_parts(conn, word, word_parts, replace_existing=False):
    parts_json = json.dumps(word_parts, ensure_ascii=False)
    values = (
        word,
        parts_json,
        word_parts["confidence"],
        word_parts["source"],
        word_parts.get("source_text"),
        WORD_PARTS_PARSER_VERSION,
    )
    before_changes = conn.total_changes
    if replace_existing:
        conn.execute(
            """
            UPDATE en_word_parts
            SET parts_json = ?,
                confidence = ?,
                source = ?,
                source_text = ?,
                parser_version = ?
            WHERE word = ?
            """,
            (
                parts_json,
                word_parts["confidence"],
                word_parts["source"],
                word_parts.get("source_text"),
                WORD_PARTS_PARSER_VERSION,
                word,
            ),
        )
        if conn.total_changes > before_changes:
            return True

    conn.execute(
        """
        INSERT OR IGNORE INTO en_word_parts
        (word, parts_json, confidence, source, source_text, parser_version)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        values,
    )
    return conn.total_changes > before_changes


def populate_tier2_word_parts(conn):
    word_set, prefix_set, suffix_set = load_word_part_validation_sets(conn)
    inserted = 0
    replaced = 0
    scanned = 0

    rows = conn.execute(
        """
        SELECT d.word, d.etymology, wp.confidence, wp.source, wp.parts_json
        FROM en_dictionary d
        LEFT JOIN en_word_parts wp ON wp.word = d.word
        WHERE d.etymology IS NOT NULL
          AND d.etymology LIKE '%+%'
          AND (
            wp.word IS NULL
            OR wp.confidence = 'high'
            OR wp.confidence = 'medium'
            OR wp.confidence = 'low'
          )
        """
    )
    for word, etymology, existing_confidence, existing_source, existing_parts_json in rows:
        replace_existing = is_incomplete_tier1_word_parts(
            existing_confidence,
            existing_source,
            existing_parts_json,
        ) or is_refreshable_tier2_word_parts(
            existing_confidence,
            existing_source,
        ) or is_lower_confidence_word_parts(existing_confidence)
        if existing_confidence and not replace_existing:
            continue

        scanned += 1
        word_parts = parse_prose_word_parts(etymology, word_set, prefix_set, suffix_set)
        if word_parts and insert_word_parts(conn, word, word_parts, replace_existing=replace_existing):
            if replace_existing:
                replaced += 1
            else:
                inserted += 1

        if scanned % BATCH_SIZE == 0:
            conn.commit()
            print(
                f"Tier 2 scanned {scanned:,} candidate rows; inserted {inserted:,} "
                f"and replaced {replaced:,} medium-confidence rows"
            )

    conn.commit()
    print(
        f"Tier 2 complete. Scanned {scanned:,} candidate rows; inserted {inserted:,} "
        f"and replaced {replaced:,} medium-confidence rows"
    )
    return inserted + replaced


def normalize_prefix_core(prefix):
    if not isinstance(prefix, str) or not prefix.endswith("-"):
        return None
    core = prefix[:-1].strip().lower()
    return core if len(core) >= AFFIX_STRIP_MIN_PREFIX_LEN and core.isalpha() else None


def normalize_suffix_core(suffix):
    if not isinstance(suffix, str) or not suffix.startswith("-"):
        return None
    core = suffix[1:].strip().lower()
    if not core.isalpha():
        return None
    return core if len(core) >= AFFIX_STRIP_MIN_SUFFIX_LEN else None


def is_tier3_record_allowed(pos, definition, allowed_pos, allow_named_entity=False):
    if not isinstance(definition, str) or not definition.strip():
        return False
    clean_definition = definition.strip()
    if TIER3_DEFINITION_BLOCKLIST_RE.search(clean_definition):
        return False
    if pos in allowed_pos:
        return True
    return allow_named_entity and pos == "name" and clean_definition.startswith("The ")


def load_verified_affix_counts(conn):
    prefix_counts = {}
    suffix_counts = {}
    rows = conn.execute(
        "SELECT parts_json FROM en_word_parts WHERE confidence IN ('high', 'medium')"
    )
    for (parts_json,) in rows:
        try:
            word_parts = json.loads(parts_json)
        except (TypeError, json.JSONDecodeError):
            continue

        for part in word_parts.get("parts") or []:
            text = (part.get("text") or "").strip().lower()
            part_type = part.get("type")
            if part_type == "prefix" and text.endswith("-"):
                core = text[:-1]
                prefix_counts[core] = prefix_counts.get(core, 0) + 1
            elif part_type == "suffix" and text.startswith("-"):
                core = text[1:]
                suffix_counts[core] = suffix_counts.get(core, 0) + 1

    return prefix_counts, suffix_counts


def tier3_prefix_allowed(core, evidence_count):
    if core in TIER3_SHORT_PREFIX_ALLOWLIST:
        return evidence_count >= TIER3_MIN_PREFIX_EVIDENCE
    if len(core) == 3:
        return core in TIER3_THREE_LETTER_PREFIX_ALLOWLIST and evidence_count >= TIER3_MIN_PREFIX_EVIDENCE
    return len(core) >= 4 and evidence_count >= TIER3_MIN_PREFIX_EVIDENCE


def tier3_suffix_allowed(core, evidence_count):
    if core in TIER3_SUFFIX_BLOCKLIST:
        return False
    return core in TIER3_SUFFIX_ALLOWLIST and evidence_count >= TIER3_MIN_SUFFIX_EVIDENCE


def load_affix_strip_sets(conn):
    word_records = {}
    for word, pos, definition in conn.execute(
        "SELECT word, pos, definition FROM en_dictionary WHERE word IS NOT NULL"
    ):
        if isinstance(word, str) and TIER3_WORD_RE.match(word):
            word_records[word] = {
                "pos": pos,
                "definition": definition,
            }

    base_word_set = {
        word
        for word, record in word_records.items()
        if is_tier3_record_allowed(
            record.get("pos"),
            record.get("definition"),
            TIER3_BASE_POS,
            allow_named_entity=True,
        )
    }
    dictionary_prefix_cores = {
        core
        for row in conn.execute("SELECT word FROM en_dictionary WHERE pos = 'prefix' AND word IS NOT NULL")
        for core in [normalize_prefix_core(row[0])]
        if core
    }
    dictionary_suffix_cores = {
        core
        for row in conn.execute("SELECT word FROM en_dictionary WHERE pos = 'suffix' AND word IS NOT NULL")
        for core in [normalize_suffix_core(row[0])]
        if core
    }
    prefix_counts, suffix_counts = load_verified_affix_counts(conn)
    prefix_cores = {
        core
        for core in dictionary_prefix_cores
        if tier3_prefix_allowed(core, prefix_counts.get(core, 0))
    }
    suffix_cores = {
        core
        for core in dictionary_suffix_cores
        if tier3_suffix_allowed(core, suffix_counts.get(core, 0))
    }
    prefix_lengths = sorted({len(core) for core in prefix_cores}, reverse=True)
    suffix_lengths = sorted({len(core) for core in suffix_cores}, reverse=True)
    return word_records, base_word_set, prefix_cores, suffix_cores, prefix_lengths, suffix_lengths


def best_prefix_strip(word, base_word_set, prefix_cores, prefix_lengths):
    for length in prefix_lengths:
        if len(word) < length + AFFIX_STRIP_MIN_PREFIX_BASE_LEN:
            continue

        core = word[:length]
        if core not in prefix_cores:
            continue

        base = word[length:]
        if len(base) >= AFFIX_STRIP_MIN_PREFIX_BASE_LEN and base in base_word_set:
            return {
                "parts": [
                    {"text": f"{core}-", "display": f"{core}-", "type": "prefix"},
                    {"text": base, "display": base, "type": "base"},
                ],
                "affix_length": length,
                "source_text": f"{core}- + {base}",
            }

    return None


def resolve_suffix_base(base, suffix_core, base_word_set):
    candidates = []
    if base.endswith("i"):
        candidates.append((f"{base[:-1]}y", AFFIX_STRIP_MIN_SUFFIX_BASE_LEN))
    if len(base) > 1 and base[-1] == base[-2]:
        candidates.append((base[:-1], AFFIX_STRIP_MIN_PREFIX_BASE_LEN))
    if suffix_core[:1] in {"a", "e", "i", "o", "u"}:
        restored_base = f"{base}e"
        min_len = (
            AFFIX_STRIP_MIN_PREFIX_BASE_LEN
            if suffix_core in {"able", "ible"} and restored_base in TIER3_SHORT_E_RESTORED_BASE_ALLOWLIST
            else AFFIX_STRIP_MIN_SUFFIX_BASE_LEN
        )
        candidates.append((restored_base, min_len))
    candidates.append((base, AFFIX_STRIP_MIN_SUFFIX_BASE_LEN))

    for candidate, min_len in candidates:
        if len(candidate) >= min_len and candidate in base_word_set:
            return candidate
    return None


def best_suffix_strip(word, base_word_set, suffix_cores, suffix_lengths):
    for length in suffix_lengths:
        if len(word) < length + AFFIX_STRIP_MIN_PREFIX_BASE_LEN - 1:
            continue

        core = word[-length:]
        if core not in suffix_cores:
            continue

        base = resolve_suffix_base(word[:-length], core, base_word_set)
        if base:
            return {
                "parts": [
                    {"text": base, "display": base, "type": "base"},
                    {"text": f"-{core}", "display": f"-{core}", "type": "suffix"},
                ],
                "affix_length": length,
                "source_text": f"{base} + -{core}",
            }

    return None


def parse_affix_strip_word_parts(
    word,
    base_word_set,
    prefix_cores,
    suffix_cores,
    prefix_lengths,
    suffix_lengths,
):
    if not isinstance(word, str) or not TIER3_WORD_RE.match(word):
        return None

    prefix_candidate = best_prefix_strip(word, base_word_set, prefix_cores, prefix_lengths)
    suffix_candidate = best_suffix_strip(word, base_word_set, suffix_cores, suffix_lengths)
    candidates = [candidate for candidate in (prefix_candidate, suffix_candidate) if candidate]
    if not candidates:
        return None

    # Prefer the most specific affix. On ties, suffixes usually mark the final derivation.
    chosen = sorted(
        candidates,
        key=lambda candidate: (
            candidate["affix_length"],
            1 if candidate["parts"][-1]["type"] == "suffix" else 0,
        ),
        reverse=True,
    )[0]

    return {
        "parts": chosen["parts"],
        "confidence": "low",
        "source": "affix_strip",
        "source_text": chosen["source_text"],
        "meta": {
            "parser_version": WORD_PARTS_PARSER_VERSION,
        },
    }


def populate_tier3_word_parts(conn):
    deleted = conn.execute(
        "DELETE FROM en_word_parts WHERE confidence = 'low' AND source = 'affix_strip'"
    ).rowcount
    if deleted:
        conn.commit()
        print(f"Tier 3 refreshed by deleting {deleted:,} existing low-confidence affix-strip rows")

    _, base_word_set, prefix_cores, suffix_cores, prefix_lengths, suffix_lengths = load_affix_strip_sets(conn)
    inserted = 0
    scanned = 0

    rows = conn.execute(
        """
        SELECT d.word, d.pos, d.definition
        FROM en_dictionary d
        LEFT JOIN en_word_parts wp ON wp.word = d.word
        WHERE wp.word IS NULL
          AND d.word IS NOT NULL
        """
    )
    for word, pos, definition in rows:
        if not is_tier3_record_allowed(pos, definition, TIER3_TARGET_POS):
            continue

        scanned += 1
        word_parts = parse_affix_strip_word_parts(
            word,
            base_word_set,
            prefix_cores,
            suffix_cores,
            prefix_lengths,
            suffix_lengths,
        )
        if word_parts and insert_word_parts(conn, word, word_parts):
            inserted += 1

        if scanned % BATCH_SIZE == 0:
            conn.commit()
            print(f"Tier 3 scanned {scanned:,} candidate rows; inserted {inserted:,} low-confidence rows")

    conn.commit()
    print(f"Tier 3 complete. Scanned {scanned:,} candidate rows; inserted {inserted:,} low-confidence rows")
    return inserted


def finalize_database(conn, vacuum=False):
    try:
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        conn.execute("PRAGMA journal_mode=DELETE")
        if vacuum:
            conn.execute("VACUUM")
    except sqlite3.OperationalError as error:
        print(f"Warning: skipped final SQLite cleanup: {error}")


def main():
    parser = argparse.ArgumentParser(description="Build the local Kaikki English dictionary SQLite DB.")
    parser.add_argument(
        "--tier2-only",
        action="store_true",
        help="Populate medium-confidence word parts from existing en_dictionary etymology rows without reading the raw dump.",
    )
    parser.add_argument(
        "--tier3-only",
        action="store_true",
        help="Populate low-confidence word parts by exact local affix stripping without reading the raw dump.",
    )
    parser.add_argument(
        "--morpheme-gloss-only",
        action="store_true",
        help="Populate local morpheme glosses and enrich existing word-part rows without reading the raw dump.",
    )
    parser.add_argument(
        "--audio-only",
        action="store_true",
        help="Populate US/UK pronunciation audio URLs from the raw dump without rebuilding the dictionary.",
    )
    args = parser.parse_args()

    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS en_dictionary (
            word TEXT PRIMARY KEY,
            pos TEXT,
            ipa TEXT,
            definition TEXT,
            etymology TEXT,
            audio_us TEXT,
            audio_uk TEXT,
            derived TEXT,
            related TEXT
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_word ON en_dictionary(word)")
    ensure_en_dictionary_audio_columns(conn)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS en_word_parts (
            word TEXT PRIMARY KEY,
            parts_json TEXT NOT NULL,
            confidence TEXT NOT NULL CHECK(confidence IN ('high', 'medium', 'low')),
            source TEXT NOT NULL,
            source_text TEXT,
            parser_version INTEGER NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_en_word_parts_confidence ON en_word_parts(confidence)")
    create_morpheme_gloss_schema(conn)

    if args.tier2_only:
        populate_tier2_word_parts(conn)
        populate_morpheme_glosses(conn)
        enrich_word_parts_with_morpheme_glosses(conn)
        finalize_database(conn)
        conn.close()
        return
    if args.tier3_only:
        populate_tier3_word_parts(conn)
        populate_morpheme_glosses(conn)
        enrich_word_parts_with_morpheme_glosses(conn)
        finalize_database(conn)
        conn.close()
        return
    if args.morpheme_gloss_only:
        populate_morpheme_glosses(conn)
        enrich_word_parts_with_morpheme_glosses(conn)
        finalize_database(conn)
        conn.close()
        return
    if args.audio_only:
        populate_pronunciation_audio(conn)
        finalize_database(conn)
        conn.close()
        return

    inserted = 0
    word_parts_inserted = 0
    scanned = 0
    with open_dictionary_dump() as handle:
        for line in handle:
            scanned += 1
            try:
                entry = json.loads(line)
                if entry.get("lang_code") != "en":
                    continue

                word = entry.get("word", "").strip().lower()
                if not word:
                    continue

                pos = entry.get("pos")
                ipa = first_ipa(entry)
                definition = first_definition(entry)
                etymology = entry.get("etymology_text")
                audio = pronunciation_audio_urls(entry)
                derived = json.dumps(word_list(entry, "derived"), ensure_ascii=False)
                related = json.dumps(word_list(entry, "related"), ensure_ascii=False)

                before_changes = conn.total_changes
                conn.execute(
                    """
                    INSERT OR IGNORE INTO en_dictionary
                    (word, pos, ipa, definition, etymology, audio_us, audio_uk, derived, related)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        word,
                        pos,
                        ipa,
                        definition,
                        etymology,
                        audio["us"],
                        audio["uk"],
                        derived,
                        related,
                    ),
                )
                if conn.total_changes > before_changes:
                    inserted += 1
                else:
                    conn.execute(
                        """
                        UPDATE en_dictionary
                        SET pos = COALESCE(NULLIF(pos, ''), ?),
                            ipa = COALESCE(NULLIF(ipa, ''), ?),
                            definition = COALESCE(NULLIF(definition, ''), ?),
                            etymology = COALESCE(NULLIF(etymology, ''), ?),
                            audio_us = COALESCE(NULLIF(audio_us, ''), ?),
                            audio_uk = COALESCE(NULLIF(audio_uk, ''), ?),
                            derived = CASE
                                WHEN derived IS NULL OR derived = '' OR derived = '[]' THEN ?
                                ELSE derived
                            END,
                            related = CASE
                                WHEN related IS NULL OR related = '' OR related = '[]' THEN ?
                                ELSE related
                            END
                        WHERE word = ?
                          AND (
                            pos IS NULL OR pos = ''
                            OR ipa IS NULL OR ipa = ''
                            OR definition IS NULL OR definition = ''
                            OR etymology IS NULL OR etymology = ''
                            OR audio_us IS NULL OR audio_us = ''
                            OR audio_uk IS NULL OR audio_uk = ''
                            OR derived IS NULL OR derived = '' OR derived = '[]'
                            OR related IS NULL OR related = '' OR related = '[]'
                          )
                        """,
                        (pos, ipa, definition, etymology, audio["us"], audio["uk"], derived, related, word),
                    )

                word_parts = parse_word_parts(entry)
                if word_parts:
                    if insert_word_parts(conn, word, word_parts):
                        word_parts_inserted += 1

                if scanned % BATCH_SIZE == 0:
                    conn.commit()
                    print(
                        f"Scanned {scanned:,} lines; inserted {inserted:,} words; "
                        f"inserted {word_parts_inserted:,} word-part rows"
                    )
            except Exception:
                continue

    conn.commit()
    tier2_inserted = populate_tier2_word_parts(conn)
    tier3_inserted = populate_tier3_word_parts(conn)
    morpheme_gloss_changed = populate_morpheme_glosses(conn)
    word_parts_enriched = enrich_word_parts_with_morpheme_glosses(conn)
    audio_updated = populate_pronunciation_audio(conn)
    finalize_database(conn, vacuum=True)
    conn.close()
    print(
        f"Done. Inserted {inserted:,} words, {word_parts_inserted:,} high-confidence word-part rows, "
        f"{tier2_inserted:,} medium-confidence word-part rows, "
        f"{tier3_inserted:,} low-confidence word-part rows, "
        f"upserted {morpheme_gloss_changed:,} morpheme gloss rows, "
        f"enriched {word_parts_enriched:,} word-part rows, "
        f"and updated {audio_updated:,} audio rows. "
        f"DB size: {DB_PATH.stat().st_size / 1e6:.1f}MB"
    )


if __name__ == "__main__":
    main()
