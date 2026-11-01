"""English verb lemmas: spaCy's rule lemmatizer reads "shining" as "shin",
"hoping" as "hop" and "coping" as "cop". correct_en_verb_lemma puts the
silent e back; the doubled forms (hopping, running) keep the bare verb.

These need the server module (main.py and its packages); CI's light
environment skips them. The spaCy tests also need en_core_web_sm."""
import pytest

pytest.importorskip("fastapi")
main = pytest.importorskip("main")

VERBS = {
    "shin", "shine", "hop", "hope", "din", "dine", "rid", "ride", "tap", "tape",
    "plan", "plane", "star", "stare", "sing", "singe", "swing", "swinge",
    "ding", "dinge", "visit", "cop", "cope", "run", "sit", "site", "find", "found",
}
EXCEPTIONS = {
    "hopping": ["hop"], "hopped": ["hop"], "planned": ["plan"], "running": ["run"],
    "sitting": ["sit"], "starring": ["star"], "coping": ["cope"], "found": ["find"],
}


def lemma_of(word: str, spacy_lemma: str) -> str:
    return main.correct_en_verb_lemma(word, spacy_lemma, VERBS, EXCEPTIONS)


@pytest.mark.parametrize(
    ("word", "spacy_lemma", "expected"),
    [
        ("shining", "shin", "shine"),
        ("Shining", "shin", "shine"),
        ("hoping", "hop", "hope"),
        ("hoped", "hop", "hope"),
        ("hopes", "hop", "hope"),
        ("dining", "din", "dine"),
        ("riding", "rid", "ride"),
        ("rides", "rid", "ride"),
        ("taping", "tap", "tape"),
        ("planed", "plan", "plane"),
        ("staring", "star", "stare"),
        ("singed", "sing", "singe"),
        # Listed by spaCy, but its rules shadowed the listing.
        ("coping", "cop", "cope"),
    ],
)
def test_the_silent_e_comes_back(word, spacy_lemma, expected):
    assert lemma_of(word, spacy_lemma) == expected


@pytest.mark.parametrize(
    ("word", "spacy_lemma"),
    [
        # Doubled consonant: the bare verb.
        ("hopping", "hop"),
        ("hopped", "hop"),
        ("planned", "plan"),
        ("running", "run"),
        ("sitting", "sit"),
        ("starring", "star"),
        # "-ng" verbs take no e before -ing.
        ("singing", "sing"),
        ("swinging", "swing"),
        ("dinged", "ding"),
        # No e-form verb.
        ("visiting", "visit"),
        # Left as written (a base form): never reread through the exceptions.
        ("found", "found"),
    ],
)
def test_the_bare_verb_stays(word, spacy_lemma):
    assert lemma_of(word, spacy_lemma) == spacy_lemma


def _spacy_or_skip():
    pytest.importorskip("spacy")
    try:
        main.get_en_nlp()
    except main.ApiError:
        pytest.skip("en_core_web_sm is not installed")


def _stems_by_surface(text: str) -> dict[str, str]:
    _lemmas, surface_index, _pos = main.extract_en_lookup_tokens(text)
    return {entry["surface"]: entry["stem"] for entry in surface_index}


def test_the_reader_index_maps_inflected_verbs_to_their_verb():
    _spacy_or_skip()
    stems = _stems_by_surface(
        "The sun was shining on the lake. She was hoping he rides home. "
        "They were dining late and taping boxes. He was hopping and running. "
        "We were sitting and singing. She was coping well."
    )
    assert stems["shining"] == "shine"
    assert stems["hoping"] == "hope"
    assert stems["rides"] == "ride"
    assert stems["dining"] == "dine"
    assert stems["taping"] == "tape"
    assert stems["coping"] == "cope"
    assert stems["hopping"] == "hop"
    assert stems["running"] == "run"
    assert stems["sitting"] == "sit"
    assert stems["singing"] == "sing"
