package expo.modules.screenocroverlay

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import android.os.SystemClock
import android.text.TextPaint
import android.util.Log
import android.view.MotionEvent
import android.view.View
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

private const val HANJA_RELATED_PAGE_SIZE = 5
private const val HANJA_LOAD_MORE_DELAY_MS = 650L

class OcrResultOverlayView(
  context: Context,
  private var ocrResult: SerializedOcrResult? = null,
  private val onTargetSelected: (OcrTapSelection) -> Unit,
  private val onWordNavigationRequested: (OcrTapSelection) -> Unit,
  private val onSaveRequested: (String, Int?) -> Unit,
  private val onHanjaRequested: (String, String) -> Unit,
  private val onRelatedKnownToggleRequested: (String, String, OverlayHanjaRelatedWord) -> Unit,
  private var closeAnchorRectOnScreen: RectF? = null,
  private val onClose: () -> Unit
) : View(context) {
  private val density = resources.displayMetrics.density
  private val koreanRegularTypeface = loadReaderSerifTypeface(context, bold = false)
  private val koreanBoldTypeface = loadReaderSerifTypeface(context, bold = true)
  private val englishRegularTypeface = loadReaderSansTypeface(context, weight = "regular")
  private val englishMediumTypeface = loadReaderSansTypeface(context, weight = "medium")
  private val englishBoldTypeface = loadReaderSansTypeface(context, weight = "bold")
  private val bookmarkPath = Path()
  private val panelClipPath = Path()
  private val boxPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.argb(58, 47, 125, 76)
    style = Paint.Style.FILL
  }
  private val boxStrokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.argb(220, 47, 125, 76)
    strokeWidth = dp(1.5f)
    style = Paint.Style.STROKE
  }
  private val selectedBoxPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.argb(90, 47, 125, 76)
    style = Paint.Style.FILL
  }
  private val dimPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.argb(35, 0, 0, 0)
    style = Paint.Style.FILL
  }
  private val closePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.argb(220, 24, 24, 24)
    style = Paint.Style.FILL
  }
  private val closeIconPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.WHITE
    strokeCap = Paint.Cap.ROUND
    strokeWidth = dp(2.4f)
    style = Paint.Style.STROKE
  }
  private val emptyTextPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.WHITE
    textAlign = Paint.Align.CENTER
    textSize = dp(14f)
  }
  private val cardPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.WHITE
    style = Paint.Style.FILL
  }
  private val cardStrokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(232, 223, 201)
    strokeWidth = dp(1f)
    style = Paint.Style.STROKE
  }
  private val panelShadowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.WHITE
    style = Paint.Style.FILL
    setShadowLayer(dp(18f), 0f, dp(10f), Color.argb(58, 0, 0, 0))
  }
  private val cardTitlePaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(26, 26, 26)
    textSize = dp(15.5f)
    typeface = koreanBoldTypeface
    isFakeBoldText = true
  }
  private val cardMetaPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(155, 142, 118)
    textSize = dp(11.5f)
    typeface = englishRegularTypeface
  }
  private val cardBodyPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(26, 26, 26)
    textSize = dp(14f)
    typeface = englishRegularTypeface
    isFakeBoldText = false
  }
  private val cardErrorPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(160, 62, 54)
    textSize = dp(14f)
    typeface = englishMediumTypeface
  }
  private val buttonPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(200, 125, 0)
    style = Paint.Style.FILL
  }
  private val secondaryButtonPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(255, 255, 255)
    style = Paint.Style.FILL
  }
  private val buttonStrokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(232, 223, 201)
    strokeWidth = dp(1.5f)
    style = Paint.Style.STROKE
  }
  private val buttonTextPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.WHITE
    textAlign = Paint.Align.CENTER
    textSize = dp(13f)
    typeface = englishBoldTypeface
    isFakeBoldText = true
  }
  private val secondaryButtonTextPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(155, 142, 118)
    textAlign = Paint.Align.CENTER
    textSize = dp(13f)
    typeface = englishBoldTypeface
    isFakeBoldText = true
  }
  private val wordNavCountPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(155, 142, 118)
    textAlign = Paint.Align.CENTER
    textSize = dp(10.5f)
    typeface = englishBoldTypeface
    isFakeBoldText = true
  }
  private val hanjaPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(155, 142, 118)
    textSize = dp(14f)
    typeface = koreanRegularTypeface
  }
  private val hanjaActivePaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(200, 125, 0)
    textSize = dp(14f)
    typeface = koreanRegularTypeface
  }
  private val hanjaParenPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(111, 101, 82)
    textSize = dp(14f)
    typeface = koreanRegularTypeface
  }
  private val hanjaUnderlinePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(155, 142, 118)
    strokeWidth = dp(1.5f)
    style = Paint.Style.STROKE
    pathEffect = DashPathEffect(floatArrayOf(dp(1.25f), dp(2f)), 0f)
  }
  private val badgePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(241, 236, 224)
    style = Paint.Style.FILL
  }
  private val badgeTextPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(111, 101, 82)
    textAlign = Paint.Align.CENTER
    textSize = dp(9.5f)
    typeface = englishBoldTypeface
    isFakeBoldText = true
  }
  private val dividerPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(239, 231, 212)
    strokeWidth = dp(1f)
    style = Paint.Style.STROKE
  }
  private val popupPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.WHITE
    style = Paint.Style.FILL
  }
  private val popupStrokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(232, 223, 201)
    strokeWidth = dp(1f)
    style = Paint.Style.STROKE
  }
  private val popupHeaderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(253, 243, 220)
    style = Paint.Style.FILL
  }
  private val popupTilePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.WHITE
    style = Paint.Style.FILL
  }
  private val popupTileStrokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.argb(52, 200, 125, 0)
    strokeWidth = dp(1f)
    style = Paint.Style.STROKE
  }
  private val popupTitlePaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(26, 26, 26)
    textSize = dp(28f)
    typeface = koreanRegularTypeface
  }
  private val popupReadingPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(26, 26, 26)
    textSize = dp(14f)
    typeface = koreanBoldTypeface
    isFakeBoldText = true
  }
  private val popupMeaningPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(111, 101, 82)
    textSize = dp(11.5f)
    typeface = englishRegularTypeface
  }
  private val relatedHeaderPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(155, 142, 118)
    textSize = dp(10f)
    typeface = englishBoldTypeface
    isFakeBoldText = true
  }
  private val relatedHintPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(155, 142, 118)
    textSize = dp(10.5f)
    textAlign = Paint.Align.RIGHT
    typeface = englishRegularTypeface
  }
  private val relatedKoreanPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(26, 26, 26)
    textSize = dp(15f)
    typeface = koreanRegularTypeface
  }
  private val relatedHanjaPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(155, 142, 118)
    textSize = dp(11.5f)
    typeface = koreanRegularTypeface
  }
  private val bookmarkPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(200, 125, 0)
    strokeWidth = dp(2.2f)
    strokeJoin = Paint.Join.ROUND
    strokeCap = Paint.Cap.ROUND
  }
  private val iconPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.WHITE
    strokeWidth = dp(2.4f)
    strokeCap = Paint.Cap.ROUND
    strokeJoin = Paint.Join.ROUND
    style = Paint.Style.STROKE
  }

  private val overlayCloseRect = RectF()
  private val cardRect = RectF()
  private val saveButtonRect = RectF()
  private val translationButtonRect = RectF()
  private val moreButtonRect = RectF()
  private val wordNavPreviousRect = RectF()
  private val wordNavNextRect = RectF()
  private val hanjaPopupRect = RectF()
  private val hanjaPopupCloseRect = RectF()
  private val hanjaLoadMoreRect = RectF()
  private val hanjaTouchRects = mutableListOf<HanjaTouchRect>()
  private val alternativeSaveRects = mutableListOf<AlternativeSaveRect>()
  private val relatedKnownRects = mutableListOf<RelatedKnownRect>()
  private var lookupCard: LookupCard? = null
  private var hanjaPopup: HanjaPopup? = null
  private var hanjaPopupTouchStartY = 0f
  private var hanjaPopupTouchLastY = 0f
  private var isDraggingHanjaPopup = false
  private var hanjaLoadMoreRunnable: Runnable? = null
  private var lastGeometryLogKey = ""

  init {
    setLayerType(LAYER_TYPE_SOFTWARE, null)
  }

  fun setResult(nextResult: SerializedOcrResult) {
    clearHanjaLoadMore()
    ocrResult = nextResult
    lookupCard = null
    hanjaPopup = null
    lastGeometryLogKey = ""
    invalidate()
  }

  fun clearResult() {
    clearHanjaLoadMore()
    ocrResult = null
    lookupCard = null
    hanjaPopup = null
    invalidate()
  }

  fun setCloseAnchorRect(anchor: RectF?) {
    closeAnchorRectOnScreen = anchor?.let { RectF(it) }
    invalidate()
  }

  fun showLookupLoading(requestId: String, selection: OcrTapSelection) {
    clearHanjaLoadMore()
    val wordOptions = lookupWordOptionsFor(selection)
    val activeWordIndex = wordOptions.indexOf(selection.selectedText.trim()).takeIf { it >= 0 } ?: 0
    lookupCard = LookupCard(
      requestId = requestId,
      selection = selection,
      wordOptions = wordOptions,
      activeWordIndex = activeWordIndex,
      state = LookupCardState.LOADING,
      surface = selection.selectedText,
      stem = "",
      definition = null,
      translation = null,
      translationSourceLanguage = null,
      translationTargetLanguage = null,
      hanja = null,
      pos = null,
      romanization = null,
      saved = false,
      alternatives = emptyList(),
      hanjaPreloads = emptyList(),
      showingTranslation = false,
      expandedAlternatives = false,
      savingAlternativeIndex = null,
      message = "Looking up..."
    )
    hanjaPopup = null
    invalidate()
  }

  fun showLookupResult(result: OverlayLookupResult) {
    val currentCard = lookupCard?.takeIf { it.requestId == result.requestId } ?: return
    if (currentCard.state == LookupCardState.LOADING) {
      clearHanjaLoadMore()
    }
    val selection = currentCard.selection
    val resultOptions = result.wordOptions.map(String::trim).filter(String::isNotBlank).distinct()
    val preservedOptions = currentCard.wordOptions.takeIf { options ->
      options.size > 1 && listOf(result.stem, result.surface, selection.selectedText).any { value ->
        options.contains(value.trim())
      }
    } ?: emptyList()
    val wordOptions = when {
      resultOptions.size > 1 -> resultOptions
      preservedOptions.isNotEmpty() -> preservedOptions
      resultOptions.isNotEmpty() -> resultOptions
      else -> lookupWordOptionsFor(selection)
    }
    val activeWordIndex = listOf(result.stem, result.surface, selection.selectedText)
      .map { candidate -> wordOptions.indexOf(candidate.trim()) }
      .firstOrNull { index -> index >= 0 } ?: 0
    lookupCard = LookupCard(
      requestId = result.requestId,
      selection = selection,
      wordOptions = wordOptions,
      activeWordIndex = activeWordIndex,
      state = if (currentCard.state == LookupCardState.SAVING) currentCard.state else LookupCardState.LOADED,
      surface = result.surface,
      stem = result.stem,
      definition = result.definition,
      translation = result.translation,
      translationSourceLanguage = result.translationSourceLanguage,
      translationTargetLanguage = result.translationTargetLanguage,
      hanja = result.hanja,
      pos = result.pos,
      romanization = result.romanization,
      saved = result.saved,
      alternatives = result.alternatives,
      hanjaPreloads = result.hanjaPreloads,
      showingTranslation = currentCard.showingTranslation,
      expandedAlternatives = currentCard.expandedAlternatives,
      savingAlternativeIndex = currentCard.savingAlternativeIndex,
      message = if (currentCard.state == LookupCardState.SAVING) currentCard.message else null
    )
    if (currentCard.state == LookupCardState.LOADING) {
      hanjaPopup = null
    }
    invalidate()
  }

  fun hasLookupCard(requestId: String): Boolean =
    lookupCard?.requestId == requestId

  fun showLookupError(requestId: String, message: String, fallback: Boolean) {
    val current = lookupCard?.takeIf { it.requestId == requestId } ?: return
    lookupCard = current.copy(
      state = if (fallback) LookupCardState.FALLBACK else LookupCardState.ERROR,
      definition = null,
      savingAlternativeIndex = null,
      message = message
    )
    invalidate()
  }

  fun showSaving(requestId: String, alternativeIndex: Int?) {
    val current = lookupCard?.takeIf { it.requestId == requestId } ?: return
    lookupCard = current.copy(
      state = if (alternativeIndex == null) LookupCardState.SAVING else current.state,
      savingAlternativeIndex = alternativeIndex,
      message = if (alternativeIndex == null) "Saving..." else current.message
    )
    invalidate()
  }

  fun showSaveResult(result: OverlaySaveResult) {
    val current = lookupCard?.takeIf { it.requestId == result.requestId } ?: return
    val alternativeIndex = result.alternativeIndex
    if (alternativeIndex != null) {
      val updatedAlternatives = current.alternatives.mapIndexed { index, entry ->
        if (index == alternativeIndex) {
          entry.copy(saved = result.saved)
        } else {
          entry
        }
      }
      lookupCard = current.copy(
        state = LookupCardState.LOADED,
        alternatives = updatedAlternatives,
        savingAlternativeIndex = null,
        message = null
      )
      invalidate()
      return
    }

    lookupCard = current.copy(
      state = LookupCardState.LOADED,
      saved = result.saved,
      savingAlternativeIndex = null,
      message = null
    )
    invalidate()
  }

  fun showSaveError(requestId: String, message: String) {
    val current = lookupCard?.takeIf { it.requestId == requestId } ?: return
    lookupCard = current.copy(state = LookupCardState.ERROR, savingAlternativeIndex = null, message = message)
    invalidate()
  }

  fun showHanjaLoading(requestId: String, character: String, sourceWord: String) {
    clearHanjaLoadMore()
    hanjaPopup = HanjaPopup(
      requestId = requestId,
      character = character,
      sourceWord = sourceWord,
      state = HanjaPopupState.LOADING,
      meaning = null,
      sound = null,
      relatedWords = emptyList(),
      visibleRelatedCount = 0,
      relatedScrollOffset = 0f,
      loadingMoreRelated = false,
      message = "Loading hanja..."
    )
    invalidate()
  }

  private fun showCachedHanjaResult(sourceWord: String, result: OverlayHanjaPreload) {
    clearHanjaLoadMore()
    hanjaPopup = HanjaPopup(
      requestId = "${lookupCard?.requestId.orEmpty()}:${sourceWord}:${result.character}",
      character = result.character,
      sourceWord = sourceWord,
      state = HanjaPopupState.LOADED,
      meaning = result.meaning,
      sound = result.sound,
      relatedWords = result.relatedWords,
      visibleRelatedCount = min(HANJA_RELATED_PAGE_SIZE, result.relatedWords.size),
      relatedScrollOffset = 0f,
      loadingMoreRelated = false,
      message = null
    )
    invalidate()
  }

  fun showHanjaResult(result: OverlayHanjaResult) {
    val current = hanjaPopup?.takeIf { it.requestId == result.requestId } ?: return
    clearHanjaLoadMore()
    lookupCard = lookupCard?.let { card ->
      val nextPreload = OverlayHanjaPreload(
        sourceWord = current.sourceWord,
        character = result.character,
        meaning = result.meaning,
        sound = result.sound,
        relatedWords = result.relatedWords
      )
      val replacedPreloads = card.hanjaPreloads.map { preload ->
        if (preload.sourceWord == nextPreload.sourceWord && preload.character == nextPreload.character) {
          nextPreload
        } else {
          preload
        }
      }
      val replacedExisting = replacedPreloads.any { preload ->
        preload.sourceWord == nextPreload.sourceWord && preload.character == nextPreload.character
      }
      val nextPreloads = if (replacedExisting) {
        replacedPreloads
      } else {
        replacedPreloads + nextPreload
      }

      card.copy(hanjaPreloads = nextPreloads)
    }
    hanjaPopup = current.copy(
      character = result.character,
      state = HanjaPopupState.LOADED,
      meaning = result.meaning,
      sound = result.sound,
      relatedWords = result.relatedWords,
      visibleRelatedCount = min(HANJA_RELATED_PAGE_SIZE, result.relatedWords.size),
      relatedScrollOffset = 0f,
      loadingMoreRelated = false,
      message = null
    )
    invalidate()
  }

  fun hasHanjaPopup(requestId: String): Boolean =
    hanjaPopup?.requestId == requestId

  fun showHanjaError(requestId: String, message: String) {
    val current = hanjaPopup?.takeIf { it.requestId == requestId } ?: return
    hanjaPopup = current.copy(
      state = HanjaPopupState.ERROR,
      meaning = null,
      sound = null,
      relatedWords = emptyList(),
      visibleRelatedCount = 0,
      relatedScrollOffset = 0f,
      loadingMoreRelated = false,
      message = message.ifBlank { "Hanja lookup failed." }
    )
    invalidate()
  }

  override fun onDetachedFromWindow() {
    clearHanjaLoadMore()
    super.onDetachedFromWindow()
  }

  private fun clearHanjaLoadMore() {
    hanjaLoadMoreRunnable?.let(::removeCallbacks)
    hanjaLoadMoreRunnable = null
    isDraggingHanjaPopup = false
  }

  private fun visibleHanjaRelatedCount(popup: HanjaPopup): Int =
    min(popup.visibleRelatedCount, popup.relatedWords.size)

  private fun hasMoreHanjaRelatedWords(popup: HanjaPopup): Boolean =
    visibleHanjaRelatedCount(popup) < popup.relatedWords.size

  private fun cachedHanjaPreload(card: LookupCard, target: HanjaTouchRect): OverlayHanjaPreload? =
    card.hanjaPreloads.firstOrNull { preload ->
      preload.sourceWord == target.sourceWord && preload.character == target.character
    }

  private fun hanjaRelatedLoadMoreHeight(popup: HanjaPopup): Float =
    if (hasMoreHanjaRelatedWords(popup) || popup.loadingMoreRelated) dp(42f) else 0f

  private fun hanjaRelatedContentHeight(popup: HanjaPopup): Float =
    visibleHanjaRelatedCount(popup) * dp(50f) + hanjaRelatedLoadMoreHeight(popup)

  private fun hanjaRelatedViewportHeight(): Float {
    if (hanjaPopupRect.isEmpty) {
      return 0f
    }

    return (hanjaPopupRect.height() - dp(73f) - dp(32f) - dp(8f)).coerceAtLeast(0f)
  }

  private fun maxHanjaPopupScroll(popup: HanjaPopup): Float =
    (hanjaRelatedContentHeight(popup) - hanjaRelatedViewportHeight()).coerceAtLeast(0f)

  private fun scrollHanjaPopupBy(delta: Float) {
    val popup = hanjaPopup ?: return
    if (popup.state != HanjaPopupState.LOADED || popup.relatedWords.isEmpty()) {
      return
    }

    val maxScroll = maxHanjaPopupScroll(popup)
    if (maxScroll <= 0f) {
      if (delta > dp(8f)) {
        startHanjaLoadMore()
      }
      return
    }

    val nextOffset = (popup.relatedScrollOffset + delta).coerceIn(0f, maxScroll)
    if (abs(nextOffset - popup.relatedScrollOffset) > 0.5f) {
      hanjaPopup = popup.copy(relatedScrollOffset = nextOffset)
      invalidate()
    }

    if (delta > 0f && nextOffset >= maxScroll - dp(8f)) {
      startHanjaLoadMore()
    }
  }

  private fun maybeLoadMoreHanjaAtBottom() {
    val popup = hanjaPopup ?: return
    if (popup.relatedScrollOffset >= maxHanjaPopupScroll(popup) - dp(8f)) {
      startHanjaLoadMore()
    }
  }

  private fun startHanjaLoadMore() {
    val popup = hanjaPopup ?: return
    if (
      popup.state != HanjaPopupState.LOADED ||
      popup.loadingMoreRelated ||
      !hasMoreHanjaRelatedWords(popup)
    ) {
      return
    }

    clearHanjaLoadMore()
    val requestId = popup.requestId
    hanjaPopup = popup.copy(loadingMoreRelated = true)

    val runnable = Runnable {
      val current = hanjaPopup
      if (current == null || current.requestId != requestId) {
        hanjaLoadMoreRunnable = null
        return@Runnable
      }

      val nextVisibleCount = min(
        current.visibleRelatedCount + HANJA_RELATED_PAGE_SIZE,
        current.relatedWords.size
      )
      val nextPopup = current.copy(
        visibleRelatedCount = nextVisibleCount,
        loadingMoreRelated = false
      )
      hanjaPopup = nextPopup.copy(
        relatedScrollOffset = min(nextPopup.relatedScrollOffset, maxHanjaPopupScroll(nextPopup))
      )
      hanjaLoadMoreRunnable = null
      invalidate()
    }

    hanjaLoadMoreRunnable = runnable
    postDelayed(runnable, HANJA_LOAD_MORE_DELAY_MS)
    invalidate()
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)

    val currentResult = ocrResult ?: return
    canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), dimPaint)
    drawBoxes(canvas, currentResult)
    drawCloseButton(canvas)
    drawEmptyState(canvas, currentResult)
    drawLookupCard(canvas)
    drawHanjaPopup(canvas)
  }

  override fun onTouchEvent(event: MotionEvent): Boolean {
    val currentResult = ocrResult ?: return true

    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        if (hanjaPopupRect.contains(event.x, event.y)) {
          hanjaPopupTouchStartY = event.y
          hanjaPopupTouchLastY = event.y
          isDraggingHanjaPopup = false
        }
        return true
      }
      MotionEvent.ACTION_MOVE -> {
        if (hanjaPopupRect.contains(event.x, event.y)) {
          val dy = event.y - hanjaPopupTouchLastY
          if (abs(event.y - hanjaPopupTouchStartY) > dp(4f)) {
            isDraggingHanjaPopup = true
          }
          if (dy != 0f) {
            scrollHanjaPopupBy(-dy)
          }
          hanjaPopupTouchLastY = event.y
        }
        return true
      }
      MotionEvent.ACTION_CANCEL -> {
        isDraggingHanjaPopup = false
        return true
      }
    }

    hanjaPopup?.let { popup ->
      relatedKnownRects.firstOrNull { it.rect.contains(event.x, event.y) }?.let { target ->
        val related = popup.relatedWords.getOrNull(target.index)
        if (related != null) {
          val nextRelated = related.copy(known = !related.known)
          hanjaPopup = popup.copy(
            relatedWords = popup.relatedWords.mapIndexed { index, entry ->
              if (index == target.index) nextRelated else entry
            }
          )
          lookupCard = lookupCard?.let { card ->
            card.copy(
              hanjaPreloads = card.hanjaPreloads.map { preload ->
                if (preload.sourceWord == popup.sourceWord && preload.character == popup.character) {
                  preload.copy(
                    relatedWords = preload.relatedWords.mapIndexed { index, entry ->
                      if (index == target.index) nextRelated else entry
                    }
                  )
                } else {
                  preload
                }
              }
            )
          }
          onRelatedKnownToggleRequested(popup.sourceWord, popup.character, nextRelated)
          invalidate()
        }
        return true
      }
      if (hanjaLoadMoreRect.contains(event.x, event.y)) {
        startHanjaLoadMore()
        return true
      }
      if (hanjaPopupRect.contains(event.x, event.y)) {
        if (isDraggingHanjaPopup) {
          maybeLoadMoreHanjaAtBottom()
        }
        isDraggingHanjaPopup = false
        return true
      }
      clearHanjaLoadMore()
      hanjaPopup = null
      invalidate()
    }

    lookupCard?.let { card ->
      if (wordNavPreviousRect.contains(event.x, event.y) && card.wordOptions.size > 1) {
        navigateLookupWord(card, -1)
        return true
      }
      if (wordNavNextRect.contains(event.x, event.y) && card.wordOptions.size > 1) {
        navigateLookupWord(card, 1)
        return true
      }
      hanjaTouchRects.firstOrNull { it.rect.contains(event.x, event.y) }?.let { target ->
        val cachedHanja = cachedHanjaPreload(card, target)
        if (cachedHanja != null) {
          showCachedHanjaResult(target.sourceWord, cachedHanja)
        } else {
          onHanjaRequested(target.character, target.sourceWord)
        }
        return true
      }
      if (moreButtonRect.contains(event.x, event.y) && card.alternatives.isNotEmpty()) {
        lookupCard = card.copy(expandedAlternatives = !card.expandedAlternatives)
        hanjaPopup = null
        invalidate()
        return true
      }
      alternativeSaveRects.firstOrNull { it.rect.contains(event.x, event.y) }?.let { target ->
        val entry = card.alternatives.getOrNull(target.index)
        if (entry != null && !entry.definition.isNullOrBlank() && card.savingAlternativeIndex != target.index) {
          onSaveRequested(card.requestId, target.index)
        }
        return true
      }
      if (translationButtonRect.contains(event.x, event.y) && card.state == LookupCardState.LOADED) {
        lookupCard = card.copy(showingTranslation = true, expandedAlternatives = false)
        hanjaPopup = null
        invalidate()
        return true
      }
      if (saveButtonRect.contains(event.x, event.y) && card.canToggleSave) {
        onSaveRequested(card.requestId, null)
        return true
      }
      if (cardRect.contains(event.x, event.y)) {
        return true
      }
    }

    if (overlayCloseRect.contains(event.x, event.y)) {
      onClose()
      return true
    }

    findTargetAt(event.x, event.y, currentResult)?.let { target ->
      onTargetSelected(target)
      return true
    }

    if (lookupCard != null) {
      lookupCard = null
      hanjaPopup = null
      invalidate()
      return true
    }

    return true
  }

  private fun drawBoxes(canvas: Canvas, result: SerializedOcrResult) {
    val transform = currentTransform(result)
    logOverlayGeometry(result, transform)
    val selectedBox = lookupCard?.selection?.box

    visibleTargets(result).forEach { target ->
      val rect = transform.mapRect(target.box)
      if (selectedBox == target.box) {
        canvas.drawRoundRect(rect, dp(3f), dp(3f), selectedBoxPaint)
      } else {
        canvas.drawRoundRect(rect, dp(3f), dp(3f), boxPaint)
      }
      canvas.drawRoundRect(rect, dp(3f), dp(3f), boxStrokePaint)
    }
  }

  private fun drawCloseButton(canvas: Canvas) {
    val size = dp(44f)
    closeAnchorRect(size)?.let(overlayCloseRect::set) ?: run {
      val margin = dp(16f)
      overlayCloseRect.set(
        width - margin - size,
        margin,
        width - margin,
        margin + size
      )
    }

    canvas.drawOval(overlayCloseRect, closePaint)

    val inset = dp(14f)
    canvas.drawLine(
      overlayCloseRect.left + inset,
      overlayCloseRect.top + inset,
      overlayCloseRect.right - inset,
      overlayCloseRect.bottom - inset,
      closeIconPaint
    )
    canvas.drawLine(
      overlayCloseRect.right - inset,
      overlayCloseRect.top + inset,
      overlayCloseRect.left + inset,
      overlayCloseRect.bottom - inset,
      closeIconPaint
    )
  }

  private fun closeAnchorRect(size: Float): RectF? {
    val anchor = closeAnchorRectOnScreen ?: return null
    if (width <= 0 || height <= 0) {
      return null
    }

    val location = IntArray(2)
    getLocationOnScreen(location)
    val centerX = anchor.centerX() - location[0]
    val centerY = anchor.centerY() - location[1]
    val margin = dp(8f)
    val left = (centerX - size / 2f).coerceIn(margin, width - margin - size)
    val top = (centerY - size / 2f).coerceIn(margin, height - margin - size)

    return RectF(left, top, left + size, top + size)
  }

  private fun drawEmptyState(canvas: Canvas, result: SerializedOcrResult) {
    if (result.targets.isNotEmpty()) {
      return
    }

    canvas.drawText(
      "No OCR boxes found",
      width / 2f,
      max(dp(96f), height / 2f),
      emptyTextPaint
    )
  }

  private fun drawLookupCard(canvas: Canvas) {
    val card = lookupCard ?: return
    hanjaTouchRects.clear()
    alternativeSaveRects.clear()
    translationButtonRect.setEmpty()
    moreButtonRect.setEmpty()
    wordNavPreviousRect.setEmpty()
    wordNavNextRect.setEmpty()

    val cardWidth = lookupCardWidth()
    val cardHeight = computeCardHeight(card)
    val left = lookupCardLeft(cardWidth)
    val top = (height - cardHeight - dp(22f)).coerceAtLeast(dp(72f))

    cardRect.set(left, top, left + cardWidth, top + cardHeight)
    drawPanelSurface(canvas, cardRect)

    val padding = dp(15f)
    val sideNavInset = if (card.wordOptions.size > 1 && card.state != LookupCardState.SAVING) dp(18f) else 0f
    val contentLeft = cardRect.left + padding + sideNavInset
    val contentRight = cardRect.right - padding - sideNavInset

    drawHeaderButtons(canvas, card)
    val actionLeft = listOf(translationButtonRect, saveButtonRect)
      .filter { !it.isEmpty }
      .minOfOrNull { it.left }
    val titleRight = actionLeft?.let { it - dp(8f) } ?: contentRight
    drawCardTitleLine(canvas, card, contentLeft, titleRight.coerceAtLeast(contentLeft + dp(62f)), cardRect.top + dp(25f))

    if (card.showingTranslation) {
      drawTranslationOnlyCard(canvas, card, contentLeft, contentRight)
      drawWordSideNavigator(canvas, card)
      return
    }

    val metaBaseline = cardRect.top + dp(43f)
    val metaBottom = drawCardMetaLine(canvas, card, contentLeft, contentRight, metaBaseline)
    var y = max(metaBaseline + dp(17f), metaBottom + dp(8f))

    val bodyPaint = if (card.state == LookupCardState.ERROR || card.state == LookupCardState.FALLBACK) {
      cardErrorPaint
    } else {
      cardBodyPaint
    }
    val body = card.displayBody
    val lines = wrapText(body, bodyPaint, contentRight - contentLeft, maxLines = if (card.expandedAlternatives) 1 else 2)
    lines.forEach { line ->
      canvas.drawText(line, contentLeft, y, bodyPaint)
      y += dp(19f)
    }

    if (card.expandedAlternatives) {
      drawAlternatives(canvas, card, contentLeft, contentRight, y + dp(3f))
    }

    drawMoreButton(canvas, card)
    drawWordSideNavigator(canvas, card)
  }

  private fun lookupCardWidth(): Float =
    min(width - dp(24f), dp(390f)).coerceAtLeast(dp(260f))

  private fun lookupCardLeft(cardWidth: Float): Float =
    ((width - cardWidth) / 2f).coerceAtLeast(dp(12f))

  private fun computeCardHeight(card: LookupCard): Float {
    val alternativeCount = if (card.expandedAlternatives) {
      min(MAX_VISIBLE_ALTERNATIVES, card.alternatives.size)
    } else {
      0
    }
    if (card.showingTranslation) {
      return dp(126f).coerceAtMost(height - dp(96f)).coerceAtLeast(dp(100f))
    }
    val moreHeight = if (card.alternatives.isNotEmpty()) dp(22f) else 0f
    val alternativeHeight = alternativeCount * alternativeRowHeight()
    val baseHeight = if (card.expandedAlternatives) dp(82f) else dp(74f)
    return (baseHeight + alternativeHeight + moreHeight)
      .coerceAtMost(height - dp(96f))
      .coerceAtLeast(dp(86f))
  }

  private fun drawCardTitleLine(canvas: Canvas, card: LookupCard, left: Float, right: Float, baseline: Float) {
    val title = card.stem.ifBlank { card.surface }
    val posLabel = formatPos(card.pos)
    val posWidth = if (posLabel.isNotEmpty()) {
      min(dp(82f), badgeTextPaint.measureText(posLabel) + dp(12f))
    } else {
      0f
    }
    val hanjaWidth = measureHanjaGroup(card.hanja)
    val reservedWidth = hanjaWidth + if (posWidth > 0f) posWidth + dp(12f) else 0f
    val titleWidth = (right - left - reservedWidth - dp(7f)).coerceAtLeast(dp(62f))
    val titleText = ellipsize(title, cardTitlePaint, titleWidth)
    canvas.drawText(titleText, left, baseline, cardTitlePaint)

    var cursor = left + cardTitlePaint.measureText(titleText) + dp(7f)
    if (card.hanja?.isNotBlank() == true && cursor < right) {
      cursor = drawHanjaInlineGroup(
        canvas = canvas,
        hanja = card.hanja,
        x = cursor,
        baseline = baseline,
        maxRight = right - if (posWidth > 0f) posWidth + dp(7f) else 0f,
        sourceWord = card.stem.ifBlank { card.surface }
      )
    }

    if (posLabel.isNotEmpty() && cursor + dp(7f) + posWidth <= right) {
      val chipLeft = cursor + dp(7f)
      val badgeRect = RectF(chipLeft, baseline - dp(14f), chipLeft + posWidth, baseline + dp(4f))
      canvas.drawRoundRect(badgeRect, dp(5f), dp(5f), badgePaint)
      canvas.drawText(posLabel, badgeRect.centerX(), badgeRect.centerY() + dp(3.2f), badgeTextPaint)
    }
  }

  private fun drawCardMetaLine(
    canvas: Canvas,
    card: LookupCard,
    left: Float,
    right: Float,
    baseline: Float
  ): Float {
    val meta = buildMetaLine(card)
    if (meta.isNotEmpty()) {
      canvas.drawText(ellipsize(meta, cardMetaPaint, right - left), left, baseline, cardMetaPaint)
      return baseline
    }

    return baseline - dp(8f)
  }

  private fun drawHeaderButtons(canvas: Canvas, card: LookupCard) {
    val buttonWidth = dp(26f)
    val buttonHeight = dp(28f)
    val top = cardRect.top + dp(8f)
    val right = cardRect.right - dp(7f)
    val canShowSave = card.showSaveButton && !card.showingTranslation
    val canShowTranslate = card.state == LookupCardState.LOADED && !card.showingTranslation

    if (canShowSave) {
      saveButtonRect.set(right - buttonWidth, top, right, top + buttonHeight)
    } else {
      saveButtonRect.setEmpty()
    }

    if (canShowTranslate) {
      val translateRight = if (!saveButtonRect.isEmpty) saveButtonRect.left - dp(2f) else right
      translationButtonRect.set(translateRight - buttonWidth, top, translateRight, top + buttonHeight)
      drawTranslateIcon(canvas, translationButtonRect)
    } else {
      translationButtonRect.setEmpty()
    }

    if (!saveButtonRect.isEmpty) {
      if (card.state == LookupCardState.SAVING) {
        canvas.drawText("...", saveButtonRect.centerX(), saveButtonRect.centerY() + dp(4f), secondaryButtonTextPaint)
      } else {
        drawBookmarkIcon(canvas, saveButtonRect, card.saved)
      }
    }
  }

  private fun drawTranslationOnlyCard(canvas: Canvas, card: LookupCard, left: Float, right: Float) {
    val labelTop = cardRect.top + dp(45f)
    val iconSize = dp(20f)
    val iconRect = RectF(left, labelTop - dp(14f), left + iconSize, labelTop + dp(6f))
    drawTranslateIcon(canvas, iconRect)
    canvas.drawText(translationHeaderLabel(card), iconRect.right + dp(8f), labelTop + dp(1f), cardMetaPaint)

    val translation = card.translation?.trim().orEmpty()
    val body = when {
      translation.isNotBlank() -> translation
      card.state == LookupCardState.LOADED -> "Translating..."
      else -> card.displayBody
    }
    val bodyTop = labelTop + dp(25f)
    val lines = wrapText(body, cardBodyPaint, right - left, maxLines = 3)
    var y = bodyTop
    lines.forEach { line ->
      canvas.drawText(line, left, y, cardBodyPaint)
      y += dp(19f)
    }
  }

  private fun translationHeaderLabel(card: LookupCard): String {
    val source = card.translationSourceLanguage?.trim().orEmpty()
    val target = card.translationTargetLanguage?.trim().orEmpty()
    return if (source.isNotBlank() && target.isNotBlank()) {
      "TRANSLATION · $source → $target"
    } else {
      "TRANSLATION"
    }
  }

  private fun drawTranslateIcon(canvas: Canvas, rect: RectF) {
    canvas.drawRoundRect(rect, dp(8f), dp(8f), secondaryButtonPaint)
    canvas.drawRoundRect(rect, dp(8f), dp(8f), buttonStrokePaint)
    canvas.drawText("A", rect.centerX(), rect.centerY() + dp(4.5f), wordNavCountPaint)
  }

  private fun drawWordSideNavigator(canvas: Canvas, card: LookupCard) {
    if (card.wordOptions.size <= 1 || card.state == LookupCardState.SAVING) {
      wordNavPreviousRect.setEmpty()
      wordNavNextRect.setEmpty()
      return
    }

    val buttonWidth = dp(22f)
    val buttonHeight = dp(34f)
    val top = cardRect.centerY() - buttonHeight / 2f
    val bottom = top + buttonHeight

    wordNavPreviousRect.set(cardRect.left, top, cardRect.left + buttonWidth, bottom)
    wordNavNextRect.set(cardRect.right - buttonWidth, top, cardRect.right, bottom)

    drawHorizontalChevron(canvas, wordNavPreviousRect, leftDirection = true)
    drawHorizontalChevron(canvas, wordNavNextRect, leftDirection = false)
  }

  private fun drawBookmarkIcon(canvas: Canvas, rect: RectF, filled: Boolean) {
    val iconWidth = dp(12f)
    val iconHeight = dp(20f)
    val left = rect.centerX() - iconWidth / 2f
    val right = rect.centerX() + iconWidth / 2f
    val top = rect.centerY() - iconHeight / 2f
    val bottom = rect.centerY() + iconHeight / 2f
    val notchY = bottom - dp(5f)

    bookmarkPath.reset()
    bookmarkPath.moveTo(left, top)
    bookmarkPath.lineTo(right, top)
    bookmarkPath.lineTo(right, bottom)
    bookmarkPath.lineTo(rect.centerX(), notchY)
    bookmarkPath.lineTo(left, bottom)
    bookmarkPath.close()

    bookmarkPaint.strokeWidth = dp(1.8f)
    bookmarkPaint.style = if (filled) Paint.Style.FILL else Paint.Style.STROKE
    bookmarkPaint.color = if (filled) Color.rgb(200, 125, 0) else Color.rgb(154, 139, 117)
    canvas.drawPath(bookmarkPath, bookmarkPaint)
  }

  private fun drawMoreButton(canvas: Canvas, card: LookupCard) {
    if (card.alternatives.isEmpty() || card.state != LookupCardState.LOADED) {
      moreButtonRect.setEmpty()
      return
    }

    val buttonSize = dp(28f)
    val centerX = cardRect.centerX()
    val top = cardRect.bottom - buttonSize
    moreButtonRect.set(centerX - buttonSize / 2f, top, centerX + buttonSize / 2f, top + buttonSize)
    drawChevronIcon(canvas, moreButtonRect, up = card.expandedAlternatives)
  }

  private fun drawAlternatives(
    canvas: Canvas,
    card: LookupCard,
    left: Float,
    right: Float,
    startY: Float
  ): Float {
    var rowTop = startY
    card.alternatives.take(MAX_VISIBLE_ALTERNATIVES).forEachIndexed { index, entry ->
      val rowHeight = alternativeRowHeight()
      val rowBottom = rowTop + rowHeight
      canvas.drawLine(left, rowTop, right, rowTop, dividerPaint)

      val saveSize = dp(24f)
      val saveTop = rowTop + (rowHeight - saveSize) / 2f
      val saveRect = RectF(right - saveSize, saveTop, right, saveTop + saveSize)
      alternativeSaveRects.add(AlternativeSaveRect(index, saveRect))
      val canToggle = !entry.definition.isNullOrBlank() && card.savingAlternativeIndex != index
      val altSavePaint = if (entry.saved) buttonPaint else secondaryButtonPaint
      canvas.drawOval(saveRect, altSavePaint)
      if (!entry.saved) {
        canvas.drawOval(saveRect, buttonStrokePaint)
      }
      when {
        card.savingAlternativeIndex == index -> canvas.drawText(
          "...",
          saveRect.centerX(),
          saveRect.centerY() + dp(5f),
          secondaryButtonTextPaint
        )
        entry.saved -> drawCheckIcon(canvas, saveRect)
        canToggle -> drawPlusIcon(canvas, saveRect)
        else -> canvas.drawText("-", saveRect.centerX(), saveRect.centerY() + dp(5f), secondaryButtonTextPaint)
      }

      val wordWidth = (right - left - saveSize - dp(12f)).coerceAtLeast(dp(80f))
      val wordText = ellipsize(entry.word, cardMetaPaint, wordWidth * 0.62f)
      val wordBaseline = rowTop + dp(23f)
      canvas.drawText(wordText, left, wordBaseline, cardMetaPaint)
      val hanjaLeft = left + cardMetaPaint.measureText(wordText) + dp(6f)
      drawHanjaInlineGroup(
        canvas = canvas,
        hanja = entry.hanja,
        x = hanjaLeft,
        baseline = wordBaseline,
        maxRight = right - saveSize - dp(10f),
        sourceWord = entry.word
      )

      val definition = entry.definition ?: "No English definition available"
      canvas.drawText(
        ellipsize(definition, cardBodyPaint, right - left - saveSize - dp(12f)),
        left,
        rowTop + dp(45f),
        cardBodyPaint
      )
      rowTop = rowBottom
    }

    return rowTop
  }

  private fun drawChevronIcon(canvas: Canvas, rect: RectF, up: Boolean) {
    iconPaint.color = Color.rgb(155, 142, 118)
    iconPaint.strokeWidth = dp(2f)
    val left = rect.centerX() - dp(5f)
    val right = rect.centerX() + dp(5f)
    val centerY = rect.centerY()
    if (up) {
      canvas.drawLine(left, centerY + dp(3f), rect.centerX(), centerY - dp(3f), iconPaint)
      canvas.drawLine(rect.centerX(), centerY - dp(3f), right, centerY + dp(3f), iconPaint)
    } else {
      canvas.drawLine(left, centerY - dp(3f), rect.centerX(), centerY + dp(3f), iconPaint)
      canvas.drawLine(rect.centerX(), centerY + dp(3f), right, centerY - dp(3f), iconPaint)
    }
  }

  private fun drawHorizontalChevron(canvas: Canvas, rect: RectF, leftDirection: Boolean) {
    iconPaint.color = Color.rgb(155, 142, 118)
    iconPaint.strokeWidth = dp(2f)
    val centerX = rect.centerX()
    val centerY = rect.centerY()
    if (leftDirection) {
      canvas.drawLine(centerX + dp(3f), centerY - dp(5f), centerX - dp(3f), centerY, iconPaint)
      canvas.drawLine(centerX - dp(3f), centerY, centerX + dp(3f), centerY + dp(5f), iconPaint)
    } else {
      canvas.drawLine(centerX - dp(3f), centerY - dp(5f), centerX + dp(3f), centerY, iconPaint)
      canvas.drawLine(centerX + dp(3f), centerY, centerX - dp(3f), centerY + dp(5f), iconPaint)
    }
  }

  private fun drawPanelSurface(canvas: Canvas, rect: RectF) {
    val radius = dp(16f)
    canvas.drawRoundRect(rect, radius, radius, panelShadowPaint)
    canvas.drawRoundRect(rect, radius, radius, cardPaint)
    canvas.drawRoundRect(rect, radius, radius, cardStrokePaint)
  }

  private fun measureHanjaGroup(hanja: String?): Float {
    val cleaned = hanja?.trim().orEmpty()
    if (cleaned.isEmpty()) {
      return 0f
    }

    var width = hanjaParenPaint.measureText("(") + hanjaParenPaint.measureText(")")
    cleaned.forEach { char ->
      width += hanjaPaint.measureText(char.toString()) + dp(2f)
    }
    return width
  }

  private fun drawHanjaInlineGroup(
    canvas: Canvas,
    hanja: String?,
    x: Float,
    baseline: Float,
    maxRight: Float,
    sourceWord: String
  ): Float {
    val cleaned = hanja?.trim().orEmpty()
    if (cleaned.isEmpty()) {
      return x
    }

    var cursor = x
    if (cursor + hanjaParenPaint.measureText("(") > maxRight) {
      return cursor
    }

    canvas.drawText("(", cursor, baseline, hanjaParenPaint)
    cursor += hanjaParenPaint.measureText("(")
    cleaned.forEach { char ->
      val charText = char.toString()
      val isActive = hanjaPopup?.character == charText
      val textPaint = if (isActive) hanjaActivePaint else hanjaPaint
      val charWidth = textPaint.measureText(charText)
      if (cursor + charWidth > maxRight) {
        return cursor
      }

      canvas.drawText(charText, cursor, baseline, textPaint)
      if (isHanja(char)) {
        hanjaUnderlinePaint.color = if (isActive) Color.rgb(200, 125, 0) else Color.rgb(155, 142, 118)
        canvas.drawLine(cursor, baseline + dp(2f), cursor + charWidth, baseline + dp(2f), hanjaUnderlinePaint)
        hanjaTouchRects.add(
          HanjaTouchRect(
            character = charText,
            sourceWord = sourceWord,
            rect = RectF(cursor - dp(3f), baseline - dp(18f), cursor + charWidth + dp(3f), baseline + dp(5f))
          )
        )
      }
      cursor += charWidth + dp(2f)
    }
    if (cursor + hanjaParenPaint.measureText(")") <= maxRight) {
      canvas.drawText(")", cursor, baseline, hanjaParenPaint)
      cursor += hanjaParenPaint.measureText(")")
    }

    return cursor
  }

  private fun drawHanjaPopup(canvas: Canvas) {
    val popup = hanjaPopup ?: return
    relatedKnownRects.clear()
    hanjaLoadMoreRect.setEmpty()

    val popupWidth = if (!cardRect.isEmpty) cardRect.width() else lookupCardWidth()
    val relatedCount = if (popup.state == HanjaPopupState.LOADED) {
      visibleHanjaRelatedCount(popup)
    } else {
      0
    }
    val contentHeight = if (popup.state == HanjaPopupState.LOADED && popup.relatedWords.isNotEmpty()) {
      dp(73f) + dp(32f) + hanjaRelatedContentHeight(popup) + dp(8f)
    } else {
      dp(138f)
    }
    val popupHeight = contentHeight.coerceAtMost(dp(430f)).coerceAtLeast(dp(126f))
    val left = if (!cardRect.isEmpty) cardRect.left else lookupCardLeft(popupWidth)
    val aboveCardTop = if (!cardRect.isEmpty) cardRect.top - popupHeight - dp(9f) else dp(82f)
    val top = if (aboveCardTop >= dp(64f)) {
      aboveCardTop
    } else {
      min(height - popupHeight - dp(20f), dp(82f)).coerceAtLeast(dp(20f))
    }

    hanjaPopupRect.set(left, top, left + popupWidth, top + popupHeight)
    drawPopupSurface(canvas, hanjaPopupRect)
    hanjaPopupCloseRect.setEmpty()

    val contentLeft = hanjaPopupRect.left + dp(15f)
    val contentRight = hanjaPopupRect.right - dp(15f)
    val headerBottom = hanjaPopupRect.top + dp(73f)
    val headerRect = RectF(hanjaPopupRect.left, hanjaPopupRect.top, hanjaPopupRect.right, headerBottom)
    canvas.save()
    panelClipPath.reset()
    panelClipPath.addRoundRect(hanjaPopupRect, dp(16f), dp(16f), Path.Direction.CW)
    canvas.clipPath(panelClipPath)
    canvas.drawRect(headerRect, popupHeaderPaint)
    canvas.restore()
    canvas.drawRoundRect(hanjaPopupRect, dp(16f), dp(16f), popupStrokePaint)

    val tileRect = RectF(contentLeft, hanjaPopupRect.top + dp(13f), contentLeft + dp(46f), hanjaPopupRect.top + dp(59f))

    canvas.drawRoundRect(tileRect, dp(10f), dp(10f), popupTilePaint)
    canvas.drawRoundRect(tileRect, dp(10f), dp(10f), popupTileStrokePaint)
    canvas.drawText(popup.character, tileRect.centerX() - popupTitlePaint.measureText(popup.character) / 2f, tileRect.centerY() + dp(10f), popupTitlePaint)

    val textLeft = tileRect.right + dp(12f)
    val reading = when (popup.state) {
      HanjaPopupState.LOADING -> "Loading..."
      HanjaPopupState.ERROR -> "Hanja"
      HanjaPopupState.LOADED -> popup.sound?.takeIf(String::isNotBlank) ?: "Hanja"
    }
    val meaning = when (popup.state) {
      HanjaPopupState.LOADING -> popup.message ?: "Loading hanja..."
      HanjaPopupState.ERROR -> popup.message ?: "Hanja lookup failed."
      HanjaPopupState.LOADED -> popup.meaning?.takeIf(String::isNotBlank) ?: "No hanja details found."
    }
    val meaningPaint = if (popup.state == HanjaPopupState.ERROR) cardErrorPaint else popupMeaningPaint
    canvas.drawText(ellipsize(reading, popupReadingPaint, contentRight - textLeft), textLeft, hanjaPopupRect.top + dp(31f), popupReadingPaint)
    canvas.drawText(ellipsize(meaning, meaningPaint, contentRight - textLeft), textLeft, hanjaPopupRect.top + dp(49f), meaningPaint)
    canvas.drawLine(hanjaPopupRect.left, headerBottom, hanjaPopupRect.right, headerBottom, dividerPaint)

    val labelBaseline = headerBottom + dp(21f)
    canvas.drawText("RELATED WORDS", contentLeft, labelBaseline, relatedHeaderPaint)
    canvas.drawText("tap ✓ to mark known", contentRight, labelBaseline, relatedHintPaint)

    if (popup.state == HanjaPopupState.LOADED && popup.relatedWords.isNotEmpty()) {
      val listTop = headerBottom + dp(32f)
      val listBottom = hanjaPopupRect.bottom - dp(8f)
      val maxScroll = maxHanjaPopupScroll(popup)
      val scrollOffset = popup.relatedScrollOffset.coerceIn(0f, maxScroll)
      val hasMore = hasMoreHanjaRelatedWords(popup)

      canvas.save()
      canvas.clipRect(contentLeft, listTop, contentRight, listBottom)

      popup.relatedWords.take(relatedCount).forEachIndexed { index, related ->
        val rowTop = listTop + index * dp(50f) - scrollOffset
        val rowBottom = rowTop + dp(50f)
        if (rowBottom >= listTop && rowTop <= listBottom) {
          drawHanjaRelatedRow(canvas, popup, related, index, contentLeft, contentRight, rowTop)
        }
      }

      if (hasMore || popup.loadingMoreRelated) {
        val loadTop = listTop + relatedCount * dp(50f) - scrollOffset
        val loadBottom = loadTop + dp(42f)

        if (loadBottom >= listTop && loadTop <= listBottom) {
          hanjaLoadMoreRect.set(contentLeft, loadTop, contentRight, loadBottom)
          if (popup.loadingMoreRelated) {
            drawLoadingSpinner(canvas, hanjaLoadMoreRect.centerX(), hanjaLoadMoreRect.centerY(), dp(8f))
          } else {
            val label = "MORE"
            val labelX = hanjaLoadMoreRect.centerX() - relatedHeaderPaint.measureText(label) / 2f
            canvas.drawText(label, labelX, hanjaLoadMoreRect.centerY() + dp(4f), relatedHeaderPaint)
          }
        }
      }

      canvas.restore()
    } else if (popup.state != HanjaPopupState.LOADING) {
      canvas.drawText(
        "No related words available",
        contentLeft,
        headerBottom + dp(62f),
        popupMeaningPaint
      )
    }
  }

  private fun drawPopupSurface(canvas: Canvas, rect: RectF) {
    val radius = dp(16f)
    canvas.drawRoundRect(rect, radius, radius, panelShadowPaint)
    canvas.drawRoundRect(rect, radius, radius, popupPaint)
    canvas.drawRoundRect(rect, radius, radius, popupStrokePaint)
  }

  private fun drawHanjaRelatedRow(
    canvas: Canvas,
    popup: HanjaPopup,
    related: OverlayHanjaRelatedWord,
    index: Int,
    left: Float,
    right: Float,
    rowTop: Float
  ) {
    val rowBottom = rowTop + dp(50f)
    if (index < visibleHanjaRelatedCount(popup) - 1) {
      canvas.drawLine(left, rowBottom, right, rowBottom, dividerPaint)
    }

    val toggleSize = dp(24f)
    val toggleRect = RectF(right - toggleSize, rowTop + dp(13f), right, rowTop + dp(13f) + toggleSize)
    relatedKnownRects.add(RelatedKnownRect(index, toggleRect))
    drawKnownToggle(canvas, toggleRect, related.known)

    val copyRight = toggleRect.left - dp(10f)
    val korean = related.korean.trim()
    val hanja = related.hanja.trim()
    val koreanText = ellipsize(korean, relatedKoreanPaint, (copyRight - left) * 0.55f)
    canvas.drawText(koreanText, left, rowTop + dp(20f), relatedKoreanPaint)
    val hanjaLeft = left + relatedKoreanPaint.measureText(koreanText) + dp(6f)
    if (hanja.isNotEmpty() && hanjaLeft < copyRight) {
      canvas.drawText(ellipsize(hanja, relatedHanjaPaint, copyRight - hanjaLeft), hanjaLeft, rowTop + dp(20f), relatedHanjaPaint)
    }

    val meaning = related.meaning.trim()
    if (meaning.isNotEmpty()) {
      canvas.drawText(ellipsize(meaning, popupMeaningPaint, copyRight - left), left, rowTop + dp(38f), popupMeaningPaint)
    }
  }

  private fun drawLoadingSpinner(canvas: Canvas, centerX: Float, centerY: Float, radius: Float) {
    val spinnerRect = RectF(centerX - radius, centerY - radius, centerX + radius, centerY + radius)
    val startAngle = ((SystemClock.uptimeMillis() % 900L).toFloat() / 900f) * 360f
    iconPaint.color = Color.rgb(155, 142, 118)
    iconPaint.strokeWidth = dp(2f)
    iconPaint.style = Paint.Style.STROKE
    canvas.drawArc(spinnerRect, startAngle, 275f, false, iconPaint)
    postInvalidateOnAnimation()
  }

  private fun drawKnownToggle(canvas: Canvas, rect: RectF, known: Boolean) {
    if (known) {
      canvas.drawOval(rect, buttonPaint)
      drawCheckIcon(canvas, rect)
    } else {
      canvas.drawOval(rect, secondaryButtonPaint)
      canvas.drawOval(rect, buttonStrokePaint)
      drawPlusIcon(canvas, rect)
    }
  }

  private fun drawPlusIcon(canvas: Canvas, rect: RectF) {
    iconPaint.color = Color.rgb(155, 142, 118)
    iconPaint.strokeWidth = dp(1.8f)
    val half = dp(4.5f)
    canvas.drawLine(rect.centerX(), rect.centerY() - half, rect.centerX(), rect.centerY() + half, iconPaint)
    canvas.drawLine(rect.centerX() - half, rect.centerY(), rect.centerX() + half, rect.centerY(), iconPaint)
  }

  private fun drawCheckIcon(canvas: Canvas, rect: RectF) {
    iconPaint.color = Color.WHITE
    iconPaint.strokeWidth = dp(2.2f)
    val centerX = rect.centerX()
    val centerY = rect.centerY()
    canvas.drawLine(centerX - dp(6f), centerY, centerX - dp(2f), centerY + dp(4f), iconPaint)
    canvas.drawLine(centerX - dp(2f), centerY + dp(4f), centerX + dp(7f), centerY - dp(6f), iconPaint)
  }

  private fun findTargetAt(x: Float, y: Float, result: SerializedOcrResult): OcrTapSelection? {
    val transform = currentTransform(result)
    val imageX = transform.overlayToImageX(x)
    val visibleTargets = visibleTargets(result)

    return visibleTargets.asReversed().firstNotNullOfOrNull { target ->
      val containsTap = transform.mapRect(target.box).apply {
        inset(-dp(8f), -dp(8f))
      }.contains(x, y)

      if (containsTap) {
        target.selectionAtImageX(imageX)
      } else {
        null
      }
    }
  }

  private fun navigateLookupWord(card: LookupCard, delta: Int) {
    val options = card.wordOptions
    if (options.size <= 1) {
      return
    }

    val nextIndex = (card.activeWordIndex + delta + options.size) % options.size
    val nextSelection = card.selection.copy(
      selectedText = options[nextIndex],
      kind = "word"
    )

    lookupCard = card.copy(
      selection = nextSelection,
      activeWordIndex = nextIndex,
      state = LookupCardState.LOADING,
      surface = options[nextIndex],
      stem = "",
      definition = null,
      translation = null,
      translationSourceLanguage = null,
      translationTargetLanguage = null,
      hanja = null,
      pos = null,
      romanization = null,
      saved = false,
      alternatives = emptyList(),
      hanjaPreloads = emptyList(),
      showingTranslation = false,
      expandedAlternatives = false,
      savingAlternativeIndex = null,
      message = "Looking up..."
    )
    hanjaPopup = null
    invalidate()
    onWordNavigationRequested(nextSelection)
  }

  private fun lookupWordOptionsFor(selection: OcrTapSelection): List<String> {
    val selected = selection.selectedText.trim()
    val current = lookupCard
    if (
      current != null &&
      current.wordOptions.size > 1 &&
      current.selection.lineText == selection.lineText &&
      current.wordOptions.contains(selected)
    ) {
      return current.wordOptions
    }

    val tokens = splitLookupWords(selection.selectedText)
    return tokens.ifEmpty { listOfNotNull(selected.takeIf(String::isNotEmpty)) }
  }

  private fun splitLookupWords(text: String): List<String> {
    val seen = linkedSetOf<String>()
    text.split(Regex("\\s+"))
      .map { token ->
        token.trim { char -> char.isWhitespace() || !char.isLetterOrDigit() }
      }
      .filter(String::isNotBlank)
      .forEach(seen::add)

    return seen.toList()
  }

  private fun visibleTargets(result: SerializedOcrResult): List<OcrTapTarget> {
    val wordTargets = result.targets.filter { it.kind == "word" }
    return wordTargets.ifEmpty { result.targets }
  }

  private fun currentTransform(result: SerializedOcrResult): ImageToOverlayTransform {
    val imageWidth = (result.result["imageWidth"] as? Number)?.toFloat()?.takeIf { it > 0f } ?: width.toFloat()
    val imageHeight = (result.result["imageHeight"] as? Number)?.toFloat()?.takeIf { it > 0f } ?: height.toFloat()
    val overlayWidth = width.toFloat().takeIf { it > 0f } ?: imageWidth
    val overlayHeight = height.toFloat().takeIf { it > 0f } ?: imageHeight

    return ImageToOverlayTransform(
      imageWidth = imageWidth,
      imageHeight = imageHeight,
      overlayWidth = overlayWidth,
      overlayHeight = overlayHeight
    )
  }

  private fun logOverlayGeometry(result: SerializedOcrResult, transform: ImageToOverlayTransform) {
    val key = "${width}x$height:${transform.imageWidth}x${transform.imageHeight}:${result.targets.size}"
    if (key == lastGeometryLogKey) {
      return
    }

    lastGeometryLogKey = key
    val firstBoxes = result.targets
      .take(10)
      .joinToString(separator = " | ") { target ->
        "${target.kind}:${target.text.take(28)}@${target.box.flattenToString()}"
      }

    Log.d(
      TAG,
      "overlay=${width}x$height " +
        "image=${transform.imageWidth}x${transform.imageHeight} " +
        "scaleX=${transform.scaleX} scaleY=${transform.scaleY} " +
        "targets=${result.targets.size} " +
        "firstTargets=$firstBoxes"
    )
  }

  private fun buildMetaLine(card: LookupCard): String =
    listOf(
      card.romanization,
      if (card.surface != card.stem) "from ${card.surface}" else null
    )
      .mapNotNull { it?.trim()?.takeIf(String::isNotEmpty) }
      .joinToString(" · ")

  private fun formatPos(pos: String?): String {
    val normalized = pos?.trim()?.replace(Regex("\\s+"), " ").orEmpty()
    if (normalized.isEmpty()) {
      return ""
    }

    val compact = normalized.replace(" ", "")
    val mapped = POS_LABELS[normalized] ?: POS_LABELS[compact]
    if (mapped != null) {
      return mapped
    }

    return if (normalized.any { it in '\uAC00'..'\uD7A3' }) {
      ""
    } else {
      normalized.replace("_", " ").uppercase()
    }
  }

  private fun isHanja(char: Char): Boolean =
    char in '\u3400'..'\u4DBF' ||
      char in '\u4E00'..'\u9FFF' ||
      char in '\uF900'..'\uFAFF'

  private fun wrapText(text: String, paint: TextPaint, maxWidth: Float, maxLines: Int): List<String> {
    val words = text.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
    if (words.isEmpty()) {
      return emptyList()
    }

    val lines = mutableListOf<String>()
    var current = ""
    for (word in words) {
      val candidate = if (current.isEmpty()) word else "$current $word"
      if (paint.measureText(candidate) <= maxWidth) {
        current = candidate
      } else {
        if (current.isNotEmpty()) {
          lines.add(current)
        }
        current = word
      }

      if (lines.size == maxLines) {
        break
      }
    }

    if (lines.size < maxLines && current.isNotEmpty()) {
      lines.add(current)
    }

    if (lines.size == maxLines && paint.measureText(lines.last()) > maxWidth) {
      lines[lines.lastIndex] = ellipsize(lines.last(), paint, maxWidth)
    }

    return lines.mapIndexed { index, line ->
      if (index == maxLines - 1 && lines.size == maxLines) {
        ellipsize(line, paint, maxWidth)
      } else {
        line
      }
    }
  }

  private fun ellipsize(text: String, paint: Paint, maxWidth: Float): String {
    if (paint.measureText(text) <= maxWidth) {
      return text
    }

    val suffix = "..."
    val suffixWidth = paint.measureText(suffix)
    val count = paint.breakText(text, true, (maxWidth - suffixWidth).coerceAtLeast(0f), null)
    return text.take(count).trimEnd() + suffix
  }

  private fun alternativeRowHeight(): Float = dp(58f)

  private fun dp(value: Float): Float = value * density
}

private data class LookupCard(
  val requestId: String,
  val selection: OcrTapSelection,
  val wordOptions: List<String>,
  val activeWordIndex: Int,
  val state: LookupCardState,
  val surface: String,
  val stem: String,
  val definition: String?,
  val translation: String?,
  val translationSourceLanguage: String?,
  val translationTargetLanguage: String?,
  val hanja: String?,
  val pos: String?,
  val romanization: String?,
  val saved: Boolean,
  val alternatives: List<OverlayDefinitionEntry>,
  val hanjaPreloads: List<OverlayHanjaPreload>,
  val showingTranslation: Boolean,
  val expandedAlternatives: Boolean,
  val savingAlternativeIndex: Int?,
  val message: String?
) {
  val displayBody: String
    get() = when (state) {
      LookupCardState.LOADING -> message ?: "Looking up..."
      LookupCardState.SAVING -> message ?: "Saving..."
      LookupCardState.ERROR -> message ?: "Lookup failed."
      LookupCardState.FALLBACK -> message ?: "Open FluentFable to look this up."
      LookupCardState.LOADED -> definition ?: "No definition found."
    }

  val showSaveButton: Boolean
    get() = state == LookupCardState.LOADED || state == LookupCardState.SAVING

  val canToggleSave: Boolean
    get() = state == LookupCardState.LOADED && !definition.isNullOrBlank()

}

private fun loadReaderSerifTypeface(context: Context, bold: Boolean): Typeface {
  val assetNames = if (bold) {
    listOf(
      "NotoSerifKR_700Bold.ttf",
      "fonts/NotoSerifKR_700Bold.ttf",
      "node_modules/@expo-google-fonts/noto-serif-kr/NotoSerifKR_700Bold.ttf"
    )
  } else {
    listOf(
      "NotoSerifKR_500Medium.ttf",
      "NotoSerifKR_400Regular.ttf",
      "fonts/NotoSerifKR_500Medium.ttf",
      "fonts/NotoSerifKR_400Regular.ttf",
      "node_modules/@expo-google-fonts/noto-serif-kr/NotoSerifKR_500Medium.ttf",
      "node_modules/@expo-google-fonts/noto-serif-kr/NotoSerifKR_400Regular.ttf"
    )
  }

  assetNames.forEach { assetName ->
    runCatching {
      return Typeface.createFromAsset(context.assets, assetName)
    }
  }

  return Typeface.create("serif", if (bold) Typeface.BOLD else Typeface.NORMAL)
}

private fun loadReaderSansTypeface(context: Context, weight: String): Typeface {
  val assetNames = when (weight) {
    "bold" -> listOf(
      "DMSans_700Bold.ttf",
      "fonts/DMSans_700Bold.ttf",
      "node_modules/@expo-google-fonts/dm-sans/700Bold/DMSans_700Bold.ttf"
    )
    "medium" -> listOf(
      "DMSans_500Medium.ttf",
      "fonts/DMSans_500Medium.ttf",
      "node_modules/@expo-google-fonts/dm-sans/500Medium/DMSans_500Medium.ttf"
    )
    else -> listOf(
      "DMSans_400Regular.ttf",
      "fonts/DMSans_400Regular.ttf",
      "node_modules/@expo-google-fonts/dm-sans/400Regular/DMSans_400Regular.ttf"
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

private enum class LookupCardState {
  LOADING,
  LOADED,
  SAVING,
  ERROR,
  FALLBACK
}

private data class HanjaTouchRect(
  val character: String,
  val sourceWord: String,
  val rect: RectF
)

private data class AlternativeSaveRect(
  val index: Int,
  val rect: RectF
)

private data class RelatedKnownRect(
  val index: Int,
  val rect: RectF
)

private data class HanjaPopup(
  val requestId: String,
  val character: String,
  val sourceWord: String,
  val state: HanjaPopupState,
  val meaning: String?,
  val sound: String?,
  val relatedWords: List<OverlayHanjaRelatedWord>,
  val visibleRelatedCount: Int,
  val relatedScrollOffset: Float,
  val loadingMoreRelated: Boolean,
  val message: String?
)

private enum class HanjaPopupState {
  LOADING,
  LOADED,
  ERROR
}

private val POS_LABELS = mapOf(
  "Noun" to "NOUN",
  "Verb" to "VERB",
  "Adverb" to "ADVERB",
  "Adjective" to "ADJECTIVE",
  "Modifier" to "MODIFIER",
  "Determiner" to "DETERMINER",
  "명사" to "NOUN",
  "동사" to "VERB",
  "형용사" to "ADJECTIVE",
  "부사" to "ADVERB",
  "관형사" to "DETERMINER",
  "감탄사" to "INTERJECTION",
  "대명사" to "PRONOUN",
  "수사" to "NUMERAL",
  "조사" to "PARTICLE",
  "접사" to "AFFIX",
  "어미" to "ENDING",
  "보조 동사" to "AUXILIARY VERB",
  "보조동사" to "AUXILIARY VERB",
  "보조 형용사" to "AUXILIARY ADJECTIVE",
  "보조형용사" to "AUXILIARY ADJECTIVE",
  "의존명사" to "DEPENDENT NOUN",
  "의존 명사" to "DEPENDENT NOUN",
  "품사없음" to "",
  "품사 없음" to ""
)

private const val MAX_VISIBLE_ALTERNATIVES = 3

private data class ImageToOverlayTransform(
  val imageWidth: Float,
  val imageHeight: Float,
  val overlayWidth: Float,
  val overlayHeight: Float
) {
  val scaleX: Float = overlayWidth / imageWidth
  val scaleY: Float = overlayHeight / imageHeight

  fun mapRect(rect: android.graphics.Rect): RectF =
    RectF(
      rect.left * scaleX,
      rect.top * scaleY,
      rect.right * scaleX,
      rect.bottom * scaleY
    )

  fun overlayToImageX(x: Float): Float =
    (x / scaleX).coerceIn(0f, imageWidth)
}

private const val TAG = "OcrResultOverlay"
