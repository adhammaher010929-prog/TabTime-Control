"use strict";

const statusBadge      = document.getElementById("status-badge");
const activePanel      = document.getElementById("active-panel");
const setupPanel       = document.getElementById("setup-panel");
const tabsSection      = document.getElementById("tabs-section");
const noTabsSection    = document.getElementById("no-tabs-section");
const tabsList         = document.getElementById("tabs-list");
const tabsCount        = document.getElementById("tabs-count");
const btnSelectAll     = document.getElementById("btn-select-all");
const btnStart         = document.getElementById("btn-start");
const btnStop          = document.getElementById("btn-stop");
const durationValue    = document.getElementById("duration-value");
const durationUnit     = document.getElementById("duration-unit");
const maxTabsInput     = document.getElementById("max-tabs");
const errorMsg         = document.getElementById("error-msg");
const timerDisplay     = document.getElementById("timer-display");
const timerLabel       = document.getElementById("timer-label");
const activeMode       = document.getElementById("active-mode");
const activeRestriction = document.getElementById("active-restriction");

const modeRadios       = document.getElementsByName("focusMode");
const modeSelector     = document.getElementById("mode-selector");

let currentTabsData = [];

function extractDomain(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function formatTime(ms) {
  if (ms <= 0) return "00:00";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  }
  return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}

let timerInterval = null;
function startTimerDisplay(endTime, state) {
  clearInterval(timerInterval);
  const tick = () => {
    let targetTime = endTime;
    const remaining = targetTime - Date.now();
    timerDisplay.textContent = formatTime(remaining);
    if (remaining <= 0 && (!state || state.mode !== "sequential")) {
      clearInterval(timerInterval);
      init();
    }
  };
  tick();
  timerInterval = setInterval(() => {
    if (state && state.mode === "sequential") {
      chrome.storage.local.get("focusState", (res) => {
        if (res.focusState && res.focusState.active && res.focusState.mode === "sequential") {
          const remaining = res.focusState.currentEndTime - Date.now();
          timerDisplay.textContent = formatTime(remaining);
          activeRestriction.textContent = `Tab ${res.focusState.currentIndex + 1} of ${res.focusState.focusQueue.length}`;
          if (remaining <= 0 && res.focusState.currentIndex >= res.focusState.focusQueue.length - 1) {
            clearInterval(timerInterval);
            init();
          }
        } else {
          clearInterval(timerInterval);
          init();
        }
      });
    } else {
      tick();
    }
  }, 1000);
}

function renderActivePanel(state) {
  setupPanel.style.display  = "none";
  activePanel.style.display = "flex";
  statusBadge.className     = "status-badge active";
  statusBadge.textContent   = "ACTIVE";

  if (state.mode === "whitelist") {
    activeMode.textContent        = "WHITELIST";
    activeRestriction.textContent = `${state.allowedTabs.length} domain(s)`;
    timerLabel.textContent        = "remaining";
    startTimerDisplay(state.endTime, state);
  } else if (state.mode === "sequential") {
    activeMode.textContent        = "SEQUENTIAL";
    activeRestriction.textContent = `Tab ${state.currentIndex + 1} of ${state.focusQueue.length}`;
    timerLabel.textContent        = "current tab time";
    startTimerDisplay(state.currentEndTime, state);
  } else {
    activeMode.textContent        = "LIMIT";
    activeRestriction.textContent = `max ${state.maxTabs} tab(s)`;
    timerLabel.textContent        = "remaining";
    startTimerDisplay(state.endTime, state);
  }
}

modeRadios.forEach(r => r.addEventListener("change", (e) => {
  document.body.dataset.mode = e.target.value;
  if (e.target.value === "sequential") {
    document.getElementById("tabs-section-label").textContent = "Arrange tabs & set durations";
  } else {
    document.getElementById("tabs-section-label").textContent = "Select tabs to allow";
  }
}));

function renderSetupPanel(tabs) {
  activePanel.style.display = "none";
  setupPanel.style.display  = "flex";
  statusBadge.className     = "status-badge idle";
  statusBadge.textContent   = "IDLE";

  const usableTabs = tabs.filter(t =>
    t.url &&
    !t.url.startsWith("chrome://") &&
    !t.url.startsWith("chrome-extension://") &&
    !t.url.startsWith("edge://") &&
    !t.url.startsWith("about:")
  );

  if (usableTabs.length === 0) {
    tabsSection.style.display   = "none";
    noTabsSection.style.display = "flex";
    modeSelector.style.display  = "none";
  } else {
    tabsSection.style.display   = "flex";
    noTabsSection.style.display = "none";
    modeSelector.style.display  = "flex";
    currentTabsData = usableTabs.map(t => ({...t, _selected: true, _duration: "5"}));
    renderTabsList();
  }
}

function renderTabsList() {
  tabsList.innerHTML = "";
  
  let checkedCount = 0;
  
  currentTabsData.forEach((tab, index) => {
    if (tab._selected) checkedCount++;
    
    const domain = extractDomain(tab.url) || tab.url;
    const item   = document.createElement("div");
    item.className = "tab-item" + (tab._selected ? " selected" : "");
    item.dataset.domain = domain;
    item.dataset.index = index;

    const cb = document.createElement("input");
    cb.type      = "checkbox";
    cb.className = "tab-checkbox";
    cb.checked   = tab._selected;
    
    let faviconEl;
    if (tab.favIconUrl && !tab.favIconUrl.startsWith("chrome://") && !tab.favIconUrl.startsWith("edge://")) {
      faviconEl = document.createElement("img");
      faviconEl.className = "tab-favicon";
      faviconEl.src = tab.favIconUrl;
      faviconEl.onerror = () => faviconEl.replaceWith(makeFaviconPlaceholder());
    } else {
      faviconEl = makeFaviconPlaceholder();
    }

    const orderBadge = document.createElement("div");
    orderBadge.className = "tab-order-badge sequential-only";
    orderBadge.textContent = index + 1;

    const info = document.createElement("div");
    info.className = "tab-info";
    
    const title = document.createElement("div");
    title.className = "tab-title";
    title.textContent = tab.title || "Untitled Tab";

    const domainEl = document.createElement("div");
    domainEl.className = "tab-domain";
    domainEl.textContent = domain;

    info.appendChild(title);
    info.appendChild(domainEl);
    
    const durContainer = document.createElement("div");
    durContainer.className = "tab-duration-container sequential-only";
    const durInput = document.createElement("input");
    durInput.type = "number";
    durInput.className = "tab-duration-input";
    durInput.min = "1";
    durInput.value = tab._duration;
    durInput.oninput = (e) => { tab._duration = e.target.value; };
    const durLabel = document.createElement("span");
    durLabel.textContent = "min";
    durLabel.style.fontSize = "9px";
    durLabel.style.color = "var(--muted)";
    durContainer.appendChild(durInput);
    durContainer.appendChild(durLabel);

    const actions = document.createElement("div");
    actions.className = "tab-actions sequential-only";
    
    const btnUp = document.createElement("button");
    btnUp.className = "btn-move";
    btnUp.innerHTML = "▲";
    btnUp.onclick = (e) => {
      e.stopPropagation();
      if (index > 0) {
        [currentTabsData[index - 1], currentTabsData[index]] = [currentTabsData[index], currentTabsData[index - 1]];
        renderTabsList();
      }
    };
    
    const btnDown = document.createElement("button");
    btnDown.className = "btn-move";
    btnDown.innerHTML = "▼";
    btnDown.onclick = (e) => {
      e.stopPropagation();
      if (index < currentTabsData.length - 1) {
        [currentTabsData[index], currentTabsData[index + 1]] = [currentTabsData[index + 1], currentTabsData[index]];
        renderTabsList();
      }
    };
    
    actions.appendChild(btnUp);
    actions.appendChild(btnDown);

    item.appendChild(orderBadge);
    item.appendChild(cb);
    item.appendChild(faviconEl);
    item.appendChild(info);
    item.appendChild(durContainer);
    item.appendChild(actions);

    const toggleCheck = () => {
      tab._selected = !tab._selected;
      renderTabsList();
    };

    info.addEventListener("click", toggleCheck);
    cb.addEventListener("change", toggleCheck);

    tabsList.appendChild(item);
  });

  tabsCount.textContent = `${checkedCount} tab${checkedCount !== 1 ? "s" : ""}`;
  
  allSelected = checkedCount === currentTabsData.length && currentTabsData.length > 0;
  btnSelectAll.textContent = allSelected ? "Deselect All" : "Select All";
}

function makeFaviconPlaceholder() {
  const el = document.createElement("div");
  el.className = "tab-favicon-placeholder";
  return el;
}

let allSelected = true;
btnSelectAll.addEventListener("click", () => {
  const newState = !allSelected;
  currentTabsData.forEach(t => t._selected = newState);
  renderTabsList();
});

btnStart.addEventListener("click", async () => {
  errorMsg.textContent = "";

  const isLimitMode = noTabsSection.style.display !== "none";
  let state;

  if (isLimitMode) {
    const maxTabs = parseInt(maxTabsInput.value, 10);
    if (!maxTabs || maxTabs < 1) {
      errorMsg.textContent = "Enter a valid max tab count.";
      return;
    }
    
    const durVal  = parseInt(durationValue.value, 10);
    const durUnit = durationUnit.value;
    if (!durVal || durVal <= 0) { errorMsg.textContent = "Invalid duration."; return; }
    const durationMinutes = durUnit === "hours" ? durVal * 60 : durVal;

    state = {
      active:      true,
      mode:        "limit",
      maxTabs,
      endTime:     Date.now() + durationMinutes * 60 * 1000,
      startTime:   Date.now(),
    };
  } else {
    const mode = document.querySelector('input[name="focusMode"]:checked').value;
    const selectedTabs = currentTabsData.filter(t => t._selected);
    
    if (selectedTabs.length === 0) {
      errorMsg.textContent = "Select at least one tab.";
      return;
    }

    if (mode === "sequential") {
      const focusQueue = selectedTabs.map(t => {
        let d = parseInt(t._duration, 10);
        if (isNaN(d) || d < 1) d = 1;
        return {
          domain: extractDomain(t.url) || t.url,
          duration: d * 60 * 1000
        };
      });
      
      state = {
        active: true,
        mode: "sequential",
        focusQueue: focusQueue,
        currentIndex: 0,
        currentEndTime: Date.now() + focusQueue[0].duration,
        startTime: Date.now()
      };
    } else {
      const durVal  = parseInt(durationValue.value, 10);
      const durUnit = durationUnit.value;
      if (!durVal || durVal <= 0) { errorMsg.textContent = "Invalid duration."; return; }
      const durationMinutes = durUnit === "hours" ? durVal * 60 : durVal;

      const domains = [...new Set(selectedTabs.map(t => extractDomain(t.url) || t.url))];
      
      state = {
        active:      true,
        mode:        "whitelist",
        allowedTabs: domains,
        endTime:     Date.now() + durationMinutes * 60 * 1000,
        startTime:   Date.now(),
      };
    }
  }

  btnStart.disabled = true;
  await chrome.storage.local.set({ focusState: state });
  
  chrome.runtime.sendMessage({ action: "START_SESSION", focusState: state }, () => {
    renderActivePanel(state);
    btnStart.disabled = false;
  });
});

btnStop.addEventListener("click", async () => {
  clearInterval(timerInterval);
  await chrome.storage.local.set({ focusState: { active: false } });
  
  chrome.runtime.sendMessage({ action: "STOP_SESSION" }, () => {
    init();
  });
});

async function init() {
  const result = await chrome.storage.local.get("focusState");
  const state  = result.focusState;

  if (state && state.active && (state.mode === "sequential" ? state.currentIndex < state.focusQueue.length : state.endTime > Date.now())) {
    renderActivePanel(state);
  } else {
    if (state && state.active) {
      await chrome.storage.local.set({ focusState: { active: false } });
    }
    const tabs = await chrome.tabs.query({});
    renderSetupPanel(tabs);
  }
}

init();
