/**
 * DashboardScreen — Issue 4
 * "Develop exact distinct native specific Dashboard analytics mappings accurately"
 *
 * Features:
 *  - 4 KPI metric cards (earnings, bounties, views, rating) with animated count-up
 *  - Earnings bar chart (7d / 30d / 90d / all periods)
 *  - Bounties bar chart with secondary comparison bars
 *  - Top skills horizontal bar chart
 *  - Recent activity feed
 *  - Period selector tabs
 *  - Offline-first via useOfflineData (cached data shown instantly)
 *  - Stale data indicator
 *  - Pull-to-refresh
 *  - Full dark mode via useTheme()
 *  - Zero frame drops: ScrollView + memoized sections
 */

import React, {
  useCallback,
  useMemo,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MetricCard } from '../components/dashboard/MetricCard';
import { BarChart } from '../components/dashboard/BarChart';
import { SkillsChart } from '../components/dashboard/SkillsChart';
import { useTheme } from '../theme/ThemeProvider';
import { useOfflineData } from '../hooks/useOfflineData';
import { AnalyticsPeriod, DashboardData, MetricCard as MetricCardType } from '../types';
import { FontSize, FontWeight, Radius, Shadow, Spacing } from '../theme/tokens';


// ─── Mock fetcher (replace with real API call) ────────────────────────────────

function buildMockData(period: AnalyticsPeriod): DashboardData {
  const multiplier = period === '7d' ? 1 : period === '30d' ? 4 : period === '90d' ? 12 : 24;
  const points = period === '7d' ? 7 : period === '30d' ? 8 : period === '90d' ? 6 : 8;

  const labels7d  = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const labels30d = ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8'];
  const labels90d = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
  const labelsAll = ['Q1', 'Q2', 'Q3', 'Q4', 'Q1', 'Q2', 'Q3', 'Q4'];

  const labelSet =
    period === '7d'  ? labels7d  :
    period === '30d' ? labels30d :
    period === '90d' ? labels90d :
    labelsAll;

  return {
    period,
    metrics: [
      {
        id: 'earnings',
        label: 'Earnings',
        value: 1240 * multiplier,
        previousValue: 980 * multiplier,
        unit: 'XLM',
        trend: 'up',
        trendPct: 26.5,
      },
      {
        id: 'bounties',
        label: 'Bounties',
        value: 4 * multiplier,
        previousValue: 3 * multiplier,
        unit: '',
        trend: 'up',
        trendPct: 33.3,
      },
      {
        id: 'views',
        label: 'Profile Views',
        value: 312 * multiplier,
        previousValue: 280 * multiplier,
        unit: '',
        trend: 'up',
        trendPct: 11.4,
      },
      {
        id: 'rating',
        label: 'Avg Rating',
        value: 4.3,
        previousValue: 4.1,
        unit: '/ 5',
        trend: 'up',
        trendPct: 4.9,
      },
    ],
    earningsChart: Array.from({ length: points }, (_, i) => ({
      label: labelSet[i] ?? String(i + 1),
      value: Math.round(100 + Math.random() * 400 * multiplier),
      secondaryValue: Math.round(80 + Math.random() * 300 * multiplier),
    })),
    bountiesChart: Array.from({ length: points }, (_, i) => ({
      label: labelSet[i] ?? String(i + 1),
      value: Math.round(1 + Math.random() * 5),
    })),
    topSkills: [
      { skill: 'UX Design',    count: 18 },
      { skill: 'Branding',     count: 14 },
      { skill: 'Illustration', count: 11 },
      { skill: 'Motion',       count: 8  },
      { skill: 'Copywriting',  count: 6  },
    ],
    recentActivity: [
      { id: '1', label: 'Bounty completed — Logo Design',    time: '2h ago',  type: 'bounty'  },
      { id: '2', label: 'New review received — 5 stars',     time: '5h ago',  type: 'review'  },
      { id: '3', label: 'Payment received — 250 XLM',        time: '1d ago',  type: 'payment' },
      { id: '4', label: 'Profile viewed by Acme Corp',       time: '2d ago',  type: 'view'    },
      { id: '5', label: 'Application accepted — Brand Kit',  time: '3d ago',  type: 'bounty'  },
    ],
  };
}

async function fetchDashboard(period: AnalyticsPeriod): Promise<DashboardData> {
  // Simulate network latency
  await new Promise((r) => setTimeout(r, 600));
  return buildMockData(period);
}

// ─── Period tabs ──────────────────────────────────────────────────────────────

const PERIODS: { key: AnalyticsPeriod; label: string }[] = [
  { key: '7d',  label: '7D'  },
  { key: '30d', label: '30D' },
  { key: '90d', label: '90D' },
  { key: 'all', label: 'All' },
];

// ─── Activity type icon ───────────────────────────────────────────────────────

const ACTIVITY_ICON: Record<string, string> = {
  bounty:  '📋',
  review:  '⭐',
  payment: '💰',
  view:    '👁️',
};

// ─── Screen ───────────────────────────────────────────────────────────────────

export function DashboardScreen({ navigation }: { navigation?: any }) {
  const { colors, isDark } = useTheme();
  const [period, setPeriod] = useState<AnalyticsPeriod>('30d');

  const fetcher = useCallback(() => fetchDashboard(period), [period]);

  const { data, isLoading, isStale, cachedAt, refetch } = useOfflineData<DashboardData>(
    `dashboard-${period}`,
    fetcher,
    { ttlMs: 5 * 60 * 1000 },
  );

  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const handlePeriodChange = useCallback((p: AnalyticsPeriod) => {
    setPeriod(p);
  }, []);

  // ── Memoised sections ───────────────────────────────────────────────────────

  const MetricsSection = useMemo(() => {
    if (!data) return null;
    const pairs: [MetricCardType, MetricCardType][] = [
      [data.metrics[0], data.metrics[1]],
      [data.metrics[2], data.metrics[3]],
    ];
    return (
      <View style={styles.metricsGrid}>
        {pairs.map((pair, i) => (
          <View key={i} style={styles.metricsRow}>
            <MetricCard metric={pair[0]} style={styles.metricCell} />
            <MetricCard metric={pair[1]} style={styles.metricCell} />
          </View>
        ))}
      </View>
    );
  }, [data]);

  const EarningsSection = useMemo(() => {
    if (!data) return null;
    return (
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>Earnings</Text>
        <Text style={[styles.cardSubtitle, { color: colors.textTertiary }]}>
          Current vs previous period
        </Text>
        <BarChart
          data={data.earningsChart}
          height={140}
          barColor={colors.primary}
          secondaryColor={colors.primaryLight}
          style={styles.chart}
          accessibilityLabel="Earnings bar chart"
        />
      </View>
    );
  }, [data, colors]);

  const BountiesSection = useMemo(() => {
    if (!data) return null;
    return (
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>Bounties Completed</Text>
        <BarChart
          data={data.bountiesChart}
          height={120}
          barColor={colors.accent}
          style={styles.chart}
          showValues
          accessibilityLabel="Bounties bar chart"
        />
      </View>
    );
  }, [data, colors]);

  const SkillsSection = useMemo(() => {
    if (!data) return null;
    return (
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>Top Skills</Text>
        <Text style={[styles.cardSubtitle, { color: colors.textTertiary }]}>
          By completed bounties
        </Text>
        <View style={styles.chartPad}>
          <SkillsChart skills={data.topSkills} />
        </View>
      </View>
    );
  }, [data, colors]);

  const ActivitySection = useMemo(() => {
    if (!data) return null;
    return (
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>Recent Activity</Text>
        {data.recentActivity.map((item, i) => (
          <View
            key={item.id}
            style={[
              styles.activityRow,
              i < data.recentActivity.length - 1 && {
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: colors.border,
              },
            ]}
          >
            <Text style={styles.activityIcon}>{ACTIVITY_ICON[item.type] ?? '📌'}</Text>
            <View style={styles.activityText}>
              <Text style={[styles.activityLabel, { color: colors.text }]} numberOfLines={1}>
                {item.label}
              </Text>
              <Text style={[styles.activityTime, { color: colors.textTertiary }]}>
                {item.time}
              </Text>
            </View>
          </View>
        ))}
      </View>
    );
  }, [data, colors]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View>
          <Text style={[styles.title, { color: colors.text }]}>Dashboard</Text>
          {isStale && cachedAt && (
            <Text style={[styles.staleNote, { color: colors.warning }]}>
              ⚠️ Showing cached data from {cachedAt.toLocaleTimeString()}
            </Text>
          )}
        </View>
        {isLoading && !refreshing && (
          <ActivityIndicator color={colors.primary} size="small" />
        )}
      </View>

      {/* Period selector */}
      <View style={[styles.periodBar, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        {PERIODS.map((p) => (
          <Pressable
            key={p.key}
            onPress={() => handlePeriodChange(p.key)}
            style={[
              styles.periodTab,
              period === p.key && { backgroundColor: colors.primary, borderRadius: Radius.md },
            ]}
            accessibilityRole="tab"
            accessibilityState={{ selected: period === p.key }}
            accessibilityLabel={`${p.label} period`}
          >
            <Text
              style={[
                styles.periodLabel,
                { color: period === p.key ? '#fff' : colors.textSecondary },
              ]}
            >
              {p.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {isLoading && !data ? (
          <View style={styles.loadingCenter}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
              Loading analytics…
            </Text>
          </View>
        ) : (
          <>
            {MetricsSection}
            {EarningsSection}
            {BountiesSection}
            {SkillsSection}
            {ActivitySection}
            <Pressable
              onPress={() => navigation?.navigate('FocusTimer')}
              style={[styles.focusModeCard, { backgroundColor: colors.surface, borderColor: colors.primary + '40' }]}
              accessibilityRole="button"
              accessibilityLabel="Open Focus Mode"
            >
              <Text style={[styles.focusModeTitle, { color: colors.text }]}>🍅 Focus Mode</Text>
              <Text style={[styles.focusModeSubtitle, { color: colors.textSecondary }]}>
                Start a Pomodoro session
              </Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.base,
    paddingBottom: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: FontSize['2xl'], fontWeight: FontWeight.bold },
  staleNote: { fontSize: FontSize.xs, marginTop: 2 },
  periodBar: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: Spacing.xs,
  },
  periodTab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.xs,
  },
  periodLabel: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  content: {
    padding: Spacing.base,
    paddingBottom: Spacing['3xl'],
    gap: Spacing.md,
  },
  metricsGrid: { gap: Spacing.sm },
  metricsRow: { flexDirection: 'row', gap: Spacing.sm },
  metricCell: { flex: 1 },
  card: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    padding: Spacing.base,
    ...Shadow.sm,
  },
  cardTitle: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.bold,
    marginBottom: 2,
  },
  cardSubtitle: {
    fontSize: FontSize.xs,
    marginBottom: Spacing.sm,
  },
  chart: { marginTop: Spacing.sm },
  chartPad: { marginTop: Spacing.sm },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
  },
  activityIcon: { fontSize: 18, width: 28, textAlign: 'center' },
  activityText: { flex: 1 },
  activityLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  activityTime: { fontSize: FontSize.xs, marginTop: 1 },
  loadingCenter: {
    alignItems: 'center',
    paddingTop: Spacing['4xl'],
    gap: Spacing.md,
  },
  loadingText: { fontSize: FontSize.base },
  focusModeCard: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    padding: Spacing.base,
    ...Shadow.sm,
  },
  focusModeTitle: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.bold,
    marginBottom: 2,
  },
  focusModeSubtitle: {
    fontSize: FontSize.sm,
  },
});
