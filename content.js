const BUTTON_ID = "maplocate-selection-button";
const MIN_SELECTION_LENGTH = 2;

let selectionButton = null;
let hideTimer = null;

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
    await chrome.runtime.sendMessage({
      type: "MAPLOCATE_FIND_SELECTION",
      query
    });
    removeButton();
  });
  button.addEventListener("mouseenter", () => clearTimeout(hideTimer));
  button.addEventListener("mouseleave", scheduleHide);
  return button;
}

function showButton() {
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

document.addEventListener("selectionchange", () => {
  clearTimeout(hideTimer);
  setTimeout(showButton, 80);
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
