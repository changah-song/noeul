import UIKit

// Reader colors. Keys match the Android palette and the `themeTokens` prop;
// a token overrides the built-in color for the current theme.
struct ReaderPalette {
  var background: UIColor
  var bodyText: UIColor
  var subtleText: UIColor
  var mutedText: UIColor
  var rule: UIColor
  var activeHighlight: UIColor
  var textSelectionHighlight: UIColor
  var savedHighlight: UIColor
  var savedHighlightText: UIColor
  var levelUnderlineEasy: UIColor
  var levelUnderlineMid: UIColor
  var levelUnderlineHard: UIColor
  var selectionHandle: UIColor
  var placeholder: UIColor
  var isDark: Bool

  static func make(theme: String, tokens: [String: Any]) -> ReaderPalette {
    let dark = theme.lowercased() == "dark"
    func pick(_ key: String, _ light: String, _ darkHex: String) -> UIColor {
      if let raw = tokens[key] as? String, let color = parseAndroidColor(raw) {
        return color
      }
      return parseAndroidColor(dark ? darkHex : light) ?? .black
    }
    return ReaderPalette(
      background: pick("background", "#fbf9f8", "#11151c"),
      bodyText: pick("bodyText", "#1b1c1c", "#f0eded"),
      subtleText: pick("subtleText", "#9a9c9f", "#5c5e63"),
      mutedText: pick("mutedText", "#75777b", "#9a9c9f"),
      rule: pick("rule", "#c5c6cb", "#353c47"),
      activeHighlight: pick("activeHighlight", "#e3cfb4", "#5c4630"),
      textSelectionHighlight: parseAndroidColor(dark ? "#52f0eded" : "#30202631")!,
      savedHighlight: pick("savedHighlight", "#202631", "#f0eded"),
      savedHighlightText: pick("savedHighlightText", "#ffffff", "#1b1c1c"),
      levelUnderlineEasy: pick("levelUnderlineEasy", "#2f8f46", "#74c476"),
      levelUnderlineMid: pick("levelUnderlineMid", "#c4661f", "#f59e0b"),
      levelUnderlineHard: pick("levelUnderlineHard", "#b32d2d", "#e5686a"),
      selectionHandle: pick("selectionHandle", "#202631", "#f0eded"),
      placeholder: pick("placeholder", "#b4aea6", "#44474b"),
      isDark: dark
    )
  }
}

private let namedColors: [String: UInt32] = [
  "black": 0xFF000000, "white": 0xFFFFFFFF, "red": 0xFFFF0000, "green": 0xFF00FF00,
  "blue": 0xFF0000FF, "gray": 0xFF888888, "grey": 0xFF888888, "yellow": 0xFFFFFF00,
  "cyan": 0xFF00FFFF, "magenta": 0xFFFF00FF, "transparent": 0x00000000,
]

// Same rules as Android's Color.parseColor: #RRGGBB or #AARRGGBB (alpha first,
// not CSS #RRGGBBAA), or a handful of names.
func parseAndroidColor(_ raw: String) -> UIColor? {
  let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
  var argb: UInt32
  if value.hasPrefix("#") {
    let hex = String(value.dropFirst())
    guard let parsed = UInt32(hex, radix: 16) else { return nil }
    switch hex.count {
    case 6: argb = 0xFF000000 | parsed
    case 8: argb = parsed
    default: return nil
    }
  } else if let named = namedColors[value.lowercased()] {
    argb = named
  } else {
    return nil
  }
  return UIColor(
    red: CGFloat((argb >> 16) & 0xFF) / 255,
    green: CGFloat((argb >> 8) & 0xFF) / 255,
    blue: CGFloat(argb & 0xFF) / 255,
    alpha: CGFloat((argb >> 24) & 0xFF) / 255
  )
}
