import type { CustomDatabase, CustomDatabaseRow, FieldDef, FieldOption, FieldRole } from '../types';

// «ДОДАТКИ ТА СЕРВІСИ» - the template the user asked for (2026-10-02): a
// database of the apps and services being learned, with their gallery, what
// they cost, when they renew, and the video lessons about them. An ordinary
// custom database underneath (search, backup, views all work); its fields
// carry roles, which lay out the record's page and the totals.

const option = (id: string, label: string, color: string): FieldOption => ({ id, label, color });

export const APPS_TEMPLATE_NAME = 'Додатки та сервіси';

export function appsTemplateFields(now: number): FieldDef[] {
  const id = (k: string) => `${now}-${k}`;
  return [
    { id: id('title'), name: 'Назва', type: 'text' },
    { id: id('logo'), name: 'Лого', type: 'relation', relationTarget: { kind: 'photos' }, isCover: true },
    {
      id: id('status'),
      name: 'Статус',
      type: 'select',
      role: 'status',
      options: [
        option('bought', 'Придбано', '#16A34A'),
        option('trial', 'Пробний період', '#2563EB'),
        option('plan', 'Планую придбати', '#D97706'),
        option('free', 'Безкоштовно', '#64748B'),
        option('dropped', 'Відмовився', '#9CA3AF'),
      ],
    },
    {
      id: id('category'),
      name: 'Категорія',
      type: 'select',
      options: [
        option('design', 'Дизайн', '#DB2777'),
        option('dev', 'Розробка', '#7C3AED'),
        option('notes', 'Нотатки', '#0891B2'),
        option('prod', 'Продуктивність', '#EA580C'),
        option('other', 'Інше', '#6B7280'),
      ],
    },
    { id: id('price'), name: 'Вартість', type: 'number', role: 'price' },
    {
      id: id('currency'),
      name: 'Валюта',
      type: 'select',
      role: 'currency',
      options: [option('usd', 'USD', '#16A34A'), option('eur', 'EUR', '#2563EB'), option('uah', 'UAH', '#D97706')],
    },
    {
      id: id('period'),
      name: 'Період',
      type: 'select',
      role: 'period',
      options: [option('month', 'Щомісяця', '#2563EB'), option('year', 'Щороку', '#7C3AED'), option('once', 'Разово', '#6B7280')],
    },
    { id: id('renewal'), name: 'Продовження', type: 'date', role: 'renewal' },
    { id: id('description'), name: 'Опис', type: 'text', role: 'description' },
    { id: id('gallery'), name: 'Галерея', type: 'relation', relationTarget: { kind: 'photos' }, multiple: true, role: 'gallery' },
    {
      id: id('lessons'),
      name: 'Уроки',
      type: 'relation',
      relationTarget: { kind: 'links', category: 'video' },
      multiple: true,
      role: 'lessons',
    },
    { id: id('site'), name: 'Сайт', type: 'text' },
  ];
}

export const APPS_TEMPLATE_RATES = { baseCurrency: 'USD', currencyRates: { USD: 1, EUR: 1.08, UAH: 0.024 } };

export function fieldWithRole(database: CustomDatabase | null | undefined, role: FieldRole): FieldDef | null {
  return database?.fields.find((f) => f.role === role) ?? null;
}

const optionLabel = (field: FieldDef | null, value: unknown): string | null => {
  if (!field || typeof value !== 'string') return null;
  return field.options?.find((o) => o.id === value)?.label ?? null;
};

// "Щомісяця" / "Щороку" / "Разово" - by the option's id in the template,
// by its words in one the user made themselves.
export type Period = 'month' | 'year' | 'once';
function periodOf(field: FieldDef | null, value: unknown): Period {
  const label = (optionLabel(field, value) ?? '').toLowerCase();
  if (value === 'year' || label.includes('рік') || label.includes('річ')) return 'year';
  if (value === 'once' || label.includes('раз')) return 'once';
  return 'month';
}

export type Subscription = { amount: number; currency: string; period: Period };

export function subscriptionOf(database: CustomDatabase | null | undefined, row: CustomDatabaseRow): Subscription | null {
  const priceField = fieldWithRole(database, 'price');
  if (!priceField) return null;
  const amount = row.values[priceField.id];
  if (typeof amount !== 'number' || !amount) return null;
  const currencyField = fieldWithRole(database, 'currency');
  const currency = optionLabel(currencyField, currencyField ? row.values[currencyField.id] : undefined) ?? database?.baseCurrency ?? '';
  const periodField = fieldWithRole(database, 'period');
  return { amount, currency, period: periodOf(periodField, periodField ? row.values[periodField.id] : undefined) };
}

const PERIOD_SHORT: Record<Period, string> = { month: '/ міс', year: '/ рік', once: 'разово' };

export function formatMoney(amount: number, currency: string): string {
  const rounded = Math.round(amount * 100) / 100;
  return `${rounded.toLocaleString('uk-UA', { maximumFractionDigits: 2 })} ${currency}`.trim();
}

export function formatSubscription(sub: Subscription): string {
  return `${formatMoney(sub.amount, sub.currency)} ${PERIOD_SHORT[sub.period]}`;
}

// In the base currency, per month: a year's price is a twelfth of itself;
// a one-time one is not a monthly cost at all and is counted apart.
export type StatusTotal = { statusId: string; label: string; color: string; monthly: number; once: number; count: number };

export function subscriptionTotals(database: CustomDatabase | null | undefined, rows: CustomDatabaseRow[]): StatusTotal[] {
  const statusField = fieldWithRole(database, 'status');
  const rates = database?.currencyRates ?? {};
  // A currency with no rate yet counts one to one rather than vanishing.
  const toBase = (sub: Subscription) => sub.amount * (rates[sub.currency] ?? 1);
  const byStatus = new Map<string, StatusTotal>();
  rows.forEach((row) => {
    const sub = subscriptionOf(database, row);
    if (!sub) return;
    const statusId = statusField && typeof row.values[statusField.id] === 'string' ? (row.values[statusField.id] as string) : '';
    const opt = statusField?.options?.find((o) => o.id === statusId);
    const total = byStatus.get(statusId) ?? { statusId, label: opt?.label ?? 'Без статусу', color: opt?.color ?? '#9CA3AF', monthly: 0, once: 0, count: 0 };
    const base = toBase(sub);
    if (sub.period === 'once') total.once += base;
    else total.monthly += sub.period === 'year' ? base / 12 : base;
    total.count += 1;
    byStatus.set(statusId, total);
  });
  const order = statusField?.options?.map((o) => o.id) ?? [];
  return Array.from(byStatus.values()).sort((a, b) => {
    const ia = order.indexOf(a.statusId);
    const ib = order.indexOf(b.statusId);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
}
