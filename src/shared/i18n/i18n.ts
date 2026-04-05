import type { Language } from '../types/index.js';
import { CATALOGS, type Catalog, type TranslationKey } from './catalog.js';

export type TranslationParams = Readonly<Record<string, string | number>>;

export interface II18n {
  readonly language: Language;

  t(key: TranslationKey, params?: TranslationParams): string;

  setLanguage(language: Language): void;

  onChange(listener: (language: Language) => void): () => void;
}

export class I18n implements II18n {
  private current: Language;
  private catalog: Catalog;
  private readonly listeners = new Set<(language: Language) => void>();

  constructor(language: Language = 'en') {
    this.current = language;
    this.catalog = CATALOGS[language];
    // Bind so callers can safely destructure `const { t } = i18n`.
    this.t = this.t.bind(this);
  }

  get language(): Language {
    return this.current;
  }

  t(key: TranslationKey, params?: TranslationParams): string {
    const template = this.catalog[key] ?? CATALOGS.en[key] ?? key;
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (match, token: string) => {
      const value = params[token];
      return value === undefined ? match : String(value);
    });
  }

  setLanguage(language: Language): void {
    if (language === this.current) return;
    this.current = language;
    this.catalog = CATALOGS[language];
    for (const listener of [...this.listeners]) listener(language);
  }

  onChange(listener: (language: Language) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
