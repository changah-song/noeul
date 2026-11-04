package expo.modules.nativeepubreader

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RevealWaveTest {
  private fun mark(
    key: String,
    weight: Float? = 0.5f,
    reinforced: Boolean = false,
    underlined: Boolean = true,
    annotated: Boolean = false
  ) = RevealWave.Mark(key, weight, reinforced, underlined, annotated)

  @Test
  fun fullWaveStaysWithinTheBudget() {
    val total = RevealWave.totalMs(underlines = true)
    assertTrue("total $total", total in 600L..900L)
    assertTrue(RevealWave.totalMs(underlines = false) < total)
  }

  @Test
  fun everythingIsShownWhenTheWaveEnds() {
    for (underlines in listOf(true, false)) {
      val end = RevealWave.totalMs(underlines)
      for (y in listOf(0f, 0.5f, 1f)) {
        assertEquals(1f, RevealWave.underlineSweep(end, y), 0f)
        for (x in listOf(0f, 0.5f, 1f)) {
          assertEquals(1f, RevealWave.annotationAlpha(end, y, x, underlines), 0f)
        }
      }
      assertTrue(RevealWave.isDone(LevelReveal(end, underlines)))
      assertFalse(RevealWave.isDone(LevelReveal(end - 1, underlines)))
    }
  }

  @Test
  fun nothingIsShownAtTheStart() {
    assertEquals(0f, RevealWave.underlineSweep(0, 0f), 0f)
    assertEquals(0f, RevealWave.annotationAlpha(0, 0f, 0f, underlines = true), 0f)
    assertEquals(0f, RevealWave.annotationAlpha(0, 0f, 0f, underlines = false), 0f)
  }

  @Test
  fun lowerLinesTrailUpperOnes() {
    val at = 200L
    val top = RevealWave.underlineSweep(at, 0f)
    val middle = RevealWave.underlineSweep(at, 0.5f)
    val bottom = RevealWave.underlineSweep(at, 1f)
    assertTrue(top > middle && middle > bottom)
    // Outside the window counts as its nearest edge.
    assertEquals(top, RevealWave.underlineSweep(at, -3f), 0f)
    assertEquals(bottom, RevealWave.underlineSweep(at, 4f), 0f)
  }

  @Test
  fun sweepNeverGoesBackwards() {
    var last = 0f
    for (ms in 0L..RevealWave.totalMs(true) step 8) {
      val sweep = RevealWave.underlineSweep(ms, 0.4f)
      assertTrue(sweep >= last)
      last = sweep
    }
  }

  @Test
  fun annotationsFollowTheUnderlines() {
    // While the top line's stroke is still running, its annotations haven't begun.
    assertTrue(RevealWave.underlineSweep(150, 0f) > 0f)
    assertEquals(0f, RevealWave.annotationAlpha(150, 0f, 0f, underlines = true), 0f)
    // Alone, they start at once.
    assertTrue(RevealWave.annotationAlpha(150, 0f, 0f, underlines = false) > 0f)
    // Left before right on a line.
    val left = RevealWave.annotationAlpha(400, 0.2f, 0f, underlines = true)
    val right = RevealWave.annotationAlpha(400, 0.2f, 1f, underlines = true)
    assertTrue(left > right)
  }

  @Test
  fun clipsSegmentsToTheStroke() {
    assertNull(RevealWave.clippedRight(100f, 150f, 80f))
    assertNull(RevealWave.clippedRight(100f, 150f, 100f))
    assertEquals(120f, RevealWave.clippedRight(100f, 150f, 120f)!!, 0f)
    assertEquals(150f, RevealWave.clippedRight(100f, 150f, 400f)!!, 0f)
  }

  @Test
  fun yFractionIsClampedToTheWindow() {
    assertEquals(0.5f, RevealWave.yFraction(600f, 400f, 400f), 0.0001f)
    assertEquals(0f, RevealWave.yFraction(10f, 400f, 400f), 0f)
    assertEquals(1f, RevealWave.yFraction(2000f, 400f, 400f), 0f)
    assertEquals(0f, RevealWave.yFraction(10f, 0f, 0f), 0f)
  }

  @Test
  fun wordHelpArrivingPlaysTheFullWave() {
    val after = listOf(mark("a"), mark("b", annotated = true))
    assertEquals(RevealKind.FULL, RevealWave.kindFor(emptyList(), after))
  }

  @Test
  fun aLevelChangePlaysTheFullWave() {
    val before = listOf(mark("a", 0.2f), mark("b", 0.6f), mark("c", 0.9f))
    val after = listOf(mark("a", 0.2f), mark("b", 0.4f), mark("c", 0.9f))
    assertEquals(RevealKind.FULL, RevealWave.kindFor(before, after))
    val calmer = listOf(mark("a", 0.2f), mark("b", 0.6f), mark("c", 0.9f, reinforced = true))
    assertEquals(RevealKind.FULL, RevealWave.kindFor(before, calmer))
  }

  @Test
  fun aFewWordsComingOrGoingJustAppear() {
    val before = listOf(mark("a"), mark("b"), mark("c"))
    assertEquals(RevealKind.NONE, RevealWave.kindFor(before, before))
    assertEquals(RevealKind.NONE, RevealWave.kindFor(before, before + mark("d")))
    assertEquals(RevealKind.NONE, RevealWave.kindFor(before, before.drop(1)))
    assertEquals(RevealKind.NONE, RevealWave.kindFor(before, emptyList()))
  }

  @Test
  fun translationsArrivingLaterPlayOnlyTheirPart() {
    val before = listOf(mark("a"), mark("b"), mark("c", underlined = false))
    val after = listOf(
      mark("a", annotated = true),
      mark("b", annotated = true),
      mark("c", underlined = false, annotated = true)
    )
    assertEquals(RevealKind.ANNOTATIONS, RevealWave.kindFor(before, after))
    // One gloss hidden (the word was saved) is not a reveal.
    val oneHidden = after.mapIndexed { i, m -> if (i == 0) m.copy(annotated = false) else m }
    assertEquals(RevealKind.NONE, RevealWave.kindFor(after, oneHidden))
  }
}
