package expo.modules.nativeepubreader

import android.text.Layout
import android.text.SpannableStringBuilder
import android.text.StaticLayout
import android.text.TextPaint

// A single renderable block on a page. Text blocks may represent either a
// complete EPUB block or a slice of a block split across a page boundary.
data class PageBlock(
  val blockId: String,
  val type: String,
  val tag: String,
  val styledText: SpannableStringBuilder? = null,
  val textPaint: TextPaint? = null,
  val textLayout: StaticLayout? = null,
  val textAlign: Layout.Alignment = Layout.Alignment.ALIGN_NORMAL,
  val imageUri: String? = null,
  val imageHeight: Int = 0,
  val contentWidth: Int = 0,
  val marginLeft: Int = 0,
  val marginTop: Int = 0,
  val marginBottom: Int = 0,
  val lineHeightMult: Float = 1.5f
)

data class ReaderPage(
  val pageIndex: Int,
  val blocks: List<PageBlock>
)
