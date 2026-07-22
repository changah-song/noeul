package expo.modules.screenocroverlay

/**
 * Strings for the floating OCR overlay.
 *
 * The overlay runs from a background Service, so it can't reach the JS i18n
 * tables directly. Instead JS pushes the active interface language's strings in
 * via ScreenOcrOverlayModule.setInterfaceLanguage(language, strings) — see
 * modules/screen-ocr-overlay/src/index.js, which builds the bundle from the
 * overlay.* keys in i18n/translations.js. That keeps every interface language
 * working here without duplicating 12 tables in Kotlin.
 *
 * EN below stays as the compile-time fallback for anything the bundle is
 * missing, and for the window before JS has pushed anything (e.g. the Service
 * being restarted by the system).
 */
object OverlayText {
  @Volatile
  private var language = "en"

  @Volatile
  private var pushed: Map<String, String> = emptyMap()

  fun setLanguage(value: String?): String {
    language = normalizeLanguage(value)
    return language
  }

  /** Replaces the active string bundle. Keys match those used by [t]. */
  fun setStrings(values: Map<String, String>?) {
    pushed = values?.filterValues { it.isNotEmpty() }.orEmpty()
  }

  fun currentLanguage(): String = language

  fun t(key: String): String =
    pushed[key] ?: EN[key] ?: key

  private fun format(key: String, vararg params: Pair<String, String>): String {
    var result = t(key)
    for ((name, value) in params) {
      result = result.replace("{{$name}}", value)
    }
    return result
  }

  fun fromSurface(surface: String): String = format("fromSurface", "surface" to surface)

  fun unsupportedPixelStride(value: Int): String =
    format("unsupportedPixelStride", "value" to value.toString())

  /**
   * [value] is the canonical uppercase POS tag (NOUN, AUXILIARY VERB, …) that
   * OcrResultOverlayView maps raw dictionary tags onto. Uppercasing matches the
   * in-app badge's textTransform and is a no-op for non-Latin scripts.
   */
  fun posLabel(value: String): String {
    val key = "pos." + value.lowercase().replace(' ', '_')
    val translated = pushed[key] ?: POS_LABELS["en"]?.get(value) ?: value
    return translated.uppercase()
  }

  fun displayLanguageName(code: String): String {
    val normalized = code.trim().lowercase()
    val shortCode = when (normalized) {
      "kor", "kr", "korean" -> "ko"
      "eng", "english" -> "en"
      "zho", "chi", "chinese" -> "zh"
      "jpn", "japanese" -> "ja"
      "spa", "spanish" -> "es"
      "fra", "fre", "french" -> "fr"
      else -> normalized.split('-', '_').firstOrNull().orEmpty()
    }
    return pushed["languageName.$shortCode"]
      ?: LANGUAGE_NAMES["en"]?.get(shortCode)
      ?: code
  }

  private fun normalizeLanguage(value: String?): String {
    val raw = value?.trim()?.lowercase()?.replace('_', '-').orEmpty()
    if (raw in setOf("zh-hant", "zh-tw", "zh-hk", "zh-mo")) {
      return "zh-Hant"
    }
    return raw.split('-').firstOrNull().orEmpty().ifEmpty { "en" }
  }

  private val EN = mapOf(
    "analyzeInProgress" to "Floating OCR is already analyzing the current screen",
    "analysisCancelled" to "Floating OCR analysis was cancelled",
    "cancelFloatingOcrScan" to "Cancel floating OCR scan",
    "clear" to "Clear",
    "close" to "Close",
    "copy" to "Copy",
    "dictionary" to "Dictionary",
    "dismissFloatingOcr" to "Dismiss floating OCR",
    "explainFailed" to "Couldn't load the explanation.",
    "floatingControllerUnavailable" to "Floating OCR controller is not available",
    "floatingOcr" to "Floating OCR",
    "floatingOcrActive" to "Floating OCR active",
    "floatingOcrNotificationBody" to "Tap the floating bubble to OCR the current screen.",
    "floatingOcrNotificationDescription" to "Keeps screen OCR capture active",
    "floatingOcrNotificationTitle" to "Floating OCR is active",
    "floatingOcrRequiresAndroid8" to "Floating OCR requires Android 8 or newer",
    "grantOverlayPermissionBeforeFloatingWidget" to "Grant overlay permission before starting the floating widget",
    "hanja" to "Hanja",
    "hanjaDetails" to "Hanja details",
    "hanjaLookupFailed" to "Hanja lookup failed.",
    "hanjaLookupTimedOut" to "Hanja lookup timed out.",
    "loading" to "Loading...",
    "loadingHanja" to "Loading hanja...",
    "lookingUp" to "Looking up...",
    "lookupFailed" to "Lookup failed.",
    "lookupResultUnavailable" to "Lookup result is no longer available.",
    "meaning" to "Meaning",
    "mediaProjectionCreateFailed" to "MediaProjection could not be created",
    "more" to "More",
    "noScreenImageAvailable" to "No screen image is available yet",
    "noDefinitionFound" to "No definition found.",
    "noDefinitionToSave" to "No definition to save.",
    "noEnglishDefinitionAvailable" to "No English definition available",
    "noHanjaDetailsFound" to "No hanja details found.",
    "noRelatedWordsAvailable" to "No related words available",
    "openAppToLookup" to "Open Noeul to look this up.",
    "overlayPermissionInProgress" to "Overlay permission request is already in progress",
    "overlayPermissionNotGranted" to "Overlay permission is not granted",
    "relatedWords" to "Related words",
    "requestScreenCaptureBeforeAnalyzing" to "Request screen capture before analyzing the current screen",
    "requestScreenCaptureBeforeFloatingWidget" to "Request screen capture before starting the floating widget",
    "rootCharacters" to "Root characters",
    "save" to "Save",
    "saveThis" to "Save this",
    "saveFailed" to "Save failed.",
    "saveTimedOut" to "Save timed out. Open the app to try again.",
    "saved" to "Saved",
    "saving" to "Saving...",
    "screenCaptureCouldNotStart" to "Screen capture could not be started",
    "screenCaptureInactive" to "Screen capture permission is not active",
    "screenCaptureInProgress" to "Screen capture request is already in progress",
    "screenCaptureMissingResult" to "Missing screen capture result",
    "screenCaptureNoPixelPlane" to "Captured image has no pixel plane",
    "screenCaptureRowOutsideBuffer" to "Captured image row is outside the pixel buffer",
    "screenCaptureSessionInactive" to "Screen capture session is no longer active",
    "seeMore" to "See more",
    "sentenceSelection" to "Sentence selection",
    "smartDefinition" to "Meaning",
    "slideDownForRoots" to "⌄ Slide down for roots",
    "slideUpForRoots" to "⌃ Slide up for roots",
    "tapToMarkKnown" to "Tap ✓ to mark known",
    "textNotFound" to "No text found",
    "translate" to "Translate",
    "translating" to "Translating...",
    "translation" to "Translation",
    "virtualDisplayCreateFailed" to "Screen capture display could not be created",
    "whatItMeansHere" to "What it means here",
    "fromSurface" to "from {{surface}}",
    "unsupportedPixelStride" to "Unsupported screen capture pixel stride: {{value}}"
  )


  private val LANGUAGE_NAMES = mapOf(
    "en" to mapOf(
      "ko" to "Korean",
      "en" to "English",
      "zh" to "Chinese",
      "ja" to "Japanese",
      "es" to "Spanish",
      "fr" to "French"
    )
  )

  private val POS_LABELS = mapOf(
    "en" to mapOf(
      "NOUN" to "NOUN",
      "VERB" to "VERB",
      "ADVERB" to "ADVERB",
      "ADJECTIVE" to "ADJECTIVE",
      "MODIFIER" to "MODIFIER",
      "DETERMINER" to "DETERMINER",
      "INTERJECTION" to "INTERJECTION",
      "PRONOUN" to "PRONOUN",
      "NUMERAL" to "NUMERAL",
      "PARTICLE" to "PARTICLE",
      "AFFIX" to "AFFIX",
      "ENDING" to "ENDING",
      "AUXILIARY VERB" to "AUXILIARY VERB",
      "AUXILIARY ADJECTIVE" to "AUXILIARY ADJECTIVE",
      "DEPENDENT NOUN" to "DEPENDENT NOUN"
    )
  )
}
