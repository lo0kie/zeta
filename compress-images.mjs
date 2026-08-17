import { existsSync } from 'node:fs';
import sharp from 'sharp';

const SOURCE = './public/raw-icon.png';
const TARGET = './public/icon.png';

if (!existsSync(SOURCE)) {
  console.warn(`${SOURCE} 不存在，跳过图标压缩`);
  process.exit(0);
}

await sharp(SOURCE).resize(128, 128).webp({ quality: 50, effort: 6 }).toFile(TARGET);
console.log(`图标压缩完成: ${TARGET}`);
