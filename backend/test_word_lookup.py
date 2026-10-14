"""POST /krdict_lookup/ core: stemming + dictionary search in one request."""

import asyncio

import pytest

from word_lookup import LOOKUP_STOP_STEMS, lookup_surface, select_lookup_stems


def run(coro):
    return asyncio.run(coro)


def test_select_lookup_stems_drops_stop_stems_blanks_and_duplicates():
    assert select_lookup_stems(["가다", "하다", " ", None, "가다", " 먹다 "]) == ["가다", "먹다"]


def test_select_lookup_stems_caps_at_the_query_limit():
    assert select_lookup_stems(["가", "나", "다"], max_stems=2) == ["가", "나"]


def test_stop_stems_match_the_app():
    # Keep in sync with STOP_STEMS in frontend/services/dictionaryLookup.js.
    assert LOOKUP_STOP_STEMS == {"하다", "되다", "있다", "없다", "이다", "아니다", "같다", "보다"}


def test_lookup_surface_returns_stems_with_aligned_results():
    stemmed = []
    searched = []

    async def stem_fn(text):
        stemmed.append(text)
        return ["먹다", "있다", "아름답다"]

    async def search_fn(stem):
        searched.append(stem)
        return [{"word": stem, "transWord": f"def of {stem}"}]

    result = run(lookup_surface(" 먹었습니다 ", stem_fn, search_fn))

    assert stemmed == ["먹었습니다"]
    assert sorted(searched) == ["먹다", "아름답다"]
    assert result == {
        "stems": ["먹다", "아름답다"],
        "results": [
            [{"word": "먹다", "transWord": "def of 먹다"}],
            [{"word": "아름답다", "transWord": "def of 아름답다"}],
        ],
    }


def test_lookup_surface_searches_stems_concurrently():
    async def stem_fn(_text):
        return ["가다", "오다", "자다"]

    running = 0
    peak = 0

    async def search_fn(stem):
        nonlocal running, peak
        running += 1
        peak = max(peak, running)
        await asyncio.sleep(0.01)
        running -= 1
        return [{"word": stem}]

    run(lookup_surface("x", stem_fn, search_fn))
    assert peak == 3


def test_lookup_surface_runs_before_search_with_the_stems_and_can_abort():
    seen = []

    async def stem_fn(_text):
        return ["가다"]

    async def search_fn(_stem):
        raise AssertionError("search must not run after before_search raises")

    async def before_search(stems):
        seen.append(stems)
        raise RuntimeError("quota")

    with pytest.raises(RuntimeError):
        run(lookup_surface("갔다", stem_fn, search_fn, before_search=before_search))
    assert seen == [["가다"]]


def test_lookup_surface_skips_search_when_nothing_to_look_up():
    async def stem_fn(_text):
        return ["하다"]

    async def search_fn(_stem):
        raise AssertionError("no search for stop stems")

    assert run(lookup_surface("했다", stem_fn, search_fn)) == {"stems": [], "results": []}


def test_lookup_surface_blank_surface_skips_stemming():
    async def stem_fn(_text):
        raise AssertionError("no stemming for a blank surface")

    assert run(lookup_surface("   ", stem_fn, stem_fn)) == {"stems": [], "results": []}
