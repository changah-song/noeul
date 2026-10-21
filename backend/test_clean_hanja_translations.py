import os
import sqlite3
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "scripts"))

import clean_hanja_translations as cleaner  # noqa: E402


def test_is_broken_flags_chatter_and_wrong_scripts():
    assert cleaner.is_broken("ar", "ماهر في\n(mahir fi)")
    assert cleaner.is_broken("ru", "флuttering фазан")
    assert cleaner.is_broken("mn", "düşman")
    assert cleaner.is_broken("vi", "chế nhạo, c嘲笑")
    assert cleaner.is_broken("th", "덩어리 흙")
    assert cleaner.is_broken("fr", "chef\npatron\nmaître")
    assert cleaner.is_broken("zh", "점등; 켜기")


def test_is_broken_keeps_real_meanings():
    assert not cleaner.is_broken("ar", "ماء")
    assert not cleaner.is_broken("ru", "вода")
    assert not cleaner.is_broken("mn", "ус")
    assert not cleaner.is_broken("vi", "nước")
    assert not cleaner.is_broken("th", "น้ำ")
    assert not cleaner.is_broken("fr", "eau")
    assert not cleaner.is_broken("zh", "韩国")  # a legitimate word definition
    assert not cleaner.is_broken("es", None)


def test_clean_clears_hun_zh_and_broken_values(tmp_path):
    db_path = tmp_path / "hanja.db"
    conn = sqlite3.connect(db_path)
    columns_char = ", ".join(f"hun_{lang} TEXT" for lang in cleaner.LANGUAGES)
    columns_word = ", ".join(f"definition_{lang} TEXT" for lang in cleaner.LANGUAGES)
    conn.execute(f"CREATE TABLE hanja_characters (character TEXT, eum TEXT, hun_korean TEXT, hun_english TEXT, {columns_char})")
    conn.execute(f"CREATE TABLE hanja_words (id TEXT, hangul TEXT, definition_english TEXT, {columns_word})")
    conn.execute(
        "INSERT INTO hanja_characters (character, eum, hun_korean, hun_english, hun_zh, hun_ru, hun_fr) "
        "VALUES ('一', '일', '한', 'one', '韓文表義一致', 'oдин', 'un')"
    )
    conn.execute("INSERT INTO hanja_words (id, hangul, definition_english, definition_vi) VALUES ('1', '물', 'water', 'nước')")
    conn.commit()
    conn.close()

    counts = cleaner.clean(str(db_path))
    assert counts["hanja_characters.hun_zh"] == 1
    assert counts["hanja_characters.hun_ru"] == 1  # Latin "o" inside Cyrillic

    conn = sqlite3.connect(db_path)
    row = conn.execute("SELECT hun_zh, hun_ru, hun_fr FROM hanja_characters").fetchone()
    assert row == (None, None, "un")
    assert conn.execute("SELECT definition_vi FROM hanja_words").fetchone() == ("nước",)
    conn.close()


def test_bundled_hanja_db_is_clean():
    """The shipped hanja.db has no placeholder hun_zh and no flagged values."""
    db_path = os.path.join(os.path.dirname(__file__), "..", "frontend", "assets", "data", "hanja.db")
    if not os.path.exists(db_path):
        return
    conn = sqlite3.connect(db_path)
    try:
        assert conn.execute("SELECT COUNT(*) FROM hanja_characters WHERE hun_zh IS NOT NULL").fetchone()[0] == 0
        for language in cleaner.LANGUAGES:
            for table, column in (("hanja_characters", f"hun_{language}"), ("hanja_words", f"definition_{language}")):
                values = [row[0] for row in conn.execute(f"SELECT {column} FROM {table} WHERE {column} IS NOT NULL")]
                assert not [value for value in values if cleaner.is_broken(language, value)], column
    finally:
        conn.close()
