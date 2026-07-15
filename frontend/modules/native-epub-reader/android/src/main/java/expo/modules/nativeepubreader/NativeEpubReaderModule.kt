package expo.modules.nativeepubreader

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.MotionEvent
import android.view.View
import android.view.View.MeasureSpec
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.view.animation.PathInterpolator
import android.widget.FrameLayout
import android.widget.ScrollView
import androidx.recyclerview.widget.RecyclerView
import androidx.viewpager2.widget.ViewPager2
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.roundToInt
import java.util.ArrayDeque
import java.util.concurrent.CancellationException
import java.util.concurrent.Executors
import java.util.concurrent.Future

private data class HighlightTerm(
  val text: String,
  val priority: Int
)

private data class HighlightMatch(
  val term: String,
  val start: Int,
  val end: Int,
  val priority: Int
)

private class HighlightTrieNode {
  val children = mutableMapOf<Char, Int>()
  val outputs = mutableListOf<HighlightTerm>()
  var fail = 0
}

private class HighlightMatcher(terms: List<String>) {
  private val nodes = mutableListOf(HighlightTrieNode())
  val termCount = terms.size

  init {
    terms.forEachIndexed { priority, term ->
      var nodeIndex = 0
      term.forEach { char ->
        nodeIndex = nodes[nodeIndex].children.getOrPut(char) {
          nodes.add(HighlightTrieNode())
          nodes.lastIndex
        }
      }
      nodes[nodeIndex].outputs.add(HighlightTerm(term, priority))
    }
    buildFailureLinks()
  }

  fun find(text: String): List<HighlightMatch> {
    if (termCount == 0 || text.isEmpty()) {
      return emptyList()
    }

    val matches = mutableListOf<HighlightMatch>()
    var nodeIndex = 0

    text.forEachIndexed { index, char ->
      while (nodeIndex != 0 && !nodes[nodeIndex].children.containsKey(char)) {
        nodeIndex = nodes[nodeIndex].fail
      }

      nodeIndex = nodes[nodeIndex].children[char] ?: 0

      nodes[nodeIndex].outputs.forEach { term ->
        val end = index + 1
        matches.add(
          HighlightMatch(
            term = term.text,
            start = end - term.text.length,
            end = end,
            priority = term.priority
          )
        )
      }
    }

    return matches.sortedWith(
      compareBy<HighlightMatch> { it.priority }
        .thenBy { it.start }
        .thenBy { it.end }
    )
  }

  private fun buildFailureLinks() {
    val queue = ArrayDeque<Int>()

    nodes[0].children.values.forEach { childIndex ->
      nodes[childIndex].fail = 0
      queue.add(childIndex)
    }

    while (!queue.isEmpty()) {
      val currentIndex = queue.removeFirst()
      nodes[currentIndex].children.forEach { (char, childIndex) ->
        var fallbackIndex = nodes[currentIndex].fail

        while (fallbackIndex != 0 && !nodes[fallbackIndex].children.containsKey(char)) {
          fallbackIndex = nodes[fallbackIndex].fail
        }

        val failIndex = nodes[fallbackIndex].children[char] ?: 0
        nodes[childIndex].fail = failIndex
        nodes[childIndex].outputs.addAll(nodes[failIndex].outputs)
        queue.add(childIndex)
      }
    }
  }
}

private data class HighlightBuildResult(
  val rangesByPage: Map<Int, List<TextRange>>,
  val contextsByPage: Map<Int, List<Map<String, Any>>> = emptyMap()
)

class NativeEpubReaderModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NativeEpubReader")

    AsyncFunction("extractPdfDocument") { options: Map<String, Any?> ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      PdfDocumentExtractor(context).extract(options)
    }

    AsyncFunction("renderPdfCover") { options: Map<String, Any?> ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      PdfDocumentExtractor(context).renderCover(options)
    }

    // Imperative beam navigation for focus mode. Called directly from the JS
    // arrow buttons so a sentence step doesn't need a React state round-trip
    // through the focusNavToken prop (which re-renders the whole reader screen
    // before the beam can move).
    AsyncFunction("focusNav") { view: NativeEpubReaderView, direction: String ->
      view.focusNav(direction)
    }.runOnQueue(Queues.MAIN)

    View(NativeEpubReaderView::class) {
      Prop("bookManifest") { view: NativeEpubReaderView, manifest: Map<String, Any?> ->
        view.setBookManifest(manifest)
      }

      Prop("chapterBlocks") { view: NativeEpubReaderView, blocks: List<Any?> ->
        view.setChapterBlocks(blocks)
      }

      Prop("chapterResources") { view: NativeEpubReaderView, resources: List<Any?> ->
        view.setChapterResources(resources)
      }

      Prop("chapterWindow") { view: NativeEpubReaderView, chapters: List<Any?> ->
        view.setChapterWindow(chapters)
      }

      Prop("restorePosition") { view: NativeEpubReaderView, position: Map<String, Any?> ->
        view.setRestorePosition(position)
      }

      Prop("chapterTransitionDirection") { view: NativeEpubReaderView, direction: String ->
        view.setChapterTransitionDirection(direction)
      }

      Prop("fontSize") { view: NativeEpubReaderView, fontSize: Double ->
        view.setReaderFontSize(fontSize)
      }

      Prop("lineHeight") { view: NativeEpubReaderView, lineHeight: Double ->
        view.setReaderLineHeight(lineHeight)
      }

      Prop("theme") { view: NativeEpubReaderView, theme: String ->
        view.setReaderTheme(theme)
      }

      Prop("themeTokens") { view: NativeEpubReaderView, tokens: Map<String, Any?> ->
        view.setThemeTokens(tokens)
      }

      Prop("renderMode") { view: NativeEpubReaderView, mode: String ->
        view.setReaderRenderMode(mode)
      }

      Prop("readerEdgeStateEnabled") { view: NativeEpubReaderView, enabled: Boolean ->
        view.setReaderEdgeStateEnabled(enabled)
      }

      Prop("highlightTerms") { view: NativeEpubReaderView, terms: List<Any?> ->
        view.setHighlightTerms(terms)
      }

      Prop("sameLevelTerms") { view: NativeEpubReaderView, terms: List<Any?> ->
        view.setSameLevelTerms(terms)
      }

      Prop("aboveLevelTerms") { view: NativeEpubReaderView, terms: List<Any?> ->
        view.setAboveLevelTerms(terms)
      }

      Prop("clearSelectionToken") { view: NativeEpubReaderView, token: Double ->
        view.setClearSelectionToken(token.toInt())
      }

      Prop("focusSentenceCount") { view: NativeEpubReaderView, count: Double ->
        view.setFocusSentenceCount(count.toInt())
      }

      Prop("focusSwipeEnabled") { view: NativeEpubReaderView, enabled: Boolean ->
        view.setFocusSwipeEnabled(enabled)
      }

      Prop("focusNavToken") { view: NativeEpubReaderView, token: String ->
        view.setFocusNavToken(token)
      }

      Prop("focusPanelHeight") { view: NativeEpubReaderView, height: Double ->
        view.setFocusPanelHeight(height)
      }

      Events(
        "onPageChange",
        "onChapterEnd",
        "onChapterStart",
        "onChapterCommit",
        "onWordSelected",
        "onTextSelected",
        "onSelectionCleared",
        "onFocusSentenceChange"
      )
    }
  }
}

private const val TAG = "NativeEpubReader"

data class ReaderThemePalette(
  val backgroundColor: Int,
  val bodyTextColor: Int,
  val mutedTextColor: Int,
  val subtleTextColor: Int,
  val ruleColor: Int,
  val edgeButtonColor: Int,
  val edgeButtonTextColor: Int,
  val activeHighlightColor: Int,
  val textSelectionHighlightColor: Int,
  val savedHighlightColor: Int,
  val savedHighlightTextColor: Int,
  val sameLevelUnderlineColor: Int,
  val aboveLevelUnderlineColor: Int,
  val selectionHandleColor: Int,
  val placeholderColor: Int
)

fun readerThemePaletteForMode(isDark: Boolean): ReaderThemePalette {
  return if (isDark) {
    ReaderThemePalette(
      backgroundColor = Color.rgb(0x11, 0x15, 0x1c),
      bodyTextColor = Color.rgb(0xf0, 0xed, 0xed),
      mutedTextColor = Color.rgb(0x9a, 0x9c, 0x9f),
      subtleTextColor = Color.rgb(0x5c, 0x5e, 0x63),
      ruleColor = Color.rgb(0x35, 0x3c, 0x47),
      edgeButtonColor = Color.rgb(0xf0, 0xed, 0xed),
      edgeButtonTextColor = Color.rgb(0x1b, 0x1c, 0x1c),
      activeHighlightColor = Color.rgb(0x35, 0x3c, 0x47),
      textSelectionHighlightColor = Color.argb(0x2e, 0xf0, 0xed, 0xed),
      savedHighlightColor = Color.rgb(0x20, 0x26, 0x31),
      savedHighlightTextColor = Color.WHITE,
      sameLevelUnderlineColor = Color.rgb(0x74, 0xc4, 0x76),
      aboveLevelUnderlineColor = Color.rgb(0xf5, 0x9e, 0x0b),
      selectionHandleColor = Color.rgb(0xf0, 0xed, 0xed),
      placeholderColor = Color.rgb(0x44, 0x47, 0x4b)
    )
  } else {
    ReaderThemePalette(
      backgroundColor = Color.rgb(0xfb, 0xf9, 0xf8),
      bodyTextColor = Color.rgb(0x1b, 0x1c, 0x1c),
      mutedTextColor = Color.rgb(0x75, 0x77, 0x7b),
      subtleTextColor = Color.rgb(0x9a, 0x9c, 0x9f),
      ruleColor = Color.rgb(0xc5, 0xc6, 0xcb),
      edgeButtonColor = Color.rgb(0x20, 0x26, 0x31),
      edgeButtonTextColor = Color.WHITE,
      activeHighlightColor = Color.rgb(0xe4, 0xe2, 0xe2),
      textSelectionHighlightColor = Color.argb(0x2e, 0x20, 0x26, 0x31),
      savedHighlightColor = Color.rgb(0x20, 0x26, 0x31),
      savedHighlightTextColor = Color.WHITE,
      sameLevelUnderlineColor = Color.rgb(0x2f, 0x8f, 0x46),
      aboveLevelUnderlineColor = Color.rgb(0xc4, 0x66, 0x1f),
      selectionHandleColor = Color.rgb(0x20, 0x26, 0x31),
      placeholderColor = Color.rgb(180, 174, 166)
    )
  }
}

private fun colorFromThemeToken(tokens: Map<String, Any?>, key: String, fallback: Int): Int {
  val raw = tokens[key] as? String ?: return fallback
  return try {
    Color.parseColor(raw)
  } catch (_: IllegalArgumentException) {
    fallback
  }
}

private fun readerThemePaletteFromTokens(tokens: Map<String, Any?>, isDark: Boolean): ReaderThemePalette {
  val fallback = readerThemePaletteForMode(isDark)
  return ReaderThemePalette(
    backgroundColor = colorFromThemeToken(tokens, "background", fallback.backgroundColor),
    bodyTextColor = colorFromThemeToken(tokens, "bodyText", fallback.bodyTextColor),
    mutedTextColor = colorFromThemeToken(tokens, "mutedText", fallback.mutedTextColor),
    subtleTextColor = colorFromThemeToken(tokens, "subtleText", fallback.subtleTextColor),
    ruleColor = colorFromThemeToken(tokens, "rule", fallback.ruleColor),
    edgeButtonColor = colorFromThemeToken(tokens, "edgeButton", fallback.edgeButtonColor),
    edgeButtonTextColor = colorFromThemeToken(tokens, "edgeButtonText", fallback.edgeButtonTextColor),
    activeHighlightColor = colorFromThemeToken(tokens, "activeHighlight", fallback.activeHighlightColor),
    textSelectionHighlightColor = colorFromThemeToken(tokens, "textSelectionHighlight", fallback.textSelectionHighlightColor),
    savedHighlightColor = colorFromThemeToken(tokens, "savedHighlight", fallback.savedHighlightColor),
    savedHighlightTextColor = colorFromThemeToken(tokens, "savedHighlightText", fallback.savedHighlightTextColor),
    sameLevelUnderlineColor = colorFromThemeToken(tokens, "levelSameUnderline", fallback.sameLevelUnderlineColor),
    aboveLevelUnderlineColor = colorFromThemeToken(tokens, "levelAboveUnderline", fallback.aboveLevelUnderlineColor),
    selectionHandleColor = colorFromThemeToken(tokens, "selectionHandle", fallback.selectionHandleColor),
    placeholderColor = colorFromThemeToken(tokens, "placeholder", fallback.placeholderColor)
  )
}

private data class ChapterWindowItem(
  val role: String,
  val spineIndex: Int,
  val href: String,
  val path: String,
  val title: String,
  val blocks: List<Any?>,
  val resources: List<Any?>,
  val signature: String
)

private data class ChapterPageRange(
  val spineIndex: Int,
  val href: String,
  val path: String,
  val startIndex: Int,
  val pageCount: Int
)

private data class PaginationResult(
  val pages: List<ReaderPage>,
  val ranges: List<ChapterPageRange>,
  val chapterCount: Int
)

// A sentence within the focus-mode chapter layout. Offsets are local to the
// block's plain text; topY/bottomY are content coordinates including the
// focus-mode top inset.
private data class FocusSentenceInfo(
  val blockId: String,
  val startOffset: Int,
  val endOffset: Int,
  val topY: Int,
  val bottomY: Int
)

// Focus (sentence beam) mode geometry and motion, mirroring the design spec:
// the focused sentence's top is pinned at 60% of the viewport, the content
// gets generous top/bottom insets so edge sentences can still anchor there,
// the anchor scroll eases over 380ms, and the dictionary-panel lift matches
// the panel's 450ms cubic-bezier(.22,.61,.36,1) slide.
private const val FOCUS_ANCHOR_RATIO = 0.60f
private const val FOCUS_TOP_INSET_RATIO = 0.545f
private const val FOCUS_BOTTOM_INSET_RATIO = 0.52f
private const val FOCUS_SCROLL_DURATION_MS = 380L
private const val FOCUS_PANEL_LIFT_DURATION_MS = 450L
// Rapid stepping: when the next beam move arrives within this window of the
// previous one, the scroll/highlight animations run at the fast durations so
// navigation keeps pace with the reader's taps instead of queueing behind
// full-length animations.
private const val FOCUS_RAPID_NAV_WINDOW_MS = 450L
private const val FOCUS_SCROLL_FAST_DURATION_MS = 180L

// Continuous (vertical scroll) mode: scroll-progress events are debounced so a
// fling emits one event when it settles, and a chapter transition needs a
// deliberate pull at the chapter edge — larger than the focus swipe threshold
// so it never fires from scroll momentum.
private const val CONTINUOUS_SCROLL_DISPATCH_DELAY_MS = 180L
private const val CONTINUOUS_EDGE_PULL_THRESHOLD_DP = 56f

private class ContinuousReaderScrollView(context: Context) : ScrollView(context) {
  private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
  private var startX = 0f
  private var startY = 0f
  var onVerticalDragIntercepted: (() -> Unit)? = null
  private var reportedVerticalDrag = false

  // Focus-mode swipe navigation: vertical swipes advance the sentence beam
  // instead of scrolling. Threshold mirrors the design spec (28dp).
  var swipeNavigationEnabled = false
  var onSwipeNavigate: ((Int) -> Unit)? = null
  private val swipeNavigationThreshold = 28f * context.resources.displayMetrics.density

  // Continuous-mode scroll progress and chapter navigation: a pull past the
  // top/bottom edge (started and released at that edge) turns the chapter.
  var onScrollPositionChanged: ((Int) -> Unit)? = null
  var edgePullEnabled = false
  var onEdgePull: ((Int) -> Unit)? = null
  private val edgePullThreshold = CONTINUOUS_EDGE_PULL_THRESHOLD_DP * context.resources.displayMetrics.density
  private var downAtTop = false
  private var downAtBottom = false

  init {
    isFillViewport = true
    overScrollMode = OVER_SCROLL_IF_CONTENT_SCROLLS
  }

  private fun maxVerticalScroll(): Int {
    val child = getChildAt(0) ?: return 0
    return (child.height - height).coerceAtLeast(0)
  }

  override fun onScrollChanged(l: Int, t: Int, oldl: Int, oldt: Int) {
    super.onScrollChanged(l, t, oldl, oldt)
    onScrollPositionChanged?.invoke(t)
  }

  override fun onInterceptTouchEvent(event: MotionEvent): Boolean {
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        startX = event.x
        startY = event.y
        reportedVerticalDrag = false
        downAtTop = scrollY <= 0
        downAtBottom = scrollY >= maxVerticalScroll()
        super.onInterceptTouchEvent(event)
        return false
      }
      MotionEvent.ACTION_MOVE -> {
        val dx = abs(event.x - startX)
        val dy = abs(event.y - startY)
        if (dy > touchSlop && dy > dx) {
          if (!reportedVerticalDrag) {
            reportedVerticalDrag = true
            onVerticalDragIntercepted?.invoke()
          }
          return true
        }
      }
    }

    return super.onInterceptTouchEvent(event)
  }

  override fun onTouchEvent(event: MotionEvent): Boolean {
    if (!swipeNavigationEnabled) {
      var pendingEdgePull = 0
      if (edgePullEnabled) {
        when (event.actionMasked) {
          MotionEvent.ACTION_DOWN -> {
            startY = event.y
            downAtTop = scrollY <= 0
            downAtBottom = scrollY >= maxVerticalScroll()
          }
          MotionEvent.ACTION_UP -> {
            val dy = event.y - startY
            if (dy <= -edgePullThreshold && downAtBottom && scrollY >= maxVerticalScroll()) {
              pendingEdgePull = 1
            } else if (dy >= edgePullThreshold && downAtTop && scrollY <= 0) {
              pendingEdgePull = -1
            }
          }
        }
      }

      val handled = super.onTouchEvent(event)
      if (pendingEdgePull != 0) {
        onEdgePull?.invoke(pendingEdgePull)
      }
      return handled
    }

    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        startX = event.x
        startY = event.y
      }
      MotionEvent.ACTION_UP -> {
        val dy = event.y - startY
        if (abs(dy) >= swipeNavigationThreshold) {
          onSwipeNavigate?.invoke(if (dy < 0) 1 else -1)
        }
      }
    }

    // Swallow the gesture entirely so the content never free-scrolls.
    return true
  }
}

class NativeEpubReaderView(
  context: Context,
  appContext: AppContext
) : ExpoView(context, appContext) {
  private val onPageChange by EventDispatcher()
  private val onChapterEnd by EventDispatcher()
  private val onChapterStart by EventDispatcher()
  private val onChapterCommit by EventDispatcher()
  private val onWordSelected by EventDispatcher()
  private val onTextSelected by EventDispatcher()
  private val onSelectionCleared by EventDispatcher()
  private val onFocusSentenceChange by EventDispatcher()
  private val viewPager = ViewPager2(context)
  private val continuousScrollView = ContinuousReaderScrollView(context)
  private val continuousPageView = EpubPageView(context)
  private val mainHandler = Handler(Looper.getMainLooper())
  private val paginationExecutor = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "NativeEpubPaginator").apply {
      isDaemon = true
    }
  }
  private var paginationTask: Future<*>? = null
  private var paginationGeneration = 0
  private var pageAdapter: EpubPageAdapter? = null
  private var pages: List<ReaderPage> = emptyList()
  private var bookManifest: Map<String, Any?> = emptyMap()
  private var chapterBlocks: List<Any?> = emptyList()
  private var chapterResources: List<Any?> = emptyList()
  private var chapterWindow: List<ChapterWindowItem> = emptyList()
  private var restorePosition: Map<String, Any?> = emptyMap()
  private var restorePositionSignature = ""
  private var chapterBlocksSignature = ""
  private var chapterWindowSignature = ""
  private var pageRanges: List<ChapterPageRange> = emptyList()
  private var committedSpineIndex: Int? = null
  private var layoutWidth = 0
  private var layoutHeight = 0
  private val pagePaddingH = dp(24f)
  private val pagePaddingV = dp(30f)
  private var readerFontSizeSp = 18f
  private var readerLineHeightMultiplier = 1.5f
  private var readerTheme = "light"
  private var readerThemeTokens: Map<String, Any?> = emptyMap()
  private var themePalette = readerThemePaletteForMode(false)
  private var readerRenderMode = "paged"
  private var readerEdgeStateEnabled = true
  private var continuousPageIndex = 0
  private var highlightTerms: List<String> = emptyList()
  private var sameLevelTerms: List<String> = emptyList()
  private var aboveLevelTerms: List<String> = emptyList()
  private var highlightMatcher = HighlightMatcher(emptyList())
  private var sameLevelMatcher = HighlightMatcher(emptyList())
  private var aboveLevelMatcher = HighlightMatcher(emptyList())
  private var savedHighlightRangesByPage: Map<Int, List<TextRange>> = emptyMap()
  private var savedHighlightContextsByPage: Map<Int, List<Map<String, Any>>> = emptyMap()
  private var sameLevelRangesByPage: Map<Int, List<TextRange>> = emptyMap()
  private var aboveLevelRangesByPage: Map<Int, List<TextRange>> = emptyMap()
  private var activeSelectionRanges: List<TextRange> = emptyList()
  private var activeSelectionKind: ActiveSelectionKind? = null
  private var lastClearSelectionToken: Int? = null
  private var activeHighlightColor = themePalette.activeHighlightColor
  private var textSelectionHighlightColor = themePalette.textSelectionHighlightColor
  private var savedHighlightColor = themePalette.savedHighlightColor
  private var savedHighlightTextColor = themePalette.savedHighlightTextColor
  private var sameLevelUnderlineColor = themePalette.sameLevelUnderlineColor
  private var aboveLevelUnderlineColor = themePalette.aboveLevelUnderlineColor
  private var userDraggedPager = false
  private var previousPageIndex = 0
  private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
  private var dragStartPage = -1
  private var dragStartX = 0f
  private var dragLatestX = 0f
  private var pendingEdgeNavigation: String? = null
  private var chapterTransitionDirection = "none"
  private var isChapterTransitionAnimating = false
  private var pagePositionOffset = 0
  private var suppressPageEvents = false
  private var focusSentences: List<FocusSentenceInfo> = emptyList()
  private var focusIndex = 0
  private var focusSpanCount = 1
  private var focusSwipeEnabled = false
  private var lastFocusNavToken: String? = null
  private var lastFocusMoveAtMs = 0L
  private var focusPanelLiftPx = 0f
  private var focusScrollAnimator: ValueAnimator? = null
  private var suppressContinuousScrollEvents = false
  private val continuousScrollDispatchRunnable = Runnable {
    dispatchContinuousPageChange(includeSavedHighlights = false)
  }

  init {
    setReaderBackgroundColors()

    viewPager.orientation = ViewPager2.ORIENTATION_HORIZONTAL
    viewPager.offscreenPageLimit = 1
    viewPager.setBackgroundColor(readerBackgroundColor())
    viewPager.registerOnPageChangeCallback(object : ViewPager2.OnPageChangeCallback() {
      override fun onPageScrollStateChanged(state: Int) {
        if (state == ViewPager2.SCROLL_STATE_DRAGGING) {
          userDraggedPager = true
        }

        if (state == ViewPager2.SCROLL_STATE_SETTLING && userDraggedPager) {
          val page = pages.getOrNull(viewPager.currentItem)
          Log.d(
            TAG,
            "page turn animation start: displayPage=${viewPager.currentItem} " +
              "spine=${page?.spineIndex ?: "unknown"} chapterPage=${page?.chapterPageIndex ?: -1}"
          )
        }

        if (state == ViewPager2.SCROLL_STATE_IDLE) {
          flushPendingEdgeNavigation()
          flushChapterCommitIfNeeded()
          finishChapterTransitionIfNeeded()
        }
      }

      override fun onPageSelected(position: Int) {
        if (suppressPageEvents) {
          return
        }

        val total = pages.size
        val logicalPage = pages.getOrNull(position)?.chapterPageIndex
          ?: logicalPageForDisplayPosition(position)
        dispatchPageChange(position, total)

        previousPageIndex = logicalPage
        userDraggedPager = false
      }
    })
    (viewPager.getChildAt(0) as? RecyclerView)?.setOnTouchListener { _, event ->
      trackEdgeSwipe(event)
      false
    }

    continuousScrollView.visibility = View.GONE
    continuousScrollView.isFillViewport = true
    continuousScrollView.setBackgroundColor(readerBackgroundColor())
    continuousScrollView.onVerticalDragIntercepted = {
      clearActiveSelection(dispatchEvent = true, forceEvent = true)
    }
    continuousScrollView.onSwipeNavigate = { direction ->
      moveFocus(direction)
    }
    continuousScrollView.onScrollPositionChanged = { handleContinuousScrollChanged() }
    continuousScrollView.onEdgePull = { direction -> handleContinuousEdgePull(direction) }
    continuousScrollView.addView(
      continuousPageView,
      FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT
      )
    )

    addView(
      viewPager,
      ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT
      )
    )
    addView(
      continuousScrollView,
      ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT
      )
    )
    updateRenderModeVisibility()
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    super.onLayout(changed, left, top, right, bottom)

    val width = right - left
    val height = bottom - top
    if (width != layoutWidth || height != layoutHeight) {
      layoutWidth = width
      layoutHeight = height
      if (chapterBlocks.isNotEmpty()) {
        repaginate(resetToFirstPage = pageAdapter == null)
      }
    }
  }

  override fun onDetachedFromWindow() {
    paginationGeneration += 1
    paginationTask?.cancel(true)
    focusScrollAnimator?.cancel()
    mainHandler.removeCallbacks(continuousScrollDispatchRunnable)
    super.onDetachedFromWindow()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (pages.isEmpty() && chapterBlocks.isNotEmpty() && layoutWidth > 0 && layoutHeight > 0) {
      repaginate(resetToFirstPage = pageAdapter == null)
    }
  }

  fun setBookManifest(manifest: Map<String, Any?>) {
    val previousEdgeStateEnabled = readerEdgeStateEnabled
    manifest.booleanValue("readerEdgeStateEnabled")?.let { enabled ->
      readerEdgeStateEnabled = enabled
    }
    manifest.stringValue("renderMode")?.let { mode ->
      setReaderRenderMode(mode)
    }
    manifest.stringValue("chapterTransitionDirection")?.let { direction ->
      setChapterTransitionDirection(direction)
    }
    bookManifest = manifest
    manifest.intValue("currentSpineIndex")?.let { spineIndex ->
      committedSpineIndex = spineIndex
    }
    if (previousEdgeStateEnabled != readerEdgeStateEnabled && pages.isNotEmpty()) {
      chapterTransitionDirection = "none"
      repaginate(resetToFirstPage = false)
    }
  }

  fun setChapterBlocks(blocks: List<Any?>) {
    val nextSignature = signatureForBlocks(blocks)

    if (chapterBlocksSignature == nextSignature) {
      chapterBlocks = blocks
      return
    }

    chapterBlocks = blocks
    chapterBlocksSignature = nextSignature
    if (chapterWindow.isNotEmpty()) {
      return
    }
    Log.d(TAG, "native blocks received: count=${blocks.size} signature=$nextSignature")
    repaginate(resetToFirstPage = true)
  }

  fun setChapterResources(resources: List<Any?>) {
    chapterResources = resources
  }

  fun setChapterWindow(chapters: List<Any?>) {
    val nextWindow = chapters.mapNotNull { raw ->
      val chapter = raw.asMap() ?: return@mapNotNull null
      val spineIndex = chapter.intValue("spineIndex") ?: return@mapNotNull null
      val blocks = chapter.listValue("blocks")
      if (blocks.isEmpty()) {
        return@mapNotNull null
      }

      ChapterWindowItem(
        role = chapter.stringValue("role") ?: "adjacent",
        spineIndex = spineIndex,
        href = chapter.stringValue("href") ?: "",
        path = chapter.stringValue("path") ?: "",
        title = chapter.stringValue("title")
          ?: chapter.stringValue("label")
          ?: "",
        blocks = blocks,
        resources = chapter.listValue("resources"),
        signature = signatureForBlocks(blocks)
      )
    }.sortedBy { it.spineIndex }

    val nextSignature = nextWindow.joinToString("|") { chapter ->
      "${chapter.role}:${chapter.spineIndex}:${chapter.href}:${chapter.path}:${chapter.title}:${chapter.signature}"
    }

    if (chapterWindowSignature == nextSignature) {
      chapterWindow = nextWindow
      return
    }

    val previousCurrentSignature = currentWindowItemSignature(chapterWindow)
    val nextCurrentSignature = currentWindowItemSignature(nextWindow)
    chapterWindow = nextWindow
    chapterWindowSignature = nextSignature

    val currentChapter = currentWindowItem(nextWindow)
    if (currentChapter != null) {
      chapterBlocks = currentChapter.blocks
      chapterResources = currentChapter.resources
      chapterBlocksSignature = currentChapter.signature
    }

    Log.d(
      TAG,
      "native chapter window received: chapters=${nextWindow.size} " +
        "current=${currentChapter?.spineIndex ?: "none"} signature=$nextSignature"
    )
    repaginate(resetToFirstPage = previousCurrentSignature != nextCurrentSignature)
  }

  fun setRestorePosition(position: Map<String, Any?>) {
    val nextSignature = signatureForRestorePosition(position)
    if (restorePositionSignature == nextSignature) {
      restorePosition = position
      return
    }

    restorePosition = position
    restorePositionSignature = nextSignature

    if (pages.isNotEmpty()) {
      post {
        applyRestorePositionToCurrentPagesIfPossible()
      }
    }
  }

  fun setChapterTransitionDirection(direction: String) {
    chapterTransitionDirection = when (direction.lowercase().substringBefore(":")) {
      "next" -> "next"
      "previous" -> "previous"
      else -> "none"
    }
  }

  fun setReaderFontSize(fontSize: Double) {
    val nextFontSize = fontSize.toFloat().coerceIn(12f, 30f)
    if (readerFontSizeSp == nextFontSize) {
      return
    }

    readerFontSizeSp = nextFontSize
    chapterTransitionDirection = "none"
    repaginate(resetToFirstPage = false)
  }

  fun setReaderLineHeight(lineHeight: Double) {
    val nextLineHeight = lineHeight.toFloat().coerceIn(1f, 2.6f)
    if (readerLineHeightMultiplier == nextLineHeight) {
      return
    }

    readerLineHeightMultiplier = nextLineHeight
    chapterTransitionDirection = "none"
    repaginate(resetToFirstPage = false)
  }

  fun setReaderTheme(theme: String) {
    val nextTheme = if (theme.lowercase() == "dark") "dark" else "light"
    if (readerTheme == nextTheme) {
      return
    }

    readerTheme = nextTheme
    themePalette = readerThemePaletteFromTokens(readerThemeTokens, readerTheme == "dark")
    setReaderBackgroundColors()
    updateHighlightColorsForTheme()
    chapterTransitionDirection = "none"
    repaginate(resetToFirstPage = false)
  }

  fun setThemeTokens(tokens: Map<String, Any?>) {
    readerThemeTokens = tokens
    val nextPalette = readerThemePaletteFromTokens(tokens, readerTheme == "dark")
    if (themePalette == nextPalette) {
      return
    }

    themePalette = nextPalette
    setReaderBackgroundColors()
    updateHighlightColorsForTheme()
    chapterTransitionDirection = "none"
    repaginate(resetToFirstPage = false)
  }

  fun setReaderRenderMode(mode: String) {
    val nextMode = when (mode.lowercase()) {
      "continuous", "vertical", "scroll", "scrolling" -> "continuous"
      "focus", "beam" -> "focus"
      else -> "paged"
    }
    if (readerRenderMode == nextMode) {
      return
    }

    readerRenderMode = nextMode
    updateRenderModeVisibility()
    chapterTransitionDirection = "none"
    clearActiveSelection(dispatchEvent = false)
    focusScrollAnimator?.cancel()
    continuousPageView.focusPanelOpen = false
    continuousScrollView.swipeNavigationEnabled = isFocusMode() && focusSwipeEnabled
    continuousScrollView.edgePullEnabled = readerRenderMode == "continuous"
    updateFocusLift(animated = false)
    // JS refreshes restorePosition on every page event, so resetting through
    // the restore path re-lands the reader at the current position in the new
    // mode's geometry (page for paged, scroll offset for continuous).
    repaginate(resetToFirstPage = true)
  }

  private fun isFocusMode(): Boolean {
    return readerRenderMode == "focus"
  }

  // Both continuous and focus modes lay the chapter out as one vertical scroll.
  private fun isVerticalLayoutMode(): Boolean {
    return readerRenderMode == "continuous" || readerRenderMode == "focus"
  }

  fun setReaderEdgeStateEnabled(enabled: Boolean) {
    if (readerEdgeStateEnabled == enabled) {
      return
    }

    readerEdgeStateEnabled = enabled
    chapterTransitionDirection = "none"
    if (pages.isNotEmpty()) {
      repaginate(resetToFirstPage = false)
    }
  }

  fun setHighlightTerms(terms: List<Any?>) {
    val nextTerms = normalizeHighlightTerms(terms)
    if (highlightTerms == nextTerms) {
      return
    }

    highlightTerms = nextTerms
    highlightMatcher = HighlightMatcher(nextTerms)
    rebuildSavedHighlightRanges()
    refreshEdgeStatesForCurrentPages()
  }

  fun setSameLevelTerms(terms: List<Any?>) {
    val nextTerms = normalizeHighlightTerms(terms)
    if (sameLevelTerms == nextTerms) {
      return
    }

    sameLevelTerms = nextTerms
    sameLevelMatcher = HighlightMatcher(nextTerms)
    rebuildLevelUnderlineRanges()
  }

  fun setAboveLevelTerms(terms: List<Any?>) {
    val nextTerms = normalizeHighlightTerms(terms)
    if (aboveLevelTerms == nextTerms) {
      return
    }

    aboveLevelTerms = nextTerms
    aboveLevelMatcher = HighlightMatcher(nextTerms)
    rebuildLevelUnderlineRanges()
  }

  fun setClearSelectionToken(token: Int) {
    if (lastClearSelectionToken == token) {
      return
    }

    lastClearSelectionToken = token
    clearActiveSelection(dispatchEvent = false)
  }

  private fun repaginate(resetToFirstPage: Boolean) {
    val windowSnapshot = chapterWindow.takeIf { it.isNotEmpty() }
      ?: currentChapterWindowFromBlocks()

    if (layoutWidth <= 0 || layoutHeight <= 0 || windowSnapshot.isEmpty()) {
      return
    }

    val generation = paginationGeneration + 1
    paginationGeneration = generation
    paginationTask?.cancel(true)

    val layoutWidthSnapshot = layoutWidth
    val layoutHeightSnapshot = layoutHeight
    val fontSizeSnapshot = readerFontSizeSp
    val lineHeightSnapshot = readerLineHeightMultiplier
    val isDarkSnapshot = readerTheme == "dark"
    val appContext = context.applicationContext ?: context
    val previousPages = pages
    val previousPage = pages.getOrNull(viewPager.currentItem)
    val previousLogicalPage = logicalPageForDisplayPosition(viewPager.currentItem)
    val transitionDirection = chapterTransitionDirection
    val backgroundColor = readerBackgroundColor()
    val themePaletteSnapshot = themePalette
    val renderModeSnapshot = readerRenderMode
    chapterTransitionDirection = "none"

    paginationTask = paginationExecutor.submit {
      val startedAt = SystemClock.elapsedRealtime()
      val paginationResult = try {
        val paginator = EpubPaginator(
          pageWidth = layoutWidthSnapshot,
          pageHeight = layoutHeightSnapshot,
          paddingH = pagePaddingH,
          paddingV = pagePaddingV,
          fontSizeSp = fontSizeSnapshot,
          lineHeightMult = lineHeightSnapshot,
          isDark = isDarkSnapshot,
          readerTextColor = themePaletteSnapshot.bodyTextColor,
          context = appContext
        )
        if (renderModeSnapshot == "continuous" || renderModeSnapshot == "focus") {
          buildContinuousChapterWindow(paginator, windowSnapshot)
        } else {
          paginateChapterWindow(paginator, windowSnapshot)
        }
      } catch (_: CancellationException) {
        return@submit
      }
      val elapsed = SystemClock.elapsedRealtime() - startedAt
      Log.d(
        TAG,
        "pagination done: generation=$generation chapters=${paginationResult.chapterCount} " +
          "pages=${paginationResult.pages.size} elapsedMs=$elapsed"
      )

      mainHandler.post {
        if (generation != paginationGeneration) {
          return@post
        }

        applyPaginatedPages(
          paginationResult = paginationResult,
          previousPages = previousPages,
          previousPage = previousPage,
          previousLogicalPage = previousLogicalPage,
          resetToFirstPage = resetToFirstPage,
          transitionDirection = transitionDirection,
          backgroundColor = backgroundColor,
          themePaletteSnapshot = themePaletteSnapshot
        )
      }
    }
  }

  private fun paginateChapterWindow(
    paginator: EpubPaginator,
    chapters: List<ChapterWindowItem>
  ): PaginationResult {
    val nextPages = mutableListOf<ReaderPage>()
    val ranges = mutableListOf<ChapterPageRange>()
    val totalSpineItems = bookManifest.intValue("totalSpineItems")
      ?: (chapters.maxOfOrNull { chapter -> chapter.spineIndex }?.plus(1) ?: 0)

    chapters.forEach { chapter ->
      val chapterPages = attachEdgeStateToChapterPages(
        pages = paginator.paginate(chapter.blocks),
        edgeState = edgeStateForChapter(chapter, totalSpineItems)
      )
      val pageCount = chapterPages.size
      val startIndex = nextPages.size

      chapterPages.forEachIndexed { localIndex, page ->
        nextPages.add(
          page.copy(
            pageIndex = nextPages.size,
            spineIndex = chapter.spineIndex,
            href = chapter.href,
            path = chapter.path,
            chapterPageIndex = localIndex,
            chapterPageCount = pageCount
          )
        )
      }

      ranges.add(
        ChapterPageRange(
          spineIndex = chapter.spineIndex,
          href = chapter.href,
          path = chapter.path,
          startIndex = startIndex,
          pageCount = pageCount
        )
      )
    }

    return PaginationResult(
      pages = nextPages.ifEmpty { listOf(ReaderPage(0, emptyList())) },
      ranges = ranges,
      chapterCount = chapters.size
    )
  }

  private fun buildContinuousChapterWindow(
    paginator: EpubPaginator,
    chapters: List<ChapterWindowItem>
  ): PaginationResult {
    val nextPages = mutableListOf<ReaderPage>()
    val ranges = mutableListOf<ChapterPageRange>()
    val totalSpineItems = bookManifest.intValue("totalSpineItems")
      ?: (chapters.maxOfOrNull { chapter -> chapter.spineIndex }?.plus(1) ?: 0)

    chapters.forEach { chapter ->
      val continuousPage = paginator
        .buildContinuousPage(chapter.blocks)
        .copy(edgeState = edgeStateForChapter(chapter, totalSpineItems))
      val startIndex = nextPages.size

      nextPages.add(
        continuousPage.copy(
          pageIndex = startIndex,
          spineIndex = chapter.spineIndex,
          href = chapter.href,
          path = chapter.path,
          chapterPageIndex = 0,
          chapterPageCount = 1
        )
      )

      ranges.add(
        ChapterPageRange(
          spineIndex = chapter.spineIndex,
          href = chapter.href,
          path = chapter.path,
          startIndex = startIndex,
          pageCount = 1
        )
      )
    }

    return PaginationResult(
      pages = nextPages.ifEmpty { listOf(ReaderPage(0, emptyList())) },
      ranges = ranges,
      chapterCount = chapters.size
    )
  }

  private fun attachEdgeStateToChapterPages(
    pages: List<ReaderPage>,
    edgeState: ReaderEdgeState?
  ): List<ReaderPage> {
    if (edgeState == null || pages.isEmpty()) {
      return pages
    }

    val lastPage = pages.last()
    val shouldUseSeparateEdgePage = (
      lastPage.blocks.isNotEmpty() &&
        renderedContentBottom(lastPage) > edgeContentTopLimit()
      )

    return if (shouldUseSeparateEdgePage) {
      pages + ReaderPage(
        pageIndex = pages.size,
        blocks = emptyList(),
        edgeState = edgeState
      )
    } else {
      pages.dropLast(1) + lastPage.copy(edgeState = edgeState)
    }
  }

  private fun edgeStateForChapter(
    chapter: ChapterWindowItem,
    totalSpineItems: Int
  ): ReaderEdgeState? {
    if (!readerEdgeStateEnabled) {
      return null
    }

    if (totalSpineItems <= 0) {
      return null
    }

    val isLastChapter = chapter.spineIndex >= totalSpineItems - 1
    if (!isLastChapter) {
      return null
    }

    val chapterTitle = chapter.title.ifBlank { "Chapter ${chapter.spineIndex + 1}" }
    val bookTitle = bookManifest.stringValue("title")
      ?: bookManifest.stringValue("currentBookTitle")
      ?: ""

    return ReaderEdgeState(
      kind = ReaderEdgeKind.BOOK_FINISHED,
      chapterTitle = chapterTitle,
      bookTitle = bookTitle.ifBlank { chapterTitle },
      chapterCount = totalSpineItems,
      savedWordCount = highlightTerms.size
    )
  }

  private fun renderedContentBottom(page: ReaderPage): Int {
    var yOffset = pagePaddingV

    page.blocks.forEach { block ->
      yOffset += block.marginTop
      yOffset += if (block.type == "image") {
        block.imageHeight
      } else {
        block.textLayout?.height ?: 0
      }
      yOffset += block.marginBottom
    }

    return yOffset
  }

  private fun edgeContentTopLimit(): Int {
    return (layoutHeight - dp(300f)).coerceAtLeast(pagePaddingV + dp(160f))
  }

  private fun currentChapterWindowFromBlocks(): List<ChapterWindowItem> {
    if (chapterBlocks.isEmpty()) {
      return emptyList()
    }

    val spineIndex = bookManifest.intValue("currentSpineIndex") ?: 0
    return listOf(
      ChapterWindowItem(
        role = "current",
        spineIndex = spineIndex,
        href = bookManifest.stringValue("currentSpineHref") ?: "",
        path = bookManifest.stringValue("currentSpinePath") ?: "",
        title = bookManifest.stringValue("currentChapterTitle")
          ?: bookManifest.stringValue("currentSpineTitle")
          ?: "",
        blocks = chapterBlocks.toList(),
        resources = chapterResources.toList(),
        signature = chapterBlocksSignature.ifBlank { signatureForBlocks(chapterBlocks) }
      )
    )
  }

  private fun currentWindowItem(chapters: List<ChapterWindowItem>): ChapterWindowItem? {
    return chapters.firstOrNull { chapter -> chapter.role == "current" }
      ?: bookManifest.intValue("currentSpineIndex")?.let { spineIndex ->
        chapters.firstOrNull { chapter -> chapter.spineIndex == spineIndex }
      }
  }

  private fun currentWindowItemSignature(chapters: List<ChapterWindowItem>): String {
    val current = currentWindowItem(chapters) ?: return ""
    return "${current.spineIndex}:${current.href}:${current.path}:${current.title}:${current.signature}"
  }

  private fun firstDisplayIndexForCurrentChapter(candidatePages: List<ReaderPage>): Int? {
    val currentSpineIndex = bookManifest.intValue("currentSpineIndex")
    if (currentSpineIndex != null) {
      candidatePages.indexOfFirst { page -> page.spineIndex == currentSpineIndex }
        .takeIf { it >= 0 }
        ?.let { return it }
    }

    return candidatePages.indices.firstOrNull()
  }

  private fun pageIndexForPreviousPage(
    candidatePages: List<ReaderPage>,
    previousPage: ReaderPage?,
    previousLogicalPage: Int
  ): Int {
    if (candidatePages.isEmpty()) {
      return 0
    }

    val previousSpineIndex = previousPage?.spineIndex
    if (previousSpineIndex != null) {
      val sameChapterPage = candidatePages.indexOfFirst { page ->
        page.spineIndex == previousSpineIndex &&
          page.chapterPageIndex == previousPage.chapterPageIndex
      }
      if (sameChapterPage >= 0) {
        return sameChapterPage
      }

      val firstBlockId = previousPage.blocks.firstOrNull()?.blockId
      if (!firstBlockId.isNullOrBlank()) {
        val blockMatch = candidatePages.indexOfFirst { page ->
          page.spineIndex == previousSpineIndex &&
            page.blocks.any { block -> block.blockId == firstBlockId }
        }
        if (blockMatch >= 0) {
          return blockMatch
        }
      }
    }

    val currentSpineIndex = bookManifest.intValue("currentSpineIndex")
    if (currentSpineIndex != null) {
      val sameLogicalPage = candidatePages.indexOfFirst { page ->
        page.spineIndex == currentSpineIndex &&
          page.chapterPageIndex == previousLogicalPage
      }
      if (sameLogicalPage >= 0) {
        return sameLogicalPage
      }
    }

    return previousLogicalPage.coerceIn(0, candidatePages.lastIndex)
  }

  private fun applyPaginatedPages(
    paginationResult: PaginationResult,
    previousPages: List<ReaderPage>,
    previousPage: ReaderPage?,
    previousLogicalPage: Int,
    resetToFirstPage: Boolean,
    transitionDirection: String,
    backgroundColor: Int,
    themePaletteSnapshot: ReaderThemePalette
  ) {
    val nextPages = paginationResult.pages
    val restorePage = pageIndexForRestorePosition(nextPages)
    val targetPage = restorePage
      ?: if (resetToFirstPage) {
        firstDisplayIndexForCurrentChapter(nextPages) ?: 0
      } else {
        pageIndexForPreviousPage(nextPages, previousPage, previousLogicalPage)
      }
    previousPageIndex = nextPages.getOrNull(targetPage)?.chapterPageIndex ?: targetPage
    userDraggedPager = false
    pageRanges = paginationResult.ranges
    val previousActiveSelectionRanges = activeSelectionRanges
    activeSelectionRanges = remapSelectionRangesForPages(activeSelectionRanges, nextPages)
    if (activeSelectionRanges.isEmpty()) {
      activeSelectionKind = null
    }
    val didDropActiveSelection = previousActiveSelectionRanges.isNotEmpty() && activeSelectionRanges.isEmpty()
    val savedHighlights = buildHighlightRanges(
      sourcePages = nextPages,
      matcher = highlightMatcher,
      label = "saved",
      collectContexts = true
    )
    savedHighlightRangesByPage = savedHighlights.rangesByPage
    savedHighlightContextsByPage = savedHighlights.contextsByPage
    sameLevelRangesByPage = buildHighlightRanges(nextPages, sameLevelMatcher, "same-level").rangesByPage
    aboveLevelRangesByPage = buildHighlightRanges(nextPages, aboveLevelMatcher, "above-level").rangesByPage

    if (isVerticalLayoutMode()) {
      pages = nextPages
      pagePositionOffset = 0
      continuousPageIndex = targetPage.coerceIn(0, pages.lastIndex.coerceAtLeast(0))
      bindContinuousPage(continuousPageIndex, backgroundColor, resetScroll = resetToFirstPage)
      if (isFocusMode()) {
        dispatchFocusPageChange()
      }
      // Continuous mode dispatches from scrollContinuousTo once the restored
      // scroll offset has been applied, so no page event is emitted here.
      if (didDropActiveSelection) {
        onSelectionCleared(mapOf<String, Any>())
      }
      return
    }

    val adapter = pageAdapter
    if (adapter == null) {
      pages = nextPages
      pagePositionOffset = 0
      pageAdapter = EpubPageAdapter(
        pages,
        pagePaddingH,
        pagePaddingV,
        readerLineHeightMultiplier,
        backgroundColor,
        themePaletteSnapshot,
        activeSelectionRanges,
        activeSelectionKind,
        savedHighlightRangesByPage,
        sameLevelRangesByPage,
        aboveLevelRangesByPage,
        activeHighlightColor,
        textSelectionHighlightColor,
        savedHighlightColor,
        savedHighlightTextColor,
        sameLevelUnderlineColor,
        aboveLevelUnderlineColor,
        ::handlePageWordSelected,
        ::handlePageTextSelected,
        ::handlePageSelectionCleared,
        ::handlePageSelectionDragStateChanged,
        ::handlePageEdgeAction
      )
      viewPager.adapter = pageAdapter
    } else {
      val canAnimateChapterTransition = (
        resetToFirstPage &&
        chapterWindow.isEmpty() &&
        previousPages.isNotEmpty() &&
        nextPages.isNotEmpty() &&
        (transitionDirection == "next" || transitionDirection == "previous")
      )

      if (canAnimateChapterTransition) {
        pages = nextPages
        adapter.updateActiveSelectionRanges(activeSelectionRanges, activeSelectionKind)
        adapter.updateSavedHighlightRanges(savedHighlightRangesByPage)
        adapter.updateLevelUnderlineRanges(sameLevelRangesByPage, aboveLevelRangesByPage)
        adapter.updateThemePalette(themePaletteSnapshot)
        adapter.updateHighlightColors(
          activeHighlightColor,
          textSelectionHighlightColor,
          savedHighlightColor,
          savedHighlightTextColor,
          sameLevelUnderlineColor,
          aboveLevelUnderlineColor
        )
        animateChapterTransition(
          adapter,
          previousPages,
          nextPages,
          transitionDirection,
          backgroundColor
        )
        if (didDropActiveSelection) {
          onSelectionCleared(mapOf<String, Any>())
        }
        return
      }

      pages = nextPages
      pagePositionOffset = 0
      adapter.updateActiveSelectionRanges(activeSelectionRanges, activeSelectionKind)
      adapter.updateSavedHighlightRanges(savedHighlightRangesByPage)
      adapter.updateLevelUnderlineRanges(sameLevelRangesByPage, aboveLevelRangesByPage)
      adapter.updateThemePalette(themePaletteSnapshot)
      adapter.updateHighlightColors(
        activeHighlightColor,
        textSelectionHighlightColor,
        savedHighlightColor,
        savedHighlightTextColor,
        sameLevelUnderlineColor,
        aboveLevelUnderlineColor
      )
      adapter.updateRenderConfig(readerLineHeightMultiplier, backgroundColor)
      adapter.updatePages(pages)
    }

    viewPager.setCurrentItem(targetPage, false)
    dispatchPageChange(targetPage, pages.size)
    if (didDropActiveSelection) {
      onSelectionCleared(mapOf<String, Any>())
    }
    forcePagerRefresh()
  }

  private fun animateChapterTransition(
    adapter: EpubPageAdapter,
    previousPages: List<ReaderPage>,
    nextPages: List<ReaderPage>,
    direction: String,
    backgroundColor: Int
  ) {
    val previousIndex = viewPager.currentItem
    val currentPageWasAtBoundary = when (direction) {
      "next" -> previousIndex >= previousPages.lastIndex
      "previous" -> previousIndex <= 0
      else -> false
    }

    if (!currentPageWasAtBoundary) {
      pagePositionOffset = 0
      adapter.updateRenderConfig(readerLineHeightMultiplier, backgroundColor)
      adapter.updatePages(nextPages)
      viewPager.setCurrentItem(0, false)
      forcePagerRefresh()
      return
    }

    val combinedPages: List<ReaderPage>
    val anchorPosition: Int
    val targetPosition: Int

    if (direction == "next") {
      combinedPages = previousPages + nextPages
      pagePositionOffset = previousPages.size
      anchorPosition = previousPages.lastIndex
      targetPosition = previousPages.size
    } else {
      combinedPages = nextPages + previousPages
      pagePositionOffset = 0
      anchorPosition = nextPages.size
      targetPosition = nextPages.lastIndex
    }

    Log.d(
      TAG,
      "chapter transition animation start: direction=$direction " +
        "previousPages=${previousPages.size} nextPages=${nextPages.size}"
    )
    isChapterTransitionAnimating = true
    suppressPageEvents = true
    adapter.updateRenderConfig(readerLineHeightMultiplier, backgroundColor)
    adapter.updatePages(combinedPages)
    viewPager.setCurrentItem(anchorPosition, false)
    suppressPageEvents = false

    post {
      viewPager.setCurrentItem(targetPosition, true)
      forcePagerRefresh()
    }
  }

  private fun forcePagerRefresh() {
    val currentItem = viewPager.currentItem
    viewPager.post {
      val initialRecyclerView = viewPager.getChildAt(0) as? RecyclerView

      if (
        layoutWidth > 0 &&
        layoutHeight > 0 &&
        (initialRecyclerView == null || initialRecyclerView.childCount == 0)
      ) {
        viewPager.measure(
          MeasureSpec.makeMeasureSpec(layoutWidth, MeasureSpec.EXACTLY),
          MeasureSpec.makeMeasureSpec(layoutHeight, MeasureSpec.EXACTLY)
        )
        viewPager.layout(0, 0, layoutWidth, layoutHeight)
      }

      val recyclerView = viewPager.getChildAt(0) as? RecyclerView
      pageAdapter?.rebindVisiblePages(recyclerView, currentItem)
    }
  }

  // Mirrors forcePagerRefresh for the continuous/focus scroll view: measure and
  // lay it out to the reader bounds so the ScrollView measures its content child
  // to the full (taller-than-viewport) height, establishing a real scroll range.
  private fun forceContinuousRefresh() {
    if (layoutWidth <= 0 || layoutHeight <= 0) {
      return
    }
    continuousScrollView.measure(
      MeasureSpec.makeMeasureSpec(layoutWidth, MeasureSpec.EXACTLY),
      MeasureSpec.makeMeasureSpec(layoutHeight, MeasureSpec.EXACTLY)
    )
    continuousScrollView.layout(0, 0, layoutWidth, layoutHeight)
  }

  private fun bindContinuousPage(
    position: Int,
    backgroundColor: Int,
    resetScroll: Boolean,
    scrollTarget: Int? = null,
    onScrollComplete: (() -> Unit)? = null
  ) {
    val page = pages.getOrNull(position) ?: ReaderPage(0, emptyList())
    continuousPageIndex = position
    val focusEnabled = isFocusMode()
    val focusTopInset = if (focusEnabled) (layoutHeight * FOCUS_TOP_INSET_RATIO).roundToInt() else 0
    val focusBottomInset = if (focusEnabled) (layoutHeight * FOCUS_BOTTOM_INSET_RATIO).roundToInt() else 0
    val contentHeight = (continuousContentHeightForPage(page) + focusTopInset + focusBottomInset)
      .coerceAtLeast(layoutHeight)
    continuousPageView.layoutParams = FrameLayout.LayoutParams(
      ViewGroup.LayoutParams.MATCH_PARENT,
      contentHeight
    )
    continuousPageView.minimumHeight = contentHeight
    // ExpoView doesn't lay out our children when only visibility/content changes,
    // so the continuous scroll view can be left unmeasured — its content child
    // never grows past the viewport and the scroll range stays 0 (up-swipes then
    // read as an edge pull → chapter end). Force a measure+layout here so vertical
    // scrolling and focus anchoring work without needing an external size change.
    forceContinuousRefresh()
    Log.d(
      TAG,
      "continuous render: page=$position blocks=${page.blocks.size} " +
        "contentHeight=$contentHeight viewportHeight=$layoutHeight focus=$focusEnabled"
    )
    continuousPageView.bind(
      page = page,
      paddingH = pagePaddingH,
      paddingV = pagePaddingV + focusTopInset,
      lineHeightMult = readerLineHeightMultiplier,
      backgroundColor = backgroundColor,
      themePalette = themePalette,
      activeSelectionRanges = activeSelectionRanges,
      activeSelectionKind = activeSelectionKind,
      savedHighlightRanges = savedHighlightRangesByPage[page.pageIndex].orEmpty(),
      sameLevelRanges = sameLevelRangesByPage[page.pageIndex].orEmpty(),
      aboveLevelRanges = aboveLevelRangesByPage[page.pageIndex].orEmpty(),
      activeHighlightColor = activeHighlightColor,
      textSelectionHighlightColor = textSelectionHighlightColor,
      savedHighlightColor = savedHighlightColor,
      savedHighlightTextColor = savedHighlightTextColor,
      sameLevelUnderlineColor = sameLevelUnderlineColor,
      aboveLevelUnderlineColor = aboveLevelUnderlineColor,
      onWordSelected = ::handlePageWordSelected,
      onTextSelected = ::handlePageTextSelected,
      onSelectionCleared = ::handlePageSelectionCleared,
      onSelectionDragStateChanged = ::handlePageSelectionDragStateChanged,
      onEdgeAction = ::handlePageEdgeAction,
      focusModeEnabled = focusEnabled,
      onFocusTextTapped = ::handleFocusTextTapped
    )

    if (focusEnabled) {
      val preservedAnchor = if (resetScroll) null else focusSentences.getOrNull(focusIndex)
      rebuildFocusSentences(page, pagePaddingV + focusTopInset)
      focusIndex = when {
        focusSentences.isEmpty() -> 0
        preservedAnchor != null -> (
          focusSentenceIndexAt(preservedAnchor.blockId, preservedAnchor.startOffset)
            ?: focusIndex.coerceIn(0, focusSentences.lastIndex)
        )
        else -> initialFocusIndexFromRestorePosition()
      }
      continuousScrollView.swipeNavigationEnabled = focusSwipeEnabled
      applyFocusHighlightToView(animate = false)
      anchorScrollToFocus(animated = false)
      dispatchFocusState()
      return
    }

    focusSentences = emptyList()
    continuousScrollView.swipeNavigationEnabled = false
    val maxScroll = (contentHeight - layoutHeight).coerceAtLeast(0)
    val resolvedScrollTarget = when {
      scrollTarget != null -> scrollTarget.coerceIn(0, maxScroll)
      resetScroll -> continuousRestoreScrollTarget(page, maxScroll) ?: 0
      else -> null
    }
    scrollContinuousTo(
      target = resolvedScrollTarget,
      // Chapter entries carry the saved-word contexts (mirrors the paged
      // dispatch); in-chapter rebinds (font size, highlights) skip them so
      // vocab exposure isn't recorded repeatedly.
      includeSavedHighlightsInDispatch = resetScroll || scrollTarget != null,
      onComplete = onScrollComplete
    )
  }

  // Applies a continuous-mode scroll offset once the freshly bound content has
  // been laid out (the height set in bindContinuousPage lands a layout pass
  // later), then reports the resulting position. This is the single source of
  // continuous-mode page events after a bind.
  private fun scrollContinuousTo(
    target: Int?,
    includeSavedHighlightsInDispatch: Boolean,
    onComplete: (() -> Unit)? = null,
    attempt: Int = 0
  ) {
    continuousScrollView.post {
      val expectedHeight = continuousPageView.layoutParams?.height ?: 0
      val childHeight = continuousScrollView.getChildAt(0)?.height ?: 0
      if (target != null && target > 0 && childHeight < expectedHeight && attempt < 3) {
        scrollContinuousTo(target, includeSavedHighlightsInDispatch, onComplete, attempt + 1)
        return@post
      }

      if (target != null) {
        val maxScroll = (childHeight.coerceAtLeast(expectedHeight) - layoutHeight).coerceAtLeast(0)
        suppressContinuousScrollEvents = true
        continuousScrollView.scrollTo(0, target.coerceIn(0, maxScroll))
        suppressContinuousScrollEvents = false
      }
      dispatchContinuousPageChange(includeSavedHighlightsInDispatch)
      onComplete?.invoke()
    }
  }

  // Maps a saved reader position onto a continuous-mode scroll offset. The
  // block anchor is preferred (stable across font size and render mode
  // changes); the page fraction is a coarse fallback for positions saved
  // without one.
  private fun continuousRestoreScrollTarget(page: ReaderPage, maxScroll: Int): Int? {
    val restoreSpineIndex = restorePosition.intValue("spineIndex") ?: return null
    if (restoreSpineIndex != page.spineIndex) {
      return null
    }

    val pageIndex = restorePosition.intValue("pageIndex")
    val pagesInChapter = restorePosition.intValue("pagesInChapter")
    if (
      pageIndex != null &&
      pagesInChapter != null &&
      pagesInChapter > 1 &&
      pageIndex >= pagesInChapter - 1
    ) {
      // Saved at the very end of the chapter (e.g. a backwards chapter pull).
      return maxScroll
    }

    restorePosition.stringValue("firstBlockId")?.takeIf { it.isNotBlank() }?.let { blockId ->
      continuousBlockTopOffset(page, blockId)?.let { blockTop ->
        return blockTop.coerceIn(0, maxScroll)
      }
    }

    if (pageIndex != null && pagesInChapter != null && pagesInChapter > 1) {
      val fraction = pageIndex.toFloat() / (pagesInChapter - 1)
      return (fraction * maxScroll).roundToInt().coerceIn(0, maxScroll)
    }

    return null
  }

  // ===== Focus (sentence beam) mode =====

  private fun rebuildFocusSentences(page: ReaderPage, topPadding: Int) {
    val sentences = mutableListOf<FocusSentenceInfo>()
    var yOffset = topPadding

    page.blocks.forEach { block ->
      yOffset += block.marginTop

      if (block.type == "image") {
        yOffset += block.imageHeight
      } else {
        val layout = block.textLayout
        if (layout != null) {
          val textLength = block.plainText.length
          block.sentenceRanges.forEach { range ->
            val start = range.first.coerceIn(0, textLength)
            val endExclusive = (range.last + 1).coerceIn(start, textLength)
            if (start < endExclusive) {
              val startLine = layout.getLineForOffset(start)
              val endLine = layout.getLineForOffset((endExclusive - 1).coerceAtLeast(start))
              sentences.add(
                FocusSentenceInfo(
                  blockId = block.blockId,
                  startOffset = start,
                  endOffset = endExclusive,
                  topY = yOffset + layout.getLineTop(startLine),
                  bottomY = yOffset + layout.getLineBottom(endLine)
                )
              )
            }
          }
          yOffset += layout.height
        }
      }

      yOffset += block.marginBottom
    }

    focusSentences = sentences
    Log.d(TAG, "focus sentences rebuilt: count=${sentences.size}")
  }

  private fun focusSentenceIndexAt(blockId: String, localOffset: Int): Int? {
    val containing = focusSentences.indexOfFirst { sentence ->
      sentence.blockId == blockId &&
        localOffset >= sentence.startOffset &&
        localOffset < sentence.endOffset
    }
    if (containing >= 0) {
      return containing
    }

    return focusSentences.indexOfFirst { it.blockId == blockId }.takeIf { it >= 0 }
  }

  private fun initialFocusIndexFromRestorePosition(): Int {
    val blockId = restorePosition.stringValue("firstBlockId")?.takeIf { it.isNotBlank() }
      ?: return 0
    return focusSentences.indexOfFirst { it.blockId == blockId }.takeIf { it >= 0 } ?: 0
  }

  private fun handleFocusTextTapped(blockId: String, localOffset: Int) {
    if (!isFocusMode() || focusSentences.isEmpty()) {
      return
    }

    val index = focusSentenceIndexAt(blockId, localOffset) ?: return
    focusTo(index, animate = true)
  }

  private fun focusTo(index: Int, animate: Boolean, fast: Boolean = false) {
    if (focusSentences.isEmpty()) {
      return
    }

    focusIndex = index.coerceIn(0, focusSentences.lastIndex)
    applyFocusHighlightToView(animate, fast)
    anchorScrollToFocus(animated = animate, fast = fast)
    dispatchFocusState()
    dispatchFocusPageChange()
  }

  private fun moveFocus(direction: Int) {
    if (!isFocusMode() || focusSentences.isEmpty()) {
      return
    }

    val maxIndex = (focusSentences.size - focusSpanCount).coerceAtLeast(0)
    val next = focusIndex + direction
    if (next < 0) {
      onChapterStart(mapOf<String, Any>())
      return
    }
    if (next > maxIndex) {
      onChapterEnd(mapOf<String, Any>())
      return
    }

    val now = SystemClock.uptimeMillis()
    val rapid = now - lastFocusMoveAtMs < FOCUS_RAPID_NAV_WINDOW_MS
    lastFocusMoveAtMs = now

    clearActiveSelection(dispatchEvent = true, forceEvent = true)
    focusTo(next, animate = true, fast = rapid)
  }

  fun focusNav(direction: String) {
    when (direction.lowercase()) {
      "next" -> moveFocus(1)
      "prev", "previous" -> moveFocus(-1)
    }
  }

  private fun applyFocusHighlightToView(animate: Boolean, fast: Boolean = false) {
    if (focusSentences.isEmpty()) {
      continuousPageView.setFocusHighlight(emptyList(), animate = false)
      return
    }

    val start = focusIndex.coerceIn(0, focusSentences.lastIndex)
    val end = (start + focusSpanCount).coerceAtMost(focusSentences.size)
    val ranges = focusSentences.subList(start, end).map { sentence ->
      FocusRange(sentence.blockId, sentence.startOffset, sentence.endOffset)
    }
    continuousPageView.setFocusHighlight(ranges, animate, fast)
  }

  private fun anchorScrollToFocus(animated: Boolean, fast: Boolean = false) {
    val sentence = focusSentences.getOrNull(focusIndex) ?: return
    val contentHeight = continuousPageView.layoutParams?.height ?: 0
    val maxScroll = (contentHeight - layoutHeight).coerceAtLeast(0)
    val target = (sentence.topY - (layoutHeight * FOCUS_ANCHOR_RATIO)).roundToInt()
      .coerceIn(0, maxScroll)

    focusScrollAnimator?.cancel()
    if (!animated) {
      continuousScrollView.post {
        continuousScrollView.scrollTo(0, target)
      }
      return
    }

    val from = continuousScrollView.scrollY
    if (abs(target - from) < 2) {
      continuousScrollView.scrollTo(0, target)
      return
    }

    focusScrollAnimator = ValueAnimator.ofInt(from, target).apply {
      duration = if (fast) FOCUS_SCROLL_FAST_DURATION_MS else FOCUS_SCROLL_DURATION_MS
      interpolator = PathInterpolator(0.33f, 1f, 0.68f, 1f)
      addUpdateListener { animator ->
        continuousScrollView.scrollTo(0, animator.animatedValue as Int)
      }
      start()
    }
  }

  private fun dispatchFocusState() {
    onFocusSentenceChange(
      mapOf(
        "index" to focusIndex,
        "count" to focusSpanCount,
        "total" to focusSentences.size
      )
    )
  }

  // Reading-progress event for focus mode: sentence index stands in for the
  // page and the focused sentence's block anchors position restore across
  // render modes.
  private fun dispatchFocusPageChange() {
    val page = pages.getOrNull(continuousPageIndex)
    val sentence = focusSentences.getOrNull(focusIndex)
    val href = page?.href?.takeIf { it.isNotBlank() }
      ?: page?.path?.takeIf { it.isNotBlank() }
      ?: bookManifest.stringValue("currentSpineHref")?.takeIf { it.isNotBlank() }
      ?: bookManifest.stringValue("currentSpinePath")
      ?: ""
    val event = mutableMapOf<String, Any>(
      "page" to focusIndex,
      "total" to focusSentences.size.coerceAtLeast(1),
      "globalPage" to continuousPageIndex,
      "globalTotal" to pages.size,
      "href" to href,
      "firstBlockId" to (sentence?.blockId ?: page?.blocks?.firstOrNull()?.blockId ?: ""),
      "savedHighlights" to (page?.pageIndex?.let { savedHighlightContextsByPage[it] }.orEmpty())
    )

    (page?.spineIndex ?: bookManifest.intValue("currentSpineIndex"))?.let { spineIndex ->
      event["spineIndex"] = spineIndex
    }

    onPageChange(event)
  }

  fun setFocusSentenceCount(count: Int) {
    val next = count.coerceIn(1, 5)
    if (focusSpanCount == next) {
      return
    }

    focusSpanCount = next
    if (isFocusMode() && focusSentences.isNotEmpty()) {
      focusIndex = focusIndex.coerceAtMost((focusSentences.size - focusSpanCount).coerceAtLeast(0))
      applyFocusHighlightToView(animate = true)
      anchorScrollToFocus(animated = true)
      dispatchFocusState()
    }
  }

  fun setFocusSwipeEnabled(enabled: Boolean) {
    focusSwipeEnabled = enabled
    continuousScrollView.swipeNavigationEnabled = enabled && isFocusMode()
  }

  fun setFocusNavToken(token: String) {
    if (token == lastFocusNavToken) {
      return
    }

    // The first token delivered is the mount-time prop value; acting on it
    // would replay a stale navigation after a view remount.
    val isInitialToken = lastFocusNavToken == null
    lastFocusNavToken = token
    if (isInitialToken) {
      return
    }

    when (token.substringBefore(":").lowercase()) {
      "next" -> moveFocus(1)
      "prev", "previous" -> moveFocus(-1)
    }
  }

  fun setFocusPanelHeight(heightDp: Double) {
    val nextLiftPx = (heightDp * resources.displayMetrics.density).toFloat().coerceAtLeast(0f)
    continuousPageView.focusPanelOpen = isFocusMode() && nextLiftPx > 0f
    if (focusPanelLiftPx == nextLiftPx) {
      return
    }

    focusPanelLiftPx = nextLiftPx
    updateFocusLift(animated = true)
  }

  // Lifts the reading surface so the anchored sentence clears the dictionary
  // panel; the scroll position itself stays put, matching the design's
  // transform-based lift.
  private fun updateFocusLift(animated: Boolean) {
    val target = if (isFocusMode()) -focusPanelLiftPx else 0f
    continuousPageView.animate().cancel()
    if (!animated) {
      continuousPageView.translationY = target
      return
    }

    continuousPageView.animate()
      .translationY(target)
      .setDuration(FOCUS_PANEL_LIFT_DURATION_MS)
      .setInterpolator(PathInterpolator(0.22f, 0.61f, 0.36f, 1f))
      .start()
  }

  private fun continuousContentHeightForPage(page: ReaderPage): Int {
    var contentHeight = pagePaddingV * 2

    page.blocks.forEach { block ->
      contentHeight += block.marginTop
      contentHeight += if (block.type == "image") {
        block.imageHeight
      } else {
        block.textLayout?.height ?: 0
      }
      contentHeight += block.marginBottom
    }

    if (page.edgeState != null) {
      contentHeight = contentHeight.coerceAtLeast(layoutHeight + dp(220f))
    }

    return contentHeight
  }

  // ===== Continuous (vertical scroll) mode =====

  private fun handleContinuousScrollChanged() {
    if (readerRenderMode != "continuous" || suppressContinuousScrollEvents || pages.isEmpty()) {
      return
    }

    mainHandler.removeCallbacks(continuousScrollDispatchRunnable)
    mainHandler.postDelayed(continuousScrollDispatchRunnable, CONTINUOUS_SCROLL_DISPATCH_DELAY_MS)
  }

  private fun handleContinuousEdgePull(direction: Int) {
    if (readerRenderMode != "continuous" || pages.isEmpty()) {
      return
    }

    val targetIndex = continuousPageIndex + direction
    val targetPage = pages.getOrNull(targetIndex)
    if (targetPage == null) {
      // No adjacent chapter in the window: let JS decide what comes next
      // (load a chapter outside the window, or finish the book).
      if (direction > 0) {
        onChapterEnd(mapOf<String, Any>())
      } else {
        onChapterStart(mapOf<String, Any>())
      }
      return
    }

    Log.d(
      TAG,
      "continuous edge pull: direction=$direction targetSpine=${targetPage.spineIndex ?: -1}"
    )
    clearActiveSelection(dispatchEvent = true, forceEvent = true)
    bindContinuousPage(
      position = targetIndex,
      backgroundColor = readerBackgroundColor(),
      resetScroll = false,
      // Land at the top when moving forward, at the end when moving back.
      scrollTarget = if (direction > 0) 0 else Int.MAX_VALUE,
      onScrollComplete = { flushContinuousChapterCommit(direction) }
    )
  }

  private fun flushContinuousChapterCommit(direction: Int) {
    val page = pages.getOrNull(continuousPageIndex) ?: return
    val nextSpineIndex = page.spineIndex ?: return
    if (committedSpineIndex == nextSpineIndex) {
      return
    }

    committedSpineIndex = nextSpineIndex
    Log.d(TAG, "continuous chapter commit: direction=$direction spine=$nextSpineIndex")
    onChapterCommit(
      mapOf(
        "spineIndex" to nextSpineIndex,
        "href" to page.href,
        "path" to page.path,
        "pageIndex" to continuousVirtualPageIndex(),
        "pagesInChapter" to continuousVirtualPageCount(),
        "firstBlockId" to firstVisibleBlockId(page, continuousScrollView.scrollY),
        "direction" to if (direction > 0) "next" else "previous"
      )
    )
  }

  // Continuous mode has no fixed pages, so scroll progress is reported as
  // virtual viewport-height pages. JS consumes them exactly like paged-mode
  // page numbers for the progress bar, cloud sync, and position restore.
  private fun continuousVirtualPageCount(): Int {
    if (layoutHeight <= 0) {
      return 1
    }
    val contentHeight = continuousPageView.layoutParams?.height ?: 0
    return ceil(contentHeight.toDouble() / layoutHeight).toInt().coerceAtLeast(1)
  }

  private fun continuousVirtualPageIndex(): Int {
    val contentHeight = continuousPageView.layoutParams?.height ?: 0
    val maxScroll = (contentHeight - layoutHeight).coerceAtLeast(0)
    val pageCount = continuousVirtualPageCount()
    if (maxScroll <= 0 || pageCount <= 1) {
      return 0
    }

    val fraction = continuousScrollView.scrollY.toFloat() / maxScroll
    return (fraction * (pageCount - 1)).roundToInt().coerceIn(0, pageCount - 1)
  }

  private fun dispatchContinuousPageChange(includeSavedHighlights: Boolean) {
    if (readerRenderMode != "continuous") {
      return
    }

    val page = pages.getOrNull(continuousPageIndex) ?: return
    val href = page.href.takeIf { it.isNotBlank() }
      ?: page.path.takeIf { it.isNotBlank() }
      ?: bookManifest.stringValue("currentSpineHref")?.takeIf { it.isNotBlank() }
      ?: bookManifest.stringValue("currentSpinePath")
      ?: ""
    val savedHighlights = if (includeSavedHighlights) {
      savedHighlightContextsByPage[page.pageIndex].orEmpty()
    } else {
      emptyList()
    }
    val event = mutableMapOf<String, Any>(
      "page" to continuousVirtualPageIndex(),
      "total" to continuousVirtualPageCount(),
      "globalPage" to continuousPageIndex,
      "globalTotal" to pages.size,
      "href" to href,
      "firstBlockId" to firstVisibleBlockId(page, continuousScrollView.scrollY),
      "savedHighlights" to savedHighlights
    )

    (page.spineIndex ?: bookManifest.intValue("currentSpineIndex"))?.let { spineIndex ->
      event["spineIndex"] = spineIndex
    }

    onPageChange(event)
  }

  // Topmost block still visible at the given scroll offset — the position
  // anchor for continuous mode, mirroring what the first block of a paged
  // page provides.
  private fun firstVisibleBlockId(page: ReaderPage, scrollY: Int): String {
    var yOffset = pagePaddingV
    for (block in page.blocks) {
      yOffset += block.marginTop
      val blockHeight = if (block.type == "image") {
        block.imageHeight
      } else {
        block.textLayout?.height ?: 0
      }
      if (yOffset + blockHeight > scrollY) {
        return block.blockId
      }
      yOffset += blockHeight
      yOffset += block.marginBottom
    }

    return page.blocks.firstOrNull()?.blockId ?: ""
  }

  // Content offset of a block's top edge. Restoring to exactly this offset
  // makes firstVisibleBlockId report the same block back, so restore events
  // round-trip without drifting.
  private fun continuousBlockTopOffset(page: ReaderPage, blockId: String): Int? {
    var yOffset = pagePaddingV
    for (block in page.blocks) {
      yOffset += block.marginTop
      if (block.blockId == blockId) {
        return yOffset
      }
      yOffset += if (block.type == "image") {
        block.imageHeight
      } else {
        block.textLayout?.height ?: 0
      }
      yOffset += block.marginBottom
    }

    return null
  }

  private fun handlePageWordSelected(hit: WordHit) {
    activeSelectionRanges = listOf(hit.range)
    activeSelectionKind = ActiveSelectionKind.WORD
    pageAdapter?.updateActiveSelectionRanges(activeSelectionRanges, activeSelectionKind)
    invalidateVisiblePageHighlights()

    val event = mutableMapOf<String, Any>(
      "text" to hit.text,
      "placement" to hit.placement,
      "pageIndex" to hit.range.pageIndex,
      "blockId" to hit.range.blockId,
      "sourceStartOffset" to hit.range.sourceStartOffset,
      "sourceEndOffset" to hit.range.sourceEndOffset,
      "localStartOffset" to hit.localStartOffset,
      "localEndOffset" to hit.localEndOffset,
      "sentence" to hit.sentence
    )
    hit.range.spineIndex?.let { spineIndex ->
      event["spineIndex"] = spineIndex
    }

    onWordSelected(event)
  }

  private fun handlePageTextSelected(selection: TextSelectionHit) {
    activeSelectionRanges = selection.ranges
    activeSelectionKind = ActiveSelectionKind.TEXT
    pageAdapter?.updateActiveSelectionRanges(activeSelectionRanges, activeSelectionKind)
    invalidateVisiblePageHighlights()

    val event = mutableMapOf<String, Any>(
      "text" to selection.text,
      "placement" to selection.placement,
      "ranges" to selection.ranges.map { range -> rangeEventMap(range) }
    )
    selection.ranges.firstOrNull()?.let { firstRange ->
      event["pageIndex"] = firstRange.pageIndex
      event["blockId"] = firstRange.blockId
      event["sourceStartOffset"] = firstRange.sourceStartOffset
      event["sourceEndOffset"] = firstRange.sourceEndOffset
      firstRange.spineIndex?.let { spineIndex ->
        event["spineIndex"] = spineIndex
      }
    }

    onTextSelected(event)
  }

  private fun handlePageSelectionCleared() {
    clearActiveSelection(dispatchEvent = true, forceEvent = true)
  }

  private fun handlePageSelectionDragStateChanged(isDraggingSelection: Boolean) {
    viewPager.isUserInputEnabled = !isDraggingSelection
    continuousScrollView.requestDisallowInterceptTouchEvent(isDraggingSelection)
  }

  private fun handlePageEdgeAction(kind: ReaderEdgeKind) {
    clearActiveSelection(dispatchEvent = true)
    when (kind) {
      ReaderEdgeKind.BOOK_FINISHED -> onChapterEnd(mapOf<String, Any>())
    }
  }

  private fun clearActiveSelection(dispatchEvent: Boolean, forceEvent: Boolean = false) {
    val hadSelection = activeSelectionRanges.isNotEmpty()
    activeSelectionRanges = emptyList()
    activeSelectionKind = null
    pageAdapter?.updateActiveSelectionRanges(activeSelectionRanges, activeSelectionKind)
    invalidateVisiblePageHighlights()
    viewPager.isUserInputEnabled = true
    continuousScrollView.requestDisallowInterceptTouchEvent(false)

    if (dispatchEvent && (hadSelection || forceEvent)) {
      onSelectionCleared(mapOf<String, Any>())
    }
  }

  private fun rangeEventMap(range: TextRange): Map<String, Any> {
    val event = mutableMapOf<String, Any>(
      "pageIndex" to range.pageIndex,
      "blockId" to range.blockId,
      "sourceStartOffset" to range.sourceStartOffset,
      "sourceEndOffset" to range.sourceEndOffset
    )
    range.spineIndex?.let { spineIndex ->
      event["spineIndex"] = spineIndex
    }
    return event
  }

  private fun invalidateVisiblePageHighlights() {
    pageAdapter?.invalidateVisiblePages(recyclerView(), viewPager.currentItem)
    if (isVerticalLayoutMode()) {
      val page = pages.getOrNull(continuousPageIndex) ?: return
      continuousPageView.updateHighlights(
        activeSelectionRanges = activeSelectionRanges,
        activeSelectionKind = activeSelectionKind,
        savedHighlightRanges = savedHighlightRangesByPage[page.pageIndex].orEmpty(),
        sameLevelRanges = sameLevelRangesByPage[page.pageIndex].orEmpty(),
        aboveLevelRanges = aboveLevelRangesByPage[page.pageIndex].orEmpty(),
        activeHighlightColor = activeHighlightColor,
        textSelectionHighlightColor = textSelectionHighlightColor,
        savedHighlightColor = savedHighlightColor,
        savedHighlightTextColor = savedHighlightTextColor,
        sameLevelUnderlineColor = sameLevelUnderlineColor,
        aboveLevelUnderlineColor = aboveLevelUnderlineColor
      )
    }
  }

  private fun recyclerView(): RecyclerView? {
    return viewPager.getChildAt(0) as? RecyclerView
  }

  private fun rebuildSavedHighlightRanges() {
    val savedHighlights = buildHighlightRanges(
      sourcePages = pages,
      matcher = highlightMatcher,
      label = "saved",
      collectContexts = true
    )
    savedHighlightRangesByPage = savedHighlights.rangesByPage
    savedHighlightContextsByPage = savedHighlights.contextsByPage
    pageAdapter?.updateSavedHighlightRanges(savedHighlightRangesByPage)
    invalidateVisiblePageHighlights()
  }

  private fun rebuildLevelUnderlineRanges() {
    sameLevelRangesByPage = buildHighlightRanges(pages, sameLevelMatcher, "same-level").rangesByPage
    aboveLevelRangesByPage = buildHighlightRanges(pages, aboveLevelMatcher, "above-level").rangesByPage
    pageAdapter?.updateLevelUnderlineRanges(sameLevelRangesByPage, aboveLevelRangesByPage)
    invalidateVisiblePageHighlights()
  }

  private fun refreshEdgeStatesForCurrentPages() {
    if (pages.isEmpty() || pages.none { page -> page.edgeState != null }) {
      return
    }

    val windowSnapshot = chapterWindow.takeIf { it.isNotEmpty() }
      ?: currentChapterWindowFromBlocks()
    if (windowSnapshot.isEmpty()) {
      return
    }

    val totalSpineItems = bookManifest.intValue("totalSpineItems")
      ?: (windowSnapshot.maxOfOrNull { chapter -> chapter.spineIndex }?.plus(1) ?: 0)
    val edgeStateBySpine = windowSnapshot
      .mapNotNull { chapter ->
        edgeStateForChapter(chapter, totalSpineItems)?.let { edgeState ->
          chapter.spineIndex to edgeState
        }
      }
      .toMap()

    var changed = false
    val nextPages = pages.map { page ->
      if (page.edgeState == null) {
        return@map page
      }

      val nextEdgeState = page.spineIndex?.let { spineIndex -> edgeStateBySpine[spineIndex] }
        ?: return@map page
      if (nextEdgeState == page.edgeState) {
        page
      } else {
        changed = true
        page.copy(edgeState = nextEdgeState)
      }
    }

    if (!changed) {
      return
    }

    pages = nextPages
    pageAdapter?.updatePages(pages)
    if (isVerticalLayoutMode()) {
      bindContinuousPage(continuousPageIndex, readerBackgroundColor(), resetScroll = false)
    }
  }

  private fun buildHighlightRanges(
    sourcePages: List<ReaderPage>,
    matcher: HighlightMatcher,
    label: String,
    collectContexts: Boolean = false
  ): HighlightBuildResult {
    if (sourcePages.isEmpty() || matcher.termCount == 0) {
      Log.d(
        TAG,
        "$label highlight ranges built: terms=${matcher.termCount} pages=${sourcePages.size} matches=0"
      )
      return HighlightBuildResult(emptyMap())
    }

    val rangesByPage = mutableMapOf<Int, MutableList<TextRange>>()
    val contextsByPage = mutableMapOf<Int, MutableList<Map<String, Any>>>()

    sourcePages.forEach { page ->
      val pageRanges = mutableListOf<TextRange>()
      val pageContexts = mutableListOf<Map<String, Any>>()
      val seenContextKeys = mutableSetOf<String>()

      page.blocks.forEach blockLoop@{ block ->
        if (block.type != "text") {
          return@blockLoop
        }

        val text = block.plainText.ifEmpty { block.styledText?.toString() ?: "" }
        if (text.isEmpty()) {
          return@blockLoop
        }

        val occupiedLocalRanges = mutableListOf<Pair<Int, Int>>()

        matcher.find(text).forEach { match ->
          if (
            hasTokenBoundary(text, match.term, match.start, match.end) &&
            !overlapsAny(occupiedLocalRanges, match.start, match.end)
          ) {
            occupiedLocalRanges.add(match.start to match.end)
            pageRanges.add(
              TextRange(
                pageIndex = page.pageIndex,
                spineIndex = page.spineIndex,
                blockId = block.blockId,
                sourceStartOffset = block.sourceStartOffset + match.start,
                sourceEndOffset = block.sourceStartOffset + match.end
              )
            )

            if (collectContexts) {
              val sentence = sentenceForOffsets(text, match.start, match.end)
              val key = "${match.term}|${sentence}|${block.blockId}"
              if (!seenContextKeys.contains(key)) {
                seenContextKeys.add(key)
                pageContexts.add(
                  mapOf(
                    "text" to match.term,
                    "sentence" to sentence,
                    "blockId" to block.blockId
                  )
                )
              }
            }
          }
        }
      }

      if (pageRanges.isNotEmpty()) {
        rangesByPage[page.pageIndex] = pageRanges
          .sortedWith(compareBy<TextRange> { it.blockId }
            .thenBy { it.sourceStartOffset }
          .thenBy { it.sourceEndOffset })
          .toMutableList()
      }

      if (pageContexts.isNotEmpty()) {
        contextsByPage[page.pageIndex] = pageContexts
      }
    }

    val matchCount = rangesByPage.values.sumOf { ranges -> ranges.size }
    Log.d(
      TAG,
      "$label highlight ranges built: terms=${matcher.termCount} pages=${sourcePages.size} matches=$matchCount"
    )

    return HighlightBuildResult(rangesByPage, contextsByPage)
  }

  private fun sentenceForOffsets(text: String, startOffset: Int, endOffset: Int): String {
    if (text.isBlank()) {
      return ""
    }

    val safeStart = startOffset.coerceIn(0, text.length)
    val safeEnd = endOffset.coerceIn(safeStart, text.length)
    val sentenceBoundaries = setOf('.', '!', '?', '。', '！', '？', '\n')
    var start = safeStart
    var end = safeEnd

    while (start > 0 && !sentenceBoundaries.contains(text[start - 1])) {
      start -= 1
    }

    while (end < text.length && !sentenceBoundaries.contains(text[end])) {
      end += 1
    }

    if (end < text.length && sentenceBoundaries.contains(text[end]) && text[end] != '\n') {
      end += 1
    }

    return text.substring(start, end).trim().ifBlank { text.trim() }
  }

  private fun normalizeHighlightTerms(terms: List<Any?>): List<String> {
    return terms
      .mapNotNull { term -> (term as? String)?.trim()?.takeIf { it.isNotEmpty() } }
      .distinct()
      .sortedWith(compareByDescending<String> { it.length }.thenBy { it })
  }

  private fun hasTokenBoundary(
    text: String,
    term: String,
    start: Int,
    end: Int
  ): Boolean {
    val startsWithToken = term.firstOrNull()?.let { isReaderTokenChar(it) } == true
    val endsWithToken = term.lastOrNull()?.let { isReaderTokenChar(it) } == true
    val startsWithCjk = term.firstOrNull()?.let { isCjkIdeograph(it) } == true
    val endsWithCjk = term.lastOrNull()?.let { isCjkIdeograph(it) } == true

    if (startsWithToken && !startsWithCjk && start > 0 && isReaderTokenChar(text[start - 1])) {
      return false
    }

    if (endsWithToken && !endsWithCjk && end < text.length && isReaderTokenChar(text[end])) {
      return false
    }

    return true
  }

  private fun overlapsAny(ranges: List<Pair<Int, Int>>, start: Int, end: Int): Boolean {
    return ranges.any { (rangeStart, rangeEnd) ->
      start < rangeEnd && end > rangeStart
    }
  }

  private fun remapSelectionRangesForPages(
    selectionRanges: List<TextRange>,
    candidatePages: List<ReaderPage>
  ): List<TextRange> {
    if (selectionRanges.isEmpty()) {
      return emptyList()
    }

    return selectionRanges.mapNotNull { selection ->
      candidatePages.forEach pageLoop@{ page ->
        if (page.spineIndex != selection.spineIndex) {
          return@pageLoop
        }

        page.blocks.forEach blockLoop@{ block ->
          if (block.type != "text" || block.blockId != selection.blockId) {
            return@blockLoop
          }

          val blockTextLength = block.plainText.ifEmpty { block.styledText?.toString() ?: "" }.length
          val blockStart = block.sourceStartOffset
          val blockEnd = blockStart + blockTextLength
          val intersects = selection.sourceStartOffset < blockEnd &&
            selection.sourceEndOffset > blockStart

          if (intersects) {
            return@mapNotNull selection.copy(pageIndex = page.pageIndex)
          }
        }
      }

      null
    }
  }

  private fun updateHighlightColorsForTheme() {
    activeHighlightColor = themePalette.activeHighlightColor
    textSelectionHighlightColor = themePalette.textSelectionHighlightColor
    savedHighlightColor = themePalette.savedHighlightColor
    savedHighlightTextColor = themePalette.savedHighlightTextColor
    sameLevelUnderlineColor = themePalette.sameLevelUnderlineColor
    aboveLevelUnderlineColor = themePalette.aboveLevelUnderlineColor

    pageAdapter?.updateThemePalette(themePalette)
    pageAdapter?.updateHighlightColors(
      activeHighlightColor,
      textSelectionHighlightColor,
      savedHighlightColor,
      savedHighlightTextColor,
      sameLevelUnderlineColor,
      aboveLevelUnderlineColor
    )
    invalidateVisiblePageHighlights()
  }

  private fun trackEdgeSwipe(event: MotionEvent) {
    if (isChapterTransitionAnimating) {
      return
    }

    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        dragStartPage = viewPager.currentItem
        dragStartX = event.x
        dragLatestX = event.x
        pendingEdgeNavigation = null
      }
      MotionEvent.ACTION_MOVE -> {
        dragLatestX = event.x
      }
      MotionEvent.ACTION_UP,
      MotionEvent.ACTION_CANCEL -> {
        dragLatestX = event.x
        val total = pages.size
        val startPage = dragStartPage
        val deltaX = dragLatestX - dragStartX

        if (total > 0 && startPage == viewPager.currentItem && abs(deltaX) > touchSlop) {
          pendingEdgeNavigation = when {
            startPage == total - 1 && deltaX < -touchSlop -> "end"
            startPage == 0 && deltaX > touchSlop -> "start"
            else -> null
          }
          pendingEdgeNavigation?.let { direction ->
            Log.d(
              TAG,
              "edge swipe detected: direction=$direction page=$startPage total=$total " +
                "deltaX=$deltaX"
            )
          }
        }

        dragStartPage = -1
        post {
          if (viewPager.scrollState == ViewPager2.SCROLL_STATE_IDLE) {
            flushPendingEdgeNavigation()
          }
        }
      }
    }
  }

  private fun flushPendingEdgeNavigation() {
    when (pendingEdgeNavigation) {
      "end" -> onChapterEnd(mapOf<String, Any>())
      "start" -> onChapterStart(mapOf<String, Any>())
    }
    pendingEdgeNavigation = null
    userDraggedPager = false
  }

  private fun flushChapterCommitIfNeeded() {
    val displayIndex = viewPager.currentItem
    val page = pages.getOrNull(displayIndex) ?: return
    val nextSpineIndex = page.spineIndex ?: return
    val previousSpineIndex = committedSpineIndex

    if (previousSpineIndex == nextSpineIndex) {
      return
    }

    val direction = when {
      previousSpineIndex == null -> "none"
      nextSpineIndex > previousSpineIndex -> "next"
      nextSpineIndex < previousSpineIndex -> "previous"
      else -> "none"
    }
    committedSpineIndex = nextSpineIndex

    Log.d(
      TAG,
      "chapter commit: direction=$direction spine=$nextSpineIndex " +
        "page=${page.chapterPageIndex}/${page.chapterPageCount}"
    )
    onChapterCommit(
      mapOf(
        "spineIndex" to nextSpineIndex,
        "href" to page.href,
        "path" to page.path,
        "pageIndex" to page.chapterPageIndex,
        "pagesInChapter" to page.chapterPageCount,
        "firstBlockId" to (page.blocks.firstOrNull()?.blockId ?: ""),
        "direction" to direction
      )
    )
  }

  private fun finishChapterTransitionIfNeeded() {
    if (!isChapterTransitionAnimating) {
      return
    }

    val logicalPage = logicalPageForDisplayPosition(viewPager.currentItem)
    val adapter = pageAdapter ?: return

    isChapterTransitionAnimating = false
    pagePositionOffset = 0
    suppressPageEvents = true
    adapter.updatePages(pages)
    viewPager.setCurrentItem(logicalPage, false)
    suppressPageEvents = false
    previousPageIndex = logicalPage
    dispatchPageChange(logicalPage, pages.size)
  }

  private fun applyRestorePositionToCurrentPagesIfPossible() {
    if (pages.isEmpty() || isChapterTransitionAnimating) {
      return
    }

    if (isVerticalLayoutMode()) {
      val targetChapterPage = pageIndexForRestorePosition(pages) ?: return
      if (targetChapterPage == continuousPageIndex) {
        // In-chapter restore echoes (JS refreshes the prop on every page
        // event) must not yank the scroll position mid-read.
        return
      }

      bindContinuousPage(targetChapterPage, readerBackgroundColor(), resetScroll = true)
      if (isFocusMode()) {
        dispatchFocusPageChange()
      }
      return
    }

    val targetPage = pageIndexForRestorePosition(pages) ?: return
    if (targetPage == viewPager.currentItem) {
      return
    }

    suppressPageEvents = true
    previousPageIndex = pages.getOrNull(targetPage)?.chapterPageIndex ?: targetPage
    viewPager.setCurrentItem(targetPage, false)
    suppressPageEvents = false
    dispatchPageChange(targetPage, pages.size)
    forcePagerRefresh()
  }

  private fun pageIndexForRestorePosition(candidatePages: List<ReaderPage>): Int? {
    if (candidatePages.isEmpty()) {
      return null
    }

    val restoreSpineIndex = restorePosition.intValue("spineIndex") ?: return null
    val currentSpineIndex = bookManifest.intValue("currentSpineIndex")
    if (currentSpineIndex != null && restoreSpineIndex != currentSpineIndex) {
      return null
    }

    val requestedPageIndex = restorePosition.intValue("pageIndex")
    val requestedFirstBlockId = restorePosition.stringValue("firstBlockId")
      ?.takeIf { it.isNotBlank() }

    val matchingChapterPages = candidatePages
      .mapIndexedNotNull { index, page ->
        if (page.spineIndex == restoreSpineIndex) index to page else null
      }

    if (matchingChapterPages.isEmpty()) {
      return null
    }

    if (requestedPageIndex != null && requestedPageIndex in matchingChapterPages.indices) {
      val (displayIndex, requestedPage) = matchingChapterPages[requestedPageIndex]
      if (
        requestedFirstBlockId == null ||
        requestedPage.blocks.firstOrNull()?.blockId == requestedFirstBlockId ||
        requestedPage.blocks.any { block -> block.blockId == requestedFirstBlockId }
      ) {
        return displayIndex
      }
    }

    if (requestedFirstBlockId != null) {
      val firstBlockMatch = candidatePages.indexOfFirst { page ->
        page.spineIndex == restoreSpineIndex &&
          page.blocks.firstOrNull()?.blockId == requestedFirstBlockId
      }
      if (firstBlockMatch >= 0) {
        return firstBlockMatch
      }

      val containingBlockMatch = candidatePages.indexOfFirst { page ->
        page.spineIndex == restoreSpineIndex &&
          page.blocks.any { block -> block.blockId == requestedFirstBlockId }
      }
      if (containingBlockMatch >= 0) {
        return containingBlockMatch
      }
    }

    return requestedPageIndex
      ?.coerceIn(0, matchingChapterPages.lastIndex)
      ?.let { matchingChapterPages[it].first }
  }

  private fun signatureForRestorePosition(position: Map<String, Any?>): String {
    position["spineIndex"] ?: return ""
    return listOf("spineIndex", "pageIndex", "pagesInChapter", "href", "firstBlockId")
      .joinToString("|") { key -> "$key=${position[key] ?: ""}" }
  }

  private fun dispatchPageChange(pageIndex: Int, total: Int) {
    val page = pages.getOrNull(pageIndex)
    val href = page?.href?.takeIf { it.isNotBlank() }
      ?: page?.path?.takeIf { it.isNotBlank() }
      ?: bookManifest.stringValue("currentSpineHref")
      ?.takeIf { it.isNotBlank() }
      ?: bookManifest.stringValue("currentSpinePath")
      ?: ""
    val chapterPageIndex = page?.chapterPageIndex ?: logicalPageForDisplayPosition(pageIndex)
    val chapterPageCount = page?.chapterPageCount?.takeIf { it > 0 } ?: total
    val event = mutableMapOf<String, Any>(
      "page" to chapterPageIndex,
      "total" to chapterPageCount,
      "globalPage" to pageIndex,
      "globalTotal" to total,
      "href" to href,
      "firstBlockId" to (page?.blocks?.firstOrNull()?.blockId ?: ""),
      "savedHighlights" to (page?.pageIndex?.let { savedHighlightContextsByPage[it] }.orEmpty())
    )

    (page?.spineIndex ?: bookManifest.intValue("currentSpineIndex"))?.let { spineIndex ->
      event["spineIndex"] = spineIndex
    }

    onPageChange(event)
  }

  private fun logicalPageForDisplayPosition(position: Int): Int {
    if (pages.isEmpty()) {
      return 0
    }

    pages.getOrNull(position)?.chapterPageIndex?.let { return it }
    return (position - pagePositionOffset).coerceIn(0, pages.lastIndex)
  }

  private fun signatureForBlocks(blocks: List<Any?>): String {
    val firstId = blocks.firstOrNull().asMap()?.stringValue("id") ?: ""
    val lastId = blocks.lastOrNull().asMap()?.stringValue("id") ?: ""
    val textLength = blocks.sumOf { rawBlock ->
      rawBlock.asMap()?.stringValue("text")?.length ?: 0
    }
    val styleHash = blocks.fold(1) { acc, rawBlock ->
      val block = rawBlock.asMap()
      val blockStyleHash = block?.get("styleTokens")?.hashCode() ?: 0
      val spansStyleHash = block?.get("spans")?.hashCode() ?: 0

      (31 * acc) + blockStyleHash + spansStyleHash
    }

    return "${blocks.size}:$firstId:$lastId:$textLength:$styleHash"
  }

  private fun setReaderBackgroundColors() {
    val backgroundColor = readerBackgroundColor()
    setBackgroundColor(backgroundColor)
    viewPager.setBackgroundColor(backgroundColor)
    continuousScrollView.setBackgroundColor(backgroundColor)
  }

  private fun updateRenderModeVisibility() {
    val isVertical = isVerticalLayoutMode()
    viewPager.visibility = if (isVertical) View.GONE else View.VISIBLE
    continuousScrollView.visibility = if (isVertical) View.VISIBLE else View.GONE
  }

  private fun readerBackgroundColor(): Int {
    return themePalette.backgroundColor
  }

  private fun dp(value: Float): Int {
    return (value * resources.displayMetrics.density).roundToInt()
  }

  private fun Any?.asMap(): Map<*, *>? = this as? Map<*, *>

  private fun Map<*, *>.stringValue(key: String): String? = this[key] as? String

  private fun Map<*, *>.listValue(key: String): List<Any?> {
    return this[key] as? List<Any?> ?: emptyList()
  }

  private fun Map<*, *>.intValue(key: String): Int? {
    return when (val value = this[key]) {
      is Int -> value
      is Double -> value.toInt()
      is Number -> value.toInt()
      else -> null
    }
  }

  private fun Map<*, *>.booleanValue(key: String): Boolean? {
    return this[key] as? Boolean
  }
}
