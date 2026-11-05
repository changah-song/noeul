import CoreText
import UIKit

// Part of a selection: a span of one block's text (source offsets). A
// sentence that runs onto the next page draws on both pages, since each page
// shows whatever part falls inside its own slices.
struct ReaderSourceRange: Equatable {
  let blockId: String
  let range: NSRange
}

// The tapped (or spoken) word's box, or a long-press text selection.
struct ReaderSelection {
  enum Kind { case word, text }
  let kind: Kind
  let spineIndex: Int
  let ranges: [ReaderSourceRange]
}

// A caret position on a page: which item, and the offset in its block's text.
struct ReaderTextPosition {
  let itemIndex: Int
  let offset: Int
}

enum ReaderSelectionHandle { case start, end }

struct ReaderWordHit {
  let item: ReaderPageItem
  // In the block's text.
  let range: NSRange
  // In page view coordinates.
  let rect: CGRect
  // Inside a marked phrase: the single word under the finger.
  let phraseWord: String?
}

// The focus beam: the lit sentence span, cross-fading from the previous one.
struct ReaderFocusBeam {
  var current: [ReaderSourceRange] = []
  var previous: [ReaderSourceRange] = []
  // 0 -> 1 while the beam moves from `previous` to `current`.
  var progress: CGFloat = 1
}

// How marks are drawn; set by the reader view on every page.
struct ReaderMarkOptions {
  var showPinyin = false
  var showGloss = false
  // Tapped underlined words: term -> tap time (epoch ms).
  var tappedAt: [String: Double] = [:]
  // Saved words whose strength just dropped: term -> (strength before, start ms).
  var savedFades: [String: (from: CGFloat, at: Double)] = [:]
  // The tapped word's sentence, washed faintly; fades out from `contextFadeAt`.
  var contextSentence: (spineIndex: Int, range: ReaderSourceRange)?
  var contextFadeAt: Double?
  // The word the voice is reading.
  var spokenRange: (spineIndex: Int, range: ReaderSourceRange)?
  // Focus mode: everything dims except the beam.
  var focusBeam: ReaderFocusBeam?
}

func nowMs() -> Double { Date().timeIntervalSince1970 * 1000 }

private let imageCache = NSCache<NSString, UIImage>()

private func loadImage(_ uri: String) -> UIImage? {
  if let cached = imageCache.object(forKey: uri as NSString) { return cached }
  let path = URL(string: uri).flatMap { $0.isFileURL ? $0.path : nil } ?? uri
  guard let image = UIImage(contentsOfFile: path) else { return nil }
  imageCache.setObject(image, forKey: uri as NSString)
  return image
}

private let pixelSize: CGFloat = 3
private let tapDissolveMs: Double = 700
private let savedFadeMs: Double = 900
private let contextFadeMs: Double = 260
private let marqueePauseMs: Double = 1400
private let marqueeFrameMs: Double = 40
private let senseTurnMs: Double = 3200
private let senseFadeMs: Double = 280
private let focusDimAlpha: CGFloat = 0.22

private func hasCjkOrKana(_ text: String) -> Bool {
  text.utf16.contains { isHangul($0) || isCjkIdeograph($0) || (0x3040...0x30FF).contains($0) }
}

final class ReaderPageView: UIView {
  // Paged mode: where the content box sits in the page.
  static let insets = UIEdgeInsets(top: 30, left: 24, bottom: 16, right: 24)

  var page: ReaderPage? {
    didSet { setNeedsDisplay() }
  }
  var palette = ReaderPalette.make(theme: "light", tokens: [:]) {
    didSet {
      backgroundColor = palette.background
      setNeedsDisplay()
    }
  }
  var selection: ReaderSelection? {
    didSet { setNeedsDisplay() }
  }
  var marks = ReaderMarkOptions() {
    didSet { setNeedsDisplay() }
  }
  // Top-left of the content box in this view. Scroll-mode tiles each show a
  // band of a tall chapter by moving it up.
  var contentOrigin = CGPoint(x: ReaderPageView.insets.left, y: ReaderPageView.insets.top) {
    didSet { setNeedsDisplay() }
  }

  private var redrawScheduled = false

  override init(frame: CGRect) {
    super.init(frame: frame)
    isOpaque = true
    contentMode = .redraw
    backgroundColor = palette.background
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  private var origin: CGPoint { contentOrigin }

  private var contentWidth: CGFloat {
    bounds.width - Self.insets.left - Self.insets.right
  }

  // MARK: - Drawing

  override func draw(_ rect: CGRect) {
    guard let context = UIGraphicsGetCurrentContext() else { return }
    palette.background.setFill()
    context.fill(bounds)
    guard let page else { return }
    // Next frame wanted by an animation (ms), if any.
    var nextFrameMs = Double.infinity

    if let beam = marks.focusBeam {
      // One dim layer for everything, then the lit span redrawn at full
      // strength inside its own clip (cross-fading while the beam moves).
      context.saveGState()
      context.setAlpha(focusDimAlpha)
      context.beginTransparencyLayer(auxiliaryInfo: nil)
      nextFrameMs = drawItems(of: page, in: rect, context: context)
      context.endTransparencyLayer()
      context.restoreGState()
      for (ranges, alpha) in [(beam.previous, 1 - beam.progress), (beam.current, beam.progress)] where alpha > 0.01 && !ranges.isEmpty {
        let clip = beamClip(ranges, in: page)
        guard !clip.isEmpty else { continue }
        context.saveGState()
        context.clip(to: clip)
        context.setAlpha(alpha)
        context.beginTransparencyLayer(auxiliaryInfo: nil)
        _ = drawItems(of: page, in: rect, context: context, boldPass: true)
        context.endTransparencyLayer()
        context.restoreGState()
      }
    } else {
      nextFrameMs = drawItems(of: page, in: rect, context: context)
    }
    drawTextSelection(context: context)
    scheduleRedraw(afterMs: nextFrameMs)
  }

  private func scheduleRedraw(afterMs delay: Double) {
    guard delay.isFinite, !redrawScheduled, window != nil else { return }
    redrawScheduled = true
    DispatchQueue.main.asyncAfter(deadline: .now() + delay / 1000) { [weak self] in
      self?.redrawScheduled = false
      self?.setNeedsDisplay()
    }
  }

  // Each block in Android's order: context wash, spoken wash, word box, level
  // underlines, saved shade + underline, text, annotations. Returns ms until
  // the next animation frame is needed.
  private func drawItems(of page: ReaderPage, in rect: CGRect, context: CGContext, boldPass: Bool = false) -> Double {
    var nextFrameMs = Double.infinity
    let now = nowMs()
    let band = rect.insetBy(dx: 0, dy: -48)
    for item in page.items {
      let itemRect = CGRect(x: 0, y: origin.y + item.y, width: bounds.width, height: item.height)
      guard itemRect.intersects(band) else { continue }
      if let frame = item.layout.imageFrame {
        drawImage(item, frame: frame)
        continue
      }
      let blockId = item.layout.block.id

      if let wash = marks.contextSentence, wash.spineIndex == page.spineIndex, wash.range.blockId == blockId {
        var fade: CGFloat = 1
        if let start = marks.contextFadeAt {
          fade = CGFloat(max(0, 1 - (now - start) / contextFadeMs))
          if fade > 0 { nextFrameMs = min(nextFrameMs, 16) }
        }
        if fade > 0 {
          palette.bodyText.withAlphaComponent((palette.isDark ? 0x1C : 0x14) / 255 * fade).setFill()
          fillBoxes(for: wash.range.range, in: item)
        }
      }
      if let spoken = marks.spokenRange, spoken.spineIndex == page.spineIndex, spoken.range.blockId == blockId {
        (palette.isDark ? UIColor(red: 0x5B / 255, green: 0x9B / 255, blue: 0xE6 / 255, alpha: 0x66 / 255)
                        : UIColor(red: 0x9C / 255, green: 0xCB / 255, blue: 0xFF / 255, alpha: 0x73 / 255)).setFill()
        fillBoxes(for: spoken.range.range, in: item)
      }
      if let selection, selection.kind == .word, selection.spineIndex == page.spineIndex {
        palette.activeHighlight.setFill()
        for part in selection.ranges where part.blockId == blockId {
          fillBoxes(for: part.range, in: item)
        }
      }
      for range in page.highlights.level where range.blockId == blockId && !range.annotationOnly {
        let progress = tapProgress(range, now: now)
        if progress > 0 && progress < 1 { nextFrameMs = min(nextFrameMs, 16) }
        drawUnderline(range.range, in: item, color: levelUnderlineColor(weight: range.weight, reinforced: range.reinforced, palette: palette),
                      thickness: 1.4 + 0.8 * min(max(range.weight, 0), 1), roundCap: true, dissolve: progress, context: context)
      }
      for range in page.highlights.saved where range.blockId == blockId {
        let shown = savedStrength(range, now: now, nextFrameMs: &nextFrameMs)
        guard shown > 0.01 else { continue }
        palette.savedHighlight.withAlphaComponent(0.16 * shown).setFill()
        fillBoxes(for: range.range, in: item)
        drawUnderline(range.range, in: item, color: palette.savedHighlight.withAlphaComponent(0.85 * shown),
                      thickness: 2, roundCap: false, dissolve: 0, context: context)
      }
      drawLines(of: item, context: context, offsetX: 0)
      if boldPass {
        // A touch heavier for the lit sentence.
        drawLines(of: item, context: context, offsetX: 0.3)
      }
      if marks.showPinyin || marks.showGloss {
        let levels = page.highlights.level.filter { $0.blockId == blockId }
        nextFrameMs = min(nextFrameMs, drawAnnotations(levels, in: item, context: context, now: now))
      }
    }
    return nextFrameMs
  }

  private func savedStrength(_ range: ReaderHighlightRange, now: Double, nextFrameMs: inout Double) -> CGFloat {
    guard let fade = marks.savedFades[range.term] else { return range.strength }
    let progress = (now - fade.at) / savedFadeMs
    guard progress < 1 else { return range.strength }
    nextFrameMs = min(nextFrameMs, 16)
    return fade.from + (range.strength - fade.from) * CGFloat(max(progress, 0))
  }

  private func drawLines(of item: ReaderPageItem, context: CGContext, offsetX: CGFloat) {
    context.saveGState()
    context.textMatrix = CGAffineTransform(scaleX: 1, y: -1)
    for index in item.lineRange {
      let line = item.layout.lines[index]
      context.textPosition = CGPoint(x: origin.x + line.x + offsetX, y: origin.y + item.lineTop(index) + line.ascent)
      CTLineDraw(line.line, context)
    }
    context.restoreGState()
  }

  private func drawImage(_ item: ReaderPageItem, frame: CGRect) {
    let box = CGRect(x: origin.x + frame.minX, y: origin.y + item.y, width: frame.width, height: item.height)
    guard let uri = item.layout.block.fileUri, let image = loadImage(uri), image.size.width > 0, image.size.height > 0 else {
      palette.placeholder.setFill()
      UIBezierPath(roundedRect: box, cornerRadius: 8).fill()
      return
    }
    let scale = min(box.width / image.size.width, box.height / image.size.height)
    let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
    image.draw(in: CGRect(x: box.midX - size.width / 2, y: box.midY - size.height / 2, width: size.width, height: size.height))
  }

  // MARK: - Geometry

  // The part of `range` on each line it touches, as (line index, left, right)
  // in view coordinates, trailing/leading whitespace excluded.
  private func lineSpans(for range: NSRange, in item: ReaderPageItem) -> [(index: Int, left: CGFloat, right: CGFloat)] {
    var spans: [(index: Int, left: CGFloat, right: CGFloat)] = []
    let text = item.layout.text
    for index in item.lineRange {
      let line = item.layout.lines[index]
      var overlap = NSIntersectionRange(range, line.range)
      while overlap.length > 0, isWhitespaceUnit(text.character(at: overlap.location)) {
        overlap.location += 1
        overlap.length -= 1
      }
      while overlap.length > 0, isWhitespaceUnit(text.character(at: NSMaxRange(overlap) - 1)) {
        overlap.length -= 1
      }
      guard overlap.length > 0 else { continue }
      let startX = CTLineGetOffsetForStringIndex(line.line, overlap.location, nil)
      let endX = min(CTLineGetOffsetForStringIndex(line.line, NSMaxRange(overlap), nil), line.width)
      spans.append((index, origin.x + line.x + startX, origin.x + line.x + max(endX, startX)))
    }
    return spans
  }

  // Bottom of a line's box: down to the next line, or its own line spacing.
  private func lineBottom(_ index: Int, in item: ReaderPageItem) -> CGFloat {
    let line = item.layout.lines[index]
    if index + 1 < item.lineRange.upperBound { return origin.y + item.lineTop(index + 1) }
    return origin.y + item.lineTop(index) + line.naturalHeight * item.layout.lineMultiplier
  }

  // Word-style boxes (tapped word, context, spoken), one per line: snug around
  // the ink, never over the pinyin or gloss rows.
  func boxes(for range: NSRange, in item: ReaderPageItem) -> [CGRect] {
    lineSpans(for: range, in: item).map { span in
      let line = item.layout.lines[span.index]
      let lineTop = origin.y + item.lineTop(span.index)
      let baseline = lineTop + line.ascent
      var top = max(lineTop - 6, baseline - line.ascent - 1)
      var bottom = min(lineBottom(span.index, in: item) - 1, baseline + line.descent + 2)
      if marks.showPinyin { top = max(top, baseline - line.ascent) }
      if marks.showGloss { bottom = min(bottom, baseline + line.descent) }
      return CGRect(x: span.left - 1, y: top, width: span.right - span.left + 2, height: max(bottom - top, 1))
    }
  }

  private func fillBoxes(for range: NSRange, in item: ReaderPageItem) {
    for box in boxes(for: range, in: item) {
      UIBezierPath(roundedRect: box, cornerRadius: 3).fill()
    }
  }

  private func tapProgress(_ range: ReaderHighlightRange, now: Double) -> CGFloat {
    guard let at = marks.tappedAt[range.term] else { return 0 }
    return CGFloat(min(max((now - at) / tapDissolveMs, 0), 1))
  }

  // An underline at baseline + 3: solid, or once tapped a row of pixels whose
  // odd cells drop out until it's dotted.
  private func drawUnderline(_ range: NSRange, in item: ReaderPageItem, color: UIColor, thickness: CGFloat,
                             roundCap: Bool, dissolve: CGFloat, context: CGContext) {
    for span in lineSpans(for: range, in: item) {
      let line = item.layout.lines[span.index]
      let y = origin.y + item.lineTop(span.index) + line.ascent + 3
      if dissolve <= 0 {
        context.saveGState()
        context.setStrokeColor(color.cgColor)
        context.setLineWidth(thickness)
        context.setLineCap(roundCap ? .round : .butt)
        context.move(to: CGPoint(x: span.left, y: y))
        context.addLine(to: CGPoint(x: span.right, y: y))
        context.strokePath()
        context.restoreGState()
        continue
      }
      context.saveGState()
      context.setShouldAntialias(false)
      color.setFill()
      let top = y - thickness / 2
      let iy = Int(floor(top / pixelSize))
      var ix = Int(floor(span.left / pixelSize))
      while CGFloat(ix) * pixelSize < span.right {
        // Even cells always stay; odd ones leave in hash order.
        if (ix + iy) & 1 == 0 || pixelHash(ix, iy) >= dissolve {
          let left = max(span.left, CGFloat(ix) * pixelSize)
          let right = min(span.right, CGFloat(ix + 1) * pixelSize)
          context.fill(CGRect(x: left, y: top, width: right - left, height: thickness))
        }
        ix += 1
      }
      context.restoreGState()
    }
  }

  // The focus beam's clip: each lit line from the span's start to its end,
  // line top to line bottom, plus the annotation rows when they're on.
  private func beamClip(_ ranges: [ReaderSourceRange], in page: ReaderPage) -> [CGRect] {
    var rects: [CGRect] = []
    for item in page.items where item.layout.imageFrame == nil {
      for part in ranges where part.blockId == item.layout.block.id {
        for span in lineSpans(for: part.range, in: item) {
          let top = origin.y + item.lineTop(span.index)
          let line = item.layout.lines[span.index]
          let size = item.layout.fontSize
          let above = marks.showPinyin ? 0.9 * size : 0
          let below = marks.showGloss ? 0.95 * size : 0
          // The text exactly; the pinyin and gloss rows a little wider, so a
          // wide annotation isn't cut at the word's edge.
          rects.append(CGRect(x: span.left, y: top, width: span.right - span.left, height: lineBottom(span.index, in: item) - top))
          if above > 0 {
            rects.append(CGRect(x: span.left - 8, y: top - above, width: span.right - span.left + 16, height: above))
          }
          if below > 0 {
            let rowTop = top + line.ascent + line.descent
            rects.append(CGRect(x: span.left - 8, y: rowTop, width: span.right - span.left + 16, height: below))
          }
        }
      }
    }
    return rects
  }

  // MARK: - Annotations

  private struct GlossItem {
    let line: Int
    let left: CGFloat
    let right: CGFloat
    let senses: [String]
  }

  // Pinyin above each level word and its gloss below, in the rows the layout
  // reserved. Several senses take turns; a gloss that doesn't fit the space
  // between its neighbours slides back and forth. Returns ms until the next
  // frame is needed.
  private func drawAnnotations(_ ranges: [ReaderHighlightRange], in item: ReaderPageItem, context: CGContext, now: Double) -> Double {
    let bodySize = item.layout.fontSize
    let ink = palette.isDark ? palette.mutedText : palette.subtleText
    let pinyinFont = UIFont.systemFont(ofSize: bodySize * 0.55)
    var glosses: [GlossItem] = []

    for range in ranges {
      let pinyin = marks.showPinyin ? range.pinyin : nil
      let senses = marks.showGloss ? (range.gloss.map(commonSenses) ?? []) : []
      guard pinyin != nil || !senses.isEmpty else { continue }
      let syllables = pinyin?.split(whereSeparator: { $0.isWhitespace }).map(String.init)
      let perCharacter = syllables.map { $0.count == range.range.length } ?? false
      for (spanIndex, span) in lineSpans(for: range.range, in: item).enumerated() {
        let line = item.layout.lines[span.index]
        let baseline = origin.y + item.lineTop(span.index) + line.ascent
        if let pinyin {
          let pinyinBaseline = baseline - line.ascent - 1 - abs(pinyinFont.descender)
          if perCharacter, let syllables {
            let overlap = NSIntersectionRange(range.range, line.range)
            for index in overlap.location..<NSMaxRange(overlap) {
              let left = origin.x + line.x + CTLineGetOffsetForStringIndex(line.line, index, nil)
              let right = origin.x + line.x + min(CTLineGetOffsetForStringIndex(line.line, index + 1, nil), line.width)
              drawSqueezed(syllables[index - range.range.location], font: pinyinFont, color: ink, centerX: (left + right) / 2,
                           baseline: pinyinBaseline, maxWidth: abs(right - left) - 1, context: context)
            }
          } else if spanIndex == 0 {
            drawSqueezed(pinyin, font: pinyinFont, color: ink, centerX: (span.left + span.right) / 2,
                         baseline: pinyinBaseline, maxWidth: span.right - span.left + 6, context: context)
          }
        }
        if !senses.isEmpty {
          glosses.append(GlossItem(line: span.index, left: span.left, right: span.right, senses: senses))
        }
      }
    }
    guard !glosses.isEmpty else { return .infinity }

    let gap: CGFloat = 3
    let edgeSlack: CGFloat = 24
    var nextFrame = Double.infinity
    for (lineIndex, items) in Dictionary(grouping: glosses, by: \.line) {
      let line = item.layout.lines[lineIndex]
      // Glosses in Hangul or CJK need a little more size to stay legible.
      let scale: CGFloat = items.contains { $0.senses.contains(where: hasCjkOrKana) } ? 0.66 : 0.58
      let glossFont = UIFont.systemFont(ofSize: bodySize * scale)
      let baseline = origin.y + item.lineTop(lineIndex) + line.ascent + line.descent + 1 + glossFont.ascender
      let top = baseline - glossFont.ascender
      let sorted = items.sorted { $0.left < $1.left }
      for (index, gloss) in sorted.enumerated() {
        let slotLeft = index == 0 ? max(origin.x, gloss.left - edgeSlack) : (sorted[index - 1].right + gloss.left) / 2 + gap / 2
        let slotRight = index == sorted.count - 1
          ? min(origin.x + contentWidth, gloss.right + edgeSlack)
          : (gloss.right + sorted[index + 1].left) / 2 - gap / 2
        let slotWidth = slotRight - slotLeft
        guard slotWidth >= 10 else { continue }

        // Which sense shows now, and the one fading out at a turn.
        var shown: [(text: String, alpha: CGFloat)]
        var turnClock = now
        if gloss.senses.count > 1 {
          let turn = Int(now / senseTurnMs)
          let phase = now.truncatingRemainder(dividingBy: senseTurnMs)
          turnClock = phase
          let current = gloss.senses[turn % gloss.senses.count]
          if phase < senseFadeMs {
            let p = CGFloat(phase / senseFadeMs)
            shown = [(gloss.senses[(turn + gloss.senses.count - 1) % gloss.senses.count], 1 - p), (current, p)]
            nextFrame = min(nextFrame, 16)
          } else {
            shown = [(current, 1)]
            nextFrame = min(nextFrame, senseTurnMs - phase)
          }
        } else {
          shown = [(gloss.senses[0], 1)]
        }
        for (text, alpha) in shown {
          let string = NSAttributedString(string: text, attributes: [.font: glossFont, .foregroundColor: ink.withAlphaComponent(alpha)])
          let width = string.size().width
          if width <= slotWidth {
            let center = min(max((gloss.left + gloss.right) / 2, slotLeft + width / 2), slotRight - width / 2)
            string.draw(at: CGPoint(x: center - width / 2, y: top))
          } else {
            let (offset, untilChange) = marqueeOffset(overflow: width - slotWidth, now: turnClock)
            nextFrame = min(nextFrame, untilChange)
            context.saveGState()
            context.clip(to: CGRect(x: slotLeft, y: top, width: slotWidth, height: glossFont.lineHeight))
            string.draw(at: CGPoint(x: slotLeft - offset, y: top))
            context.restoreGState()
          }
        }
      }
    }
    return nextFrame.isFinite ? min(max(nextFrame, 16), marqueePauseMs) : nextFrame
  }

  private func drawSqueezed(_ text: String, font: UIFont, color: UIColor, centerX: CGFloat, baseline: CGFloat,
                            maxWidth: CGFloat, context: CGContext) {
    guard maxWidth > 0 else { return }
    let string = NSAttributedString(string: text, attributes: [.font: font, .foregroundColor: color])
    let natural = string.size().width
    let scale = natural > maxWidth ? max(maxWidth / natural, 0.55) : 1
    context.saveGState()
    context.translateBy(x: centerX, y: 0)
    context.scaleBy(x: scale, y: 1)
    string.draw(at: CGPoint(x: -natural / 2, y: baseline - font.ascender))
    context.restoreGState()
  }

  // Pause, slide left, pause, slide back; all glosses share the clock.
  private func marqueeOffset(overflow: CGFloat, now: Double) -> (CGFloat, Double) {
    let slideMs = max(Double(overflow / 28) * 1000, 500)
    let cycle = 2 * marqueePauseMs + 2 * slideMs
    let t = now.truncatingRemainder(dividingBy: cycle)
    if t < marqueePauseMs { return (0, marqueePauseMs - t) }
    if t < marqueePauseMs + slideMs { return (overflow * CGFloat((t - marqueePauseMs) / slideMs), marqueeFrameMs) }
    if t < 2 * marqueePauseMs + slideMs { return (overflow, 2 * marqueePauseMs + slideMs - t) }
    return (overflow * CGFloat(1 - (t - 2 * marqueePauseMs - slideMs) / slideMs), marqueeFrameMs)
  }

  // MARK: - Text selection

  // The selection's parts that fall on this page, in reading order.
  func selectionParts() -> [(itemIndex: Int, range: NSRange)] {
    guard let page, let selection, selection.spineIndex == page.spineIndex else { return [] }
    var parts: [(itemIndex: Int, range: NSRange)] = []
    for (index, item) in page.items.enumerated() where item.layout.imageFrame == nil && !item.lineRange.isEmpty {
      let slice = sliceRange(of: item)
      for part in selection.ranges where part.blockId == item.layout.block.id {
        let overlap = NSIntersectionRange(part.range, slice)
        if overlap.length > 0 { parts.append((index, overlap)) }
      }
    }
    return parts.sorted { ($0.itemIndex, $0.range.location) < ($1.itemIndex, $1.range.location) }
  }

  func sliceRange(of item: ReaderPageItem) -> NSRange {
    let lines = item.layout.lines
    guard !item.lineRange.isEmpty else { return NSRange(location: 0, length: 0) }
    let start = lines[item.lineRange.lowerBound].range.location
    return NSRange(location: start, length: NSMaxRange(lines[item.lineRange.upperBound - 1].range) - start)
  }

  // Long-press selection boxes: one rounded box per line around the ink.
  func textSelectionBoxes() -> [CGRect] {
    guard let page, selection?.kind == .text else { return [] }
    return selectionParts().flatMap { part -> [CGRect] in
      let item = page.items[part.itemIndex]
      return lineSpans(for: part.range, in: item).map { span in
        let line = item.layout.lines[span.index]
        let top = origin.y + item.lineTop(span.index)
        return CGRect(x: span.left - 2, y: top - 1, width: span.right - span.left + 4, height: line.ascent + line.descent + 3)
      }
    }
  }

  // Every box of the current selection (word or text), for tap tests.
  func selectionBoxes() -> [CGRect] {
    guard let page, let selection else { return [] }
    if selection.kind == .text { return textSelectionBoxes() }
    return selectionParts().flatMap { boxes(for: $0.range, in: page.items[$0.itemIndex]) }
  }

  func selectionContains(_ point: CGPoint) -> Bool {
    selectionBoxes().contains { $0.insetBy(dx: -4, dy: -4).contains(point) }
  }

  // The selection's start and end on this page, as caret positions.
  func selectionEndpoints() -> (start: ReaderTextPosition, end: ReaderTextPosition)? {
    let parts = selectionParts()
    guard let first = parts.first, let last = parts.last else { return nil }
    return (
      ReaderTextPosition(itemIndex: first.itemIndex, offset: first.range.location),
      ReaderTextPosition(itemIndex: last.itemIndex, offset: NSMaxRange(last.range))
    )
  }

  private struct HandleGeometry {
    let handle: ReaderSelectionHandle
    let x: CGFloat
    let top: CGFloat
    let bottom: CGFloat
    let knobY: CGFloat
  }

  // A bar along the first box's left edge and the last box's right edge,
  // knobs above the first and below the last.
  private func handleGeometries() -> [HandleGeometry] {
    let boxes = textSelectionBoxes()
    guard let first = boxes.first, let last = boxes.last else { return [] }
    return [
      HandleGeometry(handle: .start, x: first.minX, top: first.minY, bottom: first.maxY, knobY: first.minY - 4.5),
      HandleGeometry(handle: .end, x: last.maxX, top: last.minY, bottom: last.maxY, knobY: last.maxY + 4.5),
    ]
  }

  private func drawTextSelection(context: CGContext) {
    let boxes = textSelectionBoxes()
    guard !boxes.isEmpty else { return }
    palette.textSelectionHighlight.setFill()
    for box in boxes {
      UIBezierPath(roundedRect: box, cornerRadius: 5).fill()
    }
    context.saveGState()
    palette.selectionHandle.setFill()
    for handle in handleGeometries() {
      context.fill(CGRect(x: handle.x - 1, y: handle.top, width: 2, height: handle.bottom - handle.top))
      context.fillEllipse(in: CGRect(x: handle.x - 5.5, y: handle.knobY - 5.5, width: 11, height: 11))
    }
    context.restoreGState()
  }

  func handleHit(at point: CGPoint) -> ReaderSelectionHandle? {
    let slop: CGFloat = 24
    return handleGeometries()
      .filter { abs(point.x - $0.x) <= slop
        && point.y >= min($0.top, $0.knobY) - slop - 4 && point.y <= max($0.bottom, $0.knobY) + slop + 4 }
      .min { abs(point.x - $0.x) + abs(point.y - $0.knobY) < abs(point.x - $1.x) + abs(point.y - $1.knobY) }?
      .handle
  }

  // Where a handle sits, so a drag can keep the finger's offset from it.
  func handlePoint(_ handle: ReaderSelectionHandle) -> CGPoint? {
    handleGeometries().first { $0.handle == handle }.map { CGPoint(x: $0.x, y: ($0.top + $0.bottom) / 2) }
  }

  // The caret position under a point. With allowClosest, a point outside the
  // text snaps to the nearest item's start or end (for drags).
  func textPosition(at point: CGPoint, allowClosest: Bool) -> ReaderTextPosition? {
    guard let page else { return nil }
    let local = CGPoint(x: point.x - origin.x, y: point.y - origin.y)
    let textItems = page.items.indices.filter { page.items[$0].layout.imageFrame == nil && !page.items[$0].lineRange.isEmpty }
    for index in textItems {
      let item = page.items[index]
      guard local.y >= item.y, local.y <= item.y + item.height else { continue }
      var lineIndex = item.lineRange.lowerBound
      for candidate in item.lineRange where item.lineTop(candidate) <= local.y { lineIndex = candidate }
      let line = item.layout.lines[lineIndex]
      let x = min(max(local.x - line.x, 0), line.width)
      var offset = CTLineGetStringIndexForPosition(line.line, CGPoint(x: x, y: 0))
      if offset == kCFNotFound { offset = line.range.location }
      offset = min(max(offset, line.range.location), NSMaxRange(line.range))
      return ReaderTextPosition(itemIndex: index, offset: offset)
    }
    guard allowClosest, let first = textItems.first, let last = textItems.last else { return nil }
    let distance: (Int) -> CGFloat = { index in
      let item = page.items[index]
      return min(abs(local.y - item.y), abs(local.y - (item.y + item.height)))
    }
    let index: Int
    if local.y <= page.items[first].y {
      index = first
    } else if local.y >= page.items[last].y + page.items[last].height {
      index = last
    } else {
      index = textItems.min { distance($0) < distance($1) } ?? last
    }
    let slice = sliceRange(of: page.items[index])
    return ReaderTextPosition(itemIndex: index, offset: local.y < page.items[index].y ? slice.location : NSMaxRange(slice))
  }

  // A caret snapped to word edges: a start to the start of the word under it,
  // an end to the end of the word before it.
  func snapped(_ position: ReaderTextPosition, asEnd: Bool) -> ReaderTextPosition {
    guard let page, let item = page.items[safe: position.itemIndex] else { return position }
    let text = item.layout.text
    let probe = asEnd ? max(position.offset - 1, 0) : position.offset
    guard text.length > 0, let token = tokenRange(in: text, at: min(probe, text.length - 1)) else { return position }
    return ReaderTextPosition(itemIndex: position.itemIndex, offset: asEnd ? NSMaxRange(token) : token.location)
  }

  // Ranges covering [from, to) on this page, in reading order.
  func sourceRanges(from: ReaderTextPosition, to: ReaderTextPosition) -> [ReaderSourceRange] {
    guard let page else { return [] }
    let (start, end) = (from.itemIndex, from.offset) <= (to.itemIndex, to.offset) ? (from, to) : (to, from)
    var ranges: [ReaderSourceRange] = []
    for index in start.itemIndex...end.itemIndex {
      guard let item = page.items[safe: index], item.layout.imageFrame == nil, !item.lineRange.isEmpty else { continue }
      let slice = sliceRange(of: item)
      let lower = index == start.itemIndex ? max(start.offset, slice.location) : slice.location
      let upper = index == end.itemIndex ? min(end.offset, NSMaxRange(slice)) : NSMaxRange(slice)
      if lower < upper {
        ranges.append(ReaderSourceRange(blockId: item.layout.block.id, range: NSRange(location: lower, length: upper - lower)))
      }
    }
    return ranges
  }

  // MARK: - Hit testing

  // The word under a point. Taps between lines (outside the ink band) or
  // between words (more than 4 pt off the word) hit nothing.
  func wordHit(at point: CGPoint) -> ReaderWordHit? {
    guard let page else { return nil }
    let local = CGPoint(x: point.x - origin.x, y: point.y - origin.y)
    for item in page.items where item.layout.imageFrame == nil {
      guard local.y >= item.y - 24, local.y <= item.y + item.height + 24 else { continue }
      let size = item.layout.fontSize
      for index in item.lineRange {
        let line = item.layout.lines[index]
        let baseline = item.lineTop(index) + line.ascent
        let bandTop = baseline - line.ascent - (marks.showPinyin ? 0.9 * size : 0) - 5
        let bandBottom = baseline + line.descent + (marks.showGloss ? 0.95 * size : 0) + 5
        guard local.y >= bandTop, local.y <= bandBottom else { continue }
        guard local.x >= line.x - 4, local.x <= line.x + line.width + 4 else { return nil }

        let lineX = local.x - line.x
        var offset = CTLineGetStringIndexForPosition(line.line, CGPoint(x: lineX, y: 0))
        guard offset != kCFNotFound else { return nil }
        // That's the nearest caret; step back when the finger is on the
        // character before it.
        if offset > line.range.location && CTLineGetOffsetForStringIndex(line.line, offset, nil) > lineX {
          offset -= 1
        }
        offset = min(max(offset, line.range.location), NSMaxRange(line.range) - 1)
        let text = item.layout.text
        let blockId = item.layout.block.id
        let plain = tokenRange(in: text, at: offset)
        var token = plain
        var phraseWord: String?
        let c = text.character(at: offset)
        if isCjkIdeograph(c) {
          // Chinese: a marked word wins over the segmenter's guess.
          let covering = page.highlights.level.filter { $0.blockId == blockId && $0.range.length > 1 && NSLocationInRange(offset, $0.range) }
          if let longest = covering.max(by: { $0.range.length < $1.range.length }) { token = longest.range }
        } else if isLatinLetter(c) || isWhitespaceUnit(c) || isInWordPunctuation(text, at: offset) {
          // Inside a marked English phrase: look up the phrase, remember the word.
          let phrases = page.highlights.level.filter { $0.blockId == blockId && $0.isPhrase && NSLocationInRange(offset, $0.range) }
          if let longest = phrases.max(by: { $0.range.length < $1.range.length }) {
            token = longest.range
            if let plain, NSIntersectionRange(plain, longest.range).length == plain.length {
              phraseWord = text.substring(with: plain)
            }
          }
        }
        guard let token else { return nil }
        let spans = lineSpans(for: token, in: item).filter { $0.index == index }
        if let span = spans.first, point.x < span.left - 4 || point.x > span.right + 4 { return nil }
        let rect = boxes(for: token, in: item).first ?? .zero
        return ReaderWordHit(item: item, range: token, rect: rect, phraseWord: phraseWord)
      }
    }
    return nil
  }
}
