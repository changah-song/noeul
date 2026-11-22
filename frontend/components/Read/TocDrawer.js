import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import skipWhileHidden from './skipWhileHidden';
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from '../../hooks/useTranslation';
import { localizeGeneratedSectionLabel } from '../../i18n/userFacing';
import { formatNumber } from '../../services/interfaceLanguage';
import { activeTocIndex } from '../../services/tocAnchors';
import { tocAncestors, tocGroups } from '../../services/tocLinkedSections';
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

const MAX_DEPTH = 2;
const DROPDOWN_WIDTH = 300;
// A list longer than this folds: an entry's sections stay shut until it is
// opened (a Bible: 66 books, then the chapters of the one being read).
const FOLD_AT = 40;

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
    currentBlockId = null,
    chapterBlocks = null,
    totalSpineItems,
    bookProgress = 0,
    isDarkMode,
    onClose,
    onSelect,
}) => {
    const { t } = useTranslation();
    const { colors } = useTheme();
    const insets = useSafeAreaInsets();
    const { width: windowWidth } = useWindowDimensions();
    const flatItems = useMemo(() => flattenToc(toc), [toc]);
    const minDepth = useMemo(() => {
        if (!flatItems.length) {
            return 0;
        }
        return Math.min(...flatItems.map((item) => item?.depth ?? 0));
    }, [flatItems]);
    const activeIndex = useMemo(() => activeTocIndex(flatItems, {
        spineIndex: currentSpineIndex,
        blocks: chapterBlocks,
        firstBlockId: currentBlockId,
    }), [currentSpineIndex, currentBlockId, chapterBlocks, flatItems]);
    const { parentOf, hasChildren } = useMemo(() => tocGroups(flatItems), [flatItems]);
    const folds = flatItems.length > FOLD_AT && hasChildren.some(Boolean);
    const [openGroups, setOpenGroups] = useState(() => new Set());
    const listRef = useRef(null);
    const scrolledToActiveRef = useRef(false);
    const activeIndexRef = useRef(activeIndex);
    activeIndexRef.current = activeIndex;
    // Each time the list opens: the branch being read is open, the rest shut.
    useEffect(() => {
        if (!visible) return;
        scrolledToActiveRef.current = false;
        const active = activeIndexRef.current;
        const next = new Set(tocAncestors(parentOf, active));
        if (active >= 0 && hasChildren[active]) next.add(active);
        setOpenGroups(next);
    }, [visible, parentOf, hasChildren]);
    const toggleGroup = useCallback((index) => {
        setOpenGroups((current) => {
            const next = new Set(current);
            if (next.has(index)) next.delete(index);
            else next.add(index);
            return next;
        });
    }, []);
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
        summaryText: colors.textTertiary,
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
                            // In points, from the window: a percentage of the
                            // modal's own width came out as zero on a second
                            // opening, leaving the list invisible.
                            width: Math.min(DROPDOWN_WIDTH, Math.max(0, windowWidth - 24)),
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
                        ref={listRef}
                        contentContainerStyle={styles.listContent}
                        showsVerticalScrollIndicator={false}
                    >
                        {flatItems.map((item, index) => {
                            if (folds && tocAncestors(parentOf, index).some((parent) => !openGroups.has(parent))) {
                                return null;
                            }
                            const isGroup = folds && hasChildren[index];
                            const isOpen = isGroup && openGroups.has(index);
                            const isActive = activeIndex >= 0
                                ? activeIndex === index
                                : Boolean(activeHref && stripHref(item?.href) === activeHref);
                            // Sections inside a chapter step in under it (three
                            // levels at most, so deep books still fit the list).
                            const normalizedDepth = Math.min(MAX_DEPTH, Math.max(0, (item?.depth ?? 0) - minDepth));
                            const isSubsection = normalizedDepth > 0;
                            const isDisabled = item?.disabled || !Number.isInteger(item?.spineIndex);
                            const title = localizeGeneratedSectionLabel(item?.title || item?.label, t) || t('read.untitledSection');
                            // An entry that folds shows its arrow where the count would be.
                            const positionLabel = isActive
                                ? t('read.youAreHere')
                                : (isGroup ? '' : fractionLabelForItem(item, totalSpineItems, t));
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
                                    disabled={isDisabled && !isGroup}
                                    accessibilityRole="button"
                                    accessibilityState={{
                                        selected: isActive,
                                        disabled: isDisabled && !isGroup,
                                        ...(isGroup ? { expanded: isOpen } : null),
                                    }}
                                    // The row being read: the list opens scrolled to it.
                                    onLayout={isActive ? (event) => {
                                        if (scrolledToActiveRef.current) return;
                                        scrolledToActiveRef.current = true;
                                        listRef.current?.scrollTo({
                                            y: Math.max(0, event.nativeEvent.layout.y - 88),
                                            animated: false,
                                        });
                                    } : undefined}
                                    onPress={() => {
                                        // A shut entry opens to show what is in
                                        // it; once open, a tap goes to it.
                                        if (isGroup && (!isOpen || isDisabled)) {
                                            toggleGroup(index);
                                            return;
                                        }
                                        if (isDisabled) return;
                                        onSelect?.(item);
                                    }}
                                    style={({ pressed }) => ([
                                        styles.row,
                                        isSubsection && styles.sectionRow,
                                        {
                                            paddingLeft: 16 + (normalizedDepth * 18),
                                            backgroundColor: isActive
                                                ? palette.activeBg
                                                : (pressed && !isDisabled ? palette.pressedBg : colors.transparent),
                                        },
                                    ])}
                                >
                                    {chapterNumber && !isSubsection ? (
                                        <Text style={[styles.chapterNumber, { color: numberColor }]}>
                                            {chapterNumber}
                                        </Text>
                                    ) : null}
                                    <Text
                                        style={[
                                            styles.chapterTitle,
                                            isSubsection && styles.sectionTitle,
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
                                    {isGroup ? (
                                        <Pressable
                                            onPress={() => toggleGroup(index)}
                                            hitSlop={12}
                                            accessibilityRole="button"
                                            accessibilityLabel={title}
                                            accessibilityState={{ expanded: isOpen }}
                                            style={styles.groupArrow}
                                        >
                                            <Feather
                                                name={isOpen ? 'chevron-down' : 'chevron-right'}
                                                size={16}
                                                color={pageColor}
                                            />
                                        </Pressable>
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
        left: 12,
        maxHeight: 520,
        borderRadius: radii.sheet,
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
    // Section-label style, with its count beside it.
    headerTitle: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 13,
        lineHeight: 18,
    },
    chapterSummary: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        lineHeight: 18,
        fontVariant: ['tabular-nums'],
    },
    bookProgressRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    bookProgressTrack: {
        flex: 1,
        height: 3,
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
    // A section inside a chapter: a shorter row in smaller type.
    sectionRow: {
        minHeight: 36,
        paddingVertical: 5,
    },
    sectionTitle: {
        fontSize: 14,
        lineHeight: 19,
    },
    groupArrow: {
        flexShrink: 0,
        width: 20,
        height: 28,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: -4,
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

export default React.memo(TocDrawer, skipWhileHidden);
