// 生成 all_code.txt：把 src 下全部 TypeScript 源码整理为 markdown 文档，
// 每个文件一段代码块（只保留一遍源码），路径为标题。用于给 AI 提供完整项目上下文。
import fs from 'node:fs';
import path from 'node:path';

const SOURCE_DIR = 'src';
const OUTPUT_FILE = 'all_code.txt';

function collectTsFiles(dir, list = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectTsFiles(full, list);
    else if (entry.isFile() && entry.name.endsWith('.ts')) list.push(full);
  }
  return list;
}

function main() {
  const srcPath = path.resolve(process.cwd(), SOURCE_DIR);
  if (!fs.existsSync(srcPath)) {
    console.error(`目录 "${srcPath}" 不存在`);
    process.exit(1);
  }

  const files = collectTsFiles(srcPath)
    .map(full => path.relative(process.cwd(), full))
    .sort();

  const sections = files.map(rel => {
    const relPosix = rel.replace(/\\/g, '/');
    const content = fs.readFileSync(rel, 'utf8').replace(/\r\n/g, '\n').replace(/\n*$/, '');
    return `## ${relPosix}\n\n\`\`\`typescript\n${content}\n\`\`\``;
  });

  const header = `# zeta 源码\n\n共 ${files.length} 个 TypeScript 文件。\n\n---\n\n`;
  const output = header + sections.join('\n\n---\n\n') + '\n';

  fs.writeFileSync(path.resolve(process.cwd(), OUTPUT_FILE), output, 'utf8');
  console.log(`输出完成: ${path.resolve(OUTPUT_FILE)}（${files.length} 个文件）`);
}

main();
