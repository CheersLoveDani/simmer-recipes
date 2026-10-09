import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, test } from 'node:test';
import YAML from 'yaml';
import { buildFeed, canonicalJson, loadRecipes, normaliseKey } from '../scripts/lib.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const base = () => ({
  title: 'Garlic Toast',
  description: 'Crisp toast rubbed with garlic and finished with olive oil.',
  course: 'snack',
  cuisine: 'italian',
  difficulty: 'easy',
  serves: 2,
  time: { prep: 2, cook: 4 },
  ingredients: [
    {
      items: [
        { qty: 2, unit: 'slice', item: 'sourdough bread' },
        { qty: 1, unit: 'clove', item: 'Garlic cloves', key: 'garlic' },
        { qty: null, unit: null, item: 'olive oil', note: 'to finish' },
      ],
    },
  ],
  steps: [{ text: 'Toast the bread until golden.', timer: { minutes: 4, label: 'Toast' } }],
  cover: { hue: 40, motif: 'slice' },
  created: '2026-10-09',
});

let root;

async function writeRecipe(id, recipe) {
  await writeFile(path.join(root, 'recipes', `${id}.yaml`), YAML.stringify(recipe));
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'simmer-feed-'));
  await mkdir(path.join(root, 'recipes'));
  await mkdir(path.join(root, 'data', 'ingredients'), { recursive: true });
  await writeFile(
    path.join(root, 'data', 'ingredients', 'produce.yaml'),
    YAML.stringify({ garlic: ['garlic clove', 'garlic cloves'] }),
  );
  await writeFile(
    path.join(root, 'data', 'ingredients', 'pantry.yaml'),
    YAML.stringify({ 'olive oil': ['extra virgin olive oil'] }),
  );
  await writeFile(path.join(root, 'data', 'ingredients', 'bakery.yaml'), YAML.stringify({ 'sourdough bread': [] }));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test('normaliseKey lowercases, strips accents and punctuation', () => {
  assert.equal(normaliseKey('  Crème  Fraîche! '), 'creme fraiche');
});

test('canonicalJson ignores key order', () => {
  assert.equal(canonicalJson({ b: 1, a: [{ d: 1, c: 2 }] }), canonicalJson({ a: [{ c: 2, d: 1 }], b: 1 }));
});

test('compiles a valid recipe with keys, aisles and total time', async () => {
  await writeRecipe('garlic-toast', base());
  const { recipes, errors } = await loadRecipes(root);
  assert.deepEqual(errors, []);
  const [recipe] = recipes;
  assert.equal(recipe.id, 'garlic-toast');
  assert.equal(recipe.time.total, 6);
  assert.equal(recipe.time.rest, 0);
  assert.equal(recipe.author, 'Simmer');
  const items = recipe.ingredients[0].items;
  assert.deepEqual(
    items.map((i) => [i.key, i.aisle]),
    [
      ['sourdough bread', 'bakery'],
      ['garlic', 'produce'],
      ['olive oil', 'pantry'],
    ],
  );
  assert.equal(items[1].item, 'Garlic cloves', 'display name is kept as written');
});

test('resolves an ingredient through an alternative name', async () => {
  const recipe = base();
  recipe.ingredients[0].items[2].item = 'Extra Virgin Olive Oil';
  await writeRecipe('garlic-toast', recipe);
  const { recipes } = await loadRecipes(root);
  assert.equal(recipes[0].ingredients[0].items[2].key, 'olive oil');
});

test('reports an unknown ingredient', async () => {
  const recipe = base();
  recipe.ingredients[0].items.push({ qty: 1, unit: 'tsp', item: 'unobtainium' });
  await writeRecipe('garlic-toast', recipe);
  const { recipes, errors } = await loadRecipes(root);
  assert.equal(recipes.length, 0);
  assert.match(errors[0].message, /unknown ingredient "unobtainium"/);
});

test('reports schema violations with the file name', async () => {
  const recipe = base();
  recipe.course = 'elevenses';
  delete recipe.steps;
  await writeRecipe('garlic-toast', recipe);
  const { errors } = await loadRecipes(root);
  assert.ok(errors.length >= 2);
  assert.ok(errors.every((e) => e.file === 'garlic-toast.yaml'));
});

test('rejects a bad id, a bad range and malformed YAML', async () => {
  await writeRecipe('Garlic_Toast', base());
  const ranged = base();
  ranged.ingredients[0].items[0].qtyMax = 1;
  await writeRecipe('ranged', ranged);
  await writeFile(path.join(root, 'recipes', 'broken.yaml'), 'title: [unclosed');
  const { errors } = await loadRecipes(root);
  const text = errors.map((e) => `${e.file}: ${e.message}`).join('\n');
  assert.match(text, /Garlic_Toast\.yaml: id/);
  assert.match(text, /ranged\.yaml: .*qtyMax/);
  assert.match(text, /broken\.yaml: YAML/);
});

test('reports a taxonomy name claimed by two keys', async () => {
  await writeFile(path.join(root, 'data', 'ingredients', 'spices.yaml'), YAML.stringify({ 'garlic powder': ['garlic'] }));
  const { errors } = await loadRecipes(root);
  assert.match(errors[0].message, /"garlic" /);
});

test('buildFeed refuses to build with invalid recipes', async () => {
  const recipe = base();
  recipe.serves = 0;
  await writeRecipe('garlic-toast', recipe);
  await assert.rejects(buildFeed(root, path.join(root, 'dist')), /Feed not built/);
});

test('buildFeed writes a manifest, bundle and per-recipe files that agree', async () => {
  await writeRecipe('garlic-toast', base());
  await writeRecipe('other-toast', { ...base(), title: 'Other Toast' });
  const out = path.join(root, 'dist');
  const manifest = await buildFeed(root, out);

  const onDisk = JSON.parse(await readFile(path.join(out, 'v1', 'manifest.json'), 'utf8'));
  assert.deepEqual(onDisk, manifest);
  assert.equal(manifest.schemaVersion, 1);
  assert.deepEqual(manifest.recipes.map((r) => r.id), ['garlic-toast', 'other-toast']);

  const bundle = JSON.parse(await readFile(path.join(out, 'v1', manifest.bundle.path), 'utf8'));
  assert.equal(bundle.recipes.length, 2);
  for (const entry of manifest.recipes) {
    const single = JSON.parse(await readFile(path.join(out, 'v1', entry.path), 'utf8'));
    assert.equal(single.hash, entry.hash);
    assert.deepEqual(single, bundle.recipes.find((r) => r.id === entry.id));
  }
});

test('hashes are stable across builds and change only for edited recipes', async () => {
  await writeRecipe('garlic-toast', base());
  await writeRecipe('other-toast', { ...base(), title: 'Other Toast' });
  const out = path.join(root, 'dist');
  const first = await buildFeed(root, out, { now: new Date('2026-01-01') });
  const second = await buildFeed(root, out, { now: new Date('2026-06-01') });
  assert.equal(second.revision, first.revision);
  assert.deepEqual(second.recipes, first.recipes);

  await writeRecipe('other-toast', { ...base(), title: 'Another Toast' });
  const third = await buildFeed(root, out);
  assert.notEqual(third.revision, first.revision);
  assert.equal(third.recipes[0].hash, first.recipes[0].hash);
  assert.notEqual(third.recipes[1].hash, first.recipes[1].hash);
  const files = await readdir(path.join(out, 'v1', 'r'));
  assert.equal(files.length, 2, 'stale recipe files are removed');
});

test('images are content-addressed and linked from the recipe', async () => {
  await writeRecipe('garlic-toast', base());
  await mkdir(path.join(root, 'images'));
  await writeFile(path.join(root, 'images', 'garlic-toast.webp'), 'not really a webp');
  const out = path.join(root, 'dist');
  await assert.rejects(buildFeed(root, out), /garlic-toast\.webp needs "author" in images\/credits\.yaml/);
  const credit = { author: 'A. Baker', license: 'CC BY 4.0', source: 'https://example.org/toast' };
  await writeFile(path.join(root, 'images', 'credits.yaml'), JSON.stringify({ 'garlic-toast': { ...credit, title: 'Toast' } }));
  const manifest = await buildFeed(root, out);
  assert.equal(manifest.images.length, 1);
  const recipe = JSON.parse(await readFile(path.join(out, 'v1', manifest.recipes[0].path), 'utf8'));
  assert.equal(recipe.image, manifest.images[0].path);
  assert.deepEqual(recipe.imageCredit, credit);
  assert.equal(await readFile(path.join(out, 'v1', recipe.image), 'utf8'), 'not really a webp');

  await writeFile(path.join(root, 'images', 'orphan.webp'), 'x');
  await assert.rejects(buildFeed(root, out), /orphan\.webp has no matching recipe/);
  await rm(path.join(root, 'images', 'orphan.webp'));

  await writeFile(path.join(root, 'images', 'credits.yaml'), JSON.stringify({ 'garlic-toast': credit, gone: credit }));
  await assert.rejects(buildFeed(root, out), /lists "gone" but images\/gone\.webp does not exist/);
});

test('every recipe in this repository is valid', async () => {
  const { errors } = await loadRecipes(repoRoot);
  assert.deepEqual(errors, []);
});
