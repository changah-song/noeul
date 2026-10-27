"""Checked explain-in-context flow.

    ground -> draft -> verify -> (refine -> verify)? -> done

- ground  Deterministic, no model spend. Turns the learner's ability
          (``theta``) and the tapped word's ``word_difficulty`` into a
          P(known) familiarity bucket, and carries the grounding hints
          (hanja bridge, known-word anchors) forward.
- draft   One model call. Emits the ``<lemma>/<gloss>/<explanation>``
          contract, calibrated to the learner's familiarity and grounded in
          the hints.
- verify  Deterministic checks (no model spend): required tags present, the
          flashcard gloss is short enough, explanation is non-trivial.
- refine  At most ``REFINE_MAX_ATTEMPTS`` follow-up model calls, fed the
          verifier's issues, to fix a bad draft.

It is a plain loop (it used to be a LangGraph graph; the flow is linear with one
bounded retry, so the framework added a dependency and nothing else). The
caller injects ``model_caller``, so this module has no dependency on the
Anthropic SDK or FastAPI and is unit-tested with a fake caller.
"""

from __future__ import annotations

import math
import re
from typing import Any, Callable, TypedDict

# A model call: (system_prompt, user_message) -> (raw_text, usage_or_None).
# ``usage`` is whatever the transport wants to hand back for spend accounting;
# the graph only collects it, never inspects it.
ModelCaller = Callable[[str, str], "tuple[str, Any]"]


class ExplainGraphError(Exception):
    """A model call inside the flow failed.

    ``usages`` holds the usage of every call that completed before the failure
    (e.g. the draft when the refine call raised), so the caller can still record
    that spend instead of losing it with the exception.
    """

    def __init__(self, cause: BaseException, usages: list):
        super().__init__(f"{cause.__class__.__name__}: {cause}")
        self.usages = list(usages)


def stream_snapshot_usage(stream: Any) -> Any:
    """Best-effort usage from an Anthropic message stream that may have ended early.

    ``current_message_snapshot`` carries input tokens from message_start and
    output tokens as message_delta events arrive; before message_start it is
    unset (the SDK raises), in which case nothing was billed worth recording.
    """
    if stream is None:
        return None
    try:
        snapshot = stream.current_message_snapshot
    except Exception:  # noqa: BLE001 - no snapshot yet
        return None
    return getattr(snapshot, "usage", None)

# One draft + at most this many refine passes. Caps worst-case model spend per
# lookup at REFINE_MAX_ATTEMPTS + 1 calls.
REFINE_MAX_ATTEMPTS = 1

# P(known) cut points for the familiarity buckets. Kept coarse (3 live buckets)
# so they double as a low-cardinality cache-key dimension without shredding the
# hit rate. ``"unknown"`` is a fourth bucket used only when we have no ability
# signal at all (behaves like the pre-grounding prompt).
_UNFAMILIAR_MAX = 0.35
_PARTIAL_MAX = 0.70

FAMILIARITY_UNKNOWN = "unknown"
FAMILIARITY_UNFAMILIAR = "unfamiliar"
FAMILIARITY_PARTIAL = "partial"
FAMILIARITY_FAMILIAR = "familiar"

_EXPLAIN_TAG_PATTERN = {
    tag: re.compile(rf"<{tag}>(.*?)</{tag}>", re.DOTALL | re.IGNORECASE)
    for tag in ("lemma", "gloss", "explanation")
}

# A gloss is meant to be a <=5-word flashcard label. We only flag space-delimited
# glosses (CJK glosses have no spaces and are exempt) and allow a little slack.
_MAX_GLOSS_WORDS = 6


def _sigmoid(x: float) -> float:
    # Matches abilityModel.js `sigmoid`; clamped domain avoids overflow warnings.
    return 1.0 / (1.0 + math.exp(-max(-60.0, min(60.0, x))))


def p_known_for(theta: Any, word_difficulty: Any) -> float | None:
    """P(known) for the tapped word, or None when either signal is missing.

    Mirrors abilityModel.js `pKnown(theta, difficulty)` = sigmoid(theta - d).
    """
    if not isinstance(theta, (int, float)) or isinstance(theta, bool):
        return None
    if not isinstance(word_difficulty, (int, float)) or isinstance(word_difficulty, bool):
        return None
    return _sigmoid(float(theta) - float(word_difficulty))


def familiarity_bucket_for(theta: Any, word_difficulty: Any) -> str:
    """Coarse familiarity bucket. Also used by the endpoint as a cache-key part."""
    return familiarity_from_p_known(p_known_for(theta, word_difficulty))


def familiarity_from_p_known(p_known: float | None) -> str:
    if p_known is None:
        return FAMILIARITY_UNKNOWN
    if p_known < _UNFAMILIAR_MAX:
        return FAMILIARITY_UNFAMILIAR
    if p_known < _PARTIAL_MAX:
        return FAMILIARITY_PARTIAL
    return FAMILIARITY_FAMILIAR


def parse_contextual_explanation(raw: str) -> dict[str, str | None]:
    """Pull the <lemma>/<gloss>/<explanation> fields out of the model output.

    Falls back gracefully: if the model ignored the tag format, the whole
    response is treated as the explanation with no lemma/gloss, preserving the
    original single-blob contract.
    """
    fields = {
        tag: (match.group(1).strip() if (match := pattern.search(raw)) else "")
        for tag, pattern in _EXPLAIN_TAG_PATTERN.items()
    }
    explanation = fields["explanation"] or (raw or "").strip()
    return {
        "explanation": explanation,
        "gloss": fields["gloss"] or None,
        "lemma": fields["lemma"] or None,
    }


_OPEN_EXPLANATION = "<explanation>"
_CLOSE_EXPLANATION = "</explanation>"


def parse_partial_explanation(raw: str) -> dict[str, str | None]:
    """Best-effort fields from a still-streaming tagged response.

    Returns ``gloss`` only once its closing tag has arrived (so the client never
    shows a half-written flashcard label), and ``explanation`` as the text
    streamed so far inside ``<explanation>``, holding back any trailing fragment
    that could be the start of the closing tag. Untagged output yields nothing
    here; the final ``parse_contextual_explanation`` handles that fallback.
    """
    raw = raw or ""
    gloss_match = _EXPLAIN_TAG_PATTERN["gloss"].search(raw)
    gloss = gloss_match.group(1).strip() if gloss_match else None

    explanation: str | None = None
    start = raw.lower().find(_OPEN_EXPLANATION)
    if start != -1:
        body = raw[start + len(_OPEN_EXPLANATION):]
        end = body.lower().find(_CLOSE_EXPLANATION)
        if end != -1:
            body = body[:end]
        else:
            cut = body.rfind("<")
            if cut != -1 and _CLOSE_EXPLANATION.startswith(body[cut:].lower()):
                body = body[:cut]
        explanation = body.lstrip()

    return {"gloss": gloss or None, "explanation": explanation}


# ─── Prompt construction ──────────────────────────────────────────────────────

_FAMILIARITY_GUIDANCE = {
    FAMILIARITY_UNFAMILIAR: (
        "The learner very likely does NOT know this word yet. Explain it plainly "
        "and assume no prior familiarity."
    ),
    FAMILIARITY_PARTIAL: (
        "The learner may partly know this word. Confirm its core meaning briefly, "
        "then spend most of the explanation on its specific sense in this sentence."
    ),
    FAMILIARITY_FAMILIAR: (
        "The learner very likely already knows this word's basic meaning. Skip the "
        "basics and focus on the nuance or specific sense it carries in THIS sentence."
    ),
}

_LEMMA_TAG = """<lemma>The dictionary base form of the tapped word, in {target}: strip conjugation, inflected endings, and attached particles. If it is already the base form, repeat it. Base form only.</lemma>
"""

_GLOSS_EXPLANATION_TAGS = """<gloss>A clean standalone definition in {interface}, at most 5 words, no full sentence. This is saved as the learner's flashcard.</gloss>
<explanation>One or two short sentences in {interface}, 30 words at most, that clarify what the word means in THIS sentence. Meaning only: never describe grammar — no particles, endings, tenses, conjugation or parts of speech. No preamble, no generic dictionary entry.</explanation>"""

# Full contract (the model supplies the base form), and the short one used when
# the client already resolved the dictionary form: the model then skips <lemma>,
# which removes a source of disagreement with the lookup panel and gets the
# learner-facing <gloss> streaming sooner.
_TAG_CONTRACT = (
    "Reply with exactly these three tags in this order and nothing else — no "
    "preamble, labels, quotes, or markdown:\n\n" + _LEMMA_TAG + _GLOSS_EXPLANATION_TAGS
)
_TAG_CONTRACT_KNOWN_LEMMA = (
    "Reply with exactly these two tags in this order and nothing else — no "
    "preamble, labels, quotes, or markdown:\n\n" + _GLOSS_EXPLANATION_TAGS
)

# Bound on a client-supplied dictionary form; anything longer is not a headword.
MAX_KNOWN_LEMMA_LEN = 64


def clean_known_lemma(value: Any) -> str | None:
    """The client's dictionary form for the tapped word, or None if unusable."""
    if not isinstance(value, str):
        return None
    lemma = " ".join(value.split())
    if not lemma or len(lemma) > MAX_KNOWN_LEMMA_LEN or "<" in lemma or ">" in lemma:
        return None
    return lemma


def build_grounded_prompt(
    *,
    target_language_name: str,
    interface_language_name: str,
    familiarity: str,
    hanja: str | None = None,
    anchor_words: list[dict] | None = None,
    dictionary_found: bool | None = None,
    dictionary_senses: list[dict] | None = None,
    issues: list[str] | None = None,
    known_lemma: str | None = None,
) -> str:
    """System prompt for the draft/refine nodes, layered with grounding.

    Grounding lines are additive and each is safe to omit, so the prompt collapses
    to the original ungrounded instruction when no signals are available.

    ``known_lemma`` is the dictionary form the client's lookup already resolved.
    When given, the model is told to use it and not to emit its own <lemma>, so
    the explanation never names a different base form than the panel shows.
    """
    lines = [
        f"You are an expert {target_language_name} tutor. A learner reading "
        f"{target_language_name} tapped a word or phrase and wants its meaning "
        "*in this sentence*, not just the dictionary definition.",
    ]

    guidance = _FAMILIARITY_GUIDANCE.get(familiarity)
    if guidance:
        lines.append(guidance)

    if hanja and str(hanja).strip():
        lines.append(
            f"This word is written with the characters {str(hanja).strip()}. Where it "
            "aids understanding, briefly connect the meaning to those characters."
        )

    anchors = _format_anchor_words(anchor_words)
    if anchors:
        lines.append(
            "The learner already knows these related words: "
            f"{anchors}. Where it is natural, anchor the explanation to one of them "
            "(e.g. \"like X, but ...\"). Never force a connection that is not real."
        )

    # Dictionary grounding. The client already looked this word up on-device, so
    # we reuse that result rather than re-querying: pass the senses it found, or
    # tell the model the dictionary came up empty. Two branches, matching why a
    # learner reaches for the AI explanation in the first place — either the
    # dictionary entry exists but its fit is unclear, or there is no entry at all.
    senses = _format_senses(dictionary_senses)
    if senses:
        lines.append(
            "The dictionary lists these senses for this word:\n"
            f"{senses}\n"
            "Pick the sense that fits THIS sentence and explain how it applies. "
            "If none of them fit, say so plainly and explain the actual meaning "
            "from context — the dictionary can be incomplete or wrong."
        )
    elif dictionary_found is False:
        lines.append(
            "This word is NOT in the dictionary — it may be slang, archaic, a "
            "rare or dialectal form, a proper noun, or a coinage. Explain it from "
            "the sentence context, and briefly note that it isn't a standard "
            "dictionary entry."
        )

    if known_lemma:
        lines.append(
            f"The dictionary base form of this word is {known_lemma}. Whenever you "
            "mention the base form, write exactly that form, never a different "
            "spelling or a reconstructed form."
        )

    if issues:
        lines.append(
            "A previous attempt had these problems: "
            + "; ".join(str(issue) for issue in issues if issue)
            + ". Produce a corrected version that fixes them."
        )

    contract = _TAG_CONTRACT_KNOWN_LEMMA if known_lemma else _TAG_CONTRACT
    lines.append(contract.format(target=target_language_name, interface=interface_language_name))
    return "\n\n".join(lines)


def _format_anchor_words(anchor_words: list[dict] | None, limit: int = 4) -> str:
    if not anchor_words:
        return ""
    formatted = []
    for item in anchor_words[:limit]:
        if not isinstance(item, dict):
            continue
        word = str(item.get("word") or item.get("lemma") or "").strip()
        if not word:
            continue
        gloss = str(item.get("gloss") or "").strip()
        formatted.append(f"{word} ({gloss})" if gloss else word)
    return ", ".join(formatted)


def _format_senses(dictionary_senses: list[dict] | None, limit: int = 6) -> str:
    """Render the client's already-fetched dictionary senses as a numbered list.

    Each sense is ``{headword, pos, definition}`` (all optional). Senses with no
    definition carry no meaning, so they are skipped; an all-empty list returns
    "" and the prompt's dictionary block collapses.
    """
    if not dictionary_senses:
        return ""
    lines: list[str] = []
    for item in dictionary_senses:
        if not isinstance(item, dict):
            continue
        definition = str(item.get("definition") or "").strip()
        if not definition:
            continue
        pos = str(item.get("pos") or "").strip()
        prefix = f"[{pos}] " if pos else ""
        lines.append(f"{len(lines) + 1}) {prefix}{definition}")
        if len(lines) >= limit:
            break
    return "\n".join(lines)


# ─── Graph state + nodes ──────────────────────────────────────────────────────


class ExplainState(TypedDict, total=False):
    # Inputs
    word: str
    sentence: str
    target_language_name: str
    interface_language_name: str
    theta: float | None
    word_difficulty: float | None
    hanja: str | None
    anchor_words: list[dict]
    # Dictionary result the client already fetched on-device (reused, not re-queried).
    dictionary_found: bool | None
    dictionary_senses: list[dict]
    # Dictionary form the client's lookup resolved; authoritative when present.
    known_lemma: str | None
    # Derived by ``ground``
    p_known: float | None
    familiarity: str
    # Working state
    attempts: int
    issues: list[str]
    lemma: str | None
    gloss: str | None
    explanation: str | None
    # Spend accounting (one entry per model call)
    usages: list


def user_message_for(word: str, sentence: str) -> str:
    return f"Word: {word}\n\nSentence: {sentence}"


def user_message_for_selection(selection: str, sentence: str) -> str:
    return f"Selected text: {selection}\n\nSentence: {sentence}"


def build_selection_prompt(*, target_language_name: str, interface_language_name: str) -> str:
    """System prompt for a long-press selection (the reader's selection toolbar).

    Unlike a tapped word, a selection can be anything from part of a word to a
    whole sentence, chosen character by character. The model first decides what
    the reader is pointing at (completing a cut-off word), then explains it at
    the right size: a word's sense, an idiom's figurative meaning, a clause's
    translation. The tags match the word contract, so parsing and streaming are
    shared; <lemma> carries the expression explained (what the panel shows and
    a saved card keeps).
    """
    target = target_language_name
    interface = interface_language_name
    return f"""You are an expert {target} tutor. A learner reading {target} selected some text and wants to understand it *in this sentence*. The selection was dragged by hand, so it may include stray punctuation, and older app versions may cut a word off.

First decide what the learner is pointing at:
- Part of a word (e.g. "Gabl" in "Gables"): the whole word it belongs to.
- A single word: that word as used here.
- An idiom, fixed expression, phrasal verb or collocation (the selection may be part of one): the whole expression.
- A name (a person, place, title): the name.
- A longer phrase, clause or sentence: the selection itself.

Reply with exactly these three tags in this order and nothing else — no preamble, labels, quotes, or markdown:

<lemma>The text you are explaining, in {target}, exactly as it appears in the sentence: the selection itself. Only extend it to complete a cut-off word, or to the whole expression when the selection is part of an idiom or fixed phrase; never widen a phrase or clause to more of the sentence. No base form, no translation.</lemma>
<gloss>Its meaning, written in {interface} (never in {target}, even for an idiom). For a word or expression: a clean definition, at most 6 words, no full sentence. For a phrase, clause or sentence: a natural, faithful translation of it as used here. This is saved as the learner's flashcard.</gloss>
<explanation>Two or three short sentences in {interface}, 50 words at most, on what it means in THIS sentence. For an idiom or fixed expression, say that it is one and give its figurative meaning. For a phrase or clause, point out the words or images that carry its meaning, any nuance or tone, and how it connects to the rest of the sentence. For a name, say what it refers to here. Meaning only: never describe grammar — no particles, endings, tenses, conjugation or parts of speech. No preamble, no generic dictionary entry.</explanation>"""


def _user_message(state: ExplainState) -> str:
    return user_message_for(state.get("word", ""), state.get("sentence", ""))


def _ground_node(state: ExplainState) -> dict:
    # Prefer a P(known) the client computed directly (its cached per-word value);
    # otherwise derive it from ability + difficulty. Either way, absent signals
    # collapse to the "unknown" bucket and the ungrounded prompt.
    p_known = state.get("p_known")
    if not isinstance(p_known, (int, float)) or isinstance(p_known, bool):
        p_known = p_known_for(state.get("theta"), state.get("word_difficulty"))
    return {
        "p_known": p_known,
        "familiarity": familiarity_from_p_known(p_known),
        "attempts": 0,
        "issues": [],
        "usages": [],
    }


def _verify_issues(state: ExplainState) -> list[str]:
    issues: list[str] = []
    if not (state.get("lemma") or "").strip():
        issues.append("missing the <lemma> base form")
    gloss = (state.get("gloss") or "").strip()
    if not gloss:
        issues.append("missing the <gloss> flashcard label")
    elif " " in gloss and len(gloss.split()) > _MAX_GLOSS_WORDS:
        issues.append("the <gloss> is longer than 5 words; make it a short label")
    explanation = (state.get("explanation") or "").strip()
    if len(explanation) < 10:
        issues.append("the <explanation> is empty or too short")
    return issues


def _route_after_verify(state: ExplainState) -> str:
    issues = state.get("issues") or []
    if issues and int(state.get("attempts", 0)) <= REFINE_MAX_ATTEMPTS:
        return "refine"
    return "end"


def run_explain_graph(
    model_caller: ModelCaller,
    *,
    word: str,
    sentence: str,
    target_language_name: str,
    interface_language_name: str,
    p_known: Any = None,
    theta: Any = None,
    word_difficulty: Any = None,
    hanja: str | None = None,
    anchor_words: list[dict] | None = None,
    dictionary_found: bool | None = None,
    dictionary_senses: list[dict] | None = None,
    known_lemma: str | None = None,
) -> dict:
    """Run the checked flow and return the parsed result + spend usages.

    ``model_caller(system, user) -> (raw_text, usage)`` makes one model call.
    ``p_known`` (0..1) is the preferred familiarity signal; when absent it is
    derived from ``theta`` and ``word_difficulty``. ``dictionary_found`` /
    ``dictionary_senses`` carry the on-device lookup the client already did:
    senses ground the model toward the right meaning, and ``found=False`` tells
    it the word is not a standard dictionary entry. Returns
    ``{lemma, gloss, explanation, familiarity, usages}``; ``usages`` holds one
    entry per model call so the caller can record spend for each.
    """
    state: ExplainState = {
        "word": word,
        "sentence": sentence,
        "target_language_name": target_language_name,
        "interface_language_name": interface_language_name,
        "p_known": p_known,
        "theta": theta,
        "word_difficulty": word_difficulty,
        "hanja": hanja,
        "anchor_words": anchor_words or [],
        "dictionary_found": dictionary_found,
        "dictionary_senses": dictionary_senses or [],
        "known_lemma": known_lemma,
    }
    state.update(_ground_node(state))

    issues: list[str] | None = None
    while True:
        system_prompt = build_grounded_prompt(
            target_language_name=target_language_name,
            interface_language_name=interface_language_name,
            familiarity=state["familiarity"],
            hanja=hanja,
            anchor_words=state["anchor_words"],
            dictionary_found=dictionary_found,
            dictionary_senses=state["dictionary_senses"],
            issues=issues,
            known_lemma=known_lemma,
        )
        try:
            raw, usage = model_caller(system_prompt, _user_message(state))
        except Exception as error:
            raise ExplainGraphError(error, state["usages"]) from error
        parsed = parse_contextual_explanation(raw or "")
        state.update({
            # The client's dictionary form wins over anything the model wrote.
            "lemma": known_lemma or parsed["lemma"],
            "gloss": parsed["gloss"],
            "explanation": parsed["explanation"],
            "attempts": state["attempts"] + 1,
            "usages": [*state["usages"], usage],
        })
        state["issues"] = _verify_issues(state)
        if _route_after_verify(state) != "refine":
            break
        issues = state["issues"]

    return {
        "lemma": state.get("lemma"),
        "gloss": state.get("gloss"),
        "explanation": state.get("explanation"),
        "familiarity": state.get("familiarity", FAMILIARITY_UNKNOWN),
        "usages": state.get("usages") or [],
    }
