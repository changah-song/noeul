package expo.modules.screenocr

import android.content.Context
import android.graphics.BitmapFactory
import android.graphics.Rect
import android.net.Uri
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.korean.KoreanTextRecognizerOptions
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ScreenOcrModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ScreenOcr")

    AsyncFunction("recognizeImage") { uriString: String ->
      if (uriString.isBlank()) {
        throw IllegalArgumentException("Image uri is required")
      }

      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val uri = Uri.parse(uriString)
      val image = InputImage.fromFilePath(context, uri)
      val dimensions = resolveImageDimensions(context, uri, image.width, image.height)
      val recognizer = TextRecognition.getClient(KoreanTextRecognizerOptions.Builder().build())

      try {
        val result = Tasks.await(recognizer.process(image))

        mapOf(
          "imageWidth" to dimensions.first,
          "imageHeight" to dimensions.second,
          "text" to result.text,
          "blocks" to result.textBlocks.map(::serializeBlock)
        )
      } finally {
        recognizer.close()
      }
    }
  }
}

private fun serializeBlock(block: Text.TextBlock): Map<String, Any?> =
  mapOf(
    "text" to block.text,
    "box" to serializeBox(block.boundingBox),
    "lines" to block.lines.map(::serializeLine)
  )

private fun serializeLine(line: Text.Line): Map<String, Any?> =
  mapOf(
    "text" to line.text,
    "box" to serializeBox(line.boundingBox),
    "elements" to line.elements.map(::serializeElement)
  )

private fun serializeElement(element: Text.Element): Map<String, Any?> =
  mapOf(
    "text" to element.text,
    "box" to serializeBox(element.boundingBox)
  )

private fun serializeBox(rect: Rect?): Map<String, Int>? {
  if (rect == null) {
    return null
  }

  return mapOf(
    "x" to rect.left,
    "y" to rect.top,
    "width" to rect.width(),
    "height" to rect.height()
  )
}

private fun resolveImageDimensions(
  context: Context,
  uri: Uri,
  fallbackWidth: Int,
  fallbackHeight: Int
): Pair<Int, Int> {
  if (fallbackWidth > 0 && fallbackHeight > 0) {
    return Pair(fallbackWidth, fallbackHeight)
  }

  return try {
    context.contentResolver.openInputStream(uri)?.use { stream ->
      val options = BitmapFactory.Options().apply {
        inJustDecodeBounds = true
      }

      BitmapFactory.decodeStream(stream, null, options)
      Pair(options.outWidth.takeIf { it > 0 } ?: fallbackWidth, options.outHeight.takeIf { it > 0 } ?: fallbackHeight)
    } ?: Pair(fallbackWidth, fallbackHeight)
  } catch (_: Exception) {
    Pair(fallbackWidth, fallbackHeight)
  }
}
