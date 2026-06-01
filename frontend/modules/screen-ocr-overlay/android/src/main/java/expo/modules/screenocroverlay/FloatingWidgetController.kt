package expo.modules.screenocroverlay

import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
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
  private var resultOverlayView: OcrResultOverlayView? = null
  private var lastBubbleX: Int? = null
  private var lastBubbleY: Int? = null
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
    val view = TextView(context).apply {
      text = "OCR"
      textSize = 13f
      typeface = Typeface.DEFAULT_BOLD
      gravity = Gravity.CENTER
      setTextColor(Color.WHITE)
      background = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(Color.rgb(47, 125, 76))
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
    bubbleParams?.let { params ->
      lastBubbleX = params.x
      lastBubbleY = params.y
    }

    bubbleView?.let { view ->
      try {
        windowManager.removeView(view)
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
    var didLongPress = false

    val longPressRunnable = Runnable {
      didLongPress = true
      onStopRequested()
    }

    view.setOnTouchListener { _, event ->
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
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
          }

          params.x = startX + dx.toInt()
          params.y = startY + dy.toInt()
          lastBubbleX = params.x
          lastBubbleY = params.y

          try {
            windowManager.updateViewLayout(view, params)
          } catch (_: Exception) {
          }
          true
        }

        MotionEvent.ACTION_UP -> {
          mainHandler.removeCallbacks(longPressRunnable)
          val moved = abs(event.rawX - downRawX) > touchSlop || abs(event.rawY - downRawY) > touchSlop

          if (!moved && !didLongPress) {
            onBubbleTap()
          }
          true
        }

        MotionEvent.ACTION_CANCEL -> {
          mainHandler.removeCallbacks(longPressRunnable)
          true
        }

        else -> false
      }
    }
  }

  private fun dp(value: Float): Float = value * density
}
