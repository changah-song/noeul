package expo.modules.nativeepubreader

import android.text.Layout
import android.text.SpannableStringBuilder
import android.text.StaticLayout
import android.text.TextPaint

// A single renderable block on a page. Text blocks may represent either a
// complete EPUB block or a slice of a block split across a page boundary.
data class PageBlock(
  val blockId: String,
  val type: String,
  val tag: String,
  val styledText: SpannableStringBuilder? = null,
  val plainText: String = "",
  val sourceStartOffset: Int = 0,
  val textPaint: TextPaint? = null,
  val textLayout: StaticLayout? = null,
  val textAlign: Layout.Alignment = Layout.Alignment.ALIGN_NORMAL,
  val imageUri: String? = null,
  val imageHeight: Int = 0,
  val contentWidth: Int = 0,
  val marginLeft: Int = 0,
  val marginTop: Int = 0,
  val marginBottom: Int = 0,
  val lineHeightMult: Float = 1.5f
)

data class ReaderPage(
  val pageIndex: Int,
  val blocks: List<PageBlock>,
  val spineIndex: Int? = null,
  val href: String = "",
  val path: String = "",
  val chapterPageIndex: Int = pageIndex,
  val chapterPageCount: Int = 0
)

data class TextRange(
  val pageIndex: Int,
  val spineIndex: Int?,
  val blockId: String,
  val sourceStartOffset: Int,
  val sourceEndOffset: Int
)

data class HighlightTerm(
  val vocabId: Int?,
  val term: String,
  val maturity: String = "new",
  val highlightTone: String = "strong"
)

data class SavedHighlightHit(
  val vocabId: Int?,
  val term: String,
  val maturity: String,
  val highlightTone: String,
  val range: TextRange
)

data class SavedHighlightRange(
  val range: TextRange,
  val vocabId: Int?,
  val term: String,
  val maturity: String = "new",
  val highlightTone: String = "strong"
)

data class WordHit(
  val text: String,
  val placement: String,
  val range: TextRange,
  val localStartOffset: Int,
  val localEndOffset: Int,
  val sentence: String = ""
)

data class TextSelectionHit(
  val text: String,
  val placement: String,
  val ranges: List<TextRange>
)

enum class ActiveSelectionKind {
  WORD,
  TEXT
}

internal fun isReaderTokenChar(char: Char): Boolean {
  val code = char.code

  return when {
    code in 0xAC00..0xD7A3 -> true // Hangul syllables
    code in 0x1100..0x11FF -> true // Hangul Jamo
    code in 0x3130..0x318F -> true // Hangul Compatibility Jamo
    code in 0x4E00..0x9FFF -> true // CJK Unified Ideographs
    code in 0x3400..0x4DBF -> true // CJK Unified Ideographs Extension A
    code in 0xF900..0xFAFF -> true // CJK Compatibility Ideographs
    char in 'A'..'Z' || char in 'a'..'z' -> true
    char.isDigit() -> true
    else -> false
  }
}
