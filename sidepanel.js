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

const LIGHT_TILE = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const RECENT_LIMIT = 5;

const mapElement = document.querySelector("#map");
const mapStatus = document.querySelector("#mapStatus");
const toast = document.querySelector("#toast");
const results = document.querySelector("#results");
const searchForm = document.querySelector("#searchForm");
const searchInput = document.querySelector("#searchInput");
const clearSearchButton = document.querySelector("#clearSearchButton");
const suggestionsElement = document.querySelector("#suggestions");
const settingsButton = document.querySelector("#settingsButton");
const zoomInButton = document.querySelector("#zoomInButton");
const zoomOutButton = document.querySelector("#zoomOutButton");
const recenterButton = document.querySelector("#recenterButton");

let messages = {};
let settings = {};
let activeTheme = "light";
let map = null;
let tileLayer = null;
let marker = null;
let currentLocation = null;
let currentZoom = 6;
let suggestions = [];
let activeSuggestionIndex = -1;
let suggestAbortController = null;
let suggestTimer = null;
let toastTimer = null;

function tileTemplate() {
  return LIGHT_TILE;
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

function knownCityProfile(query) {
  const cleanQuery = normalizeSearchText(query);
  const profiles = [
    {
      aliases: ["львів", "lviv", "lvov", "lwow"],
      regions: ["львівська область", "lviv oblast"]
    },
    {
      aliases: ["рівне", "rivne", "rovno"],
      regions: ["рівненська область", "rivne oblast"]
    },
    {
      aliases: ["хмельницький", "khmelnytskyi", "khmelnitsky", "khmelnytskyy"],
      regions: ["хмельницька область", "khmelnytskyi oblast", "khmelnytskyy oblast"]
    },
    {
      aliases: ["київ", "kyiv", "kiev"],
      regions: ["місто київ", "kyiv city"]
    },
    {
      aliases: ["харків", "kharkiv", "kharkov"],
      regions: ["харківська область", "kharkiv oblast"]
    },
    {
      aliases: ["одеса", "odesa", "odessa"],
      regions: ["одеська область", "odesa oblast", "odessa oblast"]
    },
    {
      aliases: ["дніпро", "dnipro", "dnepr"],
      regions: ["дніпропетровська область", "dnipropetrovsk oblast"]
    }
  ];
  return profiles.find((profile) => profile.aliases.some((alias) => normalizeSearchText(alias) === cleanQuery)) || null;
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

function languageForQuery(query) {
  return /[А-Яа-яІіЇїЄєҐґ]/.test(query) ? "uk" : getActiveLanguage();
}

function knownCityAliases(query) {
  const cleanQuery = normalizeSearchText(query);
  const aliases = {
    "львів": ["львів", "lviv", "lvov", "lwow"],
    "lviv": ["львів", "lviv", "lvov", "lwow"],
    "lvov": ["львів", "lviv", "lvov", "lwow"],
    "київ": ["київ", "kyiv", "kiev"],
    "kyiv": ["київ", "kyiv", "kiev"],
    "kiev": ["київ", "kyiv", "kiev"],
    "харків": ["харків", "kharkiv", "kharkov"],
    "kharkiv": ["харків", "kharkiv", "kharkov"],
    "одеса": ["одеса", "odesa", "odessa"],
    "odesa": ["одеса", "odesa", "odessa"],
    "дніпро": ["дніпро", "dnipro", "dnepr"],
    "dnipro": ["дніпро", "dnipro", "dnepr"],
    "рівне": ["рівне", "rivne", "rovno"],
    "rivne": ["рівне", "rivne", "rovno"],
    "хмельницький": ["хмельницький", "khmelnytskyi", "khmelnitsky"],
    "khmelnytskyi": ["хмельницький", "khmelnytskyi", "khmelnitsky"]
  };
  return aliases[cleanQuery] || (knownCityScore(cleanQuery) ? [cleanQuery] : []);
}

function textIncludesAny(text, aliases) {
  const cleanText = normalizeSearchText(text);
  return aliases.some((alias) => cleanText.includes(normalizeSearchText(alias)));
}

function locationSubtitle(location) {
  const address = location.address || {};
  return [
    address.county || address.district || address.municipality,
    address.state || address.region || address.province,
    address.country
  ].filter(Boolean).join(", ");
}

function locationRegionText(location) {
  const address = location.address || {};
  return normalizeSearchText([
    address.state,
    address.region,
    address.province,
    address.state_district,
    location.display_name
  ].filter(Boolean).join(" "));
}

function matchesKnownCityRegion(location, query) {
  const profile = knownCityProfile(query);
  if (!profile) {
    return false;
  }
  const regionText = locationRegionText(location);
  return profile.regions.some((region) => regionText.includes(normalizeSearchText(region)));
}

function isWrongKnownCityRegion(location, query) {
  const profile = knownCityProfile(query);
  if (!profile) {
    return false;
  }
  const address = location.address || {};
  const country = normalizeSearchText(address.country || "");
  const hasKnownCityName = textIncludesAny(primaryLocationName(location), profile.aliases)
    || textIncludesAny(location.display_name, profile.aliases);
  return hasKnownCityName
    && (country.includes("україна") || country.includes("ukraine") || normalizeSearchText(location.display_name).includes("україна"))
    && !matchesKnownCityRegion(location, query);
}

function knownCityScore(name) {
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

function isKnownMajorCityResult(location, query) {
  const cleanQuery = normalizeSearchText(query);
  const address = location.address || {};
  const primaryName = normalizeSearchText(primaryLocationName(location));
  const cityName = normalizeSearchText(address.city || address.town || "");
  const state = normalizeSearchText(address.state || address.region || address.province || "");
  const municipality = normalizeSearchText(address.municipality || "");
  const displayName = normalizeSearchText(location.display_name);
  const aliases = knownCityAliases(query);
  const cityScore = knownCityScore(cleanQuery) || Math.max(...aliases.map(knownCityScore), 0);

  if (!cityScore || !aliases.length) {
    return false;
  }

  if (aliases.some((alias) => cityName === normalizeSearchText(alias) || primaryName === normalizeSearchText(alias))) {
    return !knownCityProfile(query) || matchesKnownCityRegion(location, query);
  }

  const hasCityInName = textIncludesAny(displayName, aliases) || textIncludesAny(primaryName, aliases);
  const hasCityContext = textIncludesAny(state, aliases) || textIncludesAny(municipality, aliases) || displayName.includes("city council") || displayName.includes("міська громада");
  return hasCityInName && (hasCityContext || matchesKnownCityRegion(location, query));
}

function locationScore(location, query) {
  const cleanQuery = normalizeSearchText(query);
  const displayName = normalizeSearchText(location.display_name);
  const primaryName = normalizeSearchText(primaryLocationName(location));
  const locationType = normalizeSearchText(location.type);
  const locationClass = normalizeSearchText(location.class);
  const settlementTypes = new Set(["city", "town", "village", "hamlet", "municipality", "suburb", "neighbourhood"]);
  const administrativeTypes = new Set(["administrative", "state", "region", "county", "province", "oblast"]);
  const aliases = knownCityAliases(query);
  const cityScore = knownCityScore(cleanQuery) || Math.max(...aliases.map(knownCityScore), 0);
  let score = isKnownMajorCityResult(location, query) ? cityScore : 0;

  if (primaryName === cleanQuery) score += 120;
  else if (primaryName.startsWith(cleanQuery)) score += 70;
  else if (displayName.startsWith(cleanQuery)) score += 45;
  else if (displayName.includes(cleanQuery)) score += 18;

  if (settlementTypes.has(locationType)) score += locationType === "city" ? 420 : 160;
  if (locationClass === "place") score += 180;
  if (locationClass === "boundary" || administrativeTypes.has(locationType)) score -= 420;
  if (location.address?.city || location.address?.town) score += 260;
  if (location.address?.village || location.address?.hamlet) score -= 140;
  if ((location.address?.city || location.address?.town) && primaryName === cleanQuery) score += 220;
  if (isKnownMajorCityResult(location, query)) score += 1200;
  if (matchesKnownCityRegion(location, query)) score += 2600;
  if (isWrongKnownCityRegion(location, query)) score -= 3200;

  return score;
}

function rankLocations(query, locations) {
  return [...locations].sort((left, right) => {
    const scoreDiff = locationScore(right, query) - locationScore(left, query);
    return scoreDiff || Number(right.importance || 0) - Number(left.importance || 0);
  });
}

function zoomForLocation(location) {
  const type = normalizeSearchText(location.type);
  const address = location.address || {};
  if (address.house_number || address.road) return 16;
  if (type === "city" || type === "town" || address.city || address.town) return 12;
  if (type === "village" || type === "hamlet" || address.village || address.hamlet) return 14;
  if (type === "administrative" || location.class === "boundary") return 9;
  return 13;
}

function markerIcon() {
  return L.divIcon({
    className: "maplocate-marker",
    html: "<span class=\"maplocate-marker-pin\"><i></i></span>",
    iconSize: [34, 42],
    iconAnchor: [17, 40]
  });
}

function initMap() {
  map = L.map(mapElement, {
    zoomControl: false,
    attributionControl: true,
    scrollWheelZoom: true,
    wheelDebounceTime: 40,
    wheelPxPerZoomLevel: 70,
    inertia: true,
    zoomSnap: 1,
    zoomDelta: 1
  }).setView([49, 31], currentZoom);

  map.attributionControl.setPrefix("");
  tileLayer = L.tileLayer(tileTemplate(), {
    maxZoom: 19,
    detectRetina: true,
    attribution: messages.mapAttribution || ""
  }).addTo(map);
}

function refreshTileLayer() {
  if (!map) return;
  const center = map.getCenter();
  const zoom = map.getZoom();
  if (tileLayer) {
    map.removeLayer(tileLayer);
  }
  tileLayer = L.tileLayer(tileTemplate(), {
    maxZoom: 19,
    detectRetina: true,
    attribution: messages.mapAttribution || ""
  }).addTo(map);
  map.setView(center, zoom, { animate: false });
}

function setMapView(location, zoom = zoomForLocation(location), animate = true) {
  const latLng = [Number(location.lat), Number(location.lon)];
  currentZoom = zoom;
  if (!marker) {
    marker = L.marker(latLng, { icon: markerIcon(), keyboard: false }).addTo(map);
  } else {
    marker.setLatLng(latLng);
  }
  marker.getElement()?.classList.remove("pulse");
  requestAnimationFrame(() => marker.getElement()?.classList.add("pulse"));
  map.flyTo(latLng, zoom, { animate, duration: animate ? 0.55 : 0 });
}

function showStatus(key) {
  mapStatus.textContent = messages[key] || key;
  mapStatus.classList.remove("hidden");
}

function hideStatus() {
  mapStatus.classList.add("hidden");
}

function showToast(key, type = "success") {
  clearTimeout(toastTimer);
  toast.textContent = messages[key] || key;
  toast.dataset.type = type;
  toast.classList.remove("hidden", "visible");
  requestAnimationFrame(() => toast.classList.add("visible"));
  toastTimer = setTimeout(() => {
    toast.classList.remove("visible");
    toastTimer = setTimeout(() => toast.classList.add("hidden"), 180);
  }, 1500);
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
    showToast(successKey);
  } catch {
    showToast("copyFailed", "error");
  }
}

function sameLocation(left, right) {
  return String(left.place_id || "") === String(right.place_id || "")
    || `${left.lat},${left.lon}` === `${right.lat},${right.lon}`;
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

async function recentLocations() {
  const { recentLocations = [] } = await chrome.storage.local.get({ recentLocations: [] });
  return recentLocations;
}

async function saveRecentLocation(location) {
  const item = {
    place_id: location.place_id,
    lat: location.lat,
    lon: location.lon,
    display_name: location.display_name,
    type: location.type,
    class: location.class,
    address: location.address || {},
    savedAt: Date.now()
  };
  const existing = await recentLocations();
  const next = [item, ...existing.filter((saved) => !sameLocation(saved, item))].slice(0, RECENT_LIMIT);
  await chrome.storage.local.set({ recentLocations: next });
}

function renderAlternatives(selectedLocation, alternatives) {
  const uniqueAlternatives = alternatives
    .filter((location) => !sameLocation(location, selectedLocation))
    .slice(0, 5);

  if (!uniqueAlternatives.length) return null;

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
    option.addEventListener("click", () => renderLocation(location, uniqueAlternatives));
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
  title.textContent = primaryLocationName(location);

  const subtitleText = locationSubtitle(location);
  if (subtitleText) {
    const subtitle = document.createElement("p");
    subtitle.className = "location-subtitle";
    subtitle.textContent = subtitleText;
    card.append(title, subtitle);
  } else {
    card.append(title);
  }

  const meta = document.createElement("dl");
  meta.className = "meta-list";
  const row = document.createElement("div");
  row.className = "meta-row";
  const label = document.createElement("dt");
  label.className = "meta-label";
  label.textContent = messages.coordinates;
  const itemValue = document.createElement("dd");
  itemValue.className = "meta-value";
  itemValue.textContent = coordinates;
  row.append(label, itemValue);
  meta.append(row);

  const actions = document.createElement("div");
  actions.className = "actions";
  [
    ["openInGoogleMaps", () => chrome.tabs.create({ url: googleMapsUrl(location) })],
    ["getDirections", () => chrome.tabs.create({ url: directionsUrl(location) })],
    ["copyAddress", () => copyText(location.display_name, "addressCopied")],
    ["copyCoordinates", () => copyText(coordinates, "coordinatesCopied")]
  ].forEach(([key, handler]) => {
    const button = document.createElement("button");
    button.className = "secondary-button";
    button.type = "button";
    button.textContent = messages[key];
    button.addEventListener("click", handler);
    actions.append(button);
  });

  card.append(meta, actions);
  const alternativesCard = renderAlternatives(location, alternatives);
  results.replaceChildren(...[card, alternativesCard].filter(Boolean));
  setMapView(location);
  saveRecentLocation(location);
}

function hideSuggestions() {
  suggestionsElement.classList.add("hidden");
  suggestionsElement.replaceChildren();
  searchInput.setAttribute("aria-expanded", "false");
  activeSuggestionIndex = -1;
}

function chooseSuggestion(location, alternatives = []) {
  searchInput.value = primaryLocationName(location);
  updateClearButton();
  hideSuggestions();
  renderLocation(location, alternatives);
}

function renderSuggestionList(locations, mode = "search") {
  suggestions = locations.slice(0, 6);
  activeSuggestionIndex = -1;
  suggestionsElement.replaceChildren();

  if (!suggestions.length) {
    hideSuggestions();
    return;
  }

  if (mode === "recent") {
    const title = document.createElement("div");
    title.className = "suggestions-title";
    title.textContent = messages.recentSearches;
    suggestionsElement.append(title);
  }

  suggestions.forEach((location, index) => {
    const option = document.createElement("button");
    option.className = `suggestion-option ${mode === "recent" ? "recent-suggestion" : ""}`;
    option.id = `suggestion-${index}`;
    option.type = "button";
    option.role = "option";
    const name = document.createElement("strong");
    name.textContent = primaryLocationName(location);
    const subtitle = document.createElement("span");
    subtitle.textContent = locationSubtitle(location) || location.display_name;
    option.append(name, subtitle);
    option.addEventListener("mousedown", (event) => event.preventDefault());
    option.addEventListener("click", () => chooseSuggestion(location, suggestions));
    suggestionsElement.append(option);
  });

  suggestionsElement.classList.remove("hidden");
  searchInput.setAttribute("aria-expanded", "true");
}

function renderSuggestions(locations) {
  renderSuggestionList(locations, "search");
}

async function showRecentSuggestions() {
  if (searchInput.value.trim()) return;
  renderSuggestionList(await recentLocations(), "recent");
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
    limit: "8",
    dedupe: "1",
    "accept-language": await languageForQuery(cleanQuery)
  });

  try {
    const response = await fetch(url, { signal: suggestAbortController.signal });
    if (!response.ok) throw new Error(response.statusText);
    renderSuggestions(rankLocations(cleanQuery, await response.json()));
  } catch (error) {
    if (error.name !== "AbortError") hideSuggestions();
  }
}

function scheduleSuggestions() {
  clearTimeout(suggestTimer);
  const query = searchInput.value.trim();
  if (!query) {
    showRecentSuggestions();
    return;
  }
  suggestTimer = setTimeout(() => fetchSuggestions(query), 260);
}

function updateClearButton() {
  clearSearchButton.classList.toggle("visible", searchInput.value.trim().length > 0);
}

async function searchPlace(query) {
  const cleanQuery = query.trim();
  if (!cleanQuery) {
    currentLocation = null;
    stateCard("searchForPlace", "enterPlace");
    return;
  }

  showStatus("searching");
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.search = new URLSearchParams({
    q: buildSearchQuery(cleanQuery, settings),
    format: "jsonv2",
    addressdetails: "1",
    limit: "10",
    dedupe: "1",
    "accept-language": await languageForQuery(cleanQuery)
  });

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(response.statusText);
    const locations = rankLocations(cleanQuery, await response.json());
    hideStatus();
    if (!locations.length) {
      currentLocation = null;
      stateCard("noResultsFound", "checkPlaceNameOrAddress");
      return;
    }
    renderLocation(locations[0], locations);
  } catch {
    showStatus("unableToLoadMap");
    currentLocation = null;
    stateCard("unableToLoadMap", "checkPlaceNameOrAddress");
  }
}

async function loadPendingSearch() {
  const { pendingSearch } = await chrome.storage.session.get("pendingSearch");
  if (!pendingSearch?.query) {
    currentLocation = null;
    stateCard("searchForPlace", "enterPlace");
    return;
  }

  await chrome.storage.session.remove("pendingSearch");
  searchInput.value = pendingSearch.query;
  updateClearButton();
  await searchPlace(pendingSearch.query);
}

async function usePendingSearch(pendingSearch) {
  if (!pendingSearch?.query) return;
  searchInput.value = pendingSearch.query;
  updateClearButton();
  await searchPlace(pendingSearch.query);
}

async function refreshTheme(themePreference) {
  activeTheme = await applyTheme(themePreference);
  refreshTileLayer();
}

async function init() {
  settings = await getSettings();
  activeTheme = await applyTheme(settings.theme);
  messages = await loadMessages();
  await localizeDocument();
  initMap();
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

searchInput.addEventListener("focus", () => {
  if (!searchInput.value.trim()) {
    showRecentSuggestions();
  }
});

clearSearchButton.addEventListener("click", () => {
  searchInput.value = "";
  currentLocation = null;
  updateClearButton();
  hideSuggestions();
  searchInput.focus();
  stateCard("searchForPlace", "enterPlace");
});

searchInput.addEventListener("keydown", (event) => {
  if (suggestionsElement.classList.contains("hidden")) return;

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
    chooseSuggestion(location, suggestions);
  }
  if (event.key === "Escape") hideSuggestions();
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".search-combo")) hideSuggestions();
});

settingsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());
zoomInButton.addEventListener("click", () => map?.zoomIn(1));
zoomOutButton.addEventListener("click", () => map?.zoomOut(1));
recenterButton.addEventListener("click", () => {
  if (currentLocation) setMapView(currentLocation, currentZoom);
});
window.addEventListener("resize", () => map?.invalidateSize());

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "sync") return;
  settings = await getSettings();
  if (changes.theme) await refreshTheme(settings.theme);
  if (changes.language) {
    messages = await loadMessages(settings.language);
    await localizeDocument();
    if (tileLayer) tileLayer.options.attribution = messages.mapAttribution || "";
    if (currentLocation) renderLocation(currentLocation);
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
