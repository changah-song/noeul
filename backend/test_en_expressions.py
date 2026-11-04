"""English multi-word expressions (en_expressions.py, data/en_expressions.tsv):
"gave up" is give up, underlined and looked up as one word."""
import asyncio
import io

import pytest

import en_expressions
import en_learner_dict


def test_whitelist_rows_are_complete():
    expressions = en_expressions.load_expressions()
    assert 70 <= len(expressions) <= 120
    texts = [expression.text for expression in expressions]
    assert len(texts) == len(set(texts))
    for expression in expressions:
        assert expression.kind in {"fixed", "idiom", "phrasal"}, expression.text
        assert expression.cefr in en_expressions.CEFR_RANKS, expression.text
        assert expression.gloss_ko, expression.text
        assert expression.senses_en and len(expression.senses_en) == len(expression.senses_ko), expression.text
        assert " " in expression.text and len(expression.pattern) == len(expression.text.split()), expression.text


def test_parse_pattern_words():
    [expression] = en_expressions.parse_expressions(io.StringIO(
        "# comment\n"
        "expression\tkind\tpattern\tgloss_ko\tdefinition_ko\tdefinition_en\tcefr\tblock_next\tnotes\n"
        "make up one's mind\tidiom\t~make up one's mind\t결심하다\t결심하다.\tTo decide.\tb2\tNOUN,of\t\n"
    ))
    assert [word.kind for word in expression.pattern] == ["lemma", "word", "possessive", "word"]
    assert expression.cefr == "B2" and expression.level_rank == 4
    assert expression.block_pos == {"NOUN"} and expression.block_words == {"of"}
    assert en_expressions.level_payload(expression)["level_rank"] == 4


nlp = None


def _nlp():
    global nlp
    spacy = pytest.importorskip("spacy")
    if nlp is None:
        try:
            nlp = spacy.load("en_core_web_sm")
        except OSError:
            pytest.skip("en_core_web_sm is not installed")
    return nlp


def _found(text: str) -> list[tuple[str, str]]:
    doc = _nlp()(text)
    return [(match.surface, match.expression.text) for match in en_expressions.default_matcher().find(doc)]


def test_inflected_phrasal_verbs_match_contiguously():
    assert _found("He gave up the fight.") == [("gave up", "give up")]
    assert ("giving up", "give up") in _found("She was giving up hope.")
    assert ("looked after", "look after") in _found("The nurse looked after the children.")
    # Phase 1 is contiguous only: an object between verb and particle is no match.
    assert not any(stem == "give up" for _surface, stem in _found("He gave it up."))


def test_longest_expression_wins():
    assert _found("I do not mind it at all.")[-1] == ("at all", "at all")
    assert ("not at all", "not at all") in _found("It was not at all clear.")
    assert ("All at once", "all at once") in _found("All at once the lights went out.")
    # "put up with", not "put up" or anything shorter.
    assert ("put up with", "put up with") in _found("I cannot put up with this noise.")


def test_possessive_and_reflexive_slots():
    assert ("made up her mind", "make up one's mind") in _found("At last she made up her mind.")
    assert ("held his tongue", "hold one's tongue") in _found("He held his tongue.")
    assert ("beside herself", "beside oneself") in _found("She was beside herself with joy.")


def test_no_match_across_sentences_or_paragraphs():
    assert not any(stem == "give up" for _s, stem in _found("He gave. Up the hill they went."))
    assert not any(stem == "give up" for _s, stem in _found("All that he gave\nUp the hill they went."))
    # A run of spaces is still the same sentence.
    assert ("gave up", "give up") in _found("He gave  up.")


def test_blocked_literal_readings():
    # "at all" before a noun phrase is literal: looked at + all the people.
    assert not any(stem == "at all" for _s, stem in _found("He looked at all the people."))
    assert not any(stem == "after all" for _s, stem in _found("After all these years he came back."))
    assert ("After all", "after all") in _found("After all, he was right.")
    # "long" must be the verb.
    assert not any(stem == "long for" for _s, stem in _found("We waited so long for you."))
    assert ("longed for", "long for") in _found("They longed for home.")


main = pytest.importorskip("main", reason="main.py needs the full backend requirements")


def _preprocess(text: str, **kwargs) -> dict:
    _nlp()
    try:
        main.get_en_nlp()
    except main.ApiError:
        pytest.skip("en_core_web_sm is not installed")
    return asyncio.run(main._preprocess_en_core(text, interface_language="ko", **kwargs))


@pytest.mark.skipif(not en_learner_dict.is_installed(), reason="en_learner.db is not built")
def test_preprocess_returns_phrases_only_when_asked():
    text = "Of course he gave up. She was giving up too."
    without = _preprocess(text)
    assert not any(" " in (row.get("surface") or "") for row in without["surface_index"])
    assert not any(result["stem"] == "give up" for result in without["results"])

    out = _preprocess(text, expressions=True)
    rows = {(row["surface"], row["stem"]): row for row in out["surface_index"]}
    assert ("gave up", "give up") in rows and ("giving up", "give up") in rows
    assert ("Of course", "of course") in rows and ("of course", "of course") in rows
    # The phrase's level is its own CEFR level, on the surface row and the result.
    assert rows[("gave up", "give up")]["level_rank"] == en_expressions.expressions_by_text()["give up"].level_rank
    by_stem = {result["stem"]: result for result in out["results"]}
    assert by_stem["give up"]["gloss"] == "포기하다"
    assert by_stem["give up"]["level_source"] == en_expressions.LEVEL_SOURCE
    assert by_stem["of course"]["gloss"] == "물론"
    assert "포기하다" in by_stem["give up"]["definition"]
    # The words are still there as words.
    assert ("gave", "give") in rows
    # The book's level is graded from the words alone.
    assert out["stats"]["book_level"] == without["stats"]["book_level"]


@pytest.mark.skipif(not en_learner_dict.is_installed(), reason="en_learner.db is not built")
def test_dictionary_has_phrase_entries():
    entries = en_learner_dict.lookup_entries(["give up", "kick the bucket"], "ko")
    assert "kick the bucket" not in entries
    [entry] = entries["give up"]
    assert entry["pos"] == "phrasal verb"
    assert entry["equivalents"] == ["포기하다"]
    assert entry["translated_senses"][0].startswith("포기하다")


def test_fallback_entry_from_the_whitelist():
    expression = en_expressions.expressions_by_text()["in spite of"]
    korean = en_expressions.dictionary_entry(expression, "ko")
    assert korean["gloss"] == "~에도 불구하고" and korean["definition"]
    english = en_expressions.dictionary_entry(expression, "en")
    assert english["gloss"] is None and english["definition"] == "\n".join(expression.senses_en)
