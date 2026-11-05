import CoreText
import UIKit

// Lays out blocks with CoreText and splits chapters into pages. Sizes, margins
// and line heights follow the Android EpubPaginator so books paginate alike.

struct ReaderLayoutConfig {
  let contentWidth: CGFloat
  let contentHeight: CGFloat
  let fontSize: CGFloat
  let lineHeight: CGFloat
  let palette: ReaderPalette
  let showPinyin: Bool
  let showGloss: Bool

  var globalScale: CGFloat { fontSize / 18 }
}

final class ReaderLine {
  let line: CTLine
  // Range in the block's text.
  let range: NSRange
  // From the content box's left edge.
  let x: CGFloat
  // From the block's first line top.
  let top: CGFloat
  let ascent: CGFloat
  let descent: CGFloat
  let width: CGFloat

  var naturalHeight: CGFloat { ascent + descent }
  var baseline: CGFloat { top + ascent }

  init(line: CTLine, range: NSRange, x: CGFloat, top: CGFloat, ascent: CGFloat, descent: CGFloat, width: CGFloat) {
    self.line = line
    self.range = range
    self.x = x
    self.top = top
    self.ascent = ascent
    self.descent = descent
    self.width = width
  }
}

final class ReaderBlockLayout {
  let block: ReaderBlock
  let text: NSString
  let sentences: [NSRange]
  let lines: [ReaderLine]
  let imageFrame: CGRect?
  let splittable: Bool
  let lineMultiplier: CGFloat
  // Body text size; annotation sizes derive from it.
  let fontSize: CGFloat
  var marginTop: CGFloat
  var marginBottom: CGFloat
  let contentHeight: CGFloat

  init(block: ReaderBlock, text: NSString, sentences: [NSRange], lines: [ReaderLine], imageFrame: CGRect?,
       splittable: Bool, lineMultiplier: CGFloat, fontSize: CGFloat, marginTop: CGFloat, marginBottom: CGFloat,
       contentHeight: CGFloat) {
    self.block = block
    self.text = text
    self.sentences = sentences
    self.lines = lines
    self.imageFrame = imageFrame
    self.splittable = splittable
    self.lineMultiplier = lineMultiplier
    self.fontSize = fontSize
    self.marginTop = marginTop
    self.marginBottom = marginBottom
    self.contentHeight = contentHeight
  }

  func height(of lineRange: Range<Int>) -> CGFloat {
    guard let first = lines[safe: lineRange.lowerBound], let last = lines[safe: lineRange.upperBound - 1] else {
      return contentHeight
    }
    return last.top + last.naturalHeight - first.top
  }
}

// A block, or a run of its lines, placed on a page.
struct ReaderPageItem {
  let layout: ReaderBlockLayout
  let lineRange: Range<Int>
  // Top of the item's first line (or image) within the content box.
  let y: CGFloat
  let height: CGFloat

  // Where this slice starts in the block's text.
  var sourceStartOffset: Int {
    layout.lines[safe: lineRange.lowerBound]?.range.location ?? 0
  }

  func lineTop(_ index: Int) -> CGFloat {
    y + layout.lines[index].top - layout.lines[lineRange.lowerBound].top
  }
}

final class ReaderPage {
  let spineIndex: Int
  let href: String
  let path: String
  let chapterPageIndex: Int
  var chapterPageCount: Int
  let items: [ReaderPageItem]
  // Built after layout, and again whenever the marked terms change.
  var highlights = ReaderPageHighlights.empty

  init(spineIndex: Int, href: String, path: String, chapterPageIndex: Int, chapterPageCount: Int, items: [ReaderPageItem]) {
    self.spineIndex = spineIndex
    self.href = href
    self.path = path
    self.chapterPageIndex = chapterPageIndex
    self.chapterPageCount = chapterPageCount
    self.items = items
  }

  var firstBlockId: String { items.first?.layout.block.id ?? "" }

  func contains(blockId: String) -> Bool {
    items.contains { $0.layout.block.id == blockId }
  }
}

extension Array {
  subscript(safe index: Int) -> Element? {
    indices.contains(index) ? self[index] : nil
  }
}

// MARK: - Fonts

enum ReaderFontFamily {
  case serif, sans, mono

  static func from(_ raw: Any?) -> ReaderFontFamily? {
    guard let value = (raw as? String)?.lowercased(), !value.isEmpty else { return nil }
    if ["monospace", "courier", "monaco", "consolas"].contains(where: value.contains) { return .mono }
    if ["sans", "helvetica", "arial", "verdana", "roboto"].contains(where: value.contains) { return .sans }
    return .serif
  }
}

private let fontCache = NSCache<NSString, UIFont>()

// Body text uses Noto Serif KR (registered by expo-font in App.js), which is
// what Android's system serif falls back to for Hangul. It has no italic, so
// italics use the system serif with Noto Serif KR behind it for Hangul.
func readerFont(size: CGFloat, bold: Bool, italic: Bool, family: ReaderFontFamily) -> UIFont {
  let key = "\(size)|\(bold)|\(italic)|\(family)" as NSString
  if let cached = fontCache.object(forKey: key) { return cached }
  let krName = bold ? "NotoSerifKR-Bold" : "NotoSerifKR-Regular"
  var font: UIFont
  switch family {
  case .serif where !italic && UIFont(name: krName, size: size) != nil:
    font = UIFont(name: krName, size: size)!
  case .serif:
    var descriptor = UIFont.systemFont(ofSize: size, weight: bold ? .bold : .regular).fontDescriptor
    descriptor = descriptor.withDesign(.serif) ?? descriptor
    if italic, let slanted = descriptor.withSymbolicTraits(descriptor.symbolicTraits.union(.traitItalic)) {
      descriptor = slanted
    }
    descriptor = descriptor.addingAttributes([.cascadeList: [UIFontDescriptor(name: krName, size: size)]])
    font = UIFont(descriptor: descriptor, size: size)
  case .sans:
    font = UIFont.systemFont(ofSize: size, weight: bold ? .bold : .regular)
    if italic, let slanted = font.fontDescriptor.withSymbolicTraits(font.fontDescriptor.symbolicTraits.union(.traitItalic)) {
      font = UIFont(descriptor: slanted, size: size)
    }
  case .mono:
    font = UIFont.monospacedSystemFont(ofSize: size, weight: bold ? .bold : .regular)
  }
  fontCache.setObject(font, forKey: key)
  return font
}

// MARK: - Block layout

// Noto Serif's hhea ascender/descender, in em.
private let notoSerifAscent: CGFloat = 1.069
private let notoSerifDescent: CGFloat = 0.293

// Annotation rows, as a share of the body text size.
let pinyinRowScale: CGFloat = 0.9
let glossRowScale: CGFloat = 0.95

private func isBold(_ style: [String: Any]) -> Bool {
  if let weight = style["fontWeight"] as? String {
    if weight.lowercased() == "bold" || weight.lowercased() == "bolder" { return true }
    if let number = Double(weight) { return number >= 600 }
  }
  if let number = doubleValue(style["fontWeight"]) { return number >= 600 }
  return false
}

private func isItalic(_ style: [String: Any]) -> Bool {
  (style["fontStyle"] as? String)?.lowercased() == "italic"
}

private func clamp(_ value: CGFloat, _ low: CGFloat, _ high: CGFloat) -> CGFloat {
  min(max(value, low), high)
}

private func blockFontSize(_ block: ReaderBlock, config: ReaderLayoutConfig) -> CGFloat {
  let style = block.style
  let fontScale = doubleValue(style["fontScale"]).map { CGFloat($0) }.flatMap { $0 > 0 ? $0 : nil } ?? 1
  if block.isHeading {
    let base: CGFloat
    switch block.tag {
    case "h1": base = 26
    case "h2": base = 23
    case "h3": base = 20
    default: base = 18
    }
    let size: CGFloat
    if let absolute = style["fontSize"] as? NSNumber {
      size = CGFloat(absolute.doubleValue)
    } else if let relative = relativeScaleToken(style["fontSize"]) {
      size = base * relative
    } else {
      size = base * fontScale
    }
    return clamp(size * config.globalScale, 12, 44)
  }
  if block.tag == "figcaption" {
    return clamp(14 * fontScale * config.globalScale, 9, 36)
  }
  let relative = relativeScaleToken(style["fontSize"]) ?? 1
  return clamp(18 * fontScale * relative * config.globalScale, 8, 36)
}

private func cssLineHeight(_ value: Any?, fontSize: CGFloat) -> CGFloat? {
  if let number = value as? NSNumber {
    let amount = CGFloat(number.doubleValue)
    return amount <= 4 ? amount : amount / fontSize
  }
  if let map = value as? [String: Any], let amount = doubleValue(map["value"]) {
    let unit = ((map["unit"] as? String) ?? "").lowercased()
    switch unit {
    case "%": return CGFloat(amount) / 100
    case "em", "rem": return CGFloat(amount)
    case "": return amount <= 4 ? CGFloat(amount) : CGFloat(amount) / fontSize
    case "px", "dp": return CGFloat(amount) / fontSize
    default: return nil
    }
  }
  guard let string = (value as? String)?.trimmingCharacters(in: .whitespaces).lowercased(), string != "normal" else {
    return nil
  }
  if string.hasSuffix("%"), let amount = Double(string.dropLast()) { return CGFloat(amount) / 100 }
  if string.hasSuffix("rem"), let amount = Double(string.dropLast(3)) { return CGFloat(amount) }
  if string.hasSuffix("em"), let amount = Double(string.dropLast(2)) { return CGFloat(amount) }
  if string.hasSuffix("px"), let amount = Double(string.dropLast(2)) { return CGFloat(amount) / fontSize }
  if let amount = Double(string) { return amount <= 4 ? CGFloat(amount) : CGFloat(amount) / fontSize }
  return nil
}

private func spacing(_ value: Any?, fallback: CGFloat, em: CGFloat, low: CGFloat = -24, high: CGFloat = 72) -> CGFloat {
  clamp(lengthToken(value, em: em) ?? fallback, low, high)
}

private func attributedText(for block: ReaderBlock, size: CGFloat, config: ReaderLayoutConfig) -> NSAttributedString {
  let blockStyle = block.style
  let blockBold = block.isHeading || isBold(blockStyle)
  let blockItalic = isItalic(blockStyle)
  let blockFamily = ReaderFontFamily.from(blockStyle["fontFamily"]) ?? .serif
  let blockColor = (blockStyle["color"] as? String).flatMap(parseAndroidColor)
  let spans = block.spans.isEmpty ? [ReaderSpan(text: block.text, marks: [], style: [:])] : block.spans

  let result = NSMutableAttributedString()
  for span in spans where !span.text.isEmpty {
    let bold = blockBold || span.marks.contains("strong") || span.marks.contains("b") || isBold(span.style)
    let italic = blockItalic || span.marks.contains("em") || span.marks.contains("i") || isItalic(span.style)
    let scale = doubleValue(span.style["fontScale"]).map { CGFloat($0) }.flatMap { $0 > 0 ? $0 : nil } ?? 1
    let family = ReaderFontFamily.from(span.style["fontFamily"]) ?? blockFamily
    let font = readerFont(size: size * scale, bold: bold, italic: italic, family: family)
    var color = config.palette.bodyText
    if !config.palette.isDark {
      color = (span.style["color"] as? String).flatMap(parseAndroidColor) ?? blockColor ?? color
    }
    var attributes: [NSAttributedString.Key: Any] = [
      NSAttributedString.Key(kCTFontAttributeName as String): font as CTFont,
      NSAttributedString.Key(kCTForegroundColorAttributeName as String): color.cgColor,
    ]
    let underline = span.marks.contains("a") || (span.style["textDecorationLine"] as? String)?.lowercased() == "underline"
    if underline {
      attributes[NSAttributedString.Key(kCTUnderlineStyleAttributeName as String)] = CTUnderlineStyle.single.rawValue
    }
    result.append(NSAttributedString(string: span.text, attributes: attributes))
  }
  return result
}

func layoutBlock(_ block: ReaderBlock, config: ReaderLayoutConfig) -> ReaderBlockLayout {
  let style = block.style
  let em = config.fontSize
  let inset = max(0, spacing(style["marginLeft"], fallback: 0, em: em) + spacing(style["paddingLeft"], fallback: 0, em: em))

  if block.isImage {
    let width = max(1, config.contentWidth - inset)
    var height: CGFloat = 260
    if style["height"] != nil {
      height = clamp(lengthToken(style["height"], em: em) ?? 260, 120, 900)
    } else if let iw = doubleValue(style["intrinsicWidth"]), let ih = doubleValue(style["intrinsicHeight"]), iw > 0, ih > 0 {
      height = clamp(width * CGFloat(ih / iw), 120, 900)
    }
    return ReaderBlockLayout(
      block: block, text: "", sentences: [], lines: [],
      imageFrame: CGRect(x: inset, y: 0, width: width, height: height),
      splittable: false, lineMultiplier: 1, fontSize: config.fontSize,
      marginTop: spacing(style["marginTop"], fallback: 8, em: em),
      marginBottom: spacing(style["marginBottom"], fallback: 12, em: em),
      contentHeight: height
    )
  }

  let size = blockFontSize(block, config: config)
  // Room for pinyin above and glosses below each line, when they're on.
  let annotationSpace = size * ((config.showPinyin ? pinyinRowScale : 0) + (config.showGloss ? glossRowScale : 0))
  var multiplier = clamp((cssLineHeight(style["lineHeight"], fontSize: size) ?? 1.5) * (config.lineHeight / 1.5), 1, 3)
  // Headings wrap tighter than body text.
  if block.isHeading { multiplier = min(multiplier, 1.3) }
  let indent = spacing(style["textIndent"], fallback: 0, em: em, low: -72, high: 72)
  let firstX = max(0, inset + indent)
  let align = (style["textAlign"] as? String)?.lowercased() ?? ""

  let family = ReaderFontFamily.from(style["fontFamily"]) ?? .serif
  let attributed = attributedText(for: block, size: size, config: config)
  let text = attributed.string as NSString
  let typesetter = CTTypesetterCreateWithAttributedString(attributed)
  var lines: [ReaderLine] = []
  var start = 0
  var top: CGFloat = 0
  while start < text.length {
    let x = lines.isEmpty ? firstX : inset
    let available = max(1, config.contentWidth - x)
    var count = CTTypesetterSuggestLineBreak(typesetter, start, Double(available))
    if count <= 0 { count = 1 }
    let range = NSRange(location: start, length: count)
    let line = CTTypesetterCreateLine(typesetter, CFRange(location: start, length: count))
    var ascent: CGFloat = 0
    var descent: CGFloat = 0
    var leading: CGFloat = 0
    let fullWidth = CGFloat(CTLineGetTypographicBounds(line, &ascent, &descent, &leading))
    if family == .serif {
      // Android sizes lines from its primary serif (Noto Serif) even when
      // Hangul comes from the CJK fallback; Noto Serif KR's own metrics are
      // ~6% taller, which would loosen every line.
      ascent = notoSerifAscent * size
      descent = notoSerifDescent * size
    }
    let width = fullWidth - CGFloat(CTLineGetTrailingWhitespaceWidth(line))
    var lineX = x
    if align == "center" {
      lineX += max(0, (available - width) / 2)
    } else if align == "right" || align == "end" {
      lineX += max(0, available - width)
    }
    if let previous = lines.last {
      top = previous.top + previous.naturalHeight * multiplier + annotationSpace
    }
    lines.append(ReaderLine(line: line, range: range, x: lineX, top: top, ascent: ascent, descent: descent, width: width))
    start += count
  }
  let height = lines.last.map { $0.top + $0.naturalHeight } ?? 0
  let defaultBottom: CGFloat = block.isHeading ? 12 : (block.tag == "li" ? 6 : 10)
  // The line spacing a line would get below it, so a paragraph break is never
  // tighter than a line break (Android adds what StaticLayout drops).
  let natural = family == .serif ? (notoSerifAscent + notoSerifDescent) * size : (lines.first?.naturalHeight ?? size)
  let lineExtra = block.isHeading ? 0 : max(0, (natural * (multiplier - 1)).rounded())
  return ReaderBlockLayout(
    block: block, text: text, sentences: splitSentences(text), lines: lines, imageFrame: nil,
    splittable: !block.isHeading && block.tag != "figcaption",
    lineMultiplier: multiplier,
    fontSize: size,
    marginTop: spacing(style["marginTop"], fallback: 0, em: em),
    marginBottom: spacing(style["marginBottom"], fallback: defaultBottom, em: em) + annotationSpace + lineExtra,
    contentHeight: height
  )
}

// Between two body paragraphs, keep at least the in-paragraph baseline gap so
// a paragraph break never looks tighter than a line break.
private func normalizeParagraphGaps(_ layouts: [ReaderBlockLayout]) {
  for index in layouts.indices.dropLast() {
    let current = layouts[index]
    let next = layouts[index + 1]
    guard current.block.tag == "p", next.block.tag == "p", let last = current.lines.last else { continue }
    guard current.lineMultiplier > 1 || next.lineMultiplier > 1 else { continue }
    let lineGap = last.naturalHeight * (current.lineMultiplier - 1)
    let gap = current.marginBottom + next.marginTop
    if gap < lineGap {
      current.marginBottom = lineGap - next.marginTop
    }
  }
}

// MARK: - Pagination

func paginateChapter(_ chapter: ReaderChapter, config: ReaderLayoutConfig) -> [ReaderPage] {
  let layouts = chapter.blocks.map { layoutBlock($0, config: config) }
  normalizeParagraphGaps(layouts)
  let pageHeight = config.contentHeight

  var pages: [[ReaderPageItem]] = []
  var items: [ReaderPageItem] = []
  var y: CGFloat = 0
  func newPage() {
    pages.append(items)
    items = []
    y = 0
  }

  for layout in layouts {
    let height = layout.contentHeight
    if y + layout.marginTop + height <= pageHeight {
      items.append(ReaderPageItem(layout: layout, lineRange: 0..<layout.lines.count, y: y + layout.marginTop, height: height))
      y += layout.marginTop + height + layout.marginBottom
      continue
    }
    if layout.splittable && !layout.lines.isEmpty {
      var lineStart = 0
      var marginTop = layout.marginTop
      while lineStart < layout.lines.count {
        let available = pageHeight - y - marginTop
        let base = layout.lines[lineStart].top
        var end = lineStart
        while end < layout.lines.count && layout.lines[end].top - base + layout.lines[end].naturalHeight <= available {
          end += 1
        }
        if end == lineStart {
          if !items.isEmpty {
            newPage()
            continue
          }
          end = lineStart + 1
        }
        let sliceHeight = layout.height(of: lineStart..<end)
        items.append(ReaderPageItem(layout: layout, lineRange: lineStart..<end, y: y + marginTop, height: sliceHeight))
        if end < layout.lines.count {
          newPage()
          marginTop = 0
        } else {
          y += marginTop + sliceHeight + layout.marginBottom
        }
        lineStart = end
      }
      continue
    }
    if !items.isEmpty { newPage() }
    if layout.marginTop + height > pageHeight {
      // Taller than a page and unsplittable: alone on its page.
      items.append(ReaderPageItem(layout: layout, lineRange: 0..<layout.lines.count, y: 0, height: height))
      newPage()
    } else {
      items.append(ReaderPageItem(layout: layout, lineRange: 0..<layout.lines.count, y: layout.marginTop, height: height))
      y = layout.marginTop + height + layout.marginBottom
    }
  }
  if !items.isEmpty || pages.isEmpty { pages.append(items) }

  return pages.enumerated().map { index, pageItems in
    ReaderPage(
      spineIndex: chapter.spineIndex, href: chapter.href, path: chapter.path,
      chapterPageIndex: index, chapterPageCount: pages.count, items: pageItems
    )
  }
}
