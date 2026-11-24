# Store listing update: songs and focus mode (2026-11-24)

Changes to make in App Store Connect and the Play Console for the next release.
The new images are in `marketing/store-2026-11/out/` (see the README there).

## Images

Each image comes in Korean (`-ko-`, for the Korean listing) and English (`-en-`, for English (U.S.)).

| Store | Slot | File | Where it goes |
|---|---|---|---|
| App Store | iPhone 6.9" | `appstore-00-banner-<lang>-2868x1320.png` | first, before 01-hero |
| App Store | iPhone 6.9" | `appstore-07-songs-<lang>-1320x2868.png` | second, after 01-hero |
| App Store | iPhone 6.3" | the `-2622x1206` / `-1206x2622` copies | same order |
| Play | Feature graphic | `play-feature-graphic-<lang>-1024x500.png` | the feature graphic |
| Play | Phone screenshots | `play-07-songs-<lang>-1080x1920.png` | second |

Apple takes landscape and portrait screenshots in the same set. A landscape first
screenshot fills the whole search-result card by itself.

## App Store text

### Korean (primary): description bullets

Replace the bullet list with:

  • 탭 한 번 사전: 읽던 자리를 벗어나지 않고 뜻, 발음, 예문 확인
  • 한자 풀이: 한국어·중국어 단어를 한자 단위로 나누어 뜻과 관련 단어까지
  • 문맥 속 의미: AI가 이 문장에서 단어가 어떤 뜻으로 쓰였는지 설명
  • 내 수준에 맞춘 표시: 읽을수록 아는 단어를 파악해 모를 만한 단어만 표시
  • 노래로 배우기: 제목·가수·가사로 노래를 찾아 뮤직비디오와 함께 읽기. 부르는 줄이 밝아지고, 줄마다 아래에 번역
  • 집중 모드: 한 번에 한 문장만, 나머지는 흐리게
  • 단어장과 복습: 저장한 단어를 간격 반복 플래시카드로 복습
  • 듣기 모드: 책을 소리 내어 읽어 주는 기능
  • 편안한 읽기: 페이지 넘김·세로 스크롤, 글꼴 조절, 북마크, 메모

Promotional text (170 max), optional refresh:
  진짜 책과 노래로 배우는 외국어. 모르는 단어는 탭 한 번, 노래는 뮤직비디오에 맞춰 줄마다 번역과 함께 읽어요.

### English (U.S.): description bullets

  • Instant lookups: meaning, pronunciation and examples without leaving the page
  • Character roots: Korean and Chinese words broken into their Hanja / Hanzi, with related words
  • Meaning in context: AI explains what a word means in this exact sentence, including literary uses
  • Fits your level: Noeul learns which words you know and highlights only the ones you probably don't
  • Learn from songs: find a song by title, artist or lyric and read along with its music video, the sung line lit and each line's translation under it
  • Focus mode: one sentence at a time, the rest of the page faded
  • Saved words: review with spaced-repetition flashcards
  • Listen mode: have the book read aloud
  • Comfortable reading: paged or vertical scroll, adjustable type, bookmarks and notes

Promotional text, optional refresh:
  Read real books and songs in the language you're learning. Tap any word for its meaning, or follow a song's video with each line's translation right under it.

Keywords (EN), if there's room: swap `graded` for `lyrics`.
Keywords (KO): swap `EPUB` for `가사` (or `노래`).

## Play Store text (English full description)

Replace the "SONGS AND SHORT TEXTS" section with:

  LEARN FROM SONGS
  • Find a song by title, artist or a line of its lyrics, or paste the lyrics yourself
  • Its music video plays above the words, and the line being sung lights up
  • Each line's translation sits right under it; tap any word, just like in a book

And in READ WITHOUT FRICTION, change the third bullet to:

  • Paged or vertical-scroll reading, focus mode (one sentence at a time), bookmarks, per-book notes, adjustable typography

Short description (80 max), optional:
  Learn by reading real books and songs: instant lookups, AI meanings, flashcards.
