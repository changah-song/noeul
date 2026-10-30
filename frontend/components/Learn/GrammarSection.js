import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from '../../hooks/useTranslation';
import {
    getGrammarPatternExamples,
    getGrammarPatterns,
    getGrammarReviewItems,
    recordGrammarReview,
    setGrammarPatternKept,
} from '../../services/Database';
import { fontFamilies, useTheme } from '../../theme';

const shuffle = (items) => {
    const copy = [...items];
    for (let index = copy.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(Math.random() * (index + 1));
        [copy[index], copy[swap]] = [copy[swap], copy[index]];
    }
    return copy;
};

// "B1" < "B2", "TOPIK 2" < "TOPIK 3", "HSK 1" < "HSK 3".
const levelOrder = (level) => {
    const value = String(level || '');
    const cefr = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].indexOf(value);
    if (cefr >= 0) return cefr;
    const number = Number(value.replace(/\D/g, ''));
    return Number.isFinite(number) && number > 0 ? number : 99;
};

/**
 * GrammarSection — Learn's Grammar tab: the patterns the reader has met in
 * the AI panel's Grammar tab, by level (new, practising, known), a pattern's
 * page with the sentences from their books, and a review where a sentence
 * they read has the pattern blanked out.
 */
const GrammarSection = ({ ownerId, language }) => {
    const { t } = useTranslation();
    const { colors } = useTheme();
    const styles = useMemo(() => createStyles(colors), [colors]);
    const [patterns, setPatterns] = useState(null);
    const [dueCount, setDueCount] = useState(0);
    const [openPattern, setOpenPattern] = useState(null);
    const [reviewItems, setReviewItems] = useState(null);

    const load = useCallback(async () => {
        try {
            const [rows, due] = await Promise.all([
                getGrammarPatterns({ ownerId, language }),
                getGrammarReviewItems({ ownerId, language, limit: 10 }),
            ]);
            setPatterns(rows);
            setDueCount(due.length);
        } catch {
            setPatterns([]);
        }
    }, [language, ownerId]);

    useEffect(() => {
        load();
    }, [load]);

    const startReview = async (patternId = null) => {
        const items = await getGrammarReviewItems({ ownerId, language, limit: 10 }).catch(() => []);
        const chosen = patternId ? items.filter((item) => item.patternId === patternId) : items;
        if (chosen.length > 0) setReviewItems(chosen);
    };

    if (openPattern) {
        return (
            <GrammarPatternPage
                pattern={openPattern}
                ownerId={ownerId}
                language={language}
                styles={styles}
                colors={colors}
                onBack={() => {
                    setOpenPattern(null);
                    load();
                }}
                onReview={() => startReview(openPattern.patternId)}
                reviewItems={reviewItems}
                onCloseReview={() => {
                    setReviewItems(null);
                    load();
                }}
            />
        );
    }

    if (patterns === null) {
        return <ActivityIndicator style={styles.loading} color={colors.textTertiary} />;
    }

    if (patterns.length === 0) {
        return (
            <View style={styles.empty}>
                <Text style={styles.emptyTitle}>{t('grammar.emptyTitle')}</Text>
                <Text style={styles.emptyBody}>{t('grammar.emptyBody')}</Text>
            </View>
        );
    }

    const byLevel = patterns.reduce((groups, pattern) => {
        const key = pattern.level || t('grammar.otherLevel');
        (groups[key] = groups[key] || []).push(pattern);
        return groups;
    }, {});
    const levels = Object.keys(byLevel).sort((a, b) => levelOrder(a) - levelOrder(b));

    return (
        <View style={styles.wrap}>
            {dueCount > 0 ? (
                <View style={styles.reviewCard}>
                    <View style={styles.reviewCopy}>
                        <Text style={styles.reviewTitle}>{t('grammar.reviewDue', { count: dueCount })}</Text>
                        <Text style={styles.reviewBody}>{t('grammar.reviewDueBody')}</Text>
                    </View>
                    <TouchableOpacity onPress={() => startReview()} style={styles.reviewButton} accessibilityRole="button">
                        <Text style={styles.reviewButtonText}>{t('grammar.review')}</Text>
                    </TouchableOpacity>
                </View>
            ) : null}
            {levels.map((level) => (
                <View key={level} style={styles.levelGroup}>
                    <Text style={styles.levelLabel}>{level}</Text>
                    {byLevel[level].map((pattern) => (
                        <TouchableOpacity
                            key={pattern.patternId}
                            onPress={() => setOpenPattern(pattern)}
                            style={styles.row}
                            accessibilityRole="button"
                            accessibilityLabel={`${pattern.title}, ${t(`grammar.state.${pattern.state}`)}`}
                        >
                            <View style={[styles.dot, styles[`dot_${pattern.state}`] || styles.dot_new]} />
                            <View style={styles.rowCopy}>
                                <Text style={styles.rowTitle}>{pattern.title || pattern.form}</Text>
                                <Text style={styles.rowMeta} numberOfLines={1}>
                                    {[
                                        t('grammar.metTimes', { count: pattern.encounters }),
                                        pattern.bookTitles.slice(0, 2).join(', '),
                                    ].filter(Boolean).join(' · ')}
                                </Text>
                            </View>
                            <Feather name="chevron-right" size={18} color={colors.textSubtle} />
                        </TouchableOpacity>
                    ))}
                </View>
            ))}
            <View style={styles.legend}>
                {['new', 'practising', 'known'].map((state) => (
                    <View key={state} style={styles.legendItem}>
                        <View style={[styles.legendDot, styles[`dot_${state}`]]} />
                        <Text style={styles.legendText}>{t(`grammar.state.${state}`)}</Text>
                    </View>
                ))}
            </View>
            <GrammarReview
                items={reviewItems}
                ownerId={ownerId}
                language={language}
                styles={styles}
                colors={colors}
                onClose={() => {
                    setReviewItems(null);
                    load();
                }}
            />
        </View>
    );
};

const GrammarPatternPage = ({ pattern, ownerId, language, styles, colors, onBack, onReview, reviewItems, onCloseReview }) => {
    const { t } = useTranslation();
    const [examples, setExamples] = useState(null);
    const [kept, setKept] = useState(pattern.kept);

    useEffect(() => {
        getGrammarPatternExamples({ ownerId, language, patternId: pattern.patternId })
            .then(setExamples)
            .catch(() => setExamples([]));
    }, [language, ownerId, pattern.patternId]);

    const canPractise = kept && (examples || []).some((example) => example.blank && example.options.length >= 3);

    return (
        <View style={styles.wrap}>
            <TouchableOpacity onPress={onBack} style={styles.back} accessibilityRole="button" accessibilityLabel={t('common.back')}>
                <Feather name="chevron-left" size={22} color={colors.text} />
            </TouchableOpacity>
            <View style={styles.pageHead}>
                {pattern.level ? <Text style={styles.levelChip}>{pattern.level}</Text> : null}
                <Text style={styles.rowMeta}>
                    {[t(`grammar.state.${pattern.state}`), t('grammar.metTimes', { count: pattern.encounters })].join(' · ')}
                </Text>
            </View>
            <Text style={styles.pageTitle}>{pattern.title || pattern.form}</Text>
            {pattern.form ? <Text style={styles.form}>{pattern.form}</Text> : null}
            {pattern.rule ? <Text style={styles.rule}>{pattern.rule}</Text> : null}
            <Text style={styles.levelLabel}>{t('grammar.fromYourBooks')}</Text>
            {examples === null ? <ActivityIndicator color={colors.textTertiary} /> : examples.map((example) => (
                <View key={example.id} style={styles.example}>
                    <Text style={styles.exampleText}>
                        {example.chunks.length > 0
                            ? example.chunks.map((chunk, index) => (
                                // eslint-disable-next-line react/no-array-index-key
                                <Text key={index} style={chunk.pattern ? styles.examplePattern : null}>
                                    {index > 0 ? ' ' : ''}{chunk.text}
                                </Text>
                            ))
                            : example.sentence}
                    </Text>
                    {example.bookTitle ? <Text style={styles.rowMeta}>{example.bookTitle}</Text> : null}
                </View>
            ))}
            <TouchableOpacity
                onPress={() => {
                    if (!kept) {
                        setKept(true);
                        setGrammarPatternKept({ ownerId, language, patternId: pattern.patternId, kept: true }).catch(() => setKept(false));
                        return;
                    }
                    if (canPractise) onReview();
                }}
                style={[styles.primary, kept && !canPractise && styles.primaryDisabled]}
                accessibilityRole="button"
            >
                <Text style={styles.primaryText}>{kept ? t('grammar.practise') : t('grammar.keep')}</Text>
            </TouchableOpacity>
            <GrammarReview
                items={reviewItems}
                ownerId={ownerId}
                language={language}
                styles={styles}
                colors={colors}
                onClose={onCloseReview}
            />
        </View>
    );
};

const GrammarReview = ({ items, ownerId, language, styles, colors, onClose }) => {
    const { t } = useTranslation();
    const [index, setIndex] = useState(0);
    const [picked, setPicked] = useState(null);
    const visible = Array.isArray(items) && items.length > 0;
    const item = visible ? items[Math.min(index, items.length - 1)] : null;
    const options = useMemo(
        () => (item ? shuffle([item.blank, ...item.options.slice(0, 3)]) : []),
        [item]
    );

    useEffect(() => {
        setIndex(0);
        setPicked(null);
    }, [items]);

    if (!visible) return null;

    const answered = picked !== null;
    const right = answered && picked === item.blank;
    const blankAt = item.sentence.indexOf(item.blank);
    const before = blankAt >= 0 ? item.sentence.slice(0, blankAt) : item.sentence;
    const after = blankAt >= 0 ? item.sentence.slice(blankAt + item.blank.length) : '';

    const pick = (option) => {
        if (answered) return;
        setPicked(option);
        recordGrammarReview({ ownerId, language, patternId: item.patternId, correct: option === item.blank }).catch(() => {});
    };
    const next = () => {
        if (index + 1 >= items.length) {
            onClose();
            return;
        }
        setIndex(index + 1);
        setPicked(null);
    };

    return (
        <Modal visible animationType="slide" onRequestClose={onClose}>
            <View style={styles.reviewScreen}>
                <View style={styles.reviewTop}>
                    <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel={t('common.close')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                        <Feather name="x" size={22} color={colors.text} />
                    </TouchableOpacity>
                    <View style={styles.progressTrack}>
                        <View style={[styles.progressFill, { width: `${((index + (answered ? 1 : 0)) / items.length) * 100}%` }]} />
                    </View>
                    <Text style={styles.rowMeta}>{`${index + 1} / ${items.length}`}</Text>
                </View>
                <Text style={styles.reviewPattern}>{item.title}</Text>
                <View style={styles.reviewSentenceCard}>
                    <Text style={styles.reviewSentence}>
                        {before}
                        <Text style={[styles.blank, answered && (right ? styles.blankRight : styles.blankWrong)]}>
                            {answered ? picked : '   '}
                        </Text>
                        {after}
                    </Text>
                    {item.bookTitle ? <Text style={styles.rowMeta}>{item.bookTitle}</Text> : null}
                </View>
                <View style={styles.options} accessibilityRole="radiogroup">
                    {options.map((option) => {
                        const isAnswer = answered && option === item.blank;
                        const isWrongPick = answered && option === picked && !right;
                        return (
                            <TouchableOpacity
                                key={option}
                                onPress={() => pick(option)}
                                style={[styles.option, isAnswer && styles.optionRight, isWrongPick && styles.optionWrong]}
                                accessibilityRole="radio"
                                accessibilityState={{ checked: option === picked }}
                            >
                                <Text style={styles.optionText}>{option}</Text>
                            </TouchableOpacity>
                        );
                    })}
                </View>
                {answered ? (
                    <Text style={styles.rule}>{right ? t('grammar.right') : t('grammar.wrong', { answer: item.blank })}</Text>
                ) : null}
                {answered && item.rule ? <Text style={styles.reviewBody}>{item.rule}</Text> : null}
                <TouchableOpacity onPress={next} style={[styles.primary, styles.reviewNext]} accessibilityRole="button">
                    <Text style={styles.primaryText}>{answered ? t('grammar.next') : t('grammar.skip')}</Text>
                </TouchableOpacity>
            </View>
        </Modal>
    );
};

const createStyles = (colors) => StyleSheet.create({
    wrap: { gap: 14, paddingTop: 6, paddingHorizontal: 18 },
    loading: { marginTop: 24 },
    empty: { paddingVertical: 32, paddingHorizontal: 26, gap: 6, alignItems: 'center' },
    emptyTitle: { fontFamily: fontFamilies.sansSemiBold, fontSize: 16, color: colors.text, textAlign: 'center' },
    emptyBody: { fontFamily: fontFamilies.sansRegular, fontSize: 14, lineHeight: 20, color: colors.textTertiary, textAlign: 'center' },
    reviewCard: {
        flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14,
        borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
    },
    reviewCopy: { flex: 1, gap: 2 },
    reviewTitle: { fontFamily: fontFamilies.sansSemiBold, fontSize: 15, color: colors.text },
    reviewBody: { fontFamily: fontFamilies.sansRegular, fontSize: 13, lineHeight: 19, color: colors.textTertiary },
    reviewButton: { height: 38, paddingHorizontal: 16, borderRadius: 19, backgroundColor: colors.text, justifyContent: 'center' },
    reviewButtonText: { fontFamily: fontFamilies.sansSemiBold, fontSize: 14, color: colors.surface },
    levelGroup: { gap: 2 },
    levelLabel: { fontFamily: fontFamilies.sansSemiBold, fontSize: 12, letterSpacing: 0.4, color: colors.textTertiary, marginTop: 4 },
    row: {
        flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12,
        borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
    },
    rowCopy: { flex: 1, gap: 2 },
    rowTitle: { fontFamily: fontFamilies.sansMedium, fontSize: 15, color: colors.text },
    rowMeta: { fontFamily: fontFamilies.sansRegular, fontSize: 12.5, color: colors.textTertiary },
    dot: { width: 10, height: 10, borderRadius: 5 },
    dot_new: { borderWidth: 1.5, borderColor: colors.textTertiary },
    dot_practising: { backgroundColor: colors.borderStrong },
    dot_known: { backgroundColor: colors.text },
    legend: { flexDirection: 'row', gap: 16, marginTop: 4 },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    legendDot: { width: 8, height: 8, borderRadius: 4 },
    legendText: { fontFamily: fontFamilies.sansRegular, fontSize: 12, color: colors.textTertiary },
    back: { width: 44, height: 44, justifyContent: 'center' },
    pageHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    levelChip: {
        fontFamily: fontFamilies.sansSemiBold, fontSize: 12, color: colors.textSecondary,
        backgroundColor: colors.surfaceMuted, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, overflow: 'hidden',
    },
    pageTitle: { fontFamily: fontFamilies.displaySemiBold, fontSize: 24, lineHeight: 30, color: colors.text },
    form: { fontFamily: fontFamilies.serifRegular, fontSize: 16, color: colors.textSecondary },
    rule: { fontFamily: fontFamilies.sansRegular, fontSize: 15, lineHeight: 22, color: colors.textSecondary },
    example: { padding: 14, gap: 6, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    exampleText: { fontFamily: fontFamilies.serifRegular, fontSize: 16, lineHeight: 24, color: colors.text },
    examplePattern: { fontFamily: fontFamilies.sansSemiBold, textDecorationLine: 'underline' },
    primary: { height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.text, marginTop: 6 },
    primaryDisabled: { opacity: 0.4 },
    primaryText: { fontFamily: fontFamilies.sansSemiBold, fontSize: 15, color: colors.surface },
    reviewScreen: { flex: 1, paddingTop: 52, paddingHorizontal: 20, paddingBottom: 28, gap: 20, backgroundColor: colors.bgPage },
    reviewTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    progressTrack: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden', backgroundColor: colors.border },
    progressFill: { height: 4, backgroundColor: colors.text },
    reviewPattern: { fontFamily: fontFamilies.sansSemiBold, fontSize: 13, color: colors.textTertiary },
    reviewSentenceCard: { padding: 18, gap: 10, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    reviewSentence: { fontFamily: fontFamilies.serifRegular, fontSize: 20, lineHeight: 32, color: colors.text },
    blank: { fontFamily: fontFamilies.sansSemiBold, textDecorationLine: 'underline', color: colors.text },
    blankRight: { color: colors.text },
    blankWrong: { color: colors.textTertiary, textDecorationStyle: 'dotted' },
    options: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    option: {
        flexGrow: 1, flexBasis: '45%', minHeight: 52, paddingHorizontal: 10, borderRadius: 12,
        borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface,
        alignItems: 'center', justifyContent: 'center',
    },
    optionRight: { borderColor: colors.text, backgroundColor: colors.surfaceMuted },
    optionWrong: { borderColor: colors.borderStrong, opacity: 0.6 },
    optionText: { fontFamily: fontFamilies.sansMedium, fontSize: 16, color: colors.text },
    reviewNext: { marginTop: 'auto' },
});

export default memo(GrammarSection);
