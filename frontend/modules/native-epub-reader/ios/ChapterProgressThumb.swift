import UIKit

// The paged reader's chapter progress bar in full screen: 3 pt thick, 3 pt
// above the bottom, between the margins; it shows on a page turn, lingers
// 700 ms and fades out over 320 ms.
final class ChapterProgressThumb: UIView {
  var color: UIColor = .black {
    didSet { setNeedsDisplay() }
  }

  private var fraction: CGFloat = 0
  private var pageCount = 1
  private var fade: CGFloat = 0
  private var hideWork: DispatchWorkItem?
  private let fader = FrameAnimator()

  override init(frame: CGRect) {
    super.init(frame: frame)
    isOpaque = false
    backgroundColor = .clear
    contentMode = .redraw
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  func show(fraction: CGFloat, pageCount: Int) {
    self.fraction = min(max(fraction, 0), 1)
    self.pageCount = pageCount
    fader.stop()
    fade = 1
    setNeedsDisplay()
    hideWork?.cancel()
    let work = DispatchWorkItem { [weak self] in self?.fadeOut() }
    hideWork = work
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.7, execute: work)
  }

  func hide() {
    hideWork?.cancel()
    fader.stop()
    fade = 0
    setNeedsDisplay()
  }

  private func fadeOut() {
    fader.run(duration: 0.32, curve: .ease, step: { [weak self] p in
      self?.fade = CGFloat(1 - p)
      self?.setNeedsDisplay()
    })
  }

  override func draw(_ rect: CGRect) {
    guard fade > 0.01, pageCount > 1 else { return }
    let inset: CGFloat = 24
    let track = bounds.width - inset * 2
    guard track > 0 else { return }
    let length = max(28, track / CGFloat(pageCount))
    let x = inset + (track - length) * fraction
    let bar = CGRect(x: x, y: bounds.height - 3 - 3, width: length, height: 3)
    color.withAlphaComponent(0.32 * fade).setFill()
    UIBezierPath(roundedRect: bar, cornerRadius: 1.5).fill()
  }
}
