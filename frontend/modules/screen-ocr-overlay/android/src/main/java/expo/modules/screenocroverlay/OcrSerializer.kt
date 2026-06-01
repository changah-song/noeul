package expo.modules.screenocroverlay

import android.graphics.Rect
import com.google.mlkit.vision.text.Text
import kotlin.math.floor
import kotlin.math.roundToInt

data class OcrTapTarget(
  val text: String,
  val lineText: String,
  val box: Rect,
  val kind: String
) {
  fun selectionAtImageX(imageX: Float): OcrTapSelection {
    val selectedText = if (kind == "line") {
      selectLineTokenAtImageX(lineText, box, imageX)
    } else {
      text.trimLookupToken().ifEmpty { lineText.trimLookupToken() }
    }

    return OcrTapSelection(
      selectedText = selectedText,
      lineText = lineText,
      box = Rect(box),
      kind = kind
    )
  }
}

data class OcrTapSelection(
  val selectedText: String,
  val lineText: String,
  val box: Rect,
  val kind: String
)

data class OverlayCaptureBounds(
  val left: Int,
  val top: Int,
  val width: Int,
  val height: Int
) {
  fun toMap(): Map<String, Int> =
    mapOf(
      "left" to left,
      "top" to top,
      "width" to width,
      "height" to height
    )

  fun toLogString(): String = "$left,$top ${width}x$height"
}

data class OcrDebugBox(
  val text: String,
  val box: Rect,
  val kind: String,
  val accepted: Boolean
)

data class SerializedOcrResult(
  val result: Map<String, Any?>,
  val targets: List<OcrTapTarget>,
  val debugBoxes: List<OcrDebugBox>
)

data class OverlayLookupResult(
  val requestId: String,
  val surface: String,
  val stem: String,
  val definition: String?,
  val hanja: String?,
  val pos: String?,
  val romanization: String?,
  val saved: Boolean,
  val sourceSentence: String,
  val alternatives: List<OverlayDefinitionEntry>
)

data class OverlayDefinitionEntry(
  val word: String,
  val definition: String?,
  val hanja: String?,
  val pos: String?,
  val romanization: String?,
  val saved: Boolean
)

data class OverlaySaveResult(
  val requestId: String,
  val saved: Boolean,
  val alternativeIndex: Int?
)

data class OverlayHanjaResult(
  val requestId: String,
  val character: String,
  val meaning: String?,
  val sound: String?,
  val relatedWords: List<OverlayHanjaRelatedWord>
)

data class OverlayHanjaRelatedWord(
  val korean: String,
  val hanja: String,
  val meaning: String,
  val known: Boolean
)

object OcrSerializer {
  private const val TOP_CHROME_RATIO = 0.14f
  private const val MIN_HANGUL_RATIO = 0.25f
  private val ignoredLabels = setOf("ocr", "floating ocr")

  fun serialize(
    result: Text,
    imageWidth: Int,
    imageHeight: Int,
    filterTopChrome: Boolean = true
  ): SerializedOcrResult {
    val targets = mutableListOf<OcrTapTarget>()
    val debugBoxes = mutableListOf<OcrDebugBox>()
    val blocks = result.textBlocks.map { block ->
      serializeBlock(block, imageHeight, filterTopChrome, targets, debugBoxes)
    }

    return SerializedOcrResult(
      result = mapOf(
        "imageWidth" to imageWidth,
        "imageHeight" to imageHeight,
        "text" to result.text,
        "blocks" to blocks,
        "targets" to targets.map(::serializeTapTarget)
      ),
      targets = targets,
      debugBoxes = debugBoxes
    )
  }

  private fun serializeBlock(
    block: Text.TextBlock,
    imageHeight: Int,
    filterTopChrome: Boolean,
    targets: MutableList<OcrTapTarget>,
    debugBoxes: MutableList<OcrDebugBox>
  ): Map<String, Any?> =
    mapOf(
      "text" to block.text,
      "box" to serializeBox(block.boundingBox),
      "lines" to block.lines.map { line ->
        serializeLine(line, imageHeight, filterTopChrome, targets, debugBoxes)
      }
    )

  private fun serializeLine(
    line: Text.Line,
    imageHeight: Int,
    filterTopChrome: Boolean,
    targets: MutableList<OcrTapTarget>,
    debugBoxes: MutableList<OcrDebugBox>
  ): Map<String, Any?> {
    val lineBox = line.boundingBox
    val lineText = line.text.trim()
    val accepted = shouldAcceptLine(lineText, lineBox, imageHeight, filterTopChrome)

    if (lineBox != null && lineText.isNotEmpty()) {
      debugBoxes.add(
        OcrDebugBox(
          text = lineText,
          box = Rect(lineBox),
          kind = "line",
          accepted = accepted
        )
      )
    }

    if (accepted && lineBox != null) {
      targets.add(
        OcrTapTarget(
          text = lineText,
          lineText = lineText,
          box = Rect(lineBox),
          kind = "line"
        )
      )

      targets.addAll(createSyntheticWordTargets(lineText, lineBox))
    }

    val serializedElements = line.elements.map { element ->
      serializeElement(element, debugBoxes)
    }

    return mapOf(
      "text" to line.text,
      "box" to serializeBox(line.boundingBox),
      "elements" to serializedElements
    )
  }

  private fun serializeElement(
    element: Text.Element,
    debugBoxes: MutableList<OcrDebugBox>
  ): Map<String, Any?> {
    val elementText = element.text.trim()
    val elementBox = element.boundingBox

    if (elementText.isNotEmpty() && elementBox != null) {
      debugBoxes.add(
        OcrDebugBox(
          text = elementText,
          box = Rect(elementBox),
          kind = "element",
          accepted = false
        )
      )
    }

    return mapOf(
      "text" to element.text,
      "box" to serializeBox(element.boundingBox)
    )
  }

  fun serializeBox(rect: Rect?): Map<String, Int>? {
    if (rect == null) {
      return null
    }

    return mapOf(
      "x" to rect.left,
      "y" to rect.top,
      "width" to rect.width(),
      "height" to rect.height()
    )
  }

  fun serializeDebugBox(debugBox: OcrDebugBox): Map<String, Any?> =
    mapOf(
      "text" to debugBox.text,
      "kind" to debugBox.kind,
      "accepted" to debugBox.accepted,
      "box" to serializeBox(debugBox.box)
    )

  private fun serializeTapTarget(target: OcrTapTarget): Map<String, Any?> =
    mapOf(
      "text" to target.text,
      "lineText" to target.lineText,
      "kind" to target.kind,
      "box" to serializeBox(target.box)
    )

  private fun shouldAcceptLine(
    text: String,
    box: Rect?,
    imageHeight: Int,
    filterTopChrome: Boolean
  ): Boolean {
    if (text.isBlank() || box == null || box.width() <= 0 || box.height() <= 0) {
      return false
    }
    if (filterTopChrome && imageHeight > 0 && box.top < imageHeight * TOP_CHROME_RATIO) {
      return false
    }

    val normalizedText = text.trim().lowercase()
    if (ignoredLabels.contains(normalizedText)) {
      return false
    }

    return hangulRatio(text) >= MIN_HANGUL_RATIO
  }

  private fun hangulRatio(text: String): Float {
    val contentChars = text.filter { it.isLetterOrDigit() }
    if (contentChars.isEmpty()) {
      return 0f
    }

    val hangulCount = contentChars.count(::isHangul)
    return hangulCount.toFloat() / contentChars.length
  }

  private fun isHangul(char: Char): Boolean =
    char in '\uAC00'..'\uD7A3' ||
      char in '\u1100'..'\u11FF' ||
      char in '\u3130'..'\u318F'
}

private data class LineToken(
  val text: String,
  val start: Int,
  val end: Int
)

private fun createSyntheticWordTargets(lineText: String, lineBox: Rect): List<OcrTapTarget> {
  val tokens = splitLookupTokensWithOffsets(lineText)
  if (tokens.isEmpty() || lineBox.width() <= 0) {
    return emptyList()
  }
  if (tokens.size == 1) {
    return listOf(
      OcrTapTarget(
        text = tokens.first().text,
        lineText = lineText,
        box = Rect(lineBox),
        kind = "word"
      )
    )
  }

  val measurableLength = tokens.sumOf { it.text.length }.coerceAtLeast(1)
  var cursor = lineBox.left

  return tokens.mapIndexed { index, token ->
    val isLast = index == tokens.lastIndex
    val tokenWidth = if (isLast) {
      lineBox.right - cursor
    } else {
      (lineBox.width() * (token.text.length.toFloat() / measurableLength)).roundToInt()
        .coerceAtLeast(1)
    }
    val tokenRight = if (isLast) {
      lineBox.right
    } else {
      (cursor + tokenWidth).coerceAtMost(lineBox.right)
    }
    val targetBox = Rect(cursor, lineBox.top, tokenRight, lineBox.bottom)
    cursor = tokenRight

    OcrTapTarget(
      text = token.text,
      lineText = lineText,
      box = targetBox,
      kind = "word"
    )
  }.filter { it.box.width() > 0 }
}

private fun selectLineTokenAtImageX(lineText: String, lineBox: Rect, imageX: Float): String {
  val tokens = splitLookupTokensWithOffsets(lineText)
  if (tokens.isEmpty()) {
    return lineText.trimLookupToken()
  }
  if (tokens.size == 1 || lineBox.width() <= 0) {
    return tokens.first().text
  }

  val relativeX = ((imageX - lineBox.left) / lineBox.width()).coerceIn(0f, 0.999f)
  val index = floor(relativeX * tokens.size).toInt().coerceIn(0, tokens.lastIndex)
  return tokens[index].text
}

private fun splitLookupTokensWithOffsets(text: String): List<LineToken> {
  val tokens = mutableListOf<LineToken>()
  var tokenStart: Int? = null

  text.forEachIndexed { index, char ->
    if (char.isWhitespace()) {
      tokenStart?.let { start ->
        addLookupToken(text, start, index, tokens)
        tokenStart = null
      }
    } else if (tokenStart == null) {
      tokenStart = index
    }
  }

  tokenStart?.let { start ->
    addLookupToken(text, start, text.length, tokens)
  }

  return tokens
}

private fun addLookupToken(
  source: String,
  start: Int,
  end: Int,
  tokens: MutableList<LineToken>
) {
  val raw = source.substring(start, end)
  val trimmed = raw.trimLookupToken()
  if (trimmed.isEmpty()) {
    return
  }

  tokens.add(
    LineToken(
      text = trimmed,
      start = start,
      end = end
    )
  )
}

private fun String.trimLookupToken(): String =
  trim { char -> char.isWhitespace() || !char.isLetterOrDigit() }
