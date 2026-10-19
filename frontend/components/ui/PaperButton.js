import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/tokens';
import { fontFamilies } from '../../theme/typography';
import PressableScale from './PressableScale';

/**
 * PaperButton — the redesign's pill button. `variant`:
 *   primary   ink fill, paper text (one per screen: the main action)
 *   secondary hairline outline
 *   quiet     text only, tinted (links like "Add")
 * `size`: 'lg' (50 tall) or 'md' (44 tall). An optional `icon` element sits
 * before the label.
 */
const PaperButton = ({
    label,
    onPress,
    variant = 'primary',
    size = 'lg',
    icon = null,
    style,
    labelStyle,
    disabled,
    accessibilityLabel,
    ...rest
}) => {
    const { colors } = useTheme();
    const height = size === 'lg' ? 50 : 44;
    const box = variant === 'primary'
        ? { backgroundColor: colors.inkSlate }
        : variant === 'secondary'
            ? { borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: 'transparent' }
            : { backgroundColor: 'transparent', paddingHorizontal: 4 };
    const ink = variant === 'primary' ? colors.onInk : variant === 'quiet' ? colors.tint : colors.text;

    return (
        <PressableScale
            {...rest}
            onPress={onPress}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel ?? label}
            style={[styles.base, { height, borderRadius: height / 2 }, box, style]}
        >
            <View style={styles.row}>
                {icon}
                {label ? (
                    <Text
                        style={[styles.label, { color: ink, fontSize: size === 'lg' ? 16 : 15 }, labelStyle]}
                        numberOfLines={1}
                    >
                        {label}
                    </Text>
                ) : null}
            </View>
        </PressableScale>
    );
};

const styles = StyleSheet.create({
    base: {
        paddingHorizontal: 22,
        alignItems: 'center',
        justifyContent: 'center',
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    label: {
        fontFamily: fontFamilies.sansSemiBold,
        letterSpacing: 0,
    },
});

export default PaperButton;
