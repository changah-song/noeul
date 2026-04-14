import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { TranslatorProvider } from 'react-native-translator';
import { tabScreenOptions } from './components/shared/TabBar';
import useAppSetup from './hooks/useAppSetup';
import Home from './screens/Home';
import Learn from './screens/Learn';
import Read from './screens/Read';

const Tab = createBottomTabNavigator();

export default function App() {
    const { books, setBooks, currentBook, setCurrentBook, preprocessOnOpen, setPreprocessOnOpen, updateBookPreprocessed } = useAppSetup();

    return (
        <TranslatorProvider>
            <NavigationContainer>
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
            </NavigationContainer>
        </TranslatorProvider>
    );
}