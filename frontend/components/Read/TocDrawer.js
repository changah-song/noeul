import React, { useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from '../../hooks/useTranslation';
import { fontFamilies, useTheme } from '../../theme';
import { ProgressBar } from '../ui';

const stripHref = (href) => {
    if (!href) return '';
    return String(href).split('#')[0].split('/').pop() || '';
};

const flattenToc = (items, depth = 0) => {
    if (!Array.isArray(items)) {
        return [];
    }

    return items.flatMap((item) => {
        const itemDepth = Number.isFinite(Number(item?.depth))
            ? Math.max(0, Number(item.depth))
            : depth;

        return [
            { ...item, depth: itemDepth },
            ...flattenToc(item?.subitems, itemDepth + 1),
        ];
    });
};

const clampProgress = (value) => {
    const progress = Number(value);
    if (!Number.isFinite(progress)) {
        return 0;
    }

    return Math.min(Math.max(progress, 0), 1);
};

const chapterNumberForItem = (item = {}) => {
    const rawNumber = item?.chapterNumber
        ?? item?.chapter_number
        ?? item?.number
        ?? item?.n
        ?? null;
    const chapterNumber = rawNumber == null ? '' : String(rawNumber).trim();

    return chapterNumber;
};

const fractionLabelForItem = (item = {}, totalSpineItems = 0) => {
    const explicitLabel = String(item?.positionLabel || '').trim();
    if (/^\d+\s*\/\s*\d+$/.test(explicitLabel)) {
        return explicitLabel.replace(/\s+/g, '');
    }

    if (Number.isInteger(item?.spineIndex) && totalSpineItems > 0) {
        return `${item.spineIndex + 1}/${totalSpineItems}`;
    }

    return explicitLabel;
};

const TocDrawer = ({
    visible,
    toc,
    currentSectionHref,
    currentSpineIndex,
    totalSpineItems,
    bookProgress = 0,
    isDarkMode,
    onClose,
    onSelect,
}) => {
    const { t } = useTranslation();
    const { colors } = useTheme();
    const insets = useSafeAreaInsets();
    const flatItems = useMemo(() => flattenToc(toc), [toc]);
    const minDepth = useMemo(() => {
        if (!flatItems.length) {
            return 0;
        }
        return Math.min(...flatItems.map((item) => item?.depth ?? 0));
    }, [flatItems]);
    const activeIndex = useMemo(() => {
        if (!Number.isInteger(currentSpineIndex)) {
            return -1;
        }

        return flatItems.reduce((activeItemIndex, item, index) => {
            if (
                !item?.disabled
                && Number.isInteger(item?.spineIndex)
                && item.spineIndex <= currentSpineIndex
            ) {
                return index;
            }

            return activeItemIndex;
        }, -1);
    }, [currentSpineIndex, flatItems]);
    const activeHref = stripHref(currentSectionHref);
    const bookProgressPercent = Math.round(clampProgress(bookProgress) * 100);
    const chapterSummaryLabel = Number.isInteger(currentSpineIndex)
        ? (
            totalSpineItems > 0
                ? `Chapter ${currentSpineIndex + 1} of ${totalSpineItems}`
                : `Chapter ${currentSpineIndex + 1}`
        )
        : t('read.chapter');

    return (
        <Modal
            visible={visible}
            transparent
            animationType="slide"
            onRequestClose={onClose}
        >
            <View style={styles.overlay}>
                <Pressable
                    style={[styles.backdrop, { backgroundColor: colors.overlay }]}
                    onPress={onClose}
                />
                <View
                    style={[
                        styles.sheet,
                        {
                            backgroundColor: colors.popover,
                            borderColor: colors.popoverBorder,
                            paddingBottom: insets.bottom + 18,
                        },
                    ]}
                >
                    <View style={[styles.grabber, { backgroundColor: colors.textSubtle }]} />

                    <View style={styles.metaRow}>
                        <Text style={[styles.contentsLabel, { color: colors.textTertiary }]}>
                            {t('read.contents')}
                        </Text>
                        <Text style={[styles.chapterSummary, { color: colors.textTertiary }]}>
                            {chapterSummaryLabel}
                        </Text>
                    </View>

                    <View style={styles.progressRow}>
                        <ProgressBar
                            progress={clampProgress(bookProgress)}
                            height={4}
                            style={styles.progressTrack}
                        />
                        <Text style={[styles.progressPercent, { color: colors.text }]}>
                            {bookProgressPercent}%
                        </Text>
                    </View>

                    <ScrollView
                        contentContainerStyle={styles.listContent}
                        showsVerticalScrollIndicator={false}
                    >
                        {flatItems.map((item, index) => {
                            const isActive = activeIndex >= 0
                                ? activeIndex === index
                                : Boolean(activeHref && stripHref(item?.href) === activeHref);
                            const normalizedDepth = Math.min(1, Math.max(0, (item?.depth ?? 0) - minDepth));
                            const isDisabled = item?.disabled || !Number.isInteger(item?.spineIndex);
                            const title = String(item?.title || item?.label || t('read.untitledSection')).trim() || t('read.untitledSection');
                            const positionLabel = fractionLabelForItem(item, totalSpineItems);
                            const chapterNumber = chapterNumberForItem(item);
                            const isRead = (
                                !isActive
                                && !isDisabled
                                && Number.isInteger(currentSpineIndex)
                                && Number.isInteger(item?.spineIndex)
                                && item.spineIndex < currentSpineIndex
                            );
                            const numberColor = isActive ? colors.accent : colors.textTertiary;
                            const titleColor = isActive ? colors.accent : colors.text;

                            return (
                                <Pressable
                                    key={`${item?.id || item?.href || item?.label || 'toc'}-${index}`}
                                    disabled={isDisabled}
                                    onPress={() => {
                                        if (isDisabled) return;
                                        onSelect?.(item);
                                    }}
                                    style={({ pressed }) => ([
                                        styles.row,
                                        {
                                            paddingLeft: 10 + (normalizedDepth * 12),
                                            backgroundColor: isActive
                                                ? colors.accentSoft
                                                : (pressed && !isDisabled ? colors.surfaceMuted : colors.transparent),
                                        },
                                        (isRead || isDisabled) && styles.rowRead,
                                    ])}
                                >
                                    {chapterNumber ? (
                                        <Text style={[styles.chapterNumber, { color: numberColor }]}>
                                            {chapterNumber}
                                        </Text>
                                    ) : null}
                                    <Text
                                        style={[
                                            styles.chapterTitle,
                                            isActive && styles.chapterTitleActive,
                                            { color: titleColor },
                                        ]}
                                        numberOfLines={1}
                                    >
                                        {title}
                                    </Text>
                                    {positionLabel ? (
                                        <Text style={[styles.positionText, { color: colors.textTertiary }]}>
                                            {positionLabel}
                                        </Text>
                                    ) : null}
                                </Pressable>
                            );
                        })}
                    </ScrollView>
                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    backdrop: {
        ...StyleSheet.absoluteFillObject,
    },
    sheet: {
        maxHeight: '78%',
        borderTopWidth: 1,
        borderTopLeftRadius: 26,
        borderTopRightRadius: 26,
        paddingTop: 10,
        paddingHorizontal: 20,
        shadowColor: 'rgba(43,20,26,0.16)',
        shadowOffset: { width: 0, height: -10 },
        shadowOpacity: 1,
        shadowRadius: 30,
        elevation: 12,
    },
    grabber: {
        width: 38,
        height: 5,
        borderRadius: 3,
        opacity: 0.4,
        alignSelf: 'center',
        marginTop: 6,
        marginBottom: 12,
    },
    metaRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 12,
    },
    contentsLabel: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 9,
        lineHeight: 12,
        textTransform: 'uppercase',
        letterSpacing: 2,
    },
    chapterSummary: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 10,
        lineHeight: 13,
        textTransform: 'uppercase',
        letterSpacing: 1.2,
    },
    progressRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginTop: 10,
        marginBottom: 6,
    },
    progressTrack: {
        flex: 1,
    },
    progressPercent: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 14,
        lineHeight: 18,
        minWidth: 38,
        textAlign: 'right',
        fontVariant: ['tabular-nums'],
    },
    listContent: {
        paddingTop: 6,
        paddingBottom: 4,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 13,
        borderRadius: 13,
        paddingRight: 10,
        paddingVertical: 12,
    },
    rowRead: {
        opacity: 0.4,
    },
    chapterNumber: {
        width: 20,
        flexShrink: 0,
        fontFamily: fontFamilies.sansBold,
        fontSize: 12,
        lineHeight: 16,
        letterSpacing: 1,
        includeFontPadding: false,
    },
    chapterTitle: {
        flex: 1,
        minWidth: 0,
        fontFamily: fontFamilies.krSerifRegular,
        fontSize: 14,
        lineHeight: 20,
        includeFontPadding: false,
    },
    chapterTitleActive: {
        fontFamily: fontFamilies.krSerifSemiBold,
    },
    positionText: {
        flexShrink: 0,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 11,
        lineHeight: 15,
        minWidth: 44,
        textAlign: 'right',
        fontVariant: ['tabular-nums'],
    },
});

export default TocDrawer;
