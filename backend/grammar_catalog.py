"""The grammar patterns Noeul tracks, per book language, each with its level.

The grammar explanation (/explain_grammar/) must name one of these by id, so a
learner's encounters can be counted, collected and reviewed: the same pattern
met in two books is the same entry. Levels follow the scale each language's
learners know: CEFR for English, TOPIK for Korean, HSK for Chinese.

Each entry: id (stable; stored on the device), form (how the pattern looks in
the language), name (a short English name the model translates for the
learner) and level.
"""

from __future__ import annotations

EN = [
    ("en.present_simple", "he works / she does", "Present simple: habits and facts", "A1"),
    ("en.present_continuous", "is / are + -ing", "Present continuous: happening now", "A1"),
    ("en.there_is", "there is / there are / there was", "There is / there was: saying something exists", "A1"),
    ("en.can_ability", "can / could + verb", "Can / could: ability", "A1"),
    ("en.imperative", "Go! / Don't go!", "Imperative: orders and requests", "A1"),
    ("en.possessive_s", "Tom's / the dog's", "'s: whose it is", "A1"),
    ("en.past_simple", "walked / went", "Past simple: finished events", "A1"),
    ("en.past_continuous", "was / were + -ing", "Past continuous: what was going on", "A2"),
    ("en.going_to", "be going to + verb", "Going to: plans and what is about to happen", "A2"),
    ("en.will_future", "will + verb", "Will: future and decisions", "A2"),
    ("en.comparative", "bigger than / more beautiful than", "Comparatives", "A2"),
    ("en.superlative", "the biggest / the most beautiful", "Superlatives", "A2"),
    ("en.must_have_to", "must / have to", "Must / have to: necessity", "A2"),
    ("en.should", "should + verb", "Should: advice", "A2"),
    ("en.infinitive_purpose", "to + verb (in order to)", "To + verb: purpose", "A2"),
    ("en.gerund_object", "like / enjoy / stop + -ing", "Verb + -ing", "A2"),
    ("en.too_enough", "too … / … enough", "Too and enough", "A2"),
    ("en.present_perfect", "has / have + past participle", "Present perfect: past linked to now", "B1"),
    ("en.past_perfect", "had + past participle", "Past perfect: earlier in the past", "B1"),
    ("en.used_to", "used to + verb", "Used to: past habits", "B1"),
    ("en.passive", "is / was + past participle", "Passive: what happens to something", "B1"),
    ("en.relative_defining", "the man who / the book that", "Relative clause: which one", "B1"),
    ("en.relative_extra", ", who … , / , which … ,", "Extra information with who / which", "B1"),
    ("en.reported_speech", "said that … / asked if …", "Reported speech", "B1"),
    ("en.first_conditional", "if + present, will", "If: real possibilities", "B1"),
    ("en.second_conditional", "if + past, would", "If: imagined situations", "B1"),
    ("en.so_that", "so … that / such … that", "So … that: cause and result", "B1"),
    ("en.might_may", "might / may + verb", "Might / may: possibility", "B1"),
    ("en.phrasal_verb", "look up / give up / put on", "Phrasal verbs", "B1"),
    ("en.participle_clause", "Walking home, he …", "-ing clause: at the same time / because", "B2"),
    ("en.third_conditional", "if + had done, would have", "If: imagined past", "B2"),
    ("en.modal_perfect", "must / might / should have + past participle", "Modal + have: guessing or judging the past", "B2"),
    ("en.wish", "I wish / if only", "Wish: regret and wanting", "B2"),
    ("en.inversion", "Never had he … / Little did she …", "Inversion for emphasis", "C1"),
    ("en.cleft", "It was … that … / What … is …", "Cleft sentence: focusing one part", "B2"),
    ("en.archaic_forms", "thou art / hath / doth / 'tis", "Old forms: thou, hath, doth", "B2"),
    ("en.subjunctive", "if I were / insist that he be", "Subjunctive: were / be", "C1"),
    ("en.long_subject", "The man in the grey coat who … was …", "Long subject before the verb", "B2"),
    ("en.fronted_adverbial", "In the corner stood a …", "Place first, then the verb", "C1"),
    ("en.not_only", "not only … but also", "Not only … but also", "B2"),
]

KO = [
    ("ko.topic_subject", "은/는 · 이/가", "Topic and subject markers", "TOPIK 1"),
    ("ko.object", "을/를", "Object marker", "TOPIK 1"),
    ("ko.polite_ending", "-아요/어요", "Polite present ending", "TOPIK 1"),
    ("ko.formal_ending", "-ㅂ니다/습니다", "Formal ending", "TOPIK 1"),
    ("ko.past", "-았/었-", "Past tense", "TOPIK 1"),
    ("ko.future_intent", "-(으)ㄹ 거예요", "Future and intention", "TOPIK 1"),
    ("ko.and_then", "-고", "And (listing, sequence)", "TOPIK 1"),
    ("ko.want", "-고 싶다", "Want to", "TOPIK 1"),
    ("ko.negation", "안 · -지 않다 · 못", "Negation", "TOPIK 1"),
    ("ko.location", "에 · 에서", "Place markers: at / in / from", "TOPIK 1"),
    ("ko.because_seo", "-아서/어서", "Because / and then (-아서)", "TOPIK 2"),
    ("ko.because_nikka", "-(으)니까", "Because (-니까), with a reason given", "TOPIK 2"),
    ("ko.but_jiman", "-지만", "But", "TOPIK 2"),
    ("ko.background_neunde", "-는데 / -(으)ㄴ데", "-는데: setting the scene, contrast", "TOPIK 2"),
    ("ko.modifier", "-(으)ㄴ · -는 · -(으)ㄹ + noun", "Modifier: describing a noun", "TOPIK 2"),
    ("ko.if", "-(으)면", "If / when", "TOPIK 2"),
    ("ko.can", "-(으)ㄹ 수 있다/없다", "Can / cannot", "TOPIK 2"),
    ("ko.try", "-아/어 보다", "Try doing", "TOPIK 2"),
    ("ko.progressive", "-고 있다", "Be doing", "TOPIK 2"),
    ("ko.state_result", "-아/어 있다", "Resulting state", "TOPIK 3"),
    ("ko.while", "-(으)면서", "While", "TOPIK 2"),
    ("ko.intention_ryeogo", "-(으)려고", "In order to", "TOPIK 2"),
    ("ko.must", "-아야/어야 하다", "Must / have to", "TOPIK 2"),
    ("ko.honorific", "-(으)시-", "Honorific: respect for the subject", "TOPIK 2"),
    ("ko.quote", "-다고 하다 · -냐고 · -자고", "Quoting what someone said", "TOPIK 3"),
    ("ko.seems", "-(으)ㄴ/는 것 같다", "Seems / I think", "TOPIK 3"),
    ("ko.retrospective", "-더-, -던", "Recalling what was seen or felt", "TOPIK 4"),
    ("ko.passive_causative", "-이/히/리/기-", "Passive and causative verbs", "TOPIK 4"),
    ("ko.nominal", "-기 · -(으)ㅁ · -는 것", "Turning a verb into a noun", "TOPIK 3"),
    ("ko.as_soon_as", "-자마자", "As soon as", "TOPIK 3"),
    ("ko.even_if", "-아도/어도", "Even if", "TOPIK 3"),
    ("ko.so_that", "-도록", "So that / until", "TOPIK 4"),
    ("ko.literary_past", "-았/었다 · -(이)었다 (written)", "Plain written ending (story narration)", "TOPIK 3"),
    ("ko.exclamation", "-구나 · -네(요)", "Noticing, exclaiming", "TOPIK 3"),
    ("ko.contrast_neunde_but", "-(으)나", "But (written, formal)", "TOPIK 5"),
    ("ko.on_the_way", "-다가", "While doing, then (interrupted)", "TOPIK 3"),
]

ZH = [
    ("zh.shi", "是", "是: A is B", "HSK 1"),
    ("zh.de_possessive", "的 (我的书)", "的: whose / describing", "HSK 1"),
    ("zh.measure_word", "一本书 · 两个人", "Measure words", "HSK 1"),
    ("zh.question_ma", "吗", "Yes/no question with 吗", "HSK 1"),
    ("zh.negation", "不 · 没(有)", "Negation: 不 and 没", "HSK 1"),
    ("zh.le_completed", "了 (completed)", "了: done / changed", "HSK 2"),
    ("zh.guo", "过", "过: have done before", "HSK 2"),
    ("zh.zhe", "着", "着: ongoing state", "HSK 2"),
    ("zh.zai_progressive", "在 + verb", "在: doing right now", "HSK 2"),
    ("zh.bi", "A 比 B + adj.", "比: comparing", "HSK 2"),
    ("zh.yao_future", "要 / 快要 … 了", "要: going to / about to", "HSK 2"),
    ("zh.de_complement", "跑得很快", "得: how well / how much", "HSK 2"),
    ("zh.result_complement", "看完 · 听懂 · 找到", "Result after the verb", "HSK 2"),
    ("zh.direction_complement", "走进来 · 拿出去", "Direction after the verb", "HSK 3"),
    ("zh.ba", "把", "把: doing something to it", "HSK 3"),
    ("zh.bei", "被", "被: passive", "HSK 3"),
    ("zh.yinwei_suoyi", "因为 … 所以 …", "Because … so …", "HSK 2"),
    ("zh.suiran_danshi", "虽然 … 但是 …", "Although … but …", "HSK 2"),
    ("zh.ruguo", "如果 … 就 …", "If … then …", "HSK 3"),
    ("zh.yi_jiu", "一 … 就 …", "As soon as", "HSK 3"),
    ("zh.you_you", "又 … 又 …", "Both … and …", "HSK 3"),
    ("zh.lian_dou", "连 … 都/也 …", "Even", "HSK 4"),
    ("zh.shi_de", "是 … 的", "是…的: stressing when / where / how", "HSK 3"),
    ("zh.de_modifier_clause", "我昨天买的书", "Long description before a noun with 的", "HSK 3"),
    ("zh.potential_complement", "看得懂 · 听不见", "Can / can't manage (得/不 in the middle)", "HSK 3"),
    ("zh.verb_reduplication", "看看 · 试一试", "Doubled verb: a little, briefly", "HSK 2"),
    ("zh.zhi_classical", "之 · 其 · 乃 (written)", "Classical words in written Chinese", "HSK 6"),
    ("zh.chuile", "除了 … 以外", "Besides / except", "HSK 3"),
    ("zh.yuelaiyue", "越来越 · 越 … 越 …", "More and more", "HSK 3"),
    ("zh.zhiyou_cai", "只有 … 才 …", "Only if … then", "HSK 4"),
]

CATALOG: dict[str, list[dict]] = {
    language: [
        {"id": pattern_id, "form": form, "name": name, "level": level}
        for pattern_id, form, name, level in entries
    ]
    for language, entries in (("en", EN), ("ko", KO), ("zh", ZH))
}

BY_ID: dict[str, dict] = {entry["id"]: entry for entries in CATALOG.values() for entry in entries}


def patterns_for(language: str) -> list[dict]:
    return CATALOG.get((language or "").split("-")[0].lower(), [])


def catalog_prompt_lines(language: str) -> str:
    """One line per pattern for the model: id | form | name | level."""
    return "\n".join(
        f"{entry['id']} | {entry['form']} | {entry['name']} | {entry['level']}"
        for entry in patterns_for(language)
    )
