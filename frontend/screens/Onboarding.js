import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    Animated,
    BackHandler,
    Easing,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { Feather, MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { AuthModal } from './Auth';
import VocabLevelModal from '../components/shared/VocabLevelModal';
import WordCheckModal, { OptionSheet } from '../components/shared/WordCheckModal';
import { useAppContext } from '../contexts/AppContext';
import { useTranslation } from '../hooks/useTranslation';
import {
    getActiveTargetLanguageOptionId,
    getInterfaceLanguageLabel,
    KRDICT_INTERFACE_LANGUAGE_OPTIONS,
    TARGET_LANGUAGE_OPTIONS,
} from '../constants/languages';
import { hasVocabSizeGrid } from '../services/vocabSizeLevels';
import { hasWordCheck } from '../services/wordCheck';
import { fontFamilies, useTheme } from '../theme';
import { ltrRow, rtlIcon } from '../services/layoutDirection';

// ─── Completion flag ──────────────────────────────────────────────────────────

export const ONBOARDING_COMPLETED_KEY = 'onboarding.completed.v1';
// Set only when someone actually went through the flow (not when an existing
// install is marked done), so the reader can skip its own first-book level prompt.
export const ONBOARDING_FLOW_SEEN_KEY = 'onboarding.flowSeen.v1';

/** Whether this install has finished onboarding. False when storage fails. */
export const hasCompletedOnboarding = async () => {
    try {
        return (await AsyncStorage.getItem(ONBOARDING_COMPLETED_KEY)) === '1';
    } catch {
        return false;
    }
};

/** Record that onboarding is done, so it never shows again. */
export const markOnboardingCompleted = async () => {
    try {
        await AsyncStorage.setItem(ONBOARDING_COMPLETED_KEY, '1');
    } catch (error) {
        console.warn('[Onboarding] Could not save completion:', error?.message ?? error);
    }
};

// ─── Content ──────────────────────────────────────────────────────────────────

const STEPS = ['welcome', 'languages', 'level', 'tour'];

const LANGUAGE_CARDS = [
    { id: 'ko', glyph: '한', nameKey: 'onboarding.korean', detailKey: 'onboarding.koreanDetail' },
    { id: 'zh', glyph: '中', nameKey: 'onboarding.chinese', detailKey: 'onboarding.chineseDetail' },
];

const LEVEL_OPTIONS = [
    { id: 'check', titleKey: 'onboarding.levelCheck', detailKey: 'onboarding.levelCheckDetail' },
    { id: 'pick', titleKey: 'onboarding.levelPick', detailKey: 'onboarding.levelPickDetail' },
    { id: 'new', titleKey: 'onboarding.levelNew', detailKey: 'onboarding.levelNewDetail' },
];

const EXTRAS = [
    { key: 'listen', icon: 'headphones', labelKey: 'onboarding.extraListen' },
    { key: 'focus', icon: 'eye', labelKey: 'onboarding.extraFocus' },
    { key: 'scan', icon: 'maximize', labelKey: 'onboarding.extraScan' },
    { key: 'songs', icon: 'music', labelKey: 'onboarding.extraSongs' },
    { key: 'cards', icon: 'layers', labelKey: 'onboarding.extraFlashcards' },
];

// The demo sentence on the "How reading works" card: a word with a level
// underline (easy), a tapped word (grey box + mid underline), a saved word
// (ink box). `gloss` is the tapped word's entry in the little panel below.
const DEMO = {
    ko: {
        tokens: [
            { text: '복녀는, ' },
            { text: '원래', mark: 'easy' },
            { text: ' 가난은 하나마 ' },
            { text: '정직한', mark: 'tapped' },
            { text: ' 농가에서 ' },
            { text: '처녀', mark: 'saved' },
            { text: '였었다.' },
        ],
        headword: '정직',
        glossKey: 'onboarding.demoGlossKo',
    },
    zh: {
        tokens: [
            { text: '他' },
            { text: '原来', mark: 'easy' },
            { text: '是个' },
            { text: '诚实', mark: 'tapped' },
            { text: '的' },
            { text: '农民', mark: 'saved' },
            { text: '。' },
        ],
        headword: '诚实',
        glossKey: 'onboarding.demoGlossZh',
    },
};

// ─── Pieces ───────────────────────────────────────────────────────────────────

const StepDots = ({ step, count, styles, colors, label }) => {
    const anims = useRef(Array.from({ length: count }, (_, i) => new Animated.Value(i === step ? 1 : 0))).current;
    useEffect(() => {
        Animated.parallel(anims.map((value, i) => Animated.timing(value, {
            toValue: i === step ? 1 : 0,
            duration: 220,
            easing: Easing.out(Easing.quad),
            useNativeDriver: false,
        }))).start();
    }, [anims, step]);

    return (
        <View style={styles.dots} accessible accessibilityLabel={label}>
            {anims.map((value, i) => (
                <Animated.View
                    // eslint-disable-next-line react/no-array-index-key
                    key={i}
                    style={[
                        styles.dot,
                        {
                            width: value.interpolate({ inputRange: [0, 1], outputRange: [6, 18] }),
                            backgroundColor: value.interpolate({
                                inputRange: [0, 1],
                                outputRange: [colors.dotInactive, colors.inkSlate],
                            }),
                        },
                    ]}
                />
            ))}
        </View>
    );
};

// A selectable card with a radio dot on the right.
const ChoiceCard = ({ selected, onPress, children, styles, minHeight }) => (
    <Pressable
        accessibilityRole="radio"
        accessibilityState={{ selected }}
        onPress={onPress}
        style={({ pressed }) => [
            styles.card,
            { minHeight },
            selected && styles.cardSelected,
            pressed && !selected && styles.cardPressed,
        ]}
    >
        {children}
        <View style={[styles.radio, selected && styles.radioSelected]} />
    </Pressable>
);

// Plain runs are split into words (each keeping its trailing space) so the
// wrapping row can break between them.
const splitDemoTokens = (tokens) => tokens.flatMap((token) => {
    if (token.mark) return [token];
    const parts = token.text.split(' ');
    return parts
        .map((part, i) => ({ text: i < parts.length - 1 ? `${part} ` : part }))
        .filter((part) => part.text.length > 0);
});

const DemoSentence = ({ language, styles, t }) => {
    const demo = DEMO[language] || DEMO.ko;
    const tokens = useMemo(() => splitDemoTokens(demo.tokens), [demo]);
    return (
        <View style={styles.demoCard}>
            <View style={styles.demoTextWrap}>
                {tokens.map((token, i) => {
                    if (!token.mark) {
                        // eslint-disable-next-line react/no-array-index-key
                        return <Text key={i} style={styles.demoText}>{token.text}</Text>;
                    }
                    return (
                        <View
                            // eslint-disable-next-line react/no-array-index-key
                            key={i}
                            style={[
                                styles.demoWord,
                                token.mark === 'easy' && styles.demoUnderlineEasy,
                                token.mark === 'tapped' && styles.demoTapped,
                                token.mark === 'saved' && styles.demoSaved,
                            ]}
                        >
                            <Text style={[styles.demoText, token.mark === 'saved' && styles.demoSavedText]}>
                                {token.text}
                            </Text>
                        </View>
                    );
                })}
            </View>
            <View style={styles.demoPanel}>
                <Text style={styles.demoHeadword}>{demo.headword}</Text>
                <Text style={styles.demoGloss} numberOfLines={1}>{t(demo.glossKey)}</Text>
            </View>
        </View>
    );
};

// ─── Screen ───────────────────────────────────────────────────────────────────

/**
 * Onboarding — first-run flow in one screen, four steps with a step indicator
 * and a back chevron:
 *   1. Welcome (app tile, headline, "Get started" / "I already have an account")
 *   2. Languages (learning language cards + the interface-language row)
 *   3. Level (word check / pick it myself / just starting)
 *   4. How reading works (demo card, gestures, "Also in Noeul") → "Start reading"
 *
 * Choices go through the same AppContext setters Profile uses. Finishing
 * (or signing in from step 1) marks onboarding completed and calls onDone().
 */
const Onboarding = ({ onDone }) => {
    const {
        interfaceLanguage,
        setInterfaceLanguage,
        targetLanguage,
        setTargetLanguage,
        setChineseScript,
    } = useAppContext();
    const theme = useTheme();
    const colors = theme.colors;
    const styles = useMemo(() => createStyles(colors), [colors]);
    const { t } = useTranslation();
    const safeInsets = useContext(SafeAreaInsetsContext);

    const [step, setStep] = useState(0);
    const [levelChoice, setLevelChoice] = useState('check');
    const [showInterfacePicker, setShowInterfacePicker] = useState(false);
    const [showWordCheck, setShowWordCheck] = useState(false);
    const [showLevelPicker, setShowLevelPicker] = useState(false);
    const [showAuth, setShowAuth] = useState(false);
    const finishingRef = useRef(false);

    const activeTargetId = getActiveTargetLanguageOptionId(targetLanguage);
    const stepName = STEPS[step];
    const isLast = step === STEPS.length - 1;
    const canCheck = hasWordCheck(targetLanguage);

    // Step content fades/slides in on each change.
    const enter = useRef(new Animated.Value(1)).current;
    useEffect(() => {
        enter.setValue(0);
        Animated.timing(enter, {
            toValue: 1,
            duration: 220,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
        }).start();
    }, [enter, step]);

    const finish = useCallback(async () => {
        if (finishingRef.current) return;
        finishingRef.current = true;
        await markOnboardingCompleted();
        onDone?.();
    }, [onDone]);

    const goBack = useCallback(() => {
        setStep((current) => Math.max(0, current - 1));
    }, []);

    const advance = useCallback(() => {
        setStep((current) => Math.min(STEPS.length - 1, current + 1));
    }, []);

    // Android back steps back through the flow instead of leaving it.
    useEffect(() => {
        const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
            if (step > 0) {
                goBack();
                return true;
            }
            return false;
        });
        return () => subscription?.remove?.();
    }, [goBack, step]);

    const selectTarget = (option) => {
        if (option.id === activeTargetId) return;
        if (option.chineseScript) {
            setChineseScript(option.chineseScript);
        }
        setTargetLanguage(option.targetLanguage);
    };

    const selectInterfaceLanguage = (language) => {
        if (language === targetLanguage) return;
        setInterfaceLanguage(language);
        setShowInterfacePicker(false);
    };

    const handlePrimary = () => {
        if (isLast) {
            finish();
            return;
        }
        if (stepName === 'level' && hasVocabSizeGrid(targetLanguage)) {
            if (levelChoice === 'check' && canCheck) {
                setShowWordCheck(true);
                return;
            }
            if (levelChoice === 'pick') {
                setShowLevelPicker(true);
                return;
            }
        }
        advance();
    };

    const primaryLabel = step === 0
        ? t('onboarding.getStarted')
        : (isLast ? t('onboarding.startReading') : t('onboarding.continue'));

    const targetCard = LANGUAGE_CARDS.find((card) => card.id === activeTargetId) || LANGUAGE_CARDS[0];
    const enterStyle = {
        opacity: enter,
        transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
    };

    const renderWelcome = () => (
        <View style={styles.welcome}>
            <View style={styles.appTile}>
                <Text style={styles.appTileLetter}>N</Text>
            </View>
            <Text style={styles.welcomeEyebrow}>{t('onboarding.welcome')}</Text>
            <Text style={[styles.headline, styles.headlineCenter]} accessibilityRole="header">
                {t('onboarding.welcomeHeadline')}
            </Text>
            <Text style={[styles.lead, styles.leadCenter]}>{t('onboarding.welcomeBody')}</Text>
        </View>
    );

    const renderLanguages = () => (
        <View>
            <Text style={styles.title} accessibilityRole="header">{t('onboarding.languagesTitle')}</Text>
            <Text style={styles.lead}>{t('onboarding.languagesBody')}</Text>
            <View style={styles.cards} accessibilityRole="radiogroup">
                {TARGET_LANGUAGE_OPTIONS.map((option) => {
                    const card = LANGUAGE_CARDS.find((item) => item.id === option.id);
                    if (!card) return null;
                    return (
                        <ChoiceCard
                            key={option.id}
                            selected={option.id === activeTargetId}
                            onPress={() => selectTarget(option)}
                            styles={styles}
                            minHeight={76}
                        >
                            <Text style={styles.cardGlyph}>{card.glyph}</Text>
                            <View style={styles.cardCopy}>
                                <Text style={styles.cardTitle}>{t(card.nameKey)}</Text>
                                <Text style={styles.cardDetail}>{t(card.detailKey)}</Text>
                            </View>
                        </ChoiceCard>
                    );
                })}
            </View>
            <TouchableOpacity
                style={styles.languageRow}
                onPress={() => setShowInterfacePicker(true)}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel={`${t('profile.interfaceLanguage')}, ${getInterfaceLanguageLabel(interfaceLanguage)}`}
            >
                <Text style={styles.languageRowLabel}>{t('profile.interfaceLanguage')}</Text>
                <Text style={styles.languageRowValue}>{getInterfaceLanguageLabel(interfaceLanguage)}</Text>
                <Feather name={rtlIcon('chevron-right')} size={16} color={colors.textSubtle} />
            </TouchableOpacity>
            <Text style={styles.note}>{t('profile.interfaceLanguageDesc')}</Text>
        </View>
    );

    const renderLevel = () => (
        <View>
            <Text style={styles.title} accessibilityRole="header">
                {t('onboarding.levelTitle', { language: t(targetCard.nameKey) })}
            </Text>
            <Text style={styles.lead}>{t('onboarding.levelBody')}</Text>
            <View style={styles.cards} accessibilityRole="radiogroup">
                {LEVEL_OPTIONS.filter((option) => option.id !== 'check' || canCheck).map((option) => (
                    <ChoiceCard
                        key={option.id}
                        selected={levelChoice === option.id}
                        onPress={() => setLevelChoice(option.id)}
                        styles={styles}
                        minHeight={72}
                    >
                        <View style={styles.cardCopy}>
                            <Text style={styles.cardTitle}>{t(option.titleKey)}</Text>
                            <Text style={styles.cardDetail}>{t(option.detailKey)}</Text>
                        </View>
                    </ChoiceCard>
                ))}
            </View>
        </View>
    );

    const renderTour = () => (
        <View>
            <DemoSentence language={activeTargetId} styles={styles} t={t} />
            <Text style={[styles.title, styles.tourTitle]} accessibilityRole="header">{t('onboarding.tourTitle')}</Text>
            <View style={styles.gestures}>
                <View style={styles.gestureRow}>
                    <View style={styles.gestureIcon}>
                        <MaterialCommunityIcons name="gesture-tap" size={22} color={colors.inkSlate} />
                    </View>
                    <View style={styles.gestureCopy}>
                        <Text style={styles.gestureTitle}>{t('onboarding.tapTitle')}</Text>
                        <Text style={styles.gestureDetail}>{t('onboarding.tapDetail')}</Text>
                    </View>
                </View>
                <View style={styles.gestureRow}>
                    <View style={styles.gestureIcon}>
                        <MaterialIcons name="translate" size={20} color={colors.inkSlate} />
                    </View>
                    <View style={styles.gestureCopy}>
                        <Text style={styles.gestureTitle}>{t('onboarding.holdTitle')}</Text>
                        <Text style={styles.gestureDetail}>{t('onboarding.holdDetail')}</Text>
                    </View>
                </View>
                <Text style={styles.tourNote}>{t('onboarding.tourNote')}</Text>
            </View>
            <View style={styles.extras}>
                <Text style={styles.extrasLabel}>{t('onboarding.alsoInNoeul')}</Text>
                <View style={styles.extrasRow}>
                    {EXTRAS.map((extra) => (
                        <View key={extra.key} style={styles.extra}>
                            <View style={styles.extraIcon}>
                                <Feather name={extra.icon} size={18} color={colors.textSecondary} />
                            </View>
                            <Text style={styles.extraLabel} numberOfLines={2}>{t(extra.labelKey)}</Text>
                        </View>
                    ))}
                </View>
            </View>
        </View>
    );

    return (
        <View
            style={[
                styles.screen,
                { paddingTop: 16 + (safeInsets?.top ?? 0), paddingBottom: 20 + (safeInsets?.bottom ?? 0) },
            ]}
            testID="onboarding"
        >
            <View style={styles.header}>
                <View style={styles.headerSide}>
                    {step > 0 ? (
                        <TouchableOpacity
                            onPress={goBack}
                            style={styles.backButton}
                            accessibilityRole="button"
                            accessibilityLabel={t('common.back')}
                        >
                            <Feather name={rtlIcon('chevron-left')} size={24} color={colors.inkSlate} />
                        </TouchableOpacity>
                    ) : null}
                </View>
                <StepDots
                    step={step}
                    count={STEPS.length}
                    styles={styles}
                    colors={colors}
                    label={t('onboarding.stepOf', { step: step + 1, total: STEPS.length })}
                />
                <View style={styles.headerSide} />
            </View>

            <ScrollView
                style={styles.body}
                contentContainerStyle={[styles.bodyContent, stepName === 'welcome' && styles.bodyCentered]}
                showsVerticalScrollIndicator={false}
            >
                <Animated.View style={enterStyle}>
                    {stepName === 'welcome' ? renderWelcome() : null}
                    {stepName === 'languages' ? renderLanguages() : null}
                    {stepName === 'level' ? renderLevel() : null}
                    {stepName === 'tour' ? renderTour() : null}
                </Animated.View>
            </ScrollView>

            <View style={styles.footer}>
                <TouchableOpacity
                    style={styles.primaryButton}
                    onPress={handlePrimary}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    testID="onboarding-primary"
                >
                    <Text style={styles.primaryButtonText}>{primaryLabel}</Text>
                </TouchableOpacity>
                {step === 0 ? (
                    <TouchableOpacity
                        style={styles.textButton}
                        onPress={() => setShowAuth(true)}
                        accessibilityRole="button"
                    >
                        <Text style={styles.textButtonText}>{t('auth.haveAccount')}</Text>
                    </TouchableOpacity>
                ) : null}
            </View>

            <OptionSheet
                visible={showInterfacePicker}
                onClose={() => setShowInterfacePicker(false)}
                title={t('profile.interfaceLanguage')}
                note={t('profile.interfaceLanguageDesc')}
                rowHeight={44}
                options={KRDICT_INTERFACE_LANGUAGE_OPTIONS.map((option) => ({
                    key: option.code,
                    label: option.label,
                    disabled: option.code === targetLanguage,
                }))}
                selectedKey={interfaceLanguage}
                onSelect={selectInterfaceLanguage}
            />

            <WordCheckModal
                visible={showWordCheck}
                onClose={() => {
                    setShowWordCheck(false);
                    advance();
                }}
            />

            <VocabLevelModal
                visible={showLevelPicker}
                onClose={() => {
                    setShowLevelPicker(false);
                    advance();
                }}
            />

            <AuthModal
                visible={showAuth}
                mode="signin"
                onClose={() => setShowAuth(false)}
                onAuthenticated={() => {
                    setShowAuth(false);
                    finish();
                }}
            />
        </View>
    );
};

const createStyles = (colors) => StyleSheet.create({
    screen: {
        flex: 1,
        paddingHorizontal: 24,
        backgroundColor: colors.bgPage,
    },
    header: {
        height: 44,
        flexDirection: 'row',
        alignItems: 'center',
    },
    headerSide: {
        width: 44,
    },
    backButton: {
        width: 44,
        height: 44,
        marginLeft: -12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    dots: {
        flex: 1,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 6,
    },
    dot: {
        height: 4,
        borderRadius: 2,
    },
    body: {
        flex: 1,
    },
    bodyContent: {
        flexGrow: 1,
        paddingBottom: 16,
    },
    bodyCentered: {
        justifyContent: 'center',
    },
    welcome: {
        alignItems: 'center',
        gap: 18,
    },
    appTile: {
        width: 84,
        height: 84,
        borderRadius: 22,
        backgroundColor: colors.inkSlate,
        alignItems: 'center',
        justifyContent: 'center',
    },
    appTileLetter: {
        fontFamily: fontFamilies.displaySemiBold,
        fontSize: 44,
        lineHeight: 52,
        color: colors.white,
    },
    welcomeEyebrow: {
        fontFamily: fontFamilies.sansMedium,
        fontSize: 15,
        color: colors.textMuted,
    },
    headline: {
        fontFamily: fontFamilies.displayMedium,
        fontSize: 34,
        lineHeight: 40,
        letterSpacing: -0.4,
        color: colors.text,
    },
    headlineCenter: {
        textAlign: 'center',
    },
    title: {
        marginTop: 36,
        marginBottom: 8,
        marginHorizontal: 4,
        fontFamily: fontFamilies.displayMedium,
        fontSize: 30,
        lineHeight: 36,
        letterSpacing: -0.3,
        color: colors.text,
    },
    lead: {
        marginHorizontal: 4,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 15,
        lineHeight: 22,
        color: colors.textMuted,
    },
    leadCenter: {
        maxWidth: 300,
        fontSize: 16,
        lineHeight: 24,
        textAlign: 'center',
    },
    cards: {
        marginTop: 24,
        gap: 10,
    },
    card: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingVertical: 12,
        paddingLeft: 14,
        paddingRight: 18,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
    },
    cardSelected: {
        borderWidth: 1.5,
        borderColor: colors.inkSlate,
        shadowColor: colors.text,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.08,
        shadowRadius: 18,
        elevation: 3,
    },
    cardPressed: {
        backgroundColor: colors.surfaceAssist,
    },
    cardGlyph: {
        width: 44,
        textAlign: 'center',
        fontFamily: fontFamilies.krSerifRegular,
        fontSize: 26,
        lineHeight: 34,
        color: colors.text,
    },
    cardCopy: {
        flex: 1,
        gap: 3,
    },
    cardTitle: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 16,
        lineHeight: 21,
        color: colors.text,
    },
    cardDetail: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        lineHeight: 18,
        color: colors.textMuted,
    },
    radio: {
        width: 22,
        height: 22,
        borderRadius: 11,
        borderWidth: 1.5,
        borderColor: colors.borderStrong,
        backgroundColor: colors.surface,
    },
    radioSelected: {
        borderWidth: 7,
        borderColor: colors.inkSlate,
    },
    languageRow: {
        marginTop: 18,
        minHeight: 56,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 18,
        gap: 12,
    },
    languageRowLabel: {
        flex: 1,
        fontFamily: fontFamilies.sansMedium,
        fontSize: 15,
        color: colors.textSecondary,
    },
    languageRowValue: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 15,
        color: colors.text,
    },
    note: {
        marginTop: 10,
        marginHorizontal: 4,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        lineHeight: 18,
        color: colors.textTertiary,
    },
    demoCard: {
        marginTop: 18,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: colors.divider,
        backgroundColor: colors.surface,
        overflow: 'hidden',
    },
    demoTextWrap: {
        paddingTop: 14,
        paddingBottom: 10,
        paddingHorizontal: 18,
        // The demo is Korean/Chinese text: left to right even in Arabic.
        flexDirection: ltrRow(),
        flexWrap: 'wrap',
        alignItems: 'flex-end',
        rowGap: 10,
    },
    demoText: {
        fontFamily: fontFamilies.krSerifRegular,
        fontSize: 18,
        lineHeight: 28,
        color: colors.readerBodyInk,
    },
    demoWord: {
        borderRadius: 3,
        paddingHorizontal: 1,
        borderBottomWidth: 2,
        borderBottomColor: 'transparent',
    },
    demoUnderlineEasy: {
        borderBottomColor: colors.readerLevelUnderlineEasy,
    },
    demoTapped: {
        backgroundColor: colors.readerTappedWordSurfaceBg,
        borderBottomColor: colors.readerLevelUnderlineMid,
    },
    demoSaved: {
        paddingHorizontal: 3,
        backgroundColor: colors.readerSavedWordSurfaceBg,
    },
    demoSavedText: {
        color: colors.readerSavedWordSurfaceText,
    },
    demoPanel: {
        borderTopWidth: 1,
        borderTopColor: colors.divider,
        paddingTop: 10,
        paddingBottom: 12,
        paddingHorizontal: 18,
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 10,
    },
    demoHeadword: {
        fontFamily: fontFamilies.krSerifSemiBold,
        fontSize: 20,
        lineHeight: 26,
        color: colors.text,
    },
    demoGloss: {
        flex: 1,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 15,
        color: colors.textSecondary,
    },
    tourTitle: {
        marginTop: 22,
        marginBottom: 14,
        fontSize: 27,
        lineHeight: 32,
    },
    gestures: {
        paddingHorizontal: 4,
        gap: 14,
    },
    gestureRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
    },
    gestureIcon: {
        width: 40,
        height: 40,
        borderRadius: 12,
        backgroundColor: colors.surfaceMuted,
        alignItems: 'center',
        justifyContent: 'center',
    },
    gestureCopy: {
        flex: 1,
        gap: 1,
    },
    gestureTitle: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 16,
        lineHeight: 21,
        color: colors.text,
    },
    gestureDetail: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 14,
        lineHeight: 19,
        color: colors.textMuted,
    },
    tourNote: {
        marginTop: 2,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        lineHeight: 19,
        color: colors.textTertiary,
    },
    extras: {
        marginTop: 18,
        marginHorizontal: 4,
        paddingTop: 14,
        borderTopWidth: 1,
        borderTopColor: colors.divider,
        opacity: 0.7,
    },
    extrasLabel: {
        marginBottom: 10,
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 12,
        color: colors.textTertiary,
    },
    extrasRow: {
        flexDirection: 'row',
        gap: 6,
    },
    extra: {
        flex: 1,
        alignItems: 'center',
        gap: 6,
    },
    extraIcon: {
        width: 38,
        height: 38,
        borderRadius: 19,
        borderWidth: 1,
        borderColor: colors.border,
        alignItems: 'center',
        justifyContent: 'center',
    },
    extraLabel: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 11,
        lineHeight: 14,
        textAlign: 'center',
        color: colors.textMuted,
    },
    footer: {
        gap: 10,
        paddingTop: 8,
    },
    primaryButton: {
        minHeight: 54,
        borderRadius: 16,
        backgroundColor: colors.inkSlate,
        alignItems: 'center',
        justifyContent: 'center',
    },
    primaryButtonText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 16,
        color: colors.white,
    },
    textButton: {
        minHeight: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    textButtonText: {
        fontFamily: fontFamilies.sansMedium,
        fontSize: 15,
        color: colors.textSecondary,
    },
});

export default Onboarding;
