# Theme System

AP Tracker themes are owned by `js/theme-engine.js` and cataloged through `js/theme-catalog.js`. Runtime pages should consume these modules instead of duplicating theme defaults, storage keys, selection parsing, or store-item normalization.

## Selection Keys

Persisted theme selections use one of these stable keys:

- Built-in theme key: `midnight`, `arctic`, `forest`, etc.
- Local custom theme key: `custom_<id>`.
- Store custom theme key: `storetheme_<storeItemId>`.

Compatibility reads must continue accepting:

- `dark` -> `midnight`
- `light` -> `arctic`
- `storeitem:<storeItemId>` -> store custom theme or built-in theme resolved from the store item

The active selection is stored in localStorage under `pressTrackerTheme` and mirrored to the user profile when signed in.

## User Preference Shape

User-scoped preferences live on `users/{uid}.themePrefs` in Firestore and in the D1 user context as `themePrefs`.

```js
{
  activeTheme: "midnight | custom_<id> | storetheme_<id>",
  customThemes: [
    {
      id: "custom_...",
      name: "Theme name",
      vars: {
        "--bg": "#0d1117",
        "--color-bg": "#0d1117",
        "--accent": "#f97316"
      },
      createdAt: 1710000000000,
      updatedAt: 1710000000000
    }
  ]
}
```

Local custom themes are also cached in localStorage under `apTracker_customThemes` with `{ customThemes, activeCustomId }`.

## Store Theme Item Shape

Plant/global store config theme items use this shape:

```js
{
  id: "theme_midnight | storeitem_...",
  type: "theme",
  themeKey: "midnight | null",
  name: "Theme name",
  price: 0,
  isActive: true,
  order: 0,
  customVars: null
}
```

For built-ins, `themeKey` identifies the canonical built-in theme and `customVars` can be `null`. For custom store themes, `themeKey` is `null` and `customVars` contains CSS custom properties.

## Token Rules

- Theme vars must be CSS custom properties whose keys start with `--`.
- Legacy tokens such as `--bg`, `--accent`, and `--text` remain supported and are synchronized with modern `--color-*` tokens.
- Non-color CSS values are allowed for layout/theme tokens such as shadows, fonts, radii, `color-mix(...)`, and SVG backgrounds.
- `--bg-svg` is converted to a CSS data URL by the theme engine when applied.
- Contrast checks are advisory only; low contrast should warn in the editor, not block floor usage.

## Application Flow

Runtime theme actions should use the shared pipeline:

1. Normalize the selection key.
2. Resolve the catalog entry from built-ins, local custom themes, store themes, and inventory.
3. Enforce ownership unless the action is a preview.
4. Apply through `applyThemeVars` / `applyResolvedTheme`.
5. Persist only for non-preview applies.
6. Refresh active UI labels and mode toggles.
