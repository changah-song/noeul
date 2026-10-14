"""English fallback for Korean lookups when the live KRDICT API is unavailable.

Non-English interface languages need KRDICT for their translation; when it is
slow or down the lookup serves the bundled snapshot's English senses, marked
fallback_language="en" so the app labels them and does not cache them.
"""

import asyncio

import pytest

from word_lookup import (
    KrdictUnavailableError,
    mark_english_fallback,
    parse_krdict_search_items,
    search_with_english_fallback,
)

SNAPSHOT_GADA = [
    {"word": "가다", "origin": "N/A", "pos": "동사", "transWord": "go"},
    {"word": "가다", "origin": "N/A", "pos": "보조 동사", "transWord": "go on"},
]


def run(coro):
    return asyncio.run(coro)


def english_search_recording(calls):
    async def english_search(query):
        calls.append(query)
        return [dict(entry) for entry in SNAPSHOT_GADA]

    return english_search


def test_live_answer_is_returned_untouched_and_snapshot_is_not_read():
    english_calls = []

    async def live_search(query):
        return [{"word": query, "transWord": "ir"}]

    result = run(search_with_english_fallback(
        "가다", "es", live_search, english_search_recording(english_calls)
    ))

    assert result == [{"word": "가다", "transWord": "ir"}]
    assert english_calls == []


def test_live_miss_is_a_real_miss_not_a_fallback():
    english_calls = []

    async def live_search(_query):
        return []

    result = run(search_with_english_fallback(
        "없는말", "es", live_search, english_search_recording(english_calls)
    ))

    assert result == []
    assert english_calls == []


@pytest.mark.parametrize(
    "failure",
    [KrdictUnavailableError("HTTP 503"), asyncio.TimeoutError(), ConnectionError("reset")],
)
def test_unavailable_krdict_serves_english_senses_marked_as_fallback(failure):
    english_calls = []
    fallbacks = []

    async def live_search(_query):
        raise failure

    result = run(search_with_english_fallback(
        "가다",
        "es",
        live_search,
        english_search_recording(english_calls),
        on_fallback=lambda query, _error, count: fallbacks.append((query, count)),
    ))

    assert english_calls == ["가다"]
    assert result == [{**entry, "fallback_language": "en"} for entry in SNAPSHOT_GADA]
    assert fallbacks == [("가다", 2)]


def test_english_interface_never_falls_back_after_live_failure():
    # English requests already tried the snapshot before going live.
    english_calls = []

    async def live_search(_query):
        raise KrdictUnavailableError("HTTP 500")

    result = run(search_with_english_fallback(
        "가다", "en", live_search, english_search_recording(english_calls)
    ))

    assert result == []
    assert english_calls == []


def test_fallback_errors_degrade_to_empty_instead_of_failing_the_lookup():
    async def live_search(_query):
        raise KrdictUnavailableError("HTTP 500")

    async def broken_english_search(_query):
        raise RuntimeError("snapshot missing")

    assert run(search_with_english_fallback("가다", "fr", live_search, broken_english_search)) == []


def test_mark_english_fallback_does_not_mutate_input():
    entries = [{"word": "가다"}]
    assert mark_english_fallback(entries) == [{"word": "가다", "fallback_language": "en"}]
    assert entries == [{"word": "가다"}]


def test_parse_krdict_search_items_returns_items():
    xml = (
        "<channel><total>2</total>"
        "<item><word>가다</word><sense><translation><trans_word>ir</trans_word>"
        "</translation></sense></item>"
        "<item><word>가다</word></item>"
        "</channel>"
    )
    items = parse_krdict_search_items(200, xml)
    assert [item.findtext("word") for item in items] == ["가다", "가다"]


def test_parse_krdict_search_items_empty_answer_is_not_an_error():
    assert parse_krdict_search_items(200, "<channel><total>0</total></channel>") == []


@pytest.mark.parametrize(
    "status_code, text",
    [
        (503, "Service Unavailable"),
        (200, "<html><body>maintenance"),
        (200, "<error><error_code>020</error_code><message>quota exceeded</message></error>"),
    ],
)
def test_parse_krdict_search_items_flags_unavailable_responses(status_code, text):
    with pytest.raises(KrdictUnavailableError):
        parse_krdict_search_items(status_code, text)
