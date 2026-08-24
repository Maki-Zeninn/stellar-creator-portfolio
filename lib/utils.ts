import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ── Formatting utilities ──────────────────────────────────────────────────────

/**
 * Format a number as a currency string.
 * @example formatCurrency(3000) // "$3,000"
 * @example formatCurrency(1500, 'EUR') // "€1,500"
 */
export function formatCurrency(amount: number, currency = 'USD', maximumFractionDigits = 0): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits,
  }).format(amount);
}

/**
 * Format an ISO date string or Date object as a localised date.
 * @example formatDate('2025-08-12') // "Aug 12, 2025"
 */
export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(date));
}

/**
 * Return a human-readable relative time string.
 * @example formatRelativeDate(new Date(Date.now() - 2 * 86400000)) // "2 days ago"
 */
export function formatRelativeDate(date: string | Date): string {
  const diffMs = Date.now() - new Date(date).getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

/**
 * Format a deadline Date as "X days left" or "Expired".
 */
export function formatDeadline(deadline: Date | string): string {
  const diffMs = new Date(deadline).getTime() - Date.now();
  const diffDays = Math.ceil(diffMs / 86_400_000);
  if (diffDays < 0) return 'Expired';
  if (diffDays === 0) return 'Due today';
  if (diffDays === 1) return '1 day left';
  return `${diffDays} days left`;
}

/**
 * Capitalise the first letter of a string.
 */
export function capitalise(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Format a star rating as "4.8 / 5" or "No ratings yet".
 */
export function formatRating(rating?: number, reviewCount?: number): string {
  if (rating == null) return 'No ratings yet';
  const reviews = reviewCount != null ? ` (${reviewCount})` : '';
  return `${rating.toFixed(1)} / 5${reviews}`;
}

/**
 * Format years of experience as "8 yrs exp" or "< 1 yr exp".
 */
export function formatExperience(years?: number): string {
  if (years == null || years < 1) return '< 1 yr exp';
  return `${years} yr${years === 1 ? '' : 's'} exp`;
}

/**
 * Truncate a string to maxLength, appending "…" if truncated.
 */
export function truncate(str: string, maxLength: number): string {
  return str.length <= maxLength ? str : `${str.slice(0, maxLength)}…`;
}

/**
 * Format a byte count as a human-readable file size (e.g. "4.2 MB").
 * Assumes `bytes` is a non-negative integer; base-1024 units (KB/MB/GB),
 * not base-1000, matching how OS file browsers typically display size.
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  return `${exponent === 0 ? value : value.toFixed(1)} ${units[exponent]}`;
}

/**
 * Parse a raw bounty status string into a normalized status label.
 * Assumes `status` is one of the known lowercase/snake_case values used by
 * the bounty API; anything else falls back to "Unknown" rather than throwing,
 * since this is used directly in UI rendering.
 */
export function parseBountyStatus(status: string): string {
  const map: Record<string, string> = {
    open: 'Open',
    in_progress: 'In Progress',
    submitted: 'Submitted',
    completed: 'Completed',
    cancelled: 'Cancelled',
    expired: 'Expired',
  };
  return map[status?.toLowerCase()] ?? 'Unknown';
}
