import { englishMessages } from './messages-en.ts';

export type Locale = 'zh-CN' | 'en';
export type MessageValues = Record<string, string | number | null | undefined>;

export const localePreferenceKey = 'pagewise:locale';
export const localeCookieName = 'pagewise-locale';

// Existing server notices include formatted numbers instead of message IDs.
const numericMessages = Object.entries(englishMessages)
  .filter(([message]) => /[\u3400-\u9fff]/.test(message) && /\{\w+\}/.test(message))
  .map(([message, translation]) => {
    const parts = message.split(/\{(\w+)\}/);
    const names = parts.filter((_, index) => index % 2 === 1);
    const pattern = parts.map((part, index) => index % 2 === 1
      ? '(-?\\d[\\d.,]*)' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
    return { pattern: new RegExp(`^${pattern}$`), names, translation };
  });

export function resolveLocale(value: unknown): Locale {
  return value === 'en' ? 'en' : 'zh-CN';
}

export function translate(locale: Locale, message: string, values: MessageValues = {}): string {
  let template = locale === 'en' ? englishMessages[message] : message;
  let substitutions = values;
  if (locale === 'en' && template === undefined) {
    for (const candidate of numericMessages) {
      const match = candidate.pattern.exec(message);
      if (!match) continue;
      template = candidate.translation;
      substitutions = { ...Object.fromEntries(candidate.names.map((name, index) => [name, match[index + 1]])), ...values };
      break;
    }
  }
  template ??= message;
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.hasOwn(substitutions, name) ? String(substitutions[name] ?? '') : placeholder);
}
