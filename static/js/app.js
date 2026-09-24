/* ============================================================
   app.js — punkt wejścia. Importuje wszystkie moduły,
             spina handlery i odpala start.
   ============================================================ */

import {
  searchInput, typeFilter, areaFilter, groupFilter, sortSelect,
  statusFilter, addressModeFilter, keywordFilter,
  clearFiltersButton, pageSizeSelect,
  prevPageButton, nextPageButton,
  deviceForm, deleteEditButton, clearFormButton,
  pingAllButton, saveChangesButton, refreshButton,
  forgetPasswordButton,
  deviceType,
  autoPingToggle, autoPingInterval,
  deviceAddressMode,
  editHint,
  loadSessionHistory,
  showToast,
} from "./core.js";

import {
  initPasswordModalHandlers,
  getAdminPassword,
  clearStoredPassword,
} from "./api.js";

import {
  initThemeToggle, loadTheme,
  loadBulkModePreference, saveBulkModePreference,
  loadAutoPingPreference, saveAutoPingPreference,
  loadQuickSshUser, initQuickSshUserPersistence,
} from "./persist.js";

import { initTabs, setActiveTab } from "./tabs.js";

import {
  loadDevices,
  render,
  resetPageAndRender,
  submitForm,
  editDevice,
  deleteEditedDevice,
  clearForm,
  toggleNumeratorField,
  pingAll,
  saveDevices,
  clearFilters,
  removeDictionaryValue,
  jumpToDevice,
  initViewToggle,
  initDepsPickerHandlers,
  initFavorites,
  toggleFavorite,
  sendWol,
} from "./devices.js";

import { pingTarget } from "./ping.js";

import { initConnections } from "./connections.js";
import { initScanner, prefillFromScan } from "./scanner.js";
import { initPortScan } from "./portscan.js";
import { initTracerouteHandlers, openTraceroute } from "./traceroute.js";
import {
  initWatchdogHandlers,
  renderWatchdogDeviceList,
  restartAllWatchdogs,
  addWatchdogFromDevice,
} from "./watchdog.js";
import { initReportHandlers } from "./report.js";
import { initBulkHandlers } from "./bulk.js";
import { initConfigHandlers } from "./config.js";
import { unlockAudioOnFirstClick } from "./sound.js";
import { initStatsHandlers } from "./stats.js";


/* ===== GLOBALNY HANDLER KLIKNIĘĆ ===== */
document.addEventListener("click", (event) => {
  // Gwiazdka ulubionych — priorytet nad klikiem w wiersz/kartę
  const favName = event.target.dataset.fav;
  if (favName) {
    event.stopPropagation();
    toggleFavorite(favName);
    return;
  }

  // Karta w widoku kart
  const cardEl = event.target.closest(".deviceCard");
  if (cardEl && !event.target.closest(".cardActions") && !event.target.closest(".cardCheckbox") && !event.target.closest(".cardFavButton") && !event.target.closest(".copyable") && !event.target.closest(".depChip")) {
    const name = cardEl.dataset.cardToggle;
    import("./core.js").then((core) => {
      if (core.expandedDevices.has(name)) core.expandedDevices.delete(name);
      else core.expandedDevices.add(name);
      render();
    });
    return;
  }

  // Wiersz tabeli
  const toggleRow = event.target.closest(".deviceRow");
  if (toggleRow && !event.target.closest(".rowActions") && !event.target.closest(".selectCell") && !event.target.closest(".favCell") && !event.target.closest(".copyable")) {
    const name = toggleRow.dataset.toggle;
    import("./core.js").then((core) => {
      if (core.expandedDevices.has(name)) core.expandedDevices.delete(name);
      else core.expandedDevices.add(name);
      render();
    });
    return;
  }

  const pingTargetValue = event.target.dataset.pingTarget;
  const pingNameValue = event.target.dataset.pingName;
  const editNameValue = event.target.dataset.edit;
  const sshValue = event.target.dataset.ssh;
  const vncValue = event.target.dataset.vnc;
  const watchdogValue = event.target.dataset.watchdog;
  const wolValue = event.target.dataset.wol;
  const tracerouteValue = event.target.dataset.traceroute;
  const tracerouteHostValue = event.target.dataset.tracerouteHost;
  const statsDeviceValue = event.target.dataset.statsDevice;
  const scanAddValue = event.target.dataset.scanAdd;
  const jumpToValue = event.target.dataset.jumpTo;
  const removeTypeValue = event.target.dataset.removeType;
  const removeAreaValue = event.target.dataset.removeArea;
  const removeGroupValue = event.target.dataset.removeGroup;

  if (pingTargetValue && pingNameValue) pingTarget(pingTargetValue, pingNameValue);
  if (editNameValue) editDevice(editNameValue);
  if (sshValue) startDeviceSsh(sshValue);
  if (vncValue) startDeviceVnc(vncValue);
  if (watchdogValue) addWatchdogFromDevice(watchdogValue);
  if (wolValue) sendWol(wolValue);
  if (tracerouteValue && tracerouteHostValue) openTraceroute(tracerouteHostValue, tracerouteValue);
   if (statsDeviceValue) {
    import("./stats.js").then((mod) => {
      if (typeof mod.openStatsForDevice === "function") {
        mod.openStatsForDevice(statsDeviceValue);
      }
    });
  }
  if (scanAddValue) prefillFromScan(scanAddValue);
  if (jumpToValue) jumpToDevice(jumpToValue);
  if (removeTypeValue) removeDictionaryValue("type", removeTypeValue);
  if (removeAreaValue) removeDictionaryValue("area", removeAreaValue);
  if (removeGroupValue) removeDictionaryValue("group", removeGroupValue);
});

/* ===== SSH/VNC z rozwiniętego urządzenia ===== */
async function startDeviceSsh(name) {
  const password = await getAdminPassword();
  if (!password) return;

  const response = await fetch("/api/ssh-tunnel", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Admin-Password": password },
    body: JSON.stringify({ name }),
  });
  const result = await response.json();

  if (!response.ok) {
    if (response.status === 403) clearStoredPassword();
    showToast(result.error || "Nie udało się uruchomić tunelu SSH.", "error", 6000);
    return;
  }
  showToast(result.message || "Uruchomiono SSH.", "success");
}

async function startDeviceVnc(name) {
  const password = await getAdminPassword();
  if (!password) return;

  const response = await fetch("/api/vnc-direct", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Admin-Password": password },
    body: JSON.stringify({ name }),
  });
  const result = await response.json();

  if (!response.ok) {
    if (response.status === 403) clearStoredPassword();
    showToast(result.error || "Nie udało się otworzyć VNC.", "error", 6000);
    return;
  }
  showToast(result.message || "Uruchomiono VNC.", "success");
}

/* ===== FILTRY / SORT / PAGINACJA ===== */
searchInput.addEventListener("input", resetPageAndRender);
typeFilter.addEventListener("change", resetPageAndRender);
sortSelect.addEventListener("change", resetPageAndRender);
statusFilter.addEventListener("change", resetPageAndRender);
addressModeFilter.addEventListener("change", resetPageAndRender);
keywordFilter.addEventListener("input", resetPageAndRender);
clearFiltersButton.addEventListener("click", clearFilters);
areaFilter.addEventListener("change", () => resetPageAndRender());
groupFilter.addEventListener("change", () => resetPageAndRender());
pageSizeSelect.addEventListener("change", resetPageAndRender);
prevPageButton.addEventListener("click", async () => {
  const core = await import("./core.js");
  core.setCurrentPage(core.currentPage - 1);
  render();
});
nextPageButton.addEventListener("click", async () => {
  const core = await import("./core.js");
  core.setCurrentPage(core.currentPage + 1);
  render();
});

/* ===== FORMULARZ ===== */
deviceForm.addEventListener("submit", submitForm);
deleteEditButton.addEventListener("click", deleteEditedDevice);
clearFormButton.addEventListener("click", clearForm);
deviceType.addEventListener("change", () => {
  if (deviceType.value === "bizerba") deviceAddressMode.value = "static";
  toggleNumeratorField();
});
forgetPasswordButton.addEventListener("click", () => {
  clearStoredPassword();
  editHint.textContent = "Hasło wyczyszczone — przy następnym zapisie zostanie zapytane ponownie.";
});

/* ===== PING / ZAPIS / ODŚWIEŻ ===== */
pingAllButton.addEventListener("click", pingAll);
saveChangesButton.addEventListener("click", saveDevices);
if (openDashboardButton) {
  openDashboardButton.addEventListener("click", () => {
    window.open("/dashboard.html", "_blank", "noopener");
  });
}

refreshButton.addEventListener("click", async () => {
  const core = await import("./core.js");
  if (core.hasUnsavedChanges) {
    if (!confirm("Masz niezapisane zmiany. Odświeżenie wczyta dane z pliku i je porzuci. Kontynuować?")) {
      return;
    }
  }
  await loadDevices();
  const core2 = await import("./core.js");
  core2.clearDirty();
  renderWatchdogDeviceList();
  restartAllWatchdogs();
});

/* ===== AUTO-PING ===== */
let autoPingTimer = null;
let autoPingRunning = false;

async function runAutoPing() {
  if (autoPingRunning) return;
  const mod = await import("./devices.js");
  const filtered = mod.getFilteredDevices();
  if (filtered.length === 0) return;
  autoPingRunning = true;
  try {
    const pingMod = await import("./ping.js");
    await pingMod.pingDevicesConcurrently(filtered, 5);
  } finally {
    autoPingRunning = false;
  }
}

function restartAutoPingTimer() {
  if (autoPingTimer) {
    clearInterval(autoPingTimer);
    autoPingTimer = null;
  }
  if (autoPingToggle.checked) {
    const intervalMs = Number(autoPingInterval.value) || 300000;
    autoPingTimer = setInterval(runAutoPing, intervalMs);
  }
}

autoPingToggle.addEventListener("change", () => {
  saveAutoPingPreference();
  restartAutoPingTimer();
});
autoPingInterval.addEventListener("change", () => {
  saveAutoPingPreference();
  restartAutoPingTimer();
});

/* ===== OSTRZEŻENIE PRZED WYJŚCIEM ===== */
window.__panelHasUnsavedChanges = false;
setInterval(() => {
  import("./core.js").then((core) => {
    window.__panelHasUnsavedChanges = core.hasUnsavedChanges;
  });
}, 200);

window.addEventListener("beforeunload", (event) => {
  if (window.__panelHasUnsavedChanges) {
    event.preventDefault();
    event.returnValue = "";
  }
});

/* ===== START ===== */
async function start() {
  loadTheme();
  initThemeToggle();
  unlockAudioOnFirstClick();

  initPasswordModalHandlers();
  initTabs();

  initConnections();
  initScanner();
  initPortScan();
  initTracerouteHandlers();
  initWatchdogHandlers();
  initReportHandlers();
  initBulkHandlers();
  initConfigHandlers();

  loadSessionHistory();
  loadBulkModePreference();
  loadAutoPingPreference();
  loadQuickSshUser();
  initQuickSshUserPersistence();
  initStatsHandlers();

  restartAutoPingTimer();

  const core = await import("./core.js");
  core.updateSaveButtonState();

  await loadDevices();

  // Widok + zależności + ulubione (po załadowaniu listy urządzeń)
  initViewToggle();
  initDepsPickerHandlers();
  initFavorites();

  renderWatchdogDeviceList();
  restartAllWatchdogs();
}

start().catch((error) => {
  console.error("[panel] Błąd startu:", error);
});

/* ===== SERVICE WORKER ===== */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* brak service workera nie przeszkadza w normalnym dzialaniu panelu */
    });
  });
}
