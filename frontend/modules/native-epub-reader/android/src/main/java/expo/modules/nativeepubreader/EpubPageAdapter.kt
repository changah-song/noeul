package expo.modules.nativeepubreader

import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView

class EpubPageAdapter(
  private var pages: List<ReaderPage>,
  private val paddingH: Int,
  private val paddingV: Int,
  private var lineHeightMult: Float,
  private var backgroundColor: Int
) : RecyclerView.Adapter<EpubPageAdapter.PageHolder>() {

  class PageHolder(val view: EpubPageView) : RecyclerView.ViewHolder(view)

  override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): PageHolder {
    val view = EpubPageView(parent.context).apply {
      layoutParams = ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT
      )
    }
    return PageHolder(view)
  }

  override fun onBindViewHolder(holder: PageHolder, position: Int) {
    holder.view.bind(pages[position], paddingH, paddingV, lineHeightMult, backgroundColor)
  }

  override fun getItemCount(): Int = pages.size

  fun updatePages(newPages: List<ReaderPage>) {
    pages = newPages
    notifyDataSetChanged()
  }

  fun updateRenderConfig(lineHeightMult: Float, backgroundColor: Int) {
    this.lineHeightMult = lineHeightMult
    this.backgroundColor = backgroundColor
    notifyDataSetChanged()
  }

  fun rebindVisiblePages(recyclerView: RecyclerView?, fallbackPosition: Int = -1) {
    if (recyclerView == null) {
      return
    }

    for (index in 0 until recyclerView.childCount) {
      val child = recyclerView.getChildAt(index)
      val holder = recyclerView.getChildViewHolder(child) as? PageHolder ?: continue
      val position = when {
        holder.bindingAdapterPosition != RecyclerView.NO_POSITION -> holder.bindingAdapterPosition
        fallbackPosition in pages.indices -> fallbackPosition
        else -> continue
      }

      if (position in pages.indices) {
        holder.view.bind(pages[position], paddingH, paddingV, lineHeightMult, backgroundColor)
      }
    }
  }
}
