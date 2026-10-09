# Contributing a recipe

1. Copy an existing file in `recipes/` and rename it. The file name becomes the
   recipe's id: lowercase words joined by hyphens, e.g. `lemon-drizzle-cake.yaml`.
   Do not rename a published recipe; people's favourites and notes point at the id.
2. Fill it in (format below).
3. Run `npm run validate` and fix anything it reports.
4. Open a pull request.

By contributing you agree to release your recipe under CC BY-SA 4.0. Write it
in your own words. Ingredient lists are not copyrightable but the wording of a
method is, so do not paste text from books or websites.

## Format

```yaml
title: Brown Butter Miso Pasta
description: One or two honest sentences. Max 320 characters.
course: main          # starter soup salad main side dessert breakfast baking drink sauce snack
cuisine: japanese     # lowercase, hyphenated
tags: [weeknight, umami]
diet: [vegetarian]    # vegetarian vegan gluten-free dairy-free nut-free pescatarian
difficulty: easy      # easy medium hard
serves: 2
yield: null           # optional, e.g. "16 squares"
time: { prep: 5, cook: 12, rest: 0 }     # minutes
ingredients:
  - section: null     # or a heading such as "For the sauce"
    items:
      - { qty: 200, unit: g, item: spaghetti }
      - { qty: 2, unit: clove, item: garlic, prep: finely grated }
      - { qty: 1, qtyMax: 2, unit: tbsp, item: honey }          # a range
      - { qty: 2, unit: null, item: onions }                      # counted, no unit
      - { qty: null, unit: null, item: black pepper, note: to taste }
      - { qty: 1, unit: tbsp, item: oil, fixed: true }            # does not scale
      - { qty: 1, unit: handful, item: basil, optional: true }
steps:
  - text: Boil the spaghetti until just shy of al dente.
    timer: { minutes: 9, label: Spaghetti }
    tip: Save a mug of the cooking water.
equipment: [large pot]
tips: []
substitutions:
  - { for: white miso, use: red miso, note: use a little less }
storage: Best eaten straight away.
nutrition: { kcal: 640, protein: 21, carbs: 78, fat: 27, fibre: 4 }   # per serving
cover: { hue: 38, motif: noodles }
created: 2026-10-09
```

### Units

`g kg ml l tsp tbsp cup oz lb pinch clove sprig slice can bunch stick leaf handful piece`,
or `null` for things you count.

Write in metric. The app converts to US measures for people who want them.

### Ingredients must be known

Every ingredient has to match an entry in `data/ingredients/`, either by its
`item` text or by an explicit `key`:

```yaml
- { qty: 600, unit: g, item: beef shin or chuck, key: stewing beef }
```

The key is what lets the app merge shopping lists ("garlic" from three recipes
becomes one line) and answer "what can I make with what I have". If an
ingredient really is new, add it to the right aisle file:

```yaml
# data/ingredients/pantry.yaml
tagliatelle: [egg tagliatelle, pappardelle]
```

### Diet labels

Only list a diet if every ingredient complies, including the ones people
forget: honey is not vegan, soy sauce is not gluten-free, gelatine and fish
sauce are not vegetarian. When a shop-bought ingredient varies (stock cubes,
curry paste), say so in a tip.

### Cover

Recipes without a photo get generated cover art. `hue` (0–359) should suit the
dish; `motif` is one of
`bowl noodles leaf loaf citrus flame drop grain fish egg berry pepper cup slice pot`.

To add a photo, put a WebP at `images/<id>.webp`, ideally 1200 px wide and
under 200 KB, and credit it in `images/credits.yaml`:

```yaml
<id>:
  title: Name of the original photo
  author: Who made it
  license: CC BY-SA 4.0
  licenseUrl: https://creativecommons.org/licenses/by-sa/4.0
  source: https://commons.wikimedia.org/wiki/File:...
```

The photo must be your own work, public domain, CC0, CC BY or CC BY-SA.
Nothing marked NC (non-commercial) or ND (no derivatives), and nothing copied
from a recipe site, shop or search result without one of those licences. The
build fails if a photo has no credit, and the app shows the credit under the
recipe.

### Themes

A theme gives a group of recipes a shared look, such as every recipe from
one cookbook. It recolours the recipe page and cook mode, shows faint
artwork in the corner behind the text, and adds a badge to the recipe's
cards. Recipes can also be found by searching for the theme's name.

A theme is a folder under `themes/`:

```
themes/arcade-nights/theme.yaml
themes/arcade-nights/logo.svg
themes/arcade-nights/scout.webp
```

```yaml
# themes/arcade-nights/theme.yaml
name: Arcade Nights
accent: "#c96a00"        # buttons, step numbers, links
accentDark: "#f99e1a"    # optional, used in dark mode
art: logo.svg            # optional background artwork
credit: Artwork by Sam Example, CC BY 4.0
styles:                  # optional variations, e.g. one per character
  scout:
    label: Scout
    accent: "#1e88f7"
    art: scout.webp
```

A recipe opts in with:

```yaml
theme:
  id: arcade-nights
  style: scout   # optional
```

A style inherits anything it leaves out from its theme. Artwork is a
`.webp`, `.png` or `.svg`; a transparent background works best, since it is
shown faintly behind text. Pick an accent dark enough to read on white, and
set `accentDark` to a lighter one for dark mode.

Only add artwork you made or are allowed to share. Logos and character art
from games, films and published books belong to their owners and cannot be
added here, even for a cookbook you own.

### Style

- British English.
- One clear action per step. Give temperatures in °C with the fan setting.
- Add a `timer` wherever the cook waits a defined time.
- Describe what done looks like, not only how long it takes.
