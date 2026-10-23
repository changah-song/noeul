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

        if (c == '.' && isAbbreviationPeriod(text, i)) {
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
private val CLOSING_DELIMITERS = setOf(
  ')', ']', '"', '“', '”', '\'', '‘', '’',
  // CJK quotes and brackets that close after the full stop: 。』 。」 。）
  '』', '」', '）', '】', '》', '〉'
)

// English titles and abbreviations whose period doesn't end a sentence
// ("Mr. Darcy", "e.g. this"). Keep in step with services/sentenceSplit.js.
private val ABBREVIATIONS = setOf("mr", "mrs", "ms", "dr", "st", "sr", "jr", "prof", "rev", "hon", "capt", "col", "gen", "lt", "sgt", "mt", "vs", "e.g", "i.e", "cf", "fig", "no", "vol", "approx")

private fun isAsciiLetter(c: Char) = c in 'a'..'z' || c in 'A'..'Z'

// A period inside a word (e.g., U.S.), after a known abbreviation, or after a
// single capital initial (J. K. Rowling).
private fun isAbbreviationPeriod(text: String, index: Int): Boolean {
  if (index + 1 < text.length && isAsciiLetter(text[index + 1])) return true
  // An English sentence starts with a capital; "the U.S. now" goes on.
  var next = index + 1
  while (next < text.length && text[next] == ' ') next++
  if (next > index + 1 && next < text.length && text[next] in 'a'..'z') return true
  var start = index
  while (start > 0 && (isAsciiLetter(text[start - 1]) || text[start - 1] == '.')) start--
  val word = text.substring(start, index)
  if (word.isEmpty()) return false
  if (word.lowercase() in ABBREVIATIONS) return true
  // "I" is a word, not an initial ("and so did I.").
  return word.length == 1 && word[0].isUpperCase() && word != "I" && (start == 0 || text[start - 1] == ' ')
}

private fun skipLeadingSpace(text: String, start: Int): Int {
  var i = start
  while (i < text.length && (text[i] == ' ' || text[i] == '\t')) i++
  return i
}
