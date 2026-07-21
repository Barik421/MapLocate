import { getActiveLanguage, loadMessages } from "./shared.js";

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

  openMapLocate(message.query || "", sender.tab)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

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
