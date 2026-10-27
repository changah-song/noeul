package expo.modules.nativeepubreader

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Typeface
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.text.StaticLayout
import android.text.TextUtils
import android.text.TextPaint
import android.util.Log
import android.util.TypedValue
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.animation.PathInterpolator
import java.text.BreakIterator
import java.util.Locale
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

private const val PAGE_VIEW_TAG = "EpubPageView"

// Focus (sentence beam) mode rendering constants, mirroring the design spec:
// unfocused sentences sit at 22% opacity and focus shifts animate over 300ms.
private const val FOCUS_DIM_ALPHA = 0.22f
private const val FOCUS_TRANSITION_DURATION_MS = 300L
// Shortened transition used while the reader is stepping rapidly through
// sentences, so consecutive beam moves don't queue up behind slow animations.
private const val FOCUS_TRANSITION_FAST_DURATION_MS = 140L
// How long the text selection's boxes take to slide to a new word.
private const val SELECTION_SLIDE_MS = 160L
// Slight second draw offset (dp) that emulates the focused sentence's heavier
// font weight without re-laying out the text.
private const val FOCUS_EMPHASIS_OFFSET_DP = 0.3f

// One line's piece of the text selection, in view coordinates. `key` is the
// (block, line) it sits on, so an animation can pair a line's old box with its
// new one.
private data class SelectionBox(val key: Long, val rect: RectF)

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

private enum class SelectionHandle {
  START,
  END
}

private data class SelectionHandleGeometry(
  val handle: SelectionHandle,
  val x: Float,
  val lineTop: Float,
  val lineBottom: Float,
  val knobCenterY: Float
)

private data class SelectionHandleLineMetrics(
  val x: Float,
  val stemTop: Float,
  val stemBottom: Float,
  val knobCenterY: Float
)

private data class SelectionHighlightVerticalMetrics(
  val top: Float,
  val bottom: Float
)

// A fading saved-word box (6 steps, see savedWordFade.js) is an even halftone
// of pixels in a soft tint, so the word, now in normal dark ink, reads on top.
private const val FADING_BOX_LIGHT_ALPHA = 0.32f
// 4x4 Bayer matrix: the order cells leave in, spread evenly over the box.
private val BAYER_4 = intArrayOf(0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5)
// Sliding glosses: pause at each end, then slide at this speed (dp/s).
private const val MARQUEE_PAUSE_MS = 1400L
// Parenthesised and bracketed asides in dictionary senses: "(CL:个[ge4])",
// "(bound form)", "[Lu3 Xun4]".
private val ASIDE_PATTERN = Regex("\\([^)]*\\)|（[^）]*）|\\[[^\\]]*]")
private const val MARQUEE_FRAME_MS = 40L

class EpubPageView(context: Context) : View(context) {
  private var page: ReaderPage? = null
  private var paddingH = 0
  private var paddingV = 0
  private var lineHeightMult = 1.5f
  private var pageBackgroundColor = Color.WHITE
  private var themePalette = readerThemePaletteForMode(false)
  private var activeSelectionRanges: List<TextRange> = emptyList()
  private var activeSelectionKind: ActiveSelectionKind? = null
  private var savedHighlightRanges: List<TextRange> = emptyList()
  private var levelRanges: List<TextRange> = emptyList()
  // When true, draw each level range's pinyin above the word (Chinese only). The
  // paginator reserves the vertical room; this view fills it.
  private var showPinyin: Boolean = false
  // When true, draw each annotated word's short translation under it.
  private var showGloss: Boolean = false
  // How far a level underline has dissolved after the reader tapped the word
  // (0 = solid, 1 = dotted). Set by the owner.
  var tapProgress: ((TextRange) -> Float)? = null
  // Called with a highlight's id when its note icon (in the margin) is tapped.
  var noteIconTapped: ((String) -> Unit)? = null
  // Where the note icons were drawn this frame, in view coordinates.
  private val noteIconHits = mutableListOf<Pair<RectF, String>>()
  private val noteIconPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
  private val noteIconPath = Path()
  // A saved box still losing pixels after a fade step: (strength it is
  // leaving, progress 0..1). Null once settled. Set by the owner.
  var savedFade: ((TextRange) -> Pair<Float, Float>?)? = null
  private var activeHighlightColor = themePalette.activeHighlightColor
  private var textSelectionHighlightColor = themePalette.textSelectionHighlightColor
  private var savedHighlightColor = themePalette.savedHighlightColor
  private var savedHighlightTextColor = themePalette.savedHighlightTextColor
  private var levelUnderlineEasyColor = themePalette.levelUnderlineEasyColor
  private var levelUnderlineMidColor = themePalette.levelUnderlineMidColor
  private var levelUnderlineHardColor = themePalette.levelUnderlineHardColor
  // §8: hard+frequent ("reinforced") words are blended toward this calm slate so they
  // read as "the book will reteach this" rather than "make a flashcard now"; the
  // salient easy→hard gradient stays for hard+rare ("study") words. v1 is a fixed tone
  // (not yet a theme token, so it does not swap for dark mode).
  private val reinforcedUnderlineTint = Color.rgb(0x5b, 0x6b, 0x8c)
  private var onWordSelected: ((WordHit) -> Unit)? = null
  private var onTextSelected: ((TextSelectionHit) -> Unit)? = null
  private var onSelectionCleared: (() -> Unit)? = null
  private var onSelectionDragStateChanged: ((Boolean) -> Unit)? = null
  private var onEdgeAction: ((ReaderEdgeKind) -> Unit)? = null
  private var onFocusTextTapped: ((String, Int) -> Unit)? = null
  private var focusModeEnabled = false
  // Set while the JS lookup panel is visible in focus mode; taps then dismiss
  // the panel instead of moving the beam or selecting another word.
  var focusPanelOpen = false
  private var focusRanges: List<FocusRange> = emptyList()
  private var previousFocusRanges: List<FocusRange> = emptyList()
  private var focusTransition = 1f
  private var focusAnimator: ValueAnimator? = null
  private val focusClipPath = Path()
  private val focusRangePath = Path()
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
  private var activeSelectionHandle: SelectionHandle? = null
  private var handleDragStartRanges: List<TextRange> = emptyList()
  // While a handle is dragged: the selection end that stays put, and where the
  // finger sits relative to the dragged handle's text position (so the text
  // under the handle, not under the fingertip, follows the finger).
  private var handleFixedPosition: TextPosition? = null
  private var handleTouchOffsetX = 0f
  private var handleTouchOffsetY = 0f
  // Last word boundary a drag landed on: a tick (haptic) per word, and no
  // redraw while the finger stays inside one word.
  private var lastSelectionFocusKey: Long = Long.MIN_VALUE
  // The text selection is drawn as one rounded box per line, hugging the
  // selected words. When the selection changes, the boxes slide from where they
  // were to where they now belong (iOS-like), rather than jumping.
  private var selectionBoxesShown: List<SelectionBox> = emptyList()
  private var selectionBoxesFrom: List<SelectionBox> = emptyList()
  private var selectionBoxesTarget: List<SelectionBox> = emptyList()
  private var selectionBoxProgress = 1f
  private var selectionBoxAnimator: ValueAnimator? = null
  private var lastSelectionTargetSnapshot: List<Pair<Long, RectF>> = emptyList()
  private val selectionBoxPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
  private val selectionHandleBarPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
  private var selectionAnchor: SelectionAnchor? = null
  private val highlightPath = Path()
  private val highlightBounds = RectF()
  private val savedHighlightPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = savedHighlightColor
    style = Paint.Style.FILL
  }
  // The reader's own highlights; the color comes from each range.
  private val userHighlightPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.FILL
  }
  private val savedHighlightTextPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    color = savedHighlightTextColor
    style = Paint.Style.FILL
  }
  // One paint for every level underline. Its color and stroke width are set per
  // range from that word's gradient weight just before it is drawn.
  private val levelMarkPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = levelUnderlineEasyColor
    style = Paint.Style.STROKE
    strokeWidth = dp(1.7f).toFloat()
    strokeCap = Paint.Cap.ROUND
  }
  // Pinyin drawn above underlined words. Size/color are set from the body text at
  // draw time so it tracks the reader font and theme.
  private val pinyinPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    textAlign = Paint.Align.CENTER
  }
  // Short translations drawn under annotated words, sized like the pinyin.
  private val glossPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    textAlign = Paint.Align.CENTER
  }

  private val activeHighlightPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = activeHighlightColor
    style = Paint.Style.FILL
  }
  private val selectionHandlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = themePalette.selectionHandleColor
    style = Paint.Style.STROKE
    strokeWidth = dp(2f).toFloat()
    strokeCap = Paint.Cap.ROUND
  }
  private val selectionHandleKnobPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = themePalette.selectionHandleColor
    style = Paint.Style.FILL
  }
  private val selectionLineRect = RectF()
  private val edgeButtonRect = RectF()
  private val edgeIconPath = Path()
  private val bookFinishedIconRect = RectF()
  private val bookFinishedIconPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    isFilterBitmap = true
    isDither = true
  }
  private val bookFinishedIconBitmap by lazy {
    BitmapFactory.decodeResource(resources, R.drawable.book_over_icon)
  }
  private val edgeSansRegularTypeface by lazy { loadReaderSansTypeface(context, "regular") }
  private val edgeSansMediumTypeface by lazy { loadReaderSansTypeface(context, "medium") }
  private val edgeSansBoldTypeface by lazy { loadReaderSansTypeface(context, "bold") }
  private val edgeDisplayTypeface by lazy { loadReaderDisplayTypeface(context, "medium") }
  private val placeholderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = themePalette.placeholderColor
    style = Paint.Style.FILL
  }

  fun bind(
    page: ReaderPage,
    paddingH: Int,
    paddingV: Int,
    lineHeightMult: Float,
    backgroundColor: Int,
    themePalette: ReaderThemePalette,
    activeSelectionRanges: List<TextRange>,
    activeSelectionKind: ActiveSelectionKind?,
    savedHighlightRanges: List<TextRange>,
    levelRanges: List<TextRange>,
    activeHighlightColor: Int,
    textSelectionHighlightColor: Int,
    savedHighlightColor: Int,
    savedHighlightTextColor: Int,
    levelUnderlineEasyColor: Int,
    levelUnderlineMidColor: Int,
    levelUnderlineHardColor: Int,
    onWordSelected: ((WordHit) -> Unit)?,
    onTextSelected: ((TextSelectionHit) -> Unit)?,
    onSelectionCleared: (() -> Unit)?,
    onSelectionDragStateChanged: ((Boolean) -> Unit)?,
    onEdgeAction: ((ReaderEdgeKind) -> Unit)?,
    focusModeEnabled: Boolean = false,
    onFocusTextTapped: ((String, Int) -> Unit)? = null,
    showPinyin: Boolean = false,
    showGloss: Boolean = false
  ) {
    this.showPinyin = showPinyin
    this.showGloss = showGloss
    this.page = page
    this.paddingH = paddingH
    this.paddingV = paddingV
    this.lineHeightMult = lineHeightMult
    this.pageBackgroundColor = backgroundColor
    this.themePalette = themePalette
    selectionHandlePaint.color = themePalette.selectionHandleColor
    selectionHandleKnobPaint.color = themePalette.selectionHandleColor
    placeholderPaint.color = themePalette.placeholderColor
    this.onWordSelected = onWordSelected
    this.onTextSelected = onTextSelected
    this.onSelectionCleared = onSelectionCleared
    this.onSelectionDragStateChanged = onSelectionDragStateChanged
    this.onEdgeAction = onEdgeAction
    if (this.focusModeEnabled != focusModeEnabled) {
      focusAnimator?.cancel()
      focusRanges = emptyList()
      previousFocusRanges = emptyList()
      focusTransition = 1f
    }
    this.focusModeEnabled = focusModeEnabled
    this.onFocusTextTapped = onFocusTextTapped
    updateHighlights(
      activeSelectionRanges = activeSelectionRanges,
      activeSelectionKind = activeSelectionKind,
      savedHighlightRanges = savedHighlightRanges,
      levelRanges = levelRanges,
      activeHighlightColor = activeHighlightColor,
      textSelectionHighlightColor = textSelectionHighlightColor,
      savedHighlightColor = savedHighlightColor,
      savedHighlightTextColor = savedHighlightTextColor,
      levelUnderlineEasyColor = levelUnderlineEasyColor,
      levelUnderlineMidColor = levelUnderlineMidColor,
      levelUnderlineHardColor = levelUnderlineHardColor
    )
    geometryDirty = true
    invalidate()
    postInvalidateOnAnimation()
  }

  fun updateHighlights(
    activeSelectionRanges: List<TextRange>,
    activeSelectionKind: ActiveSelectionKind?,
    savedHighlightRanges: List<TextRange>,
    levelRanges: List<TextRange>,
    activeHighlightColor: Int,
    textSelectionHighlightColor: Int,
    savedHighlightColor: Int,
    savedHighlightTextColor: Int,
    levelUnderlineEasyColor: Int,
    levelUnderlineMidColor: Int,
    levelUnderlineHardColor: Int
  ) {
    this.activeSelectionRanges = activeSelectionRanges
    this.activeSelectionKind = activeSelectionKind
    this.savedHighlightRanges = savedHighlightRanges
    this.levelRanges = levelRanges
    this.activeHighlightColor = activeHighlightColor
    this.textSelectionHighlightColor = textSelectionHighlightColor
    this.savedHighlightColor = savedHighlightColor
    this.savedHighlightTextColor = savedHighlightTextColor
    this.levelUnderlineEasyColor = levelUnderlineEasyColor
    this.levelUnderlineMidColor = levelUnderlineMidColor
    this.levelUnderlineHardColor = levelUnderlineHardColor
    savedHighlightPaint.color = savedHighlightColor
    savedHighlightTextPaint.color = savedHighlightTextColor
    activeHighlightPaint.color = activePaintColor()
    invalidate()
    postInvalidateOnAnimation()
  }

  override fun onDraw(canvas: Canvas) {
    marqueeTickScheduled = false
    readAnimationPending = false
    canvas.drawColor(pageBackgroundColor)
    val contentWidth = width - (paddingH * 2)
    if (contentWidth <= 0) return
    drawSelectionBoxes(canvas)
    drawPageBlocks(canvas, contentWidth)
    drawSelectionHandleMarks(canvas)
    drawReaderEdgeState(canvas)
    if (readAnimationPending) postInvalidateOnAnimation()
  }

  // ── Text selection: tight rounded boxes and iOS-style handles ─────────────

  private fun selectionAccentColor(): Int {
    return if (Color.luminance(themePalette.backgroundColor) < 0.4f) {
      Color.rgb(0x5A, 0xA2, 0xFF)
    } else {
      Color.rgb(0x2F, 0x7B, 0xF6)
    }
  }

  // One box per line of the selection, from the first selected glyph to the
  // last on that line (never the paragraph indent or a trailing space), and
  // from the line's ascent to its descent.
  private fun computeSelectionBoxes(): List<SelectionBox> {
    if (activeSelectionKind != ActiveSelectionKind.TEXT || activeSelectionRanges.isEmpty()) return emptyList()
    if (geometryDirty) rebuildGeometry()
    val currentPage = page ?: return emptyList()
    val pad = dp(2f).toFloat()
    val boxes = mutableListOf<SelectionBox>()
    sortedActiveTextSelectionRanges().forEach { range ->
      if (range.pageIndex != currentPage.pageIndex || range.spineIndex != currentPage.spineIndex) return@forEach
      val renderedIndex = renderedTextBlocks.indexOfFirst { it.block.blockId == range.blockId }
      if (renderedIndex < 0) return@forEach
      val rendered = renderedTextBlocks[renderedIndex]
      val layout = rendered.layout
      val text = layout.text
      val textLength = blockTextForSelection(rendered.block).length.coerceAtMost(text.length)
      val localStart = (range.sourceStartOffset - rendered.block.sourceStartOffset).coerceIn(0, textLength)
      val localEnd = (range.sourceEndOffset - rendered.block.sourceStartOffset).coerceIn(localStart, textLength)
      if (localStart >= localEnd || layout.lineCount <= 0) return@forEach
      val metrics = rendered.block.textPaint?.fontMetrics
      val firstLine = layout.getLineForOffset(localStart)
      val lastLine = layout.getLineForOffset(max(localStart, localEnd - 1))
      for (line in firstLine..lastLine) {
        val lineEnd = layout.getLineEnd(line)
        var from = max(localStart, layout.getLineStart(line))
        var to = min(localEnd, layout.getLineVisibleEnd(line))
        while (from < to && text[from].isWhitespace()) from++
        while (to > from && text[to - 1].isWhitespace()) to--
        if (from >= to) continue
        val x1 = layout.getPrimaryHorizontal(from)
        val x2 = if (to >= lineEnd) layout.getLineRight(line) else layout.getPrimaryHorizontal(to)
        val baseline = layout.getLineBaseline(line).toFloat()
        val top = metrics?.let { baseline + it.ascent } ?: layout.getLineTop(line).toFloat()
        val bottom = metrics?.let { baseline + it.descent } ?: layout.getLineBottom(line).toFloat()
        boxes.add(
          SelectionBox(
            key = (renderedIndex.toLong() shl 32) or line.toLong(),
            rect = RectF(
              rendered.x + min(x1, x2) - pad,
              rendered.y + top - pad,
              rendered.x + max(x1, x2) + pad,
              rendered.y + bottom + pad
            )
          )
        )
      }
    }
    return boxes
  }

  // Starts a slide from what is on screen now to `target`. A line that only
  // the new selection has grows out of the edge nearest the old selection; a
  // line it no longer has shrinks into that edge.
  private fun animateSelectionBoxesTo(target: List<SelectionBox>) {
    val current = selectionBoxesShown
    selectionBoxAnimator?.cancel()
    selectionBoxesTarget = target
    if (current.isEmpty() || target.isEmpty()) {
      selectionBoxesFrom = target
      selectionBoxesShown = target
      selectionBoxProgress = 1f
      return
    }
    val currentKeys = current.associateBy { it.key }
    val targetKeys = target.associateBy { it.key }
    val firstKey = current.first().key
    fun collapsedAt(box: SelectionBox, atRight: Boolean): RectF {
      val x = if (atRight) box.rect.right else box.rect.left
      return RectF(x, box.rect.top, x, box.rect.bottom)
    }
    val keys = (current.map { it.key } + target.map { it.key }).distinct().sorted()
    val from = mutableListOf<SelectionBox>()
    val to = mutableListOf<SelectionBox>()
    keys.forEach { key ->
      val old = currentKeys[key]
      val new = targetKeys[key]
      // Lines before the old selection open from their right edge (they join
      // its start); lines after it from their left edge.
      val beforeOld = key < firstKey
      from.add(SelectionBox(key, old?.rect?.let(::RectF) ?: collapsedAt(new!!, atRight = beforeOld)))
      to.add(SelectionBox(key, new?.rect?.let(::RectF) ?: collapsedAt(old!!, atRight = beforeOld)))
    }
    selectionBoxesFrom = from
    selectionBoxesTarget = to
    selectionBoxProgress = 0f
    selectionBoxAnimator = ValueAnimator.ofFloat(0f, 1f).apply {
      duration = SELECTION_SLIDE_MS
      interpolator = PathInterpolator(0.2f, 0f, 0f, 1f)
      addUpdateListener { animator ->
        selectionBoxProgress = animator.animatedValue as Float
        invalidate()
      }
      addListener(object : android.animation.AnimatorListenerAdapter() {
        override fun onAnimationEnd(animation: android.animation.Animator) {
          selectionBoxesTarget = target
          selectionBoxesShown = target
        }
      })
      start()
    }
  }

  private fun drawSelectionBoxes(canvas: Canvas) {
    val target = computeSelectionBoxes()
    val snapshot = target.map { it.key to it.rect }
    if (snapshot != lastSelectionTargetSnapshot) {
      lastSelectionTargetSnapshot = snapshot
      animateSelectionBoxesTo(target)
    }
    if (target.isEmpty() && selectionBoxProgress >= 1f) {
      selectionBoxesShown = emptyList()
      return
    }
    val t = selectionBoxProgress.coerceIn(0f, 1f)
    val shown = if (t >= 1f) {
      selectionBoxesTarget
    } else {
      selectionBoxesTarget.mapIndexed { index, end ->
        val start = selectionBoxesFrom.getOrNull(index)?.rect ?: end.rect
        SelectionBox(
          end.key,
          RectF(
            start.left + (end.rect.left - start.left) * t,
            start.top + (end.rect.top - start.top) * t,
            start.right + (end.rect.right - start.right) * t,
            start.bottom + (end.rect.bottom - start.bottom) * t
          )
        )
      }
    }
    selectionBoxesShown = shown.filter { it.rect.width() > 0.5f }
    val radius = dp(5f).toFloat()
    selectionBoxPaint.color = selectionAccentColor()
    selectionBoxPaint.alpha = 0x48
    selectionBoxesShown.forEach { box -> canvas.drawRoundRect(box.rect, radius, radius, selectionBoxPaint) }
  }

  // iOS-style handles: a thin bar the height of the selection's first (or last)
  // line, with a round knob above the start and below the end.
  private fun drawSelectionHandleMarks(canvas: Canvas) {
    if (activeSelectionKind != ActiveSelectionKind.TEXT) return
    val boxes = selectionBoxesShown
    if (boxes.isEmpty()) return
    val accent = selectionAccentColor()
    selectionHandleBarPaint.color = accent
    selectionHandleKnobPaint.color = accent
    val barWidth = dp(2f).toFloat()
    val knob = dp(5.5f).toFloat()
    val first = boxes.first().rect
    val last = boxes.last().rect
    canvas.drawRoundRect(first.left - barWidth / 2f, first.top, first.left + barWidth / 2f, first.bottom, barWidth, barWidth, selectionHandleBarPaint)
    canvas.drawCircle(first.left, first.top - knob + dp(1f), knob, selectionHandleKnobPaint)
    canvas.drawRoundRect(last.right - barWidth / 2f, last.top, last.right + barWidth / 2f, last.bottom, barWidth, barWidth, selectionHandleBarPaint)
    canvas.drawCircle(last.right, last.bottom + knob - dp(1f), knob, selectionHandleKnobPaint)
  }

  // In scroll and focus modes this view holds the whole chapter inside a
  // ScrollView, and every invalidate (each focus fade frame, a selection, a
  // highlight change) re-records its display list. Recording only the blocks
  // near the visible window keeps that cost proportional to the screen, not
  // the chapter. The window spans one screen above and below what's visible;
  // the scroll view calls onViewportScrolled so we re-record before the
  // reader scrolls past it.
  private var recordedWindowTop = Int.MIN_VALUE
  private var recordedWindowBottom = Int.MAX_VALUE

  private fun scrollViewport(): Pair<Int, Int>? {
    val scroller = parent as? android.widget.ScrollView ?: return null
    val viewportHeight = scroller.height
    if (viewportHeight <= 0) return null
    return scroller.scrollY to viewportHeight
  }

  fun onViewportScrolled(scrollY: Int, viewportHeight: Int) {
    if (recordedWindowTop == Int.MIN_VALUE) return
    val margin = viewportHeight / 4
    if (scrollY - margin < recordedWindowTop || scrollY + viewportHeight + margin > recordedWindowBottom) {
      invalidate()
    }
  }

  private fun drawPageBlocks(canvas: Canvas, contentWidth: Int) {
    var yOffset = paddingV.toFloat()
    noteIconHits.clear()
    val viewport = scrollViewport()
    val windowTop: Float
    val windowBottom: Float
    if (viewport != null) {
      val (scrollY, viewportHeight) = viewport
      recordedWindowTop = scrollY - viewportHeight
      recordedWindowBottom = scrollY + viewportHeight * 2
      windowTop = recordedWindowTop.toFloat()
      windowBottom = recordedWindowBottom.toFloat()
    } else {
      recordedWindowTop = Int.MIN_VALUE
      recordedWindowBottom = Int.MAX_VALUE
      windowTop = Float.NEGATIVE_INFINITY
      windowBottom = Float.POSITIVE_INFINITY
    }

    page?.blocks?.forEach { block ->
      yOffset += block.marginTop

      // Skip blocks wholly outside the recorded window. Text heights come from
      // the prebuilt layout, so skipping never changes where later blocks land.
      val blockHeight = if (block.type == "image") {
        block.imageHeight.toFloat()
      } else {
        block.textLayout?.height?.toFloat()
      }
      if (blockHeight != null && (yOffset + blockHeight < windowTop || yOffset > windowBottom)) {
        yOffset += blockHeight + block.marginBottom
        return@forEach
      }

      if (block.type == "image") {
        val blockWidth = block.contentWidth.takeIf { it > 0 } ?: contentWidth
        val imageX = (paddingH + block.marginLeft).toFloat()
        if (focusModeEnabled) {
          val dimLayer = canvas.saveLayerAlpha(
            imageX,
            yOffset,
            imageX + blockWidth,
            yOffset + block.imageHeight,
            (FOCUS_DIM_ALPHA * 255).roundToInt()
          )
          drawImage(canvas, block, imageX, yOffset, blockWidth)
          canvas.restoreToCount(dimLayer)
        } else {
          drawImage(canvas, block, imageX, yOffset, blockWidth)
        }
        yOffset += block.imageHeight
      } else {
        val layout = block.textLayout ?: buildFallbackTextLayout(block, contentWidth) ?: return@forEach

        canvas.save()
        canvas.translate((paddingH + block.marginLeft).toFloat(), yOffset)
        if (focusModeEnabled) {
          drawFocusModeBlock(canvas, block, layout)
        } else {
          drawBlockContent(canvas, block, layout)
        }
        canvas.restore()
        drawNoteIcons(canvas, block, layout, yOffset)

        yOffset += layout.height
      }

      yOffset += block.marginBottom
    }
  }

  // A small speech bubble in the right margin, level with the first line of
  // each highlight that has a note. `top` is the block's top in view space.
  private fun drawNoteIcons(canvas: Canvas, block: PageBlock, layout: StaticLayout, top: Float) {
    val currentPage = page ?: return
    if (savedHighlightRanges.none { it.noteId != null }) return
    val textLength = blockTextForSelection(block).length
    if (textLength <= 0 || layout.lineCount <= 0) return
    val size = min(dp(15f).toFloat(), max(dp(9f).toFloat(), paddingH * 0.62f))
    val centerX = width - paddingH / 2f
    val metrics = block.textPaint?.fontMetrics
    noteIconPaint.color = themePalette.mutedTextColor
    savedHighlightRanges.forEach { range ->
      val noteId = range.noteId ?: return@forEach
      if (
        range.blockId != block.blockId ||
        range.pageIndex != currentPage.pageIndex ||
        range.spineIndex != currentPage.spineIndex
      ) return@forEach
      val localStart = (range.sourceStartOffset - block.sourceStartOffset).coerceIn(0, textLength)
      val line = layout.getLineForOffset(localStart).coerceIn(0, layout.lineCount - 1)
      val baseline = layout.getLineBaseline(line).toFloat()
      val centerY = top + (metrics?.let { baseline + (it.ascent + it.descent) / 2f }
        ?: ((layout.getLineTop(line) + layout.getLineBottom(line)) / 2f))
      val left = centerX - size / 2f
      val bubbleTop = centerY - size * 0.45f
      val bubbleBottom = centerY + size * 0.3f
      val radius = size * 0.22f
      noteIconPath.reset()
      noteIconPath.addRoundRect(left, bubbleTop, left + size, bubbleBottom, radius, radius, Path.Direction.CW)
      noteIconPath.moveTo(left + size * 0.22f, bubbleBottom - 1f)
      noteIconPath.lineTo(left + size * 0.22f, bubbleBottom + size * 0.28f)
      noteIconPath.lineTo(left + size * 0.5f, bubbleBottom - 1f)
      noteIconPath.close()
      canvas.drawPath(noteIconPath, noteIconPaint)
      noteIconHits.add(RectF(left, bubbleTop, left + size, bubbleBottom + size * 0.28f) to noteId)
    }
  }

  private fun noteIconAt(x: Float, y: Float): String? {
    if (noteIconHits.isEmpty()) return null
    val slop = dp(14f).toFloat()
    return noteIconHits.firstOrNull { (rect, _) ->
      x >= rect.left - slop && x <= rect.right + slop && y >= rect.top - slop && y <= rect.bottom + slop
    }?.second
  }

  private fun drawBlockContent(canvas: Canvas, block: PageBlock, layout: StaticLayout) {
    activeHighlightPaint.color = activePaintColor()
    // A text selection is drawn for the whole page at once (drawSelectionBoxes).
    if (activeSelectionKind != ActiveSelectionKind.TEXT) {
      drawTextHighlights(canvas, block, layout, activeSelectionRanges, activeHighlightPaint)
    }
    drawTextHighlights(canvas, block, layout, levelRanges, levelMarkPaint)
    drawTextHighlights(canvas, block, layout, savedHighlightRanges, savedHighlightPaint)
    layout.draw(canvas)
    drawSavedHighlightText(canvas, block, layout, savedHighlightRanges)
    if (showPinyin || showGloss) {
      drawAnnotations(canvas, block, layout)
    }
  }

  // Annotation rows drawn into the space the paginator reserved between lines:
  // pinyin centered above each word, the gloss centered below it. Each gloss
  // gets a slot reaching halfway to its neighbours on the line; one that doesn't
  // fit its slot slides back and forth inside it instead of being cut off, so
  // the whole translation can be read. Sliding glosses schedule redraws only
  // while one is on screen, and none during the pauses at either end.
  private data class GlossItem(val line: Int, val left: Float, val right: Float, val text: String)

  private var marqueeTickScheduled = false
  private var selectionDragStarted = false
  private val selectionDragSlop = ViewConfiguration.get(context).scaledTouchSlop.toFloat()

  // Set while a tapped underline is still dissolving, to draw the next frame.
  private var readAnimationPending = false
  private val underlinePath = Path()
  // Pixel marks are drawn as a grid of square "pixels" (no anti-aliasing, so
  // the cells stay crisp): a tapped word's underline dissolves into a dotted
  // row, and a saved word's box loses pixels as it fades.
  private val pixelPaint = Paint().apply { style = Paint.Style.FILL }
  private val pixelRect = RectF()
  private val pixelSize: Int by lazy { dp(3f).coerceAtLeast(2) }

  // Pseudo-random, fixed order in which grid cells leave.
  private fun pixelHash(ix: Int, iy: Int): Float =
    (((ix * 73856093) xor (iy * 19349663)) and 0xffff) / 65535f

  // Tapped underline: even cells (the dotted row) always stay; odd cells leave
  // in hash order as progress runs 0 -> 1.
  private fun pixelKept(ix: Int, iy: Int, progress: Float): Boolean {
    if ((ix + iy) and 1 == 0) return true
    return pixelHash(ix, iy) >= progress
  }

  private fun tapDissolve(range: TextRange): Float {
    val progress = tapProgress?.invoke(range) ?: 0f
    if (progress > 0f && progress < 1f) readAnimationPending = true
    return progress
  }

  private fun drawAnnotations(canvas: Canvas, block: PageBlock, layout: StaticLayout) {
    if (levelRanges.isEmpty()) return
    val currentPage = page ?: return
    val blockTextLength = blockTextForSelection(block).length
    if (blockTextLength <= 0) return
    val bodyPaint = block.textPaint ?: return

    // Small type needs more contrast than the subtle ink gives it on a dark
    // page, so dark themes use the (brighter) muted ink for pinyin and glosses.
    val annotationColor = if (Color.luminance(themePalette.backgroundColor) < 0.4f) {
      themePalette.mutedTextColor
    } else {
      themePalette.subtleTextColor
    }
    pinyinPaint.textSize = bodyPaint.textSize * 0.55f
    pinyinPaint.color = annotationColor
    glossPaint.color = annotationColor
    val ascent = bodyPaint.fontMetrics.ascent
    val descent = bodyPaint.fontMetrics.descent
    val glosses = mutableListOf<GlossItem>()

    rangesForBlock(levelRanges, block.blockId).forEach { range ->
      if (
        range.pageIndex != currentPage.pageIndex ||
        range.spineIndex != currentPage.spineIndex
      ) {
        return@forEach
      }
      val pinyin = if (showPinyin) range.pinyin?.takeIf { it.isNotBlank() } else null
      val gloss = if (showGloss) range.gloss?.takeIf { it.isNotBlank() } else null
      if (pinyin == null && gloss == null) return@forEach

      val blockSourceStart = block.sourceStartOffset
      val blockSourceEnd = blockSourceStart + blockTextLength
      val localStart = (max(range.sourceStartOffset, blockSourceStart) - blockSourceStart)
        .coerceIn(0, blockTextLength)
      val localEnd = (min(range.sourceEndOffset, blockSourceEnd) - blockSourceStart)
        .coerceIn(localStart, blockTextLength)
      if (localStart >= localEnd) {
        return@forEach
      }

      // A word can wrap across lines (Chinese breaks anywhere, so 大钱 often
      // ends one line as 大 and starts the next as 钱). Annotate every part:
      // pinyin syllable by syllable when the reading has one per character,
      // and the gloss under each part, so the character that starts the next
      // line is never left bare.
      val firstLine = layout.getLineForOffset(localStart)
      val lastLine = layout.getLineForOffset(localEnd - 1)
      val syllables = pinyin?.trim()?.split(Regex("\\s+"))
      val perCharacterPinyin = syllables != null && syllables.size == localEnd - localStart
      val glossLabel = gloss?.let { firstSense(it) }.orEmpty()
      for (line in firstLine..lastLine) {
        val partStart = max(localStart, layout.getLineStart(line))
        val visibleLineEnd = layout.getLineVisibleEnd(line)
        val partEnd = min(localEnd, visibleLineEnd)
        if (partStart >= partEnd) continue
        val startX = layout.getPrimaryHorizontal(partStart)
        val endX = if (partEnd >= visibleLineEnd) {
          layout.getLineRight(line)
        } else {
          layout.getPrimaryHorizontal(partEnd)
        }
        val left = min(startX, endX)
        val right = max(startX, endX)
        val baseline = layout.getLineBaseline(line).toFloat()

        if (pinyin != null) {
          // Baseline just above the glyph tops, in the gap above the line.
          val pinyinBaseline = baseline + ascent - dp(1f) - pinyinPaint.descent()
          if (perCharacterPinyin) {
            // Ruby style: each syllable over its own character, squeezed
            // horizontally when it's wider than the character, so neighbouring
            // words' readings never run into each other.
            for (index in partStart until partEnd) {
              val syllable = syllables!![index - localStart]
              val cellLeft = layout.getPrimaryHorizontal(index)
              val cellRight = if (index + 1 >= visibleLineEnd) layout.getLineRight(line) else layout.getPrimaryHorizontal(index + 1)
              val cellWidth = abs(cellRight - cellLeft) - dp(1f)
              if (cellWidth <= 0f) continue
              val natural = pinyinPaint.measureText(syllable)
              pinyinPaint.textScaleX = if (natural > cellWidth) (cellWidth / natural).coerceAtLeast(0.55f) else 1f
              canvas.drawText(syllable, (cellLeft + cellRight) / 2f, pinyinBaseline, pinyinPaint)
            }
            pinyinPaint.textScaleX = 1f
          } else if (line == firstLine) {
            // No per-character reading: the whole thing over the word, squeezed to fit.
            val natural = pinyinPaint.measureText(pinyin)
            val available = right - left + dp(6f)
            pinyinPaint.textScaleX = if (natural > available) (available / natural).coerceAtLeast(0.55f) else 1f
            canvas.drawText(pinyin, (left + right) / 2f, pinyinBaseline, pinyinPaint)
            pinyinPaint.textScaleX = 1f
          }
        }
        if (glossLabel.isNotEmpty()) {
          glosses.add(GlossItem(line, left, right, glossLabel))
        }
      }
    }

    if (glosses.isEmpty()) return
    // Hangul and CJK glosses are short and dense, so they can be larger than
    // a Latin-script gloss (which is longer and slides when it doesn't fit).
    val compactScript = glosses.any { item -> item.text.any(::isCompactScriptChar) }
    glossPaint.textSize = bodyPaint.textSize * (if (compactScript) GLOSS_TEXT_SCALE_COMPACT else GLOSS_TEXT_SCALE_LATIN)
    val gap = dp(3f).toFloat()
    val edgeSlack = dp(24f).toFloat()
    val now = SystemClock.uptimeMillis()
    var nextTickMs = Long.MAX_VALUE

    glosses.groupBy { it.line }.forEach { (line, items) ->
      val sorted = items.sortedBy { it.left }
      // Baseline just below the line's descenders, in the gap below the line.
      val baseline = layout.getLineBaseline(line) + descent + dp(1f) - glossPaint.ascent()
      sorted.forEachIndexed { index, item ->
        val slotLeft = if (index == 0) {
          max(0f, item.left - edgeSlack)
        } else {
          (sorted[index - 1].right + item.left) / 2f + gap / 2f
        }
        val slotRight = if (index == sorted.lastIndex) {
          min(layout.width.toFloat(), item.right + edgeSlack)
        } else {
          (item.right + sorted[index + 1].left) / 2f - gap / 2f
        }
        val slotWidth = slotRight - slotLeft
        if (slotWidth < dp(10f)) return@forEachIndexed
        val width = glossPaint.measureText(item.text)
        val center = (item.left + item.right) / 2f

        if (width <= slotWidth) {
          // Centered on the word, nudged to stay inside the slot.
          val x = center.coerceIn(slotLeft + width / 2f, slotRight - width / 2f)
          canvas.drawText(item.text, x, baseline, glossPaint)
        } else {
          val overflow = width - slotWidth
          val (offset, untilChange) = marqueeOffset(overflow, now)
          nextTickMs = min(nextTickMs, untilChange)
          val save = canvas.save()
          canvas.clipRect(slotLeft, baseline + glossPaint.ascent(), slotRight, baseline + glossPaint.descent())
          // textAlign is CENTER: the text's left edge sits at slotLeft - offset.
          canvas.drawText(item.text, slotLeft - offset + width / 2f, baseline, glossPaint)
          canvas.restoreToCount(save)
        }
      }
    }

    if (nextTickMs != Long.MAX_VALUE && !marqueeTickScheduled) {
      marqueeTickScheduled = true
      postInvalidateDelayed(nextTickMs.coerceIn(MARQUEE_FRAME_MS, MARQUEE_PAUSE_MS))
    }
  }

  // Where a sliding gloss is right now: (pixels scrolled, ms until the next
  // frame is needed). The cycle is pause, slide left, pause, slide back; all
  // glosses share the clock so they move together.
  private fun marqueeOffset(overflow: Float, now: Long): Pair<Float, Long> {
    val slideMs = (overflow / (dp(28f).toFloat()) * 1000f).toLong().coerceAtLeast(500L)
    val cycle = 2 * MARQUEE_PAUSE_MS + 2 * slideMs
    val t = now % cycle
    return when {
      t < MARQUEE_PAUSE_MS -> 0f to (MARQUEE_PAUSE_MS - t)
      t < MARQUEE_PAUSE_MS + slideMs -> (overflow * (t - MARQUEE_PAUSE_MS) / slideMs) to MARQUEE_FRAME_MS
      t < 2 * MARQUEE_PAUSE_MS + slideMs -> overflow to (2 * MARQUEE_PAUSE_MS + slideMs - t)
      else -> (overflow * (1f - (t - 2 * MARQUEE_PAUSE_MS - slideMs).toFloat() / slideMs)) to MARQUEE_FRAME_MS
    }
  }

  private fun isCompactScriptChar(ch: Char): Boolean {
    val block = Character.UnicodeBlock.of(ch) ?: return false
    return block == Character.UnicodeBlock.HANGUL_SYLLABLES ||
      block == Character.UnicodeBlock.HANGUL_JAMO ||
      block == Character.UnicodeBlock.HANGUL_COMPATIBILITY_JAMO ||
      block == Character.UnicodeBlock.CJK_UNIFIED_IDEOGRAPHS ||
      block == Character.UnicodeBlock.HIRAGANA ||
      block == Character.UnicodeBlock.KATAKANA
  }

  // The gloss's first sense, without the dictionary's asides: "(located) at;
  // (to be) in" -> "at", "pocket (in a garment)" -> "pocket", "(bound form)
  // to go" -> "to go". A sense that is nothing but an aside is skipped.
  private fun firstSense(gloss: String): String {
    // Asides first: a comma inside "(since the 20th century, ...)" would
    // otherwise split the sense in the middle of the parenthesis.
    val withoutAsides = gloss.replace(ASIDE_PATTERN, " ")
    withoutAsides.split(';', '；', ',', '，').forEach { sense ->
      val cleaned = sense.replace(Regex("\\s+"), " ").trim()
      if (cleaned.isNotEmpty()) return cleaned
    }
    return ""
  }

  // Focus mode: draw the whole block dimmed, then re-draw the focused sentence
  // span(s) at full opacity clipped to their glyph bounds. During a focus shift
  // the outgoing span fades down while the incoming span fades up (300ms).
  // How far a block's annotations reach outside its text layout: the pinyin
  // row above the first line and the gloss row below the last. Layers drawn
  // for a block must cover these, or they clip the first line's pinyin.
  private fun annotationOverhang(block: PageBlock): Pair<Float, Float> {
    val bodyTextPx = block.textPaint?.textSize ?: return 0f to 0f
    val above = if (showPinyin) bodyTextPx * PINYIN_ROW_SCALE + dp(4f) else 0f
    val below = if (showGloss) bodyTextPx * GLOSS_ROW_SCALE + dp(4f) else 0f
    return above to below
  }

  private fun drawFocusModeBlock(canvas: Canvas, block: PageBlock, layout: StaticLayout) {
    val layoutWidth = layout.width.toFloat().coerceAtLeast(1f)
    val layoutHeight = layout.height.toFloat().coerceAtLeast(1f)
    val (above, below) = annotationOverhang(block)
    val dimLayer = canvas.saveLayerAlpha(
      -dp(8f).toFloat(),
      -above,
      layoutWidth + dp(8f),
      layoutHeight + below,
      (FOCUS_DIM_ALPHA * 255).roundToInt()
    )
    drawBlockContent(canvas, block, layout)
    canvas.restoreToCount(dimLayer)

    if (focusTransition < 1f) {
      drawFocusOverlay(canvas, block, layout, previousFocusRanges, 1f - focusTransition)
    }
    drawFocusOverlay(canvas, block, layout, focusRanges, focusTransition)
  }

  private fun drawFocusOverlay(
    canvas: Canvas,
    block: PageBlock,
    layout: StaticLayout,
    ranges: List<FocusRange>,
    alpha: Float
  ) {
    if (alpha <= 0.01f) return

    val textLength = blockTextForSelection(block).length
    if (textLength <= 0) return

    focusClipPath.reset()
    var hasClip = false
    ranges.forEach { range ->
      if (range.blockId != block.blockId) return@forEach
      val localStart = range.startOffset.coerceIn(0, textLength)
      val localEnd = range.endOffset.coerceIn(localStart, textLength)
      if (localStart >= localEnd) return@forEach
      focusRangePath.reset()
      layout.getSelectionPath(localStart, localEnd, focusRangePath)
      focusClipPath.addPath(focusRangePath)
      if (showPinyin || showGloss) {
        addAnnotationClip(block, layout, localStart, localEnd)
      }
      hasClip = true
    }
    if (!hasClip || focusClipPath.isEmpty) return

    val layoutWidth = layout.width.toFloat().coerceAtLeast(1f)
    val layoutHeight = layout.height.toFloat().coerceAtLeast(1f)
    val (above, below) = annotationOverhang(block)
    val clipSave = canvas.save()
    canvas.clipPath(focusClipPath)
    val overlayLayer = canvas.saveLayerAlpha(
      -dp(8f).toFloat(),
      -above,
      layoutWidth + dp(8f),
      layoutHeight + below,
      (alpha.coerceIn(0f, 1f) * 255).roundToInt()
    )
    drawBlockContent(canvas, block, layout)
    // Faux medium weight: a hairline-offset second pass thickens the focused
    // glyphs slightly, standing in for the design's 400 → 500 weight bump.
    canvas.translate(FOCUS_EMPHASIS_OFFSET_DP * resources.displayMetrics.density, 0f)
    layout.draw(canvas)
    canvas.translate(-FOCUS_EMPHASIS_OFFSET_DP * resources.displayMetrics.density, 0f)
    drawSavedHighlightText(canvas, block, layout, savedHighlightRanges)
    canvas.restoreToCount(overlayLayer)
    canvas.restoreToCount(clipSave)
  }

  // Light the annotation rows of the focused span too: the pinyin row above each
  // of its lines and the gloss row below, which the glyph selection path misses.
  private fun addAnnotationClip(block: PageBlock, layout: StaticLayout, localStart: Int, localEnd: Int) {
    val bodyTextPx = block.textPaint?.textSize ?: return
    val above = if (showPinyin) bodyTextPx * PINYIN_ROW_SCALE else 0f
    val below = if (showGloss) bodyTextPx * GLOSS_ROW_SCALE else 0f
    val firstLine = layout.getLineForOffset(localStart)
    val lastLine = layout.getLineForOffset(max(localStart, localEnd - 1))
    for (line in firstLine..lastLine) {
      val from = max(localStart, layout.getLineStart(line))
      val to = min(localEnd, layout.getLineEnd(line))
      if (from >= to) continue
      val x1 = layout.getPrimaryHorizontal(from)
      val x2 = if (to >= layout.getLineEnd(line)) layout.getLineRight(line) else layout.getPrimaryHorizontal(to)
      val baseline = layout.getLineBaseline(line).toFloat()
      val metrics = block.textPaint!!.fontMetrics
      // Only the annotation rows are added here (the glyphs come from the
      // selection path). A word's pinyin or gloss can be wider than the word,
      // so a row may reach past the span, but only over a line edge, a space
      // or punctuation: never over the next sentence's first character, which
      // would light half of it (and half its pinyin).
      val left = min(x1, x2) - annotationReach(layout, line, from, towardStart = true)
      val right = max(x1, x2) + annotationReach(layout, line, to, towardStart = false)
      if (above > 0f) {
        focusClipPath.addRect(left, baseline + metrics.ascent - above, right, baseline + metrics.ascent, Path.Direction.CW)
      }
      if (below > 0f) {
        focusClipPath.addRect(left, baseline + metrics.descent, right, baseline + metrics.descent + below, Path.Direction.CW)
      }
    }
  }

  // How far a focused span's annotation row may reach past `offset` (its start
  // or end on `line`): the full slack at the line's edge, the width of a
  // neighbouring space or punctuation mark, otherwise nothing.
  private fun annotationReach(layout: StaticLayout, line: Int, offset: Int, towardStart: Boolean): Float {
    val text = layout.text
    val lineStart = layout.getLineStart(line)
    val lineEnd = layout.getLineEnd(line)
    val neighbour = if (towardStart) offset - 1 else offset
    if (neighbour < lineStart || neighbour >= lineEnd) return dp(8f).toFloat()
    val ch = text[neighbour]
    if (!ch.isWhitespace() && Character.isLetterOrDigit(ch)) return 0f
    val a = layout.getPrimaryHorizontal(neighbour)
    val b = if (neighbour + 1 >= lineEnd) layout.getLineRight(line) else layout.getPrimaryHorizontal(neighbour + 1)
    return min(abs(b - a), dp(8f).toFloat())
  }

  fun setFocusHighlight(ranges: List<FocusRange>, animate: Boolean, fast: Boolean = false) {
    if (ranges == focusRanges) {
      return
    }

    focusAnimator?.cancel()
    if (!animate) {
      previousFocusRanges = emptyList()
      focusRanges = ranges
      focusTransition = 1f
      invalidate()
      postInvalidateOnAnimation()
      return
    }

    previousFocusRanges = focusRanges
    focusRanges = ranges
    focusTransition = 0f
    focusAnimator = ValueAnimator.ofFloat(0f, 1f).apply {
      duration = if (fast) FOCUS_TRANSITION_FAST_DURATION_MS else FOCUS_TRANSITION_DURATION_MS
      interpolator = PathInterpolator(0.25f, 0.1f, 0.25f, 1f)
      addUpdateListener { animator ->
        focusTransition = animator.animatedValue as Float
        invalidate()
      }
      start()
    }
  }

  override fun onTouchEvent(event: MotionEvent): Boolean {
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        tapStartX = event.x
        tapStartY = event.y
        hitTestSelectionHandle(event.x, event.y)?.let { handle ->
          activeSelectionHandle = handle
          handleDragStartRanges = activeSelectionRanges
          beginHandleDrag(handle, event.x, event.y)
          isTapCandidate = false
          cancelPendingLongPress()
          parent?.requestDisallowInterceptTouchEvent(true)
          onSelectionDragStateChanged?.invoke(true)
          return true
        }

        isTapCandidate = true
        scheduleLongPress()
        return true
      }
      MotionEvent.ACTION_MOVE -> {
        activeSelectionHandle?.let { handle ->
          updateHandleSelection(handle, event.x, event.y)
          return true
        }

        if (isSelectionMode) {
          // A held finger jitters; the long-press sentence selection (which
          // may spill onto the neighbouring page) only turns into a drag once
          // the finger actually moves.
          if (!selectionDragStarted) {
            if (abs(event.x - tapStartX) < selectionDragSlop && abs(event.y - tapStartY) < selectionDragSlop) {
              return true
            }
            selectionDragStarted = true
          }
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
        if (activeSelectionHandle != null) {
          finishHandleSelection(cancelled = false)
          return true
        }

        if (isSelectionMode) {
          finishDragSelection(cancelled = false)
          return true
        }

        if (isTapCandidate) {
          performClick()
          noteIconAt(event.x, event.y)?.let { noteId ->
            noteIconTapped?.invoke(noteId)
            isTapCandidate = false
            return true
          }
          page?.edgeState?.let { edgeState ->
            if (edgeActionBoundsForKind(edgeState.kind).contains(event.x, event.y)) {
              onEdgeAction?.invoke(edgeState.kind)
              isTapCandidate = false
              return true
            }
          }

          // While the lookup panel is open in focus mode, a tap anywhere on
          // the reading surface only dismisses the panel — it must not move
          // the beam or select a new word (mirrors paged-mode behavior).
          if (focusModeEnabled && focusPanelOpen) {
            clearSelectionFromTap()
            isTapCandidate = false
            return true
          }

          if (!focusModeEnabled && activeSelectionKind != null && activeSelectionRanges.isNotEmpty()) {
            if (!hitTestActiveSelectionHighlight(event.x, event.y)) {
              clearSelectionFromTap()
            }
            isTapCandidate = false
            return true
          }

          val hit = hitTestText(event.x, event.y)
          if (hit != null) {
            if (focusModeEnabled) {
              // Word taps move the beam to the word's sentence; the lookup panel
              // always slides up from the bottom in focus mode.
              onFocusTextTapped?.invoke(hit.range.blockId, hit.localStartOffset)
              onWordSelected?.invoke(hit.copy(placement = "bottom"))
            } else {
              onWordSelected?.invoke(hit)
            }
          } else {
            if (focusModeEnabled) {
              // A tap on a sentence's blank space still moves the beam there.
              hitTestTextPosition(event.x, event.y, allowClosest = false)?.let { position ->
                onFocusTextTapped?.invoke(position.block.blockId, position.localOffset)
              }
            }
            onSelectionCleared?.invoke()
          }
        }
        isTapCandidate = false
      }
      MotionEvent.ACTION_CANCEL -> {
        cancelPendingLongPress()
        if (activeSelectionHandle != null) {
          finishHandleSelection(cancelled = true)
        }
        if (isSelectionMode) {
          finishDragSelection(cancelled = true)
        }
        isTapCandidate = false
      }
    }

    return true
  }

  private fun clearSelectionFromTap() {
    activeSelectionRanges = emptyList()
    activeSelectionKind = null
    activeHighlightPaint.color = activePaintColor()
    invalidate()
    postInvalidateOnAnimation()
    onSelectionCleared?.invoke()
  }

  override fun performClick(): Boolean {
    super.performClick()
    return true
  }

  private fun drawReaderEdgeState(canvas: Canvas) {
    val edgeState = page?.edgeState ?: return
    if (width <= 0 || height <= 0) return

    when (edgeState.kind) {
      ReaderEdgeKind.BOOK_FINISHED -> drawBookFinishedState(canvas, edgeState)
    }
  }

  private fun drawBookFinishedState(canvas: Canvas, edgeState: ReaderEdgeState) {
    val buttonRect = edgeActionBoundsForKind(edgeState.kind)
    drawSlateButton(canvas, buttonRect)

    val buttonLabelPaint = edgeTextPaint(
      sizeSp = 11f,
      color = readerEdgeButtonTextColor(),
      typeface = edgeSansBoldTypeface,
      letterSpacingEm = 0.16f
    )
    drawCenteredButtonTextWithBookIcon(canvas, ReaderText.t("backToLibrary").uppercase(), buttonRect, buttonLabelPaint)

    val metaPaint = edgeTextPaint(
      sizeSp = 13f,
      color = readerEdgeMutedTextColor(),
      typeface = edgeSansRegularTypeface
    )
    val titlePaint = edgeTextPaint(
      sizeSp = 28f,
      color = readerEdgeTextColor(),
      typeface = edgeDisplayTypeface
    )
    val labelPaint = edgeTextPaint(
      sizeSp = 10f,
      color = readerEdgeSubtleTextColor(),
      typeface = edgeSansMediumTypeface,
      letterSpacingEm = 0.26f
    )
    val buttonTop = buttonRect.top
    val metaCenterY = buttonTop - dp(31f)
    val titleCenterY = metaCenterY - dp(44f)
    val labelCenterY = titleCenterY - dp(45f)
    val iconCenterY = labelCenterY - dp(43f)
    val centerX = width / 2f

    drawBookFinishedIcon(canvas, centerX, iconCenterY, dp(54f).toFloat())
    drawCenteredText(canvas, ReaderText.t("bookFinished").uppercase(), labelCenterY, labelPaint, width - dp(48f))
    drawCenteredText(canvas, edgeState.bookTitle.ifBlank { edgeState.chapterTitle }, titleCenterY, titlePaint, width - dp(64f))
    drawCenteredText(
      canvas,
      bookFinishedMeta(edgeState.chapterCount, edgeState.savedWordCount),
      metaCenterY,
      metaPaint,
      width - dp(64f)
    )

    val reviewPaint = edgeTextPaint(
      sizeSp = 12f,
      color = readerEdgeReviewTextColor(),
      typeface = edgeSansMediumTypeface,
      letterSpacingEm = 0.12f
    )
    drawCenteredText(
      canvas,
      bookReviewLabel(edgeState.savedWordCount),
      buttonRect.bottom + dp(34f),
      reviewPaint,
      width - dp(64f)
    )
  }

  private fun drawSlateButton(canvas: Canvas, rect: RectF) {
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = readerEdgeButtonColor()
      style = Paint.Style.FILL
    }
    val radius = dp(4f).toFloat()
    canvas.drawRoundRect(rect, radius, radius, paint)
  }

  private fun drawCenteredButtonTextWithBookIcon(
    canvas: Canvas,
    label: String,
    rect: RectF,
    paint: TextPaint
  ) {
    val iconPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = readerEdgeButtonTextColor()
      style = Paint.Style.STROKE
      strokeWidth = dp(1.7f).toFloat()
      strokeCap = Paint.Cap.ROUND
      strokeJoin = Paint.Join.ROUND
    }
    val iconSize = dp(20f).toFloat()
    val gap = dp(14f).toFloat()
    val labelPaint = TextPaint(paint).apply {
      textAlign = Paint.Align.LEFT
    }
    val labelWidth = labelPaint.measureText(label)
    val totalWidth = iconSize + gap + labelWidth
    val iconCenterX = rect.centerX() - (totalWidth / 2f) + (iconSize / 2f)
    val baseline = baselineForCenter(rect.centerY(), labelPaint)
    val labelX = iconCenterX + (iconSize / 2f) + gap

    drawOpenBookIcon(canvas, iconCenterX, rect.centerY(), iconSize, iconPaint)
    canvas.drawText(label, labelX, baseline, labelPaint)
  }

  private fun drawBookFinishedIcon(
    canvas: Canvas,
    centerX: Float,
    centerY: Float,
    targetWidth: Float
  ) {
    val bitmap = bookFinishedIconBitmap
    if (bitmap == null || bitmap.width <= 0 || bitmap.height <= 0) {
      val fallbackPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = readerEdgeTextColor()
        style = Paint.Style.STROKE
        strokeWidth = dp(2.1f).toFloat()
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
      }
      drawOpenBookIcon(canvas, centerX, centerY, dp(38f).toFloat(), fallbackPaint)
      return
    }

    val targetHeight = targetWidth * (bitmap.height.toFloat() / bitmap.width.toFloat())
    bookFinishedIconRect.set(
      centerX - (targetWidth / 2f),
      centerY - (targetHeight / 2f),
      centerX + (targetWidth / 2f),
      centerY + (targetHeight / 2f)
    )
    canvas.drawBitmap(bitmap, null, bookFinishedIconRect, bookFinishedIconPaint)
  }

  private fun drawOpenBookIcon(
    canvas: Canvas,
    centerX: Float,
    centerY: Float,
    size: Float,
    paint: Paint
  ) {
    val half = size / 2f
    val top = centerY - (size * 0.38f)
    val bottom = centerY + (size * 0.38f)
    val centerTop = top + (size * 0.17f)
    val centerBottom = bottom - (size * 0.08f)
    val outerLeft = centerX - half
    val outerRight = centerX + half
    val innerGap = size * 0.12f

    edgeIconPath.reset()
    edgeIconPath.moveTo(centerX - innerGap, centerTop)
    edgeIconPath.cubicTo(
      centerX - (size * 0.28f),
      top,
      outerLeft,
      top + (size * 0.04f),
      outerLeft,
      top + (size * 0.24f)
    )
    edgeIconPath.lineTo(outerLeft, bottom)
    edgeIconPath.cubicTo(
      outerLeft + (size * 0.24f),
      bottom - (size * 0.09f),
      centerX - (size * 0.18f),
      bottom,
      centerX - innerGap,
      centerBottom
    )

    edgeIconPath.moveTo(centerX + innerGap, centerTop)
    edgeIconPath.cubicTo(
      centerX + (size * 0.28f),
      top,
      outerRight,
      top + (size * 0.04f),
      outerRight,
      top + (size * 0.24f)
    )
    edgeIconPath.lineTo(outerRight, bottom)
    edgeIconPath.cubicTo(
      outerRight - (size * 0.24f),
      bottom - (size * 0.09f),
      centerX + (size * 0.18f),
      bottom,
      centerX + innerGap,
      centerBottom
    )

    edgeIconPath.moveTo(centerX, top - (size * 0.06f))
    edgeIconPath.lineTo(centerX, bottom + (size * 0.06f))
    canvas.drawPath(edgeIconPath, paint)
  }

  private fun drawCenteredText(
    canvas: Canvas,
    text: String,
    centerY: Float,
    paint: TextPaint,
    maxWidth: Int
  ) {
    val displayText = TextUtils
      .ellipsize(text, paint, maxWidth.toFloat().coerceAtLeast(1f), TextUtils.TruncateAt.END)
      .toString()
    canvas.drawText(displayText, width / 2f, baselineForCenter(centerY, paint), paint)
  }

  private fun baselineForCenter(centerY: Float, paint: Paint): Float {
    val metrics = paint.fontMetrics
    return centerY - ((metrics.ascent + metrics.descent) / 2f)
  }

  private fun edgeActionBoundsForKind(kind: ReaderEdgeKind): RectF {
    return edgeActionBounds(
      bottomInsetDp = if (kind == ReaderEdgeKind.BOOK_FINISHED) 48f else 28f
    )
  }

  private fun edgeActionBounds(bottomInsetDp: Float): RectF {
    val horizontalInset = dp(24f).toFloat()
    val buttonBottom = height - dp(bottomInsetDp).toFloat()
    val buttonHeight = dp(60f).toFloat()
    edgeButtonRect.set(
      horizontalInset,
      buttonBottom - buttonHeight,
      width - horizontalInset,
      buttonBottom
    )
    return edgeButtonRect
  }

  private fun edgeTextPaint(
    sizeSp: Float,
    color: Int,
    typeface: Typeface,
    letterSpacingEm: Float = 0f
  ): TextPaint {
    return TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
      this.color = color
      textSize = sp(sizeSp)
      this.typeface = typeface
      textAlign = Paint.Align.CENTER
      letterSpacing = letterSpacingEm
    }
  }

  private fun bookFinishedMeta(chapterCount: Int, savedWordCount: Int): String {
    val safeChapterCount = chapterCount.coerceAtLeast(0)
    val safeSavedWordCount = savedWordCount.coerceAtLeast(0)
    return "${ReaderText.chapterCount(safeChapterCount)} · ${ReaderText.wordsSaved(safeSavedWordCount)}"
  }

  private fun bookReviewLabel(savedWordCount: Int): String {
    val safeSavedWordCount = savedWordCount.coerceAtLeast(0)
    return ReaderText.reviewWords(safeSavedWordCount).uppercase()
  }

  private fun readerEdgeTextColor(): Int {
    return themePalette.bodyTextColor
  }

  private fun readerEdgeMutedTextColor(): Int {
    return themePalette.mutedTextColor
  }

  private fun readerEdgeSubtleTextColor(): Int {
    return themePalette.subtleTextColor
  }

  private fun readerEdgeRuleColor(): Int {
    return themePalette.ruleColor
  }

  private fun readerEdgeButtonColor(): Int {
    return themePalette.edgeButtonColor
  }

  private fun readerEdgeButtonTextColor(): Int {
    return themePalette.edgeButtonTextColor
  }

  private fun readerEdgeReviewTextColor(): Int {
    return if (themePalette.backgroundColor == Color.rgb(0x11, 0x15, 0x1c)) {
      themePalette.mutedTextColor
    } else {
      Color.rgb(0x5c, 0x5e, 0x63)
    }
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

    val block = renderedTextBlocks[renderedIndex].block
    // A long press selects the word under the finger; dragging or the handles
    // widen it word by word into a phrase (for the selection toolbar: copy,
    // highlight, note, AI explanation).
    val sliceLength = blockTextForSelection(block).length
    val srcStart = hit.range.sourceStartOffset
    val srcEnd = hit.range.sourceEndOffset
    val selStart = (srcStart - block.sourceStartOffset).coerceIn(0, sliceLength)
    val selEnd = (srcEnd - block.sourceStartOffset).coerceIn(selStart, sliceLength)

    isTapCandidate = false
    isSelectionMode = true
    selectionDragStarted = false
    lastSelectionFocusKey = Long.MIN_VALUE
    parent?.requestDisallowInterceptTouchEvent(true)
    onSelectionDragStateChanged?.invoke(true)
    selectionAnchor = SelectionAnchor(
      pageIndex = hit.range.pageIndex,
      spineIndex = hit.range.spineIndex,
      blockId = hit.range.blockId,
      renderedIndex = renderedIndex,
      localStartOffset = selStart,
      localEndOffset = selEnd,
      sourceStartOffset = block.sourceStartOffset + selStart,
      sourceEndOffset = block.sourceStartOffset + selEnd
    )
    activeSelectionRanges = rangesForSourceSpan(block, hit.range.pageIndex, hit.range.spineIndex, srcStart, srcEnd)
    activeSelectionKind = ActiveSelectionKind.TEXT
    activeHighlightPaint.color = activePaintColor()
    invalidate()
    postInvalidateOnAnimation()
  }

  private fun updateDragSelection(x: Float, y: Float) {
    val anchor = selectionAnchor ?: return
    // Whole words only: the drag widens the selection a word at a time.
    val focus = hitTestTextPosition(x, y, allowClosest = true)
      ?.let { snapFocusForAnchor(it, anchor) }
      ?: return
    if (!selectionFocusMoved(focus)) return
    val ranges = buildSelectionRanges(anchor, focus)

    if (ranges.isNotEmpty()) {
      activeSelectionRanges = ranges
      activeSelectionKind = ActiveSelectionKind.TEXT
      activeHighlightPaint.color = activePaintColor()
      invalidate()
      postInvalidateOnAnimation()
    }
  }

  private fun beginHandleDrag(handle: SelectionHandle, touchX: Float, touchY: Float) {
    val endpoints = activeTextSelectionEndpoints()
    handleFixedPosition = when (handle) {
      SelectionHandle.START -> endpoints?.second
      SelectionHandle.END -> endpoints?.first
    }
    val geometry = selectionHandleGeometries().firstOrNull { it.handle == handle }
    if (geometry != null) {
      handleTouchOffsetX = geometry.x - touchX
      handleTouchOffsetY = (geometry.lineTop + geometry.lineBottom) / 2f - touchY
    } else {
      handleTouchOffsetX = 0f
      handleTouchOffsetY = 0f
    }
    lastSelectionFocusKey = Long.MIN_VALUE
  }

  // Whether `focus` is a different character from the last drag step. The
  // first step of a drag only records it; later steps tick once per character.
  private fun selectionFocusMoved(focus: TextPosition): Boolean {
    val key = (focus.renderedIndex.toLong() shl 32) or (focus.localOffset.toLong() and 0xffffffffL)
    if (key == lastSelectionFocusKey) return false
    if (lastSelectionFocusKey != Long.MIN_VALUE) {
      performHapticFeedback(HapticFeedbackConstants.TEXT_HANDLE_MOVE)
    }
    lastSelectionFocusKey = key
    return true
  }

  private fun updateHandleSelection(handle: SelectionHandle, x: Float, y: Float) {
    // Word by word: the handle snaps to the edge of the word under it. The
    // other end stays where it was when the drag began, so the handles may
    // cross without the selection jumping.
    val fixed = handleFixedPosition ?: activeTextSelectionEndpoints()?.let { endpoints ->
      if (handle == SelectionHandle.START) endpoints.second else endpoints.first
    } ?: return
    val raw = hitTestTextPosition(x + handleTouchOffsetX, y + handleTouchOffsetY, allowClosest = true) ?: return
    val focus = snappedPositionForHandle(
      raw,
      if (compareTextPositions(raw, fixed) >= 0) SelectionHandle.END else SelectionHandle.START
    )
    if (!selectionFocusMoved(focus)) return
    val ranges = buildSelectionRangesBetween(fixed, focus)

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
      Log.d(PAGE_VIEW_TAG, "text selection: pages=${activeSelectionRanges.map { it.pageIndex }} text=$selectedText")
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

  private fun finishHandleSelection(cancelled: Boolean) {
    parent?.requestDisallowInterceptTouchEvent(false)
    onSelectionDragStateChanged?.invoke(false)

    if (cancelled) {
      activeSelectionRanges = handleDragStartRanges
      activeSelectionKind = if (activeSelectionRanges.isNotEmpty()) ActiveSelectionKind.TEXT else null
      invalidate()
      postInvalidateOnAnimation()
    } else {
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
    }

    activeSelectionHandle = null
    handleDragStartRanges = emptyList()
    handleFixedPosition = null
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
      // Chinese: the underline and the gloss under a word come from the
      // server's segmentation of the book (厮杀 is one word); Android's word
      // breaker splits words it doesn't know (厮 + 杀). A tap inside a marked
      // or glossed word takes that exact word, so the lookup matches what is
      // drawn under it.
      val tokenRange = markedCjkWordAt(block, blockText, localOffset)
        ?: tokenRangeAtOffset(blockText, localOffset)

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
      val placement = if (usesTopLookupPlacement(wordCenterY)) "top" else "bottom"
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
        sentence = sentenceForToken(block, tokenRange)
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

  private fun buildSelectionRangesBetween(
    firstPosition: TextPosition,
    secondPosition: TextPosition
  ): List<TextRange> {
    val currentPage = page ?: return emptyList()
    val orderedPositions = if (compareTextPositions(firstPosition, secondPosition) <= 0) {
      firstPosition to secondPosition
    } else {
      secondPosition to firstPosition
    }
    val startPosition = orderedPositions.first
    val endPosition = orderedPositions.second
    val ranges = mutableListOf<TextRange>()

    for (index in startPosition.renderedIndex..endPosition.renderedIndex) {
      val block = renderedTextBlocks.getOrNull(index)?.block ?: continue
      val blockText = blockTextForSelection(block)
      val blockLength = blockText.length
      if (blockLength <= 0) continue

      val localStart = if (index == startPosition.renderedIndex) {
        startPosition.localOffset.coerceIn(0, blockLength)
      } else {
        0
      }
      val localEnd = if (index == endPosition.renderedIndex) {
        endPosition.localOffset.coerceIn(localStart, blockLength)
      } else {
        blockLength
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
    var lastBlockId: String? = null
    var lastEnd = -1

    ranges.forEach { range ->
      // Parts on neighbouring pages belong to a paragraph this page also
      // holds a slice of, so its whole text is available here.
      val rendered = renderedTextBlocks.firstOrNull { item ->
        item.block.blockId == range.blockId && page?.spineIndex == range.spineIndex
      } ?: return@forEach
      val source = sourceTextOf(rendered.block)
      val start = range.sourceStartOffset.coerceIn(0, source.length)
      val end = range.sourceEndOffset.coerceIn(start, source.length)
      val contiguous = range.blockId == lastBlockId && start <= lastEnd
      val selected = if (contiguous) source.substring(start, end) else source.substring(start, end).trim()

      if (selected.isNotEmpty()) {
        if (builder.isNotEmpty() && !contiguous) {
          builder.append('\n')
        }
        builder.append(selected)
      }
      lastBlockId = range.blockId
      lastEnd = end
    }

    return builder.toString().trim()
  }

  private fun activeTextSelectionEndpoints(): Pair<TextPosition, TextPosition>? {
    if (geometryDirty) {
      rebuildGeometry()
    }

    val ranges = sortedActiveTextSelectionRanges()
    val first = ranges.firstOrNull() ?: return null
    val last = ranges.lastOrNull() ?: return null
    val start = textPositionForRangeEndpoint(first, isStart = true) ?: return null
    val end = textPositionForRangeEndpoint(last, isStart = false) ?: return null

    return start to end
  }

  private fun sortedActiveTextSelectionRanges(): List<TextRange> {
    val currentPage = page ?: return emptyList()

    return activeSelectionRanges
      .filter { range ->
        range.pageIndex == currentPage.pageIndex &&
          range.spineIndex == currentPage.spineIndex
      }
      .sortedWith(
        compareBy<TextRange> { range -> renderedIndexForRange(range) }
          .thenBy { range -> range.sourceStartOffset }
          .thenBy { range -> range.sourceEndOffset }
      )
      .filter { range -> renderedIndexForRange(range) != Int.MAX_VALUE }
  }

  private fun renderedIndexForRange(range: TextRange): Int {
    return renderedTextBlocks.indexOfFirst { rendered ->
      rendered.block.blockId == range.blockId
    }.takeIf { it >= 0 } ?: Int.MAX_VALUE
  }

  private fun textPositionForRangeEndpoint(range: TextRange, isStart: Boolean): TextPosition? {
    val renderedIndex = renderedIndexForRange(range).takeIf { it != Int.MAX_VALUE } ?: return null
    val rendered = renderedTextBlocks.getOrNull(renderedIndex) ?: return null
    val block = rendered.block
    val blockText = blockTextForSelection(block)
    val sourceOffset = if (isStart) range.sourceStartOffset else range.sourceEndOffset
    val localOffset = (sourceOffset - block.sourceStartOffset).coerceIn(0, blockText.length)

    return TextPosition(
      renderedIndex = renderedIndex,
      block = block,
      localOffset = localOffset,
      sourceOffset = block.sourceStartOffset + localOffset
    )
  }

  private fun compareTextPositions(first: TextPosition, second: TextPosition): Int {
    return when {
      first.renderedIndex != second.renderedIndex -> first.renderedIndex.compareTo(second.renderedIndex)
      first.sourceOffset != second.sourceOffset -> first.sourceOffset.compareTo(second.sourceOffset)
      else -> first.localOffset.compareTo(second.localOffset)
    }
  }

  private fun snapFocusForAnchor(position: TextPosition, anchor: SelectionAnchor): TextPosition {
    val isForward = position.renderedIndex > anchor.renderedIndex ||
      (position.renderedIndex == anchor.renderedIndex && position.sourceOffset >= anchor.sourceStartOffset)

    return snappedPositionForHandle(
      position = position,
      handle = if (isForward) SelectionHandle.END else SelectionHandle.START
    )
  }

  // The nearest word edge: a start snaps to the start of the word under it, an
  // end to the end of the word before it.
  private fun snappedPositionForHandle(position: TextPosition, handle: SelectionHandle): TextPosition {
    val text = blockTextForSelection(position.block)
    if (text.isEmpty()) {
      return position
    }

    val probeOffset = when (handle) {
      SelectionHandle.START -> position.localOffset
      SelectionHandle.END -> max(0, position.localOffset - 1)
    }.coerceIn(0, text.length)
    val tokenRange = tokenRangeAtOffset(text, probeOffset) ?: return position
    val snappedLocalOffset = when (handle) {
      SelectionHandle.START -> tokenRange.start
      SelectionHandle.END -> tokenRange.end
    }.coerceIn(0, text.length)

    return position.copy(
      localOffset = snappedLocalOffset,
      sourceOffset = position.block.sourceStartOffset + snappedLocalOffset
    )
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
    return if (usesTopLookupPlacement(centerY)) "top" else "bottom"
  }

  // Lookup panel goes above the word when the word sits in the lower half of
  // what's on screen. In scroll and focus modes this view holds the whole
  // chapter inside a ScrollView, so measure against the visible window, not
  // against this view's (chapter-tall) height.
  private fun usesTopLookupPlacement(centerY: Float): Boolean {
    val scroller = parent as? android.widget.ScrollView
    if (scroller != null && scroller.height > 0) {
      return centerY - scroller.scrollY >= scroller.height * 0.5f
    }
    return height > 0 && centerY >= height * 0.5f
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

  // A chapter's level ranges number in the hundreds or thousands; scanning all
  // of them for every block on every frame dominated draw time. Group each
  // range list by block once (keyed by list identity: the lists are replaced,
  // never mutated) and reuse the grouping until a new list arrives.
  private val rangesByBlockCache = java.util.IdentityHashMap<List<TextRange>, Map<String, List<TextRange>>>()

  private fun rangesForBlock(ranges: List<TextRange>, blockId: String): List<TextRange> {
    if (ranges.isEmpty()) return ranges
    val grouped = rangesByBlockCache[ranges] ?: run {
      if (rangesByBlockCache.size >= 8) rangesByBlockCache.clear()
      ranges.groupBy { it.blockId }.also { rangesByBlockCache[ranges] = it }
    }
    return grouped[blockId].orEmpty()
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

    rangesForBlock(ranges, block.blockId).forEach { range ->
      if (
        range.pageIndex != currentPage.pageIndex ||
        range.spineIndex != currentPage.spineIndex
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

      if (paint === savedHighlightPaint && range.userColor != null) {
        userHighlightPaint.color = range.userColor
        drawTextSelectionHighlight(
          canvas = canvas,
          block = block,
          layout = layout,
          localStart = localStart,
          localEnd = localEnd,
          textLength = blockTextLength,
          paint = userHighlightPaint
        )
        return@forEach
      }

      if (paint === savedHighlightPaint) {
        // A saved word loses pixels a step each time it comes on screen
        // without a lookup, the leaving pixels going one by one, until the
        // box is gone.
        val strength = range.strength.coerceIn(0f, 1f)
        val fade = savedFade?.invoke(range)
        if (fade != null) readAnimationPending = true
        if (strength > 0f || fade != null) {
          drawTextSelectionHighlight(
            canvas = canvas,
            block = block,
            layout = layout,
            localStart = localStart,
            localEnd = localEnd,
            textLength = blockTextLength,
            paint = paint,
            pixelKeep = strength,
            pixelFrom = fade?.first ?: strength,
            pixelProgress = fade?.second ?: 1f
          )
        }
        return@forEach
      }

      if (paint === levelMarkPaint) {
        if (range.annotationOnly) return@forEach
        applyLevelUnderlineShade(paint, range.levelWeight, range.levelReinforced)
        drawLevelUnderline(
          canvas, layout, localStart, localEnd, blockTextLength, paint,
          dissolve = tapDissolve(range)
        )
        return@forEach
      }

      if (
        paint === activeHighlightPaint &&
        (activeSelectionKind == ActiveSelectionKind.TEXT || activeSelectionKind == ActiveSelectionKind.WORD)
      ) {
        drawTextSelectionHighlight(
          canvas = canvas,
          block = block,
          layout = layout,
          localStart = localStart,
          localEnd = localEnd,
          textLength = blockTextLength,
          paint = paint
        )
      } else {
        highlightPath.reset()
        layout.getSelectionPath(
          localStart.coerceIn(0, blockTextLength),
          localEnd.coerceIn(0, blockTextLength),
          highlightPath
        )
        canvas.drawPath(highlightPath, paint)
      }
    }
  }

  private fun drawTextSelectionHighlight(
    canvas: Canvas,
    block: PageBlock,
    layout: StaticLayout,
    localStart: Int,
    localEnd: Int,
    textLength: Int,
    paint: Paint,
    // Saved-word boxes: the share of the box's pixels still drawn (1 = solid
    // box, fading in steps as the reader passes the word without a lookup),
    // and while a step is animating, the share it is leaving and how far.
    pixelKeep: Float = 1f,
    pixelFrom: Float = pixelKeep,
    pixelProgress: Float = 1f
  ) {
    val text = blockTextForSelection(block)
    val safeStart = localStart.coerceIn(0, textLength)
    val safeEnd = localEnd.coerceIn(safeStart, textLength)
    if (safeStart >= safeEnd || layout.lineCount <= 0) return


    val startLine = layout.getLineForOffset(safeStart)
    val endLine = layout.getLineForOffset(max(safeStart, safeEnd - 1))
    val horizontalPad = dp(1f).toFloat()
    val topPad = dp(12f).toFloat()
    val bottomPad = dp(5f).toFloat()
    val cornerRadius = dp(2f).toFloat()

    for (line in startLine..endLine) {
      val rawLineStart = layout.getLineStart(line).coerceIn(0, textLength)
      val rawLineEnd = layout.getLineEnd(line).coerceIn(rawLineStart, textLength)
      var lineStart = max(safeStart, rawLineStart)
      var lineEnd = min(safeEnd, rawLineEnd)

      while (lineStart < lineEnd && text[lineStart].isWhitespace()) {
        lineStart += 1
      }
      while (lineEnd > lineStart && text[lineEnd - 1].isWhitespace()) {
        lineEnd -= 1
      }
      if (lineStart >= lineEnd) continue

      val selectedThroughLineStart = safeStart <= rawLineStart
      val selectedThroughLineEnd = safeEnd >= rawLineEnd
      val startX = if (selectedThroughLineStart) {
        layout.getLineLeft(line)
      } else {
        layout.getPrimaryHorizontal(lineStart)
      }
      val endX = if (selectedThroughLineEnd) {
        layout.getLineRight(line)
      } else {
        layout.getPrimaryHorizontal(lineEnd)
      }
      val left = min(startX, endX) - horizontalPad
      val right = max(startX, endX) + horizontalPad
      if (right <= left) continue

      val verticalMetrics = selectionHighlightVerticalMetrics(
        layout = layout,
        line = line,
        textPaint = block.textPaint,
        topPad = topPad,
        bottomPad = bottomPad
      ) ?: continue
      val top = verticalMetrics.top
      val bottom = verticalMetrics.bottom
      if (bottom <= top) continue

      selectionLineRect.set(left, top, right, bottom)
      if (pixelKeep < 1f || pixelFrom > pixelKeep) {
        drawPixelBox(canvas, selectionLineRect, cornerRadius, paint, pixelKeep, pixelFrom, pixelProgress)
      } else {
        canvas.drawRoundRect(selectionLineRect, cornerRadius, cornerRadius, paint)
      }
    }
  }

  // The box as a grid of pixels inside its rounded outline, keeping the
  // `keep` share of them in ordered-dither order. While a step animates
  // (progress < 1), each pixel between `keep` and `from` leaves at its own
  // moment, so the reader sees them go one by one.
  private fun drawPixelBox(
    canvas: Canvas,
    rect: RectF,
    radius: Float,
    paint: Paint,
    keep: Float,
    from: Float,
    progress: Float
  ) {
    pixelPaint.color = paint.color
    pixelPaint.alpha = (paint.alpha * FADING_BOX_LIGHT_ALPHA).roundToInt()
    highlightPath.reset()
    highlightPath.addRoundRect(rect, radius, radius, Path.Direction.CW)
    val save = canvas.save()
    canvas.clipPath(highlightPath)
    val cell = pixelSize
    val firstX = floor(rect.left / cell).toInt()
    val lastX = ceil(rect.right / cell).toInt()
    val firstY = floor(rect.top / cell).toInt()
    val lastY = ceil(rect.bottom / cell).toInt()
    for (iy in firstY until lastY) {
      for (ix in firstX until lastX) {
        val order = pixelLeaveOrder(ix, iy)
        val kept = order < keep || (order < from && progress < pixelHash(iy, ix) * 0.85f)
        if (!kept) continue
        pixelRect.set(ix * cell.toFloat(), iy * cell.toFloat(), (ix + 1) * cell.toFloat(), (iy + 1) * cell.toFloat())
        canvas.drawRect(pixelRect, pixelPaint)
      }
    }
    canvas.restoreToCount(save)
  }

  // Where a cell falls in the box's leaving order, 0..1: cells at or above
  // the box's strength are gone. Ordered dither on the page's own grid, so
  // neighbouring boxes line up.
  private fun pixelLeaveOrder(ix: Int, iy: Int): Float {
    val bx = ((ix % 4) + 4) % 4
    val by = ((iy % 4) + 4) % 4
    return (BAYER_4[by * 4 + bx] + 0.5f) / 16f
  }

  private fun drawSavedHighlightText(
    canvas: Canvas,
    block: PageBlock,
    layout: StaticLayout,
    ranges: List<TextRange>
  ) {
    val currentPage = page ?: return
    val text = blockTextForSelection(block)
    val textLength = text.length
    if (textLength <= 0 || layout.lineCount <= 0 || ranges.isEmpty()) return

    val sourceStart = block.sourceStartOffset
    val sourceEnd = sourceStart + textLength
    val textPaint = TextPaint(block.textPaint ?: savedHighlightTextPaint).apply {
      color = savedHighlightTextColor
    }
    val lightTextAlpha = textPaint.alpha

    ranges.forEach { range ->
      if (
        range.pageIndex != currentPage.pageIndex ||
        range.spineIndex != currentPage.spineIndex ||
        range.blockId != block.blockId
      ) {
        return@forEach
      }
      // A reader's highlight keeps the body ink on its light box.
      if (range.userColor != null) return@forEach
      // Light text only on a full box; once it breaks into pixels (or is
      // animating its first step) the word is read in the body ink underneath.
      if (range.strength < 1f || savedFade?.invoke(range) != null) return@forEach
      textPaint.alpha = lightTextAlpha
      if (textPaint.alpha == 0) return@forEach

      val safeStart = (max(range.sourceStartOffset, sourceStart) - sourceStart).coerceIn(0, textLength)
      val safeEnd = (min(range.sourceEndOffset, sourceEnd) - sourceStart).coerceIn(safeStart, textLength)
      if (safeStart >= safeEnd) {
        return@forEach
      }

      val startLine = layout.getLineForOffset(safeStart)
      val endLine = layout.getLineForOffset(max(safeStart, safeEnd - 1))

      for (line in startLine..endLine) {
        val rawLineStart = layout.getLineStart(line).coerceIn(0, textLength)
        val rawLineEnd = layout.getLineEnd(line).coerceIn(rawLineStart, textLength)
        var lineStart = max(safeStart, rawLineStart)
        var lineEnd = min(safeEnd, rawLineEnd)

        while (lineStart < lineEnd && text[lineStart].isWhitespace()) {
          lineStart += 1
        }
        while (lineEnd > lineStart && text[lineEnd - 1].isWhitespace()) {
          lineEnd -= 1
        }
        if (lineStart >= lineEnd) continue

        val x = layout.getPrimaryHorizontal(lineStart)
        val baseline = layout.getLineBaseline(line).toFloat()
        canvas.drawText(text, lineStart, lineEnd, x, baseline, textPaint)
      }
    }
  }

  private fun hitTestActiveSelectionHighlight(tapX: Float, tapY: Float): Boolean {
    if (
      activeSelectionRanges.isEmpty() ||
      (activeSelectionKind != ActiveSelectionKind.TEXT && activeSelectionKind != ActiveSelectionKind.WORD)
    ) {
      return false
    }

    if (geometryDirty) {
      rebuildGeometry()
    }

    val currentPage = page ?: return false
    val horizontalPad = dp(1f).toFloat()
    val topPad = dp(12f).toFloat()
    val bottomPad = dp(5f).toFloat()

    activeSelectionRanges.forEach { range ->
      if (range.pageIndex != currentPage.pageIndex || range.spineIndex != currentPage.spineIndex) {
        return@forEach
      }

      val rendered = renderedTextBlocks.firstOrNull { item -> item.block.blockId == range.blockId }
        ?: return@forEach
      val layout = rendered.layout
      val text = blockTextForSelection(rendered.block)
      val textLength = text.length
      if (textLength <= 0 || layout.lineCount <= 0) return@forEach

      val safeStart = (range.sourceStartOffset - rendered.block.sourceStartOffset)
        .coerceIn(0, textLength)
      val safeEnd = (range.sourceEndOffset - rendered.block.sourceStartOffset)
        .coerceIn(safeStart, textLength)
      if (safeStart >= safeEnd) return@forEach

      val localX = tapX - rendered.x
      val localY = tapY - rendered.y
      val startLine = layout.getLineForOffset(safeStart)
      val endLine = layout.getLineForOffset(max(safeStart, safeEnd - 1))

      for (line in startLine..endLine) {
        val rawLineStart = layout.getLineStart(line).coerceIn(0, textLength)
        val rawLineEnd = layout.getLineEnd(line).coerceIn(rawLineStart, textLength)
        var lineStart = max(safeStart, rawLineStart)
        var lineEnd = min(safeEnd, rawLineEnd)

        while (lineStart < lineEnd && text[lineStart].isWhitespace()) {
          lineStart += 1
        }
        while (lineEnd > lineStart && text[lineEnd - 1].isWhitespace()) {
          lineEnd -= 1
        }
        if (lineStart >= lineEnd) continue

        val selectedThroughLineStart = safeStart <= rawLineStart
        val selectedThroughLineEnd = safeEnd >= rawLineEnd
        val startX = if (selectedThroughLineStart) {
          layout.getLineLeft(line)
        } else {
          layout.getPrimaryHorizontal(lineStart)
        }
        val endX = if (selectedThroughLineEnd) {
          layout.getLineRight(line)
        } else {
          layout.getPrimaryHorizontal(lineEnd)
        }
        val left = min(startX, endX) - horizontalPad
        val right = max(startX, endX) + horizontalPad
        val verticalMetrics = selectionHighlightVerticalMetrics(
          layout = layout,
          line = line,
          textPaint = rendered.block.textPaint,
          topPad = topPad,
          bottomPad = bottomPad
        ) ?: continue

        if (localX in left..right && localY in verticalMetrics.top..verticalMetrics.bottom) {
          return true
        }
      }
    }

    return false
  }

  /**
   * Shade one level underline from its gradient weight: 0 = "you very nearly know
   * this" (easy/green), 1 = "well above you" (hard/red), interpolated through the
   * mid stop at 0.5.
   *
   * The stroke thickens slightly with weight as well. That's deliberate: a
   * green→red ramp is the classic red-green colorblindness trap, so weight is
   * carried by a second, non-chromatic channel too. It is a mitigation, not a
   * substitute for a proper accessible mode.
   */
  private fun applyLevelUnderlineShade(paint: Paint, weight: Float?, reinforced: Boolean) {
    val w = (weight ?: 1f).coerceIn(0f, 1f)
    val base = levelColorForWeight(w)
    // §8: a hard-but-frequent word keeps its weight (thickness) but is desaturated
    // toward the calm slate; a hard+rare word stays on the salient green→red gradient.
    paint.color = if (reinforced) lerpColor(base, reinforcedUnderlineTint, 0.6f) else base
    paint.strokeWidth = dp(1.4f + (0.8f * w)).toFloat()
  }

  private fun levelColorForWeight(w: Float): Int = if (w <= 0.5f) {
    lerpColor(levelUnderlineEasyColor, levelUnderlineMidColor, w / 0.5f)
  } else {
    lerpColor(levelUnderlineMidColor, levelUnderlineHardColor, (w - 0.5f) / 0.5f)
  }

  // Component-wise RGB interpolation. Deliberately not going through a perceptual
  // space: the three stops are close enough in luminance that the simple lerp
  // reads smoothly, and this runs per range per draw.
  private fun lerpColor(from: Int, to: Int, t: Float): Int {
    val amount = t.coerceIn(0f, 1f)
    val r = Color.red(from) + ((Color.red(to) - Color.red(from)) * amount)
    val g = Color.green(from) + ((Color.green(to) - Color.green(from)) * amount)
    val b = Color.blue(from) + ((Color.blue(to) - Color.blue(from)) * amount)
    return Color.rgb(r.toInt(), g.toInt(), b.toInt())
  }

  private fun drawLevelUnderline(
    canvas: Canvas,
    layout: StaticLayout,
    localStart: Int,
    localEnd: Int,
    textLength: Int,
    paint: Paint,
    // 0 draws a solid line; above 0 the line is a row of pixels whose odd
    // cells drop out, ending as a dotted line at 1.
    dissolve: Float = 0f
  ) {
    val safeStart = localStart.coerceIn(0, textLength)
    val safeEnd = localEnd.coerceIn(safeStart, textLength)
    if (safeStart >= safeEnd) return

    val startLine = layout.getLineForOffset(safeStart)
    val endLine = layout.getLineForOffset(max(safeStart, safeEnd - 1))

    for (line in startLine..endLine) {
      val lineStart = max(safeStart, layout.getLineStart(line))
      val visibleLineEnd = layout.getLineVisibleEnd(line)
      val lineEnd = min(safeEnd, visibleLineEnd)
      if (lineStart >= lineEnd) continue

      val startX = layout.getPrimaryHorizontal(lineStart)
      // A word that wraps (Chinese breaks between any two characters) ends
      // this line's part at the line break, and the x of that offset is the
      // start of the NEXT line: the underline ran from the margin under the
      // whole line. Take the line's right edge instead, as the annotations do.
      val endX = if (lineEnd >= visibleLineEnd) {
        layout.getLineRight(line)
      } else {
        layout.getPrimaryHorizontal(lineEnd)
      }
      val left = min(startX, endX)
      val right = max(startX, endX)
      val underlineY = layout.getLineBaseline(line).toFloat() + dp(3f)
      if (dissolve <= 0f) {
        underlinePath.reset()
        underlinePath.moveTo(left, underlineY)
        underlinePath.lineTo(right, underlineY)
        canvas.drawPath(underlinePath, paint)
        continue
      }
      pixelPaint.color = paint.color
      pixelPaint.alpha = paint.alpha
      val cell = pixelSize
      val top = underlineY - paint.strokeWidth / 2f
      val bottom = top + paint.strokeWidth
      val iy = floor(top / cell).toInt()
      for (ix in floor(left / cell).toInt() until ceil(right / cell).toInt()) {
        if (!pixelKept(ix, iy, dissolve)) continue
        pixelRect.set(max(left, ix * cell.toFloat()), top, min(right, (ix + 1) * cell.toFloat()), bottom)
        canvas.drawRect(pixelRect, pixelPaint)
      }
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

  // The longest level / annotation term on this block that covers a tapped
  // CJK character, in block-local offsets. Null off CJK text or between terms.
  private fun markedCjkWordAt(block: PageBlock, text: String, offset: Int): LocalTokenRange? {
    if (text.isEmpty()) return null
    val probe = offset.coerceIn(0, text.length - 1)
    if (!isCjkIdeograph(text[probe])) return null
    val currentPage = page ?: return null
    var best: LocalTokenRange? = null
    rangesForBlock(levelRanges, block.blockId).forEach { range ->
      if (range.pageIndex != currentPage.pageIndex || range.spineIndex != currentPage.spineIndex) return@forEach
      val start = range.sourceStartOffset - block.sourceStartOffset
      val end = range.sourceEndOffset - block.sourceStartOffset
      if (start < 0 || end > text.length || start >= end) return@forEach
      if (probe < start || probe >= end) return@forEach
      if (best == null || end - start > best!!.end - best!!.start) best = LocalTokenRange(start, end)
    }
    return best?.takeIf { it.end - it.start > 1 }
  }

  private fun tokenRangeAtOffset(text: String, offset: Int): LocalTokenRange? {
    if (text.isEmpty()) {
      return null
    }

    var probe = offset.coerceIn(0, text.length)
    if (probe == text.length) {
      probe -= 1
    }

    // Korean words carry invisible joiners between syllables; look through
    // them so a tap on a joiner still lands on the word.
    if (text[probe] == WORD_JOINER) {
      var left = probe
      while (left > 0 && text[left] == WORD_JOINER) left -= 1
      probe = left
    }

    // A tap on punctuation or a space picks the word next to it. The
    // neighbour is then segmented like a direct tap, so punctuation after a
    // Chinese sentence picks its last word rather than the whole run of text
    // back to the previous mark.
    if (!isReaderTokenChar(text[probe])) {
      probe = when {
        probe > 0 && isReaderTokenChar(text[probe - 1]) -> probe - 1
        probe + 1 < text.length && isReaderTokenChar(text[probe + 1]) -> probe + 1
        else -> return null
      }
    }

    if (isCjkIdeograph(text[probe])) {
      cjkTokenRangeAtOffset(text, probe)?.let { return it }
    }

    var start = probe
    while (
      start > 0 &&
      (isReaderTokenChar(text[start - 1]) || text[start - 1] == WORD_JOINER || isInWordPunctuationAt(text, start - 1))
    ) {
      start -= 1
    }
    while (start < probe && text[start] == WORD_JOINER) start += 1

    var end = probe + 1
    while (
      end < text.length &&
      (isReaderTokenChar(text[end]) || text[end] == WORD_JOINER || isInWordPunctuationAt(text, end))
    ) {
      end += 1
    }
    while (end > probe + 1 && text[end - 1] == WORD_JOINER) end -= 1

    return if (start < end) LocalTokenRange(start, end) else null
  }

  private fun cjkTokenRangeAtOffset(text: String, offset: Int): LocalTokenRange? {
    val probe = offset.coerceIn(0, text.length - 1)
    if (!isCjkIdeograph(text[probe])) {
      return null
    }

    var runStart = probe
    while (runStart > 0 && isCjkIdeograph(text[runStart - 1])) {
      runStart -= 1
    }

    var runEnd = probe + 1
    while (runEnd < text.length && isCjkIdeograph(text[runEnd])) {
      runEnd += 1
    }

    val runText = text.substring(runStart, runEnd)
    val relativeProbe = probe - runStart
    val iterator = BreakIterator.getWordInstance(Locale.CHINESE)
    iterator.setText(runText)

    val segmentStart = iterator.preceding(relativeProbe + 1)
    val segmentEnd = iterator.following(relativeProbe)

    if (
      segmentStart != BreakIterator.DONE &&
      segmentEnd != BreakIterator.DONE &&
      segmentStart < segmentEnd
    ) {
      val candidate = runText.substring(segmentStart, segmentEnd).trim()
      if (candidate.any { isCjkIdeograph(it) }) {
        return LocalTokenRange(runStart + segmentStart, runStart + segmentEnd)
      }
    }

    return LocalTokenRange(probe, probe + 1)
  }

  // Resolve the local [start, end) offsets of the sentence containing the
  // word at [localStart, localEnd) within the block. Prefers the precomputed
  // sentenceRanges (the same source focus mode uses); falls back to scanning
  // for sentence-boundary punctuation. Returns null if nothing sensible is
  // found so the caller can default to the bare word.
  // Grow the active text selection by one sentence: direction < 0 moves its
  // start to the previous sentence's start, direction > 0 moves its end to the
  // next sentence's end, crossing into the neighbouring paragraph when needed
  // (within this page). Re-emits onTextSelected so the translation updates.
  // Returns false when there is no text selection or nothing further to add.
  fun extendSelectionBySentence(direction: Int): Boolean {
    if (activeSelectionKind != ActiveSelectionKind.TEXT) return false
    extendWithinParagraph(direction)?.let { ranges ->
      publishExtendedSelection(ranges)
      return true
    }
    val (start, end) = activeTextSelectionEndpoints() ?: return false
    val ranges = if (direction < 0) {
      val newStart = previousSentenceStart(start) ?: return false
      buildSelectionRangesBetween(newStart, end)
    } else {
      val newEnd = nextSentenceEnd(end) ?: return false
      buildSelectionRangesBetween(start, newEnd)
    }
    if (ranges.isEmpty()) return false
    publishExtendedSelection(ranges)
    return true
  }

  private fun publishExtendedSelection(ranges: List<TextRange>) {
    activeSelectionRanges = ranges
    activeHighlightPaint.color = activePaintColor()
    invalidate()
    postInvalidateOnAnimation()
    val selectedText = selectedTextForRanges(ranges)
    Log.d(PAGE_VIEW_TAG, "text selection extended: pages=${ranges.map { it.pageIndex }} text=$selectedText")
    if (selectedText.isNotBlank()) {
      onTextSelected?.invoke(
        TextSelectionHit(
          text = selectedText,
          placement = placementForRanges(ranges),
          ranges = ranges
        )
      )
    }
  }

  // When the selection sits inside one paragraph, grow it by that paragraph's
  // own sentences in source coordinates, so it can reach the next sentence
  // even when it starts on the next page. Null means "not a single paragraph
  // or no further sentence here": the caller then tries the neighbouring
  // paragraphs on this page.
  private fun extendWithinParagraph(direction: Int): List<TextRange>? {
    val currentPage = page ?: return null
    val blockIds = activeSelectionRanges.map { it.blockId }.distinct()
    if (blockIds.size != 1) return null
    val rendered = renderedTextBlocks.firstOrNull { it.block.blockId == blockIds[0] } ?: return null
    val block = rendered.block
    val source = sourceTextOf(block)
    if (source.isEmpty()) return null
    val srcStart = activeSelectionRanges.minOf { it.sourceStartOffset }
    val srcEnd = activeSelectionRanges.maxOf { it.sourceEndOffset }
    val spans = sourceSentenceSpans(block)
    val newStart = if (direction < 0) spans.lastOrNull { it.first < srcStart }?.first ?: return null else srcStart
    val newEnd = if (direction > 0) spans.firstOrNull { it.second > srcEnd }?.second ?: return null else srcEnd
    return rangesForSourceSpan(block, currentPage.pageIndex, currentPage.spineIndex, newStart, newEnd)
  }

  // Sentence spans [start, end) of a paragraph in source coordinates.
  private fun sourceSentenceSpans(block: PageBlock): List<Pair<Int, Int>> {
    val length = sourceTextOf(block).length
    if (length <= 0) return emptyList()
    val spans = block.sentenceRanges
      .map { it.first.coerceIn(0, length) to (it.last + 1).coerceIn(0, length) }
      .filter { it.first < it.second }
    if (spans.isNotEmpty()) return spans
    val out = mutableListOf<Pair<Int, Int>>()
    var cursor = 0
    while (cursor < length) {
      val bounds = sentenceBoundsAtOffset(block, cursor - block.sourceStartOffset, cursor - block.sourceStartOffset) ?: break
      if (bounds.second <= cursor) break
      out.add(bounds)
      cursor = bounds.second
      while (cursor < length && sourceTextOf(block)[cursor].isWhitespace()) cursor++
    }
    return out
  }

  // Sentence spans of the part of a paragraph on this page, in local offsets.
  private fun sentenceSpans(block: PageBlock): List<Pair<Int, Int>> {
    val length = blockTextForSelection(block).length
    if (length <= 0) return emptyList()
    val sliceStart = block.sourceStartOffset
    return sourceSentenceSpans(block)
      .map { (it.first - sliceStart).coerceIn(0, length) to (it.second - sliceStart).coerceIn(0, length) }
      .filter { it.first < it.second }
  }

  private fun textPositionAt(renderedIndex: Int, localOffset: Int): TextPosition? {
    val block = renderedTextBlocks.getOrNull(renderedIndex)?.block ?: return null
    return TextPosition(renderedIndex, block, localOffset, block.sourceStartOffset + localOffset)
  }

  private fun previousSentenceStart(position: TextPosition): TextPosition? {
    sentenceSpans(position.block)
      .lastOrNull { it.first < position.localOffset }
      ?.let { return textPositionAt(position.renderedIndex, it.first) }
    for (index in position.renderedIndex - 1 downTo 0) {
      val block = renderedTextBlocks[index].block
      val last = sentenceSpans(block).lastOrNull() ?: continue
      return textPositionAt(index, last.first)
    }
    return null
  }

  private fun nextSentenceEnd(position: TextPosition): TextPosition? {
    sentenceSpans(position.block)
      .firstOrNull { it.second > position.localOffset }
      ?.let { return textPositionAt(position.renderedIndex, it.second) }
    for (index in position.renderedIndex + 1 until renderedTextBlocks.size) {
      val block = renderedTextBlocks[index].block
      val first = sentenceSpans(block).firstOrNull() ?: continue
      return textPositionAt(index, first.second)
    }
    return null
  }

  // Bounds [start, end) in SOURCE coordinates (offsets into the whole
  // paragraph) of the sentence containing the word at local [localStart,
  // localEnd) of this slice. Prefers the paginator's sentenceRanges, which are
  // in source coordinates; falls back to scanning the paragraph for terminal
  // punctuation. Null when nothing sensible is found.
  private fun sentenceBoundsAtOffset(
    block: PageBlock,
    localStart: Int,
    localEnd: Int
  ): Pair<Int, Int>? {
    val source = sourceTextOf(block)
    if (source.isEmpty()) {
      return null
    }

    val probe = (block.sourceStartOffset + localStart).coerceIn(0, source.length)
    val match = block.sentenceRanges.firstOrNull { probe in it.first..(it.last + 1) }
    if (match != null) {
      val start = match.first.coerceIn(0, source.length)
      val end = (match.last + 1).coerceIn(start, source.length)
      if (start < end) {
        return start to end
      }
    }

    val boundaries = setOf('.', '!', '?', '。', '！', '？', '\n')
    var start = probe
    while (start > 0 && !boundaries.contains(source[start - 1])) {
      start -= 1
    }
    var end = (block.sourceStartOffset + localEnd).coerceIn(start, source.length)
    while (end < source.length && !boundaries.contains(source[end])) {
      end += 1
    }
    if (end < source.length && boundaries.contains(source[end]) && source[end] != '\n') {
      end += 1
    }
    return if (start < end) start to end else null
  }

  private fun sourceTextOf(block: PageBlock): String =
    block.sourceText.ifEmpty { blockTextForSelection(block) }

  // Selection ranges for [srcStart, srcEnd) of a paragraph: the part on this
  // page, plus the parts that spill onto the previous / next page when this
  // page only holds a slice of the paragraph. Those pages draw their part when
  // the reader turns to them.
  private fun rangesForSourceSpan(
    block: PageBlock,
    pageIndex: Int,
    spineIndex: Int?,
    srcStart: Int,
    srcEnd: Int
  ): List<TextRange> {
    val sliceStart = block.sourceStartOffset
    val sliceEnd = sliceStart + blockTextForSelection(block).length
    val ranges = mutableListOf<TextRange>()
    if (srcStart < sliceStart && pageIndex > 0) {
      ranges.add(TextRange(pageIndex - 1, spineIndex, block.blockId, srcStart, sliceStart))
    }
    val hereStart = max(srcStart, sliceStart)
    val hereEnd = min(srcEnd, sliceEnd)
    if (hereStart < hereEnd) {
      ranges.add(TextRange(pageIndex, spineIndex, block.blockId, hereStart, hereEnd))
    }
    if (srcEnd > sliceEnd) {
      ranges.add(TextRange(pageIndex + 1, spineIndex, block.blockId, sliceEnd, srcEnd))
    }
    return ranges
  }

  // The sentence around a tapped word, from the whole paragraph, so a word
  // near a page edge still gets its complete sentence.
  private fun sentenceForToken(block: PageBlock, tokenRange: LocalTokenRange): String {
    val source = sourceTextOf(block)
    if (source.isEmpty()) return ""
    val (start, end) = sentenceBoundsAtOffset(block, tokenRange.start, tokenRange.end)
      ?: (block.sourceStartOffset + tokenRange.start to block.sourceStartOffset + tokenRange.end)
    return source.substring(start.coerceIn(0, source.length), end.coerceIn(0, source.length))
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

  private fun hitTestSelectionHandle(tapX: Float, tapY: Float): SelectionHandle? {
    if (activeSelectionKind != ActiveSelectionKind.TEXT || activeSelectionRanges.isEmpty()) {
      return null
    }

    if (geometryDirty) {
      rebuildGeometry()
    }

    val hitSlop = dp(24f).toFloat()
    return selectionHandleGeometries()
      .filter { geometry ->
        val top = min(geometry.lineTop, geometry.knobCenterY) - hitSlop
        val bottom = max(geometry.lineBottom, geometry.knobCenterY) + hitSlop
        abs(tapX - geometry.x) <= hitSlop && tapY in top..bottom
      }
      .minByOrNull { geometry ->
        abs(tapX - geometry.x) + abs(tapY - geometry.knobCenterY)
      }
      ?.handle
  }

  private fun selectionHandleGeometries(): List<SelectionHandleGeometry> {
    val endpoints = activeTextSelectionEndpoints() ?: return emptyList()

    return listOfNotNull(
      selectionHandleGeometry(endpoints.first, SelectionHandle.START),
      selectionHandleGeometry(endpoints.second, SelectionHandle.END)
    )
  }

  private fun selectionHandleGeometry(
    position: TextPosition,
    handle: SelectionHandle
  ): SelectionHandleGeometry? {
    val rendered = renderedTextBlocks.getOrNull(position.renderedIndex) ?: return null
    val layout = rendered.layout
    val metrics = selectionHandleLineMetrics(layout, position.localOffset, handle, rendered.block.textPaint)
      ?: return null

    val x = rendered.x + metrics.x
    val lineTop = rendered.y + metrics.stemTop
    val lineBottom = rendered.y + metrics.stemBottom
    val knobCenterY = rendered.y + metrics.knobCenterY

    return SelectionHandleGeometry(
      handle = handle,
      x = x,
      lineTop = lineTop,
      lineBottom = lineBottom,
      knobCenterY = knobCenterY
    )
  }

  private fun selectionHandleLineMetrics(
    layout: StaticLayout,
    localOffset: Int,
    handle: SelectionHandle,
    textPaint: TextPaint?
  ): SelectionHandleLineMetrics? {
    if (layout.lineCount <= 0) return null

    val textLength = layout.text.length
    val safeOffset = localOffset.coerceIn(0, textLength)
    val lineOffset = when (handle) {
      SelectionHandle.START -> safeOffset
      SelectionHandle.END -> max(0, safeOffset - 1)
    }.coerceIn(0, textLength)
    val line = layout.getLineForOffset(lineOffset).coerceIn(0, layout.lineCount - 1)
    val verticalMetrics = selectionHighlightVerticalMetrics(
      layout = layout,
      line = line,
      textPaint = textPaint,
      topPad = dp(12f).toFloat(),
      bottomPad = dp(5f).toFloat()
    ) ?: return null
    val stemTop = verticalMetrics.top
    val stemBottom = verticalMetrics.bottom
    val knobCenterY = when (handle) {
      SelectionHandle.START -> stemTop - dp(4f)
      SelectionHandle.END -> stemBottom + dp(4f)
    }

    return SelectionHandleLineMetrics(
      x = selectionHandleHorizontal(layout, safeOffset, line, handle),
      stemTop = stemTop,
      stemBottom = stemBottom,
      knobCenterY = knobCenterY
    )
  }

  private fun selectionHandleHorizontal(
    layout: StaticLayout,
    safeOffset: Int,
    selectedLine: Int,
    handle: SelectionHandle
  ): Float {
    if (handle == SelectionHandle.END && safeOffset > 0 && safeOffset < layout.text.length) {
      val safeOffsetLine = layout.getLineForOffset(safeOffset).coerceIn(0, layout.lineCount - 1)
      if (safeOffsetLine != selectedLine) {
        return layout.getLineRight(selectedLine)
      }
    }

    return layout.getPrimaryHorizontal(safeOffset)
  }

  private fun selectionHighlightVerticalMetrics(
    layout: StaticLayout,
    line: Int,
    textPaint: TextPaint?,
    topPad: Float,
    bottomPad: Float
  ): SelectionHighlightVerticalMetrics? {
    if (line !in 0 until layout.lineCount) return null

    val lineTop = layout.getLineTop(line).toFloat()
    val lineBottom = layout.getLineBottom(line).toFloat()
    val baseline = layout.getLineBaseline(line).toFloat()
    val fontMetrics = textPaint?.fontMetrics
    val contentTop = fontMetrics?.let { baseline + it.ascent } ?: lineTop
    val contentBottom = fontMetrics?.let { baseline + it.descent } ?: lineBottom
    var top = max(lineTop - dp(6f), contentTop - topPad)
    var bottom = min(lineBottom - dp(1f), contentBottom + bottomPad)
    // With pinyin above the line or translations under it (drawAnnotations
    // puts them just outside the ascent and descent), the box stays inside
    // the glyph band so it never covers them.
    if (showPinyin) top = max(top, contentTop)
    if (showGloss) bottom = min(bottom, contentBottom)

    return if (bottom > top) {
      SelectionHighlightVerticalMetrics(top = top, bottom = bottom)
    } else {
      null
    }
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
    activeSelectionHandle = null
    handleDragStartRanges = emptyList()
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

  private fun sp(value: Float): Float {
    return TypedValue.applyDimension(
      TypedValue.COMPLEX_UNIT_SP,
      value,
      resources.displayMetrics
    )
  }
}

private fun loadReaderSansTypeface(context: Context, weight: String): Typeface {
  val assetNames = when (weight) {
    "bold" -> listOf(
      "Inter_700Bold.ttf",
      "fonts/Inter_700Bold.ttf",
      "node_modules/@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf"
    )
    "medium" -> listOf(
      "Inter_600SemiBold.ttf",
      "Inter_500Medium.ttf",
      "fonts/Inter_600SemiBold.ttf",
      "fonts/Inter_500Medium.ttf",
      "node_modules/@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf",
      "node_modules/@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf"
    )
    else -> listOf(
      "Inter_400Regular.ttf",
      "fonts/Inter_400Regular.ttf",
      "node_modules/@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf"
    )
  }

  assetNames.forEach { assetName ->
    runCatching {
      return Typeface.createFromAsset(context.assets, assetName)
    }
  }

  return when (weight) {
    "bold" -> Typeface.create("sans-serif", Typeface.BOLD)
    "medium" -> Typeface.create("sans-serif-medium", Typeface.NORMAL)
    else -> Typeface.create("sans-serif", Typeface.NORMAL)
  }
}

private fun loadReaderDisplayTypeface(context: Context, weight: String): Typeface {
  val assetNames = when (weight) {
    "bold" -> listOf(
      "Fraunces_600SemiBold.ttf",
      "Fraunces_700Bold.ttf",
      "fonts/Fraunces_600SemiBold.ttf",
      "fonts/Fraunces_700Bold.ttf",
      "node_modules/@expo-google-fonts/fraunces/600SemiBold/Fraunces_600SemiBold.ttf",
      "node_modules/@expo-google-fonts/fraunces/700Bold/Fraunces_700Bold.ttf"
    )
    else -> listOf(
      "Fraunces_500Medium.ttf",
      "Fraunces_400Regular.ttf",
      "fonts/Fraunces_500Medium.ttf",
      "fonts/Fraunces_400Regular.ttf",
      "node_modules/@expo-google-fonts/fraunces/500Medium/Fraunces_500Medium.ttf",
      "node_modules/@expo-google-fonts/fraunces/400Regular/Fraunces_400Regular.ttf"
    )
  }

  assetNames.forEach { assetName ->
    runCatching {
      return Typeface.createFromAsset(context.assets, assetName)
    }
  }

  return Typeface.create("serif", if (weight == "bold") Typeface.BOLD else Typeface.NORMAL)
}
