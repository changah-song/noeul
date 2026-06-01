package expo.modules.screenocroverlay

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.DisplayMetrics
import android.util.Log
import android.view.WindowManager
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.korean.KoreanTextRecognizerOptions
import java.io.File
import java.io.FileOutputStream

private const val IMAGE_ACQUIRE_ATTEMPTS = 9
private const val IMAGE_ACQUIRE_DELAY_MS = 80L
private const val DEBUG_BOX_LOG_LIMIT = 10
private const val TAG = "ScreenOcrCapture"

class ScreenCaptureSession(
  private val context: Context,
  resultCode: Int,
  data: Intent,
  private val onStopped: () -> Unit
) {
  private val captureLock = Any()
  private val mainHandler = Handler(Looper.getMainLooper())
  private val recognizer = TextRecognition.getClient(KoreanTextRecognizerOptions.Builder().build())
  private val projection: MediaProjection
  private var imageReader: ImageReader
  private var virtualDisplay: VirtualDisplay
  private val callback = object : MediaProjection.Callback() {
    override fun onStop() {
      release(stopProjection = false)
      onStopped()
    }

    override fun onCapturedContentResize(width: Int, height: Int) {
      if (width <= 0 || height <= 0) {
        return
      }

      mainHandler.post {
        resizeCapture(width, height)
      }
    }
  }
  private var released = false

  private var captureWidth: Int
  private var captureHeight: Int
  private val densityDpi: Int

  init {
    val metrics = resolveCaptureMetrics(context)
    captureWidth = metrics.width
    captureHeight = metrics.height
    densityDpi = metrics.densityDpi

    val projectionManager = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
    projection = projectionManager.getMediaProjection(resultCode, data)
      ?: throw IllegalStateException("MediaProjection could not be created")

    imageReader = createImageReader(captureWidth, captureHeight)
    projection.registerCallback(callback, mainHandler)
    virtualDisplay = projection.createVirtualDisplay(
      "FluentFableScreenOcr",
      captureWidth,
      captureHeight,
      densityDpi,
      DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
      imageReader.surface,
      null,
      mainHandler
    )
  }

  fun analyzeLatestImage(cropBounds: OverlayCaptureBounds? = null): SerializedOcrResult {
    check(!released) { "Screen capture session is no longer active" }

    val image = acquireLatestImageWithRetry()
      ?: throw IllegalStateException("No screen image is available yet")

    image.use { currentImage ->
      val fullBitmap = currentImage.toBitmap()
      var cropBitmap: Bitmap? = null
      return try {
        val appliedCropBounds = sanitizeCropBounds(cropBounds, fullBitmap)
        val ocrBitmap = if (appliedCropBounds != null) {
          Bitmap.createBitmap(
            fullBitmap,
            appliedCropBounds.left,
            appliedCropBounds.top,
            appliedCropBounds.width,
            appliedCropBounds.height
          ).also { cropBitmap = it }
        } else {
          fullBitmap
        }
        val inputImage = InputImage.fromBitmap(ocrBitmap, 0)
        val ocrResult = Tasks.await(recognizer.process(inputImage))
        val serialized = OcrSerializer.serialize(
          result = ocrResult,
          imageWidth = ocrBitmap.width,
          imageHeight = ocrBitmap.height,
          filterTopChrome = appliedCropBounds == null
        )
        val debugBitmapPath = saveDebugBitmap(ocrBitmap, serialized.debugBoxes)
        val debugInfo = buildDebugInfo(
          fullBitmap = fullBitmap,
          ocrBitmap = ocrBitmap,
          cropBounds = appliedCropBounds,
          serialized = serialized,
          debugBitmapPath = debugBitmapPath
        )

        logCaptureGeometry(
          fullBitmap = fullBitmap,
          ocrBitmap = ocrBitmap,
          cropBounds = appliedCropBounds,
          serialized = serialized,
          debugBitmapPath = debugBitmapPath
        )
        serialized.copy(
          result = serialized.result + mapOf(
            "debugOverlayBitmapUri" to debugBitmapPath?.let { File(it).toURI().toString() },
            "debug" to debugInfo
          )
        )
      } finally {
        if (cropBitmap != null && cropBitmap !== fullBitmap) {
          cropBitmap?.recycle()
        }
        fullBitmap.recycle()
      }
    }
  }

  fun release() {
    release(stopProjection = true)
  }

  private fun release(stopProjection: Boolean) {
    if (released) {
      return
    }

    synchronized(captureLock) {
      released = true

      try {
        virtualDisplay.release()
      } catch (_: Exception) {
      }

      try {
        imageReader.close()
      } catch (_: Exception) {
      }
    }

    try {
      projection.unregisterCallback(callback)
    } catch (_: Exception) {
    }

    if (stopProjection) {
      try {
        projection.stop()
      } catch (_: Exception) {
      }
    }

    try {
      recognizer.close()
    } catch (_: Exception) {
    }
  }

  private fun acquireLatestImageWithRetry(): Image? {
    repeat(IMAGE_ACQUIRE_ATTEMPTS) { attempt ->
      try {
        synchronized(captureLock) {
          if (released) {
            return null
          }
          imageReader.acquireLatestImage()
        }?.let { return it }
      } catch (_: IllegalStateException) {
      }

      if (attempt < IMAGE_ACQUIRE_ATTEMPTS - 1) {
        Thread.sleep(IMAGE_ACQUIRE_DELAY_MS)
      }
    }

    return null
  }

  private fun resizeCapture(width: Int, height: Int) {
    synchronized(captureLock) {
      if (released || width == captureWidth && height == captureHeight) {
        return
      }

      val nextImageReader = createImageReader(width, height)
      val previousImageReader = imageReader

      try {
        virtualDisplay.resize(width, height, densityDpi)
        virtualDisplay.setSurface(nextImageReader.surface)
        imageReader = nextImageReader
        captureWidth = width
        captureHeight = height
        previousImageReader.close()
        Log.d(TAG, "captured content resized to ${width}x$height density=$densityDpi")
      } catch (error: Exception) {
        nextImageReader.close()
        Log.w(TAG, "failed to resize captured content to ${width}x$height", error)
      }
    }
  }

  private fun createImageReader(width: Int, height: Int): ImageReader =
    ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2)

  private fun Image.toBitmap(): Bitmap {
    val plane = planes.firstOrNull()
      ?: throw IllegalStateException("Captured image has no pixel plane")
    val buffer = plane.buffer
    val pixelStride = plane.pixelStride
    val rowStride = plane.rowStride
    val rowPadding = rowStride - pixelStride * width
    val paddedWidth = width + (rowPadding / pixelStride).coerceAtLeast(0)

    buffer.rewind()
    val paddedBitmap = Bitmap.createBitmap(paddedWidth, height, Bitmap.Config.ARGB_8888)
    paddedBitmap.copyPixelsFromBuffer(buffer)

    if (paddedWidth == width) {
      return paddedBitmap
    }

    return Bitmap.createBitmap(paddedBitmap, 0, 0, width, height).also {
      paddedBitmap.recycle()
    }
  }

  private fun sanitizeCropBounds(
    cropBounds: OverlayCaptureBounds?,
    fullBitmap: Bitmap
  ): OverlayCaptureBounds? {
    if (cropBounds == null || cropBounds.width <= 0 || cropBounds.height <= 0) {
      return null
    }

    val cropLeft = cropBounds.left.coerceIn(0, fullBitmap.width - 1)
    val cropTop = cropBounds.top.coerceIn(0, fullBitmap.height - 1)
    val cropWidth = cropBounds.width.coerceAtMost(fullBitmap.width - cropLeft).coerceAtLeast(1)
    val cropHeight = cropBounds.height.coerceAtMost(fullBitmap.height - cropTop).coerceAtLeast(1)

    return OverlayCaptureBounds(
      left = cropLeft,
      top = cropTop,
      width = cropWidth,
      height = cropHeight
    )
  }

  private fun buildDebugInfo(
    fullBitmap: Bitmap,
    ocrBitmap: Bitmap,
    cropBounds: OverlayCaptureBounds?,
    serialized: SerializedOcrResult,
    debugBitmapPath: String?
  ): Map<String, Any?> =
    mapOf(
      "capturedBitmapWidth" to fullBitmap.width,
      "capturedBitmapHeight" to fullBitmap.height,
      "ocrBitmapWidth" to ocrBitmap.width,
      "ocrBitmapHeight" to ocrBitmap.height,
      "overlayCaptureBounds" to cropBounds?.toMap(),
      "readerWidth" to captureWidth,
      "readerHeight" to captureHeight,
      "displayRotation" to displayRotation(),
      "windowBounds" to windowBoundsDebug(),
      "targetCount" to serialized.targets.size,
      "debugBoxCount" to serialized.debugBoxes.size,
      "debugOverlayBitmapPath" to debugBitmapPath,
      "firstBoxes" to serialized.debugBoxes
        .take(DEBUG_BOX_LOG_LIMIT)
        .map(OcrSerializer::serializeDebugBox)
    )

  private fun logCaptureGeometry(
    fullBitmap: Bitmap,
    ocrBitmap: Bitmap,
    cropBounds: OverlayCaptureBounds?,
    serialized: SerializedOcrResult,
    debugBitmapPath: String?
  ) {
    val firstBoxes = serialized.debugBoxes
      .take(DEBUG_BOX_LOG_LIMIT)
      .joinToString(separator = " | ") { box ->
        "${box.kind}:${box.accepted}:${box.text.take(28)}@${box.box.flattenToString()}"
      }

    Log.d(
      TAG,
      "fullBitmap=${fullBitmap.width}x${fullBitmap.height} " +
        "overlayBounds=${cropBounds?.toLogString() ?: "none"} " +
        "ocrBitmap=${ocrBitmap.width}x${ocrBitmap.height} " +
        "overlayView=${cropBounds?.let { "${it.width}x${it.height}" } ?: "unknown"} " +
        "reader=${captureWidth}x${captureHeight} " +
        "rotation=${displayRotation()} " +
        "bounds=${windowBoundsDebug()} " +
        "targets=${serialized.targets.size} debugBoxes=${serialized.debugBoxes.size} " +
        "debugBitmap=$debugBitmapPath " +
        "firstBoxes=$firstBoxes"
    )
  }

  private fun saveDebugBitmap(bitmap: Bitmap, debugBoxes: List<OcrDebugBox>): String? {
    return try {
      val debugBitmap = bitmap.copy(Bitmap.Config.ARGB_8888, true)
      val canvas = Canvas(debugBitmap)
      val linePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(230, 47, 125, 76)
        strokeWidth = 3f
        style = Paint.Style.STROKE
      }
      val filteredPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(210, 200, 125, 0)
        strokeWidth = 2f
        style = Paint.Style.STROKE
      }
      val elementPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(145, 0, 122, 255)
        strokeWidth = 1f
        style = Paint.Style.STROKE
      }

      debugBoxes.forEach { debugBox ->
        val paint = when {
          debugBox.kind == "element" -> elementPaint
          debugBox.accepted -> linePaint
          else -> filteredPaint
        }
        canvas.drawRect(debugBox.box, paint)
      }

      val debugDir = File(context.cacheDir, "screen-ocr-overlay").apply {
        mkdirs()
      }
      val debugFile = File(debugDir, "last-ocr-debug.png")
      FileOutputStream(debugFile).use { output ->
        debugBitmap.compress(Bitmap.CompressFormat.PNG, 100, output)
      }
      debugBitmap.recycle()
      debugFile.absolutePath
    } catch (error: Exception) {
      Log.w(TAG, "failed to save OCR debug bitmap", error)
      null
    }
  }

  @Suppress("DEPRECATION")
  private fun displayRotation(): Int {
    val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    return windowManager.defaultDisplay.rotation
  }

  private fun windowBoundsDebug(): Map<String, Any?> {
    val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager

    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val currentBounds = windowManager.currentWindowMetrics.bounds
      val maxBounds = windowManager.maximumWindowMetrics.bounds
      mapOf(
        "current" to "${currentBounds.width()}x${currentBounds.height()}@${currentBounds.left},${currentBounds.top}",
        "maximum" to "${maxBounds.width()}x${maxBounds.height()}@${maxBounds.left},${maxBounds.top}"
      )
    } else {
      val metrics = DisplayMetrics()
      @Suppress("DEPRECATION")
      windowManager.defaultDisplay.getRealMetrics(metrics)
      mapOf(
        "current" to "${metrics.widthPixels}x${metrics.heightPixels}@0,0",
        "maximum" to "${metrics.widthPixels}x${metrics.heightPixels}@0,0"
      )
    }
  }
}

private data class CaptureMetrics(
  val width: Int,
  val height: Int,
  val densityDpi: Int
)

private fun resolveCaptureMetrics(context: Context): CaptureMetrics {
  val displayMetrics = context.resources.displayMetrics
  val densityDpi = displayMetrics.densityDpi.takeIf { it > 0 } ?: DisplayMetrics.DENSITY_DEFAULT

  if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
    val windowManager = context.getSystemService(WindowManager::class.java)
    val bounds = windowManager.maximumWindowMetrics.bounds

    return CaptureMetrics(
      width = bounds.width().coerceAtLeast(1),
      height = bounds.height().coerceAtLeast(1),
      densityDpi = densityDpi
    )
  }

  @Suppress("DEPRECATION")
  val legacyWindowManager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
  val metrics = DisplayMetrics()
  @Suppress("DEPRECATION")
  legacyWindowManager.defaultDisplay.getRealMetrics(metrics)

  return CaptureMetrics(
    width = metrics.widthPixels.coerceAtLeast(1),
    height = metrics.heightPixels.coerceAtLeast(1),
    densityDpi = metrics.densityDpi.takeIf { it > 0 } ?: densityDpi
  )
}
