package expo.modules.nativeepubreader

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.text.StaticLayout
import android.util.Log
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

private const val PAGE_VIEW_TAG = "EpubPageView"

private data class RenderedTextBlock(
  val block: PageBlock,
  val layout: StaticLayout,
  val x: Float,
  val y: Float,
  val width: Int
)

private data class LocalTokenRange(
  val start: Int,
  val end: Int
)

private data class TextPosition(
  val renderedIndex: Int,
  val block: PageBlock,
  val localOffset: Int,
  val sourceOffset: Int
)

private data class SelectionAnchor(
  val pageIndex: Int,
  val spineIndex: Int?,
  val blockId: String,
  val renderedIndex: Int,
  val localStartOffset: Int,
  val localEndOffset: Int,
  val sourceStartOffset: Int,
  val sourceEndOffset: Int
)

class EpubPageView(context: Context) : View(context) {
  private var page: ReaderPage? = null
  private var paddingH = 0
  private var paddingV = 0
  private var lineHeightMult = 1.5f
  private var pageBackgroundColor = Color.WHITE
  private var activeSelectionRanges: List<TextRange> = emptyList()
  private var activeSelectionKind: ActiveSelectionKind? = null
  private var savedHighlightRanges: List<TextRange> = emptyList()
  private var activeHighlightColor = Color.argb(0x55, 0xfc, 0xd5, 0xb4)
  private var textSelectionHighlightColor = Color.argb(0x66, 0x7a, 0xb3, 0xff)
  private var savedHighlightColor = Color.rgb(0xf7, 0xd4, 0x88)
  private var onWordSelected: ((WordHit) -> Unit)? = null
  private var onTextSelected: ((TextSelectionHit) -> Unit)? = null
  private var onSelectionCleared: (() -> Unit)? = null
  private var onSelectionDragStateChanged: ((Boolean) -> Unit)? = null
  private var renderedTextBlocks = emptyList<RenderedTextBlock>()
  private var geometryDirty = true
  private val bitmapCache = mutableMapOf<String, Bitmap?>()
  private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
  private val longPressTimeout = ViewConfiguration.getLongPressTimeout().toLong()
  private val longPressHandler = Handler(Looper.getMainLooper())
  private var longPressRunnable: Runnable? = null
  private var tapStartX = 0f
  private var tapStartY = 0f
  private var isTapCandidate = false
  private var isSelectionMode = false
  private var selectionAnchor: SelectionAnchor? = null
  private val highlightPath = Path()
  private val highlightBounds = RectF()
  private val savedHighlightPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = savedHighlightColor
    style = Paint.Style.FILL
  }
  private val activeHighlightPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = activeHighlightColor
    style = Paint.Style.FILL
  }
  private val placeholderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(180, 174, 166)
    style = Paint.Style.FILL
  }

  fun bind(
    page: ReaderPage,
    paddingH: Int,
    paddingV: Int,
    lineHeightMult: Float,
    backgroundColor: Int,
    activeSelectionRanges: List<TextRange>,
    activeSelectionKind: ActiveSelectionKind?,
    savedHighlightRanges: List<TextRange>,
    activeHighlightColor: Int,
    textSelectionHighlightColor: Int,
    savedHighlightColor: Int,
    onWordSelected: ((WordHit) -> Unit)?,
    onTextSelected: ((TextSelectionHit) -> Unit)?,
    onSelectionCleared: (() -> Unit)?,
    onSelectionDragStateChanged: ((Boolean) -> Unit)?
  ) {
    this.page = page
    this.paddingH = paddingH
    this.paddingV = paddingV
    this.lineHeightMult = lineHeightMult
    this.pageBackgroundColor = backgroundColor
    this.onWordSelected = onWordSelected
    this.onTextSelected = onTextSelected
    this.onSelectionCleared = onSelectionCleared
    this.onSelectionDragStateChanged = onSelectionDragStateChanged
    updateHighlights(
      activeSelectionRanges = activeSelectionRanges,
      activeSelectionKind = activeSelectionKind,
      savedHighlightRanges = savedHighlightRanges,
      activeHighlightColor = activeHighlightColor,
      textSelectionHighlightColor = textSelectionHighlightColor,
      savedHighlightColor = savedHighlightColor
    )
    geometryDirty = true
    invalidate()
    postInvalidateOnAnimation()
  }

  fun updateHighlights(
    activeSelectionRanges: List<TextRange>,
    activeSelectionKind: ActiveSelectionKind?,
    savedHighlightRanges: List<TextRange>,
    activeHighlightColor: Int,
    textSelectionHighlightColor: Int,
    savedHighlightColor: Int
  ) {
    this.activeSelectionRanges = activeSelectionRanges
    this.activeSelectionKind = activeSelectionKind
    this.savedHighlightRanges = savedHighlightRanges
    this.activeHighlightColor = activeHighlightColor
    this.textSelectionHighlightColor = textSelectionHighlightColor
    this.savedHighlightColor = savedHighlightColor
    savedHighlightPaint.color = savedHighlightColor
    activeHighlightPaint.color = activePaintColor()
    invalidate()
    postInvalidateOnAnimation()
  }

  override fun onDraw(canvas: Canvas) {
    canvas.drawColor(pageBackgroundColor)
    val contentWidth = width - (paddingH * 2)
    if (contentWidth <= 0) return
    var yOffset = paddingV.toFloat()

    page?.blocks?.forEach { block ->
      yOffset += block.marginTop

      if (block.type == "image") {
        val blockWidth = block.contentWidth.takeIf { it > 0 } ?: contentWidth
        drawImage(canvas, block, (paddingH + block.marginLeft).toFloat(), yOffset, blockWidth)
        yOffset += block.imageHeight
      } else {
        val layout = block.textLayout ?: buildFallbackTextLayout(block, contentWidth) ?: return@forEach

        canvas.save()
        canvas.translate((paddingH + block.marginLeft).toFloat(), yOffset)
        drawTextHighlights(canvas, block, layout, savedHighlightRanges, savedHighlightPaint)
        activeHighlightPaint.color = activePaintColor()
        drawTextHighlights(canvas, block, layout, activeSelectionRanges, activeHighlightPaint)
        layout.draw(canvas)
        canvas.restore()

        yOffset += layout.height
      }

      yOffset += block.marginBottom
    }
  }

  override fun onTouchEvent(event: MotionEvent): Boolean {
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        tapStartX = event.x
        tapStartY = event.y
        isTapCandidate = true
        scheduleLongPress()
        return true
      }
      MotionEvent.ACTION_MOVE -> {
        if (isSelectionMode) {
          updateDragSelection(event.x, event.y)
          return true
        }

        val dx = abs(event.x - tapStartX)
        val dy = abs(event.y - tapStartY)
        if (
          dx > touchSlop ||
          dy > touchSlop
        ) {
          isTapCandidate = false
          cancelPendingLongPress()
        }

        if (dy > touchSlop && dy > dx) {
          parent?.requestDisallowInterceptTouchEvent(false)
          return false
        }
      }
      MotionEvent.ACTION_UP -> {
        cancelPendingLongPress()
        if (isSelectionMode) {
          finishDragSelection(cancelled = false)
          return true
        }

        if (isTapCandidate) {
          performClick()
          val hit = hitTestText(event.x, event.y)
          if (hit != null) {
            onWordSelected?.invoke(hit)
          } else {
            onSelectionCleared?.invoke()
          }
        }
        isTapCandidate = false
      }
      MotionEvent.ACTION_CANCEL -> {
        cancelPendingLongPress()
        if (isSelectionMode) {
          finishDragSelection(cancelled = true)
        }
        isTapCandidate = false
      }
    }

    return true
  }

  override fun performClick(): Boolean {
    super.performClick()
    return true
  }

  private fun scheduleLongPress() {
    cancelPendingLongPress()
    val runnable = Runnable {
      beginLongPressSelection(tapStartX, tapStartY)
    }
    longPressRunnable = runnable
    longPressHandler.postDelayed(runnable, longPressTimeout)
  }

  private fun cancelPendingLongPress() {
    longPressRunnable?.let { runnable ->
      longPressHandler.removeCallbacks(runnable)
    }
    longPressRunnable = null
  }

  private fun beginLongPressSelection(x: Float, y: Float) {
    val hit = hitTestText(x, y) ?: return
    val renderedIndex = renderedTextBlocks.indexOfFirst { rendered ->
      rendered.block.blockId == hit.range.blockId &&
        rendered.block.sourceStartOffset <= hit.range.sourceStartOffset &&
        rendered.block.sourceStartOffset + blockTextForSelection(rendered.block).length >= hit.range.sourceEndOffset
    }

    if (renderedIndex < 0) {
      return
    }

    isTapCandidate = false
    isSelectionMode = true
    parent?.requestDisallowInterceptTouchEvent(true)
    onSelectionDragStateChanged?.invoke(true)
    selectionAnchor = SelectionAnchor(
      pageIndex = hit.range.pageIndex,
      spineIndex = hit.range.spineIndex,
      blockId = hit.range.blockId,
      renderedIndex = renderedIndex,
      localStartOffset = hit.localStartOffset,
      localEndOffset = hit.localEndOffset,
      sourceStartOffset = hit.range.sourceStartOffset,
      sourceEndOffset = hit.range.sourceEndOffset
    )
    activeSelectionRanges = listOf(hit.range)
    activeSelectionKind = ActiveSelectionKind.TEXT
    activeHighlightPaint.color = activePaintColor()
    invalidate()
    postInvalidateOnAnimation()
  }

  private fun updateDragSelection(x: Float, y: Float) {
    val anchor = selectionAnchor ?: return
    val focus = hitTestTextPosition(x, y, allowClosest = true) ?: return
    val ranges = buildSelectionRanges(anchor, focus)

    if (ranges.isNotEmpty()) {
      activeSelectionRanges = ranges
      activeSelectionKind = ActiveSelectionKind.TEXT
      activeHighlightPaint.color = activePaintColor()
      invalidate()
      postInvalidateOnAnimation()
    }
  }

  private fun finishDragSelection(cancelled: Boolean) {
    parent?.requestDisallowInterceptTouchEvent(false)
    onSelectionDragStateChanged?.invoke(false)

    if (!cancelled) {
      val selectedText = selectedTextForRanges(activeSelectionRanges)
      if (selectedText.isNotBlank() && activeSelectionRanges.isNotEmpty()) {
        onTextSelected?.invoke(
          TextSelectionHit(
            text = selectedText,
            placement = placementForRanges(activeSelectionRanges),
            ranges = activeSelectionRanges
          )
        )
      } else {
        activeSelectionRanges = emptyList()
        activeSelectionKind = null
        onSelectionCleared?.invoke()
      }
    } else {
      activeSelectionRanges = emptyList()
      activeSelectionKind = null
      invalidate()
      postInvalidateOnAnimation()
    }

    isSelectionMode = false
    selectionAnchor = null
    isTapCandidate = false
  }

  private fun activePaintColor(): Int {
    return if (isSelectionMode || activeSelectionKind == ActiveSelectionKind.TEXT) {
      textSelectionHighlightColor
    } else {
      activeHighlightColor
    }
  }

  fun hitTestText(tapX: Float, tapY: Float): WordHit? {
    if (geometryDirty) {
      rebuildGeometry()
    }

    val currentPage = page
    if (currentPage == null || renderedTextBlocks.isEmpty()) {
      Log.d(PAGE_VIEW_TAG, "word hit no-hit: reason=outside text")
      return null
    }

    renderedTextBlocks.forEach { rendered ->
      val layout = rendered.layout
      val block = rendered.block
      val blockBottom = rendered.y + layout.height

      if (tapY < rendered.y || tapY > blockBottom) {
        return@forEach
      }

      if (tapX < rendered.x || tapX > rendered.x + rendered.width) {
        Log.d(PAGE_VIEW_TAG, "word hit no-hit: reason=margin block=${block.blockId}")
        return null
      }

      if (layout.lineCount <= 0 || layout.height <= 0) {
        Log.d(PAGE_VIEW_TAG, "word hit no-hit: reason=blank space block=${block.blockId}")
        return null
      }

      val localX = tapX - rendered.x
      val localY = tapY - rendered.y
      val line = layout.getLineForVertical(localY.toInt().coerceIn(0, layout.height - 1))
      val horizontalTolerance = dp(4f).toFloat()
      val lineLeft = layout.getLineLeft(line)
      val lineRight = layout.getLineRight(line)

      if (localX < lineLeft - horizontalTolerance || localX > lineRight + horizontalTolerance) {
        Log.d(PAGE_VIEW_TAG, "word hit no-hit: reason=blank space block=${block.blockId}")
        return null
      }

      val localOffset = layout.getOffsetForHorizontal(line, localX)
      val blockText = blockTextForSelection(block)
      val tokenRange = tokenRangeAtOffset(blockText, localOffset)

      if (tokenRange == null) {
        Log.d(
          PAGE_VIEW_TAG,
          "word hit no-hit: reason=blank space block=${block.blockId} localOffset=$localOffset"
        )
        return null
      }

      val sourceStart = block.sourceStartOffset + tokenRange.start
      val sourceEnd = block.sourceStartOffset + tokenRange.end
      val word = blockText.substring(tokenRange.start, tokenRange.end)
      val wordCenterY = wordCenterY(rendered, layout, tokenRange, line)
      val placement = when {
        wordCenterY <= paddingV + dp(56f) -> "bottom"
        wordCenterY > height / 2f -> "top"
        else -> "bottom"
      }
      val range = TextRange(
        pageIndex = currentPage.pageIndex,
        spineIndex = currentPage.spineIndex,
        blockId = block.blockId,
        sourceStartOffset = sourceStart,
        sourceEndOffset = sourceEnd
      )

      Log.d(
        PAGE_VIEW_TAG,
        "word hit success: page=${currentPage.pageIndex} spine=${currentPage.spineIndex ?: "none"} " +
          "block=${block.blockId} local=${tokenRange.start}..${tokenRange.end} " +
          "source=$sourceStart..$sourceEnd text=$word"
      )

      return WordHit(
        text = word,
        placement = placement,
        range = range,
        localStartOffset = tokenRange.start,
        localEndOffset = tokenRange.end,
        sentence = sentenceForToken(blockText, tokenRange)
      )
    }

    Log.d(PAGE_VIEW_TAG, "word hit no-hit: reason=${describeNoHitArea(tapX, tapY)}")
    return null
  }

  private fun hitTestTextPosition(
    tapX: Float,
    tapY: Float,
    allowClosest: Boolean
  ): TextPosition? {
    if (geometryDirty) {
      rebuildGeometry()
    }

    if (renderedTextBlocks.isEmpty()) {
      return null
    }

    renderedTextBlocks.forEachIndexed { index, rendered ->
      val layout = rendered.layout
      val block = rendered.block
      val blockBottom = rendered.y + layout.height

      if (tapY < rendered.y || tapY > blockBottom || layout.lineCount <= 0) {
        return@forEachIndexed
      }

      val text = blockTextForSelection(block)
      if (text.isEmpty()) {
        return null
      }

      val localY = tapY - rendered.y
      val line = layout.getLineForVertical(localY.toInt().coerceIn(0, layout.height - 1))
      val localX = (tapX - rendered.x).coerceIn(layout.getLineLeft(line), layout.getLineRight(line))
      val localOffset = layout.getOffsetForHorizontal(line, localX).coerceIn(0, text.length)

      return TextPosition(
        renderedIndex = index,
        block = block,
        localOffset = localOffset,
        sourceOffset = block.sourceStartOffset + localOffset
      )
    }

    if (!allowClosest) {
      return null
    }

    val closestIndex = when {
      tapY <= renderedTextBlocks.first().y -> 0
      tapY >= renderedTextBlocks.last().y + renderedTextBlocks.last().layout.height -> renderedTextBlocks.lastIndex
      else -> renderedTextBlocks
        .withIndex()
        .minByOrNull { (_, rendered) ->
          min(abs(tapY - rendered.y), abs(tapY - (rendered.y + rendered.layout.height)))
        }
        ?.index ?: return null
    }
    val rendered = renderedTextBlocks[closestIndex]
    val blockText = blockTextForSelection(rendered.block)
    val localOffset = if (tapY < rendered.y) 0 else blockText.length

    return TextPosition(
      renderedIndex = closestIndex,
      block = rendered.block,
      localOffset = localOffset,
      sourceOffset = rendered.block.sourceStartOffset + localOffset
    )
  }

  private fun buildSelectionRanges(
    anchor: SelectionAnchor,
    focus: TextPosition
  ): List<TextRange> {
    val currentPage = page ?: return emptyList()
    val startIndex = min(anchor.renderedIndex, focus.renderedIndex)
    val endIndex = max(anchor.renderedIndex, focus.renderedIndex)
    val forward = focus.renderedIndex > anchor.renderedIndex ||
      (focus.renderedIndex == anchor.renderedIndex && focus.sourceOffset >= anchor.sourceStartOffset)
    val ranges = mutableListOf<TextRange>()

    for (index in startIndex..endIndex) {
      val block = renderedTextBlocks.getOrNull(index)?.block ?: continue
      val blockText = blockTextForSelection(block)
      val blockLength = blockText.length
      if (blockLength <= 0) continue

      val localStart: Int
      val localEnd: Int

      if (anchor.renderedIndex == focus.renderedIndex) {
        localStart = min(anchor.localStartOffset, focus.localOffset).coerceIn(0, blockLength)
        localEnd = max(anchor.localEndOffset, focus.localOffset).coerceIn(localStart, blockLength)
      } else if (forward) {
        localStart = if (index == anchor.renderedIndex) anchor.localStartOffset else 0
        localEnd = if (index == focus.renderedIndex) focus.localOffset else blockLength
      } else {
        localStart = if (index == focus.renderedIndex) focus.localOffset else 0
        localEnd = if (index == anchor.renderedIndex) anchor.localEndOffset else blockLength
      }

      if (localStart < localEnd) {
        ranges.add(
          TextRange(
            pageIndex = currentPage.pageIndex,
            spineIndex = currentPage.spineIndex,
            blockId = block.blockId,
            sourceStartOffset = block.sourceStartOffset + localStart,
            sourceEndOffset = block.sourceStartOffset + localEnd
          )
        )
      }
    }

    return ranges
  }

  private fun selectedTextForRanges(ranges: List<TextRange>): String {
    val builder = StringBuilder()

    ranges.forEach { range ->
      val rendered = renderedTextBlocks.firstOrNull { item ->
        item.block.blockId == range.blockId &&
          page?.pageIndex == range.pageIndex &&
          page?.spineIndex == range.spineIndex
      } ?: return@forEach
      val block = rendered.block
      val text = blockTextForSelection(block)
      val localStart = (range.sourceStartOffset - block.sourceStartOffset).coerceIn(0, text.length)
      val localEnd = (range.sourceEndOffset - block.sourceStartOffset).coerceIn(localStart, text.length)
      val selected = text.substring(localStart, localEnd).trim()

      if (selected.isNotEmpty()) {
        if (builder.isNotEmpty()) {
          builder.append('\n')
        }
        builder.append(selected)
      }
    }

    return builder.toString()
  }

  private fun placementForRanges(ranges: List<TextRange>): String {
    val bounds = RectF()
    val blockBounds = RectF()
    var hasBounds = false

    ranges.forEach { range ->
      val rendered = renderedTextBlocks.firstOrNull { item ->
        item.block.blockId == range.blockId &&
          page?.pageIndex == range.pageIndex &&
          page?.spineIndex == range.spineIndex
      } ?: return@forEach
      val textLength = blockTextForSelection(rendered.block).length
      val localStart = (range.sourceStartOffset - rendered.block.sourceStartOffset).coerceIn(0, textLength)
      val localEnd = (range.sourceEndOffset - rendered.block.sourceStartOffset).coerceIn(localStart, textLength)
      if (localStart >= localEnd) return@forEach

      highlightPath.reset()
      blockBounds.setEmpty()
      rendered.layout.getSelectionPath(localStart, localEnd, highlightPath)
      highlightPath.computeBounds(blockBounds, true)
      if (blockBounds.isEmpty) return@forEach

      blockBounds.offset(rendered.x, rendered.y)
      if (hasBounds) {
        bounds.union(blockBounds)
      } else {
        bounds.set(blockBounds)
        hasBounds = true
      }
    }

    val centerY = if (hasBounds) bounds.centerY() else tapStartY
    return when {
      centerY <= paddingV + dp(56f) -> "bottom"
      centerY > height / 2f -> "top"
      else -> "bottom"
    }
  }

  private fun rebuildGeometry() {
    val currentPage = page
    val contentWidth = width - (paddingH * 2)

    if (currentPage == null || contentWidth <= 0) {
      renderedTextBlocks = emptyList()
      geometryDirty = false
      return
    }

    val renderedBlocks = mutableListOf<RenderedTextBlock>()
    var yOffset = paddingV.toFloat()

    currentPage.blocks.forEach { block ->
      yOffset += block.marginTop

      if (block.type == "image") {
        yOffset += block.imageHeight
      } else {
        val layout = block.textLayout ?: buildFallbackTextLayout(block, contentWidth)
        if (layout != null) {
          renderedBlocks.add(
            RenderedTextBlock(
              block = block,
              layout = layout,
              x = (paddingH + block.marginLeft).toFloat(),
              y = yOffset,
              width = block.contentWidth.takeIf { it > 0 } ?: contentWidth
            )
          )
          yOffset += layout.height
        }
      }

      yOffset += block.marginBottom
    }

    renderedTextBlocks = renderedBlocks
    geometryDirty = false
  }

  private fun drawTextHighlights(
    canvas: Canvas,
    block: PageBlock,
    layout: StaticLayout,
    ranges: List<TextRange>,
    paint: Paint
  ) {
    val currentPage = page ?: return
    val blockTextLength = blockTextForSelection(block).length
    if (blockTextLength <= 0) return

    ranges.forEach { range ->
      if (
        range.pageIndex != currentPage.pageIndex ||
        range.spineIndex != currentPage.spineIndex ||
        range.blockId != block.blockId
      ) {
        return@forEach
      }

      val blockSourceStart = block.sourceStartOffset
      val blockSourceEnd = blockSourceStart + blockTextLength
      val localStart = max(range.sourceStartOffset, blockSourceStart) - blockSourceStart
      val localEnd = min(range.sourceEndOffset, blockSourceEnd) - blockSourceStart

      if (localStart >= localEnd) {
        return@forEach
      }

      highlightPath.reset()
      layout.getSelectionPath(
        localStart.coerceIn(0, blockTextLength),
        localEnd.coerceIn(0, blockTextLength),
        highlightPath
      )
      canvas.drawPath(highlightPath, paint)
    }
  }

  private fun wordCenterY(
    rendered: RenderedTextBlock,
    layout: StaticLayout,
    tokenRange: LocalTokenRange,
    fallbackLine: Int
  ): Float {
    highlightPath.reset()
    highlightBounds.setEmpty()
    layout.getSelectionPath(tokenRange.start, tokenRange.end, highlightPath)
    highlightPath.computeBounds(highlightBounds, true)

    return if (highlightBounds.width() > 0f || highlightBounds.height() > 0f) {
      rendered.y + highlightBounds.centerY()
    } else {
      rendered.y + (
        layout.getLineTop(fallbackLine) +
          layout.getLineBottom(fallbackLine)
        ) / 2f
    }
  }

  private fun tokenRangeAtOffset(text: String, offset: Int): LocalTokenRange? {
    if (text.isEmpty()) {
      return null
    }

    var probe = offset.coerceIn(0, text.length)
    if (probe == text.length) {
      probe -= 1
    }

    if (!isReaderTokenChar(text[probe])) {
      probe = when {
        probe > 0 && isReaderTokenChar(text[probe - 1]) -> probe - 1
        probe + 1 < text.length && isReaderTokenChar(text[probe + 1]) -> probe + 1
        else -> return null
      }
    }

    var start = probe
    while (start > 0 && isReaderTokenChar(text[start - 1])) {
      start -= 1
    }

    var end = probe + 1
    while (end < text.length && isReaderTokenChar(text[end])) {
      end += 1
    }

    return if (start < end) LocalTokenRange(start, end) else null
  }

  private fun sentenceForToken(text: String, tokenRange: LocalTokenRange): String {
    if (text.isEmpty()) {
      return ""
    }

    val sentenceBoundaries = setOf('.', '!', '?', '。', '！', '？', '\n')
    var start = tokenRange.start.coerceIn(0, text.length)
    while (start > 0 && !sentenceBoundaries.contains(text[start - 1])) {
      start -= 1
    }

    var end = tokenRange.end.coerceIn(start, text.length)
    while (end < text.length && !sentenceBoundaries.contains(text[end])) {
      end += 1
    }
    if (end < text.length && sentenceBoundaries.contains(text[end]) && text[end] != '\n') {
      end += 1
    }

    return text.substring(start, end)
      .replace(Regex("\\s+"), " ")
      .trim()
      .trim('“', '”', '"', '\'', '‘', '’')
  }

  private fun describeNoHitArea(tapX: Float, tapY: Float): String {
    val currentPage = page ?: return "outside text"
    val contentWidth = width - (paddingH * 2)
    if (contentWidth <= 0) return "outside text"

    var yOffset = paddingV.toFloat()
    currentPage.blocks.forEach { block ->
      val marginTopStart = yOffset
      yOffset += block.marginTop
      if (tapY in marginTopStart..yOffset) return "margin"

      val blockX = (paddingH + block.marginLeft).toFloat()
      val blockWidth = block.contentWidth.takeIf { it > 0 } ?: contentWidth
      val blockHeight = if (block.type == "image") {
        block.imageHeight
      } else {
        val layout = block.textLayout ?: buildFallbackTextLayout(block, contentWidth)
        layout?.height ?: 0
      }
      val blockBottom = yOffset + blockHeight

      if (tapY in yOffset..blockBottom) {
        if (tapX < blockX || tapX > blockX + blockWidth) return "margin"
        return if (block.type == "image") "image" else "blank space"
      }

      yOffset = blockBottom
      val marginBottomStart = yOffset
      yOffset += block.marginBottom
      if (tapY in marginBottomStart..yOffset) return "margin"
    }

    return "outside text"
  }

  private fun buildFallbackTextLayout(block: PageBlock, pageContentWidth: Int): StaticLayout? {
    val text = block.styledText ?: return null
    val textPaint = block.textPaint ?: return null
    val blockWidth = block.contentWidth.takeIf { it > 0 } ?: pageContentWidth
    val effectiveLineHeightMult = block.lineHeightMult.takeIf { it > 0f } ?: lineHeightMult

    return StaticLayout.Builder
      .obtain(text, 0, text.length, textPaint, blockWidth)
      .setAlignment(block.textAlign)
      .setLineSpacing(0f, effectiveLineHeightMult)
      .setIncludePad(true)
      .build()
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    geometryDirty = true
    if (w > 0 && h > 0) postInvalidateOnAnimation()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (page != null) {
      geometryDirty = true
      postInvalidateOnAnimation()
    }
  }

  override fun onDetachedFromWindow() {
    cancelPendingLongPress()
    if (isSelectionMode) {
      finishDragSelection(cancelled = true)
    }
    super.onDetachedFromWindow()
  }

  private fun drawImage(
    canvas: Canvas,
    block: PageBlock,
    x: Float,
    y: Float,
    contentWidth: Int
  ) {
    val uri = block.imageUri
    val bitmap = if (uri.isNullOrBlank()) null else bitmapForUri(uri)

    if (bitmap == null) {
      canvas.drawRoundRect(
        RectF(x, y, x + contentWidth, y + block.imageHeight),
        8f,
        8f,
        placeholderPaint
      )
      return
    }

    val scale = minOf(
      contentWidth.toFloat() / bitmap.width.toFloat(),
      block.imageHeight.toFloat() / bitmap.height.toFloat()
    )
    val drawWidth = bitmap.width * scale
    val drawHeight = bitmap.height * scale
    val left = x + ((contentWidth - drawWidth) / 2f)
    val top = y + ((block.imageHeight - drawHeight) / 2f)

    canvas.drawBitmap(
      bitmap,
      null,
      RectF(left, top, left + drawWidth, top + drawHeight),
      null
    )
  }

  private fun bitmapForUri(uri: String): Bitmap? {
    if (bitmapCache.containsKey(uri)) {
      return bitmapCache[uri]
    }

    val bitmap = try {
      context.contentResolver.openInputStream(Uri.parse(uri))?.use { stream ->
        BitmapFactory.decodeStream(stream)
      }
    } catch (_: Exception) {
      null
    }

    bitmapCache[uri] = bitmap
    return bitmap
  }

  private fun blockTextForSelection(block: PageBlock): String {
    return block.plainText.ifEmpty { block.styledText?.toString() ?: "" }
  }

  private fun dp(value: Float): Int {
    return (value * resources.displayMetrics.density).toInt()
  }
}
