package expo.modules.nativeepubreader

import android.content.Context
import org.json.JSONObject

/**
 * User-visible strings drawn by the native reader (the book-finished page) and
 * the listen-mode media notification (ListenSessionService).
 *
 * They follow the in-app interface language, not the phone's locale, so Android
 * resources can't supply them. JS builds the map from i18n/translations.js and
 * i18n/nativeStrings.js (buildReaderNativeStrings) and pushes it through
 * NativeEpubReaderModule.setInterfaceStrings. The last map is persisted in
 * SharedPreferences so ListenSessionService shows the right language even if it
 * is recreated before JS runs. EN below is the fallback for any missing key.
 */
object ReaderText {
  private const val PREFS_NAME = "noeul_native_reader_strings"
  private const val PREFS_KEY_LANGUAGE = "language"
  private const val PREFS_KEY_STRINGS = "strings"

  @Volatile
  private var language = "en"

  @Volatile
  private var pushed: Map<String, String> = emptyMap()

  @Volatile
  private var loaded = false

  /** Loads the last persisted strings once per process. */
  fun ensureLoaded(context: Context) {
    if (loaded) return
    synchronized(this) {
      if (loaded) return
      loaded = true
      try {
        val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val json = prefs.getString(PREFS_KEY_STRINGS, null) ?: return
        val obj = JSONObject(json)
        val values = mutableMapOf<String, String>()
        obj.keys().forEach { key -> obj.optString(key).takeIf { it.isNotEmpty() }?.let { values[key] = it } }
        // A push that raced ahead of this load wins.
        if (pushed.isEmpty()) {
          pushed = values
          language = prefs.getString(PREFS_KEY_LANGUAGE, null) ?: language
        }
      } catch (_: Exception) {
        // Corrupt or missing prefs: stay on the English fallback.
      }
    }
  }

  /** Replaces the active strings. Returns true when anything changed. */
  fun setStrings(context: Context?, nextLanguage: String?, values: Map<String, Any?>?): Boolean {
    val next = values.orEmpty()
      .mapNotNull { (key, value) -> (value as? String)?.takeIf { it.isNotEmpty() }?.let { key to it } }
      .toMap()
    val lang = nextLanguage?.trim().orEmpty().ifEmpty { language }
    loaded = true
    if (next == pushed && lang == language) return false
    pushed = next
    language = lang
    if (context != null) {
      try {
        context.applicationContext
          .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
          .edit()
          .putString(PREFS_KEY_LANGUAGE, lang)
          .putString(PREFS_KEY_STRINGS, JSONObject(next).toString())
          .apply()
      } catch (_: Exception) {
        // Persisting is best effort; the in-memory map is already live.
      }
    }
    return true
  }

  fun t(key: String): String = pushed[key] ?: EN[key] ?: key

  private fun format(key: String, vararg params: Pair<String, String>): String {
    var result = t(key)
    for ((name, value) in params) {
      result = result.replace("{{$name}}", value)
    }
    return result
  }

  private fun plural(count: Int, oneKey: String, otherKey: String): String =
    format(if (count == 1) oneKey else otherKey, "count" to count.toString())

  fun chapterCount(count: Int): String = plural(count, "chaptersOne", "chaptersOther")

  fun wordsSaved(count: Int): String = plural(count, "wordsSavedOne", "wordsSavedOther")

  fun reviewWords(count: Int): String = plural(count, "reviewWordsOne", "reviewWordsOther")

  fun chapterNumber(number: Int): String = format("chapterNumber", "number" to number.toString())

  private val EN = mapOf(
    "backToLibrary" to "Back to library",
    "bookFinished" to "Book finished",
    "chaptersOne" to "1 chapter",
    "chaptersOther" to "{{count}} chapters",
    "wordsSavedOne" to "1 word saved",
    "wordsSavedOther" to "{{count}} words saved",
    "reviewWordsOne" to "Review 1 word",
    "reviewWordsOther" to "Review {{count}} words",
    "chapterNumber" to "Chapter {{number}}",
    "listenChannel" to "Listen",
    "listenPlay" to "Play",
    "listenPause" to "Pause",
    "listenPrevious" to "Previous sentence",
    "listenNext" to "Next sentence",
    "listenStop" to "Stop listening",
    "pdfImportFailed" to "This PDF couldn't be opened. It may be damaged or password-protected."
  )
}
