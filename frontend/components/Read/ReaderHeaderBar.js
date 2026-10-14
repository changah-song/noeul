import { memo } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { spacing } from '../../theme';

// Building blocks of the reader top bar, matching the book reader header in
// screens/Read.js (same sizes, icons, colors and badge). Used by the song
// reader; Read.js still renders its own inline copy and can adopt these later.

export const ReaderHeaderBar = ({ styles, topInset = 0, children }) => (
    <View style={[styles.headerBar, { paddingTop: topInset + spacing.xs }]}>
        {children}
    </View>
);

export const ReaderSavedWordsButton = memo(({ styles, themeColors, count = 0, onPress, accessibilityLabel }) => (
    <TouchableOpacity
        style={styles.savedButton}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
    >
        <MaterialCommunityIcons name="cards-outline" size={22} color={themeColors.textSecondary} />
        {count > 0 ? (
            <View style={styles.savedBadge}>
                <Text style={styles.savedBadgeText}>{count > 99 ? '99+' : count}</Text>
            </View>
        ) : null}
    </TouchableOpacity>
));
ReaderSavedWordsButton.displayName = 'ReaderSavedWordsButton';

export const ReaderFocusModeButton = memo(({ styles, themeColors, active, onPress, accessibilityLabel }) => (
    <TouchableOpacity
        style={styles.headerIconButton}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ selected: !!active }}
        accessibilityLabel={accessibilityLabel}
    >
        <MaterialIcons
            name="visibility"
            size={21}
            color={active ? themeColors.inkSlate : themeColors.textSecondary}
        />
    </TouchableOpacity>
));
ReaderFocusModeButton.displayName = 'ReaderFocusModeButton';

export const ReaderMenuButton = memo(({ styles, themeColors, open, onPress, accessibilityLabel }) => (
    <TouchableOpacity
        style={styles.settingsButton}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ expanded: !!open }}
        accessibilityLabel={accessibilityLabel}
    >
        <MaterialIcons name="menu" size={22} color={open ? themeColors.inkSlate : themeColors.textSecondary} />
    </TouchableOpacity>
));
ReaderMenuButton.displayName = 'ReaderMenuButton';

export default ReaderHeaderBar;
