/* ============================================================
   devices.js — tabela główna + widok kart: ładowanie, filtrowanie,
                sortowanie, paginacja, wiersze, formularz
                dodawania/edycji, zapis, zależności, WOL, widok,
                ulubione, pola sieciowe, traceroute.
   ============================================================ */

import {
  devices, setDevices,
  devicesVersion, setDevicesVersion,
  config, setConfig,
  statuses,
  currentPage, setCurrentPage,
  expandedDevices, setExpandedDevices,
  selectedDevices, setSelectedDevices,
  currentPageNames, setCurrentPageNames,
  body, summary, pingAllButton,
  searchInput, typeFilter, areaFilter, groupFilter, sortSelect,
  statusFilter, addressModeFilter, keywordFilter,
  clearFiltersButton, pageSizeSelect,
  prevPageButton, nextPageButton, pageInfo,
  selectAllCheckbox,
  editorTitle, deviceForm, editName, deviceName, deviceIp,
  deviceAddressMode, deviceType, deviceArea, deviceGroup,
  deviceKeywords, deviceNote, numeratorField, deviceNumerator,
  deviceSystemId, deviceVncUsername, deleteEditButton,
  clearFormButton, editHint,
  escapeHtml, uniq, compareText, setSelectIfOptionExists,
  pingTargetFor, markDirty, clearDirty, showToast,
  addHistoryEntry, isStatusStale, getResolvedIp,
  savePersistedStatuses,
  devicesCards, viewTableButton, viewCardsButton,
  depsFilterInput, depsList, depsSelected,
  deviceMac,
  deviceNetmask, deviceGateway, deviceDns,
  favoritesOnlyFilter,
} from "./core.js";

import {
  getAdminPassword,
  clearStoredPassword,
} from "./api.js";

import {
  loadViewMode, saveViewMode,
  loadFavorites, saveFavorites,
  loadFavoritesOnlyFilter, saveFavoritesOnlyFilter,
} from "./persist.js";

import { pingDevice, pingDevicesConcurrently, pingTarget } from "./ping.js";

/* ===== ZMIENNE STANU WIDOKU ===== */
let currentViewMode = "table";
let currentDeps = new Set();
let currentFavorites = loadFavorites();

/* ===== ŁADOWANIE DANYCH ===== */
export async function loadDevices() {
  const preserved = {
    search: searchInput.value,
    type: typeFilter.value,
    area: areaFilter.value,
    group: groupFilter.value,
    sort: sortSelect.value,
    status: statusFilter.value,
    addressMode: addressModeFilter.value,
    keyword: keywordFilter.value,
    pageSize: pageSizeSelect.value,
    currentPage: currentPage,
    expanded: new Set(expandedDevices),
    selected: new Set(selectedDevices),
  };

  const [devicesResponse, configResponse] = await Promise.all([
    fetch("/api/devices"),
    fetch("/api/config"),
  ]);
  const newDevices = await devicesResponse.json();
  const newVersion = devicesResponse.headers.get("X-Devices-Version");
  const newConfig = await configResponse.json();

  const mergedConfig = { ...config, ...newConfig };

  setDevices(newDevices);
  setDevicesVersion(newVersion);
  setConfig(mergedConfig);

  fillFilters();
  fillFormOptions();
  renderDictionaries();

  // Wypełnij WSZYSTKIE pola konfiguracji (SSH/VNC/stats/backup)
  import("./config.js").then((mod) => {
    if (typeof mod.fillAllConfigFields === "function") {
      mod.fillAllConfigFields(mergedConfig);
    }
  }).catch(() => {});
  
  searchInput.value = preserved.search;
  setSelectIfOptionExists(typeFilter, preserved.type);
  setSelectIfOptionExists(areaFilter, preserved.area);
  setSelectIfOptionExists(groupFilter, preserved.group);
  sortSelect.value = preserved.sort || "name";
  setSelectIfOptionExists(statusFilter, preserved.status);
  setSelectIfOptionExists(addressModeFilter, preserved.addressMode);
  keywordFilter.value = preserved.keyword;
  pageSizeSelect.value = preserved.pageSize || "20";
  setCurrentPage(preserved.currentPage || 1);

  const existingNames = new Set(devices.map((d) => d.name));
  setExpandedDevices(new Set([...preserved.expanded].filter((n) => existingNames.has(n))));
  setSelectedDevices(new Set([...preserved.selected].filter((n) => existingNames.has(n))));

  render();

  import("./watchdog.js").then((mod) => {
    if (typeof mod.renderWatchdogDeviceList === "function") {
      mod.renderWatchdogDeviceList();
    }
  }).catch(() => {});
}

/* ===== FILTRY / OPCJE ===== */
export function fillFilters() {
  const types = uniq([...config.types, ...devices.map((device) => device.type)]);
  const areas = uniq([...config.areas, ...devices.map((device) => device.area)]);
  const groups = uniq([...config.groups, ...devices.map((device) => device.group)]);

  typeFilter.innerHTML = '<option value="">Wszystkie typy</option>' +
    types.map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join("");

  areaFilter.innerHTML = '<option value="">Wszystkie obszary</option>' +
    areas.map((area) => `<option value="${escapeHtml(area)}">${escapeHtml(area)}</option>`).join("");

  groupFilter.innerHTML = '<option value="">Wszystkie</option>' +
    groups.map((group) => `<option value="${escapeHtml(group)}">${escapeHtml(group)}</option>`).join("");
}

export function fillFormOptions() {
  const types = uniq([...config.types, ...devices.map((device) => device.type)]);
  const areas = uniq([...config.areas, ...devices.map((device) => device.area)]);
  const groups = uniq([...config.groups, ...devices.map((device) => device.group)]);

  deviceType.innerHTML = types.map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join("");
  deviceArea.innerHTML = areas.map((area) => `<option value="${escapeHtml(area)}">${escapeHtml(area)}</option>`).join("");
  deviceGroup.innerHTML = '<option value="">— brak —</option>' +
    groups.map((group) => `<option value="${escapeHtml(group)}">${escapeHtml(group)}</option>`).join("");
}

/* ===== FILTROWANIE / SORT ===== */
export function getFilteredDevices() {
  const query = searchInput.value.trim().toLowerCase();
  const type = typeFilter.value;
  const area = areaFilter.value;
  const group = groupFilter.value;
  const status = statusFilter.value;
  const addressMode = addressModeFilter.value;
  const keyword = keywordFilter.value.trim().toLowerCase();
  const favOnly = favoritesOnlyFilter ? favoritesOnlyFilter.checked : false;

  const filtered = devices.filter((device) => {
    const currentStatus = statuses[device.name]?.online === true ? "online" : statuses[device.name]?.online === false ? "offline" : "unknown";
    const keywords = device.keywords || [];
    const haystack = [
      device.name,
      device.ip,
      device.netmask,
      device.gateway,
      device.dns,
      device.addressMode,
      device.type,
      device.site,
      device.area,
      device.areaCode,
      device.number,
      device.note,
      device.systemId,
      device.group,
      getResolvedIp(device.name) || "",
      ...(device.keywords || []),
    ].join(" ").toLowerCase();

    if (favOnly && !currentFavorites.has(device.name)) {
      return false;
    }

    return (!query || haystack.includes(query)) &&
      (!type || device.type === type) &&
      (!area || device.area === area) &&
      (!group || device.group === group) &&
      (!status || currentStatus === status) &&
      (!addressMode || device.addressMode === addressMode) &&
      (!keyword || keywords.some((word) => word.toLowerCase().includes(keyword)));
  });

  return sortDevices(filtered);
}

function sortDevices(items) {
  const key = sortSelect.value;
  const statusRank = { online: 0, offline: 1, unknown: 2 };

  return [...items].sort((a, b) => {
    // Ulubione zawsze na górze (sztywno)
    const favA = currentFavorites.has(a.name) ? 0 : 1;
    const favB = currentFavorites.has(b.name) ? 0 : 1;
    if (favA !== favB) return favA - favB;

    if (key === "status") {
      const statusA = statuses[a.name]?.online === true ? "online" : statuses[a.name]?.online === false ? "offline" : "unknown";
      const statusB = statuses[b.name]?.online === true ? "online" : statuses[b.name]?.online === false ? "offline" : "unknown";
      return statusRank[statusA] - statusRank[statusB] || compareText(a.name, b.name);
    }

    return compareText(a[key] || "", b[key] || "") || compareText(a.name, b.name);
  });
}

/* ===== RENDER ===== */
export function render() {
  const filtered = getFilteredDevices();
  const pageData = paginate(filtered);
  const online = filtered.filter((device) => statuses[device.name]?.online === true).length;
  const offline = filtered.filter((device) => statuses[device.name]?.online === false).length;

  summary.innerHTML = [
    metric(filtered.length, "Widoczne urządzenia"),
    metric(online, "Online"),
    metric(offline, "Offline"),
    metric(devices.length, "Wszystkie w pliku"),
  ].join("");

  pingAllButton.textContent = `Ping widoczne (${filtered.length})`;

  if (currentViewMode === "cards") {
    if (devicesCards) {
      devicesCards.innerHTML = pageData.items.map((device) => card(device)).join("");
      devicesCards.classList.remove("hidden");
    }
    const tableEl = document.querySelector("#devicesTable");
    if (tableEl) tableEl.closest(".tableWrap").classList.add("hidden");
  } else {
    body.innerHTML = pageData.items.map((device) => row(device)).join("");
    if (devicesCards) devicesCards.classList.add("hidden");
    const tableEl = document.querySelector("#devicesTable");
    if (tableEl) tableEl.closest(".tableWrap").classList.remove("hidden");
  }

  renderPagination(pageData, filtered.length);

  setCurrentPageNames(pageData.items.map((device) => device.name));
  selectAllCheckbox.checked = currentPageNames.length > 0 && currentPageNames.every((name) => selectedDevices.has(name));

  import("./bulk.js").then((mod) => {
    if (typeof mod.updateBulkBar === "function") {
      mod.updateBulkBar();
    }
  }).catch(() => {});
}

function metric(value, label) {
  return `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`;
}

function paginate(items) {
  const selectedSize = pageSizeSelect.value;
  if (selectedSize === "all") {
    setCurrentPage(1);
    return { items, page: 1, totalPages: 1, pageSize: items.length || 1 };
  }

  const pageSize = Number(selectedSize);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const clampedPage = Math.min(Math.max(1, currentPage), totalPages);
  setCurrentPage(clampedPage);
  const start = (clampedPage - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    page: clampedPage,
    totalPages,
    pageSize,
  };
}

function renderPagination(pageData, totalItems) {
  const selectedSize = pageSizeSelect.value;
  const showingAll = selectedSize === "all";
  const from = totalItems === 0 ? 0 : (pageData.page - 1) * pageData.pageSize + 1;
  const to = showingAll ? totalItems : Math.min(totalItems, pageData.page * pageData.pageSize);

  pageInfo.textContent = `${from}-${to} z ${totalItems} | strona ${pageData.page} / ${pageData.totalPages}`;
  prevPageButton.disabled = showingAll || pageData.page <= 1;
  nextPageButton.disabled = showingAll || pageData.page >= pageData.totalPages;
}

export function resetPageAndRender() {
  setCurrentPage(1);
  render();
}

/* ===== ZALEŻNOŚCI ===== */
function getDependencyIssues(device) {
  const deps = device.dependencies || [];
  const issues = [];
  deps.forEach((depName) => {
    const depStatus = statuses[depName];
    if (depStatus && depStatus.online === false) {
      issues.push(depName);
    }
  });
  return issues;
}

/* ===== ULUBIONE ===== */
export function toggleFavorite(name) {
  if (currentFavorites.has(name)) {
    currentFavorites.delete(name);
  } else {
    currentFavorites.add(name);
  }
  saveFavorites(currentFavorites);
  render();
}

/* ===== WIERSZ TABELI ===== */
function row(device) {
  const status = statuses[device.name] || {};
  const stale = isStatusStale(status);
  const statusClass = status.checking ? "checking" : status.online === true ? "online" : status.online === false ? "offline" : "";
  const staleClass = stale ? " stale" : "";
  const statusText = status.checking
    ? "Sprawdzam"
    : status.online === true
      ? `Online${status.latencyMs ? ` ${status.latencyMs} ms` : ""}${stale ? " (stary)" : ""}`
      : status.online === false
        ? `Offline${stale ? " (stary)" : ""}`
        : "Nieznany";
  const target = pingTargetFor(device);
  const knownDhcpIp = status.resolvedIp || getResolvedIp(device.name);
  const ipText = device.ip || (knownDhcpIp ? `${knownDhcpIp} (DHCP)` : "DHCP / po nazwie");
  const modeText = device.addressMode === "static" ? "Stałe IP" : "DHCP";
  const expanded = expandedDevices.has(device.name);
  const isSelected = selectedDevices.has(device.name);
  const isFav = currentFavorites.has(device.name);
  const depIssues = getDependencyIssues(device);

  const mainRow = `
    <tr class="deviceRow" data-toggle="${escapeHtml(device.name)}">
      <td class="selectCell">
        <input type="checkbox" class="rowCheckbox" data-select="${escapeHtml(device.name)}" ${isSelected ? "checked" : ""}>
      </td>
      <td class="favCell">
        <button class="favButton ${isFav ? "active" : ""}" data-fav="${escapeHtml(device.name)}" title="${isFav ? "Usuń z ulubionych" : "Dodaj do ulubionych"}">${isFav ? "★" : "☆"}</button>
      </td>
      <td>
        <span class="expandArrow ${expanded ? "open" : ""}">▸</span>
        <span class="status ${statusClass}${staleClass}"><span class="dot"></span></span>
        <strong class="copyable">${escapeHtml(device.name)}</strong>
        ${depIssues.length > 0 ? `<span class="depWarnIcon" title="Zależność offline: ${escapeHtml(depIssues.join(", "))}">⚠</span>` : ""}
      </td>
      <td><code class="copyable">${escapeHtml(ipText)}</code></td>
      <td>${escapeHtml(device.area || "")}</td>
      <td class="rowActions">
        <button data-ping-target="${escapeHtml(target)}" data-ping-name="${escapeHtml(device.name)}">Ping</button>
      </td>
    </tr>
  `;

  if (!expanded) {
    return mainRow;
  }

  // Zawsze widoczne (nawet puste): Status, Typ, Adresowanie, IP, Lokacja
  const knownDhcpIpForDetails = status.resolvedIp || getResolvedIp(device.name);
  const ipDetailsText = device.ip || (knownDhcpIpForDetails ? `${knownDhcpIpForDetails} (DHCP)` : "DHCP / po nazwie");
  const locDetailsText = device.area || device.site || "";

  const detailFields = [
    ["Status", statusText],
    ["Typ", device.type || "inne"],
    ["Adresowanie", modeText],
    ["IP", ipDetailsText],
    ["Lokacja", locDetailsText],
  ];

  // Warunkowe — tylko jeśli wypełnione
  if (device.group) {
    detailFields.push(["Grupa / maszyna", device.group]);
  }

  if (device.type === "bizerba" && device.numerator) {
    detailFields.push(["Numerator", device.numerator]);
  }

  if (device.systemId) {
    detailFields.push(["System ID", device.systemId]);
  }

  if (device.vncUsername) {
    detailFields.push(["Użytkownik VNC", device.vncUsername]);
  }

  if (device.mac) {
    detailFields.push(["MAC", device.mac]);
  }
  if (device.netmask) {
    detailFields.push(["Maska", device.netmask]);
  }
  if (device.gateway) {
    detailFields.push(["Brama", device.gateway]);
  }
  if (device.dns) {
    detailFields.push(["DNS", device.dns]);
  }

  const depNames = (device.dependencies || []).join(", ");
  if (depNames) {
    detailFields.push(["Zależy od", depNames]);
  }

  if (depIssues.length > 0) {
    detailFields.push(["⚠ Zależność offline", depIssues.join(", ")]);
  }

  if (device.note) {
    detailFields.push(["Notatka", device.note]);
  }

  const keywordsHtml = (device.keywords || []).map((word) => `<span class="tag">${escapeHtml(word)}</span>`).join("");

  const relatedDevices = device.group
    ? devices.filter((other) => other.group === device.group && other.name !== device.name)
    : [];

  const relatedHtml = relatedDevices.length > 0 ? `
    <div class="relatedDevices">
      <span class="detailLabel">Powiązane urządzenia (${escapeHtml(device.group)})</span>
      <div class="relatedChips">
        ${relatedDevices.map((related) => `<button class="relatedChip" data-jump-to="${escapeHtml(related.name)}">${escapeHtml(related.name)}</button>`).join("")}
      </div>
    </div>
  ` : "";

  const detailRow = `
    <tr class="deviceDetail">
      <td colspan="6">
        <div class="detailActions">
          <button data-ssh="${escapeHtml(device.name)}">SSH</button>
          <button data-vnc="${escapeHtml(device.name)}">VNC</button>
          <a class="httpsButton" href="https://${escapeHtml(target)}" target="_blank" rel="noopener noreferrer">HTTPS</a>
          <button data-stats-device="${escapeHtml(device.name)}">📊 Statystyki</button>
          <button data-traceroute="${escapeHtml(device.name)}" data-traceroute-host="${escapeHtml(target)}">Traceroute</button>
          ${device.mac ? `<button data-wol="${escapeHtml(device.name)}">Wybudź (WOL)</button>` : ""}
          <button data-watchdog="${escapeHtml(device.name)}">Watchdog</button>
          <button data-edit="${escapeHtml(device.name)}">Edytuj</button>
        </div>
        ${relatedHtml}
        <div class="detailGrid">
          ${detailFields.map(([label, value]) => `
            <div class="detailItem">
              <span class="detailLabel">${escapeHtml(label)}</span>
              <span class="detailValue">${escapeHtml(value || "—")}</span>
            </div>
          `).join("")}
          ${(device.keywords || []).length > 0 ? `
            <div class="detailItem detailKeywords">
              <span class="detailLabel">Słowa kluczowe</span>
              <span class="detailValue">${keywordsHtml}</span>
            </div>
          ` : ""}
        </div>
      </td>
    </tr>
  `;

  return mainRow + detailRow;
}

/* ===== KARTA (WIDOK KART) ===== */
function card(device) {
  const status = statuses[device.name] || {};
  const stale = isStatusStale(status);
  const statusClass = status.checking ? "checking" : status.online === true ? "online" : status.online === false ? "offline" : "";
  const cardStatusClass = statusClass ? `status-${statusClass}` : "status-stale";
  const statusText = status.checking
    ? "Sprawdzam…"
    : status.online === true
      ? `Online${status.latencyMs ? ` · ${status.latencyMs} ms` : ""}${stale ? " (stary)" : ""}`
      : status.online === false
        ? `Offline${stale ? " (stary)" : ""}`
        : "Nieznany";
  const target = pingTargetFor(device);
  const knownDhcpIp = status.resolvedIp || getResolvedIp(device.name);
  const ipText = device.ip || (knownDhcpIp ? `${knownDhcpIp} (DHCP)` : "DHCP / po nazwie");
  const expanded = expandedDevices.has(device.name);
  const isSelected = selectedDevices.has(device.name);
  const isFav = currentFavorites.has(device.name);
  const depIssues = getDependencyIssues(device);
  const hasDepIssue = depIssues.length > 0;

  const tags = [
    device.type ? `<span class="cardTag">${escapeHtml(device.type)}</span>` : "",
    device.area ? `<span class="cardTag">${escapeHtml(device.area)}</span>` : "",
    device.group ? `<span class="cardTag">${escapeHtml(device.group)}</span>` : "",
  ].filter(Boolean).join("");

  let detailHtml = "";
  if (expanded) {
    const depList = (device.dependencies || []).map((n) => `<span class="cardTag">${escapeHtml(n)}</span>`).join("") || '<span class="muted">brak</span>';
    const relatedDevices = device.group ? devices.filter((o) => o.group === device.group && o.name !== device.name) : [];
    const relatedHtml = relatedDevices.length > 0
      ? `<div class="cardDetailRow"><span class="detailLabel">W grupie</span><span class="detailValue">${relatedDevices.map((r) => escapeHtml(r.name)).join(", ")}</span></div>`
      : "";

    const netRows = [];
    if (device.netmask) netRows.push(`<div class="cardDetailRow"><span class="detailLabel">Maska</span><span class="detailValue">${escapeHtml(device.netmask)}</span></div>`);
    if (device.gateway) netRows.push(`<div class="cardDetailRow"><span class="detailLabel">Brama</span><span class="detailValue">${escapeHtml(device.gateway)}</span></div>`);
    if (device.dns) netRows.push(`<div class="cardDetailRow"><span class="detailLabel">DNS</span><span class="detailValue">${escapeHtml(device.dns)}</span></div>`);

    const depRow = (device.dependencies || []).length > 0
      ? `<div class="cardDetailRow"><span class="detailLabel">Zależy od</span><span class="detailValue">${depList}</span></div>`
      : "";

    const sysIdRow = device.systemId
      ? `<div class="cardDetailRow"><span class="detailLabel">System ID</span><span class="detailValue">${escapeHtml(device.systemId)}</span></div>`
      : "";

    const vncUserRow = device.vncUsername
      ? `<div class="cardDetailRow"><span class="detailLabel">Użytkownik VNC</span><span class="detailValue">${escapeHtml(device.vncUsername)}</span></div>`
      : "";

    const groupRow = device.group
      ? `<div class="cardDetailRow"><span class="detailLabel">Grupa</span><span class="detailValue">${escapeHtml(device.group)}</span></div>`
      : "";

    detailHtml = `
      <div class="cardDetail">
        <div class="cardDetailRow"><span class="detailLabel">IP</span><span class="detailValue">${escapeHtml(ipText)}</span></div>
        <div class="cardDetailRow"><span class="detailLabel">Adresowanie</span><span class="detailValue">${device.addressMode === "static" ? "Stałe IP" : "DHCP"}</span></div>
        ${groupRow}
        ${sysIdRow}
        ${vncUserRow}
        ${netRows.join("")}
        ${depRow}
        ${relatedHtml}
        ${device.mac ? `<div class="cardDetailRow"><span class="detailLabel">MAC</span><span class="detailValue">${escapeHtml(device.mac)}</span></div>` : ""}
        ${device.note ? `<div class="cardDetailRow"><span class="detailLabel">Notatka</span><span class="detailValue">${escapeHtml(device.note)}</span></div>` : ""}
      </div>
    `;
  }

  return `
    <div class="deviceCard ${cardStatusClass} ${hasDepIssue ? "hasDepIssue" : ""}" data-card-toggle="${escapeHtml(device.name)}">
      <input type="checkbox" class="cardCheckbox" data-select="${escapeHtml(device.name)}" ${isSelected ? "checked" : ""}>
      <button class="cardFavButton ${isFav ? "active" : ""}" data-fav="${escapeHtml(device.name)}" title="${isFav ? "Usuń z ulubionych" : "Dodaj do ulubionych"}">${isFav ? "★" : "☆"}</button>
      <div class="cardHeader">
        <div>
          <div class="cardName copyable">${escapeHtml(device.name)}</div>
          <div class="cardHost copyable">${escapeHtml(ipText)}</div>
        </div>
        <span class="cardStatusDot"></span>
      </div>
      ${tags ? `<div class="cardTags">${tags}</div>` : ""}
      <div class="cardStatusLabel ${statusClass || "unknown"}">${escapeHtml(statusText)}</div>
      ${hasDepIssue ? `<div class="cardDepWarning">⚠ Zależność offline: ${depIssues.map((n) => escapeHtml(n)).join(", ")}</div>` : ""}
      <div class="cardActions">
        <button data-ping-target="${escapeHtml(target)}" data-ping-name="${escapeHtml(device.name)}">Ping</button>
        <button data-ssh="${escapeHtml(device.name)}">SSH</button>
        <button data-vnc="${escapeHtml(device.name)}">VNC</button>
        <button data-edit="${escapeHtml(device.name)}">Edytuj</button>
      </div>
      ${detailHtml}
    </div>
  `;
}

/* ===== PING WIDOCZNYCH ===== */
export async function pingAll() {
  const filtered = getFilteredDevices();
  if (filtered.length === 0) {
    alert("Brak urządzeń w aktualnym wyszukiwaniu.");
    return;
  }
  await pingDevicesConcurrently(filtered, 5);
}

/* ===== FORMULARZ ===== */
function readFormDevice() {
  const device = {
    name: deviceName.value.trim().toUpperCase(),
    ip: deviceIp.value.trim(),
    addressMode: deviceAddressMode.value,
    type: deviceType.value,
    area: deviceArea.value,
    group: deviceGroup.value,
    keywords: deviceKeywords.value.split(",").map((word) => word.trim()).filter(Boolean),
    note: deviceNote.value.trim(),
    systemId: deviceSystemId.value.trim(),
    vncUsername: deviceVncUsername.value.trim(),
    dependencies: [...currentDeps],
  };

  const macValue = deviceMac ? deviceMac.value.trim() : "";
  if (macValue) device.mac = macValue;

  const netmaskValue = deviceNetmask ? deviceNetmask.value.trim() : "";
  if (netmaskValue) device.netmask = netmaskValue;

  const gatewayValue = deviceGateway ? deviceGateway.value.trim() : "";
  if (gatewayValue) device.gateway = gatewayValue;

  const dnsValue = deviceDns ? deviceDns.value.trim() : "";
  if (dnsValue) device.dns = dnsValue;

  if (device.type === "bizerba") {
    device.numerator = deviceNumerator.value.trim();
  }

  return device;
}

export function submitForm(event) {
  event.preventDefault();
  const newDevice = readFormDevice();
  const oldName = editName.value;
  const duplicate = devices.some((device) => device.name === newDevice.name && device.name !== oldName);

  if (duplicate) {
    alert("Urządzenie o takiej nazwie już istnieje.");
    return;
  }

  if (newDevice.addressMode === "static" && !newDevice.ip) {
    alert("Stałe IP wymaga wpisania adresu IP.");
    deviceIp.focus();
    return;
  }

  const wasNew = !oldName;

  if (oldName) {
    setDevices(devices.map((device) => device.name === oldName ? newDevice : device));
  } else {
    setDevices([...devices, newDevice]);
  }

  markDirty();
  fillFilters();
  fillFormOptions();
  render();

  if (wasNew) {
    const keepArea = newDevice.area;
    clearForm();
    deviceArea.value = keepArea;
    editHint.textContent = `Dodano ${newDevice.name}. Kliknij "Zapisz zmiany" nad tabelą, aby zapisać plik.`;
    deviceName.focus();
  } else {
    editName.value = newDevice.name;
    deleteEditButton.classList.remove("hidden");
    editorTitle.textContent = `Edytuj ${newDevice.name}`;
    editHint.textContent = `Zmieniono ${newDevice.name}. Kliknij "Zapisz zmiany" nad tabelą, aby zapisać plik.`;
  }
}

export function editDevice(name) {
  const device = devices.find((item) => item.name === name);
  if (!device) return;

  import("./tabs.js").then((mod) => {
    if (typeof mod.setActiveTab === "function") {
      mod.setActiveTab("add", true);
    }
  });

  editName.value = device.name;
  deviceName.value = device.name;
  deviceIp.value = device.ip;
  deviceAddressMode.value = device.addressMode || (device.type === "bizerba" ? "static" : "dhcp");
  deviceType.value = device.type || "inne";
  deviceArea.value = device.area || config.areas[0] || "";
  deviceGroup.value = device.group || "";
  deviceKeywords.value = (device.keywords || []).join(", ");
  deviceNote.value = device.note || "";
  deviceSystemId.value = device.systemId || "";
  deviceVncUsername.value = device.vncUsername || "";
  deviceNumerator.value = device.numerator || "";
  if (deviceMac) deviceMac.value = device.mac || "";
  if (deviceNetmask) deviceNetmask.value = device.netmask || "";
  if (deviceGateway) deviceGateway.value = device.gateway || "";
  if (deviceDns) deviceDns.value = device.dns || "";
  currentDeps = new Set(device.dependencies || []);
  renderDepsPicker(device.name);
  toggleNumeratorField();
  editorTitle.textContent = `Edytuj ${device.name}`;
  editHint.textContent = `Edytujesz ${device.name}. Zapis do pliku wymaga hasła (przycisk "Zapisz zmiany" nad tabelą).`;
  deleteEditButton.classList.remove("hidden");
  deviceName.focus();
}

export function deleteEditedDevice() {
  const name = editName.value;
  if (!name) {
    alert("Najpierw wybierz urządzenie do edycji.");
    return;
  }

  if (!confirm(`Usunąć ${name}?`)) return;

  setDevices(devices.filter((device) => device.name !== name));
  markDirty();
  clearForm();
  saveDevices();
}

export function clearForm() {
  editName.value = "";
  deviceForm.reset();
  deviceAddressMode.value = "dhcp";
  deviceType.value = config.types[0] || "inne";
  deviceArea.value = config.areas[0] || "";
  deviceGroup.value = "";
  if (deviceMac) deviceMac.value = "";
  if (deviceNetmask) deviceNetmask.value = "";
  if (deviceGateway) deviceGateway.value = "";
  if (deviceDns) deviceDns.value = "";
  currentDeps = new Set();
  renderDepsPicker("");
  editorTitle.textContent = "Dodaj urządzenie";
  deleteEditButton.classList.add("hidden");
  editHint.textContent = "";
  toggleNumeratorField();
}

export function toggleNumeratorField() {
  const isBizerba = deviceType.value === "bizerba";
  numeratorField.classList.toggle("hidden", !isBizerba);
  if (!isBizerba) {
    deviceNumerator.value = "";
  }
}

/* ===== ZAPIS ===== */
export async function saveDevices() {
  const password = await getAdminPassword();
  if (!password) return;

  const response = await fetch("/api/devices", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Password": password,
    },
    body: JSON.stringify({ devices, version: devicesVersion }),
  });
  const result = await response.json();

  if (!response.ok) {
    if (response.status === 403) clearStoredPassword();
    if (response.status === 409) {
      addHistoryEntry("Konflikt zapisu — ktoś inny zapisał zmiany w międzyczasie.", "error");
      alert(result.error || "Ktoś inny zapisał zmiany w międzyczasie. Odśwież i wprowadź zmiany ponownie.");
      await loadDevices();
      return;
    }
    addHistoryEntry(result.error || "Nie udało się zapisać urządzeń.", "error");
    alert(result.error || "Nie udało się zapisać.");
    return;
  }

  setDevicesVersion(response.headers.get("X-Devices-Version") || devicesVersion);

  const configResponse = await fetch("/api/config", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Password": password,
    },
    body: JSON.stringify({ config }),
  });
  const configResult = await configResponse.json();
  if (!configResponse.ok) {
    if (configResponse.status === 403) clearStoredPassword();
    addHistoryEntry(configResult.error || "Urządzenia zapisane, ale nie udało się zapisać konfiguracji.", "error");
    alert(configResult.error || "Urządzenia zapisane, ale nie udało się zapisać typów i obszarów.");
    return;
  }

  await loadDevices();
  clearDirty();
  addHistoryEntry(`Zapisano ${result.count} urządzeń.`, "success");
  alert(`Zapisano ${result.count} urządzeń oraz typy i obszary.`);
}

/* ===== SŁOWNIKI ===== */
export function renderDictionaries() {
  const typeChipsEl = document.querySelector("#typeChips");
  const areaChipsEl = document.querySelector("#areaChips");
  const groupChipsEl = document.querySelector("#groupChips");

  if (typeChipsEl) typeChipsEl.innerHTML = config.types.map((type) => dictionaryChip(type, "type")).join("");
  if (areaChipsEl) areaChipsEl.innerHTML = config.areas.map((area) => dictionaryChip(area, "area")).join("");
  if (groupChipsEl) groupChipsEl.innerHTML = config.groups.map((group) => dictionaryChip(group, "group")).join("");
}

function dictionaryChip(value, kind) {
  return `<span class="dictChip">${escapeHtml(value)} <button type="button" data-remove-${kind}="${escapeHtml(value)}">×</button></span>`;
}

export function addDictionaryValue(kind) {
  const input = kind === "type" ? document.querySelector("#newTypeInput")
    : kind === "area" ? document.querySelector("#newAreaInput")
    : document.querySelector("#newGroupInput");
  const value = input.value.trim();
  if (!value) return;

  const key = kind === "type" ? "types" : kind === "area" ? "areas" : "groups";
  setConfig({ ...config, [key]: uniq([...config[key], value]) });
  input.value = "";
  markDirty();
  fillFilters();
  fillFormOptions();
  renderDictionaries();
  render();
}

export function removeDictionaryValue(kind, value) {
  const key = kind === "type" ? "types" : kind === "area" ? "areas" : "groups";
  const inUse = devices.some((device) => {
    if (kind === "type") return device.type === value;
    if (kind === "area") return device.area === value;
    return device.group === value;
  });
  if (inUse) {
    alert("Nie można usunąć pozycji używanej przez urządzenia.");
    return;
  }

  setConfig({ ...config, [key]: config[key].filter((item) => item !== value) });
  markDirty();
  fillFilters();
  fillFormOptions();
  renderDictionaries();
  render();
}

export function clearFilters() {
  searchInput.value = "";
  typeFilter.value = "";
  areaFilter.value = "";
  groupFilter.value = "";
  statusFilter.value = "";
  addressModeFilter.value = "";
  keywordFilter.value = "";
  if (favoritesOnlyFilter) favoritesOnlyFilter.checked = false;
  saveFavoritesOnlyFilter(false);
  sortSelect.value = "name";
  fillFilters();
  resetPageAndRender();
}

/* ===== JUMP DO URZĄDZENIA ===== */
export function jumpToDevice(name) {
  typeFilter.value = "";
  areaFilter.value = "";
  groupFilter.value = "";
  statusFilter.value = "";
  addressModeFilter.value = "";
  keywordFilter.value = "";
  searchInput.value = name;
  expandedDevices.add(name);
  resetPageAndRender();

  requestAnimationFrame(() => {
    let selector;
    try {
      selector = `[data-toggle="${CSS.escape(name)}"]`;
    } catch (error) {
      selector = null;
    }
    const targetRow = selector ? document.querySelector(selector) : null;
    if (targetRow) {
      targetRow.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  });
}

/* ===== ZALEŻNOŚCI (picker) ===== */
export function renderDepsPicker(currentDeviceName) {
  if (!depsList || !depsSelected) return;

  const filter = (depsFilterInput?.value || "").trim().toLowerCase();
  const candidates = devices
    .filter((d) => d.name !== currentDeviceName)
    .filter((d) => !filter || d.name.toLowerCase().includes(filter) || (d.area || "").toLowerCase().includes(filter))
    .sort((a, b) => compareText(a.name, b.name));

  depsList.innerHTML = candidates.map((d) => `
    <label class="depsListItem">
      <input type="checkbox" data-dep="${escapeHtml(d.name)}" ${currentDeps.has(d.name) ? "checked" : ""}>
      <span>${escapeHtml(d.name)}${d.area ? ` <span class="muted">(${escapeHtml(d.area)})</span>` : ""}</span>
    </label>
  `).join("");

  renderDepsSelected();
}

function renderDepsSelected() {
  if (!depsSelected) return;
  depsSelected.innerHTML = [...currentDeps].sort().map((name) => `
    <span class="depChip">${escapeHtml(name)} <button type="button" data-dep-remove="${escapeHtml(name)}">×</button></span>
  `).join("");
}

export function initDepsPickerHandlers() {
  if (depsFilterInput) {
    depsFilterInput.addEventListener("input", () => {
      const currentName = editName.value || "";
      renderDepsPicker(currentName);
    });
  }

  if (depsList) {
    depsList.addEventListener("change", (event) => {
      const name = event.target.dataset.dep;
      if (!name) return;
      if (event.target.checked) currentDeps.add(name);
      else currentDeps.delete(name);
      renderDepsSelected();
    });
  }

  if (depsSelected) {
    depsSelected.addEventListener("click", (event) => {
      const name = event.target.dataset.depRemove;
      if (!name) return;
      currentDeps.delete(name);
      renderDepsPicker(editName.value || "");
    });
  }
}

/* ===== WIDOK ===== */
export function initViewToggle() {
  currentViewMode = loadViewMode();
  updateViewToggleUI();

  if (viewTableButton) {
    viewTableButton.addEventListener("click", () => {
      currentViewMode = "table";
      saveViewMode("table");
      updateViewToggleUI();
      render();
    });
  }
  if (viewCardsButton) {
    viewCardsButton.addEventListener("click", () => {
      currentViewMode = "cards";
      saveViewMode("cards");
      updateViewToggleUI();
      render();
    });
  }
}

function updateViewToggleUI() {
  if (viewTableButton) viewTableButton.classList.toggle("active", currentViewMode === "table");
  if (viewCardsButton) viewCardsButton.classList.toggle("active", currentViewMode === "cards");
}

export function getViewMode() {
  return currentViewMode;
}

/* ===== ULUBIONE (init) ===== */
export function initFavorites() {
  if (favoritesOnlyFilter) {
    favoritesOnlyFilter.checked = loadFavoritesOnlyFilter();
    favoritesOnlyFilter.addEventListener("change", () => {
      saveFavoritesOnlyFilter(favoritesOnlyFilter.checked);
      resetPageAndRender();
    });
  }
}

/* ===== WOL ===== */
export async function sendWol(deviceName) {
  const device = devices.find((d) => d.name === deviceName);
  if (!device || !device.mac) {
    showToast("Brak adresu MAC dla tego urządzenia.", "error");
    return;
  }

  const password = await getAdminPassword();
  if (!password) return;

  const response = await fetch("/api/wol", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Admin-Password": password },
    body: JSON.stringify({ mac: device.mac }),
  });
  const result = await response.json();

  if (!response.ok) {
    if (response.status === 403) clearStoredPassword();
    showToast(result.error || "Nie udało się wysłać WOL.", "error", 6000);
    return;
  }
  showToast(result.message || "Wysłano magic packet.", "success");
}
