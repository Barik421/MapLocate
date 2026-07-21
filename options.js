import { applyTheme, detectLanguage, getSettings, localizeDocument, loadMessages, watchSystemTheme } from "./shared.js";

const form = document.querySelector("#settingsForm");
const languageSelect = document.querySelector("#languageSelect");
const themeSelect = document.querySelector("#themeSelect");
const defaultCountry = document.querySelector("#defaultCountry");
const preferredRegion = document.querySelector("#preferredRegion");
const referenceCity = document.querySelector("#referenceCity");
const selectionButtonEnabled = document.querySelector("#selectionButtonEnabled");
const selectionActionMode = document.querySelector("#selectionActionMode");

async function hydrate() {
  const settings = await getSettings();
  await applyTheme(settings.theme);
  await localizeDocument();

  languageSelect.value = settings.language === "auto" ? detectLanguage() : settings.language;
  themeSelect.value = settings.theme;
  defaultCountry.value = settings.defaultCountry;
  preferredRegion.value = settings.preferredRegion;
  referenceCity.value = settings.referenceCity;
  selectionButtonEnabled.checked = settings.selectionButtonEnabled;
  selectionActionMode.value = settings.selectionActionMode;
}

async function saveForm() {
  await chrome.storage.sync.set({
    language: languageSelect.value,
    theme: themeSelect.value,
    defaultCountry: defaultCountry.value.trim(),
    preferredRegion: preferredRegion.value.trim(),
    referenceCity: referenceCity.value.trim(),
    selectionButtonEnabled: selectionButtonEnabled.checked,
    selectionActionMode: selectionActionMode.value
  });
}

languageSelect.addEventListener("change", async () => {
  await saveForm();
  await loadMessages(languageSelect.value);
  await localizeDocument();
});

themeSelect.addEventListener("change", async () => {
  await saveForm();
  await applyTheme(themeSelect.value);
});

form.addEventListener("input", () => {
  saveForm();
});

form.addEventListener("change", () => {
  saveForm();
});

watchSystemTheme(async () => {
  if (themeSelect.value === "system") {
    await applyTheme("system");
  }
});

hydrate();
