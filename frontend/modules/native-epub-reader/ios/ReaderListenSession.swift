import AVFoundation
import MediaPlayer
import UIKit

// Listen mode's player on the lock screen and in Control Center, like the
// Android ListenSessionService: Now Playing shows the book (title, author,
// cover), the remote buttons come back to JS as { action } events, and an
// active playback audio session keeps the voice going with the screen locked
// (with the `audio` background mode in Info.plist).
final class ReaderListenSession {
  static let shared = ReaderListenSession()

  // Remote buttons, interruptions and unplugging: play, pause, toggle, next,
  // previous, stop.
  var onControl: ((String) -> Void)?

  private var active = false
  private var playing = false
  private var title = ""
  private var subtitle = ""
  private var coverSource: String?
  private var artwork: MPMediaItemArtwork?
  private var commandTargets: [(MPRemoteCommand, Any)] = []
  private var observers: [NSObjectProtocol] = []
  // Paused by a call or another app; resumes when it ends if iOS says so.
  private var pausedByInterruption = false

  private init() {}

  func update(title: String?, subtitle: String?, playing: Bool?, cover: String?) {
    if !active { start() }
    if let title { self.title = title }
    if let subtitle { self.subtitle = subtitle }
    if let playing { self.playing = playing }
    if let cover { setCover(cover) }
    publish()
  }

  func stop() {
    guard active else { return }
    active = false
    playing = false
    pausedByInterruption = false
    for (command, target) in commandTargets {
      command.removeTarget(target)
      command.isEnabled = false
    }
    commandTargets = []
    observers.forEach(NotificationCenter.default.removeObserver)
    observers = []
    MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    MPNowPlayingInfoCenter.default().playbackState = .stopped
    UIApplication.shared.endReceivingRemoteControlEvents()
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }

  private func start() {
    active = true
    let session = AVAudioSession.sharedInstance()
    // Spoken audio: other apps' podcasts pause, music keeps its place.
    try? session.setCategory(.playback, mode: .spokenAudio, options: [])
    try? session.setActive(true)
    UIApplication.shared.beginReceivingRemoteControlEvents()

    let center = MPRemoteCommandCenter.shared()
    bind(center.playCommand, "play")
    bind(center.pauseCommand, "pause")
    bind(center.togglePlayPauseCommand, "toggle")
    bind(center.nextTrackCommand, "next")
    bind(center.previousTrackCommand, "previous")
    bind(center.stopCommand, "stop")

    let notifications = NotificationCenter.default
    observers.append(notifications.addObserver(forName: AVAudioSession.interruptionNotification, object: session, queue: .main) { [weak self] note in
      self?.handleInterruption(note)
    })
    observers.append(notifications.addObserver(forName: AVAudioSession.routeChangeNotification, object: session, queue: .main) { [weak self] note in
      // Headphones unplugged: pause rather than read out loud.
      guard let self, self.playing,
            let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
            AVAudioSession.RouteChangeReason(rawValue: raw) == .oldDeviceUnavailable else { return }
      self.onControl?("pause")
    })
  }

  private func bind(_ command: MPRemoteCommand, _ action: String) {
    command.isEnabled = true
    let target = command.addTarget { [weak self] _ in
      self?.onControl?(action)
      return .success
    }
    commandTargets.append((command, target))
  }

  private func handleInterruption(_ note: Notification) {
    guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
          let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
    switch type {
    case .began:
      if playing {
        pausedByInterruption = true
        onControl?("pause")
      }
    case .ended:
      let options = (note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt).map(AVAudioSession.InterruptionOptions.init) ?? []
      if pausedByInterruption && options.contains(.shouldResume) {
        try? AVAudioSession.sharedInstance().setActive(true)
        onControl?("play")
      }
      pausedByInterruption = false
    @unknown default:
      break
    }
  }

  private func publish() {
    guard active else { return }
    var info: [String: Any] = [
      MPMediaItemPropertyTitle: title,
      MPMediaItemPropertyArtist: subtitle,
      MPNowPlayingInfoPropertyPlaybackRate: playing ? 1.0 : 0.0,
      MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
    ]
    if let artwork { info[MPMediaItemPropertyArtwork] = artwork }
    MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    MPNowPlayingInfoCenter.default().playbackState = playing ? .playing : .paused
  }

  // The book's cover as the player's art: a file URI or path, a data: URI or
  // a web URL. "" clears it; the same source isn't decoded twice.
  private func setCover(_ raw: String) {
    let source = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard source != (coverSource ?? "") else { return }
    coverSource = source.isEmpty ? nil : source
    artwork = nil
    guard !source.isEmpty else { return }
    DispatchQueue.global(qos: .utility).async { [weak self] in
      let image = Self.loadCover(source)
      DispatchQueue.main.async {
        guard let self, self.coverSource == source, let image else { return }
        self.artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
        self.publish()
      }
    }
  }

  private static func loadCover(_ source: String) -> UIImage? {
    if source.hasPrefix("data:") {
      guard let comma = source.firstIndex(of: ","),
            let data = Data(base64Encoded: String(source[source.index(after: comma)...]), options: .ignoreUnknownCharacters)
      else { return nil }
      return UIImage(data: data)
    }
    if source.hasPrefix("http://") || source.hasPrefix("https://") {
      guard let url = URL(string: source), let data = try? Data(contentsOf: url) else { return nil }
      return UIImage(data: data)
    }
    let path = source.hasPrefix("file://") ? (URL(string: source)?.path ?? source) : source
    return UIImage(contentsOfFile: path)
  }
}
