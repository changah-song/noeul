"""English multi-word expressions: fixed expressions ("of course", "in spite
of"), verb idioms ("make up one's mind") and opaque phrasal verbs ("give up",
"look after"), found in a spaCy doc and looked up as one word.

The list is a curated whitelist, data/en_expressions.tsv, rather than every
multi-word dictionary entry: matching all of Wiktionary's 19.6k produced mostly
noise ("for someone", "on the"). Each row carries its own Korean gloss and
definition (Wiktionary has Korean for about 3% of them) and its CEFR level.

Matching is contiguous only (phase 1): "gave up" matches give up, "gave it up"
does not. Within a sentence, the longest expression starting at a word wins,
and the scan continues after it.

Pattern words:
  ~give      any form of the word (gave, giving, gives): the token's lemma.
             As the first word it must be tagged a verb, so "waited so long
             for" is not "long for".
  one's      any possessive: my, your, his, her, its, our, their, one's.
  oneself    any reflexive: himself, herself, themselves...
  other      the word itself, case-insensitively.
"""

from __future__ import annotations

import csv
import os
import re
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Callable, Iterable

EXPRESSIONS_PATH = os.path.join(os.path.dirname(__file__), "data", "en_expressions.tsv")

CEFR_RANKS = {"A1": 1, "A2": 2, "B1": 3, "B2": 4, "C1": 5, "C2": 6}
SENSE_SEPARATOR = " / "
POSSESSIVES = {"my", "your", "his", "her", "its", "our", "their", "one's", "thy"}
VERB_POS = {"VERB", "AUX"}
# The dictionary's part of speech for each kind.
POS_BY_KIND = {"fixed": "phrase", "idiom": "phrase", "phrasal": "phrasal verb"}
LEVEL_SOURCE = "en_expressions"

_WHITESPACE_RUN = re.compile(r"\s+")


@dataclass(frozen=True)
class PatternWord:
    kind: str  # "word" | "lemma" | "possessive" | "reflexive"
    value: str


@dataclass(frozen=True)
class Expression:
    text: str
    kind: str
    pattern: tuple[PatternWord, ...]
    gloss_ko: tuple[str, ...]
    senses_en: tuple[str, ...]
    senses_ko: tuple[str, ...]
    cefr: str
    block_words: frozenset[str] = field(default_factory=frozenset)
    block_pos: frozenset[str] = field(default_factory=frozenset)
    # The Korean gloss's meaning in plain English: the source the other
    # interface languages' glosses are translated from.
    gloss_en: tuple[str, ...] = ()

    @property
    def level_rank(self) -> int:
        return CEFR_RANKS[self.cefr]

    @property
    def pos(self) -> str:
        return POS_BY_KIND.get(self.kind, "phrase")


@dataclass(frozen=True)
class ExpressionMatch:
    expression: Expression
    start_char: int
    end_char: int
    surface: str  # the text as written, whitespace runs collapsed: "gave up"


def normalize_text(text: str) -> str:
    return _WHITESPACE_RUN.sub(" ", (text or "").replace("’", "'")).strip()


def _parse_pattern(pattern: str) -> tuple[PatternWord, ...]:
    words = []
    for raw in pattern.split():
        if raw.startswith("~"):
            words.append(PatternWord("lemma", raw[1:].lower()))
        elif raw == "one's":
            words.append(PatternWord("possessive", raw))
        elif raw == "oneself":
            words.append(PatternWord("reflexive", raw))
        else:
            words.append(PatternWord("word", raw.lower()))
    return tuple(words)


def _split_list(raw: str, separator: str) -> tuple[str, ...]:
    return tuple(item.strip() for item in (raw or "").split(separator) if item.strip())


def parse_expressions(lines: Iterable[str]) -> list[Expression]:
    rows = csv.DictReader(
        (line for line in lines if line.strip() and not line.startswith("#")),
        delimiter="\t",
        quoting=csv.QUOTE_NONE,
    )
    expressions = []
    for row in rows:
        blocks = _split_list(row.get("block_next") or "", ",")
        expressions.append(Expression(
            text=normalize_text(row["expression"]).lower(),
            kind=row["kind"].strip(),
            pattern=_parse_pattern(row["pattern"]),
            gloss_ko=_split_list(row["gloss_ko"], ","),
            gloss_en=_split_list(row.get("gloss_en") or "", ","),
            senses_en=_split_list(row["definition_en"], SENSE_SEPARATOR),
            senses_ko=_split_list(row["definition_ko"], SENSE_SEPARATOR),
            cefr=row["cefr"].strip().upper(),
            block_words=frozenset(block for block in blocks if not block.isupper()),
            block_pos=frozenset(block for block in blocks if block.isupper()),
        ))
    return expressions


@lru_cache(maxsize=1)
def load_expressions(path: str = EXPRESSIONS_PATH) -> tuple[Expression, ...]:
    if not os.path.exists(path):
        return ()
    with open(path, encoding="utf-8") as handle:
        return tuple(parse_expressions(handle))


def expressions_by_text(path: str = EXPRESSIONS_PATH) -> dict[str, Expression]:
    return {expression.text: expression for expression in load_expressions(path)}


class ExpressionMatcher:
    """Finds the whitelist's expressions in a spaCy doc."""

    def __init__(self, expressions: Iterable[Expression]):
        self.by_first: dict[str, list[Expression]] = {}
        for expression in expressions:
            first = expression.pattern[0] if expression.pattern else None
            if first is None or first.kind not in ("word", "lemma"):
                continue
            self.by_first.setdefault(first.value, []).append(expression)
        for candidates in self.by_first.values():
            candidates.sort(key=lambda expression: -len(expression.pattern))

    @staticmethod
    def _word_matches(token, word: PatternWord, lemma: str, first: bool = False) -> bool:
        lower = token.text.lower().replace("’", "'")
        if word.kind == "word":
            return lower == word.value
        if word.kind == "lemma":
            # The verb an idiom starts with must be tagged a verb; a later
            # word ("noses" in turn up one's nose) only needs its lemma.
            if first and token.pos_ not in VERB_POS:
                return False
            return lemma == word.value or lower == word.value
        if word.kind == "possessive":
            return lower in POSSESSIVES or token.tag_ == "PRP$"
        if word.kind == "reflexive":
            return lower.endswith("self") or lower.endswith("selves")
        return False

    def _match_at(self, run: list, lemmas: list[str], start: int, expression: Expression) -> int | None:
        """The end (exclusive, in the run) of the expression starting at
        run[start], or None."""
        end = start + len(expression.pattern)
        if end > len(run):
            return None
        for offset, word in enumerate(expression.pattern):
            if not self._word_matches(run[start + offset], word, lemmas[start + offset], first=offset == 0):
                return None
        # Words written apart ("at all", not a glued token pair).
        for left, right in zip(run[start:end - 1], run[start + 1:end]):
            if left.idx + len(left.text) >= right.idx:
                return None
        if end < len(run) and (expression.block_words or expression.block_pos):
            following = run[end]
            if (
                following.text.lower().replace("’", "'") in expression.block_words
                or following.pos_ in expression.block_pos
            ):
                return None
        return end

    @staticmethod
    def _runs(doc) -> Iterable[list]:
        """Each sentence's tokens without whitespace, cut at line breaks: an
        expression never spans two sentences or two paragraphs."""
        sentences = doc.sents if doc.has_annotation("SENT_START") or doc.has_annotation("DEP") else [doc[:]]
        for sentence in sentences:
            run: list = []
            for token in sentence:
                if token.is_space:
                    if "\n" in token.text and run:
                        yield run
                        run = []
                    continue
                run.append(token)
            if run:
                yield run

    def find(self, doc, lemma_of: Callable | None = None) -> list[ExpressionMatch]:
        if not self.by_first:
            return []
        lemma_of = lemma_of or (lambda token: token.lemma_.strip().lower())
        text = doc.text
        matches: list[ExpressionMatch] = []
        for run in self._runs(doc):
            lemmas = [lemma_of(token) for token in run]
            index = 0
            while index < len(run):
                token = run[index]
                lower = token.text.lower().replace("’", "'")
                candidates = list(self.by_first.get(lower, []))
                if lemmas[index] != lower:
                    candidates += [
                        expression for expression in self.by_first.get(lemmas[index], [])
                        if expression not in candidates
                    ]
                candidates.sort(key=lambda expression: -len(expression.pattern))
                found = None
                for expression in candidates:
                    end = self._match_at(run, lemmas, index, expression)
                    if end is not None:
                        found = (expression, end)
                        break
                if not found:
                    index += 1
                    continue
                expression, end = found
                start_char = run[index].idx
                last = run[end - 1]
                end_char = last.idx + len(last.text)
                matches.append(ExpressionMatch(
                    expression=expression,
                    start_char=start_char,
                    end_char=end_char,
                    surface=normalize_text(text[start_char:end_char]),
                ))
                index = end
        return matches


@lru_cache(maxsize=1)
def default_matcher() -> ExpressionMatcher:
    return ExpressionMatcher(load_expressions())


def level_payload(expression: Expression) -> dict:
    """The same level fields an english_cefr word carries, from the
    expression's own CEFR level."""
    rank = expression.level_rank
    return {
        "cefr_level": expression.cefr,
        "cefr_rank": rank,
        "level_rank": rank,
        "level_source": LEVEL_SOURCE,
        "proficiency_system": "CEFR",
        "proficiency_level": expression.cefr,
        "proficiency_rank": rank,
    }


# ─── Other interface languages ───────────────────────────────────────────────
#
# data/en_expressions_i18n.tsv holds each expression's gloss and senses in the
# other interface languages, machine-translated from the reviewed Korean
# (scripts/translate_en_expressions.py), some corrected by hand.

TRANSLATIONS_PATH = os.path.join(os.path.dirname(__file__), "data", "en_expressions_i18n.tsv")
# Every interface language but English (the senses) and Korean (en_expressions.tsv).
TRANSLATED_LANGUAGES = ("ja", "zh", "zh-Hant", "es", "fr", "pt", "ru", "vi", "th", "id", "ar", "mn")
TRANSLATION_COLUMNS = ["expression", "language", "gloss", "senses", "source", "note"]


@dataclass(frozen=True)
class TranslationRow:
    expression: str
    language: str
    gloss: tuple[str, ...]   # the equivalents, shown under the phrase
    senses: tuple[str, ...]  # aligned with Expression.senses_en
    source: str              # "machine" (from the Korean) or "hand"
    note: str = ""


def read_translation_rows(path: str = TRANSLATIONS_PATH) -> list[TranslationRow]:
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as handle:
        rows = csv.DictReader(
            (line for line in handle if line.strip() and not line.startswith("#")),
            delimiter="\t",
            quoting=csv.QUOTE_NONE,
        )
        return [
            TranslationRow(
                expression=normalize_text(row["expression"]).lower(),
                language=row["language"].strip(),
                gloss=_split_list(row["gloss"], "|"),
                senses=_split_list(row["senses"], SENSE_SEPARATOR),
                source=(row.get("source") or "machine").strip(),
                note=(row.get("note") or "").strip(),
            )
            for row in rows
        ]


def write_translation_rows(path: str, rows: Iterable[TranslationRow], order: list[str]) -> None:
    rank = {text: index for index, text in enumerate(order)}
    language_rank = {language: index for index, language in enumerate(TRANSLATED_LANGUAGES)}
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("# The expressions' gloss and senses in the other interface languages.\n")
        handle.write("# source: machine = translated from the reviewed Korean (scripts/translate_en_expressions.py);\n")
        handle.write("#   hand = corrected by hand (never overwritten), with the reason in note.\n")
        handle.write("# gloss items are separated by ' | ', senses by ' / ' (aligned with definition_en).\n")
        handle.write("\t".join(TRANSLATION_COLUMNS) + "\n")
        for row in sorted(rows, key=lambda r: (language_rank.get(r.language, 99), rank.get(r.expression, 1e9))):
            values = [row.expression, row.language, " | ".join(row.gloss), SENSE_SEPARATOR.join(row.senses),
                      row.source, row.note]
            assert all("\t" not in value and "\n" not in value for value in values), row
            handle.write("\t".join(values) + "\n")


@lru_cache(maxsize=1)
def translations(path: str = TRANSLATIONS_PATH) -> dict[tuple[str, str], TranslationRow]:
    """(expression, language) -> its row. Rows whose senses don't line up with
    the English ones are left out."""
    by_text = expressions_by_text()
    out = {}
    for row in read_translation_rows(path):
        expression = by_text.get(row.expression)
        if expression and len(row.senses) == len(expression.senses_en):
            out[(row.expression, row.language)] = row
    return out


def localized(expression: Expression, interface_language: str) -> tuple[tuple[str, ...], tuple[str | None, ...]]:
    """(gloss items, senses aligned with senses_en, None where missing) in the
    interface language. English has no gloss and its senses are the English."""
    if interface_language == "en":
        return (), tuple(expression.senses_en)
    if interface_language == "ko":
        return expression.gloss_ko, expression.senses_ko
    row = translations().get((expression.text, interface_language))
    if not row:
        return (), (None,) * len(expression.senses_en)
    return row.gloss, row.senses


def dictionary_entry(expression: Expression, interface_language: str) -> dict:
    """The expression as an en_learner_dict.lookup_entries entry, straight from
    the whitelist files (used when en_learner.db predates them)."""
    gloss, senses = localized(expression, interface_language)
    translated = [None] * len(expression.senses_en) if interface_language == "en" else list(senses)
    equivalents = list(gloss)
    if interface_language == "en":
        definition = "\n".join(expression.senses_en)
    else:
        definition = "\n".join(text for text in translated if text) or None
    return {
        "word": expression.text,
        "entry_no": 1,
        "pos": expression.pos,
        "ipa": None,
        "audio_us": None,
        "audio_uk": None,
        "senses": list(expression.senses_en),
        "translated_senses": translated,
        "definition": definition,
        "equivalents": equivalents,
        "gloss": ", ".join(equivalents) or None,
    }
