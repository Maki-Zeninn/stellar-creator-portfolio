/**
 * ActivityTimelineScreen
 *
 * Issue 2 — "Construct explicit comprehensive global Activity timeline
 * summaries internally"
 *
 * Features:
 *  - Weekly summary card (total events, earnings, bounties, unread)
 *  - Chronological timeline with section headers (Today / Yesterday / This Week / Earlier)
 *  - Filter tabs: All / Bounties / Reviews / Payments / Messages / Applications
 *  - Mark-all-read action
 *  - Infinite scroll with load-more
 *  - SectionList for zero frame drops (native section rendering)
 *  - Full i18n + haptics + accessibility
 */

import React, {
  useCallback,
  useMemo,
  useState,
} from 'react';
import {
  Alert,
  Pressable,
  SafeAreaView,
  SectionList,
  SectionListData,
  SectionListRenderItem,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { ActivityEventItem } from '../components/activity/ActivityEventItem';
import { ActivitySummaryCard } from '../components/activity/ActivitySummaryCard';
import { EmptyState } from '../components/ui/EmptyState';
import {
  Colors,
  FontSize,
  FontWeight,
  Radius,
  Spacing,
} from '../theme/tokens';
import {
  ActivityEvent,
  ActivityEventType,
  ActivityFilterType,
  ActivitySummary,
} from '../types';
import { useI18n } from '../i18n/I18nProvider';

// ─── Mock data ────────────────────────────────────────────────────────────────

const EVENT_TYPES: ActivityEventType[] = [
  'bounty_posted', 'bounty_applied', 'bounty_accepted', 'bounty_completed',
  'review_received', 'review_left', 'payment_received', 'payment_sent',
  'message_received', 'profile_viewed', 'match_found', 'dispute_resolved',
];

const MOCK_EVENTS: ActivityEvent[] = Array.from({ length: 30 }, (_, i) => ({
  id: `evt-${i}`,
  type: EVENT_TYPES[i % EVENT_TYPES.length],
  title: '',
  subtitle: i % 4 === 0 ? 'Logo design for Tamgora platform' : undefined,
  amount: [4, 7, 11].includes(i % 12) ? 250 + i * 10 : undefined,
  relatedId: `item-${i}`,
  relatedName: ['Alice Chen', 'Stellar Bounty #42', 'Bob Martinez', undefined][i % 4] ?? undefined,
  avatarUrl: undefined,
  read: i > 5,
  createdAt: new Date(Date.now() - i * 3_600_000 * 8).toISOString(),
}));

const MOCK_SUMMARY: ActivitySummary = {
  totalEvents: 30,
  unreadCount: 6,
  weeklyEarnings: 1240,
  weeklyBounties: 4,
};

// ─── Filter mapping ───────────────────────────────────────────────────────────

const FILTER_EVENT_TYPES: Record<ActivityFilterType, ActivityEventType[] | null> = {
  all:          null,
  bounties:     ['bounty_posted', 'bounty_applied', 'bounty_accepted', 'bounty_rejected', 'bounty_completed'],
  reviews:      ['review_received', 'review_left'],
  payments:     ['payment_received', 'payment_sent'],
  messages:     ['message_received'],
  applications: ['bounty_applied', 'bounty_accepted', 'bounty_rejected'],
};

// ─── Section grouping ─────────────────────────────────────────────────────────

interface TimelineSection {
  title: string;
  data: ActivityEvent[];
}

function groupIntoSections(
  events: ActivityEvent[],
  labels: { today: string; yesterday: string; thisWeek: string; older: string },
): TimelineSection[] {
  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86_400_000);
  const weekAgo   = new Date(today.getTime() - 7 * 86_400_000);

  const buckets: Record<string, ActivityEvent[]> = {
    [labels.today]:     [],
    [labels.yesterday]: [],
    [labels.thisWeek]:  [],
    [labels.older]:     [],
  };

  for (const evt of events) {
    const d = new Date(evt.createdAt);
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    if (day >= today)          buckets[labels.today].push(evt);
    else if (day >= yesterday) buckets[labels.yesterday].push(evt);
    else if (day >= weekAgo)   buckets[labels.thisWeek].push(evt);
    else                       buckets[labels.older].push(evt);
  }

  return Object.entries(buckets)
    .filter(([, data]) => data.length > 0)
    .map(([title, data]) => ({ title, data }));
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ActivityTimelineScreen() {
  const { t } = useI18n();

  const [events, setEvents]         = useState<ActivityEvent[]>(MOCK_EVENTS);
  const [filter, setFilter]         = useState<ActivityFilterType>('all');
  const [page, setPage]             = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);

  const PAGE_SIZE = 10;

  const filtered = useMemo(() => {
    const allowed = FILTER_EVENT_TYPES[filter];
    return allowed ? events.filter((e) => allowed.includes(e.type)) : events;
  }, [events, filter]);

  const visible = useMemo(() => filtered.slice(0, page * PAGE_SIZE), [filtered, page]);

  const sections = useMemo(
    () =>
      groupIntoSections(visible, {
        today:     t('activity.todaySection'),
        yesterday: t('activity.yesterdaySection'),
        thisWeek:  t('activity.thisWeekSection'),
        older:     t('activity.olderSection'),
      }),
    [visible, t],
  );

  const handleMarkAllRead = useCallback(async () => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setEvents((prev) => prev.map((e) => ({ ...e, read: true })));
  }, []);

  const handleFilterChange = useCallback(async (f: ActivityFilterType) => {
    await Haptics.selectionAsync();
    setFilter(f);
    setPage(1);
  }, []);

  const handleLoadMore = useCallback(async () => {
    if (loadingMore || visible.length >= filtered.length) return;
    setLoadingMore(true);
    await new Promise((r) => setTimeout(r, 500));
    setPage((p) => p + 1);
    setLoadingMore(false);
  }, [loadingMore, visible.length, filtered.length]);

  const handleEventPress = useCallback((event: ActivityEvent) => {
    Alert.alert(event.type.replace(/_/g, ' '), event.relatedName ?? event.id);
  }, []);

  // ── Filter tabs ─────────────────────────────────────────────────────────────

  const FILTER_TABS: { key: ActivityFilterType; label: string }[] = [
    { key: 'all',          label: t('activity.filterAll')          },
    { key: 'bounties',     label: t('activity.filterBounties')     },
    { key: 'reviews',      label: t('activity.filterReviews')      },
    { key: 'payments',     label: t('activity.filterPayments')     },
    { key: 'messages',     label: t('activity.filterMessages')     },
    { key: 'applications', label: t('activity.filterApplications') },
  ];

  // ── Render helpers ──────────────────────────────────────────────────────────

  const renderItem: SectionListRenderItem<ActivityEvent, TimelineSection> = useCallback(
    ({ item, section, index }) => {
      const isLast = index === section.data.length - 1;
      return (
        <ActivityEventItem
          event={item}
          isLast={isLast}
          onPress={handleEventPress}
        />
      );
    },
    [handleEventPress],
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: SectionListData<ActivityEvent, TimelineSection> }) => (
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionHeaderText}>{section.title}</Text>
      </View>
    ),
    [],
  );

  const keyExtractor = useCallback((item: ActivityEvent) => item.id, []);

  const unreadCount = useMemo(() => events.filter((e) => !e.read).length, [events]);

  const ListHeader = useMemo(
    () => (
      <View>
        <ActivitySummaryCard summary={{ ...MOCK_SUMMARY, unreadCount }} />

        {/* Filter tabs */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tabScroll}
          contentContainerStyle={styles.tabContent}
        >
          {FILTER_TABS.map((tab) => (
            <Pressable
              key={tab.key}
              onPress={() => handleFilterChange(tab.key)}
              style={[styles.tab, filter === tab.key && styles.tabActive]}
              accessibilityRole="tab"
              accessibilityState={{ selected: filter === tab.key }}
              accessibilityLabel={tab.label}
            >
              <Text style={[styles.tabText, filter === tab.key && styles.tabTextActive]}>
                {tab.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [unreadCount, filter, t],
  );

  const ListFooter = useMemo(() => {
    if (visible.length >= filtered.length) return null;
    return (
      <Pressable
        onPress={handleLoadMore}
        style={({ pressed }) => [styles.loadMoreBtn, pressed && { opacity: 0.7 }]}
        accessibilityRole="button"
        accessibilityLabel={t('activity.loadMore')}
      >
        <Text style={styles.loadMoreText}>
          {loadingMore ? t('activity.loadingMore') : t('activity.loadMore')}
        </Text>
      </Pressable>
    );
  }, [visible.length, filtered.length, loadingMore, handleLoadMore, t]);

  return (
    <SafeAreaView style={styles.safe}>
      {/* Screen header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.screenTitle}>{t('activity.screenTitle')}</Text>
          {unreadCount > 0 && (
            <Text style={styles.unreadBadge}>
              {unreadCount} {t('activity.unread')}
            </Text>
          )}
        </View>
        {unreadCount > 0 && (
          <Pressable
            onPress={handleMarkAllRead}
            style={({ pressed }) => [styles.markReadBtn, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel={t('activity.markAllRead')}
          >
            <Text style={styles.markReadText}>{t('activity.markAllRead')}</Text>
          </Pressable>
        )}
      </View>

      <SectionList
        sections={sections}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        keyExtractor={keyExtractor}
        ListHeaderComponent={ListHeader}
        ListFooterComponent={ListFooter}
        ListEmptyComponent={
          <EmptyState
            icon="📭"
            title={t('activity.noActivity')}
            subtitle={t('activity.noActivitySub')}
          />
        }
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        stickySectionHeadersEnabled={false}
        removeClippedSubviews
        maxToRenderPerBatch={8}
        windowSize={12}
        initialNumToRender={10}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.3}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.base,
    paddingBottom: Spacing.sm,
    backgroundColor: Colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  screenTitle: {
    fontSize: FontSize['2xl'],
    fontWeight: FontWeight.bold,
    color: Colors.text,
  },
  unreadBadge: {
    fontSize: FontSize.xs,
    color: Colors.primary,
    fontWeight: FontWeight.semibold,
    marginTop: 2,
  },
  markReadBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  markReadText: {
    fontSize: FontSize.xs,
    color: Colors.primary,
    fontWeight: FontWeight.semibold,
  },
  listContent: {
    paddingHorizontal: Spacing.base,
    paddingBottom: Spacing['3xl'],
  },
  tabScroll: {
    marginBottom: Spacing.sm,
  },
  tabContent: {
    paddingVertical: Spacing.sm,
    gap: Spacing.xs,
  },
  tab: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
    marginRight: Spacing.xs,
  },
  tabActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  tabText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    fontWeight: FontWeight.medium,
  },
  tabTextActive: {
    color: Colors.textInverse,
  },
  sectionHeader: {
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.xs,
    marginTop: Spacing.sm,
  },
  sectionHeaderText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
    color: Colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  loadMoreBtn: {
    alignItems: 'center',
    paddingVertical: Spacing.md,
  },
  loadMoreText: {
    fontSize: FontSize.base,
    color: Colors.primary,
    fontWeight: FontWeight.semibold,
  },
});
