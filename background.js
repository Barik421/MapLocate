import { buildSearchQuery, getActiveLanguage, getSettings, loadMessages } from "./shared.js";

const MENU_ID = "maplocate-find";

async function refreshContextMenu() {
  const language = await getActiveLanguage();
  const messages = await loadMessages(language);
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: messages.findOnMap,
      contexts: ["selection"]
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  refreshContextMenu();
});

chrome.runtime.onStartup.addListener(refreshContextMenu);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.language) {
    refreshContextMenu();
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) {
    return;
  }

  await openMapLocate(info.selectionText || "", tab);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "MAPLOCATE_FIND_SELECTION") {
    return false;
  }

  if (message.actionMode !== "quickInfo") {
    openMapLocate(message.query || "", sender.tab)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  handleSelection(message.query || "", sender.tab)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

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
  const cityScore = knownCityScore(cleanQuery);

  if (!cityScore || primaryName !== cleanQuery) {
    return false;
  }

  if (cityName === cleanQuery) {
    return true;
  }

  return state.includes(cleanQuery) || municipality.includes(cleanQuery) || displayName.includes(`${cleanQuery} міська громада`);
}

function locationScore(location, query) {
  const cleanQuery = normalizeSearchText(query);
  const primaryName = normalizeSearchText(primaryLocationName(location));
  const displayName = normalizeSearchText(location.display_name);
  const locationType = normalizeSearchText(location.type);
  const locationClass = normalizeSearchText(location.class);
  const settlementTypes = new Set(["city", "town", "village", "hamlet", "municipality", "suburb", "neighbourhood"]);
  let score = isKnownMajorCityResult(location, query) ? knownCityScore(cleanQuery) : 0;

  if (primaryName === cleanQuery) score += 500;
  if (primaryName.startsWith(cleanQuery)) score += 160;
  if (displayName.startsWith(cleanQuery)) score += 90;
  if (settlementTypes.has(locationType)) score += locationType === "city" ? 420 : 160;
  if (locationClass === "place") score += 180;
  if (locationClass === "boundary" || locationType === "administrative") score -= 420;
  if (location.address?.city || location.address?.town) score += 260;
  if (location.address?.village || location.address?.hamlet) score -= 140;
  return score;
}

function rankLocations(query, locations) {
  return [...locations].sort((left, right) => {
    const scoreDiff = locationScore(right, query) - locationScore(left, query);
    return scoreDiff || Number(right.importance || 0) - Number(left.importance || 0);
  });
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

async function searchBestLocation(query, settings) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.search = new URLSearchParams({
    q: buildSearchQuery(query, settings),
    format: "jsonv2",
    addressdetails: "1",
    limit: "10",
    dedupe: "1",
    "accept-language": await getActiveLanguage()
  });
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(response.statusText);
  }
  return rankLocations(query, await response.json())[0] || null;
}

function locationInfo(location) {
  const address = location.address || {};
  const query = googleMapsQuery(location);
  return {
    title: location.display_name,
    place: primaryLocationName(location),
    region: address.state || address.region || address.province || "",
    district: address.county || address.district || address.municipality || "",
    mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`,
    googleUrl: `https://www.google.com/search?q=${encodeURIComponent(query)}`
  };
}

async function handleSelection(query, tab) {
  const settings = await getSettings();
  const location = await searchBestLocation(query, settings);
  if (!location) {
    throw new Error("Location not found");
  }
  await chrome.tabs.sendMessage(tab.id, {
    type: "MAPLOCATE_QUICK_INFO",
    info: locationInfo(location)
  });
}

async function openMapLocate(query, tab) {
  const pendingSearch = {
    query,
    createdAt: Date.now()
  };

  const openPanel = tab?.id
    ? chrome.sidePanel.open({ tabId: tab.id })
    : tab?.windowId
      ? chrome.sidePanel.open({ windowId: tab.windowId })
      : Promise.resolve();

  const storeSearch = chrome.storage.session.set({
    pendingSearch
  });

  await storeSearch;
  await chrome.runtime.sendMessage({
    type: "MAPLOCATE_PENDING_SEARCH",
    pendingSearch
  }).catch(() => {});

  await openPanel;
}
