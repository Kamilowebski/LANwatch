/* ============================================================
   dashboard.js — samodzielna logika dashboardu (kiosk view).
   Nie zależy od app.js ani core.js — żeby można było otworzyć
   dashboard bez ładowania całego panelu.
   ============================================================ */

const DASH_SETTINGS_KEY = "devicePanelDashboard";
const DASH_STATUSES_KEY = "devicePanelStatuses";
const STATUS_STALE_MS = 10 * 60 * 1000;

/* ===== STAN ===== */
let devices = [];
let config = { types: [] };
let statuses = {};
let settings = loadSettings();
let pingTimer = null;
let clockTimer = null;
let countdownTimer = null;
let nextRefreshAt = 0;
let isPinging = false;

/* ===== DOM ===== */
const dashClock = document.querySelector("#dashClock");
const dashDate = document.querySelector("#dashDate");
const dashCounters = document.querySelector("#dashCounters");
const dashRefreshInfo = document.querySelector("#dashRefreshInfo");
const dashFullscreenButton = document.querySelector("#dashFullscreenButton");
const dashSettingsButton = document.querySelector("#dashSettingsButton");
const dashGrid = document.querySelector("#dashGrid");
const dashProblems = document.querySelector("#dashProblems");
const dashProblemsList = document.querySelector("#dashProblemsList");
const dashProblemsClose = document.querySelector("#dashProblemsClose");
const dashSettings = document.querySelector("#dashSettings");
const dashSettingsClose = document.querySelector("#dashSettingsClose");
const dashTypesList = document.querySelector("#dashTypesList");
const dashRefreshInterval = document.querySelector("#dashRefreshInterval");
const dashShowProblems = document.querySelector("#dashShowProblems");
const dashShowLatency = document.querySelector("#dashShowLatency");
const dashCompactMode = document.querySelector("#dashCompactMode");
const dashDarkMode = document.querySelector("#dashDarkMode");
const dashRefreshNowButton = document.querySelector("#dashRefreshNowButton");
const dashSettingsResetButton = document.querySelector("#dashSettingsResetButton");
const dashToastContainer = document.querySelector("#dashToastContainer");

/* ===== USTAWIENIA ===== */
function loadSettings() {
  let parsed = null;
  try {
    const raw = localStorage.getItem(DASH_SETTINGS_KEY);
    if (raw) parsed = JSON.parse(raw);
  } catch (error) {
    parsed = null;
  }
  if (!parsed || typeof parsed !== "object") parsed = {};

  return {
    types: Array.isArray(parsed.types) ? parsed.types.map(String) : [],
    refreshInterval: typeof parsed.refreshInterval === "number" ? parsed.refreshInterval : 30000,
    showProblems: parsed.showProblems !== false,
    showLatency: parsed.showLatency !== false,
    compactMode: parsed.compactMode === true,
    darkMode: parsed.darkMode !== false,
  };
}

function saveSettings() {
  try {
    localStorage.setItem(DASH_SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    /* ignore */
  }
}

function applySettingsToUI() {
  dashRefreshInterval.value = String(settings.refreshInterval);
  dashShowProblems.checked = settings.showProblems;
  dashShowLatency.checked = settings.showLatency;
  dashCompactMode.checked = settings.compactMode;
  dashDarkMode.checked = settings.darkMode;

  document.documentElement.classList.toggle("theme-dark", settings.darkMode);
  dashGrid.classList.toggle("compact", settings.compactMode);
}

/* ===== UTIL ===== */
function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function compareText(a, b) {
  return String(a).localeCompare(String(b), "pl", { numeric: true, sensitivity: "base" });
}

function pingTargetFor(device) {
  return device.addressMode === "dhcp" ? device.name : (device.ip || device.name);
}

function isStatusStale(status) {
  if (!status || !status.savedAt) return false;
  return Date.now() - status.savedAt > STATUS_STALE_MS;
}

function showToast(message, type = "info", duration = 3000) {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  dashToastContainer.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("toastOut");
    setTimeout(() => toast.remove(), 200);
  }, duration);
}

/* ===== ZEGAR ===== */
function updateClock() {
  const now = new Date();
  dashClock.textContent = now.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  dashDate.textContent = now.toLocaleDateString("pl-PL", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
}

/* ===== ŁADOWANIE DANYCH ===== */
async function loadDevices() {
  try {
    const response = await fetch("/api/devices");
    const data = await response.json();
    devices = Array.isArray(data) ? data : [];
  } catch (error) {
    console.warn("[dashboard] Nie udało się załadować urządzeń:", error);
    devices = [];
  }
}

async function loadConfig() {
  try {
    const response = await fetch("/api/config");
    config = await response.json();
  } catch (error) {
    config = { types: [] };
  }
}

function loadPersistedStatuses() {
  try {
    const raw = localStorage.getItem(DASH_STATUSES_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      statuses = { ...statuses, ...parsed };
    }
  } catch (error) {
    /* ignore */
  }
}

function savePersistedStatuses() {
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
    localStorage.setItem(DASH_STATUSES_KEY, JSON.stringify(snapshot));
  } catch (error) {
    /* ignore */
  }
}

/* ===== FILTROWANIE ===== */
function getVisibleDevices() {
  if (settings.types.length === 0) return devices;
  return devices.filter((d) => settings.types.includes(d.type));
}

/* ===== PINGI ===== */
async function pingOne(device) {
  const target = pingTargetFor(device);
  statuses[device.name] = { ...statuses[device.name], checking: false };

  try {
    const response = await fetch(`/api/ping?count=1&target=${encodeURIComponent(target)}`);
    const result = await response.json();
    statuses[device.name] = { ...result, savedAt: Date.now() };
  } catch (error) {
    statuses[device.name] = { online: false, error: error.message, savedAt: Date.now() };
  }
}

async function pingAllVisible() {
  if (isPinging) return;
  isPinging = true;

  const visible = getVisibleDevices();
  render();

  const concurrency = 6;
  let index = 0;

  async function worker() {
    while (index < visible.length) {
      const current = visible[index++];
      await pingOne(current);
      render();
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, visible.length) }, () => worker()));

  savePersistedStatuses();
  isPinging = false;
  render();
}

/* ===== PROBLEMY ===== */
function getProblems() {
  const visible = getVisibleDevices();
  const problems = [];

  visible.forEach((device) => {
    const status = statuses[device.name];
    if (status && status.online === false) {
      problems.push({
        type: "offline",
        device: device.name,
        message: status.error ? "brak odpowiedzi" : "offline",
      });
    }
    const deps = device.dependencies || [];
    deps.forEach((depName) => {
      const depStatus = statuses[depName];
      if (depStatus && depStatus.online === false) {
        problems.push({
          type: "dep",
          device: device.name,
          message: `zależność offline: ${depName}`,
        });
      }
    });
  });

  return problems;
}

/* ===== RENDER ===== */
function render() {
  renderCounters();
  renderGrid();
  renderProblems();
}

function renderCounters() {
  const visible = getVisibleDevices();
  const online = visible.filter((d) => statuses[d.name]?.online === true).length;
  const offline = visible.filter((d) => statuses[d.name]?.online === false).length;
  const unknown = visible.length - online - offline;
  const problems = getProblems().length;

  const offlineClass = offline > 0 ? " hasItems" : "";
  const problemsClass = problems > 0 ? " hasItems" : "";

  dashCounters.innerHTML = `
    <span class="dash-counter online"><span class="dash-counter-dot"></span>${online} online</span>
    <span class="dash-counter offline${offlineClass}"><span class="dash-counter-dot"></span>${offline} offline</span>
    ${unknown > 0 ? `<span class="dash-counter unknown"><span class="dash-counter-dot"></span>${unknown} brak</span>` : ""}
    ${problems > 0 ? `<span class="dash-counter problems${problemsClass}"><span class="dash-counter-dot"></span>${problems} problemów</span>` : ""}
  `;
}

function renderGrid() {
  const visible = getVisibleDevices();

  if (visible.length === 0) {
    dashGrid.innerHTML = '<div class="dash-empty">Brak urządzeń do wyświetlenia.<br>Sprawdź ustawienia typów w panelu ⚙</div>';
    return;
  }

  const sorted = [...visible].sort((a, b) => compareText(a.name, b.name));

  dashGrid.innerHTML = sorted.map((device) => dashCard(device)).join("");
}

function dashCard(device) {
  const status = statuses[device.name] || {};
  const stale = isStatusStale(status);
  const statusClass = status.online === true ? "online" : status.online === false ? "offline" : "unknown";
  const staleClass = stale ? "status-stale" : `status-${statusClass}`;

  let statusText = "NIEZNANY";
  if (status.online === true) statusText = "ONLINE";
  else if (status.online === false) statusText = "OFFLINE";

  const latencyHtml = (settings.showLatency && status.online === true && typeof status.latencyMs === "number")
    ? `<span class="dash-latency">${status.latencyMs} ms</span>`
    : "";

  const knownDhcpIp = status.resolvedIp;
  const ipText = device.ip || (knownDhcpIp ? `${knownDhcpIp} (DHCP)` : "DHCP");

  const tags = [
    device.type ? `<span class="dash-tag">${escapeHtml(device.type)}</span>` : "",
    device.area ? `<span class="dash-tag">${escapeHtml(device.area)}</span>` : "",
  ].filter(Boolean).join("");

  const depIssues = [];
  (device.dependencies || []).forEach((depName) => {
    if (statuses[depName]?.online === false) depIssues.push(depName);
  });
  const depHtml = depIssues.length > 0
    ? `<div class="dash-card-dep">⚠ ${escapeHtml(depIssues.join(", "))}</div>`
    : "";

  return `
    <div class="dash-card ${staleClass} ${depIssues.length > 0 ? "hasDepIssue" : ""}">
      <div class="dash-card-bar"></div>
      <div class="dash-card-body">
        <div class="dash-card-name">${escapeHtml(device.name)}</div>
        <div class="dash-card-ip">${escapeHtml(ipText)}</div>
        <div class="dash-card-status">
          <span class="dash-dot"></span>
          <span>${escapeHtml(statusText)}</span>
          ${latencyHtml}
        </div>
        ${tags ? `<div class="dash-card-tags">${tags}</div>` : ""}
        ${depHtml}
      </div>
    </div>
  `;
}

function renderProblems() {
  if (!settings.showProblems) {
    dashProblems.classList.add("hidden");
    return;
  }

  const problems = getProblems();
  if (problems.length === 0) {
    dashProblems.classList.add("hidden");
    return;
  }

  dashProblems.classList.remove("hidden");
  dashProblemsList.innerHTML = problems.map((p) => `
    <li class="${p.type === "dep" ? "dep-item" : ""}">
      <strong>${escapeHtml(p.device)}</strong>
      <span>${escapeHtml(p.message)}</span>
    </li>
  `).join("");
}

/* ===== TIMERY ===== */
function startRefreshTimer() {
  stopRefreshTimer();

  if (settings.refreshInterval <= 0) {
    dashRefreshInfo.textContent = "auto-off";
    return;
  }

  nextRefreshAt = Date.now() + settings.refreshInterval;

  pingTimer = setInterval(() => {
    pingAllVisible();
    nextRefreshAt = Date.now() + settings.refreshInterval;
  }, settings.refreshInterval);

  countdownTimer = setInterval(updateRefreshInfo, 1000);
  updateRefreshInfo();
}

function stopRefreshTimer() {
  if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
}

function updateRefreshInfo() {
  if (settings.refreshInterval <= 0) {
    dashRefreshInfo.textContent = "auto-off";
    return;
  }
  if (isPinging) {
    dashRefreshInfo.textContent = "pinguję…";
    return;
  }
  const remaining = Math.max(0, Math.ceil((nextRefreshAt - Date.now()) / 1000));
  dashRefreshInfo.textContent = `odśwież za ${remaining}s`;
}

/* ===== USTAWIENIA UI ===== */
function renderTypesList() {
  const allTypes = [...new Set([...(config.types || []), ...devices.map((d) => d.type).filter(Boolean)])].sort(compareText);

  if (allTypes.length === 0) {
    dashTypesList.innerHTML = '<p class="dash-settings-hint">Brak typów.</p>';
    return;
  }

  dashTypesList.innerHTML = allTypes.map((type) => `
    <label class="dash-types-item">
      <input type="checkbox" data-dash-type="${escapeHtml(type)}" ${settings.types.includes(type) ? "checked" : ""}>
      <span>${escapeHtml(type)}</span>
    </label>
  `).join("");
}

function openSettings() {
  dashSettings.classList.remove("hidden");
  renderTypesList();
}

function closeSettings() {
  dashSettings.classList.add("hidden");
}

/* ===== HANDLERY ===== */
dashFullscreenButton.addEventListener("click", () => {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    document.documentElement.requestFullscreen().catch(() => {});
  }
});

dashSettingsButton.addEventListener("click", openSettings);
dashSettingsClose.addEventListener("click", closeSettings);
dashProblemsClose.addEventListener("click", () => {
  settings.showProblems = false;
  dashShowProblems.checked = false;
  saveSettings();
  renderProblems();
});

dashTypesList.addEventListener("change", (event) => {
  const type = event.target.dataset.dashType;
  if (!type) return;
  if (event.target.checked) {
    if (!settings.types.includes(type)) settings.types.push(type);
  } else {
    settings.types = settings.types.filter((t) => t !== type);
  }
  saveSettings();
  pingAllVisible();
});

dashRefreshInterval.addEventListener("change", () => {
  settings.refreshInterval = Number(dashRefreshInterval.value);
  saveSettings();
  startRefreshTimer();
});

dashShowProblems.addEventListener("change", () => {
  settings.showProblems = dashShowProblems.checked;
  saveSettings();
  renderProblems();
});

dashShowLatency.addEventListener("change", () => {
  settings.showLatency = dashShowLatency.checked;
  saveSettings();
  render();
});

dashCompactMode.addEventListener("change", () => {
  settings.compactMode = dashCompactMode.checked;
  saveSettings();
  dashGrid.classList.toggle("compact", settings.compactMode);
});

dashDarkMode.addEventListener("change", () => {
  settings.darkMode = dashDarkMode.checked;
  saveSettings();
  document.documentElement.classList.toggle("theme-dark", settings.darkMode);
});

dashRefreshNowButton.addEventListener("click", () => {
  pingAllVisible();
  nextRefreshAt = Date.now() + settings.refreshInterval;
});

dashSettingsResetButton.addEventListener("click", () => {
  if (!confirm("Zresetować ustawienia dashboardu?")) return;
  settings = {
    types: [],
    refreshInterval: 30000,
    showProblems: true,
    showLatency: true,
    compactMode: false,
    darkMode: true,
  };
  saveSettings();
  applySettingsToUI();
  startRefreshTimer();
  pingAllVisible();
  renderTypesList();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeSettings();
  }
  if (event.key === "F11" || (event.key === "f" && event.ctrlKey)) {
    /* zostaw domyślne F11 przeglądarki */
  }
});

/* ===== START ===== */
async function start() {
  applySettingsToUI();
  updateClock();
  clockTimer = setInterval(updateClock, 1000);

  loadPersistedStatuses();

  await Promise.all([loadDevices(), loadConfig()]);

  render();
  await pingAllVisible();
  startRefreshTimer();
}

start().catch((error) => {
  console.error("[dashboard] Błąd startu:", error);
  showToast("Błąd startu dashboardu: " + error.message, "error", 6000);
});
