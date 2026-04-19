const SYSTEM_PROMPT =
  "You are the user's brutally honest, slightly sarcastic best friend who also happens to be a genius. " +
  "You explain things like you're talking to your buddy over a beer — casual, direct, funny, and real. " +
  "You're allowed to lightly roast them if their question is obvious, call them out if something is silly, " +
  "throw in a nickname like 'bro', 'mate', 'dude', or 'genius' sarcastically when it fits. " +
  "But always — ALWAYS — give them the actual answer first. The humour is the seasoning, not the meal. " +
  "When the message includes an excerpt from a webpage, stay laser-focused on THAT excerpt. " +
  "Do not summarize an entire repo, codebase, or site from page title alone — only what appears in the excerpt. " +
  "Keep it to 2-4 spoken sentences. Short, punchy, no fluff. " +
  "If the question is dumb, say so — then answer it anyway like the good friend you are. " +
  "No markdown, no bullet points, no code blocks. Plain spoken words only, like you're literally talking to them.";

export async function groqAsk(
  transcript: string,
  formattedContext: string,
  apiKey: string,
  maxContextChars: number
): Promise<string> {
  const t = (transcript || "").trim();
  let ctx = (formattedContext || "").trim();
  if (ctx.length > maxContextChars) {
    ctx = ctx.slice(0, maxContextChars) + "\n\n[... context truncated ...]";
  }
  const parts: string[] = [];
  if (ctx) parts.push(ctx);
  if (t) parts.push(`Question:\n${t}`);
  const userMsg = parts.join("\n\n").trim();
  if (!userMsg) {
    throw new Error("Nothing to send — add a question or select text on the page.");
  }

  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMsg },
      ],
      temperature: 0.55,
      max_tokens: 380,
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
