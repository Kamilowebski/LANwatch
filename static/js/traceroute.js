/* ============================================================
   traceroute.js — modal traceroute (klik z urządzenia lub z Skanera).
   Czeka na pełny wynik, potem wyświetla listę hopów.
   ============================================================ */

import {
  tracerouteModal,
  tracerouteTitle,
  tracerouteSubtitle,
  tracerouteCloseButton,
  tracerouteStatus,
  tracerouteResults,
  tracerouteHostInput,
  startTracerouteButton,
  escapeHtml,
  addHistoryEntry,
  showToast,
} from "./core.js";

import { getAdminPassword, clearStoredPassword } from "./api.js";

/* ===== OTWIERANIE MODALA ===== */
export function openTraceroute(host, label) {
  if (!host) return;
  tracerouteModal.classList.remove("hidden");
  tracerouteTitle.textContent = label ? `Traceroute: ${label}` : `Traceroute: ${host}`;
  tracerouteSubtitle.textContent = host;
  tracerouteStatus.textContent = "Uruchamiam traceroute… (może potrwać kilkadziesiąt sekund)";
  tracerouteResults.innerHTML = "";
  runTraceroute(host);
}

export function closeTraceroute() {
  tracerouteModal.classList.add("hidden");
  tracerouteStatus.textContent = "";
  tracerouteResults.innerHTML = "";
}

async function runTraceroute(host) {
  const password = await getAdminPassword();
  if (!password) {
    tracerouteStatus.textContent = "Anulowano — brak hasła.";
    return;
  }

  try {
    const response = await fetch("/api/traceroute", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Password": password },
      body: JSON.stringify({ host, maxHops: 15 }),
    });
    const result = await response.json();

    if (!response.ok) {
      if (response.status === 403) clearStoredPassword();
      tracerouteStatus.textContent = result.error || "Nie udało się wykonać traceroute.";
      return;
    }

    renderTracerouteResults(host, result.hops);
  } catch (error) {
    tracerouteStatus.textContent = `Błąd: ${error.message}`;
  }
}

function renderTracerouteResults(host, hops) {
  tracerouteStatus.textContent = `Trasa do ${host}: ${hops.length} hopów.`;

  const rows = hops.map((h) => {
    const hostText = h.host || "*";
    const latencyText = h.latencyMs != null ? `${h.latencyMs} ms` : "—";
    const statusClass = h.status === "ok" ? "trOk" : "trTimeout";
    return `
      <tr>
        <td class="trHopCell">${h.hop}</td>
        <td class="trHostCell ${statusClass}">${escapeHtml(hostText)}</td>
        <td class="trMsCell">${escapeHtml(latencyText)}</td>
      </tr>
    `;
  }).join("");

  tracerouteResults.innerHTML = `
    <table class="tracerouteTable">
      <thead>
        <tr><th>Hop</th><th>Host</th><th>Opóźnienie</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  addHistoryEntry(`Traceroute: ${host} — ${hops.length} hopów.`, "info");
}

/* ===== HANDLERY ===== */
export function initTracerouteHandlers() {
  if (tracerouteCloseButton) {
    tracerouteCloseButton.addEventListener("click", closeTraceroute);
  }

  if (tracerouteModal) {
    tracerouteModal.addEventListener("click", (event) => {
      if (event.target === tracerouteModal) closeTraceroute();
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && tracerouteModal && !tracerouteModal.classList.contains("hidden")) {
      closeTraceroute();
    }
  });

  if (startTracerouteButton) {
    startTracerouteButton.addEventListener("click", () => {
      const host = tracerouteHostInput.value.trim();
      if (!host) {
        showToast("Wpisz host / IP.", "error");
        return;
      }
      openTraceroute(host);
    });
  }

  if (tracerouteHostInput) {
    tracerouteHostInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        const host = tracerouteHostInput.value.trim();
        if (host) openTraceroute(host);
      }
    });
  }
}
