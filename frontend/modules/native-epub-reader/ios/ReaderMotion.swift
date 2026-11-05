import QuartzCore
import UIKit

// CSS-style cubic-bézier timing, for animations UIKit's curves can't express
// (the beam's scroll, its cross-fade).
struct CubicBezier {
  let x1: Double, y1: Double, x2: Double, y2: Double

  static let ease = CubicBezier(x1: 0.25, y1: 0.1, x2: 0.25, y2: 1)
  static let easeOutCubic = CubicBezier(x1: 0.33, y1: 1, x2: 0.68, y2: 1)
  static let panelLift = CubicBezier(x1: 0.22, y1: 0.61, x2: 0.36, y2: 1)

  private func sample(_ t: Double, _ a: Double, _ b: Double) -> Double {
    let u = 1 - t
    return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t
  }

  // Progress (0...1) at time fraction x.
  func value(at x: Double) -> Double {
    let x = min(max(x, 0), 1)
    var lower = 0.0, upper = 1.0, t = x
    for _ in 0..<24 {
      let current = sample(t, x1, x2)
      if abs(current - x) < 1e-5 { break }
      if current < x { lower = t } else { upper = t }
      t = (lower + upper) / 2
    }
    return sample(t, y1, y2)
  }
}

// Runs a closure every frame for `duration`, with eased progress; a new run
// replaces the old one.
final class FrameAnimator {
  private var link: CADisplayLink?
  private var start: CFTimeInterval = 0
  private var duration: CFTimeInterval = 0
  private var curve = CubicBezier.ease
  private var step: ((Double) -> Void)?
  private var completion: (() -> Void)?

  var isRunning: Bool { link != nil }

  func run(duration: CFTimeInterval, curve: CubicBezier, step: @escaping (Double) -> Void, completion: (() -> Void)? = nil) {
    stop()
    guard duration > 0 else {
      step(1)
      completion?()
      return
    }
    self.duration = duration
    self.curve = curve
    self.step = step
    self.completion = completion
    start = CACurrentMediaTime()
    let link = CADisplayLink(target: self, selector: #selector(tick))
    link.add(to: .main, forMode: .common)
    self.link = link
  }

  func stop() {
    link?.invalidate()
    link = nil
    step = nil
    completion = nil
  }

  @objc private func tick() {
    let fraction = min((CACurrentMediaTime() - start) / duration, 1)
    step?(curve.value(at: fraction))
    if fraction >= 1 {
      let done = completion
      stop()
      done?()
    }
  }
}
