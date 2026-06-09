import React, { useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from '../../hooks/useTranslation';
import { colors, radii, spacing, textStyles } from '../../theme';

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

const TocDrawer = ({
    visible,
    toc,
    currentSectionHref,
    currentSpineIndex,
    totalSpineItems,
    isDarkMode,
    onClose,
    onSelect,
}) => {
    const { t } = useTranslation();
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

    const palette = isDarkMode
        ? {
            sheet: 'rgba(23, 21, 19, 0.98)',
            border: 'rgba(239, 230, 214, 0.18)',
            text: '#f3ede3',
            mutedText: '#b6aa99',
            subText: '#a09382',
            activeBg: 'rgba(200, 125, 0, 0.16)',
            activeText: '#f0c98d',
            disabledText: 'rgba(182, 170, 153, 0.48)',
            pressedBg: 'rgba(239, 230, 214, 0.08)',
            divider: 'rgba(239, 230, 214, 0.12)',
        }
        : {
            sheet: 'rgba(255, 252, 246, 0.98)',
            border: colors.border,
            text: colors.text,
            mutedText: colors.textMuted,
            subText: colors.textMuted,
            activeBg: colors.accentSoft,
            activeText: colors.accentStrong,
            disabledText: 'rgba(111, 98, 82, 0.45)',
            pressedBg: 'rgba(33, 28, 23, 0.05)',
            divider: 'rgba(221, 213, 200, 0.7)',
        };

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onClose}
        >
            <View style={styles.overlay}>
                <Pressable style={styles.backdrop} onPress={onClose} />
                <View style={[styles.dropdown, { backgroundColor: palette.sheet, borderColor: palette.border }]}>
                    <View style={styles.header}>
                        <Text style={[styles.headerTitle, { color: palette.text }]}>{t('read.contents')}</Text>
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
                            const isSubchapter = normalizedDepth > 0;
                            const isDisabled = item?.disabled || !Number.isInteger(item?.spineIndex);
                            const title = String(item?.title || item?.label || t('read.untitledSection')).trim() || t('read.untitledSection');
                            const positionLabel = item?.positionLabel || (
                                Number.isInteger(item?.spineIndex) && totalSpineItems
                                    ? `${item.spineIndex + 1}/${totalSpineItems}`
                                    : ''
                            );
                            const isLast = index === flatItems.length - 1;

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
                                            paddingLeft: normalizedDepth * 12,
                                            backgroundColor: isActive
                                                ? palette.activeBg
                                                : (pressed && !isDisabled ? palette.pressedBg : 'transparent'),
                                            borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth,
                                            borderBottomColor: palette.divider,
                                        },
                                    ])}
                                >
                                    <View style={styles.rowContent}>
                                        <Text
                                            style={[
                                                styles.chapterText,
                                                isSubchapter ? styles.subchapterLabel : styles.chapterLabel,
                                                {
                                                    color: isActive
                                                        ? palette.activeText
                                                        : (isDisabled
                                                            ? palette.disabledText
                                                            : (isSubchapter ? palette.subText : palette.text)),
                                                },
                                            ]}
                                            numberOfLines={2}
                                        >
                                            {title}
                                        </Text>
                                        {positionLabel ? (
                                            <Text
                                                style={[
                                                    styles.positionText,
                                                    {
                                                        color: isActive
                                                            ? palette.activeText
                                                            : (isDisabled ? palette.disabledText : palette.mutedText),
                                                    },
                                                ]}
                                            >
                                                {positionLabel}
                                            </Text>
                                        ) : null}
                                    </View>
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
    },
    dropdown: {
        position: 'absolute',
        top: 56,
        right: spacing.lg,
        width: 252,
        maxHeight: 360,
        borderRadius: radii.lg,
        borderWidth: 1,
        padding: spacing.sm,
        gap: 4,
        shadowColor: '#000',
        shadowOpacity: 0.08,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
        elevation: 8,
    },
    header: {
        marginBottom: 0,
    },
    headerTitle: {
        ...textStyles.label,
        color: colors.textSubtle,
        fontSize: 11,
        textTransform: 'uppercase',
        letterSpacing: 1.2,
    },
    listContent: {
        paddingBottom: 2,
    },
    row: {
        minHeight: 28,
        justifyContent: 'center',
        paddingRight: 2,
        paddingVertical: 2,
        position: 'relative',
        overflow: 'hidden',
    },
    rowContent: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.xs,
    },
    chapterText: {
        flex: 1,
        minWidth: 0,
        textAlign: 'left',
        alignSelf: 'stretch',
    },
    chapterLabel: {
        ...textStyles.body,
        fontSize: 14,
        lineHeight: 18,
        includeFontPadding: false,
    },
    subchapterLabel: {
        ...textStyles.caption,
        fontSize: 12,
        lineHeight: 16,
        includeFontPadding: false,
    },
    positionText: {
        ...textStyles.caption,
        fontSize: 11,
        minWidth: 48,
        textAlign: 'right',
    },
});

export default TocDrawer;
