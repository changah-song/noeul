package expo.modules.screenocroverlay

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Rect
import kotlin.math.abs

object OcrBoxRefiner {
  fun refine(serialized: SerializedOcrResult, bitmap: Bitmap): SerializedOcrResult {
    if (serialized.targets.isEmpty()) {
      return serialized
    }

    val refinedTargets = serialized.targets.map { target ->
      tightenBoxToInk(bitmap, target.box)?.let { refinedBox ->
        target.copy(box = refinedBox)
      } ?: target
    }

    return OcrSerializer.withTargets(serialized, refinedTargets)
  }

  private fun tightenBoxToInk(bitmap: Bitmap, box: Rect): Rect? {
    if (box.width() <= 0 || box.height() <= 0 || bitmap.width <= 0 || bitmap.height <= 0) {
      return null
    }

    val verticalTopPadding = (box.height() * 0.55f).toInt().coerceAtLeast(3)
    val verticalBottomPadding = (box.height() * 0.24f).toInt().coerceAtLeast(2)
    val horizontalPadding = (box.height() * 0.16f).toInt().coerceAtLeast(2)
    val scanLeft = (box.left - horizontalPadding).coerceIn(0, bitmap.width - 1)
    val scanTop = (box.top - verticalTopPadding).coerceIn(0, bitmap.height - 1)
    val scanRight = (box.right + horizontalPadding).coerceIn(scanLeft + 1, bitmap.width)
    val scanBottom = (box.bottom + verticalBottomPadding).coerceIn(scanTop + 1, bitmap.height)
    val scanWidth = scanRight - scanLeft
    val scanHeight = scanBottom - scanTop

    if (scanWidth <= 0 || scanHeight <= 0) {
      return null
    }

    val pixels = IntArray(scanWidth * scanHeight)
    bitmap.getPixels(pixels, 0, scanWidth, scanLeft, scanTop, scanWidth, scanHeight)

    val sampleStep = maxOf(1, minOf(scanWidth, scanHeight) / 24)
    val samples = mutableListOf<Int>()
    var sampleY = 0
    while (sampleY < scanHeight) {
      var sampleX = 0
      while (sampleX < scanWidth) {
        val pixel = pixels[sampleY * scanWidth + sampleX]
        if (Color.alpha(pixel) > 32) {
          samples.add(pixelLuminance(pixel))
        }
        sampleX += sampleStep
      }
      sampleY += sampleStep
    }

    if (samples.size < 8) {
      return null
    }

    samples.sort()
    val low = samples[(samples.size * 0.1f).toInt().coerceIn(0, samples.lastIndex)]
    val median = samples[samples.size / 2]
    val high = samples[(samples.size * 0.9f).toInt().coerceIn(0, samples.lastIndex)]
    if (high - low < 28) {
      return null
    }

    val darkText = median >= 128
    val threshold = maxOf(28, ((high - low) * 0.22f).toInt())
    val inkMask = BooleanArray(scanWidth * scanHeight)
    val rowCounts = IntArray(scanHeight)
    var totalInkPixels = 0

    for (y in 0 until scanHeight) {
      for (x in 0 until scanWidth) {
        val index = y * scanWidth + x
        val pixel = pixels[index]
        if (Color.alpha(pixel) <= 32) {
          continue
        }

        val luminance = pixelLuminance(pixel)
        val isInk = if (darkText) {
          luminance < median - threshold
        } else {
          luminance > median + threshold
        }

        if (isInk) {
          inkMask[index] = true
          rowCounts[y] += 1
          totalInkPixels += 1
        }
      }
    }

    if (totalInkPixels < maxOf(4, (scanWidth * scanHeight * 0.003f).toInt())) {
      return null
    }

    val rowRun = bestInkRun(
      counts = rowCounts,
      minimumCount = maxOf(1, (scanWidth * 0.025f).toInt()),
      preferredIndex = (box.centerY() - scanTop).coerceIn(0, scanHeight - 1)
    ) ?: return null

    val selectedTop = rowRun.first
    val selectedBottom = rowRun.second
    val colCounts = IntArray(scanWidth)
    for (y in selectedTop..selectedBottom) {
      for (x in 0 until scanWidth) {
        if (inkMask[y * scanWidth + x]) {
          colCounts[x] += 1
        }
      }
    }

    val colRun = fullInkSpan(
      counts = colCounts,
      minimumCount = maxOf(1, ((selectedBottom - selectedTop + 1) * 0.025f).toInt())
    ) ?: return null

    val visualPadding = maxOf(1, (box.height() * 0.04f).toInt())
    val refined = Rect(
      (scanLeft + colRun.first - visualPadding).coerceIn(0, bitmap.width - 1),
      box.top.coerceIn(0, bitmap.height - 1),
      (scanLeft + colRun.second + 1 + visualPadding).coerceIn(1, bitmap.width),
      box.bottom.coerceIn(1, bitmap.height)
    )

    if (
      refined.width() <= 0 ||
      refined.height() <= 0 ||
      refined.width() > box.width() * 1.35f ||
      refined.height() > box.height() * 1.65f ||
      refined.width() < box.width() * 0.12f ||
      refined.height() < box.height() * 0.25f
    ) {
      return null
    }

    return refined
  }

  private fun bestInkRun(
    counts: IntArray,
    minimumCount: Int,
    preferredIndex: Int
  ): Pair<Int, Int>? {
    var best: Pair<Int, Int>? = null
    var bestScore = Int.MIN_VALUE
    var index = 0

    while (index < counts.size) {
      while (index < counts.size && counts[index] < minimumCount) {
        index += 1
      }
      if (index >= counts.size) {
        break
      }

      val start = index
      var inkTotal = 0
      while (index < counts.size && counts[index] >= minimumCount) {
        inkTotal += counts[index]
        index += 1
      }
      val end = index - 1
      val center = (start + end) / 2
      val distancePenalty = abs(center - preferredIndex) * maxOf(1, minimumCount)
      val score = inkTotal - distancePenalty

      if (score > bestScore) {
        bestScore = score
        best = Pair(start, end)
      }
    }

    return best
  }

  private fun fullInkSpan(counts: IntArray, minimumCount: Int): Pair<Int, Int>? {
    val first = counts.indexOfFirst { it >= minimumCount }
    if (first < 0) {
      return null
    }

    val last = counts.indexOfLast { it >= minimumCount }
    return Pair(first, last)
  }

  private fun pixelLuminance(pixel: Int): Int {
    val red = Color.red(pixel)
    val green = Color.green(pixel)
    val blue = Color.blue(pixel)
    return ((red * 299) + (green * 587) + (blue * 114)) / 1000
  }
}
