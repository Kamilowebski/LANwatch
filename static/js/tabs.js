/* ============================================================
   tabs.js — akordeon zakładek (jedna otwarta naraz)
   ============================================================ */

import {
  tabsBar,
  tabPanels,
} from "./core.js";

import {
  loadActiveTab,
  saveActiveTab,
} from "./persist.js";

let activeTab = null;

export function getActiveTab() {
  return activeTab;
}

export function setActiveTab(tabName, forceOpen = false) {
  // Jedna zakładka naraz. Kliknięcie aktywnej -> zamyka ją (wszystkie schowane).
  // forceOpen=true pomija toggle — używane przy wywołaniach programistycznych.
  if (activeTab === tabName && !forceOpen) {
    activeTab = null;
  } else {
    activeTab = tabName;
  }

  tabsBar.querySelectorAll(".tabButton").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === activeTab);
  });
  tabPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.panel === activeTab);
  });

  saveActiveTab(activeTab);

  if (activeTab === "watchdog") {
    // Dynamiczny import, żeby uniknąć cyklu (watchdog.js importuje core.js, ale nie tabs.js)
    import("./watchdog.js").then((mod) => {
      if (typeof mod.renderWatchdogDeviceList === "function") {
        mod.renderWatchdogDeviceList();
      }
    }).catch(() => {});
  }
}

export function initTabs() {
  tabsBar.querySelectorAll(".tabButton").forEach((button) => {
    button.addEventListener("click", () => setActiveTab(button.dataset.tab));
  });

  const savedTab = loadActiveTab();
  activeTab = null;
  setActiveTab(savedTab && savedTab !== "" ? savedTab : "add");
}
