import UIKit

// Saved-word boxes and level underlines: which words on a page get them.
// Matching follows the Android reader exactly: terms longest first, exact
// UTF-16 matches on each page slice, a word-boundary rule that exempts CJK,
// and no two marks of one kind overlapping in a block.

struct ReaderLevelTerm {
  let text: String
  let weight: CGFloat
  let pinyin: String?
  let gloss: String?
  let reinforced: Bool
  let annotationOnly: Bool
  // Word frequency (Zipf); breaks ties between equal-length words.
  let rank: Double
}

struct ReaderHighlightRange {
  let blockId: String
  // In the block's text.
  let range: NSRange
  let term: String
  // Saved boxes: 0...1, 1 = solid.
  var strength: CGFloat = 1
  // Level underlines: position on the easy -> hard gradient.
  var weight: CGFloat = 1
  var pinyin: String?
  var gloss: String?
  var reinforced = false
  var annotationOnly = false
  // A multi-word English phrase ("gave up"): a tap inside it looks up the phrase.
  var isPhrase = false
}

struct ReaderPageHighlights {
  var saved: [ReaderHighlightRange] = []
  var level: [ReaderHighlightRange] = []
  // onPageChange's savedHighlights: [{ text, sentence, blockId }].
  var savedContexts: [[String: Any]] = []
  // Exposure: graded (and exposure-only) words and saved words on the page.
  var savedTerms: [String] = []
  var levelTerms: [String] = []
  var exposureTerms: [String] = []
  // Exposure-only hits per block, for scroll and focus units.
  var exposureHits: [(blockId: String, range: NSRange, term: String)] = []
  var chars = 0

  static let empty = ReaderPageHighlights()
}

private func trimmedTerm(_ value: Any?) -> String? {
  guard let text = (value as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
  return text
}

private func longestFirst(_ a: String, _ b: String) -> Bool {
  let la = (a as NSString).length
  let lb = (b as NSString).length
  return la != lb ? la > lb : a < b
}

final class ReaderHighlightTerms {
  let saved: [String]
  let strengths: [String: CGFloat]
  let level: [ReaderLevelTerm]
  let exposure: [String]
  let savedMatcher: TermMatcher
  let levelMatcher: TermMatcher
  let exposureMatcher: TermMatcher

  init(highlightTerms: [Any], strengths rawStrengths: [String: Any], levelTerms: [Any], exposureTerms: [Any] = []) {
    var seen = Set<String>()
    saved = highlightTerms.compactMap(trimmedTerm).filter { seen.insert($0).inserted }.sorted(by: longestFirst)

    var strengths: [String: CGFloat] = [:]
    for (term, value) in rawStrengths {
      if let number = doubleValue(value) { strengths[term] = CGFloat(min(max(number, 0), 1)) }
    }
    self.strengths = strengths

    var levelSeen = Set<String>()
    level = levelTerms.compactMap { entry -> ReaderLevelTerm? in
      if let text = trimmedTerm(entry) {
        return ReaderLevelTerm(text: text, weight: 1, pinyin: nil, gloss: nil, reinforced: false, annotationOnly: false, rank: 0)
      }
      guard let map = entry as? [String: Any], let text = trimmedTerm(map["text"]) else { return nil }
      return ReaderLevelTerm(
        text: text,
        weight: CGFloat(min(max(doubleValue(map["weight"]) ?? 1, 0), 1)),
        pinyin: trimmedTerm(map["pinyin"]),
        gloss: trimmedTerm(map["gloss"]),
        reinforced: (map["category"] as? String) == "reinforced",
        annotationOnly: (map["annotationOnly"] as? Bool) == true,
        rank: doubleValue(map["rank"]) ?? 0
      )
    }
    .filter { levelSeen.insert($0.text).inserted }
    .sorted { a, b in
      let la = (a.text as NSString).length
      let lb = (b.text as NSString).length
      if la != lb { return la > lb }
      if a.rank != b.rank { return a.rank > b.rank }
      return a.text < b.text
    }

    var exposureSeen = Set<String>()
    exposure = exposureTerms.compactMap(trimmedTerm).filter { exposureSeen.insert($0).inserted }.sorted(by: longestFirst)

    savedMatcher = TermMatcher(terms: saved)
    levelMatcher = TermMatcher(terms: level.map(\.text))
    exposureMatcher = TermMatcher(terms: exposure)
  }

  var isEmpty: Bool { saved.isEmpty && level.isEmpty && exposure.isEmpty }
}

func isWhitespaceUnit(_ c: unichar) -> Bool {
  Unicode.Scalar(c)?.properties.isWhitespace ?? false
}

// Runs of whitespace as one space, trimmed ("gave\nup" -> "gave up").
func collapseSpaces(_ text: String) -> String {
  text.components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }.joined(separator: " ")
}

// A phrase term: has whitespace and at least one Latin letter.
func isPhraseTerm(_ term: String) -> Bool {
  term.utf16.contains(where: isWhitespaceUnit) && term.utf16.contains(where: isLatinLetter)
}

// Aho–Corasick over UTF-16 code units. A term's priority is its index in the
// (longest-first) list. When a term contains whitespace, terms and text are
// both matched with whitespace runs collapsed, so a phrase matches across a
// line break or a no-break space; offsets map back to the original text.
final class TermMatcher {
  private var children: [[unichar: Int]] = [[:]]
  private var fail: [Int] = [0]
  private var outputs: [[Int]] = [[]]
  private let lengths: [Int]
  private let collapsesSpaces: Bool

  init(terms rawTerms: [String]) {
    collapsesSpaces = rawTerms.contains { $0.utf16.contains(where: isWhitespaceUnit) }
    let terms = collapsesSpaces ? rawTerms.map(collapseSpaces) : rawTerms
    lengths = terms.map { ($0 as NSString).length }
    for (index, term) in terms.enumerated() {
      var node = 0
      for unit in term.utf16 {
        if let next = children[node][unit] {
          node = next
        } else {
          children.append([:])
          fail.append(0)
          outputs.append([])
          children[node][unit] = children.count - 1
          node = children.count - 1
        }
      }
      outputs[node].append(index)
    }
    var queue: [Int] = Array(children[0].values)
    var head = 0
    while head < queue.count {
      let node = queue[head]
      head += 1
      for (unit, child) in children[node] {
        var state = fail[node]
        while state != 0 && children[state][unit] == nil { state = fail[state] }
        let target = children[state][unit] ?? 0
        fail[child] = target == child ? 0 : target
        outputs[child].append(contentsOf: outputs[fail[child]])
        queue.append(child)
      }
    }
  }

  var isEmpty: Bool { lengths.isEmpty }

  func matches(in original: [unichar]) -> [(priority: Int, start: Int, end: Int)] {
    guard !lengths.isEmpty else { return [] }
    var units = original
    var offsets: [Int] = []
    if collapsesSpaces {
      units = []
      units.reserveCapacity(original.count)
      offsets.reserveCapacity(original.count)
      var pendingSpace = false
      for (index, unit) in original.enumerated() {
        if isWhitespaceUnit(unit) {
          pendingSpace = !units.isEmpty
          continue
        }
        if pendingSpace {
          units.append(0x20)
          offsets.append(index - 1)
          pendingSpace = false
        }
        units.append(unit)
        offsets.append(index)
      }
    }
    var found: [(priority: Int, start: Int, end: Int)] = []
    var state = 0
    for (position, unit) in units.enumerated() {
      while state != 0 && children[state][unit] == nil { state = fail[state] }
      state = children[state][unit] ?? 0
      for priority in outputs[state] {
        let start = position + 1 - lengths[priority]
        if collapsesSpaces {
          found.append((priority, offsets[start], offsets[position] + 1))
        } else {
          found.append((priority, start, position + 1))
        }
      }
    }
    return found.sorted { ($0.priority, $0.start, $0.end) < ($1.priority, $1.start, $1.end) }
  }
}

// A term made of letters must not continue a longer word on either side;
// CJK ideographs may match inside a run.
private func hasTokenBoundary(_ units: [unichar], start: Int, end: Int) -> Bool {
  guard start < end else { return false }
  let first = units[start]
  let last = units[end - 1]
  var before = start - 1
  while before >= 0 && units[before] == wordJoiner { before -= 1 }
  var after = end
  while after < units.count && units[after] == wordJoiner { after += 1 }
  if isReaderTokenChar(first) && !isCjkIdeograph(first) && before >= 0 && isReaderTokenChar(units[before]) {
    return false
  }
  if isReaderTokenChar(last) && !isCjkIdeograph(last) && after < units.count && isReaderTokenChar(units[after]) {
    return false
  }
  return true
}

private let contextBoundaries: Set<unichar> = Set(".!?。！？\n".utf16)

// The saved word's sentence for onPageChange, scanned within the page slice.
private func contextSentence(_ units: [unichar], start: Int, end: Int) -> String {
  var from = start
  var to = end
  while from > 0 && !contextBoundaries.contains(units[from - 1]) { from -= 1 }
  while to < units.count && !contextBoundaries.contains(units[to]) { to += 1 }
  if to < units.count && units[to] != 0x0A { to += 1 }
  let sentence = String(utf16CodeUnits: Array(units[from..<to]), count: to - from).trimmingCharacters(in: .whitespacesAndNewlines)
  if !sentence.isEmpty { return sentence }
  return String(utf16CodeUnits: units, count: units.count).trimmingCharacters(in: .whitespacesAndNewlines)
}

func buildHighlights(for page: ReaderPage, terms: ReaderHighlightTerms?) -> ReaderPageHighlights {
  var result = ReaderPageHighlights()
  var seenContexts = Set<String>()
  var savedTerms: [String] = []
  var levelTerms: [String] = []
  var exposureTerms: [String] = []

  for item in page.items where item.layout.imageFrame == nil && !item.lineRange.isEmpty {
    let lines = item.layout.lines
    let sliceStart = lines[item.lineRange.lowerBound].range.location
    let sliceEnd = NSMaxRange(lines[item.lineRange.upperBound - 1].range)
    let slice = NSRange(location: sliceStart, length: sliceEnd - sliceStart)
    result.chars += slice.length
    guard let terms, !terms.isEmpty else { continue }

    var units = [unichar](repeating: 0, count: slice.length)
    item.layout.text.getCharacters(&units, range: slice)
    let blockId = item.layout.block.id

    var occupied: [Range<Int>] = []
    for match in terms.savedMatcher.matches(in: units) {
      guard hasTokenBoundary(units, start: match.start, end: match.end),
            !occupied.contains(where: { $0.overlaps(match.start..<match.end) }) else { continue }
      occupied.append(match.start..<match.end)
      let term = terms.saved[match.priority]
      result.saved.append(ReaderHighlightRange(
        blockId: blockId,
        range: NSRange(location: sliceStart + match.start, length: match.end - match.start),
        term: term,
        strength: terms.strengths[term] ?? 1
      ))
      if !savedTerms.contains(term) { savedTerms.append(term) }
      let sentence = contextSentence(units, start: match.start, end: match.end)
      if seenContexts.insert("\(term)|\(sentence)|\(blockId)").inserted {
        result.savedContexts.append(["text": term, "sentence": sentence, "blockId": blockId])
      }
    }

    occupied = []
    for match in terms.levelMatcher.matches(in: units) {
      guard hasTokenBoundary(units, start: match.start, end: match.end),
            !occupied.contains(where: { $0.overlaps(match.start..<match.end) }) else { continue }
      occupied.append(match.start..<match.end)
      let info = terms.level[match.priority]
      let reported = collapseSpaces(info.text)
      if !info.annotationOnly && !levelTerms.contains(reported) { levelTerms.append(reported) }
      result.level.append(ReaderHighlightRange(
        blockId: blockId,
        range: NSRange(location: sliceStart + match.start, length: match.end - match.start),
        term: info.text,
        weight: info.weight,
        pinyin: info.pinyin,
        gloss: info.gloss,
        reinforced: info.reinforced,
        annotationOnly: info.annotationOnly,
        isPhrase: isPhraseTerm(info.text)
      ))
    }

    // Words reported as seen but never drawn; one inside a marked phrase is
    // part of the phrase, not seen on its own.
    let phraseSpans = result.level.filter { $0.isPhrase && $0.blockId == blockId }
      .map { ($0.range.location - sliceStart)..<(NSMaxRange($0.range) - sliceStart) }
    occupied = []
    for match in terms.exposureMatcher.matches(in: units) {
      guard hasTokenBoundary(units, start: match.start, end: match.end),
            !occupied.contains(where: { $0.overlaps(match.start..<match.end) }),
            !phraseSpans.contains(where: { $0.lowerBound <= match.start && match.end <= $0.upperBound && $0 != match.start..<match.end })
      else { continue }
      occupied.append(match.start..<match.end)
      let term = collapseSpaces(terms.exposure[match.priority])
      if !exposureTerms.contains(term) { exposureTerms.append(term) }
      result.exposureHits.append((blockId, NSRange(location: sliceStart + match.start, length: match.end - match.start), term))
    }
  }
  result.savedTerms = savedTerms
  result.levelTerms = levelTerms
  result.exposureTerms = exposureTerms
  return result
}

// MARK: - Drawing helpers

private let reinforcedTint = UIColor(red: 0x5b / 255, green: 0x6b / 255, blue: 0x8c / 255, alpha: 1)

func lerpColor(_ from: UIColor, _ to: UIColor, _ t: CGFloat) -> UIColor {
  var (r1, g1, b1, a1): (CGFloat, CGFloat, CGFloat, CGFloat) = (0, 0, 0, 0)
  var (r2, g2, b2, a2): (CGFloat, CGFloat, CGFloat, CGFloat) = (0, 0, 0, 0)
  from.getRed(&r1, green: &g1, blue: &b1, alpha: &a1)
  to.getRed(&r2, green: &g2, blue: &b2, alpha: &a2)
  let amount = min(max(t, 0), 1)
  return UIColor(red: r1 + (r2 - r1) * amount, green: g1 + (g2 - g1) * amount, blue: b1 + (b2 - b1) * amount, alpha: 1)
}

// Green -> amber -> red by weight; a hard-but-frequent ("reinforced") word is
// pulled toward a calm slate.
func levelUnderlineColor(weight: CGFloat, reinforced: Bool, palette: ReaderPalette) -> UIColor {
  let w = min(max(weight, 0), 1)
  let base = w <= 0.5
    ? lerpColor(palette.levelUnderlineEasy, palette.levelUnderlineMid, w / 0.5)
    : lerpColor(palette.levelUnderlineMid, palette.levelUnderlineHard, (w - 0.5) / 0.5)
  return reinforced ? lerpColor(base, reinforcedTint, 0.6) : base
}

// Fixed pseudo-random order in which pixel-mark cells leave.
func pixelHash(_ ix: Int, _ iy: Int) -> CGFloat {
  CGFloat(((ix &* 73856093) ^ (iy &* 19349663)) & 0xffff) / 65535
}

private let asidePattern = try! NSRegularExpression(pattern: "\\([^)]*\\)|（[^）]*）|\\[[^\\]]*]")

// Up to three senses to rotate through: a compound ("a · b") keeps one label
// made of each part's first sense; otherwise senses split on ; , 、 with
// asides removed, deduplicated.
func commonSenses(_ gloss: String) -> [String] {
  if gloss.contains(" · ") {
    let label = gloss.components(separatedBy: " · ").map(firstSense).filter { !$0.isEmpty }.joined(separator: " · ")
    return label.isEmpty ? [] : [label]
  }
  let range = NSRange(location: 0, length: (gloss as NSString).length)
  let stripped = asidePattern.stringByReplacingMatches(in: gloss, range: range, withTemplate: " ")
  var senses: [String] = []
  for sense in stripped.components(separatedBy: CharacterSet(charactersIn: ";；,，、")) {
    let cleaned = collapseSpaces(sense)
    if !cleaned.isEmpty && !senses.contains(cleaned) { senses.append(cleaned) }
    if senses.count == 3 { break }
  }
  return senses
}

// A gloss's first sense without dictionary asides: "(located) at; (to be) in" -> "at".
func firstSense(_ gloss: String) -> String {
  let range = NSRange(location: 0, length: (gloss as NSString).length)
  let stripped = asidePattern.stringByReplacingMatches(in: gloss, range: range, withTemplate: " ")
  for sense in stripped.components(separatedBy: CharacterSet(charactersIn: ";；,，")) {
    let cleaned = sense.components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }.joined(separator: " ")
    if !cleaned.isEmpty { return cleaned }
  }
  return ""
}

// Graded words (drawn level words and exposure-only words) fully inside a
// span of one block, whitespace-collapsed and deduplicated, for exposure.
func gradedTerms(in highlights: ReaderPageHighlights, blockId: String, within span: NSRange? = nil) -> [String] {
  var terms: [String] = []
  let inside: (NSRange) -> Bool = { range in
    guard let span else { return true }
    return range.location >= span.location && NSMaxRange(range) <= NSMaxRange(span)
  }
  for range in highlights.level where range.blockId == blockId && !range.annotationOnly && inside(range.range) {
    let term = collapseSpaces(range.term)
    if !terms.contains(term) { terms.append(term) }
  }
  for hit in highlights.exposureHits where hit.blockId == blockId && inside(hit.range) {
    if !terms.contains(hit.term) { terms.append(hit.term) }
  }
  return terms
}

func savedTerms(in highlights: ReaderPageHighlights, blockId: String, within span: NSRange? = nil) -> [String] {
  var terms: [String] = []
  for range in highlights.saved where range.blockId == blockId {
    if let span, !(range.range.location >= span.location && NSMaxRange(range.range) <= NSMaxRange(span)) { continue }
    if !terms.contains(range.term) { terms.append(range.term) }
  }
  return terms
}
