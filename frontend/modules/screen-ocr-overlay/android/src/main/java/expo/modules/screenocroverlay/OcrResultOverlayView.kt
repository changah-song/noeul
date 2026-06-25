package expo.modules.screenocroverlay

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.os.SystemClock
import android.text.TextPaint
import android.util.Log
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import java.util.UUID
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

private const val HANJA_RELATED_PAGE_SIZE = 5
private const val HANJA_LOAD_MORE_DELAY_MS = 650L
private const val DICTIONARY_COMPACT_HEIGHT_DP = 252f
private const val DICTIONARY_NO_ROOT_HEIGHT_DP = 215f
private const val DICTIONARY_TRANSLATION_HEIGHT_DP = 332f
private const val DICTIONARY_EXPANDED_MAX_HEIGHT_DP = 548f
private const val TRANSLATION_MAX_SCROLL_HEIGHT_DP = 150f
private const val TRANSLATION_PANEL_BOTTOM_PADDING_DP = 22f
private const val TOP_PLACEMENT_TRANSLATION_TOP_PADDING_DP = 22f
private const val TOP_PLACEMENT_TRANSLATION_BOTTOM_PADDING_DP = 10f
private const val LOOKUP_LOADING_SHIMMER_DURATION_MS = 1400L
private const val ROOT_RELATED_INITIAL_VISIBLE_COUNT = 2
private const val ROOT_RELATED_PAGE_SIZE = 3

class OcrResultOverlayView(
  context: Context,
  private var ocrResult: SerializedOcrResult? = null,
  private val onTargetSelected: (OcrTapSelection) -> Unit,
  private val onWordNavigationRequested: (OcrTapSelection) -> Unit,
  private val onTranslationRequested: (String, String) -> Unit,
  private val onSaveRequested: (String, Int?) -> Unit,
  private val onHanjaRequested: (String, String) -> String?,
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
  private val translateIconPath = Path()
  private val panelClipPath = Path()
  private val boxPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.argb(33, 61, 79, 114)
    style = Paint.Style.FILL
  }
  private val boxStrokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(61, 79, 114)
    strokeWidth = dp(1.5f)
    style = Paint.Style.STROKE
  }
  private val selectedBoxPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(61, 79, 114)
    style = Paint.Style.FILL
  }
  private val regionBoxPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.argb(61, 61, 79, 114)
    style = Paint.Style.FILL
  }
  private val dimPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.TRANSPARENT
    style = Paint.Style.FILL
  }
  private val closePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.argb(230, 32, 38, 49)
    style = Paint.Style.FILL
  }
  private val closeIconPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(250, 248, 245)
    strokeCap = Paint.Cap.ROUND
    strokeJoin = Paint.Join.ROUND
    strokeWidth = 64f
    style = Paint.Style.STROKE
  }
  private val closeBorderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(53, 60, 71)
    strokeWidth = dp(1f)
    style = Paint.Style.STROKE
  }
  private val glyphPath = Path()
  private val emptyPillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.argb(199, 27, 28, 28)
    style = Paint.Style.FILL
  }
  private val emptyIconPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(216, 217, 219)
    strokeWidth = dp(1.8f)
    strokeCap = Paint.Cap.ROUND
    style = Paint.Style.STROKE
  }
  private val emptyTextPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(216, 217, 219)
    textAlign = Paint.Align.CENTER
    textSize = dp(13f)
    typeface = englishRegularTypeface
  }
  private val cardPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.WHITE
    style = Paint.Style.FILL
  }
  private val cardStrokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(228, 226, 226)
    strokeWidth = dp(1f)
    style = Paint.Style.STROKE
  }
  private val panelShadowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.WHITE
    style = Paint.Style.FILL
    setShadowLayer(dp(30f), 0f, -dp(10f), Color.argb(20, 27, 28, 28))
  }
  private val cardTitlePaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(27, 28, 28)
    textSize = dp(28f)
    typeface = koreanBoldTypeface
  }
  private val headingHanjaPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(68, 71, 75)
    textSize = dp(17f)
    typeface = koreanRegularTypeface
  }
  private val romanizationPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(117, 119, 123)
    textSize = dp(14f)
    typeface = Typeface.create(Typeface.SERIF, Typeface.ITALIC)
  }
  private val eyebrowPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(154, 156, 159)
    textSize = dp(9f)
    typeface = englishBoldTypeface
    isFakeBoldText = true
    letterSpacing = 0.2f
  }
  private val cardMetaPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(117, 119, 123)
    textSize = dp(13f)
    typeface = englishRegularTypeface
  }
  private val translationLangPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(117, 119, 123)
    textSize = dp(11f)
    typeface = englishRegularTypeface
    letterSpacing = 0.08f
  }
  private val translationCopyPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(154, 156, 159)
    textSize = dp(10f)
    typeface = englishMediumTypeface
    letterSpacing = 0.16f
  }
  private val cardBodyPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(68, 71, 75)
    textSize = dp(15f)
    typeface = englishRegularTypeface
    isFakeBoldText = false
  }
  private val cardErrorPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(117, 119, 123)
    textSize = dp(14f)
    typeface = Typeface.create(Typeface.SERIF, Typeface.ITALIC)
  }
  private val buttonPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(32, 38, 49)
    style = Paint.Style.FILL
  }
  private val secondaryButtonPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(255, 255, 255)
    style = Paint.Style.FILL
  }
  private val buttonStrokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(228, 226, 226)
    strokeWidth = dp(1f)
    style = Paint.Style.STROKE
  }
  private val buttonTextPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.WHITE
    textAlign = Paint.Align.CENTER
    textSize = dp(11f)
    typeface = englishBoldTypeface
    isFakeBoldText = true
    letterSpacing = 0.18f
  }
  private val secondaryButtonTextPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(32, 38, 49)
    textAlign = Paint.Align.CENTER
    textSize = dp(11f)
    typeface = englishBoldTypeface
    isFakeBoldText = true
    letterSpacing = 0.18f
  }
  private val wordNavCountPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(154, 156, 159)
    textAlign = Paint.Align.CENTER
    textSize = dp(10.5f)
    typeface = englishBoldTypeface
    isFakeBoldText = true
  }
  private val hanjaPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(68, 71, 75)
    textSize = dp(16f)
    typeface = koreanRegularTypeface
  }
  private val hanjaActivePaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(32, 38, 49)
    textSize = dp(16f)
    typeface = koreanRegularTypeface
  }
  private val hanjaParenPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(68, 71, 75)
    textSize = dp(16f)
    typeface = koreanRegularTypeface
  }
  private val hanjaUnderlinePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(197, 198, 203)
    strokeWidth = dp(1.5f)
    style = Paint.Style.STROKE
    pathEffect = DashPathEffect(floatArrayOf(dp(1.25f), dp(2f)), 0f)
  }
  private val badgePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.TRANSPARENT
    style = Paint.Style.FILL
  }
  private val badgeTextPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(92, 94, 99)
    textAlign = Paint.Align.CENTER
    textSize = dp(12f)
    typeface = englishBoldTypeface
    isFakeBoldText = true
    letterSpacing = 0.155f
  }
  private val dividerPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(236, 234, 234)
    strokeWidth = dp(1f)
    style = Paint.Style.STROKE
  }
  private val skeletonBasePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(240, 237, 237)
    style = Paint.Style.FILL
  }
  private val skeletonEdgePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(235, 232, 232)
    style = Paint.Style.FILL
  }
  private val skeletonCorePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(230, 227, 227)
    style = Paint.Style.FILL
  }
  private val skeletonShimmerPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.FILL
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
  private val rootCarouselRect = RectF()
  private val hanjaPopupRect = RectF()
  private val hanjaPopupCloseRect = RectF()
  private val hanjaLoadMoreRect = RectF()
  private val multiSelectPanelRect = RectF()
  private val multiSelectTranslateRect = RectF()
  private val multiSelectClearRect = RectF()
  private val hanjaTouchRects = mutableListOf<HanjaTouchRect>()
  private val alternativeSaveRects = mutableListOf<AlternativeSaveRect>()
  private val relatedKnownRects = mutableListOf<RelatedKnownRect>()
  private val rootSeeMoreRects = mutableListOf<RootSeeMoreRect>()
  private val multiSelectModeRects = mutableListOf<MultiSelectModeRect>()
  private val multiSelectTargets = mutableListOf<OcrTapTarget>()
  private val multiSelectTargetKeys = mutableSetOf<String>()
  private var lookupCard: LookupCard? = null
  private var lookupPanelPlacement = LookupPanelPlacement.BOTTOM
  private var isLookupExpanded = false
  private var activeRootCharacterIndex = 0
  private val rootRelatedVisibleCounts = mutableMapOf<String, Int>()
  private var panelGestureCandidate = false
  private var panelGestureActive = false
  private var panelGestureStartX = 0f
  private var panelGestureStartY = 0f
  private var rootCarouselGestureCandidate = false
  private var rootCarouselGestureActive = false
  private var rootCarouselStartX = 0f
  private var rootCarouselStartY = 0f
  private var rootCarouselDragX = 0f
  private var hanjaPopup: HanjaPopup? = null
  private var hanjaPopupTouchStartY = 0f
  private var hanjaPopupTouchLastY = 0f
  private var isDraggingHanjaPopup = false
  private var hanjaLoadMoreRunnable: Runnable? = null
  private var lastGeometryLogKey = ""
  private var multiSelectMode = MultiSelectOrderMode.LEFT_TO_RIGHT
  private var pendingLongPressTarget: OcrTapTarget? = null
  private var touchStartX = 0f
  private var touchStartY = 0f
  private var longPressHandled = false
  private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
  private val longPressRunnable = Runnable {
    pendingLongPressTarget?.let { target ->
      startMultiSelect(target)
      longPressHandled = true
    }
  }

  init {
    setLayerType(LAYER_TYPE_SOFTWARE, null)
  }

  fun setResult(nextResult: SerializedOcrResult) {
    clearHanjaLoadMore()
    clearMultiSelect()
    ocrResult = nextResult
    lookupCard = null
    isLookupExpanded = false
    activeRootCharacterIndex = 0
    rootRelatedVisibleCounts.clear()
    resetLookupPanelGesture()
    resetRootCarouselGesture()
    hanjaPopup = null
    lastGeometryLogKey = ""
    invalidate()
  }

  fun clearResult() {
    clearHanjaLoadMore()
    clearMultiSelect()
    ocrResult = null
    lookupCard = null
    isLookupExpanded = false
    activeRootCharacterIndex = 0
    rootRelatedVisibleCounts.clear()
    resetLookupPanelGesture()
    resetRootCarouselGesture()
    hanjaPopup = null
    invalidate()
  }

  fun setCloseAnchorRect(anchor: RectF?) {
    closeAnchorRectOnScreen = anchor?.let { RectF(it) }
    invalidate()
  }

  private fun closeLookupPanel() {
    clearHanjaLoadMore()
    clearMultiSelect()
    lookupCard = null
    isLookupExpanded = false
    activeRootCharacterIndex = 0
    rootRelatedVisibleCounts.clear()
    resetLookupPanelGesture()
    resetRootCarouselGesture()
    hanjaPopup = null
    invalidate()
  }

  fun showLookupLoading(requestId: String, selection: OcrTapSelection) {
    clearHanjaLoadMore()
    lookupPanelPlacement = placementForSelection(selection)
    isLookupExpanded = false
    activeRootCharacterIndex = 0
    rootRelatedVisibleCounts.clear()
    resetLookupPanelGesture()
    resetRootCarouselGesture()
    val wordOptions = lookupWordOptionsFor(selection)
    val activeWordIndex = wordOptions.indexOf(selection.selectedText.trim()).takeIf { it >= 0 } ?: 0
    lookupCard = LookupCard(
      requestId = requestId,
      selection = selection,
      wordOptions = wordOptions,
      activeWordIndex = activeWordIndex,
      state = LookupCardState.LOADING,
      surface = selection.selectedText,
      sourceSentence = selection.lineText,
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
      translationRequested = false,
      expandedAlternatives = false,
      savingAlternativeIndex = null,
      message = OverlayText.t("lookingUp")
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
    val nextCard = LookupCard(
      requestId = result.requestId,
      selection = selection,
      wordOptions = wordOptions,
      activeWordIndex = activeWordIndex,
      state = if (currentCard.state == LookupCardState.SAVING) currentCard.state else LookupCardState.LOADED,
      surface = result.surface,
      sourceSentence = result.sourceSentence,
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
      translationRequested = currentCard.translationRequested || !result.translation.isNullOrBlank(),
      expandedAlternatives = currentCard.expandedAlternatives,
      savingAlternativeIndex = currentCard.savingAlternativeIndex,
      message = if (currentCard.state == LookupCardState.SAVING) currentCard.message else null
    )
    lookupCard = nextCard
    clampRootCharacterIndex(nextCard)
    if (!canExpandLookup(nextCard)) {
      isLookupExpanded = false
    }
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
      message = if (alternativeIndex == null) OverlayText.t("saving") else current.message
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
      message = OverlayText.t("loadingHanja")
    )
    invalidate()
  }

  private fun showCachedHanjaResult(requestId: String, sourceWord: String, result: OverlayHanjaPreload) {
    clearHanjaLoadMore()
    hanjaPopup = HanjaPopup(
      requestId = requestId,
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
      message = message.ifBlank { OverlayText.t("hanjaLookupFailed") }
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
    drawBoxes(canvas, currentResult)
    drawCloseButton(canvas)
    drawEmptyState(canvas, currentResult)
    drawMultiSelectPanel(canvas)
    drawLookupCard(canvas)
    drawHanjaPopup(canvas)
  }

  override fun onTouchEvent(event: MotionEvent): Boolean {
    val currentResult = ocrResult ?: return true

    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        touchStartX = event.x
        touchStartY = event.y
        longPressHandled = false
        beginLookupPanelGesture(event)
        beginRootCarouselGesture(event)
        if (
          lookupCard == null &&
          hanjaPopup == null &&
          !overlayCloseRect.contains(event.x, event.y)
        ) {
          pendingLongPressTarget = findTargetObjectAt(event.x, event.y, currentResult)
          if (pendingLongPressTarget != null) {
            postDelayed(longPressRunnable, ViewConfiguration.getLongPressTimeout().toLong())
          }
        }
        if (hanjaPopupRect.contains(event.x, event.y)) {
          hanjaPopupTouchStartY = event.y
          hanjaPopupTouchLastY = event.y
          isDraggingHanjaPopup = false
        }
        return true
      }
      MotionEvent.ACTION_MOVE -> {
        if (handleRootCarouselGestureMove(event)) {
          return true
        }
        if (handleLookupPanelGestureMove(event)) {
          return true
        }
        if (
          pendingLongPressTarget != null &&
          (abs(event.x - touchStartX) > touchSlop || abs(event.y - touchStartY) > touchSlop)
        ) {
          cancelPendingLongPress()
        }
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
      MotionEvent.ACTION_UP -> {
        val consumedByLongPress = longPressHandled
        cancelPendingLongPress()
        if (finishRootCarouselGesture(event)) {
          return true
        }
        if (finishLookupPanelGesture(event)) {
          return true
        }
        if (consumedByLongPress) {
          return true
        }
      }
      MotionEvent.ACTION_CANCEL -> {
        cancelPendingLongPress()
        resetLookupPanelGesture()
        resetRootCarouselGesture()
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
          onHanjaRequested(target.character, target.sourceWord)?.let { requestId ->
            showCachedHanjaResult(requestId, target.sourceWord, cachedHanja)
          }
        } else {
          onHanjaRequested(target.character, target.sourceWord)
        }
        return true
      }
      relatedKnownRects.firstOrNull { it.rect.contains(event.x, event.y) && it.embeddedRoot }?.let { target ->
        if (toggleRootRelatedKnown(card, target)) {
          return true
        }
      }
      rootSeeMoreRects.firstOrNull { it.rect.contains(event.x, event.y) }?.let { target ->
        showMoreRootRelatedWords(target)
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
        val shouldShowTranslation = !card.showingTranslation
        val shouldRequestTranslation = shouldShowTranslation &&
          card.translation.isNullOrBlank() &&
          !card.translationRequested
        lookupCard = card.copy(
          showingTranslation = shouldShowTranslation,
          translationRequested = card.translationRequested || shouldRequestTranslation,
          expandedAlternatives = false
        )
        isLookupExpanded = false
        resetLookupPanelGesture()
        resetRootCarouselGesture()
        hanjaPopup = null
        invalidate()
        if (shouldRequestTranslation) {
          onTranslationRequested(card.requestId, translationQueryForCard(card))
        }
        return true
      }
      if (saveButtonRect.contains(event.x, event.y) && card.canToggleSave) {
        onSaveRequested(card.requestId, null)
        return true
      }
      if (cardRect.contains(event.x, event.y)) {
        return true
      }
      if (card.showingTranslation) {
        closeLookupPanel()
        return true
      }
    }

    if (overlayCloseRect.contains(event.x, event.y)) {
      onClose()
      return true
    }

    if (multiSelectTargets.isNotEmpty()) {
      if (handleMultiSelectTap(event.x, event.y, currentResult)) {
        return true
      }
      return true
    }

    findTargetAt(event.x, event.y, currentResult)?.let { target ->
      onTargetSelected(target)
      return true
    }

    if (lookupCard != null) {
      closeLookupPanel()
      return true
    }

    return true
  }

  private fun beginLookupPanelGesture(event: MotionEvent) {
    val card = lookupCard
    panelGestureCandidate = card != null &&
      hanjaPopup == null &&
      canExpandLookup(card) &&
      cardRect.contains(event.x, event.y)
    panelGestureActive = false
    panelGestureStartX = event.x
    panelGestureStartY = event.y
  }

  private fun handleLookupPanelGestureMove(event: MotionEvent): Boolean {
    if (!panelGestureCandidate) {
      return false
    }

    val dx = event.x - panelGestureStartX
    val dy = event.y - panelGestureStartY
    if (!panelGestureActive) {
      if (abs(dy) <= dp(12f) || abs(dy) <= abs(dx)) {
        return false
      }
      panelGestureActive = true
      cancelPendingLongPress()
    }

    return true
  }

  private fun finishLookupPanelGesture(event: MotionEvent): Boolean {
    if (!panelGestureCandidate) {
      resetLookupPanelGesture()
      return false
    }

    val dy = event.y - panelGestureStartY
    val wasActive = panelGestureActive || abs(dy) > dp(28f)
    if (wasActive) {
      val shouldExpand = if (lookupPanelPlacement == LookupPanelPlacement.TOP) {
        dy > dp(28f)
      } else {
        dy < -dp(28f)
      }
      val shouldCollapse = if (lookupPanelPlacement == LookupPanelPlacement.TOP) {
        dy < -dp(28f)
      } else {
        dy > dp(28f)
      }

      when {
        shouldExpand -> isLookupExpanded = true
        shouldCollapse -> isLookupExpanded = false
      }
      hanjaPopup = null
      invalidate()
    }

    resetLookupPanelGesture()
    return wasActive
  }

  private fun resetLookupPanelGesture() {
    panelGestureCandidate = false
    panelGestureActive = false
    panelGestureStartX = 0f
    panelGestureStartY = 0f
  }

  private fun beginRootCarouselGesture(event: MotionEvent) {
    val card = lookupCard
    rootCarouselGestureCandidate = card != null &&
      hanjaPopup == null &&
      isLookupExpanded &&
      canExpandLookup(card) &&
      !rootCarouselRect.isEmpty &&
      rootCarouselRect.contains(event.x, event.y)
    rootCarouselGestureActive = false
    rootCarouselStartX = event.x
    rootCarouselStartY = event.y
    rootCarouselDragX = 0f
  }

  private fun handleRootCarouselGestureMove(event: MotionEvent): Boolean {
    if (!rootCarouselGestureCandidate) {
      return false
    }

    val dx = event.x - rootCarouselStartX
    val dy = event.y - rootCarouselStartY
    if (!rootCarouselGestureActive) {
      if (abs(dx) <= touchSlop || abs(dx) <= abs(dy)) {
        return false
      }
      rootCarouselGestureActive = true
      cancelPendingLongPress()
    }

    rootCarouselDragX = dx.coerceIn(-rootCarouselRect.width(), rootCarouselRect.width())
    invalidate()
    return true
  }

  private fun finishRootCarouselGesture(event: MotionEvent): Boolean {
    if (!rootCarouselGestureCandidate) {
      resetRootCarouselGesture()
      return false
    }

    val wasActive = rootCarouselGestureActive
    if (wasActive) {
      val card = lookupCard
      val characters = card?.let { extractHanjaCharacters(it.hanja) }.orEmpty()
      if (characters.size > 1) {
        val dx = event.x - rootCarouselStartX
        val threshold = max(dp(42f), rootCarouselRect.width() * 0.16f)
        activeRootCharacterIndex = when {
          dx <= -threshold -> (activeRootCharacterIndex + 1).coerceAtMost(characters.lastIndex)
          dx >= threshold -> (activeRootCharacterIndex - 1).coerceAtLeast(0)
          else -> activeRootCharacterIndex.coerceIn(0, characters.lastIndex)
        }
      }
      hanjaPopup = null
      invalidate()
    }

    resetRootCarouselGesture()
    return wasActive
  }

  private fun resetRootCarouselGesture() {
    rootCarouselGestureCandidate = false
    rootCarouselGestureActive = false
    rootCarouselStartX = 0f
    rootCarouselStartY = 0f
    rootCarouselDragX = 0f
  }

  private fun clampRootCharacterIndex(card: LookupCard? = lookupCard) {
    val lastIndex = card?.let { extractHanjaCharacters(it.hanja).lastIndex } ?: -1
    activeRootCharacterIndex = if (lastIndex >= 0) {
      activeRootCharacterIndex.coerceIn(0, lastIndex)
    } else {
      0
    }
  }

  private fun placementForSelection(selection: OcrTapSelection): LookupPanelPlacement {
    val result = ocrResult ?: return LookupPanelPlacement.BOTTOM
    if (height <= 0) {
      return LookupPanelPlacement.BOTTOM
    }

    val rect = currentTransform(result).mapRect(selection.box)
    return if (rect.centerY() > height * 0.52f) {
      LookupPanelPlacement.TOP
    } else {
      LookupPanelPlacement.BOTTOM
    }
  }

  private fun canExpandLookup(card: LookupCard?): Boolean =
    card != null &&
      !card.showingTranslation &&
      card.state == LookupCardState.LOADED &&
      card.hasRootCharacters

  private fun drawBoxes(canvas: Canvas, result: SerializedOcrResult) {
    val transform = currentTransform(result)
    logOverlayGeometry(result, transform)
    val selectedBox = lookupCard?.selection?.box
    val selectedIsRegion = lookupCard?.let(::isRegionSelection) == true

    visibleTargets(result).forEach { target ->
      val rect = transform.mapRect(target.box)
      val isMultiSelected = multiSelectTargetKeys.contains(targetKey(target))
      if (selectedBox == target.box || isMultiSelected) {
        val pressedRect = RectF(rect).apply {
          inset(-dp(if (selectedIsRegion || isMultiSelected) 2f else 1f), -dp(if (selectedIsRegion || isMultiSelected) 1f else 0.5f))
        }
        val radius = dp(if (selectedIsRegion || isMultiSelected) 4f else 2f)
        canvas.drawRoundRect(pressedRect, radius, radius, if (selectedIsRegion || isMultiSelected) regionBoxPaint else selectedBoxPaint)
        canvas.drawRoundRect(pressedRect, radius, radius, boxStrokePaint)
      } else {
        val targetRect = RectF(rect).apply {
          inset(-dp(1f), -dp(0.5f))
        }
        canvas.drawRoundRect(targetRect, dp(2f), dp(2f), boxPaint)
        canvas.drawRoundRect(targetRect, dp(2f), dp(2f), boxStrokePaint)
      }
    }
  }

  private fun drawCloseButton(canvas: Canvas) {
    if (lookupCard != null) {
      overlayCloseRect.setEmpty()
      return
    }

    val size = dp(56f)
    closeAnchorRect(size)?.let(overlayCloseRect::set) ?: run {
      val rightMargin = dp(24f)
      val bottomMargin = dp(48f)
      overlayCloseRect.set(
        width - rightMargin - size,
        height - bottomMargin - size,
        width - rightMargin,
        height - bottomMargin
      )
    }

    closePaint.setShadowLayer(dp(16f), 0f, dp(4f), Color.argb(82, 0, 0, 0))
    canvas.drawOval(overlayCloseRect, closePaint)
    closePaint.clearShadowLayer()
    canvas.drawOval(overlayCloseRect, closeBorderPaint)
    drawCloseX(canvas, overlayCloseRect)
  }

  private fun drawCloseX(canvas: Canvas, rect: RectF) {
    val centerX = rect.centerX()
    val centerY = rect.centerY()
    val half = dp(9.5f)
    closeIconPaint.strokeWidth = dp(2.8f)
    canvas.drawLine(centerX - half, centerY - half, centerX + half, centerY + half, closeIconPaint)
    canvas.drawLine(centerX + half, centerY - half, centerX - half, centerY + half, closeIconPaint)
  }

  private fun drawFfGlyph(canvas: Canvas, centerX: Float, centerY: Float, size: Float) {
    val scale = size / 1024f
    canvas.save()
    canvas.translate(centerX - size / 2f, centerY - size / 2f)
    canvas.scale(scale, scale)

    glyphPath.reset()
    glyphPath.moveTo(252f, 296f)
    glyphPath.cubicTo(348f, 258f, 462f, 272f, 532f, 330f)
    canvas.drawPath(glyphPath, closeIconPaint)

    glyphPath.reset()
    glyphPath.moveTo(532f, 330f)
    glyphPath.cubicTo(602f, 272f, 716f, 258f, 812f, 296f)
    canvas.drawPath(glyphPath, closeIconPaint)

    drawGlyphLine(canvas, 252f, 296f, 252f, 700f)
    drawGlyphLine(canvas, 812f, 296f, 812f, 700f)
    drawGlyphLine(canvas, 532f, 330f, 532f, 734f)

    glyphPath.reset()
    glyphPath.moveTo(252f, 700f)
    glyphPath.cubicTo(348f, 662f, 462f, 676f, 532f, 734f)
    canvas.drawPath(glyphPath, closeIconPaint)

    glyphPath.reset()
    glyphPath.moveTo(532f, 734f)
    glyphPath.cubicTo(602f, 676f, 716f, 662f, 812f, 700f)
    canvas.drawPath(glyphPath, closeIconPaint)

    drawGlyphLine(canvas, 252f, 452f, 396f, 452f)
    drawGlyphLine(canvas, 532f, 462f, 676f, 462f)
    canvas.restore()
  }

  private fun drawGlyphLine(canvas: Canvas, startX: Float, startY: Float, endX: Float, endY: Float) {
    canvas.drawLine(startX, startY, endX, endY, closeIconPaint)
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

    val label = OverlayText.t("textNotFound")
    val iconSize = dp(16f)
    val gap = dp(8f)
    val horizontalPadding = dp(18f)
    val pillHeight = dp(40f)
    val textWidth = emptyTextPaint.measureText(label)
    val pillWidth = iconSize + gap + textWidth + horizontalPadding * 2f
    val centerX = width / 2f
    val centerY = max(dp(96f), height / 2f)
    val rect = RectF(
      centerX - pillWidth / 2f,
      centerY - pillHeight / 2f,
      centerX + pillWidth / 2f,
      centerY + pillHeight / 2f
    )
    canvas.drawRoundRect(rect, pillHeight / 2f, pillHeight / 2f, emptyPillPaint)

    val iconLeft = rect.left + horizontalPadding
    val iconCenterY = rect.centerY()
    drawSearchOffIcon(canvas, iconLeft + iconSize / 2f, iconCenterY, iconSize)
    emptyTextPaint.textAlign = Paint.Align.LEFT
    canvas.drawText(label, iconLeft + iconSize + gap, iconCenterY - (emptyTextPaint.ascent() + emptyTextPaint.descent()) / 2f, emptyTextPaint)
    emptyTextPaint.textAlign = Paint.Align.CENTER
  }

  private fun drawMultiSelectPanel(canvas: Canvas) {
    if (multiSelectTargets.isEmpty() || lookupCard != null) {
      multiSelectPanelRect.setEmpty()
      multiSelectTranslateRect.setEmpty()
      multiSelectClearRect.setEmpty()
      multiSelectModeRects.clear()
      return
    }

    val margin = dp(16f)
    val panelHeight = dp(108f)
    val bottom = (height - dp(104f)).coerceAtLeast(panelHeight + margin)
    val top = bottom - panelHeight
    multiSelectPanelRect.set(margin, top, width - margin, bottom)

    drawPanelSurface(canvas, multiSelectPanelRect)

    val contentLeft = multiSelectPanelRect.left + dp(14f)
    val contentRight = multiSelectPanelRect.right - dp(14f)
    val headerY = multiSelectPanelRect.top + dp(24f)
    canvas.drawText(OverlayText.t("sentenceSelection").uppercase(), contentLeft, headerY, eyebrowPaint)
    val countLabel = "${multiSelectTargets.size}"
    wordNavCountPaint.color = Color.rgb(154, 156, 159)
    canvas.drawText(countLabel, contentRight - wordNavCountPaint.measureText(countLabel) / 2f, headerY, wordNavCountPaint)

    multiSelectModeRects.clear()
    val modeTop = multiSelectPanelRect.top + dp(38f)
    val modeHeight = dp(30f)
    val modeGap = dp(6f)
    val modes = MultiSelectOrderMode.values()
    val modeWidth = ((contentRight - contentLeft) - modeGap * (modes.size - 1)) / modes.size
    modes.forEachIndexed { index, mode ->
      val left = contentLeft + index * (modeWidth + modeGap)
      val rect = RectF(left, modeTop, left + modeWidth, modeTop + modeHeight)
      multiSelectModeRects.add(MultiSelectModeRect(mode, rect))
      val active = multiSelectMode == mode
      if (active) {
        buttonPaint.color = Color.rgb(32, 38, 49)
        canvas.drawRoundRect(rect, dp(4f), dp(4f), buttonPaint)
      } else {
        secondaryButtonPaint.color = Color.WHITE
        canvas.drawRoundRect(rect, dp(4f), dp(4f), secondaryButtonPaint)
        canvas.drawRoundRect(rect, dp(4f), dp(4f), buttonStrokePaint)
      }
      drawActionLabel(canvas, mode.label, rect.centerX(), rect.centerY(), if (active) Color.WHITE else Color.rgb(32, 38, 49))
    }
    secondaryButtonPaint.color = Color.WHITE

    val actionTop = multiSelectPanelRect.bottom - dp(34f)
    val actionHeight = dp(28f)
    multiSelectTranslateRect.set(contentLeft, actionTop, contentRight - dp(74f), actionTop + actionHeight)
    multiSelectClearRect.set(contentRight - dp(66f), actionTop, contentRight, actionTop + actionHeight)
    buttonPaint.color = Color.rgb(32, 38, 49)
    canvas.drawRoundRect(multiSelectTranslateRect, dp(4f), dp(4f), buttonPaint)
    drawActionLabel(canvas, OverlayText.t("translate").uppercase(), multiSelectTranslateRect.centerX(), multiSelectTranslateRect.centerY(), Color.WHITE)
    secondaryButtonPaint.color = Color.WHITE
    canvas.drawRoundRect(multiSelectClearRect, dp(4f), dp(4f), secondaryButtonPaint)
    canvas.drawRoundRect(multiSelectClearRect, dp(4f), dp(4f), buttonStrokePaint)
    drawActionLabel(canvas, OverlayText.t("clear").uppercase(), multiSelectClearRect.centerX(), multiSelectClearRect.centerY(), Color.rgb(32, 38, 49))
  }

  private fun drawSearchOffIcon(canvas: Canvas, centerX: Float, centerY: Float, size: Float) {
    val radius = size * 0.28f
    canvas.drawCircle(centerX - size * 0.07f, centerY - size * 0.07f, radius, emptyIconPaint)
    canvas.drawLine(
      centerX + radius * 0.45f,
      centerY + radius * 0.45f,
      centerX + size * 0.35f,
      centerY + size * 0.35f,
      emptyIconPaint
    )
    canvas.drawLine(
      centerX - size * 0.38f,
      centerY - size * 0.38f,
      centerX + size * 0.38f,
      centerY + size * 0.38f,
      emptyIconPaint
    )
  }

  private fun drawLookupCard(canvas: Canvas) {
    val card = lookupCard ?: return
    hanjaTouchRects.clear()
    alternativeSaveRects.clear()
    relatedKnownRects.clear()
    rootSeeMoreRects.clear()
    translationButtonRect.setEmpty()
    moreButtonRect.setEmpty()
    wordNavPreviousRect.setEmpty()
    wordNavNextRect.setEmpty()
    rootCarouselRect.setEmpty()

    val topPlacement = lookupPanelPlacement == LookupPanelPlacement.TOP
    val regionTranslation = card.showingTranslation && isRegionSelection(card)
    val cardWidth = lookupCardWidth(regionTranslation)
    val cardHeight = computeCardHeight(card)
    val left = lookupCardLeft(cardWidth)
    val top = if (topPlacement) {
      0f
    } else {
      val bottomInset = if (regionTranslation) dp(16f) else 0f
      (height - bottomInset - cardHeight).coerceAtLeast(dp(72f))
    }

    cardRect.set(left, top, left + cardWidth, top + cardHeight)
    drawPanelSurface(canvas, cardRect, topPlacement = topPlacement, floating = regionTranslation)

    val horizontalPadding = if (regionTranslation) dp(14f) else dp(24f)
    val contentLeft = cardRect.left + horizontalPadding
    val contentRight = cardRect.right - horizontalPadding
    if (regionTranslation) {
      drawRegionTranslationSheet(canvas, card, contentLeft, contentRight)
      return
    }

    if (!topPlacement) {
      drawSheetHandle(canvas, atBottom = false, canExpand = canExpandLookup(card))
    }

    val headingBottom = drawLookupHeading(canvas, card, contentLeft, contentRight)
    if (card.showingTranslation) {
      drawDictionaryTranslationSheet(canvas, card, contentLeft, contentRight, headingBottom + dp(14f))
      drawSheetActionRow(canvas, card, activeTranslation = true)
      if (topPlacement) {
        drawSheetHandle(canvas, atBottom = true, canExpand = false)
      }
      return
    }

    var y = if (card.state == LookupCardState.LOADING || card.state == LookupCardState.SAVING) {
      drawDefinitionLoadingBody(canvas, contentLeft, contentRight, headingBottom + dp(22f))
    } else {
      drawDefinitionBody(canvas, card, contentLeft, contentRight, headingBottom + dp(14f))
    }

    if (card.expandedAlternatives) {
      drawAlternatives(canvas, card, contentLeft, contentRight, y + dp(8f))
    } else if (isLookupExpanded && canExpandLookup(card)) {
      drawRootCharacters(canvas, card, contentLeft, contentRight, y + dp(10f))
    }

    drawSheetActionRow(canvas, card, activeTranslation = false)
    if (topPlacement) {
      drawSheetHandle(canvas, atBottom = true, canExpand = canExpandLookup(card))
    }
  }

  private fun lookupCardWidth(regionTranslation: Boolean = false): Float =
    if (regionTranslation) {
      (width - dp(32f)).coerceAtLeast(dp(260f))
    } else {
      width.toFloat().coerceAtLeast(dp(260f))
    }

  private fun lookupCardLeft(cardWidth: Float): Float =
    ((width - cardWidth) / 2f).coerceAtLeast(0f)

  private fun computeCardHeight(card: LookupCard): Float {
    val alternativeCount = if (card.expandedAlternatives) {
      min(MAX_VISIBLE_ALTERNATIVES, card.alternatives.size)
    } else {
      0
    }
    if (card.showingTranslation && isRegionSelection(card)) {
      return computeRegionTranslationHeight(card)
        .coerceAtMost(height - dp(72f))
        .coerceAtLeast(dp(88f))
    }

    val desired = when {
      card.showingTranslation -> dp(DICTIONARY_TRANSLATION_HEIGHT_DP)
      card.state == LookupCardState.LOADING || card.state == LookupCardState.SAVING -> dp(DICTIONARY_COMPACT_HEIGHT_DP)
      card.expandedAlternatives -> dp(236f) + alternativeCount * alternativeRowHeight()
      isLookupExpanded && canExpandLookup(card) -> dp(DICTIONARY_EXPANDED_MAX_HEIGHT_DP)
      canExpandLookup(card) -> dp(DICTIONARY_COMPACT_HEIGHT_DP)
      card.definition.isNullOrBlank() -> dp(DICTIONARY_NO_ROOT_HEIGHT_DP)
      else -> dp(DICTIONARY_COMPACT_HEIGHT_DP)
    }

    return desired.coerceAtMost(height - dp(72f)).coerceAtLeast(dp(132f))
  }

  private fun computeRegionTranslationHeight(card: LookupCard): Float {
    val topPadding = if (lookupPanelPlacement == LookupPanelPlacement.TOP) {
      dp(TOP_PLACEMENT_TRANSLATION_TOP_PADDING_DP)
    } else {
      dp(12f)
    }
    val bottomPadding = if (lookupPanelPlacement == LookupPanelPlacement.TOP) {
      dp(TOP_PLACEMENT_TRANSLATION_BOTTOM_PADDING_DP)
    } else {
      dp(TRANSLATION_PANEL_BOTTOM_PADDING_DP)
    }
    val headerHeight = dp(18f)
    val headerBottomGap = dp(8f)
    val translation = card.translation?.trim().orEmpty()
    val bodyHeight = if (translation.isBlank() && card.translationRequested) {
      dp(45f)
    } else {
      val body = translation.ifBlank { card.displayBody }
      val contentWidth = (lookupCardWidth(regionTranslation = true) - dp(28f)).coerceAtLeast(dp(120f))
      val lineCount = wrapText(body, cardBodyPaint, contentWidth, maxLines = 6).size.coerceAtLeast(1)
      min(lineCount * dp(24f), dp(TRANSLATION_MAX_SCROLL_HEIGHT_DP))
    }

    return topPadding + headerHeight + headerBottomGap + bodyHeight + bottomPadding
  }

  private fun drawSheetHandle(canvas: Canvas, atBottom: Boolean, canExpand: Boolean) {
    val handleWidth = dp(36f)
    val handleHeight = dp(4f)
    val top = if (atBottom) {
      cardRect.bottom - dp(12f) - handleHeight
    } else {
      cardRect.top + dp(12f)
    }
    val rect = RectF(
      cardRect.centerX() - handleWidth / 2f,
      top,
      cardRect.centerX() + handleWidth / 2f,
      top + handleHeight
    )
    val handlePaint = secondaryButtonPaint
    handlePaint.color = Color.rgb(228, 226, 226)
    canvas.drawRoundRect(rect, handleHeight / 2f, handleHeight / 2f, handlePaint)
    handlePaint.color = Color.WHITE

    if (canExpand && !isLookupExpanded) {
      val hint = if (atBottom) OverlayText.t("slideDownForRoots") else OverlayText.t("slideUpForRoots")
      val hintY = if (atBottom) {
        rect.top - dp(9f)
      } else {
        rect.bottom + dp(14f)
      }
      wordNavCountPaint.color = Color.rgb(154, 156, 159)
      wordNavCountPaint.textAlign = Paint.Align.CENTER
      canvas.drawText(hint, cardRect.centerX(), hintY, wordNavCountPaint)
    }
  }

  private fun drawLookupHeading(
    canvas: Canvas,
    card: LookupCard,
    contentLeft: Float,
    contentRight: Float
  ): Float {
    val collapsedRootOffset = if (canExpandLookup(card) && !isLookupExpanded && !card.showingTranslation) {
      dp(18f)
    } else {
      0f
    }
    val baseline = cardRect.top + dp(if (card.definition.isNullOrBlank()) 58f else 56f) + collapsedRootOffset
    val hasNavigation = card.wordOptions.size > 1 && card.state != LookupCardState.SAVING
    val chevronWidth = dp(24f)

    if (hasNavigation) {
      wordNavPreviousRect.set(contentLeft - dp(4f), baseline - dp(25f), contentLeft + chevronWidth, baseline + dp(9f))
      wordNavNextRect.set(contentRight - chevronWidth, baseline - dp(25f), contentRight + dp(4f), baseline + dp(9f))
      drawHeadwordChevron(canvas, wordNavPreviousRect, leftDirection = true, active = card.activeWordIndex > 0)
      drawHeadwordChevron(canvas, wordNavNextRect, leftDirection = false, active = card.activeWordIndex < card.wordOptions.lastIndex)
    }

    val availableLeft = if (hasNavigation) wordNavPreviousRect.right + dp(6f) else contentLeft
    val availableRight = if (hasNavigation) wordNavNextRect.left - dp(6f) else contentRight
    val title = card.stem.ifBlank { card.surface.ifBlank { card.selection.selectedText } }
    val hanja = card.hanja?.trim().orEmpty()
    val romanization = card.romanization?.trim().orEmpty()
    val gap = dp(9f)
    val hanjaWidth = if (hanja.isNotEmpty()) headingHanjaPaint.measureText(hanja) else 0f
    val romanWidth = if (romanization.isNotEmpty()) romanizationPaint.measureText(romanization) else 0f
    val reserved = (if (hanjaWidth > 0f) hanjaWidth + gap else 0f) +
      (if (romanWidth > 0f) romanWidth + gap else 0f)
    val maxTitleWidth = (availableRight - availableLeft - reserved).coerceAtLeast(dp(72f))
    val titleText = ellipsize(title, cardTitlePaint, maxTitleWidth)
    val titleWidth = cardTitlePaint.measureText(titleText)
    val totalWidth = titleWidth +
      (if (hanjaWidth > 0f) gap + hanjaWidth else 0f) +
      (if (romanWidth > 0f) gap + romanWidth else 0f)
    var cursor = ((availableLeft + availableRight - totalWidth) / 2f).coerceAtLeast(availableLeft)

    canvas.drawText(titleText, cursor, baseline, cardTitlePaint)
    cursor += titleWidth
    if (hanja.isNotEmpty()) {
      cursor += gap
      drawHeadingHanja(canvas, hanja, cursor, baseline, availableRight, title)
      cursor += hanjaWidth
    }
    if (romanization.isNotEmpty() && cursor + gap < availableRight) {
      cursor += gap
      canvas.drawText(ellipsize(romanization, romanizationPaint, availableRight - cursor), cursor, baseline, romanizationPaint)
    }

    return baseline + dp(13f)
  }

  private fun drawHeadingHanja(
    canvas: Canvas,
    hanja: String,
    x: Float,
    baseline: Float,
    maxRight: Float,
    sourceWord: String
  ) {
    var cursor = x
    hanja.forEach { char ->
      val charText = char.toString()
      val width = headingHanjaPaint.measureText(charText)
      if (cursor + width > maxRight) {
        return
      }
      canvas.drawText(charText, cursor, baseline, headingHanjaPaint)
      if (isHanja(char)) {
        hanjaTouchRects.add(
          HanjaTouchRect(
            character = charText,
            sourceWord = sourceWord,
            rect = RectF(cursor - dp(4f), baseline - dp(22f), cursor + width + dp(4f), baseline + dp(6f))
          )
        )
      }
      cursor += width + dp(2f)
    }
  }

  private fun drawDefinitionBody(
    canvas: Canvas,
    card: LookupCard,
    contentLeft: Float,
    contentRight: Float,
    top: Float
  ): Float {
    val posLabel = formatPos(card.pos)
    val bodyPaint = if (card.state == LookupCardState.ERROR || card.state == LookupCardState.FALLBACK) {
      cardErrorPaint
    } else {
      cardBodyPaint
    }
    val body = if (card.state == LookupCardState.LOADED && card.definition.isNullOrBlank()) {
      OverlayText.t("noDefinitionFound")
    } else {
      card.displayBody
    }
    val availableWidth = contentRight - contentLeft
    val posWidth = if (posLabel.isNotEmpty()) {
      badgeTextPaint.measureText(posLabel) + dp(28f)
    } else {
      0f
    }
    val gap = if (posWidth > 0f) dp(10f) else 0f
    val textWidth = (availableWidth - posWidth - gap).coerceAtLeast(dp(120f))
    val lines = wrapText(body, bodyPaint, textWidth, maxLines = if (card.definition.isNullOrBlank()) 1 else 2)
    val firstLineWidth = lines.firstOrNull()?.let { bodyPaint.measureText(it) } ?: 0f
    val groupWidth = (posWidth + gap + firstLineWidth).coerceAtMost(availableWidth)
    var cursor = contentLeft + (availableWidth - groupWidth) / 2f
    val rowTop = top
    val baseline = rowTop + dp(19f)

    if (posLabel.isNotEmpty()) {
      val badgeRect = RectF(cursor, rowTop - dp(1f), cursor + posWidth, rowTop + dp(26f))
      canvas.drawRoundRect(badgeRect, dp(3f), dp(3f), badgePaint)
      canvas.drawRoundRect(badgeRect, dp(3f), dp(3f), buttonStrokePaint.apply { color = Color.rgb(197, 198, 203) })
      canvas.drawText(posLabel, badgeRect.centerX(), badgeRect.centerY() - (badgeTextPaint.ascent() + badgeTextPaint.descent()) / 2f, badgeTextPaint)
      buttonStrokePaint.color = Color.rgb(228, 226, 226)
      cursor = badgeRect.right + gap
    }

    var y = baseline
    lines.forEachIndexed { index, line ->
      canvas.drawText(line, if (index == 0) cursor else contentLeft + (availableWidth - bodyPaint.measureText(line)) / 2f, y, bodyPaint)
      y += dp(23f)
    }

    val secondDefinition = card.alternatives.firstOrNull { !it.definition.isNullOrBlank() && it.word != card.stem }
    if (secondDefinition != null && !card.expandedAlternatives && !card.hasRootCharacters) {
      val numberY = y + dp(2f)
      wordNavCountPaint.color = Color.rgb(154, 156, 159)
      wordNavCountPaint.textAlign = Paint.Align.LEFT
      canvas.drawText("2", contentLeft + dp(36f), numberY, wordNavCountPaint)
      val altText = ellipsize(secondDefinition.definition.orEmpty(), cardBodyPaint, availableWidth - dp(72f))
      canvas.drawText(altText, contentLeft + dp(55f), numberY, cardBodyPaint)
      wordNavCountPaint.textAlign = Paint.Align.CENTER
      y += dp(24f)
    }

    return max(y, top + dp(30f))
  }

  private fun drawCenteredStateText(
    canvas: Canvas,
    text: String,
    contentLeft: Float,
    contentRight: Float,
    baseline: Float
  ): Float {
    val line = ellipsize(text, cardBodyPaint, contentRight - contentLeft)
    canvas.drawText(line, (contentLeft + contentRight - cardBodyPaint.measureText(line)) / 2f, baseline, cardBodyPaint)
    return baseline + dp(24f)
  }

  private fun drawDefinitionLoadingBody(
    canvas: Canvas,
    contentLeft: Float,
    contentRight: Float,
    top: Float
  ): Float {
    val width = contentRight - contentLeft
    val firstTop = top + dp(2f)
    drawSkeletonLine(canvas, contentLeft, firstTop, width)
    drawSkeletonLine(canvas, contentLeft, firstTop + dp(23f), width * 0.66f)
    postInvalidateOnAnimation()
    return firstTop + dp(52f)
  }

  private fun drawSkeletonLine(canvas: Canvas, left: Float, top: Float, width: Float) {
    val height = dp(13f)
    val radius = dp(2f)
    val rect = RectF(left, top, left + width, top + height)
    canvas.drawRoundRect(rect, radius, radius, skeletonBasePaint)

    val progress = (SystemClock.uptimeMillis() % LOOKUP_LOADING_SHIMMER_DURATION_MS).toFloat() /
      LOOKUP_LOADING_SHIMMER_DURATION_MS
    val sweepWidth = dp(160f)
    val sweepLeft = left + width + sweepWidth - ((width + sweepWidth * 2f) * progress)
    skeletonShimmerPaint.shader = LinearGradient(
      sweepLeft,
      top,
      sweepLeft + sweepWidth,
      top,
      intArrayOf(
        Color.rgb(235, 232, 232),
        Color.rgb(230, 227, 227),
        Color.rgb(235, 232, 232)
      ),
      floatArrayOf(0f, 0.5f, 1f),
      Shader.TileMode.CLAMP
    )

    canvas.save()
    canvas.clipRect(rect)
    canvas.drawRoundRect(rect, radius, radius, skeletonShimmerPaint)
    canvas.restore()
    skeletonShimmerPaint.shader = null
  }

  private fun drawDictionaryTranslationSheet(
    canvas: Canvas,
    card: LookupCard,
    contentLeft: Float,
    contentRight: Float,
    top: Float
  ) {
    val titleBaseline = top + dp(13f)
    canvas.drawText(OverlayText.t("translation").uppercase(), contentLeft, titleBaseline, eyebrowPaint)
    val translation = card.translation?.trim().orEmpty()
    if (translation.isBlank() && card.translationRequested) {
      drawTranslationLoadingBody(canvas, contentLeft, contentRight, titleBaseline + dp(14f))
      return
    }

    val body = translation.ifBlank { card.displayBody }
    var y = titleBaseline + dp(33f)
    wrapText(body, cardBodyPaint, contentRight - contentLeft, maxLines = 6).forEach { line ->
      canvas.drawText(line, contentLeft, y, cardBodyPaint)
      y += dp(24f)
    }
  }

  private fun drawRegionTranslationSheet(
    canvas: Canvas,
    card: LookupCard,
    contentLeft: Float,
    contentRight: Float
  ) {
    val topPadding = if (lookupPanelPlacement == LookupPanelPlacement.TOP) {
      dp(TOP_PLACEMENT_TRANSLATION_TOP_PADDING_DP)
    } else {
      dp(12f)
    }
    val headerTop = cardRect.top + topPadding
    val headerCenterY = headerTop + dp(9f)
    val iconRect = RectF(contentLeft, headerCenterY - dp(8f), contentLeft + dp(16f), headerCenterY + dp(8f))
    drawTranslateGlyph(canvas, iconRect, Color.rgb(154, 156, 159))

    val translation = card.translation?.trim().orEmpty()
    val copyLabel = OverlayText.t("copy").uppercase()
    val headerRight = if (translation.isNotBlank()) {
      contentRight - translationCopyPaint.measureText(copyLabel) - dp(14f)
    } else {
      contentRight
    }
    drawTranslationHeaderLanguages(canvas, card, iconRect.right + dp(8f), headerRight, headerCenterY)
    if (translation.isNotBlank()) {
      val copyBaseline = centeredTextBaseline(translationCopyPaint, headerCenterY)
      canvas.drawText(copyLabel, contentRight - translationCopyPaint.measureText(copyLabel), copyBaseline, translationCopyPaint)
    }

    val bodyTop = headerTop + dp(26f)
    if (translation.isBlank() && card.translationRequested) {
      drawTranslationLoadingBody(canvas, contentLeft, contentRight, bodyTop)
      return
    }

    val body = translation.ifBlank { card.displayBody }
    cardBodyPaint.textSize = dp(15f)
    var y = bodyTop - cardBodyPaint.ascent()
    wrapText(body, cardBodyPaint, contentRight - contentLeft, maxLines = 6).forEach { line ->
      canvas.drawText(line, contentLeft, y, cardBodyPaint)
      y += dp(24f)
    }
    cardBodyPaint.textSize = dp(15f)
  }

  private fun drawTranslationLoadingBody(
    canvas: Canvas,
    contentLeft: Float,
    contentRight: Float,
    top: Float
  ): Float {
    val width = contentRight - contentLeft
    val firstTop = top + dp(4f)
    drawSkeletonLine(canvas, contentLeft, firstTop, width)
    drawSkeletonLine(canvas, contentLeft, firstTop + dp(24f), width * 0.68f)
    postInvalidateOnAnimation()
    return firstTop + dp(53f)
  }

  private fun drawRootCharacters(
    canvas: Canvas,
    card: LookupCard,
    contentLeft: Float,
    contentRight: Float,
    top: Float
  ): Float {
    val characters = extractHanjaCharacters(card.hanja)
    if (characters.isEmpty()) {
      rootCarouselRect.setEmpty()
      return top
    }
    activeRootCharacterIndex = activeRootCharacterIndex.coerceIn(0, characters.lastIndex)

    val headerBaseline = top + dp(12f)
    canvas.drawText(OverlayText.t("rootCharacters").uppercase(), contentLeft, headerBaseline, eyebrowPaint)
    val dotY = headerBaseline - dp(3f)
    val dotGap = dp(10f)
    val firstDotX = contentRight - (characters.size - 1) * dotGap - dp(3f)
    characters.forEachIndexed { index, _ ->
      val dotPaint = secondaryButtonPaint
      dotPaint.color = if (index == activeRootCharacterIndex) Color.rgb(32, 38, 49) else Color.rgb(210, 208, 208)
      canvas.drawCircle(firstDotX + index * dotGap, dotY, dp(2.5f), dotPaint)
      dotPaint.color = Color.WHITE
    }

    val cardTop = top + dp(24f)
    val rootCardWidth = (contentRight - contentLeft) * 0.86f
    val rootCardGap = dp(12f)
    val bottomReserve = if (lookupPanelPlacement == LookupPanelPlacement.TOP) dp(52f) else dp(92f)
    val availableHeight = cardRect.bottom - cardTop - bottomReserve
    val rootCardHeight = rootCardHeightFor(card, characters, availableHeight)
    rootCarouselRect.set(contentLeft, cardTop, contentRight, cardTop + rootCardHeight)
    canvas.save()
    canvas.clipRect(cardRect.left, cardTop - dp(2f), cardRect.right, cardTop + rootCardHeight + dp(2f))
    characters.forEachIndexed { index, character ->
      val left = contentLeft + (index - activeRootCharacterIndex) * (rootCardWidth + rootCardGap) + rootCarouselDragX
      val rect = RectF(left, cardTop, left + rootCardWidth, cardTop + rootCardHeight)
      if (rect.right >= cardRect.left && rect.left <= cardRect.right) {
        drawRootCharacterCard(canvas, card, character, rect)
      }
    }
    canvas.restore()

    return cardTop + rootCardHeight
  }

  private fun drawRootCharacterCard(canvas: Canvas, card: LookupCard, character: String, rect: RectF) {
    val preloadIndex = card.hanjaPreloads.indexOfFirst { preload ->
      preload.character == character || preload.character.contains(character)
    }
    val preload = card.hanjaPreloads.getOrNull(preloadIndex)
    val surfacePaint = popupTilePaint
    surfacePaint.color = Color.rgb(254, 253, 252)
    canvas.drawRoundRect(rect, dp(4f), dp(4f), surfacePaint)
    canvas.drawRoundRect(rect, dp(4f), dp(4f), cardStrokePaint)
    surfacePaint.color = Color.WHITE

    val tileRect = RectF(rect.left + dp(12f), rect.top + dp(12f), rect.left + dp(56f), rect.top + dp(56f))
    val tilePaint = popupHeaderPaint
    tilePaint.color = Color.rgb(240, 237, 237)
    canvas.drawRoundRect(tileRect, dp(3f), dp(3f), tilePaint)
    tilePaint.color = Color.rgb(253, 243, 220)
    popupTitlePaint.color = Color.rgb(32, 38, 49)
    popupTitlePaint.textSize = dp(28f)
    canvas.drawText(character, tileRect.centerX() - popupTitlePaint.measureText(character) / 2f, tileRect.centerY() - (popupTitlePaint.ascent() + popupTitlePaint.descent()) / 2f, popupTitlePaint)

    val textLeft = tileRect.right + dp(12f)
    canvas.drawText(OverlayText.t("meaning").uppercase(), textLeft, rect.top + dp(25f), eyebrowPaint)
    val meaning = preload?.meaning?.trim().orEmpty().ifBlank { OverlayText.t("hanjaDetails") }
    val meaningPaint = relatedKoreanPaint
    meaningPaint.typeface = englishBoldTypeface
    meaningPaint.textSize = dp(14f)
    meaningPaint.color = Color.rgb(27, 28, 28)
    canvas.drawText(ellipsize(meaning, meaningPaint, rect.right - textLeft - dp(12f)), textLeft, rect.top + dp(45f), meaningPaint)
    meaningPaint.typeface = koreanRegularTypeface
    meaningPaint.textSize = dp(15f)

    val dividerY = rect.top + dp(76f)
    canvas.drawLine(rect.left + dp(12f), dividerY, rect.right - dp(12f), dividerY, dividerPaint)
    canvas.drawText(OverlayText.t("relatedWords").uppercase(), rect.left + dp(12f), dividerY + dp(22f), eyebrowPaint)

    val relatedRowHeight = dp(45f)
    val firstRelatedTop = dividerY + dp(37f)
    val sourceWord = preload?.sourceWord?.takeIf(String::isNotBlank) ?: rootSourceWordFor(card)
    val visibleLimit = rootVisibleRelatedCount(sourceWord, character, preload?.relatedWords?.size ?: 0)
    val maxRelatedRows = ((rect.bottom - firstRelatedTop - dp(44f)) / relatedRowHeight).toInt().coerceAtLeast(1)
    val related = preload?.relatedWords.orEmpty().take(min(visibleLimit, maxRelatedRows))
    if (related.isEmpty()) {
      canvas.drawText(OverlayText.t("noRelatedWordsAvailable"), rect.left + dp(12f), dividerY + dp(48f), popupMeaningPaint)
      return
    }

    related.forEachIndexed { index, entry ->
      val rowTop = firstRelatedTop + index * relatedRowHeight
      val toggleSize = dp(30f)
      val toggleRect = RectF(rect.right - dp(12f) - toggleSize, rowTop - dp(18f), rect.right - dp(12f), rowTop - dp(18f) + toggleSize)
      relatedKnownRects.add(
        RelatedKnownRect(
          index = index,
          rect = RectF(toggleRect),
          sourceWord = sourceWord,
          sourceHanja = character,
          preloadIndex = preloadIndex.takeIf { it >= 0 },
          embeddedRoot = true
        )
      )
      drawKnownToggle(canvas, toggleRect, entry.known)

      val word = ellipsize(entry.korean.trim(), relatedKoreanPaint, (toggleRect.left - rect.left - dp(34f)) * 0.52f)
      canvas.drawText(word, rect.left + dp(12f), rowTop, relatedKoreanPaint)
      val hanja = entry.hanja.trim()
      if (hanja.isNotEmpty()) {
        canvas.drawText(
          ellipsize(hanja, relatedHanjaPaint, toggleRect.left - rect.left - dp(24f) - relatedKoreanPaint.measureText(word)),
          rect.left + dp(12f) + relatedKoreanPaint.measureText(word) + dp(6f),
          rowTop,
          relatedHanjaPaint
        )
      }
      val gloss = entry.meaning.trim()
      if (gloss.isNotEmpty()) {
        canvas.drawText(ellipsize(gloss, popupMeaningPaint, toggleRect.left - rect.left - dp(24f)), rect.left + dp(12f), rowTop + dp(18f), popupMeaningPaint)
      }
    }

    val totalRelated = preload?.relatedWords?.size ?: 0
    if (totalRelated > visibleLimit && related.size < maxRelatedRows) {
      val seeMoreTop = firstRelatedTop + related.size * relatedRowHeight + dp(7f)
      val seeMoreRect = RectF(rect.left + dp(12f), seeMoreTop, rect.right - dp(12f), seeMoreTop + dp(28f))
      rootSeeMoreRects.add(
        RootSeeMoreRect(
          sourceWord = sourceWord,
          sourceHanja = character,
          totalCount = totalRelated,
          rect = RectF(seeMoreRect)
        )
      )
      val label = OverlayText.t("seeMore")
      relatedHintPaint.color = Color.rgb(117, 119, 123)
      relatedHintPaint.textAlign = Paint.Align.RIGHT
      canvas.drawText(label, seeMoreRect.right - dp(17f), seeMoreRect.centerY() + dp(4f), relatedHintPaint)
      drawSmallChevronDown(canvas, seeMoreRect.right - dp(6f), seeMoreRect.centerY() + dp(1f), Color.rgb(117, 119, 123))
      relatedHintPaint.color = Color.rgb(155, 142, 118)
    }
  }

  private fun rootCardHeightFor(card: LookupCard, characters: List<String>, availableHeight: Float): Float {
    var maxRows = 0
    var hasMore = false
    characters.forEach { character ->
      val preload = card.hanjaPreloads.firstOrNull { entry ->
        entry.character == character || entry.character.contains(character)
      }
      val sourceWord = preload?.sourceWord?.takeIf(String::isNotBlank) ?: rootSourceWordFor(card)
      val total = preload?.relatedWords?.size ?: 0
      val visible = rootVisibleRelatedCount(sourceWord, character, total)
      maxRows = max(maxRows, min(total, visible))
      if (total > visible) {
        hasMore = true
      }
    }

    val rowCount = maxRows.coerceAtLeast(1)
    val desiredHeight = dp(113f) +
      rowCount * dp(45f) +
      if (hasMore) dp(42f) else dp(18f)

    return desiredHeight
      .coerceIn(dp(214f), dp(282f))
      .coerceAtMost(availableHeight.coerceAtLeast(dp(136f)))
  }

  private fun rootSourceWordFor(card: LookupCard): String =
    card.stem.ifBlank { card.surface.ifBlank { card.selection.selectedText } }

  private fun rootRelatedKey(sourceWord: String, sourceHanja: String): String =
    "${sourceWord.trim()}|${sourceHanja.trim()}"

  private fun rootVisibleRelatedCount(sourceWord: String, sourceHanja: String, totalCount: Int): Int {
    if (totalCount <= 0) {
      return 0
    }

    return (rootRelatedVisibleCounts[rootRelatedKey(sourceWord, sourceHanja)]
      ?: ROOT_RELATED_INITIAL_VISIBLE_COUNT)
      .coerceIn(1, totalCount)
  }

  private fun showMoreRootRelatedWords(target: RootSeeMoreRect) {
    val key = rootRelatedKey(target.sourceWord, target.sourceHanja)
    val current = rootRelatedVisibleCounts[key] ?: ROOT_RELATED_INITIAL_VISIBLE_COUNT
    rootRelatedVisibleCounts[key] = min(target.totalCount, current + ROOT_RELATED_PAGE_SIZE)
    invalidate()
  }

  private fun toggleRootRelatedKnown(card: LookupCard, target: RelatedKnownRect): Boolean {
    val preloadIndex = target.preloadIndex ?: return false
    val preload = card.hanjaPreloads.getOrNull(preloadIndex) ?: return false
    val related = preload.relatedWords.getOrNull(target.index) ?: return false
    val nextRelated = related.copy(known = !related.known)
    val nextPreloads = card.hanjaPreloads.mapIndexed { index, entry ->
      if (index == preloadIndex) {
        entry.copy(
          relatedWords = entry.relatedWords.mapIndexed { relatedIndex, relatedEntry ->
            if (relatedIndex == target.index) nextRelated else relatedEntry
          }
        )
      } else {
        entry
      }
    }

    lookupCard = card.copy(hanjaPreloads = nextPreloads)
    onRelatedKnownToggleRequested(
      target.sourceWord ?: preload.sourceWord,
      target.sourceHanja ?: preload.character,
      nextRelated
    )
    invalidate()
    return true
  }

  private fun drawSmallChevronDown(canvas: Canvas, centerX: Float, centerY: Float, color: Int) {
    iconPaint.color = color
    iconPaint.strokeWidth = dp(1.7f)
    canvas.drawLine(centerX - dp(4f), centerY - dp(2f), centerX, centerY + dp(2f), iconPaint)
    canvas.drawLine(centerX, centerY + dp(2f), centerX + dp(4f), centerY - dp(2f), iconPaint)
  }

  private fun drawSheetActionRow(canvas: Canvas, card: LookupCard, activeTranslation: Boolean) {
    val contentLeft = cardRect.left + dp(24f)
    val contentRight = cardRect.right - dp(24f)
    val height = dp(46f)
    val bottomPadding = if (lookupPanelPlacement == LookupPanelPlacement.TOP) dp(52f) else dp(26f)
    val top = cardRect.bottom - bottomPadding - height
    val gap = dp(10f)
    val buttonWidth = (contentRight - contentLeft - gap) / 2f
    saveButtonRect.set(contentLeft, top, contentLeft + buttonWidth, top + height)
    translationButtonRect.set(saveButtonRect.right + gap, top, contentRight, top + height)

    val saved = card.saved && card.definition?.isNotBlank() == true
    if (saved) {
      buttonPaint.color = Color.rgb(32, 38, 49)
      canvas.drawRoundRect(saveButtonRect, dp(3f), dp(3f), buttonPaint)
    } else {
      secondaryButtonPaint.color = Color.WHITE
      canvas.drawRoundRect(saveButtonRect, dp(3f), dp(3f), secondaryButtonPaint)
      canvas.drawRoundRect(saveButtonRect, dp(3f), dp(3f), buttonStrokePaint)
    }
    secondaryButtonPaint.color = if (activeTranslation) Color.rgb(240, 237, 237) else Color.WHITE
    canvas.drawRoundRect(translationButtonRect, dp(3f), dp(3f), secondaryButtonPaint)
    secondaryButtonPaint.color = Color.WHITE
    canvas.drawRoundRect(translationButtonRect, dp(3f), dp(3f), buttonStrokePaint)

    val saveTextColor = if (saved) Color.WHITE else Color.rgb(32, 38, 49)
    val saveLabel = if (saved) OverlayText.t("saved").uppercase() else OverlayText.t("save").uppercase()
    drawActionBookmark(canvas, saveButtonRect.left + saveButtonRect.width() / 2f - dp(30f), saveButtonRect.centerY(), saved, saveTextColor)
    drawActionLabel(canvas, saveLabel, saveButtonRect.centerX() + dp(8f), saveButtonRect.centerY(), saveTextColor)
    drawActionLabel(
      canvas,
      if (activeTranslation) OverlayText.t("dictionary").uppercase() else OverlayText.t("translate").uppercase(),
      translationButtonRect.centerX(),
      translationButtonRect.centerY(),
      Color.rgb(32, 38, 49)
    )
  }

  private fun drawActionLabel(canvas: Canvas, label: String, centerX: Float, centerY: Float, color: Int) {
    secondaryButtonTextPaint.color = color
    canvas.drawText(label, centerX, centerY - (secondaryButtonTextPaint.ascent() + secondaryButtonTextPaint.descent()) / 2f, secondaryButtonTextPaint)
    secondaryButtonTextPaint.color = Color.rgb(32, 38, 49)
  }

  private fun drawActionBookmark(canvas: Canvas, centerX: Float, centerY: Float, filled: Boolean, color: Int) {
    val width = dp(10f)
    val height = dp(15f)
    bookmarkPath.reset()
    bookmarkPath.moveTo(centerX - width / 2f, centerY - height / 2f)
    bookmarkPath.lineTo(centerX + width / 2f, centerY - height / 2f)
    bookmarkPath.lineTo(centerX + width / 2f, centerY + height / 2f)
    bookmarkPath.lineTo(centerX, centerY + height / 2f - dp(4f))
    bookmarkPath.lineTo(centerX - width / 2f, centerY + height / 2f)
    bookmarkPath.close()
    bookmarkPaint.color = color
    bookmarkPaint.strokeWidth = dp(1.6f)
    bookmarkPaint.style = if (filled) Paint.Style.FILL else Paint.Style.STROKE
    canvas.drawPath(bookmarkPath, bookmarkPaint)
  }

  private fun drawHeadwordChevron(canvas: Canvas, rect: RectF, leftDirection: Boolean, active: Boolean) {
    iconPaint.color = if (active) Color.rgb(154, 156, 159) else Color.rgb(210, 208, 208)
    iconPaint.strokeWidth = dp(2f)
    val centerX = rect.centerX()
    val centerY = rect.centerY()
    if (leftDirection) {
      canvas.drawLine(centerX + dp(4f), centerY - dp(6f), centerX - dp(3f), centerY, iconPaint)
      canvas.drawLine(centerX - dp(3f), centerY, centerX + dp(4f), centerY + dp(6f), iconPaint)
    } else {
      canvas.drawLine(centerX - dp(4f), centerY - dp(6f), centerX + dp(3f), centerY, iconPaint)
      canvas.drawLine(centerX + dp(3f), centerY, centerX - dp(4f), centerY + dp(6f), iconPaint)
    }
  }

  private fun drawTranslateGlyph(canvas: Canvas, rect: RectF, color: Int) {
    val previousColor = iconPaint.color
    val previousStyle = iconPaint.style
    val previousStrokeWidth = iconPaint.strokeWidth
    iconPaint.color = color
    iconPaint.style = Paint.Style.FILL
    iconPaint.strokeWidth = 0f

    translateIconPath.reset()
    translateIconPath.moveTo(12.87f, 15.07f)
    translateIconPath.lineTo(10.33f, 12.56f)
    translateIconPath.lineTo(10.36f, 12.53f)
    translateIconPath.cubicTo(12.1f, 10.59f, 13.34f, 8.36f, 14.07f, 6f)
    translateIconPath.lineTo(17f, 6f)
    translateIconPath.lineTo(17f, 4f)
    translateIconPath.lineTo(10f, 4f)
    translateIconPath.lineTo(10f, 2f)
    translateIconPath.lineTo(8f, 2f)
    translateIconPath.lineTo(8f, 4f)
    translateIconPath.lineTo(1f, 4f)
    translateIconPath.lineTo(1f, 5.99f)
    translateIconPath.lineTo(12.17f, 5.99f)
    translateIconPath.cubicTo(11.5f, 7.92f, 10.44f, 9.75f, 9f, 11.35f)
    translateIconPath.cubicTo(8.07f, 10.32f, 7.3f, 9.19f, 6.69f, 8f)
    translateIconPath.lineTo(4.69f, 8f)
    translateIconPath.cubicTo(5.42f, 9.63f, 6.42f, 11.17f, 7.67f, 12.56f)
    translateIconPath.lineTo(2.58f, 17.58f)
    translateIconPath.lineTo(4f, 19f)
    translateIconPath.lineTo(9f, 14f)
    translateIconPath.lineTo(12.11f, 17.11f)
    translateIconPath.lineTo(12.87f, 15.07f)
    translateIconPath.close()
    translateIconPath.moveTo(18.5f, 10f)
    translateIconPath.lineTo(16.5f, 10f)
    translateIconPath.lineTo(12f, 22f)
    translateIconPath.lineTo(14f, 22f)
    translateIconPath.lineTo(15.12f, 19f)
    translateIconPath.lineTo(19.87f, 19f)
    translateIconPath.lineTo(21f, 22f)
    translateIconPath.lineTo(23f, 22f)
    translateIconPath.lineTo(18.5f, 10f)
    translateIconPath.close()
    translateIconPath.moveTo(15.88f, 17f)
    translateIconPath.lineTo(17.5f, 12.67f)
    translateIconPath.lineTo(19.12f, 17f)
    translateIconPath.lineTo(15.88f, 17f)
    translateIconPath.close()

    val saveCount = canvas.save()
    canvas.translate(rect.left, rect.top)
    canvas.scale(rect.width() / 24f, rect.height() / 24f)
    canvas.drawPath(translateIconPath, iconPaint)
    canvas.restoreToCount(saveCount)

    iconPaint.color = previousColor
    iconPaint.style = previousStyle
    iconPaint.strokeWidth = previousStrokeWidth
  }

  private fun extractHanjaCharacters(value: String?): List<String> =
    value?.trim().orEmpty()
      .map(Char::toString)
      .filter { token -> token.length == 1 && isHanja(token.first()) }
      .distinct()

  private fun isRegionSelection(card: LookupCard): Boolean =
    card.selection.kind == "line" ||
      card.selection.kind == "sentence" ||
      card.selection.selectedText.trim().contains(Regex("\\s+"))

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
    drawTranslateGlyph(canvas, iconRect, Color.rgb(154, 156, 159))
    drawTranslationHeaderLanguages(canvas, card, iconRect.right + dp(8f), right, iconRect.centerY())

    val translation = card.translation?.trim().orEmpty()
    val body = when {
      translation.isNotBlank() -> translation
      card.state == LookupCardState.LOADED -> OverlayText.t("translating")
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

  private fun drawTranslationHeaderLanguages(
    canvas: Canvas,
    card: LookupCard,
    left: Float,
    right: Float,
    centerY: Float
  ) {
    val available = right - left
    if (available <= dp(8f)) {
      return
    }

    val languages = translationHeaderLanguages(card)
    val gap = dp(5f)
    val arrowWidth = dp(9f)
    var sourceLabel = languages.first
    var targetLabel = languages.second
    val fullWidth = translationLangPaint.measureText(sourceLabel) +
      gap + arrowWidth + gap +
      translationLangPaint.measureText(targetLabel)

    if (fullWidth > available) {
      val textWidth = (available - arrowWidth - gap * 2f).coerceAtLeast(0f)
      val sourceWidth = min(translationLangPaint.measureText(sourceLabel), textWidth * 0.46f)
      val targetWidth = (textWidth - sourceWidth).coerceAtLeast(0f)
      sourceLabel = ellipsize(sourceLabel, translationLangPaint, sourceWidth)
      targetLabel = ellipsize(targetLabel, translationLangPaint, targetWidth)
    }

    val baseline = centeredTextBaseline(translationLangPaint, centerY)
    var x = left
    canvas.drawText(sourceLabel, x, baseline, translationLangPaint)
    x += translationLangPaint.measureText(sourceLabel) + gap
    drawInlineArrow(canvas, x, centerY, arrowWidth, Color.rgb(154, 156, 159))
    x += arrowWidth + gap
    canvas.drawText(targetLabel, x, baseline, translationLangPaint)
  }

  private fun drawInlineArrow(canvas: Canvas, left: Float, centerY: Float, width: Float, color: Int) {
    val previousColor = iconPaint.color
    val previousStyle = iconPaint.style
    val previousStrokeWidth = iconPaint.strokeWidth
    iconPaint.color = color
    iconPaint.style = Paint.Style.STROKE
    iconPaint.strokeWidth = dp(1.2f)

    val right = left + width
    val y = centerY
    canvas.drawLine(left, y, right - dp(1.2f), y, iconPaint)
    canvas.drawLine(right - dp(3.5f), y - dp(3f), right, y, iconPaint)
    canvas.drawLine(right - dp(3.5f), y + dp(3f), right, y, iconPaint)

    iconPaint.color = previousColor
    iconPaint.style = previousStyle
    iconPaint.strokeWidth = previousStrokeWidth
  }

  private fun centeredTextBaseline(paint: Paint, centerY: Float): Float =
    centerY - (paint.ascent() + paint.descent()) / 2f

  private fun translationHeaderLanguages(card: LookupCard): Pair<String, String> {
    val source = card.translationSourceLanguage?.trim().orEmpty()
    val target = card.translationTargetLanguage?.trim().orEmpty()
    return if (source.isNotBlank() && target.isNotBlank()) {
      displayLanguageName(source) to displayLanguageName(target)
    } else {
      OverlayText.displayLanguageName("ko") to OverlayText.displayLanguageName("en")
    }
  }

  private fun translationHeaderLabel(card: LookupCard): String {
    val languages = translationHeaderLanguages(card)
    return "${languages.first} → ${languages.second}"
  }

  private fun displayLanguageName(code: String): String {
    return OverlayText.displayLanguageName(code)
  }

  private fun drawTranslateIcon(canvas: Canvas, rect: RectF) {
    secondaryButtonPaint.color = Color.WHITE
    canvas.drawRoundRect(rect, dp(8f), dp(8f), secondaryButtonPaint)
    canvas.drawRoundRect(rect, dp(8f), dp(8f), buttonStrokePaint)
    val iconSize = min(rect.width(), rect.height()) - dp(10f)
    val iconRect = RectF(
      rect.centerX() - iconSize / 2f,
      rect.centerY() - iconSize / 2f,
      rect.centerX() + iconSize / 2f,
      rect.centerY() + iconSize / 2f
    )
    drawTranslateGlyph(canvas, iconRect, Color.rgb(32, 38, 49))
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

      val definition = entry.definition ?: OverlayText.t("noEnglishDefinitionAvailable")
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

  private fun drawPanelSurface(
    canvas: Canvas,
    rect: RectF,
    topPlacement: Boolean = false,
    floating: Boolean = false
  ) {
    val radius = dp(if (floating) 12f else 16f)
    val topRadius = if (topPlacement) 0f else radius
    val bottomRadius = if (topPlacement || floating) radius else 0f
    val radii = floatArrayOf(
      topRadius, topRadius,
      topRadius, topRadius,
      bottomRadius, bottomRadius,
      bottomRadius, bottomRadius
    )
    panelClipPath.reset()
    panelClipPath.addRoundRect(rect, radii, Path.Direction.CW)
    panelShadowPaint.setShadowLayer(
      dp(if (floating) 24f else 30f),
      0f,
      if (topPlacement || floating) dp(if (floating) 8f else 10f) else -dp(10f),
      Color.argb(20, 27, 28, 28)
    )
    canvas.drawPath(panelClipPath, panelShadowPaint)
    canvas.drawPath(panelClipPath, cardPaint)
    canvas.drawPath(panelClipPath, cardStrokePaint)
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
      HanjaPopupState.LOADING -> OverlayText.t("loading")
      HanjaPopupState.ERROR -> OverlayText.t("hanja")
      HanjaPopupState.LOADED -> popup.sound?.takeIf(String::isNotBlank) ?: OverlayText.t("hanja")
    }
    val meaning = when (popup.state) {
      HanjaPopupState.LOADING -> popup.message ?: OverlayText.t("loadingHanja")
      HanjaPopupState.ERROR -> popup.message ?: OverlayText.t("hanjaLookupFailed")
      HanjaPopupState.LOADED -> popup.meaning?.takeIf(String::isNotBlank) ?: OverlayText.t("noHanjaDetailsFound")
    }
    val meaningPaint = if (popup.state == HanjaPopupState.ERROR) cardErrorPaint else popupMeaningPaint
    canvas.drawText(ellipsize(reading, popupReadingPaint, contentRight - textLeft), textLeft, hanjaPopupRect.top + dp(31f), popupReadingPaint)
    canvas.drawText(ellipsize(meaning, meaningPaint, contentRight - textLeft), textLeft, hanjaPopupRect.top + dp(49f), meaningPaint)
    canvas.drawLine(hanjaPopupRect.left, headerBottom, hanjaPopupRect.right, headerBottom, dividerPaint)

    val labelBaseline = headerBottom + dp(21f)
    canvas.drawText(OverlayText.t("relatedWords").uppercase(), contentLeft, labelBaseline, relatedHeaderPaint)
    canvas.drawText(OverlayText.t("tapToMarkKnown"), contentRight, labelBaseline, relatedHintPaint)

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
            val label = OverlayText.t("more").uppercase()
            val labelX = hanjaLoadMoreRect.centerX() - relatedHeaderPaint.measureText(label) / 2f
            canvas.drawText(label, labelX, hanjaLoadMoreRect.centerY() + dp(4f), relatedHeaderPaint)
          }
        }
      }

      canvas.restore()
    } else if (popup.state != HanjaPopupState.LOADING) {
      canvas.drawText(
        OverlayText.t("noRelatedWordsAvailable"),
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

  private fun startMultiSelect(target: OcrTapTarget) {
    lookupCard = null
    hanjaPopup = null
    clearHanjaLoadMore()
    if (multiSelectTargets.isEmpty()) {
      multiSelectMode = MultiSelectOrderMode.LEFT_TO_RIGHT
    }
    addMultiSelectTarget(target)
    invalidate()
  }

  private fun handleMultiSelectTap(x: Float, y: Float, result: SerializedOcrResult): Boolean {
    multiSelectModeRects.firstOrNull { it.rect.contains(x, y) }?.let { modeRect ->
      multiSelectMode = modeRect.mode
      invalidate()
      return true
    }
    if (multiSelectTranslateRect.contains(x, y)) {
      translateMultiSelection(result)
      return true
    }
    if (multiSelectClearRect.contains(x, y)) {
      clearMultiSelect()
      invalidate()
      return true
    }

    findTargetObjectAt(x, y, result)?.let { target ->
      toggleMultiSelectTarget(target)
      invalidate()
      return true
    }

    return false
  }

  private fun translateMultiSelection(result: SerializedOcrResult) {
    val sentence = buildSelectedSentence(result).trim()
    if (sentence.isBlank()) {
      return
    }

    val box = mergeSelectedTargetBoxes()
    val requestId = "sentence-${UUID.randomUUID()}"
    val selection = OcrTapSelection(
      selectedText = sentence,
      lineText = sentence,
      box = box,
      kind = "sentence"
    )
    lookupPanelPlacement = placementForSelection(selection)
    isLookupExpanded = false
    activeRootCharacterIndex = 0
    rootRelatedVisibleCounts.clear()
    resetLookupPanelGesture()
    resetRootCarouselGesture()
    lookupCard = LookupCard(
      requestId = requestId,
      selection = selection,
      wordOptions = emptyList(),
      activeWordIndex = 0,
      state = LookupCardState.LOADED,
      surface = sentence,
      sourceSentence = sentence,
      stem = sentence,
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
      showingTranslation = true,
      translationRequested = true,
      expandedAlternatives = false,
      savingAlternativeIndex = null,
      message = null
    )
    hanjaPopup = null
    invalidate()
    onTranslationRequested(requestId, sentence)
  }

  private fun addMultiSelectTarget(target: OcrTapTarget) {
    val key = targetKey(target)
    if (multiSelectTargetKeys.add(key)) {
      multiSelectTargets.add(target)
    }
  }

  private fun toggleMultiSelectTarget(target: OcrTapTarget) {
    val key = targetKey(target)
    if (multiSelectTargetKeys.remove(key)) {
      multiSelectTargets.removeAll { targetKey(it) == key }
    } else {
      addMultiSelectTarget(target)
    }
  }

  private fun clearMultiSelect() {
    multiSelectTargets.clear()
    multiSelectTargetKeys.clear()
    multiSelectPanelRect.setEmpty()
    multiSelectTranslateRect.setEmpty()
    multiSelectClearRect.setEmpty()
    multiSelectModeRects.clear()
    cancelPendingLongPress()
  }

  private fun cancelPendingLongPress() {
    removeCallbacks(longPressRunnable)
    pendingLongPressTarget = null
    longPressHandled = false
  }

  private fun buildSelectedSentence(result: SerializedOcrResult): String =
    sortTargetsForSentence(multiSelectTargets, result)
      .joinToString(separator = " ") { target -> target.text.trim().ifBlank { target.lineText.trim() } }
      .replace(Regex("\\s+([,.!?;:])"), "$1")
      .replace(Regex("\\s+"), " ")
      .trim()

  private fun sortTargetsForSentence(
    targets: List<OcrTapTarget>,
    result: SerializedOcrResult
  ): List<OcrTapTarget> {
    val transform = currentTransform(result)
    return when (multiSelectMode) {
      MultiSelectOrderMode.LEFT_TO_RIGHT -> sortTargetsByRows(targets, transform, leftToRight = true)
      MultiSelectOrderMode.RIGHT_TO_LEFT -> sortTargetsByRows(targets, transform, leftToRight = false)
    }
  }

  private fun sortTargetsByRows(
    targets: List<OcrTapTarget>,
    transform: ImageToOverlayTransform,
    leftToRight: Boolean
  ): List<OcrTapTarget> {
    val rows = mutableListOf<MutableList<OcrTapTarget>>()
    val sorted = targets.sortedBy { transform.mapRect(it.box).centerY() }
    val rowTolerance = sorted.map { transform.mapRect(it.box).height() }.average()
      .takeIf { !it.isNaN() && it > 0.0 }
      ?.toFloat()
      ?.let { max(dp(12f), it * 0.55f) }
      ?: dp(18f)

    sorted.forEach { target ->
      val centerY = transform.mapRect(target.box).centerY()
      val row = rows.firstOrNull { existing ->
        val averageY = existing.map { transform.mapRect(it.box).centerY() }.average().toFloat()
        abs(averageY - centerY) <= rowTolerance
      }
      if (row == null) {
        rows.add(mutableListOf(target))
      } else {
        row.add(target)
      }
    }

    return rows.flatMap { row ->
      if (leftToRight) {
        row.sortedBy { transform.mapRect(it.box).centerX() }
      } else {
        row.sortedByDescending { transform.mapRect(it.box).centerX() }
      }
    }
  }

  private fun mergeSelectedTargetBoxes(): Rect {
    if (multiSelectTargets.isEmpty()) {
      return Rect()
    }

    return Rect(
      multiSelectTargets.minOf { it.box.left },
      multiSelectTargets.minOf { it.box.top },
      multiSelectTargets.maxOf { it.box.right },
      multiSelectTargets.maxOf { it.box.bottom }
    )
  }

  private fun targetKey(target: OcrTapTarget): String =
    "${target.kind}|${target.text}|${target.box.left},${target.box.top},${target.box.right},${target.box.bottom}"

  private fun findTargetObjectAt(x: Float, y: Float, result: SerializedOcrResult): OcrTapTarget? =
    visibleTargets(result).asReversed().firstOrNull { target ->
      currentTransform(result).mapRect(target.box).apply {
        inset(-dp(8f), -dp(8f))
      }.contains(x, y)
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

    lookupPanelPlacement = placementForSelection(nextSelection)
    isLookupExpanded = false
    activeRootCharacterIndex = 0
    rootRelatedVisibleCounts.clear()
    resetLookupPanelGesture()
    resetRootCarouselGesture()
    lookupCard = card.copy(
      selection = nextSelection,
      activeWordIndex = nextIndex,
      state = LookupCardState.LOADING,
      surface = options[nextIndex],
      sourceSentence = nextSelection.lineText,
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
      translationRequested = false,
      expandedAlternatives = false,
      savingAlternativeIndex = null,
      message = OverlayText.t("lookingUp")
    )
    hanjaPopup = null
    invalidate()
    onWordNavigationRequested(nextSelection)
  }

  private fun lookupWordOptionsFor(selection: OcrTapSelection): List<String> {
    val selected = selection.selectedText.trim()
    if (selection.kind == "sentence") {
      return listOfNotNull(selected.takeIf(String::isNotEmpty))
    }

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

  private fun translationQueryForCard(card: LookupCard): String =
    if (isRegionSelection(card)) {
      card.sourceSentence.ifBlank {
        card.selection.lineText.ifBlank { card.selection.selectedText }
      }
    } else {
      card.stem.ifBlank { card.surface.ifBlank { card.selection.selectedText } }
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
    val overlayLocation = IntArray(2)
    getLocationOnScreen(overlayLocation)

    return ImageToOverlayTransform(
      imageWidth = imageWidth,
      imageHeight = imageHeight,
      overlayWidth = overlayWidth,
      overlayHeight = overlayHeight,
      overlayScreenLeft = overlayLocation[0].toFloat(),
      overlayScreenTop = overlayLocation[1].toFloat()
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
        "overlayOrigin=${transform.overlayScreenLeft},${transform.overlayScreenTop} " +
        "image=${transform.imageWidth}x${transform.imageHeight} " +
        "scaleX=${transform.scaleX} scaleY=${transform.scaleY} " +
        "targets=${result.targets.size} " +
        "firstTargets=$firstBoxes"
    )
  }

  private fun buildMetaLine(card: LookupCard): String =
    listOf(
      card.romanization,
      if (card.surface != card.stem) OverlayText.fromSurface(card.surface) else null
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
      return OverlayText.posLabel(mapped)
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
  val sourceSentence: String,
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
  val translationRequested: Boolean,
  val expandedAlternatives: Boolean,
  val savingAlternativeIndex: Int?,
  val message: String?
) {
  val displayBody: String
    get() = when (state) {
      LookupCardState.LOADING -> message ?: OverlayText.t("lookingUp")
      LookupCardState.SAVING -> message ?: OverlayText.t("saving")
      LookupCardState.ERROR -> message ?: OverlayText.t("lookupFailed")
      LookupCardState.FALLBACK -> message ?: OverlayText.t("openAppToLookup")
      LookupCardState.LOADED -> definition ?: OverlayText.t("noDefinitionFound")
    }

  val showSaveButton: Boolean
    get() = state == LookupCardState.LOADED || state == LookupCardState.SAVING

  val canToggleSave: Boolean
    get() = state == LookupCardState.LOADED && !definition.isNullOrBlank()

  val hasRootCharacters: Boolean
    get() = hanja?.any { char ->
      char in '\u3400'..'\u4DBF' ||
        char in '\u4E00'..'\u9FFF' ||
        char in '\uF900'..'\uFAFF'
    } == true

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
      "Inter_700Bold.ttf",
      "fonts/Inter_700Bold.ttf",
      "node_modules/@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf"
    )
    "medium" -> listOf(
      "Inter_500Medium.ttf",
      "fonts/Inter_500Medium.ttf",
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
  val rect: RectF,
  val sourceWord: String? = null,
  val sourceHanja: String? = null,
  val preloadIndex: Int? = null,
  val embeddedRoot: Boolean = false
)

private data class RootSeeMoreRect(
  val sourceWord: String,
  val sourceHanja: String,
  val totalCount: Int,
  val rect: RectF
)

private data class MultiSelectModeRect(
  val mode: MultiSelectOrderMode,
  val rect: RectF
)

private enum class MultiSelectOrderMode(val label: String) {
  LEFT_TO_RIGHT("L-R"),
  RIGHT_TO_LEFT("R-L")
}

private enum class LookupPanelPlacement {
  TOP,
  BOTTOM
}

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
  val overlayHeight: Float,
  val overlayScreenLeft: Float,
  val overlayScreenTop: Float
) {
  private val screenWidth: Float = maxOf(imageWidth, overlayScreenLeft + overlayWidth)
  private val screenHeight: Float = maxOf(imageHeight, overlayScreenTop + overlayHeight)
  val scaleX: Float = screenWidth / imageWidth
  val scaleY: Float = screenHeight / imageHeight

  fun mapRect(rect: android.graphics.Rect): RectF =
    RectF(
      rect.left * scaleX - overlayScreenLeft,
      rect.top * scaleY - overlayScreenTop,
      rect.right * scaleX - overlayScreenLeft,
      rect.bottom * scaleY - overlayScreenTop
    )

  fun overlayToImageX(x: Float): Float =
    ((x + overlayScreenLeft) / scaleX).coerceIn(0f, imageWidth)
}

private const val TAG = "OcrResultOverlay"
