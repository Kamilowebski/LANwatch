/* ============================================================
   core.js — stan globalny, referencje DOM, funkcje pomocnicze,
             toasty, historia sesji, escapeHtml, uniq,
             cache resolved IP (DHCP)
   Zero importów — to fundament całej aplikacji.
   ============================================================ */

/* ===== STAN GLOBALNY ===== */
export let devices = [];
export let devicesVersion = null;
export let config = {
  areas: ["EXPORT", "MALA PACZKA", "ROZBIOR"],
  types: ["terminal", "drukarka", "komputer", "bizerba", "inne"],
  groups: [],
  sshUser: "",
  vncLocalPort: 5900,
  vncRemotePort: 5900,
  vncViewerPath: "",
};
export let statuses = {};
export let currentPage = 1;
export let expandedDevices = new Set();
export let selectedDevices = new Set();
export let bulkModeEnabled = false;
export let currentPageNames = [];
export let hasUnsavedChanges = false;

/* ===== SETTERY ===== */
export function setDevices(value) { devices = value; }
export function setDevicesVersion(value) { devicesVersion = value; }
export function setConfig(value) { config = value; }
export function setStatuses(value) { statuses = value; }
export function setCurrentPage(value) { currentPage = value; }
export function setExpandedDevices(value) { expandedDevices = value; }
export function setSelectedDevices(value) { selectedDevices = value; }
export function setBulkModeEnabled(value) { bulkModeEnabled = value; }
export function setCurrentPageNames(value) { currentPageNames = value; }
export function setHasUnsavedChanges(value) { hasUnsavedChanges = value; }

/* ===== DOM — główne referencje ===== */
export const body = document.querySelector("#devicesBody");
export const searchInput = document.querySelector("#searchInput");
export const typeFilter = document.querySelector("#typeFilter");
export const areaFilter = document.querySelector("#areaFilter");
export const groupFilter = document.querySelector("#groupFilter");
export const sortSelect = document.querySelector("#sortSelect");
export const statusFilter = document.querySelector("#statusFilter");
export const addressModeFilter = document.querySelector("#addressModeFilter");
export const keywordFilter = document.querySelector("#keywordFilter");
export const clearFiltersButton = document.querySelector("#clearFiltersButton");
export const summary = document.querySelector("#summary");
export const pingAllButton = document.querySelector("#pingAllButton");
export const openDashboardButton = document.querySelector("#openDashboardButton");
export const saveChangesButton = document.querySelector("#saveChangesButton");
export const unsavedIndicator = document.querySelector("#unsavedIndicator");
export const forgetPasswordButton = document.querySelector("#forgetPasswordButton");
export const editorTitle = document.querySelector("#editorTitle");
export const deviceForm = document.querySelector("#deviceForm");
export const editName = document.querySelector("#editName");
export const deviceName = document.querySelector("#deviceName");
export const deviceIp = document.querySelector("#deviceIp");
export const deviceAddressMode = document.querySelector("#deviceAddressMode");
export const deviceType = document.querySelector("#deviceType");
export const deviceArea = document.querySelector("#deviceArea");
export const deviceGroup = document.querySelector("#deviceGroup");
export const deviceKeywords = document.querySelector("#deviceKeywords");
export const deviceNote = document.querySelector("#deviceNote");
export const numeratorField = document.querySelector("#numeratorField");
export const deviceNumerator = document.querySelector("#deviceNumerator");
export const deviceSystemId = document.querySelector("#deviceSystemId");
export const deviceVncUsername = document.querySelector("#deviceVncUsername");
export const deleteEditButton = document.querySelector("#deleteEditButton");
export const clearFormButton = document.querySelector("#clearFormButton");
export const editHint = document.querySelector("#editHint");
export const newTypeInput = document.querySelector("#newTypeInput");
export const addTypeButton = document.querySelector("#addTypeButton");
export const typeChips = document.querySelector("#typeChips");
export const newAreaInput = document.querySelector("#newAreaInput");
export const addAreaButton = document.querySelector("#addAreaButton");
export const areaChips = document.querySelector("#areaChips");
export const newGroupInput = document.querySelector("#newGroupInput");
export const addGroupButton = document.querySelector("#addGroupButton");
export const groupChips = document.querySelector("#groupChips");
export const pageSizeSelect = document.querySelector("#pageSizeSelect");
export const refreshButton = document.querySelector("#refreshButton");
export const autoPingToggle = document.querySelector("#autoPingToggle");
export const autoPingInterval = document.querySelector("#autoPingInterval");
export const prevPageButton = document.querySelector("#prevPageButton");
export const nextPageButton = document.querySelector("#nextPageButton");
export const pageInfo = document.querySelector("#pageInfo");
export const selectAllCheckbox = document.querySelector("#selectAllCheckbox");
export const bulkModeToggle = document.querySelector("#bulkModeToggle");
export const devicesTable = document.querySelector("#devicesTable");
export const bulkActionsBar = document.querySelector("#bulkActionsBar");
export const bulkCount = document.querySelector("#bulkCount");
export const selectAllFilteredButton = document.querySelector("#selectAllFilteredButton");
export const clearSelectionButton = document.querySelector("#clearSelectionButton");
export const bulkAreaSelect = document.querySelector("#bulkAreaSelect");
export const bulkAreaApply = document.querySelector("#bulkAreaApply");
export const bulkGroupSelect = document.querySelector("#bulkGroupSelect");
export const bulkGroupApply = document.querySelector("#bulkGroupApply");
export const bulkTypeSelect = document.querySelector("#bulkTypeSelect");
export const bulkTypeApply = document.querySelector("#bulkTypeApply");
export const bulkDeleteButton = document.querySelector("#bulkDeleteButton");
export const themeToggleButton = document.querySelector("#themeToggleButton");
export const toastContainer = document.querySelector("#toastContainer");
export const sessionHistoryList = document.querySelector("#sessionHistoryList");
export const clearHistoryButton = document.querySelector("#clearHistoryButton");
export const sshUserInput = document.querySelector("#sshUserInput");
export const vncLocalPortInput = document.querySelector("#vncLocalPortInput");
export const vncRemotePortInput = document.querySelector("#vncRemotePortInput");
export const vncViewerPathInput = document.querySelector("#vncViewerPathInput");
export const saveTunnelSettingsButton = document.querySelector("#saveTunnelSettingsButton");
export const scanRangeInput = document.querySelector("#scanRangeInput");
export const startScanButton = document.querySelector("#startScanButton");
export const scanStatus = document.querySelector("#scanStatus");
export const scanResults = document.querySelector("#scanResults");

export const quickHostInput = document.querySelector("#quickHostInput");
export const quickSshUserInput = document.querySelector("#quickSshUserInput");
export const quickVncButton = document.querySelector("#quickVncButton");
export const quickSshButton = document.querySelector("#quickSshButton");
export const quickHttpsLink = document.querySelector("#quickHttpsLink");
export const quickHttpLink = document.querySelector("#quickHttpLink");

export const watchdogToggle = document.querySelector("#watchdogToggle");
export const watchdogDeviceList = document.querySelector("#watchdogDeviceList");
export const watchdogNameInput = document.querySelector("#watchdogNameInput");
export const watchdogHostInput = document.querySelector("#watchdogHostInput");
export const watchdogIntervalInput = document.querySelector("#watchdogIntervalInput");
export const watchdogAddButton = document.querySelector("#watchdogAddButton");
export const watchdogClearHistoryButton = document.querySelector("#watchdogClearHistoryButton");
export const watchdogToggleAddFormButton = document.querySelector("#watchdogToggleAddFormButton");
export const watchdogAddBox = document.querySelector("#watchdogAddBox");
export const watchdogCancelAddButton = document.querySelector("#watchdogCancelAddButton");
export const watchdogSoundToggle = document.querySelector("#watchdogSoundToggle");
export const watchdogHistoryLengthInput = document.querySelector("#watchdogHistoryLengthInput");
export const watchdogSaveHistoryLengthButton = document.querySelector("#watchdogSaveHistoryLengthButton");
export const watchdogToggleSettingsButton = document.querySelector("#watchdogToggleSettingsButton");
export const watchdogSettingsBox = document.querySelector("#watchdogSettingsBox");
export const watchdogStatusBadge = document.querySelector("#watchdogStatusBadge");

export const watchdogReportModal = document.querySelector("#watchdogReportModal");
export const reportTitle = document.querySelector("#reportTitle");
export const reportSubtitle = document.querySelector("#reportSubtitle");
export const reportCloseButton = document.querySelector("#reportCloseButton");
export const reportRangeButtons = document.querySelector("#reportRangeButtons");
export const reportStats = document.querySelector("#reportStats");
export const reportCanvas = document.querySelector("#reportCanvas");
export const reportTableBody = document.querySelector("#reportTableBody");

export const tabsBar = document.querySelector("#tabsBar");
export const tabPanels = document.querySelectorAll(".tabPanel");

export const passwordModal = document.querySelector("#passwordModal");
export const passwordForm = document.querySelector("#passwordForm");
export const passwordModalInput = document.querySelector("#passwordModalInput");
export const passwordModalCancel = document.querySelector("#passwordModalCancel");

/* ===== NOWE REFERENCJE (widok kart, zależności, MAC, port scan) ===== */
export const devicesCards = document.querySelector("#devicesCards");
export const viewTableButton = document.querySelector("#viewTableButton");
export const viewCardsButton = document.querySelector("#viewCardsButton");

export const depsFilterInput = document.querySelector("#depsFilterInput");
export const depsList = document.querySelector("#depsList");
export const depsSelected = document.querySelector("#depsSelected");

export const deviceMac = document.querySelector("#deviceMac");

export const portScanHostInput = document.querySelector("#portScanHostInput");
export const startPortScanButton = document.querySelector("#startPortScanButton");
export const portScanStatus = document.querySelector("#portScanStatus");
export const portScanResults = document.querySelector("#portScanResults");

/* ===== STATYSTYKI ===== */
export const openStatsButton = document.querySelector("#openStatsButton");

export const statsModal = document.querySelector("#statsModal");
export const statsTitle = document.querySelector("#statsTitle");
export const statsSubtitle = document.querySelector("#statsSubtitle");
export const statsCloseButton = document.querySelector("#statsCloseButton");
export const statsDateInput = document.querySelector("#statsDateInput");
export const statsPrevDayButton = document.querySelector("#statsPrevDayButton");
export const statsNextDayButton = document.querySelector("#statsNextDayButton");
export const statsTodayButton = document.querySelector("#statsTodayButton");
export const statsStatus = document.querySelector("#statsStatus");
export const statsContent = document.querySelector("#statsContent");
export const statsEmpty = document.querySelector("#statsEmpty");
export const statsSummary = document.querySelector("#statsSummary");
export const statsUptimeCanvas = document.querySelector("#statsUptimeCanvas");
export const statsLatencyCanvas = document.querySelector("#statsLatencyCanvas");
export const statsTableBody = document.querySelector("#statsTableBody");

export const statsDeviceModal = document.querySelector("#statsDeviceModal");
export const statsDeviceTitle = document.querySelector("#statsDeviceTitle");
export const statsDeviceSubtitle = document.querySelector("#statsDeviceSubtitle");
export const statsDeviceCloseButton = document.querySelector("#statsDeviceCloseButton");
export const statsDeviceSummary = document.querySelector("#statsDeviceSummary");
export const statsDeviceCanvas = document.querySelector("#statsDeviceCanvas");
export const statsDeviceTableBody = document.querySelector("#statsDeviceTableBody");
export const statsDeviceHourFrom = document.querySelector("#statsDeviceHourFrom");
export const statsDeviceHourTo = document.querySelector("#statsDeviceHourTo");
export const statsDeviceHourApplyButton = document.querySelector("#statsDeviceHourApplyButton");
export const statsDeviceHourResetButton = document.querySelector("#statsDeviceHourResetButton");
export const statsDeviceHourInfo = document.querySelector("#statsDeviceHourInfo");
export const statsDeviceDateInput = document.querySelector("#statsDeviceDateInput");
export const statsDevicePrevDayButton = document.querySelector("#statsDevicePrevDayButton");
export const statsDeviceNextDayButton = document.querySelector("#statsDeviceNextDayButton");
export const statsDeviceTodayButton = document.querySelector("#statsDeviceTodayButton");

/* ===== KONFIGURACJA STATYSTYK ===== */
export const statsEnabledInput = document.querySelector("#statsEnabledInput");
export const statsIntervalInput = document.querySelector("#statsIntervalInput");
export const statsRetentionInput = document.querySelector("#statsRetentionInput");
export const statsConcurrencyInput = document.querySelector("#statsConcurrencyInput");
export const statsRunNowButton = document.querySelector("#statsRunNowButton");
export const statsRunNowStatus = document.querySelector("#statsRunNowStatus");

export const backupEnabledInput = document.querySelector("#backupEnabledInput");
export const backupHourInput = document.querySelector("#backupHourInput");
export const backupMinuteInput = document.querySelector("#backupMinuteInput");
export const backupRetentionInput = document.querySelector("#backupRetentionInput");
export const backupNowButton = document.querySelector("#backupNowButton");
export const backupNowStatus = document.querySelector("#backupNowStatus");

/* ===== NOWE (P3): pola sieciowe, powiadomienia, ulubione, traceroute ===== */
export const deviceNetmask = document.querySelector("#deviceNetmask");
export const deviceGateway = document.querySelector("#deviceGateway");
export const deviceDns = document.querySelector("#deviceDns");

export const watchdogNotifyToggle = document.querySelector("#watchdogNotifyToggle");

export const favoritesOnlyFilter = document.querySelector("#favoritesOnlyFilter");

export const tracerouteHostInput = document.querySelector("#tracerouteHostInput");
export const startTracerouteButton = document.querySelector("#startTracerouteButton");

export const tracerouteModal = document.querySelector("#tracerouteModal");
export const tracerouteTitle = document.querySelector("#tracerouteTitle");
export const tracerouteSubtitle = document.querySelector("#tracerouteSubtitle");
export const tracerouteCloseButton = document.querySelector("#tracerouteCloseButton");
export const tracerouteStatus = document.querySelector("#tracerouteStatus");
export const tracerouteResults = document.querySelector("#tracerouteResults");

/* ===== FUNKCJE POMOCNICZE ===== */
export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function uniq(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "pl"));
}

export function compareText(a, b) {
  return String(a).localeCompare(String(b), "pl", { numeric: true, sensitivity: "base" });
}

export function setSelectIfOptionExists(select, value) {
  if (!value) {
    select.value = "";
    return;
  }
  const exists = Array.from(select.options).some((opt) => opt.value === value);
  select.value = exists ? value : "";
}

export function pingTargetFor(device) {
  return device.addressMode === "dhcp" ? device.name : (device.ip || device.name);
}

/* ===== FLAGA NIEZAPISANYCH ZMIAN ===== */
export function markDirty() {
  hasUnsavedChanges = true;
  updateSaveButtonState();
}

export function clearDirty() {
  hasUnsavedChanges = false;
  updateSaveButtonState();
}

export function updateSaveButtonState() {
  if (!saveChangesButton) return;
  saveChangesButton.classList.toggle("dirty", hasUnsavedChanges);
  unsavedIndicator.classList.toggle("hidden", !hasUnsavedChanges);
}

/* ===== TOASTY + HISTORIA ===== */
const MAX_HISTORY_ENTRIES = 50;
let sessionHistory = [];

export function showToast(message, type = "info", duration = 4000) {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("toastOut");
    setTimeout(() => toast.remove(), 200);
  }, duration);

  addHistoryEntry(message, type);
}

export function loadSessionHistory() {
  try {
    sessionHistory = JSON.parse(sessionStorage.getItem("devicePanelHistory") || "[]");
  } catch (error) {
    sessionHistory = [];
  }
  renderSessionHistory();
}

export function addHistoryEntry(message, type = "info") {
  const time = new Date().toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const entry = { time, message, type };

  sessionHistory.unshift(entry);
  if (sessionHistory.length > MAX_HISTORY_ENTRIES) {
    sessionHistory.length = MAX_HISTORY_ENTRIES;
  }
  try {
    sessionStorage.setItem("devicePanelHistory", JSON.stringify(sessionHistory));
  } catch (error) {
    /* ignore */
  }
  renderSessionHistory();

  try {
    const persistent = JSON.parse(localStorage.getItem("devicePanelHistoryPersistent") || "[]");
    persistent.unshift({ ...entry, date: new Date().toISOString() });
    if (persistent.length > 500) {
      persistent.length = 500;
    }
    localStorage.setItem("devicePanelHistoryPersistent", JSON.stringify(persistent));
  } catch (error) {
    /* ignore */
  }
}

export function renderSessionHistory() {
  if (!sessionHistoryList) return;
  if (sessionHistory.length === 0) {
    sessionHistoryList.innerHTML = '<li class="historyItem empty">Brak działań w tej sesji.</li>';
    return;
  }
  sessionHistoryList.innerHTML = sessionHistory.map((entry) => `
    <li class="historyItem ${escapeHtml(entry.type || "info")}">
      <span class="historyTime">${escapeHtml(entry.time)}</span>
      <span class="historyMessage">${escapeHtml(entry.message)}</span>
    </li>
  `).join("");
}

export function clearSessionHistory() {
  sessionHistory = [];
  try {
    sessionStorage.removeItem("devicePanelHistory");
  } catch (error) {
    /* ignore */
  }
  renderSessionHistory();
}

/* ===== CACHE DHCP (resolved IP) ===== */
let resolvedIpCache = {};
try {
  resolvedIpCache = JSON.parse(localStorage.getItem("dhcpResolvedIps") || "{}");
} catch (error) {
  resolvedIpCache = {};
}

export function getResolvedIpCache() {
  return resolvedIpCache;
}

export function getAllResolvedIps() {
  return Object.values(resolvedIpCache);
}

export function getResolvedIp(name) {
  return resolvedIpCache[name];
}

export function rememberResolvedIp(name, resolvedIp) {
  if (!resolvedIp || resolvedIpCache[name] === resolvedIp) {
    return;
  }
  resolvedIpCache[name] = resolvedIp;
  try {
    localStorage.setItem("dhcpResolvedIps", JSON.stringify(resolvedIpCache));
  } catch (error) {
    /* ignore */
  }
}

/* ===== PERSYSTENCJA STATUSÓW PINGÓW (tabela główna) ===== */
const STATUS_STALE_MS = 10 * 60 * 1000;
let persistedStatuses = {};
try {
  const raw = localStorage.getItem("devicePanelStatuses");
  if (raw) {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      Object.keys(parsed).forEach((name) => {
        const entry = parsed[name];
        if (entry && typeof entry === "object" && !entry.checking && typeof entry.savedAt === "number") {
          persistedStatuses[name] = entry;
        }
      });
    }
  }
} catch (error) {
  persistedStatuses = {};
}

statuses = { ...persistedStatuses };

export function savePersistedStatuses() {
  try {
    const snapshot = {};
    Object.keys(statuses).forEach((name) => {
      const entry = statuses[name];
      if (entry && !entry.checking) {
        snapshot[name] = {
          online: entry.online === true,
          latencyMs: typeof entry.latencyMs === "number" ? entry.latencyMs : null,
          resolvedIp: entry.resolvedIp || null,
          savedAt: entry.savedAt || Date.now(),
        };
      }
    });
    localStorage.setItem("devicePanelStatuses", JSON.stringify(snapshot));
  } catch (error) {
    /* ignore */
  }
}

export function isStatusStale(status) {
  if (!status || !status.savedAt) return false;
  return Date.now() - status.savedAt > STATUS_STALE_MS;
}
