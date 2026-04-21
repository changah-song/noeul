import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { TranslatorProvider } from 'react-native-translator';
import { ActivityIndicator, View } from 'react-native';
import { tabScreenOptions } from './components/shared/TabBar';
import useAppSetup from './hooks/useAppSetup';
import useAuth from './hooks/useAuth';
import Auth from './screens/Auth';
import Home from './screens/Home';
import Learn from './screens/Learn';
import Read from './screens/Read';

const Tab = createBottomTabNavigator();

export default function App() {
    const { books, setBooks, currentBook, setCurrentBook, preprocessOnOpen, setPreprocessOnOpen, updateBookPreprocessed } = useAppSetup();
    const { user, loading, signOut } = useAuth();

    if (loading) {
        return (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#d9e2ec' }}>
                <ActivityIndicator size="large" color="#0f609b" />
            </View>
        );
    }

    return (
        <TranslatorProvider>
            <NavigationContainer>
                {!user ? (
                    <Auth />
                ) : (
                <Tab.Navigator screenOptions={tabScreenOptions}>
                    <Tab.Screen name="Home">
                        {props => (
                            <Home
                                {...props}
                                books={books}
                                setBooks={setBooks}
                                currentBook={currentBook}
                                setCurrentBook={setCurrentBook}
                                setPreprocessOnOpen={setPreprocessOnOpen}
                                signOut={signOut}
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
                                onPreprocessComplete={(uri) => {
                                    setPreprocessOnOpen(false);
                                    updateBookPreprocessed(uri);
                                }}
                            />
                        )}
                    </Tab.Screen>
                    <Tab.Screen name="Learn" component={Learn} />
                </Tab.Navigator>
                )}
            </NavigationContainer>
        </TranslatorProvider>
    );
}
