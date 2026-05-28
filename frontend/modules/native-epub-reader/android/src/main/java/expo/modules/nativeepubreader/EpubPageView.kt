package expo.modules.nativeepubreader

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.net.Uri
import android.text.StaticLayout
import android.view.View

class EpubPageView(context: Context) : View(context) {
  private var page: ReaderPage? = null
  private var paddingH = 0
  private var paddingV = 0
  private var lineHeightMult = 1.5f
  private var pageBackgroundColor = Color.WHITE
  private val bitmapCache = mutableMapOf<String, Bitmap?>()
  private val placeholderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(180, 174, 166)
    style = Paint.Style.FILL
  }

  fun bind(
    page: ReaderPage,
    paddingH: Int,
    paddingV: Int,
    lineHeightMult: Float,
    backgroundColor: Int
  ) {
    this.page = page
    this.paddingH = paddingH
    this.paddingV = paddingV
    this.lineHeightMult = lineHeightMult
    this.pageBackgroundColor = backgroundColor
    invalidate()
    postInvalidateOnAnimation()
  }

  override fun onDraw(canvas: Canvas) {
    canvas.drawColor(pageBackgroundColor)
    val contentWidth = width - (paddingH * 2)
    if (contentWidth <= 0) return
    var yOffset = paddingV.toFloat()

    page?.blocks?.forEach { block ->
      yOffset += block.marginTop

      if (block.type == "image") {
        val blockWidth = block.contentWidth.takeIf { it > 0 } ?: contentWidth
        drawImage(canvas, block, (paddingH + block.marginLeft).toFloat(), yOffset, blockWidth)
        yOffset += block.imageHeight
      } else {
        val layout = block.textLayout ?: buildFallbackTextLayout(block, contentWidth) ?: return@forEach

        canvas.save()
        canvas.translate((paddingH + block.marginLeft).toFloat(), yOffset)
        layout.draw(canvas)
        canvas.restore()

        yOffset += layout.height
      }

      yOffset += block.marginBottom
    }
  }

  private fun buildFallbackTextLayout(block: PageBlock, pageContentWidth: Int): StaticLayout? {
    val text = block.styledText ?: return null
    val textPaint = block.textPaint ?: return null
    val blockWidth = block.contentWidth.takeIf { it > 0 } ?: pageContentWidth
    val effectiveLineHeightMult = block.lineHeightMult.takeIf { it > 0f } ?: lineHeightMult

    return StaticLayout.Builder
      .obtain(text, 0, text.length, textPaint, blockWidth)
      .setAlignment(block.textAlign)
      .setLineSpacing(0f, effectiveLineHeightMult)
      .setIncludePad(true)
      .build()
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    if (w > 0 && h > 0) postInvalidateOnAnimation()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (page != null) {
      postInvalidateOnAnimation()
    }
  }

  private fun drawImage(
    canvas: Canvas,
    block: PageBlock,
    x: Float,
    y: Float,
    contentWidth: Int
  ) {
    val uri = block.imageUri
    val bitmap = if (uri.isNullOrBlank()) null else bitmapForUri(uri)

    if (bitmap == null) {
      canvas.drawRoundRect(
        RectF(x, y, x + contentWidth, y + block.imageHeight),
        8f,
        8f,
        placeholderPaint
      )
      return
    }

    val scale = minOf(
      contentWidth.toFloat() / bitmap.width.toFloat(),
      block.imageHeight.toFloat() / bitmap.height.toFloat()
    )
    val drawWidth = bitmap.width * scale
    val drawHeight = bitmap.height * scale
    val left = x + ((contentWidth - drawWidth) / 2f)
    val top = y + ((block.imageHeight - drawHeight) / 2f)

    canvas.drawBitmap(
      bitmap,
      null,
      RectF(left, top, left + drawWidth, top + drawHeight),
      null
    )
  }

  private fun bitmapForUri(uri: String): Bitmap? {
    if (bitmapCache.containsKey(uri)) {
      return bitmapCache[uri]
    }

    val bitmap = try {
      context.contentResolver.openInputStream(Uri.parse(uri))?.use { stream ->
        BitmapFactory.decodeStream(stream)
      }
    } catch (_: Exception) {
      null
    }

    bitmapCache[uri] = bitmap
    return bitmap
  }
}
