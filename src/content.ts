import type { ContextMode, PageContextPayload } from "./types";

const PANEL_HOST_ID = "pagewhisper-root";

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function gatherPageContext(
  mode: ContextMode,
  maxChars: number
): PageContextPayload {
  const sel = window.getSelection();
  let raw = (sel?.toString() ?? "").trim();

  if (mode === "selectionParagraph" && sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    let node: Node | null = range.commonAncestorContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
    const blocks = new Set([
      "P",
      "DIV",
      "ARTICLE",
      "SECTION",
      "LI",
      "BLOCKQUOTE",
      "TD",
      "TH",
      "MAIN",
      "ASIDE",
      "FIGCAPTION",
    ]);
    let el = node as HTMLElement | null;
    while (el && el !== document.body) {
      if (el.tagName && blocks.has(el.tagName)) {
        const t = el.innerText?.trim() ?? "";
        if (t.length > 0) {
          raw = t;
          break;
        }
      }
      el = el.parentElement;
    }
  }

  const truncated = raw.length > maxChars;
  const contextBody = raw.slice(0, maxChars);

  return {
    contextBody,
    pageTitle: document.title,
    pageUrl: location.href,
    contextChars: contextBody.length,
    truncated,
  };
}

function removePanel(): void {
  revokePlayback();
  document.getElementById(PANEL_HOST_ID)?.remove();
}

let playbackObjectUrl: string | null = null;
let currentPlaybackAudio: HTMLAudioElement | null = null;

function revokePlayback(): void {
  try {
    currentPlaybackAudio?.pause();
  } catch {
    /* ignore */
  }
  currentPlaybackAudio = null;
  if (playbackObjectUrl) {
    URL.revokeObjectURL(playbackObjectUrl);
    playbackObjectUrl = null;
  }
}

/**
 * Try to play TTS right after the pipeline returns. Often blocked by autoplay policy
 * unless the user taps "Play answer".
 */
function tryAutoplayMp3(
  b64: string,
  onStatus: (s: string) => void,
  onNeedUserTap: () => void
): void {
  revokePlayback();
  const bytes = base64ToBytes(b64);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy], { type: "audio/mpeg" });
  playbackObjectUrl = URL.createObjectURL(blob);
  const audio = new Audio(playbackObjectUrl);
  currentPlaybackAudio = audio;
  audio.addEventListener("ended", () => revokePlayback());
  audio.load();
  void audio
    .play()
    .then(() => {
      onStatus("Playing answer…");
    })
    .catch((err: unknown) => {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "AbortError") {
        onStatus(
          'Tap "Play answer" to hear (browser blocked automatic playback).'
        );
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        onStatus(`Could not start playback: ${msg}`);
      }
      onNeedUserTap();
    });
}

/** User clicked "Play answer" / "Replay" — fresh gesture, should succeed. */
function playMp3UserGesture(b64: string, onStatus: (s: string) => void): void {
  revokePlayback();
  const bytes = base64ToBytes(b64);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy], { type: "audio/mpeg" });
  playbackObjectUrl = URL.createObjectURL(blob);
  const audio = new Audio(playbackObjectUrl);
  currentPlaybackAudio = audio;
  audio.addEventListener("ended", () => revokePlayback());
  audio.load();
  void audio
    .play()
    .then(() => {
      onStatus("Playing answer…");
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      onStatus(`Playback failed: ${msg}`);
    });
}

function openPanel(): void {
  removePanel();

  const host = document.createElement("div");
  host.id = PANEL_HOST_ID;
  host.style.cssText = [
    "all:initial",
    "position:fixed",
    "right:16px",
    "bottom:16px",
    "z-index:2147483646",
    "font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif",
    "font-size:14px",
  ].join(";");

  const shadow = host.attachShadow({ mode: "open" });
  const wrap = document.createElement("div");
  wrap.innerHTML = `
<style>
  * { box-sizing: border-box; }
  .card {
    width: min(380px, calc(100vw - 32px));
    max-height: min(480px, calc(100vh - 32px));
    overflow: auto;
    background: #141418;
    color: #f4f4f5;
    border: 1px solid #27272a;
    border-radius: 12px;
    box-shadow: 0 12px 40px rgba(0,0,0,.45);
    padding: 14px 16px;
  }
  h2 { margin: 0 0 8px; font-size: 15px; font-weight: 600; }
  .muted { color: #a1a1aa; font-size: 12px; line-height: 1.4; margin-bottom: 10px; word-break: break-word; }
  .warn { color: #fbbf24; font-size: 12px; margin-bottom: 8px; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 10px; }
  button {
    background: #3f3f46;
    color: #fafafa;
    border: none;
    border-radius: 8px;
    padding: 8px 12px;
    cursor: pointer;
    font-size: 13px;
  }
  button:hover { background: #52525b; }
  button.primary { background: #6366f1; }
  button.primary:hover { background: #4f46e5; }
  button.danger { background: #7f1d1d; }
  textarea {
    width: 100%;
    min-height: 64px;
    border-radius: 8px;
    border: 1px solid #3f3f46;
    background: #18181b;
    color: #fafafa;
    padding: 8px;
    font: inherit;
    resize: vertical;
    margin-bottom: 8px;
  }
  .out { font-size: 13px; line-height: 1.45; white-space: pre-wrap; margin-top: 10px; padding-top: 10px; border-top: 1px solid #27272a; }
  .label { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #71717a; margin-bottom: 4px; }
  .x { margin-left: auto; background: transparent; color: #a1a1aa; font-size: 18px; line-height: 1; padding: 4px 8px; }
</style>
<div class="card">
  <div style="display:flex;align-items:flex-start;gap:8px">
    <h2>PageWhisper</h2>
    <button class="x" type="button" id="pw-close" aria-label="Close">×</button>
  </div>
  <div class="muted" id="pw-preview"></div>
  <div class="warn" id="pw-warn" hidden></div>
  <div class="row">
    <button type="button" class="primary" id="pw-mic">Record question</button>
    <button type="button" id="pw-typed-send">Ask (typed)</button>
  </div>
  <div class="row" id="pw-answer-actions" hidden>
    <button type="button" class="primary" id="pw-play">Play answer</button>
    <button type="button" id="pw-copy">Copy answer</button>
  </div>
  <div class="label">Or type your question</div>
  <textarea id="pw-q" placeholder="e.g. What does this paragraph mean?"></textarea>
  <div id="pw-status" class="muted"></div>
  <div class="out" id="pw-out" hidden></div>
</div>`;
  shadow.appendChild(wrap);

  void chrome.runtime.sendMessage({ type: "GET_SETTINGS_SNAPSHOT" }, (snap) => {
    const mode = (snap?.contextMode ?? "selectionParagraph") as ContextMode;
    const maxChars = Number(snap?.maxContextChars) || 8000;
    const ctx = gatherPageContext(mode, maxChars);

    const preview = shadow.getElementById("pw-preview");
    if (preview) {
      preview.textContent = `Context: ${ctx.contextChars} characters from “${ctx.pageTitle.slice(0, 80)}${ctx.pageTitle.length > 80 ? "…" : ""}”${ctx.truncated ? " (truncated to your max length)" : ""}`;
    }

    const warn = shadow.getElementById("pw-warn");
    if (warn && ctx.contextChars === 0) {
      warn.hidden = false;
      warn.textContent =
        "No text selected — select a passage on the page, then ask your question.";
    }

    const mic = shadow.getElementById("pw-mic") as HTMLButtonElement | null;
    const typedSend = shadow.getElementById("pw-typed-send") as HTMLButtonElement | null;
    const ta = shadow.getElementById("pw-q") as HTMLTextAreaElement | null;
    const status = shadow.getElementById("pw-status");
    const out = shadow.getElementById("pw-out");
    const answerActions = shadow.getElementById(
      "pw-answer-actions"
    ) as HTMLDivElement | null;
    const playBtn = shadow.getElementById("pw-play") as HTMLButtonElement | null;
    const copyBtn = shadow.getElementById("pw-copy") as HTMLButtonElement | null;

    let recording = false;
    let recorder: MediaRecorder | null = null;
    let chunks: Blob[] = [];
    let lastAudioB64: string | null = null;
    let lastAnswer = "";

    const setStatus = (t: string) => {
      if (status) status.textContent = t;
    };

    const showAnswerActions = () => {
      if (answerActions) answerActions.hidden = false;
    };

    const refreshContext = (): PageContextPayload =>
      gatherPageContext(mode, maxChars);

    const runTyped = () => {
      const question = ta?.value?.trim() ?? "";
      const pageContext = refreshContext();
      if (pageContext.contextChars === 0) {
        setStatus("Select text on the page first.");
        return;
      }
      if (!question) {
        setStatus("Type a question, or use Record.");
        return;
      }
      setStatus("Asking…");
      void chrome.runtime.sendMessage(
        {
          type: "PIPELINE_TYPED",
          question,
          pageContext,
        },
        (res: { ok?: boolean; error?: string; text?: string; audioBase64?: string; transcript?: string }) => {
          if (!res?.ok) {
            setStatus(res?.error ?? "Something went wrong.");
            return;
          }
          lastAudioB64 = res.audioBase64 ?? null;
          lastAnswer = res.text ?? "";
          if (out) {
            out.hidden = false;
            out.textContent = `You said: ${res.transcript ?? question}\n\nAnswer:\n${res.text ?? ""}`;
          }
          if (lastAudioB64) {
            showAnswerActions();
            tryAutoplayMp3(lastAudioB64, setStatus, () => {
              /* Play answer button already visible */
            });
          } else {
            setStatus("Done. (no audio returned)");
          }
        }
      );
    };

    typedSend?.addEventListener("click", runTyped);

    playBtn?.addEventListener("click", () => {
      if (lastAudioB64) playMp3UserGesture(lastAudioB64, setStatus);
    });

    copyBtn?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(lastAnswer);
        setStatus("Copied answer.");
      } catch {
        setStatus("Could not copy.");
      }
    });

    mic?.addEventListener("click", async () => {
      if (!window.isSecureContext) {
        setStatus("Microphone needs HTTPS on this site.");
        return;
      }
      if (recording && recorder) {
        recorder.stop();
        return;
      }
      const pageContext = refreshContext();
      if (pageContext.contextChars === 0) {
        setStatus("Select text on the page first.");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        chunks = [];
        recorder = new MediaRecorder(stream);
        recording = true;
        if (mic) mic.textContent = "Stop & send";
        setStatus("Recording… click again to stop.");
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };
        recorder.onstop = async () => {
          recording = false;
          stream.getTracks().forEach((t) => t.stop());
          if (mic) mic.textContent = "Record question";
          const blob = new Blob(chunks, { type: "audio/webm" });
          const buf = await blob.arrayBuffer();
          const u8 = new Uint8Array(buf);
          let binary = "";
          for (let i = 0; i < u8.length; i++) binary += String.fromCharCode(u8[i]);
          const audioBase64 = btoa(binary);
          setStatus("Transcribing and answering…");
          void chrome.runtime.sendMessage(
            { type: "PIPELINE_VOICE", audioBase64, pageContext },
            (res: { ok?: boolean; error?: string; text?: string; audioBase64?: string; transcript?: string }) => {
              if (!res?.ok) {
                setStatus(res?.error ?? "Something went wrong.");
                return;
              }
              lastAudioB64 = res.audioBase64 ?? null;
              lastAnswer = res.text ?? "";
              if (out) {
                out.hidden = false;
                out.textContent = `You said: ${res.transcript ?? ""}\n\nAnswer:\n${res.text ?? ""}`;
              }
              if (lastAudioB64) {
                showAnswerActions();
                tryAutoplayMp3(lastAudioB64, setStatus, () => {
                  /* Play answer visible */
                });
              } else {
                setStatus("Done. (no audio returned)");
              }
            }
          );
        };
        recorder.start();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setStatus(`Mic error: ${msg}`);
      }
    });
  });

  shadow.getElementById("pw-close")?.addEventListener("click", removePanel);
  document.documentElement.appendChild(host);
}

chrome.runtime.onMessage.addListener((msg: { type?: string }) => {
  if (msg?.type === "OPEN_PANEL") {
    openPanel();
    return;
  }
  return false;
});
