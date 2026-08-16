export type BuiltinCaseName =
  | 'Upper Case'
  | 'Lower Case'
  | 'Camel Case'
  | 'Pascal Case'
  | 'Snake Case'
  | 'Constant Case'
  | 'Kebab Case'
  | 'Header Case'
  | 'Title Case'
  | 'Sentence Case'
  | 'Dot Case'
  | 'Path Case';

export function splitWords(s: string): string[] {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[-_\s./\\]+/)
    .filter(Boolean);
}

export const wordTransformers: Record<BuiltinCaseName, (text: string) => string> = {
  'Camel Case': s =>
    splitWords(s)
      .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
      .join(''),
  'Pascal Case': s =>
    splitWords(s)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(''),
  'Kebab Case': s =>
    splitWords(s)
      .map(w => w.toLowerCase())
      .join('-'),
  'Snake Case': s =>
    splitWords(s)
      .map(w => w.toLowerCase())
      .join('_'),
  'Constant Case': s =>
    splitWords(s)
      .map(w => w.toUpperCase())
      .join('_'),
  'Upper Case': s => splitWords(s).join('').toUpperCase(),
  'Lower Case': s => splitWords(s).join('').toLowerCase(),
  'Title Case': s =>
    splitWords(s)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' '),
  'Sentence Case': s =>
    splitWords(s)
      .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()))
      .join(' '),
  'Header Case': s =>
    splitWords(s)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join('-'),
  'Dot Case': s =>
    splitWords(s)
      .map(w => w.toLowerCase())
      .join('.'),
  'Path Case': s =>
    splitWords(s)
      .map(w => w.toLowerCase())
      .join('/'),
};
