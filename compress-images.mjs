import sharp from 'sharp';

await sharp('./public/raw-icon.png').resize(128, 128).webp({ quality: 50, effort: 6 }).toFile('./public/icon.png');
