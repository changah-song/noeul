"""/preprocess_chapter/ KRDICT caching: never cache a failure as "no entry"."""

from datetime import datetime, timedelta, timezone

import pytest

from word_lookup import (
    NEGATIVE_CACHE_MAX_AGE_DAYS,
    KrdictUnavailableError,
    is_reusable_cache_row,
    parse_krdict_first_entry,
)

FOUND = """<?xml version="1.0" encoding="UTF-8"?>
<channel><total>2</total>
<item><word>학교</word><origin>學校</origin><pos>명사</pos>
<sense><translation><trans_word><![CDATA[school^]]></trans_word></translation></sense></item>
<item><word>학교</word><pos>명사</pos></item>
</channel>"""

EMPTY = """<?xml version="1.0" encoding="UTF-8"?><channel><total>0</total></channel>"""

QUOTA_ERROR = """<?xml version="1.0" encoding="UTF-8"?>
<error><error_code>020</error_code><message>daily limit exceeded</message></error>"""


def test_first_entry_is_parsed_and_separator_stripped():
    assert parse_krdict_first_entry(200, FOUND) == {
        "hanja": "學校",
        "definition": "school",
        "pos": "명사",
    }


def test_entry_without_translation_or_origin_gets_placeholders():
    xml = "<channel><item><word>얘</word></item></channel>"
    assert parse_krdict_first_entry(200, xml) == {
        "hanja": "N/A",
        "definition": "N/A",
        "pos": "Unknown",
    }


def test_genuine_empty_answer_is_none():
    assert parse_krdict_first_entry(200, EMPTY) is None


@pytest.mark.parametrize("status,text", [
    (200, QUOTA_ERROR),       # quota exhausted, sent as HTTP 200
    (500, FOUND),             # server error
    (429, ""),                # rate limited
    (200, "<html>oops"),      # unparseable body
])
def test_failures_raise_instead_of_looking_like_no_entry(status, text):
    with pytest.raises(KrdictUnavailableError):
        parse_krdict_first_entry(status, text)


NOW = datetime(2026, 10, 14, 12, 0, tzinfo=timezone.utc)


def _sqlite_ts(dt):
    # SQLite CURRENT_TIMESTAMP format: naive UTC.
    return dt.astimezone(timezone.utc).replace(tzinfo=None).strftime("%Y-%m-%d %H:%M:%S")


def test_rows_with_a_definition_are_always_reusable():
    assert is_reusable_cache_row("school", _sqlite_ts(NOW - timedelta(days=900)), NOW)
    assert is_reusable_cache_row("N/A", None, NOW)


def test_recent_negative_row_is_reusable():
    assert is_reusable_cache_row(None, _sqlite_ts(NOW - timedelta(days=1)), NOW)


def test_expired_negative_row_is_refetched():
    old = NOW - timedelta(days=NEGATIVE_CACHE_MAX_AGE_DAYS, seconds=1)
    assert not is_reusable_cache_row(None, _sqlite_ts(old), NOW)


@pytest.mark.parametrize("last_updated", [None, "", "not a date"])
def test_negative_row_without_a_usable_timestamp_is_refetched(last_updated):
    assert not is_reusable_cache_row(None, last_updated, NOW)


def test_naive_now_is_treated_as_utc():
    naive_now = NOW.replace(tzinfo=None)
    assert is_reusable_cache_row(None, _sqlite_ts(NOW - timedelta(hours=1)), naive_now)
