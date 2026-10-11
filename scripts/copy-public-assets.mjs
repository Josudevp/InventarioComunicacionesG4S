import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
await Promise.all([
  cp('assets', 'dist/assets', { recursive: true }),
  cp('icons', 'dist/icons', { recursive: true }),
  cp('manifest.json', 'dist/manifest.json'),
  cp('sw.js', 'dist/sw.js')
]);

const manifest = JSON.parse(await readFile('dist/.vite/manifest.json', 'utf8'));
const buildAssets = new Set();
for (const entry of Object.values(manifest)) {
  if (entry.isEntry || entry.isDynamicEntry) buildAssets.add(entry.file);
  for (const file of [...(entry.css || []), ...(entry.assets || [])]) {
    if (/\.(css|woff2)$/.test(file)) buildAssets.add(file);
  }
}

const serviceWorkerPath = 'dist/sw.js';
const serviceWorker = await readFile(serviceWorkerPath, 'utf8');
await writeFile(serviceWorkerPath, serviceWorker.replace(
  'const BUILD_ASSETS = [];',
  `const BUILD_ASSETS = ${JSON.stringify([...buildAssets].map(file => `./${file}`))};`
));