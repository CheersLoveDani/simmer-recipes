// Themes: optional looks that a group of recipes can share, such as the
// recipes from one cookbook. A theme sets an accent colour and background
// art; its styles are variations a single recipe can pick (a character, a
// chapter, a season).
//
//   themes/<theme-id>/theme.yaml
//   themes/<theme-id>/<art>.webp | .png | .svg
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import YAML from 'yaml';

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const HEX = /^#[0-9a-f]{6}$/i;
const ART = /^[a-z0-9][a-z0-9._-]*\.(webp|png|svg)$/i;
const sha = (data) => createHash('sha256').update(data).digest('hex').slice(0, 12);

/**
 * Read every theme under <root>/themes.
 * Returns { themes, errors }. Each theme keeps `dir` so its art can be copied.
 */
export async function loadThemes(root) {
  const base = path.join(root, 'themes');
  const themes = [];
  const errors = [];
  if (!existsSync(base)) return { themes, errors };

  for (const entry of (await readdir(base, { withFileTypes: true })).filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const id = entry.name;
    const dir = path.join(base, id);
    const file = `themes/${id}/theme.yaml`;
    const fail = (message) => errors.push({ file, message });
    if (!ID.test(id)) fail(`folder name "${id}" must be lowercase words joined by hyphens`);

    let source;
    try {
      source = YAML.parse(await readFile(path.join(dir, 'theme.yaml'), 'utf8'));
    } catch (err) {
      fail(err.code === 'ENOENT' ? 'is missing' : `YAML: ${err.message}`);
      continue;
    }
    if (!source || typeof source !== 'object') {
      fail('must be a mapping');
      continue;
    }

    const known = ['name', 'description', 'accent', 'accentDark', 'art', 'credit', 'styles'];
    for (const key of Object.keys(source)) if (!known.includes(key)) fail(`unknown field "${key}"`);
    if (typeof source.name !== 'string' || !source.name.trim()) fail('needs a "name"');

    const look = (where, value) => {
      const out = {};
      for (const field of ['accent', 'accentDark']) {
        if (value[field] === undefined) continue;
        if (typeof value[field] !== 'string' || !HEX.test(value[field])) fail(`${where}"${field}" must be a colour like "#f79a1e"`);
        else out[field] = value[field].toLowerCase();
      }
      if (value.art !== undefined) {
        if (typeof value.art !== 'string' || !ART.test(value.art)) fail(`${where}"art" must be a .webp, .png or .svg file in the theme folder`);
        else if (!existsSync(path.join(dir, value.art))) fail(`${where}art "${value.art}" does not exist`);
        else out.art = value.art;
      }
      return out;
    };

    const theme = { id, dir, name: String(source.name ?? id).trim(), ...look('', source), styles: {} };
    if (!theme.accent) fail('needs an "accent" colour');
    for (const field of ['description', 'credit']) {
      if (source[field] === undefined) continue;
      if (typeof source[field] !== 'string') fail(`"${field}" must be text`);
      else theme[field] = source[field].trim();
    }

    for (const [key, style] of Object.entries(source.styles ?? {})) {
      if (!ID.test(key)) fail(`style "${key}" must be lowercase words joined by hyphens`);
      if (!style || typeof style !== 'object') {
        fail(`style "${key}" must be a mapping`);
        continue;
      }
      for (const field of Object.keys(style)) if (!['label', 'accent', 'accentDark', 'art'].includes(field)) fail(`style "${key}": unknown field "${field}"`);
      if (typeof style.label !== 'string' || !style.label.trim()) fail(`style "${key}" needs a "label"`);
      theme.styles[key] = { label: String(style.label ?? key).trim(), ...look(`style "${key}": `, style) };
    }
    themes.push(theme);
  }
  return { themes, errors };
}

/** Check that every recipe's theme and style exist. Returns error objects. */
export function checkRecipeThemes(recipes, themes) {
  const byId = new Map(themes.map((t) => [t.id, t]));
  const errors = [];
  for (const recipe of recipes) {
    if (!recipe.theme) continue;
    const theme = byId.get(recipe.theme.id);
    const file = `${recipe.id}.yaml`;
    if (!theme) errors.push({ file, message: `theme "${recipe.theme.id}" does not exist under themes/` });
    else if (recipe.theme.style && !theme.styles[recipe.theme.style]) {
      errors.push({ file, message: `theme "${theme.id}" has no style "${recipe.theme.style}"` });
    }
  }
  return errors;
}

/**
 * Copy theme art into the feed under content-addressed names and return the
 * themes as the app receives them, with `art` pointing at the published file.
 */
export async function publishThemes(themes, feedDir) {
  const published = [];
  for (const theme of themes) {
    const copied = new Map();
    const publish = async (name) => {
      if (!name) return undefined;
      if (!copied.has(name)) {
        const hash = sha(await readFile(path.join(theme.dir, name)));
        const ext = path.extname(name).toLowerCase();
        const rel = `img/t/${theme.id}/${path.basename(name, path.extname(name))}.${hash}${ext}`;
        await mkdir(path.dirname(path.join(feedDir, rel)), { recursive: true });
        await copyFile(path.join(theme.dir, name), path.join(feedDir, rel));
        copied.set(name, rel);
      }
      return copied.get(name);
    };
    const withArt = async ({ art, ...rest }) => {
      const published = await publish(art);
      return published ? { ...rest, art: published } : rest;
    };

    const { dir: _dir, styles, ...top } = theme;
    const out = { ...(await withArt(top)), styles: {} };
    for (const [key, style] of Object.entries(styles)) out.styles[key] = await withArt(style);
    published.push(out);
  }
  return published;
}
