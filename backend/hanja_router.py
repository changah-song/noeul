"""
hanja_router.py

Add to your existing FastAPI app with:
    from hanja_router import router as hanja_router
    app.include_router(hanja_router)
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from supabase import AsyncClient

router = APIRouter(prefix="/hanja", tags=["hanja"])


# ── Response models ────────────────────────────────────────────────────────────

class RelatedWord(BaseModel):
    hangul:             str
    hanja:              str
    definition_korean:  str
    definition_english: str

class HanjaCharacter(BaseModel):
    char:          str
    hun_korean:    str      # e.g. "내릴" or "틈, 겨를"
    eum:           str      # e.g. "강"
    hun_english:   str      # e.g. "descend"
    related_words: list[RelatedWord]

class HanjaWordResponse(BaseModel):
    hangul:             str
    hanja:              str | None
    definition_korean:  str
    definition_english: str
    characters:         list[HanjaCharacter]


# ── DB helpers ─────────────────────────────────────────────────────────────────

def extract_hanja_chars(hanja_str: str) -> list[str]:
    """Pull individual CJK characters from a hanja string e.g. '降水' → ['降','水']"""
    return [c for c in hanja_str if "\u4e00" <= c <= "\u9fff"]


async def get_word_entry(supabase: AsyncClient, hangul: str) -> dict | None:
    result = (
        await supabase.table("hanja_words")
        .select("*")
        .eq("hangul", hangul)
        .limit(1)
        .execute()
    )
    return result.data[0] if result.data else None


async def get_character_info_by_eum(
    supabase: AsyncClient,
    char: str,
    eum: str,
) -> dict | None:
    """
    Used when user taps a word — eum is known from the hangul position,
    so we return only the contextually correct meaning.
    e.g. '강수' position 0 → char='降', eum='강' → returns 내릴/descend only
    """
    result = (
        await supabase.table("hanja_characters")
        .select("*")
        .eq("character", char)
        .eq("eum", eum)
        .limit(1)
        .execute()
    )
    return result.data[0] if result.data else None


async def get_all_character_meanings(
    supabase: AsyncClient,
    char: str,
) -> list[dict]:
    """
    Used when user taps a hanja character in the panel — returns ALL
    pronunciations and meanings for that character.
    e.g. '降' → [(강, 내릴, descend), (항, 항복할, surrender)]
    """
    result = (
        await supabase.table("hanja_characters")
        .select("*")
        .eq("character", char)
        .execute()
    )
    return result.data or []


async def get_related_words(
    supabase: AsyncClient,
    char: str,
    exclude_hangul: str,
    limit: int = 8,
) -> list[dict]:
    """Find other words whose hanja string contains this character."""
    result = (
        await supabase.table("hanja_words")
        .select("hangul, hanja, definition_korean, definition_english")
        .like("hanja", f"%{char}%")
        .neq("hangul", exclude_hangul)
        .limit(limit)
        .execute()
    )
    return result.data or []


# ── Endpoint 1: Tap a word ─────────────────────────────────────────────────────

@router.get("/word/{hangul}", response_model=HanjaWordResponse)
async def lookup_word(hangul: str, supabase: AsyncClient):
    """
    User taps a Korean word in the reader.
    Returns the word's hanja breakdown with each character's contextually
    correct meaning (matched by syllable position) + related words.

    Example: GET /hanja/word/강수
    降 at position 0 → hangul[0] = '강' → returns 내릴 (descend), not 항복할
    """
    word_entry = await get_word_entry(supabase, hangul)
    if not word_entry:
        raise HTTPException(status_code=404, detail=f"'{hangul}' not found.")

    hanja_str  = word_entry.get("hanja") or ""
    hanja_chars = extract_hanja_chars(hanja_str)

    characters: list[HanjaCharacter] = []

    for i, char in enumerate(hanja_chars):
        # Match eum positionally from the hangul string
        eum = hangul[i] if i < len(hangul) else ""

        char_info    = await get_character_info_by_eum(supabase, char, eum)
        related_raw  = await get_related_words(supabase, char, exclude_hangul=hangul)

        characters.append(HanjaCharacter(
            char=char,
            hun_korean=char_info["hun_korean"]  if char_info else "",
            eum=char_info["eum"]                if char_info else eum,
            hun_english=char_info["hun_english"] if char_info else "",
            related_words=[
                RelatedWord(
                    hangul=w["hangul"],
                    hanja=w.get("hanja") or "",
                    definition_korean=w.get("definition_korean") or "",
                    definition_english=w.get("definition_english") or "",
                )
                for w in related_raw
            ],
        ))

    return HanjaWordResponse(
        hangul=hangul,
        hanja=hanja_str or None,
        definition_korean=word_entry.get("definition_korean") or "",
        definition_english=word_entry.get("definition_english") or "",
        characters=characters,
    )


# ── Endpoint 2: Tap a hanja character ─────────────────────────────────────────

@router.get("/character/{char}", response_model=list[HanjaCharacter])
async def lookup_character(char: str, supabase: AsyncClient):
    """
    User taps an individual hanja character in the definition panel.
    Returns ALL pronunciations and meanings for that character + related words.

    Example: GET /hanja/character/降
    Returns both: 강/내릴/descend AND 항/항복할/surrender, each with related words.
    """
    meanings = await get_all_character_meanings(supabase, char)
    if not meanings:
        raise HTTPException(status_code=404, detail=f"'{char}' not found.")

    result: list[HanjaCharacter] = []

    for m in meanings:
        related_raw = await get_related_words(supabase, char, exclude_hangul="")
        result.append(HanjaCharacter(
            char=char,
            hun_korean=m["hun_korean"],
            eum=m["eum"],
            hun_english=m["hun_english"] or "",
            related_words=[
                RelatedWord(
                    hangul=w["hangul"],
                    hanja=w.get("hanja") or "",
                    definition_korean=w.get("definition_korean") or "",
                    definition_english=w.get("definition_english") or "",
                )
                for w in related_raw
            ],
        ))

    return result
