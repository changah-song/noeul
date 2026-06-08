import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { TranslatorProvider } from 'react-native-translator';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import {
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMSans_700Bold,
} from '@expo-google-fonts/dm-sans';
import {
    Fraunces_400Regular,
    Fraunces_500Medium,
    Fraunces_600SemiBold,
    Fraunces_700Bold,
} from '@expo-google-fonts/fraunces';
import {
    NotoSerifKR_400Regular,
    NotoSerifKR_500Medium,
    NotoSerifKR_600SemiBold,
    NotoSerifKR_700Bold,
} from '@expo-google-fonts/noto-serif-kr';
import LocalDataDecisionModal from './components/Auth/LocalDataDecisionModal';
import { tabScreenOptions } from './components/shared/TabBar';
import { AppProvider } from './contexts/AppContext';
import { LocalOwnerProvider, useLocalOwner } from './contexts/LocalOwnerContext';
import useAppSetup from './hooks/useAppSetup';
import useAuth from './hooks/useAuth';
import Home from './screens/Home';
import Learn from './screens/Learn';
import Profile from './screens/Profile';
import Read from './screens/Read';
import Write from './screens/Write';
import { GUEST_OWNER_ID, getLocalOwnerId } from './services/localDataScope';
import {
    getActiveOwnerId,
    resumeCloudSync,
    transitionLocalOwner,
} from './services/localOwnerCoordinator';
import { getLegacyMigrationStatus } from './services/localOwnerMigration';
import { applyOwnershipDecision } from './services/localOwnershipDecisions';
import { hasLocalUserData } from './services/localUserData';
import { initializeOverlayLookupBridge } from './services/overlayLookup';
import { syncUserDataFromCloud } from './services/userDataSync';

const Tab = createBottomTabNavigator();
const isStaleSyncGenerationError = (error) => (
    String(error?.message || error || '').includes('stale sync generation')
);

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function App() {
    return (
        <LocalOwnerProvider>
            <AppContent />
        </LocalOwnerProvider>
    );
}

function AppContent() {
    const { user, loading, signOut, updateUsername, updateProfile } = useAuth();
    const {
        activeOwnerId,
        ownershipBlocked,
        pendingOwnershipDecision,
        syncPaused,
        syncGeneration,
    } = useLocalOwner();
    const [ownerMigrationReady, setOwnerMigrationReady] = useState(false);
    const [localDataDecisionBusy, setLocalDataDecisionBusy] = useState(false);
    const { books, setBooks, currentBook, setCurrentBook, preprocessOnOpen, setPreprocessOnOpen, updateBookPreprocessed, syncCloudBooks, loading: appSetupLoading, loadedOwnerId: appSetupOwnerId } = useAppSetup({
        ownerId: activeOwnerId,
        ownerReady: !loading && ownerMigrationReady,
        user,
    });
    const [isReaderFocusMode, setIsReaderFocusMode] = useState(false);
    const [fontsLoaded] = useFonts({
        'FFSans-Regular': DMSans_400Regular,
        'FFSans-Medium': DMSans_500Medium,
        'FFSans-SemiBold': DMSans_600SemiBold,
        'FFSans-Bold': DMSans_700Bold,
        'FFDisplay-Regular': Fraunces_400Regular,
        'FFDisplay-Medium': Fraunces_500Medium,
        'FFDisplay-SemiBold': Fraunces_600SemiBold,
        'FFDisplay-Bold': Fraunces_700Bold,
        'FFSerif-Regular': NotoSerifKR_400Regular,
        'FFSerif-Medium': NotoSerifKR_500Medium,
        'FFSerif-SemiBold': NotoSerifKR_600SemiBold,
        'FFSerif-Bold': NotoSerifKR_700Bold,
    });

    const appOwnerStateReady = !appSetupLoading && appSetupOwnerId === activeOwnerId;
    const appReady = !loading && ownerMigrationReady && appOwnerStateReady && fontsLoaded;

    useEffect(() => {
        if (appReady) {
            SplashScreen.hideAsync().catch(() => {});
        }
    }, [appReady]);

    useEffect(() => {
        if (!appReady) {
            return undefined;
        }

        return initializeOverlayLookupBridge();
    }, [appReady]);

    useEffect(() => {
        if (loading) {
            setOwnerMigrationReady(false);
            return undefined;
        }

        let isActive = true;
        setOwnerMigrationReady(false);

        const transitionOwner = async () => {
            const previousOwnerId = getActiveOwnerId();
            const nextOwnerId = getLocalOwnerId(user);
            const authEvent = user?.id ? 'SESSION_RESTORED' : 'SIGNED_OUT';

            try {
                const migrationStatus = await getLegacyMigrationStatus({ user });
                const hasGuestData = await hasLocalUserData(GUEST_OWNER_ID);
                if (!isActive) {
                    return;
                }

                const transitionResult = await transitionLocalOwner({
                    previousOwnerId,
                    nextOwnerId,
                    authEvent,
                    user,
                    hasGuestData,
                    hasRemoteData: false,
                    hasLegacyDecisionRequired: migrationStatus.requiresDecision,
                });
                if (!isActive) {
                    return;
                }

                if (transitionResult.status === 'blocked') {
                    const reason = transitionResult.reason === 'guest-data'
                        ? 'Guest local data requires an explicit ownership decision before cloud sync resumes.'
                        : 'Legacy local data requires an explicit migration decision before cloud sync resumes.';
                    console.warn(`[App] ${reason}`);
                }

                setOwnerMigrationReady(true);
            } catch (error) {
                if (!isActive) {
                    return;
                }

                await transitionLocalOwner({
                    previousOwnerId,
                    nextOwnerId,
                    authEvent: `${authEvent}:ERROR`,
                    user,
                    hasGuestData: false,
                    hasRemoteData: false,
                    hasLegacyDecisionRequired: Boolean(user?.id),
                });
                if (!isActive) {
                    return;
                }

                setOwnerMigrationReady(true);
                console.warn('[App] Legacy local data migration check failed; cloud sync remains paused:', error?.message ?? error);
            }
        };

        transitionOwner();

        return () => {
            isActive = false;
        };
    }, [loading, user?.id]);

    useEffect(() => {
        if (
            loading
            || !ownerMigrationReady
            || !appOwnerStateReady
            || ownershipBlocked
            || pendingOwnershipDecision
            || syncPaused
            || !user?.id
        ) {
            return;
        }

        if (activeOwnerId !== user.id) {
            return;
        }

        syncUserDataFromCloud({
            user,
            ownerId: activeOwnerId,
            generation: syncGeneration,
        }).catch((error) => {
            if (isStaleSyncGenerationError(error)) {
                return;
            }
            console.warn('[App] User data sync failed:', error?.message ?? error);
        });
    }, [
        activeOwnerId,
        appOwnerStateReady,
        loading,
        ownerMigrationReady,
        ownershipBlocked,
        pendingOwnershipDecision,
        syncGeneration,
        syncPaused,
        user?.id,
    ]);

    useEffect(() => {
        if (user?.id && activeOwnerId !== user.id) {
            setCurrentBook(null);
            setBooks([]);
        }
    }, [activeOwnerId, setBooks, setCurrentBook, user?.id]);

    const handleOwnershipDecision = async (action) => {
        if (!pendingOwnershipDecision || localDataDecisionBusy) {
            return;
        }

        setLocalDataDecisionBusy(true);
        try {
            await applyOwnershipDecision({
                decision: pendingOwnershipDecision,
                action,
                user,
            });
        } catch (error) {
            Alert.alert(
                'Local data decision failed',
                error?.message || 'Could not resolve local data ownership. Cloud sync remains paused.'
            );
        } finally {
            setLocalDataDecisionBusy(false);
        }
    };

    useEffect(() => {
        if (
            loading
            || !ownerMigrationReady
            || !appOwnerStateReady
            || user?.id
            || activeOwnerId !== GUEST_OWNER_ID
            || ownershipBlocked
            || pendingOwnershipDecision
            || !syncPaused
        ) {
            return;
        }

        resumeCloudSync();
    }, [
        activeOwnerId,
        appOwnerStateReady,
        loading,
        ownerMigrationReady,
        ownershipBlocked,
        pendingOwnershipDecision,
        syncPaused,
        user?.id,
    ]);

    useEffect(() => {
        if (
            loading
            || !ownerMigrationReady
            || !appOwnerStateReady
            || !user?.id
            || activeOwnerId !== user.id
            || ownershipBlocked
            || pendingOwnershipDecision
            || !syncPaused
        ) {
            return;
        }

        resumeCloudSync();
    }, [
        activeOwnerId,
        appOwnerStateReady,
        loading,
        ownerMigrationReady,
        ownershipBlocked,
        pendingOwnershipDecision,
        syncPaused,
        user?.id,
    ]);

    useEffect(() => {
        if (
            loading
            || !ownerMigrationReady
            || !appOwnerStateReady
            || ownershipBlocked
            || pendingOwnershipDecision
        ) {
            return;
        }

        if (user?.id && (syncPaused || activeOwnerId !== user.id)) {
            return;
        }

        syncCloudBooks({
            user,
            ownerId: activeOwnerId,
            generation: syncGeneration,
        }).catch((error) => {
            if (isStaleSyncGenerationError(error)) {
                return;
            }
            console.warn('[App] Cloud book sync failed:', error);
        });
    }, [
        activeOwnerId,
        appOwnerStateReady,
        loading,
        ownerMigrationReady,
        ownershipBlocked,
        pendingOwnershipDecision,
        syncCloudBooks,
        syncGeneration,
        syncPaused,
        user?.id,
    ]);

    if (!appReady) {
        return null;
    }

    return (
        <AppProvider user={user}>
            <TranslatorProvider>
                <NavigationContainer>
                    <Tab.Navigator screenOptions={(props) => tabScreenOptions(props, { hideTabChrome: isReaderFocusMode })}>
                    <Tab.Screen name="Home">
                        {props => (
                            <Home
                                {...props}
                                books={books}
                                setBooks={setBooks}
                                currentBook={currentBook}
                                setCurrentBook={setCurrentBook}
                                setPreprocessOnOpen={setPreprocessOnOpen}
                                user={user}
                            />
                        )}
                    </Tab.Screen>
                    <Tab.Screen name="Read">
                        {props => (
                            <Read
                                {...props}
                                books={books}
                                setBooks={setBooks}
                                currentBook={currentBook}
                                preprocessOnOpen={preprocessOnOpen}
                                user={user}
                                setIsReaderFocusMode={setIsReaderFocusMode}
                                onPreprocessComplete={(uri) => {
                                    setPreprocessOnOpen(false);
                                    updateBookPreprocessed(uri);
                                }}
                            />
                        )}
                    </Tab.Screen>
                    <Tab.Screen name="Learn">
                        {props => (
                            <Learn
                                {...props}
                                books={books}
                                user={user}
                            />
                        )}
                    </Tab.Screen>
                    <Tab.Screen name="Write">
                        {props => (
                            <Write
                                {...props}
                                user={user}
                            />
                        )}
                    </Tab.Screen>
                    <Tab.Screen name="Profile">
                        {props => (
                            <Profile
                                {...props}
                                user={user}
                                books={books}
                                signOut={signOut}
                                updateUsername={updateUsername}
                                updateProfile={updateProfile}
                            />
                        )}
                    </Tab.Screen>
                    </Tab.Navigator>
                </NavigationContainer>
                <LocalDataDecisionModal
                    decision={pendingOwnershipDecision}
                    user={user}
                    busy={localDataDecisionBusy}
                    onResolve={handleOwnershipDecision}
                />
            </TranslatorProvider>
        </AppProvider>
    );
}
