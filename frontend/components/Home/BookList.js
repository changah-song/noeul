import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, radii, spacing, textStyles } from '../../theme';

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
                    <View style={styles.coverWrap}>
                        <Image
                            style={styles.cover}
                            source={item.cover ? { uri: item.cover } : require('../../assets/icon.png')}
                        />
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
        height: 150,
        borderRadius: 12,
        backgroundColor: colors.surfaceElevated,
        overflow: 'hidden',
        marginBottom: spacing.xs,
    },
    cover: {
        width: '100%',
        height: '100%',
        resizeMode: 'cover',
        backgroundColor: colors.surfaceMuted,
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
        borderRadius: 999,
        backgroundColor: '#6e6255',
    },
});

export default BookList;
