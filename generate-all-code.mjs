import fs from 'node:fs';
import path from 'node:path';

const SOURCE_DIRS = ['src'];
const ADDITIONAL_FILES = ['package.json'];
const OUTPUT_FILE = 'all_code.txt';
const TARGET_EXTENSIONS = ['.ts', '.tsx', '.vue', '.less', '.css', '.json', '.js', '.mjs'];
const LANG_MAP = {
  '.ts': 'typescript',
  '.tsx': 'typescriptreact',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.vue': 'vue',
  '.less': 'less',
  '.css': 'css',
  '.scss': 'scss',
  '.json': 'json',
};

function collectTsFiles(dir, list = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTsFiles(full, list);
    } else if (entry.isFile() && TARGET_EXTENSIONS.some(ext => entry.name.endsWith(ext))) {
      list.push(full);
    }
  }
  return list;
}

function main() {
  const extraFiles = ADDITIONAL_FILES.map(file => path.resolve(process.cwd(), file)).filter(full =>
    fs.existsSync(full)
  );

  const allFiles = [
    ...extraFiles,
    ...SOURCE_DIRS.flatMap(dir => {
      const dirPath = path.resolve(process.cwd(), dir);
      if (!fs.existsSync(dirPath)) {
        console.warn(`目录 "${dirPath}" 不存在，已跳过`);
        return [];
      }
      return collectTsFiles(dirPath);
    }),
  ];

  const files = Array.from(new Set(allFiles))
    .map(full => path.relative(process.cwd(), full))
    .sort();

  if (files.length === 0) {
    console.error('未找到任何源文件');
    process.exit(1);
  }

  const sections = files.map(rel => {
    const relPosix = rel.replace(/\\/g, '/');
    const content = fs
      .readFileSync(rel, 'utf8')
      .replace(/\r\n/g, '\n')
      .replace(/^\n+|\n+$/g, '');
    return `## ${relPosix}\n\n${content}`;
  });

  const header = `# zeta 源码\n\n共 ${files.length} 个源文件。\n\n---\n\n`;
  const output = header + sections.join('\n\n');

  fs.writeFileSync(path.resolve(process.cwd(), OUTPUT_FILE), output, 'utf8');
  console.log(`输出完成: ${path.resolve(OUTPUT_FILE)}（${files.length} 个文件）`);
}

main();
