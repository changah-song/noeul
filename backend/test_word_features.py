"""The word_features table and how preprocessing attaches it (word_features.py)."""
import word_features


def test_common_words_are_more_frequent_than_rare_ones():
    ko = word_features.lookup_word_features("ko", ["사람", "공동묘지", "먹다", "공부", "공부하다"])
    assert ko["사람"]["zipf"] > ko["공동묘지"]["zipf"]
    # Verbs are counted by their stem; 하다 verbs by their noun, a little lower.
    assert ko["먹다"]["zipf"] > 5
    assert ko["공부하다"]["zipf"] < ko["공부"]["zipf"]
    zh = word_features.lookup_word_features("zh", ["我们", "厮杀"])
    assert zh["我们"]["zipf"] > zh["厮杀"]["zipf"]


def test_korean_loanwords_are_flagged_and_chinese_ones_are_not():
    ko = word_features.lookup_word_features("ko", ["컴퓨터", "아이러니", "사람"])
    assert ko["컴퓨터"]["loanword"] is True
    assert ko["아이러니"]["loanword"] is True
    assert ko["사람"]["loanword"] is False
    assert word_features.lookup_word_features("zh", ["咖啡"])["咖啡"]["loanword"] is False


def test_attach_uses_stem_then_surface():
    entries = [{"stem": "사람"}, {"surface": "컴퓨터"}, {"stem": "없는말없는말"}]
    out = word_features.attach_word_features("ko", entries)
    assert out[0]["zipf"] > 6
    assert out[1]["loanword"] is True
    assert "zipf" not in out[2]
