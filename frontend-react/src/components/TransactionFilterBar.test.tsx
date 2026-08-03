import { describe, it, expect, beforeAll } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../i18n/locales/en.json';
import de from '../i18n/locales/de.json';
import ru from '../i18n/locales/ru.json';
import uk from '../i18n/locales/uk.json';
import TransactionFilterBar from './TransactionFilterBar';
import { EMPTY_FILTERS, type TransactionFilters } from '../utils/filterTransactions';

/**
 * Server-rendered structural checks.
 *
 * These cannot measure layout — pixel widths and clipping still need a real
 * browser. What they do guard is everything the markup is responsible for:
 * that both date pickers exist as separate labelled controls, that every
 * interactive element carries an accessible name in all four languages, and
 * that no translation key is missing (a missing key renders as the raw key,
 * which these assertions would catch).
 */

const LANGS = ['en', 'de', 'ru', 'uk'] as const;

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      de: { translation: de },
      ru: { translation: ru },
      uk: { translation: uk },
    },
    lng: 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });
});

function render(filters: TransactionFilters = EMPTY_FILTERS) {
  return renderToStaticMarkup(
    <TransactionFilterBar
      filters={filters}
      onChange={() => {}}
      onReset={() => {}}
      categories={[
        { id: 1, name: 'Food', translation_key: 'category.food' },
        { id: 2, name: 'Продукты у дома' },
      ]}
      resultCount={3}
      isFiltering={false}
    />,
  );
}

/** Pulls every aria-label value out of the markup. */
function ariaLabels(html: string): string[] {
  return [...html.matchAll(/aria-label="([^"]*)"/g)].map(m => m[1]);
}

describe('structure', () => {
  it('renders a single day picker in day mode', () => {
    const html = render({ ...EMPTY_FILTERS, dateMode: 'day' });
    expect(html.match(/type="date"/g)).toHaveLength(1);
    expect(html).not.toContain('tx-date-range-part');
  });

  it('renders TWO separate date pickers in range mode', () => {
    const html = render({ ...EMPTY_FILTERS, dateMode: 'range' });
    // Both pickers must exist as independent controls — the mobile fix stacks
    // them, so neither may be dropped or merged.
    expect(html.match(/type="date"/g)).toHaveLength(2);
    expect(html.match(/tx-date-range-part/g)).toHaveLength(2);
  });

  it('gives each range picker its own From/To tag', () => {
    const html = render({ ...EMPTY_FILTERS, dateMode: 'range' });
    expect(html.match(/tx-date-range-tag/g)).toHaveLength(2);
    expect(html).toContain('From');
    expect(html).toContain('To');
  });

  it('no longer emits the old shared separator', () => {
    const html = render({ ...EMPTY_FILTERS, dateMode: 'range' });
    expect(html).not.toContain('tx-date-range-sep');
  });

  it('wraps the toggle caption so CSS can hide it independently', () => {
    expect(render()).toContain('tx-filters-toggle-label');
  });

  it('shows the clear-search button only once there is a query', () => {
    expect(render()).not.toContain('tx-search-clear');
    expect(render({ ...EMPTY_FILTERS, query: 'молоко' })).toContain('tx-search-clear');
  });
});

describe('accessibility in all four languages', () => {
  for (const lng of LANGS) {
    describe(lng, () => {
      it('gives every control a non-empty accessible name', async () => {
        await i18n.changeLanguage(lng);
        const html = render({ ...EMPTY_FILTERS, dateMode: 'range', query: 'x' });

        const labels = ariaLabels(html);
        // search, filter toggle, clear search, category, date-mode group,
        // date from, date to, reset.
        expect(labels.length).toBeGreaterThanOrEqual(8);
        for (const label of labels) {
          expect(label.trim()).not.toBe('');
          // A missing i18n key renders as the key itself.
          expect(label).not.toMatch(/^transactions\./);
        }
      });

      it('renders no raw translation keys anywhere', async () => {
        await i18n.changeLanguage(lng);
        const html = render({ ...EMPTY_FILTERS, dateMode: 'range' });
        expect(html).not.toMatch(/transactions\.filter_/);
      });

      it('keeps the placeholder short enough to display unclipped', async () => {
        await i18n.changeLanguage(lng);
        const html = render();
        const ph = html.match(/placeholder="([^"]*)"/)?.[1] ?? '';
        expect(ph).not.toBe('');
        // The narrow-screen field has roughly 12 characters of room; the long
        // descriptive wording lives in aria-label instead.
        expect(ph.length).toBeLessThanOrEqual(12);
      });

      it('still describes the search fully for screen readers', async () => {
        await i18n.changeLanguage(lng);
        const html = render();
        const search = html.match(/class="tx-search-input"[^>]*aria-label="([^"]*)"/)?.[1]
          ?? ariaLabels(html)[0];
        expect(search.length).toBeGreaterThan(12);
      });

      it('never translates a custom category name', async () => {
        await i18n.changeLanguage(lng);
        expect(render()).toContain('Продукты у дома');
      });
    });
  }

  it('translates the built-in category per language', async () => {
    await i18n.changeLanguage('ru');
    expect(render()).toContain('Еда');
    await i18n.changeLanguage('de');
    expect(render()).toContain('Essen');
  });
});
