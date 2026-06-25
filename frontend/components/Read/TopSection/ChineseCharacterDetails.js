import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import {
    fetchChineseWordBreakdown,
    fetchRelatedPhoneticChinese,
} from '../../../services/chineseCharacterDatabase';
import { useTranslation } from '../../../hooks/useTranslation';
import { fontFamilies, spacing, textStyles, useTheme } from '../../../theme';

const parseJsonArray = (value) => {
    if (Array.isArray(value)) {
        return value;
    }

    if (typeof value !== 'string' || !value.trim()) {
        return [];
    }

    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

const cleanValue = (value) => (typeof value === 'string' ? value.trim() : '');

const hasUnknownDecompositionPart = (value) => /[?？]/.test(cleanValue(value));

const formatComponentRadicalLabel = (form, radical, name, number) => {
    const componentForm = cleanValue(form);
    const glyph = cleanValue(radical);
    const englishName = cleanValue(name);
    const radicalNumber = number == null ? '' : String(number).trim();
    const displayGlyph = componentForm && glyph && componentForm !== glyph
        ? `${componentForm} -> ${glyph}`
        : (componentForm || glyph);

    return [
        displayGlyph,
        englishName,
        radicalNumber ? `#${radicalNumber}` : '',
    ].filter(Boolean).join(' · ');
};

const uniquePinyinValues = (rows = []) => {
    const seen = new Set();
    const values = [];

    rows.forEach((row) => {
        parseJsonArray(row?.pinyin_json).map(cleanValue).filter(Boolean).forEach((pinyin) => {
            if (!seen.has(pinyin)) {
                seen.add(pinyin);
                values.push(pinyin);
            }
        });
    });

    return values;
};

const ChineseCharacterDetails = ({ word }) => {
    const { t } = useTranslation();
    const { colors } = useTheme();
    const styles = useMemo(() => createStyles(colors), [colors]);
    const [breakdown, setBreakdown] = useState([]);
    const [activeIndex, setActiveIndex] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [relatedPhonetic, setRelatedPhonetic] = useState([]);
    const [isRelatedLoading, setIsRelatedLoading] = useState(false);

    const palette = useMemo(() => ({
        text: colors.readerBodyInk,
        secondaryText: colors.textSecondary,
        mutedText: colors.readerMutedInk,
        emptyText: colors.readerSubtleInk,
        border: colors.readerBorder,
        sectionBg: colors.readerSurface,
        activeBg: colors.surfaceMuted,
        accent: colors.readerProgressFill,
    }), [colors]);

    useEffect(() => {
        let isCancelled = false;
        const normalizedWord = cleanValue(word);

        setBreakdown([]);
        setActiveIndex(0);
        setRelatedPhonetic([]);
        setErrorMessage('');

        if (!normalizedWord) {
            return () => {
                isCancelled = true;
            };
        }

        setIsLoading(true);
        fetchChineseWordBreakdown(normalizedWord)
            .then((rows) => {
                if (!isCancelled) {
                    setBreakdown(rows);
                    setActiveIndex(0);
                }
            })
            .catch((error) => {
                if (!isCancelled) {
                    console.warn(`[ChineseCharacterDetails] lookup failed for "${normalizedWord}":`, error.message);
                    setErrorMessage(t('chinese.breakdownUnavailable'));
                }
            })
            .finally(() => {
                if (!isCancelled) {
                    setIsLoading(false);
                }
            });

        return () => {
            isCancelled = true;
        };
    }, [t, word]);

    const activeCharacter = breakdown[activeIndex] ?? null;
    const pinyin = useMemo(
        () => parseJsonArray(activeCharacter?.pinyin_json).map(cleanValue).filter(Boolean),
        [activeCharacter?.pinyin_json]
    );

    useEffect(() => {
        let isCancelled = false;
        const phonetic = cleanValue(activeCharacter?.phonetic);

        setRelatedPhonetic([]);
        if (!phonetic || activeCharacter?.missingEtymology) {
            setIsRelatedLoading(false);
            return () => {
                isCancelled = true;
            };
        }

        setIsRelatedLoading(true);
        fetchRelatedPhoneticChinese(phonetic)
            .then((rows) => {
                if (!isCancelled) {
                    setRelatedPhonetic(rows.filter((row) => row.character !== activeCharacter?.character));
                }
            })
            .catch((error) => {
                if (!isCancelled) {
                    console.warn(`[ChineseCharacterDetails] phonetic lookup failed for "${phonetic}":`, error.message);
                    setRelatedPhonetic([]);
                }
            })
            .finally(() => {
                if (!isCancelled) {
                    setIsRelatedLoading(false);
                }
            });

        return () => {
            isCancelled = true;
        };
    }, [activeCharacter?.character, activeCharacter?.missingEtymology, activeCharacter?.phonetic]);

    if (isLoading) {
        return (
            <View style={[styles.section, { borderTopColor: palette.border }]}>
                <ActivityIndicator size="small" color={palette.mutedText} />
                <Text style={[styles.loadingText, { color: palette.mutedText }]}>{t('chinese.loadingBreakdown')}</Text>
            </View>
        );
    }

    if (errorMessage || breakdown.length === 0) {
        return (
            <View style={[styles.section, { borderTopColor: palette.border }]}>
                <Text style={[styles.emptyText, { color: palette.emptyText }]}>
                    {errorMessage || t('chinese.noBreakdown')}
                </Text>
            </View>
        );
    }

    const semanticRadicalLabel = formatComponentRadicalLabel(
        activeCharacter?.semantic,
        activeCharacter?.semantic_radical,
        activeCharacter?.semantic_radical_english_name,
        activeCharacter?.semantic_radical_number
    );
    const primaryRadicalLabel = formatComponentRadicalLabel(
        activeCharacter?.radical,
        activeCharacter?.primary_radical || activeCharacter?.radical,
        activeCharacter?.primary_radical_english_name,
        activeCharacter?.primary_radical_number
    );
    const safeDecomposition = hasUnknownDecompositionPart(activeCharacter?.decomposition)
        ? ''
        : activeCharacter?.decomposition;
    const phoneticPinyin = parseJsonArray(activeCharacter?.phonetic_pinyin_json)
        .map(cleanValue)
        .filter(Boolean);
    const phoneticLabel = [
        cleanValue(activeCharacter?.phonetic),
        phoneticPinyin.length > 0 ? phoneticPinyin.join(', ') : '',
    ].filter(Boolean).join(' · ');
    const relatedReadings = uniquePinyinValues([
        activeCharacter,
        ...relatedPhonetic,
    ]).slice(0, 8);

    return (
        <View style={[styles.section, { borderTopColor: palette.border }]}>
            <View style={styles.headerRow}>
                <Text style={[styles.sectionTitle, { color: palette.mutedText }]}>{t('chinese.characterBreakdown')}</Text>
                <View style={styles.characterDots}>
                    {breakdown.map((item, index) => (
                        <View
                            key={`${item.character}-${index}-dot`}
                            style={[
                                styles.characterDot,
                                {
                                    backgroundColor: index === activeIndex
                                        ? palette.accent
                                        : palette.border,
                                },
                            ]}
                        />
                    ))}
                </View>
            </View>

            {breakdown.length > 1 ? (
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.tabRow}
                >
                    {breakdown.map((item, index) => (
                        <TouchableOpacity
                            key={`${item.character}-${index}`}
                            accessibilityRole="button"
                            accessibilityLabel={t('chinese.showBreakdown', { character: item.character })}
                            activeOpacity={0.82}
                            onPress={() => setActiveIndex(index)}
                            style={[
                                styles.tabButton,
                                {
                                    borderColor: index === activeIndex ? palette.accent : palette.border,
                                    backgroundColor: index === activeIndex ? palette.activeBg : colors.transparent,
                                },
                            ]}
                        >
                            <Text style={[styles.tabText, { color: palette.text }]}>{item.character}</Text>
                        </TouchableOpacity>
                    ))}
                </ScrollView>
            ) : null}

            {activeCharacter?.missingEtymology ? (
                <Text style={[styles.emptyText, { color: palette.emptyText }]}>
                    {t('chinese.noDecomposition')}
                </Text>
            ) : (
                <View style={styles.content}>
                    <View style={styles.glyphRow}>
                        <Text selectable style={[styles.largeGlyph, { color: palette.text }]}>
                            {activeCharacter.character}
                        </Text>
                        <View style={styles.glyphMeta}>
                            {pinyin.length > 0 ? (
                                <Text selectable style={[styles.pinyinText, { color: palette.mutedText }]}>
                                    {pinyin.join(', ')}
                                </Text>
                            ) : null}
                            {activeCharacter.definition ? (
                                <Text selectable numberOfLines={3} style={[styles.definitionText, { color: palette.secondaryText }]}>
                                    {activeCharacter.definition}
                                </Text>
                            ) : null}
                        </View>
                    </View>

                    <View style={[styles.detailBlock, { backgroundColor: palette.sectionBg, borderColor: palette.border }]}>
                        <DetailRow
                            label={t('chinese.decomposition')}
                            value={safeDecomposition}
                            palette={palette}
                        />
                        <DetailRow
                            label={t('chinese.formation')}
                            value={activeCharacter.etymology_type}
                            palette={palette}
                        />
                        <DetailRow
                            label={t('chinese.primaryRadical')}
                            value={primaryRadicalLabel}
                            palette={palette}
                        />
                        <DetailRow
                            label={t('chinese.semanticComponent')}
                            value={semanticRadicalLabel || activeCharacter.semantic}
                            palette={palette}
                            showComponentIcon
                        />
                        <DetailRow
                            label={t('chinese.phoneticComponent')}
                            value={phoneticLabel}
                            palette={palette}
                            showComponentIcon
                        />
                        <DetailRow
                            label={t('chinese.exampleReadings')}
                            value={relatedReadings.join(', ')}
                            palette={palette}
                        />
                        <DetailRow
                            label={t('chinese.hint')}
                            value={activeCharacter.hint}
                            palette={palette}
                        />
                    </View>

                    {activeCharacter.phonetic ? (
                        <View style={styles.relatedSection}>
                            <View style={styles.relatedHeader}>
                                <Text style={[styles.relatedTitle, { color: palette.mutedText }]}>
                                    {t('chinese.samePhoneticComponent')}
                                </Text>
                                {isRelatedLoading ? (
                                    <ActivityIndicator size="small" color={palette.mutedText} />
                                ) : null}
                            </View>
                            {relatedPhonetic.length > 0 ? (
                                <ScrollView
                                    horizontal
                                    showsHorizontalScrollIndicator={false}
                                    contentContainerStyle={styles.relatedRow}
                                >
                                    {relatedPhonetic.map((item) => {
                                        const itemPinyin = parseJsonArray(item.pinyin_json).map(cleanValue).filter(Boolean);
                                        return (
                                            <View
                                                key={item.character}
                                                style={[styles.relatedItem, { borderColor: palette.border }]}
                                            >
                                                <Text selectable style={[styles.relatedGlyph, { color: palette.text }]}>
                                                    {item.character}
                                                </Text>
                                                {itemPinyin.length > 0 ? (
                                                    <Text numberOfLines={1} style={[styles.relatedPinyin, { color: palette.mutedText }]}>
                                                        {itemPinyin[0]}
                                                    </Text>
                                                ) : null}
                                            </View>
                                        );
                                    })}
                                </ScrollView>
                            ) : !isRelatedLoading ? (
                                <Text style={[styles.emptyText, { color: palette.emptyText }]}>
                                    {t('chinese.noRelatedPhonetic')}
                                </Text>
                            ) : null}
                        </View>
                    ) : null}
                </View>
            )}
        </View>
    );
};

const DetailRow = ({ label, value, palette, showComponentIcon = false }) => {
    const cleaned = cleanValue(value);
    if (!cleaned) {
        return null;
    }

    return (
        <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: palette.mutedText }]}>{label}</Text>
            <View style={styles.detailValueRow}>
                <Text selectable style={[styles.detailValue, { color: palette.text }]}>{cleaned}</Text>
                {showComponentIcon ? (
                    <MaterialIcons name="account-tree" size={14} color={palette.mutedText} />
                ) : null}
            </View>
        </View>
    );
};

const createStyles = (colors) => StyleSheet.create({
    section: {
        borderTopWidth: StyleSheet.hairlineWidth,
        gap: 10,
        paddingTop: spacing.sm,
    },
    headerRow: {
        alignItems: 'center',
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: spacing.sm,
    },
    sectionTitle: {
        ...textStyles.caption,
        fontFamily: fontFamilies.sansBold,
        fontSize: 11,
        letterSpacing: 0,
        textTransform: 'uppercase',
    },
    characterDots: {
        alignItems: 'center',
        flexDirection: 'row',
        gap: 4,
    },
    characterDot: {
        width: 5,
        height: 5,
        borderRadius: 2.5,
    },
    tabRow: {
        gap: 8,
        paddingVertical: 2,
    },
    tabButton: {
        minWidth: 42,
        height: 38,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 7,
        borderWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 10,
    },
    tabText: {
        fontFamily: fontFamilies.krSerifSemiBold,
        fontSize: 21,
        lineHeight: 26,
        letterSpacing: 0,
    },
    content: {
        gap: 10,
    },
    glyphRow: {
        alignItems: 'center',
        flexDirection: 'row',
        gap: spacing.md,
    },
    largeGlyph: {
        fontFamily: fontFamilies.krSerifSemiBold,
        fontSize: 54,
        lineHeight: 62,
        letterSpacing: 0,
    },
    glyphMeta: {
        flex: 1,
        minWidth: 0,
        gap: 4,
    },
    pinyinText: {
        fontFamily: fontFamilies.displayItalic,
        fontSize: 15,
        lineHeight: 19,
        letterSpacing: 0,
    },
    definitionText: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        lineHeight: 18,
        letterSpacing: 0,
    },
    detailBlock: {
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth,
        gap: 8,
        padding: spacing.sm,
    },
    detailRow: {
        gap: 2,
    },
    detailLabel: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 10,
        lineHeight: 12,
        letterSpacing: 0,
        textTransform: 'uppercase',
    },
    detailValueRow: {
        alignItems: 'center',
        flexDirection: 'row',
        gap: 5,
    },
    detailValue: {
        flexShrink: 1,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 14,
        lineHeight: 19,
        letterSpacing: 0,
    },
    relatedSection: {
        gap: 7,
    },
    relatedHeader: {
        alignItems: 'center',
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: spacing.sm,
    },
    relatedTitle: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 11,
        lineHeight: 14,
        letterSpacing: 0,
        textTransform: 'uppercase',
    },
    relatedRow: {
        gap: 8,
        paddingVertical: 2,
    },
    relatedItem: {
        minWidth: 48,
        borderRadius: 7,
        borderWidth: StyleSheet.hairlineWidth,
        alignItems: 'center',
        gap: 2,
        paddingHorizontal: 8,
        paddingVertical: 7,
    },
    relatedGlyph: {
        fontFamily: fontFamilies.krSerifSemiBold,
        fontSize: 22,
        lineHeight: 26,
        letterSpacing: 0,
    },
    relatedPinyin: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 10,
        lineHeight: 12,
        letterSpacing: 0,
    },
    loadingText: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        lineHeight: 17,
        textAlign: 'center',
    },
    emptyText: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        lineHeight: 18,
        textAlign: 'center',
    },
});

export default ChineseCharacterDetails;
