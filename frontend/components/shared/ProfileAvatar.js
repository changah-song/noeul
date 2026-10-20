import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/tokens';
import { fontFamilies } from '../../theme';

// Muted colours for signed-in letter avatars, picked per account so each
// person keeps the same one. White text reads on all of them.
const AVATAR_COLORS = ['#3d6b5e', '#8a5a44', '#5b4f7a', '#3f5f80', '#6b6a3d', '#7a4b5c'];

const hashString = (value) => {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
        hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
};

/** The signed-in person's first name, from their profile or email. */
export const firstNameOf = (user) => {
    const meta = user?.user_metadata || {};
    const name = meta.given_name
        || meta.full_name
        || meta.name
        || meta.display_name
        || meta.username
        || String(user?.email || '').split('@')[0];
    return String(name || '').trim().split(/\s+/)[0] || '';
};

/** First character of the first name (a whole Hangul or Han character too). */
export const avatarLetterOf = (user) => {
    const first = Array.from(firstNameOf(user))[0] || '';
    return first.toLocaleUpperCase();
};

/**
 * ProfileAvatar — a round avatar. Guests get a person icon; signed-in users
 * get the first letter of their first name on a colour of their own.
 */
const ProfileAvatar = ({ user, size = 34 }) => {
    const { colors } = useTheme();
    const letter = user ? avatarLetterOf(user) : '';
    const box = { width: size, height: size, borderRadius: size / 2 };
    if (!letter) {
        return (
            <View style={[styles.base, box, { backgroundColor: colors.surfaceMuted }]}>
                <Feather name="user" size={Math.round(size * 0.5)} color={colors.textSecondary} />
            </View>
        );
    }
    const color = AVATAR_COLORS[hashString(String(user?.id || user?.email || letter)) % AVATAR_COLORS.length];
    return (
        <View style={[styles.base, box, { backgroundColor: color }]}>
            <Text
                style={[styles.letter, { fontSize: Math.round(size * 0.46), lineHeight: Math.round(size * 0.6) }]}
                allowFontScaling={false}
            >
                {letter}
            </Text>
        </View>
    );
};

const styles = StyleSheet.create({
    base: {
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    },
    letter: {
        fontFamily: fontFamilies.sansSemiBold,
        color: '#ffffff',
        includeFontPadding: false,
    },
});

export default ProfileAvatar;
