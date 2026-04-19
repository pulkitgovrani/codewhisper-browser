import { groqAsk } from "./api/groq";
import { synthesizeSpeech, transcribeAudio } from "./api/elevenlabs";
import { loadSettings, trimSecret } from "./settings";
import type { PageContextPayload } from "./types";

function formatContextForGroq(ctx: PageContextPayload): string {
  const parts: string[] = [];
  if (ctx.pageTitle.trim()) parts.push(`Page title: ${ctx.pageTitle.trim()}`);
  if (ctx.contextBody.trim()) parts.push(`Text to discuss:\n${ctx.contextBody.trim()}`);
  return parts.join("\n\n");
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

interface PipelineVoice {
  type: "PIPELINE_VOICE";
  audioBase64: string;
  pageContext: PageContextPayload;
}

interface PipelineTyped {
  type: "PIPELINE_TYPED";
  question: string;
  pageContext: PageContextPayload;
}

type ExtMsg = PipelineVoice | PipelineTyped;

async function handlePipeline(msg: ExtMsg): Promise<Record<string, unknown>> {
  const s = await loadSettings();
  const groqKey = trimSecret(s.groqApiKey);
  const elKey = trimSecret(s.elevenLabsApiKey);
  const voiceId = trimSecret(s.elevenLabsVoiceId);

  if (!groqKey) {
    return { ok: false, error: "Set your Groq API key in PageWhisper options." };
  }
  if (!elKey || !voiceId) {
    return {
      ok: false,
      error: "Set ElevenLabs API key and voice ID in PageWhisper options.",
    };
  }

  let transcript = "";
  try {
    if (msg.type === "PIPELINE_VOICE") {
      const bytes = base64ToBytes(msg.audioBase64);
      transcript = await transcribeAudio(bytes, elKey);
    } else {
      transcript = msg.question.trim();
      if (!transcript) {
        return { ok: false, error: "Type a question first." };
      }
    }

    const contextStr = formatContextForGroq(msg.pageContext);
    const answer = await groqAsk(
      transcript,
      contextStr,
      groqKey,
      s.maxContextChars
    );
    const audioBuf = await synthesizeSpeech(answer, elKey, voiceId);
    return {
      ok: true,
      transcript,
      text: answer,
      audioBase64: bytesToBase64(audioBuf),
      contextChars: msg.pageContext.contextChars,
      truncated: msg.pageContext.truncated,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: message };
  }
}

chrome.runtime.onMessage.addListener(
  (request: unknown, _sender, sendResponse: (r: unknown) => void) => {
    const r = request as Record<string, unknown>;
    if (r.type === "GET_SETTINGS_SNAPSHOT") {
      void loadSettings().then((s) =>
        sendResponse({
          contextMode: s.contextMode,
          maxContextChars: s.maxContextChars,
        })
      );
      return true;
    }
    if (
      r.type === "PIPELINE_VOICE" &&
      typeof r.audioBase64 === "string" &&
      r.pageContext &&
      typeof r.pageContext === "object"
    ) {
      void handlePipeline({
        type: "PIPELINE_VOICE",
        audioBase64: r.audioBase64,
        pageContext: r.pageContext as PageContextPayload,
      }).then(sendResponse);
      return true;
    }
    if (
      r.type === "PIPELINE_TYPED" &&
      r.question != null &&
      r.pageContext &&
      typeof r.pageContext === "object"
    ) {
      void handlePipeline({
        type: "PIPELINE_TYPED",
        question: String(r.question),
        pageContext: r.pageContext as PageContextPayload,
      }).then(sendResponse);
      return true;
    }
    return false;
  }
);

chrome.commands.onCommand.addListener((command) => {
  if (command !== "open-panel") return;
  void chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab?.id) return;
    void chrome.tabs.sendMessage(tab.id, { type: "OPEN_PANEL" }).catch(() => {
      void chrome.notifications.create({
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon128.png"),
        title: "PageWhisper",
        message: "Reload this page and try again, or open a normal web page.",
      });
    });
  });
});
