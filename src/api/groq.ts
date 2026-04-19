const SYSTEM_PROMPT =
  "You are the user's genius friend who happens to know everything — code, science, history, you name it. " +
  "When they ask you something, explain it like you're sitting next to them: direct, clear, and a little witty. " +
  "Keep it to 2-4 spoken sentences max. Lead with the actual answer, then maybe drop a quick analogy or a light observation if it fits naturally — don't force it. " +
  "10% humour, 90% signal. Never pad the response. If it's simple, say so simply. " +
  "No markdown, no bullet points, no code blocks — plain spoken words only.";

export async function groqAsk(
  transcript: string,
  contextBody: string,
  apiKey: string,
  maxContextChars: number
): Promise<string> {
  const t = (transcript || "").trim();
  const cb = (contextBody || "").trim();
  const parts: string[] = [];
  if (t) parts.push(t);
  if (cb) {
    let tb = cb.slice(0, maxContextChars);
    if (cb.length > maxContextChars) tb += "\n[... truncated ...]";
    parts.push(tb);
  }
  const userMsg = parts.join("\n\n");
  if (!userMsg.trim()) {
    throw new Error("Nothing to send — add a question or select text on the page.");
  }

  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMsg },
      ],
      temperature: 0.65,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Groq ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await resp.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) throw new Error("Empty answer from Groq.");
  return text;
}
