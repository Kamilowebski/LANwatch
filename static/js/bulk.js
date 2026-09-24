/* ============================================================
   bulk.js — akcje grupowe: zmiana obszaru/grupy/typu, usuwanie,
             bar nad tabelą, zaznaczanie (tabela + karty).
   ============================================================ */

import {
  devices, setDevices,
  config,
  selectedDevices, setSelectedDevices,
  bulkModeEnabled, setBulkModeEnabled,
  currentPageNames,
  bulkActionsBar, bulkCount,
  bulkAreaSelect, bulkAreaApply,
  bulkGroupSelect, bulkGroupApply,
  bulkTypeSelect, bulkTypeApply,
  bulkDeleteButton,
  bulkModeToggle,
  selectAllFilteredButton, clearSelectionButton,
  devicesTable,
  showToast, addHistoryEntry, markDirty,
  uniq, escapeHtml,
} from "./core.js";

import { saveBulkModePreference, loadBulkModePreference as loadBulkPref } from "./persist.js";

export function updateBulkBar() {
  if (!bulkModeEnabled) {
    bulkActionsBar.classList.add("hidden");
    return;
  }
  const count = selectedDevices.size;
  bulkActionsBar.classList.toggle("hidden", count === 0);
  if (count > 0) {
    bulkCount.textContent = `Zaznaczono: ${count}`;
    const areas = uniq([...config.areas, ...devices.map((device) => device.area)]);
    const groups = uniq([...config.groups, ...devices.map((device) => device.group)]);
    const types = uniq([...config.types, ...devices.map((device) => device.type)]);
    bulkAreaSelect.innerHTML = '<option value="">Zmień obszar na…</option>' +
      areas.map((area) => `<option value="${escapeHtml(area)}">${escapeHtml(area)}</option>`).join("");
    bulkGroupSelect.innerHTML = '<option value="">Zmień grupę na…</option><option value="__clear__">— usuń grupę —</option>' +
      groups.map((group) => `<option value="${escapeHtml(group)}">${escapeHtml(group)}</option>`).join("");
    bulkTypeSelect.innerHTML = '<option value="">Zmień typ na…</option>' +
      types.map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join("");
  }
}

async function applyBulkField(field, value) {
  if (selectedDevices.size === 0) return;
  const count = selectedDevices.size;
  setDevices(devices.map((device) => {
    if (!selectedDevices.has(device.name)) return device;
    return { ...device, [field]: value };
  }));
  markDirty();
  const mod = await import("./devices.js");
  mod.render();
  addHistoryEntry(`Akcja grupowa: zmieniono "${field}" na "${value || "(puste)"}" dla ${count} urządzeń.`, "info");
  await mod.saveDevices();
}

async function bulkDeleteSelected() {
  if (selectedDevices.size === 0) return;
  if (!confirm(`Usunąć ${selectedDevices.size} zaznaczonych urządzeń? Tej operacji nie da się cofnąć w panelu (ale kopia zapasowa istnieje od ostatniego startu programu).`)) {
    return;
  }
  const count = selectedDevices.size;
  setDevices(devices.filter((device) => !selectedDevices.has(device.name)));
  setSelectedDevices(new Set());
  markDirty();
  const mod = await import("./devices.js");
  mod.render();
  addHistoryEntry(`Akcja grupowa: usunięto ${count} urządzeń.`, "info");
  await mod.saveDevices();
}

export function applyBulkModeVisibility() {
  devicesTable.classList.toggle("hideSelectColumn", !bulkModeEnabled);
  const cardsEl = document.querySelector("#devicesCards");
  if (cardsEl) {
    cardsEl.classList.toggle("showCheckboxes", bulkModeEnabled);
  }
  if (!bulkModeEnabled) {
    setSelectedDevices(new Set());
  }
  updateBulkBar();
}

export function initBulkHandlers() {
  // Zaznaczanie pojedynczych wierszy / kafelków (delegacja change)
  document.addEventListener("change", (event) => {
    const selectName = event.target.dataset.select;
    if (selectName) {
      if (event.target.checked) selectedDevices.add(selectName);
      else selectedDevices.delete(selectName);
      updateBulkBar();
      return;
    }
  });

  // Zaznacz wszystkie na stronie
  const selectAllCheckbox = document.querySelector("#selectAllCheckbox");
  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener("change", async () => {
      if (selectAllCheckbox.checked) {
        currentPageNames.forEach((name) => selectedDevices.add(name));
      } else {
        currentPageNames.forEach((name) => selectedDevices.delete(name));
      }
      const mod = await import("./devices.js");
      mod.render();
    });
  }

  selectAllFilteredButton.addEventListener("click", async () => {
    const mod = await import("./devices.js");
    mod.getFilteredDevices().forEach((device) => selectedDevices.add(device.name));
    mod.render();
  });

  clearSelectionButton.addEventListener("click", async () => {
    setSelectedDevices(new Set());
    const mod = await import("./devices.js");
    mod.render();
  });

  bulkAreaApply.addEventListener("click", () => {
    const value = bulkAreaSelect.value;
    if (!value) { showToast("Wybierz obszar z listy.", "error"); return; }
    applyBulkField("area", value);
  });

  bulkGroupApply.addEventListener("click", () => {
    const value = bulkGroupSelect.value;
    if (!value) { showToast("Wybierz grupę z listy (albo „— usuń grupę —”).", "error"); return; }
    applyBulkField("group", value === "__clear__" ? "" : value);
  });

  bulkTypeApply.addEventListener("click", () => {
    const value = bulkTypeSelect.value;
    if (!value) { showToast("Wybierz typ z listy.", "error"); return; }
    applyBulkField("type", value);
  });

  bulkDeleteButton.addEventListener("click", bulkDeleteSelected);

  bulkModeToggle.addEventListener("change", async () => {
    setBulkModeEnabled(bulkModeToggle.checked);
    saveBulkModePreference(bulkModeEnabled);
    applyBulkModeVisibility();
    const mod = await import("./devices.js");
    mod.render();
  });

  // Wczytaj preferencję na starcie
  setBulkModeEnabled(loadBulkPref());
  bulkModeToggle.checked = bulkModeEnabled;
  applyBulkModeVisibility();
}
