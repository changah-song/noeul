import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { Screen, Card, ProgressBar, BookCover, IconButton, Press } from '../components/ui';
import { useBooks } from '../contexts/BooksContext';
import { useAppContext } from '../contexts/AppContext';
import { useLocalOwner } from '../contexts/LocalOwnerContext';
import { makeScopedStorageKey } from '../services/localDataScope';
import { viewData } from '../services/Database';
import { useTheme, withAlpha } from '../theme/tokens';
import { fontFamilies } from '../theme/typography';
import { insets } from '../theme/spacing';

const getGreeting = () => {
  const hour = new Date().getHours();
  if (hour < 6)  return { korean: '좋은 밤이에요', english: 'Good night' };
  if (hour < 12) return { korean: '좋은 아침이에요', english: 'Good morning' };
  if (hour < 17) return { korean: '안녕하세요', english: 'Good afternoon' };
  if (hour < 21) return { korean: '좋은 저녁이에요', english: 'Good evening' };
  return { korean: '좋은 밤이에요', english: 'Good night' };
};

const formatRelativeTime = (isoDate) => {
  if (!isoDate) return null;
  const ts = new Date(isoDate).getTime();
  if (!Number.isFinite(ts)) return null;
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'last week';
  return new Date(isoDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const isReviewDue = (word) => {
  if (!word?.next_review_at || word?.level === 'unorganized') return false;
  const ts = new Date(word.next_review_at).getTime();
  return Number.isFinite(ts) && ts <= Date.now();
};

export default function Home({ navigation }) {
  const { colors, isDarkMode } = useTheme();
  const { currentBook, books } = useBooks();
  const { targetLanguage } = useAppContext();
  const { activeOwnerId } = useLocalOwner();
  const greeting = useMemo(() => getGreeting(), []);

  const [vocabStats, setVocabStats] = useState({ total: 0, due: 0 });
  const [draftCount, setDraftCount] = useState(0);

  useFocusEffect(useCallback(() => {
    let active = true;

    const loadCounts = async () => {
      if (!activeOwnerId) return;
      try {
        const rows = await viewData({ ownerId: activeOwnerId, language: targetLanguage });
        if (!active) return;
        const words = rows ?? [];
        setVocabStats({ total: words.length, due: words.filter(isReviewDue).length });
      } catch {
        if (active) setVocabStats({ total: 0, due: 0 });
      }
      try {
        const raw = await AsyncStorage.getItem(makeScopedStorageKey(activeOwnerId, 'writing-entries-v1'));
        if (!active) return;
        const parsed = raw ? JSON.parse(raw) : [];
        setDraftCount(Array.isArray(parsed) ? parsed.filter((e) => !e?.deleted).length : 0);
      } catch {
        if (active) setDraftCount(0);
      }
    };

    loadCounts();
    return () => { active = false; };
  }, [activeOwnerId, targetLanguage]));

  const heroBook = currentBook ?? books[0] ?? null;
  const heroProgress = heroBook?.progress ?? 0;
  const heroWhen = formatRelativeTime(heroBook?.updatedAt);
  const reviewedRatio = vocabStats.total > 0
    ? (vocabStats.total - vocabStats.due) / vocabStats.total
    : 0;

  const handleContinueReading = useCallback(() => {
    if (heroBook) {
      navigation.navigate('Reader');
    } else {
      navigation.navigate('Library');
    }
  }, [navigation, heroBook]);

  return (
    <Screen gradient scroll contentContainerStyle={styles.scrollContent} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={styles.headerRow}>
        <View style={styles.greetingBlock}>
          <Text style={[styles.koreanGreeting, { color: colors.textMuted }]}>
            {greeting.korean}
          </Text>
          <Text style={[styles.englishGreeting, { color: colors.text }]}>
            {greeting.english}
          </Text>
        </View>
        <IconButton
          tone="gradient"
          size={44}
          onPress={() => navigation.navigate('Profile')}
          icon={<Feather name="user" size={22} color="#FFFFFF" />}
        />
      </View>

      {/* Stats strip */}
      <View style={styles.statsRow}>
        <Text style={[styles.statText, { color: colors.textMuted }]}>
          <Text style={[styles.statNumber, { color: colors.text }]}>{books.length}</Text>
          {books.length === 1 ? ' book' : ' books'}
        </Text>
        <Text style={[styles.statDot, { color: colors.textMuted }]}>·</Text>
        <Text style={[styles.statText, { color: colors.textMuted }]}>
          <Text style={[styles.statNumber, { color: colors.text }]}>{vocabStats.total}</Text>
          {' words'}
        </Text>
        <Text style={[styles.statDot, { color: colors.textMuted }]}>·</Text>
        <Text style={[styles.statText, { color: colors.textMuted }]}>
          <Text style={[styles.statNumber, { color: colors.text }]}>{vocabStats.due}</Text>
          {' due'}
        </Text>
      </View>

      {/* Continue reading */}
      <Text style={[styles.sectLabel, { color: colors.textTertiary }]}>Continue reading</Text>
      <Press onPress={handleContinueReading}>
        <Card tone="glass" padded={false}>
          <BookCover
            title={heroBook?.title ?? 'Your first book'}
            aspect={null}
            radius={0}
            spineWidth={6}
            titleSize={32}
            padding={18}
            titleStyle={{ color: 'rgba(255,255,255,0.98)' }}
            style={styles.heroCover}
          />
          <View style={styles.heroMeta}>
            <View style={styles.heroMetaTop}>
              <View style={styles.heroMetaLeft}>
                {heroBook?.author ? (
                  <Text style={[styles.heroEyebrow, { color: colors.textTertiary }]} numberOfLines={1}>
                    {heroBook.author}
                  </Text>
                ) : null}
                {heroBook?.titleTranslation ? (
                  <Text style={[styles.heroTitleEn, { color: colors.textMuted }]} numberOfLines={1}>
                    {heroBook.titleTranslation}
                  </Text>
                ) : !heroBook ? (
                  <Text style={[styles.heroTitleEn, { color: colors.textMuted }]}>
                    Import a book to begin
                  </Text>
                ) : null}
              </View>
              {heroWhen ? (
                <Text style={[styles.heroWhen, { color: colors.textTertiary }]}>{heroWhen}</Text>
              ) : null}
            </View>
            <View style={styles.heroProgressRow}>
              <ProgressBar progress={heroProgress} height={6} style={styles.heroProgressBar} />
              <Text style={[styles.heroProgressPct, { color: colors.textMuted }]}>
                {Math.round(heroProgress * 100)}%
              </Text>
            </View>
          </View>
        </Card>
      </Press>

      {/* Enter library */}
      <View style={styles.libraryRow}>
        <Press onPress={() => navigation.navigate('Library')} containerStyle={styles.libraryLink}>
          <View style={styles.libraryLinkInner}>
            <Text style={[styles.libraryLinkText, { color: colors.accent }]}>Enter library</Text>
            <Feather name="arrow-right" size={16} color={colors.accent} />
          </View>
        </Press>
        <IconButton
          tone="glass"
          size={44}
          onPress={() => navigation.navigate('ScreenshotOcr')}
          icon={<MaterialCommunityIcons name="line-scan" size={22} color={colors.accent} />}
        />
      </View>

      {/* Practice */}
      <Text style={[styles.sectLabel, { color: colors.textTertiary }]}>Practice</Text>
      <View style={styles.practiceRow}>
        {/* Writing */}
        <Press onPress={() => navigation.navigate('Write')} containerStyle={styles.practiceCol}>
          <Card tone="glass" padded={false} contentStyle={styles.practiceCard}>
            <View style={styles.practiceTopRow}>
              <View style={[styles.practiceIconTile, { backgroundColor: colors.accentSoft }]}>
                <Feather name="edit-3" size={20} color={colors.accent} />
              </View>
              <IconButton
                tone="gradient"
                size={34}
                onPress={() => navigation.navigate('WritingCanvas', { entry: null })}
                icon={<Feather name="plus" size={19} color="#FFFFFF" />}
              />
            </View>
            <Text style={[styles.practiceTitle, { color: colors.text }]}>Writing</Text>
            <Text style={[styles.practiceSub, { color: colors.textMuted }]}>
              {draftCount > 0
                ? `${draftCount} ${draftCount === 1 ? 'entry' : 'entries'} · feedback ready`
                : 'Start your first entry'}
            </Text>
          </Card>
        </Press>

        {/* Vocab */}
        <Press onPress={() => navigation.navigate('Learn')} containerStyle={styles.practiceCol}>
          <Card tone="glass" padded={false} contentStyle={styles.practiceCard}>
            <View style={styles.practiceTopRow}>
              <View style={[styles.practiceIconTile, { backgroundColor: withAlpha(colors.accent3, 0.18) }]}>
                <MaterialCommunityIcons name="bookshelf" size={20} color={colors.accent3} />
              </View>
              <IconButton
                tone="gradient"
                size={34}
                onPress={() => navigation.navigate('Flashcards')}
                icon={<MaterialCommunityIcons name="card-multiple" size={18} color="#FFFFFF" />}
              />
            </View>
            <Text style={[styles.practiceTitle, { color: colors.text }]}>Vocab</Text>
            <Text style={[styles.practiceSub, { color: colors.textMuted }]}>
              {`${vocabStats.total} saved · ${vocabStats.due} cards due`}
            </Text>
            <ProgressBar progress={reviewedRatio} height={5} style={styles.practiceProgress} />
          </Card>
        </Press>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: insets.screenHorizontal,
    paddingTop: 6,
    paddingBottom: 40,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    paddingTop: 8,
    paddingHorizontal: 4,
  },
  greetingBlock: {
    flex: 1,
  },
  koreanGreeting: {
    fontFamily: fontFamilies.krSerifMedium,
    fontSize: 13,
    lineHeight: 19,
  },
  englishGreeting: {
    fontFamily: fontFamilies.displayMedium,
    fontSize: 26,
    lineHeight: 30,
    marginTop: 3,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 11,
    marginTop: 16,
    paddingHorizontal: 5,
  },
  statText: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 13,
  },
  statNumber: {
    fontFamily: fontFamilies.sansExtraBold,
  },
  statDot: {
    fontSize: 13,
    opacity: 0.35,
  },
  sectLabel: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 10,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    marginTop: 22,
    marginBottom: 12,
    marginHorizontal: 4,
  },
  heroCover: {
    height: 168,
    width: '100%',
  },
  heroMeta: {
    paddingTop: 16,
    paddingHorizontal: 17,
    paddingBottom: 18,
  },
  heroMetaTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  heroMetaLeft: {
    flex: 1,
    minWidth: 0,
  },
  heroEyebrow: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 10,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
  },
  heroTitleEn: {
    fontFamily: fontFamilies.displayItalic,
    fontSize: 16,
    marginTop: 4,
  },
  heroWhen: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 11,
  },
  heroProgressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    marginTop: 14,
  },
  heroProgressBar: {
    flex: 1,
  },
  heroProgressPct: {
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 11.5,
  },
  libraryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
    paddingVertical: 2,
    paddingHorizontal: 5,
  },
  libraryLink: {
    flex: 1,
  },
  libraryLinkInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingVertical: 10,
  },
  libraryLinkText: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 13,
  },
  practiceRow: {
    flexDirection: 'row',
    gap: 12,
  },
  practiceCol: {
    flex: 1,
  },
  practiceCard: {
    flex: 1,
    minHeight: 150,
    paddingTop: 16,
    paddingBottom: 16,
    paddingHorizontal: 15,
  },
  practiceTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  practiceIconTile: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  practiceTitle: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 15,
    marginTop: 'auto',
    paddingTop: 14,
  },
  practiceSub: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 3,
  },
  practiceProgress: {
    marginTop: 11,
  },
});
