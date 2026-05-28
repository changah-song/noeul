import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { TranslatorProvider } from 'react-native-translator';
import { useEffect, useState } from 'react';
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
import { tabScreenOptions } from './components/shared/TabBar';
import useAppSetup from './hooks/useAppSetup';
import useAuth from './hooks/useAuth';
import Home from './screens/Home';
import Learn from './screens/Learn';
import Profile from './screens/Profile';
import Read from './screens/Read';
import Write from './screens/Write';

const Tab = createBottomTabNavigator();

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function App() {
    const { books, setBooks, currentBook, setCurrentBook, preprocessOnOpen, setPreprocessOnOpen, updateBookPreprocessed, loading: appSetupLoading } = useAppSetup();
    const { user, loading, signOut, updateUsername, updateProfile } = useAuth();
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

    const appReady = !loading && !appSetupLoading && fontsLoaded;

    useEffect(() => {
        if (appReady) {
            SplashScreen.hideAsync().catch(() => {});
        }
    }, [appReady]);

    if (!appReady) {
        return null;
    }

    return (
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
                            />
                        )}
                    </Tab.Screen>
                    <Tab.Screen name="Write" component={Write} />
                    <Tab.Screen name="Profile">
                        {props => (
                            <Profile
                                {...props}
                                user={user}
                                signOut={signOut}
                                updateUsername={updateUsername}
                                updateProfile={updateProfile}
                            />
                        )}
                    </Tab.Screen>
                </Tab.Navigator>
            </NavigationContainer>
        </TranslatorProvider>
    );
}
