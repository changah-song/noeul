import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator, Alert, Image, Modal, Pressable, StyleSheet, Text, TextInput, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Feather } from '@expo/vector-icons';
import BookList from '../components/Home/BookList';
import { Card, IconButton, Screen } from '../components/ui';
import { colors, spacing, textStyles } from '../theme';
import useBooks from '../hooks/useBooks';
import { deleteBookIndexEntries, viewData } from '../services/Database';
import { getTodayProgress } from '../services/dailyProgress';

const Home = ({ books, setBooks, currentBook, setCurrentBook, setPreprocessOnOpen, user }) => {
    const [editBook, setEditBook] = useState(null);
    const [editDraft, setEditDraft] = useState({ title: '', author: '', cover: '' });
    const [stats, setStats] = useState({ saved: 0, mastered: 0, needsPractice: 0 });
    const [todayProgress, setTodayProgress] = useState({ readingMillis: 0, wordsStudied: 0 });
    const {
        isImporting,
        openingBookUri,
        confirmAddBook,
        handlePress,
    } = useBooks({
        books,
        setBooks,
        setCurrentBook,
        onBookImported: () => {},
    });

    const updateBookRecord = useCallback((uri, patch) => {
        setBooks((prevBooks) => prevBooks.map((book) => (
            book.uri === uri ? { ...book, ...patch } : book
        )));
    }, [setBooks]);

    const handleDeleteBook = useCallback((bookToDelete) => {
        Alert.alert(
            'Remove book',
            `Remove "${bookToDelete.title || 'Untitled'}" from your collection?`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Remove',
                    style: 'destructive',
                    onPress: async () => {
                        await deleteBookIndexEntries(bookToDelete.uri);
                        setBooks((prevBooks) => {
                            const remainingBooks = prevBooks.filter((book) => book.uri !== bookToDelete.uri);

                            if (currentBook === bookToDelete.uri) {
                                setCurrentBook(remainingBooks[0]?.uri ?? null);
                                setPreprocessOnOpen(false);
                            }

                            return remainingBooks;
                        });
                    },
                },
            ]
        );
    }, [currentBook, setBooks, setCurrentBook, setPreprocessOnOpen]);

    const handleEditBook = useCallback((book) => {
        if (!book) {
            return;
        }

        setEditBook(book);
        setEditDraft({
            title: book.title || '',
            author: book.author || '',
            cover: book.cover || '',
        });
    }, []);

    const handlePickCover = useCallback(async () => {
        try {
            const { assets } = await DocumentPicker.getDocumentAsync({
                type: ['image/*'],
                copyToCacheDirectory: true,
            });

            if (!assets?.[0]?.uri) {
                return;
            }

            setEditDraft((prev) => ({ ...prev, cover: assets[0].uri }));
        } catch (error) {
            console.error('[Home] Failed to pick cover:', error);
        }
    }, []);

    const handleSaveBookEdit = useCallback(() => {
        if (!editBook) {
            return;
        }

        updateBookRecord(editBook.uri, {
            title: editDraft.title.trim() || 'Untitled',
            author: editDraft.author.trim() || 'Unknown author',
            cover: editDraft.cover.trim() || null,
        });
        setEditBook(null);
    }, [editBook, editDraft.author, editDraft.cover, editDraft.title, updateBookRecord]);

    const hasBooks = books.length > 0;
    const userName = useMemo(() => {
        const metadataName = user?.user_metadata?.username
            || user?.user_metadata?.display_name
            || user?.user_metadata?.name;

        if (metadataName && String(metadataName).trim()) {
            return String(metadataName).trim();
        }

        const email = user?.email ?? '';
        const base = email.split('@')[0] || 'Reader';
        return base
            .split(/[._-]/)
            .filter(Boolean)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ');
    }, [user?.email, user?.user_metadata]);
    const greeting = useMemo(() => {
        const hour = new Date().getHours();
        return hour < 17 ? 'Good morning' : 'Good evening';
    }, []);
    const currentReadingBook = useMemo(() => (
        books.find((book) => book.uri === currentBook) ?? books[0] ?? null
    ), [books, currentBook]);
    const libraryBooks = useMemo(() => (
        books.filter((book) => book.uri !== currentReadingBook?.uri)
    ), [books, currentReadingBook?.uri]);
    const currentProgress = Math.min(Math.max(typeof currentReadingBook?.progress === 'number' ? currentReadingBook.progress : 0, 0), 1);
    const todayReadMinutes = Math.floor((todayProgress.readingMillis ?? 0) / 60000);
    const todayWordsStudied = todayProgress.wordsStudied ?? 0;
    const readingGoalMinutes = 15;
    const studyGoalWords = 5;
    const completedGoals = Number(todayReadMinutes >= readingGoalMinutes) + Number(todayWordsStudied >= studyGoalWords);

    useFocusEffect(
        useCallback(() => {
            let isActive = true;

            const loadHomeData = async () => {
                try {
                    const [rows, today] = await Promise.all([
                        viewData(),
                        getTodayProgress(),
                    ]);

                    if (!isActive) {
                        return;
                    }

                    const now = new Date();
                    const needsPractice = rows.filter(
                        (row) => row.next_review_at && new Date(row.next_review_at) <= now && row.level !== 'unorganized'
                    ).length;

                    setStats({
                        saved: rows.length,
                        mastered: rows.filter((row) => row.level === 'good').length,
                        needsPractice,
                    });
                    setTodayProgress(today);
                } catch (error) {
                    console.error('[Home] Failed to load home data:', error);
                }
            };

            loadHomeData();

            return () => {
                isActive = false;
            };
        }, [])
    );

    return (
        <Screen scroll contentContainerStyle={styles.screenContent}>
                <View style={styles.topBar}>
                    {!hasBooks ? (
                        <Text style={styles.topBarTitle}>Home</Text>
                    ) : (
                        <View>
                            <Text style={styles.greetingEyebrow}>{greeting}</Text>
                            <Text style={styles.greetingTitle}>{userName}</Text>
                        </View>
                    )}
                    {!hasBooks ? (
                        <TouchableOpacity
                            onPress={confirmAddBook}
                            style={styles.addButton}
                            activeOpacity={0.88}
                        >
                            <Feather name="plus" size={18} color={colors.accentStrong} />
                        </TouchableOpacity>
                    ) : <View style={styles.topBarSpacer} />}
                </View>

                {isImporting && !hasBooks ? (
                    <View style={styles.emptyScreen}>
                        <View style={styles.emptyMessageWrap}>
                            <ActivityIndicator size="small" color={colors.accentStrong} />
                            <Text style={styles.emptyHeadline}>Loading book…</Text>
                            <Text style={styles.emptyCopy}>
                                Preparing your shelf and book details.
                            </Text>
                        </View>
                    </View>
                ) : !hasBooks ? (
                    <View style={styles.emptyScreen}>
                        <View style={styles.emptyMessageWrap}>
                            <Text style={styles.emptyHeadline}>No books yet</Text>
                            <Text style={styles.emptyCopy}>
                                Upload a book to start building your reading shelf.
                            </Text>
                        </View>
                    </View>
                ) : (
                    <View style={styles.loadedLayout}>
                        <View style={styles.statsRow}>
                            <Card style={styles.statCard} contentStyle={styles.statCardContent}>
                                <Text style={styles.statValue}>{stats.saved}</Text>
                                <Text style={styles.statLabel}>words saved</Text>
                            </Card>
                            <Card style={styles.statCard} contentStyle={styles.statCardContent}>
                                <Text style={styles.statValue}>{stats.mastered}</Text>
                                <Text style={styles.statLabel}>words mastered</Text>
                            </Card>
                            <Card style={styles.statCard} contentStyle={styles.statCardContent}>
                                <Text style={styles.statValue}>{stats.needsPractice}</Text>
                                <Text style={styles.statLabel}>need practicing</Text>
                            </Card>
                        </View>

                        {currentReadingBook ? (
                            <View style={styles.currentSection}>
                                <Text style={styles.sectionHeading}>CONTINUE READING</Text>
                                <Pressable
                                    onPress={() => handlePress(currentReadingBook.uri)}
                                    style={({ pressed }) => pressed ? styles.currentCardPressed : null}
                                >
                                    <Card style={styles.currentCard} contentStyle={styles.currentCardContent}>
                                        <Image
                                            style={styles.currentCover}
                                            source={currentReadingBook.cover ? { uri: currentReadingBook.cover } : require('../assets/icon.png')}
                                        />

                                        <View style={styles.currentCopy}>
                                            <Text style={styles.currentTitle} numberOfLines={4}>
                                                {currentReadingBook.title || 'Untitled'}
                                            </Text>
                                            <Text style={styles.currentAuthor} numberOfLines={2}>
                                                {currentReadingBook.author || 'Unknown author'}
                                            </Text>
                                            <View style={styles.currentProgressWrap}>
                                                <View style={styles.currentProgressRail}>
                                                    <View style={styles.currentProgressTrack} />
                                                    <View
                                                        style={[
                                                            styles.currentProgressDot,
                                                            { left: `${currentProgress * 100}%` },
                                                        ]}
                                                    />
                                                </View>
                                                <Text style={styles.currentProgressText}>
                                                    {Math.round(currentProgress * 100)}% complete
                                                </Text>
                                            </View>
                                        </View>
                                    </Card>
                                </Pressable>
                            </View>
                        ) : null}

                        <View style={styles.shelfSection}>
                            <View style={styles.shelfHeader}>
                                <Text style={styles.sectionHeading}>MY SHELF</Text>
                                <TouchableOpacity onPress={confirmAddBook}>
                                    <Text style={styles.shelfImportLink}>+ Import .epub</Text>
                                </TouchableOpacity>
                            </View>

                            <View style={styles.shelfPanel}>
                                {isImporting ? (
                                    <View style={styles.shelfLoadingState}>
                                        <ActivityIndicator size="small" color={colors.accentStrong} />
                                        <Text style={styles.shelfLoadingTitle}>Loading book…</Text>
                                        <Text style={styles.shelfLoadingCopy}>
                                            Your new book will appear here in a moment.
                                        </Text>
                                    </View>
                                ) : libraryBooks.length > 0 ? (
                                    <BookList
                                        books={libraryBooks}
                                        onOpenBook={handlePress}
                                    />
                                ) : (
                                    <View style={styles.emptyLibraryState}>
                                        <Text style={styles.emptyLibraryTitle}>No other books yet</Text>
                                        <Text style={styles.emptyLibraryCopy}>
                                            Add another book to grow your shelf.
                                        </Text>
                                    </View>
                                )}
                            </View>
                        </View>

                        <View style={styles.goalSection}>
                            <Text style={styles.sectionHeading}>TODAY&apos;S GOAL</Text>
                            <Card style={styles.goalCard} contentStyle={styles.goalCardContent}>
                                <View style={styles.goalItemsRow}>
                                    <View style={styles.goalItem}>
                                        <View style={[styles.goalDot, todayReadMinutes >= readingGoalMinutes && styles.goalDotComplete]} />
                                        <Text style={styles.goalItemText}>Read {readingGoalMinutes} min</Text>
                                    </View>
                                    <View style={styles.goalItem}>
                                        <View style={[styles.goalDot, todayWordsStudied >= studyGoalWords && styles.goalDotComplete]} />
                                        <Text style={styles.goalItemText}>Learn {studyGoalWords} words</Text>
                                    </View>
                                </View>
                                <View style={styles.goalProgressTrack}>
                                    <View style={[styles.goalProgressFill, { width: `${(completedGoals / 2) * 100}%` }]} />
                                </View>
                                <Text style={styles.goalSummary}>
                                    {completedGoals} of 2 goals complete
                                    {completedGoals < 2 ? ' · keep going!' : ' · great work!'}
                                </Text>
                                <View style={styles.goalMetrics}>
                                    <Text style={styles.goalMetricText}>{todayReadMinutes} min read today</Text>
                                    <Text style={styles.goalMetricText}>{todayWordsStudied} words studied</Text>
                                </View>
                            </Card>
                        </View>
                    </View>
                )}

                {!!openingBookUri && (
                    <View style={styles.loadingOverlay}>
                        <ActivityIndicator size="small" color={colors.accentStrong} />
                        <Text style={styles.loadingText}>Opening book…</Text>
                    </View>
                )}

                <Modal visible={!!editBook} animationType="fade" transparent onRequestClose={() => setEditBook(null)}>
                    <TouchableWithoutFeedback onPress={() => setEditBook(null)}>
                        <View style={styles.modalBackdrop}>
                            <TouchableWithoutFeedback>
                                <View style={styles.editModal}>
                                    <Text style={styles.editTitle}>Edit book</Text>

                                    <Text style={styles.editLabel}>Title</Text>
                                    <TextInput
                                        value={editDraft.title}
                                        onChangeText={(title) => setEditDraft((prev) => ({ ...prev, title }))}
                                        style={styles.editInput}
                                        placeholder="Untitled"
                                        placeholderTextColor={colors.textSubtle}
                                    />

                                    <Text style={styles.editLabel}>Author</Text>
                                    <TextInput
                                        value={editDraft.author}
                                        onChangeText={(author) => setEditDraft((prev) => ({ ...prev, author }))}
                                        style={styles.editInput}
                                        placeholder="Unknown author"
                                        placeholderTextColor={colors.textSubtle}
                                    />

                                    <Text style={styles.editLabel}>Cover</Text>
                                    <View style={styles.coverRow}>
                                        <Image
                                            source={editDraft.cover ? { uri: editDraft.cover } : require('../assets/icon.png')}
                                            style={styles.coverPreview}
                                        />
                                        <View style={styles.coverActions}>
                                            <IconButton
                                                label="Change cover"
                                                onPress={handlePickCover}
                                                icon={<Feather name="image" size={15} color={colors.text} />}
                                            />
                                            <IconButton
                                                label="Remove cover"
                                                onPress={() => setEditDraft((prev) => ({ ...prev, cover: '' }))}
                                                icon={<Feather name="trash-2" size={15} color={colors.danger} />}
                                            />
                                        </View>
                                    </View>

                                    <View style={styles.modalActions}>
                                        <IconButton label="Cancel" onPress={() => setEditBook(null)} />
                                        <IconButton
                                            tone="accent"
                                            label="Save"
                                            onPress={handleSaveBookEdit}
                                            icon={<Feather name="check" size={15} color={colors.accentStrong} />}
                                        />
                                    </View>
                                </View>
                            </TouchableWithoutFeedback>
                        </View>
                    </TouchableWithoutFeedback>
                </Modal>

        </Screen>
    );
};

const styles = StyleSheet.create({
    screenContent: {
        flexGrow: 1,
        paddingBottom: spacing.xl,
    },
    topBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: spacing.md,
    },
    topBarTitle: {
        ...textStyles.sectionTitle,
        fontSize: 20,
    },
    greetingEyebrow: {
        ...textStyles.bodyMuted,
        fontSize: 14,
    },
    greetingTitle: {
        ...textStyles.hero,
        fontSize: 28,
        lineHeight: 34,
    },
    addButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.accentSoft,
    },
    topBarSpacer: {
        width: 40,
        height: 40,
    },
    emptyScreen: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    emptyMessageWrap: {
        maxWidth: 240,
        alignItems: 'center',
        gap: spacing.sm,
    },
    emptyHeadline: {
        ...textStyles.title,
        fontSize: 24,
        textAlign: 'center',
    },
    emptyCopy: {
        ...textStyles.bodyMuted,
        textAlign: 'center',
        lineHeight: 22,
    },
    loadedLayout: {
        gap: spacing.md,
    },
    statsRow: {
        flexDirection: 'row',
        gap: spacing.xs,
    },
    statCard: {
        flex: 1,
    },
    statCardContent: {
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
        gap: spacing.xxs,
    },
    statValue: {
        ...textStyles.title,
        fontSize: 18,
    },
    statLabel: {
        ...textStyles.bodyMuted,
        fontSize: 10,
    },
    sectionHeading: {
        ...textStyles.eyebrow,
        color: colors.textMuted,
        letterSpacing: 0.8,
        marginBottom: spacing.xs,
    },
    currentSection: {
        marginBottom: 0,
    },
    currentCard: {
        backgroundColor: colors.surfaceElevated,
        position: 'relative',
    },
    currentCardPressed: {
        opacity: 0.78,
    },
    currentCardContent: {
        padding: spacing.sm,
        flexDirection: 'row',
        gap: spacing.sm,
        alignItems: 'center',
    },
    currentCover: {
        width: 96,
        height: 128,
        borderRadius: 12,
        backgroundColor: colors.surfaceMuted,
        resizeMode: 'cover',
    },
    currentCopy: {
        flex: 1,
        minHeight: 128,
        justifyContent: 'center',
        paddingRight: spacing.xs,
    },
    currentTitle: {
        ...textStyles.title,
        fontSize: 17,
        lineHeight: 24,
    },
    currentAuthor: {
        ...textStyles.bodyMuted,
        marginTop: spacing.xs,
        fontSize: 13,
        lineHeight: 18,
    },
    currentProgressWrap: {
        marginTop: spacing.sm,
        gap: 4,
    },
    currentProgressRail: {
        height: 8,
        justifyContent: 'center',
        position: 'relative',
    },
    currentProgressTrack: {
        position: 'absolute',
        left: 0,
        right: 0,
        height: 2,
        borderRadius: 999,
        backgroundColor: colors.border,
    },
    currentProgressDot: {
        position: 'absolute',
        top: '50%',
        width: 8,
        height: 8,
        marginTop: -4,
        marginLeft: -4,
        borderRadius: 999,
        backgroundColor: '#6e6255',
    },
    currentProgressText: {
        ...textStyles.bodyMuted,
        fontSize: 11,
    },
    currentOpenButton: {
        width: 30,
        height: 30,
        borderRadius: 15,
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: 0,
    },
    shelfSection: {
        gap: spacing.xs,
    },
    shelfPanel: {
        borderRadius: 24,
        borderWidth: 1,
        borderColor: '#e6d7bf',
        backgroundColor: colors.surfaceElevated,
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.sm,
        paddingBottom: spacing.sm,
    },
    shelfHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 2,
    },
    shelfImportLink: {
        ...textStyles.sectionTitle,
        fontSize: 13,
        color: '#5067ff',
    },
    emptyLibraryState: {
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xl,
        borderRadius: 24,
        backgroundColor: colors.surfaceElevated,
        alignItems: 'center',
        gap: spacing.xs,
    },
    emptyLibraryTitle: {
        ...textStyles.sectionTitle,
        fontSize: 18,
    },
    emptyLibraryCopy: {
        ...textStyles.bodyMuted,
        textAlign: 'center',
        lineHeight: 21,
    },
    shelfLoadingState: {
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.lg,
        alignItems: 'center',
        gap: spacing.xs,
    },
    shelfLoadingTitle: {
        ...textStyles.sectionTitle,
        fontSize: 16,
    },
    shelfLoadingCopy: {
        ...textStyles.bodyMuted,
        textAlign: 'center',
        lineHeight: 20,
    },
    goalSection: {
        gap: spacing.sm,
        marginTop: 0,
    },
    goalCard: {
        backgroundColor: colors.surfaceElevated,
    },
    goalCardContent: {
        gap: spacing.sm,
    },
    goalItemsRow: {
        flexDirection: 'row',
        gap: spacing.lg,
        flexWrap: 'wrap',
    },
    goalItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
    },
    goalDot: {
        width: 18,
        height: 18,
        borderRadius: 9,
        backgroundColor: '#e2e2e2',
    },
    goalDotComplete: {
        backgroundColor: '#5067ff',
    },
    goalItemText: {
        ...textStyles.sectionTitle,
        fontSize: 14,
    },
    goalProgressTrack: {
        height: 4,
        borderRadius: 999,
        backgroundColor: colors.border,
        overflow: 'hidden',
    },
    goalProgressFill: {
        height: '100%',
        borderRadius: 999,
        backgroundColor: '#5067ff',
        minWidth: 12,
    },
    goalSummary: {
        ...textStyles.bodyMuted,
        fontSize: 11,
    },
    goalMetrics: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: spacing.md,
        flexWrap: 'wrap',
    },
    goalMetricText: {
        ...textStyles.bodyMuted,
        fontSize: 11,
    },
    loadingOverlay: {
        position: 'absolute',
        top: spacing.xl,
        alignSelf: 'center',
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderRadius: 999,
        backgroundColor: colors.surfaceElevated,
    },
    loadingText: {
        ...textStyles.caption,
        color: colors.textMuted,
    },
    modalBackdrop: {
        flex: 1,
        backgroundColor: colors.overlay,
        justifyContent: 'center',
        padding: spacing.xl,
    },
    editModal: {
        backgroundColor: colors.surfaceElevated,
        borderRadius: 28,
        padding: spacing.xl,
        gap: spacing.md,
    },
    editTitle: {
        ...textStyles.title,
    },
    editLabel: {
        ...textStyles.eyebrow,
    },
    editInput: {
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 16,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        color: colors.text,
        backgroundColor: colors.surface,
        ...textStyles.body,
    },
    coverRow: {
        flexDirection: 'row',
        gap: spacing.md,
        alignItems: 'center',
    },
    coverPreview: {
        width: 72,
        height: 108,
        borderRadius: 16,
        backgroundColor: colors.surfaceMuted,
    },
    coverActions: {
        flex: 1,
        gap: spacing.sm,
    },
    modalActions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: spacing.sm,
        marginTop: spacing.sm,
    },
});

export default Home;
