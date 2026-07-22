const BUTTON_ID = "maplocate-selection-button";
const POPOVER_ID = "maplocate-info-popover";
const BACKDROP_ID = "maplocate-info-backdrop";
const MIN_SELECTION_LENGTH = 2;
const FALLBACK_MESSAGES = {
  close: "Close",
  findOnMap: "Find on map",
  openInGoogleMaps: "Open in Google Maps",
  openInGoogleSearch: "Open in Google",
  placeInfoUnavailable: "Place information is unavailable",
  region: "Region",
  district: "District"
};

let selectionButton = null;
let hideTimer = null;
let extensionContextValid = true;
let settings = {
  selectionButtonEnabled: true,
  selectionActionMode: "sidePanel"
};

function hasExtensionContext() {
  try {
    return extensionContextValid && Boolean(globalThis.chrome?.runtime?.id);
  } catch {
    extensionContextValid = false;
    return false;
  }
}

function getMessage(key) {
  try {
    if (hasExtensionContext()) {
      return globalThis.chrome.i18n.getMessage(key) || FALLBACK_MESSAGES[key] || key;
    }
  } catch {
    extensionContextValid = false;
  }
  return FALLBACK_MESSAGES[key] || key;
}

try {
  if (hasExtensionContext()) {
    globalThis.chrome.storage.sync.get(settings).then((stored) => {
      settings = { ...settings, ...stored };
    }).catch(() => {
      extensionContextValid = false;
    });

    globalThis.chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") {
        return;
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
  button.innerHTML = `<span class="maplocate-selection-pin"></span><span>${getMessage("findOnMap")}</span>`;
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", async () => {
    const query = button.dataset.query || getSelectedText();
    if (query.length < MIN_SELECTION_LENGTH) {
      removeButton();
      return;
    }
    try {
      const response = await sendRuntimeMessage({
        type: "MAPLOCATE_FIND_SELECTION",
        query,
        actionMode: settings.selectionActionMode
      });
      if (!response?.ok && settings.selectionActionMode === "quickInfo") {
        showQuickInfo({
          title: getMessage("placeInfoUnavailable"),
          region: "",
          district: "",
          mapsUrl: "",
          googleUrl: ""
        }, button.getBoundingClientRect());
      }
    } finally {
      removeButton();
    }
  });
  button.addEventListener("mouseenter", () => clearTimeout(hideTimer));
  button.addEventListener("mouseleave", scheduleHide);
  return button;
}

function showButton() {
  if (!settings.selectionButtonEnabled || !hasExtensionContext()) {
    removeButton();
    return;
  }

  const query = getSelectedText();
  const rect = selectionRect();
  if (query.length < MIN_SELECTION_LENGTH || !rect) {
    removeButton();
    return;
  }

  if (!selectionButton) {
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
  link.textContent = getMessage(labelKey);
  return link;
}

function showQuickInfo(info, anchorRect = null) {
  removePopover();
  const backdrop = document.createElement("button");
  backdrop.id = BACKDROP_ID;
  backdrop.type = "button";
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

function isMapLocateUiEvent(event) {
  const path = event.composedPath?.() || [];
  return path.some((node) => (
    node instanceof Element
    && (node.id === BUTTON_ID || node.id === POPOVER_ID || node.id === BACKDROP_ID)
  ));
}

function closeUiFromOutside(event) {
  if (isMapLocateUiEvent(event)) {
    return;
  }

  if (document.getElementById(POPOVER_ID) || selectionButton) {
    clearSelectionUi();
  }
}

document.addEventListener("selectionchange", () => {
  clearTimeout(hideTimer);
  setTimeout(showButton, 80);
});

document.addEventListener("pointerdown", closeUiFromOutside, true);
document.addEventListener("click", closeUiFromOutside, true);

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
        showQuickInfo(message.info);
      }
    });
  }
} catch {
  extensionContextValid = false;
}
