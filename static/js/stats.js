/* ============================================================
   stats.js — modal statystyk: wybór dnia, wykresy, tabela.
   Dane pobierane z backendu (/api/stats?date=YYYY-MM-DD).
   ============================================================ */

import {
  statsModal, statsTitle, statsSubtitle, statsCloseButton,
  statsDateInput, statsPrevDayButton, statsNextDayButton, statsTodayButton,
  statsStatus, statsContent, statsEmpty,
  statsSummary, statsUptimeCanvas, statsLatencyCanvas, statsTableBody,
  statsDeviceModal, statsDeviceTitle, statsDeviceSubtitle,
  statsDeviceCloseButton, statsDeviceSummary, statsDeviceCanvas,
  statsDeviceTableBody,
  statsDeviceHourFrom, statsDeviceHourTo,
  statsDeviceHourApplyButton, statsDeviceHourResetButton, statsDeviceHourInfo,
  openStatsButton,
  escapeHtml, addHistoryEntry, showToast,
  statsDeviceDateInput, statsDevicePrevDayButton, statsDeviceNextDayButton, statsDeviceTodayButton,

} from "./core.js";

let currentDate = "";
let currentData = null;
let currentDeviceName = null;
let currentDeviceEntries = [];

/* ===== POMOCNICZE DATY ===== */
function todayStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function shiftDate(dateStr, deltaDays) {
  const parts = dateStr.split("-").map(Number);
  if (parts.length !== 3) return dateStr;
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  d.setDate(d.getDate() + deltaDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ===== OTWIERANIE / ZAMYKANIE ===== */
export function openStats() {
  currentDate = todayStr();
  statsDateInput.value = currentDate;
  statsModal.classList.remove("hidden");
  loadStats(currentDate);
}
export async function openStatsForDevice(name) {
  currentDate = todayStr();
  statsDateInput.value = currentDate;

  const data = await fetchStatsForDate(currentDate);

  if (!data || !data.devices || !data.devices[name]) {
    showToast(`Brak danych dla ${name} w dniu ${currentDate}.`, "error", 5000);
    return;
  }

  currentData = data;
  currentDeviceName = name;
  currentDeviceEntries = data.devices[name];

  if (statsDeviceDateInput) statsDeviceDateInput.value = currentDate;

  statsDeviceModal.classList.remove("hidden");

  if (statsDeviceHourFrom) statsDeviceHourFrom.value = 0;
  if (statsDeviceHourTo) statsDeviceHourTo.value = 23;

  applyDeviceHourFilter();
}

async function fetchStatsForDate(date) {
  try {
    const response = await fetch(`/api/stats?date=${encodeURIComponent(date)}`);
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    return null;
  }
}

async function changeDeviceDate(newDate) {
  if (!currentDeviceName) return;
  if (!newDate) return;

  currentDate = newDate;
  if (statsDeviceDateInput) statsDeviceDateInput.value = newDate;

  const data = await fetchStatsForDate(newDate);

  if (!data || !data.devices || !data.devices[currentDeviceName]) {
    currentData = data || { devices: {} };
    currentDeviceEntries = [];
    statsDeviceTitle.textContent = `Szczegóły: ${currentDeviceName}`;
    statsDeviceSubtitle.textContent = `${newDate} — brak danych`;
    statsDeviceSummary.innerHTML = '<div class="reportStatCard"><span class="statLabel">Brak danych</span><span class="statValue">—</span></div>';
    statsDeviceTableBody.innerHTML = '<tr><td colspan="3" class="muted" style="text-align:center;padding:16px;">Brak pingów w tym dniu.</td></tr>';
    if (statsDeviceHourInfo) statsDeviceHourInfo.textContent = "";
    clearCanvas(statsDeviceCanvas);
    return;
  }

  currentData = data;
  currentDeviceEntries = data.devices[currentDeviceName];
  applyDeviceHourFilter();
}

function closeStats() {
  statsModal.classList.add("hidden");
}

function openDeviceStats(name) {
  if (!currentData || !currentData.devices || !currentData.devices[name]) return;

  currentDeviceName = name;
  currentDeviceEntries = currentData.devices[name];

  statsDeviceModal.classList.remove("hidden");

  if (statsDeviceHourFrom) statsDeviceHourFrom.value = 0;
  if (statsDeviceHourTo) statsDeviceHourTo.value = 23;

  applyDeviceHourFilter();
}

function getFilteredDeviceEntries() {
  if (!currentDeviceEntries || currentDeviceEntries.length === 0) return [];

  const from = statsDeviceHourFrom ? Number(statsDeviceHourFrom.value) : 0;
  const to = statsDeviceHourTo ? Number(statsDeviceHourTo.value) : 23;
  const fromH = Math.max(0, Math.min(23, from));
  const toH = Math.max(0, Math.min(23, to));

  return currentDeviceEntries.filter((e) => {
    const h = new Date(e.t * 1000).getHours();
    if (fromH <= toH) {
      return h >= fromH && h <= toH;
    }
    // Zawijanie przez północ (np. 22-6)
    return h >= fromH || h <= toH;
  });
}

function applyDeviceHourFilter() {
  if (!currentDeviceName) return;

  const entries = getFilteredDeviceEntries();
  const from = statsDeviceHourFrom ? Number(statsDeviceHourFrom.value) : 0;
  const to = statsDeviceHourTo ? Number(statsDeviceHourTo.value) : 23;

  statsDeviceTitle.textContent = `Szczegóły: ${currentDeviceName}`;
  statsDeviceSubtitle.textContent = `${currentDate} — ${entries.length} pingów (${from}:00 – ${to}:59)`;

  if (statsDeviceHourInfo) {
    statsDeviceHourInfo.textContent = `Wyświetlono ${entries.length} z ${currentDeviceEntries.length} pingów`;
  }

  if (entries.length === 0) {
    statsDeviceSummary.innerHTML = '<div class="reportStatCard"><span class="statLabel">Brak danych</span><span class="statValue">—</span></div>';
    statsDeviceTableBody.innerHTML = '<tr><td colspan="3" class="muted" style="text-align:center;padding:16px;">Brak pingów w wybranym zakresie godzin.</td></tr>';
    clearCanvas(statsDeviceCanvas);
    return;
  }

  const stats = computeDeviceStats(entries);
  statsDeviceSummary.innerHTML = `
    <div class="reportStatCard"><span class="statLabel">Uptime</span><span class="statValue ${stats.loss > 5 ? "bad" : "good"}">${stats.uptime.toFixed(1)} %</span></div>
    <div class="reportStatCard"><span class="statLabel">Online</span><span class="statValue">${stats.online}</span></div>
    <div class="reportStatCard"><span class="statLabel">Offline</span><span class="statValue ${stats.offline > 0 ? "bad" : ""}">${stats.offline}</span></div>
    <div class="reportStatCard"><span class="statLabel">Średnia</span><span class="statValue">${stats.avg != null ? stats.avg + " ms" : "—"}</span></div>
    <div class="reportStatCard"><span class="statLabel">Min</span><span class="statValue">${stats.min != null ? stats.min + " ms" : "—"}</span></div>
    <div class="reportStatCard"><span class="statLabel">Max</span><span class="statValue">${stats.max != null ? stats.max + " ms" : "—"}</span></div>
  `;

  drawDeviceChart(entries);

  const reversed = [...entries].reverse();
  statsDeviceTableBody.innerHTML = reversed.map((e) => {
    const date = new Date(e.t * 1000);
    const time = date.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const statusLabel = e.online ? "Online" : "Offline";
    const statusClass = e.online ? "online" : "offline";
    const ms = e.online && e.ms != null ? `${e.ms} ms` : "—";
    return `
      <tr>
        <td class="timeCell">${escapeHtml(time)}</td>
        <td class="statusCell ${statusClass}">${statusLabel}</td>
        <td class="msCell">${escapeHtml(ms)}</td>
      </tr>
    `;
  }).join("");
}

function clearCanvas(canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = Math.max(300, Math.floor(rect.width || 1000));
  const cssHeight = 300;
  canvas.width = Math.floor(cssWidth * dpr);
  canvas.height = Math.floor(cssHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--text-faint").trim() || "#90a0af";
  ctx.font = "14px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Brak danych.", cssWidth / 2, cssHeight / 2);
}

function closeDeviceStats() {
  statsDeviceModal.classList.add("hidden");
  currentDeviceName = null;
  currentDeviceEntries = [];
}

/* ===== ŁADOWANIE DANYCH ===== */
async function loadStats(date) {
  statsStatus.textContent = "Ładowanie…";
  statsContent.classList.add("hidden");
  statsEmpty.classList.add("hidden");

  try {
    const response = await fetch(`/api/stats?date=${encodeURIComponent(date)}`);
    const data = await response.json();

    if (!response.ok) {
      statsStatus.textContent = data.error || "Nie udało się pobrać statystyk.";
      return;
    }

    currentData = data;

    if (!data.devices || Object.keys(data.devices).length === 0) {
      statsStatus.textContent = "";
      statsEmpty.classList.remove("hidden");
      return;
    }

    statsStatus.textContent = "";
    renderStats(data, date);
  } catch (error) {
    statsStatus.textContent = `Błąd: ${error.message}`;
  }
}

/* ===== OBLICZENIA ===== */
function computeDeviceStats(entries) {
  const total = entries.length;
  let online = 0;
  let offline = 0;
  const latencies = [];

  entries.forEach((e) => {
    if (e.online) {
      online++;
      if (typeof e.ms === "number") latencies.push(e.ms);
    } else {
      offline++;
    }
  });

  latencies.sort((a, b) => a - b);
  const avg = latencies.length > 0 ? Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length) : null;
  const min = latencies.length > 0 ? latencies[0] : null;
  const max = latencies.length > 0 ? latencies[latencies.length - 1] : null;
  const uptime = total > 0 ? (online / total) * 100 : 0;

  return { total, online, offline, avg, min, max, uptime, loss: 100 - uptime };
}

/* ===== RENDER ===== */
function renderStats(data, date) {
  const deviceNames = Object.keys(data.devices);

  let totalOnline = 0;
  let totalOffline = 0;
  let totalPings = 0;
  const allLatencies = [];
  const perDevice = [];

  deviceNames.forEach((name) => {
    const entries = data.devices[name] || [];
    const stats = computeDeviceStats(entries);
    perDevice.push({ name, stats });
    totalOnline += stats.online;
    totalOffline += stats.offline;
    totalPings += stats.total;
    entries.forEach((e) => {
      if (e.online && typeof e.ms === "number") allLatencies.push(e.ms);
    });
  });

  const globalUptime = totalPings > 0 ? (totalOnline / totalPings) * 100 : 0;
  const avgLatency = allLatencies.length > 0
    ? Math.round(allLatencies.reduce((s, v) => s + v, 0) / allLatencies.length)
    : null;

  statsTitle.textContent = `Statystyki — ${date}`;
  statsSubtitle.textContent = `${deviceNames.length} urządzeń, ${totalPings} pingów`;

  statsSummary.innerHTML = `
    <div class="reportStatCard"><span class="statLabel">Uptime globalny</span><span class="statValue ${globalUptime < 95 ? "bad" : "good"}">${globalUptime.toFixed(2)} %</span></div>
    <div class="reportStatCard"><span class="statLabel">Urządzenia</span><span class="statValue">${deviceNames.length}</span></div>
    <div class="reportStatCard"><span class="statLabel">Pingi razem</span><span class="statValue">${totalPings}</span></div>
    <div class="reportStatCard"><span class="statLabel">Online / Offline</span><span class="statValue">${totalOnline} / ${totalOffline}</span></div>
    <div class="reportStatCard"><span class="statLabel">Średnia ms</span><span class="statValue">${avgLatency != null ? avgLatency + " ms" : "—"}</span></div>
  `;

  // Sortuj od najgorszego uptime
  perDevice.sort((a, b) => a.stats.uptime - b.stats.uptime);

  statsContent.classList.remove("hidden");

  drawUptimeChart(perDevice);
  drawLatencyChart(data, deviceNames);
  renderStatsTable(perDevice);
}

function renderStatsTable(perDevice) {
  statsTableBody.innerHTML = perDevice.map(({ name, stats }) => {
    const uptimeClass = stats.uptime < 95 ? "bad" : (stats.uptime >= 99.5 ? "good" : "");
    return `
      <tr class="statsRow" data-stats-device="${escapeHtml(name)}">
        <td><strong>${escapeHtml(name)}</strong></td>
        <td>${stats.total}</td>
        <td>${stats.online}</td>
        <td>${stats.offline}</td>
        <td class="${uptimeClass}">${stats.uptime.toFixed(1)} %</td>
        <td>${stats.avg != null ? stats.avg + " ms" : "—"}</td>
        <td>${stats.min != null ? stats.min + " ms" : "—"}</td>
        <td>${stats.max != null ? stats.max + " ms" : "—"}</td>
      </tr>
    `;
  }).join("");
}

/* ===== WYKRESY ===== */
function drawUptimeChart(perDevice) {
  const canvas = statsUptimeCanvas;
  if (!canvas) return;

  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = Math.max(400, Math.floor(rect.width || 1200));
  const cssHeight = 400;

  canvas.width = Math.floor(cssWidth * dpr);
  canvas.height = Math.floor(cssHeight * dpr);

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const w = cssWidth;
  const h = cssHeight;
  ctx.clearRect(0, 0, w, h);

  const onlineColor = getComputedStyle(document.documentElement).getPropertyValue("--status-online").trim() || "#158266";
  const offlineColor = getComputedStyle(document.documentElement).getPropertyValue("--status-offline").trim() || "#bd2f2f";
  const warnColor = getComputedStyle(document.documentElement).getPropertyValue("--status-checking").trim() || "#c98318";
  const labelColor = getComputedStyle(document.documentElement).getPropertyValue("--text-secondary").trim() || "#526170";
  const gridColor = getComputedStyle(document.documentElement).getPropertyValue("--border-color-light").trim() || "#edf1f5";

  const paddingLeft = 60;
  const paddingRight = 20;
  const paddingTop = 20;
  const paddingBottom = 140;
  const chartWidth = w - paddingLeft - paddingRight;
  const chartHeight = h - paddingTop - paddingBottom;

  // Oś Y — 0..100%
  ctx.font = "12px Arial";
  ctx.fillStyle = labelColor;
  ctx.strokeStyle = gridColor;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  for (let i = 0; i <= 4; i++) {
    const value = (100 / 4) * i;
    const y = paddingTop + chartHeight - (i / 4) * chartHeight;
    ctx.beginPath();
    ctx.moveTo(paddingLeft, y);
    ctx.lineTo(paddingLeft + chartWidth, y);
    ctx.stroke();
    ctx.fillText(`${value}%`, paddingLeft - 6, y);
  }

  // Słupki — max 60 urządzeń pokazujemy, reszta grupowana jako "inne"
  const maxBars = 60;
  let bars = perDevice;
  if (bars.length > maxBars) {
    const worst = bars.slice(0, maxBars - 1);
    const rest = bars.slice(maxBars - 1);
    const restAvg = rest.reduce((s, d) => s + d.stats.uptime, 0) / rest.length;
    bars = [...worst, { name: `(+ ${rest.length} innych)`, stats: { uptime: restAvg } }];
  }

  const rawBarW = chartWidth / bars.length;
  const barW = Math.min(60, Math.max(6, rawBarW));
  const gap = Math.max(2, Math.min(8, barW * 0.2));
  const innerWidth = chartWidth - barW; // margines, żeby pierwszy i ostatni nie wchodziły na osie

  bars.forEach((item, i) => {
    const x = paddingLeft + barW / 2 + (i / Math.max(1, bars.length - 1)) * innerWidth - (barW - gap) / 2;
    const bw = barW - gap;
    const uptime = item.stats.uptime;
    const barH = Math.max(2, (uptime / 100) * chartHeight);
    const y = paddingTop + chartHeight - barH;

    let color = onlineColor;
    if (uptime < 95) color = offlineColor;
    else if (uptime < 99) color = warnColor;

    ctx.fillStyle = color;
    ctx.fillRect(x, y, bw, barH);

    // Procent nad słupkiem (tylko dla słupków szerszych niż 20 px)
    if (bw > 20) {
      ctx.fillStyle = labelColor;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.font = "10px Arial";
      ctx.save();
      ctx.translate(x + bw / 2, paddingTop + chartHeight - barH - 4);
      ctx.rotate(-Math.PI / 3);
      ctx.fillText(`${uptime.toFixed(1)}%`, 0, 0);
      ctx.restore();
    }
  });

  // Etykiety urządzeń pod wykresem — obrócone
  ctx.fillStyle = labelColor;
  ctx.font = "11px Arial";
  ctx.textAlign = "right";
  ctx.textBaseline = "top";

  bars.forEach((item, i) => {
    const x = paddingLeft + barW / 2 + (i / Math.max(1, bars.length - 1)) * innerWidth;
    const y = paddingTop + chartHeight + 8;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-Math.PI / 3);
    ctx.fillText(item.name, 0, 0);
    ctx.restore();
  });
}

function drawLatencyChart(data, deviceNames) {
  const canvas = statsLatencyCanvas;
  if (!canvas) return;

  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = Math.max(400, Math.floor(rect.width || 1200));
  const cssHeight = 300;

  canvas.width = Math.floor(cssWidth * dpr);
  canvas.height = Math.floor(cssHeight * dpr);

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const w = cssWidth;
  const h = cssHeight;
  ctx.clearRect(0, 0, w, h);

  // Zbierz wszystkie timestampy i uśrednij ms per timestamp
  const buckets = new Map();
  deviceNames.forEach((name) => {
    (data.devices[name] || []).forEach((e) => {
      if (!buckets.has(e.t)) buckets.set(e.t, []);
      if (e.online && typeof e.ms === "number") {
        buckets.get(e.t).push(e.ms);
      }
    });
  });

  const points = [...buckets.entries()]
    .map(([t, values]) => ({
      t,
      avg: values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : null,
    }))
    .sort((a, b) => a.t - b.t);

  if (points.length === 0) {
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--text-faint").trim() || "#90a0af";
    ctx.font = "14px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Brak danych.", w / 2, h / 2);
    return;
  }

  const paddingLeft = 60;
  const paddingRight = 20;
  const paddingTop = 20;
  const paddingBottom = 40;
  const chartWidth = w - paddingLeft - paddingRight;
  const chartHeight = h - paddingTop - paddingBottom;

  const minT = points[0].t;
  const maxT = points[points.length - 1].t;
  const rangeT = Math.max(1, maxT - minT);

  let maxMs = 10;
  points.forEach((p) => {
    if (p.avg != null && p.avg > maxMs) maxMs = p.avg;
  });
  maxMs = Math.ceil(maxMs / 50) * 50;
  if (maxMs < 50) maxMs = 50;

  const onlineColor = getComputedStyle(document.documentElement).getPropertyValue("--status-online").trim() || "#158266";
  const labelColor = getComputedStyle(document.documentElement).getPropertyValue("--text-secondary").trim() || "#526170";
  const gridColor = getComputedStyle(document.documentElement).getPropertyValue("--border-color-light").trim() || "#edf1f5";

  // Osie
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  ctx.font = "12px Arial";
  ctx.fillStyle = labelColor;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  for (let i = 0; i <= 4; i++) {
    const value = (maxMs / 4) * i;
    const y = paddingTop + chartHeight - (i / 4) * chartHeight;
    ctx.beginPath();
    ctx.moveTo(paddingLeft, y);
    ctx.lineTo(paddingLeft + chartWidth, y);
    ctx.stroke();
    ctx.fillText(`${Math.round(value)} ms`, paddingLeft - 6, y);
  }

  // Oś X — godziny
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const xTicks = 6;
  for (let i = 0; i <= xTicks; i++) {
    const t = minT + (rangeT * i / xTicks);
    const x = paddingLeft + (i / xTicks) * chartWidth;
    const date = new Date(t * 1000);
    const label = date.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
    ctx.fillText(label, x, paddingTop + chartHeight + 6);
  }

  // Linia
  ctx.strokeStyle = onlineColor;
  ctx.lineWidth = 2;
  ctx.beginPath();

  let started = false;
  points.forEach((p) => {
    if (p.avg == null) return;
    const x = paddingLeft + ((p.t - minT) / rangeT) * chartWidth;
    const y = paddingTop + chartHeight - (p.avg / maxMs) * chartHeight;
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.stroke();

  // Punkty
  ctx.fillStyle = onlineColor;
  points.forEach((p) => {
    if (p.avg == null) return;
    const x = paddingLeft + ((p.t - minT) / rangeT) * chartWidth;
    const y = paddingTop + chartHeight - (p.avg / maxMs) * chartHeight;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawDeviceChart(entries) {
  const canvas = statsDeviceCanvas;
  if (!canvas) return;

  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = Math.max(400, Math.floor(rect.width || 1200));
  const cssHeight = 300;

  canvas.width = Math.floor(cssWidth * dpr);
  canvas.height = Math.floor(cssHeight * dpr);

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const w = cssWidth;
  const h = cssHeight;
  ctx.clearRect(0, 0, w, h);

  if (entries.length === 0) return;

  const paddingLeft = 60;
  const paddingRight = 20;
  const paddingTop = 20;
  const paddingBottom = 40;
  const chartWidth = w - paddingLeft - paddingRight;
  const chartHeight = h - paddingTop - paddingBottom;

  const minT = entries[0].t;
  const maxT = entries[entries.length - 1].t;
  const rangeT = Math.max(1, maxT - minT);

  let maxMs = 10;
  entries.forEach((e) => {
    if (e.online && typeof e.ms === "number" && e.ms > maxMs) maxMs = e.ms;
  });
  maxMs = Math.ceil(maxMs / 50) * 50;
  if (maxMs < 50) maxMs = 50;

  const onlineColor = getComputedStyle(document.documentElement).getPropertyValue("--status-online").trim() || "#158266";
  const offlineColor = getComputedStyle(document.documentElement).getPropertyValue("--status-offline").trim() || "#bd2f2f";
  const labelColor = getComputedStyle(document.documentElement).getPropertyValue("--text-secondary").trim() || "#526170";
  const gridColor = getComputedStyle(document.documentElement).getPropertyValue("--border-color-light").trim() || "#edf1f5";

  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  ctx.font = "12px Arial";
  ctx.fillStyle = labelColor;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  for (let i = 0; i <= 4; i++) {
    const value = (maxMs / 4) * i;
    const y = paddingTop + chartHeight - (i / 4) * chartHeight;
    ctx.beginPath();
    ctx.moveTo(paddingLeft, y);
    ctx.lineTo(paddingLeft + chartWidth, y);
    ctx.stroke();
    ctx.fillText(`${Math.round(value)} ms`, paddingLeft - 6, y);
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const xTicks = 6;
  for (let i = 0; i <= xTicks; i++) {
    const t = minT + (rangeT * i / xTicks);
    const x = paddingLeft + (i / xTicks) * chartWidth;
    const date = new Date(t * 1000);
    const label = date.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
    ctx.fillText(label, x, paddingTop + chartHeight + 6);
  }

  const rawBarW = chartWidth / entries.length;
  const barW = Math.min(40, Math.max(2, rawBarW));
  const innerWidth = chartWidth - barW;

  entries.forEach((e, i) => {
    const x = paddingLeft + barW / 2 + (i / Math.max(1, entries.length - 1)) * innerWidth;
    const baseline = paddingTop + chartHeight;

    if (e.online && typeof e.ms === "number") {
      const barH = Math.max(2, (e.ms / maxMs) * chartHeight);
      ctx.fillStyle = onlineColor;
      ctx.fillRect(x - barW / 2, baseline - barH, barW, barH);
    } else {
      ctx.fillStyle = offlineColor;
      ctx.fillRect(x - barW / 2, baseline - 8, barW, 8);
    }
  });
}

/* ===== HANDLERY ===== */
export function initStatsHandlers() {
  if (openStatsButton) {
    openStatsButton.addEventListener("click", openStats);
  }
  if (statsCloseButton) {
    statsCloseButton.addEventListener("click", closeStats);
  }
  if (statsModal) {
    statsModal.addEventListener("click", (event) => {
      if (event.target === statsModal) closeStats();
    });
  }
  if (statsDeviceCloseButton) {
    statsDeviceCloseButton.addEventListener("click", closeDeviceStats);
  }
  if (statsDeviceModal) {
    statsDeviceModal.addEventListener("click", (event) => {
      if (event.target === statsDeviceModal) closeDeviceStats();
    });
  }

  if (statsDateInput) {
    statsDateInput.addEventListener("change", () => {
      currentDate = statsDateInput.value;
      if (currentDate) loadStats(currentDate);
    });
  }

  if (statsPrevDayButton) {
    statsPrevDayButton.addEventListener("click", () => {
      currentDate = shiftDate(currentDate, -1);
      statsDateInput.value = currentDate;
      loadStats(currentDate);
    });
  }

  if (statsNextDayButton) {
    statsNextDayButton.addEventListener("click", () => {
      currentDate = shiftDate(currentDate, 1);
      statsDateInput.value = currentDate;
      loadStats(currentDate);
    });
  }

  if (statsTodayButton) {
    statsTodayButton.addEventListener("click", () => {
      currentDate = todayStr();
      statsDateInput.value = currentDate;
      loadStats(currentDate);
    });
  }

  if (statsTableBody) {
    statsTableBody.addEventListener("click", (event) => {
      const row = event.target.closest(".statsRow");
      if (!row) return;
      const name = row.dataset.statsDevice;
      if (name) openDeviceStats(name);
    });
  }
  
   if (statsDeviceDateInput) {
    statsDeviceDateInput.addEventListener("change", () => {
      const value = statsDeviceDateInput.value;
      if (value && value !== currentDate) changeDeviceDate(value);
    });
  }

  if (statsDevicePrevDayButton) {
    statsDevicePrevDayButton.addEventListener("click", () => {
      const prev = shiftDate(currentDate, -1);
      changeDeviceDate(prev);
    });
  }

  if (statsDeviceNextDayButton) {
    statsDeviceNextDayButton.addEventListener("click", () => {
      const next = shiftDate(currentDate, 1);
      changeDeviceDate(next);
    });
  }

  if (statsDeviceTodayButton) {
    statsDeviceTodayButton.addEventListener("click", () => {
      changeDeviceDate(todayStr());
    });
  }
  
  if (statsDeviceHourApplyButton) {
    statsDeviceHourApplyButton.addEventListener("click", () => {
      applyDeviceHourFilter();
    });
  }

  if (statsDeviceHourResetButton) {
    statsDeviceHourResetButton.addEventListener("click", () => {
      if (statsDeviceHourFrom) statsDeviceHourFrom.value = 0;
      if (statsDeviceHourTo) statsDeviceHourTo.value = 23;
      applyDeviceHourFilter();
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (statsDeviceModal && !statsDeviceModal.classList.contains("hidden")) {
        closeDeviceStats();
      } else if (statsModal && !statsModal.classList.contains("hidden")) {
        closeStats();
      }
    }
  });

  // Przerysowanie przy zmianie rozmiaru
  window.addEventListener("resize", () => {
    if (statsModal && !statsModal.classList.contains("hidden") && currentData) {
      renderStats(currentData, currentDate);
    }
  });
}
