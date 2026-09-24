/* ============================================================
   connections.js — szybkie połączenia SSH/VNC/HTTPS/HTTP
                    dla hostów spoza bazy.
   ============================================================ */

import {
  quickHostInput,
  quickSshUserInput,
  quickVncButton,
  quickSshButton,
  quickHttpsLink,
  quickHttpLink,
  showToast,
} from "./core.js";

import {
  getAdminPassword,
  clearStoredPassword,
} from "./api.js";

function getQuickHost() {
  const host = quickHostInput.value.trim();
  if (!host) {
    showToast("Wpisz host / IP / nazwę.", "error");
    return null;
  }
  return host;
}

export function initConnections() {
  quickSshButton.addEventListener("click", async () => {
    const host = getQuickHost();
    if (!host) return;

    const password = await getAdminPassword();
    if (!password) return;

    const response = await fetch("/api/ssh-raw", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Password": password,
      },
      body: JSON.stringify({
        host,
        sshUser: quickSshUserInput.value.trim(),
      }),
    });
    const result = await response.json();

    if (!response.ok) {
      if (response.status === 403) clearStoredPassword();
      showToast(result.error || "Nie udało się uruchomić SSH.", "error", 6000);
      return;
    }

    showToast(result.message || "Uruchomiono SSH.", "success");
  });

  quickVncButton.addEventListener("click", async () => {
    const host = getQuickHost();
    if (!host) return;

    const password = await getAdminPassword();
    if (!password) return;

    const response = await fetch("/api/vnc-raw", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Password": password,
      },
      body: JSON.stringify({ host }),
    });
    const result = await response.json();

    if (!response.ok) {
      if (response.status === 403) clearStoredPassword();
      showToast(result.error || "Nie udało się otworzyć VNC.", "error", 6000);
      return;
    }

    showToast(result.message || "Uruchomiono VNC.", "success");
  });

  quickHostInput.addEventListener("input", updateQuickLinks);
  quickHostInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (quickHttpsLink.href && quickHttpsLink.href !== "#") {
        window.open(quickHttpsLink.href, "_blank", "noopener");
      }
    }
  });
}

function updateQuickLinks() {
  const host = quickHostInput.value.trim();
  if (!host) {
    quickHttpsLink.href = "#";
    quickHttpLink.href = "#";
    return;
  }
  quickHttpsLink.href = `https://${host}`;
  quickHttpLink.href = `http://${host}`;
}
