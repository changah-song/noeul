import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { fontFamilies, radii } from '../../theme';

// ── Welcome-back ("Return Note") entry screen ──────────────────────────────
// Shown when reopening an in-progress book: last note, progress, and a single
// Continue-reading action. Ported 1:1 from the Noeul design prototype. Themed
// via the reader-scoped `themeColors` passed from the Read screen.
const Dot = ({ color }) => (
    <View style={{ width: 3, height: 3, borderRadius: 2, backgroundColor: color }} />
);

const ReturnNote = ({
    themeColors,
    title,
    subtitle,
    chapterLabel,
    percent = 0,
    lastSessionLabel,
    note,
    hasNote,
    noteEmptyLabel,
    onBack,
    onContinue,
    onOpenNotes,
    topInset = 0,
    bottomInset = 0,
}) => {
    const styles = useMemo(() => createStyles(themeColors), [themeColors]);
    const pct = Math.round(Math.min(Math.max(Number(percent) || 0, 0), 1) * 100);
    const metaParts = [chapterLabel, `${pct}% in`, lastSessionLabel].filter(Boolean);

    return (
        <View style={[styles.root, { paddingTop: topInset + 14, paddingBottom: bottomInset + 28 }]}>
            <View style={styles.topRow}>
                <TouchableOpacity
                    style={styles.backButton}
                    onPress={onBack}
                    accessibilityRole="button"
                    accessibilityLabel="Library"
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                    <Feather name="chevron-left" size={20} color={themeColors.readerMutedInk} />
                </TouchableOpacity>
                <Text style={styles.topLabel}>Library</Text>
            </View>

            <View style={styles.body}>
                <Text style={styles.eyebrow}>Welcome back</Text>
                <Text style={styles.title} numberOfLines={3}>{title}</Text>
                {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}

                {metaParts.length ? (
                    <View style={styles.metaRow}>
                        {metaParts.map((part, index) => (
                            <React.Fragment key={`${part}-${index}`}>
                                {index > 0 ? <Dot color={themeColors.textSubtle} /> : null}
                                <Text style={styles.metaText}>{part}</Text>
                            </React.Fragment>
                        ))}
                    </View>
                ) : null}

                <Pressable
                    onPress={onOpenNotes}
                    disabled={!onOpenNotes}
                    style={({ pressed }) => ([
                        styles.noteCard,
                        pressed && onOpenNotes ? styles.noteCardPressed : null,
                    ])}
                    accessibilityRole={onOpenNotes ? 'button' : undefined}
                    accessibilityLabel={onOpenNotes ? 'Open your notes' : undefined}
                >
                    <View style={styles.noteHeaderRow}>
                        <Text style={styles.noteLabel}>Your note to yourself</Text>
                        {hasNote && onOpenNotes ? (
                            <Feather name="chevron-right" size={15} color={themeColors.textTertiary} />
                        ) : null}
                    </View>
                    <Text style={hasNote ? styles.noteText : styles.noteEmptyText}>
                        {hasNote ? `“${note}”` : noteEmptyLabel}
                    </Text>
                </Pressable>
            </View>

            <TouchableOpacity
                style={styles.continueButton}
                onPress={onContinue}
                activeOpacity={0.85}
                accessibilityRole="button"
            >
                <Text style={styles.continueLabel}>Continue reading</Text>
                <Feather name="arrow-right" size={18} color={themeColors.glyphCream} />
            </TouchableOpacity>
            <Text style={styles.caption}>Picks up exactly where you stopped.</Text>
        </View>
    );
};

const createStyles = (themeColors) => StyleSheet.create({
    root: {
        flex: 1,
        paddingHorizontal: 28,
        backgroundColor: themeColors.readerPaper,
    },
    topRow: {
        height: 38,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    backButton: {
        width: 34,
        height: 34,
        marginLeft: -6,
        alignItems: 'center',
        justifyContent: 'center',
    },
    topLabel: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 9,
        letterSpacing: 2,
        textTransform: 'uppercase',
        color: themeColors.textTertiary,
    },
    body: {
        flex: 1,
        justifyContent: 'center',
    },
    eyebrow: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 10,
        letterSpacing: 2.4,
        textTransform: 'uppercase',
        color: themeColors.textTertiary,
    },
    title: {
        fontFamily: fontFamilies.krSerifSemiBold,
        fontSize: 30,
        lineHeight: 38,
        color: themeColors.text,
        marginTop: 10,
        marginBottom: 4,
    },
    subtitle: {
        fontFamily: fontFamilies.displayItalic,
        fontSize: 15,
        lineHeight: 20,
        color: themeColors.textTertiary,
    },
    metaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginTop: 12,
    },
    metaText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 11,
        letterSpacing: 0.4,
        color: themeColors.textMuted,
    },
    noteCard: {
        marginTop: 26,
        paddingVertical: 16,
        paddingHorizontal: 18,
        backgroundColor: themeColors.surfaceCard,
        borderWidth: 1,
        borderColor: themeColors.border,
        borderRadius: radii.lg,
    },
    noteCardPressed: {
        backgroundColor: themeColors.surfaceMuted,
    },
    noteHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 9,
    },
    noteLabel: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 9.5,
        letterSpacing: 1.8,
        textTransform: 'uppercase',
        color: themeColors.textTertiary,
    },
    noteText: {
        fontFamily: fontFamilies.displayItalic,
        fontSize: 17,
        lineHeight: 26,
        color: themeColors.textSecondary,
    },
    noteEmptyText: {
        fontFamily: fontFamilies.displayItalic,
        fontSize: 15,
        lineHeight: 23,
        color: themeColors.textSubtle,
    },
    continueButton: {
        height: 52,
        borderRadius: radii.md,
        backgroundColor: themeColors.inkSlate,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
    },
    continueLabel: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 13,
        letterSpacing: 1.8,
        textTransform: 'uppercase',
        color: themeColors.glyphCream,
    },
    caption: {
        textAlign: 'center',
        marginTop: 12,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 11,
        color: themeColors.textSubtle,
    },
});

export default ReturnNote;
