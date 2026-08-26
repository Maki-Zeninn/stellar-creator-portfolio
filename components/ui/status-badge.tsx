/**
 * StatusBadge — shared pill badge for entity status values.
 *
 * Consolidates the repeated
 *   <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${STATUS_COLORS[status]}`}>
 * markup that was copy-pasted across the admin pages (bounties, users,
 * reports, disputes) into one canonical component (closes #1217).
 *
 * Usage:
 *   <StatusBadge status="open" />
 *   <StatusBadge status="active" colorMap={MY_CUSTOM_COLORS} />
 */

import { cn } from '@/lib/utils';

// Default colour map covers the union of all statuses used across admin pages.
const DEFAULT_COLORS: Record<string, string> = {
  // Bounty statuses
  open: 'bg-green-500/10 text-green-600 border-green-500/20',
  'in-progress': 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  completed: 'bg-muted text-muted-foreground border-border',
  cancelled: 'bg-muted text-muted-foreground border-border',
  flagged: 'bg-red-500/10 text-red-600 border-red-500/20',
  // User statuses
  active: 'bg-green-500/10 text-green-600 border-green-500/20',
  suspended: 'bg-red-500/10 text-red-600 border-red-500/20',
  pending: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  // Report statuses
  resolved: 'bg-green-500/10 text-green-600 border-green-500/20',
  dismissed: 'bg-muted text-muted-foreground border-border',
  escalated: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  removed: 'bg-purple-500/10 text-purple-700 border-purple-500/20',
  // Dispute statuses
  closed: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
};

interface StatusBadgeProps {
  /** The status string to display and colour. */
  status: string;
  /**
   * Optional override colour map. Keys are status strings; values are
   * Tailwind class strings. Falls back to DEFAULT_COLORS for any key not
   * present in the override.
   */
  colorMap?: Record<string, string>;
  className?: string;
}

export function StatusBadge({ status, colorMap, className }: StatusBadgeProps) {
  const map = colorMap ?? DEFAULT_COLORS;
  const colorClasses = map[status] ?? DEFAULT_COLORS[status] ?? 'bg-muted text-muted-foreground border-border';

  return (
    <span
      className={cn(
        'text-xs px-2 py-0.5 rounded-full border font-medium',
        colorClasses,
        className,
      )}
    >
      {status}
    </span>
  );
}
