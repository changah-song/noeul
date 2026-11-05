import Foundation

// Interface text the native reader draws itself (the chapter pull ring, and
// later the listen controls). JS pushes the strings for the app language
// through the `interfaceStrings` prop or setInterfaceStrings(); English is
// the fallback.
enum ReaderStrings {
  private static let english: [String: String] = [
    "pullNext": "Pull up for the next chapter",
    "releaseNext": "Let go for the next chapter",
    "pullPrevious": "Pull down for the previous chapter",
    "releasePrevious": "Let go for the previous chapter",
    "chapterNumber": "Chapter {{number}}",
    "pdfImportFailed": "This PDF couldn't be opened. It may be damaged or password-protected.",
  ]

  private static var language = ""
  private static var pushed: [String: String] = [:]

  // Returns whether anything changed.
  @discardableResult
  static func set(language newLanguage: String, strings raw: [String: Any]) -> Bool {
    var next: [String: String] = [:]
    for (key, value) in raw where key != "language" {
      if let text = value as? String { next[key] = text }
    }
    guard newLanguage != language || next != pushed else { return false }
    language = newLanguage
    pushed = next
    return true
  }

  static func t(_ key: String) -> String {
    pushed[key] ?? english[key] ?? key
  }
}
