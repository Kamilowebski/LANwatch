/* ============================================================
   ping.js — pingi z tabeli głównej + persystencja statusów.
   ============================================================ */

import {
  devices,
  statuses,
  pingTargetFor,
  savePersistedStatuses,
  rememberResolvedIp,
} from "./core.js";

// Uwaga: render() jest w devices.js — dynamiczny import, żeby uniknąć cyklu.
async function safeRender() {
  const mod = await import("./devices.js");
  if (typeof mod.render === "function") {
    mod.render();
  }
}

export async function pingDevice(device) {
  const target = pingTargetFor(device);
  statuses[device.name] = { checking: true };
  await safeRender();

  try {
    const response = await fetch(`/api/ping?target=${encodeURIComponent(target)}`);
    const result = await response.json();
    statuses[device.name] = { ...result, savedAt: Date.now() };
    if (result.resolvedIp) {
      rememberResolvedIp(device.name, result.resolvedIp);
    }
  } catch (error) {
    statuses[device.name] = { online: false, error: error.message, savedAt: Date.now() };
  }

  savePersistedStatuses();
  await safeRender();
}

export async function pingTarget(target, name) {
  const device = devices.find((item) => item.name === name);
  const effectiveTarget = device ? pingTargetFor(device) : target;
  statuses[name] = { checking: true };
  await safeRender();

  try {
    const response = await fetch(`/api/ping?target=${encodeURIComponent(effectiveTarget)}`);
    const result = await response.json();
    statuses[name] = { ...result, savedAt: Date.now() };
    if (result.resolvedIp) {
      rememberResolvedIp(name, result.resolvedIp);
    }
  } catch (error) {
    statuses[name] = { online: false, error: error.message, savedAt: Date.now() };
  }

  savePersistedStatuses();
  await safeRender();
}

export async function pingDevicesConcurrently(deviceList, concurrency = 5) {
  let index = 0;

  async function worker() {
    while (index < deviceList.length) {
      const current = deviceList[index++];
      await pingDevice(current);
    }
  }

  const workerCount = Math.min(concurrency, deviceList.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}
