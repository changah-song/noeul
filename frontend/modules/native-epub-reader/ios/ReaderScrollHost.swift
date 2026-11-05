import UIKit

// Scroll and focus modes: one chapter as one tall page in a vertical scroll
// view. The chapter is drawn by viewport-height tiles (each a ReaderPageView
// showing its band), recycled as the reader scrolls, so a long chapter never
// needs one giant backing store. A probe page view, never drawn, answers hit
// tests in content coordinates.

protocol ReaderScrollHostDelegate: AnyObject {
  // The offset changed; `userDriven` while a finger or fling moves it.
  func scrollHostDidScroll(_ host: ReaderScrollHost, userDriven: Bool, delta: CGFloat)
  func scrollHostWillBeginDragging(_ host: ReaderScrollHost)
  func scrollHostDidSettle(_ host: ReaderScrollHost)
  func scrollHostPullStarted(_ host: ReaderScrollHost, direction: Int)
  func scrollHostEdgePull(_ host: ReaderScrollHost, direction: Int)
  func scrollHostFocusSwipe(_ host: ReaderScrollHost, direction: Int)
  // The finger lifted (with or without scrolling).
  func scrollHostGestureEnded(_ host: ReaderScrollHost)
}

private let pullSpace: CGFloat = 96
private let pullFullDistance: CGFloat = 120
private let pullFollow: CGFloat = 72
private let focusSwipeDistance: CGFloat = 28

final class ReaderScrollHost: UIView, UIScrollViewDelegate {
  weak var delegate: ReaderScrollHostDelegate?

  let scrollView = UIScrollView()
  let contentView = UIView()
  // Geometry and hit tests in content coordinates.
  let probe = ReaderPageView(frame: .zero)

  private var tiles: [Int: ReaderPageView] = [:]
  private var spareTiles: [ReaderPageView] = []
  private let ring = PullRingView()

  private(set) var page: ReaderPage?
  private(set) var textTop: CGFloat = 30
  private(set) var contentHeight: CGFloat = 0

  var palette = ReaderPalette.make(theme: "light", tokens: [:]) {
    didSet {
      backgroundColor = palette.background
      scrollView.backgroundColor = palette.background
      scrollView.indicatorStyle = palette.isDark ? .white : .black
      forEachPageView { $0.palette = palette }
      ring.setNeedsDisplay()
    }
  }
  var selection: ReaderSelection? {
    didSet { forEachPageView { $0.selection = selection } }
  }
  var marks = ReaderMarkOptions() {
    didSet { forEachPageView { $0.marks = marks } }
  }

  var chromeTop: CGFloat = 0
  var pullNextEnabled = false
  var pullPreviousEnabled = false
  // Focus mode: no free scrolling; vertical swipes step the beam. A span
  // taller than the screen can still be dragged within these offsets.
  var focusSwipeMode = false {
    didSet {
      scrollView.isScrollEnabled = !focusSwipeMode
      focusPan.isEnabled = focusSwipeMode
    }
  }
  var focusSpanBounds: ClosedRange<CGFloat>?

  // Offset when the current touch went down (pulls must start at the edge).
  private(set) var touchDownOffset: CGFloat = 0
  // Set while the reader is scrolled by hand or by a fling.
  private(set) var userDriven = false
  private var suppressScrollEvents = false

  private var pullDirection = 0
  private var pullStartY: CGFloat = 0
  private var pullDistance: CGFloat = 0
  private var lastPanY: CGFloat = 0
  private var pullWasFull = false
  private let pullAnimator = FrameAnimator()
  private let scrollAnimator = FrameAnimator()
  private let haptic = UISelectionFeedbackGenerator()

  private let focusPan = UIPanGestureRecognizer()
  private var focusPanStartY: CGFloat = 0
  private var focusPanLastY: CGFloat = 0
  private var focusDownAtSpanTop = true
  private var focusDownAtSpanBottom = true
  private var liftAnimator: UIViewPropertyAnimator?
  private(set) var lift: CGFloat = 0

  override init(frame: CGRect) {
    super.init(frame: frame)
    scrollView.bounces = false
    scrollView.alwaysBounceVertical = false
    scrollView.contentInsetAdjustmentBehavior = .never
    scrollView.showsHorizontalScrollIndicator = false
    scrollView.delegate = self
    scrollView.panGestureRecognizer.addTarget(self, action: #selector(handleScrollPan(_:)))
    addSubview(scrollView)
    scrollView.addSubview(contentView)
    ring.host = self
    ring.isUserInteractionEnabled = false
    ring.isOpaque = false
    ring.backgroundColor = .clear
    addSubview(ring)
    focusPan.addTarget(self, action: #selector(handleFocusPan(_:)))
    focusPan.isEnabled = false
    scrollView.addGestureRecognizer(focusPan)
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  var offset: CGFloat { scrollView.contentOffset.y }
  var viewportHeight: CGFloat { bounds.height }
  var maxScroll: CGFloat { max(0, contentHeight - bounds.height) }
  var pullShift: CGFloat { pullFollow * (1 - exp(-pullDistance / pullFollow)) }
  var pullProgress: CGFloat { min(1, pullDistance / pullFullDistance) }
  var activePullDirection: Int { pullDirection }
  // A finger on the page or a pull still springing back.
  var isInteracting: Bool { scrollView.isTracking || pullDirection != 0 || pullAnimator.isRunning }

  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    if event?.type == .touches {
      touchDownOffset = offset
      userDriven = true
    }
    return super.hitTest(point, with: event)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    scrollView.frame = bounds
    ring.frame = bounds
    if page != nil { applyContentGeometry() }
    updateTiles()
  }

  // MARK: - Binding

  // Show a chapter page; `target` sets the offset, else the current one is kept (clamped).
  func bind(page: ReaderPage, textTop: CGFloat, contentHeight: CGFloat, target: CGFloat?) {
    self.page = page
    self.textTop = textTop
    self.contentHeight = max(contentHeight, bounds.height)
    userDriven = false
    for tile in tiles.values {
      tile.removeFromSuperview()
      spareTiles.append(tile)
    }
    tiles.removeAll()
    probe.page = page
    probe.contentOrigin = CGPoint(x: ReaderPageView.insets.left, y: textTop)
    applyContentGeometry()
    setOffset(target ?? offset)
    ring.setNeedsDisplay()
  }

  private func applyContentGeometry() {
    let width = bounds.width
    contentView.bounds = CGRect(x: 0, y: 0, width: width, height: contentHeight)
    contentView.center = CGPoint(x: width / 2, y: contentHeight / 2)
    scrollView.contentSize = CGSize(width: width, height: contentHeight)
    probe.frame = CGRect(x: 0, y: 0, width: width, height: contentHeight)
  }

  func setOffset(_ y: CGFloat) {
    suppressScrollEvents = true
    // Not contentOffset =: this also stops a fling still running.
    scrollView.setContentOffset(CGPoint(x: 0, y: min(max(y, 0), maxScroll)), animated: false)
    suppressScrollEvents = false
    updateTiles()
    ring.setNeedsDisplay()
  }

  func setIndicatorInsets(top: CGFloat, bottom: CGFloat) {
    scrollView.verticalScrollIndicatorInsets = UIEdgeInsets(top: top, left: 0, bottom: bottom, right: 0)
  }

  // Every tile and the probe.
  func forEachPageView(_ body: (ReaderPageView) -> Void) {
    body(probe)
    tiles.values.forEach(body)
  }

  func redrawTiles() {
    tiles.values.forEach { $0.setNeedsDisplay() }
  }

  private func updateTiles() {
    let height = bounds.height
    guard height > 0, let page else { return }
    let y = offset
    let count = max(1, Int(ceil(contentHeight / height)))
    let first = max(0, Int(floor((y - height * 0.5) / height)))
    let last = min(count - 1, Int(floor((y + height * 1.5) / height)))
    for (index, tile) in tiles where index < first || index > last {
      tile.removeFromSuperview()
      spareTiles.append(tile)
      tiles[index] = nil
    }
    guard first <= last else { return }
    for (index, tile) in tiles {
      tile.viewportOffsetY = CGFloat(index) * height - y
      tile.viewportHeight = height
    }
    for index in first...last where tiles[index] == nil {
      let tile = spareTiles.popLast() ?? ReaderPageView(frame: .zero)
      tile.frame = CGRect(x: 0, y: CGFloat(index) * height, width: bounds.width, height: height)
      tile.palette = palette
      tile.marks = marks
      tile.selection = selection
      tile.page = page
      tile.contentOrigin = CGPoint(x: ReaderPageView.insets.left, y: textTop - CGFloat(index) * height)
      tile.viewportOffsetY = CGFloat(index) * height - y
      tile.viewportHeight = height
      tile.setNeedsDisplay()
      contentView.addSubview(tile)
      tiles[index] = tile
    }
  }

  // MARK: - Scrolling

  private var lastOffset: CGFloat = 0

  func scrollViewDidScroll(_ scrollView: UIScrollView) {
    if pullDirection != 0 && scrollView.isTracking {
      // While pulling, the content follows the finger, not the scroll.
      let edge = pullDirection > 0 ? maxScroll : 0
      if abs(offset - edge) > 0.5 { setOffset(edge) }
    }
    updateTiles()
    ring.setNeedsDisplay()
    let delta = offset - lastOffset
    lastOffset = offset
    guard !suppressScrollEvents else { return }
    delegate?.scrollHostDidScroll(self, userDriven: userDriven && (scrollView.isTracking || scrollView.isDragging || scrollView.isDecelerating), delta: delta)
  }

  func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
    scrollAnimator.stop()
    delegate?.scrollHostWillBeginDragging(self)
  }

  // A pull never flings: the content stays at the edge it was pulled from.
  func scrollViewWillEndDragging(_ scrollView: UIScrollView, withVelocity velocity: CGPoint,
                                 targetContentOffset: UnsafeMutablePointer<CGPoint>) {
    if pullDirection != 0 { targetContentOffset.pointee = scrollView.contentOffset }
  }

  func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
    if !decelerate { delegate?.scrollHostDidSettle(self) }
  }

  func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) {
    delegate?.scrollHostDidSettle(self)
  }

  var isDecelerating: Bool { scrollView.isDecelerating }

  // Eased scroll for the focus beam.
  func animateOffset(to target: CGFloat, duration: CFTimeInterval) {
    let goal = min(max(target, 0), maxScroll)
    if duration <= 0 || abs(goal - offset) < 2 {
      scrollAnimator.stop()
      setOffset(goal)
      return
    }
    let from = offset
    scrollAnimator.run(duration: duration, curve: .easeOutCubic) { [weak self] progress in
      self?.setOffset(from + (goal - from) * CGFloat(progress))
    }
  }

  func stopScrollAnimation() {
    scrollAnimator.stop()
  }

  // Focus mode: lifts the content so the lit sentence stays above the panel.
  func setLift(_ value: CGFloat, animated: Bool) {
    guard value != lift else { return }
    lift = value
    liftAnimator?.stopAnimation(true)
    let apply = { self.contentView.transform = CGAffineTransform(translationX: 0, y: -value) }
    guard animated else {
      apply()
      return
    }
    let animator = UIViewPropertyAnimator(
      duration: 0.45,
      timingParameters: UICubicTimingParameters(controlPoint1: CGPoint(x: 0.22, y: 0.61), controlPoint2: CGPoint(x: 0.36, y: 1))
    )
    animator.addAnimations(apply)
    animator.startAnimation()
    liftAnimator = animator
  }

  // MARK: - Chapter pull

  @objc private func handleScrollPan(_ pan: UIPanGestureRecognizer) {
    let y = pan.location(in: self).y
    switch pan.state {
    case .began:
      pullAnimator.stop()
      resetPull()
      lastPanY = y
    case .changed:
      if pullDirection == 0 {
        let movingUp = y < lastPanY
        let movingDown = y > lastPanY
        if pullNextEnabled && touchDownOffset >= maxScroll - 0.5 && movingUp && offset >= maxScroll - 0.5 {
          startPull(1, at: y)
        } else if pullPreviousEnabled && touchDownOffset <= 0.5 && movingDown && offset <= 0.5 {
          startPull(-1, at: y)
        }
      } else {
        pullDistance = max(0, (pullStartY - y) * CGFloat(pullDirection))
        let full = pullProgress >= 1
        if full && !pullWasFull { haptic.selectionChanged() }
        pullWasFull = full
        applyPullShift()
      }
      lastPanY = y
    case .ended, .cancelled, .failed:
      defer { DispatchQueue.main.async { self.delegate?.scrollHostGestureEnded(self) } }
      guard pullDirection != 0 else { return }
      let direction = pullDirection
      if pan.state == .ended && pullProgress >= 1 {
        // The chapter changes under the finger: no spring back.
        resetPull()
        delegate?.scrollHostEdgePull(self, direction: direction)
        return
      }
      let from = pullDistance
      pullAnimator.run(duration: 0.22, curve: .ease, step: { [weak self] progress in
        self?.pullDistance = from * CGFloat(1 - progress)
        self?.applyPullShift()
      }, completion: { [weak self] in
        guard let self else { return }
        self.resetPull()
        self.delegate?.scrollHostGestureEnded(self)
      })
    default:
      break
    }
  }

  private func startPull(_ direction: Int, at y: CGFloat) {
    pullDirection = direction
    pullStartY = y
    pullDistance = 0
    pullWasFull = false
    haptic.prepare()
    delegate?.scrollHostPullStarted(self, direction: direction)
  }

  private func resetPull() {
    pullDirection = 0
    pullDistance = 0
    pullWasFull = false
    applyPullShift()
  }

  private func applyPullShift() {
    if !focusSwipeMode {
      contentView.transform = CGAffineTransform(translationX: 0, y: -CGFloat(pullDirection) * pullShift)
    }
    ring.setNeedsDisplay()
  }

  // MARK: - Focus swipes

  @objc private func handleFocusPan(_ pan: UIPanGestureRecognizer) {
    let y = pan.location(in: self).y
    switch pan.state {
    case .began:
      focusPanStartY = y - pan.translation(in: self).y
      focusPanLastY = y
      if let bounds = focusSpanBounds {
        focusDownAtSpanTop = touchDownOffset <= bounds.lowerBound + 0.5
        focusDownAtSpanBottom = touchDownOffset >= bounds.upperBound - 0.5
      } else {
        focusDownAtSpanTop = true
        focusDownAtSpanBottom = true
      }
      delegate?.scrollHostWillBeginDragging(self)
    case .changed:
      if let bounds = focusSpanBounds {
        setOffset(min(max(offset + (focusPanLastY - y), bounds.lowerBound), bounds.upperBound))
      }
      focusPanLastY = y
    case .ended:
      let dy = y - focusPanStartY
      guard abs(dy) >= focusSwipeDistance else { return }
      let direction = dy < 0 ? 1 : -1
      let bounds = focusSpanBounds
      if direction > 0 && focusDownAtSpanBottom && (bounds == nil || offset >= bounds!.upperBound - 0.5) {
        delegate?.scrollHostFocusSwipe(self, direction: 1)
      } else if direction < 0 && focusDownAtSpanTop && (bounds == nil || offset <= bounds!.lowerBound + 0.5) {
        delegate?.scrollHostFocusSwipe(self, direction: -1)
      }
    default:
      break
    }
  }
}

// The "pull for the next chapter" ring: in the empty space after the text,
// filling clockwise as the reader pulls; "let go" once it's full.
final class PullRingView: UIView {
  weak var host: ReaderScrollHost?

  override func draw(_ rect: CGRect) {
    guard let host, !host.focusSwipeMode, let context = UIGraphicsGetCurrentContext() else { return }
    let direction = host.activePullDirection
    let shift = host.pullShift
    if host.pullNextEnabled {
      let revealed = min(max(host.offset - (host.maxScroll - pullSpace), 0), pullSpace)
      let alpha = direction > 0 ? 1 : revealed / pullSpace
      if alpha > 0.01 {
        let gap = pullSpace + (direction > 0 ? shift : 0)
        let progress = direction > 0 ? host.pullProgress : 0
        drawIndicator(context, y: bounds.height - gap / 2, alpha: alpha, progress: progress,
                      label: ReaderStrings.t(progress >= 1 ? "releaseNext" : "pullNext"), palette: host.palette)
      }
    }
    if direction < 0 {
      let alpha = min(max(shift / 24, 0), 1)
      if alpha > 0.01 {
        let progress = host.pullProgress
        drawIndicator(context, y: host.chromeTop + shift / 2, alpha: alpha, progress: progress,
                      label: ReaderStrings.t(progress >= 1 ? "releasePrevious" : "pullPrevious"), palette: host.palette)
      }
    }
  }

  private func drawIndicator(_ context: CGContext, y: CGFloat, alpha: CGFloat, progress: CGFloat, label: String, palette: ReaderPalette) {
    let radius: CGFloat = 9
    let font = UIFont.systemFont(ofSize: 13)
    let text = NSAttributedString(string: label, attributes: [.font: font, .foregroundColor: palette.bodyText.withAlphaComponent(alpha * 0.72)])
    let labelWidth = text.size().width
    let groupWidth = radius * 2 + 8 + labelWidth
    let startX = (bounds.width - groupWidth) / 2
    let center = CGPoint(x: startX + radius, y: y)

    context.saveGState()
    context.setLineWidth(1.6)
    context.setStrokeColor(palette.rule.withAlphaComponent(alpha).cgColor)
    context.strokeEllipse(in: CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2))
    if progress > 0 {
      context.setStrokeColor(palette.bodyText.withAlphaComponent(alpha).cgColor)
      context.setLineCap(.round)
      context.addArc(center: center, radius: radius, startAngle: -.pi / 2, endAngle: -.pi / 2 + 2 * .pi * progress, clockwise: false)
      context.strokePath()
    }
    if progress >= 1 {
      context.setFillColor(palette.bodyText.withAlphaComponent(alpha).cgColor)
      context.fillEllipse(in: CGRect(x: center.x - 4.05, y: center.y - 4.05, width: 8.1, height: 8.1))
    }
    context.restoreGState()
    text.draw(at: CGPoint(x: startX + radius * 2 + 8, y: y - font.lineHeight / 2))
  }
}
