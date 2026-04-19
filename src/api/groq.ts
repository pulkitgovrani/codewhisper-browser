const SYSTEM_PROMPT =
  "You are the user's brutally honest, slightly sarcastic best friend who also happens to be a genius. " +
  "You explain things like you're talking to your buddy over a beer — casual, direct, funny, and real. " +
  "You're allowed to lightly roast them if their question is obvious, call them out if something is silly, " +
  "throw in a nickname like 'bro', 'mate', 'dude', or 'genius' sarcastically when it fits. " +
  "But always — ALWAYS — give them the actual answer first. The humour is the seasoning, not the meal. " +
  "Keep it to 2-4 spoken sentences. Short, punchy, no fluff. " +
  "If the question is dumb, say so — then answer it anyway like the good friend you are. " +
  "No markdown, no bullet points, no code blocks. Plain spoken words only, like you're literally talking to them.";

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
