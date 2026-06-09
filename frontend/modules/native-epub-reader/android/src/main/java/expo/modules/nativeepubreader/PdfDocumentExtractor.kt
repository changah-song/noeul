package expo.modules.nativeepubreader

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.interactive.documentnavigation.outline.PDOutlineItem
import com.tom_roush.pdfbox.text.PDFTextStripper
import com.tom_roush.pdfbox.text.TextPosition
import java.io.File
import java.io.FileOutputStream

class PdfDocumentExtractor(private val context: Context) {
  fun extract(options: Map<String, Any?>): Map<String, Any?> {
    val sourceUri = options.stringValue("sourceUri")
      ?: throw IllegalArgumentException("PDF sourceUri is required")
    val outputRootUri = options.stringValue("outputRootUri")
      ?: throw IllegalArgumentException("PDF outputRootUri is required")
    val fallbackName = options.stringValue("fallbackName") ?: "Untitled"
    val outputRoot = fileFromUri(outputRootUri)

    outputRoot.mkdirs()
    PDFBoxResourceLoader.init(context.applicationContext)

    val localPdf = localPdfFile(sourceUri)
    val deleteLocalPdf = shouldDeleteLocalPdf(sourceUri)

    try {
      PDDocument.load(localPdf).use { document ->
        if (document.isEncrypted) {
          document.setAllSecurityToBeRemoved(true)
        }

        val pageCount = document.numberOfPages
        val pages = (0 until pageCount).map { pageIndex ->
          val textLayout = extractPageTextLayout(document, pageIndex)
          val page = document.getPage(pageIndex)
          val box = page.mediaBox

          mapOf(
            "index" to pageIndex,
            "label" to "Page ${pageIndex + 1}",
            "text" to textLayout.text,
            "lines" to textLayout.lines,
            "width" to box.width.toDouble(),
            "height" to box.height.toDouble(),
            "rotation" to page.rotation
          )
        }
        val info = document.documentInformation
        val title = info?.title?.trim()?.takeIf { it.isNotEmpty() } ?: fallbackName
        val author = info?.author?.trim()?.takeIf { it.isNotEmpty() } ?: "Unknown author"

        return mapOf(
          "sourceUri" to sourceUri,
          "fallbackName" to fallbackName,
          "title" to title,
          "author" to author,
          "pageCount" to pageCount,
          "pages" to pages,
          "outline" to collectOutlineItems(document)
        )
      }
    } finally {
      if (deleteLocalPdf) {
        localPdf.delete()
      }
    }
  }

  fun renderCover(options: Map<String, Any?>): Map<String, Any?> {
    val sourceUri = options.stringValue("sourceUri")
      ?: throw IllegalArgumentException("PDF sourceUri is required")
    val outputRootUri = options.stringValue("outputRootUri")
      ?: throw IllegalArgumentException("PDF outputRootUri is required")
    val requestedPageNumber = options.intValue("pageNumber") ?: 1
    val maxWidth = (options.intValue("maxWidth") ?: 900).coerceIn(240, 1600)
    val outputRoot = fileFromUri(outputRootUri)

    outputRoot.mkdirs()

    val localPdf = localPdfFile(sourceUri)
    val deleteLocalPdf = shouldDeleteLocalPdf(sourceUri)

    try {
      ParcelFileDescriptor.open(localPdf, ParcelFileDescriptor.MODE_READ_ONLY).use { descriptor ->
        PdfRenderer(descriptor).use { renderer ->
          val pageCount = renderer.pageCount
          if (pageCount <= 0) {
            throw IllegalArgumentException("PDF has no pages to render")
          }

          val pageIndex = requestedPageNumber - 1
          if (pageIndex < 0 || pageIndex >= pageCount) {
            throw IllegalArgumentException("PDF cover page must be between 1 and $pageCount")
          }

          renderer.openPage(pageIndex).use { page ->
            val scale = maxWidth.toDouble() / page.width.toDouble().coerceAtLeast(1.0)
            val bitmapWidth = maxWidth
            val bitmapHeight = (page.height * scale).toInt().coerceAtLeast(1)
            val bitmap = Bitmap.createBitmap(bitmapWidth, bitmapHeight, Bitmap.Config.ARGB_8888)

            try {
              bitmap.eraseColor(Color.WHITE)
              page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)

              val coverFile = File(outputRoot, "cover-page-${pageIndex + 1}.png")
              FileOutputStream(coverFile).use { output ->
                bitmap.compress(Bitmap.CompressFormat.PNG, 92, output)
              }

              return mapOf(
                "coverUri" to Uri.fromFile(coverFile).toString(),
                "pageNumber" to pageIndex + 1,
                "pageCount" to pageCount,
                "width" to bitmapWidth,
                "height" to bitmapHeight
              )
            } finally {
              bitmap.recycle()
            }
          }
        }
      }
    } finally {
      if (deleteLocalPdf) {
        localPdf.delete()
      }
    }
  }

  private fun extractPageTextLayout(document: PDDocument, pageIndex: Int): PdfPageTextLayout {
    val stripper = PdfPageLineStripper().apply {
      sortByPosition = true
      startPage = pageIndex + 1
      endPage = pageIndex + 1
    }
    val extractedText = stripper.getText(document).orEmpty().trim()
    val lineText = stripper.lines
      .mapNotNull { it["text"] as? String }
      .joinToString("\n")
      .trim()

    return PdfPageTextLayout(
      text = extractedText.ifBlank { lineText },
      lines = stripper.lines
    )
  }

  private fun collectOutlineItems(document: PDDocument): List<Map<String, Any?>> {
    val outline = document.documentCatalog?.documentOutline ?: return emptyList()
    val items = mutableListOf<Map<String, Any?>>()

    fun visit(firstItem: PDOutlineItem?, depth: Int) {
      var item = firstItem
      while (item != null) {
        val pageIndex = try {
          val page = item.findDestinationPage(document)
          if (page != null) document.pages.indexOf(page) else -1
        } catch (_: Exception) {
          -1
        }
        val title = item.title?.trim().orEmpty()

        if (title.isNotEmpty() && pageIndex >= 0) {
          items.add(
            mapOf(
              "title" to title,
              "pageIndex" to pageIndex,
              "depth" to depth
            )
          )
        }

        visit(item.firstChild, depth + 1)
        item = item.nextSibling
      }
    }

    visit(outline.firstChild, 0)
    return items
  }

  private fun localPdfFile(sourceUri: String): File {
    val uri = Uri.parse(sourceUri)
    if (uri.scheme == "file" || uri.scheme.isNullOrBlank()) {
      return File(uri.path ?: sourceUri.removePrefix("file://"))
    }

    val tempFile = File.createTempFile("ff-pdf-import-", ".pdf", context.cacheDir)
    context.contentResolver.openInputStream(uri)?.use { input ->
      FileOutputStream(tempFile).use { output ->
        input.copyTo(output)
      }
    } ?: throw IllegalArgumentException("Could not open PDF URI")
    return tempFile
  }

  private fun shouldDeleteLocalPdf(sourceUri: String): Boolean {
    val scheme = Uri.parse(sourceUri).scheme
    return !scheme.isNullOrBlank() && scheme != "file"
  }

  private fun fileFromUri(uriString: String): File {
    val uri = Uri.parse(uriString)
    return if (uri.scheme == "file" || uri.scheme.isNullOrBlank()) {
      File(uri.path ?: uriString.removePrefix("file://"))
    } else {
      throw IllegalArgumentException("PDF outputRootUri must be a file URI")
    }
  }

  private fun Map<*, *>.stringValue(key: String): String? = this[key] as? String

  private fun Map<*, *>.intValue(key: String): Int? {
    val value = this[key] ?: return null
    return when (value) {
      is Number -> value.toInt()
      is String -> value.toIntOrNull()
      else -> null
    }
  }
}

private data class PdfPageTextLayout(
  val text: String,
  val lines: List<Map<String, Any?>>
)

private class PdfPageLineStripper : PDFTextStripper() {
  val lines = mutableListOf<Map<String, Any?>>()

  override fun writeString(text: String, textPositions: MutableList<TextPosition>) {
    super.writeString(text, textPositions)

    val cleanText = text
      .replace(Regex("[\\t\\r\\n]+"), " ")
      .replace(Regex(" {2,}"), " ")
      .trim()

    if (cleanText.isBlank() || textPositions.isEmpty()) {
      return
    }

    var minX = Float.MAX_VALUE
    var minY = Float.MAX_VALUE
    var maxX = Float.MIN_VALUE
    var maxY = Float.MIN_VALUE
    var fontSizeTotal = 0.0
    var fontSizeCount = 0
    val fontNames = mutableMapOf<String, Int>()

    textPositions.forEach { position ->
      val x = position.xDirAdj
      val y = position.yDirAdj
      val width = position.widthDirAdj
      val height = position.heightDir

      minX = minOf(minX, x)
      minY = minOf(minY, y)
      maxX = maxOf(maxX, x + width)
      maxY = maxOf(maxY, y + height)
      if (position.fontSizeInPt > 0f) {
        fontSizeTotal += position.fontSizeInPt.toDouble()
        fontSizeCount += 1
      }
      val fontName = position.font?.name?.trim().orEmpty()
      if (fontName.isNotEmpty()) {
        fontNames[fontName] = (fontNames[fontName] ?: 0) + 1
      }
    }

    if (minX == Float.MAX_VALUE || minY == Float.MAX_VALUE) {
      return
    }

    val dominantFontName = fontNames.maxByOrNull { it.value }?.key.orEmpty()

    lines.add(
      mapOf(
        "text" to cleanText,
        "x" to minX.toDouble(),
        "y" to minY.toDouble(),
        "width" to (maxX - minX).toDouble(),
        "height" to (maxY - minY).toDouble(),
        "fontSize" to if (fontSizeCount > 0) fontSizeTotal / fontSizeCount else null,
        "fontName" to dominantFontName,
        "bold" to dominantFontName.contains("bold", ignoreCase = true),
        "italic" to (
          dominantFontName.contains("italic", ignoreCase = true) ||
            dominantFontName.contains("oblique", ignoreCase = true)
          )
      )
    )
  }
}
