import { StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

// The mark a finished book keeps on the shelf: a bookmark ribbon hanging
// from the top of the cover, near its opening edge. Sits beside Book3D (not
// inside it, which clips), so place it in the cover's container.
const FinishedRibbon = ({ color, iconColor, size = 'regular', style }) => {
    const width = size === 'small' ? 12 : 16;
    const body = size === 'small' ? 13 : 18;
    const notch = size === 'small' ? 4 : 5;
    return (
        <View pointerEvents="none" style={[styles.ribbon, { width }, style]}>
            <View style={[styles.body, { height: body, backgroundColor: color }]}>
                <Feather name="check" size={size === 'small' ? 8 : 10} color={iconColor} />
            </View>
            <View
                style={{
                    width: 0,
                    height: 0,
                    borderLeftWidth: width / 2,
                    borderRightWidth: width / 2,
                    borderBottomWidth: notch,
                    borderLeftColor: color,
                    borderRightColor: color,
                    borderBottomColor: 'transparent',
                }}
            />
        </View>
    );
};

const styles = StyleSheet.create({
    ribbon: {
        position: 'absolute',
        top: 0,
        alignItems: 'center',
    },
    body: {
        alignSelf: 'stretch',
        alignItems: 'center',
        justifyContent: 'flex-end',
        paddingBottom: 2,
    },
});

export default FinishedRibbon;
