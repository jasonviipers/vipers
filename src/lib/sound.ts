"use client";

import { loadTerminalSettings } from "./terminal-settings";

/**
 * Terminal sound engine: tiny synthesized WebAudio cues — no audio assets.
 * Gated by the /settings SOUND EFFECTS toggle; browsers require a user
 * gesture before audio may start, so the engine lazily unlocks itself on
 * the first play attempt after an interaction and stays silent otherwise.
 */

type Cue = "fill" | "fail" | "alert" | "click";

let ctx: AudioContext | null = null;
let unlocked = false;

function ensureContext(): AudioContext | null {
  if (typeof window === "undefined") {
    return null;
  }
  const AudioCtor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioCtor) {
    return null;
  }
  if (!ctx) {
    ctx = new AudioCtor();
  }
  return ctx;
}

function tone(
  context: AudioContext,
  freq: number,
  startOffset: number,
  duration: number,
  gain: number,
): void {
  const osc = context.createOscillator();
  const amp = context.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  amp.gain.setValueAtTime(0, context.currentTime + startOffset);
  amp.gain.linearRampToValueAtTime(
    gain,
    context.currentTime + startOffset + 0.01,
  );
  amp.gain.exponentialRampToValueAtTime(
    0.0001,
    context.currentTime + startOffset + duration,
  );
  osc.connect(amp).connect(context.destination);
  osc.start(context.currentTime + startOffset);
  osc.stop(context.currentTime + startOffset + duration + 0.05);
}

function playCue(cue: Cue): void {
  const context = ensureContext();
  if (!context) {
    return;
  }
  if (context.state === "suspended") {
    if (!unlocked) {
      // Autoplay policy: no user gesture yet — stay silent rather than
      // throwing or queueing unmuted audio.
      return;
    }
    void context.resume();
  }

  switch (cue) {
    case "fill":
      // Rising two-tone: position opened / order filled.
      tone(context, 660, 0, 0.09, 0.05);
      tone(context, 880, 0.1, 0.12, 0.05);
      break;
    case "fail":
      // Descending two-tone: order failed / risk rejection.
      tone(context, 330, 0, 0.12, 0.05);
      tone(context, 220, 0.13, 0.16, 0.05);
      break;
    case "alert":
      // Sharp double-ping: risk / heartbeat alerts.
      tone(context, 990, 0, 0.06, 0.04);
      tone(context, 990, 0.12, 0.06, 0.04);
      break;
    case "click":
      // Tiny tick: UI affordance.
      tone(context, 1320, 0, 0.03, 0.02);
      break;
  }
}

/** Public API: fire-and-forget cue playback; never throws. */
export function playSound(cue: Cue): void {
  try {
    if (typeof window === "undefined") {
      return;
    }
    if (!loadTerminalSettings().soundEnabled) {
      return;
    }
    // Any call site runs inside a user-gesture-driven render cycle or an
    // event handler; the first such call unlocks the context.
    const context = ensureContext();
    if (context && context.state === "running") {
      unlocked = true;
    }
    playCue(cue);
  } catch {
    // Sound is a nicety; never surface an audio failure.
  }
}

/**
 * Call once from a top-level user-gesture handler (e.g. the first click on
 * the terminal layout) so later event-driven cues can play.
 */
export function unlockAudio(): void {
  try {
    const context = ensureContext();
    if (context && context.state === "suspended") {
      void context.resume();
    }
    unlocked = true;
  } catch {
    // ignore
  }
}
