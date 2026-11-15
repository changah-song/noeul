import { useEffect, useRef, useState } from 'react';
import {
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';

import { useTranslation } from '../../hooks/useTranslation';
import { FOLDER_NAME_MAX_LENGTH } from '../../services/bookFolders';
import { fontFamilies } from '../../theme';

// The sheet for everything folders need a name or a choice for. `request`
// says what it is doing:
//   { mode: 'move', book, bookTitle, currentFolderId }   file a book
//   { mode: 'new' }                                       make an empty folder
//   { mode: 'rename', folder }                            rename a folder
// In 'move' one tap on a folder files the book and closes the sheet; typing a
// name and pressing return makes a new folder with the book in it.
const FolderSheet = ({
    request,
    folders,
    palette,
    onClose,
    onPickFolder,
    onRemoveFromFolder,
    onSubmitName,
}) => {
    const { t } = useTranslation();
    const [name, setName] = useState('');
    const inputRef = useRef(null);
    const mode = request?.mode ?? null;
    const moving = mode === 'move';

    useEffect(() => {
        setName(mode === 'rename' ? request.folder?.name ?? '' : '');
        // Only when the sheet opens for a new request.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [request]);

    const trimmed = name.trim();
    const submit = () => {
        if (trimmed) onSubmitName(trimmed);
    };

    const title = moving
        ? t('home.folderMoveTitle')
        : mode === 'rename' ? t('home.folderRename') : t('home.folderNew');

    return (
        <Modal
            visible={!!request}
            transparent
            animationType="fade"
            onRequestClose={onClose}
            // Naming a folder is the whole point of these two, so the keyboard
            // comes up with the sheet.
            onShow={() => { if (!moving) inputRef.current?.focus(); }}
        >
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                style={styles.fill}
            >
                <Pressable style={[styles.backdrop, { backgroundColor: palette.overlay }]} onPress={onClose}>
                    <Pressable style={[styles.sheet, { backgroundColor: palette.surface }]} onPress={() => {}}>
                        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">{title}</Text>
                        {moving && request.bookTitle ? (
                            <Text style={[styles.subtitle, { color: palette.sub }]} numberOfLines={1}>
                                {request.bookTitle}
                            </Text>
                        ) : null}

                        {moving ? (
                            <ScrollView
                                style={styles.list}
                                keyboardShouldPersistTaps="handled"
                                showsVerticalScrollIndicator={false}
                            >
                                {folders.map(({ folder, books }) => {
                                    const current = folder.id === request.currentFolderId;
                                    return (
                                        <Pressable
                                            key={folder.id}
                                            accessibilityRole="button"
                                            accessibilityState={{ selected: current }}
                                            onPress={() => (current ? onClose() : onPickFolder(folder.id))}
                                            style={({ pressed }) => [
                                                styles.row,
                                                { borderBottomColor: palette.divider },
                                                pressed && { backgroundColor: palette.pressed },
                                            ]}
                                        >
                                            <Feather name="folder" size={17} color={current ? palette.accent : palette.sub} />
                                            <Text style={[styles.rowLabel, { color: palette.text }]} numberOfLines={1}>
                                                {folder.name}
                                            </Text>
                                            <Text style={[styles.rowCount, { color: palette.tertiary }]}>{books.length}</Text>
                                            {current ? <Feather name="check" size={16} color={palette.accent} /> : null}
                                        </Pressable>
                                    );
                                })}
                                {request.currentFolderId ? (
                                    <Pressable
                                        accessibilityRole="button"
                                        onPress={onRemoveFromFolder}
                                        style={({ pressed }) => [
                                            styles.row,
                                            { borderBottomColor: palette.divider },
                                            pressed && { backgroundColor: palette.pressed },
                                        ]}
                                    >
                                        <Feather name="corner-up-left" size={17} color={palette.sub} />
                                        <Text style={[styles.rowLabel, { color: palette.text }]}>
                                            {t('home.folderRemoveFrom')}
                                        </Text>
                                    </Pressable>
                                ) : null}
                            </ScrollView>
                        ) : null}

                        <View style={[styles.inputRow, { borderColor: palette.border }]}>
                            <Feather name={moving ? 'folder-plus' : 'folder'} size={17} color={palette.sub} />
                            <TextInput
                                ref={inputRef}
                                value={name}
                                onChangeText={setName}
                                onSubmitEditing={submit}
                                placeholder={moving ? t('home.folderNew') : t('home.folderNamePlaceholder')}
                                placeholderTextColor={palette.faint}
                                maxLength={FOLDER_NAME_MAX_LENGTH}
                                returnKeyType="done"
                                selectTextOnFocus={mode === 'rename'}
                                style={[styles.input, { color: palette.text }]}
                            />
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={t('common.save')}
                                accessibilityState={{ disabled: !trimmed }}
                                disabled={!trimmed}
                                hitSlop={8}
                                onPress={submit}
                                style={[
                                    styles.confirm,
                                    { backgroundColor: trimmed ? palette.accent : palette.border },
                                ]}
                            >
                                <Feather name="check" size={16} color={palette.onAccent} />
                            </Pressable>
                        </View>
                    </Pressable>
                </Pressable>
            </KeyboardAvoidingView>
        </Modal>
    );
};

const styles = StyleSheet.create({
    fill: {
        flex: 1,
    },
    backdrop: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    sheet: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        paddingHorizontal: 22,
        paddingTop: 20,
        paddingBottom: 28,
    },
    title: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 16,
        lineHeight: 22,
    },
    subtitle: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        lineHeight: 18,
        marginTop: 2,
    },
    list: {
        maxHeight: 264,
        marginTop: 10,
    },
    row: {
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    rowLabel: {
        flex: 1,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 15,
        lineHeight: 20,
    },
    rowCount: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 13,
        lineHeight: 18,
    },
    inputRow: {
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginTop: 14,
        paddingLeft: 14,
        paddingRight: 8,
        borderWidth: 1,
        borderRadius: 12,
    },
    input: {
        flex: 1,
        paddingVertical: 8,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 15,
    },
    confirm: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
    },
});

export default FolderSheet;
