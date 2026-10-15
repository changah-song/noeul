package expo.modules.nativeepubreader

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Base64
import java.net.URL
import java.util.concurrent.Executors
import android.os.IBinder
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

// Foreground service behind listen mode. Two jobs:
//
// 1. Keep the process alive while the voice reads. Without a foreground
//    service Android freezes a backgrounded app after a few seconds, so
//    listening stopped at the end of the current sentence as soon as the
//    screen locked or the reader switched apps.
// 2. Put a media player on the notification shade and the lock screen: the
//    book's title, its author, and previous / play-pause / next / stop. The
//    buttons and the lock-screen controls (through the media session) are
//    forwarded to JavaScript as "onListenControl" events; the reader screen
//    owns the actual playback.
//
// The voice itself is the phone's text-to-speech engine, driven from
// JavaScript; this service never plays audio.
class ListenSessionService : Service() {
  private var mediaSession: MediaSessionCompat? = null
  private var title = ""
  private var subtitle = ""
  private var playing = false
  private var inForeground = false
  // The book's cover, shown as the player's art on the shade and the lock
  // screen. Decoded off the main thread; the source string that produced it
  // is kept so an update with the same cover does not decode it again.
  private var coverUri: String? = null
  private var coverBitmap: Bitmap? = null
  private val coverExecutor = Executors.newSingleThreadExecutor()
  private val mainHandler = Handler(Looper.getMainLooper())

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    ensureNotificationChannel()
    mediaSession = MediaSessionCompat(this, "NoeulListen").apply {
      setCallback(object : MediaSessionCompat.Callback() {
        override fun onPlay() = control(CONTROL_PLAY)
        override fun onPause() = control(CONTROL_PAUSE)
        override fun onSkipToNext() = control(CONTROL_NEXT)
        override fun onSkipToPrevious() = control(CONTROL_PREVIOUS)
        override fun onStop() = control(CONTROL_STOP)
      })
      isActive = true
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_UPDATE -> {
        intent.getStringExtra(EXTRA_TITLE)?.let { title = it }
        intent.getStringExtra(EXTRA_SUBTITLE)?.let { subtitle = it }
        if (intent.hasExtra(EXTRA_PLAYING)) playing = intent.getBooleanExtra(EXTRA_PLAYING, playing)
        if (intent.hasExtra(EXTRA_COVER)) loadCover(intent.getStringExtra(EXTRA_COVER))
        publish()
      }
      ACTION_CONTROL -> {
        // A notification button. Pressing play/pause toggles; the state
        // follows from the next update JavaScript sends.
        control(intent.getStringExtra(EXTRA_CONTROL) ?: return START_NOT_STICKY)
      }
      ACTION_STOP -> {
        endSession()
        return START_NOT_STICKY
      }
    }
    return START_NOT_STICKY
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    // Swiping the app away ends the session rather than leaving an orphaned
    // player on the shade.
    control(CONTROL_STOP)
    endSession()
    super.onTaskRemoved(rootIntent)
  }

  override fun onDestroy() {
    mediaSession?.isActive = false
    mediaSession?.release()
    mediaSession = null
    coverExecutor.shutdownNow()
    super.onDestroy()
  }

  // Decode the cover (a file / content URI, a plain path, a data: URI or an
  // http(s) URL) at a size fit for the player, then republish with it.
  private fun loadCover(source: String?) {
    val next = source?.trim().takeUnless { it.isNullOrEmpty() }
    if (next == coverUri) return
    coverUri = next
    coverBitmap = null
    if (next == null) return
    coverExecutor.execute {
      val bitmap = try {
        decodeCover(next)
      } catch (_: Exception) {
        null
      }
      mainHandler.post {
        if (coverUri == next) {
          coverBitmap = bitmap
          if (bitmap != null && mediaSession != null) publish()
        }
      }
    }
  }

  private fun decodeCover(source: String): Bitmap? {
    val bytes: ByteArray = when {
      source.startsWith("data:") -> {
        val comma = source.indexOf(',')
        if (comma < 0) return null
        Base64.decode(source.substring(comma + 1), Base64.DEFAULT)
      }
      source.startsWith("http://") || source.startsWith("https://") ->
        URL(source).openStream().use { it.readBytes() }
      source.startsWith("content://") ->
        contentResolver.openInputStream(Uri.parse(source))?.use { it.readBytes() } ?: return null
      else -> {
        val path = if (source.startsWith("file://")) Uri.parse(source).path ?: return null else source
        java.io.File(path).takeIf { it.exists() }?.readBytes() ?: return null
      }
    }
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    var sample = 1
    while (bounds.outWidth / sample > COVER_MAX_PX * 2 || bounds.outHeight / sample > COVER_MAX_PX * 2) sample *= 2
    val options = BitmapFactory.Options().apply { inSampleSize = sample }
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
  }

  private fun control(action: String) {
    onControl?.invoke(action)
  }

  private fun endSession() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
    inForeground = false
    stopSelf()
  }

  private fun publish() {
    val session = mediaSession ?: return
    session.setMetadata(
      MediaMetadataCompat.Builder()
        .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
        .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, subtitle)
        .apply {
          coverBitmap?.let {
            putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, it)
            putBitmap(MediaMetadataCompat.METADATA_KEY_ART, it)
          }
        }
        .build()
    )
    session.setPlaybackState(
      PlaybackStateCompat.Builder()
        .setActions(
          PlaybackStateCompat.ACTION_PLAY or PlaybackStateCompat.ACTION_PAUSE or
            PlaybackStateCompat.ACTION_PLAY_PAUSE or PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
            PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or PlaybackStateCompat.ACTION_STOP
        )
        .setState(
          if (playing) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED,
          PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN,
          1f
        )
        .build()
    )

    val notification = buildNotification(session)
    if (!inForeground) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
      inForeground = true
    } else {
      (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(NOTIFICATION_ID, notification)
    }
  }

  private fun controlIntent(action: String, requestCode: Int): PendingIntent {
    val intent = Intent(this, ListenSessionService::class.java)
      .setAction(ACTION_CONTROL)
      .putExtra(EXTRA_CONTROL, action)
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
    return PendingIntent.getService(this, requestCode, intent, flags)
  }

  private fun buildNotification(session: MediaSessionCompat): Notification {
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName) ?: Intent()
    val launchFlags = PendingIntent.FLAG_UPDATE_CURRENT or
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
    val openApp = PendingIntent.getActivity(this, 0, launchIntent, launchFlags)
    val smallIcon = applicationInfo.icon.takeIf { it != 0 } ?: android.R.drawable.ic_media_play

    return NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
      .setSmallIcon(smallIcon)
      .setLargeIcon(coverBitmap)
      .setContentTitle(title)
      .setContentText(subtitle)
      .setContentIntent(openApp)
      .setDeleteIntent(controlIntent(CONTROL_STOP, 4))
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOngoing(playing)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .addAction(android.R.drawable.ic_media_previous, "Previous", controlIntent(CONTROL_PREVIOUS, 1))
      .addAction(
        if (playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
        if (playing) "Pause" else "Play",
        controlIntent(CONTROL_TOGGLE, 2)
      )
      .addAction(android.R.drawable.ic_media_next, "Next", controlIntent(CONTROL_NEXT, 3))
      .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Stop", controlIntent(CONTROL_STOP, 4))
      .setStyle(
        androidx.media.app.NotificationCompat.MediaStyle()
          .setMediaSession(session.sessionToken)
          .setShowActionsInCompactView(0, 1, 2)
      )
      .build()
  }

  private fun ensureNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (manager.getNotificationChannel(NOTIFICATION_CHANNEL_ID) != null) return
    manager.createNotificationChannel(
      NotificationChannel(NOTIFICATION_CHANNEL_ID, "Listen", NotificationManager.IMPORTANCE_LOW).apply {
        setShowBadge(false)
        setSound(null, null)
      }
    )
  }

  companion object {
    // Set by the module while it is alive; receives the control names below.
    @Volatile
    var onControl: ((String) -> Unit)? = null

    const val CONTROL_PLAY = "play"
    const val CONTROL_PAUSE = "pause"
    const val CONTROL_TOGGLE = "toggle"
    const val CONTROL_NEXT = "next"
    const val CONTROL_PREVIOUS = "previous"
    const val CONTROL_STOP = "stop"

    private const val ACTION_UPDATE = "expo.modules.nativeepubreader.LISTEN_UPDATE"
    private const val ACTION_CONTROL = "expo.modules.nativeepubreader.LISTEN_CONTROL"
    private const val ACTION_STOP = "expo.modules.nativeepubreader.LISTEN_STOP"
    private const val EXTRA_TITLE = "title"
    private const val EXTRA_SUBTITLE = "subtitle"
    private const val EXTRA_PLAYING = "playing"
    private const val EXTRA_COVER = "cover"
    private const val COVER_MAX_PX = 640
    private const val EXTRA_CONTROL = "control"
    private const val NOTIFICATION_CHANNEL_ID = "noeul_listen"
    private const val NOTIFICATION_ID = 7421

    // Start the session or update its title / subtitle / playing state.
    fun update(context: Context, title: String?, subtitle: String?, playing: Boolean?, cover: String? = null) {
      val intent = Intent(context, ListenSessionService::class.java).setAction(ACTION_UPDATE)
      title?.let { intent.putExtra(EXTRA_TITLE, it) }
      subtitle?.let { intent.putExtra(EXTRA_SUBTITLE, it) }
      playing?.let { intent.putExtra(EXTRA_PLAYING, it) }
      cover?.let { intent.putExtra(EXTRA_COVER, it) }
      try {
        ContextCompat.startForegroundService(context, intent)
      } catch (_: Exception) {
        // Starting from the background without a running session is refused
        // on newer Android; the next foreground start brings the player up.
      }
    }

    fun stop(context: Context) {
      try {
        context.startService(Intent(context, ListenSessionService::class.java).setAction(ACTION_STOP))
      } catch (_: Exception) {
        // Not running: nothing to stop.
      }
    }
  }
}
