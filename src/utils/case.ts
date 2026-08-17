/** 内置命名格式名：QuickPick 列表与 zeta.case.cycleOrder 配置使用同一组名称 */
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

/**
 * 把驼峰/帕斯卡/连字符/下划线/路径等写法拆成单词数组：
 * 先按「小写或数字后接大写」「连续大写后接大写小写」切分驼峰边界，
 * 再按 - _ . / \\ 与空白分隔符拆分。
 */
export function splitWords(s: string): string[] {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[-_\s./\\]+/)
    .filter(Boolean);
}

/** 内置 12 种命名格式转换器：以 splitWords 拆词后按各自规则拼接 */
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
