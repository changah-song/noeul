package expo.modules.nativeepubreader

import android.content.Context
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.MotionEvent
import android.view.View.MeasureSpec
import android.view.ViewConfiguration
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import androidx.viewpager2.widget.ViewPager2
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import kotlin.math.abs
import kotlin.math.roundToInt
import java.util.concurrent.CancellationException
import java.util.concurrent.Executors
import java.util.concurrent.Future

class NativeEpubReaderModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NativeEpubReader")

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

      Prop("highlightTerms") { view: NativeEpubReaderView, terms: List<Any?> ->
        view.setHighlightTerms(terms)
      }

      Prop("clearSelectionToken") { view: NativeEpubReaderView, token: Double ->
        view.setClearSelectionToken(token.toInt())
      }

      Events(
        "onPageChange",
        "onChapterEnd",
        "onChapterStart",
        "onChapterCommit",
        "onWordSelected",
        "onTextSelected",
        "onSelectionCleared"
      )
    }
  }
}

private const val TAG = "NativeEpubReader"

private data class ChapterWindowItem(
  val role: String,
  val spineIndex: Int,
  val href: String,
  val path: String,
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
  private val viewPager = ViewPager2(context)
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
  private var chapterBlocksSignature = ""
  private var chapterWindowSignature = ""
  private var pageRanges: List<ChapterPageRange> = emptyList()
  private var committedSpineIndex: Int? = null
  private var layoutWidth = 0
  private var layoutHeight = 0
  private val pagePaddingH = dp(20f)
  private val pagePaddingV = dp(24f)
  private var readerFontSizeSp = 18f
  private var readerLineHeightMultiplier = 1.5f
  private var readerTheme = "light"
  private var highlightTerms: List<String> = emptyList()
  private var savedHighlightRangesByPage: Map<Int, List<TextRange>> = emptyMap()
  private var activeSelectionRanges: List<TextRange> = emptyList()
  private var activeSelectionKind: ActiveSelectionKind? = null
  private var lastClearSelectionToken: Int? = null
  private var activeHighlightColor = Color.argb(0x55, 0xfc, 0xd5, 0xb4)
  private var textSelectionHighlightColor = Color.rgb(0xe3, 0xe7, 0xee)
  private var savedHighlightColor = Color.rgb(0xf7, 0xd4, 0x88)
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

    addView(
      viewPager,
      ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT
      )
    )
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
    super.onDetachedFromWindow()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (pages.isEmpty() && chapterBlocks.isNotEmpty() && layoutWidth > 0 && layoutHeight > 0) {
      repaginate(resetToFirstPage = pageAdapter == null)
    }
  }

  fun setBookManifest(manifest: Map<String, Any?>) {
    manifest.stringValue("chapterTransitionDirection")?.let { direction ->
      setChapterTransitionDirection(direction)
    }
    bookManifest = manifest
    manifest.intValue("currentSpineIndex")?.let { spineIndex ->
      committedSpineIndex = spineIndex
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
        blocks = blocks,
        resources = chapter.listValue("resources"),
        signature = signatureForBlocks(blocks)
      )
    }.sortedBy { it.spineIndex }

    val nextSignature = nextWindow.joinToString("|") { chapter ->
      "${chapter.role}:${chapter.spineIndex}:${chapter.href}:${chapter.path}:${chapter.signature}"
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
    restorePosition = position

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
    setReaderBackgroundColors()
    updateHighlightColorsForTheme()
    chapterTransitionDirection = "none"
    repaginate(resetToFirstPage = false)
  }

  fun setHighlightTerms(terms: List<Any?>) {
    val nextTerms = normalizeHighlightTerms(terms)
    if (highlightTerms == nextTerms) {
      return
    }

    highlightTerms = nextTerms
    rebuildSavedHighlightRanges()
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
          context = appContext
        )
        paginateChapterWindow(paginator, windowSnapshot)
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
          backgroundColor = backgroundColor
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

    chapters.forEach { chapter ->
      val chapterPages = paginator.paginate(chapter.blocks)
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
    return "${current.spineIndex}:${current.href}:${current.path}:${current.signature}"
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
    backgroundColor: Int
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
    savedHighlightRangesByPage = buildSavedHighlightRanges(nextPages, highlightTerms)

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
        activeSelectionRanges,
        activeSelectionKind,
        savedHighlightRangesByPage,
        activeHighlightColor,
        textSelectionHighlightColor,
        savedHighlightColor,
        ::handlePageWordSelected,
        ::handlePageTextSelected,
        ::handlePageSelectionCleared,
        ::handlePageSelectionDragStateChanged
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
        adapter.updateHighlightColors(activeHighlightColor, textSelectionHighlightColor, savedHighlightColor)
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
      adapter.updateHighlightColors(activeHighlightColor, textSelectionHighlightColor, savedHighlightColor)
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
  }

  private fun clearActiveSelection(dispatchEvent: Boolean, forceEvent: Boolean = false) {
    val hadSelection = activeSelectionRanges.isNotEmpty()
    activeSelectionRanges = emptyList()
    activeSelectionKind = null
    pageAdapter?.updateActiveSelectionRanges(activeSelectionRanges, activeSelectionKind)
    invalidateVisiblePageHighlights()
    viewPager.isUserInputEnabled = true

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
  }

  private fun recyclerView(): RecyclerView? {
    return viewPager.getChildAt(0) as? RecyclerView
  }

  private fun rebuildSavedHighlightRanges() {
    savedHighlightRangesByPage = buildSavedHighlightRanges(pages, highlightTerms)
    pageAdapter?.updateSavedHighlightRanges(savedHighlightRangesByPage)
    invalidateVisiblePageHighlights()
  }

  private fun buildSavedHighlightRanges(
    sourcePages: List<ReaderPage>,
    terms: List<String>
  ): Map<Int, List<TextRange>> {
    if (sourcePages.isEmpty() || terms.isEmpty()) {
      Log.d(
        TAG,
        "saved highlight ranges built: terms=${terms.size} pages=${sourcePages.size} matches=0"
      )
      return emptyMap()
    }

    val rangesByPage = mutableMapOf<Int, MutableList<TextRange>>()

    sourcePages.forEach { page ->
      val pageRanges = mutableListOf<TextRange>()

      page.blocks.forEach blockLoop@{ block ->
        if (block.type != "text") {
          return@blockLoop
        }

        val text = block.plainText.ifEmpty { block.styledText?.toString() ?: "" }
        if (text.isEmpty()) {
          return@blockLoop
        }

        val occupiedLocalRanges = mutableListOf<Pair<Int, Int>>()

        terms.forEach { term ->
          var searchStart = 0
          while (searchStart <= text.length - term.length) {
            val matchStart = text.indexOf(term, startIndex = searchStart)
            if (matchStart < 0) {
              break
            }

            val matchEnd = matchStart + term.length
            if (
              hasTokenBoundary(text, term, matchStart, matchEnd) &&
              !overlapsAny(occupiedLocalRanges, matchStart, matchEnd)
            ) {
              occupiedLocalRanges.add(matchStart to matchEnd)
              pageRanges.add(
                TextRange(
                  pageIndex = page.pageIndex,
                  spineIndex = page.spineIndex,
                  blockId = block.blockId,
                  sourceStartOffset = block.sourceStartOffset + matchStart,
                  sourceEndOffset = block.sourceStartOffset + matchEnd
                )
              )
            }

            searchStart = matchStart + 1
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
    }

    val matchCount = rangesByPage.values.sumOf { ranges -> ranges.size }
    Log.d(
      TAG,
      "saved highlight ranges built: terms=${terms.size} pages=${sourcePages.size} matches=$matchCount"
    )

    return rangesByPage
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

  private fun savedHighlightContextsForPage(
    page: ReaderPage?,
    terms: List<String>
  ): List<Map<String, Any>> {
    if (page == null || terms.isEmpty()) {
      return emptyList()
    }

    val contexts = mutableListOf<Map<String, Any>>()
    val seenKeys = mutableSetOf<String>()

    page.blocks.forEach blockLoop@{ block ->
      if (block.type != "text") {
        return@blockLoop
      }

      val text = block.plainText.ifEmpty { block.styledText?.toString() ?: "" }
      if (text.isEmpty()) {
        return@blockLoop
      }

      val occupiedLocalRanges = mutableListOf<Pair<Int, Int>>()

      terms.forEach { term ->
        if (term.isBlank()) {
          return@forEach
        }

        var searchStart = 0
        while (searchStart <= text.length - term.length) {
          val matchStart = text.indexOf(term, startIndex = searchStart)
          if (matchStart < 0) {
            break
          }

          val matchEnd = matchStart + term.length
          if (
            hasTokenBoundary(text, term, matchStart, matchEnd) &&
            !overlapsAny(occupiedLocalRanges, matchStart, matchEnd)
          ) {
            val sentence = sentenceForOffsets(text, matchStart, matchEnd)
            val key = "${term}|${sentence}|${block.blockId}"
            if (!seenKeys.contains(key)) {
              seenKeys.add(key)
              occupiedLocalRanges.add(matchStart to matchEnd)
              contexts.add(
                mapOf(
                  "text" to term,
                  "sentence" to sentence,
                  "blockId" to block.blockId
                )
              )
            }
          }

          searchStart = matchStart + 1
        }
      }
    }

    return contexts
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

    if (startsWithToken && start > 0 && isReaderTokenChar(text[start - 1])) {
      return false
    }

    if (endsWithToken && end < text.length && isReaderTokenChar(text[end])) {
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
    activeHighlightColor = Color.argb(0x55, 0xfc, 0xd5, 0xb4)
    textSelectionHighlightColor = Color.rgb(0xe3, 0xe7, 0xee)
    savedHighlightColor = Color.rgb(0xf7, 0xd4, 0x88)

    pageAdapter?.updateHighlightColors(activeHighlightColor, textSelectionHighlightColor, savedHighlightColor)
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
      "savedHighlights" to savedHighlightContextsForPage(page, highlightTerms)
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
  }

  private fun readerBackgroundColor(): Int {
    return if (readerTheme == "dark") Color.rgb(31, 41, 55) else Color.rgb(249, 247, 242)
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
}
