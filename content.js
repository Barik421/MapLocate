if (!globalThis["maplocate-content-script"]) {
  globalThis["maplocate-content-script"] = true;

const BUTTON_ID = "maplocate-selection-button";
const POPOVER_ID = "maplocate-info-popover";
const BACKDROP_ID = "maplocate-info-backdrop";
const MIN_SELECTION_LENGTH = 2;
const CONTENT_MESSAGES = {
  en: {
    close: "Close",
    findOnMap: "Find on map",
    openInGoogleMaps: "Open in Google Maps",
    openInGoogleSearch: "Open in Google",
    placeInfoUnavailable: "Place information is unavailable",
    region: "Region",
    district: "District"
  },
  uk: {
    close: "Закрити",
    findOnMap: "Знайти на карті",
    openInGoogleMaps: "Відкрити в Google Maps",
    openInGoogleSearch: "Відкрити в Google",
    placeInfoUnavailable: "Не вдалося знайти інформацію",
    region: "Область",
    district: "Район"
  }
};
const FALLBACK_MESSAGES = CONTENT_MESSAGES.en;

let selectionButton = null;
let hideTimer = null;
let extensionContextValid = true;
let selectionRequestActive = false;
let selectionAnchorRect = null;
let settings = {
  language: "en",
  selectionButtonEnabled: false,
  selectionActionMode: "quickInfo"
};
let localizedMessages = CONTENT_MESSAGES.en;
const pendingSettingsChanges = {};

function hasExtensionContext() {
  try {
    return extensionContextValid && Boolean(globalThis.chrome?.runtime?.id);
  } catch {
    extensionContextValid = false;
    return false;
  }
}

function getMessage(key) {
  if (localizedMessages[key]) {
    return localizedMessages[key];
  }
  try {
    if (hasExtensionContext()) {
      return globalThis.chrome.i18n.getMessage(key) || FALLBACK_MESSAGES[key] || key;
    }
  } catch {
    extensionContextValid = false;
  }
  return FALLBACK_MESSAGES[key] || key;
}

function detectLanguage(language = globalThis.chrome?.i18n?.getUILanguage?.() || navigator.language) {
  return String(language || "").toLowerCase().startsWith("uk") ? "uk" : "en";
}

function resolveLanguage(language) {
  return language === "uk" ? "uk" : "en";
}

function loadContentMessages(language = settings.language) {
  localizedMessages = CONTENT_MESSAGES[resolveLanguage(language)] || FALLBACK_MESSAGES;
  applyLocalizedText();
}

function applyLocalizedText(root = document) {
  root.querySelectorAll("[data-maplocate-i18n]").forEach((node) => {
    node.textContent = getMessage(node.dataset.maplocateI18n);
  });
  root.querySelectorAll("[data-maplocate-i18n-aria]").forEach((node) => {
    node.setAttribute("aria-label", getMessage(node.dataset.maplocateI18nAria));
  });
}

try {
  if (hasExtensionContext()) {
    globalThis.chrome.storage.sync.get(settings).then((stored) => {
      settings = { ...settings, ...stored, ...pendingSettingsChanges };
      if (!settings.selectionButtonEnabled) {
        removeButton();
        removePopover();
      }
      loadContentMessages(settings.language);
    }).catch(() => {
      extensionContextValid = false;
    });

    globalThis.chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") {
        return;
      }
      for (const key of Object.keys(settings)) {
        if (changes[key]) pendingSettingsChanges[key] = changes[key].newValue;
      }
      if (changes.selectionButtonEnabled) {
        settings.selectionButtonEnabled = changes.selectionButtonEnabled.newValue;
        if (!settings.selectionButtonEnabled) {
          removeButton();
          removePopover();
        }
      }
      if (changes.selectionActionMode) {
        settings.selectionActionMode = changes.selectionActionMode.newValue;
      }
      if (changes.language) {
        settings.language = changes.language.newValue;
        loadContentMessages(settings.language);
      }
    });
  }
} catch {
  extensionContextValid = false;
}

async function sendRuntimeMessage(message) {
  try {
    if (!hasExtensionContext()) {
      return null;
    }
    return await globalThis.chrome.runtime.sendMessage(message);
  } catch {
    extensionContextValid = false;
    clearSelectionUi();
    return null;
  }
}

function getSelectedText() {
  const selection = window.getSelection();
  return selection ? selection.toString().trim() : "";
}

function removeButton() {
  if (selectionButton) {
    selectionButton.remove();
    selectionButton = null;
  }
}

function removePopover() {
  document.getElementById(BACKDROP_ID)?.remove();
  document.getElementById(POPOVER_ID)?.remove();
}

function clearSelectionUi() {
  clearTimeout(hideTimer);
  removeButton();
  removePopover();
  window.getSelection()?.removeAllRanges();
}

function scheduleHide() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(removeButton, 4500);
}

function selectionRect() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }
  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    return null;
  }
  return rect;
}

function placeButton(rect) {
  const top = Math.max(8, rect.top - 44);
  const left = Math.min(
    rect.left,
    document.documentElement.clientWidth - 154
  );

  selectionButton.style.top = `${top}px`;
  selectionButton.style.left = `${Math.max(8, left)}px`;
}

function createButton() {
  const button = document.createElement("button");
  button.id = BUTTON_ID;
  button.type = "button";
  const icon = document.createElement("span");
  icon.className = "maplocate-selection-pin";
  const label = document.createElement("span");
  label.dataset.maplocateI18n = "findOnMap";
  label.textContent = getMessage("findOnMap");
  button.append(icon, label);
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", async () => {
    if (!hasExtensionContext() || !settings.selectionButtonEnabled || selectionRequestActive) {
      return;
    }
    const query = button.dataset.query || getSelectedText();
    const anchorRect = button.getBoundingClientRect();
    selectionAnchorRect = anchorRect;
    if (query.length < MIN_SELECTION_LENGTH) {
      removeButton();
      return;
    }
    selectionRequestActive = true;
    removeButton();
    window.getSelection()?.removeAllRanges();
    try {
      const response = await sendRuntimeMessage({
        type: "MAPLOCATE_FIND_SELECTION",
        query,
        actionMode: settings.selectionActionMode
      });
      if (hasExtensionContext() && !response?.ok && settings.selectionActionMode === "quickInfo") {
        showQuickInfo({
          title: getMessage("placeInfoUnavailable"),
          region: "",
          district: "",
          mapsUrl: "",
          googleUrl: ""
        }, anchorRect);
      }
    } finally {
      selectionRequestActive = false;
      selectionAnchorRect = null;
    }
  });
  button.addEventListener("mouseenter", () => clearTimeout(hideTimer));
  button.addEventListener("mouseleave", scheduleHide);
  return button;
}

function showButton() {
  if (!hasExtensionContext() || !settings.selectionButtonEnabled || selectionRequestActive) {
    removeButton();
    return;
  }
  if (document.getElementById(POPOVER_ID)) {
    removeButton();
    return;
  }

  const query = getSelectedText();
  const rect = selectionRect();
  if (query.length < MIN_SELECTION_LENGTH || !rect) {
    removeButton();
    return;
  }

  // Content scripts from different installed copies have separate globals,
  // but share the page DOM. Do not add another copy of the selection button.
  if (selectionButton && !selectionButton.isConnected) {
    selectionButton = null;
  }
  if (!selectionButton) {
    if (document.getElementById(BUTTON_ID)) {
      return;
    }
    selectionButton = createButton();
    document.documentElement.append(selectionButton);
  }

  selectionButton.dataset.query = query;
  placeButton(rect);
  scheduleHide();
}

function quickInfoRow(labelKey, value) {
  if (!value) {
    return null;
  }
  const row = document.createElement("div");
  row.className = "maplocate-info-row";
  const label = document.createElement("span");
  label.dataset.maplocateI18n = labelKey;
  label.textContent = getMessage(labelKey);
  const text = document.createElement("strong");
  text.textContent = value;
  row.append(label, text);
  return row;
}

function actionLink(labelKey, url) {
  if (!url) {
    return null;
  }
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.dataset.maplocateI18n = labelKey;
  link.textContent = getMessage(labelKey);
  return link;
}

function showQuickInfo(info, anchorRect = null) {
  if (!hasExtensionContext() || !settings.selectionButtonEnabled) {
    return;
  }
  removePopover();
  const backdrop = document.createElement("button");
  backdrop.id = BACKDROP_ID;
  backdrop.type = "button";
  backdrop.dataset.maplocateI18nAria = "close";
  backdrop.setAttribute("aria-label", getMessage("close"));
  backdrop.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    clearSelectionUi();
  });

  const popover = document.createElement("section");
  popover.id = POPOVER_ID;

  const closeButton = document.createElement("button");
  closeButton.className = "maplocate-info-close";
  closeButton.type = "button";
  closeButton.dataset.maplocateI18nAria = "close";
  closeButton.setAttribute("aria-label", getMessage("close"));
  closeButton.textContent = "×";
  closeButton.addEventListener("click", clearSelectionUi);

  const title = document.createElement("h2");
  title.textContent = info.place || info.title;

  const rows = [
    quickInfoRow("region", info.region),
    quickInfoRow("district", info.district)
  ].filter(Boolean);

  const actions = document.createElement("div");
  actions.className = "maplocate-info-actions";
  [
    actionLink("openInGoogleMaps", info.mapsUrl),
    actionLink("openInGoogleSearch", info.googleUrl)
  ].filter(Boolean).forEach((link) => actions.append(link));

  popover.append(closeButton, title, ...rows, actions);
  document.documentElement.append(backdrop, popover);

  const rect = anchorRect || selectionRect();
  const gap = 10;
  const margin = 8;
  const viewportHeight = document.documentElement.clientHeight;
  const viewportWidth = document.documentElement.clientWidth;
  const popoverRect = popover.getBoundingClientRect();
  const anchorTop = rect?.top ?? margin;
  const anchorBottom = rect?.bottom ?? margin;
  const belowTop = anchorBottom + gap;
  const aboveTop = anchorTop - popoverRect.height - gap;
  const top = belowTop + popoverRect.height <= viewportHeight - margin
    ? belowTop
    : Math.max(margin, aboveTop);
  const left = Math.min(
    rect?.left || 12,
    viewportWidth - popoverRect.width - margin
  );
  popover.style.top = `${top}px`;
  popover.style.left = `${Math.max(margin, left)}px`;
}

document.addEventListener("selectionchange", () => {
  clearTimeout(hideTimer);
  setTimeout(showButton, 80);
});

document.addEventListener("mouseup", () => {
  clearTimeout(hideTimer);
  setTimeout(showButton, 40);
});

document.addEventListener("touchend", () => {
  clearTimeout(hideTimer);
  setTimeout(showButton, 120);
}, { passive: true });

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    clearSelectionUi();
  }
});

window.addEventListener("scroll", clearSelectionUi, { passive: true });

window.addEventListener("resize", clearSelectionUi);

try {
  if (hasExtensionContext()) {
    globalThis.chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === "MAPLOCATE_QUICK_INFO") {
        showQuickInfo(message.info, selectionAnchorRect);
      }
    });
  }
} catch {
  extensionContextValid = false;
}

}
