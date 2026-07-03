import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Screen, Card, Press } from '../components/ui';
import { useAppContext } from '../contexts/AppContext';
import { useLocalOwner } from '../contexts/LocalOwnerContext';
import { viewData } from '../services/Database';
import { normalizeBookLanguage } from '../constants/languages';
import { elevation, useTheme } from '../theme/tokens';
import { fontFamilies } from '../theme/typography';
import { insets } from '../theme/spacing';
import { Gradients, Motion } from '../theme';

const FILTERS = [
  { key: 'recent', label: 'Recent' },
  { key: 'starred', label: 'Starred' },
  { key: 'maturity', label: 'Maturity' },
  { key: 'not-seen', label: 'Not seen' },
];

// Word maturity — drives the row's status pill and encounter dots.
// matured: seen 13+ · waiting: seen 3–12 · notseen: seen < 3
const STATUS_META = {
  matured: { label: 'Matured', colorKey: 'success', dots: 4 },
  waiting: { label: 'Waiting', colorKey: 'accent3', dots: 2 },
  notseen: { label: 'Not seen', colorKey: 'textSubtle', dots: 1 },
};

const numericValue = (v) => (typeof v === 'number' ? v : parseInt(v, 10) || 0);

const normalizeRows = (rows) =>
  rows.map((row) => ({
    ...row,
    is_favorite: Boolean(row.is_favorite),
    correct_count: numericValue(row.correct_count),
    wrong_count: numericValue(row.wrong_count),
    created_at: row.created_at ?? null,
    next_review_at: row.next_review_at ?? null,
  }));

const getSeenCount = (w) => numericValue(w.correct_count) + numericValue(w.wrong_count);

const getStatus = (w) => {
  const seen = getSeenCount(w);
  if (seen >= 13) return 'matured';
  if (seen >= 3) return 'waiting';
  return 'notseen';
};

const isReviewDue = (w, now = Date.now()) => {
  if (!w.next_review_at) return false;
  const ts = new Date(w.next_review_at).getTime();
  return Number.isFinite(ts) && ts <= now;
};

const isNotSeenLately = (w) => {
  const date = w.last_reviewed_at ?? w.created_at;
  if (!date) return true;
  const ts = new Date(date).getTime();
  return !Number.isFinite(ts) || Date.now() - ts > 7 * 86400000;
};

const getFilteredWords = (rows, filter) => {
  if (filter === 'starred') return [...rows].filter((w) => w.is_favorite);
  if (filter === 'not-seen') return [...rows].filter(isNotSeenLately);
  if (filter === 'maturity') return [...rows].sort((a, b) => getSeenCount(b) - getSeenCount(a));
  return [...rows].sort((a, b) =>
    new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
  );
};

const formatWhen = (date) =>
  date ? new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';

export default function Learn({ navigation, user }) {
  const { colors, isDarkMode } = useTheme();
  const { activeOwnerId } = useLocalOwner();
  const { targetLanguage } = useAppContext();
  const [words, setWords] = useState([]);
  const [activeFilter, setActiveFilter] = useState('recent');
  const [loading, setLoading] = useState(true);

  const fetchWords = useCallback(async () => {
    try {
      const data = await viewData({ ownerId: activeOwnerId, language: normalizeBookLanguage(targetLanguage) });
      setWords(normalizeRows(data ?? []));
    } catch (err) {
      console.warn('[Learn] fetchWords error:', err);
    } finally {
      setLoading(false);
    }
  }, [activeOwnerId, targetLanguage]);

  useEffect(() => { setWords([]); setLoading(true); fetchWords(); }, [activeOwnerId, fetchWords, targetLanguage]);
  useFocusEffect(useCallback(() => { fetchWords(); }, [fetchWords]));

  const filteredWords = useMemo(() => getFilteredWords(words, activeFilter), [words, activeFilter]);
  const dueCount = useMemo(() => words.filter(isReviewDue).length, [words]);
  const maturedCount = useMemo(() => words.filter((w) => getStatus(w) === 'matured').length, [words]);
  const waitingCount = useMemo(() => words.filter((w) => getStatus(w) === 'waiting').length, [words]);
  const notSeenCount = useMemo(() => words.filter((w) => getStatus(w) === 'notseen').length, [words]);

  const handleReviewDue = useCallback(() => {
    const deck = words.filter(isReviewDue);
    if (deck.length > 0) {
      navigation.navigate('Flashcards', { deck });
    }
  }, [navigation, words]);

  const handleKeepReading = useCallback(() => {
    navigation.navigate('Reader');
  }, [navigation]);

  const handleWordPress = useCallback((word) => {
    navigation.navigate('VocabDetail', { word });
  }, [navigation]);

  const stats = [
    { value: maturedCount, label: 'MATURED\nTHROUGH\nREADING' },
    { value: waitingCount, label: 'WAITING FOR\nANOTHER\nENCOUNTER' },
    { value: notSeenCount, label: 'NOT\nSEEN' },
  ];

  return (
    <Screen gradient edges={['top', 'left', 'right']}>
      {/* Fixed header — title, stats card, and tabs; only the list scrolls */}
      <View style={styles.fixedTop}>
        <View style={styles.headerRow}>
          <Press onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={8}>
            <Feather name="chevron-left" size={22} color={colors.textMuted} />
          </Press>
          <Text style={[styles.title, { color: colors.text }]}>Vocabulary</Text>
        </View>

        {/* Stats card */}
        <Card tone="glass" padded={false} style={styles.statsCard} contentStyle={styles.statsCardContent}>
          <View style={styles.statsRow}>
            {stats.map((stat, i) => (
              <React.Fragment key={stat.label}>
                <View style={styles.statCol}>
                  <Text style={[styles.statNumber, { color: colors.text }]}>{stat.value}</Text>
                  <Text style={[styles.statLabel, { color: colors.textTertiary }]}>{stat.label}</Text>
                </View>
                {i < stats.length - 1 ? (
                  <View style={[styles.statDivider, { backgroundColor: colors.divider }]} />
                ) : null}
              </React.Fragment>
            ))}
          </View>
          <View style={styles.actionRow}>
            <Press
              onPress={handleReviewDue}
              disabled={dueCount === 0}
              containerStyle={styles.reviewBtnContainer}
              style={dueCount === 0 ? { opacity: Motion.disabledOpacity } : null}
            >
              <LinearGradient
                colors={isDarkMode ? Gradients.accentDusk : Gradients.accent}
                start={{ x: 0.2, y: 0 }}
                end={{ x: 0.8, y: 1 }}
                style={[styles.reviewBtn, elevation.fab]}
              >
                <Text style={[styles.actionLabel, { color: colors.glyphCream }]}>
                  {`Review ${dueCount} due`}
                </Text>
              </LinearGradient>
            </Press>
            <Press
              onPress={handleKeepReading}
              containerStyle={styles.ghostBtnContainer}
              style={[styles.ghostBtn, { borderColor: colors.borderStrong }]}
            >
              <Text style={[styles.actionLabel, { color: colors.textMuted }]}>Keep reading</Text>
            </Press>
          </View>
        </Card>

        {/* Filter tabs */}
        <View style={[styles.tabRow, { borderBottomColor: colors.divider }]}>
          {FILTERS.map((f) => {
            const active = activeFilter === f.key;
            return (
              <Press key={f.key} onPress={() => setActiveFilter(f.key)} style={styles.tab}>
                <Text style={[styles.tabLabel, { color: active ? colors.text : colors.textTertiary }]}>
                  {f.label}
                </Text>
                {active ? (
                  <View style={[styles.tabUnderline, { backgroundColor: colors.accent }]} />
                ) : null}
              </Press>
            );
          })}
        </View>
      </View>

      {/* Word list */}
      <ScrollView contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
        {loading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
        ) : filteredWords.length === 0 ? (
          <Text style={[styles.emptyText, { color: colors.textSubtle }]}>
            No words in this view yet.
          </Text>
        ) : (
          filteredWords.map((word) => {
            const status = STATUS_META[getStatus(word)];
            const statusColor = colors[status.colorKey];
            return (
              <Press key={`${word.word}|${word.hanja}`} onPress={() => handleWordPress(word)}>
                <Card tone="glass" padded={false} contentStyle={styles.wordCardContent}>
                  <View style={styles.wordCardTop}>
                    <View style={styles.wordMain}>
                      <View style={styles.wordTitleRow}>
                        <Text style={[styles.wordKorean, { color: colors.text }]}>{word.word}</Text>
                        {word.hanja ? (
                          <Text style={[styles.wordHanja, { color: colors.textTertiary }]}>{word.hanja}</Text>
                        ) : null}
                        <View style={[styles.statusPill, { borderColor: statusColor }]}>
                          <Text style={[styles.statusPillLabel, { color: statusColor }]}>{status.label}</Text>
                        </View>
                        {word.is_favorite ? (
                          <MaterialIcons name="star" size={13} color={colors.accent3} />
                        ) : null}
                      </View>
                      <Text style={[styles.wordDef, { color: colors.textSecondary }]}>
                        {word.def ?? ''}
                      </Text>
                      <Text style={[styles.wordMeta, { color: colors.textTertiary }]}>
                        {`times encountered · ×${getSeenCount(word)} · ${formatWhen(word.created_at)}`}
                      </Text>
                    </View>
                    <View style={styles.dotsRow}>
                      {[0, 1, 2, 3].map((i) => (
                        <View
                          key={i}
                          style={[
                            styles.dot,
                            { backgroundColor: i < status.dots ? statusColor : colors.borderStrong },
                          ]}
                        />
                      ))}
                    </View>
                  </View>
                </Card>
              </Press>
            );
          })
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fixedTop: {
    paddingHorizontal: insets.screenHorizontal,
    paddingTop: 2,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  backBtn: {
    width: 38,
    height: 38,
    marginLeft: -8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: fontFamilies.displayMedium,
    fontSize: 26,
  },
  statsCard: {
    marginTop: 14,
  },
  statsCardContent: {
    paddingTop: 16,
    paddingHorizontal: 6,
    paddingBottom: 12,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  statCol: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  statNumber: {
    fontFamily: fontFamilies.displaySemiBold,
    fontSize: 30,
    lineHeight: 30,
  },
  statLabel: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 8.5,
    lineHeight: 12,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    textAlign: 'center',
    marginTop: 8,
  },
  statDivider: {
    width: 1,
    marginVertical: 2,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 15,
    paddingHorizontal: 8,
  },
  reviewBtnContainer: {
    flex: 1.5,
  },
  reviewBtn: {
    height: 44,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostBtnContainer: {
    flex: 1,
  },
  ghostBtn: {
    height: 44,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  tabRow: {
    flexDirection: 'row',
    gap: 22,
    marginTop: 18,
    borderBottomWidth: 1,
  },
  tab: {
    paddingBottom: 11,
    position: 'relative',
  },
  tabLabel: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 11,
    letterSpacing: 1.3,
    textTransform: 'uppercase',
  },
  tabUnderline: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: -1,
    height: 2,
    borderRadius: 2,
  },
  listContent: {
    paddingTop: 14,
    paddingHorizontal: insets.screenHorizontal,
    paddingBottom: 40,
    gap: 10,
  },
  wordCardContent: {
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  wordCardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  wordMain: {
    flex: 1,
    minWidth: 0,
  },
  wordTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 9,
  },
  wordKorean: {
    fontFamily: fontFamilies.krSerifSemiBold,
    fontSize: 19,
  },
  wordHanja: {
    fontFamily: fontFamilies.krSerifRegular,
    fontSize: 13,
  },
  statusPill: {
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  statusPillLabel: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 8.5,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  wordDef: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 13.5,
    marginTop: 4,
  },
  wordMeta: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 11,
    marginTop: 5,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingTop: 5,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});
