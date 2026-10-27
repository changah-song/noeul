"""Tests for the checked explain-in-context flow (explain_graph.py).

The flow tests inject a fake model caller, so no network/API key is required.
"""

import pytest

import explain_graph as g


# ─── Pure helpers ─────────────────────────────────────────────────────────────


def test_p_known_matches_sigmoid_of_theta_minus_difficulty():
    # theta well above difficulty -> very likely known
    assert g.p_known_for(3.0, -3.0) > 0.99
    # theta well below difficulty -> very likely unknown
    assert g.p_known_for(-3.0, 3.0) < 0.01
    # equal -> 0.5
    assert g.p_known_for(0.0, 0.0) == pytest.approx(0.5)


@pytest.mark.parametrize("theta,diff,expected", [
    (None, None, g.FAMILIARITY_UNKNOWN),
    (1.0, None, g.FAMILIARITY_UNKNOWN),   # one signal missing -> unknown
    (2.0, -2.0, g.FAMILIARITY_FAMILIAR),
    (-2.0, 2.0, g.FAMILIARITY_UNFAMILIAR),
    (0.2, 0.0, g.FAMILIARITY_PARTIAL),
])
def test_familiarity_bucket_for(theta, diff, expected):
    assert g.familiarity_bucket_for(theta, diff) == expected


def test_familiarity_from_p_known_boundaries():
    assert g.familiarity_from_p_known(None) == g.FAMILIARITY_UNKNOWN
    assert g.familiarity_from_p_known(0.0) == g.FAMILIARITY_UNFAMILIAR
    assert g.familiarity_from_p_known(0.5) == g.FAMILIARITY_PARTIAL
    assert g.familiarity_from_p_known(0.99) == g.FAMILIARITY_FAMILIAR


def test_bool_is_not_treated_as_a_number():
    # Guards against Python's bool-is-int trap poisoning grounding.
    assert g.p_known_for(True, False) is None


def test_parse_contextual_explanation_tagged():
    parsed = g.parse_contextual_explanation(
        "<lemma>가다</lemma><gloss>to go</gloss><explanation>Here it means to leave.</explanation>"
    )
    assert parsed == {"lemma": "가다", "gloss": "to go", "explanation": "Here it means to leave."}


def test_parse_contextual_explanation_untagged_fallback():
    parsed = g.parse_contextual_explanation("just a blob of text")
    assert parsed["explanation"] == "just a blob of text"
    assert parsed["lemma"] is None and parsed["gloss"] is None


def test_grounded_prompt_layers_in_hints():
    prompt = g.build_grounded_prompt(
        target_language_name="Korean",
        interface_language_name="English",
        familiarity=g.FAMILIARITY_FAMILIAR,
        hanja="學校",
        anchor_words=[{"word": "학생", "gloss": "student"}],
        issues=["the <gloss> is longer than 5 words"],
    )
    assert "already knows" in prompt          # familiarity guidance
    assert "學校" in prompt                    # hanja bridge
    assert "학생 (student)" in prompt          # anchor word
    assert "previous attempt" in prompt       # refine issues
    assert "<lemma>" in prompt and "<gloss>" in prompt and "<explanation>" in prompt


def test_grounded_prompt_collapses_without_hints():
    prompt = g.build_grounded_prompt(
        target_language_name="Korean",
        interface_language_name="English",
        familiarity=g.FAMILIARITY_UNKNOWN,
    )
    assert "already knows" not in prompt
    assert "previous attempt" not in prompt
    assert "not in the dictionary" not in prompt.lower()
    assert "dictionary lists these senses" not in prompt.lower()
    assert "<explanation>" in prompt


def test_grounded_prompt_includes_dictionary_senses():
    prompt = g.build_grounded_prompt(
        target_language_name="Korean",
        interface_language_name="English",
        familiarity=g.FAMILIARITY_PARTIAL,
        dictionary_found=True,
        dictionary_senses=[
            {"pos": "noun", "definition": "boat; ship"},
            {"pos": "noun", "definition": "stomach; belly"},
            {"definition": ""},  # empty sense is skipped
        ],
    )
    assert "dictionary lists these senses" in prompt.lower()
    assert "boat; ship" in prompt
    assert "stomach; belly" in prompt
    assert "1)" in prompt and "2)" in prompt
    assert "3)" not in prompt              # the empty sense was skipped
    assert "if none of them fit" in prompt.lower()
    assert "not in the dictionary" not in prompt.lower()


def test_grounded_prompt_flags_missing_dictionary():
    prompt = g.build_grounded_prompt(
        target_language_name="Korean",
        interface_language_name="English",
        familiarity=g.FAMILIARITY_UNFAMILIAR,
        dictionary_found=False,
        dictionary_senses=[],
    )
    assert "not in the dictionary" in prompt.lower()
    assert "dictionary lists these senses" not in prompt.lower()


def test_format_senses_skips_empty_and_caps():
    assert g._format_senses(None) == ""
    assert g._format_senses([{"definition": ""}, {"definition": "   "}]) == ""
    out = g._format_senses([{"definition": f"sense {i}"} for i in range(10)], limit=3)
    assert out.count("\n") == 2  # exactly 3 lines


# ─── Checked flow (draft → verify → refine) ───────────────────────────────────

def test_known_lemma_replaces_the_lemma_tag():
    prompt = g.build_grounded_prompt(
        target_language_name="Korean",
        interface_language_name="English",
        familiarity=g.FAMILIARITY_UNKNOWN,
        known_lemma="눕다",
    )
    assert "base form of this word is 눕다" in prompt
    assert "<lemma>" not in prompt
    assert "<gloss>" in prompt and "<explanation>" in prompt
    # Without it, the model is still asked for its own base form.
    assert "<lemma>" in g.build_grounded_prompt(
        target_language_name="Korean",
        interface_language_name="English",
        familiarity=g.FAMILIARITY_UNKNOWN,
    )


@pytest.mark.parametrize("value,expected", [
    ("눕다", "눕다"),
    ("  눕다 ", "눕다"),
    ("", None),
    (None, None),
    (42, None),
    ("x" * 65, None),
    ("<lemma>", None),
])
def test_clean_known_lemma(value, expected):
    assert g.clean_known_lemma(value) == expected


def test_parse_partial_explanation_streams_in_order():
    assert g.parse_partial_explanation("") == {"gloss": None, "explanation": None}
    # Gloss is withheld until its closing tag arrives.
    assert g.parse_partial_explanation("<gloss>to lie")["gloss"] is None
    partial = g.parse_partial_explanation("<gloss>to lie down</gloss>\n<explanation>Here it")
    assert partial == {"gloss": "to lie down", "explanation": "Here it"}
    # A trailing fragment of the closing tag is held back, not shown.
    assert g.parse_partial_explanation("<gloss>x</gloss><explanation>Done.</expl")["explanation"] == "Done."
    # A '<' that is not the closing tag is real text.
    assert g.parse_partial_explanation("<gloss>x</gloss><explanation>a <b")["explanation"] == "a <b"
    done = g.parse_partial_explanation("<gloss>x</gloss><explanation>All of it.</explanation>")
    assert done["explanation"] == "All of it."


GOOD = (
    "<lemma>가다</lemma><gloss>to go</gloss>"
    "<explanation>Here 갔어 is the past tense of 가다; she left.</explanation>"
)
BAD_GLOSS = (
    # 8 words — over _MAX_GLOSS_WORDS (6), so verify must flag it as too long.
    "<lemma>가다</lemma><gloss>to go to a place far far away</gloss>"
    "<explanation>It means to leave, past tense.</explanation>"
)
MISSING_LEMMA = "<gloss>to go</gloss><explanation>It means to leave here.</explanation>"


def _scripted_caller(outputs):
    """Return (caller, calls). Yields `outputs` in order; records each prompt."""
    calls = []
    it = iter(outputs)

    def caller(system, user):
        calls.append({"system": system, "user": user})
        return next(it), {"input_tokens": 100, "output_tokens": 50}

    return caller, calls


def _run(caller, **kwargs):
    return g.run_explain_graph(
        caller,
        word=kwargs.pop("word", "갔어"),
        sentence=kwargs.pop("sentence", "그녀는 갔어."),
        target_language_name="Korean",
        interface_language_name="English",
        **kwargs,
    )


def test_happy_path_single_call():
    caller, calls = _scripted_caller([GOOD])
    result = _run(caller, p_known=0.9)
    assert result["lemma"] == "가다"
    assert result["gloss"] == "to go"
    assert result["familiarity"] == g.FAMILIARITY_FAMILIAR
    assert len(calls) == 1
    assert len(result["usages"]) == 1


def test_bad_gloss_triggers_one_refine_with_issue_fed_back():
    caller, calls = _scripted_caller([BAD_GLOSS, GOOD])
    result = _run(caller, p_known=0.1)
    assert len(calls) == 2
    assert result["gloss"] == "to go"
    assert "previous attempt" in calls[1]["system"].lower()
    assert "gloss" in calls[1]["system"].lower()


def test_refine_is_capped():
    # Model never fixes the gloss; the flow must still stop after one refine.
    caller, calls = _scripted_caller([BAD_GLOSS, BAD_GLOSS, GOOD])
    _run(caller)
    assert len(calls) == g.REFINE_MAX_ATTEMPTS + 1


def test_missing_lemma_is_refined():
    caller, calls = _scripted_caller([MISSING_LEMMA, GOOD])
    result = _run(caller)
    assert len(calls) == 2
    assert "lemma" in calls[1]["system"].lower()
    assert result["lemma"] == "가다"


def test_direct_p_known_overrides_theta():
    caller, _ = _scripted_caller([GOOD])
    result = _run(caller, p_known=0.1, theta=3.0, word_difficulty=-3.0)
    assert result["familiarity"] == g.FAMILIARITY_UNFAMILIAR


def test_grounding_injected_into_draft_prompt():
    caller, calls = _scripted_caller([GOOD])
    _run(
        caller,
        word="학교",
        sentence="학교에 갔어.",
        p_known=0.5,
        hanja="學校",
        anchor_words=[{"word": "학생", "gloss": "student"}],
    )
    system = calls[0]["system"]
    assert "學校" in system
    assert "학생" in system and "student" in system


def test_known_lemma_overrides_model_lemma_and_skips_lemma_check():
    # The model's own (wrong) base form is ignored, and a reply without <lemma>
    # is not sent back for refinement when the client supplied the base form.
    caller, calls = _scripted_caller([
        "<gloss>to lie down</gloss><explanation>Here 누워 means lying down.</explanation>",
    ])
    result = _run(caller, word="누워", sentence="그는 침대에 누워 책을 읽었다.", known_lemma="눕다")
    assert result["lemma"] == "눕다"
    assert len(calls) == 1
    assert "<lemma>" not in calls[0]["system"]
    assert "눕다" in calls[0]["system"]


def test_failed_refine_keeps_the_draft_usage_for_spend_accounting():
    draft_usage = {"input_tokens": 100, "output_tokens": 50}
    calls = []

    def caller(system, user):
        calls.append(system)
        if len(calls) == 1:
            return BAD_GLOSS, draft_usage
        raise TimeoutError("refine timed out")

    with pytest.raises(g.ExplainGraphError) as excinfo:
        _run(caller, p_known=0.1)
    assert excinfo.value.usages == [draft_usage]
    assert isinstance(excinfo.value.__cause__, TimeoutError)


def test_failed_first_call_reports_no_usages():
    def caller(system, user):
        raise ConnectionError("down")

    with pytest.raises(g.ExplainGraphError) as excinfo:
        _run(caller)
    assert excinfo.value.usages == []


class _Snapshot:
    usage = {"input_tokens": 120, "output_tokens": 7}


class _StreamWithSnapshot:
    current_message_snapshot = _Snapshot()


class _StreamBeforeMessageStart:
    @property
    def current_message_snapshot(self):
        raise AssertionError("no message_start yet")


def test_stream_snapshot_usage():
    assert g.stream_snapshot_usage(_StreamWithSnapshot()) == _Snapshot.usage
    assert g.stream_snapshot_usage(_StreamBeforeMessageStart()) is None
    assert g.stream_snapshot_usage(None) is None


def test_selection_prompt_covers_partial_words_and_phrases():
    prompt = g.build_selection_prompt(target_language_name="English", interface_language_name="Korean")
    # It asks the model to complete a cut-off word and to scale to clauses.
    assert "Part of a word" in prompt
    assert "translation" in prompt
    assert "<lemma>" in prompt and "<gloss>" in prompt and "<explanation>" in prompt
    assert "Korean" in prompt and "English" in prompt


def test_selection_user_message_names_the_selection():
    assert g.user_message_for_selection("Gabl", "Anne of Green Gables").startswith("Selected text: Gabl")


def test_selection_reply_parses_like_a_word_reply():
    raw = "<lemma>Gables</lemma><gloss>박공지붕</gloss><explanation>집 이름의 일부입니다.</explanation>"
    parsed = g.parse_contextual_explanation(raw)
    assert parsed == {"lemma": "Gables", "gloss": "박공지붕", "explanation": "집 이름의 일부입니다."}
