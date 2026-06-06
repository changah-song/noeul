import React, { useMemo, useState } from 'react';
import { Alert, Image, Linking, Modal, Pressable, StyleSheet, Text, TextInput, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import Auth from './Auth';
import { Card, IconButton, Screen, SectionHeader } from '../components/ui';
import {
    bumpSyncGeneration,
    pauseCloudSync,
    resumeCloudSync,
} from '../services/localOwnerCoordinator';
import { deleteCurrentUserProfile } from '../services/accountDeletion';
import { makeOwnerDataDirectory } from '../services/localDataScope';
import { clearLocalUserData } from '../services/localUserData';
import { colors, radii, spacing, textStyles } from '../theme';

const FEEDBACK_EMAIL = 'casong00@gmail.com';

const Profile = ({ user, signOut, updateUsername, updateProfile }) => {
    const [showNameEditor, setShowNameEditor] = useState(false);
    const [draftName, setDraftName] = useState('');
    const [isSavingName, setIsSavingName] = useState(false);
    const [statsExpanded, setStatsExpanded] = useState(false);
    const [showFeedbackComposer, setShowFeedbackComposer] = useState(false);
    const [feedbackMessage, setFeedbackMessage] = useState('');
    const [isSavingAvatar, setIsSavingAvatar] = useState(false);
    const [isSigningOut, setIsSigningOut] = useState(false);
    const [isDeletingProfile, setIsDeletingProfile] = useState(false);

    const joinedDate = user?.created_at
        ? new Date(user.created_at).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
        })
        : 'Recently';

    const displayName = useMemo(() => {
        const metadataName = user?.user_metadata?.username
            || user?.user_metadata?.display_name
            || user?.user_metadata?.name;

        if (metadataName && String(metadataName).trim()) {
            return String(metadataName).trim();
        }

        return 'Reader';
    }, [user?.user_metadata]);

    const avatarUri = useMemo(() => {
        const avatar = user?.user_metadata?.avatar_uri;
        const updatedAt = user?.user_metadata?.avatar_updated_at;
        if (!avatar || !String(avatar).trim()) {
            return null;
        }
        return updatedAt ? `${String(avatar).trim()}?t=${encodeURIComponent(String(updatedAt))}` : String(avatar).trim();
    }, [user?.user_metadata]);

    const handleStartEditName = () => {
        setDraftName(displayName);
        setShowNameEditor(true);
    };

    const handleSaveName = async () => {
        const trimmed = draftName.trim();

        if (!trimmed) {
            Alert.alert('Name required', 'Please enter a username.');
            return;
        }

        try {
            setIsSavingName(true);
            await updateUsername?.(trimmed);
            setShowNameEditor(false);
        } catch (error) {
            Alert.alert('Update failed', error.message || 'Could not update username.');
        } finally {
            setIsSavingName(false);
        }
    };

    const handlePickAvatar = async () => {
        try {
            setIsSavingAvatar(true);
            const { assets, canceled } = await DocumentPicker.getDocumentAsync({
                type: ['image/*'],
                copyToCacheDirectory: true,
            });

            if (canceled || !assets?.[0]?.uri) {
                return;
            }

            const picked = assets[0];
            const extension = (picked.name?.split('.').pop() || picked.uri.split('.').pop() || 'jpg').replace(/[^a-zA-Z0-9]/g, '');
            const avatarDir = `${FileSystem.documentDirectory}${makeOwnerDataDirectory(user?.id)}profile/`;
            const timestamp = Date.now();
            const destination = `${avatarDir}avatar-${user?.id || 'local'}-${timestamp}.${extension || 'jpg'}`;

            await FileSystem.makeDirectoryAsync(avatarDir, { intermediates: true });
            await FileSystem.copyAsync({
                from: picked.uri,
                to: destination,
            });

            await updateProfile?.({
                avatar_uri: destination,
                avatar_updated_at: timestamp,
            });
        } catch (error) {
            Alert.alert('Upload failed', error.message || 'Could not update your profile image.');
        } finally {
            setIsSavingAvatar(false);
        }
    };

    const handleSendFeedback = async () => {
        const trimmed = feedbackMessage.trim();
        const subject = encodeURIComponent('Fluent Fable feedback');
        const body = encodeURIComponent(trimmed || 'Hi, I wanted to share some feedback:\n\n');
        const url = `mailto:${FEEDBACK_EMAIL}?subject=${subject}&body=${body}`;

        try {
            await Linking.openURL(url);
            setShowFeedbackComposer(false);
            setFeedbackMessage('');
        } catch (error) {
            Alert.alert(
                'Mail app unavailable',
                `Direct in-app sending would require backend email setup. For now, please email ${FEEDBACK_EMAIL} and paste your message there.`
            );
        }
    };

    const performSignOut = async ({ removeLocalData = false } = {}) => {
        if (isSigningOut || isDeletingProfile) {
            return;
        }

        const userId = user?.id;
        setIsSigningOut(true);
        pauseCloudSync();
        bumpSyncGeneration();

        try {
            if (removeLocalData && userId) {
                await clearLocalUserData(userId);
            }

            await signOut?.();
        } catch (error) {
            resumeCloudSync();
            Alert.alert('Sign out failed', error.message || 'Could not sign out.');
        } finally {
            setIsSigningOut(false);
        }
    };

    const handleSignOut = () => {
        Alert.alert(
            'Sign out',
            'Choose whether to keep this account data cached on this device.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Sign out',
                    onPress: () => performSignOut(),
                },
                {
                    text: 'Sign out and remove data from this device',
                    style: 'destructive',
                    onPress: () => performSignOut({ removeLocalData: true }),
                },
            ]
        );
    };

    const signOutLocally = async () => {
        try {
            await signOut?.({ scope: 'local' });
        } catch (error) {
            console.warn('[Profile] Failed to clear deleted account session locally', error);
        }
    };

    const performDeleteProfile = async () => {
        if (isDeletingProfile || isSigningOut) {
            return;
        }

        const userId = user?.id;
        let didDeleteRemoteProfile = false;
        setIsDeletingProfile(true);
        pauseCloudSync();
        bumpSyncGeneration();

        try {
            await deleteCurrentUserProfile();
            didDeleteRemoteProfile = true;

            if (userId) {
                await clearLocalUserData(userId);
            }

            await signOutLocally();
        } catch (error) {
            if (didDeleteRemoteProfile) {
                await signOutLocally();
                Alert.alert(
                    'Profile deleted',
                    'Your account was deleted, but some cached data on this device may not have been removed.'
                );
                return;
            }

            resumeCloudSync();
            Alert.alert('Delete profile failed', error.message || 'Could not delete your profile.');
        } finally {
            setIsDeletingProfile(false);
        }
    };

    const handleDeleteProfile = () => {
        if (isDeletingProfile || isSigningOut) {
            return;
        }

        Alert.alert(
            'Delete profile?',
            'This permanently deletes your account and all data in it, including books, vocabulary, songs, writing, reading progress, settings, and cloud files. This cannot be undone.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete everything',
                    style: 'destructive',
                    onPress: performDeleteProfile,
                },
            ]
        );
    };

    if (!user) {
        return (
            <Screen scroll>
                <SectionHeader
                    eyebrow="Profile"
                    title="Guest mode is active"
                    subtitle="Keep reading as a guest, or sign in to sync saved words, track progress, and unlock strength, weakness, and level analysis."
                />

                <View style={styles.guestAuthWrap}>
                    <Auth
                        embedded
                        title="Sign in later if you want"
                        subtitle="Guest mode keeps your reading and saved words on this device. Signing in lets us sync them to your account."
                    />
                </View>
            </Screen>
        );
    }

    return (
        <Screen scroll>
            <SectionHeader
                eyebrow="Profile"
                title="Your profile"
            />

            <Card style={styles.profileCard}>
                <View style={styles.profileTop}>
                    {avatarUri ? (
                        <Image source={{ uri: avatarUri }} style={styles.avatar} />
                    ) : (
                        <View style={styles.avatar}>
                            <Feather name="user" size={28} color={colors.textMuted} />
                        </View>
                    )}
                    <View style={styles.identity}>
                        <Text style={styles.nameText}>{displayName}</Text>
                        <Text style={styles.placeholderText}>Analysis to be implemented soon</Text>
                        <Text style={styles.joinedText}>Joined {joinedDate}</Text>
                    </View>
                </View>

                <View style={styles.profileActions}>
                    <IconButton
                        label="Change username"
                        onPress={handleStartEditName}
                        icon={<Feather name="edit-3" size={15} color={colors.text} />}
                    />
                    <IconButton
                        label={isSavingAvatar ? 'Uploading…' : 'Change photo'}
                        onPress={handlePickAvatar}
                        disabled={isSavingAvatar}
                        icon={<Feather name="image" size={15} color={colors.text} />}
                    />
                </View>
            </Card>

            <Card tone="muted" subtle style={styles.sectionCard}>
                <View style={styles.optionList}>
                    <TouchableOpacity style={styles.optionRow} activeOpacity={0.8} onPress={() => setShowFeedbackComposer(true)}>
                        <Text style={styles.optionText}>Help & feedback</Text>
                        <Feather name="mail" size={16} color={colors.textMuted} />
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={styles.optionRow}
                        activeOpacity={0.8}
                        onPress={() => setStatsExpanded((prev) => !prev)}
                    >
                        <Text style={styles.optionText}>Reading and vocab stats</Text>
                        <Feather
                            name={statsExpanded ? 'chevron-up' : 'chevron-down'}
                            size={16}
                            color={colors.textMuted}
                        />
                    </TouchableOpacity>

                    {statsExpanded ? (
                        <View style={styles.expandBody}>
                            <Text style={styles.expandText}>Analysis to be implemented soon</Text>
                        </View>
                    ) : null}

                    <TouchableOpacity
                        style={[
                            styles.optionRow,
                            styles.deleteOptionRow,
                            (isDeletingProfile || isSigningOut) && styles.optionRowDisabled,
                        ]}
                        activeOpacity={0.8}
                        onPress={handleDeleteProfile}
                        disabled={isDeletingProfile || isSigningOut}
                    >
                        <Text style={[styles.optionText, styles.deleteOptionText]}>
                            {isDeletingProfile ? 'Deleting profile...' : 'Delete profile'}
                        </Text>
                        <Feather name="trash-2" size={16} color={colors.danger} />
                    </TouchableOpacity>
                </View>
            </Card>

            <IconButton
                label={isSigningOut ? 'Signing out...' : 'Sign out'}
                tone="neutral"
                onPress={handleSignOut}
                disabled={isSigningOut || isDeletingProfile}
                icon={<Feather name="log-out" size={16} color={colors.text} />}
                style={styles.signOutButton}
            />

            <Modal visible={showNameEditor} animationType="fade" transparent onRequestClose={() => setShowNameEditor(false)}>
                <TouchableWithoutFeedback onPress={() => setShowNameEditor(false)}>
                    <View style={styles.modalBackdrop}>
                        <TouchableWithoutFeedback>
                            <View style={styles.modalCard}>
                                <Text style={styles.modalTitle}>Change username</Text>
                                <TextInput
                                    value={draftName}
                                    onChangeText={setDraftName}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    placeholder="Enter username"
                                    placeholderTextColor={colors.textSubtle}
                                    style={styles.input}
                                />
                                <View style={styles.modalActions}>
                                    <Pressable onPress={() => setShowNameEditor(false)} style={styles.modalButton}>
                                        <Text style={styles.modalButtonText}>Cancel</Text>
                                    </Pressable>
                                    <Pressable
                                        onPress={handleSaveName}
                                        style={[styles.modalButton, styles.modalPrimaryButton, isSavingName && styles.modalButtonDisabled]}
                                        disabled={isSavingName}
                                    >
                                        <Text style={[styles.modalButtonText, styles.modalPrimaryButtonText]}>
                                            {isSavingName ? 'Saving…' : 'Save'}
                                        </Text>
                                    </Pressable>
                                </View>
                            </View>
                        </TouchableWithoutFeedback>
                    </View>
                </TouchableWithoutFeedback>
            </Modal>

            <Modal visible={showFeedbackComposer} animationType="fade" transparent onRequestClose={() => setShowFeedbackComposer(false)}>
                <TouchableWithoutFeedback onPress={() => setShowFeedbackComposer(false)}>
                    <View style={styles.modalBackdrop}>
                        <TouchableWithoutFeedback>
                            <View style={styles.modalCard}>
                                <Text style={styles.modalTitle}>Help & feedback</Text>
                                <Text style={styles.modalHelper}>
                                    Write your message here. Tapping send will open your mail app with the message addressed to {FEEDBACK_EMAIL}.
                                </Text>
                                <TextInput
                                    value={feedbackMessage}
                                    onChangeText={setFeedbackMessage}
                                    multiline
                                    textAlignVertical="top"
                                    placeholder="Type your feedback here"
                                    placeholderTextColor={colors.textSubtle}
                                    style={[styles.input, styles.feedbackInput]}
                                />
                                <View style={styles.modalActions}>
                                    <Pressable onPress={() => setShowFeedbackComposer(false)} style={styles.modalButton}>
                                        <Text style={styles.modalButtonText}>Cancel</Text>
                                    </Pressable>
                                    <Pressable
                                        onPress={handleSendFeedback}
                                        style={[styles.modalButton, styles.modalPrimaryButton]}
                                    >
                                        <Text style={[styles.modalButtonText, styles.modalPrimaryButtonText]}>Send</Text>
                                    </Pressable>
                                </View>
                            </View>
                        </TouchableWithoutFeedback>
                    </View>
                </TouchableWithoutFeedback>
            </Modal>
        </Screen>
    );
};

const styles = StyleSheet.create({
    guestAuthWrap: {
        marginTop: spacing.xl,
    },
    profileCard: {
        marginTop: spacing.xl,
    },
    profileTop: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
    },
    avatar: {
        width: 72,
        height: 72,
        borderRadius: 36,
        backgroundColor: colors.surfaceMuted,
        alignItems: 'center',
        justifyContent: 'center',
    },
    identity: {
        flex: 1,
        gap: spacing.xxs,
    },
    nameText: {
        ...textStyles.title,
    },
    placeholderText: {
        ...textStyles.bodyMuted,
    },
    joinedText: {
        ...textStyles.caption,
    },
    profileActions: {
        marginTop: spacing.lg,
        alignItems: 'flex-start',
        gap: spacing.sm,
    },
    sectionCard: {
        marginTop: spacing.lg,
    },
    optionList: {
        gap: spacing.xs,
    },
    optionRow: {
        minHeight: 44,
        borderRadius: radii.md,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.sm,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: colors.surface,
    },
    optionRowDisabled: {
        opacity: 0.55,
    },
    optionText: {
        ...textStyles.body,
        color: colors.text,
    },
    deleteOptionRow: {
        borderWidth: 1,
        borderColor: 'rgba(182, 79, 68, 0.28)',
        backgroundColor: 'rgba(182, 79, 68, 0.08)',
    },
    deleteOptionText: {
        color: colors.danger,
        fontWeight: '700',
    },
    expandBody: {
        paddingHorizontal: spacing.sm,
        paddingBottom: spacing.xs,
    },
    expandText: {
        ...textStyles.bodyMuted,
    },
    signOutButton: {
        marginTop: spacing.lg,
        marginBottom: spacing.md,
        alignSelf: 'flex-start',
    },
    modalBackdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.26)',
        justifyContent: 'center',
        paddingHorizontal: spacing.lg,
    },
    modalCard: {
        backgroundColor: colors.surfaceElevated,
        borderRadius: radii.lg,
        padding: spacing.lg,
        borderWidth: 1,
        borderColor: colors.border,
        gap: spacing.md,
    },
    modalTitle: {
        ...textStyles.sectionTitle,
    },
    modalHelper: {
        ...textStyles.bodyMuted,
        lineHeight: 20,
    },
    input: {
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radii.md,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        color: colors.text,
        backgroundColor: colors.surface,
        ...textStyles.body,
    },
    feedbackInput: {
        minHeight: 140,
    },
    modalActions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: spacing.sm,
    },
    modalButton: {
        minWidth: 88,
        minHeight: 40,
        borderRadius: radii.pill,
        paddingHorizontal: spacing.md,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.surfaceMuted,
    },
    modalPrimaryButton: {
        backgroundColor: colors.accentSoft,
    },
    modalButtonDisabled: {
        opacity: 0.6,
    },
    modalButtonText: {
        ...textStyles.label,
        color: colors.text,
    },
    modalPrimaryButtonText: {
        color: colors.accentStrong,
    },
});

export default Profile;
