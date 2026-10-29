import { useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import CoachTip from './CoachTip';

// CoachTip over a whole screen: place it last inside the screen's root view.
// It brings its own full-size container to measure the anchor against.
export default function ScreenCoachTip(props) {
    const containerRef = useRef(null);
    if (!props.visible) return null;
    return (
        <View ref={containerRef} collapsable={false} pointerEvents="box-none" style={StyleSheet.absoluteFill}>
            <CoachTip {...props} containerRef={containerRef} />
        </View>
    );
}
