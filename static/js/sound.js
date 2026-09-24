/* ============================================================
   sound.js — Web Audio API: beep przy awarii i powrocie maszyny.
   Zero importów, zero plików audio.
   ============================================================ */

let audioCtx = null;

export function ensureAudioContext() {
  if (audioCtx) return audioCtx;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  } catch (error) {
    return null;
  }
  return audioCtx;
}

// Przeglądarki wymagają gestu użytkownika, żeby odblokować dźwięk.
export function unlockAudioOnFirstClick() {
  document.addEventListener("click", () => {
    const ctx = ensureAudioContext();
    if (ctx && ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
  }, { once: true });
}

export function playBeep(frequency, durationMs, volume = 0.15) {
  const ctx = ensureAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.02);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + durationMs / 1000);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + durationMs / 1000 + 0.02);
  } catch (error) {
    /* ignore */
  }
}

export function playAlertBeep() {
  // awaria — niski ton, dwa krótkie
  playBeep(320, 180, 0.18);
  setTimeout(() => playBeep(240, 240, 0.18), 220);
}

export function playRecoveryBeep() {
  // powrót — wysoki ton, jeden krótki
  playBeep(880, 150, 0.14);
}
