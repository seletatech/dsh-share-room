// Shared, pure translation logic. Build embeds this and the reviewed dictionaries
// in the two browser entry points; there are no DOM text replacements.
export function normalizeLocale(value) {
  const tag = String(value || 'en').toLowerCase().replaceAll('_', '-');
  if (/^zh(?:-|$)/.test(tag)) return /(?:hant|tw|hk|mo)/.test(tag) ? 'zh-Hant' : 'zh';
  return 'en';
}
export function translate(locale, key, values = []) {
  const dictionary = dictionaries[normalizeLocale(locale)];
  const template = dictionary[key] ?? dictionaries.en[key] ?? key;
  return template.replace(/\{(\d+)\}/g, (match, index) => String(values[index] ?? match));
}
// Only translate known protocol error messages, never conversation text or names.
// Template matching is anchored; no substring replacement or character conversion.
const errorTemplates = Object.keys(dictionaries.en).filter(key => /\{\d+\}/.test(key)).map(key => ({
  key, pattern: new RegExp('^' + key.split(/\{\d+\}/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('([\\s\\S]*?)') + '$')
}));
export function translateError(locale, message) {
  if (typeof message !== 'string') return message;
  if (Object.hasOwn(dictionaries.en, message)) return translate(locale, message);
  for (const {key, pattern} of errorTemplates) { const match = pattern.exec(message); if (match) return translate(locale, key, match.slice(1)); }
  return message;
}
