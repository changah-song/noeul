"""Chinese sense ranking: real meanings before "variant of" / "surname" pointers."""

import pytest

from zh_senses import (
    first_meaning_sense,
    is_reference_only_definition,
    is_reference_sense,
    is_register_tagged_sense,
    rank_zh_entries,
    reorder_senses,
    short_gloss,
)


def entry(pinyin: str, definition: str, traditional: str | None = None) -> dict:
    return {"pinyin": pinyin, "definition": definition, "traditional": traditional}


# CC-CEDICT rows in file order (the order the DB returns them in).
GAN = [
    entry("gān", "old variant of 乾|干[gan1]", "乹"),
    entry("Gān", "surname Gan", "乾"),
    entry("gān", "dry; dried food; empty; hollow; taken in to nominal kinship", "乾"),
    entry("gān", "variant of 乾|干[gan1]", "亁"),
    entry("Gān", "surname Gan", "干"),
    entry("gān", "(bound form) to have to do with; to concern oneself with", "干"),
    entry("gàn", "tree trunk; main part of sth; to manage; to work", "幹"),
]
LI = [entry("Lǐ", "surname Li"), entry("lǐ", "plum")]
HOU = [
    entry("Hòu", "surname Hou", "后"),
    entry("hòu", "empress; queen; (archaic) monarch; ruler", "后"),
    entry("hòu", "back; behind; rear; afterwards; after; later; post-", "後"),
]
MIAN = [
    entry("miàn", "face; side; surface; aspect; top; classifier for objects with flat surfaces", "面"),
    entry("miàn", "variant of 麵|面[mian4]", "麪"),
    entry("miàn", "flour; noodles; (of food) soft (not crunchy)", "麵"),
]
MEN = [
    entry("Mén", "surname Men"),
    entry("mén", "gate; door; doorway; gateway; opening (CL:扇[shan4])"),
]


def definitions(entries):
    return [e["definition"] for e in entries]


def test_gan_dry_comes_first_and_pointers_last():
    ranked = definitions(rank_zh_entries(GAN))
    assert ranked[0].startswith("dry; dried food")
    # Real meanings keep CC-CEDICT order among themselves.
    assert ranked[:3] == [GAN[2]["definition"], GAN[5]["definition"], GAN[6]["definition"]]
    # Surnames (proper-name reading, no substantive sense) and variants trail.
    assert set(ranked[3:]) == {"old variant of 乾|干[gan1]", "surname Gan", "variant of 乾|干[gan1]"}


def test_li_plum_before_surname():
    assert definitions(rank_zh_entries(LI)) == ["plum", "surname Li"]


def test_hou_keeps_cedict_order_among_real_meanings():
    # "surname Hou" drops to the end. Between "empress" and "back; behind" we keep
    # CC-CEDICT order (empress first): there is no frequency signal in the DB,
    # the two are both real meanings, and the lookup panel lists both. Keeping the
    # original order is the rule for every word, rather than a per-word guess.
    ranked = definitions(rank_zh_entries(HOU))
    assert ranked == [HOU[1]["definition"], HOU[2]["definition"], "surname Hou"]


def test_mian_face_then_noodles_then_variant():
    ranked = definitions(rank_zh_entries(MIAN))
    assert ranked[0].startswith("face; side")
    assert ranked[1].startswith("flour; noodles")
    assert ranked[2] == "variant of 麵|面[mian4]"


def test_men_gate_first():
    assert definitions(rank_zh_entries(MEN))[0].startswith("gate; door")


def test_ranking_is_stable_and_non_destructive():
    original = [dict(e) for e in GAN]
    rank_zh_entries(GAN)
    assert GAN == original
    assert rank_zh_entries([]) == []


def test_entries_without_definition_go_last():
    ranked = rank_zh_entries([{"pinyin": "x", "definition": None}, entry("lǐ", "plum")])
    assert definitions(ranked) == ["plum", None]


def test_proper_name_with_real_sense_beats_pointers_but_yields_to_common_reading():
    entries = [
        entry("Hàn", "Han ethnic group; Chinese (language); the Han dynasty"),
        entry("hàn", "man; (bound form) male"),
        entry("hàn", "variant of 漢|汉[Han4]"),
    ]
    assert definitions(rank_zh_entries(entries)) == [
        "man; (bound form) male",
        "Han ethnic group; Chinese (language); the Han dynasty",
        "variant of 漢|汉[Han4]",
    ]


@pytest.mark.parametrize(
    "sense, is_ref",
    [
        ("variant of 乾|干[gan1]", True),
        ("old variant of 乾|干[gan1]", True),
        ("Japanese variant of 圓|圆", True),
        ("Taiwan variant of 著[zhe5]", True),
        ("erhua variant of 這|这[zhe4]", True),
        ("surname Gan", True),
        ("see 某人[mou3 ren2]", True),
        ("see also 族[zu2]", True),
        ("also written 嘗|尝[chang2]", True),
        ("also pr. [gan4]", True),
        ("used in 自個兒|自个儿[zi4 ge3 r5]", True),
        # Real meanings that merely look bureaucratic.
        ("Peking University (abbr. for 北京大學|北京大学)", False),
        ("abbr. for 北京大學|北京大学[Bei3 jing1 Da4 xue2]", False),
        ("classifier for objects with flat surfaces", False),
        ("CL:扇[shan4]", False),
        ("(bound form) to have to do with", False),
        ("(classifier used before a noun that has no specific classifier)", False),
        ("character used in Taiwan as a substitute for a real name", False),
        ("cohomology (invariant of a topological space in math.)", False),
        ("See you there!", False),
        ("", False),
        (None, False),
    ],
)
def test_is_reference_sense(sense, is_ref):
    assert is_reference_sense(sense) is is_ref


def test_reference_only_definition():
    assert is_reference_only_definition("variant of 乾|干[gan1]")
    assert is_reference_only_definition("see 中山市[Zhong1 shan1 Shi4]; see 中山區|中山区[Zhong1 shan1 Qu1]")
    assert not is_reference_only_definition("variant of 豐|丰[feng1]; luxuriant; buxom")
    assert not is_reference_only_definition("")
    assert not is_reference_only_definition(None)


def test_first_meaning_sense_skips_pointers():
    assert first_meaning_sense("dry; dried food") == "dry"
    assert first_meaning_sense("variant of 豐|丰[feng1]; luxuriant; buxom") == "luxuriant"
    assert first_meaning_sense("(bound form) to have to do with; to concern oneself with") == (
        "(bound form) to have to do with"
    )
    assert first_meaning_sense("Peking University (abbr. for 北京大學|北京大学)") == (
        "Peking University (abbr. for 北京大學|北京大学)"
    )


def test_first_meaning_sense_fallbacks():
    # Reference-only entry: the pointer itself is all we have...
    assert first_meaning_sense("surname Li") == "surname Li"
    # ...unless the backend inlined the target's definition after the pointer.
    assert first_meaning_sense("variant of 乾|干[gan1]: dry; dried food") == "dry"
    assert first_meaning_sense("") is None
    assert first_meaning_sense(None) is None


def test_reorder_senses_moves_pointers_after_meanings():
    assert reorder_senses("variant of 豐|丰[feng1]; luxuriant; buxom; variant of 風|风[feng1]") == (
        "luxuriant; buxom; variant of 豐|丰[feng1]; variant of 風|风[feng1]"
    )
    assert reorder_senses("dry; dried food") == "dry; dried food"
    assert reorder_senses("") == ""


# ─── Reading preference and register tags ──────────────────────────────────

SHUO = [
    entry("shuì", "to persuade"),
    entry("shuō", "to speak; to talk; to say; to explain; to comment; to scold"),
    entry("shuō", "variant of 說|说[shuo1]"),
]
ZHE = [
    entry("zhāo", "a move in chess (Taiwan pr. [zhuo2]); trick; tactic; (dialect) okay"),
    entry("zháo", "to touch; to come in contact with; to feel"),
    entry("zhe", "aspect particle indicating action in progress or ongoing state"),
]
ZHAO = [
    entry("Zhào", "surname Zhao; one of the seven states during the Warring States period"),
    entry("zhào", "to surpass (old)"),
]


def test_preferred_reading_picks_the_common_entry():
    assert definitions(rank_zh_entries(SHUO, preferred_reading="shuō"))[0].startswith("to speak")
    assert definitions(rank_zh_entries(ZHE, preferred_reading="zhe"))[0].startswith("aspect particle")
    # Readings compare without case or spaces.
    assert definitions(rank_zh_entries(SHUO, preferred_reading="Shuō "))[0].startswith("to speak")


def test_same_reading_prefers_the_entry_with_more_meanings():
    # 后 hòu: "back; behind; after ..." over "empress; queen" (此后, 以后, 然后).
    ranked = definitions(rank_zh_entries(HOU, preferred_reading="hòu"))
    assert ranked[0].startswith("back; behind")
    assert ranked[-1] == "surname Hou"


def test_entry_with_only_old_senses_yields_to_the_surname():
    # 赵 in a novel is the Zhao family, not "to surpass (old)".
    ranked = definitions(rank_zh_entries(ZHAO, preferred_reading="zhào"))
    assert ranked[0].startswith("surname Zhao")


@pytest.mark.parametrize(
    "sense, tagged",
    [
        ("to surpass (old)", True),
        ("(literary) juice", True),
        ("(dialect) younger sister", True),
        ("(Cantonese) to sleep", True),
        ("(Tw) scooter", True),
        ("smile (archaic)", True),
        ("(old) local constable", True),
        ("to withdraw the mandate of heaven (and transition to a new dynasty) (original meaning)", True),
        ("(classical particle similar to 於|于[yu2]) in", True),
        ("to die; to pass away", False),
        ("(coll.) to fall asleep", False),
        ("old (of people)", False),
        ("(bound form) individual", False),
        ("", False),
        (None, False),
    ],
)
def test_register_tagged_sense(sense, tagged):
    assert is_register_tagged_sense(sense) is tagged


@pytest.mark.parametrize(
    "definition, gloss",
    [
        ("if; in case; in the event that", "if"),
        ("(of a person) to turn round; to face about; (of a widow) to remarry (archaic)", "to turn round"),
        # notes go, and a too-long first sense gives way to the next one
        ("(third-person singular) (since the early 20th century, usu. male) he; him", "he"),
        ("prefix used before the surname of a person or a numeral indicating the order "
         "of birth of the children in a family; old (of people); venerable (person)", "old"),
        ("to be (followed by substantives only); correct; right", "to be"),
        ("not very (clear, good etc)", "not very"),
        # ...but when no sense fits, a long one's first comma piece will do
        ("Ah Q, antihero of Lu Xun's influential novella The True Story of Ah Q", "Ah Q"),
        # the first comma piece of a long description is not a gloss
        ("a semantically light, transitive verb that is combined with various grammatical "
         "objects to form compound verbs; to beat; to strike", "to beat"),
        # old / literary / dialect senses only when nothing else is left
        ("(dialect) to sleep; to rest", "to rest"),
        ("to surpass (old)", "to surpass"),
        ("(literary) juice", "juice"),
        # classifiers
        ("(classifier used before a noun that has no specific classifier); (bound form) individual",
         "classifier"),
        ("classifier indicating a small amount or small number greater than 1: some, a few, several",
         "some"),
        ("classifier for trees", "classifier for trees"),
        # a sense that is all note
        ("(completed action marker); (modal particle indicating change of state)",
         "completed action marker"),
        # pointers: the inlined meaning, with or without [pinyin]
        ("variant of 乾|干[gan1]: dry; dried food", "dry"),
        ("variant of 上城区: Shangcheng, a district of Hangzhou City", "Shangcheng"),
        ("short name for 瀋陽|沈阳[Shen3 yang2]", "short name for 沈阳"),
        ("surname Li", "surname Li"),
        ("", None),
        (None, None),
    ],
)
def test_short_gloss(definition, gloss):
    assert short_gloss(definition) == gloss


def test_short_gloss_is_always_short():
    gloss = short_gloss("temple dedicated to the local tutelary god 土地神[tu3 di4 shen2] and the god of cereals")
    assert gloss.endswith("…") and len(gloss) <= 41


def test_short_gloss_of_a_proper_name_entry_is_its_surname_sense():
    definition = "surname Zhao; one of the seven states during the Warring States period (476–220 BC)"
    assert short_gloss(definition, proper_name=True) == "surname Zhao"
    assert short_gloss(definition) == "one of the seven states during the…"
