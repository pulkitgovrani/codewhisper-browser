/** Match codewhisper backend: scribe_v2 + eleven_flash_v2_5 */

export async function transcribeAudio(
  audioBytes: Uint8Array,
  apiKey: string
): Promise<string> {
  const form = new FormData();
  form.append("model_id", "scribe_v2");
  const copy = new Uint8Array(audioBytes.byteLength);
  copy.set(audioBytes);
  form.append(
    "file",
    new Blob([copy], { type: "audio/webm" }),
    "audio.webm"
  );

  const resp = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`ElevenLabs STT ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await resp.json()) as { text?: string };
  const text = (data.text ?? "").trim();
  if (!text) throw new Error("No speech detected.");
  return text;
}

function looksLikeMp3Bytes(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 16) return false;
  const u8 = new Uint8Array(buf);
  if (u8[0] === 0x49 && u8[1] === 0x44 && u8[2] === 0x33) return true;
  if (u8[0] === 0xff && (u8[1] & 0xe0) === 0xe0) return true;
  return false;
}

export async function synthesizeSpeech(
  text: string,
  apiKey: string,
  voiceId: string
): Promise<ArrayBuffer> {
  const url = new URL(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`
  );
  url.searchParams.set("output_format", "mp3_44100_128");

  const resp = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_flash_v2_5",
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`ElevenLabs TTS ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const buf = await resp.arrayBuffer();
  if (buf.byteLength < 32) {
    throw new Error("ElevenLabs TTS returned an empty or invalid audio response.");
  }
  const head = new Uint8Array(buf)[0];
  if (head === 0x7b) {
    try {
      const payload = JSON.parse(new TextDecoder().decode(buf)) as {
        detail?: unknown;
      };
      throw new Error(
        `ElevenLabs TTS returned JSON instead of audio: ${JSON.stringify(payload.detail ?? payload).slice(0, 200)}`
      );
    } catch (e) {
      if (e instanceof SyntaxError) {
        throw new Error("ElevenLabs TTS response was not valid MP3 audio.");
      }
      throw e;
    }
  }
  if (!looksLikeMp3Bytes(buf)) {
    throw new Error(
      "ElevenLabs TTS response does not look like MP3 (unexpected format). Check voice ID and API key."
    );
  }

  return buf;
}
