import Foundation

// Word and sentence boundaries, matching the Android reader. All ranges are
// UTF-16 offsets; Korean text carries U+2060 joiners between syllables (added
// in JS), which are part of a word and never a boundary.

let wordJoiner: unichar = 0x2060

func isHangul(_ c: unichar) -> Bool {
  (0xAC00...0xD7A3).contains(c) || (0x1100...0x11FF).contains(c) || (0x3130...0x318F).contains(c)
}

func isCjkIdeograph(_ c: unichar) -> Bool {
  (0x4E00...0x9FFF).contains(c) || (0x3400...0x4DBF).contains(c) || (0xF900...0xFAFF).contains(c)
}

func isLatinLetter(_ c: unichar) -> Bool {
  if (0x41...0x5A).contains(c) || (0x61...0x7A).contains(c) { return true }
  // Latin-1 Supplement and Latin Extended-A/B letters (café, naïve), not × or ÷.
  return (0xC0...0x24F).contains(c) && c != 0xD7 && c != 0xF7
}

// Characters that can be part of a tappable word.
func isReaderTokenChar(_ c: unichar) -> Bool {
  if isHangul(c) || isCjkIdeograph(c) || isLatinLetter(c) { return true }
  guard let scalar = Unicode.Scalar(c) else { return false }
  return scalar.properties.numericType == .decimal
}

private let inWordJoiners: Set<unichar> = [0x27, 0x2019, 0x2D]

// An apostrophe or hyphen between two Latin letters keeps the word whole
// (don't, well-known).
func isInWordPunctuation(_ text: NSString, at index: Int) -> Bool {
  guard index > 0, index + 1 < text.length, inWordJoiners.contains(text.character(at: index)) else { return false }
  return isLatinLetter(text.character(at: index - 1)) && isLatinLetter(text.character(at: index + 1))
}

// The word containing `offset`, or nil when the tap is not on a word.
func tokenRange(in text: NSString, at offset: Int) -> NSRange? {
  let length = text.length
  guard length > 0 else { return nil }
  var probe = min(max(offset, 0), length - 1)
  while probe > 0 && text.character(at: probe) == wordJoiner { probe -= 1 }
  if !isReaderTokenChar(text.character(at: probe)) && !isInWordPunctuation(text, at: probe) {
    if probe > 0 && isReaderTokenChar(text.character(at: probe - 1)) {
      probe -= 1
    } else if probe + 1 < length && isReaderTokenChar(text.character(at: probe + 1)) {
      probe += 1
    } else {
      return nil
    }
  }

  if isCjkIdeograph(text.character(at: probe)) {
    return chineseWordRange(in: text, at: probe)
  }

  func isPart(_ i: Int) -> Bool {
    let c = text.character(at: i)
    return c == wordJoiner || (isReaderTokenChar(c) && !isCjkIdeograph(c)) || isInWordPunctuation(text, at: i)
  }
  var start = probe
  var end = probe + 1
  while start > 0 && isPart(start - 1) { start -= 1 }
  while end < length && isPart(end) { end += 1 }
  while start < end && text.character(at: start) == wordJoiner { start += 1 }
  while end > start && text.character(at: end - 1) == wordJoiner { end -= 1 }
  return end > start ? NSRange(location: start, length: end - start) : nil
}

// Segment the run of ideographs around `probe` into words.
private func chineseWordRange(in text: NSString, at probe: Int) -> NSRange {
  var start = probe
  var end = probe + 1
  while start > 0 && isCjkIdeograph(text.character(at: start - 1)) { start -= 1 }
  while end < text.length && isCjkIdeograph(text.character(at: end)) { end += 1 }
  let run = NSRange(location: start, length: end - start)
  let tokenizer = CFStringTokenizerCreate(
    nil, text as CFString, CFRange(location: run.location, length: run.length),
    kCFStringTokenizerUnitWord, Locale(identifier: "zh") as CFLocale
  )
  var type = CFStringTokenizerGoToTokenAtIndex(tokenizer, probe)
  if type == [] { type = CFStringTokenizerAdvanceToNextToken(tokenizer) }
  let token = CFStringTokenizerGetCurrentTokenRange(tokenizer)
  if token.location != kCFNotFound && token.location <= probe && probe < token.location + token.length {
    return NSRange(location: token.location, length: token.length)
  }
  return NSRange(location: probe, length: 1)
}

private let sentenceTerminals: Set<unichar> = Set(".!?。！？".utf16)
private let sentenceClosers: Set<unichar> = Set(")]\"“”'‘’』」）】》〉".utf16)
private let quoteTrim = CharacterSet(charactersIn: "“”\"'‘’")

private func isDigit(_ c: unichar) -> Bool { (0x30...0x39).contains(c) }
private func isAsciiLetter(_ c: unichar) -> Bool { (0x41...0x5A).contains(c) || (0x61...0x7A).contains(c) }

private let abbreviations: Set<String> = [
  "mr", "mrs", "ms", "dr", "st", "sr", "jr", "prof", "rev", "hon", "capt", "col", "gen", "lt", "sgt", "mt", "vs",
  "e.g", "i.e", "cf", "fig", "no", "vol", "approx",
]

// A period inside a word (U.S.), after a known abbreviation, or after a single
// capital initial (J. K. Rowling). Same rules as services/sentenceSplit.js.
private func isAbbreviationPeriod(_ text: NSString, at index: Int) -> Bool {
  let length = text.length
  if index + 1 < length && isAsciiLetter(text.character(at: index + 1)) { return true }
  var next = index + 1
  while next < length && text.character(at: next) == 0x20 { next += 1 }
  if next > index + 1 && next < length && (0x61...0x7A).contains(text.character(at: next)) { return true }
  var start = index
  while start > 0 {
    let c = text.character(at: start - 1)
    guard isAsciiLetter(c) || c == 0x2E else { break }
    start -= 1
  }
  guard start < index else { return false }
  let word = text.substring(with: NSRange(location: start, length: index - start))
  if abbreviations.contains(word.lowercased()) { return true }
  return word.count == 1 && word == word.uppercased() && word != "I"
    && (start == 0 || text.character(at: start - 1) == 0x20)
}

// Sentence ranges in a block's text: split on newlines and . ! ? 。 ！ ？ (not a
// decimal point), taking trailing terminals and closing quotes/brackets along.
func splitSentences(_ text: NSString) -> [NSRange] {
  var ranges: [NSRange] = []
  let length = text.length
  var start = 0
  var i = 0
  func skipLeadingSpace() {
    while start < length {
      let c = text.character(at: start)
      if c == 0x20 || c == 0x09 { start += 1 } else { break }
    }
  }
  skipLeadingSpace()
  i = start
  while i < length {
    let c = text.character(at: i)
    if c == 0x0A {
      if i > start { ranges.append(NSRange(location: start, length: i - start)) }
      start = i + 1
      skipLeadingSpace()
      i = start
      continue
    }
    if sentenceTerminals.contains(c) {
      if c == 0x2E && i > 0 && i + 1 < length && isDigit(text.character(at: i - 1)) && isDigit(text.character(at: i + 1)) {
        i += 1
        continue
      }
      if c == 0x2E && isAbbreviationPeriod(text, at: i) {
        i += 1
        continue
      }
      var end = i + 1
      while end < length {
        let next = text.character(at: end)
        if sentenceTerminals.contains(next) || sentenceClosers.contains(next) { end += 1 } else { break }
      }
      ranges.append(NSRange(location: start, length: end - start))
      start = end
      skipLeadingSpace()
      i = start
      continue
    }
    i += 1
  }
  if start < length { ranges.append(NSRange(location: start, length: length - start)) }
  return ranges
}

// The cleaned-up sentence around a word, sent with onWordSelected.
func sentence(in text: NSString, sentences: [NSRange], containing offset: Int) -> String {
  var bounds = sentences.first { offset >= $0.location && offset < NSMaxRange($0) + 1 }
  if bounds == nil {
    var start = offset
    while start > 0 {
      let c = text.character(at: start - 1)
      if sentenceTerminals.contains(c) || c == 0x0A { break }
      start -= 1
    }
    var end = offset
    while end < text.length {
      let c = text.character(at: end)
      if c == 0x0A { break }
      end += 1
      if sentenceTerminals.contains(c) { break }
    }
    bounds = NSRange(location: start, length: end - start)
  }
  let raw = text.substring(with: bounds!)
  let collapsed = raw.components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }.joined(separator: " ")
  return collapsed.trimmingCharacters(in: quoteTrim).trimmingCharacters(in: .whitespaces)
}
