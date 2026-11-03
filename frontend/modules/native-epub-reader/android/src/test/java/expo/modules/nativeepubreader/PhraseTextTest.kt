package expo.modules.nativeepubreader

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PhraseTextTest {
  @Test
  fun collapsesWhitespaceRunsInTerms() {
    assertEquals("gave up", collapsePhraseSpaces("gave  up"))
    assertEquals("gave up", collapsePhraseSpaces(" gave\nup "))
    assertEquals("word", collapsePhraseSpaces("word"))
  }

  @Test
  fun plainSingleSpacesNeedNoCollapsing() {
    assertNull(collapseTextSpaces("He gave up the fight."))
  }

  @Test
  fun collapsedTextMapsBackToOriginalOffsets() {
    val text = "He gave \n up."
    val collapsed = collapseTextSpaces(text)!!
    assertEquals("He gave up.", collapsed.text)
    val start = collapsed.text.indexOf("gave up")
    val end = start + "gave up".length
    assertEquals(3, collapsed.offsets[start])
    // The last character of "up" in the original text, plus one.
    assertEquals(text.indexOf("up") + 2, collapsed.offsets[end - 1] + 1)
    assertArrayEquals(intArrayOf(0, 1, 2), collapsed.offsets.copyOfRange(0, 3))
  }

  @Test
  fun phraseTermsAreLatinWordsWithSpaces() {
    assertTrue(isPhraseTerm("gave up"))
    assertTrue(isPhraseTerm("of course"))
    assertFalse(isPhraseTerm("gave"))
    assertFalse(isPhraseTerm(null))
    assertFalse(isPhraseTerm("天 地"))
  }

  @Test
  fun phraseRangeAtPicksTheLongestPhraseCoveringTheTap() {
    val text = "She made up her mind at last."
    val madeUp = text.indexOf("made up her mind")
    val ranges = listOf(
      madeUp to madeUp + "made up her mind".length,
      text.indexOf("at last") to text.indexOf("at last") + "at last".length,
      // A single word is never a phrase.
      text.indexOf("She") to text.indexOf("She") + 3
    )
    assertEquals(ranges[0], phraseRangeAt(text, text.indexOf("her"), ranges))
    // The space inside the phrase counts too.
    assertEquals(ranges[1], phraseRangeAt(text, text.indexOf("at last") + 2, ranges))
    assertNull(phraseRangeAt(text, 1, ranges))
  }

  @Test
  fun exposuresInsidePhrasesAreDropped() {
    data class R(val block: String, val start: Int, val end: Int)
    // "gave" (3..7) inside "gave up" (3..10) goes; the sampled phrase itself,
    // a word elsewhere and a word in another block stay.
    val exposures = listOf(R("b1", 3, 7), R("b1", 3, 10), R("b1", 20, 24), R("b2", 3, 7))
    val phrases = listOf(R("b1", 3, 10))
    val kept = withoutRangesInsidePhrases(exposures, phrases, { it.block }, { it.start }, { it.end })
    assertEquals(listOf(R("b1", 3, 10), R("b1", 20, 24), R("b2", 3, 7)), kept)
  }
}
