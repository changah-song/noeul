import React, { useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { fontFamilies, radii } from '../../theme';

// ── Notes log ──────────────────────────────────────────────────────────────
// A slide-up sheet listing every note the reader has written in this book,
// newest first. Tapping a note navigates the reader to where it was written.
// Not in the prototype — a companion to the welcome-back note card.
const NotesLog = ({ themeColors, visible, notes = [], onClose, onSelect }) => {
    const insets = useSafeAreaInsets();
    const styles = useMemo(() => createStyles(themeColors), [themeColors]);

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <View style={styles.overlay}>
                <Pressable style={styles.backdrop} onPress={onClose} />
                <View style={[styles.sheet, { paddingBottom: insets.bottom + 18 }]}>
                    <View style={styles.grabber} />
                    <View style={styles.headerRow}>
                        <Text style={styles.title}>Your notes</Text>
                        <TouchableOpacity
                            onPress={onClose}
                            style={styles.closeButton}
                            accessibilityRole="button"
                            accessibilityLabel="Close"
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                            <Feather name="x" size={18} color={themeColors.textTertiary} />
                        </TouchableOpacity>
                    </View>

                    {notes.length === 0 ? (
                        <View style={styles.emptyState}>
                            <Text style={styles.emptyText}>
                                No notes yet. Leave one when you close the book and it will appear here.
                            </Text>
                        </View>
                    ) : (
                        <ScrollView
                            contentContainerStyle={styles.listContent}
                            showsVerticalScrollIndicator={false}
                        >
                            {notes.map((note) => (
                                <Pressable
                                    key={note.id ?? `${note.createdAt}-${note.text?.slice(0, 8)}`}
                                    onPress={() => onSelect?.(note)}
                                    style={({ pressed }) => ([
                                        styles.noteRow,
                                        pressed ? styles.noteRowPressed : null,
                                    ])}
                                    accessibilityRole="button"
                                >
                                    <View style={styles.noteMetaRow}>
                                        <Text style={styles.noteMeta} numberOfLines={1}>
                                            {note.positionLabel || ''}
                                        </Text>
                                        <Text style={styles.noteTime}>{note.timeLabel || ''}</Text>
                                    </View>
                                    <Text style={styles.noteText} numberOfLines={4}>
                                        {`“${note.text}”`}
                                    </Text>
                                </Pressable>
                            ))}
                        </ScrollView>
                    )}
                </View>
            </View>
        </Modal>
    );
};

const createStyles = (themeColors) => StyleSheet.create({
    overlay: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    backdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: themeColors.overlay,
    },
    sheet: {
        maxHeight: '78%',
        backgroundColor: themeColors.surface,
        borderTopLeftRadius: radii.xl,
        borderTopRightRadius: radii.xl,
        borderTopWidth: 1,
        borderColor: themeColors.border,
        paddingTop: 10,
        paddingHorizontal: 20,
        shadowColor: 'rgba(43,20,26,0.16)',
        shadowOffset: { width: 0, height: -10 },
        shadowOpacity: 1,
        shadowRadius: 30,
        elevation: 12,
    },
    grabber: {
        width: 40,
        height: 4,
        borderRadius: 2,
        alignSelf: 'center',
        marginTop: 4,
        marginBottom: 12,
        backgroundColor: themeColors.surfaceStrong,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    title: {
        fontFamily: fontFamilies.displaySemiBold,
        fontSize: 19,
        lineHeight: 24,
        color: themeColors.text,
    },
    closeButton: {
        width: 30,
        height: 30,
        alignItems: 'center',
        justifyContent: 'center',
    },
    emptyState: {
        paddingVertical: 34,
        paddingHorizontal: 8,
    },
    emptyText: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 14,
        lineHeight: 21,
        color: themeColors.textTertiary,
        textAlign: 'center',
    },
    listContent: {
        paddingTop: 10,
        paddingBottom: 6,
    },
    noteRow: {
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderRadius: radii.lg,
        borderWidth: 1,
        borderColor: themeColors.border,
        backgroundColor: themeColors.surfaceCard,
        marginBottom: 10,
    },
    noteRowPressed: {
        backgroundColor: themeColors.surfaceMuted,
    },
    noteMetaRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 10,
        marginBottom: 7,
    },
    noteMeta: {
        flex: 1,
        fontFamily: fontFamilies.sansBold,
        fontSize: 9,
        letterSpacing: 1.6,
        textTransform: 'uppercase',
        color: themeColors.textTertiary,
    },
    noteTime: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 10,
        letterSpacing: 0.4,
        color: themeColors.textSubtle,
    },
    noteText: {
        fontFamily: fontFamilies.displayItalic,
        fontSize: 15,
        lineHeight: 23,
        color: themeColors.textSecondary,
    },
});

export default NotesLog;
