/* ============================================================
   config.js — konfiguracja: słowniki (typy/obszary/grupy),
               tunel SSH/VNC, funkcje dodatkowe, tryb bulk.
   ============================================================ */

import {
  config,
  setConfig,
  sshUserInput, vncLocalPortInput, vncRemotePortInput, vncViewerPathInput,
  saveTunnelSettingsButton,
  addTypeButton, addAreaButton, addGroupButton,
  newTypeInput, newAreaInput, newGroupInput,
  clearHistoryButton,
  showToast,
  addHistoryEntry,
  statsEnabledInput, statsIntervalInput, statsRetentionInput, statsConcurrencyInput,
  statsRunNowButton, statsRunNowStatus,
  backupEnabledInput, backupHourInput, backupMinuteInput, backupRetentionInput,
  backupNowButton, backupNowStatus,
} from "./core.js";

import {
  getAdminPassword,
  clearStoredPassword,
} from "./api.js";

import { clearSessionHistory } from "./core.js";

export function initConfigHandlers() {
  // ===== SŁOWNIKI =====
  addTypeButton.addEventListener("click", async () => {
    const mod = await import("./devices.js");
    mod.addDictionaryValue("type");
  });
  addAreaButton.addEventListener("click", async () => {
    const mod = await import("./devices.js");
    mod.addDictionaryValue("area");
  });
  addGroupButton.addEventListener("click", async () => {
    const mod = await import("./devices.js");
    mod.addDictionaryValue("group");
  });

  newTypeInput.addEventListener("keydown", async (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const mod = await import("./devices.js");
      mod.addDictionaryValue("type");
    }
  });
  newAreaInput.addEventListener("keydown", async (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const mod = await import("./devices.js");
      mod.addDictionaryValue("area");
    }
  });
  newGroupInput.addEventListener("keydown", async (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const mod = await import("./devices.js");
      mod.addDictionaryValue("group");
    }
  });

  // ===== TUNEL SSH/VNC =====
  saveTunnelSettingsButton.addEventListener("click", saveTunnelSettings);

  // ===== HISTORIA =====
  clearHistoryButton.addEventListener("click", clearSessionHistory);
  
   // ===== STATYSTYKI =====
  if (statsRunNowButton) {
    statsRunNowButton.addEventListener("click", async () => {
      const password = await getAdminPassword();
      if (!password) return;

      statsRunNowButton.disabled = true;
      statsRunNowStatus.textContent = "Uruchamiam cykl…";

      try {
        const response = await fetch("/api/stats/run-now", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Admin-Password": password },
          body: JSON.stringify({}),
        });
        const result = await response.json();

        if (!response.ok) {
          if (response.status === 403) clearStoredPassword();
          statsRunNowStatus.textContent = result.error || "Błąd.";
          return;
        }

        statsRunNowStatus.textContent = `OK: ${result.online} online / ${result.offline} offline (${result.date})`;
        addHistoryEntry(`Ręczny cykl statystyk: ${result.online} online / ${result.offline} offline.`, "success");
      } catch (error) {
        statsRunNowStatus.textContent = `Błąd: ${error.message}`;
      } finally {
        statsRunNowButton.disabled = false;
      }
    });
  }

  // ===== BACKUP =====
  if (backupNowButton) {
    backupNowButton.addEventListener("click", async () => {
      const password = await getAdminPassword();
      if (!password) return;

      backupNowButton.disabled = true;
      backupNowStatus.textContent = "Wykonuję kopię…";

      try {
        const response = await fetch("/api/stats/backup-now", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Admin-Password": password },
          body: JSON.stringify({}),
        });
        const result = await response.json();

        if (!response.ok) {
          if (response.status === 403) clearStoredPassword();
          backupNowStatus.textContent = result.error || "Błąd.";
          return;
        }

        backupNowStatus.textContent = `OK: skopiowano ${result.copied.length} plików, usunięto ${result.removed} starych.`;
        addHistoryEntry(`Ręczna kopia zapasowa: ${result.copied.join(", ")}`, "success");
      } catch (error) {
        backupNowStatus.textContent = `Błąd: ${error.message}`;
      } finally {
        backupNowButton.disabled = false;
      }
    });
  }
}

async function saveTunnelSettings() {
  const password = await getAdminPassword();
  if (!password) return;

  // Krok 1: pobierz aktualny config z backendu (żeby nie skasować pól spoza UI)
  let serverConfig = {};
  try {
    const cfgResponse = await fetch("/api/config");
    serverConfig = await cfgResponse.json();
  } catch (error) {
    alert("Nie udało się pobrać aktualnej konfiguracji z serwera.");
    return;
  }

  // Krok 2: zbuduj payload — bierz z backendu, nadpisz tylko to co jest w UI
  const updatedConfig = {
    ...serverConfig,
    areas: serverConfig.areas || [],
    types: serverConfig.types || [],
    groups: serverConfig.groups || [],

    sshUser: sshUserInput ? sshUserInput.value.trim() : (serverConfig.sshUser || ""),
    vncLocalPort: vncLocalPortInput ? (Number(vncLocalPortInput.value) || 5900) : (serverConfig.vncLocalPort || 5900),
    vncRemotePort: vncRemotePortInput ? (Number(vncRemotePortInput.value) || 5900) : (serverConfig.vncRemotePort || 5900),
    vncViewerPath: vncViewerPathInput ? vncViewerPathInput.value.trim() : (serverConfig.vncViewerPath || ""),

    statsEnabled: statsEnabledInput ? statsEnabledInput.checked : (serverConfig.statsEnabled === true),
    statsIntervalMinutes: statsIntervalInput ? (Number(statsIntervalInput.value) || 15) : (serverConfig.statsIntervalMinutes || 15),
    statsRetentionDays: statsRetentionInput ? (Number(statsRetentionInput.value) || 90) : (serverConfig.statsRetentionDays || 90),
    statsPingConcurrency: statsConcurrencyInput ? (Number(statsConcurrencyInput.value) || 24) : (serverConfig.statsPingConcurrency || 24),

    backupEnabled: backupEnabledInput ? backupEnabledInput.checked : (serverConfig.backupEnabled !== false),
    backupHour: backupHourInput ? (Number(backupHourInput.value) || 13) : (serverConfig.backupHour != null ? serverConfig.backupHour : 13),
    backupMinute: backupMinuteInput ? (Number(backupMinuteInput.value) || 30) : (serverConfig.backupMinute != null ? serverConfig.backupMinute : 30),
    backupRetentionDays: backupRetentionInput ? (Number(backupRetentionInput.value) || 30) : (serverConfig.backupRetentionDays || 30),
  };

  // Krok 3: wyślij na serwer
  const response = await fetch("/api/config", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Password": password,
    },
    body: JSON.stringify({ config: updatedConfig }),
  });
  const result = await response.json();

  if (!response.ok) {
    if (response.status === 403) clearStoredPassword();
    addHistoryEntry(result.error || "Nie udało się zapisać konfiguracji.", "error");
    alert(result.error || "Nie udało się zapisać konfiguracji.");
    return;
  }

  // Krok 4: zaktualizuj pola UI z tego co zapisał backend
  setConfig({ ...config, ...result.config });
  fillAllConfigFields(result.config);

  addHistoryEntry("Zapisano konfigurację.", "success");
  alert("Zapisano konfigurację.");
}

export function fillAllConfigFields(cfg) {
  if (!cfg || typeof cfg !== "object") return;

  // Tunel SSH/VNC
  if (sshUserInput) sshUserInput.value = cfg.sshUser != null ? String(cfg.sshUser) : "";
  if (vncLocalPortInput) vncLocalPortInput.value = cfg.vncLocalPort != null ? cfg.vncLocalPort : 5900;
  if (vncRemotePortInput) vncRemotePortInput.value = cfg.vncRemotePort != null ? cfg.vncRemotePort : 5900;
  if (vncViewerPathInput) vncViewerPathInput.value = cfg.vncViewerPath != null ? String(cfg.vncViewerPath) : "";

  // Statystyki
  if (statsEnabledInput) statsEnabledInput.checked = cfg.statsEnabled === true;
  if (statsIntervalInput) statsIntervalInput.value = cfg.statsIntervalMinutes != null ? cfg.statsIntervalMinutes : 15;
  if (statsRetentionInput) statsRetentionInput.value = cfg.statsRetentionDays != null ? cfg.statsRetentionDays : 90;
  if (statsConcurrencyInput) statsConcurrencyInput.value = cfg.statsPingConcurrency != null ? cfg.statsPingConcurrency : 24;

  // Backup
  if (backupEnabledInput) backupEnabledInput.checked = cfg.backupEnabled !== false;
  if (backupHourInput) backupHourInput.value = cfg.backupHour != null ? cfg.backupHour : 13;
  if (backupMinuteInput) backupMinuteInput.value = cfg.backupMinute != null ? cfg.backupMinute : 30;
  if (backupRetentionInput) backupRetentionInput.value = cfg.backupRetentionDays != null ? cfg.backupRetentionDays : 30;
}
