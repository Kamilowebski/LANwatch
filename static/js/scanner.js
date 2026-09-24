/* ============================================================
   scanner.js — skaner sieci: wysyła zakres, wyświetla wyniki,
                prefill formularza z wykrytego hosta.
   ============================================================ */

import {
  scanRangeInput,
  startScanButton,
  scanStatus,
  scanResults,
  getAllResolvedIps,
  escapeHtml,
  addHistoryEntry,
  deviceIp,
  deviceAddressMode,
  deviceName,
  editorTitle,
  editHint,
} from "./core.js";

import {
  getAdminPassword,
  clearStoredPassword,
} from "./api.js";

let lastScanResults = {};

export function initScanner() {
  startScanButton.addEventListener("click", startNetworkScan);
  scanRangeInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      startNetworkScan();
    }
  });
}

async function startNetworkScan() {
  const range = scanRangeInput.value.trim();
  if (!range) {
    scanStatus.textContent = "Wpisz zakres, np. 192.168.1.1-192.168.1.254.";
    return;
  }

  const password = await getAdminPassword();
  if (!password) return;

  startScanButton.disabled = true;
  scanResults.innerHTML = "";
  scanStatus.textContent = "Skanowanie w toku, to może potrwać do kilkunastu-kilkudziesięciu sekund…";

  try {
    const response = await fetch("/api/network-scan", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Password": password,
      },
      body: JSON.stringify({ range, knownDhcpIps: getAllResolvedIps() }),
    });
    const result = await response.json();

    if (!response.ok) {
      if (response.status === 403) clearStoredPassword();
      scanStatus.textContent = result.error || "Nie udało się przeskanować sieci.";
      return;
    }

    renderScanResults(result);
  } catch (error) {
    scanStatus.textContent = `Błąd skanowania: ${error.message}`;
  } finally {
    startScanButton.disabled = false;
  }
}

function renderScanResults(result) {
  lastScanResults = {};
  result.online.forEach((item) => {
    lastScanResults[item.ip] = item;
  });

  const newFound = result.online.filter((item) => !item.inDatabase);
  const known = result.online.filter((item) => item.inDatabase);

  scanStatus.textContent = `Sprawdzono ${result.scanned} adresów, online: ${result.online.length} ` +
    `(nowych, spoza bazy: ${newFound.length}).`;

  addHistoryEntry(
    `Skan sieci: sprawdzono ${result.scanned} adresów, online ${result.online.length} (nowych: ${newFound.length}).`,
    "info"
  );

  if (result.online.length === 0) {
    scanResults.innerHTML = "";
    return;
  }

  const rows = [...newFound, ...known].map((item) => {
    const latency = item.latencyMs ? `${item.latencyMs} ms` : "";
    const hostnameText = item.hostname ? `— ${item.hostname}` : "";
    if (item.inDatabase) {
      return `
        <div class="scanResultRow inDatabase">
          <span><span class="scanIp">${escapeHtml(item.ip)}</span> <span class="muted">${escapeHtml(hostnameText)} już w bazie ${escapeHtml(latency)}</span></span>
        </div>
      `;
    }
    return `
      <div class="scanResultRow">
        <span><span class="scanIp">${escapeHtml(item.ip)}</span> <span class="muted">${escapeHtml(hostnameText)} ${escapeHtml(latency)}</span></span>
        <button data-scan-add="${escapeHtml(item.ip)}">Dodaj do bazy</button>
      </div>
    `;
  });

  scanResults.innerHTML = rows.join("");
}

export function prefillFromScan(ip) {
  const scanItem = lastScanResults[ip];
  // clearForm jest w devices.js — dynamiczny import
  import("./devices.js").then((mod) => {
    if (typeof mod.clearForm === "function") {
      mod.clearForm();
    }
  });
  deviceIp.value = ip;
  deviceAddressMode.value = "static";
  if (scanItem && scanItem.hostname) {
    deviceName.value = scanItem.hostname.toUpperCase();
  }
  import("./tabs.js").then((mod) => {
    if (typeof mod.setActiveTab === "function") {
      mod.setActiveTab("add", true);
    }
  });
  editorTitle.textContent = `Nowe urządzenie — ${ip}`;
  editHint.textContent = scanItem && scanItem.hostname
    ? `Znalezione skanerem pod adresem ${ip} (nazwa hosta: ${scanItem.hostname}). Sprawdź/popraw nazwę i pozostałe dane, potem zapisz.`
    : `Znalezione skanerem pod adresem ${ip}. Uzupełnij nazwę i pozostałe dane, potem zapisz.`;
  deviceName.focus();
}
