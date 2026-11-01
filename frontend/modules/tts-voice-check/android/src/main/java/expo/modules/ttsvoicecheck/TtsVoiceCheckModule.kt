package expo.modules.ttsvoicecheck

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import android.provider.Settings
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.Locale
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import kotlin.math.max

// Which of the phone's text-to-speech voices really speak. Engines list voices
// they have not downloaded without marking them (Samsung's lists a voice for
// every language it could fetch), so the only test that holds is to have each
// one say a short line into a file and look for sound in it. Nothing is played
// aloud, and the check runs on its own engine connection so it never touches
// what the reader is playing.
class TtsVoiceCheckModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("TtsVoiceCheck")

    // Resolves { defaultVoice, voices: { [id]: Boolean } }: whether the
    // engine's default voice for `locale` speaks, and each listed voice. null
    // when the engine would not start, so nothing is known either way.
    AsyncFunction("checkVoices") { locale: String, voiceIds: List<String>, sample: String, promise: Promise ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      Thread {
        val result = try {
          VoiceProber(context).run(locale, voiceIds, sample)
        } catch (e: Exception) {
          null
        }
        promise.resolve(result)
      }.start()
    }

    // The engine's own "download voices" page; Android's text-to-speech
    // settings when the engine has none. False when neither would open.
    Function("openVoiceDownload") {
      val activity = appContext.currentActivity
      if (activity == null) {
        false
      } else {
        val engine = Settings.Secure.getString(activity.contentResolver, Settings.Secure.TTS_DEFAULT_SYNTH)
        val install = Intent(TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA).apply {
          if (!engine.isNullOrBlank()) setPackage(engine)
        }
        listOf(install, Intent("com.android.settings.TTS_SETTINGS")).any { intent ->
          try {
            activity.startActivity(intent)
            true
          } catch (e: ActivityNotFoundException) {
            false
          } catch (e: SecurityException) {
            false
          }
        }
      }
    }
  }
}

private class VoiceProber(private val context: Context) {
  @Volatile private var pendingId: String? = null
  @Volatile private var pendingDone = false
  @Volatile private var pendingLatch: CountDownLatch? = null

  fun run(locale: String, voiceIds: List<String>, sample: String): Map<String, Any>? {
    val ready = CountDownLatch(1)
    var status = TextToSpeech.ERROR
    val engine = TextToSpeech(context) { initStatus ->
      status = initStatus
      ready.countDown()
    }
    try {
      if (!ready.await(INIT_TIMEOUT_MS, TimeUnit.MILLISECONDS) || status != TextToSpeech.SUCCESS) return null
      engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
        override fun onStart(utteranceId: String?) {}
        override fun onDone(utteranceId: String?) = finish(utteranceId, true)
        @Deprecated("Superseded by onError(String, Int)")
        override fun onError(utteranceId: String?) = finish(utteranceId, false)
        override fun onError(utteranceId: String?, errorCode: Int) = finish(utteranceId, false)
      })
      val file = File(context.cacheDir, "tts-voice-check.wav")
      val deadline = SystemClock.elapsedRealtime() + TOTAL_BUDGET_MS

      // setLanguage reports missing data before anything is synthesized.
      val language = runCatching { engine.setLanguage(Locale.forLanguageTag(locale)) }
        .getOrDefault(TextToSpeech.LANG_NOT_SUPPORTED)
      val defaultVoice = language >= TextToSpeech.LANG_AVAILABLE && speaks(engine, sample, file, "default")

      val installed = runCatching { engine.voices.orEmpty() }.getOrDefault(emptySet())
      val voices = voiceIds.associateWith { id ->
        val voice = installed.firstOrNull { it.name == id }
        voice != null &&
          SystemClock.elapsedRealtime() < deadline &&
          runCatching { engine.setVoice(voice) }.getOrDefault(TextToSpeech.ERROR) == TextToSpeech.SUCCESS &&
          speaks(engine, sample, file, "voice:$id")
      }
      file.delete()
      return mapOf("defaultVoice" to defaultVoice, "voices" to voices)
    } finally {
      engine.shutdown()
    }
  }

  private fun speaks(engine: TextToSpeech, sample: String, file: File, utteranceId: String): Boolean {
    file.delete()
    val latch = CountDownLatch(1)
    pendingDone = false
    pendingId = utteranceId
    pendingLatch = latch
    if (engine.synthesizeToFile(sample, Bundle(), file, utteranceId) != TextToSpeech.SUCCESS) return false
    if (!latch.await(PROBE_TIMEOUT_MS, TimeUnit.MILLISECONDS)) {
      // Flush it so the next voice is not queued behind a stuck one.
      engine.stop()
      return false
    }
    return pendingDone && hasSound(file)
  }

  private fun finish(utteranceId: String?, done: Boolean) {
    if (utteranceId == null || utteranceId != pendingId) return
    pendingDone = done
    pendingLatch?.countDown()
  }

  // The file is a WAV: a 44-byte header, then PCM. A voice with nothing
  // installed writes no samples, or only silence.
  private fun hasSound(file: File): Boolean {
    if (!file.exists() || file.length() <= WAV_HEADER_BYTES) return false
    val bytes = file.readBytes()
    val bits = (bytes[34].toInt() and 0xff) or ((bytes[35].toInt() and 0xff) shl 8)
    return when (bits) {
      16 -> {
        var peak = 0
        var i = WAV_HEADER_BYTES
        while (i + 1 < bytes.size) {
          val sample = (bytes[i + 1].toInt() shl 8) or (bytes[i].toInt() and 0xff)
          peak = max(peak, abs(sample))
          i += 2
        }
        peak >= MIN_PEAK_16
      }
      8 -> (WAV_HEADER_BYTES until bytes.size).any { abs((bytes[it].toInt() and 0xff) - 128) >= MIN_PEAK_8 }
      else -> bytes.size - WAV_HEADER_BYTES >= MIN_UNKNOWN_BYTES
    }
  }

  companion object {
    private const val INIT_TIMEOUT_MS = 5000L
    // The first line after the engine starts can be slow while it loads.
    private const val PROBE_TIMEOUT_MS = 6000L
    private const val TOTAL_BUDGET_MS = 20000L
    private const val WAV_HEADER_BYTES = 44
    // About -36 dBFS; real speech peaks far above it.
    private const val MIN_PEAK_16 = 500
    private const val MIN_PEAK_8 = 4
    private const val MIN_UNKNOWN_BYTES = 2000
  }
}
