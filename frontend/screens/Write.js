import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { Screen, Card, Badge, GradientButton, IconButton, Press } from '../components/ui';
import { Gradients } from '../theme';
import { useBooks } from '../contexts/BooksContext';
import { useAppContext } from '../contexts/AppContext';
import { useLocalOwner } from '../contexts/LocalOwnerContext';
import {
  cloudWritingRowToEntry,
  fetchUserWritingEntries,
  softDeleteUserWritingEntry,
} from '../services/writingCloudSync';
import { GUEST_OWNER_ID, makeScopedStorageKey } from '../services/localDataScope';
import { isCurrentSyncGeneration } from '../services/localOwnerCoordinator';
import { subscribeToAssessments } from '../services/writingAssessmentManager';
import { elevation, radii, useTheme, withAlpha } from '../theme/tokens';
import { fontFamilies, typeScale, lineHeights } from '../theme/typography';
import { insets } from '../theme/spacing';

const LEGACY_STORAGE_KEY = 'writing_entries_v1';
const getWritingStorageKey = (ownerId) => makeScopedStorageKey(ownerId, 'writing-entries-v1');

// Keys mirror backend categories; uncategorized entries count as 'free'.
// 'free' also matches the backend's legacy 'sandbox' key. 'book_review'
// (entry about the book you're reading) gets the distinct amber treatment.
const CATEGORY_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'free', label: 'Free', matches: ['free', 'sandbox'] },
  { key: 'reflective', label: 'Reflective' },
  { key: 'persuasive', label: 'Persuasive' },
  { key: 'creative', label: 'Creative' },
  { key: 'book_review', label: 'Book review', book: true },
];

const DEFAULT_CATEGORY = 'free';

const normalizeEntry = (entry = {}, index = 0) => {
  const body = typeof entry.body === 'string' ? entry.body : entry.content ?? '';
  const date = entry.date ?? entry.createdAt ?? entry.updatedAt ?? new Date().toISOString();
  const title = typeof entry.title === 'string' && entry.title.trim()
    ? entry.title.trim()
    : 'Untitled entry';
  const assessment = entry.assessment ?? entry.review;
  return {
    id: entry.id ?? `entry-${index}-${Date.now()}`,
    title,
    body,
    prompt: entry.prompt ?? '',
    createdAt: entry.createdAt ?? date,
    updatedAt: entry.updatedAt ?? date,
    status: entry.status ?? (assessment ? 'reviewed' : 'draft'),
    category: entry.category ?? 'free',
    promptHidden: entry.promptHidden ?? false,
    assessment: assessment ?? null,
    deleted: entry.deleted ?? false,
  };
};

const getWordCount = (text = '') => text.trim().split(/\s+/).filter(Boolean).length;

const formatRelativeDate = (isoDate) => {
  if (!isoDate) return '';
  const diff = Date.now() - new Date(isoDate).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'TODAY';
  if (days === 1) return 'YESTERDAY';
  if (days < 7) return `${days} DAYS AGO`;
  if (days < 14) return 'LAST WEEK';
  return new Date(isoDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
};

const HANGUL_RE = /[ㄱ-ㆎ가-힣]/;

// The real /assess_entry/ payload has no feedback string — its summary is an
// object of {patterns, strengths, vocab_items}. Reduce whatever shape the
// entry carries (legacy mock, cloud row, or live API result) to one line.
const getAssessmentNote = (assessment) => {
  if (!assessment) return null;
  if (typeof assessment.feedback === 'string' && assessment.feedback.trim()) {
    return assessment.feedback;
  }
  const summary = assessment.summary;
  if (typeof summary === 'string' && summary.trim()) return summary;
  const fromList = (list) =>
    Array.isArray(list) && typeof list[0] === 'string' && list[0].trim() ? list[0] : null;
  return fromList(summary?.patterns) ?? fromList(summary?.strengths);
};

const getAssessmentScore = (assessment) => {
  const raw = assessment?.score ?? assessment?.overall_score;
  const num = typeof raw === 'string' ? Number(raw) : raw;
  return typeof num === 'number' && Number.isFinite(num) ? Math.round(num) : null;
};

const getAssessmentBand = (assessment) => {
  const raw = assessment?.band ?? assessment?.level;
  return typeof raw === 'string' && raw.trim() ? raw.trim().toUpperCase() : null;
};

export default function Write({ navigation }) {
  const { colors, isDarkMode } = useTheme();
  const { user } = useBooks();
  const { activeOwnerId, syncPaused, syncGeneration } = useLocalOwner();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [confirmVisible, setConfirmVisible] = useState(false);

  const loadEntries = useCallback(async () => {
    if (!activeOwnerId) return;
    setLoading(true);
    try {
      const storageKey = getWritingStorageKey(activeOwnerId);
      let raw = await AsyncStorage.getItem(storageKey);
      if (!raw && activeOwnerId === GUEST_OWNER_ID) {
        const legacyRaw = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
        if (legacyRaw) {
          const legacyParsed = JSON.parse(legacyRaw);
          if (Array.isArray(legacyParsed)) {
            raw = JSON.stringify(legacyParsed.map(normalizeEntry));
            await AsyncStorage.setItem(storageKey, raw);
          }
        }
      }
      const parsed = raw ? JSON.parse(raw) : [];
      let local = Array.isArray(parsed) ? parsed.map(normalizeEntry) : [];

      if (user?.id && activeOwnerId === user.id && !syncPaused && isCurrentSyncGeneration(syncGeneration)) {
        try {
          const cloudRows = await fetchUserWritingEntries(user.id, { includeDeleted: false });
          const cloudEntries = (cloudRows ?? []).map(cloudWritingRowToEntry).map(normalizeEntry);
          const localById = new Map(local.map((e) => [e.id, e]));
          cloudEntries.forEach((ce) => { if (!localById.has(ce.id)) local.push(ce); });
        } catch (e) {
          console.warn('[Write] Cloud sync failed:', e);
        }
      }

      setEntries(local.filter((e) => !e.deleted).sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      ));
    } catch (error) {
      console.warn('[Write] Load entries error:', error);
    } finally {
      setLoading(false);
    }
  }, [activeOwnerId, syncGeneration, syncPaused, user?.id]);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  useFocusEffect(useCallback(() => { loadEntries(); }, [loadEntries]));

  // A background assessment finished while this screen is up — refresh so
  // the new score appears without leaving and coming back.
  useEffect(() => subscribeToAssessments((event) => {
    if (event.type === 'success') loadEntries();
  }), [loadEntries]);

  const handleNewEntry = useCallback(() => {
    navigation.navigate('WritingCanvas', { entry: null });
  }, [navigation]);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
    setConfirmVisible(false);
  }, []);

  const toggleSelected = useCallback((entryId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  }, []);

  const handleLongPressEntry = useCallback((entry) => {
    setSelectMode(true);
    setSelectedIds((prev) => new Set(prev).add(entry.id));
  }, []);

  const handlePressEntry = useCallback((entry) => {
    if (selectMode) {
      toggleSelected(entry.id);
    } else {
      navigation.navigate('WritingCanvas', { entry });
    }
  }, [navigation, selectMode, toggleSelected]);

  const deleteSelected = useCallback(async () => {
    const idSet = new Set(selectedIds);
    setConfirmVisible(false);
    if (!activeOwnerId || idSet.size === 0) return;
    try {
      // Tombstone locally (deleted: true) rather than removing, so the cloud
      // merge in loadEntries can't resurrect entries if the remote soft
      // delete fails or hasn't propagated yet.
      const storageKey = getWritingStorageKey(activeOwnerId);
      const raw = await AsyncStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      const list = Array.isArray(parsed) ? parsed : [];
      const deletedAt = new Date().toISOString();
      const foundIds = new Set();
      const next = list.map((e) => {
        if (!idSet.has(e.id)) return e;
        foundIds.add(e.id);
        return { ...e, deleted: true, updatedAt: deletedAt };
      });
      entries
        .filter((e) => idSet.has(e.id) && !foundIds.has(e.id))
        .forEach((e) => next.push({ ...e, deleted: true, updatedAt: deletedAt }));
      await AsyncStorage.setItem(storageKey, JSON.stringify(next));
      setEntries((prev) => prev.filter((e) => !idSet.has(e.id)));

      if (user?.id && activeOwnerId === user.id && !syncPaused && isCurrentSyncGeneration(syncGeneration)) {
        for (const entryId of idSet) {
          try {
            await softDeleteUserWritingEntry({
              user,
              ownerId: activeOwnerId,
              generation: syncGeneration,
              entryId,
            });
          } catch (e) {
            console.warn('[Write] Cloud delete failed:', e);
          }
        }
      }
    } catch (error) {
      console.warn('[Write] Delete entries error:', error);
    } finally {
      setSelectMode(false);
      setSelectedIds(new Set());
    }
  }, [activeOwnerId, entries, selectedIds, syncGeneration, syncPaused, user]);

  const visibleEntries = useMemo(() => {
    if (categoryFilter === 'all') return entries;
    const filter = CATEGORY_FILTERS.find((f) => f.key === categoryFilter);
    const matches = filter?.matches ?? [categoryFilter];
    return entries.filter((e) => matches.includes(e.category ?? DEFAULT_CATEGORY));
  }, [entries, categoryFilter]);

  return (
    <Screen gradient edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Press
            onPress={() => navigation.goBack()}
            style={styles.backBtn}
            hitSlop={8}
          >
            <Feather name="chevron-left" size={22} color={colors.textMuted} />
          </Press>
          <Text style={[styles.title, { color: colors.text }]}>Writing</Text>
        </View>
        {selectMode ? (
          <View style={styles.headerActions}>
            <IconButton
              tone="muted"
              size={38}
              icon={<Feather name="trash-2" size={18} color={colors.danger} />}
              onPress={() => setConfirmVisible(true)}
              disabled={selectedIds.size === 0}
            />
            <IconButton
              tone="ghost"
              size={38}
              icon={<Feather name="x" size={20} color={colors.textMuted} />}
              onPress={exitSelectMode}
            />
          </View>
        ) : (
          <GradientButton
            label="New"
            icon={<Feather name="plus" size={16} color={colors.glyphCream} />}
            onPress={handleNewEntry}
            size="sm"
          />
        )}
      </View>

      <Text style={[styles.subtitle, { color: colors.textMuted }]}>
        {selectMode
          ? `${selectedIds.size} selected — tap entries to select`
          : 'Past entries with automated feedback scores'}
      </Text>

      <View style={styles.filterWrap}>
        {CATEGORY_FILTERS.map(({ key, label, book }) => {
          const active = categoryFilter === key;
          // Book pill is set apart: amber tint at rest, amber→rose fill active
          const gradient = book
            ? (isDarkMode ? Gradients.progressDusk : Gradients.progress)
            : (isDarkMode ? Gradients.accentDusk : Gradients.accent);
          const idleText = book ? colors.accent3 : colors.textMuted;
          return (
            <Press
              key={key}
              onPress={() => setCategoryFilter(key)}
              style={active ? elevation.fab : null}
            >
              <View
                style={[
                  styles.filterPill,
                  {
                    borderColor: active || book ? 'transparent' : colors.borderStrong,
                    backgroundColor:
                      !active && book
                        ? withAlpha(colors.accent3, isDarkMode ? 0.18 : 0.16)
                        : 'transparent',
                  },
                ]}
              >
                {active ? (
                  <LinearGradient
                    colors={gradient}
                    start={{ x: 0.2, y: 0 }}
                    end={{ x: 0.8, y: 1 }}
                    style={StyleSheet.absoluteFill}
                  />
                ) : null}
                {book ? (
                  <Feather
                    name="book-open"
                    size={12}
                    color={active ? colors.glyphCream : colors.accent3}
                  />
                ) : null}
                <Text
                  style={[
                    styles.filterLabel,
                    { color: active ? colors.glyphCream : idleText },
                  ]}
                >
                  {label}
                </Text>
              </View>
            </Press>
          );
        })}
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
        ) : entries.length === 0 ? (
          <View style={styles.emptyState}>
            <Feather name="edit-3" size={32} color={colors.textSubtle} />
            <Text style={[styles.emptyText, { color: colors.textMuted }]}>
              No entries yet. Tap "New" to start writing.
            </Text>
          </View>
        ) : visibleEntries.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={[styles.emptyText, { color: colors.textMuted }]}>
              No {CATEGORY_FILTERS.find((f) => f.key === categoryFilter)?.label.toLowerCase()} entries yet.
            </Text>
          </View>
        ) : (
          visibleEntries.map((entry) => {
            const wordCount = getWordCount(entry.body);
            const score = getAssessmentScore(entry.assessment);
            const band = getAssessmentBand(entry.assessment);
            const note = getAssessmentNote(entry.assessment);
            const titleIsKorean = HANGUL_RE.test(entry.title);
            const selected = selectedIds.has(entry.id);
            return (
              <Press
                key={entry.id}
                onPress={() => handlePressEntry(entry)}
                onLongPress={() => handleLongPressEntry(entry)}
                containerStyle={styles.entryWrap}
              >
                <Card
                  tone="glass"
                  padded={false}
                  contentStyle={[styles.entryCard, selectMode && styles.entryCardSelect]}
                  style={selected ? { borderColor: colors.accent } : null}
                >
                  {selectMode ? (
                    <View
                      style={[
                        styles.selectRing,
                        { borderColor: selected ? 'transparent' : colors.borderStrong },
                      ]}
                    >
                      {selected ? (
                        <>
                          <LinearGradient
                            colors={isDarkMode ? Gradients.accentDusk : Gradients.accent}
                            start={{ x: 0.2, y: 0 }}
                            end={{ x: 0.8, y: 1 }}
                            style={StyleSheet.absoluteFill}
                          />
                          <Feather name="check" size={13} color={colors.glyphCream} />
                        </>
                      ) : null}
                    </View>
                  ) : null}
                  <View style={styles.entryBody}>
                  <View style={styles.entryTop}>
                    <View style={styles.entryTopLeft}>
                      <Text style={[styles.entryMetaText, { color: colors.textTertiary }]}>
                        {formatRelativeDate(entry.updatedAt)}
                        {wordCount > 0 ? ` · ${wordCount} WORDS` : ''}
                      </Text>
                      <Text
                        style={[
                          styles.entryTitle,
                          titleIsKorean ? styles.entryTitleKr : styles.entryTitleLatin,
                          { color: colors.text },
                        ]}
                        numberOfLines={1}
                      >
                        {entry.title}
                      </Text>
                    </View>
                    {score != null ? (
                      <View style={[styles.scoreTile, { backgroundColor: colors.accentSoft }]}>
                        <Text style={[styles.scoreNumber, { color: colors.accent }]}>{score}</Text>
                        <Text style={[styles.scoreLabel, { color: colors.textTertiary }]}>SCORE</Text>
                      </View>
                    ) : null}
                  </View>
                  {note ? (
                    <View style={styles.noteRow}>
                      {band ? (
                        <View style={[styles.bandPill, { borderColor: colors.accent2 }]}>
                          <Text style={[styles.bandLabel, { color: colors.accent2 }]}>{band}</Text>
                        </View>
                      ) : null}
                      <Text style={[styles.noteText, { color: colors.textMuted }]} numberOfLines={2}>
                        {note}
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.noteRow}>
                      <Badge label={entry.status === 'draft' ? 'Draft' : 'Saved'} tone="neutral" />
                    </View>
                  )}
                  </View>
                </Card>
              </Press>
            );
          })
        )}
        <View style={{ height: insets.screenBottom + 8 }} />
      </ScrollView>

      {confirmVisible ? (
        <View style={styles.confirmWrap} pointerEvents="box-none">
          <Card tone="glass" glow radius="lg" contentStyle={styles.confirmContent}>
            <Text style={[styles.confirmText, { color: colors.text }]}>
              Delete {selectedIds.size === 1 ? 'this entry' : `${selectedIds.size} entries`}?
              {' '}This can't be undone.
            </Text>
            <View style={styles.confirmActions}>
              <GradientButton
                label="Cancel"
                variant="secondary"
                size="sm"
                onPress={() => setConfirmVisible(false)}
              />
              <GradientButton
                label="Delete"
                variant="danger"
                size="sm"
                onPress={deleteSelected}
              />
            </View>
          </Card>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  // Header — prototype: back 38×38 at -8px, 26px Fraunces title, gap 6, "New" pill right
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: insets.screenHorizontal,
    paddingTop: 8,
  },
  headerLeft: {
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
    lineHeight: 32,
  },
  subtitle: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 12.5,
    lineHeight: 17,
    marginTop: 4,
    marginHorizontal: insets.screenHorizontal + 4,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  filterWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: insets.screenHorizontal,
    marginTop: 14,
  },
  // Prototype .lvl-opt pill: radius 11, hairline outline, 12px/700 label;
  // active = accent gradient fill + glow
  filterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingHorizontal: 14,
    paddingVertical: 8,
    overflow: 'hidden',
  },
  filterLabel: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 12,
    lineHeight: 15,
  },
  scrollContent: {
    paddingHorizontal: insets.screenHorizontal,
    paddingTop: 14,
  },
  entryWrap: {
    marginBottom: 14,
  },
  entryCard: {
    paddingVertical: 16,
    paddingHorizontal: 17,
  },
  entryCardSelect: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  entryBody: {
    flex: 1,
    minWidth: 0,
  },
  selectRing: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  entryTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  entryTopLeft: {
    flex: 1,
    minWidth: 0,
  },
  entryMetaText: {
    fontFamily: fontFamilies.sansBold,
    fontSize: typeScale.micro,
    lineHeight: lineHeights.micro,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
  },
  entryTitle: {
    fontSize: 17,
    lineHeight: 24,
    marginTop: 5,
  },
  entryTitleKr: {
    fontFamily: fontFamilies.krSerifRegular,
  },
  entryTitleLatin: {
    fontFamily: fontFamilies.displayRegular,
  },
  scoreTile: {
    width: 48,
    height: 48,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreNumber: {
    fontFamily: fontFamilies.sansExtraBold,
    fontSize: 18,
    lineHeight: 18,
  },
  scoreLabel: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 7.5,
    lineHeight: 9,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 1,
  },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  bandPill: {
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  bandLabel: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  noteText: {
    flex: 1,
    fontFamily: fontFamilies.sansRegular,
    fontSize: 11.5,
    lineHeight: 16,
  },
  confirmWrap: {
    position: 'absolute',
    left: insets.screenHorizontal,
    right: insets.screenHorizontal,
    bottom: insets.screenBottom,
  },
  confirmContent: {
    padding: 19,
    gap: 14,
  },
  confirmText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: typeScale.body,
    lineHeight: lineHeights.body,
  },
  confirmActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: 60,
    gap: 12,
  },
  emptyText: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: typeScale.body,
    textAlign: 'center',
    maxWidth: 260,
  },
});
