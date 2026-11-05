import PDFKit
import UIKit

// PDF import on iOS with PDFKit: the same results as the Android
// PdfDocumentExtractor (pdfbox + PdfRenderer), which services/pdfMetadata.js
// turns into chapters. Line coordinates are in PDF points from the page's
// top-left, like pdfbox's direction-adjusted positions.

struct PdfImportError: Error {}

enum ReaderPdf {
  static func extract(_ options: [String: Any]) throws -> [String: Any] {
    guard let sourceUri = options["sourceUri"] as? String else { throw PdfImportError() }
    let fallbackName = (options["fallbackName"] as? String) ?? "Untitled"
    let document = try open(sourceUri)

    var pages: [[String: Any]] = []
    for index in 0..<document.pageCount {
      guard let page = document.page(at: index) else { continue }
      let box = page.bounds(for: .mediaBox)
      let lines = textLines(of: page, box: box)
      let text = (page.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
      pages.append([
        "index": index,
        "label": "Page \(index + 1)",
        "text": text.isEmpty ? lines.compactMap { $0["text"] as? String }.joined(separator: "\n") : text,
        "lines": lines,
        "width": Double(box.width),
        "height": Double(box.height),
        "rotation": page.rotation,
      ])
    }

    let attributes = document.documentAttributes ?? [:]
    let title = (attributes[PDFDocumentAttribute.titleAttribute] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
    let author = (attributes[PDFDocumentAttribute.authorAttribute] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
    return [
      "sourceUri": sourceUri,
      "fallbackName": fallbackName,
      "title": (title?.isEmpty == false ? title : nil) ?? fallbackName,
      "author": (author?.isEmpty == false ? author : nil) ?? "Unknown author",
      "pageCount": document.pageCount,
      "pages": pages,
      "outline": outline(of: document),
    ]
  }

  // The chosen page rendered on white at `maxWidth` pixels wide, as a PNG.
  static func renderCover(_ options: [String: Any]) throws -> [String: Any] {
    guard let sourceUri = options["sourceUri"] as? String,
          let outputRootUri = options["outputRootUri"] as? String else { throw PdfImportError() }
    let pageNumber = intValue(options["pageNumber"]) ?? 1
    let maxWidth = min(max(intValue(options["maxWidth"]) ?? 900, 240), 1600)
    let document = try open(sourceUri)
    guard document.pageCount > 0, pageNumber >= 1, pageNumber <= document.pageCount,
          let page = document.page(at: pageNumber - 1) else { throw PdfImportError() }

    let box = page.bounds(for: .mediaBox)
    let rotated = page.rotation % 180 != 0
    let pageSize = rotated ? CGSize(width: box.height, height: box.width) : box.size
    let scale = CGFloat(maxWidth) / max(pageSize.width, 1)
    let size = CGSize(width: CGFloat(maxWidth), height: max(1, (pageSize.height * scale).rounded()))
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    let image = UIGraphicsImageRenderer(size: size, format: format).image { context in
      UIColor.white.setFill()
      context.fill(CGRect(origin: .zero, size: size))
      let cg = context.cgContext
      // PDF space is bottom-up; flip, then scale the page into the image.
      cg.translateBy(x: 0, y: size.height)
      cg.scaleBy(x: scale, y: -scale)
      page.draw(with: .mediaBox, to: cg)
    }

    let root = try directory(outputRootUri)
    let file = root.appendingPathComponent("cover-page-\(pageNumber).png")
    guard let data = image.pngData() else { throw PdfImportError() }
    try data.write(to: file)
    return [
      "coverUri": file.absoluteString,
      "pageNumber": pageNumber,
      "pageCount": document.pageCount,
      "width": Int(size.width),
      "height": Int(size.height),
    ]
  }

  private static func fileURL(_ uri: String) -> URL {
    if let url = URL(string: uri), url.isFileURL { return url }
    return URL(fileURLWithPath: uri.hasPrefix("file://") ? String(uri.dropFirst(7)) : uri)
  }

  private static func directory(_ uri: String) throws -> URL {
    let url = fileURL(uri)
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
  }

  // Opens the file; a PDF locked only by an owner password (no open
  // password) opens with an empty one, as pdfbox removes its security.
  private static func open(_ uri: String) throws -> PDFDocument {
    guard let document = PDFDocument(url: fileURL(uri)) else { throw PdfImportError() }
    if document.isLocked && !document.unlock(withPassword: "") { throw PdfImportError() }
    return document
  }

  // One entry per text line: its text, box and dominant font.
  private static func textLines(of page: PDFPage, box: CGRect) -> [[String: Any]] {
    guard let selection = page.selection(for: box) else { return [] }
    var lines: [[String: Any]] = []
    for line in selection.selectionsByLine() {
      guard let attributed = line.attributedString else { continue }
      let text = attributed.string
        .replacingOccurrences(of: "[\\t\\r\\n]+", with: " ", options: .regularExpression)
        .replacingOccurrences(of: " {2,}", with: " ", options: .regularExpression)
        .trimmingCharacters(in: .whitespaces)
      guard !text.isEmpty else { continue }
      let bounds = line.bounds(for: page)
      guard bounds.width > 0 || bounds.height > 0 else { continue }

      var sizeTotal: CGFloat = 0
      var sizeCount: CGFloat = 0
      var fontNames: [String: Int] = [:]
      attributed.enumerateAttribute(.font, in: NSRange(location: 0, length: attributed.length)) { value, range, _ in
        guard let font = value as? UIFont else { return }
        sizeTotal += font.pointSize * CGFloat(range.length)
        sizeCount += CGFloat(range.length)
        fontNames[font.fontName, default: 0] += range.length
      }
      let fontName = fontNames.max { $0.value < $1.value }?.key ?? ""
      let lowered = fontName.lowercased()
      var entry: [String: Any] = [
        "text": text,
        "x": Double(bounds.minX - box.minX),
        // Distance from the page top to the line's baseline (pdfbox's y).
        "y": Double(box.maxY - bounds.maxY + bounds.height * 0.8),
        "width": Double(bounds.width),
        "height": Double(bounds.height),
        "fontName": fontName,
        "bold": lowered.contains("bold"),
        "italic": lowered.contains("italic") || lowered.contains("oblique"),
      ]
      if sizeCount > 0 { entry["fontSize"] = Double(sizeTotal / sizeCount) }
      lines.append(entry)
    }
    return lines
  }

  private static func outline(of document: PDFDocument) -> [[String: Any]] {
    guard let root = document.outlineRoot else { return [] }
    var items: [[String: Any]] = []
    func visit(_ node: PDFOutline, depth: Int) {
      for index in 0..<node.numberOfChildren {
        guard let child = node.child(at: index) else { continue }
        let title = (child.label ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if !title.isEmpty, let page = child.destination?.page {
          let pageIndex = document.index(for: page)
          if pageIndex != NSNotFound {
            items.append(["title": title, "pageIndex": pageIndex, "depth": depth])
          }
        }
        visit(child, depth: depth + 1)
      }
    }
    visit(root, depth: 0)
    return items
  }
}
