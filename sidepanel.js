import {
  applyTheme,
  buildSearchQuery,
  formatCoordinates,
  getActiveLanguage,
  getSettings,
  loadMessages,
  localizeDocument,
  watchSystemTheme
} from "./shared.js";

const TILE_SIZE = 256;
const LIGHT_TILE = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const DARK_TILE = "https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}.png";

const mapElement = document.querySelector("#map");
const mapStatus = document.querySelector("#mapStatus");
const results = document.querySelector("#results");
const searchForm = document.querySelector("#searchForm");
const searchInput = document.querySelector("#searchInput");
const clearSearchButton = document.querySelector("#clearSearchButton");
const suggestionsElement = document.querySelector("#suggestions");
const settingsButton = document.querySelector("#settingsButton");
const zoomInButton = document.querySelector("#zoomInButton");
const zoomOutButton = document.querySelector("#zoomOutButton");

let messages = {};
let settings = {};
let activeTheme = "light";
let marker = null;
let currentLocation = null;
let suggestions = [];
let activeSuggestionIndex = -1;
let suggestAbortController = null;
let suggestTimer = null;
let wheelDelta = 0;
let wheelTimer = null;
const tileElements = new Map();
let markerElement = null;
let mapState = {
  center: { lat: 49.0, lon: 31.0 },
  zoom: 6,
  dragging: false,
  startPoint: null,
  startCenter: null
};

function lonToX(lon, zoom) {
  return ((lon + 180) / 360) * TILE_SIZE * 2 ** zoom;
}

function latToY(lat, zoom) {
  const sin = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * TILE_SIZE * 2 ** zoom;
}

function xToLon(x, zoom) {
  return (x / (TILE_SIZE * 2 ** zoom)) * 360 - 180;
}

function yToLat(y, zoom) {
  const n = Math.PI - (2 * Math.PI * y) / (TILE_SIZE * 2 ** zoom);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

function project(lat, lon, zoom = mapState.zoom) {
  return { x: lonToX(lon, zoom), y: latToY(lat, zoom) };
}

function unproject(x, y, zoom = mapState.zoom) {
  return { lat: yToLat(y, zoom), lon: xToLon(x, zoom) };
}

function tileTemplate() {
  return activeTheme === "dark" ? DARK_TILE : LIGHT_TILE;
}

function tileUrl(x, y, z) {
  const tiles = 2 ** z;
  const wrappedX = ((x % tiles) + tiles) % tiles;
  return tileTemplate()
    .replace("{z}", z)
    .replace("{x}", wrappedX)
    .replace("{y}", y);
}

function ensureMarkerElement() {
  if (!markerElement) {
    markerElement = document.createElement("div");
    markerElement.className = "marker";
    mapElement.append(markerElement);
  }
  return markerElement;
}

function renderMap() {
  const { width, height } = mapElement.getBoundingClientRect();
  if (!width || !height) {
    return;
  }

  const center = project(mapState.center.lat, mapState.center.lon);
  const topLeft = {
    x: center.x - width / 2,
    y: center.y - height / 2
  };
  const minTileX = Math.floor(topLeft.x / TILE_SIZE) - 1;
  const maxTileX = Math.floor((topLeft.x + width) / TILE_SIZE) + 1;
  const minTileY = Math.max(0, Math.floor(topLeft.y / TILE_SIZE) - 1);
  const maxTileY = Math.min(2 ** mapState.zoom - 1, Math.floor((topLeft.y + height) / TILE_SIZE) + 1);
  const neededTiles = new Set();
  for (let x = minTileX; x <= maxTileX; x += 1) {
    for (let y = minTileY; y <= maxTileY; y += 1) {
      const key = `${activeTheme}:${mapState.zoom}:${x}:${y}`;
      neededTiles.add(key);
      let image = tileElements.get(key);
      if (!image) {
        image = new Image(TILE_SIZE, TILE_SIZE);
        image.className = "tile";
        image.alt = "";
        image.decoding = "async";
        image.referrerPolicy = "no-referrer";
        image.src = tileUrl(x, y, mapState.zoom);
        image.addEventListener("load", () => image.classList.add("loaded"), { once: true });
        tileElements.set(key, image);
        mapElement.append(image);
      }
      image.style.left = `${Math.round(x * TILE_SIZE - topLeft.x)}px`;
      image.style.top = `${Math.round(y * TILE_SIZE - topLeft.y)}px`;
    }
  }

  tileElements.forEach((image, key) => {
    if (!neededTiles.has(key)) {
      image.remove();
      tileElements.delete(key);
    }
  });

  if (marker) {
    const point = project(marker.lat, marker.lon);
    const pin = ensureMarkerElement();
    pin.style.left = `${point.x - topLeft.x}px`;
    pin.style.top = `${point.y - topLeft.y}px`;
    pin.classList.remove("hidden");
  } else if (markerElement) {
    markerElement.classList.add("hidden");
  }
}

function normalizeSearchText(value) {
  return String(value || "")
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’'`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function primaryLocationName(location) {
  const address = location.address || {};
  return address.city
    || address.town
    || address.village
    || address.hamlet
    || address.municipality
    || address.county
    || address.state
    || location.name
    || String(location.display_name || "").split(",")[0];
}

function knownPopulationScore(name) {
  const scores = {
    "київ": 5000, "kyiv": 5000, "kiev": 5000,
    "харків": 4400, "kharkiv": 4400,
    "одеса": 4200, "odesa": 4200, "odessa": 4200,
    "дніпро": 4000, "dnipro": 4000,
    "донецьк": 3900, "donetsk": 3900,
    "запоріжжя": 3800, "zaporizhzhia": 3800, "zaporizhia": 3800,
    "львів": 3700, "lviv": 3700, "lvov": 3700,
    "кривий ріг": 3600, "kryvyi rih": 3600,
    "миколаїв": 3500, "mykolaiv": 3500,
    "маріуполь": 3400, "mariupol": 3400,
    "вінниця": 3300, "vinnytsia": 3300,
    "херсон": 3200, "kherson": 3200,
    "полтава": 3100, "poltava": 3100,
    "чернігів": 3000, "chernihiv": 3000,
    "черкаси": 2900, "cherkasy": 2900,
    "житомир": 2800, "zhytomyr": 2800,
    "суми": 2700, "sumy": 2700,
    "рівне": 2600, "rivne": 2600,
    "івано франківськ": 2500, "ivano frankivsk": 2500,
    "тернопіль": 2400, "ternopil": 2400,
    "луцьк": 2300, "lutsk": 2300,
    "ужгород": 2200, "uzhhorod": 2200,
    "хмельницький": 2100, "khmelnytskyi": 2100,
    "чернівці": 2000, "chernivtsi": 2000
  };
  return scores[normalizeSearchText(name)] || 0;
}

function locationScore(location, query) {
  const cleanQuery = normalizeSearchText(query);
  const displayName = normalizeSearchText(location.display_name);
  const primaryName = normalizeSearchText(primaryLocationName(location));
  const locationType = normalizeSearchText(location.type);
  const locationClass = normalizeSearchText(location.class);
  const settlementTypes = new Set(["city", "town", "village", "hamlet", "municipality", "suburb", "neighbourhood"]);
  const administrativeTypes = new Set(["administrative", "state", "region", "county", "province", "oblast"]);
  let score = knownPopulationScore(primaryName);

  if (primaryName === cleanQuery) {
    score += 120;
  } else if (primaryName.startsWith(cleanQuery)) {
    score += 70;
  } else if (displayName.startsWith(cleanQuery)) {
    score += 45;
  } else if (displayName.includes(cleanQuery)) {
    score += 18;
  }

  if (settlementTypes.has(locationType)) {
    score += locationType === "city" ? 420 : 160;
  }

  if (locationClass === "place") {
    score += 180;
  }

  if (locationClass === "boundary" || administrativeTypes.has(locationType)) {
    score -= 420;
  }

  if (location.address?.city || location.address?.town) {
    score += 260;
  }

  if (location.address?.village || location.address?.hamlet) {
    score += 45;
  }

  if ((location.address?.city || location.address?.town) && primaryName === cleanQuery) {
    score += 220;
  }

  return score;
}

function rankLocations(query, locations) {
  return [...locations].sort((left, right) => {
    const scoreDiff = locationScore(right, query) - locationScore(left, query);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
    return Number(right.importance || 0) - Number(left.importance || 0);
  });
}

function zoomTo(nextZoom, anchor = null) {
  const boundedZoom = Math.max(2, Math.min(18, nextZoom));
  if (boundedZoom === mapState.zoom) {
    return;
  }

  if (!anchor) {
    mapState.zoom = boundedZoom;
    renderMap();
    return;
  }

  const before = screenToGeo(anchor.clientX, anchor.clientY);
  mapState.zoom = boundedZoom;
  const afterPoint = project(before.lat, before.lon, boundedZoom);
  const rect = mapElement.getBoundingClientRect();
  const centerX = afterPoint.x - (anchor.clientX - rect.left - rect.width / 2);
  const centerY = afterPoint.y - (anchor.clientY - rect.top - rect.height / 2);
  mapState.center = unproject(centerX, centerY, boundedZoom);
  renderMap();
}

function setMapView(lat, lon, zoom = 13) {
  mapState.center = { lat: Number(lat), lon: Number(lon) };
  mapState.zoom = Math.max(2, Math.min(18, zoom));
  marker = { lat: Number(lat), lon: Number(lon) };
  renderMap();
}

function screenToGeo(clientX, clientY) {
  const rect = mapElement.getBoundingClientRect();
  const center = project(mapState.center.lat, mapState.center.lon);
  return unproject(
    center.x - rect.width / 2 + clientX - rect.left,
    center.y - rect.height / 2 + clientY - rect.top
  );
}

function startDrag(event) {
  mapState.dragging = true;
  mapState.startPoint = { x: event.clientX, y: event.clientY };
  mapState.startCenter = project(mapState.center.lat, mapState.center.lon);
  mapElement.classList.add("dragging");
  mapElement.setPointerCapture(event.pointerId);
}

function drag(event) {
  if (!mapState.dragging) {
    return;
  }
  const dx = event.clientX - mapState.startPoint.x;
  const dy = event.clientY - mapState.startPoint.y;
  mapState.center = unproject(mapState.startCenter.x - dx, mapState.startCenter.y - dy);
  renderMap();
}

function stopDrag(event) {
  mapState.dragging = false;
  mapElement.classList.remove("dragging");
  if (mapElement.hasPointerCapture(event.pointerId)) {
    mapElement.releasePointerCapture(event.pointerId);
  }
}

function zoomMap(event) {
  event.preventDefault();
  wheelDelta += event.deltaY;
  clearTimeout(wheelTimer);
  wheelTimer = setTimeout(() => {
    wheelDelta = 0;
  }, 180);
  if (Math.abs(wheelDelta) < 110) {
    return;
  }

  const direction = wheelDelta > 0 ? -1 : 1;
  wheelDelta = 0;
  zoomTo(mapState.zoom + direction);
}

function showStatus(key) {
  mapStatus.textContent = messages[key] || key;
  mapStatus.classList.remove("hidden");
}

function hideStatus() {
  mapStatus.classList.add("hidden");
}

function stateCard(titleKey, bodyKey) {
  const card = document.createElement("article");
  card.className = "state-card";
  const title = document.createElement("strong");
  title.textContent = messages[titleKey] || titleKey;
  const body = document.createElement("span");
  body.textContent = messages[bodyKey] || bodyKey;
  card.append(title, body);
  results.replaceChildren(card);
}

function googleMapsQuery(location) {
  const address = location.address || {};
  const placeName = primaryLocationName(location);
  const details = [
    address.city || address.town || address.village || address.hamlet ? "" : address.county,
    address.state,
    address.country
  ].filter(Boolean);
  return [placeName, ...details].filter(Boolean).join(", ") || location.display_name;
}

function googleMapsUrl(location) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(googleMapsQuery(location))}`;
}

function directionsUrl(location) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(googleMapsQuery(location))}`;
}

async function copyText(value, successKey) {
  try {
    await navigator.clipboard.writeText(value);
    showStatus(successKey);
    setTimeout(hideStatus, 1400);
  } catch {
    showStatus("copyFailed");
  }
}

function sameLocation(left, right) {
  return String(left.place_id || "") === String(right.place_id || "")
    || `${left.lat},${left.lon}` === `${right.lat},${right.lon}`;
}

function renderAlternatives(selectedLocation, alternatives) {
  const uniqueAlternatives = alternatives
    .filter((location) => !sameLocation(location, selectedLocation))
    .slice(0, 5);

  if (!uniqueAlternatives.length) {
    return null;
  }

  const card = document.createElement("article");
  card.className = "alternatives-card";
  const title = document.createElement("h3");
  title.textContent = messages.maybeOtherPlace;
  const list = document.createElement("div");
  list.className = "alternative-list";

  uniqueAlternatives.forEach((location) => {
    const option = document.createElement("button");
    option.className = "alternative-option";
    option.type = "button";
    option.textContent = location.display_name;
    option.addEventListener("click", () => {
      renderLocation(location, uniqueAlternatives);
    });
    list.append(option);
  });

  card.append(title, list);
  return card;
}

function renderLocation(location, alternatives = []) {
  currentLocation = location;
  const coordinates = formatCoordinates(location.lat, location.lon);
  const card = document.createElement("article");
  card.className = "location-card";

  const title = document.createElement("h2");
  title.className = "location-title";
  title.textContent = location.display_name;

  const meta = document.createElement("dl");
  meta.className = "meta-list";
  [
    ["address", location.display_name],
    ["coordinates", coordinates]
  ].forEach(([labelKey, value]) => {
    const row = document.createElement("div");
    row.className = "meta-row";
    const label = document.createElement("dt");
    label.className = "meta-label";
    label.textContent = messages[labelKey];
    const itemValue = document.createElement("dd");
    itemValue.className = "meta-value";
    itemValue.textContent = value;
    row.append(label, itemValue);
    meta.append(row);
  });

  const actions = document.createElement("div");
  actions.className = "actions";
  const actionItems = [
    ["openInGoogleMaps", () => chrome.tabs.create({ url: googleMapsUrl(location) })],
    ["getDirections", () => chrome.tabs.create({ url: directionsUrl(location) })],
    ["copyAddress", () => copyText(location.display_name, "addressCopied")],
    ["copyCoordinates", () => copyText(coordinates, "coordinatesCopied")]
  ];
  actionItems.forEach(([key, handler]) => {
    const button = document.createElement("button");
    button.className = "secondary-button";
    button.type = "button";
    button.textContent = messages[key];
    button.addEventListener("click", handler);
    actions.append(button);
  });

  card.append(title, meta, actions);
  const alternativesCard = renderAlternatives(location, alternatives);
  results.replaceChildren(...[card, alternativesCard].filter(Boolean));
  setMapView(location.lat, location.lon);
}

function renderDuplicates(locations) {
  const overlay = document.createElement("div");
  overlay.className = "duplicates";
  const panel = document.createElement("section");
  panel.className = "duplicates-panel";
  const header = document.createElement("div");
  header.className = "duplicates-header";
  const title = document.createElement("h2");
  title.textContent = messages.multipleLocationsFound;
  const closeButton = document.createElement("button");
  closeButton.className = "modal-close-button";
  closeButton.type = "button";
  closeButton.title = messages.close;
  closeButton.setAttribute("aria-label", messages.close);
  closeButton.append(document.createElement("span"));
  closeButton.addEventListener("click", () => overlay.remove());
  const intro = document.createElement("p");
  intro.textContent = messages.selectCorrectLocation;
  const list = document.createElement("div");
  list.className = "duplicate-list";

  locations.slice(0, 6).forEach((location) => {
    const option = document.createElement("button");
    option.className = "duplicate-option";
    option.type = "button";
    option.textContent = location.display_name;
    option.addEventListener("click", () => {
      overlay.remove();
      renderLocation(location);
    });
    list.append(option);
  });

  const cancelButton = document.createElement("button");
  cancelButton.className = "secondary-button modal-cancel-button";
  cancelButton.type = "button";
  cancelButton.textContent = messages.cancel;
  cancelButton.addEventListener("click", () => overlay.remove());

  header.append(title, closeButton);
  panel.append(header, intro, list, cancelButton);
  overlay.append(panel);
  document.body.append(overlay);
}

function hideSuggestions() {
  suggestionsElement.classList.add("hidden");
  suggestionsElement.replaceChildren();
  searchInput.setAttribute("aria-expanded", "false");
  activeSuggestionIndex = -1;
}

function renderSuggestions(locations) {
  suggestions = locations.slice(0, 6);
  activeSuggestionIndex = -1;
  suggestionsElement.replaceChildren();

  if (!suggestions.length) {
    hideSuggestions();
    return;
  }

  suggestions.forEach((location, index) => {
    const option = document.createElement("button");
    option.className = "suggestion-option";
    option.id = `suggestion-${index}`;
    option.type = "button";
    option.role = "option";
    option.textContent = location.display_name;
    option.addEventListener("mousedown", (event) => event.preventDefault());
    option.addEventListener("click", () => {
      searchInput.value = location.display_name;
      updateClearButton();
      hideSuggestions();
      renderLocation(location);
    });
    suggestionsElement.append(option);
  });

  suggestionsElement.classList.remove("hidden");
  searchInput.setAttribute("aria-expanded", "true");
}

function updateActiveSuggestion(nextIndex) {
  const options = [...suggestionsElement.querySelectorAll(".suggestion-option")];
  options.forEach((option) => option.classList.remove("active"));
  activeSuggestionIndex = nextIndex;
  if (activeSuggestionIndex >= 0 && options[activeSuggestionIndex]) {
    options[activeSuggestionIndex].classList.add("active");
    searchInput.setAttribute("aria-activedescendant", options[activeSuggestionIndex].id);
  } else {
    searchInput.removeAttribute("aria-activedescendant");
  }
}

async function fetchSuggestions(query) {
  const cleanQuery = query.trim();
  if (cleanQuery.length < 2) {
    hideSuggestions();
    return;
  }

  suggestAbortController?.abort();
  suggestAbortController = new AbortController();

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.search = new URLSearchParams({
    q: buildSearchQuery(cleanQuery, settings),
    format: "jsonv2",
    addressdetails: "1",
    limit: "6",
    dedupe: "1",
    "accept-language": await getActiveLanguage()
  });

  try {
    const response = await fetch(url, { signal: suggestAbortController.signal });
    if (!response.ok) {
      throw new Error(response.statusText);
    }
    renderSuggestions(rankLocations(cleanQuery, await response.json()));
  } catch (error) {
    if (error.name !== "AbortError") {
      hideSuggestions();
    }
  }
}

function scheduleSuggestions() {
  clearTimeout(suggestTimer);
  suggestTimer = setTimeout(() => fetchSuggestions(searchInput.value), 260);
}

function updateClearButton() {
  clearSearchButton.classList.toggle("visible", searchInput.value.trim().length > 0);
}

async function searchPlace(query) {
  const cleanQuery = query.trim();
  if (!cleanQuery) {
    stateCard("searchForPlace", "enterPlace");
    return;
  }

  showStatus("searching");
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.search = new URLSearchParams({
    q: buildSearchQuery(cleanQuery, settings),
    format: "jsonv2",
    addressdetails: "1",
    limit: "8",
    dedupe: "1",
    "accept-language": await getActiveLanguage()
  });

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(response.statusText);
    }
    const locations = rankLocations(cleanQuery, await response.json());
    hideStatus();
    if (!locations.length) {
      stateCard("noResultsFound", "checkPlaceNameOrAddress");
      return;
    }
    renderLocation(locations[0], locations);
  } catch {
    showStatus("unableToLoadMap");
    stateCard("unableToLoadMap", "checkPlaceNameOrAddress");
  }
}

async function loadPendingSearch() {
  const { pendingSearch } = await chrome.storage.session.get("pendingSearch");
  if (!pendingSearch?.query) {
    stateCard("searchForPlace", "enterPlace");
    return;
  }

  await chrome.storage.session.remove("pendingSearch");
  searchInput.value = pendingSearch.query;
  updateClearButton();
  await searchPlace(pendingSearch.query);
}

async function usePendingSearch(pendingSearch) {
  if (!pendingSearch?.query) {
    return;
  }
  searchInput.value = pendingSearch.query;
  updateClearButton();
  await searchPlace(pendingSearch.query);
}

async function refreshTheme(themePreference) {
  activeTheme = await applyTheme(themePreference);
  renderMap();
}

async function init() {
  settings = await getSettings();
  activeTheme = await applyTheme(settings.theme);
  messages = await loadMessages();
  await localizeDocument();
  renderMap();
  await loadPendingSearch();
}

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  hideSuggestions();
  searchPlace(searchInput.value);
});

searchInput.addEventListener("input", () => {
  updateClearButton();
  scheduleSuggestions();
});

clearSearchButton.addEventListener("click", () => {
  searchInput.value = "";
  updateClearButton();
  hideSuggestions();
  searchInput.focus();
  stateCard("searchForPlace", "enterPlace");
});

searchInput.addEventListener("keydown", (event) => {
  if (suggestionsElement.classList.contains("hidden")) {
    return;
  }

  if (event.key === "ArrowDown") {
    event.preventDefault();
    updateActiveSuggestion(Math.min(activeSuggestionIndex + 1, suggestions.length - 1));
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    updateActiveSuggestion(Math.max(activeSuggestionIndex - 1, -1));
  }

  if (event.key === "Enter" && activeSuggestionIndex >= 0) {
    event.preventDefault();
    const location = suggestions[activeSuggestionIndex];
    searchInput.value = location.display_name;
    updateClearButton();
    hideSuggestions();
    renderLocation(location);
  }

  if (event.key === "Escape") {
    hideSuggestions();
  }
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".search-combo")) {
    hideSuggestions();
  }
});

settingsButton.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

zoomInButton.addEventListener("click", () => zoomTo(mapState.zoom + 1));
zoomOutButton.addEventListener("click", () => zoomTo(mapState.zoom - 1));

mapElement.addEventListener("pointerdown", startDrag);
mapElement.addEventListener("pointermove", drag);
mapElement.addEventListener("pointerup", stopDrag);
mapElement.addEventListener("pointercancel", stopDrag);
mapElement.addEventListener("wheel", zoomMap, { passive: false });
window.addEventListener("resize", renderMap);

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "sync") {
    return;
  }
  settings = await getSettings();
  if (changes.theme) {
    await refreshTheme(settings.theme);
  }
  if (changes.language) {
    messages = await loadMessages(settings.language);
    await localizeDocument();
    if (currentLocation) {
      renderLocation(currentLocation);
    }
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "MAPLOCATE_PENDING_SEARCH") {
    usePendingSearch(message.pendingSearch);
  }
});

watchSystemTheme(async () => {
  if ((await getSettings()).theme === "system") {
    await refreshTheme("system");
  }
});

init();
