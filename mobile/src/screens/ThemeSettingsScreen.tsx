/**
 * ThemeSettingsScreen — Issue 3
 * "Establish native explicit operating system matched Dark mode logic centrally"
 *
 * - Three-way toggle: Light / Dark / System
 * - Live preview of the active theme
 * - Persisted via AsyncStorage (ThemeProvider handles persistence)
 * - Animated selection indicator
 * - Fully themed — all colors from useTheme()
 */

import React, { useCallback } from 'react';
import {
  Animated,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeMode } from '../types';
import { FontSize, FontWeight, Radius, Shadow, Spacing } from '../theme/tokens';

// ─── Option card ──────────────────────────────────────────────────────────────

interface ThemeOptionProps {
  mode: ThemeMode;
  label: string;
  icon: string;
  description: string;
  isSelected: boolean;
  onSelect: (mode: ThemeMode) => void;
}

function ThemeOption({ mode, label, icon, description, isSelected, onSelect }: ThemeOptionProps) {
  const { colors } = useTheme();
  const scaleAnim = React.useRef(new Animated.Value(1)).current;

  const handlePress = useCallback(async () => {
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 0.96, duration: 80, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 1,    duration: 120, useNativeDriver: true }),
    ]).start();
    await Haptics.selectionAsync();
    onSelect(mode);
  }, [mode, onSelect, scaleAnim]);

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <Pressable
        onPress={handlePress}
        style={[
          styles.optionCard,
          {
            backgroundColor: colors.surface,
            borderColor: isSelected ? colors.primary : colors.border,
            borderWidth: isSelected ? 2 : 1,
          },
          Shadow.sm,
        ]}
        accessibilityRole="radio"
        accessibilityState={{ checked: isSelected }}
        accessibilityLabel={`${label}: ${description}`}
      >
        <View style={[styles.optionIcon, { backgroundColor: isSelected ? colors.primary + '22' : colors.surfaceElevated }]}>
          <Text style={styles.optionEmoji}>{icon}</Text>
        </View>
        <View style={styles.optionText}>
          <Text style={[styles.optionLabel, { color: isSelected ? colors.primary : colors.text }]}>
            {label}
          </Text>
          <Text style={[styles.optionDesc, { color: colors.textSecondary }]}>
            {description}
          </Text>
        </View>
        {isSelected && (
          <View style={[styles.checkmark, { backgroundColor: colors.primary }]}>
            <Text style={styles.checkmarkText}>✓</Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

// ─── Preview card ─────────────────────────────────────────────────────────────

function ThemePreview() {
  const { colors, isDark } = useTheme();

  return (
    <View style={[styles.preview, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.previewLabel, { color: colors.textTertiary }]}>PREVIEW</Text>
      <View style={[styles.previewCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
        {/* Mock header */}
        <View style={[styles.previewHeader, { backgroundColor: colors.primary }]}>
          <View style={styles.previewHeaderDot} />
          <View style={[styles.previewHeaderBar, { backgroundColor: 'rgba(255,255,255,0.6)' }]} />
        </View>
        {/* Mock content rows */}
        {[1, 2, 3].map((i) => (
          <View key={i} style={styles.previewRow}>
            <View style={[styles.previewAvatar, { backgroundColor: colors.surfaceElevated }]} />
            <View style={styles.previewLines}>
              <View style={[styles.previewLine, { backgroundColor: colors.border, width: `${70 - i * 10}%` }]} />
              <View style={[styles.previewLine, { backgroundColor: colors.surfaceElevated, width: `${50 - i * 5}%` }]} />
            </View>
          </View>
        ))}
      </View>
      <Text style={[styles.previewMode, { color: colors.textSecondary }]}>
        {isDark ? '🌙 Dark mode active' : '☀️ Light mode active'}
      </Text>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

interface ThemeSettingsScreenProps {
  onBack?: () => void;
}

export function ThemeSettingsScreen({ onBack }: ThemeSettingsScreenProps) {
  const { colors, mode, setMode, isDark } = useTheme();

  const OPTIONS: Array<{ mode: ThemeMode; label: string; icon: string; description: string }> = [
    {
      mode: 'light',
      label: 'Light',
      icon: '☀️',
      description: 'Always use the light theme',
    },
    {
      mode: 'dark',
      label: 'Dark',
      icon: '🌙',
      description: 'Always use the dark theme',
    },
    {
      mode: 'system',
      label: 'System',
      icon: '⚙️',
      description: 'Match your device appearance setting',
    },
  ];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        {onBack && (
          <Pressable
            onPress={onBack}
            style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Text style={[styles.backText, { color: colors.primary }]}>‹ Back</Text>
          </Pressable>
        )}
        <Text style={[styles.title, { color: colors.text }]}>Appearance</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Choose how Tamgora looks on your device
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Live preview */}
        <ThemePreview />

        {/* Options */}
        <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>
          THEME MODE
        </Text>

        {OPTIONS.map((opt) => (
          <ThemeOption
            key={opt.mode}
            mode={opt.mode}
            label={opt.label}
            icon={opt.icon}
            description={opt.description}
            isSelected={mode === opt.mode}
            onSelect={setMode}
          />
        ))}

        {/* Info note */}
        <View style={[styles.note, { backgroundColor: colors.infoLight ?? colors.surfaceElevated }]}>
          <Text style={[styles.noteText, { color: colors.info ?? colors.textSecondary }]}>
            ℹ️  System mode automatically switches between light and dark based on your device's
            appearance settings (Settings → Display & Brightness on iOS).
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.base,
    paddingBottom: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { marginBottom: Spacing.xs },
  backText: { fontSize: FontSize.base, fontWeight: FontWeight.medium },
  title: { fontSize: FontSize['2xl'], fontWeight: FontWeight.bold },
  subtitle: { fontSize: FontSize.base, marginTop: 2 },
  content: { padding: Spacing.base, paddingBottom: Spacing['3xl'] },

  // Preview
  preview: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    padding: Spacing.base,
    marginBottom: Spacing.xl,
  },
  previewLabel: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
    letterSpacing: 0.8,
    marginBottom: Spacing.sm,
  },
  previewCard: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: Spacing.sm,
  },
  previewHeader: {
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
    gap: Spacing.xs,
  },
  previewHeaderDot: {
    width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.8)',
  },
  previewHeaderBar: {
    flex: 1, height: 8, borderRadius: 4,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.sm,
    gap: Spacing.sm,
  },
  previewAvatar: {
    width: 28, height: 28, borderRadius: 14,
  },
  previewLines: { flex: 1, gap: 4 },
  previewLine: { height: 6, borderRadius: 3 },
  previewMode: { fontSize: FontSize.sm, textAlign: 'center' },

  // Options
  sectionLabel: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
    letterSpacing: 0.8,
    marginBottom: Spacing.sm,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    gap: Spacing.md,
  },
  optionIcon: {
    width: 48, height: 48, borderRadius: Radius.md,
    alignItems: 'center', justifyContent: 'center',
  },
  optionEmoji: { fontSize: 24 },
  optionText: { flex: 1 },
  optionLabel: { fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  optionDesc: { fontSize: FontSize.sm, marginTop: 2 },
  checkmark: {
    width: 24, height: 24, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  checkmarkText: { color: '#fff', fontSize: FontSize.sm, fontWeight: FontWeight.bold },

  // Note
  note: {
    borderRadius: Radius.lg,
    padding: Spacing.md,
    marginTop: Spacing.sm,
  },
  noteText: { fontSize: FontSize.sm, lineHeight: 20 },
});
