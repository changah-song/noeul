import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, fontFamilies, layout, radii, spacing, textStyles } from '../../theme';

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const clampDotPosition = (value) => clamp(value, 0.035, 0.965);

const BookList = ({ books, onOpenBook }) => {
    return (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.row}
        >
            {books.map((item) => (
                <TouchableOpacity
                    key={item.id}
                    activeOpacity={0.9}
                    style={styles.item}
                    onPress={() => onOpenBook(item.uri)}
                >
                    <View style={[
                        styles.coverWrap,
                        item.coverTone === 'dark' && styles.coverWrapDark,
                        item.coverTone === 'mid' && styles.coverWrapMid,
                    ]}>
                        <View style={styles.coverRule} />
                        <Text style={[
                            styles.coverTitle,
                            item.coverTone === 'dark' && styles.coverTitleDark,
                            item.coverTone === 'mid' && styles.coverTitleDark,
                        ]} numberOfLines={2}>
                            {item.title || 'Untitled'}
                        </Text>
                        <Text style={[
                            styles.coverAuthor,
                            item.coverTone === 'dark' && styles.coverAuthorDark,
                            item.coverTone === 'mid' && styles.coverAuthorDark,
                        ]} numberOfLines={1}>
                            {item.author || item.creator || ''}
                        </Text>
                        <View style={styles.coverRule} />
                    </View>
                    <Text style={styles.title} numberOfLines={2}>
                        {item.title || 'Untitled'}
                    </Text>
                    <View style={styles.progressRail}>
                        <View style={styles.progressTrack} />
                        <View
                            style={[
                                styles.progressDot,
                                { left: `${clampDotPosition(typeof item.progress === 'number' ? item.progress : 0) * 100}%` },
                            ]}
                        />
                    </View>
                </TouchableOpacity>
            ))}
        </ScrollView>
    );
};

const styles = StyleSheet.create({
    row: {
        gap: spacing.md,
        paddingRight: spacing.md,
    },
    item: {
        width: 104,
    },
    coverWrap: {
        width: 104,
        aspectRatio: layout.bookCoverAspectRatio,
        borderRadius: radii.xs,
        backgroundColor: colors.surfaceMuted,
        borderLeftWidth: layout.bookGridCoverSpineWidth,
        borderLeftColor: colors.divider,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: spacing.sm,
        marginBottom: spacing.xs,
    },
    coverWrapDark: {
        backgroundColor: colors.coverSlate,
        borderLeftColor: colors.inkSlateDeep,
    },
    coverWrapMid: {
        backgroundColor: colors.coverMid,
        borderLeftColor: colors.coverSlate,
    },
    coverRule: {
        width: 30,
        height: layout.tabBarBorderWidth,
        backgroundColor: colors.textSubtle,
        marginVertical: spacing.xs,
    },
    coverTitle: {
        fontFamily: fontFamilies.krSerifSemiBold,
        fontSize: 18,
        lineHeight: 24,
        textAlign: 'center',
        color: colors.text,
    },
    coverTitleDark: {
        color: colors.border,
    },
    coverAuthor: {
        marginTop: spacing.xs,
        fontFamily: fontFamilies.krSerifRegular,
        fontSize: 11,
        lineHeight: 15,
        textAlign: 'center',
        color: colors.textTertiary,
    },
    coverAuthorDark: {
        color: colors.textSubtle,
    },
    title: {
        ...textStyles.sectionTitle,
        fontSize: 11,
        lineHeight: 15,
    },
    progressRail: {
        marginTop: spacing.xs,
        justifyContent: 'center',
        height: 8,
        position: 'relative',
    },
    progressTrack: {
        position: 'absolute',
        left: 0,
        right: 0,
        height: 2,
        borderRadius: 999,
        backgroundColor: colors.border,
    },
    progressDot: {
        position: 'absolute',
        top: '50%',
        width: 8,
        height: 8,
        marginTop: -4,
        marginLeft: -4,
        borderRadius: radii.pill,
        backgroundColor: colors.inkSlate,
    },
});

export default BookList;
