import React, { useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from '../../hooks/useTranslation';
import { localizeGeneratedSectionLabel } from '../../i18n/userFacing';
import { formatNumber } from '../../services/interfaceLanguage';
import { colors as defaultColors, elevation, fontFamilies, layout, useTheme } from '../../theme';

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

const fractionLabelForItem = (item = {}, totalSpineItems = 0, t) => {
    const explicitLabel = String(item?.positionLabel || '').trim();
    if (/^\d+\s*\/\s*\d+$/.test(explicitLabel)) {
        return explicitLabel.replace(/\s+/g, '');
    }

    if (Number.isInteger(item?.spineIndex) && totalSpineItems > 0) {
        return `${item.spineIndex + 1}/${totalSpineItems}`;
    }

    // PDF sections carry generated "Page 3" / "Pages 3-5" labels.
    return localizeGeneratedSectionLabel(explicitLabel, t);
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
                ? t('read.chapterOfTotal', { current: currentSpineIndex + 1, total: totalSpineItems })
                : t('read.chapterNumber', { number: formatNumber(currentSpineIndex + 1) })
        )
        : t('read.chapter');

    const palette = {
        sheet: colors.readerSurface,
        border: colors.readerBorder,
        headerText: colors.textTertiary,
        summaryText: colors.textSubtle,
        activeBg: colors.surfaceAssist,
        numberRead: colors.readerSubtleInk,
        numberCurrent: colors.readerBodyInk,
        numberUnread: colors.readerMutedInk,
        titleRead: colors.readerMutedInk,
        titleCurrent: colors.readerBodyInk,
        titleUnread: colors.readerBodyInk,
        pageRead: colors.textSubtle,
        pageCurrent: colors.textTertiary,
        pageUnread: colors.textSubtle,
        disabledText: colors.readerSubtleInk,
        pressedBg: colors.surfaceMuted,
        progressTrack: colors.readerProgressTrack,
        progressFill: colors.readerProgressFill,
        progressText: colors.readerBodyInk,
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
                            top: insets.top + layout.readerHeaderHeight + 2,
                            backgroundColor: palette.sheet,
                            borderColor: palette.border,
                        },
                    ]}
                >
                    <View style={styles.progressHeader}>
                        <View style={styles.metaRow}>
                            <Text style={[styles.headerTitle, { color: palette.headerText }]}>{t('read.contents')}</Text>
                            <Text style={[styles.chapterSummary, { color: palette.summaryText }]}>
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
                                {t('common.percent', { value: formatNumber(bookProgressPercent) })}
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
                            const title = localizeGeneratedSectionLabel(item?.title || item?.label, t) || t('read.untitledSection');
                            const positionLabel = isActive
                                ? t('read.youAreHere')
                                : fractionLabelForItem(item, totalSpineItems, t);
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
                                    accessibilityRole="button"
                                    accessibilityState={{ selected: isActive, disabled: isDisabled }}
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
        maxHeight: 520,
        borderRadius: 16,
        borderWidth: StyleSheet.hairlineWidth,
        overflow: 'hidden',
        paddingTop: 14,
        paddingBottom: 8,
        ...elevation.readerToc,
    },
    progressHeader: {
        flexShrink: 0,
        paddingHorizontal: 16,
        paddingBottom: 10,
    },
    metaRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 12,
        marginBottom: 10,
    },
    headerTitle: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 13,
        lineHeight: 17,
    },
    chapterSummary: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 12,
        lineHeight: 16,
        fontVariant: ['tabular-nums'],
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
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 13,
        lineHeight: 17,
        minWidth: 34,
        textAlign: 'right',
        fontVariant: ['tabular-nums'],
    },
    listContent: {
        paddingBottom: 0,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 11,
        minHeight: 44,
        paddingRight: 16,
        paddingVertical: 8,
    },
    chapterNumber: {
        width: 18,
        flexShrink: 0,
        textAlign: 'center',
        fontFamily: fontFamilies.sansMedium,
        fontSize: 13,
        lineHeight: 18,
        includeFontPadding: false,
        fontVariant: ['tabular-nums'],
    },
    chapterTitle: {
        flex: 1,
        minWidth: 0,
        fontFamily: fontFamilies.krSerifRegular,
        fontSize: 15,
        lineHeight: 21,
        includeFontPadding: false,
    },
    chapterTitleActive: {
        fontFamily: fontFamilies.krSerifMedium,
    },
    positionText: {
        flexShrink: 0,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 12,
        lineHeight: 16,
        textAlign: 'right',
        fontVariant: ['tabular-nums'],
    },
});

export default React.memo(TocDrawer);
