import { memo, useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather, MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from '../../hooks/useTranslation';
import { fontFamilies, useTheme } from '../../theme';
import { HIGHLIGHT_COLORS } from './highlightColors';

/**
 * SelectionToolbar — what a long press offers once text is selected: the AI
 * explanation first, then copy, highlight and note as icons. It stays up after
 * each action, so a passage can be highlighted, annotated and explained in
 * one go. The highlight button opens a row of colors (and, on a highlighted
 * passage, a way to remove it). Floats where the lookup panel would.
 */
const SelectionToolbar = ({
    placement = 'bottom',
    highlightColor = null,
    hasNote = false,
    copied = false,
    explaining = false,
    colorsOpen = false,
    onCopy,
    onHighlight,
    onPickColor,
    onRemoveHighlight,
    onNote,
    onExplain,
}) => {
    const { t } = useTranslation();
    const { colors, isDarkMode } = useTheme();
    const styles = useMemo(() => createStyles(colors, isDarkMode), [colors, isDarkMode]);
    const mode = isDarkMode ? 'dark' : 'light';
    const highlighted = Boolean(highlightColor);
    const activeSwatch = HIGHLIGHT_COLORS.find((color) => color.key === highlightColor)?.swatch[mode];

    const iconButton = ({ key, label, icon, onPress, active = false, disabled = false }) => (
        <TouchableOpacity
            key={key}
            style={[styles.iconButton, active && styles.iconButtonActive, disabled && styles.disabled]}
            onPress={disabled ? undefined : onPress}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ disabled, selected: active }}
            activeOpacity={0.7}
        >
            {icon}
        </TouchableOpacity>
    );

    const mainRow = (
        <View style={styles.row}>
            <TouchableOpacity
                style={[styles.explainButton, explaining && styles.iconButtonActive]}
                onPress={onExplain}
                accessibilityRole="button"
                accessibilityLabel={t('selection.aiExplain')}
                accessibilityState={{ selected: explaining }}
                activeOpacity={0.7}
            >
                <MaterialIcons name="auto-awesome" size={18} color={colors.text} />
                <Text style={styles.explainLabel} numberOfLines={1}>{t('selection.aiExplain')}</Text>
            </TouchableOpacity>
            <View style={styles.divider} />
            {iconButton({
                key: 'copy',
                label: copied ? t('lookup.copied') : t('selection.copy'),
                icon: <Feather name={copied ? 'check' : 'copy'} size={19} color={colors.text} />,
                onPress: onCopy,
            })}
            {iconButton({
                key: 'highlight',
                label: highlighted ? t('selection.changeHighlight') : t('selection.highlight'),
                icon: (
                    <MaterialCommunityIcons
                        name={highlighted ? 'marker-check' : 'marker'}
                        size={21}
                        color={activeSwatch || colors.text}
                    />
                ),
                onPress: onHighlight,
                active: colorsOpen,
                disabled: !onHighlight,
            })}
            {iconButton({
                key: 'note',
                label: hasNote ? t('selection.editNote') : t('selection.note'),
                icon: (
                    <MaterialCommunityIcons
                        name={hasNote ? 'comment-text' : 'comment-text-outline'}
                        size={20}
                        color={colors.text}
                    />
                ),
                onPress: onNote,
                disabled: !onNote,
            })}
        </View>
    );

    const colorRow = colorsOpen ? (
        <View style={[styles.row, styles.colorRow]}>
            {HIGHLIGHT_COLORS.map((color) => {
                const selected = color.key === highlightColor;
                return (
                    <TouchableOpacity
                        key={color.key}
                        style={[styles.swatchRing, selected && { borderColor: colors.text }]}
                        onPress={() => onPickColor?.(color.key)}
                        accessibilityRole="button"
                        accessibilityLabel={t(`selection.color.${color.key}`)}
                        accessibilityState={{ selected }}
                        activeOpacity={0.7}
                    >
                        <View style={[styles.swatch, { backgroundColor: color.swatch[mode] }]} />
                    </TouchableOpacity>
                );
            })}
            {highlighted ? (
                <>
                    <View style={styles.divider} />
                    {iconButton({
                        key: 'remove',
                        label: t('selection.removeHighlight'),
                        icon: <MaterialCommunityIcons name="marker-cancel" size={20} color={colors.text} />,
                        onPress: onRemoveHighlight,
                    })}
                </>
            ) : null}
        </View>
    ) : null;

    return (
        <View style={[styles.bar, placement === 'top' ? styles.barTop : styles.barBottom]} accessibilityRole="toolbar">
            {placement === 'top' ? <>{mainRow}{colorRow}</> : <>{colorRow}{mainRow}</>}
        </View>
    );
};

const createStyles = (colors, isDarkMode) => StyleSheet.create({
    bar: {
        alignSelf: 'center',
        marginHorizontal: 16,
        paddingHorizontal: 6,
        paddingVertical: 6,
        gap: 4,
        borderRadius: 18,
        backgroundColor: colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
        shadowColor: '#000',
        shadowOpacity: isDarkMode ? 0.45 : 0.16,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 5 },
        elevation: 10,
    },
    barTop: {
        marginTop: 8,
    },
    barBottom: {
        marginBottom: 10,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
    },
    colorRow: {
        gap: 6,
        paddingHorizontal: 4,
    },
    explainButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        height: 44,
        paddingHorizontal: 12,
        borderRadius: 12,
    },
    explainLabel: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 14,
        color: colors.text,
    },
    divider: {
        width: StyleSheet.hairlineWidth,
        height: 24,
        marginHorizontal: 4,
        backgroundColor: colors.border,
    },
    iconButton: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 12,
    },
    iconButtonActive: {
        backgroundColor: colors.surfaceMuted,
    },
    disabled: {
        opacity: 0.4,
    },
    swatchRing: {
        width: 36,
        height: 36,
        borderRadius: 18,
        borderWidth: 2,
        borderColor: 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
    },
    swatch: {
        width: 24,
        height: 24,
        borderRadius: 12,
    },
});

export default memo(SelectionToolbar);
