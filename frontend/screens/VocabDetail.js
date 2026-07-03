import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { Screen, Card, Press } from '../components/ui';
import { useLocalOwner } from '../contexts/LocalOwnerContext';
import {
  addRelatedKnownWord,
  getRelatedKnownWords,
  getVocabContexts,
  removeRelatedKnownWord,
  updateFavorite,
} from '../services/Database';
import { fetchHanjaRelated } from '../services/api/hanjaRelated';
import { resolveDictionaryLookup } from '../services/dictionaryLookup';
import { supabase, toggleCloudRelatedKnownWord } from '../services/supabase';
import { isCurrentSyncGeneration } from '../services/localOwnerCoordinator';
import { useTheme } from '../theme/tokens';
import { fontFamilies } from '../theme/typography';

const HANJA_RE = /[㐀-䶿一-鿿豈-﫿]/;
const INITIAL_VISIBLE_COUNT = 2;

const relatedWordKey = (entry) => `${entry?.korean ?? ''}|${entry?.hanja ?? ''}`;

const uniqueHanjaChars = (hanja) => {
  if (typeof hanja !== 'string') return [];
  return [...new Set([...hanja].filter((char) => HANJA_RE.test(char)))];
};

const getMaturity = (word, colors) => {
  const seen = (word?.correct_count ?? 0) + (word?.wrong_count ?? 0);
  if (seen >= 13) return { label: 'Matured', color: colors.success };
  if (seen >= 3) return { label: 'Waiting', color: colors.accent3 };
  return { label: 'Not seen', color: colors.textSubtle };
};

const readingLine = (rows) => {
  const first = Array.isArray(rows) ? rows[0] : null;
  if (!first) return '';
  const korean = [first.hun_korean, first.reading].filter(Boolean).join(' ');
  const english = first.hun_display || first.hun_english || first.meaning || '';
  return [korean, english].filter(Boolean).join(' · ');
};

export default function VocabDetail({ navigation, route }) {
  const { colors } = useTheme();
  const { activeOwnerId, syncGeneration, syncPaused } = useLocalOwner();
  const word = route?.params?.word ?? {};
  const language = word.language ?? 'ko';

  const [context, setContext] = useState(null);
  const [dictEntry, setDictEntry] = useState(null);
  const [hanjaLookups, setHanjaLookups] = useState({});
  const [hanjaPage, setHanjaPage] = useState(0);
  const [hanjaExpanded, setHanjaExpanded] = useState(false);
  const [knownKeys, setKnownKeys] = useState(new Set());
  const [isFavorite, setIsFavorite] = useState(!!word.is_favorite);

  const hanjaChars = useMemo(() => uniqueHanjaChars(word.hanja), [word.hanja]);

  const sourceWordDetails = useMemo(() => ({
    hanja: word.hanja ?? null,
    definition: word.def ?? null,
    level: word.level ?? 'unorganized',
    sourceBookUri: word.source_book_uri ?? null,
    sourceBookTitle: word.source_book_title ?? null,
    isFavorite: !!word.is_favorite,
    priority: word.priority ?? 'normal',
    createdAt: word.created_at ?? undefined,
    language,
  }), [language, word]);

  useEffect(() => {
    if (!word?.word) return undefined;
    let cancelled = false;
    getVocabContexts(word.word, word.hanja, word.def, 1, language, { ownerId: activeOwnerId })
      .then((rows) => { if (!cancelled) setContext(rows[0] ?? null); })
      .catch((e) => console.warn('[VocabDetail] contexts error:', e));
    return () => { cancelled = true; };
  }, [activeOwnerId, language, word.def, word.hanja, word.word]);

  useEffect(() => {
    if (!word?.word) return undefined;
    let cancelled = false;
    resolveDictionaryLookup({
      surface: word.word,
      fetchLive: false,
      allowRemoteStemming: false,
      targetLanguage: language,
    })
      .then((resolved) => {
        if (cancelled) return;
        const rows = resolved?.cachedResults ?? [];
        const match = rows.find((row) => row?.pos || row?.romanization) ?? null;
        setDictEntry(match);
      })
      .catch((e) => console.warn('[VocabDetail] dictionary cache error:', e));
    return () => { cancelled = true; };
  }, [language, word.word]);

  useEffect(() => {
    if (hanjaChars.length === 0) return undefined;
    let cancelled = false;
    hanjaChars.forEach(async (char) => {
      try {
        const lookup = await fetchHanjaRelated(char);
        if (!cancelled) {
          setHanjaLookups((prev) => ({ ...prev, [char]: lookup }));
        }
      } catch (e) {
        console.warn(`[VocabDetail] hanja lookup failed for "${char}":`, e.message);
      }
    });
    return () => { cancelled = true; };
  }, [hanjaChars]);

  useEffect(() => {
    if (!word?.word) return undefined;
    let cancelled = false;
    getRelatedKnownWords(word.word, language, { ownerId: activeOwnerId })
      .then((knownWords) => {
        if (!cancelled) setKnownKeys(new Set(knownWords.map(relatedWordKey)));
      })
      .catch((e) => console.warn('[VocabDetail] known words load failed:', e.message));
    return () => { cancelled = true; };
  }, [activeOwnerId, language, word.word]);

  const handleToggleFavorite = useCallback(async () => {
    try {
      await updateFavorite(word.word, word.hanja, word.def, !isFavorite, language, { ownerId: activeOwnerId });
      setIsFavorite((v) => !v);
    } catch (e) {
      console.warn('[VocabDetail] favorite error:', e);
    }
  }, [activeOwnerId, isFavorite, language, word.def, word.hanja, word.word]);

  const handleKnownPress = useCallback(async (entry, sourceHanjaChar) => {
    const key = relatedWordKey(entry);
    const known = knownKeys.has(key);
    const markedAt = new Date().toISOString();
    const knownEntry = {
      korean: entry.korean,
      hanja: entry.hanja,
      meaning: entry.meaning,
      sourceHanja: sourceHanjaChar,
      markedAt,
      updatedAt: markedAt,
    };
    const relation = {
      language,
      mainWord: word.word,
      mainHanja: word.hanja ?? null,
      mainDefinition: word.def ?? null,
      relatedWord: knownEntry.korean,
      relatedHanja: knownEntry.hanja,
      relatedDefinition: knownEntry.meaning,
      sourceHanja: knownEntry.sourceHanja,
      markedAt,
      updatedAt: markedAt,
    };

    setKnownKeys((previous) => {
      const next = new Set(previous);
      if (known) { next.delete(key); } else { next.add(key); }
      return next;
    });

    if (!word.word) return;

    try {
      const nextKnownWords = known
        ? await removeRelatedKnownWord(word.word, knownEntry, language, {
            ownerId: activeOwnerId,
            mainHanja: word.hanja ?? null,
            mainDefinition: word.def ?? null,
          })
        : await addRelatedKnownWord(word.word, knownEntry, {
            ownerId: activeOwnerId,
            createIfMissing: true,
            mainWord: sourceWordDetails,
            language,
          });

      if (known || nextKnownWords.length > 0) {
        setKnownKeys(new Set(nextKnownWords.map(relatedWordKey)));
      }

      const ownerId = activeOwnerId;
      const generation = syncGeneration;

      supabase.auth.getUser()
        .then(({ data: { user } }) => {
          if (!user || syncPaused || ownerId !== user.id || !isCurrentSyncGeneration(generation)) {
            return null;
          }
          return toggleCloudRelatedKnownWord({
            user,
            ownerId,
            generation,
            known,
            relation,
            entry: {
              word: word.word,
              hanja: word.hanja ?? null,
              definition: word.def ?? null,
              level: word.level ?? 'unorganized',
              status: word.level ?? 'unorganized',
              sourceBookUri: word.source_book_uri ?? null,
              sourceBookTitle: word.source_book_title ?? null,
              contextSentence: context?.sentence ?? null,
              isFavorite,
              priority: word.priority ?? 'normal',
              createdAt: word.created_at ?? markedAt,
              updatedAt: markedAt,
              language,
            },
          });
        })
        .catch((syncError) => {
          console.warn(`[VocabDetail] cloud sync failed for "${word.word}":`, syncError.message);
        });
    } catch (e) {
      console.warn(`[VocabDetail] known word toggle failed for "${word.word}":`, e.message);
    }
  }, [activeOwnerId, context, isFavorite, knownKeys, language, sourceWordDetails, syncGeneration, syncPaused, word]);

  const hanjaPages = useMemo(() => (
    hanjaChars
      .map((char) => {
        const lookup = hanjaLookups[char];
        if (!lookup) return null;
        const reading = readingLine(lookup.firstTableData);
        const related = lookup.similarWordsTableData ?? [];
        if (!reading && related.length === 0) return null;
        return { char, reading, related };
      })
      .filter(Boolean)
  ), [hanjaChars, hanjaLookups]);

  const pageIndex = hanjaPages.length > 0 ? hanjaPage % hanjaPages.length : 0;
  const currentPage = hanjaPages[pageIndex] ?? null;

  const handleHanjaNav = useCallback((dir) => {
    if (hanjaPages.length === 0) return;
    setHanjaPage((p) => (((p % hanjaPages.length) + dir) + hanjaPages.length) % hanjaPages.length);
    setHanjaExpanded(false);
  }, [hanjaPages.length]);

  const maturity = getMaturity(word, colors);
  const encounters = (word.correct_count ?? 0) + (word.wrong_count ?? 0);
  const pos = dictEntry?.pos ?? null;
  const romanization = dictEntry?.romanization ?? null;
  const sourceTitle = context?.sourceBookTitle ?? word.source_book_title ?? null;
  const visibleRelated = currentPage
    ? (hanjaExpanded ? currentPage.related : currentPage.related.slice(0, INITIAL_VISIBLE_COUNT))
    : [];

  return (
    <Screen gradient edges={['top', 'left', 'right']}>
      {/* Header — 56px bar over a hairline */}
      <View style={[styles.header, { borderBottomColor: colors.readerHairline }]}>
        <View style={styles.headerLeft}>
          <Press onPress={() => navigation.goBack()} style={styles.headerBtn} hitSlop={8}>
            <Feather name="arrow-left" size={22} color={colors.textMuted} />
          </Press>
          <Text style={[styles.headerLabel, { color: colors.textTertiary }]}>Your vocabulary</Text>
        </View>
        <Press onPress={handleToggleFavorite} style={styles.starBtn} hitSlop={8}>
          <MaterialIcons
            name={isFavorite ? 'star' : 'star-outline'}
            size={23}
            color={isFavorite ? colors.accent3 : colors.textMuted}
          />
        </Press>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Word · hanja · romanization */}
        <View style={styles.wordRow}>
          <Text style={[styles.wordKorean, { color: colors.text }]}>{word.word ?? ''}</Text>
          {word.hanja ? (
            <Text style={[styles.wordHanja, { color: colors.textMuted }]}>{word.hanja}</Text>
          ) : null}
          {romanization ? (
            <Text style={[styles.wordRoman, { color: colors.textTertiary }]}>{romanization}</Text>
          ) : null}
        </View>

        {/* Status · pos · encounters */}
        <View style={styles.metaRow}>
          <View style={[styles.statusPill, { borderColor: maturity.color }]}>
            <Text style={[styles.statusPillText, { color: maturity.color }]}>{maturity.label}</Text>
          </View>
          {pos ? (
            <Text style={[styles.pos, { color: colors.textMuted }]}>{pos}</Text>
          ) : null}
          {encounters > 0 ? (
            <>
              <Text style={[styles.metaDot, { color: colors.textTertiary }]}>·</Text>
              <Text style={[styles.encounters, { color: colors.textMuted }]}>×{encounters} encounters</Text>
            </>
          ) : null}
        </View>

        {/* Definition */}
        <Text style={[styles.meaning, { color: colors.text }]}>{word.def ?? ''}</Text>

        {/* Seen in */}
        {context?.sentence ? (
          <>
            <Text style={[styles.sectLabel, { color: colors.textTertiary }]}>Seen in</Text>
            <View style={styles.quoteRow}>
              <Text style={[styles.quoteGlyph, { color: colors.accent }]}>“</Text>
              <View style={styles.quoteBody}>
                <Text style={[styles.sentenceKr, { color: colors.textSecondary }]}>{context.sentence}</Text>
                {sourceTitle ? (
                  <Text style={[styles.sentenceSource, { color: colors.textTertiary }]}>— {sourceTitle}</Text>
                ) : null}
              </View>
            </View>
          </>
        ) : null}

        {/* Related by hanja */}
        {currentPage ? (
          <Card tone="glass" padded={false} style={styles.hanjaCard} contentStyle={styles.hanjaCardContent}>
            <View style={styles.hanjaTop}>
              <View style={styles.hanjaTopLeft}>
                <Text style={[styles.hanjaChar, { color: colors.text }]}>{currentPage.char}</Text>
                <View style={styles.hanjaTitle}>
                  <Text style={[styles.hanjaEyebrow, { color: colors.textTertiary }]}>Related by hanja</Text>
                  <Text style={[styles.hanjaReading, { color: colors.text }]}>{currentPage.reading}</Text>
                </View>
              </View>
              <View style={styles.hanjaNav}>
                <Press
                  onPress={() => handleHanjaNav(-1)}
                  style={[styles.hanjaNavBtn, { borderColor: colors.borderStrong }]}
                  hitSlop={6}
                >
                  <Feather name="chevron-left" size={16} color={colors.textMuted} />
                </Press>
                <Text style={[styles.hanjaCount, { color: colors.textMuted }]}>
                  {pageIndex + 1} of {hanjaPages.length}
                </Text>
                <Press
                  onPress={() => handleHanjaNav(1)}
                  style={[styles.hanjaNavBtn, { borderColor: colors.borderStrong }]}
                  hitSlop={6}
                >
                  <Feather name="chevron-right" size={16} color={colors.textMuted} />
                </Press>
              </View>
            </View>

            {visibleRelated.length > 0 ? (
              <View style={styles.relatedList}>
                {visibleRelated.map((related) => {
                  const known = knownKeys.has(relatedWordKey(related));
                  return (
                    <View
                      key={relatedWordKey(related)}
                      style={[styles.relatedRow, { borderTopColor: colors.divider }]}
                    >
                      <View style={styles.relatedText}>
                        <Text style={[styles.relatedWord, { color: colors.text }]}>{related.korean}</Text>
                        {related.meaning ? (
                          <Text style={[styles.relatedMeaning, { color: colors.textMuted }]}>{related.meaning}</Text>
                        ) : null}
                      </View>
                      <Press
                        onPress={() => handleKnownPress(related, currentPage.char)}
                        style={[styles.knownBtn, { borderBottomColor: known ? colors.success : colors.accent }]}
                        hitSlop={8}
                      >
                        <Text style={[styles.knownBtnText, { color: known ? colors.success : colors.accent }]}>
                          {known ? 'Known ✓' : 'Mark known'}
                        </Text>
                      </Press>
                    </View>
                  );
                })}
              </View>
            ) : null}

            {currentPage.related.length > INITIAL_VISIBLE_COUNT ? (
              <Press
                onPress={() => setHanjaExpanded((v) => !v)}
                style={[styles.seeMoreBtn, { borderTopColor: colors.divider }]}
              >
                <Text style={[styles.seeMoreText, { color: colors.textMuted }]}>
                  {hanjaExpanded ? 'See less' : 'See more'}
                </Text>
                <Feather name={hanjaExpanded ? 'chevron-up' : 'chevron-down'} size={15} color={colors.textMuted} />
              </Press>
            ) : null}
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 8,
    paddingRight: 10,
    borderBottomWidth: 1,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  headerBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerLabel: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 11,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  starBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    paddingTop: 24,
    paddingHorizontal: 22,
    paddingBottom: 40,
  },
  wordRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: 12,
  },
  wordKorean: {
    fontFamily: fontFamilies.krSerifSemiBold,
    fontSize: 46,
    lineHeight: 50,
  },
  wordHanja: {
    fontFamily: fontFamilies.krSerifMedium,
    fontSize: 26,
    lineHeight: 32,
  },
  wordRoman: {
    fontFamily: fontFamilies.displayItalic,
    fontSize: 19,
    lineHeight: 26,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 15,
  },
  statusPill: {
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 3,
    paddingHorizontal: 9,
  },
  statusPillText: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 9,
    letterSpacing: 1.3,
    textTransform: 'uppercase',
  },
  pos: {
    fontFamily: fontFamilies.displayItalic,
    fontSize: 13,
  },
  metaDot: {
    opacity: 0.4,
  },
  encounters: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 12.5,
  },
  meaning: {
    fontFamily: fontFamilies.displayMedium,
    fontSize: 30,
    lineHeight: 35,
    marginTop: 22,
  },
  sectLabel: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 10,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    marginTop: 26,
    marginBottom: 12,
    marginHorizontal: 4,
  },
  quoteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  quoteGlyph: {
    fontFamily: fontFamilies.displayRegular,
    fontSize: 38,
    lineHeight: 38,
    marginTop: -8,
    opacity: 0.55,
  },
  quoteBody: {
    flex: 1,
  },
  sentenceKr: {
    fontFamily: fontFamilies.krSerifRegular,
    fontSize: 15,
    lineHeight: 26,
  },
  sentenceSource: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 12.5,
    lineHeight: 19,
    marginTop: 7,
  },
  hanjaCard: {
    marginTop: 26,
  },
  hanjaCardContent: {
    paddingTop: 17,
    paddingHorizontal: 17,
    paddingBottom: 6,
  },
  hanjaTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  hanjaTopLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    flexShrink: 1,
  },
  hanjaChar: {
    fontFamily: fontFamilies.krSerifSemiBold,
    fontSize: 42,
    lineHeight: 46,
  },
  hanjaTitle: {
    flexShrink: 1,
  },
  hanjaEyebrow: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 8.5,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  hanjaReading: {
    fontFamily: fontFamilies.krSerifRegular,
    fontSize: 14.5,
    marginTop: 4,
  },
  hanjaNav: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  hanjaNavBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hanjaCount: {
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 11,
  },
  relatedList: {
    marginTop: 14,
  },
  relatedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 13,
    borderTopWidth: 1,
  },
  relatedText: {
    flexShrink: 1,
  },
  relatedWord: {
    fontFamily: fontFamilies.krSerifSemiBold,
    fontSize: 16,
  },
  relatedMeaning: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 12,
    marginTop: 2,
  },
  knownBtn: {
    borderBottomWidth: 1,
    paddingBottom: 2,
  },
  knownBtnText: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 9,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  seeMoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 12,
    borderTopWidth: 1,
  },
  seeMoreText: {
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 12,
  },
});
