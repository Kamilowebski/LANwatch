/* ============================================================
   watchdog.js — obserwowane maszyny, pingi w tle, karty,
                 historia pingów, dźwięk przy zmianie stanu.
   ============================================================ */

import {
  devices,
  watchdogToggle,
  watchdogDeviceList,
  watchdogNameInput,
  watchdogHostInput,
  watchdogIntervalInput,
  watchdogAddButton,
  watchdogClearHistoryButton,
  watchdogToggleAddFormButton,
  watchdogAddBox,
  watchdogCancelAddButton,
  watchdogSoundToggle,
  watchdogNotifyToggle,
  watchdogHistoryLengthInput,
  watchdogToggleSettingsButton,
  watchdogSettingsBox,
  watchdogStatusBadge,
  watchdogSaveHistoryLengthButton,
  escapeHtml,
  showToast,
} from "./core.js";

import { playAlertBeep, playRecoveryBeep } from "./sound.js";

import {
  loadNotifyPreference,
  saveNotifyPreference,
} from "./persist.js";

/* ===== POWIADOMIENIA SYSTEMOWE ===== */
export async function requestNotificationPermission() {
  if (!("Notification" in window)) {
    return "unsupported";
  }
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  try {
    const result = await Notification.requestPermission();
    return result;
  } catch (error) {
    return "error";
  }
}

async function showSystemNotification(title, body) {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  const options = {
    body,
    tag: "watchdog-" + title,
  };

  try {
    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) {
        await registration.showNotification(title, options);
        return;
      }
    }
    // Fallback dla przeglądarek bez SW
    new Notification(title, options);
  } catch (error) {
    console.warn("[panel] Powiadomienie nie powiodło się:", error);
  }
} 

/* ===== STAŁE ===== */
export const WATCHDOG_DISPLAY_COUNT = 5;
export const WATCHDOG_DEFAULT_INTERVAL = 5000;
export const WATCHDOG_MIN_INTERVAL = 1000;
export const WATCHDOG_DEFAULT_HISTORY_LENGTH = 1000;
export const WATCHDOG_MIN_HISTORY_LENGTH = 50;
export const WATCHDOG_MAX_HISTORY_LENGTH = 10000;

export let watchdogPrefs = loadWatchdogPrefs();
export const watchdogTimers = {};

/* ===== PREFS ===== */
export function loadWatchdogPrefs() {
  let prefs = null;
  try {
    prefs = JSON.parse(localStorage.getItem("devicePanelWatchdog") || "null");
  } catch (error) {
    prefs = null;
  }
  if (!prefs || typeof prefs !== "object" || Array.isArray(prefs)) {
    prefs = {};
  }
  if (typeof prefs.enabled !== "boolean") prefs.enabled = false;
  if (typeof prefs.soundEnabled !== "boolean") prefs.soundEnabled = true;
  if (typeof prefs.notifyEnabled !== "boolean") prefs.notifyEnabled = false;
  if (!Array.isArray(prefs.watched)) prefs.watched = [];
  if (!prefs.history || typeof prefs.history !== "object" || Array.isArray(prefs.history)) prefs.history = {};

  const historyLength = Number(prefs.historyLength);
  prefs.historyLength = (historyLength >= WATCHDOG_MIN_HISTORY_LENGTH && historyLength <= WATCHDOG_MAX_HISTORY_LENGTH)
    ? Math.round(historyLength)
    : WATCHDOG_DEFAULT_HISTORY_LENGTH;

  prefs.watched = prefs.watched
    .filter((item) => item && item.name && item.host)
    .map((item) => ({
      name: String(item.name),
      host: String(item.host),
      intervalMs: Number(item.intervalMs) >= WATCHDOG_MIN_INTERVAL ? Number(item.intervalMs) : WATCHDOG_DEFAULT_INTERVAL,
    }));

  return prefs;
}

export function saveWatchdogPrefs() {
  if (Array.isArray(watchdogPrefs) || typeof watchdogPrefs !== "object" || watchdogPrefs === null) {
    console.warn("[panel] watchdogPrefs nie jest obiektem — resetuję.");
    watchdogPrefs = { enabled: false, soundEnabled: true, historyLength: WATCHDOG_DEFAULT_HISTORY_LENGTH, watched: [], history: {} };
  }
  try {
    localStorage.setItem("devicePanelWatchdog", JSON.stringify(watchdogPrefs));
  } catch (error) {
    /* ignore */
  }
}

function truncateAllHistories() {
  const limit = watchdogPrefs.historyLength;
  Object.keys(watchdogPrefs.history).forEach((name) => {
    const history = watchdogPrefs.history[name];
    if (Array.isArray(history) && history.length > limit) {
      watchdogPrefs.history[name] = history.slice(-limit);
    }
  });
}

/* ===== ZWIJANIE USTAWIEŃ WATCHDOGA ===== */
function openWatchdogSettings() {
  if (watchdogSettingsBox) {
    watchdogSettingsBox.classList.remove("collapsed");
  }
  if (watchdogToggleSettingsButton) {
    watchdogToggleSettingsButton.textContent = "⚙ Zwiń ustawienia";
  }
}

function closeWatchdogSettings() {
  if (watchdogSettingsBox) {
    watchdogSettingsBox.classList.add("collapsed");
  }
  if (watchdogToggleSettingsButton) {
    watchdogToggleSettingsButton.textContent = "⚙ Ustawienia Watchdoga";
  }
}

function updateWatchdogStatusBadge() {
  if (!watchdogStatusBadge) return;
  if (watchdogPrefs.enabled) {
    watchdogStatusBadge.textContent = `AKTYWNY (${watchdogPrefs.watched.length})`;
    watchdogStatusBadge.className = "watchdogStatusBadge active";
  } else {
    watchdogStatusBadge.textContent = "WYŁĄCZONY";
    watchdogStatusBadge.className = "watchdogStatusBadge inactive";
  }
}
 
/* ===== FORMULARZ DODAWANIA ===== */
function openWatchdogAddForm() {
  watchdogAddBox.classList.remove("collapsed");
  watchdogToggleAddFormButton.textContent = "− Zwiń formularz";
  watchdogNameInput.focus();
}

function closeWatchdogAddForm() {
  watchdogAddBox.classList.add("collapsed");
  watchdogToggleAddFormButton.textContent = "+ Dodaj maszynę";
}

function addWatchdogWatch() {
  const name = watchdogNameInput.value.trim();
  const host = watchdogHostInput.value.trim();
  const intervalMs = Number(watchdogIntervalInput.value);

  if (!name) { showToast("Wpisz nazwę (etykietę).", "error"); return; }
  if (!host) { showToast("Wpisz host / IP.", "error"); return; }
  if (!intervalMs || intervalMs < WATCHDOG_MIN_INTERVAL) {
    showToast(`Interwał musi być >= ${WATCHDOG_MIN_INTERVAL} ms.`, "error");
    return;
  }
  if (watchdogPrefs.watched.some((item) => item.name === name)) {
    showToast(`Maszyna "${name}" już jest na liście.`, "error");
    return;
  }

  watchdogPrefs.watched.push({ name, host, intervalMs });
  if (!watchdogPrefs.history[name]) watchdogPrefs.history[name] = [];
  saveWatchdogPrefs();

  watchdogNameInput.value = "";
  watchdogHostInput.value = "";

  showToast(`Dodano do obserwowanych: ${name} (${host}).`, "success");
  renderWatchdogDeviceList();
  if (watchdogPrefs.enabled) startWatchdogFor(name);
  closeWatchdogAddForm();
}

function removeWatchdogWatch(name) {
  watchdogPrefs.watched = watchdogPrefs.watched.filter((item) => item.name !== name);
  delete watchdogPrefs.history[name];
  saveWatchdogPrefs();
  stopWatchdogFor(name);
  showToast(`Usunięto z obserwowanych: ${name}.`, "info");
  renderWatchdogDeviceList();
}

export function addWatchdogFromDevice(deviceName) {
  const device = devices.find((item) => item.name === deviceName);
  if (!device) {
    showToast("Nie znaleziono urządzenia.", "error");
    return;
  }

  const name = device.name;
  const host = device.addressMode === "dhcp" ? device.name : (device.ip || device.name);

  if (watchdogPrefs.watched.some((item) => item.name === name)) {
    showToast(`„${name}" już jest obserwowane.`, "info");
    import("./tabs.js").then((mod) => mod.setActiveTab("watchdog", true));
    return;
  }

  watchdogPrefs.watched.push({ name, host, intervalMs: WATCHDOG_DEFAULT_INTERVAL });
  if (!watchdogPrefs.history[name]) watchdogPrefs.history[name] = [];
  saveWatchdogPrefs();

  showToast(`Dodano do obserwowanych: ${name} (${host}).`, "success");
  renderWatchdogDeviceList();
  if (watchdogPrefs.enabled) startWatchdogFor(name);
  import("./tabs.js").then((mod) => mod.setActiveTab("watchdog", true));
}

/* ===== TIMERY ===== */
function startWatchdogFor(name) {
  const watched = watchdogPrefs.watched.find((item) => item.name === name);
  if (!watched) return;
  if (watchdogTimers[name]) return;

  pingWatchdog(name);
  watchdogTimers[name] = setInterval(() => pingWatchdog(name), watched.intervalMs);
}

function stopWatchdogFor(name) {
  if (watchdogTimers[name]) {
    clearInterval(watchdogTimers[name]);
    delete watchdogTimers[name];
  }
}

function stopAllWatchdogs() {
  Object.keys(watchdogTimers).forEach((name) => stopWatchdogFor(name));
}

export function restartAllWatchdogs() {
  stopAllWatchdogs();
  if (watchdogPrefs.enabled) {
    watchdogPrefs.watched.forEach((item) => startWatchdogFor(item.name));
  }
}

/* ===== PING ===== */
async function pingWatchdog(name) {
  const watched = watchdogPrefs.watched.find((item) => item.name === name);
  if (!watched) return;

  let status = "timeout";
  let latencyMs = null;

  try {
    const response = await fetch(`/api/ping?count=1&target=${encodeURIComponent(watched.host)}`);
    const result = await response.json();

    if (result.online === true) {
      status = "online";
      latencyMs = typeof result.latencyMs === "number" ? result.latencyMs : null;
    } else if (result.error) {
      status = "timeout";
    } else if (result.raw) {
      status = "offline";
    } else {
      status = "timeout";
    }
  } catch (error) {
    status = "timeout";
  }

  if (!watchdogPrefs.history[name]) watchdogPrefs.history[name] = [];
  const history = watchdogPrefs.history[name];
  const prevEntry = history.length > 0 ? history[history.length - 1] : null;

  if (prevEntry) {
    const prevOk = prevEntry.status === "online";
    const nowOk = status === "online";
    if (prevOk !== nowOk) {
      // Dźwięk
      if (watchdogPrefs.soundEnabled) {
        if (nowOk) playRecoveryBeep();
        else playAlertBeep();
      }
      // Powiadomienie systemowe
      if (watchdogPrefs.notifyEnabled) {
        if (nowOk) {
          showSystemNotification(
            `✅ ${name} wróciło online`,
            `${watched.host} odpowiada ponownie.`
          );
        } else {
          showSystemNotification(
            `⚠ ${name} offline`,
            `${watched.host} nie odpowiada (${status === "timeout" ? "brak odpowiedzi" : "błąd"}).`
          );
        }
      }
    }
  }

  history.push({ t: Date.now(), status, latencyMs });
  if (history.length > watchdogPrefs.historyLength) history.shift();
  saveWatchdogPrefs();

  renderWatchdogDeviceList();

  // Odśwież otwarty raport tej maszyny  import("./report.js").then((mod) => {
    import("./report.js").then((mod) => {
	if (typeof mod.refreshReportIfOpen === "function") {
      mod.refreshReportIfOpen(name);
    }
  }).catch(() => {});
}

/* ===== KARTY ===== */
export function renderWatchdogDeviceList() {
  if (!watchdogDeviceList) return;

  watchdogToggle.checked = watchdogPrefs.enabled;
  watchdogSoundToggle.checked = watchdogPrefs.soundEnabled;
  if (watchdogNotifyToggle) watchdogNotifyToggle.checked = watchdogPrefs.notifyEnabled;
  watchdogHistoryLengthInput.value = watchdogPrefs.historyLength;
  updateWatchdogStatusBadge();

  if (watchdogPrefs.watched.length === 0) {
    watchdogDeviceList.innerHTML = '<p class="muted">Brak obserwowanych maszyn. Dodaj pierwszą powyżej.</p>';
    return;
  }

  watchdogDeviceList.innerHTML = watchdogPrefs.watched.map((item) => {
    const history = watchdogPrefs.history[item.name] || [];
    const recent = history.slice(-WATCHDOG_DISPLAY_COUNT);
    const last = history.length > 0 ? history[history.length - 1] : null;
    const lastStatus = last ? last.status : "unknown";

    let statusLabel = "BRAK DANYCH";
    let lastMsText = "";
    if (last) {
      if (last.status === "online") {
        statusLabel = "ONLINE";
        lastMsText = last.latencyMs != null ? `(ostatni ${last.latencyMs} ms)` : "";
      } else if (last.status === "offline") {
        statusLabel = "OFFLINE";
      } else {
        statusLabel = "BRAK ODPOWIEDZI";
      }
    }

    const pingsHtml = [];
    for (let i = 0; i < WATCHDOG_DISPLAY_COUNT; i++) {
      const point = recent[i];
      if (!point) {
        pingsHtml.push('<span class="wdPing empty">—</span>');
        continue;
      }
      if (point.status === "online") {
        const ms = point.latencyMs != null ? `${point.latencyMs} ms` : "online";
        pingsHtml.push(`<span class="wdPing online">${escapeHtml(ms)}</span>`);
      } else if (point.status === "offline") {
        pingsHtml.push('<span class="wdPing offline">offline</span>');
      } else {
        pingsHtml.push('<span class="wdPing timeout">brak</span>');
      }
    }

    return `
      <div class="wdCard status-${escapeHtml(lastStatus)}">
        <div class="wdCardHeader">
          <div class="wdCardTitle">
            <span class="wdCardName">${escapeHtml(item.name)}</span>
            <span class="wdCardHost">${escapeHtml(item.host)}</span>
          </div>
          <div class="wdCardMeta">
            <span>${item.intervalMs} ms</span>
            <button type="button" class="wdReportButton" data-wd-report="${escapeHtml(item.name)}">Raport</button>
            <button type="button" data-wd-remove="${escapeHtml(item.name)}">Usuń</button>
          </div>
        </div>
        <div class="wdCardStatus ${escapeHtml(lastStatus)}">
          ${escapeHtml(statusLabel)}
          ${lastMsText ? `<span class="lastMs">${escapeHtml(lastMsText)}</span>` : ""}
        </div>
        <div class="wdPings">
          <span class="wdPingsLabel">Ostatnie ${WATCHDOG_DISPLAY_COUNT}:</span>
          ${pingsHtml.join("")}
        </div>
      </div>
    `;
  }).join("");
}

/* ===== GETTERY (dla report.js) ===== */
export function getWatchdogPrefs() {
  return watchdogPrefs;
}

export function getWatchdogHistory(name) {
  return watchdogPrefs.history[name] || [];
}

export function getWatchdogWatched(name) {
  return watchdogPrefs.watched.find((item) => item.name === name);
}

/* ===== INIT HANDLERÓW ===== */
export function initWatchdogHandlers() {
  watchdogToggle.addEventListener("change", () => {
    watchdogPrefs.enabled = watchdogToggle.checked;
    saveWatchdogPrefs();
    restartAllWatchdogs();
    renderWatchdogDeviceList();
  });

  watchdogSoundToggle.addEventListener("change", () => {
    watchdogPrefs.soundEnabled = watchdogSoundToggle.checked;
    saveWatchdogPrefs();
    if (watchdogPrefs.soundEnabled) playRecoveryBeep();
    showToast(watchdogPrefs.soundEnabled ? "Dźwięk włączony." : "Dźwięk wyłączony.", "info");
  });
  if (watchdogNotifyToggle) {
    watchdogNotifyToggle.addEventListener("change", async () => {
      if (watchdogNotifyToggle.checked) {
        const permission = await requestNotificationPermission();
        if (permission === "granted") {
          watchdogPrefs.notifyEnabled = true;
          saveWatchdogPrefs();
          showToast("Powiadomienia systemowe włączone.", "success");
          // Testowe powiadomienie
          showSystemNotification("Panel urządzeń", "Powiadomienia systemowe działają.");
        } else if (permission === "denied") {
          watchdogNotifyToggle.checked = false;
          watchdogPrefs.notifyEnabled = false;
          saveWatchdogPrefs();
          showToast("Przeglądarka zablokowała powiadomienia. Zezwól w ustawieniach witryny.", "error", 6000);
        } else if (permission === "unsupported") {
          watchdogNotifyToggle.checked = false;
          watchdogPrefs.notifyEnabled = false;
          saveWatchdogPrefs();
          showToast("Ta przeglądarka nie obsługuje powiadomień systemowych.", "error", 6000);
        } else {
          watchdogNotifyToggle.checked = false;
          watchdogPrefs.notifyEnabled = false;
          saveWatchdogPrefs();
          showToast("Nie udało się uzyskać zgody na powiadomienia.", "error", 6000);
        }
      } else {
        watchdogPrefs.notifyEnabled = false;
        saveWatchdogPrefs();
        showToast("Powiadomienia systemowe wyłączone.", "info");
      }
    });
  }

  watchdogSaveHistoryLengthButton.addEventListener("click", () => {
    const value = Number(watchdogHistoryLengthInput.value);
    if (!value || value < WATCHDOG_MIN_HISTORY_LENGTH || value > WATCHDOG_MAX_HISTORY_LENGTH) {
      showToast(`Długość historii: ${WATCHDOG_MIN_HISTORY_LENGTH}–${WATCHDOG_MAX_HISTORY_LENGTH}.`, "error");
      return;
    }
    watchdogPrefs.historyLength = Math.round(value);
    truncateAllHistories();
    saveWatchdogPrefs();
    renderWatchdogDeviceList();
    showToast(`Długość historii: ${watchdogPrefs.historyLength} pingów.`, "success");
  });
  if (watchdogToggleSettingsButton) {
    watchdogToggleSettingsButton.addEventListener("click", () => {
      if (watchdogSettingsBox.classList.contains("collapsed")) {
        openWatchdogSettings();
      } else {
        closeWatchdogSettings();
      }
    });
  }
  watchdogAddButton.addEventListener("click", addWatchdogWatch);
  watchdogNameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); addWatchdogWatch(); }
  });
  watchdogHostInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); addWatchdogWatch(); }
  });
  watchdogIntervalInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); addWatchdogWatch(); }
  });

  watchdogToggleAddFormButton.addEventListener("click", () => {
    if (watchdogAddBox.classList.contains("collapsed")) openWatchdogAddForm();
    else closeWatchdogAddForm();
  });

  watchdogCancelAddButton.addEventListener("click", () => {
    watchdogNameInput.value = "";
    watchdogHostInput.value = "";
    closeWatchdogAddForm();
  });

  watchdogClearHistoryButton.addEventListener("click", () => {
    if (!confirm("Wyczyścić historię pingów wszystkich obserwowanych maszyn?")) return;
    watchdogPrefs.history = {};
    saveWatchdogPrefs();
    renderWatchdogDeviceList();
    showToast("Wyczyszczono historię pingów.", "success");
  });

  watchdogDeviceList.addEventListener("click", (event) => {
    const name = event.target.dataset.wdRemove;
    if (name) { removeWatchdogWatch(name); return; }
    const reportName = event.target.dataset.wdReport;
    if (reportName) {
      import("./report.js").then((mod) => mod.openReport(reportName));
    }
  });
}
