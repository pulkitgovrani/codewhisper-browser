# PageWhisper (browser)

Voice or typed Q&A about **selected text** on web pages, using the same **Groq** + **ElevenLabs** stack as [CodeWhisper](../codewhisper) (no Python — calls are made from the extension service worker).

## Load unpacked (Chrome / Edge / Brave)

1. Run `npm install` and `npm run build`.
2. Open `chrome://extensions` → enable **Developer mode** → **Load unpacked** → choose the `dist` folder.

## Setup

1. Open the extension **Options** (right‑click the toolbar icon → Options, or from the popup).
2. Paste **Groq API key**, **ElevenLabs API key**, and **voice ID** (same idea as CodeWhisper’s settings).
3. On any **https** page, select text → toolbar **Open panel** (or **⌘⇧Y** / **Ctrl+Shift+Y**) → record a question or type it → listen to the answer.

If the answer text appears but you hear nothing, your browser likely blocked automatic playback — use **Play answer** in the panel (a tap counts as a user gesture).

Keys are stored in `chrome.storage.local` in your browser profile.

## Develop

- `npm run watch` — rebuild on change (reload the extension in `chrome://extensions` after each build).
