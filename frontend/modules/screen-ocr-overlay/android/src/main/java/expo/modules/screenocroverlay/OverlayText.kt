package expo.modules.screenocroverlay

object OverlayText {
  @Volatile
  private var language = "en"

  fun setLanguage(value: String?): String {
    language = normalizeLanguage(value)
    return language
  }

  fun currentLanguage(): String = language

  fun t(key: String): String =
    translationsFor(language)[key] ?: EN[key] ?: key

  fun fromSurface(surface: String): String =
    if (language == "ko") {
      "${surface}에서"
    } else {
      "from $surface"
    }

  fun unsupportedPixelStride(value: Int): String =
    if (language == "ko") {
      "지원되지 않는 화면 캡처 픽셀 간격: $value"
    } else {
      "Unsupported screen capture pixel stride: $value"
    }

  fun posLabel(value: String): String =
    POS_LABELS[language]?.get(value) ?: POS_LABELS["en"]?.get(value) ?: value

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
    return LANGUAGE_NAMES[language]?.get(shortCode)
      ?: LANGUAGE_NAMES["en"]?.get(shortCode)
      ?: code
  }

  private fun normalizeLanguage(value: String?): String {
    val shortCode = value?.trim()?.lowercase()?.split('-', '_')?.firstOrNull().orEmpty()
    return if (shortCode == "ko") "ko" else "en"
  }

  private fun translationsFor(language: String): Map<String, String> =
    if (language == "ko") KO else EN

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
    "openAppToLookup" to "Open FluentFable to look this up.",
    "overlayPermissionInProgress" to "Overlay permission request is already in progress",
    "overlayPermissionNotGranted" to "Overlay permission is not granted",
    "relatedWords" to "Related words",
    "requestScreenCaptureBeforeAnalyzing" to "Request screen capture before analyzing the current screen",
    "requestScreenCaptureBeforeFloatingWidget" to "Request screen capture before starting the floating widget",
    "rootCharacters" to "Root characters",
    "save" to "Save",
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
    "whatItMeansHere" to "What it means here"
  )

  private val KO = mapOf(
    "analyzeInProgress" to "플로팅 OCR이 현재 화면을 이미 분석 중입니다",
    "analysisCancelled" to "플로팅 OCR 분석이 취소되었습니다",
    "cancelFloatingOcrScan" to "플로팅 OCR 스캔 취소",
    "clear" to "지우기",
    "close" to "닫기",
    "copy" to "복사",
    "dictionary" to "사전",
    "dismissFloatingOcr" to "플로팅 OCR 닫기",
    "explainFailed" to "설명을 불러오지 못했습니다.",
    "floatingControllerUnavailable" to "플로팅 OCR 컨트롤러를 사용할 수 없습니다",
    "floatingOcr" to "플로팅 OCR",
    "floatingOcrActive" to "플로팅 OCR 활성화됨",
    "floatingOcrNotificationBody" to "현재 화면을 OCR하려면 플로팅 버블을 탭하세요.",
    "floatingOcrNotificationDescription" to "화면 OCR 캡처를 활성 상태로 유지합니다",
    "floatingOcrNotificationTitle" to "플로팅 OCR이 활성화되어 있습니다",
    "floatingOcrRequiresAndroid8" to "플로팅 OCR은 Android 8 이상에서 사용할 수 있습니다",
    "grantOverlayPermissionBeforeFloatingWidget" to "플로팅 위젯을 시작하기 전에 오버레이 권한을 허용하세요",
    "hanja" to "한자",
    "hanjaDetails" to "한자 정보",
    "hanjaLookupFailed" to "한자 조회에 실패했습니다.",
    "hanjaLookupTimedOut" to "한자 조회 시간이 초과되었습니다.",
    "loading" to "불러오는 중...",
    "loadingHanja" to "한자를 불러오는 중...",
    "lookingUp" to "찾는 중...",
    "lookupFailed" to "조회에 실패했습니다.",
    "lookupResultUnavailable" to "조회 결과를 더 이상 사용할 수 없습니다.",
    "meaning" to "뜻",
    "mediaProjectionCreateFailed" to "MediaProjection을 만들 수 없습니다",
    "more" to "더 보기",
    "noScreenImageAvailable" to "아직 사용할 수 있는 화면 이미지가 없습니다",
    "noDefinitionFound" to "뜻을 찾을 수 없습니다.",
    "noDefinitionToSave" to "저장할 뜻이 없습니다.",
    "noEnglishDefinitionAvailable" to "사용 가능한 영어 뜻이 없습니다",
    "noHanjaDetailsFound" to "한자 정보를 찾을 수 없습니다.",
    "noRelatedWordsAvailable" to "관련 단어가 없습니다",
    "openAppToLookup" to "조회하려면 FluentFable을 여세요.",
    "overlayPermissionInProgress" to "오버레이 권한 요청이 이미 진행 중입니다",
    "overlayPermissionNotGranted" to "오버레이 권한이 허용되지 않았습니다",
    "relatedWords" to "관련 단어",
    "requestScreenCaptureBeforeAnalyzing" to "현재 화면을 분석하기 전에 화면 캡처를 요청하세요",
    "requestScreenCaptureBeforeFloatingWidget" to "플로팅 위젯을 시작하기 전에 화면 캡처를 요청하세요",
    "rootCharacters" to "어근 한자",
    "save" to "저장",
    "saveFailed" to "저장에 실패했습니다.",
    "saveTimedOut" to "저장 시간이 초과되었습니다. 앱을 열어 다시 시도하세요.",
    "saved" to "저장됨",
    "saving" to "저장 중...",
    "screenCaptureCouldNotStart" to "화면 캡처를 시작할 수 없습니다",
    "screenCaptureInactive" to "화면 캡처 권한이 활성화되어 있지 않습니다",
    "screenCaptureInProgress" to "화면 캡처 요청이 이미 진행 중입니다",
    "screenCaptureMissingResult" to "화면 캡처 결과가 없습니다",
    "screenCaptureNoPixelPlane" to "캡처된 이미지에 픽셀 평면이 없습니다",
    "screenCaptureRowOutsideBuffer" to "캡처된 이미지 행이 픽셀 버퍼 범위를 벗어났습니다",
    "screenCaptureSessionInactive" to "화면 캡처 세션이 더 이상 활성화되어 있지 않습니다",
    "seeMore" to "더 보기",
    "sentenceSelection" to "문장 선택",
    "smartDefinition" to "의미",
    "slideDownForRoots" to "⌄ 어근을 보려면 아래로 밀기",
    "slideUpForRoots" to "⌃ 어근을 보려면 위로 밀기",
    "tapToMarkKnown" to "✓를 눌러 아는 단어로 표시",
    "textNotFound" to "텍스트를 찾을 수 없습니다",
    "translate" to "번역",
    "translating" to "번역 중...",
    "translation" to "번역",
    "whatItMeansHere" to "여기서의 의미"
  )

  private val LANGUAGE_NAMES = mapOf(
    "en" to mapOf(
      "ko" to "Korean",
      "en" to "English",
      "zh" to "Chinese",
      "ja" to "Japanese",
      "es" to "Spanish",
      "fr" to "French"
    ),
    "ko" to mapOf(
      "ko" to "한국어",
      "en" to "영어",
      "zh" to "중국어",
      "ja" to "일본어",
      "es" to "스페인어",
      "fr" to "프랑스어"
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
    ),
    "ko" to mapOf(
      "NOUN" to "명사",
      "VERB" to "동사",
      "ADVERB" to "부사",
      "ADJECTIVE" to "형용사",
      "MODIFIER" to "수식어",
      "DETERMINER" to "관형사",
      "INTERJECTION" to "감탄사",
      "PRONOUN" to "대명사",
      "NUMERAL" to "수사",
      "PARTICLE" to "조사",
      "AFFIX" to "접사",
      "ENDING" to "어미",
      "AUXILIARY VERB" to "보조 동사",
      "AUXILIARY ADJECTIVE" to "보조 형용사",
      "DEPENDENT NOUN" to "의존 명사"
    )
  )
}
