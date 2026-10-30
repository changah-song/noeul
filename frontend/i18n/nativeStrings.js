// Strings that only native Android code draws (the native EPUB reader, the
// listen-mode media notification, the floating OCR overlay).
//
// Native views and services can't read the JS i18n tables, and Android
// resources follow the phone's locale rather than the in-app interface
// language. So JS builds a flat string map for the active interface language
// and pushes it to native (see buildReaderNativeStrings below and
// modules/*/src). Native keeps an English fallback for every key and persists
// the last map it received, so a service started without JS still shows the
// right language.
//
// Text that already exists in i18n/translations.js is reused from there
// (READER_REUSED_KEYS); this file only holds native-only text. Every table must
// carry the full English key set — i18n/__tests__/nativeStrings.test.js checks.
import { UI_TRANSLATIONS } from './translations';

export const NATIVE_STRINGS = {
  en: {
    'native.reader.bookFinished': 'Book finished',
    'native.reader.chaptersOne': '1 chapter',
    'native.reader.chaptersOther': '{{count}} chapters',
    'native.reader.wordsSavedOne': '1 word saved',
    'native.reader.wordsSavedOther': '{{count}} words saved',
    'native.reader.chapterNumber': 'Chapter {{number}}',
    'native.reader.pullNext': 'Pull up for the next chapter',
    'native.reader.releaseNext': 'Let go for the next chapter',
    'native.reader.pullPrevious': 'Pull down for the previous chapter',
    'native.reader.releasePrevious': 'Let go for the previous chapter',
    'native.reader.pdfImportFailed': 'This PDF couldn\'t be opened. It may be damaged or password-protected.',
    'native.overlay.virtualDisplayCreateFailed': 'Screen capture display could not be created.',
    'native.languageName.ar': 'Arabic',
    'native.languageName.mn': 'Mongolian',
    'native.languageName.vi': 'Vietnamese',
    'native.languageName.th': 'Thai',
    'native.languageName.id': 'Indonesian',
    'native.languageName.ru': 'Russian',
    'native.languageName.pt': 'Portuguese',
  },
  fr: {
    'native.reader.bookFinished': 'Livre terminé',
    'native.reader.chaptersOne': '1 chapitre',
    'native.reader.chaptersOther': '{{count}} chapitres',
    'native.reader.wordsSavedOne': '1 mot enregistré',
    'native.reader.wordsSavedOther': '{{count}} mots enregistrés',
    'native.reader.chapterNumber': 'Chapitre {{number}}',
    'native.reader.pullNext': 'Tirez vers le haut pour le chapitre suivant',
    'native.reader.releaseNext': 'Relâchez pour le chapitre suivant',
    'native.reader.pullPrevious': 'Tirez vers le bas pour le chapitre précédent',
    'native.reader.releasePrevious': 'Relâchez pour le chapitre précédent',
    'native.reader.pdfImportFailed': 'Impossible d\'ouvrir ce PDF. Il est peut-être endommagé ou protégé par un mot de passe.',
    'native.overlay.virtualDisplayCreateFailed': 'Impossible de créer l\'affichage de capture d\'écran.',
    'native.languageName.ar': 'Arabe',
    'native.languageName.mn': 'Mongol',
    'native.languageName.vi': 'Vietnamien',
    'native.languageName.th': 'Thaï',
    'native.languageName.id': 'Indonésien',
    'native.languageName.ru': 'Russe',
    'native.languageName.pt': 'Portugais',
  },
  es: {
    'native.reader.bookFinished': 'Libro terminado',
    'native.reader.chaptersOne': '1 capítulo',
    'native.reader.chaptersOther': '{{count}} capítulos',
    'native.reader.wordsSavedOne': '1 palabra guardada',
    'native.reader.wordsSavedOther': '{{count}} palabras guardadas',
    'native.reader.chapterNumber': 'Capítulo {{number}}',
    'native.reader.pullNext': 'Desliza hacia arriba para el siguiente capítulo',
    'native.reader.releaseNext': 'Suelta para el siguiente capítulo',
    'native.reader.pullPrevious': 'Desliza hacia abajo para el capítulo anterior',
    'native.reader.releasePrevious': 'Suelta para el capítulo anterior',
    'native.reader.pdfImportFailed': 'No se pudo abrir este PDF. Puede que esté dañado o protegido con contraseña.',
    'native.overlay.virtualDisplayCreateFailed': 'No se pudo crear la pantalla de captura.',
    'native.languageName.ar': 'Árabe',
    'native.languageName.mn': 'Mongol',
    'native.languageName.vi': 'Vietnamita',
    'native.languageName.th': 'Tailandés',
    'native.languageName.id': 'Indonesio',
    'native.languageName.ru': 'Ruso',
    'native.languageName.pt': 'Portugués',
  },
  ar: {
    'native.reader.bookFinished': 'انتهى الكتاب',
    'native.reader.chaptersOne': 'فصل واحد',
    'native.reader.chaptersOther': '{{count}} فصول',
    'native.reader.wordsSavedOne': 'كلمة واحدة محفوظة',
    'native.reader.wordsSavedOther': '{{count}} كلمات محفوظة',
    'native.reader.chapterNumber': 'الفصل {{number}}',
    'native.reader.pullNext': 'اسحب للأعلى للفصل التالي',
    'native.reader.releaseNext': 'اترك للانتقال إلى الفصل التالي',
    'native.reader.pullPrevious': 'اسحب للأسفل للفصل السابق',
    'native.reader.releasePrevious': 'اترك للانتقال إلى الفصل السابق',
    'native.reader.pdfImportFailed': 'تعذّر فتح ملف PDF هذا. ربما يكون تالفًا أو محميًا بكلمة مرور.',
    'native.overlay.virtualDisplayCreateFailed': 'تعذّر إنشاء شاشة التقاط الشاشة.',
    'native.languageName.ar': 'العربية',
    'native.languageName.mn': 'المنغولية',
    'native.languageName.vi': 'الفيتنامية',
    'native.languageName.th': 'التايلاندية',
    'native.languageName.id': 'الإندونيسية',
    'native.languageName.ru': 'الروسية',
    'native.languageName.pt': 'البرتغالية',
  },
  mn: {
    'native.reader.bookFinished': 'Ном дууслаа',
    'native.reader.chaptersOne': '1 бүлэг',
    'native.reader.chaptersOther': '{{count}} бүлэг',
    'native.reader.wordsSavedOne': '1 үг хадгалсан',
    'native.reader.wordsSavedOther': '{{count}} үг хадгалсан',
    'native.reader.chapterNumber': '{{number}}-р бүлэг',
    'native.reader.pullNext': 'Дараагийн бүлэг рүү дээш татна уу',
    'native.reader.releaseNext': 'Дараагийн бүлэг рүү шилжихийн тулд суллана уу',
    'native.reader.pullPrevious': 'Өмнөх бүлэг рүү доош татна уу',
    'native.reader.releasePrevious': 'Өмнөх бүлэг рүү шилжихийн тулд суллана уу',
    'native.reader.pdfImportFailed': 'Энэ PDF-ийг нээж чадсангүй. Гэмтсэн эсвэл нууц үгээр хамгаалагдсан байж магадгүй.',
    'native.overlay.virtualDisplayCreateFailed': 'Дэлгэц бичлэгийн дэлгэцийг үүсгэж чадсангүй.',
    'native.languageName.ar': 'Араб хэл',
    'native.languageName.mn': 'Монгол хэл',
    'native.languageName.vi': 'Вьетнам хэл',
    'native.languageName.th': 'Тай хэл',
    'native.languageName.id': 'Индонез хэл',
    'native.languageName.ru': 'Орос хэл',
    'native.languageName.pt': 'Португал хэл',
  },
  vi: {
    'native.reader.bookFinished': 'Đã đọc xong sách',
    'native.reader.chaptersOne': '1 chương',
    'native.reader.chaptersOther': '{{count}} chương',
    'native.reader.wordsSavedOne': 'Đã lưu 1 từ',
    'native.reader.wordsSavedOther': 'Đã lưu {{count}} từ',
    'native.reader.chapterNumber': 'Chương {{number}}',
    'native.reader.pullNext': 'Kéo lên để sang chương sau',
    'native.reader.releaseNext': 'Thả tay để sang chương sau',
    'native.reader.pullPrevious': 'Kéo xuống để về chương trước',
    'native.reader.releasePrevious': 'Thả tay để về chương trước',
    'native.reader.pdfImportFailed': 'Không thể mở tệp PDF này. Tệp có thể bị hỏng hoặc được bảo vệ bằng mật khẩu.',
    'native.overlay.virtualDisplayCreateFailed': 'Không thể tạo màn hình ghi.',
    'native.languageName.ar': 'Tiếng Ả Rập',
    'native.languageName.mn': 'Tiếng Mông Cổ',
    'native.languageName.vi': 'Tiếng Việt',
    'native.languageName.th': 'Tiếng Thái',
    'native.languageName.id': 'Tiếng Indonesia',
    'native.languageName.ru': 'Tiếng Nga',
    'native.languageName.pt': 'Tiếng Bồ Đào Nha',
  },
  th: {
    'native.reader.bookFinished': 'อ่านจบเล่มแล้ว',
    'native.reader.chaptersOne': '1 บท',
    'native.reader.chaptersOther': '{{count}} บท',
    'native.reader.wordsSavedOne': 'บันทึก 1 คำ',
    'native.reader.wordsSavedOther': 'บันทึก {{count}} คำ',
    'native.reader.chapterNumber': 'บทที่ {{number}}',
    'native.reader.pullNext': 'ดึงขึ้นเพื่อไปบทถัดไป',
    'native.reader.releaseNext': 'ปล่อยเพื่อไปบทถัดไป',
    'native.reader.pullPrevious': 'ดึงลงเพื่อกลับบทก่อนหน้า',
    'native.reader.releasePrevious': 'ปล่อยเพื่อกลับบทก่อนหน้า',
    'native.reader.pdfImportFailed': 'เปิด PDF นี้ไม่ได้ ไฟล์อาจเสียหายหรือมีการตั้งรหัสผ่านไว้',
    'native.overlay.virtualDisplayCreateFailed': 'สร้างจอแสดงผลสำหรับจับภาพหน้าจอไม่ได้',
    'native.languageName.ar': 'ภาษาอาหรับ',
    'native.languageName.mn': 'ภาษามองโกเลีย',
    'native.languageName.vi': 'ภาษาเวียดนาม',
    'native.languageName.th': 'ภาษาไทย',
    'native.languageName.id': 'ภาษาอินโดนีเซีย',
    'native.languageName.ru': 'ภาษารัสเซีย',
    'native.languageName.pt': 'ภาษาโปรตุเกส',
  },
  id: {
    'native.reader.bookFinished': 'Buku selesai',
    'native.reader.chaptersOne': '1 bab',
    'native.reader.chaptersOther': '{{count}} bab',
    'native.reader.wordsSavedOne': '1 kata disimpan',
    'native.reader.wordsSavedOther': '{{count}} kata disimpan',
    'native.reader.chapterNumber': 'Bab {{number}}',
    'native.reader.pullNext': 'Tarik ke atas untuk bab berikutnya',
    'native.reader.releaseNext': 'Lepaskan untuk bab berikutnya',
    'native.reader.pullPrevious': 'Tarik ke bawah untuk bab sebelumnya',
    'native.reader.releasePrevious': 'Lepaskan untuk bab sebelumnya',
    'native.reader.pdfImportFailed': 'PDF ini tidak dapat dibuka. Mungkin rusak atau dilindungi kata sandi.',
    'native.overlay.virtualDisplayCreateFailed': 'Layar perekaman tidak dapat dibuat.',
    'native.languageName.ar': 'Bahasa Arab',
    'native.languageName.mn': 'Bahasa Mongolia',
    'native.languageName.vi': 'Bahasa Vietnam',
    'native.languageName.th': 'Bahasa Thai',
    'native.languageName.id': 'Bahasa Indonesia',
    'native.languageName.ru': 'Bahasa Rusia',
    'native.languageName.pt': 'Bahasa Portugis',
  },
  ru: {
    'native.reader.bookFinished': 'Книга прочитана',
    'native.reader.chaptersOne': '1 глава',
    'native.reader.chaptersOther': 'Глав: {{count}}',
    'native.reader.wordsSavedOne': 'Сохранено 1 слово',
    'native.reader.wordsSavedOther': 'Сохранено слов: {{count}}',
    'native.reader.chapterNumber': 'Глава {{number}}',
    'native.reader.pullNext': 'Потяните вверх, чтобы открыть следующую главу',
    'native.reader.releaseNext': 'Отпустите, чтобы открыть следующую главу',
    'native.reader.pullPrevious': 'Потяните вниз, чтобы вернуться к предыдущей главе',
    'native.reader.releasePrevious': 'Отпустите, чтобы вернуться к предыдущей главе',
    'native.reader.pdfImportFailed': 'Не удалось открыть этот PDF. Возможно, файл повреждён или защищён паролем.',
    'native.overlay.virtualDisplayCreateFailed': 'Не удалось создать экран для захвата.',
    'native.languageName.ar': 'Арабский',
    'native.languageName.mn': 'Монгольский',
    'native.languageName.vi': 'Вьетнамский',
    'native.languageName.th': 'Тайский',
    'native.languageName.id': 'Индонезийский',
    'native.languageName.ru': 'Русский',
    'native.languageName.pt': 'Португальский',
  },
  zh: {
    'native.reader.bookFinished': '已读完本书',
    'native.reader.chaptersOne': '1 章',
    'native.reader.chaptersOther': '{{count}} 章',
    'native.reader.wordsSavedOne': '已收藏 1 个词',
    'native.reader.wordsSavedOther': '已收藏 {{count}} 个词',
    'native.reader.chapterNumber': '第 {{number}} 章',
    'native.reader.pullNext': '上拉进入下一章',
    'native.reader.releaseNext': '松手进入下一章',
    'native.reader.pullPrevious': '下拉返回上一章',
    'native.reader.releasePrevious': '松手返回上一章',
    'native.reader.pdfImportFailed': '无法打开此 PDF。文件可能已损坏或受密码保护。',
    'native.overlay.virtualDisplayCreateFailed': '无法创建屏幕捕获显示。',
    'native.languageName.ar': '阿拉伯语',
    'native.languageName.mn': '蒙古语',
    'native.languageName.vi': '越南语',
    'native.languageName.th': '泰语',
    'native.languageName.id': '印尼语',
    'native.languageName.ru': '俄语',
    'native.languageName.pt': '葡萄牙语',
  },
  'zh-Hant': {
    'native.reader.bookFinished': '已讀完本書',
    'native.reader.chaptersOne': '1 章',
    'native.reader.chaptersOther': '{{count}} 章',
    'native.reader.wordsSavedOne': '已收藏 1 個詞',
    'native.reader.wordsSavedOther': '已收藏 {{count}} 個詞',
    'native.reader.chapterNumber': '第 {{number}} 章',
    'native.reader.pullNext': '上拉進入下一章',
    'native.reader.releaseNext': '放開進入下一章',
    'native.reader.pullPrevious': '下拉返回上一章',
    'native.reader.releasePrevious': '放開返回上一章',
    'native.reader.pdfImportFailed': '無法開啟此 PDF。檔案可能已損毀或受密碼保護。',
    'native.overlay.virtualDisplayCreateFailed': '無法建立螢幕擷取畫面。',
    'native.languageName.ar': '阿拉伯語',
    'native.languageName.mn': '蒙古語',
    'native.languageName.vi': '越南語',
    'native.languageName.th': '泰語',
    'native.languageName.id': '印尼語',
    'native.languageName.ru': '俄語',
    'native.languageName.pt': '葡萄牙語',
  },
  ko: {
    'native.reader.bookFinished': '완독했어요',
    'native.reader.chaptersOne': '1개 챕터',
    'native.reader.chaptersOther': '{{count}}개 챕터',
    'native.reader.wordsSavedOne': '단어 1개 저장',
    'native.reader.wordsSavedOther': '단어 {{count}}개 저장',
    'native.reader.chapterNumber': '{{number}}장',
    'native.reader.pullNext': '위로 당기면 다음 장으로',
    'native.reader.releaseNext': '놓으면 다음 장으로',
    'native.reader.pullPrevious': '아래로 당기면 이전 장으로',
    'native.reader.releasePrevious': '놓으면 이전 장으로',
    'native.reader.pdfImportFailed': '이 PDF를 열 수 없습니다. 파일이 손상되었거나 비밀번호로 보호되어 있을 수 있습니다.',
    'native.overlay.virtualDisplayCreateFailed': '화면 캡처용 디스플레이를 만들 수 없습니다.',
    'native.languageName.ar': '아랍어',
    'native.languageName.mn': '몽골어',
    'native.languageName.vi': '베트남어',
    'native.languageName.th': '태국어',
    'native.languageName.id': '인도네시아어',
    'native.languageName.ru': '러시아어',
    'native.languageName.pt': '포르투갈어',
  },
  ja: {
    'native.reader.bookFinished': '読了しました',
    'native.reader.chaptersOne': '1章',
    'native.reader.chaptersOther': '{{count}}章',
    'native.reader.wordsSavedOne': '1語を保存しました',
    'native.reader.wordsSavedOther': '{{count}}語を保存しました',
    'native.reader.chapterNumber': '第{{number}}章',
    'native.reader.pullNext': '上に引くと次の章へ',
    'native.reader.releaseNext': '指を離すと次の章へ',
    'native.reader.pullPrevious': '下に引くと前の章へ',
    'native.reader.releasePrevious': '指を離すと前の章へ',
    'native.reader.pdfImportFailed': 'このPDFを開けませんでした。ファイルが破損しているか、パスワードで保護されている可能性があります。',
    'native.overlay.virtualDisplayCreateFailed': '画面キャプチャ用のディスプレイを作成できませんでした。',
    'native.languageName.ar': 'アラビア語',
    'native.languageName.mn': 'モンゴル語',
    'native.languageName.vi': 'ベトナム語',
    'native.languageName.th': 'タイ語',
    'native.languageName.id': 'インドネシア語',
    'native.languageName.ru': 'ロシア語',
    'native.languageName.pt': 'ポルトガル語',
  },
  pt: {
    'native.reader.bookFinished': 'Livro concluído',
    'native.reader.chaptersOne': '1 capítulo',
    'native.reader.chaptersOther': '{{count}} capítulos',
    'native.reader.wordsSavedOne': '1 palavra salva',
    'native.reader.wordsSavedOther': '{{count}} palavras salvas',
    'native.reader.chapterNumber': 'Capítulo {{number}}',
    'native.reader.pullNext': 'Puxe para cima para o próximo capítulo',
    'native.reader.releaseNext': 'Solte para o próximo capítulo',
    'native.reader.pullPrevious': 'Puxe para baixo para o capítulo anterior',
    'native.reader.releasePrevious': 'Solte para o capítulo anterior',
    'native.reader.pdfImportFailed': 'Não foi possível abrir este PDF. Ele pode estar corrompido ou protegido por senha.',
    'native.overlay.virtualDisplayCreateFailed': 'Não foi possível criar a tela de captura.',
    'native.languageName.ar': 'Árabe',
    'native.languageName.mn': 'Mongol',
    'native.languageName.vi': 'Vietnamita',
    'native.languageName.th': 'Tailandês',
    'native.languageName.id': 'Indonésio',
    'native.languageName.ru': 'Russo',
    'native.languageName.pt': 'Português',
  },
};

// Native key -> translations.js key, for reader/listen text the app already has.
export const READER_REUSED_KEYS = {
  backToLibrary: 'home.backToLibrary',
  reviewWordsOne: 'learn.reviewWordsOne',
  reviewWordsOther: 'learn.reviewWordsOther',
  listenChannel: 'read.listen',
  listenPlay: 'read.listenPlay',
  listenPause: 'read.listenPause',
  // Listen previous / next step the focus beam one sentence.
  listenPrevious: 'read.focusPreviousSentence',
  listenNext: 'read.focusNextSentence',
  listenStop: 'read.listenStop',
};

// Native key -> nativeStrings key for the reader module (NativeEpubReader).
export const READER_NATIVE_KEYS = {
  bookFinished: 'native.reader.bookFinished',
  chaptersOne: 'native.reader.chaptersOne',
  chaptersOther: 'native.reader.chaptersOther',
  wordsSavedOne: 'native.reader.wordsSavedOne',
  wordsSavedOther: 'native.reader.wordsSavedOther',
  chapterNumber: 'native.reader.chapterNumber',
  pullNext: 'native.reader.pullNext',
  releaseNext: 'native.reader.releaseNext',
  pullPrevious: 'native.reader.pullPrevious',
  releasePrevious: 'native.reader.releasePrevious',
  pdfImportFailed: 'native.reader.pdfImportFailed',
};

// Interface-language names the overlay's translation header may need beyond the
// language.* names translations.js already has (ko, en, zh, ja, es, fr).
export const NATIVE_LANGUAGE_NAME_CODES = ['ar', 'mn', 'vi', 'th', 'id', 'ru', 'pt'];

// Raw template lookup: {{placeholders}} stay in place, native fills them in.
export const nativeString = (language, key) => (
  NATIVE_STRINGS[language]?.[key] ?? NATIVE_STRINGS.en[key] ?? key
);

const appTemplate = (language, key) => (
  UI_TRANSLATIONS[language]?.[key] ?? UI_TRANSLATIONS.en?.[key] ?? key
);

// Flat map for NativeEpubReader (reader view + ListenSessionService). Keys
// match ReaderText.kt.
export const buildReaderNativeStrings = (language) => {
  const strings = {};
  for (const [nativeKey, appKey] of Object.entries(READER_REUSED_KEYS)) {
    strings[nativeKey] = appTemplate(language, appKey);
  }
  for (const [nativeKey, key] of Object.entries(READER_NATIVE_KEYS)) {
    strings[nativeKey] = nativeString(language, key);
  }
  return strings;
};

// Extra entries merged into the overlay bundle (keys match OverlayText.kt).
export const buildOverlayNativeExtras = (language) => {
  const strings = {
    virtualDisplayCreateFailed: nativeString(language, 'native.overlay.virtualDisplayCreateFailed'),
  };
  for (const code of NATIVE_LANGUAGE_NAME_CODES) {
    strings[`languageName.${code}`] = nativeString(language, `native.languageName.${code}`);
  }
  return strings;
};
