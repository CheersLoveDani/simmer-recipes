import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv';
import YAML from 'yaml';

export const SCHEMA_VERSION = 1;

export const AISLES = [
  'produce',
  'meat-fish',
  'dairy-eggs',
  'bakery',
  'pantry',
  'spices',
  'tins-jars',
  'frozen',
  'drinks',
  'other',
];

const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function sha(input, length = 12) {
  return createHash('sha256').update(input).digest('hex').slice(0, length);
}

/** JSON with object keys sorted, so equal content always hashes equally. */
export function canonicalJson(value) {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortKeys(value[k])]),
    );
  }
  return value;
}

export function normaliseKey(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Taxonomy source: data/ingredients/<aisle>.yaml (or <aisle>.<anything>.yaml),
 * each a map of canonical key -> list of alternative names (may be empty).
 * Returns { byName: Map<name, {key, aisle}>, errors: string[] }.
 */
export async function loadTaxonomy(root) {
  const dir = path.join(root, 'data', 'ingredients');
  const byName = new Map();
  const errors = [];
  const files = existsSync(dir) ? (await readdir(dir)).filter((f) => f.endsWith('.yaml')).sort() : [];
  for (const file of files) {
    const aisle = file.split('.')[0];
    if (!AISLES.includes(aisle)) {
      errors.push(`data/ingredients/${file}: unknown aisle "${aisle}"`);
      continue;
    }
    const doc = YAML.parse(await readFile(path.join(dir, file), 'utf8')) ?? {};
    for (const [rawKey, aka] of Object.entries(doc)) {
      const key = normaliseKey(rawKey);
      for (const name of [key, ...(aka ?? []).map(normaliseKey)]) {
        const existing = byName.get(name);
        if (existing && existing.key !== key) {
          errors.push(`data/ingredients/${file}: "${name}" maps to both "${existing.key}" and "${key}"`);
        } else if (existing && existing.aisle !== aisle) {
          errors.push(`data/ingredients/${file}: "${name}" is in both ${existing.aisle} and ${aisle}`);
        } else {
          byName.set(name, { key, aisle });
        }
      }
    }
  }
  return { byName, errors };
}

let validator;
async function getValidator() {
  if (!validator) {
    const schemaPath = new URL('../schema/recipe.schema.json', import.meta.url);
    const schema = JSON.parse(await readFile(schemaPath, 'utf8'));
    validator = new Ajv({ allErrors: true, allowUnionTypes: true }).compile(schema);
  }
  return validator;
}

/**
 * Validate one parsed source recipe and compile it to the feed shape.
 * Returns { recipe, errors }. `recipe` is null when there are errors.
 */
export function compileRecipe(id, source, validate, taxonomy) {
  const errors = [];
  if (!ID_PATTERN.test(id)) errors.push(`id "${id}" must be lowercase words joined by hyphens`);
  if (!validate(source)) {
    for (const e of validate.errors) errors.push(`${e.instancePath || '/'} ${e.message}`);
    return { recipe: null, errors };
  }

  const ingredients = source.ingredients.map((group) => ({
    section: group.section ?? null,
    items: group.items.map((item) => {
      const lookup = normaliseKey(item.key ?? item.item);
      const known = taxonomy.byName.get(lookup);
      if (!known) errors.push(`unknown ingredient "${lookup}" — add it to data/ingredients/<aisle>.yaml`);
      if (item.qtyMax != null && (item.qty == null || item.qtyMax <= item.qty)) {
        errors.push(`"${item.item}": qtyMax must be greater than qty`);
      }
      const { key: _ignored, ...rest } = item;
      return { ...rest, key: known?.key ?? lookup, aisle: known?.aisle ?? 'other' };
    }),
  }));

  if (errors.length) return { recipe: null, errors };

  const time = { prep: source.time.prep, cook: source.time.cook, rest: source.time.rest ?? 0 };
  time.total = time.prep + time.cook + time.rest;

  const body = {
    id,
    title: source.title,
    description: source.description,
    course: source.course,
    cuisine: source.cuisine,
    tags: source.tags ?? [],
    diet: source.diet ?? [],
    difficulty: source.difficulty,
    serves: source.serves,
    ...(source.yield ? { yield: source.yield } : {}),
    time,
    ingredients,
    steps: source.steps,
    equipment: source.equipment ?? [],
    tips: source.tips ?? [],
    substitutions: source.substitutions ?? [],
    ...(source.storage ? { storage: source.storage } : {}),
    ...(source.nutrition ? { nutrition: source.nutrition } : {}),
    cover: source.cover,
    author: source.author ?? 'Simmer',
    created: source.created,
    ...(source.updated ? { updated: source.updated } : {}),
  };
  return { recipe: body, errors };
}

/** Load, validate and compile every recipe under <root>/recipes. */
export async function loadRecipes(root) {
  const validate = await getValidator();
  const taxonomy = await loadTaxonomy(root);
  const errors = taxonomy.errors.map((message) => ({ file: 'taxonomy', message }));
  const recipes = [];
  const dir = path.join(root, 'recipes');
  const files = existsSync(dir) ? (await readdir(dir)).filter((f) => f.endsWith('.yaml')).sort() : [];
  for (const file of files) {
    const id = path.basename(file, '.yaml');
    let source;
    try {
      source = YAML.parse(await readFile(path.join(dir, file), 'utf8'));
    } catch (err) {
      errors.push({ file, message: `YAML: ${err.message}` });
      continue;
    }
    const result = compileRecipe(id, source, validate, taxonomy);
    for (const message of result.errors) errors.push({ file, message });
    if (result.recipe) recipes.push(result.recipe);
  }
  return { recipes, errors, taxonomy };
}

/**
 * Build the feed into <outDir>/v<SCHEMA_VERSION>/.
 * Throws if any recipe is invalid.
 */
export async function buildFeed(root, outDir, { now = new Date() } = {}) {
  const { recipes, errors } = await loadRecipes(root);
  if (errors.length) {
    const lines = errors.map((e) => `  ${e.file}: ${e.message}`).join('\n');
    throw new Error(`Feed not built, ${errors.length} problem(s):\n${lines}`);
  }

  const feedDir = path.join(outDir, `v${SCHEMA_VERSION}`);
  await rm(feedDir, { recursive: true, force: true });
  await mkdir(path.join(feedDir, 'r'), { recursive: true });
  await mkdir(path.join(feedDir, 'img'), { recursive: true });

  const images = [];
  const imageDir = path.join(root, 'images');
  const imageFiles = existsSync(imageDir) ? (await readdir(imageDir)).filter((f) => f.endsWith('.webp')).sort() : [];
  const known = new Set(recipes.map((r) => r.id));
  // Photos come from other people under open licences, which require credit.
  const creditsFile = path.join(imageDir, 'credits.yaml');
  const credits = existsSync(creditsFile) ? (YAML.parse(await readFile(creditsFile, 'utf8')) ?? {}) : {};
  for (const id of Object.keys(credits)) {
    if (!imageFiles.includes(`${id}.webp`)) throw new Error(`images/credits.yaml lists "${id}" but images/${id}.webp does not exist`);
  }
  for (const file of imageFiles) {
    const id = path.basename(file, '.webp');
    if (!known.has(id)) throw new Error(`images/${file} has no matching recipe`);
    const credit = credits[id];
    for (const field of ['author', 'license', 'source']) {
      if (typeof credit?.[field] !== 'string' || !credit[field].trim()) {
        throw new Error(`images/${file} needs "${field}" in images/credits.yaml`);
      }
    }
    for (const field of ['source', 'licenseUrl']) {
      if (credit[field] !== undefined && !/^https:\/\/\S+$/.test(credit[field])) {
        throw new Error(`images/${file}: "${field}" in images/credits.yaml must be an https link`);
      }
    }
    const hash = sha(await readFile(path.join(imageDir, file)));
    const rel = `img/${id}.${hash}.webp`;
    await copyFile(path.join(imageDir, file), path.join(feedDir, rel));
    images.push({ id, hash, path: rel });
  }
  const imageById = new Map(images.map((i) => [i.id, i.path]));
  const creditFor = ({ author, license, licenseUrl, source }) => ({ author, license, ...(licenseUrl ? { licenseUrl } : {}), source });

  const entries = [];
  const compiled = [];
  for (const body of recipes) {
    const withImage = imageById.has(body.id) ? { ...body, image: imageById.get(body.id), imageCredit: creditFor(credits[body.id]) } : body;
    const hash = sha(canonicalJson(withImage));
    const recipe = { ...withImage, hash };
    const rel = `r/${recipe.id}.${hash}.json`;
    await writeFile(path.join(feedDir, rel), JSON.stringify(recipe));
    entries.push({ id: recipe.id, hash, path: rel });
    compiled.push(recipe);
  }

  const bundleJson = JSON.stringify({ schemaVersion: SCHEMA_VERSION, recipes: compiled });
  const bundleHash = sha(bundleJson);
  const bundlePath = `recipes.${bundleHash}.json`;
  await writeFile(path.join(feedDir, bundlePath), bundleJson);

  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    revision: sha(canonicalJson({ recipes: entries, images }), 16),
    generatedAt: now.toISOString(),
    bundle: { path: bundlePath, hash: bundleHash, bytes: Buffer.byteLength(bundleJson) },
    recipes: entries,
    images,
  };
  await writeFile(path.join(feedDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}
