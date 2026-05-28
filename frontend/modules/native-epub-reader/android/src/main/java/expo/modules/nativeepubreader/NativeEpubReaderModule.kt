package expo.modules.nativeepubreader

import android.content.Context
import android.graphics.Color
import android.os.Handler
import android.os.Looper
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

      Events("onPageChange", "onChapterEnd", "onChapterStart")
    }
  }
}

class NativeEpubReaderView(
  context: Context,
  appContext: AppContext
) : ExpoView(context, appContext) {
  private val onPageChange by EventDispatcher()
  private val onChapterEnd by EventDispatcher()
  private val onChapterStart by EventDispatcher()
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
  private var restorePosition: Map<String, Any?> = emptyMap()
  private var chapterBlocksSignature = ""
  private var layoutWidth = 0
  private var layoutHeight = 0
  private val pagePaddingH = dp(20f)
  private val pagePaddingV = dp(24f)
  private var readerFontSizeSp = 18f
  private var readerLineHeightMultiplier = 1.5f
  private var readerTheme = "light"
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

        if (state == ViewPager2.SCROLL_STATE_IDLE) {
          flushPendingEdgeNavigation()
          finishChapterTransitionIfNeeded()
        }
      }

      override fun onPageSelected(position: Int) {
        if (suppressPageEvents) {
          return
        }

        val total = pages.size
        val logicalPage = logicalPageForDisplayPosition(position)
        dispatchPageChange(logicalPage, total)

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
  }

  fun setChapterBlocks(blocks: List<Any?>) {
    val nextSignature = signatureForBlocks(blocks)

    if (chapterBlocksSignature == nextSignature) {
      chapterBlocks = blocks
      return
    }

    chapterBlocks = blocks
    chapterBlocksSignature = nextSignature
    repaginate(resetToFirstPage = true)
  }

  fun setChapterResources(resources: List<Any?>) {
    chapterResources = resources
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
    chapterTransitionDirection = "none"
    repaginate(resetToFirstPage = false)
  }

  private fun repaginate(resetToFirstPage: Boolean) {
    if (layoutWidth <= 0 || layoutHeight <= 0 || chapterBlocks.isEmpty()) {
      return
    }

    val generation = paginationGeneration + 1
    paginationGeneration = generation
    paginationTask?.cancel(true)

    val layoutWidthSnapshot = layoutWidth
    val layoutHeightSnapshot = layoutHeight
    val chapterBlocksSnapshot = chapterBlocks.toList()
    val fontSizeSnapshot = readerFontSizeSp
    val lineHeightSnapshot = readerLineHeightMultiplier
    val isDarkSnapshot = readerTheme == "dark"
    val appContext = context.applicationContext ?: context
    val previousPages = pages
    val previousLogicalPage = logicalPageForDisplayPosition(viewPager.currentItem)
    val transitionDirection = chapterTransitionDirection
    val backgroundColor = readerBackgroundColor()
    chapterTransitionDirection = "none"

    paginationTask = paginationExecutor.submit {
      val nextPages = try {
        EpubPaginator(
          pageWidth = layoutWidthSnapshot,
          pageHeight = layoutHeightSnapshot,
          paddingH = pagePaddingH,
          paddingV = pagePaddingV,
          fontSizeSp = fontSizeSnapshot,
          lineHeightMult = lineHeightSnapshot,
          isDark = isDarkSnapshot,
          context = appContext
        ).paginate(chapterBlocksSnapshot)
      } catch (_: CancellationException) {
        return@submit
      }

      mainHandler.post {
        if (generation != paginationGeneration) {
          return@post
        }

        applyPaginatedPages(
          nextPages = nextPages,
          previousPages = previousPages,
          previousLogicalPage = previousLogicalPage,
          resetToFirstPage = resetToFirstPage,
          transitionDirection = transitionDirection,
          backgroundColor = backgroundColor
        )
      }
    }
  }

  private fun applyPaginatedPages(
    nextPages: List<ReaderPage>,
    previousPages: List<ReaderPage>,
    previousLogicalPage: Int,
    resetToFirstPage: Boolean,
    transitionDirection: String,
    backgroundColor: Int
  ) {
    val restorePage = pageIndexForRestorePosition(nextPages)
    val targetPage = restorePage
      ?: if (resetToFirstPage) {
        0
      } else {
        previousLogicalPage.coerceIn(0, nextPages.lastIndex)
      }
    previousPageIndex = targetPage
    userDraggedPager = false

    val adapter = pageAdapter
    if (adapter == null) {
      pages = nextPages
      pagePositionOffset = 0
      pageAdapter = EpubPageAdapter(
        pages,
        pagePaddingH,
        pagePaddingV,
        readerLineHeightMultiplier,
        backgroundColor
      )
      viewPager.adapter = pageAdapter
    } else {
      val canAnimateChapterTransition = (
        resetToFirstPage &&
        previousPages.isNotEmpty() &&
        nextPages.isNotEmpty() &&
        (transitionDirection == "next" || transitionDirection == "previous")
      )

      if (canAnimateChapterTransition) {
        pages = nextPages
        animateChapterTransition(
          adapter,
          previousPages,
          nextPages,
          transitionDirection,
          backgroundColor
        )
        return
      }

      pages = nextPages
      pagePositionOffset = 0
      adapter.updateRenderConfig(readerLineHeightMultiplier, backgroundColor)
      adapter.updatePages(pages)
    }

    viewPager.setCurrentItem(targetPage, false)
    dispatchPageChange(targetPage, pages.size)
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
    val currentLogicalPage = logicalPageForDisplayPosition(viewPager.currentItem)
    if (targetPage == currentLogicalPage) {
      return
    }

    suppressPageEvents = true
    previousPageIndex = targetPage
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

    if (requestedPageIndex != null && requestedPageIndex in candidatePages.indices) {
      val requestedPage = candidatePages[requestedPageIndex]
      if (
        requestedFirstBlockId == null ||
        requestedPage.blocks.firstOrNull()?.blockId == requestedFirstBlockId ||
        requestedPage.blocks.any { block -> block.blockId == requestedFirstBlockId }
      ) {
        return requestedPageIndex
      }
    }

    if (requestedFirstBlockId != null) {
      val firstBlockMatch = candidatePages.indexOfFirst { page ->
        page.blocks.firstOrNull()?.blockId == requestedFirstBlockId
      }
      if (firstBlockMatch >= 0) {
        return firstBlockMatch
      }

      val containingBlockMatch = candidatePages.indexOfFirst { page ->
        page.blocks.any { block -> block.blockId == requestedFirstBlockId }
      }
      if (containingBlockMatch >= 0) {
        return containingBlockMatch
      }
    }

    return requestedPageIndex?.coerceIn(0, candidatePages.lastIndex)
  }

  private fun dispatchPageChange(pageIndex: Int, total: Int) {
    val page = pages.getOrNull(pageIndex)
    val href = bookManifest.stringValue("currentSpineHref")
      ?.takeIf { it.isNotBlank() }
      ?: bookManifest.stringValue("currentSpinePath")
      ?: ""
    val event = mutableMapOf<String, Any>(
      "page" to pageIndex,
      "total" to total,
      "href" to href,
      "firstBlockId" to (page?.blocks?.firstOrNull()?.blockId ?: "")
    )

    bookManifest.intValue("currentSpineIndex")?.let { spineIndex ->
      event["spineIndex"] = spineIndex
    }

    onPageChange(event)
  }

  private fun logicalPageForDisplayPosition(position: Int): Int {
    if (pages.isEmpty()) {
      return 0
    }

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

  private fun Map<*, *>.intValue(key: String): Int? {
    return when (val value = this[key]) {
      is Int -> value
      is Double -> value.toInt()
      is Number -> value.toInt()
      else -> null
    }
  }
}
