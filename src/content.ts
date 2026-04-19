import type { ContextMode, PageContextPayload } from "./types";

const PANEL_HOST_ID = "pagewhisper-root";

let selectionChangeCleanup: (() => void) | null = null;

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Expand mode used to grab the first matching ancestor `DIV`/`TD`/`MAIN`, which on GitHub/code UIs is often
 * the whole file or repo body. We instead pick the *tightest* wrapper whose text still contains the highlight
 * and isn’t absurdly large.
 */
function expandSelectionToTightBlock(sel: Selection, selText: string, maxChars: number): string {
  if (!selText || !sel.rangeCount) return selText;
  const range = sel.getRangeAt(0);
  let node: Node | null = range.commonAncestorContainer;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;

  const TIGHT = new Set([
    "P",
    "LI",
    "BLOCKQUOTE",
    "FIGCAPTION",
    "DT",
    "DD",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "PRE",
    "CODE",
    "CAPTION",
    "TD",
    "TH",
  ]);
  const MID = new Set(["ARTICLE", "SECTION", "ASIDE"]);
  const LOOSE = new Set(["DIV", "MAIN", "NAV"]);

  const needle = selText.slice(0, Math.min(selText.length, 400));
  const MAX_BOX = Math.min(Math.max(maxChars * 4, 4000), 14_000);

  const candidates: HTMLElement[] = [];
  let el = node as HTMLElement | null;
  while (el && el !== document.body) {
    const tag = el.tagName;
    if (TIGHT.has(tag) || MID.has(tag) || LOOSE.has(tag)) {
      const t = el.innerText?.trim() ?? "";
      if (t.length >= selText.length && (needle.length === 0 || t.includes(needle))) {
        candidates.push(el);
      }
    }
    el = el.parentElement;
  }

  if (candidates.length === 0) return selText;

  let bestText = selText;
  let bestLen = Infinity;
  for (const c of candidates) {
    const t = c.innerText?.trim() ?? "";
    if (t.length > MAX_BOX) continue;
    if (t.length < selText.length) continue;
    if (t.length < bestLen) {
      bestLen = t.length;
      bestText = t;
    }
  }

  return bestLen === Infinity ? selText : bestText;
}

function gatherPageContext(
  mode: ContextMode,
  maxChars: number
): PageContextPayload {
  const sel = window.getSelection();
  let raw = (sel?.toString() ?? "").trim();

  if (mode === "selectionParagraph" && sel && sel.rangeCount > 0 && raw) {
    raw = expandSelectionToTightBlock(sel, raw, maxChars);
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

function contextModeShortLabel(mode: ContextMode): string {
  return mode === "selectionParagraph"
    ? "Expand: smallest block around highlight"
    : "Exact selection only";
}

/** Updates the “what we’re sending” preview from the live page selection. */
function renderContextPreview(
  shadow: ShadowRoot,
  mode: ContextMode,
  maxChars: number
): void {
  const ctx = gatherPageContext(mode, maxChars);
  const badge = shadow.getElementById("pw-mode-badge");
  const meta = shadow.getElementById("pw-context-meta");
  const snippet = shadow.getElementById("pw-snippet");
  const snippetLabel = shadow.getElementById("pw-snippet-label");
  const card = shadow.getElementById("pw-context-card");
  const warn = shadow.getElementById("pw-warn");

  if (badge) badge.textContent = contextModeShortLabel(mode);

  const titleShort =
    ctx.pageTitle.trim().slice(0, 72) + (ctx.pageTitle.length > 72 ? "…" : "");

  if (meta) {
    if (ctx.contextChars === 0) {
      meta.textContent = `Tab: “${titleShort || "Untitled"}” · No passage captured yet.`;
    } else {
      meta.textContent = `Tab: “${titleShort || "Untitled"}” · Sending ${ctx.contextChars.toLocaleString()} of ${maxChars.toLocaleString()} characters${ctx.truncated ? " (cut at your max)" : ""}.`;
    }
  }

  if (snippetLabel) {
    snippetLabel.hidden = ctx.contextChars === 0;
  }

  if (snippet) {
    const body = ctx.contextBody.replace(/\s+/g, " ").trim();
    if (!body) {
      snippet.hidden = true;
      snippet.textContent = "";
    } else {
      snippet.hidden = false;
      const limit = 320;
      snippet.textContent =
        body.length > limit ? `${body.slice(0, limit).trimEnd()}…` : body;
    }
  }

  if (card) {
    card.classList.toggle("context-empty", ctx.contextChars === 0);
  }

  if (warn) {
    if (ctx.contextChars === 0) {
      warn.hidden = false;
      warn.textContent =
        "Nothing highlighted — answers won’t use page text (fine for random questions). Drag to select a quote or paragraph first for grounded answers.";
    } else {
      warn.hidden = true;
    }
  }
}

function removePanel(): void {
  selectionChangeCleanup?.();
  selectionChangeCleanup = null;
  revokePlayback();
  document.getElementById(PANEL_HOST_ID)?.remove();
}

/** Web Audio path avoids Chromium blocking <audio src="blob:…"> in extension content scripts ("URL safety check"). */
let sharedAudioContext: AudioContext | null = null;
let playbackSourceNode: AudioBufferSourceNode | null = null;

function getAudioContextCtor(): typeof AudioContext {
  const w = window as Window & { webkitAudioContext?: typeof AudioContext };
  const Ctor = window.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) {
    throw new Error("Web Audio API not available in this context.");
  }
  return Ctor;
}

function getOrCreateAudioContext(): AudioContext {
  if (sharedAudioContext && sharedAudioContext.state !== "closed") {
    return sharedAudioContext;
  }
  const Ctor = getAudioContextCtor();
  sharedAudioContext = new Ctor();
  return sharedAudioContext;
}

function revokePlayback(): void {
  try {
    playbackSourceNode?.stop();
  } catch {
    /* already stopped */
  }
  try {
    playbackSourceNode?.disconnect();
  } catch {
    /* ignore */
  }
  playbackSourceNode = null;
}

function describeErr(err: unknown): string {
  if (err instanceof DOMException || err instanceof Error) {
    return err.name ? `${err.name}: ${err.message}` : err.message;
  }
  return String(err);
}

/**
 * Decode MP3 bytes and play via Web Audio (no blob: URLs — avoids MEDIA_ERR_SRC_NOT_SUPPORTED / URL safety check).
 */
async function playMp3WebAudio(
  mp3Bytes: Uint8Array,
  opts: {
    onStatus: (s: string) => void;
    expectUserGesture?: boolean;
    onAutoplayBlocked?: () => void;
  }
): Promise<void> {
  revokePlayback();
  let ctx: AudioContext;
  try {
    ctx = getOrCreateAudioContext();
  } catch (e) {
    opts.onStatus(`Playback failed: ${describeErr(e)}`);
    return;
  }

  try {
    await ctx.resume();
  } catch (e) {
    if (!opts.expectUserGesture) {
      opts.onAutoplayBlocked?.();
      return;
    }
    opts.onStatus(`Playback failed: ${describeErr(e)}`);
    return;
  }

  if (!opts.expectUserGesture && ctx.state !== "running") {
    opts.onAutoplayBlocked?.();
    return;
  }

  const ab = mp3Bytes.buffer.slice(
    mp3Bytes.byteOffset,
    mp3Bytes.byteOffset + mp3Bytes.byteLength
  );
  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await ctx.decodeAudioData(ab);
  } catch (e) {
    opts.onStatus(`Playback failed: ${describeErr(e)}`);
    console.warn("[PageWhisper] decodeAudioData failed", e);
    return;
  }

  const src = ctx.createBufferSource();
  src.buffer = audioBuffer;
  src.connect(ctx.destination);
  playbackSourceNode = src;
  src.onended = () => {
    playbackSourceNode = null;
  };
  try {
    src.start();
    opts.onStatus("Playing answer…");
  } catch (e) {
    playbackSourceNode = null;
    opts.onStatus(`Playback failed: ${describeErr(e)}`);
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
  const bytes = base64ToBytes(b64);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  void playMp3WebAudio(copy, {
    onStatus,
    expectUserGesture: false,
    onAutoplayBlocked: () => {
      onStatus(
        'Tap "Play answer" to hear (browser blocked automatic playback).'
      );
      onNeedUserTap();
    },
  });
}

/** User clicked "Play answer" / "Replay" — fresh gesture, should succeed. */
function playMp3UserGesture(b64: string, onStatus: (s: string) => void): void {
  const bytes = base64ToBytes(b64);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  void playMp3WebAudio(copy, {
    onStatus,
    expectUserGesture: true,
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
    width: min(420px, calc(100vw - 32px));
    max-height: min(580px, calc(100vh - 32px));
    overflow: auto;
    background: linear-gradient(160deg, #14141a 0%, #0c0c10 100%);
    color: #f4f4f5;
    border: 1px solid #31313d;
    border-radius: 18px;
    box-shadow: 0 20px 56px rgba(0,0,0,.65), 0 0 0 1px rgba(99,102,241,.12);
    padding: 14px 16px 16px;
  }
  .head-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin-bottom: 12px;
  }
  .mascot-img {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    flex-shrink: 0;
    box-shadow: 0 4px 14px rgba(99, 102, 241, 0.35);
    object-fit: contain;
    user-select: none;
    pointer-events: none;
  }
  .brand-text { flex: 1; min-width: 0; }
  .title {
    font-size: 17px;
    font-weight: 700;
    letter-spacing: -0.02em;
    margin: 0 0 4px;
    background: linear-gradient(90deg, #e4e4e7, #a5b4fc);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  .tagline {
    font-size: 12px;
    line-height: 1.35;
    color: #a1a1aa;
    margin: 0;
  }
  .context-card {
    background: rgba(24,24,27,.85);
    border: 1px solid #3f3f46;
    border-radius: 12px;
    padding: 10px 12px;
    margin-bottom: 12px;
  }
  .context-card.context-empty {
    border-color: rgba(251,191,36,.35);
    background: rgba(39,39,42,.65);
  }
  .context-top {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 6px;
  }
  .context-kicker {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .1em;
    color: #71717a;
  }
  .badge {
    font-size: 11px;
    font-weight: 600;
    color: #c7d2fe;
    background: rgba(99,102,241,.18);
    border: 1px solid rgba(99,102,241,.35);
    padding: 3px 8px;
    border-radius: 999px;
  }
  #pw-context-meta {
    font-size: 12px;
    line-height: 1.45;
    color: #d4d4d8;
    margin: 0 0 6px;
    word-break: break-word;
  }
  #pw-snippet-label {
    font-size: 11px;
    color: #71717a;
    margin: 0 0 4px;
  }
  #pw-snippet {
    margin: 0;
    padding: 8px 10px;
    border-left: 3px solid #6366f1;
    background: rgba(9,9,11,.55);
    border-radius: 0 8px 8px 0;
    font-size: 12px;
    line-height: 1.45;
    color: #e4e4e7;
    max-height: 112px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .refresh-ctx {
    margin-top: 8px;
    padding: 0;
    border: none;
    background: none;
    color: #a5b4fc;
    font-size: 12px;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .refresh-ctx:hover { color: #c7d2fe; }
  .muted { color: #a1a1aa; font-size: 12px; line-height: 1.4; word-break: break-word; }
  .warn {
    color: #fde68a;
    font-size: 12px;
    line-height: 1.45;
    margin: 0 0 10px;
    padding: 8px 10px;
    border-radius: 8px;
    background: rgba(251,191,36,.08);
    border: 1px solid rgba(251,191,36,.2);
  }
  button.btn {
    background: #3f3f46;
    color: #fafafa;
    border: none;
    border-radius: 8px;
    padding: 8px 12px;
    cursor: pointer;
    font-size: 13px;
    transition: background 0.15s, transform 0.1s;
  }
  button.btn:hover { background: #52525b; }
  button.btn:active { transform: scale(0.98); }
  button.primary { background: #6366f1; }
  button.primary:hover { background: #4f46e5; }
  #pw-mic {
    width: 100%;
    padding: 12px 16px;
    font-size: 14px;
    font-weight: 600;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }
  #pw-mic.recording {
    background: #dc2626;
    animation: pulse-ring 1.2s ease-in-out infinite;
  }
  @keyframes pulse-ring {
    0%   { box-shadow: 0 0 0 0 rgba(220,38,38,0.5); }
    60%  { box-shadow: 0 0 0 8px rgba(220,38,38,0); }
    100% { box-shadow: 0 0 0 0 rgba(220,38,38,0); }
  }
  .mic-row { margin-bottom: 10px; }
  .ask-row { display: flex; gap: 8px; }
  textarea {
    width: 100%;
    min-height: 60px;
    border-radius: 10px;
    border: 1px solid #3f3f46;
    background: #18181b;
    color: #fafafa;
    padding: 10px 10px;
    font: inherit;
    resize: vertical;
    margin-bottom: 4px;
    transition: border-color 0.15s;
  }
  textarea:focus { outline: none; border-color: #818cf8; }
  .hint { font-size: 11px; color: #71717a; margin: 0 0 8px; }
  .out {
    font-size: 13px;
    line-height: 1.55;
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid #2a2a35;
  }
  .transcript-line {
    color: #a1a1aa;
    font-size: 11px;
    margin-bottom: 8px;
  }
  .answer-block {
    color: #f4f4f5;
    font-size: 13.5px;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .answer-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
  .label { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #71717a; margin-bottom: 6px; }
  .x { margin-left: auto; background: transparent; color: #a1a1aa; font-size: 20px; line-height: 1; padding: 4px 8px; border-radius: 8px; }
  .x:hover { color: #fafafa; background: rgba(63,63,70,.5); }
</style>
<div class="card">
  <div class="head-row">
    <img class="mascot-img" id="pw-mascot-icon" src="" width="44" height="44" alt="" />
    <div class="brand-text">
      <h2 class="title">PageWhisper</h2>
      <p class="tagline">Sydney the owl read the tab so you don’t have to pretend you did.</p>
    </div>
    <button class="x" type="button" id="pw-close" aria-label="Close panel">×</button>
  </div>
  <div id="pw-context-card" class="context-card">
    <div class="context-top">
      <span class="context-kicker">Context for Groq</span>
      <span class="badge" id="pw-mode-badge"></span>
    </div>
    <p id="pw-context-meta"></p>
    <p id="pw-snippet-label" hidden>Preview of what we send:</p>
    <blockquote id="pw-snippet" hidden></blockquote>
    <button type="button" class="refresh-ctx" id="pw-refresh-ctx">↻ Refresh from page</button>
  </div>
  <div class="warn" id="pw-warn" hidden></div>
  <div class="mic-row">
    <button type="button" class="btn primary" id="pw-mic">🎙 Roast this page (voice)</button>
  </div>
  <div class="label">Or type</div>
  <textarea id="pw-q" placeholder="What’s this paragraph trying to say? Why should I care?"></textarea>
  <p class="hint">⌘/Ctrl + Enter to send · Change “context mode” in extension options</p>
  <div class="ask-row">
    <button type="button" class="btn primary" id="pw-typed-send" style="flex:1">Ask Sydney</button>
  </div>
  <div id="pw-status" class="muted" style="margin-top:8px;min-height:1.2em"></div>
  <div class="out" id="pw-out" hidden>
    <div class="transcript-line" id="pw-transcript"></div>
    <div class="answer-block" id="pw-answer"></div>
    <div class="answer-actions" id="pw-answer-actions" hidden>
      <button type="button" class="btn primary" id="pw-play">▶ Play</button>
      <button type="button" class="btn" id="pw-copy">Copy</button>
      <button type="button" class="btn" id="pw-replay" hidden>↺ Replay</button>
    </div>
  </div>
</div>`;
  shadow.appendChild(wrap);

  const mascotImg = shadow.getElementById("pw-mascot-icon") as HTMLImageElement | null;
  if (mascotImg && typeof chrome.runtime?.getURL === "function") {
    mascotImg.src = chrome.runtime.getURL("icons/icon48.png");
    mascotImg.alt = "Sydney — PageWhisper mascot";
    mascotImg.title = "Sydney — PageWhisper mascot";
  }

  void chrome.runtime.sendMessage({ type: "GET_SETTINGS_SNAPSHOT" }, (snap) => {
    const mode = (snap?.contextMode ?? "selectionParagraph") as ContextMode;
    const maxChars = Number(snap?.maxContextChars) || 8000;

    renderContextPreview(shadow, mode, maxChars);
    shadow.getElementById("pw-refresh-ctx")?.addEventListener("click", () => {
      renderContextPreview(shadow, mode, maxChars);
    });

    selectionChangeCleanup?.();
    let previewDebounce: ReturnType<typeof setTimeout> | null = null;
    const onDocSelectionChange = () => {
      if (!document.getElementById(PANEL_HOST_ID)) return;
      if (previewDebounce) clearTimeout(previewDebounce);
      previewDebounce = setTimeout(() => {
        renderContextPreview(shadow, mode, maxChars);
        previewDebounce = null;
      }, 100);
    };
    document.addEventListener("selectionchange", onDocSelectionChange);
    selectionChangeCleanup = () => {
      document.removeEventListener("selectionchange", onDocSelectionChange);
      if (previewDebounce) clearTimeout(previewDebounce);
    };

    const mic = shadow.getElementById("pw-mic") as HTMLButtonElement | null;
    const typedSend = shadow.getElementById("pw-typed-send") as HTMLButtonElement | null;
    const ta = shadow.getElementById("pw-q") as HTMLTextAreaElement | null;
    const status = shadow.getElementById("pw-status");
    const out = shadow.getElementById("pw-out");
    const answerActions = shadow.getElementById("pw-answer-actions") as HTMLDivElement | null;
    const transcriptEl = shadow.getElementById("pw-transcript");
    const answerEl = shadow.getElementById("pw-answer");
    const playBtn = shadow.getElementById("pw-play") as HTMLButtonElement | null;
    const replayBtn = shadow.getElementById("pw-replay") as HTMLButtonElement | null;
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

    const showAnswer = (transcript: string, text: string) => {
      if (out) out.hidden = false;
      if (transcriptEl) transcriptEl.textContent = `You asked: ${transcript}`;
      if (answerEl) answerEl.textContent = text;
      out?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    };

    const refreshContext = (): PageContextPayload =>
      gatherPageContext(mode, maxChars);

    const runTyped = () => {
      renderContextPreview(shadow, mode, maxChars);
      const question = ta?.value?.trim() ?? "";
      const pageContext = refreshContext();
      if (!question) {
        setStatus("Ask something — or tap voice and let Sydney eavesdrop.");
        return;
      }
      setStatus("Sydney’s thinking\u2026");
      void chrome.runtime.sendMessage(
        { type: "PIPELINE_TYPED", question, pageContext },
        (res: { ok?: boolean; error?: string; text?: string; audioBase64?: string; transcript?: string }) => {
          if (!res?.ok) {
            setStatus(res?.error ?? "Something went wrong.");
            return;
          }
          lastAudioB64 = res.audioBase64 ?? null;
          lastAnswer = res.text ?? "";
          showAnswer(res.transcript ?? question, lastAnswer);
          if (lastAudioB64) {
            showAnswerActions();
            tryAutoplayMp3(lastAudioB64, setStatus, () => { /* play button visible */ });
          } else {
            setStatus("Done — answer’s on screen (no audio this time).");
          }
        }
      );
    };

    typedSend?.addEventListener("click", runTyped);
    ta?.addEventListener("focus", () => {
      renderContextPreview(shadow, mode, maxChars);
    });
    ta?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) runTyped();
    });

    playBtn?.addEventListener("click", () => {
      if (lastAudioB64) {
        playMp3UserGesture(lastAudioB64, setStatus);
        if (replayBtn) replayBtn.hidden = false;
        if (playBtn) playBtn.hidden = true;
      }
    });

    replayBtn?.addEventListener("click", () => {
      if (lastAudioB64) playMp3UserGesture(lastAudioB64, setStatus);
    });

    copyBtn?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(lastAnswer);
        setStatus("Stolen fair and square — it’s on your clipboard.");
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
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        chunks = [];
        recorder = new MediaRecorder(stream);
        recording = true;
        if (mic) {
          mic.textContent = "⏹ Stop — send to Sydney";
          mic.classList.add("recording");
          mic.classList.remove("primary");
        }
        setStatus("Listening… cut Sydney off whenever.");
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };
        recorder.onstop = async () => {
          recording = false;
          stream.getTracks().forEach((t) => t.stop());
          renderContextPreview(shadow, mode, maxChars);
          const pageContext = gatherPageContext(mode, maxChars);
          if (mic) {
            mic.textContent = "🎙 Roast this page (voice)";
            mic.classList.remove("recording");
            mic.classList.add("primary");
          }
          const blob = new Blob(chunks, { type: "audio/webm" });
          const buf = await blob.arrayBuffer();
          const u8 = new Uint8Array(buf);
          let binary = "";
          for (let i = 0; i < u8.length; i++) binary += String.fromCharCode(u8[i]);
          const audioBase64 = btoa(binary);
          setStatus("Turning your rant into text\u2026");
          void chrome.runtime.sendMessage(
            { type: "PIPELINE_VOICE", audioBase64, pageContext },
            (res: { ok?: boolean; error?: string; text?: string; audioBase64?: string; transcript?: string }) => {
              if (!res?.ok) {
                setStatus(res?.error ?? "Something went wrong.");
                return;
              }
              lastAudioB64 = res.audioBase64 ?? null;
              lastAnswer = res.text ?? "";
              showAnswer(res.transcript ?? "", lastAnswer);
              if (lastAudioB64) {
                showAnswerActions();
                tryAutoplayMp3(lastAudioB64, setStatus, () => { /* play button visible */ });
              } else {
                setStatus("Done — answer’s on screen (no audio this time).");
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
