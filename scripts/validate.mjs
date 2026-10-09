import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRecipes } from './lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { recipes, errors } = await loadRecipes(root);

if (errors.length) {
  for (const e of errors) console.error(`${e.file}: ${e.message}`);
  console.error(`\n${errors.length} problem(s).`);
  process.exit(1);
}
console.log(`${recipes.length} recipes valid.`);
