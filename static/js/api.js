/* ============================================================
   api.js — warstwa komunikacji z backendem + obsługa hasła.
   ============================================================ */

import {
  passwordModal,
  passwordForm,
  passwordModalInput,
  passwordModalCancel,
  editHint,
} from "./core.js";

/* ===== HASŁO ===== */
export function getStoredPassword() {
  try {
    return sessionStorage.getItem("devicePanelAdminPassword") || "";
  } catch (error) {
    return "";
  }
}

export function storePassword(value) {
  try {
    sessionStorage.setItem("devicePanelAdminPassword", value);
  } catch (error) {
    /* ignore */
  }
}

export function clearStoredPassword() {
  try {
    sessionStorage.removeItem("devicePanelAdminPassword");
  } catch (error) {
    /* ignore */
  }
}

let passwordPromiseResolve = null;

export function closePasswordModal() {
  passwordModal.classList.add("hidden");
  passwordModalInput.value = "";
}

export function requestPasswordFromModal() {
  return new Promise((resolve) => {
    passwordPromiseResolve = resolve;
    passwordModal.classList.remove("hidden");
    passwordModalInput.focus();
  });
}

export function initPasswordModalHandlers() {
  passwordForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = passwordModalInput.value;
    closePasswordModal();
    if (passwordPromiseResolve) {
      if (value) {
        storePassword(value);
      }
      passwordPromiseResolve(value || null);
      passwordPromiseResolve = null;
    }
  });

  passwordModalCancel.addEventListener("click", () => {
    closePasswordModal();
    if (passwordPromiseResolve) {
      passwordPromiseResolve(null);
      passwordPromiseResolve = null;
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !passwordModal.classList.contains("hidden")) {
      closePasswordModal();
      if (passwordPromiseResolve) {
        passwordPromiseResolve(null);
        passwordPromiseResolve = null;
      }
    }
  });
}

export async function getAdminPassword() {
  const stored = getStoredPassword();
  if (stored) return stored;
  return requestPasswordFromModal();
}

/* ===== OGÓLNE FETCH ===== */
export async function apiGet(path) {
  const response = await fetch(path);
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || `Błąd HTTP ${response.status}`);
  }
  return { result, response };
}

export async function apiPost(path, payload, requireAuth = true) {
  const headers = { "Content-Type": "application/json" };
  if (requireAuth) {
    const password = await getAdminPassword();
    if (!password) return { ok: false, cancelled: true };
    headers["X-Admin-Password"] = password;
  }

  const response = await fetch(path, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const result = await response.json();

  if (response.status === 403) {
    clearStoredPassword();
  }

  return { ok: response.ok, status: response.status, result, response };
}

/* ===== POMOCNIK: obsługa błędów z alertem ===== */
export function reportApiError(result, defaultMessage) {
  if (result && result.error) {
    return result.error;
  }
  return defaultMessage;
}
