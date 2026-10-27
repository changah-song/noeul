import { memo, useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather, MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from '../../hooks/useTranslation';
import { fontFamilies, useTheme } from '../../theme';

/**
 * SelectionToolbar — what a long press offers once words are selected: copy,
 * highlight (or remove the highlight the selection sits in), a note, and an
 * AI explanation. Floats where the lookup panel would.
 */
const SelectionToolbar = ({
    placement = 'bottom',
    highlighted = false,
    hasNote = false,
    copied = false,
    onCopy,
    onHighlight,
    onNote,
    onExplain,
}) => {
    const { t } = useTranslation();
    const { colors, isDarkMode } = useTheme();
    const styles = useMemo(() => createStyles(colors, isDarkMode), [colors, isDarkMode]);

    const actions = [
        {
            key: 'copy',
            label: copied ? t('lookup.copied') : t('selection.copy'),
            icon: <Feather name={copied ? 'check' : 'copy'} size={19} color={colors.text} />,
            onPress: onCopy,
        },
        {
            key: 'highlight',
            label: highlighted ? t('selection.removeHighlight') : t('selection.highlight'),
            icon: (
                <MaterialCommunityIcons
                    name={highlighted ? 'marker-cancel' : 'marker'}
                    size={20}
                    color={colors.text}
                />
            ),
            onPress: onHighlight,
        },
        {
            key: 'note',
            label: hasNote ? t('selection.editNote') : t('selection.note'),
            icon: <Feather name="edit-3" size={19} color={colors.text} />,
            onPress: onNote,
        },
        {
            key: 'explain',
            label: t('selection.aiExplain'),
            icon: <MaterialIcons name="auto-awesome" size={19} color={colors.text} />,
            onPress: onExplain,
        },
    ];

    return (
        <View style={[styles.bar, placement === 'top' ? styles.barTop : styles.barBottom]} accessibilityRole="toolbar">
            {actions.map((action) => (
                <TouchableOpacity
                    key={action.key}
                    style={styles.action}
                    onPress={action.onPress}
                    accessibilityRole="button"
                    accessibilityLabel={action.label}
                    activeOpacity={0.7}
                >
                    {action.icon}
                    <Text style={styles.label} numberOfLines={1}>{action.label}</Text>
                </TouchableOpacity>
            ))}
        </View>
    );
};

const createStyles = (colors, isDarkMode) => StyleSheet.create({
    bar: {
        flexDirection: 'row',
        alignSelf: 'center',
        marginHorizontal: 16,
        paddingHorizontal: 6,
        paddingVertical: 6,
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
        marginBottom: 14,
    },
    action: {
        minWidth: 72,
        paddingHorizontal: 8,
        paddingVertical: 6,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 3,
        borderRadius: 12,
    },
    label: {
        fontFamily: fontFamilies.sansMedium,
        fontSize: 12,
        lineHeight: 16,
        color: colors.textSecondary,
    },
});

export default memo(SelectionToolbar);
