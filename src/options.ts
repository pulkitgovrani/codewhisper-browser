import { loadSettings } from "./settings";
import type { ContextMode } from "./types";
import { DEFAULT_SETTINGS } from "./types";

const groq = document.getElementById("groq") as HTMLInputElement | null;
const el = document.getElementById("el") as HTMLInputElement | null;
const voice = document.getElementById("voice") as HTMLInputElement | null;
const max = document.getElementById("max") as HTMLInputElement | null;
const mode = document.getElementById("mode") as HTMLSelectElement | null;
const saveBtn = document.getElementById("save");
const saved = document.getElementById("saved");

void loadSettings().then((s) => {
  if (groq) groq.value = s.groqApiKey;
  if (el) el.value = s.elevenLabsApiKey;
  if (voice) voice.value = s.elevenLabsVoiceId;
  if (max) max.value = String(s.maxContextChars ?? DEFAULT_SETTINGS.maxContextChars);
  if (mode) mode.value = s.contextMode;
});

saveBtn?.addEventListener("click", async () => {
  const maxChars = Math.min(
    50000,
    Math.max(500, parseInt(max?.value ?? "8000", 10) || 8000)
  );
  const ctxMode = (mode?.value === "selection" ? "selection" : "selectionParagraph") as ContextMode;

  await chrome.storage.local.set({
    groqApiKey: groq?.value?.trim() ?? "",
    elevenLabsApiKey: el?.value?.trim() ?? "",
    elevenLabsVoiceId: voice?.value?.trim() ?? "",
    maxContextChars: maxChars,
    contextMode: ctxMode,
  });

  if (saved) {
    saved.hidden = false;
    setTimeout(() => {
      saved.hidden = true;
    }, 2000);
  }
});
