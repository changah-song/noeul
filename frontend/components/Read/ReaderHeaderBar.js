import { memo } from 'react';
import { Pressable, Text, TouchableOpacity, View } from 'react-native';
import { Feather, MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { spacing } from '../../theme';

// Building blocks of the reader top bar, shared by the book reader
// (screens/Read.js) and the song reader so both headers look the same.
// Styles come from createReaderChromeStyles (readerChromeStyles.js).

const HIT_SLOP = { top: 2, bottom: 2, left: 2, right: 2 };

export const ReaderHeaderBar = ({ styles, topInset = 0, children }) => (
    <View style={[styles.headerBar, { paddingTop: topInset + spacing.xs }]}>
        {children}
    </View>
);

export const ReaderBackButton = memo(({ styles, themeColors, onPress, accessibilityLabel }) => (
    <TouchableOpacity
        style={styles.headerBackButton}
        onPress={onPress}
        hitSlop={HIT_SLOP}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
    >
        <Feather name="chevron-left" size={24} color={themeColors.inkSlate} />
    </TouchableOpacity>
));
ReaderBackButton.displayName = 'ReaderBackButton';

export const ReaderCheckpointButton = memo(({
    styles,
    themeColors,
    active,
    onPress,
    onLongPress,
    accessibilityLabel,
}) => (
    <TouchableOpacity
        style={styles.headerIconButton}
        onPress={onPress}
        onLongPress={onLongPress}
        accessibilityRole="button"
        accessibilityState={{ selected: !!active }}
        accessibilityLabel={accessibilityLabel}
    >
        <MaterialIcons
            name={active ? 'bookmark' : 'bookmark-border'}
            size={21}
            color={themeColors.inkSlate}
        />
    </TouchableOpacity>
));
ReaderCheckpointButton.displayName = 'ReaderCheckpointButton';

export const ReaderSavedWordsButton = memo(({ styles, themeColors, count = 0, onPress, accessibilityLabel }) => (
    <TouchableOpacity
        style={styles.savedButton}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
    >
        <MaterialCommunityIcons name="cards-outline" size={21} color={themeColors.inkSlate} />
        {count > 0 ? (
            <View style={styles.savedBadge}>
                <Text style={styles.savedBadgeText}>{count > 99 ? '99+' : count}</Text>
            </View>
        ) : null}
    </TouchableOpacity>
));
ReaderSavedWordsButton.displayName = 'ReaderSavedWordsButton';

export const ReaderFocusModeButton = memo(({ styles, themeColors, active, onPress, accessibilityLabel, style }) => (
    <TouchableOpacity
        style={[styles.headerIconButton, active && styles.headerIconButtonActive, style]}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ selected: !!active }}
        accessibilityLabel={accessibilityLabel}
    >
        <Feather name="eye" size={20} color={themeColors.inkSlate} />
    </TouchableOpacity>
));
ReaderFocusModeButton.displayName = 'ReaderFocusModeButton';

export const ReaderListenButton = memo(({ styles, themeColors, active, onPress, accessibilityLabel, style }) => (
    <TouchableOpacity
        style={[styles.headerIconButton, active && styles.headerIconButtonActive, style]}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ selected: !!active }}
        accessibilityLabel={accessibilityLabel}
    >
        <Feather name="headphones" size={19} color={themeColors.inkSlate} />
    </TouchableOpacity>
));
ReaderListenButton.displayName = 'ReaderListenButton';

// Thin progress bar + percent. Fills the space between the left icon group
// and the right-hand buttons, right-aligned; tapping opens the contents.
export const ReaderProgressButton = memo(({
    styles,
    fillWidth,
    label,
    disabled,
    onPress,
    accessibilityLabel,
}) => (
    <Pressable
        disabled={disabled}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ disabled: !!disabled }}
        accessibilityLabel={accessibilityLabel}
        style={({ pressed }) => ([
            styles.progressCluster,
            pressed && !disabled && styles.progressClusterPressed,
        ])}
    >
        <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: fillWidth }]} />
        </View>
        <Text numberOfLines={1} style={styles.progressLabel}>{label}</Text>
    </Pressable>
));
ReaderProgressButton.displayName = 'ReaderProgressButton';

export const ReaderFullscreenButton = memo(({ styles, themeColors, onPress, accessibilityLabel }) => (
    <TouchableOpacity
        style={styles.headerIconButton}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
    >
        <Feather name="maximize" size={18} color={themeColors.inkSlate} />
    </TouchableOpacity>
));
ReaderFullscreenButton.displayName = 'ReaderFullscreenButton';

export const ReaderMenuButton = memo(({ styles, themeColors, open, onPress, accessibilityLabel }) => (
    <TouchableOpacity
        style={[styles.settingsButton, open && styles.headerIconButtonActive]}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ expanded: !!open }}
        accessibilityLabel={accessibilityLabel}
    >
        <Feather name="menu" size={21} color={themeColors.inkSlate} />
    </TouchableOpacity>
));
ReaderMenuButton.displayName = 'ReaderMenuButton';

export default ReaderHeaderBar;
