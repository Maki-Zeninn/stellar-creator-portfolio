/**
 * Format a date as a localized string.
 * @example formatDate('2025-08-12') // "8/12/2025"
 */
export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString();
}
