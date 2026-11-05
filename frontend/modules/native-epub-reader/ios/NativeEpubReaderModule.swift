import ExpoModulesCore

// iOS side of the NativeEpubReader module. Same name, props and events as the
// Android module; functions that aren't implemented yet are left undefined so
// the JS wrapper's feature checks fall back.
public class NativeEpubReaderModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NativeEpubReader")

    Events("onListenControl")

    OnCreate { [weak self] in
      ReaderListenSession.shared.onControl = { action in
        self?.sendEvent("onListenControl", ["action": action])
      }
    }

    OnDestroy {
      ReaderListenSession.shared.onControl = nil
    }

    // Start or update the lock-screen player (title, subtitle, playing, cover).
    // `cover: ""` clears the art; a missing key leaves it as it is.
    Function("updateListenSession") { (options: [String: Any]) in
      DispatchQueue.main.async {
        ReaderListenSession.shared.update(
          title: options["title"] as? String,
          subtitle: options["subtitle"] as? String,
          playing: options["playing"] as? Bool,
          cover: options["cover"] as? String
        )
      }
    }

    Function("stopListenSession") {
      DispatchQueue.main.async { ReaderListenSession.shared.stop() }
    }

    // PDF import (PDFKit), off the main thread. Failures reject with
    // ERR_PDF_IMPORT and the localized message alone, as on Android: a thrown
    // exception would reach JS prefixed with "Calling the ... function has
    // failed", and the import dialog then shows its generic text.
    AsyncFunction("extractPdfDocument") { (options: [String: Any], promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          promise.resolve(try ReaderPdf.extract(options))
        } catch {
          promise.reject("ERR_PDF_IMPORT", ReaderStrings.t("pdfImportFailed"))
        }
      }
    }

    AsyncFunction("renderPdfCover") { (options: [String: Any], promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          promise.resolve(try ReaderPdf.renderCover(options))
        } catch {
          promise.reject("ERR_PDF_IMPORT", ReaderStrings.t("pdfImportFailed"))
        }
      }
    }

    AsyncFunction("seekToPosition") { (viewTag: Int, position: [String: Any]) in
      self.appContext?.findView(withTag: viewTag, ofType: NativeEpubReaderView.self)?.seek(to: position)
    }.runOnQueue(.main)

    AsyncFunction("setSpokenWord") { (viewTag: Int, word: [String: Any]) in
      self.appContext?.findView(withTag: viewTag, ofType: NativeEpubReaderView.self)?.setSpokenWord(word)
    }.runOnQueue(.main)

    AsyncFunction("focusNav") { (viewTag: Int, direction: String) -> [String: Any] in
      self.appContext?.findView(withTag: viewTag, ofType: NativeEpubReaderView.self)?.focusNav(direction) ?? ["moved": false]
    }.runOnQueue(.main)

    AsyncFunction("setSpokenRange") { (viewTag: Int, range: [String: Any]) in
      self.appContext?.findView(withTag: viewTag, ofType: NativeEpubReaderView.self)?.setSpokenRange(range)
    }.runOnQueue(.main)

    Function("setInterfaceStrings") { (language: String, strings: [String: Any]) -> Bool in
      ReaderStrings.set(language: language, strings: strings)
    }

    // A timer for listen mode's pauses that keeps running with the screen off.
    AsyncFunction("listenDelay") { (ms: Double, promise: Promise) in
      DispatchQueue.main.asyncAfter(deadline: .now() + min(max(ms, 0), 600_000) / 1000) {
        promise.resolve(nil)
      }
    }

    AsyncFunction("extendSelection") { (viewTag: Int, direction: String) -> Bool in
      self.appContext?.findView(withTag: viewTag, ofType: NativeEpubReaderView.self)?.extendSelection(direction) ?? false
    }.runOnQueue(.main)

    View(NativeEpubReaderView.self) {
      Events(
        "onPageChange",
        "onChapterEnd",
        "onChapterStart",
        "onChapterCommit",
        "onWordSelected",
        "onTextSelected",
        "onSelectionCleared",
        "onFocusSentenceChange",
        "onExposure",
        "onSavedTermsShown",
        "onReadingDirection",
        "onHighlightNotePress"
      )

      Prop("bookManifest") { (view: NativeEpubReaderView, value: [String: Any]?) in
        view.bookManifest = value ?? [:]
      }
      Prop("chapterBlocks") { (view: NativeEpubReaderView, value: [[String: Any]]?) in
        view.chapterBlocks = value ?? []
      }
      Prop("chapterWindow") { (view: NativeEpubReaderView, value: [[String: Any]]?) in
        view.chapterWindow = value ?? []
      }
      Prop("restorePosition") { (view: NativeEpubReaderView, value: [String: Any]?) in
        view.restorePosition = value ?? [:]
      }
      Prop("fontSize") { (view: NativeEpubReaderView, value: Double?) in
        view.fontSize = value ?? 18
      }
      Prop("lineHeight") { (view: NativeEpubReaderView, value: Double?) in
        view.lineHeight = value ?? 1.5
      }
      Prop("theme") { (view: NativeEpubReaderView, value: String?) in
        view.theme = value ?? "light"
      }
      Prop("themeTokens") { (view: NativeEpubReaderView, value: [String: Any]?) in
        view.themeTokens = value ?? [:]
      }
      Prop("keepScreenOn") { (view: NativeEpubReaderView, value: Bool?) in
        view.keepScreenOn = value ?? false
      }
      Prop("clearSelectionToken") { (view: NativeEpubReaderView, value: Double?) in
        view.clearSelectionToken = value ?? 0
      }

      Prop("highlightTerms") { (view: NativeEpubReaderView, value: [Any]?) in
        view.highlightTerms = value ?? []
      }
      Prop("highlightStrengths") { (view: NativeEpubReaderView, value: [String: Any]?) in
        view.highlightStrengths = value ?? [:]
      }
      Prop("levelTerms") { (view: NativeEpubReaderView, value: [Any]?) in
        view.levelTerms = value ?? []
      }
      Prop("showPinyin") { (view: NativeEpubReaderView, value: Bool?) in
        view.showPinyin = value ?? false
      }
      Prop("showGloss") { (view: NativeEpubReaderView, value: Bool?) in
        view.showGloss = value ?? false
      }
      Prop("tappedTerms") { (view: NativeEpubReaderView, value: [Any]?) in
        view.tappedTerms = value ?? []
      }

      Prop("renderMode") { (view: NativeEpubReaderView, value: String?) in
        view.renderMode = value ?? "paged"
      }
      Prop("chapterTransitionDirection") { (view: NativeEpubReaderView, value: String?) in
        view.chapterTransitionDirection = value ?? "none"
      }
      Prop("exposureTerms") { (view: NativeEpubReaderView, value: [Any]?) in
        view.exposureTerms = value ?? []
      }
      Prop("reduceMotion") { (view: NativeEpubReaderView, value: Bool?) in
        view.reduceMotion = value ?? false
      }
      Prop("showContextSentence") { (view: NativeEpubReaderView, value: Bool?) in
        view.showContextSentence = value ?? false
      }
      Prop("chromeInsets") { (view: NativeEpubReaderView, value: [String: Any]?) in
        view.chromeInsets = value ?? [:]
      }
      Prop("fullscreen") { (view: NativeEpubReaderView, value: Bool?) in
        view.fullscreen = value ?? false
      }
      Prop("pagedFocus") { (view: NativeEpubReaderView, value: Bool?) in
        view.pagedFocus = value ?? false
      }
      Prop("interfaceStrings") { (view: NativeEpubReaderView, value: [String: Any]?) in
        view.interfaceStrings = value ?? [:]
      }
      Prop("focusSentenceCount") { (view: NativeEpubReaderView, value: Int?) in
        view.focusSentenceCount = value ?? 1
      }
      Prop("focusSwipeEnabled") { (view: NativeEpubReaderView, value: Bool?) in
        view.focusSwipeEnabled = value ?? false
      }
      Prop("focusNavToken") { (view: NativeEpubReaderView, value: String?) in
        view.focusNavToken = value ?? "none:0"
      }
      Prop("focusPanelHeight") { (view: NativeEpubReaderView, value: Double?) in
        view.focusPanelHeight = value ?? 0
      }
      Prop("focusTapsInSpanOnly") { (view: NativeEpubReaderView, value: Bool?) in
        view.focusTapsInSpanOnly = value ?? false
      }

      OnViewDidUpdateProps { (view: NativeEpubReaderView) in
        view.propsDidUpdate()
      }
    }
  }
}
