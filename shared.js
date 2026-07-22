const STORAGE_DEFAULTS = {
  language: "auto",
  theme: "system",
  defaultCountry: "",
  preferredRegion: "",
  referenceCity: "",
  selectionButtonEnabled: true,
  selectionActionMode: "sidePanel"
};

let cachedMessages = null;
let cachedLanguage = null;

export async function getSettings() {
  const stored = await chrome.storage.sync.get(STORAGE_DEFAULTS);
  return { ...STORAGE_DEFAULTS, ...stored };
}

export function detectLanguage(language = chrome.i18n?.getUILanguage?.() || navigator.language) {
  return String(language || "").toLowerCase().startsWith("uk") ? "uk" : "en";
}

export async function getActiveLanguage() {
  const { language } = await getSettings();
  return language === "uk" || language === "en" ? language : detectLanguage();
}

export async function loadMessages(language) {
  const activeLanguage = language || await getActiveLanguage();
  if (cachedMessages && cachedLanguage === activeLanguage) {
    return cachedMessages;
  }

  const response = await fetch(chrome.runtime.getURL(`_locales/${activeLanguage}/messages.json`));
  const rawMessages = await response.json();
  cachedLanguage = activeLanguage;
  cachedMessages = Object.fromEntries(
    Object.entries(rawMessages).map(([key, value]) => [key, value.message])
  );
  return cachedMessages;
}

export async function t(key) {
  const messages = await loadMessages();
  return messages[key] || key;
}

export async function localizeDocument(root = document) {
  const messages = await loadMessages();
  if (messages.extensionName) {
    document.title = messages.extensionName;
  }
  root.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = messages[node.dataset.i18n] || node.dataset.i18n;
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((node) => {
    node.placeholder = messages[node.dataset.i18nPlaceholder] || node.dataset.i18nPlaceholder;
  });
  root.querySelectorAll("[data-i18n-title]").forEach((node) => {
    node.title = messages[node.dataset.i18nTitle] || node.dataset.i18nTitle;
    node.setAttribute("aria-label", node.title);
  });
  document.documentElement.lang = cachedLanguage || await getActiveLanguage();
}

export function resolveTheme(theme) {
  if (theme === "dark" || theme === "light") {
    return theme;
  }
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export async function applyTheme(themeValue) {
  const theme = themeValue || (await getSettings()).theme;
  const resolvedTheme = resolveTheme(theme);
  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.dataset.themePreference = theme;
  return resolvedTheme;
}

export function watchSystemTheme(callback) {
  const media = matchMedia("(prefers-color-scheme: dark)");
  const listener = () => callback(resolveTheme("system"));
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

export function formatCoordinates(lat, lon) {
  return `${Number(lat).toFixed(6)}, ${Number(lon).toFixed(6)}`;
}

export function buildSearchQuery(query, settings) {
  return [query, settings.preferredRegion, settings.defaultCountry]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
}
