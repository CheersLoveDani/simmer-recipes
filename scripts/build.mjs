import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFeed } from './lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.resolve(root, process.argv[2] ?? 'dist');

try {
  const manifest = await buildFeed(root, outDir);
  // GitHub Pages would otherwise run Jekyll over the output.
  await writeFile(path.join(outDir, '.nojekyll'), '');
  await writeFile(
    path.join(outDir, 'index.html'),
    '<!doctype html><meta charset="utf-8"><title>Simmer recipes</title>' +
      '<p>Recipe feed for <a href="https://github.com/CheersLoveDani/simmer">Simmer</a>. ' +
      'See <a href="v1/manifest.json">v1/manifest.json</a>.</p>\n',
  );
  console.log(`Built ${manifest.recipes.length} recipes, revision ${manifest.revision} -> ${outDir}`);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
