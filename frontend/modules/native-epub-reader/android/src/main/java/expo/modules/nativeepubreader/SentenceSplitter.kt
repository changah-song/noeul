package expo.modules.nativeepubreader

// Returns sentence ranges within `text` as IntRange(first..last) where
// first is the inclusive start index and last is the inclusive end index
// of each sentence (including its terminal punctuation).
fun splitSentences(text: String): List<IntRange> {
  if (text.isEmpty()) return emptyList()

  val result = mutableListOf<IntRange>()
  var sentenceStart = skipLeadingSpace(text, 0)
  var i = sentenceStart

  while (i < text.length) {
    val c = text[i]

    when {
      c == '\n' -> {
        if (sentenceStart < i) {
          result.add(sentenceStart..i - 1)
        }
        sentenceStart = skipLeadingSpace(text, i + 1)
        i = sentenceStart
      }

      c == '.' || c == '!' || c == '?' || c == '。' || c == '！' || c == '？' -> {
        // Skip decimal numbers (e.g. "3.14"): period flanked by digits on both sides
        if (c == '.' &&
          i > 0 && text[i - 1].isDigit() &&
          i + 1 < text.length && text[i + 1].isDigit()
        ) {
          i++
          continue
        }

        // Consume any consecutive terminal punctuation and closing delimiters
        var end = i + 1
        while (end < text.length &&
          (text[end] in TERMINAL_PUNCTUATION || text[end] in CLOSING_DELIMITERS)
        ) {
          end++
        }

        if (sentenceStart < end) {
          result.add(sentenceStart..end - 1)
        }

        sentenceStart = skipLeadingSpace(text, end)
        i = sentenceStart
      }

      else -> i++
    }
  }

  // Trailing text without terminal punctuation
  if (sentenceStart < text.length) {
    result.add(sentenceStart..text.length - 1)
  }

  return result.filter { it.first <= it.last }
}

private val TERMINAL_PUNCTUATION = setOf('.', '!', '?', '。', '！', '？')
private val CLOSING_DELIMITERS = setOf(')', ']', '"', '“', '”', '\'', '‘', '’')

private fun skipLeadingSpace(text: String, start: Int): Int {
  var i = start
  while (i < text.length && (text[i] == ' ' || text[i] == '\t')) i++
  return i
}
