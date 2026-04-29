const BLOCKED_URL = chrome.runtime.getURL("blocked.html");
const TRANSPARENT_ICON = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

let cachedState = null;
let sequentialTimer = null;

async function getFocusState() {
  if (cachedState !== null) return cachedState;
  const result = await chrome.storage.local.get(['focusState']);
  cachedState = result.focusState || { active: false };
  return cachedState;
}

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.focusState) {
    cachedState = changes.focusState.newValue || { active: false };
    if (cachedState.active && cachedState.mode === "sequential") {
      startSequentialTimer();
    } else {
      stopSequentialTimer();
    }
  }
});

function stopSequentialTimer() {
  if (sequentialTimer) {
    clearInterval(sequentialTimer);
    sequentialTimer = null;
  }
}

function startSequentialTimer() {
  stopSequentialTimer();
  
  sequentialTimer = setInterval(async () => {
    const state = await getFocusState();
    if (!state.active || state.mode !== "sequential") {
      stopSequentialTimer();
      return;
    }
    
    if (Date.now() >= state.currentEndTime) {
      state.currentIndex++;
      if (state.currentIndex < state.focusQueue.length) {
        state.currentEndTime = Date.now() + state.focusQueue[state.currentIndex].duration;
        await chrome.storage.local.set({ focusState: state });
        switchToCurrentSequentialTab(state);
      } else {
        await endSession();
        chrome.notifications.create({
          type: "basic",
          iconUrl: TRANSPARENT_ICON, 
          title: "Sequential Focus Complete",
          message: "You have completed all your focus tabs!"
        });
      }
    }
  }, 1000);
}

async function switchToCurrentSequentialTab(state) {
  const currentTab = state.focusQueue[state.currentIndex];
  if (!currentTab) return;
  const domain = currentTab.domain;
  
  const tabs = await chrome.tabs.query({});
  let found = false;
  for (const tab of tabs) {
    if (tab.url && tab.url.includes(domain)) {
      chrome.tabs.update(tab.id, { active: true }).catch(() => {});
      chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
      found = true;
      break;
    }
  }
  if (!found) {
    chrome.tabs.create({ url: "https://" + domain }).catch(() => {});
  }
}

async function endSession() {
  const state = await getFocusState();
  state.active = false;
  await chrome.storage.local.set({ focusState: state });
  chrome.alarms.clear("focusAlarm");
  stopSequentialTimer();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "START_SESSION") {
    cachedState = message.focusState;
    if (cachedState.mode === "sequential") {
      startSequentialTimer();
      switchToCurrentSequentialTab(cachedState);
    } else {
      const timeLeftMs = message.focusState.endTime - Date.now();
      if (timeLeftMs > 0) {
        chrome.alarms.create("focusAlarm", { delayInMinutes: timeLeftMs / 60000 });
      }
    }
    sendResponse({ success: true });
  } else if (message.action === "STOP_SESSION") {
    endSession().then(() => sendResponse({ success: true }));
    return true; 
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "focusAlarm") {
    await endSession();
    chrome.notifications.create({
      type: "basic",
      iconUrl: TRANSPARENT_ICON, 
      title: "Focus Session Complete",
      message: "Great job! Your focus session has ended."
    });
  }
});

chrome.tabs.onCreated.addListener(async (tab) => {
  const state = await getFocusState();
  if (!state.active) return;
  
  if (state.mode === "limit") {
    chrome.tabs.query({}, (tabs) => {
      if (tabs.length > state.maxTabs) {
        chrome.tabs.remove(tab.id).catch(() => {});
      }
    });
  } else if (state.mode === "whitelist") {
    const urlToCheck = tab.pendingUrl || tab.url;
    handleWhitelistMode(tab.id, urlToCheck, state);
  } else if (state.mode === "sequential") {
    const urlToCheck = tab.pendingUrl || tab.url;
    handleSequentialMode(tab.id, urlToCheck, state);
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const state = await getFocusState();
  if (!state.active) return;
  
  if (state.mode === "whitelist") {
    if (changeInfo.url || changeInfo.status === 'loading') {
      const urlToCheck = changeInfo.url || tab.pendingUrl || tab.url;
      handleWhitelistMode(tabId, urlToCheck, state);
    }
  } else if (state.mode === "sequential") {
    if (changeInfo.url || changeInfo.status === 'loading') {
      const urlToCheck = changeInfo.url || tab.pendingUrl || tab.url;
      handleSequentialMode(tabId, urlToCheck, state);
    }
  }
});

function isExtensionOrBrowserUrl(url) {
  return url.startsWith("chrome://") ||
         url.startsWith("chrome-extension://") ||
         url.startsWith("edge://") ||
         url.startsWith("about:") ||
         url.includes(chrome.runtime.id);
}

function handleWhitelistMode(tabId, url, state) {
  if (!url || isExtensionOrBrowserUrl(url)) return;

  try {
    const urlObj = new URL(url);
    let domain = urlObj.hostname;
    if (domain.startsWith("www.")) domain = domain.substring(4);

    const isAllowed = state.allowedTabs.some(allowed => {
      let allowedDomain = allowed;
      if (allowedDomain.startsWith("www.")) allowedDomain = allowedDomain.substring(4);
      return domain === allowedDomain || domain.endsWith("." + allowedDomain);
    });

    if (!isAllowed) {
      chrome.tabs.update(tabId, { url: BLOCKED_URL }).catch(() => {});
    }
  } catch (e) {}
}

function handleSequentialMode(tabId, url, state) {
  if (!url || isExtensionOrBrowserUrl(url)) return;

  try {
    const urlObj = new URL(url);
    let domain = urlObj.hostname;
    if (domain.startsWith("www.")) domain = domain.substring(4);

    const currentAllowed = state.focusQueue[state.currentIndex];
    if (!currentAllowed) return;
    
    let allowedDomain = currentAllowed.domain;
    if (allowedDomain.startsWith("www.")) allowedDomain = allowedDomain.substring(4);
    
    const isAllowed = (domain === allowedDomain || domain.endsWith("." + allowedDomain));

    if (!isAllowed) {
      chrome.tabs.update(tabId, { url: BLOCKED_URL }).catch(() => {});
    }
  } catch (e) {}
}

// Start on load if sequential
getFocusState().then(state => {
  if (state.active && state.mode === "sequential") {
    startSequentialTimer();
  }
});
