/**
 * Tamgora Mobile — i18n engine
 *
 * Supports: en, es, fr, de, ar (RTL)
 * - Locale detection via expo-localization
 * - AsyncStorage persistence
 * - Safe interpolation (no prototype pollution)
 * - RTL layout flag
 * - Intl-based date / currency / number formatters
 */

import { getLocales } from 'expo-localization';
import en, { TranslationKeys } from './locales/en';
import es from './locales/es';
import fr from './locales/fr';
import de from './locales/de';
import ar from './locales/ar';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AppLocale = 'en' | 'es' | 'fr' | 'de' | 'ar';

export interface LocaleInfo {
  code: AppLocale;
  label: string;
  nativeLabel: string;
  rtl: boolean;
}

export type TranslationBundle = typeof en;

// ─── Constants ────────────────────────────────────────────────────────────────

export const SUPPORTED_LOCALES: AppLocale[] = ['en', 'es', 'fr', 'de', 'ar'];

export const LOCALE_INFO: Record<AppLocale, LocaleInfo> = {
  en: { code: 'en', label: 'English',  nativeLabel: 'English',   rtl: false },
  es: { code: 'es', label: 'Spanish',  nativeLabel: 'Español',   rtl: false },
  fr: { code: 'fr', label: 'French',   nativeLabel: 'Français',  rtl: false },
  de: { code: 'de', label: 'German',   nativeLabel: 'Deutsch',   rtl: false },
  ar: { code: 'ar', label: 'Arabic',   nativeLabel: 'العربية',   rtl: true  },
};

const BUNDLES: Record<AppLocale, TranslationBundle> = { en, es, fr, de, ar };

export const DEFAULT_LOCALE: AppLocale = 'en';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Guard against prototype-pollution style keys. */
function assertSafeKey(key: string): void {
  if (!key || key.length > 512) throw new Error(`Invalid i18n key: "${key}"`);
  if (
    key.includes('__proto__') ||
    key.includes('constructor') ||
    key.includes('prototype')
  ) {
    throw new Error(`Unsafe i18n key: "${key}"`);
  }
  for (const seg of key.split('.')) {
    if (seg.startsWith('__')) throw new Error(`Unsafe i18n key segment: "${seg}"`);
  }
}

/** Traverse a nested object by dot-path. */
function getByPath(obj: unknown, path: string): unknown {
  assertSafeKey(path);
  return path.split('.').reduce<unknown>((cur, seg) => {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    return (cur as Record<string, unknown>)[seg];
  }, obj);
}

/** Replace {{param}} placeholders. */
function interpolate(
  template: string,
  params?: Record<string, string | number>,
): string {
  if (!params) return template;
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, name: string) => {
    const v = params[name];
    return v === undefined || v === null ? '' : String(v);
  });
}

// ─── Core i18n class ──────────────────────────────────────────────────────────

class I18nService {
  private _locale: AppLocale = DEFAULT_LOCALE;
  private _bundle: TranslationBundle = en;
  private _listeners: Array<(locale: AppLocale) => void> = [];

  get locale(): AppLocale {
    return this._locale;
  }

  get isRtl(): boolean {
    return LOCALE_INFO[this._locale].rtl;
  }

  get bundle(): TranslationBundle {
    return this._bundle;
  }

  /** Translate a dot-path key with optional interpolation params. */
  t(key: string, params?: Record<string, string | number>): string {
    const raw = getByPath(this._bundle, key);
    if (typeof raw !== 'string') {
      // Fallback to English bundle
      const fallback = getByPath(en, key);
      if (typeof fallback === 'string') return interpolate(fallback, params);
      return key; // last resort: return the key itself
    }
    return interpolate(raw, params);
  }

  /** Change the active locale and notify listeners. */
  setLocale(locale: AppLocale): void {
    if (!SUPPORTED_LOCALES.includes(locale)) {
      console.warn(`[i18n] Unsupported locale "${locale}", falling back to "${DEFAULT_LOCALE}"`);
      locale = DEFAULT_LOCALE;
    }
    this._locale = locale;
    this._bundle = BUNDLES[locale];
    this._listeners.forEach((cb) => cb(locale));
  }

  /** Subscribe to locale changes. Returns an unsubscribe function. */
  subscribe(cb: (locale: AppLocale) => void): () => void {
    this._listeners.push(cb);
    return () => {
      this._listeners = this._listeners.filter((l) => l !== cb);
    };
  }

  /**
   * Detect the best locale from the device.
   * Priority: device locale tags → DEFAULT_LOCALE.
   */
  detectDeviceLocale(): AppLocale {
    try {
      const deviceLocales = getLocales();
      for (const loc of deviceLocales) {
        const tag = loc.languageTag ?? '';
        const base = tag.split('-')[0]?.toLowerCase() as AppLocale;
        if (SUPPORTED_LOCALES.includes(base)) return base;
      }
    } catch {
      // expo-localization not available in test env
    }
    return DEFAULT_LOCALE;
  }

  /** Initialise with device locale (call once at app startup). */
  init(overrideLocale?: AppLocale): void {
    const locale = overrideLocale ?? this.detectDeviceLocale();
    this.setLocale(locale);
  }

  // ── Intl formatters ─────────────────────────────────────────────────────────

  formatDate(
    date: Date | number,
    options?: Intl.DateTimeFormatOptions,
  ): string {
    const d = typeof date === 'number' ? new Date(date) : date;
    return new Intl.DateTimeFormat(this._locale, {
      dateStyle: 'medium',
      ...options,
    }).format(d);
  }

  formatDateTime(date: Date | number): string {
    const d = typeof date === 'number' ? new Date(date) : date;
    return new Intl.DateTimeFormat(this._locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(d);
  }

  formatCurrency(amount: number, currency = 'USD'): string {
    return new Intl.NumberFormat(this._locale, {
      style: 'currency',
      currency,
    }).format(amount);
  }

  formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
    return new Intl.NumberFormat(this._locale, options).format(value);
  }

  /**
   * Human-readable relative time (e.g. "2h ago").
   * Uses translation keys from common.* for consistency.
   */
  formatRelativeTime(date: Date | number): string {
    const d = typeof date === 'number' ? new Date(date) : date;
    const diffMs = Date.now() - d.getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    const diffHr  = Math.floor(diffMs / 3_600_000);
    const diffDay = Math.floor(diffMs / 86_400_000);

    if (diffMin < 1)  return this.t('common.justNow');
    if (diffMin < 60) return this.t('common.minutesAgo', { count: diffMin });
    if (diffHr  < 24) return this.t('common.hoursAgo',   { count: diffHr  });
    if (diffDay === 1) return this.t('common.yesterday');
    return this.t('common.daysAgo', { count: diffDay });
  }
}

// ─── Singleton export ─────────────────────────────────────────────────────────

export const i18n = new I18nService();
export default i18n;
