import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Alert,
    Linking,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    TouchableWithoutFeedback,
    View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { AuthModal } from './Auth';
import { deleteCurrentUserProfile } from '../services/accountDeletion';
import { Screen } from '../components/ui';
import VocabLevelModal, { tierIndexForTheta } from '../components/shared/VocabLevelModal';
import { OptionSheet } from '../components/shared/WordCheckModal';
import { getVocabTiers, hasVocabSizeGrid } from '../services/vocabSizeLevels';
import { getProfileAbility } from '../services/Database';
import { useAppContext } from '../contexts/AppContext';
import { useLocalOwner } from '../contexts/LocalOwnerContext';
import { useTranslation } from '../hooks/useTranslation';
import {
    getActiveTargetLanguageOptionId,
    getInterfaceLanguageLabel,
    KRDICT_INTERFACE_LANGUAGE_OPTIONS,
    normalizeInterfaceLanguageCode,
    TARGET_LANGUAGE_OPTIONS,
} from '../constants/languages';
import {
    CONTACT_EMAIL,
    PRIVACY_POLICY_URL,
    TERMS_OF_SERVICE_URL,
} from '../constants/links';
import { fontFamilies, radii, spacing, textStyles, useTheme } from '../theme';
import ProfileAvatar from '../components/shared/ProfileAvatar';
import { rtlIcon } from '../services/layoutDirection';
import { formatNumber } from '../services/interfaceLanguage';

const getProfileColors = (themeColors) => ({
    bg: themeColors.bgPage,
    surface: themeColors.surface,
    muted: themeColors.surfaceMuted,
    surfaceMuted: themeColors.surfaceMuted,
    ink: themeColors.text,
    inkSlate: themeColors.inkSlate,
    body: themeColors.textMuted,
    sub: themeColors.textTertiary,
    faint: themeColors.textSubtle,
    border: themeColors.divider,
    hardBorder: themeColors.border,
    strongBorder: themeColors.borderStrong,
    accent: themeColors.accent,
    danger: themeColors.danger,
    white: themeColors.white,
    cream: themeColors.glyphCream,
});

// The reader-facing label of a vocabulary tier ("About 3,000 words", "HSK 3").
export const vocabEstimateLabel = (tier, t) => {
    if (!tier) return null;
    if (tier.advanced) return t('vocabLevel.advancedTier');
    if (tier.label) return tier.label;
    return t('profile.vocabEstimateWords', { count: formatNumber(tier.threshold) });
};

// One settings row: small leading icon, label, optional value, trailing chevron.
const NavRow = ({ icon, label, value, valueStyle, onPress, trailingIcon = 'chevron-right', showDivider, styles, profileColors }) => (
    <>
        {showDivider ? <View style={styles.rowDivider} /> : null}
        <TouchableOpacity
            activeOpacity={0.7}
            onPress={onPress}
            style={styles.row}
            accessibilityRole="button"
            accessibilityLabel={value ? `${label}, ${value}` : label}
        >
            {icon ? <Feather name={icon} size={18} color={profileColors.body} /> : null}
            <Text style={[styles.rowLabel, styles.rowLabelFlex]} numberOfLines={1}>{label}</Text>
            {value ? <Text style={[styles.rowValue, valueStyle]} numberOfLines={1}>{value}</Text> : null}
            {trailingIcon ? <Feather name={rtlIcon(trailingIcon)} size={16} color={profileColors.faint} /> : null}
        </TouchableOpacity>
    </>
);

const Profile = ({ user, signOut, updateUsername, navigation }) => {
    const [isSigningOut, setIsSigningOut] = useState(false);
    const [showSignOutModal, setShowSignOutModal] = useState(false);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [isDeletingAccount, setIsDeletingAccount] = useState(false);
    const [showAuthModal, setShowAuthModal] = useState(false);
    const [authMode, setAuthMode] = useState('signin');
    const [showNameEditor, setShowNameEditor] = useState(false);
    const [showInterfaceLanguagePicker, setShowInterfaceLanguagePicker] = useState(false);
    const [showContactModal, setShowContactModal] = useState(false);
    const [emailCopied, setEmailCopied] = useState(false);
    const [draftName, setDraftName] = useState('');
    const [isSavingName, setIsSavingName] = useState(false);
    const [showTargetLanguagePicker, setShowTargetLanguagePicker] = useState(false);
    const [showVocabLevel, setShowVocabLevel] = useState(false);
    const [vocabEstimate, setVocabEstimate] = useState(null);
    // Notifications and personalized vocabulary keep their stored settings
    // (AppContext) but no longer have rows here.
    const {
        interfaceLanguage,
        setInterfaceLanguage,
        targetLanguage,
        setTargetLanguage,
        setChineseScript,
        isDarkMode,
        setIsDarkMode,
        activeProfileId,
    } = useAppContext();
    const { activeOwnerId } = useLocalOwner();
    const theme = useTheme();
    const profileColors = useMemo(() => getProfileColors(theme.colors), [theme.colors]);
    const styles = useMemo(() => createStyles(profileColors, theme.colors), [profileColors, theme.colors]);
    const { t } = useTranslation();
    const isAnonymous = Boolean(user?.is_anonymous);
    const isGuest = !user?.id || isAnonymous;
    const showVocabRow = hasVocabSizeGrid(targetLanguage);

    const displayName = useMemo(() => {
        const metadataName = user?.user_metadata?.username
            || user?.user_metadata?.display_name
            || user?.user_metadata?.name;

        if (metadataName && String(metadataName).trim()) {
            return String(metadataName).trim();
        }

        return t('profile.defaultName');
    }, [t, user?.user_metadata]);

    const learningSince = useMemo(() => {
        if (!user?.created_at) {
            return t('profile.recently');
        }

        return new Date(user.created_at).toLocaleDateString(normalizeInterfaceLanguageCode(interfaceLanguage), {
            month: 'short',
            year: 'numeric',
        });
    }, [interfaceLanguage, t, user?.created_at]);

    const identitySubtitle = isGuest
        ? t('profile.guestSubtitle')
        : (user?.email || t('profile.userSubtitle', { date: learningSince }));

    const interfaceLanguageOptions = KRDICT_INTERFACE_LANGUAGE_OPTIONS;

    useEffect(() => {
        if (user?.id) {
            setShowAuthModal(false);
        }
    }, [user?.id]);

    // The current level estimate for the "Vocabulary level" row.
    const loadVocabEstimate = useCallback(async () => {
        if (!hasVocabSizeGrid(targetLanguage)) {
            setVocabEstimate(null);
            return;
        }
        try {
            const ability = await getProfileAbility({
                ownerId: activeOwnerId,
                profileId: activeProfileId,
                language: targetLanguage,
            });
            const tiers = getVocabTiers(targetLanguage);
            const index = tierIndexForTheta(tiers, ability?.theta);
            setVocabEstimate(index == null ? null : vocabEstimateLabel(tiers[index], t));
        } catch {
            setVocabEstimate(null);
        }
    }, [activeOwnerId, activeProfileId, t, targetLanguage]);

    useEffect(() => {
        if (!showVocabLevel) {
            loadVocabEstimate();
        }
    }, [loadVocabEstimate, showVocabLevel]);

    useEffect(() => {
        const unsubscribe = navigation?.addListener?.('focus', loadVocabEstimate);
        return typeof unsubscribe === 'function' ? unsubscribe : undefined;
    }, [loadVocabEstimate, navigation]);

    const goBack = () => {
        if (navigation?.canGoBack?.()) {
            navigation.goBack();
            return;
        }
        navigation?.navigate?.('Home');
    };

    const performSignOut = async () => {
        if (isSigningOut) {
            return;
        }

        setIsSigningOut(true);
        try {
            await signOut?.();
        } catch (error) {
            Alert.alert(t('profile.signOutFailed'), error.message || t('profile.preferenceSoon'));
        } finally {
            setIsSigningOut(false);
            setShowSignOutModal(false);
        }
    };

    const performDeleteAccount = async () => {
        if (isDeletingAccount) {
            return;
        }

        setIsDeletingAccount(true);
        let profileDeleted = false;
        try {
            await deleteCurrentUserProfile();
            profileDeleted = true;
            setShowDeleteModal(false);
            await signOut?.();
        } catch (error) {
            if (profileDeleted) {
                // The account is gone; only the follow-up sign-out failed.
                // Don't tell the user the deletion failed.
                console.warn('[Profile] Sign-out after account deletion failed:', error?.message ?? error);
                Alert.alert(t('profile.signOutFailed'), t('profile.signOutAfterDeleteFailed'));
            } else {
                Alert.alert(t('profile.deleteAccountFailed'), error?.message || t('profile.preferenceSoon'));
            }
        } finally {
            setIsDeletingAccount(false);
        }
    };

    const handleInterfaceLanguageSelect = (language) => {
        if (language === targetLanguage) {
            return;
        }

        setInterfaceLanguage(language);
        setShowInterfaceLanguagePicker(false);
    };

    const activeTargetOptionId = getActiveTargetLanguageOptionId(targetLanguage);
    const activeTargetOption = TARGET_LANGUAGE_OPTIONS.find((option) => option.id === activeTargetOptionId);

    const handleTargetLanguageSelect = (option) => {
        setShowTargetLanguagePicker(false);
        if (option.id === activeTargetOptionId) {
            return;
        }
        // Chinese is a single option now; a per-script choice can still ride along
        // (option.chineseScript) but the picker no longer sets one — the panel shows
        // both Simplified and Traditional regardless.
        if (option.chineseScript) {
            setChineseScript(option.chineseScript);
        }
        setTargetLanguage(option.targetLanguage);
    };

    const openAuthModal = (mode) => {
        setAuthMode(mode);
        setShowAuthModal(true);
    };

    const openNameEditor = () => {
        setDraftName(displayName === t('profile.defaultName') ? '' : displayName);
        setShowNameEditor(true);
    };

    const openLink = (url) => {
        Linking.openURL(url).catch(() => {
            Alert.alert('', t('profile.linkUnavailable'));
        });
    };

    const openContactModal = () => {
        setEmailCopied(false);
        setShowContactModal(true);
    };

    const handleCopyEmail = async () => {
        try {
            await Clipboard.setStringAsync(CONTACT_EMAIL);
            setEmailCopied(true);
        } catch (error) {
            Alert.alert('', t('profile.linkUnavailable'));
        }
    };

    const handleSaveName = async () => {
        const nextName = draftName.trim();
        if (!nextName) {
            Alert.alert(t('profile.usernameRequiredTitle'), t('profile.usernameRequiredBody'));
            return;
        }

        if (!updateUsername) {
            Alert.alert(t('profile.usernameUnavailableTitle'), t('profile.usernameUnavailableBody'));
            return;
        }

        setIsSavingName(true);
        try {
            await updateUsername(nextName);
            setShowNameEditor(false);
        } catch (error) {
            Alert.alert(t('profile.saveFailed'), error?.message || t('profile.preferenceSoon'));
        } finally {
            setIsSavingName(false);
        }
    };

    const appearanceModes = [
        { key: 'light', label: t('profile.light'), selected: !isDarkMode, onPress: () => setIsDarkMode(false) },
        { key: 'dark', label: t('profile.dark'), selected: isDarkMode, onPress: () => setIsDarkMode(true) },
    ];

    return (
        <Screen
            backgroundColor={profileColors.bg}
            contentContainerStyle={styles.screenContent}
        >
            <ScrollView
                style={styles.pageScroller}
                contentContainerStyle={styles.pageScrollerContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
            >
                <View style={styles.topBar}>
                    <TouchableOpacity
                        onPress={goBack}
                        style={styles.backButton}
                        accessibilityRole="button"
                        accessibilityLabel={t('common.back')}
                    >
                        <Feather name={rtlIcon('chevron-left')} size={24} color={profileColors.inkSlate} />
                    </TouchableOpacity>
                </View>

                <View style={styles.profileHeader}>
                    <ProfileAvatar user={user} size={56} />
                    <View style={styles.profileIdentity}>
                        <Text style={styles.profileName} numberOfLines={1}>{displayName}</Text>
                        <Text style={styles.profileSubtitle} numberOfLines={1}>{identitySubtitle}</Text>
                    </View>
                    {!isGuest ? (
                        <TouchableOpacity
                            accessibilityRole="button"
                            accessibilityLabel={t('profile.editUsername')}
                            activeOpacity={0.78}
                            onPress={openNameEditor}
                            style={styles.editUsernameButton}
                        >
                            <Feather name="edit-2" size={16} color={profileColors.sub} />
                        </TouchableOpacity>
                    ) : null}
                </View>

                <Text style={styles.sectionLabel}>{t('profile.sectionLearning')}</Text>
                <View style={styles.card}>
                    <NavRow
                        icon="book"
                        label={t('profile.learningLanguage')}
                        value={activeTargetOption?.label}
                        valueStyle={styles.rowValueGlyph}
                        onPress={() => setShowTargetLanguagePicker(true)}
                        styles={styles}
                        profileColors={profileColors}
                    />
                    {showVocabRow ? (
                        <NavRow
                            icon="bar-chart-2"
                            label={t('profile.vocabLevel')}
                            value={vocabEstimate}
                            onPress={() => setShowVocabLevel(true)}
                            showDivider
                            styles={styles}
                            profileColors={profileColors}
                        />
                    ) : null}
                    <NavRow
                        icon="globe"
                        label={t('profile.interfaceLanguage')}
                        value={getInterfaceLanguageLabel(interfaceLanguage)}
                        valueStyle={styles.rowValueStrong}
                        onPress={() => setShowInterfaceLanguagePicker(true)}
                        showDivider
                        styles={styles}
                        profileColors={profileColors}
                    />
                </View>

                <Text style={styles.sectionLabel}>{t('profile.sectionApp')}</Text>
                <View style={styles.card}>
                    <View style={styles.row}>
                        <Feather name="moon" size={18} color={profileColors.body} />
                        <Text style={[styles.rowLabel, styles.rowLabelFlex]} numberOfLines={1}>{t('profile.appearance')}</Text>
                        <View style={styles.segmentControl} accessibilityRole="radiogroup" accessibilityLabel={t('profile.appearance')}>
                            {appearanceModes.map((mode) => (
                                <Pressable
                                    key={mode.key}
                                    accessibilityRole="radio"
                                    accessibilityState={{ selected: mode.selected }}
                                    onPress={mode.onPress}
                                    hitSlop={{ top: 6, bottom: 6 }}
                                    style={[styles.segmentButton, mode.selected && styles.segmentButtonActive]}
                                >
                                    <Text style={[styles.segmentText, mode.selected && styles.segmentTextActive]}>
                                        {mode.label}
                                    </Text>
                                </Pressable>
                            ))}
                        </View>
                    </View>
                </View>

                {/* Shown to everyone, guests included: the privacy policy and a way to
                    reach us shouldn't require an account. */}
                <Text style={styles.sectionLabel}>{t('profile.about')}</Text>
                <View style={styles.card}>
                    <NavRow
                        label={t('profile.privacyPolicy')}
                        onPress={() => openLink(PRIVACY_POLICY_URL)}
                        trailingIcon="external-link"
                        styles={styles}
                        profileColors={profileColors}
                    />
                    <NavRow
                        label={t('profile.termsOfService')}
                        onPress={() => openLink(TERMS_OF_SERVICE_URL)}
                        trailingIcon="external-link"
                        showDivider
                        styles={styles}
                        profileColors={profileColors}
                    />
                    <NavRow
                        label={t('profile.contact')}
                        onPress={openContactModal}
                        trailingIcon="mail"
                        showDivider
                        styles={styles}
                        profileColors={profileColors}
                    />
                </View>

                {isGuest ? (
                    <View style={styles.accountActions}>
                        <TouchableOpacity
                            activeOpacity={0.86}
                            onPress={() => openAuthModal('signin')}
                            style={[styles.accountButton, styles.accountButtonSecondary]}
                            accessibilityRole="button"
                        >
                            <Text style={styles.accountButtonSecondaryText}>{t('profile.signIn')}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            activeOpacity={0.86}
                            onPress={() => openAuthModal('signup')}
                            style={[styles.accountButton, styles.accountButtonPrimary]}
                            accessibilityRole="button"
                        >
                            <Text style={styles.accountButtonPrimaryText}>{t('auth.createAccount')}</Text>
                        </TouchableOpacity>
                    </View>
                ) : (
                    <View style={styles.accountColumn}>
                        <TouchableOpacity
                            activeOpacity={0.86}
                            onPress={() => setShowSignOutModal(true)}
                            disabled={isSigningOut}
                            style={[styles.accountButton, styles.accountButtonSecondary, isSigningOut && styles.buttonDisabled]}
                            accessibilityRole="button"
                        >
                            <Text style={styles.logoutText}>
                                {isSigningOut ? t('profile.loggingOut') : t('profile.logout')}
                            </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            accessibilityRole="button"
                            activeOpacity={0.7}
                            onPress={() => setShowDeleteModal(true)}
                            disabled={isDeletingAccount}
                            style={[styles.deleteAccountButton, isDeletingAccount && styles.buttonDisabled]}
                        >
                            <Text style={styles.deleteAccountText}>
                                {isDeletingAccount ? t('profile.deletingAccount') : t('profile.deleteAccount')}
                            </Text>
                        </TouchableOpacity>
                    </View>
                )}
            </ScrollView>

            <VocabLevelModal visible={showVocabLevel} onClose={() => setShowVocabLevel(false)} />

            <OptionSheet
                visible={showTargetLanguagePicker}
                onClose={() => setShowTargetLanguagePicker(false)}
                title={t('profile.learningLanguage')}
                note={t('profile.learningLanguageDesc')}
                rowHeight={54}
                options={TARGET_LANGUAGE_OPTIONS.map((option) => ({
                    key: option.id,
                    label: option.label,
                    fontFamily: fontFamilies.krSerifSemiBold,
                }))}
                selectedKey={activeTargetOptionId}
                onSelect={(key) => {
                    const option = TARGET_LANGUAGE_OPTIONS.find((item) => item.id === key);
                    if (option) handleTargetLanguageSelect(option);
                }}
            />

            <OptionSheet
                visible={showInterfaceLanguagePicker}
                onClose={() => setShowInterfaceLanguagePicker(false)}
                title={t('profile.interfaceLanguage')}
                note={t('profile.interfaceLanguageDesc')}
                footnote={t('profile.translationDisclaimer')}
                rowHeight={44}
                options={interfaceLanguageOptions.map((option) => ({
                    key: option.code,
                    label: option.label,
                    disabled: option.code === targetLanguage,
                }))}
                selectedKey={interfaceLanguage}
                onSelect={handleInterfaceLanguageSelect}
            />

            <Modal
                visible={showContactModal}
                animationType="fade"
                transparent
                onRequestClose={() => setShowContactModal(false)}
            >
                <TouchableWithoutFeedback onPress={() => setShowContactModal(false)}>
                    <View style={styles.modalBackdrop}>
                        <TouchableWithoutFeedback>
                            <View style={styles.modalCard}>
                                <Text style={styles.modalTitle}>{t('profile.contact')}</Text>
                                <Text style={styles.modalHelper}>{t('profile.contactBody')}</Text>
                                <Pressable onPress={handleCopyEmail} style={styles.contactEmailField}>
                                    <Text style={styles.contactEmailText} selectable>{CONTACT_EMAIL}</Text>
                                    <Feather
                                        name={emailCopied ? 'check' : 'copy'}
                                        size={18}
                                        color={emailCopied ? profileColors.accent : profileColors.sub}
                                    />
                                </Pressable>
                                <View style={styles.modalActions}>
                                    <Pressable
                                        onPress={() => setShowContactModal(false)}
                                        style={styles.modalButton}
                                    >
                                        <Text style={styles.modalButtonText}>{t('common.close')}</Text>
                                    </Pressable>
                                    <Pressable
                                        onPress={handleCopyEmail}
                                        style={[styles.modalButton, styles.modalPrimaryButton]}
                                    >
                                        <Text style={[styles.modalButtonText, styles.modalPrimaryButtonText]}>
                                            {emailCopied ? t('profile.emailCopied') : t('profile.copyEmail')}
                                        </Text>
                                    </Pressable>
                                </View>
                            </View>
                        </TouchableWithoutFeedback>
                    </View>
                </TouchableWithoutFeedback>
            </Modal>

            <AuthModal
                visible={showAuthModal}
                mode={authMode}
                onClose={() => setShowAuthModal(false)}
                onAuthenticated={() => setShowAuthModal(false)}
            />

            <Modal
                visible={showNameEditor}
                animationType="fade"
                transparent
                onRequestClose={() => setShowNameEditor(false)}
            >
                <TouchableWithoutFeedback onPress={() => setShowNameEditor(false)}>
                    <View style={styles.modalBackdrop}>
                        <TouchableWithoutFeedback>
                            <View style={styles.modalCard}>
                                <Text style={styles.modalTitle}>{t('profile.editUsernameTitle')}</Text>
                                <TextInput
                                    value={draftName}
                                    onChangeText={setDraftName}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    editable={!isSavingName}
                                    placeholder={t('profile.usernamePlaceholder')}
                                    placeholderTextColor={profileColors.faint}
                                    style={styles.usernameInput}
                                />
                                <View style={styles.modalActions}>
                                    <Pressable
                                        onPress={() => setShowNameEditor(false)}
                                        style={styles.modalButton}
                                        disabled={isSavingName}
                                    >
                                        <Text style={styles.modalButtonText}>{t('common.cancel')}</Text>
                                    </Pressable>
                                    <Pressable
                                        onPress={handleSaveName}
                                        style={[
                                            styles.modalButton,
                                            styles.modalPrimaryButton,
                                            isSavingName && styles.buttonDisabled,
                                        ]}
                                        disabled={isSavingName}
                                    >
                                        <Text style={[styles.modalButtonText, styles.modalPrimaryButtonText]}>
                                            {isSavingName ? t('common.working') : t('common.save')}
                                        </Text>
                                    </Pressable>
                                </View>
                            </View>
                        </TouchableWithoutFeedback>
                    </View>
                </TouchableWithoutFeedback>
            </Modal>

            <Modal
                visible={showSignOutModal}
                animationType="fade"
                transparent
                onRequestClose={() => setShowSignOutModal(false)}
            >
                <TouchableWithoutFeedback onPress={() => setShowSignOutModal(false)}>
                    <View style={styles.modalBackdrop}>
                        <TouchableWithoutFeedback>
                            <View style={styles.modalCard}>
                                <Text style={styles.modalTitle}>{t('profile.logoutTitle')}</Text>
                                <Text style={styles.modalHelper}>
                                    {t('profile.logoutBody')}
                                </Text>
                                <View style={styles.modalActions}>
                                    <Pressable
                                        onPress={() => setShowSignOutModal(false)}
                                        style={styles.modalButton}
                                    >
                                        <Text style={styles.modalButtonText}>{t('common.cancel')}</Text>
                                    </Pressable>
                                    <Pressable
                                        onPress={() => performSignOut()}
                                        style={[styles.modalButton, styles.modalPrimaryButton]}
                                    >
                                        <Text style={[styles.modalButtonText, styles.modalPrimaryButtonText]}>
                                            {t('profile.logout')}
                                        </Text>
                                    </Pressable>
                                </View>
                            </View>
                        </TouchableWithoutFeedback>
                    </View>
                </TouchableWithoutFeedback>
            </Modal>

            <Modal
                visible={showDeleteModal}
                animationType="fade"
                transparent
                onRequestClose={() => (isDeletingAccount ? null : setShowDeleteModal(false))}
            >
                <TouchableWithoutFeedback onPress={() => (isDeletingAccount ? null : setShowDeleteModal(false))}>
                    <View style={styles.modalBackdrop}>
                        <TouchableWithoutFeedback>
                            <View style={styles.modalCard}>
                                <Text style={styles.modalTitle}>{t('profile.deleteAccountTitle')}</Text>
                                <Text style={styles.modalHelper}>
                                    {t('profile.deleteAccountBody')}
                                </Text>
                                <View style={styles.modalActions}>
                                    <Pressable
                                        onPress={() => setShowDeleteModal(false)}
                                        style={styles.modalButton}
                                        disabled={isDeletingAccount}
                                    >
                                        <Text style={styles.modalButtonText}>{t('common.cancel')}</Text>
                                    </Pressable>
                                    <Pressable
                                        onPress={() => performDeleteAccount()}
                                        style={[
                                            styles.modalButton,
                                            styles.modalDangerButton,
                                            isDeletingAccount && styles.buttonDisabled,
                                        ]}
                                        disabled={isDeletingAccount}
                                    >
                                        <Text style={[styles.modalButtonText, styles.modalDangerButtonText]}>
                                            {isDeletingAccount ? t('profile.deletingAccount') : t('profile.deleteAccountConfirm')}
                                        </Text>
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

const createStyles = (profileColors, themeColors) => StyleSheet.create({
    screenContent: {
        flex: 1,
        paddingHorizontal: 0,
        paddingTop: 0,
        paddingBottom: 0,
        backgroundColor: profileColors.bg,
    },
    pageScroller: {
        flex: 1,
        width: '100%',
    },
    pageScrollerContent: {
        flexGrow: 1,
        paddingBottom: 32,
    },
    topBar: {
        paddingTop: 4,
        paddingHorizontal: 8,
        flexDirection: 'row',
        alignItems: 'center',
    },
    backButton: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    profileHeader: {
        paddingHorizontal: 20,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
    },
    avatar: {
        width: 56,
        height: 56,
        borderRadius: 28,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: profileColors.inkSlate,
    },
    avatarInitial: {
        fontFamily: fontFamilies.displaySemiBold,
        fontSize: 24,
        lineHeight: 30,
        color: profileColors.white,
    },
    profileIdentity: {
        flex: 1,
        minWidth: 0,
        gap: 2,
    },
    profileName: {
        width: '100%',
        fontFamily: fontFamilies.displaySemiBold,
        fontSize: 24,
        lineHeight: 30,
        color: profileColors.ink,
    },
    profileSubtitle: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 14,
        lineHeight: 19,
        color: profileColors.body,
    },
    editUsernameButton: {
        width: 44,
        height: 44,
        borderRadius: radii.pill,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: profileColors.border,
        backgroundColor: profileColors.surface,
    },
    sectionLabel: {
        marginTop: 22,
        marginBottom: 8,
        marginHorizontal: 20,
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 13,
        lineHeight: 18,
        color: profileColors.sub,
    },
    card: {
        marginHorizontal: 16,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: profileColors.border,
        backgroundColor: profileColors.surface,
        overflow: 'hidden',
    },
    row: {
        minHeight: 54,
        paddingHorizontal: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    rowDivider: {
        height: 1,
        marginLeft: 16,
        backgroundColor: profileColors.border,
    },
    rowLabel: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 15,
        lineHeight: 20,
        color: profileColors.ink,
    },
    rowLabelFlex: {
        flex: 1,
        minWidth: 0,
    },
    rowValue: {
        maxWidth: '45%',
        fontFamily: fontFamilies.sansRegular,
        fontSize: 14,
        lineHeight: 20,
        color: profileColors.body,
    },
    rowValueStrong: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 15,
        color: profileColors.ink,
    },
    rowValueGlyph: {
        fontFamily: fontFamilies.krSerifSemiBold,
        fontSize: 15,
        color: profileColors.ink,
    },
    segmentControl: {
        flexDirection: 'row',
        padding: 3,
        borderRadius: 10,
        backgroundColor: profileColors.muted,
    },
    segmentButton: {
        height: 32,
        paddingHorizontal: 14,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    segmentButtonActive: {
        backgroundColor: profileColors.surface,
        shadowColor: themeColors.text,
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.12,
        shadowRadius: 3,
        elevation: 1,
    },
    segmentText: {
        fontFamily: fontFamilies.sansMedium,
        fontSize: 14,
        color: profileColors.body,
    },
    segmentTextActive: {
        fontFamily: fontFamilies.sansSemiBold,
        color: profileColors.ink,
    },
    accountActions: {
        marginTop: 18,
        marginHorizontal: 16,
        flexDirection: 'row',
        gap: 8,
    },
    accountColumn: {
        marginTop: 18,
        marginHorizontal: 16,
        gap: 8,
    },
    accountButton: {
        flex: 1,
        minHeight: 48,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 14,
    },
    accountButtonSecondary: {
        borderWidth: 1,
        borderColor: profileColors.hardBorder,
        backgroundColor: profileColors.surface,
    },
    accountButtonPrimary: {
        backgroundColor: profileColors.inkSlate,
    },
    accountButtonSecondaryText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 15,
        color: profileColors.ink,
    },
    accountButtonPrimaryText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 15,
        color: profileColors.white,
    },
    buttonDisabled: {
        opacity: 0.6,
    },
    logoutText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 15,
        color: profileColors.danger,
    },
    deleteAccountButton: {
        minHeight: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    deleteAccountText: {
        fontFamily: fontFamilies.sansMedium,
        fontSize: 14,
        color: profileColors.danger,
    },
    modalBackdrop: {
        flex: 1,
        backgroundColor: themeColors.overlay,
        justifyContent: 'center',
        paddingHorizontal: spacing.lg,
    },
    modalCard: {
        backgroundColor: themeColors.surfaceElevated,
        borderRadius: 20,
        padding: 20,
        gap: spacing.md,
    },
    modalTitle: {
        fontFamily: fontFamilies.displaySemiBold,
        fontSize: 21,
        lineHeight: 28,
        color: profileColors.ink,
    },
    modalHelper: {
        ...textStyles.bodyMuted,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 14,
        lineHeight: 20,
        color: profileColors.body,
    },
    contactEmailField: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        minHeight: 48,
        paddingHorizontal: spacing.md,
        borderWidth: 1,
        borderColor: profileColors.hardBorder,
        borderRadius: 14,
        backgroundColor: profileColors.surface,
    },
    contactEmailText: {
        flex: 1,
        minWidth: 0,
        fontFamily: fontFamilies.sansMedium,
        fontSize: 15,
        lineHeight: 20,
        color: profileColors.ink,
    },
    modalActions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: spacing.sm,
    },
    modalButton: {
        minWidth: 88,
        minHeight: 44,
        borderRadius: 12,
        paddingHorizontal: spacing.md,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: profileColors.hardBorder,
        backgroundColor: profileColors.surface,
    },
    modalPrimaryButton: {
        borderColor: profileColors.inkSlate,
        backgroundColor: profileColors.inkSlate,
    },
    modalDangerButton: {
        borderColor: profileColors.danger,
        backgroundColor: profileColors.danger,
    },
    usernameInput: {
        minHeight: 48,
        borderWidth: 1,
        borderColor: profileColors.hardBorder,
        borderRadius: 14,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        backgroundColor: profileColors.surface,
        color: profileColors.ink,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 15,
        lineHeight: 20,
    },
    modalButtonText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 15,
        color: themeColors.text,
    },
    modalPrimaryButtonText: {
        color: profileColors.white,
    },
    modalDangerButtonText: {
        color: profileColors.white,
    },
});

export default Profile;
