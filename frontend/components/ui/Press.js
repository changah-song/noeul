import React, { useRef } from 'react';
import { Animated, Pressable } from 'react-native';

// Noeul press feedback — the universal `.press` treatment: every tappable
// scales to 0.97 and fades to 0.9 over ~120ms while held.
// `style` goes on the animated content view; use `containerStyle` for
// layout styles that must live on the Pressable itself (e.g. flex: 1).
const Press = ({
  children,
  onPress,
  onLongPress,
  disabled = false,
  style,
  containerStyle,
  scaleTo = 0.97,
  opacityTo = 0.9,
  ...rest
}) => {
  const anim = useRef(new Animated.Value(0)).current;

  const animateTo = (toValue) => {
    Animated.timing(anim, {
      toValue,
      duration: 120,
      useNativeDriver: true,
    }).start();
  };

  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [1, scaleTo] });
  const opacity = anim.interpolate({ inputRange: [0, 1], outputRange: [1, opacityTo] });

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      onPressIn={() => animateTo(1)}
      onPressOut={() => animateTo(0)}
      style={containerStyle}
      {...rest}
    >
      <Animated.View style={[style, { transform: [{ scale }], opacity }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
};

export default Press;
