import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Screen, Card, BookCover, Press, GradientButton } from '../components/ui';
import { useBooks } from '../contexts/BooksContext';
import { useAppContext } from '../contexts/AppContext';
import { useLocalOwner } from '../contexts/LocalOwnerContext';
import useBooksHook from '../hooks/useBooks';
import { getPublicDomainBooks } from '../services/publicDomainBooks';
import { radii, useTheme } from '../theme/tokens';
import { fontFamilies } from '../theme/typography';
import { spacing, insets } from '../theme/spacing';

const TABS = ['Books', 'Songs'];

// The prototype's per-book cover gradient pairs — sunset palette colors
// cycled by shelf position when a book has no extracted cover colors.
const SUNSET_COVER_GRADIENTS = [
  ['#EE9A4C', '#C9506A'],
  ['#D85C76', '#4B3F6B'],
  ['#E0654A', '#7A3D5A'],
  ['#F4A65C', '#E76A4B'],
  ['#C9506A', '#4B3F6B'],
  ['#7A3D5A', '#E0654A'],
];

const coverGradientFor = (book, index) => (
  book?.coverAccentColor && book?.coverBackgroundColor
    ? [book.coverAccentColor, book.coverBackgroundColor]
    : SUNSET_COVER_GRADIENTS[index % SUNSET_COVER_GRADIENTS.length]
);

const bookTimestamp = (book) => (
  Date.parse(book?.lastOpenedAt ?? book?.updatedAt ?? '') || 0
);

const progressStatus = (pct) => {
  if (pct <= 0) return 'Not started';
  if (pct >= 100) return 'Finished';
  return `${pct}%`;
};

export default function Library({ navigation }) {
  const { colors } = useTheme();
  const { books, setBooks, setCurrentBook, setPreprocessOnOpen, user } = useBooks();
  const { activeOwnerId, syncGeneration } = useLocalOwner();
  const { targetLanguage } = useAppContext();
  const [activeTab, setActiveTab] = useState('Books');

  const {
    isImporting,
    addBook,
    handlePress,
    pdfCoverPrompt,
    pdfCoverPageInput,
    setPdfCoverPageInput,
    choosePdfCoverDefault,
    choosePdfCoverNone,
    choosePdfCoverCustom,
  } = useBooksHook({
    books,
    setBooks,
    setCurrentBook,
    onBookImported: () => {},
    user,
    ownerId: activeOwnerId,
    syncGeneration,
    targetLanguage,
  });

  const shelfBooks = useMemo(
    () => [...books].sort((a, b) => bookTimestamp(b) - bookTimestamp(a)),
    [books]
  );

  const publicDomainBooks = useMemo(
    () => getPublicDomainBooks(targetLanguage),
    [targetLanguage]
  );

  const handleOpenPublicDomainBook = useCallback((pdBook) => {
    const openedAt = new Date().toISOString();
    const localBook = {
      ...pdBook,
      publicDomain: true,
      downloaded: true,
      lastOpenedAt: openedAt,
      originalTitle: pdBook.title,
      originalAuthor: pdBook.author,
      originalCover: null,
      originalFilename: pdBook.title,
    };

    setBooks((prevBooks) => {
      const exists = prevBooks.some((book) => book.uri === localBook.uri);
      if (exists) {
        return prevBooks.map((book) => (
          book.uri === localBook.uri
            ? { ...localBook, ...book, lastOpenedAt: openedAt }
            : book
        ));
      }
      return [...prevBooks, localBook];
    });
    setCurrentBook(localBook.uri);
    setPreprocessOnOpen(false);
    navigation.navigate('Reader', { returnTo: 'Home' });
  }, [setBooks, setCurrentBook, setPreprocessOnOpen, navigation]);

  const isBooksTab = activeTab === 'Books';

  return (
    <Screen gradient edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.headerRow}>
          <Press onPress={() => navigation.goBack()} containerStyle={styles.backBtn} hitSlop={8}>
            <View style={styles.backBtnInner}>
              <Feather name="chevron-left" size={22} color={colors.textMuted} />
            </View>
          </Press>
          <Text style={[styles.title, { color: colors.text }]}>Library</Text>
        </View>
        <Text style={[styles.subtitle, { color: colors.textMuted }]}>
          Your books & songs · sorted by recent
        </Text>

        {/* Segmented: books / songs */}
        <Card tone="glass" padded={false} contentStyle={styles.segmentRow}>
          {TABS.map((tab) => {
            const isActive = activeTab === tab;
            return (
              <Press
                key={tab}
                onPress={() => setActiveTab(tab)}
                containerStyle={styles.segmentTabWrap}
                style={[
                  styles.segmentTab,
                  isActive && { backgroundColor: colors.surfaceStrong },
                ]}
              >
                <Feather
                  name={tab === 'Books' ? 'book-open' : 'music'}
                  size={15}
                  color={isActive ? colors.text : colors.textMuted}
                />
                <Text style={[styles.segmentLabel, { color: isActive ? colors.text : colors.textMuted }]}>
                  {tab}
                </Text>
              </Press>
            );
          })}
        </Card>

        {/* Import dropzone */}
        <View style={[styles.dropzone, { borderColor: colors.borderStrong }]}>
          <View style={[styles.importIconTile, { backgroundColor: colors.accentSoft }]}>
            <Feather name="upload-cloud" size={24} color={colors.accent} />
          </View>
          <Text style={[styles.importTitle, { color: colors.text }]}>Import a book</Text>
          <Text style={[styles.importSub, { color: colors.textMuted }]}>
            Drop an EPUB or paste a text block — we'll parse & level every word for immersion reading.
          </Text>
          <Press onPress={addBook} disabled={isImporting}>
            <View style={[
              styles.chooseFileBtn,
              { borderColor: colors.borderStrong, backgroundColor: colors.surfaceMuted },
            ]}>
              <Text style={[styles.chooseFileLabel, { color: colors.text }]}>Choose file</Text>
            </View>
          </Press>
          {isImporting ? (
            <View style={styles.importStatus}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={[styles.importStatusText, { color: colors.textMuted }]}>
                Parsing & leveling your book…
              </Text>
            </View>
          ) : null}
        </View>

        {/* Shelf / songs */}
        <Text style={[styles.sectLabel, { color: colors.textTertiary }]}>
          {isBooksTab ? 'On your shelf' : 'Your songs'}
        </Text>
        {isBooksTab ? (
          shelfBooks.length > 0 ? (
            <View style={styles.grid}>
              {shelfBooks.map((book, index) => {
                const pct = Math.round((book.progress ?? 0) * 100);
                const hasCoverImage = typeof book.cover === 'string' && book.cover.length > 0;
                return (
                  <Press
                    key={book.uri ?? book.id}
                    onPress={() => handlePress(book.uri)}
                    containerStyle={styles.gridItem}
                  >
                    <BookCover
                      title={book.title}
                      aspect={0.72}
                      radius={12}
                      padding={12}
                      spineWidth={5}
                      titleSize={16}
                      lift
                      gradientColors={coverGradientFor(book, index)}
                      showTitle={!hasCoverImage}
                    >
                      {hasCoverImage ? (
                        <Image
                          source={{ uri: book.cover }}
                          style={StyleSheet.absoluteFill}
                          resizeMode="cover"
                        />
                      ) : null}
                      {pct > 0 && pct < 100 ? (
                        <View style={[styles.coverProgress, { width: `${pct}%` }]} />
                      ) : null}
                      {pct >= 100 ? (
                        <View style={styles.coverCheck}>
                          <Feather name="check" size={14} color={colors.accent} />
                        </View>
                      ) : null}
                    </BookCover>
                    <Text style={[styles.gridTitle, { color: colors.text }]} numberOfLines={1}>
                      {book.titleTranslation ?? book.title ?? 'Untitled'}
                    </Text>
                    <Text style={[styles.gridMeta, { color: colors.textTertiary }]} numberOfLines={1}>
                      {book.author ? `${book.author} · ` : ''}{progressStatus(pct)}
                    </Text>
                  </Press>
                );
              })}
            </View>
          ) : null
        ) : (
          <View style={styles.emptyTab}>
            <Feather name="music" size={32} color={colors.textSubtle} />
            <Text style={[styles.emptyText, { color: colors.textMuted }]}>No songs yet</Text>
          </View>
        )}

        {/* Public domain · pre-installed */}
        <View style={styles.pdHeaderRow}>
          <Text style={[styles.sectLabel, styles.pdLabel, { color: colors.textTertiary }]}>
            Public domain · pre-installed
          </Text>
          <Text style={[styles.pdFree, { color: colors.textTertiary }]}>Free forever</Text>
        </View>
        <Text style={[styles.pdIntro, { color: colors.textMuted }]}>
          Classic Korean literature bundled with the app — already leveled and ready to read.
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.pdScroll}
          contentContainerStyle={styles.pdRow}
        >
          {publicDomainBooks.map((book, index) => {
            const levelLabel = book.difficulty ?? book.bookLevel?.level ?? null;
            return (
              <Press
                key={book.uri}
                onPress={() => handleOpenPublicDomainBook(book)}
                containerStyle={styles.pdItem}
              >
                <BookCover
                  title={book.title}
                  aspect={0.72}
                  radius={12}
                  padding={11}
                  spineWidth={5}
                  titleSize={15}
                  lift
                  gradientColors={SUNSET_COVER_GRADIENTS[index % SUNSET_COVER_GRADIENTS.length]}
                >
                  {levelLabel ? (
                    <View style={styles.pdBadge}>
                      <Text style={styles.pdBadgeText}>{levelLabel}</Text>
                    </View>
                  ) : null}
                </BookCover>
                <Text style={[styles.pdTitle, { color: colors.text }]} numberOfLines={1}>
                  {book.titleTranslation ?? book.title}
                </Text>
                <Text style={[styles.pdAuthor, { color: colors.textTertiary }]} numberOfLines={1}>
                  {book.author}
                </Text>
              </Press>
            );
          })}
        </ScrollView>
      </ScrollView>

      {/* PDF cover choice — the import flow awaits this prompt for PDFs */}
      <Modal
        visible={!!pdfCoverPrompt}
        animationType="fade"
        transparent
        onRequestClose={choosePdfCoverDefault}
      >
        <View style={[styles.modalBackdrop, { backgroundColor: colors.overlay }]}>
          <Card tone="solid" radius="xl" style={styles.pdfModal}>
            <Text style={[styles.pdfModalTitle, { color: colors.text }]}>PDF cover</Text>
            <Text style={[styles.pdfModalCopy, { color: colors.textMuted }]}>
              {pdfCoverPrompt?.pageCount
                ? `"${pdfCoverPrompt.title}" has ${pdfCoverPrompt.pageCount} pages. Which page should be the cover?`
                : `"${pdfCoverPrompt?.title || 'PDF'}" is ready. Which page should be the cover?`}
            </Text>
            <GradientButton label="Use first page" size="sm" onPress={choosePdfCoverDefault} />
            <Text style={[styles.pdfModalLabel, { color: colors.textMuted }]}>Specific page</Text>
            <TextInput
              value={pdfCoverPageInput}
              onChangeText={setPdfCoverPageInput}
              onSubmitEditing={choosePdfCoverCustom}
              style={[styles.pdfModalInput, {
                borderColor: colors.borderStrong,
                color: colors.text,
                backgroundColor: colors.surfaceMuted,
              }]}
              placeholder="1"
              placeholderTextColor={colors.textSubtle}
              keyboardType="number-pad"
              inputMode="numeric"
              returnKeyType="done"
              selectTextOnFocus
            />
            <View style={styles.pdfModalActions}>
              <GradientButton
                label="No cover"
                variant="secondary"
                size="sm"
                onPress={choosePdfCoverNone}
                style={styles.pdfModalAction}
              />
              <GradientButton
                label="Use page"
                variant="secondary"
                size="sm"
                onPress={choosePdfCoverCustom}
                style={styles.pdfModalAction}
              />
            </View>
          </Card>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: insets.screenHorizontal,
    paddingTop: 6,
    paddingBottom: insets.screenBottom + spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 2,
  },
  backBtn: {
    marginLeft: -8,
  },
  backBtnInner: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: fontFamilies.displayMedium,
    fontSize: 26,
  },
  subtitle: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 12.5,
    marginTop: 4,
    marginHorizontal: 4,
  },
  segmentRow: {
    flexDirection: 'row',
    padding: 5,
    gap: 5,
  },
  segmentTabWrap: {
    flex: 1,
  },
  segmentTab: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: 12,
  },
  segmentLabel: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 12,
  },
  dropzone: {
    marginTop: 18,
    paddingVertical: 24,
    paddingHorizontal: 18,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: 18,
    alignItems: 'center',
  },
  importIconTile: {
    width: 46,
    height: 46,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  importTitle: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 14,
  },
  importSub: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 11.5,
    lineHeight: 17,
    textAlign: 'center',
    marginTop: 5,
    maxWidth: 250,
  },
  chooseFileBtn: {
    marginTop: 14,
    paddingVertical: 9,
    paddingHorizontal: 18,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  chooseFileLabel: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 12,
  },
  importStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
  },
  importStatusText: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 12,
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
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 16,
  },
  gridItem: {
    width: '48%',
  },
  coverProgress: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
  coverCheck: {
    position: 'absolute',
    top: 9,
    right: 9,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridTitle: {
    fontFamily: fontFamilies.displayRegular,
    fontSize: 13,
    lineHeight: 17,
    marginTop: 8,
  },
  gridMeta: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 11,
    marginTop: 1,
  },
  emptyTab: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 12,
  },
  emptyText: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 14,
  },
  pdHeaderRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: 26,
  },
  pdLabel: {
    marginTop: 0,
    marginBottom: 0,
  },
  pdFree: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 10.5,
  },
  pdIntro: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 11.5,
    lineHeight: 17,
    marginTop: 8,
    marginHorizontal: 4,
  },
  pdScroll: {
    marginTop: 14,
    marginHorizontal: -insets.screenHorizontal,
  },
  pdRow: {
    paddingHorizontal: insets.screenHorizontal,
    paddingTop: 2,
    paddingBottom: 6,
    gap: 14,
  },
  pdItem: {
    width: 118,
  },
  pdBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 5,
    backgroundColor: 'rgba(0,0,0,0.22)',
  },
  pdBadgeText: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 8,
    letterSpacing: 0.6,
    color: 'rgba(255,255,255,0.9)',
  },
  pdTitle: {
    fontFamily: fontFamilies.displayRegular,
    fontSize: 12.5,
    lineHeight: 16,
    marginTop: 7,
  },
  pdAuthor: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 10.5,
    marginTop: 1,
  },
  modalBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  pdfModal: {
    width: '100%',
    maxWidth: 340,
  },
  pdfModalTitle: {
    fontFamily: fontFamilies.displayMedium,
    fontSize: 19,
    lineHeight: 24,
    marginBottom: spacing.xs,
  },
  pdfModalCopy: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: spacing.md,
  },
  pdfModalLabel: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 11,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  pdfModalInput: {
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingVertical: 12,
    paddingHorizontal: 14,
    fontFamily: fontFamilies.sansRegular,
    fontSize: 15,
  },
  pdfModalActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  pdfModalAction: {
    flex: 1,
  },
});
