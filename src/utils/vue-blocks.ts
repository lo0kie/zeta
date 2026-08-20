/**
 * Vue 文档块提取工具：`<template>` / `<script>` / `<style>` 块区间与 HTML 注释跳过判定。
 */

/**
 * 判断 index 是否位于 HTML 注释 `<!-- ... -->` 内（用于跳过被注释包裹的残缺/临时禁用标签）。
 * 判定：找 index 之前最近的一个 `<!--`，若它之后没有对应的 `-->`，则 index 在注释内。
 */
export function inHtmlComment(text: string, index: number): boolean {
  const commentStart = text.lastIndexOf('<!--', index);
  return commentStart !== -1 && commentStart > text.lastIndexOf('-->', index);
}

/** Vue 文档中非 `<template>` 的块（`<script>` / `<style>`）区间集合（覆盖整个块，含标签本身） */
export function nonTemplateBlocks(text: string): [number, number][] {
  const blocks: [number, number][] = [];
  // <script> / <style>（含 lang="ts" 等属性），跳过 HTML 注释包裹的残缺标签
  const re = /<(script|style)\b[^>]*>([\s\S]*?)<\/(script|style)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (inHtmlComment(text, m.index)) continue;
    blocks.push([m.index, m.index + m[0].length]);
  }
  return blocks;
}
