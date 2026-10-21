"""Machine-translated Korean glosses for interface languages KRDICT lacks.

KRDICT translates into 11 languages; for others (Portuguese) the English
glosses are machine-translated. A gloss that cannot be translated stays English
and is marked fallback_language="en", never passed off as the user's language.
"""

import asyncio

from word_lookup import (
    FALLBACK_LANGUAGE_FIELD,
    MACHINE_TRANSLATED_FIELD,
    translate_entry_glosses,
)

ENGLISH_GADA = [
    {"word": "가다", "origin": "N/A", "pos": "동사", "transWord": "go"},
    {"word": "가다", "origin": "N/A", "pos": "보조 동사", "transWord": "go on"},
    {"word": "가다", "origin": "N/A", "pos": "동사", "transWord": "go"},
]


def run(coro):
    return asyncio.run(coro)


def test_glosses_are_translated_once_each_and_marked():
    calls = []

    async def translate(text):
        calls.append(text)
        return {"go": "ir", "go on": "continuar"}[text]

    result = run(translate_entry_glosses(ENGLISH_GADA, "pt", translate))

    assert [entry["transWord"] for entry in result] == ["ir", "continuar", "ir"]
    assert all(entry["interface_language"] == "pt" for entry in result)
    assert all(entry[MACHINE_TRANSLATED_FIELD] is True for entry in result)
    assert all(FALLBACK_LANGUAGE_FIELD not in entry for entry in result)
    assert sorted(calls) == ["go", "go on"]
    # The input entries are not mutated.
    assert ENGLISH_GADA[0]["transWord"] == "go"


def test_untranslated_gloss_stays_english_and_is_marked_as_fallback():
    async def translate(text):
        return None if text == "go on" else "ir"

    result = run(translate_entry_glosses(ENGLISH_GADA, "pt", translate))

    assert result[0]["transWord"] == "ir"
    assert result[1]["transWord"] == "go on"
    assert result[1][FALLBACK_LANGUAGE_FIELD] == "en"
    assert MACHINE_TRANSLATED_FIELD not in result[1]


def test_translation_errors_never_break_the_lookup():
    async def translate(_text):
        raise RuntimeError("provider down")

    result = run(translate_entry_glosses(ENGLISH_GADA[:1], "pt", translate))

    assert result == [{**ENGLISH_GADA[0], FALLBACK_LANGUAGE_FIELD: "en"}]


def test_snapshot_fallback_entries_are_translated_too():
    entries = [{"word": "가다", "transWord": "go", FALLBACK_LANGUAGE_FIELD: "en"}]

    async def translate(_text):
        return "ir"

    [entry] = run(translate_entry_glosses(entries, "pt", translate))

    assert entry["transWord"] == "ir"
    assert FALLBACK_LANGUAGE_FIELD not in entry


def test_missing_gloss_is_left_alone_and_empty_input_is_empty():
    async def translate(_text):
        raise AssertionError("nothing to translate")

    entry = {"word": "가다", "transWord": "N/A"}
    assert run(translate_entry_glosses([entry], "pt", translate)) == [entry]
    assert run(translate_entry_glosses([], "pt", translate)) == []
    assert run(translate_entry_glosses(None, "pt", translate)) == []
