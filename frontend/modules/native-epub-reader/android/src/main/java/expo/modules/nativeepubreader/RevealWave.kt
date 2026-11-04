package expo.modules.nativeepubreader

// The wave that brings a page's word help in once it is ready: the level
// underlines sweep in line by line, top to bottom, each line's underlines
// growing left to right as one pen stroke across the line; then the pinyin
// and glosses fade and rise into place, following the same wave. Paint only
// (clip width, alpha, a few dp of offset), so nothing moves in the layout.
//
// Positions are fractions: y of the line within the visible window (0 = top,
// 1 = bottom; outside is clamped) and x of the word within the line's width.
// Everything here is pure, so the timing is unit tested.

// Which parts of the word help play the wave. NONE draws everything at once.
enum class RevealKind { NONE, ANNOTATIONS, FULL }

// A running reveal, as the page views see it: how long it has been playing
// and whether the underlines take part (else only the annotations do).
data class LevelReveal(val elapsedMs: Long, val underlines: Boolean)

object RevealWave {
  // The top line starts; each line below starts a little later, the bottom
  // line of the window LINE_SPREAD_MS after the top one.
  const val LINE_SPREAD_MS = 220L
  // One line's stroke, from the left margin to the right.
  const val LINE_SWEEP_MS = 300L
  // The annotations trail the underlines by this much, line for line.
  const val ANNOTATION_LAG_MS = 200L
  // Within a line, the annotation of a word at the right edge starts this much
  // after one at the left edge, so they follow the stroke across.
  const val ANNOTATION_ACROSS_MS = 180L
  const val ANNOTATION_FADE_MS = 220L
  // How far (dp) an annotation rises into place as it fades in.
  const val ANNOTATION_RISE_DP = 3f
  // A reveal armed before the page drew starts on its first frame, but only
  // if that frame comes this soon: never later, on some page turn.
  const val ARM_TIMEOUT_MS = 1500L

  fun totalMs(underlines: Boolean): Long {
    val lag = if (underlines) ANNOTATION_LAG_MS else 0L
    val annotations = lag + LINE_SPREAD_MS + ANNOTATION_ACROSS_MS + ANNOTATION_FADE_MS
    val strokes = if (underlines) LINE_SPREAD_MS + LINE_SWEEP_MS else 0L
    return maxOf(annotations, strokes)
  }

  fun isDone(reveal: LevelReveal): Boolean = reveal.elapsedMs >= totalMs(reveal.underlines)

  fun lineDelayMs(yFraction: Float): Long =
    (yFraction.coerceIn(0f, 1f) * LINE_SPREAD_MS).toLong()

  // How far across its line the underline stroke has reached, 0..1 of the
  // line's width (eased out, so it lands softly at the right margin).
  fun underlineSweep(elapsedMs: Long, yFraction: Float): Float {
    val t = (elapsedMs - lineDelayMs(yFraction)).toFloat() / LINE_SWEEP_MS
    return easeOutCubic(t.coerceIn(0f, 1f))
  }

  // How visible a word's pinyin and gloss are, 0..1.
  fun annotationAlpha(elapsedMs: Long, yFraction: Float, xFraction: Float, underlines: Boolean): Float {
    val lag = if (underlines) ANNOTATION_LAG_MS else 0L
    val delay = lag + lineDelayMs(yFraction) + (xFraction.coerceIn(0f, 1f) * ANNOTATION_ACROSS_MS).toLong()
    val t = (elapsedMs - delay).toFloat() / ANNOTATION_FADE_MS
    return easeOutQuad(t.coerceIn(0f, 1f))
  }

  // The right edge (layout x) to draw an underline segment to, given where the
  // stroke has reached on its line; null when the stroke hasn't reached it.
  fun clippedRight(left: Float, right: Float, sweepX: Float): Float? {
    val clipped = minOf(right, sweepX)
    return if (clipped <= left) null else clipped
  }

  // y of a line within the visible window, as a fraction (clamped to 0..1).
  fun yFraction(y: Float, windowTop: Float, windowHeight: Float): Float {
    if (windowHeight <= 0f) return 0f
    return ((y - windowTop) / windowHeight).coerceIn(0f, 1f)
  }

  // One word's mark on the page in front of the reader, before or after the
  // level terms changed. `key` names the word's place in the text.
  data class Mark(
    val key: String,
    val weight: Float?,
    val reinforced: Boolean,
    val underlined: Boolean,
    val annotated: Boolean
  )

  // Whether the change from `before` to `after` (the marks on the page the
  // reader is looking at) plays the wave. Underlines play when most of the
  // page's underlines are new (word help just arrived) or any one changed
  // shade (the level changed); otherwise a word or two coming or going (a
  // save hides a gloss, the marks slider moves) just appears. Annotations
  // alone play when most of them are new (the translations came in after the
  // underlines, or were turned on).
  fun kindFor(before: List<Mark>, after: List<Mark>): RevealKind {
    val beforeByKey = before.associateBy { it.key }
    val underlined = after.filter { it.underlined }
    if (underlined.isNotEmpty()) {
      var kept = 0
      for (mark in underlined) {
        val old = beforeByKey[mark.key]?.takeIf { it.underlined } ?: continue
        if (old.weight != mark.weight || old.reinforced != mark.reinforced) return RevealKind.FULL
        kept++
      }
      if (kept * 2 < underlined.size) return RevealKind.FULL
    }
    val annotated = after.filter { it.annotated }
    if (annotated.isNotEmpty()) {
      val kept = annotated.count { beforeByKey[it.key]?.annotated == true }
      if (kept * 2 < annotated.size) return RevealKind.ANNOTATIONS
    }
    return RevealKind.NONE
  }

  private fun easeOutCubic(t: Float): Float {
    val u = 1f - t
    return 1f - u * u * u
  }

  private fun easeOutQuad(t: Float): Float = 1f - (1f - t) * (1f - t)
}
