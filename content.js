const BUTTON_ID = "maplocate-selection-button";
const POPOVER_ID = "maplocate-info-popover";
const MIN_SELECTION_LENGTH = 2;

let selectionButton = null;
let hideTimer = null;
let settings = {
  selectionButtonEnabled: true,
  selectionActionMode: "sidePanel"
};

chrome.storage.sync.get(settings).then((stored) => {
  settings = { ...settings, ...stored };
});

chrome.storage.onChanged.addListener((changes, area) => {
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
  const top = Math.max(8, window.scrollY + rect.top - 44);
  const left = Math.min(
    window.scrollX + rect.left,
    window.scrollX + document.documentElement.clientWidth - 154
  );

  selectionButton.style.top = `${top}px`;
  selectionButton.style.left = `${Math.max(window.scrollX + 8, left)}px`;
}

function createButton() {
  const button = document.createElement("button");
  button.id = BUTTON_ID;
  button.type = "button";
  button.innerHTML = `<span class="maplocate-selection-pin"></span><span>${chrome.i18n.getMessage("findOnMap")}</span>`;
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", async () => {
    const query = button.dataset.query || getSelectedText();
    if (query.length < MIN_SELECTION_LENGTH) {
      removeButton();
      return;
    }
    try {
      const response = await chrome.runtime.sendMessage({
        type: "MAPLOCATE_FIND_SELECTION",
        query,
        actionMode: settings.selectionActionMode
      });
      if (!response?.ok && settings.selectionActionMode === "quickInfo") {
        showQuickInfo({
          title: chrome.i18n.getMessage("placeInfoUnavailable"),
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
  if (!settings.selectionButtonEnabled) {
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
  label.textContent = chrome.i18n.getMessage(labelKey);
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
  link.textContent = chrome.i18n.getMessage(labelKey);
  return link;
}

function showQuickInfo(info, anchorRect = null) {
  removePopover();
  const popover = document.createElement("section");
  popover.id = POPOVER_ID;

  const closeButton = document.createElement("button");
  closeButton.className = "maplocate-info-close";
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", chrome.i18n.getMessage("close"));
  closeButton.textContent = "×";
  closeButton.addEventListener("click", removePopover);

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
  document.documentElement.append(popover);

  const rect = anchorRect || selectionRect();
  const top = Math.max(8, window.scrollY + (rect?.bottom || 24) + 10);
  const left = Math.min(
    window.scrollX + (rect?.left || 12),
    window.scrollX + document.documentElement.clientWidth - 326
  );
  popover.style.top = `${top}px`;
  popover.style.left = `${Math.max(window.scrollX + 8, left)}px`;
}

document.addEventListener("selectionchange", () => {
  clearTimeout(hideTimer);
  setTimeout(showButton, 80);
});

document.addEventListener("pointerdown", (event) => {
  if (event.target.closest(`#${BUTTON_ID}, #${POPOVER_ID}`)) {
    return;
  }

  if (document.getElementById(POPOVER_ID) || selectionButton || getSelectedText()) {
    clearSelectionUi();
  }
}, true);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    clearSelectionUi();
  }
});

window.addEventListener("scroll", () => {
  if (!selectionButton) {
    return;
  }
  const rect = selectionRect();
  if (rect) {
    placeButton(rect);
  }
}, { passive: true });

window.addEventListener("resize", removeButton);

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "MAPLOCATE_QUICK_INFO") {
    showQuickInfo(message.info);
  }
});
