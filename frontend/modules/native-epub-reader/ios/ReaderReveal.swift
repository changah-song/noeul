import UIKit

// The wave that brings a page's word help in once it is ready (RevealWave.kt):
// level underlines sweep in line by line, top to bottom, each line as one pen
// stroke left to right; then pinyin and glosses fade and rise into place on
// the same wave. Paint only, so nothing moves in the layout.
//
// Positions are fractions: y of the line within the visible window (0 top,
// 1 bottom, clamped) and x of the word within the line.

enum ReaderRevealKind { case none, annotations, full }

struct ReaderReveal {
  // When the wave started (ms since 1970), and whether underlines take part.
  let startMs: Double
  let underlines: Bool
}

enum RevealWave {
  static let lineSpreadMs: Double = 220
  static let lineSweepMs: Double = 300
  static let annotationLagMs: Double = 200
  static let annotationAcrossMs: Double = 180
  static let annotationFadeMs: Double = 220
  static let annotationRise: CGFloat = 3

  static func totalMs(underlines: Bool) -> Double {
    let lag = underlines ? annotationLagMs : 0
    let annotations = lag + lineSpreadMs + annotationAcrossMs + annotationFadeMs
    let strokes = underlines ? lineSpreadMs + lineSweepMs : 0
    return max(annotations, strokes)
  }

  static func isDone(_ reveal: ReaderReveal, now: Double) -> Bool {
    now - reveal.startMs >= totalMs(underlines: reveal.underlines)
  }

  static func lineDelayMs(_ y: CGFloat) -> Double { Double(min(max(y, 0), 1)) * lineSpreadMs }

  // How far across its line the stroke has reached, 0...1, eased out.
  static func underlineSweep(elapsedMs: Double, y: CGFloat) -> CGFloat {
    let t = (elapsedMs - lineDelayMs(y)) / lineSweepMs
    let u = 1 - min(max(t, 0), 1)
    return CGFloat(1 - u * u * u)
  }

  // How visible a word's pinyin and gloss are, 0...1.
  static func annotationAlpha(elapsedMs: Double, y: CGFloat, x: CGFloat, underlines: Bool) -> CGFloat {
    let lag = underlines ? annotationLagMs : 0
    let delay = lag + lineDelayMs(y) + Double(min(max(x, 0), 1)) * annotationAcrossMs
    let t = min(max((elapsedMs - delay) / annotationFadeMs, 0), 1)
    return CGFloat(1 - (1 - t) * (1 - t))
  }

  struct Mark {
    let key: String
    let weight: CGFloat?
    let reinforced: Bool
    let underlined: Bool
    let annotated: Bool
  }

  // Whether a change in the marks on the page being read plays the wave:
  // underlines when most are new or any changed shade (word help arrived, the
  // level changed); annotations alone when most of them are new.
  static func kind(before: [Mark], after: [Mark]) -> ReaderRevealKind {
    let old = Dictionary(before.map { ($0.key, $0) }, uniquingKeysWith: { first, _ in first })
    let underlined = after.filter(\.underlined)
    if !underlined.isEmpty {
      var kept = 0
      for mark in underlined {
        guard let previous = old[mark.key], previous.underlined else { continue }
        if previous.weight != mark.weight || previous.reinforced != mark.reinforced { return .full }
        kept += 1
      }
      if kept * 2 < underlined.count { return .full }
    }
    let annotated = after.filter(\.annotated)
    if !annotated.isEmpty {
      let kept = annotated.filter { old[$0.key]?.annotated == true }.count
      if kept * 2 < annotated.count { return .annotations }
    }
    return .none
  }

  static func marks(for page: ReaderPage?, showPinyin: Bool, showGloss: Bool) -> [Mark] {
    guard let page else { return [] }
    return page.highlights.level.map { range in
      Mark(
        key: "\(range.blockId):\(range.range.location):\(range.range.length)",
        weight: range.annotationOnly ? nil : range.weight,
        reinforced: range.reinforced,
        underlined: !range.annotationOnly,
        annotated: (showPinyin && range.pinyin != nil) || (showGloss && range.gloss != nil)
      )
    }
  }
}
