import ExpoModulesCore
import UIKit

// The reader view behind NativeEpubReaderView.js, ported from the Android
// module. Three render modes:
// - paged: every page of the chapter window (previous, current, next chapter)
//   side by side in one horizontal pager;
// - continuous (scroll): one chapter at a time as one tall page, with a pull
//   at either end to change chapter;
// - focus: the continuous layout with a sentence "beam"; the rest is dimmed.
// Listening works in all three (pagedFocus lights the sentence on the page).
// Not ported yet: user highlights and note icons (JS doesn't use them).

private final class ReaderPageCell: UICollectionViewCell {
  static let reuseIdentifier = "ReaderPageCell"
  let pageView = ReaderPageView(frame: .zero)

  override init(frame: CGRect) {
    super.init(frame: frame)
    pageView.frame = contentView.bounds
    pageView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    contentView.addSubview(pageView)
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }
}

enum ReaderRenderMode {
  case paged, continuous, focus

  static func from(_ raw: String) -> ReaderRenderMode {
    switch raw.lowercased() {
    case "continuous", "vertical", "scroll", "scrolling": return .continuous
    case "focus", "beam": return .focus
    default: return .paged
    }
  }
}

// A sentence of the chapter on screen, for listening in paged mode.
private struct PagedSentence {
  let blockId: String
  // In the block's text.
  let range: NSRange
  // Global index of the page it starts on.
  let page: Int
  let layout: ReaderBlockLayout
}

// A sentence of the bound chapter, for the focus beam.
private struct FocusSentence {
  let blockId: String
  let itemIndex: Int
  // In the block's text.
  let range: NSRange
  // In content coordinates.
  let topY: CGFloat
  let bottomY: CGFloat
}

private let layoutQueue = DispatchQueue(label: "app.noeul.reader.layout", qos: .userInitiated)
private let edgeSwipeSlop: CGFloat = 12
private let readingDirectionTravel: CGFloat = 6
private let savedShownHoldMs = 600
private let focusAnchorRatio: CGFloat = 0.28
private let focusTopMargin: CGFloat = 44
private let focusBottomMargin: CGFloat = 12

// Gestures on the reader: remembers where a touch went down (a pan begins
// only after the finger has moved), and lets the handle pan start only on a
// selection handle.
private final class GestureGate: NSObject, UIGestureRecognizerDelegate {
  var shouldBegin: (UIGestureRecognizer, CGPoint) -> Bool = { _, _ in true }
  var onTouchDown: () -> Void = {}
  private(set) var touchDown = CGPoint.zero

  func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
    touchDown = touch.location(in: gestureRecognizer.view)
    onTouchDown()
    return true
  }

  func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
    shouldBegin(gestureRecognizer, touchDown)
  }

  func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                         shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
    false
  }
}

final class NativeEpubReaderView: ExpoView, UICollectionViewDataSource, UICollectionViewDelegateFlowLayout, ReaderScrollHostDelegate {
  let onPageChange = EventDispatcher()
  let onChapterEnd = EventDispatcher()
  let onChapterStart = EventDispatcher()
  let onChapterCommit = EventDispatcher()
  let onWordSelected = EventDispatcher()
  let onTextSelected = EventDispatcher()
  let onSelectionCleared = EventDispatcher()
  let onFocusSentenceChange = EventDispatcher()
  let onExposure = EventDispatcher()
  let onSavedTermsShown = EventDispatcher()
  let onReadingDirection = EventDispatcher()
  let onHighlightNotePress = EventDispatcher()

  // MARK: Props, as last set from JS

  var bookManifest: [String: Any] = [:] {
    didSet { committedSpineIndex = intValue(bookManifest["currentSpineIndex"]) ?? committedSpineIndex }
  }
  var chapterBlocks: [[String: Any]] = []
  var chapterWindow: [[String: Any]] = []
  var restorePosition: [String: Any] = [:]
  var fontSize: Double = 18
  var lineHeight: Double = 1.5
  var theme = "light"
  var themeTokens: [String: Any] = [:]
  var renderMode = "paged"
  var chapterTransitionDirection = "none"
  var keepScreenOn = false {
    didSet { UIApplication.shared.isIdleTimerDisabled = keepScreenOn && window != nil }
  }
  var clearSelectionToken: Double = 0 {
    didSet {
      if clearSelectionToken != oldValue {
        setSelection(nil)
        fadeContextSentence()
      }
    }
  }
  var highlightTerms: [Any] = [] {
    didSet { highlightsDirty = true }
  }
  var highlightStrengths: [String: Any] = [:] {
    didSet {
      highlightsDirty = true
      recordStrengthDrops(from: oldValue)
    }
  }
  var levelTerms: [Any] = [] {
    didSet { highlightsDirty = true }
  }
  var exposureTerms: [Any] = [] {
    didSet { highlightsDirty = true }
  }
  var showPinyin = false
  var showGloss = false
  var showContextSentence = false {
    didSet {
      if !showContextSentence && marks.contextSentence != nil {
        marks.contextSentence = nil
        pushMarks()
      }
    }
  }
  var reduceMotion = false {
    didSet {
      if reduceMotion && marks.reveal != nil {
        marks.reveal = nil
        pushMarks()
      }
    }
  }
  var fullscreen = false {
    didSet {
      if !fullscreen { progressThumb.hide() }
    }
  }
  var pagedFocus = false {
    didSet {
      if pagedFocus != oldValue { pagedFocusChanged() }
    }
  }
  var tappedTerms: [Any] = [] {
    didSet {
      var next: [String: Double] = [:]
      for entry in tappedTerms {
        let map = entry as? [String: Any]
        guard let text = ((map?["text"] ?? entry) as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
              !text.isEmpty else { continue }
        next[text] = max(next[text] ?? 0, doubleValue(map?["at"]) ?? 0)
      }
      marks.tappedAt = next
      pushMarks()
    }
  }
  var chromeInsets: [String: Any] = [:] {
    didSet { chromeInsetsChanged() }
  }
  var interfaceStrings: [String: Any] = [:] {
    didSet {
      let language = (interfaceStrings["language"] as? String) ?? ""
      if ReaderStrings.set(language: language, strings: interfaceStrings) { host.setNeedsDisplay() }
    }
  }
  var focusSentenceCount = 1 {
    didSet { focusSpanCountChanged(from: oldValue) }
  }
  var focusSwipeEnabled = false
  var focusNavToken = "none:0" {
    didSet { focusNavTokenChanged(from: oldValue) }
  }
  var focusPanelHeight: Double = 0 {
    didSet { focusPanelChanged(from: oldValue) }
  }
  var focusTapsInSpanOnly = false

  // MARK: State

  private let collectionView: UICollectionView
  private let host = ReaderScrollHost(frame: .zero)
  private let progressThumb = ChapterProgressThumb()
  // Whether the pages had any word help yet: its first arrival sweeps in.
  private var hadLevelMarks = false
  // The annotation settings the pages on screen were laid out with.
  private var laidOutAnnotations = (pinyin: false, gloss: false)
  // A chrome inset change that came in mid-gesture (a pull shows the header);
  // applied when the finger lifts so the pull isn't cut short.
  private var pendingChromeTopDelta: CGFloat?
  private var mode = ReaderRenderMode.paged
  private var palette = ReaderPalette.make(theme: "light", tokens: [:])
  // Paged: every page of the window. Vertical: one page per window chapter.
  private var pages: [ReaderPage] = []
  // Paged: the page showing. Vertical: the window chapter bound.
  private var currentPage = 0
  private var committedSpineIndex: Int?
  private var selection: ReaderSelection?
  private var marks = ReaderMarkOptions()
  private var highlightsDirty = true
  private var highlightGeneration = 0
  private var chromeTop: CGFloat = 0
  private var chromeBottom: CGFloat = 0

  private var contentSignature = ""
  private var settingsSignature = ""
  private var currentChapterSignature = ""
  private var appliedRestoreSignature = ""
  private var layoutGeneration = 0
  private var laidOutSize = CGSize.zero

  // Paged swipes.
  private var dragStartPage = 0
  private var pendingEdge: EventDispatcher?
  private var lastPagerOffset: CGFloat = 0

  // Reading direction: travel in one direction this gesture, and the last one reported.
  private var directionTravel: CGFloat = 0
  private var reportedDirection = 0

  // Exposure: the unit (page, focus span) being read, and scroll mode's
  // per-block ledger.
  private var exposureUnit: (key: String, start: CFTimeInterval, collect: () -> (terms: [String], saved: [String], chars: Int))?
  private var savedShownWork: DispatchWorkItem?
  private var blockFirstSeen: [String: CFTimeInterval] = [:]
  private var blocksEmitted = Set<String>()
  private var scrollSettleWork: DispatchWorkItem?

  // Focus beam.
  private var focusSentences: [FocusSentence] = []
  private var focusIndex = 0
  private var lastFocusMoveAt: CFTimeInterval = 0
  private var focusNavTokenSeen = false
  private var pendingFocusLandAtEndSpine: Int?
  private let beamAnimator = FrameAnimator()

  // Listening in paged mode.
  private var pagedSentences: [PagedSentence] = []
  private var pagedSpine: Int?
  private var pagedIndex = 0
  private var userTurnedPage = false

  // Long-press selection: the word it started on, the last end reached (for
  // haptics), and handle drags.
  private var selectionAnchor: (start: ReaderTextPosition, end: ReaderTextPosition)?
  private var selectionDragStarted = false
  private var longPressStart = CGPoint.zero
  private var lastSelectionEdge: (Int, Int)?
  private var draggedHandle: ReaderSelectionHandle?
  private var handleFixedEnd: ReaderTextPosition?
  private var handleGrabOffset = CGPoint.zero
  private var handleDragOriginal: ReaderSelection?
  private let selectionHaptic = UISelectionFeedbackGenerator()
  private let handlePan = UIPanGestureRecognizer()
  private let gate = GestureGate()
  private var touchStartedWhileFlinging = false

  required init(appContext: AppContext? = nil) {
    let layout = UICollectionViewFlowLayout()
    layout.scrollDirection = .horizontal
    layout.minimumLineSpacing = 0
    layout.minimumInteritemSpacing = 0
    collectionView = UICollectionView(frame: .zero, collectionViewLayout: layout)
    super.init(appContext: appContext)

    collectionView.isPagingEnabled = true
    collectionView.showsHorizontalScrollIndicator = false
    collectionView.contentInsetAdjustmentBehavior = .never
    collectionView.alwaysBounceHorizontal = true
    collectionView.dataSource = self
    collectionView.delegate = self
    collectionView.register(ReaderPageCell.self, forCellWithReuseIdentifier: ReaderPageCell.reuseIdentifier)
    addSubview(collectionView)
    host.delegate = self
    host.isHidden = true
    addSubview(host)
    progressThumb.isUserInteractionEnabled = false
    addSubview(progressThumb)

    gate.onTouchDown = { [weak self] in
      guard let self else { return }
      self.touchStartedWhileFlinging = self.mode == .continuous && self.host.isDecelerating
    }
    gate.shouldBegin = { [weak self] recognizer, down in
      guard let self else { return false }
      if recognizer === self.handlePan {
        guard let surface = self.surface else { return false }
        return surface.view.handleHit(at: self.convert(down, to: surface.space)) != nil
      }
      return !self.touchStartedWhileFlinging
    }
    let tap = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
    tap.delegate = gate
    addGestureRecognizer(tap)
    let longPress = UILongPressGestureRecognizer(target: self, action: #selector(handleLongPress(_:)))
    longPress.minimumPressDuration = 0.4
    longPress.delegate = gate
    addGestureRecognizer(longPress)
    // Dragging a selection handle wins over turning the page or scrolling.
    handlePan.addTarget(self, action: #selector(handleHandlePan(_:)))
    handlePan.delegate = gate
    addGestureRecognizer(handlePan)
    collectionView.panGestureRecognizer.require(toFail: handlePan)
    host.scrollView.panGestureRecognizer.require(toFail: handlePan)
    applyPalette()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    collectionView.frame = bounds
    host.frame = bounds
    progressThumb.frame = bounds
    if bounds.size != laidOutSize && bounds.width > 0 && bounds.height > 0 {
      collectionView.collectionViewLayout.invalidateLayout()
      repaginate(resetToFirstPage: false)
    }
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    UIApplication.shared.isIdleTimerDisabled = keepScreenOn && window != nil
    if window == nil { closeExposure() }
  }

  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    if event?.type == .touches {
      // A new gesture: reading direction starts over.
      directionTravel = 0
      reportedDirection = 0
    }
    return super.hitTest(point, with: event)
  }

  // MARK: - Props

  // Called once per JS render after all changed props are set.
  func propsDidUpdate() {
    let nextMode = ReaderRenderMode.from(renderMode)
    if nextMode != mode {
      switchMode(to: nextMode)
      return
    }
    let chapters = parsedChapters()
    let nextContent = chapters.map(\.signature).joined(separator: "|")
    let tokensSignature = themeTokens.keys.sorted().map { "\($0)=\(themeTokens[$0] ?? "")" }.joined(separator: ",")
    let nextSettings = "\(clampedFontSize)|\(clampedLineHeight)|\(theme)|\(tokensSignature)|\(showPinyin)|\(showGloss)"
    let current = currentChapter(in: chapters)?.signature ?? ""

    if nextSettings != settingsSignature {
      settingsSignature = nextSettings
      applyPalette()
      marks.showPinyin = showPinyin
      marks.showGloss = showGloss
      contentSignature = ""
    }
    if nextContent != contentSignature {
      contentSignature = nextContent
      let reset = current != currentChapterSignature
      currentChapterSignature = current
      repaginate(resetToFirstPage: reset)
      return
    }
    if highlightsDirty { refreshHighlights() }
    applyRestorePositionIfChanged()
  }

  private var clampedFontSize: CGFloat { CGFloat(min(max(fontSize, 12), 30)) }
  private var clampedLineHeight: CGFloat { CGFloat(min(max(lineHeight, 1), 2.6)) }
  private var manifestSpineIndex: Int? { intValue(bookManifest["currentSpineIndex"]) }
  private var isVertical: Bool { mode != .paged }
  private var focusSpanCount: Int { min(max(focusSentenceCount, 1), 5) }
  private var transitionPrefix: String { String(chapterTransitionDirection.split(separator: ":").first ?? "none") }

  private func applyPalette() {
    palette = ReaderPalette.make(theme: theme, tokens: themeTokens)
    backgroundColor = palette.background
    collectionView.backgroundColor = palette.background
    host.palette = palette
    progressThumb.color = palette.bodyText
  }

  private func parsedChapters() -> [ReaderChapter] {
    let window = chapterWindow.compactMap(ReaderChapter.parse).sorted { $0.spineIndex < $1.spineIndex }
    if !window.isEmpty { return window }
    // Single-chapter path (no window).
    var legacy: [String: Any] = [
      "role": "current",
      "spineIndex": manifestSpineIndex ?? 0,
      "href": (bookManifest["currentSpineHref"] as? String) ?? "",
      "path": (bookManifest["currentSpinePath"] as? String) ?? "",
      "blocks": chapterBlocks,
    ]
    legacy["title"] = bookManifest["currentChapterTitle"] ?? bookManifest["currentSpineTitle"]
    return ReaderChapter.parse(legacy).map { [$0] } ?? []
  }

  private func currentChapter(in chapters: [ReaderChapter]) -> ReaderChapter? {
    chapters.first { $0.role == "current" } ?? chapters.first { $0.spineIndex == manifestSpineIndex }
  }

  private func switchMode(to next: ReaderRenderMode) {
    mode = next
    collectionView.isHidden = isVertical
    host.isHidden = !isVertical
    host.focusSwipeMode = next == .focus
    host.stopScrollAnimation()
    host.setLift(0, animated: false)
    beamAnimator.stop()
    setSelection(nil)
    marks.spokenRange = nil
    marks.focusBeam = nil
    pushMarks()
    focusSentences = []
    contentSignature = parsedChapters().map(\.signature).joined(separator: "|")
    repaginate(resetToFirstPage: true)
  }

  private func chromeInsetsChanged() {
    let top = CGFloat(doubleValue(chromeInsets["top"]) ?? 0)
    let bottom = CGFloat(doubleValue(chromeInsets["bottom"]) ?? 0)
    let oldTop = chromeTop
    let bottomChanged = bottom != chromeBottom
    chromeTop = top
    chromeBottom = bottom
    host.chromeTop = mode == .continuous ? top : 0
    host.setIndicatorInsets(top: top, bottom: bottom)
    switch mode {
    case .paged:
      if bottomChanged { repaginate(resetToFirstPage: pages.isEmpty) }
    case .continuous:
      // Keep the same line in place as the text moves down or up. Not while
      // a finger is on the page: a rebind then would end a chapter pull.
      guard top != oldTop || bottomChanged, pages.indices.contains(currentPage) else { break }
      if host.isInteracting {
        pendingChromeTopDelta = (pendingChromeTopDelta ?? 0) + (top - oldTop)
      } else {
        bindVertical(currentPage, target: host.offset + (top - oldTop), resetScroll: false)
      }
    case .focus:
      break
    }
  }

  // MARK: - Pagination

  private func repaginate(resetToFirstPage: Bool) {
    guard bounds.width > 0, bounds.height > 0 else { return }
    let size = bounds.size
    let insets = ReaderPageView.insets
    let vertical = isVertical
    let config = ReaderLayoutConfig(
      contentWidth: size.width - insets.left - insets.right,
      contentHeight: vertical ? .greatestFiniteMagnitude : size.height - insets.top - (insets.bottom + chromeBottom),
      fontSize: clampedFontSize,
      lineHeight: clampedLineHeight,
      palette: palette,
      showPinyin: showPinyin,
      showGloss: showGloss
    )
    let chapters = parsedChapters()
    let previous = pages[safe: currentPage]
    let previousAnchor = previous.map { ($0.spineIndex, $0.chapterPageIndex, $0.firstBlockId) }
    // Marked words that change with this layout (glosses turned on, word
    // help arriving) can play the reveal, compared with what was on screen.
    let termsChanged = highlightsDirty
    let marksBefore = RevealWave.marks(for: previous, showPinyin: laidOutAnnotations.pinyin, showGloss: laidOutAnnotations.gloss)
    let annotations = (pinyin: showPinyin, gloss: showGloss)
    let terms = currentHighlightTerms()
    if resetToFirstPage && mode == .focus && transitionPrefix == "previous" {
      // Going back a chapter in focus mode lands on its last sentence.
      pendingFocusLandAtEndSpine = currentChapter(in: chapters)?.spineIndex ?? manifestSpineIndex
    }
    layoutGeneration += 1
    highlightGeneration += 1
    let generation = layoutGeneration

    layoutQueue.async { [weak self] in
      let laidOut = chapters.flatMap { paginateChapter($0, config: config) }
      for page in laidOut {
        page.highlights = buildHighlights(for: page, terms: terms)
      }
      DispatchQueue.main.async {
        guard let self, generation == self.layoutGeneration else { return }
        self.laidOutSize = size
        let annotationsChanged = annotations != self.laidOutAnnotations
        self.laidOutAnnotations = annotations
        if self.isVertical {
          self.installVertical(laidOut, resetToFirstPage: resetToFirstPage, previousSpine: previous?.spineIndex)
        } else {
          self.install(laidOut, resetToFirstPage: resetToFirstPage, previousAnchor: previousAnchor)
        }
        if (termsChanged || annotationsChanged) && self.hadLevelMarks {
          let after = RevealWave.marks(for: self.pages[safe: self.currentPage], showPinyin: self.showPinyin, showGloss: self.showGloss)
          self.startReveal(RevealWave.kind(before: marksBefore, after: after))
          self.pushMarks()
        }
      }
    }
  }

  private func dropSelectionIfGone() {
    if let selection, !selection.ranges.allSatisfy({ part in
      pages.contains { $0.spineIndex == selection.spineIndex && $0.contains(blockId: part.blockId) }
    }) {
      self.selection = nil
      onSelectionCleared([:])
    }
  }

  private func install(_ newPages: [ReaderPage], resetToFirstPage: Bool, previousAnchor: (Int, Int, String)?) {
    closeExposure()
    pages = newPages
    dropSelectionIfGone()

    var target = restoredPageIndex()
    if target == nil {
      if resetToFirstPage, let spine = manifestSpineIndex {
        target = pages.firstIndex { $0.spineIndex == spine }
      } else if let (spine, chapterPage, blockId) = previousAnchor {
        target = pages.firstIndex { $0.spineIndex == spine && $0.chapterPageIndex == chapterPage && $0.contains(blockId: blockId) }
          ?? pages.firstIndex { $0.spineIndex == spine && $0.contains(blockId: blockId) }
          ?? pages.lastIndex { $0.spineIndex == spine && $0.chapterPageIndex <= chapterPage }
      }
    }
    if target == nil, let spine = manifestSpineIndex {
      target = pages.firstIndex { $0.spineIndex == spine }
    }
    appliedRestoreSignature = ReaderPosition.parse(restorePosition)?.signature ?? ""
    currentPage = min(max(target ?? 0, 0), max(pages.count - 1, 0))

    collectionView.reloadData()
    collectionView.layoutIfNeeded()
    scrollToCurrentPage()
    emitPageChange()
    revealIfFirstMarks()
    if pagedFocusActive { refreshPagedFocus() }
  }

  private func scrollToCurrentPage() {
    let width = collectionView.bounds.width
    guard width > 0 else { return }
    collectionView.setContentOffset(CGPoint(x: CGFloat(currentPage) * width, y: 0), animated: false)
    lastPagerOffset = collectionView.contentOffset.x
  }

  // MARK: - Highlights

  private var highlightTermsCache: ReaderHighlightTerms?

  private func currentHighlightTerms() -> ReaderHighlightTerms {
    if highlightsDirty || highlightTermsCache == nil {
      highlightTermsCache = ReaderHighlightTerms(
        highlightTerms: highlightTerms, strengths: highlightStrengths, levelTerms: levelTerms, exposureTerms: exposureTerms
      )
      highlightsDirty = false
    }
    return highlightTermsCache!
  }

  // Marked words changed without a re-layout: rebuild them for every page.
  private func refreshHighlights() {
    let terms = currentHighlightTerms()
    let snapshot = pages
    highlightGeneration += 1
    let generation = highlightGeneration
    layoutQueue.async { [weak self] in
      let built = snapshot.map { buildHighlights(for: $0, terms: terms) }
      DispatchQueue.main.async {
        guard let self, generation == self.highlightGeneration else { return }
        let shown = self.pages[safe: self.currentPage]
        let before = RevealWave.marks(for: shown, showPinyin: self.showPinyin, showGloss: self.showGloss)
        for (page, highlights) in zip(snapshot, built) {
          page.highlights = highlights
        }
        let after = RevealWave.marks(for: shown, showPinyin: self.showPinyin, showGloss: self.showGloss)
        self.startReveal(RevealWave.kind(before: before, after: after))
        self.pushMarks()
        self.host.redrawTiles()
      }
    }
  }

  // A saved word the reader passes without looking up loses strength; the
  // drop animates over 900 ms.
  private func recordStrengthDrops(from old: [String: Any]) {
    let now = nowMs()
    for (term, value) in highlightStrengths {
      guard let next = doubleValue(value) else { continue }
      let previous = doubleValue(old[term]) ?? 1
      if next < previous {
        marks.savedFades[term] = (CGFloat(min(max(previous, 0), 1)), now)
      } else if next > previous {
        marks.savedFades[term] = nil
      }
    }
    pushMarks()
  }

  // Word help sweeps in: on its first arrival, and when most of the page's
  // marks are new or changed (never with reduce motion).
  private func startReveal(_ kind: ReaderRevealKind) {
    if let page = pages[safe: currentPage], !page.highlights.level.isEmpty { hadLevelMarks = true }
    guard kind != .none, !reduceMotion else { return }
    marks.reveal = ReaderReveal(startMs: nowMs(), underlines: kind == .full)
  }

  // After a layout: the first pages with word help play the full wave.
  private func revealIfFirstMarks() {
    guard !hadLevelMarks, let page = pages[safe: currentPage], !page.highlights.level.isEmpty else { return }
    startReveal(.full)
    pushMarks()
  }

  private func pushMarks() {
    for cell in collectionView.visibleCells {
      (cell as? ReaderPageCell)?.pageView.marks = marks
    }
    host.marks = marks
  }

  // MARK: - Context sentence

  private func setContextSentence(spine: Int, layout: ReaderBlockLayout, around range: NSRange) {
    guard showContextSentence else { return }
    let bounds = sentenceBounds(layout, start: range.location, end: NSMaxRange(range))
    marks.contextSentence = (spine, ReaderSourceRange(blockId: layout.block.id, range: bounds))
    marks.contextFadeAt = nil
    pushMarks()
  }

  private func fadeContextSentence() {
    guard marks.contextSentence != nil, marks.contextFadeAt == nil else { return }
    let start = nowMs()
    marks.contextFadeAt = start
    pushMarks()
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
      guard let self, self.marks.contextFadeAt == start else { return }
      self.marks.contextSentence = nil
      self.marks.contextFadeAt = nil
      self.pushMarks()
    }
  }

  // MARK: - Exposure

  private func openExposure(key: String, collect: @escaping () -> (terms: [String], saved: [String], chars: Int)) {
    guard key != exposureUnit?.key else { return }
    closeExposure()
    exposureUnit = (key, CACurrentMediaTime(), collect)
    let saved = collect().saved
    if !saved.isEmpty { scheduleSavedShown(saved, key: key, requireCurrent: true) }
  }

  private func closeExposure() {
    guard let unit = exposureUnit else { return }
    exposureUnit = nil
    let dwellMs = (CACurrentMediaTime() - unit.start) * 1000
    let collected = unit.collect()
    guard dwellMs > 0, !collected.terms.isEmpty || !collected.saved.isEmpty else { return }
    onExposure(["terms": collected.terms, "savedTerms": collected.saved, "chars": collected.chars, "dwellMs": dwellMs])
  }

  // Saved words on screen for 600 ms: JS fades them a step.
  private func scheduleSavedShown(_ terms: [String], key: String, requireCurrent: Bool) {
    savedShownWork?.cancel()
    let work = DispatchWorkItem { [weak self] in
      guard let self else { return }
      if requireCurrent && self.exposureUnit?.key != key { return }
      self.onSavedTermsShown(["terms": terms, "unitKey": key])
    }
    savedShownWork = work
    DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(savedShownHoldMs), execute: work)
  }

  private func openPagedExposure(_ page: ReaderPage) {
    openExposure(key: "paged:\(page.spineIndex):\(page.chapterPageIndex)") {
      let highlights = page.highlights
      return (highlights.levelTerms + highlights.exposureTerms, highlights.savedTerms, highlights.chars)
    }
  }

  // Scroll mode: each block counts once it has scrolled fully past the top.
  private func creditContinuousExposure() {
    guard mode == .continuous, let page = pages[safe: currentPage] else { return }
    let top = host.offset
    let bottom = top + host.viewportHeight
    let now = CACurrentMediaTime()
    for item in page.items where item.layout.imageFrame == nil {
      let blockId = item.layout.block.id
      guard !blocksEmitted.contains(blockId) else { continue }
      let blockTop = host.textTop + item.y
      let blockBottom = blockTop + item.height
      if blockBottom > top && blockTop < bottom && blockFirstSeen[blockId] == nil {
        blockFirstSeen[blockId] = now
        let saved = savedTerms(in: page.highlights, blockId: blockId)
        if !saved.isEmpty { scheduleSavedShown(saved, key: "block:\(page.spineIndex):\(blockId)", requireCurrent: false) }
      }
      if blockBottom <= top, let seen = blockFirstSeen[blockId] {
        blocksEmitted.insert(blockId)
        let terms = gradedTerms(in: page.highlights, blockId: blockId)
        let saved = savedTerms(in: page.highlights, blockId: blockId)
        let dwellMs = (now - seen) * 1000
        if dwellMs > 0 && (!terms.isEmpty || !saved.isEmpty) {
          onExposure(["terms": terms, "savedTerms": saved, "chars": item.layout.text.length, "dwellMs": dwellMs])
        }
      }
    }
  }

  private func resetContinuousExposure() {
    blockFirstSeen = [:]
    blocksEmitted = []
  }

  // MARK: - Reading direction

  private func reportReadingDirection(_ direction: Int) {
    guard mode != .focus, direction != 0, direction != reportedDirection else { return }
    reportedDirection = direction
    onReadingDirection(["direction": direction > 0 ? "forward" : "back"])
  }

  private func trackReadingTravel(_ delta: CGFloat) {
    guard delta != 0 else { return }
    if (delta > 0) != (directionTravel > 0) { directionTravel = 0 }
    directionTravel += delta
    if abs(directionTravel) >= readingDirectionTravel {
      reportReadingDirection(directionTravel > 0 ? 1 : -1)
    }
  }

  // MARK: - Position (paged)

  // The page restorePosition points at, if it is in the current chapter.
  private func restoredPageIndex() -> Int? {
    guard let position = ReaderPosition.parse(restorePosition) else { return nil }
    if let spine = manifestSpineIndex, spine != position.spineIndex { return nil }
    let chapterPages = pages.indices.filter { pages[$0].spineIndex == position.spineIndex }
    guard !chapterPages.isEmpty else { return nil }
    if let fraction = position.chapterFraction {
      return chapterPages[Int((fraction * Double(chapterPages.count - 1)).rounded())]
    }
    if let pageIndex = position.pageIndex, let index = chapterPages[safe: pageIndex] {
      if position.firstBlockId == nil || pages[index].contains(blockId: position.firstBlockId!) {
        return index
      }
    }
    if let blockId = position.firstBlockId {
      if let index = chapterPages.first(where: { pages[$0].firstBlockId == blockId }) { return index }
      if let index = chapterPages.first(where: { pages[$0].contains(blockId: blockId) }) { return index }
    }
    if let pageIndex = position.pageIndex {
      return chapterPages[min(max(pageIndex, 0), chapterPages.count - 1)]
    }
    return nil
  }

  // JS echoes the position back after every page event; only a real change
  // (or a new seek token) may move the reader.
  private func applyRestorePositionIfChanged() {
    guard let position = ReaderPosition.parse(restorePosition), position.signature != appliedRestoreSignature else { return }
    appliedRestoreSignature = position.signature
    guard !pages.isEmpty else { return }
    if isVertical {
      applyVerticalRestore(position)
      return
    }
    guard let target = restoredPageIndex(), target != currentPage else { return }
    jump(to: target)
  }

  func seek(to raw: [String: Any]) {
    guard let position = ReaderPosition.parse(raw) else { return }
    if isVertical {
      seekVertical(position)
      return
    }
    let chapterPages = pages.indices.filter { pages[$0].spineIndex == position.spineIndex }
    guard !chapterPages.isEmpty else { return }
    if let blockId = position.firstBlockId {
      if let pageIndex = position.pageIndex, let index = chapterPages[safe: pageIndex], pages[index].contains(blockId: blockId) {
        return jump(to: index)
      }
      if let index = chapterPages.first(where: { pages[$0].contains(blockId: blockId) }) { return jump(to: index) }
    }
    if let fraction = position.chapterFraction {
      return jump(to: chapterPages[Int((fraction * Double(chapterPages.count - 1)).rounded())])
    }
    let pageIndex = min(max(position.pageIndex ?? chapterPages.count - 1, 0), chapterPages.count - 1)
    jump(to: chapterPages[pageIndex])
  }

  private func jump(to index: Int) {
    currentPage = index
    scrollToCurrentPage()
    emitPageChange()
  }

  // MARK: - Vertical modes

  private var focusTopInset: CGFloat { mode == .focus ? (0.545 * bounds.height).rounded() : 0 }
  private var focusBottomInset: CGFloat { mode == .focus ? (0.52 * bounds.height).rounded() : 0 }

  private func verticalTextTop() -> CGFloat {
    30 + (mode == .continuous ? chromeTop : 0) + focusTopInset
  }

  private func canPullNext(_ page: ReaderPage) -> Bool {
    guard mode == .continuous else { return false }
    guard let total = intValue(bookManifest["totalSpineItems"]) else { return true }
    return page.spineIndex < total - 1
  }

  private func canPullPrevious(_ page: ReaderPage) -> Bool {
    mode == .continuous && page.spineIndex > 0
  }

  private func verticalContentHeight(_ page: ReaderPage) -> CGFloat {
    let blocks = page.items.last.map { $0.y + $0.height + $0.layout.marginBottom } ?? 0
    var height = verticalTextTop() + blocks + 30 + (mode == .continuous ? chromeBottom : 0) + focusBottomInset
    if canPullNext(page) { height += 96 }
    return max(bounds.height, height)
  }

  private func installVertical(_ newPages: [ReaderPage], resetToFirstPage: Bool, previousSpine: Int?) {
    closeExposure()
    resetContinuousExposure()
    pages = newPages
    dropSelectionIfGone()
    let position = ReaderPosition.parse(restorePosition)
    var index: Int?
    if let position, position.spineIndex == (manifestSpineIndex ?? position.spineIndex) {
      index = pages.firstIndex { $0.spineIndex == position.spineIndex }
    }
    if index == nil, resetToFirstPage, let spine = manifestSpineIndex {
      index = pages.firstIndex { $0.spineIndex == spine }
    }
    if index == nil, let previousSpine { index = pages.firstIndex { $0.spineIndex == previousSpine } }
    if index == nil, let spine = manifestSpineIndex { index = pages.firstIndex { $0.spineIndex == spine } }
    appliedRestoreSignature = position?.signature ?? ""
    guard let bound = index ?? (pages.isEmpty ? nil : 0) else { return }
    let page = pages[bound]
    let target = position.flatMap { continuousRestoreTarget($0, page: page) }
    let landAtEnd = mode == .focus && pendingFocusLandAtEndSpine == page.spineIndex
    bindVertical(bound, target: target ?? 0, resetScroll: true, landFocusAtEnd: landAtEnd)
    revealIfFirstMarks()
    if mode == .focus {
      dispatchFocusPageChange()
      openFocusExposure()
    } else {
      dispatchContinuousPageChange(includeSaved: true)
      creditContinuousExposure()
    }
  }

  // Bind a window chapter. Continuous: `target` sets the offset. Focus: the
  // beam keeps its sentence unless `resetScroll`, then lands on the restore
  // block (or the last span when going back a chapter).
  private func bindVertical(_ index: Int, target: CGFloat?, resetScroll: Bool, landFocusAtEnd: Bool = false) {
    guard let page = pages[safe: index] else { return }
    let preserved = (mode == .focus && !resetScroll && !landFocusAtEnd && currentPage == index) ? focusSentences[safe: focusIndex] : nil
    currentPage = index
    host.chromeTop = mode == .continuous ? chromeTop : 0
    host.pullNextEnabled = canPullNext(page)
    host.pullPreviousEnabled = canPullPrevious(page)
    host.focusSwipeMode = mode == .focus
    host.selection = selection
    host.marks = marks
    host.bind(page: page, textTop: verticalTextTop(), contentHeight: verticalContentHeight(page), target: mode == .focus ? nil : target)
    guard mode == .focus else { return }

    rebuildFocusSentences()
    if pendingFocusLandAtEndSpine == page.spineIndex { pendingFocusLandAtEndSpine = nil }
    if focusSentences.isEmpty {
      focusIndex = 0
    } else if let preserved {
      focusIndex = focusSentenceIndex(blockId: preserved.blockId, offset: preserved.range.location) ?? clampFocusIndex(focusIndex)
    } else if landFocusAtEnd {
      focusIndex = focusMaxIndex
    } else if let blockId = ReaderPosition.parse(restorePosition)?.firstBlockId,
              let first = focusSentences.firstIndex(where: { $0.blockId == blockId }) {
      focusIndex = first
    } else {
      focusIndex = 0
    }
    setBeam(animated: false, fast: false)
    anchorFocus(animated: false, fast: false)
    onFocusSentenceChange(focusStatePayload(focusIndex, withNext: true))
  }

  // Scroll offset for a saved position in a chapter (spec order: chapter end,
  // block, fraction, page index).
  private func continuousRestoreTarget(_ position: ReaderPosition, page: ReaderPage) -> CGFloat? {
    guard position.spineIndex == page.spineIndex else { return nil }
    let maxScroll = max(0, verticalContentHeight(page) - bounds.height)
    if let count = position.pagesInChapter, count > 1, let pageIndex = position.pageIndex, pageIndex >= count - 1 {
      return maxScroll
    }
    if let blockId = position.firstBlockId, let target = blockScrollTarget(blockId, page: page) { return target }
    if let fraction = position.chapterFraction { return (CGFloat(fraction) * maxScroll).rounded() }
    if let count = position.pagesInChapter, count > 1, let pageIndex = position.pageIndex {
      return (CGFloat(pageIndex) / CGFloat(count - 1) * maxScroll).rounded()
    }
    return nil
  }

  private func blockScrollTarget(_ blockId: String, page: ReaderPage) -> CGFloat? {
    guard let item = page.items.first(where: { $0.layout.block.id == blockId }) else { return nil }
    return verticalTextTop() + item.y - (mode == .continuous ? chromeTop : 0)
  }

  private func applyVerticalRestore(_ position: ReaderPosition) {
    guard let index = pages.firstIndex(where: { $0.spineIndex == position.spineIndex }) else { return }
    if let spine = manifestSpineIndex, spine != position.spineIndex { return }
    // The position echo for the chapter already showing never moves it.
    if index == currentPage && position.seekToken == nil { return }
    let page = pages[index]
    bindVertical(index, target: continuousRestoreTarget(position, page: page) ?? 0, resetScroll: true)
    if mode == .focus {
      dispatchFocusPageChange()
    } else {
      dispatchContinuousPageChange(includeSaved: true)
      creditContinuousExposure()
    }
  }

  private func seekVertical(_ position: ReaderPosition) {
    guard let index = pages.firstIndex(where: { $0.spineIndex == position.spineIndex }) else { return }
    let page = pages[index]
    let target = position.firstBlockId.flatMap { blockScrollTarget($0, page: page) } ?? continuousRestoreTarget(position, page: page)
    bindVertical(index, target: target ?? 0, resetScroll: false)
    if mode == .focus {
      dispatchFocusPageChange()
    } else {
      dispatchContinuousPageChange(includeSaved: true)
      creditContinuousExposure()
    }
  }

  private var virtualPageCount: Int {
    max(1, Int(ceil(host.contentHeight / max(bounds.height, 1))))
  }

  private var virtualPageIndex: Int {
    let count = virtualPageCount
    let maxScroll = host.maxScroll
    guard maxScroll > 0, count > 1 else { return 0 }
    return min(max(Int((host.offset / maxScroll * CGFloat(count - 1)).rounded()), 0), count - 1)
  }

  private func firstVisibleBlockId(_ page: ReaderPage) -> String {
    let readingTop = host.offset + (mode == .continuous ? chromeTop : 0)
    let textTop = host.textTop
    return page.items.first { textTop + $0.y + $0.height > readingTop }?.layout.block.id ?? page.firstBlockId
  }

  private func pageHref(_ page: ReaderPage) -> String {
    if !page.href.isEmpty { return page.href }
    if !page.path.isEmpty { return page.path }
    return (bookManifest["currentSpineHref"] as? String) ?? (bookManifest["currentSpinePath"] as? String) ?? ""
  }

  private func dispatchContinuousPageChange(includeSaved: Bool) {
    guard let page = pages[safe: currentPage] else { return }
    onPageChange([
      "page": virtualPageIndex,
      "total": virtualPageCount,
      "globalPage": currentPage,
      "globalTotal": pages.count,
      "href": pageHref(page),
      "firstBlockId": firstVisibleBlockId(page),
      "savedHighlights": includeSaved ? page.highlights.savedContexts : [[String: Any]](),
      "spineIndex": page.spineIndex,
    ])
  }

  // Pull past either end: the adjacent window chapter, or ask JS for one.
  private func handleEdgePull(_ direction: Int) {
    let next = currentPage + direction
    guard pages.indices.contains(next) else {
      reportReadingDirection(direction)
      if direction > 0 { onChapterEnd([:]) } else { onChapterStart([:]) }
      return
    }
    clearSelection(fromTap: false, force: true)
    bindVertical(next, target: direction > 0 ? 0 : .greatestFiniteMagnitude, resetScroll: false)
    dispatchContinuousPageChange(includeSaved: true)
    creditContinuousExposure()
    guard let page = pages[safe: currentPage], page.spineIndex != committedSpineIndex else { return }
    committedSpineIndex = page.spineIndex
    onChapterCommit([
      "spineIndex": page.spineIndex,
      "href": page.href,
      "path": page.path,
      "pageIndex": virtualPageIndex,
      "pagesInChapter": virtualPageCount,
      "firstBlockId": firstVisibleBlockId(page),
      "direction": direction > 0 ? "next" : "previous",
    ])
  }

  // MARK: - ReaderScrollHostDelegate

  func scrollHostDidScroll(_ host: ReaderScrollHost, userDriven: Bool, delta: CGFloat) {
    guard mode == .continuous else { return }
    if userDriven { trackReadingTravel(delta) }
    scrollSettleWork?.cancel()
    let work = DispatchWorkItem { [weak self] in
      self?.creditContinuousExposure()
      self?.dispatchContinuousPageChange(includeSaved: false)
    }
    scrollSettleWork = work
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.18, execute: work)
  }

  func scrollHostWillBeginDragging(_ host: ReaderScrollHost) {
    // A vertical drag closes the lookup.
    clearSelection(fromTap: false, force: true)
    fadeContextSentence()
  }

  func scrollHostDidSettle(_ host: ReaderScrollHost) {
    applyPendingChromeRebind()
  }

  func scrollHostGestureEnded(_ host: ReaderScrollHost) {
    applyPendingChromeRebind()
  }

  private func applyPendingChromeRebind() {
    guard let delta = pendingChromeTopDelta, mode == .continuous, !host.isInteracting else { return }
    pendingChromeTopDelta = nil
    if pages.indices.contains(currentPage) {
      bindVertical(currentPage, target: host.offset + delta, resetScroll: false)
    }
  }

  func scrollHostPullStarted(_ host: ReaderScrollHost, direction: Int) {
    reportReadingDirection(direction)
  }

  func scrollHostEdgePull(_ host: ReaderScrollHost, direction: Int) {
    // The new chapter binds with the current insets.
    pendingChromeTopDelta = nil
    handleEdgePull(direction)
  }

  func scrollHostFocusSwipe(_ host: ReaderScrollHost, direction: Int) {
    guard focusSwipeEnabled else { return }
    _ = moveFocus(direction)
  }

  // MARK: - Focus beam

  private var focusMaxIndex: Int { max(0, focusSentences.count - focusSpanCount) }

  private func clampFocusIndex(_ index: Int) -> Int { min(max(index, 0), focusMaxIndex) }

  private func rebuildFocusSentences() {
    focusSentences = []
    guard let page = pages[safe: currentPage] else { return }
    let textTop = host.textTop
    for (itemIndex, item) in page.items.enumerated() where item.layout.imageFrame == nil && !item.lineRange.isEmpty {
      let layout = item.layout
      let lineFor: (Int) -> Int = { offset in
        item.lineRange.first { NSLocationInRange(offset, layout.lines[$0].range) } ?? item.lineRange.upperBound - 1
      }
      for sentence in layout.sentences {
        let range = NSIntersectionRange(sentence, NSRange(location: 0, length: layout.text.length))
        guard range.length > 0 else { continue }
        let startLine = lineFor(range.location)
        let endLine = lineFor(NSMaxRange(range) - 1)
        let bottom = endLine + 1 < item.lineRange.upperBound
          ? item.lineTop(endLine + 1)
          : item.lineTop(endLine) + layout.lines[endLine].naturalHeight * layout.lineMultiplier
        focusSentences.append(FocusSentence(
          blockId: layout.block.id, itemIndex: itemIndex, range: range,
          topY: textTop + item.lineTop(startLine), bottomY: textTop + bottom
        ))
      }
    }
  }

  private func focusSentenceIndex(blockId: String, offset: Int) -> Int? {
    focusSentences.firstIndex { $0.blockId == blockId && offset >= $0.range.location && offset < NSMaxRange($0.range) }
      ?? focusSentences.firstIndex { $0.blockId == blockId }
  }

  private func spanRanges(_ index: Int) -> [ReaderSourceRange] {
    guard !focusSentences.isEmpty else { return [] }
    let upper = min(index + focusSpanCount, focusSentences.count)
    guard index < upper else { return [] }
    return focusSentences[index..<upper].map { ReaderSourceRange(blockId: $0.blockId, range: $0.range) }
  }

  // Light the span, cross-fading from the old one (300 ms, 140 ms when fast).
  private func setBeam(animated: Bool, fast: Bool) {
    let current = spanRanges(focusIndex)
    let old = marks.focusBeam?.current ?? []
    beamAnimator.stop()
    guard animated, old != current else {
      marks.focusBeam = ReaderFocusBeam(current: current, previous: [], progress: 1)
      pushMarks()
      return
    }
    marks.focusBeam = ReaderFocusBeam(current: current, previous: old, progress: 0)
    pushMarks()
    beamAnimator.run(duration: fast ? 0.14 : 0.3, curve: .ease, step: { [weak self] progress in
      guard let self, self.marks.focusBeam != nil else { return }
      self.marks.focusBeam?.progress = CGFloat(progress)
      self.host.marks = self.marks
    })
  }

  // Scroll the span to its anchor (0.28 of the screen) and lift it above an
  // open panel.
  private func anchorFocus(animated: Bool, fast: Bool) {
    guard mode == .focus, let first = focusSentences[safe: focusIndex] else {
      host.setLift(0, animated: animated)
      host.focusSpanBounds = nil
      return
    }
    let height = bounds.height
    let last = focusSentences[min(focusIndex + focusSpanCount - 1, focusSentences.count - 1)]
    let spanTop = first.topY
    let spanBottom = max(spanTop, last.bottomY)
    let spanHeight = spanBottom - spanTop
    let low = min(1, focusTopMargin / height)
    let ratio = min(max(min(focusAnchorRatio, (height - spanHeight - focusBottomMargin) / height), low), 1)
    let target = min(max((spanTop - height * ratio).rounded(), 0), host.maxScroll)
    let panel = CGFloat(max(0, focusPanelHeight))
    let spanTopOnScreen = spanTop - target
    let lift = panel <= 0 ? 0 : min(max(spanTopOnScreen + spanHeight + focusBottomMargin - (height - panel), 0),
                                    max(0, spanTopOnScreen - focusTopMargin))
    host.setLift(lift, animated: animated)
    let topAligned = min(max((spanTop - lift - focusTopMargin).rounded(), 0), host.maxScroll)
    let bottomAligned = min(max((spanBottom - height + focusBottomMargin).rounded(), 0), host.maxScroll)
    host.focusSpanBounds = bottomAligned > topAligned ? topAligned...bottomAligned : nil
    host.animateOffset(to: target, duration: animated ? (fast ? 0.18 : 0.38) : 0)
  }

  private func focusTo(_ index: Int, animated: Bool, fast: Bool) {
    closeExposure()
    focusIndex = clampFocusIndex(index)
    setBeam(animated: animated, fast: fast)
    anchorFocus(animated: animated, fast: fast)
    onFocusSentenceChange(focusStatePayload(focusIndex, withNext: true))
    dispatchFocusPageChange()
    openFocusExposure()
  }

  // One beam step; the result is focusNav's return value.
  func moveFocus(_ direction: Int) -> [String: Any] {
    if pagedFocusActive { return movePagedFocus(direction) }
    guard mode == .focus, !focusSentences.isEmpty else { return ["moved": false] }
    let next = focusIndex + direction
    if next < 0 {
      onChapterStart([:])
      return ["moved": false, "atStart": true]
    }
    if next > focusMaxIndex {
      onChapterEnd([:])
      return ["moved": false, "atEnd": true]
    }
    let now = CACurrentMediaTime()
    let fast = now - lastFocusMoveAt < 0.45
    lastFocusMoveAt = now
    clearSelection(fromTap: false, force: focusPanelHeight > 0)
    focusTo(next, animated: true, fast: fast)
    var payload = focusStatePayload(focusIndex, withNext: true)
    payload["moved"] = true
    return payload
  }

  func focusNav(_ direction: String) -> [String: Any] {
    switch direction {
    case "next": return moveFocus(1)
    case "prev", "previous": return moveFocus(-1)
    default: return ["moved": false]
    }
  }

  // { index, count, total, text, levelWords, segments, next }
  private func focusStatePayload(_ index: Int, withNext: Bool) -> [String: Any] {
    var payload: [String: Any] = ["index": index, "count": focusSpanCount, "total": focusSentences.count]
    guard let page = pages[safe: currentPage], !focusSentences.isEmpty else { return payload }
    let upper = min(index + focusSpanCount, focusSentences.count)
    guard index < upper else { return payload }
    var texts: [String] = []
    var segments: [[String: Any]] = []
    var levelWords: [[String: Any]] = []
    var at = 0
    for sentence in focusSentences[index..<upper] {
      let layout = page.items[sentence.itemIndex].layout
      let text = layout.text.substring(with: sentence.range)
      texts.append(text)
      segments.append(["blockId": sentence.blockId, "start": sentence.range.location, "end": NSMaxRange(sentence.range), "at": at])
      at += (text as NSString).length + 1
      let words = page.highlights.level
        .filter { $0.blockId == sentence.blockId && !$0.annotationOnly
          && $0.range.location >= sentence.range.location && NSMaxRange($0.range) <= NSMaxRange(sentence.range) }
        .sorted { $0.range.location < $1.range.location }
      for word in words {
        var entry: [String: Any] = [
          "text": collapseSpaces(layout.text.substring(with: word.range)),
          "blockId": word.blockId,
          "sourceStartOffset": word.range.location,
          "sourceEndOffset": NSMaxRange(word.range),
        ]
        if let gloss = word.gloss { entry["gloss"] = gloss }
        if let pinyin = word.pinyin { entry["pinyin"] = pinyin }
        levelWords.append(entry)
      }
    }
    payload["text"] = texts.joined(separator: " ")
    payload["levelWords"] = levelWords
    payload["segments"] = segments
    if withNext {
      if index + 1 <= focusMaxIndex {
        var next = focusStatePayload(index + 1, withNext: false)
        next["moved"] = true
        payload["next"] = next
      } else {
        payload["next"] = ["moved": false, "atEnd": true]
      }
    }
    return payload
  }

  private func dispatchFocusPageChange() {
    guard let page = pages[safe: currentPage] else { return }
    onPageChange([
      "page": focusIndex,
      "total": max(1, focusSentences.count),
      "globalPage": currentPage,
      "globalTotal": pages.count,
      "href": pageHref(page),
      "firstBlockId": focusSentences[safe: focusIndex]?.blockId ?? page.firstBlockId,
      "savedHighlights": page.highlights.savedContexts,
      "spineIndex": page.spineIndex,
    ])
  }

  private func openFocusExposure() {
    guard mode == .focus, let page = pages[safe: currentPage], !focusSentences.isEmpty else { return }
    let index = focusIndex
    let upper = min(index + focusSpanCount, focusSentences.count)
    let span = Array(focusSentences[index..<upper])
    openExposure(key: "focus:\(page.spineIndex):\(index):\(focusSpanCount)") {
      var terms: [String] = []
      var saved: [String] = []
      var chars = 0
      for sentence in span {
        for term in gradedTerms(in: page.highlights, blockId: sentence.blockId, within: sentence.range) where !terms.contains(term) {
          terms.append(term)
        }
        for term in savedTerms(in: page.highlights, blockId: sentence.blockId, within: sentence.range) where !saved.contains(term) {
          saved.append(term)
        }
        chars += sentence.range.length
      }
      return (terms, saved, chars)
    }
  }

  private func focusSpanCountChanged(from old: Int) {
    guard mode == .focus, !focusSentences.isEmpty, min(max(old, 1), 5) != focusSpanCount else { return }
    focusIndex = clampFocusIndex(focusIndex)
    setBeam(animated: true, fast: false)
    anchorFocus(animated: true, fast: false)
    onFocusSentenceChange(focusStatePayload(focusIndex, withNext: true))
  }

  // Fallback stepping for JS without focusNav: the first value is the mount value.
  private func focusNavTokenChanged(from old: String) {
    guard focusNavToken != old else { return }
    guard focusNavTokenSeen else {
      focusNavTokenSeen = true
      return
    }
    let prefix = focusNavToken.split(separator: ":").first.map(String.init) ?? ""
    if prefix == "next" { _ = moveFocus(1) } else if prefix == "prev" || prefix == "previous" { _ = moveFocus(-1) }
  }

  private func focusPanelChanged(from old: Double) {
    guard focusPanelHeight != old else { return }
    if mode == .focus && !focusSentences.isEmpty {
      anchorFocus(animated: true, fast: false)
    } else {
      host.setLift(0, animated: true)
    }
  }

  // MARK: - Listening in paged mode

  private var pagedFocusActive: Bool { pagedFocus && mode == .paged }

  private func sliceRange(_ item: ReaderPageItem) -> NSRange {
    guard !item.lineRange.isEmpty else { return NSRange(location: 0, length: 0) }
    let lines = item.layout.lines
    let start = lines[item.lineRange.lowerBound].range.location
    return NSRange(location: start, length: NSMaxRange(lines[item.lineRange.upperBound - 1].range) - start)
  }

  private func pagedFocusChanged() {
    if pagedFocusActive {
      refreshPagedFocus()
    } else {
      pagedSentences = []
      pagedSpine = nil
      marks.listenSentence = nil
      marks.spokenRange = nil
      pushMarks()
    }
  }

  // Each sentence of the chapter on screen, on the page where it starts.
  private func buildPagedSentences(spine: Int) -> [PagedSentence] {
    var result: [PagedSentence] = []
    var seen = Set<String>()
    for (index, page) in pages.enumerated() where page.spineIndex == spine {
      for item in page.items where item.layout.imageFrame == nil && !item.lineRange.isEmpty {
        let slice = sliceRange(item)
        for sentence in item.layout.sentences where sentence.length > 0 && NSLocationInRange(sentence.location, slice) {
          guard seen.insert("\(item.layout.block.id):\(sentence.location)").inserted else { continue }
          result.append(PagedSentence(blockId: item.layout.block.id, range: sentence, page: index, layout: item.layout))
        }
      }
    }
    return result
  }

  // After a layout, a chapter change or turning listening on: keep the
  // sentence being read, else start from the page on screen.
  private func refreshPagedFocus() {
    guard pagedFocusActive, let page = pages[safe: currentPage] else { return }
    let previous = pagedSentences[safe: pagedIndex]
    let sameChapter = pagedSpine == page.spineIndex
    pagedSpine = page.spineIndex
    pagedSentences = buildPagedSentences(spine: page.spineIndex)
    if sameChapter, let previous,
       let kept = pagedSentences.firstIndex(where: { $0.blockId == previous.blockId && $0.range.location == previous.range.location }) {
      pagedIndex = kept
      lightPagedSentence()
      return
    }
    pagedIndex = pagedSentenceIndexForCurrentPage()
    lightPagedSentence()
    if !sameChapter { onFocusSentenceChange(pagedFocusPayload(pagedIndex, withNext: true)) }
  }

  private func pagedSentenceIndexForCurrentPage() -> Int {
    pagedSentences.firstIndex { $0.page == currentPage }
      ?? pagedSentences.lastIndex { $0.page < currentPage }
      ?? 0
  }

  private func jumpPagedFocusToCurrentPage() {
    guard !pagedSentences.isEmpty else { return }
    pagedIndex = pagedSentenceIndexForCurrentPage()
    lightPagedSentence()
    var payload = pagedFocusPayload(pagedIndex, withNext: true)
    payload["jump"] = true
    onFocusSentenceChange(payload)
  }

  private func pagedSpan(_ index: Int) -> ArraySlice<PagedSentence> {
    let upper = min(index + focusSpanCount, pagedSentences.count)
    return index < upper ? pagedSentences[index..<upper] : []
  }

  private func lightPagedSentence() {
    guard let spine = pagedSpine else { return }
    marks.listenSentence = (spine, pagedSpan(pagedIndex).map { ReaderSourceRange(blockId: $0.blockId, range: $0.range) })
    pushMarks()
  }

  private func movePagedFocus(_ direction: Int) -> [String: Any] {
    guard !pagedSentences.isEmpty else { return ["moved": false] }
    let next = pagedIndex + direction
    if next < 0 {
      onChapterStart([:])
      return ["moved": false, "atStart": true]
    }
    if next > max(0, pagedSentences.count - focusSpanCount) {
      onChapterEnd([:])
      return ["moved": false, "atEnd": true]
    }
    clearSelection(fromTap: false)
    pagedIndex = next
    lightPagedSentence()
    let target = pagedSentences[next].page
    if target != currentPage && !collectionView.isDragging && !collectionView.isDecelerating {
      turnPage(to: target)
    }
    let payload = pagedFocusPayload(pagedIndex, withNext: true)
    onFocusSentenceChange(payload)
    var result = payload
    result["moved"] = true
    return result
  }

  // A programmatic page turn (listening): animated, sends the page event.
  private func turnPage(to index: Int) {
    let width = collectionView.bounds.width
    guard width > 0, pages.indices.contains(index) else { return }
    currentPage = index
    collectionView.setContentOffset(CGPoint(x: CGFloat(index) * width, y: 0), animated: true)
    emitPageChange()
  }

  // Same keys as the focus-mode payload; offsets are into whole blocks.
  private func pagedFocusPayload(_ index: Int, withNext: Bool) -> [String: Any] {
    var payload: [String: Any] = ["index": index, "count": focusSpanCount, "total": pagedSentences.count]
    let span = pagedSpan(index)
    guard !span.isEmpty, let spine = pagedSpine else { return payload }
    var texts: [String] = []
    var segments: [[String: Any]] = []
    var levelWords: [[String: Any]] = []
    var seenWords = Set<String>()
    var at = 0
    for sentence in span {
      let text = sentence.layout.text.substring(with: sentence.range)
      texts.append(text)
      segments.append(["blockId": sentence.blockId, "start": sentence.range.location, "end": NSMaxRange(sentence.range), "at": at])
      at += (text as NSString).length + 1
      for page in pages where page.spineIndex == spine {
        let words = page.highlights.level
          .filter { $0.blockId == sentence.blockId && !$0.annotationOnly
            && $0.range.location >= sentence.range.location && NSMaxRange($0.range) <= NSMaxRange(sentence.range) }
        for word in words where seenWords.insert("\(word.blockId):\(word.range.location)").inserted {
          var entry: [String: Any] = [
            "text": collapseSpaces(sentence.layout.text.substring(with: word.range)),
            "blockId": word.blockId,
            "sourceStartOffset": word.range.location,
            "sourceEndOffset": NSMaxRange(word.range),
          ]
          if let gloss = word.gloss { entry["gloss"] = gloss }
          if let pinyin = word.pinyin { entry["pinyin"] = pinyin }
          levelWords.append(entry)
        }
      }
    }
    levelWords.sort { (($0["sourceStartOffset"] as? Int) ?? 0) < (($1["sourceStartOffset"] as? Int) ?? 0) }
    payload["text"] = texts.joined(separator: " ")
    payload["levelWords"] = levelWords
    payload["segments"] = segments
    if withNext {
      if index + 1 <= max(0, pagedSentences.count - focusSpanCount) {
        var next = pagedFocusPayload(index + 1, withNext: false)
        next["moved"] = true
        payload["next"] = next
      } else {
        payload["next"] = ["moved": false, "atEnd": true]
      }
    }
    return payload
  }

  // MARK: - Selection

  // Where gestures are hit-tested: the current page in paged mode, the
  // chapter's content (through the probe) in the vertical modes.
  private var surface: (view: ReaderPageView, space: UIView)? {
    if isVertical { return host.page == nil ? nil : (host.probe, host.contentView) }
    guard let view = currentPageView else { return nil }
    return (view, view)
  }

  private var currentPageView: ReaderPageView? {
    collectionView.visibleCells
      .compactMap { $0 as? ReaderPageCell }
      .first { collectionView.indexPath(for: $0)?.item == currentPage }?
      .pageView
  }

  private func setSelection(_ next: ReaderSelection?) {
    selection = next
    for cell in collectionView.visibleCells {
      (cell as? ReaderPageCell)?.pageView.selection = next
    }
    host.selection = next
  }

  // Clear any selection. `fromTap` marks clears the reader's own taps caused
  // (JS brings its header back for those); `force` sends the event even with
  // nothing selected.
  private func clearSelection(fromTap: Bool, force: Bool = false) {
    let had = selection != nil
    setSelection(nil)
    selectionAnchor = nil
    if had || force { onSelectionCleared(fromTap ? ["fromTap": true] : [:]) }
  }

  func setSpokenWord(_ word: [String: Any]) {
    guard
      let blockId = word["blockId"] as? String,
      let start = intValue(word["sourceStartOffset"]),
      let end = intValue(word["sourceEndOffset"]),
      end > start,
      let page = pages[safe: currentPage]
    else {
      setSelection(nil)
      return
    }
    setSelection(ReaderSelection(
      kind: .word, spineIndex: page.spineIndex,
      ranges: [ReaderSourceRange(blockId: blockId, range: NSRange(location: start, length: end - start))]
    ))
  }

  // Listen mode: wash the word the voice is reading (offsets into the whole block).
  func setSpokenRange(_ raw: [String: Any]) {
    if let blockId = raw["blockId"] as? String, let start = intValue(raw["start"]), let end = intValue(raw["end"]), end > start,
       let page = pages[safe: currentPage] {
      marks.spokenRange = (page.spineIndex, ReaderSourceRange(blockId: blockId, range: NSRange(location: start, length: end - start)))
      // Listening in pages: follow the voice onto the next page.
      if pagedFocusActive, !collectionView.isDragging, !collectionView.isDecelerating,
         let target = pages.indices.first(where: { index in
           pages[index].spineIndex == page.spineIndex && pages[index].items.contains {
             $0.layout.block.id == blockId && NSLocationInRange(start, sliceRange($0))
           }
         }), target != currentPage {
        turnPage(to: target)
      }
    } else {
      marks.spokenRange = nil
    }
    pushMarks()
  }

  private func placement(for rect: CGRect, in surface: (view: ReaderPageView, space: UIView)) -> String {
    if mode == .focus { return "bottom" }
    if isVertical { return rect.midY - host.offset >= host.viewportHeight / 2 ? "top" : "bottom" }
    return rect.midY >= surface.view.bounds.height / 2 ? "top" : "bottom"
  }

  private func selectWord(_ hit: ReaderWordHit, page: ReaderPage, surface: (view: ReaderPageView, space: UIView)) {
    let layout = hit.item.layout
    setSelection(ReaderSelection(kind: .word, spineIndex: page.spineIndex, ranges: [ReaderSourceRange(blockId: layout.block.id, range: hit.range)]))
    setContextSentence(spine: page.spineIndex, layout: layout, around: hit.range)
    let sliceStart = hit.item.sourceStartOffset
    var payload: [String: Any] = [
      "text": collapseSpaces(layout.text.substring(with: hit.range)),
      "placement": placement(for: hit.rect, in: surface),
      "pageIndex": currentPage,
      "blockId": layout.block.id,
      "sourceStartOffset": hit.range.location,
      "sourceEndOffset": NSMaxRange(hit.range),
      "localStartOffset": hit.range.location - sliceStart,
      "localEndOffset": NSMaxRange(hit.range) - sliceStart,
      "sentence": sentence(in: layout.text, sentences: layout.sentences, containing: hit.range.location),
      "spineIndex": page.spineIndex,
    ]
    if let word = hit.phraseWord, !word.isEmpty { payload["phraseWord"] = word }
    onWordSelected(payload)
  }

  @objc private func handleTap(_ recognizer: UITapGestureRecognizer) {
    guard let surface, let page = surface.view.page else { return }
    let point = recognizer.location(in: surface.space)
    if mode == .focus {
      handleFocusTap(at: point, page: page, surface: surface)
      return
    }
    if selection != nil {
      if surface.view.selectionContains(point) { return }
      // Tapping another word looks it up straight away.
      if let hit = surface.view.wordHit(at: point) {
        selectWord(hit, page: page, surface: surface)
      } else {
        clearSelection(fromTap: true, force: true)
        fadeContextSentence()
      }
      return
    }
    guard let hit = surface.view.wordHit(at: point) else {
      onSelectionCleared(["fromTap": true])
      fadeContextSentence()
      return
    }
    selectWord(hit, page: page, surface: surface)
  }

  private func isInLitSpan(_ blockId: String, _ offset: Int) -> Bool {
    spanRanges(focusIndex).contains { $0.blockId == blockId && NSLocationInRange(offset, $0.range) }
  }

  // Focus taps: with the panel open a word is looked up without moving the
  // beam; otherwise the beam moves to the tapped sentence.
  private func handleFocusTap(at point: CGPoint, page: ReaderPage, surface: (view: ReaderPageView, space: UIView)) {
    var hit = surface.view.wordHit(at: point)
    if focusTapsInSpanOnly, let found = hit, !isInLitSpan(found.item.layout.block.id, found.range.location) { hit = nil }
    if focusPanelHeight > 0 {
      if let hit {
        selectWord(hit, page: page, surface: surface)
      } else {
        clearSelection(fromTap: true, force: true)
      }
      return
    }
    if let hit {
      if let index = focusSentenceIndex(blockId: hit.item.layout.block.id, offset: hit.range.location) {
        focusTo(index, animated: true, fast: false)
      }
      selectWord(hit, page: page, surface: surface)
      return
    }
    if let position = surface.view.textPosition(at: point, allowClosest: false),
       let item = page.items[safe: position.itemIndex],
       !focusTapsInSpanOnly || isInLitSpan(item.layout.block.id, position.offset),
       let index = focusSentenceIndex(blockId: item.layout.block.id, offset: position.offset) {
      focusTo(index, animated: true, fast: false)
    }
    onSelectionCleared(["fromTap": true])
  }

  // MARK: - Text selection

  private func blockLayout(_ blockId: String, spine: Int) -> ReaderBlockLayout? {
    for page in pages where page.spineIndex == spine {
      if let item = page.items.first(where: { $0.layout.block.id == blockId }) { return item.layout }
    }
    return nil
  }

  // The sentence around [start, end) of a block, in source offsets.
  private func sentenceBounds(_ layout: ReaderBlockLayout, start: Int, end: Int) -> NSRange {
    if let match = layout.sentences.first(where: { start >= $0.location && start <= NSMaxRange($0) }), match.length > 0 {
      return match
    }
    let text = layout.text
    let boundaries: Set<unichar> = Set(".!?。！？\n".utf16)
    var lower = start
    while lower > 0 && !boundaries.contains(text.character(at: lower - 1)) { lower -= 1 }
    var upper = max(end, lower)
    while upper < text.length && !boundaries.contains(text.character(at: upper)) { upper += 1 }
    if upper < text.length && text.character(at: upper) != 0x0A { upper += 1 }
    return NSRange(location: lower, length: upper - lower)
  }

  private func before(_ a: ReaderTextPosition, _ b: ReaderTextPosition) -> Bool {
    (a.itemIndex, a.offset) < (b.itemIndex, b.offset)
  }

  // Selection from `fixed` to `focus` snapped to word edges (either order);
  // a light tick each time it reaches a new word.
  private func selectBetween(_ fixedStart: ReaderTextPosition, _ fixedEnd: ReaderTextPosition, focus: ReaderTextPosition,
                             view: ReaderPageView, page: ReaderPage) {
    let ranges: [ReaderSourceRange]
    let edge: ReaderTextPosition
    if before(focus, fixedStart) {
      edge = view.snapped(focus, asEnd: false)
      ranges = view.sourceRanges(from: edge, to: fixedEnd)
    } else if before(fixedEnd, focus) {
      edge = view.snapped(focus, asEnd: true)
      ranges = view.sourceRanges(from: fixedStart, to: edge)
    } else {
      edge = fixedEnd
      ranges = view.sourceRanges(from: fixedStart, to: fixedEnd)
    }
    guard !ranges.isEmpty else { return }
    if lastSelectionEdge.map({ $0 != (edge.itemIndex, edge.offset) }) ?? true {
      if lastSelectionEdge != nil { selectionHaptic.selectionChanged() }
      lastSelectionEdge = (edge.itemIndex, edge.offset)
    }
    setSelection(ReaderSelection(kind: .text, spineIndex: page.spineIndex, ranges: ranges))
  }

  private func setScrollingEnabled(_ enabled: Bool) {
    collectionView.isScrollEnabled = enabled
    if mode == .continuous { host.scrollView.isScrollEnabled = enabled }
  }

  // A long press selects the word under the finger; moving the finger then
  // extends it word by word, and releasing sends onTextSelected.
  @objc private func handleLongPress(_ recognizer: UILongPressGestureRecognizer) {
    guard let surface, let page = surface.view.page else { return }
    let view = surface.view
    let point = recognizer.location(in: surface.space)
    switch recognizer.state {
    case .began:
      guard let hit = view.wordHit(at: point),
            let itemIndex = page.items.firstIndex(where: { $0.layout === hit.item.layout && NSLocationInRange(hit.range.location, view.sliceRange(of: $0)) })
      else { return }
      selectionAnchor = (
        ReaderTextPosition(itemIndex: itemIndex, offset: hit.range.location),
        ReaderTextPosition(itemIndex: itemIndex, offset: NSMaxRange(hit.range))
      )
      selectionDragStarted = false
      lastSelectionEdge = nil
      longPressStart = point
      selectionHaptic.prepare()
      setScrollingEnabled(false)
      setSelection(ReaderSelection(kind: .text, spineIndex: page.spineIndex, ranges: [ReaderSourceRange(blockId: hit.item.layout.block.id, range: hit.range)]))
    case .changed:
      guard let anchor = selectionAnchor else { return }
      if !selectionDragStarted {
        guard abs(point.x - longPressStart.x) >= 8 || abs(point.y - longPressStart.y) >= 8 else { return }
        selectionDragStarted = true
      }
      guard let focus = view.textPosition(at: point, allowClosest: true) else { return }
      selectBetween(anchor.start, anchor.end, focus: focus, view: view, page: page)
    case .ended:
      finishTextSelection()
    case .cancelled, .failed:
      if selectionAnchor != nil { setSelection(nil) }
      selectionAnchor = nil
      setScrollingEnabled(true)
    default:
      break
    }
  }

  @objc private func handleHandlePan(_ recognizer: UIPanGestureRecognizer) {
    guard let surface, let page = surface.view.page else { return }
    let view = surface.view
    let point = recognizer.location(in: surface.space)
    switch recognizer.state {
    case .began:
      let down = convert(gate.touchDown, to: surface.space)
      guard let handle = view.handleHit(at: down), let endpoints = view.selectionEndpoints(),
            let handlePoint = view.handlePoint(handle) else { return }
      draggedHandle = handle
      handleFixedEnd = handle == .start ? endpoints.end : endpoints.start
      // Keep the finger's offset from the handle, so the text under the
      // handle (not under the finger) follows.
      handleGrabOffset = CGPoint(x: handlePoint.x - down.x, y: handlePoint.y - down.y)
      handleDragOriginal = selection
      lastSelectionEdge = nil
      selectionHaptic.prepare()
      setScrollingEnabled(false)
    case .changed:
      guard let fixed = handleFixedEnd else { return }
      let target = CGPoint(x: point.x + handleGrabOffset.x, y: point.y + handleGrabOffset.y)
      guard let focus = view.textPosition(at: target, allowClosest: true) else { return }
      selectBetween(fixed, fixed, focus: focus, view: view, page: page)
    case .ended:
      draggedHandle = nil
      handleFixedEnd = nil
      handleDragOriginal = nil
      finishTextSelection()
    case .cancelled, .failed:
      setSelection(handleDragOriginal)
      draggedHandle = nil
      handleFixedEnd = nil
      handleDragOriginal = nil
      setScrollingEnabled(true)
    default:
      break
    }
  }

  private func finishTextSelection() {
    selectionAnchor = nil
    setScrollingEnabled(true)
    guard let selection, selection.kind == .text, let payload = textSelectionPayload(selection) else {
      if selection != nil {
        setSelection(nil)
        onSelectionCleared(["fromTap": true])
      }
      return
    }
    fadeContextSentence()
    onTextSelected(payload)
  }

  // Ranges sorted in reading order: by where each block first appears, then offset.
  private func orderedRanges(_ selection: ReaderSelection) -> [ReaderSourceRange] {
    let order: (String) -> Int = { blockId in
      self.pages.firstIndex { $0.spineIndex == selection.spineIndex && $0.contains(blockId: blockId) } ?? Int.max
    }
    return selection.ranges.sorted { (order($0.blockId), $0.range.location) < (order($1.blockId), $1.range.location) }
  }

  // The sentence(s) covering [start, end) of a block, by punctuation scan.
  private func sentenceForOffsets(_ text: NSString, start: Int, end: Int) -> String {
    let boundaries: Set<unichar> = Set(".!?。！？\n".utf16)
    var lower = min(max(start, 0), text.length)
    var upper = min(max(end, lower), text.length)
    while lower > 0 && !boundaries.contains(text.character(at: lower - 1)) { lower -= 1 }
    while upper < text.length && !boundaries.contains(text.character(at: upper)) { upper += 1 }
    if upper < text.length && text.character(at: upper) != 0x0A { upper += 1 }
    let result = text.substring(with: NSRange(location: lower, length: upper - lower)).trimmingCharacters(in: .whitespacesAndNewlines)
    return result.isEmpty ? (text as String).trimmingCharacters(in: .whitespacesAndNewlines) : result
  }

  private func textSelectionPayload(_ selection: ReaderSelection) -> [String: Any]? {
    let ordered = orderedRanges(selection)
    var text = ""
    var lastBlock: String?
    var lastEnd = -1
    for part in ordered {
      guard let layout = blockLayout(part.blockId, spine: selection.spineIndex) else { continue }
      let range = NSIntersectionRange(part.range, NSRange(location: 0, length: layout.text.length))
      let contiguous = part.blockId == lastBlock && range.location <= lastEnd
      var piece = layout.text.substring(with: range)
      if !contiguous { piece = piece.trimmingCharacters(in: .whitespacesAndNewlines) }
      if !piece.isEmpty {
        if !text.isEmpty && !contiguous { text += "\n" }
        text += piece
      }
      lastBlock = part.blockId
      lastEnd = NSMaxRange(range)
    }
    text = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return nil }

    // One entry per page (paged) or chapter (vertical) the selection touches.
    var ranges: [[String: Any]] = []
    for part in ordered {
      for (index, page) in pages.enumerated() where page.spineIndex == selection.spineIndex {
        for item in page.items where item.layout.block.id == part.blockId && !item.lineRange.isEmpty {
          let lines = item.layout.lines
          let sliceStart = lines[item.lineRange.lowerBound].range.location
          let slice = NSRange(location: sliceStart, length: NSMaxRange(lines[item.lineRange.upperBound - 1].range) - sliceStart)
          let overlap = NSIntersectionRange(part.range, slice)
          guard overlap.length > 0 else { continue }
          ranges.append([
            "pageIndex": index,
            "blockId": part.blockId,
            "sourceStartOffset": overlap.location,
            "sourceEndOffset": NSMaxRange(overlap),
            "spineIndex": selection.spineIndex,
          ])
        }
      }
    }
    var payload: [String: Any] = ["text": text, "placement": selectionPlacement(), "ranges": ranges]
    if let first = ranges.first {
      for key in ["pageIndex", "blockId", "sourceStartOffset", "spineIndex"] {
        payload[key] = first[key]
      }
      payload["sourceEndOffset"] = ranges.last?["sourceEndOffset"]
    }
    if let first = ordered.first, let layout = blockLayout(first.blockId, spine: selection.spineIndex) {
      let end = ordered.last { $0.blockId == first.blockId }.map { NSMaxRange($0.range) } ?? NSMaxRange(first.range)
      payload["sentence"] = sentenceForOffsets(layout.text, start: first.range.location, end: end)
    }
    return payload
  }

  private func selectionPlacement() -> String {
    guard let surface else { return "bottom" }
    let boxes = surface.view.selectionBoxes()
    let rect = boxes.isEmpty ? CGRect(origin: longPressStart, size: .zero) : boxes.dropFirst().reduce(boxes[0]) { $0.union($1) }
    return placement(for: rect, in: surface)
  }

  // Grow the text selection by one sentence: within its paragraph first
  // (which can reach onto the next page), else into the neighbouring
  // paragraph on this page. Re-sends onTextSelected.
  func extendSelection(_ direction: String) -> Bool {
    guard let selection, selection.kind == .text else { return false }
    let backward = direction == "prev" || direction == "previous"
    guard backward || direction == "next" else { return false }

    let blockIds = Set(selection.ranges.map(\.blockId))
    if blockIds.count == 1, let blockId = blockIds.first, let layout = blockLayout(blockId, spine: selection.spineIndex) {
      let start = selection.ranges.map(\.range.location).min() ?? 0
      let end = selection.ranges.map { NSMaxRange($0.range) }.max() ?? 0
      let spans = layout.sentences.filter { $0.length > 0 }
      let newStart = backward ? spans.last(where: { $0.location < start })?.location : start
      let newEnd = backward ? end : spans.first(where: { NSMaxRange($0) > end }).map { NSMaxRange($0) }
      if let newStart, let newEnd {
        publishExtended(ReaderSelection(kind: .text, spineIndex: selection.spineIndex,
          ranges: [ReaderSourceRange(blockId: blockId, range: NSRange(location: newStart, length: newEnd - newStart))]))
        return true
      }
    }

    guard let surface, let page = surface.view.page, let endpoints = surface.view.selectionEndpoints() else { return false }
    let view = surface.view
    let items = page.items
    if backward {
      for index in stride(from: endpoints.start.itemIndex - 1, through: 0, by: -1) {
        guard let last = items[index].layout.sentences.last(where: { $0.length > 0 }) else { continue }
        let from = ReaderTextPosition(itemIndex: index, offset: max(last.location, view.sliceRange(of: items[index]).location))
        publishExtended(ReaderSelection(kind: .text, spineIndex: page.spineIndex, ranges: view.sourceRanges(from: from, to: endpoints.end)))
        return true
      }
    } else {
      for index in (endpoints.end.itemIndex + 1)..<max(items.count, endpoints.end.itemIndex + 1) {
        guard let first = items[index].layout.sentences.first(where: { $0.length > 0 }) else { continue }
        let to = ReaderTextPosition(itemIndex: index, offset: min(NSMaxRange(first), NSMaxRange(view.sliceRange(of: items[index]))))
        publishExtended(ReaderSelection(kind: .text, spineIndex: page.spineIndex, ranges: view.sourceRanges(from: endpoints.start, to: to)))
        return true
      }
    }
    return false
  }

  private func publishExtended(_ next: ReaderSelection) {
    guard !next.ranges.isEmpty else { return }
    setSelection(next)
    if let payload = textSelectionPayload(next) { onTextSelected(payload) }
  }

  // MARK: - Paged events

  private func emitPageChange() {
    guard let page = pages[safe: currentPage] else { return }
    onPageChange([
      "page": page.chapterPageIndex,
      "total": page.chapterPageCount,
      "globalPage": currentPage,
      "globalTotal": pages.count,
      "href": pageHref(page),
      "firstBlockId": page.firstBlockId,
      "savedHighlights": page.highlights.savedContexts,
      "spineIndex": page.spineIndex,
    ])
    openPagedExposure(page)
  }

  // The pager came to rest: send any edge swipe, then a chapter commit if the
  // page now showing belongs to another chapter.
  private func pagerDidSettle() {
    let width = collectionView.bounds.width
    if width > 0 {
      currentPage = min(max(Int((collectionView.contentOffset.x / width).rounded()), 0), max(pages.count - 1, 0))
    }
    if pagedFocusActive {
      if pages[safe: currentPage]?.spineIndex != pagedSpine {
        refreshPagedFocus()
      } else if userTurnedPage {
        jumpPagedFocusToCurrentPage()
      }
    }
    userTurnedPage = false
    if let edge = pendingEdge {
      pendingEdge = nil
      reportReadingDirection(edge === onChapterEnd ? 1 : -1)
      edge([:])
    }
    guard let page = pages[safe: currentPage], page.spineIndex != committedSpineIndex else { return }
    let direction = committedSpineIndex.map { page.spineIndex > $0 ? "next" : "previous" } ?? "none"
    committedSpineIndex = page.spineIndex
    onChapterCommit([
      "spineIndex": page.spineIndex,
      "href": page.href,
      "path": page.path,
      "pageIndex": page.chapterPageIndex,
      "pagesInChapter": page.chapterPageCount,
      "firstBlockId": page.firstBlockId,
      "direction": direction,
    ])
  }

  // MARK: - UICollectionView

  func collectionView(_ collectionView: UICollectionView, numberOfItemsInSection section: Int) -> Int {
    isVertical ? 0 : pages.count
  }

  func collectionView(_ collectionView: UICollectionView, cellForItemAt indexPath: IndexPath) -> UICollectionViewCell {
    let cell = collectionView.dequeueReusableCell(withReuseIdentifier: ReaderPageCell.reuseIdentifier, for: indexPath)
    if let cell = cell as? ReaderPageCell {
      cell.pageView.palette = palette
      cell.pageView.selection = selection
      cell.pageView.marks = marks
      cell.pageView.contentOrigin = CGPoint(x: ReaderPageView.insets.left, y: ReaderPageView.insets.top)
      cell.pageView.page = pages[safe: indexPath.item]
    }
    return cell
  }

  func collectionView(_ collectionView: UICollectionView, layout: UICollectionViewLayout, sizeForItemAt indexPath: IndexPath) -> CGSize {
    collectionView.bounds.size
  }

  func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
    guard scrollView === collectionView else { return }
    dragStartPage = currentPage
    pendingEdge = nil
    lastPagerOffset = scrollView.contentOffset.x
    // Turning the page closes the lookup.
    clearSelection(fromTap: false)
    fadeContextSentence()
  }

  func scrollViewDidScroll(_ scrollView: UIScrollView) {
    guard scrollView === collectionView else { return }
    let x = scrollView.contentOffset.x
    if scrollView.isDragging { trackReadingTravel(x - lastPagerOffset) }
    lastPagerOffset = x
    updateProgressThumb()
  }

  // Full screen only: a thin bar at the bottom showing the place in the
  // chapter; it follows the finger within a chapter and holds at the end
  // across a chapter boundary.
  private func updateProgressThumb() {
    guard fullscreen, mode == .paged, !pages.isEmpty else { return }
    let width = collectionView.bounds.width
    guard width > 0 else { return }
    let position = collectionView.contentOffset.x / width
    let index = min(max(Int(floor(position)), 0), pages.count - 1)
    let page = pages[index]
    let count = page.chapterPageCount
    guard count > 1 else {
      progressThumb.hide()
      return
    }
    var chapterPosition = CGFloat(page.chapterPageIndex) + (position - CGFloat(index))
    // Dragging past the chapter's last page holds at the end.
    chapterPosition = min(max(chapterPosition, 0), CGFloat(count - 1))
    progressThumb.show(fraction: chapterPosition / CGFloat(count - 1), pageCount: count)
  }

  func scrollViewWillEndDragging(_ scrollView: UIScrollView, withVelocity velocity: CGPoint, targetContentOffset: UnsafeMutablePointer<CGPoint>) {
    guard scrollView === collectionView else { return }
    let width = scrollView.bounds.width
    guard width > 0 else { return }
    let target = min(max(Int((targetContentOffset.pointee.x / width).rounded()), 0), max(pages.count - 1, 0))
    if target != currentPage {
      userTurnedPage = true
      reportReadingDirection(target > dragStartPage ? 1 : -1)
      currentPage = target
      emitPageChange()
      return
    }
    // A swipe past either end of the window asks JS for the next chapter.
    let translation = scrollView.panGestureRecognizer.translation(in: scrollView).x
    if target == dragStartPage {
      if target == pages.count - 1 && translation < -edgeSwipeSlop {
        pendingEdge = onChapterEnd
      } else if target == 0 && translation > edgeSwipeSlop {
        pendingEdge = onChapterStart
      }
    }
  }

  func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) {
    guard scrollView === collectionView else { return }
    pagerDidSettle()
  }

  func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
    guard scrollView === collectionView else { return }
    if !decelerate { pagerDidSettle() }
  }
}
