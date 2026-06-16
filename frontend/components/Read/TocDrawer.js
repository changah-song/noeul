import React, { useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from '../../hooks/useTranslation';
import { colors as defaultColors, elevation, fontFamilies, layout, radii, useTheme } from '../../theme';

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
    const bookProgressFillWidth = `${bookProgressPercent}%`;
    const chapterSummaryLabel = Number.isInteger(currentSpineIndex)
        ? (
            totalSpineItems > 0
                ? `Chapter ${currentSpineIndex + 1} of ${totalSpineItems}`
                : `Chapter ${currentSpineIndex + 1}`
        )
        : t('read.chapter');

    const palette = {
        sheet: colors.readerSurface,
        border: colors.readerBorder,
        headerText: colors.readerSubtleInk,
        activeBg: colors.readerSavedChipBg,
        numberRead: colors.readerSubtleInk,
        numberCurrent: colors.readerProgressFill,
        numberUnread: colors.readerMutedInk,
        titleRead: colors.readerSubtleInk,
        titleCurrent: colors.readerBodyInk,
        titleUnread: colors.readerBodyInk,
        pageRead: colors.readerSubtleInk,
        pageCurrent: colors.readerMutedInk,
        pageUnread: colors.readerSubtleInk,
        disabledText: colors.readerSubtleInk,
        pressedBg: colors.readerSavedChipBg,
        progressTrack: colors.readerProgressTrack,
        progressFill: colors.readerProgressFill,
        progressText: colors.readerProgressFill,
    };

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onClose}
        >
            <View style={styles.overlay}>
                <Pressable
                    style={[styles.backdrop, { backgroundColor: colors.readerTocScrim }]}
                    onPress={onClose}
                />
                <View
                    style={[
                        styles.dropdown,
                        {
                            top: insets.top + layout.readerHeaderHeight - 2,
                            backgroundColor: palette.sheet,
                            borderColor: palette.border,
                        },
                    ]}
                >
                    <View style={styles.progressHeader}>
                        <View style={styles.metaRow}>
                            <Text style={[styles.headerTitle, { color: palette.headerText }]}>CONTENTS</Text>
                            <Text style={[styles.chapterSummary, { color: palette.headerText }]}>
                                {chapterSummaryLabel}
                            </Text>
                        </View>
                        <View style={styles.bookProgressRow}>
                            <View style={[styles.bookProgressTrack, { backgroundColor: palette.progressTrack }]}>
                                <View
                                    style={[
                                        styles.bookProgressFill,
                                        {
                                            width: bookProgressFillWidth,
                                            backgroundColor: palette.progressFill,
                                        },
                                    ]}
                                />
                            </View>
                            <Text style={[styles.bookProgressText, { color: palette.progressText }]}>
                                {bookProgressPercent}%
                            </Text>
                        </View>
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
                            const numberColor = isDisabled
                                ? palette.disabledText
                                : (isActive ? palette.numberCurrent : (isRead ? palette.numberRead : palette.numberUnread));
                            const titleColor = isDisabled
                                ? palette.disabledText
                                : (isActive ? palette.titleCurrent : (isRead ? palette.titleRead : palette.titleUnread));
                            const pageColor = isDisabled
                                ? palette.disabledText
                                : (isActive ? palette.pageCurrent : (isRead ? palette.pageRead : palette.pageUnread));

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
                                            paddingLeft: 16 + (normalizedDepth * 12),
                                            backgroundColor: isActive
                                                ? palette.activeBg
                                                : (pressed && !isDisabled ? palette.pressedBg : colors.transparent),
                                        },
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
                                        <Text style={[styles.positionText, { color: pageColor }]}>
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
        justifyContent: 'flex-start',
    },
    backdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: defaultColors.readerTocScrim,
    },
    dropdown: {
        position: 'absolute',
        right: 12,
        width: 272,
        maxHeight: 600,
        borderRadius: radii.md,
        borderWidth: 1,
        overflow: 'hidden',
        ...elevation.readerToc,
    },
    progressHeader: {
        flexShrink: 0,
        paddingHorizontal: 16,
        paddingVertical: 13,
        borderBottomWidth: 1,
        borderBottomColor: defaultColors.divider,
    },
    metaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        marginBottom: 9,
    },
    headerTitle: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 9,
        lineHeight: 12,
        textTransform: 'uppercase',
        letterSpacing: 2.2,
    },
    chapterSummary: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 10,
        lineHeight: 14,
    },
    bookProgressRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    bookProgressTrack: {
        flex: 1,
        height: 4,
        borderRadius: 2,
        overflow: 'hidden',
    },
    bookProgressFill: {
        height: '100%',
        borderRadius: 2,
    },
    bookProgressText: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 12,
        lineHeight: 16,
        minWidth: 34,
        textAlign: 'right',
        fontVariant: ['tabular-nums'],
    },
    listContent: {
        paddingVertical: 4,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 11,
        minHeight: 34,
        paddingRight: 16,
        paddingVertical: 7,
    },
    chapterNumber: {
        width: 18,
        flexShrink: 0,
        textAlign: 'center',
        fontFamily: fontFamilies.displayMedium,
        fontSize: 13,
        lineHeight: 18,
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
        fontFamily: fontFamilies.krSerifMedium,
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
