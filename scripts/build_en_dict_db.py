import gzip
import argparse
import json
import re
import sqlite3
import unicodedata
from pathlib import Path

try:
    from morpheme_seed import (
        BOUND_ROOTS as CURATED_BOUND_ROOTS,
        PREFIXES as CURATED_PREFIXES,
        SUFFIXES as CURATED_SUFFIXES,
    )
except ModuleNotFoundError:
    from scripts.morpheme_seed import (
        BOUND_ROOTS as CURATED_BOUND_ROOTS,
        PREFIXES as CURATED_PREFIXES,
        SUFFIXES as CURATED_SUFFIXES,
    )


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "backend" / "en_dict.db"
JSONL_PATH = ROOT / "scripts" / "kaikki.org-dictionary-English.jsonl"
JSONL_GZ_PATH = ROOT / "scripts" / "kaikki.org-dictionary-English.jsonl.gz"
DEFAULT_MORPHEME_REVIEW_QUEUE_PATH = ROOT / "scripts" / "en_morpheme_review_queue.jsonl"
DEFAULT_MORPHEME_REVIEW_DECISIONS_PATH = ROOT / "scripts" / "en_morpheme_review_decisions.jsonl"
BATCH_SIZE = 10_000
WORD_PARTS_PARSER_VERSION = 4
MORPHEME_GLOSS_VERSION = 1
EN_AUDIO_TAGS = {
    "us": {"US", "General-American"},
    "uk": {"UK", "Received-Pronunciation"},
}
TIER3_TARGET_POS = {"noun", "verb", "adj", "adv"}
TIER3_BASE_POS = {"noun", "verb", "adj", "adv"}
CURATED_WORD_PART_SOURCE = "curated_morpheme"
CURATED_WORD_PART_REVIEWED_SOURCE = "curated_morpheme_reviewed"
CURATED_MIN_BASE_LEN = 3
CURATED_MAX_WORD_PARTS = 4
CURATED_MAX_PREFIXES = 2
CURATED_MAX_SUFFIXES = 3
CURATED_HIGH_SCORE = 9
CURATED_MEDIUM_SCORE = 7
CURATED_MIN_SCORE_MARGIN = 2
CURATED_HIGH_SCORE_MARGIN = 3
CURATED_CONTEXTUAL_PREFIX_ALIASES = {
    "il-": "en-",
    "im-": "en-",
    "in-": "en-",
    "ir-": "en-",
}
CURATED_CONTEXTUAL_SUFFIX_ALIASES = {
    "-ion": "-tion",
}
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
    "curated_seed_v1": 100,
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
WORD_TOKEN_RE = re.compile(r"[a-z]+")
CURATED_MEANING_STOPWORDS = {
    "a",
    "act",
    "an",
    "and",
    "be",
    "become",
    "cause",
    "certain",
    "does",
    "for",
    "in",
    "into",
    "of",
    "or",
    "person",
    "process",
    "quality",
    "related",
    "relating",
    "result",
    "state",
    "that",
    "the",
    "thing",
    "to",
    "who",
    "with",
}
CURATED_NEGATION_CUES = {
    "anti",
    "cannot",
    "fail",
    "fails",
    "free",
    "lack",
    "lacking",
    "lacks",
    "no",
    "non",
    "not",
    "opposite",
    "reverse",
    "un",
    "unable",
    "without",
}
CURATED_AWAY_CUES = {"apart", "aside", "away", "back", "down", "off", "out"}
CURATED_LOCATIVE_CUES = {"in", "inside", "into", "through", "within"}
CURATED_OPAQUE_BREAKDOWN_WORDS = {
    "because",
    "understand",
}


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
    if re.search(r"\blatin\s*/\s*greek\b|\bgreek\s*/\s*latin\b", normalized):
        return "Latin/Greek"
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


def iter_curated_seed_morpheme_glosses():
    for part_type, entries in (
        ("prefix", CURATED_PREFIXES),
        ("suffix", CURATED_SUFFIXES),
        ("bound_root", CURATED_BOUND_ROOTS),
    ):
        for item in entries:
            seeded_item = dict(item)
            seeded_item.setdefault("type", part_type)
            seeded_item.setdefault("display", seeded_item["key"])
            seeded_item.setdefault("source", "curated_seed_v1")
            seeded_item.setdefault("confidence", "high")
            yield seeded_item


def add_curated_seed_expected_keys(expected_keys, key, part_type, language):
    normalized_type = normalize_gloss_part_type(part_type)
    language_name = normalize_language_name(language)
    for lookup_key in morpheme_key_candidates(key, normalized_type):
        expected_keys.add((lookup_key, normalized_type, language_name))


def prune_stale_curated_seed_morpheme_glosses(conn, expected_keys):
    rows = conn.execute(
        """
        SELECT lookup_key, part_type, language
        FROM en_morpheme_glosses
        WHERE source = 'curated_seed_v1'
        """
    ).fetchall()
    stale_rows = [row for row in rows if row not in expected_keys]
    if not stale_rows:
        return 0

    conn.executemany(
        """
        DELETE FROM en_morpheme_glosses
        WHERE lookup_key = ?
          AND part_type = ?
          AND language = ?
          AND source = 'curated_seed_v1'
        """,
        stale_rows,
    )
    return len(stale_rows)


def populate_curated_seed_morpheme_glosses(conn):
    changed = 0
    expected_keys = set()
    for item in iter_curated_seed_morpheme_glosses():
        add_curated_seed_expected_keys(
            expected_keys,
            item["key"],
            item["type"],
            item.get("language"),
        )
        changed += upsert_morpheme_gloss(
            conn,
            item["key"],
            item["type"],
            item["meaning"],
            display=item.get("display"),
            language=item.get("language"),
            source=item.get("source", "curated_seed_v1"),
            source_word=item.get("key"),
            confidence=item.get("confidence", "high"),
        )
        for alias in item.get("aliases") or []:
            add_curated_seed_expected_keys(
                expected_keys,
                alias,
                item["type"],
                item.get("language"),
            )
            changed += upsert_morpheme_gloss(
                conn,
                alias,
                item["type"],
                item["meaning"],
                display=alias,
                language=item.get("language"),
                source=item.get("source", "curated_seed_v1"),
                source_word=item.get("key"),
                confidence=item.get("confidence", "high"),
            )

    stale_deleted = prune_stale_curated_seed_morpheme_glosses(conn, expected_keys)
    if stale_deleted:
        print(f"Removed {stale_deleted:,} stale curated morpheme gloss rows.")

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
    deleted = conn.execute(
        "DELETE FROM en_morpheme_glosses WHERE source = 'parsed_word_parts'"
    ).rowcount
    if deleted:
        print(f"Removed {deleted:,} stale parsed word-part morpheme gloss rows.")

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
    curated_seed_changed = populate_curated_seed_morpheme_glosses(conn)
    seed_changed = populate_seed_morpheme_glosses(conn)
    affix_changed = populate_english_affix_morpheme_glosses(conn)
    parsed_changed = populate_existing_word_part_morpheme_glosses(conn)
    conn.commit()

    needed_keys = collect_missing_morpheme_gloss_keys(conn)
    base_changed = populate_english_base_morpheme_glosses(conn, needed_keys)
    conn.commit()
    source_changed = populate_source_dump_morpheme_glosses(conn, needed_keys)
    conn.commit()
    total_changed = (
        curated_seed_changed
        + seed_changed
        + affix_changed
        + parsed_changed
        + base_changed
        + source_changed
    )
    print(
        f"Morpheme gloss lookup ready. Upserted {total_changed:,} rows "
        f"({curated_seed_changed:,} curated seed, {seed_changed:,} legacy seed, "
        f"{affix_changed:,} English affix, "
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


def curated_entry_match_core(value, part_type):
    display = normalize_affix_text(value, part_type)
    key = normalize_morpheme_key(display, part_type)
    if not key:
        return None
    if part_type == "prefix":
        core = key[:-1] if key.endswith("-") else key
    elif part_type == "suffix":
        core = key[1:] if key.startswith("-") else key
    else:
        core = key
    return core if core and core.isalpha() else None


def curated_entry_display(value, part_type):
    return normalize_affix_text(value, part_type)


def build_curated_match_entry(item, surface, part_type, *, contextual_alias=False):
    match_core = curated_entry_match_core(surface, part_type)
    if not match_core:
        return None

    key = item["key"]
    display = curated_entry_display(surface, part_type)
    canonical_display = curated_entry_display(key, part_type)
    lookup_terms = {
        term
        for term in (
            curated_entry_match_core(key, part_type),
            match_core,
            *(curated_entry_match_core(alias, part_type) for alias in item.get("aliases") or []),
        )
        if term
    }
    return {
        "key": key,
        "display": display,
        "canonical": canonical_display,
        "type": part_type,
        "language": normalize_language_name(item.get("language")),
        "meaning": clean_gloss_meaning(item.get("meaning"), max_length=80),
        "match_core": match_core,
        "lookup_terms": sorted(lookup_terms, key=len, reverse=True),
        "contextual_alias": contextual_alias,
    }


def add_curated_match_entry(entries_by_core, entry):
    if not entry:
        return
    entries = entries_by_core.setdefault(entry["match_core"], [])
    signature = (
        entry["key"],
        entry["display"],
        entry["type"],
        entry["language"],
        entry["meaning"],
    )
    if any(
        (
            existing["key"],
            existing["display"],
            existing["type"],
            existing["language"],
            existing["meaning"],
        ) == signature
        for existing in entries
    ):
        return
    entries.append(entry)


def add_contextual_curated_aliases(entries_by_core, part_type, aliases):
    if not aliases:
        return

    entries_by_key = {
        entry["canonical"]: entry
        for entries in entries_by_core.values()
        for entry in entries
    }
    for surface, canonical in aliases.items():
        canonical_display = curated_entry_display(canonical, part_type)
        canonical_entry = entries_by_key.get(canonical_display)
        if not canonical_entry:
            continue

        alias_entry = dict(canonical_entry)
        alias_entry["display"] = curated_entry_display(surface, part_type)
        alias_entry["match_core"] = curated_entry_match_core(surface, part_type)
        alias_entry["lookup_terms"] = sorted(
            {
                *canonical_entry.get("lookup_terms", []),
                curated_entry_match_core(surface, part_type),
            },
            key=len,
            reverse=True,
        )
        alias_entry["contextual_alias"] = True
        add_curated_match_entry(entries_by_core, alias_entry)


def load_curated_morpheme_match_sets():
    match_sets = {
        "prefix": {},
        "suffix": {},
        "bound_root": {},
    }
    for item in iter_curated_seed_morpheme_glosses():
        part_type = item["type"]
        for surface in [item["key"], *(item.get("aliases") or [])]:
            add_curated_match_entry(
                match_sets[part_type],
                build_curated_match_entry(item, surface, part_type),
            )

    add_contextual_curated_aliases(
        match_sets["prefix"],
        "prefix",
        CURATED_CONTEXTUAL_PREFIX_ALIASES,
    )
    add_contextual_curated_aliases(
        match_sets["suffix"],
        "suffix",
        CURATED_CONTEXTUAL_SUFFIX_ALIASES,
    )

    return {
        part_type: {
            "by_core": by_core,
            "lengths": sorted({len(core) for core in by_core}, reverse=True),
            "overlap_lengths": sorted(
                {len(core) - 1 for core in by_core if len(core) > 2},
                reverse=True,
            ),
        }
        for part_type, by_core in match_sets.items()
    }


def normalized_text_tokens(*values):
    tokens = set()
    for value in values:
        if not isinstance(value, str):
            continue
        normalized = strip_diacritics(value.casefold())
        tokens.update(WORD_TOKEN_RE.findall(normalized))
    return tokens


def meaning_keywords(meaning):
    return {
        token
        for token in normalized_text_tokens(meaning)
        if len(token) >= 3 and token not in CURATED_MEANING_STOPWORDS
    }


def token_matches_keyword(tokens, keyword):
    if keyword in tokens:
        return True
    if len(keyword) >= 4 and keyword.endswith("e"):
        keyword = keyword[:-1]
    return any(
        len(token) >= 4
        and len(keyword) >= 4
        and (token.startswith(keyword) or keyword.startswith(token))
        for token in tokens
    )


def count_keyword_matches(tokens, keywords):
    return sum(1 for keyword in keywords if token_matches_keyword(tokens, keyword))


def normalized_evidence_text(*values):
    return " ".join(
        strip_diacritics(value.casefold())
        for value in values
        if isinstance(value, str) and value.strip()
    )


def evidence_mentions_term(evidence_text, term, part_type):
    if not term:
        return False
    term = strip_diacritics(term.casefold())
    if part_type == "base":
        return bool(re.search(rf"\b{re.escape(term)}\b", evidence_text))
    if part_type in {"prefix", "suffix"}:
        affix = f"{term}-" if part_type == "prefix" else f"-{term}"
        if affix in evidence_text:
            return True
        return bool(re.search(rf"\b{re.escape(term)}\b", evidence_text))
    if part_type == "bound_root" and len(term) <= 3:
        return bool(re.search(rf"\b{re.escape(term)}\b", evidence_text))
    if len(term) <= 2:
        return bool(re.search(rf"\b{re.escape(term)}\b", evidence_text))
    return term in evidence_text


def evidence_mentions_entry(evidence_text, entry):
    return any(
        evidence_mentions_term(evidence_text, term, entry["type"])
        for term in entry.get("lookup_terms") or [entry.get("match_core")]
    )


def build_curated_word_part(entry):
    part = {
        "text": entry["display"],
        "display": entry["display"],
        "type": entry["type"],
    }
    if entry.get("meaning"):
        part["meaning"] = entry["meaning"]
        part["meaning_source"] = "curated_seed_v1"
        part["meaning_confidence"] = "high"
    if entry.get("language"):
        part["note"] = entry["language"]
    if entry.get("canonical") and entry["canonical"] != entry["display"]:
        part["canonical"] = entry["canonical"]
    return part


def build_curated_base_part(base_word):
    return {
        "text": base_word,
        "display": base_word,
        "type": "base",
    }


def prefix_match_sequences(word, prefix_match_set):
    by_core = prefix_match_set["by_core"]
    lengths = prefix_match_set["lengths"]
    results = [([], 0)]

    def visit(offset, prefixes):
        if len(prefixes) >= CURATED_MAX_PREFIXES:
            return
        for length in lengths:
            if len(word) <= offset + length + 1:
                continue
            core = word[offset:offset + length]
            entries = by_core.get(core)
            if not entries:
                continue
            for entry in entries:
                next_prefixes = [*prefixes, entry]
                results.append((next_prefixes, offset + length))
                visit(offset + length, next_prefixes)

    visit(0, [])
    return results


def suffix_surface_matches(segment, suffix_match_set, right_suffix=None):
    by_core = suffix_match_set["by_core"]
    lengths = suffix_match_set["lengths"]
    overlap_lengths = suffix_match_set["overlap_lengths"]

    for length in lengths:
        if len(segment) <= length:
            continue
        core = segment[-length:]
        for entry in by_core.get(core, []):
            yield segment[:-length], entry, "exact"

    right_core = right_suffix.get("match_core") if right_suffix else ""
    allow_dropped_e = right_core[:1] in {"a", "e", "i", "o", "u"}
    if allow_dropped_e:
        for core, entries in by_core.items():
            if not core.endswith("e") or len(core) <= 2:
                continue
            surface = core[:-1]
            if len(segment) <= len(surface) or not segment.endswith(surface):
                continue
            for entry in entries:
                yield segment[:-len(surface)], entry, "dropped_e"

    for tail_length in overlap_lengths:
        if len(segment) <= tail_length:
            continue
        tail = segment[-tail_length:]
        for core, entries in by_core.items():
            if len(core) - 1 != tail_length or core[1:] != tail:
                continue
            stem = segment[:-tail_length]
            if not stem.endswith(core[:1]):
                continue
            for entry in entries:
                yield stem, entry, "overlap"


def suffix_match_sequences(segment, suffix_match_set, max_suffixes):
    results = [(segment, [], [])]

    def visit(current, suffixes, spellings):
        if len(suffixes) >= max_suffixes:
            return
        right_suffix = suffixes[0] if suffixes else None
        for stem, entry, spelling in suffix_surface_matches(
            current,
            suffix_match_set,
            right_suffix=right_suffix,
        ):
            if len(stem) < 2:
                continue
            next_suffixes = [entry, *suffixes]
            next_spellings = [spelling, *spellings]
            results.append((stem, next_suffixes, next_spellings))
            visit(stem, next_suffixes, next_spellings)

    visit(segment, [], [])
    return results


def base_spelling_variants(stem, suffixes):
    variants = [(stem, "exact")]
    if not suffixes:
        return variants

    first_suffix_core = suffixes[0]["match_core"]
    if stem.endswith("i"):
        variants.append((f"{stem[:-1]}y", "y_to_i"))
    if len(stem) > 1 and stem[-1] == stem[-2]:
        variants.append((stem[:-1], "doubled_consonant"))
    if first_suffix_core[:1] in {"a", "e", "i", "o", "u"}:
        variants.append((f"{stem}e", "dropped_e"))

    deduped = []
    seen = set()
    for value, spelling in variants:
        if value in seen:
            continue
        seen.add(value)
        deduped.append((value, spelling))
    return deduped


def central_candidates(stem, suffixes, root_match_set, base_records):
    candidates = []
    for root in root_match_set["by_core"].get(stem, []):
        candidates.append({
            "type": "bound_root",
            "surface": stem,
            "entry": root,
            "spelling": "exact",
        })

    for base, spelling in base_spelling_variants(stem, suffixes):
        if len(base) >= CURATED_MIN_BASE_LEN and base in base_records:
            candidates.append({
                "type": "base",
                "surface": stem,
                "base": base,
                "spelling": spelling,
            })

    return candidates


def candidate_signature(parts):
    return tuple(
        (
            part.get("type"),
            part.get("text"),
            part.get("canonical"),
            part.get("meaning"),
        )
        for part in parts
    )


def semantic_candidate_signature(candidate):
    return tuple(
        (
            part.get("type"),
            part.get("canonical") or part.get("text"),
            part.get("meaning"),
        )
        for part in candidate.get("parts") or []
    )


def candidate_source_text(parts):
    return " + ".join(part.get("display") or part.get("text") or "" for part in parts)


def score_curated_candidate(candidate, definition, etymology):
    definition_tokens = normalized_text_tokens(definition)
    evidence_text = normalized_evidence_text(etymology)
    candidate_text = normalized_evidence_text(candidate.get("source_text"))
    all_text_tokens = normalized_text_tokens(definition, etymology)
    score = 2
    score += 2 if candidate["central_type"] == "bound_root" else 1
    score += min(2, len(candidate["prefixes"]) + len(candidate["suffixes"]))
    if candidate["central_type"] == "bound_root":
        score += 4
    if candidate_text and candidate_text in evidence_text:
        score += 4

    if candidate.get("central_spelling") != "exact":
        score -= 1
    score -= sum(1 for spelling in candidate.get("suffix_spellings") or [] if spelling != "exact")
    extra_suffixes = max(0, len(candidate["suffixes"]) - 1)
    score -= extra_suffixes
    if extra_suffixes and all(spelling == "exact" for spelling in candidate.get("suffix_spellings") or []):
        score -= extra_suffixes

    for entry in [*candidate["prefixes"], *candidate["suffixes"]]:
        if evidence_mentions_entry(evidence_text, entry):
            score += 2
        overlap = count_keyword_matches(all_text_tokens, meaning_keywords(entry.get("meaning")))
        if overlap:
            score += min(2, overlap)

        meaning = entry.get("meaning") or ""
        meaning_tokens = meaning_keywords(meaning)
        is_negative_meaning = bool({"not", "without", "opposite"} & meaning_tokens)
        is_directional_meaning = bool({"apart", "away", "back", "down"} & meaning_tokens)
        if is_negative_meaning and not is_directional_meaning:
            if definition_tokens & CURATED_NEGATION_CUES:
                score += 3
            else:
                score -= 3
        if {"away", "apart", "down"} & meaning_tokens:
            if all_text_tokens & CURATED_AWAY_CUES:
                score += 2
            elif entry["match_core"] == "a":
                score -= 3
        if {"into", "inside", "within"} & meaning_tokens and all_text_tokens & CURATED_LOCATIVE_CUES:
            score += 2

        if len(entry["match_core"]) == 1 and not evidence_mentions_entry(evidence_text, entry):
            score -= 2

    central_entry = candidate.get("central_entry")
    if central_entry:
        if evidence_mentions_entry(evidence_text, central_entry):
            score += 4
        overlap = count_keyword_matches(all_text_tokens, meaning_keywords(central_entry.get("meaning")))
        if overlap:
            score += min(3, overlap)
        if len(central_entry["match_core"]) <= 3 and not evidence_mentions_entry(evidence_text, central_entry):
            score -= 4
    else:
        base = candidate.get("central_base")
        if base and evidence_mentions_term(evidence_text, base, "base"):
            score += 4

    return score


def rank_curated_candidates(candidates, definition, etymology):
    scored = []
    for candidate in candidates:
        candidate["score"] = score_curated_candidate(candidate, definition, etymology)
        scored.append(candidate)
    return sorted(scored, key=lambda item: item["score"], reverse=True)


def confidence_for_curated_candidate(best, ranked):
    best_signature = semantic_candidate_signature(best)
    competitor = next(
        (
            candidate
            for candidate in ranked[1:]
            if semantic_candidate_signature(candidate) != best_signature
        ),
        None,
    )
    margin = best["score"] - (competitor["score"] if competitor else -100)
    if best["score"] >= CURATED_HIGH_SCORE and margin >= CURATED_HIGH_SCORE_MARGIN:
        return "high", margin
    if best["score"] >= CURATED_MEDIUM_SCORE and margin >= CURATED_MIN_SCORE_MARGIN:
        return "medium", margin
    return None, margin


def ranked_curated_morpheme_candidates(word, definition, etymology, match_sets, base_records):
    if not isinstance(word, str) or not TIER3_WORD_RE.match(word):
        return []
    if word in CURATED_OPAQUE_BREAKDOWN_WORDS:
        return []

    candidates = []
    seen = set()
    for prefixes, prefix_len in prefix_match_sequences(word, match_sets["prefix"]):
        segment = word[prefix_len:]
        max_suffixes = CURATED_MAX_WORD_PARTS - 1 - len(prefixes)
        if max_suffixes < 0:
            continue
        for stem, suffixes, suffix_spellings in suffix_match_sequences(
            segment,
            match_sets["suffix"],
            max_suffixes,
        ):
            if not prefixes and not suffixes:
                continue
            if len(prefixes) + len(suffixes) + 1 > CURATED_MAX_WORD_PARTS:
                continue
            for central in central_candidates(
                stem,
                suffixes,
                match_sets["bound_root"],
                base_records,
            ):
                parts = [build_curated_word_part(prefix) for prefix in prefixes]
                if central["type"] == "bound_root":
                    parts.append(build_curated_word_part(central["entry"]))
                    central_entry = central["entry"]
                    central_base = None
                else:
                    parts.append(build_curated_base_part(central["base"]))
                    central_entry = None
                    central_base = central["base"]
                parts.extend(build_curated_word_part(suffix) for suffix in suffixes)

                signature = candidate_signature(parts)
                if signature in seen:
                    continue
                seen.add(signature)

                candidates.append({
                    "parts": parts,
                    "prefixes": prefixes,
                    "suffixes": suffixes,
                    "suffix_spellings": suffix_spellings,
                    "central_type": central["type"],
                    "central_entry": central_entry,
                    "central_base": central_base,
                    "central_spelling": central.get("spelling"),
                    "source_text": candidate_source_text(parts),
                })

    if not candidates:
        return []

    return rank_curated_candidates(candidates, definition, etymology)


def parse_curated_morpheme_word_parts(word, definition, etymology, match_sets, base_records):
    ranked = ranked_curated_morpheme_candidates(
        word,
        definition,
        etymology,
        match_sets,
        base_records,
    )
    if not ranked:
        return None

    best = ranked[0]
    if best["score"] < CURATED_MEDIUM_SCORE:
        return None

    confidence, margin = confidence_for_curated_candidate(best, ranked)
    if confidence != "high":
        return None

    return {
        "parts": best["parts"],
        "confidence": confidence,
        "source": CURATED_WORD_PART_SOURCE,
        "source_text": best["source_text"],
        "meta": {
            "parser_version": WORD_PARTS_PARSER_VERSION,
            "candidate_score": best["score"],
            "candidate_margin": margin,
            "candidate_count": len(ranked),
        },
    }


def trim_review_text(value, max_length=1200):
    if not isinstance(value, str):
        return None
    cleaned = re.sub(r"\s+", " ", value).strip()
    if not cleaned:
        return None
    if len(cleaned) <= max_length:
        return cleaned
    return f"{cleaned[:max_length].rsplit(' ', 1)[0].rstrip()}..."


def serialize_review_part(part):
    serialized = {
        "text": part.get("text"),
        "display": part.get("display"),
        "type": part.get("type"),
    }
    for key in ("meaning", "canonical", "note"):
        if part.get(key):
            serialized[key] = part[key]
    return serialized


def serialize_review_candidate(candidate):
    return {
        "source_text": candidate.get("source_text"),
        "score": candidate.get("score"),
        "central_type": candidate.get("central_type"),
        "central_spelling": candidate.get("central_spelling"),
        "suffix_spellings": candidate.get("suffix_spellings") or [],
        "parts": [
            serialize_review_part(part)
            for part in candidate.get("parts") or []
        ],
    }


def curated_review_reason(best, confidence, margin):
    if confidence == "medium":
        return "medium_confidence"
    if best["score"] >= CURATED_HIGH_SCORE:
        return "ambiguous_high_score"
    if best["score"] >= CURATED_MEDIUM_SCORE:
        return "near_threshold"
    return "low_score"


def build_curated_morpheme_review_record(word, pos, definition, etymology, ranked):
    if not ranked:
        return None

    best = ranked[0]
    if best["score"] < CURATED_MEDIUM_SCORE:
        return None

    confidence, margin = confidence_for_curated_candidate(best, ranked)
    if confidence == "high":
        return None

    return {
        "word": word,
        "pos": pos,
        "reason": curated_review_reason(best, confidence, margin),
        "suggested_confidence": confidence or "review_required",
        "score": best["score"],
        "margin": margin,
        "candidate_count": len(ranked),
        "definition": trim_review_text(definition),
        "etymology": trim_review_text(etymology),
        "best_candidate": serialize_review_candidate(best),
        "competing_candidates": [
            serialize_review_candidate(candidate)
            for candidate in ranked[1:5]
        ],
    }


def load_curated_base_records(conn):
    records = {}
    rows = conn.execute(
        """
        SELECT word, pos, definition, etymology
        FROM en_dictionary
        WHERE word IS NOT NULL
        """
    )
    for word, pos, definition, etymology in rows:
        if not isinstance(word, str) or not TIER3_WORD_RE.match(word):
            continue
        if not is_tier3_record_allowed(
            pos,
            definition,
            TIER3_BASE_POS,
            allow_named_entity=True,
        ):
            continue
        records[word] = {
            "pos": pos,
            "definition": definition,
            "etymology": etymology,
        }
    return records


def is_refreshable_curated_word_parts(confidence, source):
    return source == CURATED_WORD_PART_SOURCE or source == "affix_strip" or confidence == "low"


def word_parts_has_bound_root(word_parts):
    return any(
        isinstance(part, dict) and part.get("type") == "bound_root"
        for part in word_parts.get("parts") or []
    )


def should_replace_with_curated(existing_confidence, existing_source, existing_parts_json, word_parts):
    if not existing_confidence:
        return False
    if is_refreshable_curated_word_parts(existing_confidence, existing_source):
        return True
    if is_incomplete_tier1_word_parts(existing_confidence, existing_source, existing_parts_json):
        return True
    if isinstance(existing_source, str) and existing_source.startswith("prose_"):
        return word_parts["confidence"] in {"high", "medium"}
    if (
        isinstance(existing_source, str)
        and existing_source.startswith("kaikki_template_")
        and (
            word_parts["confidence"] == "high"
            or word_parts_has_bound_root(word_parts)
        )
    ):
        return True
    return False


def is_tier3_record_allowed(pos, definition, allowed_pos, allow_named_entity=False):
    if not isinstance(definition, str) or not definition.strip():
        return False
    clean_definition = definition.strip()
    if TIER3_DEFINITION_BLOCKLIST_RE.search(clean_definition):
        return False
    if pos in allowed_pos:
        return True
    return allow_named_entity and pos == "name" and clean_definition.startswith("The ")


def populate_tier3_word_parts(conn):
    deleted = conn.execute(
        """
        DELETE FROM en_word_parts
        WHERE source IN ('affix_strip', ?)
           OR source LIKE 'kaikki_template_%'
           OR source LIKE 'prose_%'
        """,
        (CURATED_WORD_PART_SOURCE,),
    ).rowcount
    if deleted:
        conn.commit()
        print(f"Tier 3 refreshed by deleting {deleted:,} generated word-part rows")

    match_sets = load_curated_morpheme_match_sets()
    base_records = load_curated_base_records(conn)
    inserted = 0
    replaced = 0
    accepted_high = 0
    accepted_medium = 0
    rejected = 0
    scanned = 0

    rows = conn.execute(
        """
        SELECT d.word, d.pos, d.definition, d.etymology,
               wp.confidence, wp.source, wp.parts_json
        FROM en_dictionary d
        LEFT JOIN en_word_parts wp ON wp.word = d.word
        WHERE d.word IS NOT NULL
        """
    )
    for word, pos, definition, etymology, existing_confidence, existing_source, existing_parts_json in rows:
        if not is_tier3_record_allowed(pos, definition, TIER3_TARGET_POS):
            continue

        scanned += 1
        word_parts = parse_curated_morpheme_word_parts(
            word,
            definition,
            etymology,
            match_sets,
            base_records,
        )
        if not word_parts:
            rejected += 1
            continue

        replace_existing = should_replace_with_curated(
            existing_confidence,
            existing_source,
            existing_parts_json,
            word_parts,
        )
        if existing_confidence and not replace_existing:
            continue

        if insert_word_parts(conn, word, word_parts, replace_existing=replace_existing):
            if replace_existing:
                replaced += 1
            else:
                inserted += 1
            if word_parts["confidence"] == "high":
                accepted_high += 1
            else:
                accepted_medium += 1

        if scanned % BATCH_SIZE == 0:
            conn.commit()
            print(
                f"Tier 3 scanned {scanned:,} candidate rows; inserted {inserted:,}, "
                f"replaced {replaced:,}, accepted {accepted_high:,} high/"
                f"{accepted_medium:,} medium, rejected {rejected:,}"
            )

    conn.commit()
    print(
        f"Tier 3 complete. Scanned {scanned:,} candidate rows; inserted {inserted:,}, "
        f"replaced {replaced:,}, accepted {accepted_high:,} high/{accepted_medium:,} medium, "
        f"rejected {rejected:,}"
    )
    return inserted + replaced


def export_curated_morpheme_review_queue(
    conn,
    output_path=DEFAULT_MORPHEME_REVIEW_QUEUE_PATH,
):
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    match_sets = load_curated_morpheme_match_sets()
    base_records = load_curated_base_records(conn)
    scanned = 0
    queued = 0
    skipped_existing_high = 0

    rows = conn.execute(
        """
        SELECT d.word, d.pos, d.definition, d.etymology,
               wp.confidence, wp.source
        FROM en_dictionary d
        LEFT JOIN en_word_parts wp ON wp.word = d.word
        WHERE d.word IS NOT NULL
        """
    )
    with output_path.open("w", encoding="utf-8") as handle:
        for word, pos, definition, etymology, existing_confidence, existing_source in rows:
            if not is_tier3_record_allowed(pos, definition, TIER3_TARGET_POS):
                continue
            if existing_confidence == "high" and existing_source == CURATED_WORD_PART_SOURCE:
                skipped_existing_high += 1
                continue

            scanned += 1
            ranked = ranked_curated_morpheme_candidates(
                word,
                definition,
                etymology,
                match_sets,
                base_records,
            )
            record = build_curated_morpheme_review_record(
                word,
                pos,
                definition,
                etymology,
                ranked,
            )
            if record:
                handle.write(json.dumps(record, ensure_ascii=False, sort_keys=True))
                handle.write("\n")
                queued += 1

            if scanned and scanned % BATCH_SIZE == 0:
                print(
                    f"Review queue scanned {scanned:,} candidate rows; "
                    f"queued {queued:,}; skipped {skipped_existing_high:,} accepted high rows"
                )

    print(
        f"Review queue ready at {output_path}. Scanned {scanned:,} candidate rows; "
        f"queued {queued:,}; skipped {skipped_existing_high:,} accepted high rows."
    )
    return queued


def reviewed_word_parts_from_decision(record):
    candidate = record.get("approved_candidate") or record.get("best_candidate")
    if not isinstance(candidate, dict):
        return None

    parts = candidate.get("parts")
    if not isinstance(parts, list) or not (2 <= len(parts) <= CURATED_MAX_WORD_PARTS):
        return None

    cleaned_parts = []
    for part in parts:
        if not isinstance(part, dict):
            return None
        part_type = normalize_gloss_part_type(part.get("type"))
        text = normalize_morpheme_key(part.get("text") or part.get("display"), part_type)
        display = part.get("display") or part.get("text")
        if not part_type or not text or not display:
            return None

        cleaned = {
            "text": normalize_affix_text(text, part_type),
            "display": normalize_affix_text(display, part_type),
            "type": part_type,
        }
        for key in ("meaning", "canonical", "note"):
            if part.get(key):
                cleaned[key] = part[key]
        if cleaned.get("canonical"):
            cleaned["canonical"] = normalize_affix_text(cleaned["canonical"], part_type)
        cleaned_parts.append(cleaned)

    return {
        "parts": cleaned_parts,
        "confidence": "high",
        "source": CURATED_WORD_PART_REVIEWED_SOURCE,
        "source_text": candidate.get("source_text") or record.get("source_text"),
        "meta": {
            "parser_version": WORD_PARTS_PARSER_VERSION,
            "review_decision": "approve",
            "review_reason": record.get("reason"),
            "review_score": record.get("score"),
            "review_margin": record.get("margin"),
            "review_candidate_count": record.get("candidate_count"),
        },
    }


def import_curated_morpheme_review_decisions(conn, decisions_path, dry_run=False):
    decisions_path = Path(decisions_path)
    if not decisions_path.exists():
        raise FileNotFoundError(f"Review decision file not found: {decisions_path}")

    approved = 0
    rejected = 0
    pending = 0
    invalid = 0
    imported = 0
    with decisions_path.open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            try:
                record = json.loads(stripped)
            except json.JSONDecodeError:
                invalid += 1
                print(f"Skipping invalid JSON decision at line {line_number}")
                continue

            decision = (record.get("decision") or "").strip().lower()
            if decision in {"pending", ""}:
                pending += 1
                continue
            if decision == "reject":
                rejected += 1
                continue
            if decision != "approve":
                invalid += 1
                print(f"Skipping unknown review decision at line {line_number}: {decision}")
                continue

            word = normalize_morpheme_key(record.get("word"), "base")
            word_parts = reviewed_word_parts_from_decision(record)
            if not word or not word_parts:
                invalid += 1
                print(f"Skipping incomplete approval decision at line {line_number}")
                continue

            approved += 1
            if dry_run:
                continue

            if insert_word_parts(conn, word, word_parts, replace_existing=True):
                imported += 1

            if approved and approved % BATCH_SIZE == 0:
                conn.commit()
                print(f"Imported {imported:,} approved review decisions so far")

    if not dry_run:
        conn.commit()

    print(
        f"Review decisions processed from {decisions_path}: "
        f"{approved:,} approved, {rejected:,} rejected, {pending:,} pending, "
        f"{invalid:,} invalid, {imported:,} imported"
        f"{' (dry run)' if dry_run else ''}."
    )
    return imported if not dry_run else approved


def export_curated_morpheme_review_decision_template(
    queue_path,
    output_path,
    limit=100,
):
    queue_path = Path(queue_path)
    output_path = Path(output_path)
    if not queue_path.exists():
        raise FileNotFoundError(f"Review queue file not found: {queue_path}")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    with queue_path.open(encoding="utf-8") as source, output_path.open("w", encoding="utf-8") as target:
        for line in source:
            if limit and written >= limit:
                break
            record = json.loads(line)
            decision_record = {
                "decision": "pending",
                "word": record.get("word"),
                "pos": record.get("pos"),
                "reason": record.get("reason"),
                "score": record.get("score"),
                "margin": record.get("margin"),
                "candidate_count": record.get("candidate_count"),
                "definition": record.get("definition"),
                "etymology": record.get("etymology"),
                "best_candidate": record.get("best_candidate"),
                "competing_candidates": record.get("competing_candidates") or [],
                "review_note": "",
            }
            target.write(json.dumps(decision_record, ensure_ascii=False, sort_keys=True))
            target.write("\n")
            written += 1

    print(f"Wrote {written:,} pending review decisions to {output_path}.")
    return written


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
        help="Populate curated morpheme word parts without reading the raw dump.",
    )
    parser.add_argument(
        "--morpheme-gloss-only",
        action="store_true",
        help="Populate local morpheme glosses and enrich existing word-part rows without reading the raw dump.",
    )
    parser.add_argument(
        "--morpheme-review-queue",
        action="store_true",
        help="Export non-high curated morpheme candidates to a review JSONL file without mutating word-part rows.",
    )
    parser.add_argument(
        "--morpheme-review-template",
        action="store_true",
        help="Create an editable pending-decision JSONL template from the morpheme review queue.",
    )
    parser.add_argument(
        "--import-morpheme-review-decisions",
        action="store_true",
        help="Import approved curated morpheme review decisions into en_word_parts.",
    )
    parser.add_argument(
        "--review-queue-path",
        default=str(DEFAULT_MORPHEME_REVIEW_QUEUE_PATH),
        help="Path for --morpheme-review-queue output.",
    )
    parser.add_argument(
        "--review-decisions-path",
        default=str(DEFAULT_MORPHEME_REVIEW_DECISIONS_PATH),
        help="Path for review decision JSONL input/output.",
    )
    parser.add_argument(
        "--review-template-limit",
        type=int,
        default=100,
        help="Maximum rows to write with --morpheme-review-template. Use 0 for all rows.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate an import action without mutating the database.",
    )
    parser.add_argument(
        "--audio-only",
        action="store_true",
        help="Populate US/UK pronunciation audio URLs from the raw dump without rebuilding the dictionary.",
    )
    args = parser.parse_args()

    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA busy_timeout=60000")
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
    if args.morpheme_review_queue:
        export_curated_morpheme_review_queue(conn, args.review_queue_path)
        finalize_database(conn)
        conn.close()
        return
    if args.morpheme_review_template:
        export_curated_morpheme_review_decision_template(
            args.review_queue_path,
            args.review_decisions_path,
            limit=args.review_template_limit,
        )
        finalize_database(conn)
        conn.close()
        return
    if args.import_morpheme_review_decisions:
        import_curated_morpheme_review_decisions(
            conn,
            args.review_decisions_path,
            dry_run=args.dry_run,
        )
        if not args.dry_run:
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
        f"{tier3_inserted:,} curated morpheme word-part rows, "
        f"upserted {morpheme_gloss_changed:,} morpheme gloss rows, "
        f"enriched {word_parts_enriched:,} word-part rows, "
        f"and updated {audio_updated:,} audio rows. "
        f"DB size: {DB_PATH.stat().st_size / 1e6:.1f}MB"
    )


if __name__ == "__main__":
    main()
