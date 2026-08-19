/**
 * 样式能力注册的语言子集（唯一事实来源）。
 *
 * 各 Provider 只注册自己验证过的语言，避免「看似支持却用不了」的假象：
 * - hover / definition 依赖 CSS 系语法解析（@x: / $x: / .x {} / var()），
 *   stylus 的赋值与缩进语法未适配，硬注册会产生错误跳转与悬浮；
 * - completion 面向全部样式语言 + vue（vue 内再按 <style lang> 二次判定）；
 * - link 只做 @import/@use/@forward/@require 与 url() 字符串解析，与具体语法
 *   无关，因此覆盖全部样式语言 + vue（vue 的 <style> 块同样需要链接入口，
 *   否则内置 css-language-features 的坏结果仍会抢占 Ctrl+点击）。
 */

/** 全部样式语言（不含 vue） */
export const STYLE_LANGUAGES = ['css', 'less', 'scss', 'sass', 'stylus', 'postcss'] as const;

/** vue 单文件组件：<style> 块内参与样式能力 */
export const VUE_STYLE_LANG = 'vue' as const;

/** 符号解析系（hover/definition）：只覆盖 CSS 系语法 */
export const STYLE_SYMBOL_LANGS = ['css', 'less', 'scss', 'sass', VUE_STYLE_LANG];

/** 补全注册：全部样式语言 + vue */
export const STYLE_COMPLETION_LANGS = [...STYLE_LANGUAGES, VUE_STYLE_LANG];

/** 文档链接注册：与语法无关，全量覆盖 */
export const STYLE_LINK_LANGS = [...STYLE_LANGUAGES, VUE_STYLE_LANG];
