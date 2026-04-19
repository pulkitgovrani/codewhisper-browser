import type { PageWhisperSettings } from "./types";
import { DEFAULT_SETTINGS } from "./types";

const KEYS: (keyof PageWhisperSettings)[] = [
  "groqApiKey",
  "elevenLabsApiKey",
  "elevenLabsVoiceId",
  "maxContextChars",
  "contextMode",
];

export async function loadSettings(): Promise<PageWhisperSettings> {
  const raw = await chrome.storage.local.get(KEYS);
  return { ...DEFAULT_SETTINGS, ...raw } as PageWhisperSettings;
}

export function trimSecret(s: string | undefined): string {
  return typeof s === "string" ? s.trim() : "";
}
