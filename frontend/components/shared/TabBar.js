import { Entypo, FontAwesome6, Foundation } from '@expo/vector-icons';
import { Text, View, StyleSheet } from 'react-native';

const tabIcons = {
    Home: { Component: Entypo, name: 'home' },
    Read: { Component: FontAwesome6, name: 'book-open' },
    Learn: { Component: Foundation, name: 'pencil' },
};

export const tabScreenOptions = ({ route }) => ({
    headerShown: false,
    tabBarActiveTintColor: 'white',
    tabBarInactiveTintColor: '#f1e8e2',
    tabBarStyle: { backgroundColor: '#6e7b8b' },
    tabBarIcon: ({ focused, color }) => {
        const { Component, name } = tabIcons[route.name];
        const iconStyles = focused ? styles.iconFocused : styles.iconDefault;
        const iconColor = focused ? '#f4a261' : color;
        return (
            <View style={[styles.iconContainer, iconStyles]}>
                <Component name={name} color={iconColor} size={26} />
            </View>
        );
    },
    tabBarLabel: ({ focused }) => {
        const labelStyle = focused ? styles.labelFocused : styles.labelDefault;
        return (
            <Text style={[labelStyle, { color: 'white', fontFamily: 'Roboto', fontSize: 12 }]}>
                {route.name}
            </Text>
        );
    },
});

const styles = StyleSheet.create({
    iconContainer: {
        justifyContent: 'center',
        alignItems: 'center',
        top: 5,
    },
    iconDefault: {
        width: 50,
        height: 50,
        borderRadius: 10,
    },
    iconFocused: {
        top: -15,
        width: 50,
        height: 50,
        borderRadius: 25,
        backgroundColor: 'white',
    },
    labelDefault: {
        textAlign: 'center',
        marginTop: 5,
    },
    labelFocused: {
        fontWeight: 'bold',
        textAlign: 'center',
        marginTop: 5,
    },
});