# MapLocate

MapLocate is a Chrome extension for quickly finding selected settlements, villages, cities, and addresses on an interactive map.

## Features

- Find selected text on a map from any web page.
- Open results in the Chrome Side Panel or a compact quick-info popover.
- Search by Ukrainian or English place names.
- Show live suggestions and recent searches in the search field.
- Open a selected place in Google Maps or Google Search.
- Copy coordinates.
- Light, dark, and system themes.
- Ukrainian and English interface languages.

## Privacy Summary

MapLocate does not run its own tracking or analytics service. Search text is sent to Nominatim/OpenStreetMap to find map results. Google Maps and Google Search are opened only when the user clicks those actions.

See [PRIVACY.md](PRIVACY.md) for the full privacy policy draft.

## Contact

For bugs, suggestions, or feedback, contact:

- Email: `mbrnvwork@gmail.com`
- Telegram: `@barik_superman`

## Local Development

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select this repository folder.
5. Reload the extension after code changes and refresh already-open web pages.

## Release Build

Run the release checks and create the zip:

```sh
node tools/validate-release.mjs
zip -r MapLocate-1.0.0.zip . -x "*.git*" "MapLocate-*.zip"
```

Upload the generated zip to the Chrome Web Store Developer Dashboard.
