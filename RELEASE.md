# MapLocate Release Notes

## Release Candidate

Version: `1.0.0`

## Chrome Web Store Listing Draft

Short description:

Find selected settlements, cities, villages, and addresses on an interactive map.

Detailed description:

MapLocate helps you quickly locate places from any web page. Select a city, village, settlement, or address, click the MapLocate button, and open the result in the Chrome Side Panel or a compact quick-info popover.

MapLocate supports Ukrainian and English interface languages, light and dark themes, search suggestions, recent searches, Google Maps actions, and quick coordinate copying.

Support contact:

Email: `mbrnvwork@gmail.com`

Telegram: `@barik_superman`

## Release Checklist

- Manifest V3 is used.
- Extension logic is packaged locally.
- No remote script tags are used.
- No `eval()` or dynamic remote code execution is used by MapLocate source files.
- Ukrainian and English locale keys are aligned.
- Permissions are limited to context menus, side panel, storage, content-script access, Nominatim, and OpenStreetMap tiles.
- Privacy policy draft is included in `PRIVACY.md`.
- The release zip excludes Git metadata and existing release archives.

## Manual QA

- Load unpacked extension in Chrome.
- Check default language with Chrome set to Ukrainian.
- Check default language with Chrome set to English or another non-Ukrainian language.
- Search for `Львів`, `Рівне`, `Хмельницький`, `Kyiv`, and `Lviv`.
- Verify suggestions appear while typing.
- Verify recent searches appear when focusing an empty search field.
- Switch light, dark, and system theme.
- Verify dark map tiles do not show authentication errors.
- Select text on a regular web page and confirm the MapLocate button appears.
- Test both Side Panel and quick-info selection modes.
- Confirm quick-info closes when clicking outside the popover.
- Confirm Open in Google Maps opens a place query, not raw coordinates.

## Known Follow-Up

The location-ranking logic is duplicated between `background.js` and `sidepanel.js`. It is acceptable for this release candidate, but should be extracted into a shared module before larger search-ranking changes.
