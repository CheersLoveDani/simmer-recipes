# Simmer recipes

The recipe library for [Simmer](https://github.com/CheersLoveDani/simmer), an
open-source cookbook app for desktop and Android.

Recipes are plain YAML files. Every push to `main` compiles them into a static
feed that the app downloads on its own, so merging a recipe here is all it
takes to put it on everyone's device.

## Layout

| Path | What it is |
| --- | --- |
| `recipes/<id>.yaml` | One recipe per file. The file name is the recipe's permanent id. |
| `data/ingredients/<aisle>.yaml` | Every known ingredient, the shop aisle it lives in, and other names for it. |
| `images/<id>.webp` | Optional cover photo for a recipe. |
| `schema/recipe.schema.json` | The recipe format. |
| `scripts/` | Validation and feed build. |

## The feed

`npm run build` writes this to `dist/`, and CI publishes it to the `gh-pages`
branch:

```
v1/manifest.json              small index: revision, plus a hash for every recipe
v1/recipes.<hash>.json        every recipe in one file
v1/r/<id>.<hash>.json         one file per recipe
v1/img/<id>.<hash>.webp       cover photos
```

- `v1` is the feed format version. A breaking change would be published as
  `v2/` next to it, so older copies of the app keep working.
- File names contain a hash of their content, so anything except
  `manifest.json` can be cached forever.
- The app fetches `manifest.json`, compares hashes with what it already has,
  and downloads only what changed.

The feed is served from two places:

- <https://cheerslovedani.github.io/simmer-recipes/v1/manifest.json>
- <https://raw.githubusercontent.com/CheersLoveDani/simmer-recipes/gh-pages/v1/manifest.json>

## Working on recipes

```sh
npm install
npm run validate   # check every recipe
npm test           # validation plus the build tests
npm run build      # write the feed to dist/
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the recipe format and house style.

## Licence

- Recipes, ingredient data and images: [CC BY-SA 4.0](LICENSE). You may share
  and adapt them, including commercially, provided you give credit and release
  your version under the same licence.
- Schema and scripts: [AGPL-3.0-or-later](LICENSE-CODE).
