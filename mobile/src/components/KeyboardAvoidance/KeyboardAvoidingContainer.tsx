/**
 * Keyboard Avoiding View Component
 * Automatically adjusts view position when keyboard appears.
 *
 * Uses the `useKeyboardAvoidance` hook's animated translateY exclusively.
 * The native KeyboardAvoidingView has been intentionally removed to avoid
 * double-compensation on iOS (both mechanisms react to the same keyboard
 * event and would shift content up by ~2× the keyboard height).
 */

import React, { useMemo } from 'react';
import {
  Animated,
  ViewProps,
  StyleSheet,
} from 'react-native';
import { useKeyboardAvoidance } from '../../hooks/useKeyboardAvoidance';

interface KeyboardAvoidingContainerProps extends ViewProps {
  children: React.ReactNode;
  offset?: number;
}

export const KeyboardAvoidingContainer: React.FC<KeyboardAvoidingContainerProps> = ({
  children,
  offset = 20,
  style,
  ...props
}) => {
  const { animatedValue } = useKeyboardAvoidance();

  const animatedStyle = useMemo(
    () => ({
      transform: [{ translateY: animatedValue }],
    }),
    [animatedValue],
  );

  return (
    <Animated.View
      style={[
        styles.container,
        animatedStyle,
        style,
      ]}
      {...props}
    >
      {children}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
