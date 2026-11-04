package expo.modules.nativeepubreader

// ─── Multi-word level terms ("gave up", "of course") ─────────────────────────
//
// A phrase term has one plain space between its words; in the book the words
// may be apart by a no-break space, a line break or several spaces. Matching
// runs on the text with each whitespace run collapsed to one space, and maps
// a match back to the original offsets. Pure functions, no Android types.

internal fun isPhraseSpace(char: Char): Boolean = char.isWhitespace()

/** The text with its whitespace runs collapsed to one plain space, trimmed. */
internal fun collapsePhraseSpaces(text: String): String {
  if (text.none { isPhraseSpace(it) }) return text
  val out = StringBuilder(text.length)
  var inSpace = false
  text.forEach { char ->
    if (isPhraseSpace(char)) {
      if (!inSpace) out.append(' ')
      inSpace = true
    } else {
      out.append(char)
      inSpace = false
    }
  }
  return out.toString().trim()
}

/**
 * Text with each whitespace run collapsed to one plain space, and where each
 * of its characters is in the original (`offsets[i]`).
 */
internal class CollapsedText(val text: String, val offsets: IntArray)

/**
 * The collapsed text, or null when there is nothing to collapse (only single
 * plain spaces): the offsets are then the identity.
 */
internal fun collapseTextSpaces(text: String): CollapsedText? {
  var needed = false
  for (index in text.indices) {
    val char = text[index]
    if (isPhraseSpace(char) && (char != ' ' || (index > 0 && isPhraseSpace(text[index - 1])))) {
      needed = true
      break
    }
  }
  if (!needed) return null
  val out = StringBuilder(text.length)
  val offsets = IntArray(text.length)
  var count = 0
  var inSpace = false
  text.forEachIndexed { index, char ->
    if (isPhraseSpace(char)) {
      if (!inSpace) {
        out.append(' ')
        offsets[count++] = index
      }
      inSpace = true
    } else {
      out.append(char)
      offsets[count++] = index
      inSpace = false
    }
  }
  return CollapsedText(out.toString(), offsets.copyOf(count))
}

/** Whether a term or a stretch of text is a phrase: Latin words with space between. */
internal fun isPhraseTerm(term: String?): Boolean =
  term != null && term.trim().any { isPhraseSpace(it) } && term.any { isLatinLetter(it) }

/**
 * The longest phrase among `ranges` (block-local [start, end) offsets into
 * `text`) that covers `offset`, or null.
 */
internal fun phraseRangeAt(text: String, offset: Int, ranges: List<Pair<Int, Int>>): Pair<Int, Int>? {
  if (text.isEmpty()) return null
  val probe = offset.coerceIn(0, text.length - 1)
  var best: Pair<Int, Int>? = null
  ranges.forEach { (start, end) ->
    if (start < 0 || end > text.length || start >= end) return@forEach
    if (probe < start || probe >= end) return@forEach
    if (!isPhraseTerm(text.substring(start, end))) return@forEach
    val current = best
    if (current == null || end - start > current.second - current.first) best = start to end
  }
  return best
}

/**
 * `ranges` minus those inside one of `phraseRanges` (in the same block, and
 * shorter): a sampled "gave" read inside "gave up" was not read as "gave".
 * The phrase itself, when it is sampled too, stays.
 */
internal fun <T> withoutRangesInsidePhrases(
  ranges: List<T>,
  phraseRanges: List<T>,
  blockOf: (T) -> String,
  startOf: (T) -> Int,
  endOf: (T) -> Int
): List<T> {
  if (phraseRanges.isEmpty() || ranges.isEmpty()) return ranges
  val byBlock = phraseRanges.groupBy(blockOf)
  return ranges.filter { range ->
    val phrases = byBlock[blockOf(range)] ?: return@filter true
    phrases.none { phrase ->
      startOf(range) >= startOf(phrase) && endOf(range) <= endOf(phrase) &&
        endOf(range) - startOf(range) < endOf(phrase) - startOf(phrase)
    }
  }
}
