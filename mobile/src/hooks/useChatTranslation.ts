/**
 * useChatTranslation — Issue #617
 * Hook for real-time per-message translation with locale switching.
 *
 * Issue #1095: Added LRU eviction to prevent unbounded cache growth.
 * The cache is capped at MAX_TRANSLATION_CACHE entries; when the cap is
 * reached, the oldest entries are evicted to maintain a bounded footprint.
 */

import { useCallback, useRef, useState } from 'react';
import { AppLocale } from '../i18n';
import { ChatTranslationService } from '../services/ChatTranslationService';

/** Maximum number of cached message translations before LRU eviction. */
const MAX_TRANSLATION_CACHE = 200;

export interface MessageTranslation {
  translatedText: string;
  isLoading: boolean;
  error: string | null;
  isVisible: boolean;
}

export function useChatTranslation(targetLocale: AppLocale) {
  const [translations, setTranslations] = useState<Record<string, MessageTranslation>>({});
  const accessOrder = useRef<string[]>([]);

  /**
   * Evict oldest entries when the cache exceeds MAX_TRANSLATION_CACHE.
   * Uses a simple FIFO strategy based on insertion order (accessOrder ref).
   */
  const evictIfNeeded = useCallback((current: Record<string, MessageTranslation>) => {
    const keys = Object.keys(current);
    if (keys.length <= MAX_TRANSLATION_CACHE) return current;

    // Evict oldest entries that are not currently visible
    const toRemove: string[] = [];
    const visibleKeys = new Set(
      accessOrder.current.filter((k) => current[k]?.isVisible),
    );

    for (const key of accessOrder.current) {
      if (keys.length - toRemove.length <= MAX_TRANSLATION_CACHE) break;
      if (!visibleKeys.has(key)) {
        toRemove.push(key);
      }
    }

    // Update access order
    accessOrder.current = accessOrder.current.filter((k) => !toRemove.includes(k));

    const next = { ...current };
    for (const key of toRemove) {
      delete next[key];
    }
    return next;
  }, []);

  const toggleTranslation = useCallback(
    async (messageId: string, originalText: string, sourceLocale: AppLocale = 'en') => {
      const current = translations[messageId];

      // If already visible, hide it
      if (current?.isVisible) {
        setTranslations((prev) => ({
          ...prev,
          [messageId]: { ...prev[messageId], isVisible: false },
        }));
        return;
      }

      // If already translated (cached), just show it
      if (current?.translatedText && !current.error) {
        // Move to end of access order (LRU update)
        accessOrder.current = accessOrder.current.filter((id) => id !== messageId);
        accessOrder.current.push(messageId);
        setTranslations((prev) => ({
          ...prev,
          [messageId]: { ...prev[messageId], isVisible: true },
        }));
        return;
      }

      // Track access order for LRU
      if (!accessOrder.current.includes(messageId)) {
        accessOrder.current.push(messageId);
      }

      // Start loading
      setTranslations((prev) => {
        const updated = {
          ...prev,
          [messageId]: { translatedText: '', isLoading: true, error: null, isVisible: true },
        };
        return evictIfNeeded(updated);
      });

      try {
        const result = await ChatTranslationService.translate(
          originalText,
          targetLocale,
          sourceLocale,
        );
        setTranslations((prev) => evictIfNeeded({
          ...prev,
          [messageId]: {
            translatedText: result.translatedText,
            isLoading: false,
            error: null,
            isVisible: true,
          },
        }));
      } catch {
        setTranslations((prev) => evictIfNeeded({
          ...prev,
          [messageId]: {
            translatedText: '',
            isLoading: false,
            error: 'Translation failed',
            isVisible: true,
          },
        }));
      }
    },
    [targetLocale, translations, evictIfNeeded],
  );

  const clearTranslations = useCallback(() => {
    accessOrder.current = [];
    setTranslations({});
  }, []);

  return { translations, toggleTranslation, clearTranslations };
}
