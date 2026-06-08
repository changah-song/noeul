package expo.modules.screenocroverlay

import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.widget.TextView
import android.widget.ImageView
import kotlin.math.abs
import kotlin.math.max

class FloatingWidgetController(
  private val context: Context,
  private val onBubbleTap: () -> Unit,
  private val onStopRequested: () -> Unit,
  private val onTargetSelected: (OcrTapSelection) -> Unit,
  private val onWordNavigationRequested: (OcrTapSelection) -> Unit,
  private val onSaveRequested: (String, Int?) -> Unit,
  private val onHanjaRequested: (String, String) -> Unit,
  private val onRelatedKnownToggleRequested: (String, String, OverlayHanjaRelatedWord) -> Unit,
  private val onResultOverlayClosed: () -> Unit
) {
  private val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
  private val mainHandler = Handler(Looper.getMainLooper())
  private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
  private val density = context.resources.displayMetrics.density
  private var bubbleView: View? = null
  private var bubbleParams: WindowManager.LayoutParams? = null
  private var dismissTargetView: TextView? = null
  private var dismissTargetActive = false
  private var resultOverlayView: OcrResultOverlayView? = null
  private var lastBubbleX: Int? = null
  private var lastBubbleY: Int? = null
  private var lastBubbleRect: RectF? = null
  private var restoreBubbleAfterHiddenCapture = false

  val isBubbleVisible: Boolean
    get() = bubbleView != null

  val isResultOverlayVisible: Boolean
    get() = resultOverlayView != null

  fun showBubble(): Boolean {
    if (bubbleView != null) {
      return true
    }
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      throw IllegalStateException("Floating OCR requires Android 8 or newer")
    }
    if (!Settings.canDrawOverlays(context)) {
      throw IllegalStateException("Overlay permission is not granted")
    }

    val size = dp(58f).toInt()
    val iconPadding = dp(5f).toInt()
    val view = ImageView(context).apply {
      setImageResource(context.applicationInfo.icon)
      scaleType = ImageView.ScaleType.CENTER_CROP
      setPadding(iconPadding, iconPadding, iconPadding, iconPadding)
      background = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(Color.WHITE)
        setStroke(dp(2f).toInt(), Color.argb(150, 255, 255, 255))
      }
      elevation = dp(8f)
      contentDescription = "Floating OCR"
    }
    val displayMetrics = context.resources.displayMetrics
    val params = WindowManager.LayoutParams(
      size,
      size,
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
      PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      x = lastBubbleX ?: max(dp(12f).toInt(), displayMetrics.widthPixels - size - dp(18f).toInt())
      y = lastBubbleY ?: max(dp(84f).toInt(), displayMetrics.heightPixels / 3)
    }

    attachDragHandler(view, params)
    windowManager.addView(view, params)
    bubbleView = view
    bubbleParams = params

    return true
  }

  fun hideBubble() {
    hideDismissTarget()

    val params = bubbleParams
    val view = bubbleView
    if (params != null && view != null) {
      lastBubbleRect = bubbleRect(params, view)
    }

    params?.let {
      lastBubbleX = params.x
      lastBubbleY = params.y
    }

    bubbleView?.let { floatingView ->
      try {
        windowManager.removeView(floatingView)
      } catch (_: Exception) {
      }
    }

    bubbleView = null
    bubbleParams = null
  }

  fun showResultOverlayShell(): Boolean = showOrUpdateResultOverlay(null)

  fun showResultOverlay(result: SerializedOcrResult): Boolean = showOrUpdateResultOverlay(result)

  fun getResultOverlayBoundsOnScreen(): OverlayCaptureBounds? {
    val view = resultOverlayView ?: return null
    if (view.width <= 0 || view.height <= 0) {
      return null
    }

    val location = IntArray(2)
    view.getLocationOnScreen(location)

    return OverlayCaptureBounds(
      left = location[0],
      top = location[1],
      width = view.width,
      height = view.height
    )
  }

  fun waitForResultOverlayBounds(timeoutMs: Long, onBounds: (OverlayCaptureBounds?) -> Unit) {
    val startedAt = SystemClock.uptimeMillis()
    val poller = object : Runnable {
      override fun run() {
        val bounds = getResultOverlayBoundsOnScreen()
        if (bounds != null) {
          onBounds(bounds)
          return
        }

        if (SystemClock.uptimeMillis() - startedAt >= timeoutMs) {
          onBounds(null)
          return
        }

        mainHandler.postDelayed(this, 16L)
      }
    }

    mainHandler.post(poller)
  }

  private fun showOrUpdateResultOverlay(result: SerializedOcrResult?): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      throw IllegalStateException("Floating OCR requires Android 8 or newer")
    }
    if (!Settings.canDrawOverlays(context)) {
      throw IllegalStateException("Overlay permission is not granted")
    }

    resultOverlayView?.let { view ->
      view.setCloseAnchorRect(lastBubbleRect)
      if (result == null) {
        view.clearResult()
      } else {
        view.setResult(result)
      }
      return true
    }

    val overlayView = OcrResultOverlayView(
      context = context,
      ocrResult = result,
      onTargetSelected = onTargetSelected,
      onWordNavigationRequested = onWordNavigationRequested,
      onSaveRequested = onSaveRequested,
      onHanjaRequested = onHanjaRequested,
      onRelatedKnownToggleRequested = onRelatedKnownToggleRequested,
      closeAnchorRectOnScreen = lastBubbleRect?.let { RectF(it) },
      onClose = {
        hideResultOverlay()
        try {
          restoreBubbleIfNeeded()
        } catch (_: Exception) {
        }
        onResultOverlayClosed()
      }
    )
    val params = WindowManager.LayoutParams(
      WindowManager.LayoutParams.MATCH_PARENT,
      WindowManager.LayoutParams.MATCH_PARENT,
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
      PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.TOP or Gravity.START
    }

    windowManager.addView(overlayView, params)
    resultOverlayView = overlayView

    return true
  }

  fun showLookupLoading(requestId: String, selection: OcrTapSelection) {
    resultOverlayView?.showLookupLoading(requestId, selection)
  }

  fun showLookupResult(result: OverlayLookupResult) {
    resultOverlayView?.showLookupResult(result)
  }

  fun showLookupError(requestId: String, message: String, fallback: Boolean) {
    resultOverlayView?.showLookupError(requestId, message, fallback)
  }

  fun hasLookupCard(requestId: String): Boolean =
    resultOverlayView?.hasLookupCard(requestId) == true

  fun showSaving(requestId: String, alternativeIndex: Int?) {
    resultOverlayView?.showSaving(requestId, alternativeIndex)
  }

  fun showSaveResult(result: OverlaySaveResult) {
    resultOverlayView?.showSaveResult(result)
  }

  fun showSaveError(requestId: String, message: String) {
    resultOverlayView?.showSaveError(requestId, message)
  }

  fun showHanjaLoading(requestId: String, character: String, sourceWord: String) {
    resultOverlayView?.showHanjaLoading(requestId, character, sourceWord)
  }

  fun showHanjaResult(result: OverlayHanjaResult) {
    resultOverlayView?.showHanjaResult(result)
  }

  fun hasHanjaPopup(requestId: String): Boolean =
    resultOverlayView?.hasHanjaPopup(requestId) == true

  fun showHanjaError(requestId: String, message: String) {
    resultOverlayView?.showHanjaError(requestId, message)
  }

  fun hideResultOverlay() {
    resultOverlayView?.let { view ->
      try {
        windowManager.removeView(view)
      } catch (_: Exception) {
      }
    }

    resultOverlayView = null
  }

  fun hideOverlaysForCapture(): Boolean {
    val shouldRestoreBubble = hideBubbleForCapture()
    hideResultOverlay()
    return shouldRestoreBubble
  }

  fun hideBubbleForCapture(): Boolean {
    val shouldRestoreBubble = isBubbleVisible || restoreBubbleAfterHiddenCapture
    restoreBubbleAfterHiddenCapture = shouldRestoreBubble
    hideBubble()
    return shouldRestoreBubble
  }

  fun restoreBubbleIfNeeded() {
    if (!restoreBubbleAfterHiddenCapture) {
      return
    }

    restoreBubbleAfterHiddenCapture = false
    showBubble()
  }

  fun removeAll() {
    restoreBubbleAfterHiddenCapture = false
    hideResultOverlay()
    hideBubble()
  }

  private fun attachDragHandler(view: View, params: WindowManager.LayoutParams) {
    var downRawX = 0f
    var downRawY = 0f
    var startX = 0
    var startY = 0
    var isDragging = false
    var didLongPress = false

    val longPressRunnable = Runnable {
      didLongPress = true
      onStopRequested()
    }

    view.setOnTouchListener { _, event ->
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          isDragging = false
          didLongPress = false
          downRawX = event.rawX
          downRawY = event.rawY
          startX = params.x
          startY = params.y
          mainHandler.postDelayed(longPressRunnable, ViewConfiguration.getLongPressTimeout().toLong())
          true
        }

        MotionEvent.ACTION_MOVE -> {
          val dx = event.rawX - downRawX
          val dy = event.rawY - downRawY

          if (abs(dx) > touchSlop || abs(dy) > touchSlop) {
            mainHandler.removeCallbacks(longPressRunnable)
            isDragging = true
          }

          params.x = startX + dx.toInt()
          params.y = startY + dy.toInt()
          lastBubbleX = params.x
          lastBubbleY = params.y

          try {
            windowManager.updateViewLayout(view, params)
          } catch (_: Exception) {
          }

          if (isDragging) {
            showDismissTarget(isBubbleInsideDismissTarget(params, view))
          }
          true
        }

        MotionEvent.ACTION_UP -> {
          mainHandler.removeCallbacks(longPressRunnable)
          val moved = abs(event.rawX - downRawX) > touchSlop || abs(event.rawY - downRawY) > touchSlop
          val shouldDismiss = isDragging && isBubbleInsideDismissTarget(params, view)
          hideDismissTarget()

          if (shouldDismiss) {
            onStopRequested()
          } else if (!moved && !didLongPress) {
            onBubbleTap()
          }
          true
        }

        MotionEvent.ACTION_CANCEL -> {
          mainHandler.removeCallbacks(longPressRunnable)
          hideDismissTarget()
          true
        }

        else -> false
      }
    }
  }

  private fun showDismissTarget(active: Boolean) {
    val targetWidth = dismissTargetWidth()
    val targetHeight = dismissTargetHeight()
    val view = dismissTargetView ?: TextView(context).apply {
      text = "X"
      textSize = 17f
      typeface = Typeface.DEFAULT_BOLD
      gravity = Gravity.CENTER or Gravity.TOP
      includeFontPadding = false
      setPadding(0, dp(9f).toInt(), 0, 0)
      setTextColor(Color.WHITE)
      elevation = dp(10f)
      contentDescription = "Dismiss floating OCR"
    }.also { newView ->
      val params = WindowManager.LayoutParams(
        targetWidth,
        targetHeight,
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
          WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
          WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
        PixelFormat.TRANSLUCENT
      ).apply {
        gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
        y = 0
      }

      windowManager.addView(newView, params)
      dismissTargetView = newView
    }

    updateDismissTarget(view, active)
  }

  private fun updateDismissTarget(view: TextView, active: Boolean) {
    if (dismissTargetActive == active && view.background != null) {
      return
    }

    dismissTargetActive = active
    view.background = GradientDrawable().apply {
      shape = GradientDrawable.RECTANGLE
      cornerRadii = floatArrayOf(
        dismissTargetHeight().toFloat(),
        dismissTargetHeight().toFloat(),
        dismissTargetHeight().toFloat(),
        dismissTargetHeight().toFloat(),
        0f,
        0f,
        0f,
        0f
      )
      setColor(if (active) Color.rgb(191, 77, 49) else Color.argb(210, 48, 42, 35))
      setStroke(dp(2f).toInt(), Color.argb(if (active) 235 else 120, 255, 255, 255))
    }
  }

  private fun hideDismissTarget() {
    dismissTargetView?.let { view ->
      try {
        windowManager.removeView(view)
      } catch (_: Exception) {
      }
    }

    dismissTargetView = null
    dismissTargetActive = false
  }

  private fun isBubbleInsideDismissTarget(params: WindowManager.LayoutParams, view: View): Boolean {
    val bubbleRect = bubbleRect(params, view)
    val targetRect = dismissTargetRect()

    return RectF.intersects(bubbleRect, targetRect)
  }

  private fun bubbleRect(params: WindowManager.LayoutParams, view: View): RectF {
    val bubbleWidth = view.width.takeIf { it > 0 } ?: params.width
    val bubbleHeight = view.height.takeIf { it > 0 } ?: params.height

    return RectF(
      params.x.toFloat(),
      params.y.toFloat(),
      params.x + bubbleWidth.toFloat(),
      params.y + bubbleHeight.toFloat()
    )
  }

  private fun dismissTargetRect(): RectF {
    val metrics = context.resources.displayMetrics
    val width = dismissTargetWidth().toFloat()
    val height = dismissTargetHeight().toFloat()
    val left = (metrics.widthPixels - width) / 2f
    val top = metrics.heightPixels - height

    return RectF(left, top, left + width, metrics.heightPixels.toFloat())
  }

  private fun dismissTargetWidth(): Int = dp(74f).toInt()

  private fun dismissTargetHeight(): Int = dp(38f).toInt()

  private fun dp(value: Float): Float = value * density
}
