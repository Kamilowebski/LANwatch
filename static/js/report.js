/* ============================================================
   report.js — modal raportu: statystyki, wykres canvas, tabela pingów.
   ============================================================ */

import {
  watchdogReportModal,
  reportTitle,
  reportSubtitle,
  reportCloseButton,
  reportRangeButtons,
  reportStats,
  reportCanvas,
  reportTableBody,
  escapeHtml,
} from "./core.js";

import {
  getWatchdogHistory,
  getWatchdogWatched,
} from "./watchdog.js";

let reportDeviceName = null;
let reportRange = "all";

export function openReport(name) {
  reportDeviceName = name;
  reportRange = "all";
  watchdogReportModal.classList.remove("hidden");
  updateReportRangeButtons();
  renderReport();
}

export function closeReport() {
  watchdogReportModal.classList.add("hidden");
  reportDeviceName = null;
}

export function refreshReportIfOpen(name) {
  if (reportDeviceName === name && !watchdogReportModal.classList.contains("hidden")) {
    renderReport();
  }
}

function updateReportRangeButtons() {
  reportRangeButtons.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("active", button.dataset.range === reportRange);
  });
}

function getRangeCutoff(range) {
  const now = Date.now();
  if (range === "1h") return now - 3600 * 1000;
  if (range === "6h") return now - 6 * 3600 * 1000;
  if (range === "24h") return now - 24 * 3600 * 1000;
  return 0;
}

function getFilteredHistory(name, range) {
  const history = getWatchdogHistory(name);
  const cutoff = getRangeCutoff(range);
  if (!cutoff) return [...history];
  return history.filter((entry) => entry.t >= cutoff);
}

function computeStats(entries) {
  const total = entries.length;
  let online = 0;
  let offline = 0;
  let timeout = 0;
  const latencies = [];

  entries.forEach((entry) => {
    if (entry.status === "online") {
      online++;
      if (typeof entry.latencyMs === "number") latencies.push(entry.latencyMs);
    } else if (entry.status === "offline") {
      offline++;
    } else {
      timeout++;
    }
  });

  latencies.sort((a, b) => a - b);
  const avg = latencies.length > 0 ? Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length) : null;
  const min = latencies.length > 0 ? latencies[0] : null;
  const max = latencies.length > 0 ? latencies[latencies.length - 1] : null;
  const median = latencies.length > 0 ? latencies[Math.floor(latencies.length / 2)] : null;
  const loss = total > 0 ? ((offline + timeout) / total) * 100 : 0;

  return { total, online, offline, timeout, loss, avg, min, max, median };
}

function renderReport() {
  if (!reportDeviceName) return;

  const watched = getWatchdogWatched(reportDeviceName);
  if (!watched) {
    closeReport();
    return;
  }

  const entries = getFilteredHistory(reportDeviceName, reportRange);
  const stats = computeStats(entries);

  reportTitle.textContent = `Raport: ${reportDeviceName}`;
  reportSubtitle.textContent = `${watched.host} — ${watched.intervalMs} ms — ${entries.length} pingów w wybranym zakresie`;

  const lossClass = stats.loss > 5 ? "bad" : "good";
  reportStats.innerHTML = `
    <div class="reportStatCard"><span class="statLabel">Utrata pakietów</span><span class="statValue ${lossClass}">${stats.loss.toFixed(1)} %</span></div>
    <div class="reportStatCard"><span class="statLabel">Średnia</span><span class="statValue">${stats.avg != null ? stats.avg + " ms" : "—"}</span></div>
    <div class="reportStatCard"><span class="statLabel">Min</span><span class="statValue">${stats.min != null ? stats.min + " ms" : "—"}</span></div>
    <div class="reportStatCard"><span class="statLabel">Max</span><span class="statValue">${stats.max != null ? stats.max + " ms" : "—"}</span></div>
    <div class="reportStatCard"><span class="statLabel">Mediana</span><span class="statValue">${stats.median != null ? stats.median + " ms" : "—"}</span></div>
    <div class="reportStatCard"><span class="statLabel">Online / Offline / Brak</span><span class="statValue">${stats.online} / ${stats.offline} / ${stats.timeout}</span></div>
  `;

  drawReportChart(entries);

  const tableEntries = [...entries].reverse().slice(0, 500);
  if (tableEntries.length === 0) {
    reportTableBody.innerHTML = '<tr><td colspan="3" class="muted" style="text-align:center;padding:16px;">Brak danych w wybranym zakresie.</td></tr>';
    return;
  }

  reportTableBody.innerHTML = tableEntries.map((entry) => {
    const date = new Date(entry.t);
    const timeStr = date.toLocaleString("pl-PL", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    let statusLabel, statusClass, msText;
    if (entry.status === "online") {
      statusLabel = "Online"; statusClass = "online";
      msText = entry.latencyMs != null ? `${entry.latencyMs} ms` : "—";
    } else if (entry.status === "offline") {
      statusLabel = "Offline"; statusClass = "offline"; msText = "—";
    } else {
      statusLabel = "Brak odpowiedzi"; statusClass = "timeout"; msText = "—";
    }
    return `
      <tr>
        <td class="timeCell">${escapeHtml(timeStr)}</td>
        <td class="statusCell ${statusClass}">${escapeHtml(statusLabel)}</td>
        <td class="msCell">${escapeHtml(msText)}</td>
      </tr>
    `;
  }).join("");
}

function drawReportChart(entries) {
  if (!reportCanvas) return;
  const ctx = reportCanvas.getContext("2d");
  const w = reportCanvas.width;
  const h = reportCanvas.height;
  ctx.clearRect(0, 0, w, h);

  if (entries.length === 0) {
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--text-faint").trim() || "#90a0af";
    ctx.font = "14px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Brak danych w wybranym zakresie.", w / 2, h / 2);
    return;
  }

  const paddingLeft = 60, paddingRight = 20, paddingTop = 20, paddingBottom = 40;
  const chartWidth = w - paddingLeft - paddingRight;
  const chartHeight = h - paddingTop - paddingBottom;

  const minT = entries[0].t;
  const maxT = entries[entries.length - 1].t;
  const rangeT = Math.max(1, maxT - minT);

  let maxMs = 10;
  entries.forEach((entry) => {
    if (entry.status === "online" && typeof entry.latencyMs === "number" && entry.latencyMs > maxMs) {
      maxMs = entry.latencyMs;
    }
  });
  maxMs = Math.ceil(maxMs / 50) * 50;
  if (maxMs < 50) maxMs = 50;

  const onlineColor = getComputedStyle(document.documentElement).getPropertyValue("--status-online").trim() || "#158266";
  const offlineColor = getComputedStyle(document.documentElement).getPropertyValue("--status-offline").trim() || "#bd2f2f";
  const timeoutColor = getComputedStyle(document.documentElement).getPropertyValue("--status-checking").trim() || "#c98318";
  const labelColor = getComputedStyle(document.documentElement).getPropertyValue("--text-secondary").trim() || "#526170";
  const gridColor = getComputedStyle(document.documentElement).getPropertyValue("--border-color-light").trim() || "#edf1f5";

  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  ctx.font = "12px Arial";
  ctx.fillStyle = labelColor;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  const yTicks = 4;
  for (let i = 0; i <= yTicks; i++) {
    const value = (maxMs / yTicks) * i;
    const y = paddingTop + chartHeight - (i / yTicks) * chartHeight;
    ctx.beginPath();
    ctx.moveTo(paddingLeft, y);
    ctx.lineTo(paddingLeft + chartWidth, y);
    ctx.stroke();
    ctx.fillText(`${Math.round(value)} ms`, paddingLeft - 6, y);
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const xTicks = 4;
  for (let i = 0; i <= xTicks; i++) {
    const t = minT + (rangeT * i / xTicks);
    const x = paddingLeft + (i / xTicks) * chartWidth;
    const date = new Date(t);
    const label = date.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
    ctx.fillText(label, x, paddingTop + chartHeight + 6);
  }

  const barW = Math.min(30, Math.max(2, chartWidth / entries.length));

   // Margines po bokach wykresu, żeby pierwszy i ostatni słupek nie wchodziły na osie
  const innerLeft = paddingLeft + barW / 2;
  const innerRight = paddingLeft + chartWidth - barW / 2;
  const innerWidth = Math.max(1, innerRight - innerLeft);

  entries.forEach((entry, index) => {
    const x = innerLeft + (index / Math.max(1, entries.length - 1)) * innerWidth;
    const baseline = paddingTop + chartHeight;

    if (entry.status === "online" && typeof entry.latencyMs === "number") {
      const barH = Math.max(2, (entry.latencyMs / maxMs) * chartHeight);
      ctx.fillStyle = onlineColor;
      ctx.fillRect(x - barW / 2, baseline - barH, barW, barH);
    } else if (entry.status === "offline") {
      ctx.fillStyle = offlineColor;
      ctx.fillRect(x - barW / 2, baseline - 8, barW, 8);
    } else {
      ctx.fillStyle = timeoutColor;
      ctx.fillRect(x - barW / 2, baseline - 8, barW, 8);
    }
  });
}

export function initReportHandlers() {
  reportCloseButton.addEventListener("click", closeReport);

  watchdogReportModal.addEventListener("click", (event) => {
    if (event.target === watchdogReportModal) closeReport();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !watchdogReportModal.classList.contains("hidden")) {
      closeReport();
    }
  });

  reportRangeButtons.addEventListener("click", (event) => {
    const range = event.target.dataset.range;
    if (!range) return;
    reportRange = range;
    updateReportRangeButtons();
    renderReport();
  });

  window.addEventListener("resize", () => {
    if (reportDeviceName && !watchdogReportModal.classList.contains("hidden")) {
      renderReport();
    }
  });
}
