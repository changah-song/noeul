import Foundation

// Parsed `chapterWindow` / `chapterBlocks` data. Field names follow the JS
// block shape built by services/epubMetadata.js.

struct ReaderSpan {
  let text: String
  let marks: [String]
  let style: [String: Any]
}

struct ReaderBlock {
  let id: String
  let tag: String
  let isImage: Bool
  // Plain text: the spans joined, or `text` when there are no spans. All
  // offsets sent to JS are UTF-16 indices into this string.
  let text: String
  let spans: [ReaderSpan]
  let style: [String: Any]
  let fileUri: String?

  var isHeading: Bool {
    tag.count == 2 && tag.hasPrefix("h") && tag.last?.isNumber == true
  }

  static func parse(_ raw: [String: Any]) -> ReaderBlock? {
    let type = (raw["type"] as? String) ?? ""
    let tag = ((raw["tag"] as? String) ?? (type == "image" ? "img" : "p")).lowercased()
    let style = (raw["styleTokens"] as? [String: Any]) ?? [:]
    let spans: [ReaderSpan] = ((raw["spans"] as? [Any]) ?? []).compactMap { item in
      guard let span = item as? [String: Any] else { return nil }
      return ReaderSpan(
        text: (span["text"] as? String) ?? "",
        marks: ((span["marks"] as? [Any]) ?? []).compactMap { ($0 as? String)?.lowercased() },
        style: (span["styleTokens"] as? [String: Any]) ?? [:]
      )
    }
    let rawText = (raw["text"] as? String) ?? ""
    let text = spans.isEmpty ? rawText : spans.map(\.text).joined()
    let isImage = type == "image"
    if !isImage && text.isEmpty && rawText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      return nil
    }
    let id = (raw["id"] as? String).flatMap { $0.isEmpty ? nil : $0 }
      ?? "block-\(stableHash(tag + text))"
    let fileUri = (raw["fileUri"] as? String)
      ?? ((raw["resource"] as? [String: Any])?["fileUri"] as? String)
    return ReaderBlock(
      id: id, tag: tag, isImage: isImage, text: text, spans: spans, style: style, fileUri: fileUri
    )
  }
}

struct ReaderChapter {
  let role: String
  let spineIndex: Int
  let href: String
  let path: String
  let title: String
  let blocks: [ReaderBlock]
  let signature: String

  static func parse(_ raw: [String: Any]) -> ReaderChapter? {
    guard let spine = intValue(raw["spineIndex"]) else { return nil }
    let blocks = ((raw["blocks"] as? [Any]) ?? []).compactMap { ($0 as? [String: Any]).flatMap(ReaderBlock.parse) }
    guard !blocks.isEmpty else { return nil }
    let role = (raw["role"] as? String) ?? "adjacent"
    let href = (raw["href"] as? String) ?? ""
    let path = (raw["path"] as? String) ?? ""
    let title = (raw["title"] as? String) ?? (raw["label"] as? String) ?? ""
    let textLength = blocks.reduce(0) { $0 + ($1.text as NSString).length }
    let blockSig = "\(blocks.count):\(blocks.first?.id ?? ""):\(blocks.last?.id ?? ""):\(textLength)"
    return ReaderChapter(
      role: role, spineIndex: spine, href: href, path: path, title: title, blocks: blocks,
      signature: "\(role):\(spine):\(href):\(path):\(title):\(blockSig)"
    )
  }
}

struct ReaderPosition {
  let spineIndex: Int
  let pageIndex: Int?
  let pagesInChapter: Int?
  let href: String
  let firstBlockId: String?
  let seekToken: String?
  // 0...1 through the chapter (the scrubber).
  let chapterFraction: Double?

  var signature: String {
    "\(spineIndex)|\(pageIndex ?? -1)|\(pagesInChapter ?? -1)|\(href)|\(firstBlockId ?? "")|\(seekToken ?? "")|\(chapterFraction ?? -1)"
  }

  static func parse(_ raw: [String: Any]) -> ReaderPosition? {
    guard let spine = intValue(raw["spineIndex"]) else { return nil }
    let blockId = (raw["firstBlockId"] as? String).flatMap { $0.isEmpty ? nil : $0 }
    let seek = (raw["seekToken"] as? String).flatMap { $0.trimmingCharacters(in: .whitespaces).isEmpty ? nil : $0 }
    return ReaderPosition(
      spineIndex: spine,
      pageIndex: intValue(raw["pageIndex"]),
      pagesInChapter: intValue(raw["pagesInChapter"]),
      href: (raw["href"] as? String) ?? "",
      firstBlockId: blockId,
      seekToken: seek,
      chapterFraction: doubleValue(raw["chapterFraction"]).map { min(max($0, 0), 1) }
    )
  }
}

// FNV-1a over UTF-16; String.hashValue is reseeded every launch, and block ids
// anchor saved positions.
func stableHash(_ string: String) -> String {
  var hash: UInt64 = 0xcbf29ce484222325
  for unit in string.utf16 {
    hash = (hash ^ UInt64(unit)) &* 0x100000001b3
  }
  return String(hash, radix: 36)
}

func intValue(_ value: Any?) -> Int? {
  switch value {
  case let number as NSNumber: return number.intValue
  case let string as String: return Int(string)
  default: return nil
  }
}

func doubleValue(_ value: Any?) -> Double? {
  switch value {
  case let number as NSNumber: return number.doubleValue
  case let string as String: return Double(string.trimmingCharacters(in: .whitespaces))
  default: return nil
  }
}

// A CSS-ish length token: a number (points), "12px", "0.75em", "1.2rem",
// "50%", or { value, unit }. Returns nil for %, auto and anything unparseable.
func lengthToken(_ value: Any?, em: CGFloat) -> CGFloat? {
  if let number = value as? NSNumber { return CGFloat(number.doubleValue) }
  if let map = value as? [String: Any] {
    guard let amount = doubleValue(map["value"]) else { return nil }
    return lengthWithUnit(CGFloat(amount), unit: ((map["unit"] as? String) ?? "").lowercased(), em: em)
  }
  guard let string = (value as? String)?.trimmingCharacters(in: .whitespaces).lowercased(), !string.isEmpty else {
    return nil
  }
  let digits = string.prefix { "0123456789.-+".contains($0) }
  guard let amount = Double(digits) else { return nil }
  return lengthWithUnit(CGFloat(amount), unit: String(string.dropFirst(digits.count)), em: em)
}

private func lengthWithUnit(_ amount: CGFloat, unit: String, em: CGFloat) -> CGFloat? {
  switch unit {
  case "", "px", "dp", "pt": return amount
  case "em", "rem": return amount * em
  default: return nil
  }
}

// Relative size token: "0.8em", "120%" or a bare multiplier.
func relativeScaleToken(_ value: Any?) -> CGFloat? {
  if let map = value as? [String: Any], let amount = doubleValue(map["value"]) {
    let unit = ((map["unit"] as? String) ?? "").lowercased()
    if unit == "%" { return CGFloat(amount) / 100 }
    if unit == "em" || unit == "rem" { return CGFloat(amount) }
    return nil
  }
  guard let string = (value as? String)?.trimmingCharacters(in: .whitespaces).lowercased() else { return nil }
  if string.hasSuffix("%"), let amount = Double(string.dropLast()) { return CGFloat(amount) / 100 }
  if string.hasSuffix("rem"), let amount = Double(string.dropLast(3)) { return CGFloat(amount) }
  if string.hasSuffix("em"), let amount = Double(string.dropLast(2)) { return CGFloat(amount) }
  return nil
}
