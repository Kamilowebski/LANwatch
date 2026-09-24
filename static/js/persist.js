/* ============================================================
   persist.js — drobne preferencje UI w localStorage:
                motyw, tryb bulk, auto-ping, aktywna zakładka,
                użytkownik SSH z szybkich połączeń, tryb widoku.
   ============================================================ */

import {
  themeToggleButton,
  bulkModeToggle,
  autoPingToggle,
  autoPingInterval,
  quickSshUserInput,
} from "./core.js";

/* ===== MOTYW ===== */
export function applyTheme(theme) {
  document.documentElement.classList.toggle("theme-dark", theme === "dark");
  if (themeToggleButton) {
    themeToggleButton.textContent = theme === "dark" ? "☀️" : "🌙";
    themeToggleButton.title = theme === "dark" ? "Przełącz na jasny motyw" : "Przełącz na ciemny motyw";
  }
}

export function loadTheme() {
  let saved = null;
  try {
    saved = localStorage.getItem("devicePanelTheme");
  } catch (error) {
    saved = null;
  }
  const theme = saved || (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  applyTheme(theme);
}

export function initThemeToggle() {
  if (!themeToggleButton) return;
  themeToggleButton.addEventListener("click", () => {
    const isDark = document.documentElement.classList.contains("theme-dark");
    const nextTheme = isDark ? "light" : "dark";
    applyTheme(nextTheme);
    try {
      localStorage.setItem("devicePanelTheme", nextTheme);
    } catch (error) {
      /* ignore */
    }
  });
}

/* ===== AKTYWNA ZAKŁADKA ===== */
export function loadActiveTab() {
  try {
    return localStorage.getItem("devicePanelActiveTab");
  } catch (error) {
    return null;
  }
}

export function saveActiveTab(tabName) {
  try {
    localStorage.setItem("devicePanelActiveTab", tabName || "");
  } catch (error) {
    /* ignore */
  }
}

/* ===== TRYB BULK ===== */
export function loadBulkModePreference() {
  try {
    return localStorage.getItem("devicePanelBulkMode") === "1";
  } catch (error) {
    return false;
  }
}

export function saveBulkModePreference(enabled) {
  try {
    localStorage.setItem("devicePanelBulkMode", enabled ? "1" : "0");
  } catch (error) {
    /* ignore */
  }
}

/* ===== AUTO-PING ===== */
export function loadAutoPingPreference() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem("devicePanelAutoPing") || "null");
  } catch (error) {
    saved = null;
  }
  if (!saved || typeof saved !== "object") {
    saved = { enabled: false, interval: "300000" };
  }
  if (autoPingToggle) {
    autoPingToggle.checked = Boolean(saved.enabled);
  }
  if (autoPingInterval && saved.interval) {
    autoPingInterval.value = saved.interval;
  }
  return saved;
}

export function saveAutoPingPreference() {
  if (!autoPingToggle || !autoPingInterval) return;
  try {
    localStorage.setItem("devicePanelAutoPing", JSON.stringify({
      enabled: autoPingToggle.checked,
      interval: autoPingInterval.value,
    }));
  } catch (error) {
    /* ignore */
  }
}

/* ===== SZYBKIE POŁĄCZENIA — UŻYTKOWNIK SSH ===== */
export function loadQuickSshUser() {
  if (!quickSshUserInput) return;
  try {
    const saved = localStorage.getItem("devicePanelQuickSshUser");
    if (saved) quickSshUserInput.value = saved;
  } catch (error) {
    /* ignore */
  }
}

export function initQuickSshUserPersistence() {
  if (!quickSshUserInput) return;
  quickSshUserInput.addEventListener("input", () => {
    try {
      localStorage.setItem("devicePanelQuickSshUser", quickSshUserInput.value.trim());
    } catch (error) {
      /* ignore */
    }
  });
}

/* ===== WIDOK (tabela / karty) ===== */
export function loadViewMode() {
  try {
    const saved = localStorage.getItem("devicePanelViewMode");
    if (saved === "cards" || saved === "table") return saved;
  } catch (error) {
    /* ignore */
  }
  return "table";
}

export function saveViewMode(mode) {
  try {
    localStorage.setItem("devicePanelViewMode", mode);
  } catch (error) {
    /* ignore */
  }
}
/* ===== ULUBIONE ===== */
export function loadFavorites() {
  try {
    const raw = localStorage.getItem("devicePanelFavorites");
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.map((v) => String(v)));
  } catch (error) {
    return new Set();
  }
}

export function saveFavorites(favoritesSet) {
  try {
    const list = [...favoritesSet];
    localStorage.setItem("devicePanelFavorites", JSON.stringify(list));
  } catch (error) {
    /* ignore */
  }
}

/* ===== POWIADOMIENIA SYSTEMOWE ===== */
export function loadNotifyPreference() {
  try {
    return localStorage.getItem("devicePanelNotifyEnabled") === "1";
  } catch (error) {
    return false;
  }
}

export function saveNotifyPreference(enabled) {
  try {
    localStorage.setItem("devicePanelNotifyEnabled", enabled ? "1" : "0");
  } catch (error) {
    /* ignore */
  }
}

/* ===== FILTR TYLKO ULUBIONE ===== */
export function loadFavoritesOnlyFilter() {
  try {
    return localStorage.getItem("devicePanelFavoritesOnly") === "1";
  } catch (error) {
    return false;
  }
}

export function saveFavoritesOnlyFilter(enabled) {
  try {
    localStorage.setItem("devicePanelFavoritesOnly", enabled ? "1" : "0");
  } catch (error) {
    /* ignore */
  }
}
