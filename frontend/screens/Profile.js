import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert,
    Animated,
    Linking,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import Auth from './Auth';
import { deleteCurrentUserProfile } from '../services/accountDeletion';
import { getReaderLevel } from '../services/Database';
import { tapSelect } from '../services/haptics';
import { getVocabTiers, hasVocabSizeGrid } from '../services/vocabSizeLevels';
import { hasWordCheck } from '../services/wordCheck';
import { PaperButton, PaperSheet, PaperTabs, PressableScale, Screen } from '../components/ui';
import VocabLevelModal, { tierIndexForTheta } from '../components/shared/VocabLevelModal';
import WordCheckModal from '../components/shared/WordCheckModal';
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
import { fontFamilies, useTheme } from '../theme';
import { springs, springTo, useReducedMotion } from '../theme/motion';

// ─── Profile (Paper redesign) ─────────────────────────────────────────────────
//
// Paper ground, ink type, hairline rows instead of cards. The page leads with
// who you are and how much of your target language you know (the level
// engine's estimate, with its uncertainty drawn as a band), then settings.
// Every tappable row answers on press-in; switches, the appearance underline
// and the level marker move on critically damped springs.

const GUTTER = 24;
const APP_VERSION = Constants.expoConfig?.version ?? null;

const getInitial = (name) => {
    const trimmed = String(name || '').trim();
    return trimmed ? trimmed.charAt(0).toUpperCase() : 'R';
};

const clamp01 = (value) => Math.max(0, Math.min(1, value));

// New strings fall back to their English text until translations.js has them.
const useCopy = (t) => useCallback((key, english, params = {}) => {
    const value = t(key, params);
    if (value !== key) return value;
    return english.replace(/\{\{(\w+)\}\}/g, (_, name) => (params[name] == null ? '' : String(params[name])));
}, [t]);

const tierTickLabel = (tier, t) => {
    if (tier.advanced) return t('vocabLevel.advancedTier');
    if (tier.label) return tier.label;
    return Number(tier.threshold).toLocaleString();
};

// ─── Small pieces ─────────────────────────────────────────────────────────────

const SWITCH_WIDTH = 46;
const SWITCH_HEIGHT = 28;
const SWITCH_THUMB = 20;
const SWITCH_INSET = 4;
const SWITCH_TRAVEL = SWITCH_WIDTH - SWITCH_THUMB - SWITCH_INSET * 2 - 2;

/**
 * PaperSwitch — the visual only (the whole row is the control). Off: a
 * hairline outline with a muted thumb. On: ink fill with a paper thumb.
 * The thumb springs across; colours cross-fade on the native driver.
 */
const PaperSwitch = ({ value, colors, reduced }) => {
    const progress = useRef(new Animated.Value(value ? 1 : 0)).current;

    useEffect(() => {
        if (reduced) {
            progress.setValue(value ? 1 : 0);
            return;
        }
        springTo(progress, value ? 1 : 0, { spring: springs.snappy }).start();
    }, [progress, reduced, value]);

    const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [0, SWITCH_TRAVEL] });

    return (
        <View
            style={[switchStyles.track, { borderColor: colors.borderStrong }]}
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
        >
            <Animated.View style={[switchStyles.fill, { backgroundColor: colors.inkSlate, opacity: progress }]} />
            <Animated.View style={[switchStyles.thumb, { transform: [{ translateX }] }]}>
                <View style={[switchStyles.thumbFace, { backgroundColor: colors.textMuted }]} />
                <Animated.View style={[switchStyles.thumbFace, { backgroundColor: colors.onInk, opacity: progress }]} />
            </Animated.View>
        </View>
    );
};

const switchStyles = StyleSheet.create({
    track: {
        width: SWITCH_WIDTH,
        height: SWITCH_HEIGHT,
        borderRadius: SWITCH_HEIGHT / 2,
        borderWidth: 1,
        justifyContent: 'center',
        overflow: 'hidden',
    },
    fill: {
        ...StyleSheet.absoluteFillObject,
        borderRadius: SWITCH_HEIGHT / 2,
    },
    thumb: {
        width: SWITCH_THUMB,
        height: SWITCH_THUMB,
        marginLeft: SWITCH_INSET - 1,
    },
    thumbFace: {
        ...StyleSheet.absoluteFillObject,
        borderRadius: SWITCH_THUMB / 2,
    },
});

/** A hairline settings row. Highlights the instant a finger lands. */
const RowPressable = ({ children, styles, style, ...rest }) => (
    <Pressable
        {...rest}
        style={({ pressed }) => [styles.rowPressable, pressed && styles.rowPressed, style]}
    >
        <View style={styles.rowInner}>{children}</View>
    </Pressable>
);

const NavRow = ({ label, value, onPress, icon = 'chevron-right', tone, disabled, styles, colors }) => (
    <RowPressable
        styles={styles}
        onPress={onPress}
        disabled={disabled}
        style={disabled ? styles.rowDisabled : null}
        accessibilityRole="button"
        accessibilityLabel={value ? `${label}, ${value}` : label}
        accessibilityState={{ disabled: !!disabled }}
    >
        <Text style={[styles.rowLabel, styles.rowLabelFlex, tone === 'danger' && { color: colors.danger }]}>{label}</Text>
        {value ? <Text style={styles.rowValue} numberOfLines={1}>{value}</Text> : null}
        {icon ? <Feather name={icon} size={18} color={colors.textSubtle} /> : null}
    </RowPressable>
);

const SwitchRow = ({ label, description, value, onValueChange, styles, colors, reduced }) => (
    <RowPressable
        styles={styles}
        onPress={() => {
            tapSelect();
            onValueChange(!value);
        }}
        accessibilityRole="switch"
        accessibilityLabel={label}
        accessibilityHint={description || undefined}
        accessibilityState={{ checked: !!value }}
    >
        <View style={styles.rowCopy}>
            <Text style={styles.rowLabel}>{label}</Text>
            {description ? <Text style={styles.rowDescription}>{description}</Text> : null}
        </View>
        <PaperSwitch value={!!value} colors={colors} reduced={reduced} />
    </RowPressable>
);

/**
 * TextRadioGroup — options as plain words; the chosen one is bold with a
 * tint underline that springs to it from wherever it is.
 */
const TextRadioGroup = ({ options, value, onChange, label, colors, styles, reduced }) => {
    const [layouts, setLayouts] = useState({});
    const x = useRef(new Animated.Value(0)).current;
    const width = useRef(new Animated.Value(0)).current;
    const placed = useRef(false);

    useEffect(() => {
        const box = layouts[value];
        if (!box) return;
        if (!placed.current || reduced) {
            x.setValue(box.x);
            width.setValue(box.width);
            placed.current = true;
            return;
        }
        Animated.parallel([
            springTo(x, box.x, { spring: springs.snappy, useNativeDriver: false }),
            springTo(width, box.width, { spring: springs.snappy, useNativeDriver: false }),
        ]).start();
    }, [layouts, reduced, value, width, x]);

    return (
        <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.radioGroup}>
            {options.map((option) => {
                const selected = option.key === value;
                return (
                    <Pressable
                        key={option.key}
                        accessibilityRole="radio"
                        accessibilityLabel={option.label}
                        accessibilityState={{ checked: selected, selected }}
                        hitSlop={{ left: 8, right: 8 }}
                        onPress={() => {
                            if (selected) return;
                            tapSelect();
                            onChange(option.key);
                        }}
                        onLayout={(event) => {
                            const { x: left, width: w } = event.nativeEvent.layout;
                            setLayouts((previous) => (
                                previous[option.key]?.x === left && previous[option.key]?.width === w
                                    ? previous
                                    : { ...previous, [option.key]: { x: left, width: w } }
                            ));
                        }}
                        style={styles.radioOption}
                    >
                        {({ pressed }) => (
                            <Text
                                style={[
                                    styles.radioText,
                                    selected ? styles.radioTextSelected : null,
                                    pressed && !selected ? styles.pressedText : null,
                                ]}
                            >
                                {option.label}
                            </Text>
                        )}
                    </Pressable>
                );
            })}
            <Animated.View
                pointerEvents="none"
                style={[styles.radioUnderline, { backgroundColor: colors.tint, left: x, width }]}
            />
        </View>
    );
};

/**
 * LevelScale — the estimate on a simple line from the easiest tier to the
 * hardest: an ink fill up to a tint marker, and a soft tint band for ±1 sd
 * (how sure the engine is). Decorative for screen readers; the sentence
 * above it says the same thing in words.
 */
const LevelScale = ({ view, colors, styles, reduced }) => {
    const known = view.fraction != null;
    const position = useRef(new Animated.Value(view.fraction ?? 0)).current;
    const bandFrom = useRef(new Animated.Value(view.bandFrom ?? 0)).current;
    const bandWidth = useRef(new Animated.Value((view.bandTo ?? 0) - (view.bandFrom ?? 0))).current;

    useEffect(() => {
        if (!known) return;
        const targets = [
            [position, view.fraction],
            [bandFrom, view.bandFrom],
            [bandWidth, view.bandTo - view.bandFrom],
        ];
        if (reduced) {
            targets.forEach(([value, to]) => value.setValue(to));
            return;
        }
        Animated.parallel(targets.map(([value, to]) => (
            springTo(value, to, { spring: springs.move, useNativeDriver: false })
        ))).start();
    }, [bandFrom, bandWidth, known, position, reduced, view.bandFrom, view.bandTo, view.fraction]);

    const percent = (value) => value.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'], extrapolate: 'clamp' });

    return (
        <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={styles.scale}>
            <View style={styles.scaleTrackArea}>
                <View style={[styles.scaleTrack, { backgroundColor: colors.border }]} />
                {known ? (
                    <>
                        <Animated.View
                            style={[styles.scaleBand, { backgroundColor: colors.tintSoft, left: percent(bandFrom), width: percent(bandWidth) }]}
                        />
                        <Animated.View style={[styles.scaleFill, { backgroundColor: colors.inkSlate, width: percent(position) }]} />
                        <Animated.View
                            style={[
                                styles.scaleMarker,
                                { backgroundColor: colors.tint, borderColor: colors.bgPage, left: percent(position) },
                            ]}
                        />
                    </>
                ) : null}
            </View>
            <View style={styles.scaleTicks}>
                {view.ticks.map((tick, index) => {
                    const first = index === 0;
                    const last = index === view.ticks.length - 1;
                    const placement = first
                        ? { left: 0, textAlign: 'left' }
                        : last
                            ? { right: 0, textAlign: 'right' }
                            : { left: `${tick.fraction * 100}%`, marginLeft: -40, width: 80, textAlign: 'center' };
                    return (
                        <Text key={tick.key} style={[styles.scaleTick, placement]} numberOfLines={1}>
                            {tick.label}
                        </Text>
                    );
                })}
            </View>
        </View>
    );
};

/** A centred Paper dialog for short tasks (confirmations, a name, sign-in). */
const PaperDialog = ({ visible, onRequestClose, onScrimPress, closeLabel, styles, reduced, cardStyle, children }) => {
    const scale = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        if (!visible || reduced) return;
        scale.setValue(0.96);
        springTo(scale, 1, { spring: springs.standard }).start();
    }, [reduced, scale, visible]);

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onRequestClose}>
            <View style={styles.dialogBackdrop}>
                <Pressable
                    style={StyleSheet.absoluteFill}
                    onPress={onScrimPress ?? onRequestClose}
                    accessibilityRole="button"
                    accessibilityLabel={closeLabel}
                />
                <Animated.View
                    accessibilityViewIsModal
                    style={[styles.dialogCard, cardStyle, { transform: [{ scale }] }]}
                >
                    {children}
                </Animated.View>
            </View>
        </Modal>
    );
};

const OptionRow = ({ label, selected, disabled, onPress, styles, colors }) => (
    <Pressable
        accessibilityRole="radio"
        accessibilityState={{ checked: selected, selected, disabled }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [styles.optionRow, pressed && styles.rowPressed, disabled && styles.optionDisabled]}
    >
        <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{label}</Text>
        {selected ? <Feather name="check" size={18} color={colors.tint} /> : null}
    </Pressable>
);

// ─── Screen ───────────────────────────────────────────────────────────────────

const Profile = ({ user, signOut, updateUsername }) => {
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
    const [showWordCheck, setShowWordCheck] = useState(false);
    const [level, setLevel] = useState(null);
    const [levelLoaded, setLevelLoaded] = useState(false);
    const {
        activeProfileId,
        interfaceLanguage,
        setInterfaceLanguage,
        targetLanguage,
        setTargetLanguage,
        chineseScript,
        setChineseScript,
        isDarkMode,
        setIsDarkMode,
        notificationsEnabled,
        setNotificationsEnabled,
        personalizedVocabEnabled,
        setPersonalizedVocabEnabled,
    } = useAppContext();
    const { activeOwnerId } = useLocalOwner();
    const theme = useTheme();
    const colors = theme.colors;
    const safeInsets = useSafeAreaInsets();
    const reduced = useReducedMotion();
    const styles = useMemo(() => createStyles(colors, safeInsets.bottom), [colors, safeInsets.bottom]);
    const { t } = useTranslation();
    const copy = useCopy(t);
    const isAnonymous = Boolean(user?.is_anonymous);
    const isGuest = !user?.id || isAnonymous;

    const displayName = useMemo(() => {
        const metadataName = user?.user_metadata?.username
            || user?.user_metadata?.display_name
            || user?.user_metadata?.name;

        if (metadataName && String(metadataName).trim()) {
            return String(metadataName).trim();
        }

        return 'Reader';
    }, [user?.user_metadata]);

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

    // ── Level estimate ──────────────────────────────────────────────────────
    // Read from the level engine whenever the tab comes into view and after
    // the picker or the word check closes (both save before closing).
    const levelRequestRef = useRef(0);
    const loadLevel = useCallback(async () => {
        const request = levelRequestRef.current + 1;
        levelRequestRef.current = request;
        let next = null;
        try {
            next = await getReaderLevel({ ownerId: activeOwnerId, profileId: activeProfileId, language: targetLanguage });
        } catch {
            next = null;
        }
        if (levelRequestRef.current !== request) return;
        setLevel(next);
        setLevelLoaded(true);
    }, [activeOwnerId, activeProfileId, targetLanguage]);

    // Another language or profile: don't show the old estimate on new tiers.
    useEffect(() => {
        setLevelLoaded(false);
        setLevel(null);
    }, [activeOwnerId, activeProfileId, targetLanguage]);

    useFocusEffect(useCallback(() => {
        loadLevel();
        return () => {
            // Drop a read still in flight when the tab loses focus.
            levelRequestRef.current += 1;
        };
    }, [loadLevel]));

    const tiers = useMemo(() => getVocabTiers(targetLanguage), [targetLanguage]);
    const hasGrid = hasVocabSizeGrid(targetLanguage);
    const canCheck = hasWordCheck(targetLanguage);

    const levelView = useMemo(() => {
        if (!tiers.length) return null;
        const minTheta = Number(tiers[0].theta);
        const maxTheta = Number(tiers[tiers.length - 1].theta);
        const span = Math.max(1e-6, maxTheta - minTheta);
        const toFraction = (theta) => clamp01((Number(theta) - minTheta) / span);

        // Four labels spread along the line, each at its tier's real place.
        const tickIndexes = [];
        [0, 1 / 3, 2 / 3, 1].forEach((share) => {
            const target = minTheta + share * span;
            let best = 0;
            tiers.forEach((tier, index) => {
                if (Math.abs(Number(tier.theta) - target) < Math.abs(Number(tiers[best].theta) - target)) best = index;
            });
            if (!tickIndexes.includes(best)) tickIndexes.push(best);
        });
        const ticks = tickIndexes.map((index) => ({
            key: String(tiers[index].threshold),
            fraction: toFraction(tiers[index].theta),
            label: tierTickLabel(tiers[index], t),
        }));

        if (!level?.hasRow || !Number.isFinite(Number(level?.theta))) {
            return { ticks, fraction: null, sentence: copy('profile.levelUnknown', 'We don’t know your level yet.'), highlight: null };
        }

        const theta = Number(level.theta);
        const sd = Math.sqrt(Math.max(0, Number(level.variance) || 0));
        const tier = tiers[tierIndexForTheta(tiers, theta) ?? 0];
        let sentence;
        let highlight = null;
        if (tier.label) {
            highlight = tier.label;
            sentence = t('wordCheck.resultHsk', { level: highlight });
        } else if (tier.advanced) {
            sentence = t('wordCheck.resultAdvanced');
        } else {
            highlight = Number(tier.threshold).toLocaleString();
            sentence = t('wordCheck.resultWords', { count: highlight });
        }
        return {
            ticks,
            fraction: toFraction(theta),
            bandFrom: toFraction(theta - sd),
            bandTo: toFraction(theta + sd),
            sentence,
            highlight,
        };
    }, [copy, level, t, tiers]);

    const renderSentence = (view) => {
        const { sentence, highlight } = view;
        const at = highlight ? sentence.indexOf(highlight) : -1;
        if (at < 0) return sentence;
        return [
            sentence.slice(0, at),
            <Text key="estimate" style={styles.levelSentenceAccent}>{highlight}</Text>,
            sentence.slice(at + highlight.length),
        ];
    };

    // ── Actions (unchanged behaviour) ───────────────────────────────────────

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
        setDraftName(displayName === 'Reader' ? '' : displayName);
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

    const closeDeleteModal = () => (isDeletingAccount ? null : setShowDeleteModal(false));
    const languageName = t(`language.${activeTargetOptionId}`);

    return (
        <Screen
            backgroundColor={colors.bgPage}
            contentContainerStyle={styles.screenContent}
        >
            <ScrollView
                style={styles.pageScroller}
                contentContainerStyle={styles.pageScrollerContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
            >
                {/* Who you are */}
                <View style={styles.header}>
                    <View style={styles.avatar} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
                        <Text style={styles.avatarInitial}>{getInitial(displayName)}</Text>
                    </View>
                    <View style={styles.identity}>
                        <Text style={styles.name} numberOfLines={1} accessibilityRole="header">{displayName}</Text>
                        <Text style={styles.status} numberOfLines={1}>{identitySubtitle}</Text>
                    </View>
                    {isGuest ? (
                        <PaperButton
                            variant="secondary"
                            size="md"
                            label={t('profile.signIn')}
                            onPress={() => openAuthModal('signin')}
                            style={styles.headerAction}
                        />
                    ) : (
                        <PaperButton
                            variant="secondary"
                            size="md"
                            label={t('common.edit')}
                            accessibilityLabel={t('profile.editUsername')}
                            onPress={openNameEditor}
                            style={styles.headerAction}
                        />
                    )}
                </View>

                {/* How much you know */}
                <View style={styles.levelSection}>
                    <Text style={styles.eyebrow} accessibilityRole="header">
                        {copy('profile.yourLanguage', 'Your {{language}}', { language: languageName })}
                    </Text>
                    {hasGrid && levelView ? (
                        levelLoaded ? (
                            <>
                                <Text style={styles.levelSentence}>{renderSentence(levelView)}</Text>
                                <LevelScale view={levelView} colors={colors} styles={styles} reduced={reduced} />
                                <Text style={styles.note}>
                                    {levelView.fraction != null
                                        ? copy('profile.levelBandNote', 'The band is how sure we are. It narrows as you read and look words up.')
                                        : t('profile.vocabLevelDesc')}
                                </Text>
                            </>
                        ) : (
                            // Holds the space while the (fast, local) read lands.
                            <View style={styles.levelPlaceholder} />
                        )
                    ) : (
                        <Text style={styles.note}>{t('profile.learningLanguageDesc')}</Text>
                    )}
                    {canCheck || hasGrid ? (
                        <View style={styles.levelActions}>
                            {canCheck ? (
                                <PaperButton
                                    size="md"
                                    label={copy('profile.takeWordCheck', 'Take the word check')}
                                    onPress={() => setShowWordCheck(true)}
                                    style={styles.levelButton}
                                />
                            ) : null}
                            {hasGrid ? (
                                <PaperButton
                                    variant={canCheck ? 'secondary' : 'primary'}
                                    size="md"
                                    label={copy('profile.setLevelMyself', 'Set it myself')}
                                    accessibilityLabel={t('profile.setVocabLevel')}
                                    onPress={() => setShowVocabLevel(true)}
                                    style={styles.levelButton}
                                />
                            ) : null}
                        </View>
                    ) : null}
                </View>

                {/* Settings */}
                <View style={styles.group}>
                    <View style={styles.rowPressable}>
                        <View style={styles.rowInner}>
                            <Text style={[styles.rowLabel, styles.rowLabelFlex]}>{t('profile.appearance')}</Text>
                            <TextRadioGroup
                                label={t('profile.appearance')}
                                value={isDarkMode ? 'dark' : 'light'}
                                onChange={(key) => setIsDarkMode(key === 'dark')}
                                options={[
                                    { key: 'light', label: t('profile.light') },
                                    { key: 'dark', label: t('profile.dark') },
                                ]}
                                colors={colors}
                                styles={styles}
                                reduced={reduced}
                            />
                        </View>
                    </View>
                    <NavRow
                        label={t('profile.learningLanguage')}
                        value={activeTargetOption?.label}
                        onPress={() => setShowTargetLanguagePicker(true)}
                        styles={styles}
                        colors={colors}
                    />
                    <NavRow
                        label={t('profile.interfaceLanguage')}
                        value={getInterfaceLanguageLabel(interfaceLanguage)}
                        onPress={() => setShowInterfaceLanguagePicker(true)}
                        styles={styles}
                        colors={colors}
                    />
                    <SwitchRow
                        label={t('profile.notifications')}
                        value={notificationsEnabled}
                        onValueChange={setNotificationsEnabled}
                        styles={styles}
                        colors={colors}
                        reduced={reduced}
                    />
                    <SwitchRow
                        label={t('profile.personalizedVocab')}
                        description={t('profile.personalizedVocabDesc')}
                        value={personalizedVocabEnabled}
                        onValueChange={setPersonalizedVocabEnabled}
                        styles={styles}
                        colors={colors}
                        reduced={reduced}
                    />
                    {/* Shown to everyone, guests included: a way to reach us
                        shouldn't require an account. */}
                    <NavRow
                        label={t('profile.contact')}
                        onPress={openContactModal}
                        icon="mail"
                        styles={styles}
                        colors={colors}
                    />
                    <View style={styles.groupEnd} />
                </View>

                {!isGuest ? (
                    <View style={styles.group}>
                        <NavRow
                            label={isSigningOut ? t('profile.loggingOut') : t('profile.logout')}
                            onPress={() => setShowSignOutModal(true)}
                            disabled={isSigningOut}
                            icon={null}
                            styles={styles}
                            colors={colors}
                        />
                        <NavRow
                            label={isDeletingAccount ? t('profile.deletingAccount') : t('profile.deleteAccount')}
                            onPress={() => setShowDeleteModal(true)}
                            disabled={isDeletingAccount}
                            icon={null}
                            tone="danger"
                            styles={styles}
                            colors={colors}
                        />
                        <View style={styles.groupEnd} />
                    </View>
                ) : null}

                {/* Privacy policy and terms stay reachable for guests too. */}
                <View style={styles.footer}>
                    <Text style={styles.footerText}>{APP_VERSION ? `Noeul ${APP_VERSION}` : 'Noeul'}</Text>
                    <Text style={styles.footerText}>·</Text>
                    <Pressable
                        accessibilityRole="link"
                        onPress={() => openLink(PRIVACY_POLICY_URL)}
                        hitSlop={{ left: 6, right: 6 }}
                        style={styles.footerLinkHit}
                    >
                        {({ pressed }) => (
                            <Text style={[styles.footerLink, pressed && styles.pressedText]}>{t('profile.privacyPolicy')}</Text>
                        )}
                    </Pressable>
                    <Text style={styles.footerText}>·</Text>
                    <Pressable
                        accessibilityRole="link"
                        onPress={() => openLink(TERMS_OF_SERVICE_URL)}
                        hitSlop={{ left: 6, right: 6 }}
                        style={styles.footerLinkHit}
                    >
                        {({ pressed }) => (
                            <Text style={[styles.footerLink, pressed && styles.pressedText]}>{t('profile.termsOfService')}</Text>
                        )}
                    </Pressable>
                </View>
            </ScrollView>

            <VocabLevelModal
                visible={showVocabLevel}
                onClose={() => {
                    setShowVocabLevel(false);
                    loadLevel();
                }}
            />

            <WordCheckModal
                visible={showWordCheck}
                onClose={() => {
                    setShowWordCheck(false);
                    loadLevel();
                }}
            />

            {/* Learning language */}
            <PaperSheet
                visible={showTargetLanguagePicker}
                onClose={() => setShowTargetLanguagePicker(false)}
                accessibilityLabel={t('profile.learningLanguage')}
            >
                <View style={styles.sheetBody}>
                    <Text style={styles.sheetTitle} accessibilityRole="header">{t('profile.learningLanguage')}</Text>
                    <View accessibilityRole="radiogroup" style={styles.optionList}>
                        {TARGET_LANGUAGE_OPTIONS.map((option) => (
                            <OptionRow
                                key={option.id}
                                label={option.label}
                                selected={option.id === activeTargetOptionId}
                                onPress={() => handleTargetLanguageSelect(option)}
                                styles={styles}
                                colors={colors}
                            />
                        ))}
                    </View>
                    <Text style={styles.sheetNote}>{t('profile.learningLanguageDesc')}</Text>
                </View>
            </PaperSheet>

            {/* App language */}
            <PaperSheet
                visible={showInterfaceLanguagePicker}
                onClose={() => setShowInterfaceLanguagePicker(false)}
                dragRegion="header"
                accessibilityLabel={t('profile.interfaceLanguage')}
            >
                <View style={styles.sheetBody}>
                    <Text style={styles.sheetTitle} accessibilityRole="header">{t('profile.interfaceLanguage')}</Text>
                    <ScrollView style={styles.sheetScroll} accessibilityRole="radiogroup">
                        {interfaceLanguageOptions.map((option) => (
                            <OptionRow
                                key={option.code}
                                label={option.label}
                                selected={option.code === interfaceLanguage}
                                disabled={option.code === targetLanguage}
                                onPress={() => handleInterfaceLanguageSelect(option.code)}
                                styles={styles}
                                colors={colors}
                            />
                        ))}
                    </ScrollView>
                    <Text style={styles.sheetNote}>{t('profile.translationDisclaimer')}</Text>
                </View>
            </PaperSheet>

            {/* Contact */}
            <PaperSheet
                visible={showContactModal}
                onClose={() => setShowContactModal(false)}
                accessibilityLabel={t('profile.contact')}
            >
                <View style={styles.sheetBody}>
                    <Text style={styles.sheetTitle} accessibilityRole="header">{t('profile.contact')}</Text>
                    <Text style={styles.sheetHelper}>{t('profile.contactBody')}</Text>
                    <PressableScale
                        onPress={handleCopyEmail}
                        accessibilityRole="button"
                        accessibilityLabel={`${CONTACT_EMAIL}, ${emailCopied ? t('profile.emailCopied') : t('profile.copyEmail')}`}
                        style={styles.emailField}
                    >
                        <Text style={styles.emailText} selectable>{CONTACT_EMAIL}</Text>
                        <Feather
                            name={emailCopied ? 'check' : 'copy'}
                            size={18}
                            color={emailCopied ? colors.tint : colors.textMuted}
                        />
                    </PressableScale>
                    <View style={styles.sheetActions}>
                        <PaperButton
                            variant="secondary"
                            label={t('common.close')}
                            onPress={() => setShowContactModal(false)}
                            style={styles.flexButton}
                        />
                        <PaperButton
                            label={emailCopied ? t('profile.emailCopied') : t('profile.copyEmail')}
                            onPress={handleCopyEmail}
                            style={styles.flexButton}
                        />
                    </View>
                </View>
            </PaperSheet>

            {/* Sign in / sign up */}
            <PaperDialog
                visible={showAuthModal}
                onRequestClose={() => setShowAuthModal(false)}
                closeLabel={t('profile.closeSignIn')}
                styles={styles}
                reduced={reduced}
                cardStyle={styles.authCard}
            >
                <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                    <View style={styles.authHeader}>
                        <Text style={[styles.dialogTitle, styles.authTitle]} accessibilityRole="header">{t('profile.authTitle')}</Text>
                        <PressableScale
                            accessibilityRole="button"
                            accessibilityLabel={t('profile.closeSignIn')}
                            onPress={() => setShowAuthModal(false)}
                            style={styles.closeButton}
                        >
                            <Feather name="x" size={20} color={colors.textMuted} />
                        </PressableScale>
                    </View>
                    <Text style={[styles.dialogHelper, styles.authHelper]}>{t('profile.authBody')}</Text>
                    <PaperTabs
                        tabs={[
                            { key: 'signin', label: t('profile.signIn') },
                            { key: 'signup', label: t('profile.signUp') },
                        ]}
                        value={authMode}
                        onChange={setAuthMode}
                        style={styles.authTabs}
                    />
                    <Auth
                        key={authMode}
                        embedded
                        initialMode={authMode}
                        showApple={false}
                        showHeader={false}
                        showModeToggle={false}
                        showSectionLabels={false}
                        title=""
                        subtitle=""
                        onAuthenticated={() => setShowAuthModal(false)}
                    />
                </ScrollView>
            </PaperDialog>

            {/* Username */}
            <PaperDialog
                visible={showNameEditor}
                onRequestClose={() => setShowNameEditor(false)}
                closeLabel={t('common.cancel')}
                styles={styles}
                reduced={reduced}
            >
                <Text style={styles.dialogTitle} accessibilityRole="header">{t('profile.editUsernameTitle')}</Text>
                <TextInput
                    value={draftName}
                    onChangeText={setDraftName}
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!isSavingName}
                    placeholder={t('profile.usernamePlaceholder')}
                    placeholderTextColor={colors.textSubtle}
                    accessibilityLabel={t('profile.usernamePlaceholder')}
                    style={styles.input}
                />
                <View style={styles.dialogActions}>
                    <PaperButton
                        variant="secondary"
                        size="md"
                        label={t('common.cancel')}
                        onPress={() => setShowNameEditor(false)}
                        disabled={isSavingName}
                        style={styles.flexButton}
                    />
                    <PaperButton
                        size="md"
                        label={isSavingName ? t('common.working') : t('common.save')}
                        onPress={handleSaveName}
                        disabled={isSavingName}
                        style={styles.flexButton}
                    />
                </View>
            </PaperDialog>

            {/* Log out */}
            <PaperDialog
                visible={showSignOutModal}
                onRequestClose={() => setShowSignOutModal(false)}
                closeLabel={t('common.cancel')}
                styles={styles}
                reduced={reduced}
            >
                <Text style={styles.dialogTitle} accessibilityRole="header">{t('profile.logoutTitle')}</Text>
                <Text style={styles.dialogHelper}>{t('profile.logoutBody')}</Text>
                <View style={styles.dialogActions}>
                    <PaperButton
                        variant="secondary"
                        size="md"
                        label={t('common.cancel')}
                        onPress={() => setShowSignOutModal(false)}
                        style={styles.flexButton}
                    />
                    <PaperButton
                        size="md"
                        label={t('profile.logout')}
                        onPress={() => performSignOut()}
                        style={styles.flexButton}
                    />
                </View>
            </PaperDialog>

            {/* Delete account */}
            <PaperDialog
                visible={showDeleteModal}
                onRequestClose={closeDeleteModal}
                closeLabel={t('common.cancel')}
                styles={styles}
                reduced={reduced}
            >
                <Text style={styles.dialogTitle} accessibilityRole="header">{t('profile.deleteAccountTitle')}</Text>
                <Text style={styles.dialogHelper}>{t('profile.deleteAccountBody')}</Text>
                <View style={styles.dialogActions}>
                    <PaperButton
                        variant="secondary"
                        size="md"
                        label={t('common.cancel')}
                        onPress={() => setShowDeleteModal(false)}
                        disabled={isDeletingAccount}
                        style={styles.flexButton}
                    />
                    <PaperButton
                        size="md"
                        label={isDeletingAccount ? t('profile.deletingAccount') : t('profile.deleteAccountConfirm')}
                        onPress={() => performDeleteAccount()}
                        disabled={isDeletingAccount}
                        style={[styles.flexButton, styles.dangerButton]}
                    />
                </View>
            </PaperDialog>
        </Screen>
    );
};

const createStyles = (colors, bottomInset = 0) => StyleSheet.create({
    screenContent: {
        flex: 1,
        paddingHorizontal: 0,
        paddingTop: 0,
        paddingBottom: 0,
        backgroundColor: colors.bgPage,
    },
    pageScroller: {
        flex: 1,
        width: '100%',
    },
    pageScrollerContent: {
        flexGrow: 1,
        paddingTop: 28,
        paddingBottom: 32,
    },

    // Header
    header: {
        paddingHorizontal: GUTTER,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
    },
    avatar: {
        width: 52,
        height: 52,
        borderRadius: 26,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.inkSlate,
    },
    avatarInitial: {
        fontFamily: fontFamilies.displayRegular,
        fontSize: 24,
        lineHeight: 30,
        color: colors.onInk,
    },
    identity: {
        flex: 1,
        minWidth: 0,
        gap: 2,
    },
    name: {
        fontFamily: fontFamilies.displaySemiBold,
        fontSize: 26,
        lineHeight: 30,
        letterSpacing: -0.4,
        color: colors.text,
    },
    status: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 14,
        lineHeight: 19,
        color: colors.textMuted,
    },
    headerAction: {
        paddingHorizontal: 16,
    },

    // Level
    levelSection: {
        marginTop: 30,
        paddingHorizontal: GUTTER,
        gap: 14,
    },
    eyebrow: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 12,
        lineHeight: 16,
        letterSpacing: 0.96,
        textTransform: 'uppercase',
        color: colors.textMuted,
    },
    levelSentence: {
        fontFamily: fontFamilies.displayRegular,
        fontSize: 32,
        lineHeight: 36,
        letterSpacing: -0.64,
        color: colors.text,
    },
    levelSentenceAccent: {
        color: colors.tint,
    },
    levelPlaceholder: {
        height: 168,
    },
    scale: {
        gap: 6,
    },
    scaleTrackArea: {
        height: 28,
        marginHorizontal: 0,
    },
    scaleTrack: {
        position: 'absolute',
        left: 0,
        right: 0,
        top: 13,
        height: 2,
        borderRadius: 1,
    },
    scaleBand: {
        position: 'absolute',
        top: 8,
        height: 12,
        borderRadius: 6,
    },
    scaleFill: {
        position: 'absolute',
        left: 0,
        top: 13,
        height: 2,
        borderRadius: 1,
    },
    scaleMarker: {
        position: 'absolute',
        top: 0,
        width: 28,
        height: 28,
        marginLeft: -14,
        borderRadius: 14,
        borderWidth: 4,
    },
    scaleTicks: {
        height: 16,
    },
    scaleTick: {
        position: 'absolute',
        top: 0,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 12,
        lineHeight: 16,
        color: colors.textMuted,
        fontVariant: ['tabular-nums'],
    },
    note: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 14,
        lineHeight: 20,
        color: colors.textMuted,
    },
    levelActions: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
    },
    levelButton: {
        paddingHorizontal: 20,
    },

    // Rows
    group: {
        marginTop: 30,
    },
    rowPressable: {
        paddingHorizontal: GUTTER,
    },
    rowPressed: {
        backgroundColor: colors.accentSoft,
    },
    rowInner: {
        minHeight: 56,
        paddingVertical: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: colors.border,
    },
    groupEnd: {
        marginHorizontal: GUTTER,
        height: StyleSheet.hairlineWidth,
        backgroundColor: colors.border,
    },
    rowCopy: {
        flex: 1,
        minWidth: 0,
        gap: 2,
    },
    rowLabel: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 16,
        lineHeight: 21,
        color: colors.text,
    },
    rowLabelFlex: {
        flex: 1,
        minWidth: 0,
    },
    rowValue: {
        flexShrink: 1,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 16,
        lineHeight: 21,
        color: colors.textMuted,
    },
    rowDescription: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        lineHeight: 18,
        color: colors.textMuted,
    },
    rowDisabled: {
        opacity: 0.55,
    },
    pressedText: {
        opacity: 0.55,
    },

    // Appearance radios
    radioGroup: {
        flexDirection: 'row',
        gap: 18,
        marginVertical: -10,
    },
    radioOption: {
        height: 56,
        justifyContent: 'center',
    },
    radioText: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 15,
        lineHeight: 20,
        color: colors.textMuted,
    },
    radioTextSelected: {
        fontFamily: fontFamilies.sansBold,
        color: colors.text,
    },
    radioUnderline: {
        position: 'absolute',
        bottom: 12,
        height: 2,
        borderRadius: 1,
    },

    // Footer
    footer: {
        marginTop: 12,
        paddingHorizontal: GUTTER,
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: 6,
    },
    footerText: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        lineHeight: 18,
        color: colors.textTertiary,
    },
    footerLinkHit: {
        minHeight: 44,
        justifyContent: 'center',
    },
    footerLink: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        lineHeight: 18,
        color: colors.tint,
    },

    // Sheets
    sheetBody: {
        flexShrink: 1,
        paddingHorizontal: GUTTER,
        paddingTop: 4,
        paddingBottom: 20 + bottomInset,
        gap: 12,
    },
    sheetTitle: {
        fontFamily: fontFamilies.displaySemiBold,
        fontSize: 26,
        lineHeight: 31,
        letterSpacing: -0.4,
        color: colors.text,
    },
    sheetHelper: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 15,
        lineHeight: 21,
        color: colors.textMuted,
    },
    sheetNote: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        lineHeight: 18,
        color: colors.textMuted,
    },
    sheetScroll: {
        flexGrow: 0,
        flexShrink: 1,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.border,
    },
    optionList: {
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.border,
    },
    optionRow: {
        minHeight: 52,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: colors.border,
    },
    optionDisabled: {
        opacity: 0.45,
    },
    optionText: {
        flex: 1,
        minWidth: 0,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 16,
        lineHeight: 21,
        color: colors.text,
    },
    optionTextSelected: {
        fontFamily: fontFamilies.sansSemiBold,
    },
    sheetActions: {
        flexDirection: 'row',
        gap: 10,
        marginTop: 4,
    },
    flexButton: {
        flex: 1,
        paddingHorizontal: 12,
    },
    emailField: {
        minHeight: 52,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        borderRadius: 16,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.borderStrong,
        backgroundColor: colors.bgPage,
    },
    emailText: {
        flex: 1,
        minWidth: 0,
        fontFamily: fontFamilies.sansMedium,
        fontSize: 15,
        lineHeight: 20,
        color: colors.text,
    },

    // Dialogs
    dialogBackdrop: {
        flex: 1,
        justifyContent: 'center',
        paddingHorizontal: 20,
        backgroundColor: colors.overlay,
    },
    dialogCard: {
        width: '100%',
        maxWidth: 440,
        alignSelf: 'center',
        borderRadius: 24,
        padding: GUTTER,
        gap: 12,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
        backgroundColor: colors.surface,
    },
    dialogTitle: {
        fontFamily: fontFamilies.displaySemiBold,
        fontSize: 24,
        lineHeight: 29,
        letterSpacing: -0.4,
        color: colors.text,
    },
    dialogHelper: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 15,
        lineHeight: 21,
        color: colors.textMuted,
    },
    dialogActions: {
        flexDirection: 'row',
        gap: 10,
        marginTop: 8,
    },
    dangerButton: {
        backgroundColor: colors.danger,
    },
    input: {
        minHeight: 50,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 16,
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: colors.bgPage,
        color: colors.text,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 16,
        lineHeight: 21,
    },
    authCard: {
        maxHeight: '88%',
    },
    authHeader: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
    },
    authTitle: {
        flex: 1,
        minWidth: 0,
    },
    authHelper: {
        marginTop: 4,
    },
    authTabs: {
        marginTop: 12,
        marginBottom: 16,
    },
    closeButton: {
        width: 44,
        height: 44,
        marginTop: -8,
        marginRight: -10,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 22,
    },
});

export default Profile;
