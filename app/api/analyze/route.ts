export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import * as cheerio from "cheerio";

type Provider = "ollama" | "gemini";

function runRules($: cheerio.CheerioAPI) {
  const title = $("title").first().text().trim();
  const hasViewport = $('meta[name="viewport"]').length > 0;
  const forms = $("form").length;
  const inputs = $("input, select, textarea").length;
  const labels = $("label").length;
  const buttons = $("button, a[role=button], .btn, [data-testid*=button]").length;
  const primaryCtaGuess = $('button[type="submit"], button:contains("Sign in"), button:contains("Buy"), a.button')
    .first()
    .text()
    .trim();
  const hasInlineValidationHint = $('*[aria-invalid], .error, .error-message').length > 0;
  const hasProgress = $("progress, .step, [aria-current=step]").length > 0;

  return {
    title,
    hasViewport,
    forms,
    inputs,
    labels,
    buttons,
    primaryCtaGuess,
    hasInlineValidationHint,
    hasProgress,
  };
}

function buildPrompt(html: string, signals: ReturnType<typeof runRules>) {
  return `You are a UX auditor.
Analyse the provided page using the extracted signals and the raw HTML.
Return 5–10 actionable usability improvements in Markdown, grouped by High, Medium, and Low priority.
For each item include: Issue, Impact, Recommendation. Use concise British English.
Do not wrap the whole response in code fences.

### Extracted signals
- title: ${signals.title || "(none)"}
- hasViewport: ${signals.hasViewport}
- forms: ${signals.forms}, inputs: ${signals.inputs}, labels: ${signals.labels}
- buttons: ${signals.buttons}, primaryCtaGuess: "${signals.primaryCtaGuess || "(none)"}"
- hasInlineValidationHint: ${signals.hasInlineValidationHint}
- hasProgress: ${signals.hasProgress}

### Raw HTML (may be truncated)
${html.slice(0, 4000)}
`;
}

export async function POST(req: Request) {
  const {
    url,
    html,
    provider,
    key,
    model,
  }: { url?: string; html?: string; provider: Provider; key?: string; model?: string } = await req.json();

  let rawHtml = html || "";
  if (!rawHtml && url && /^https?:\/\//i.test(url)) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 UX-Audit-Demo" } });
      rawHtml = await r.text();
    } catch {}
  }
  if (!rawHtml) {
    return new Response(JSON.stringify({ error: "No URL/HTML provided." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const $ = cheerio.load(rawHtml);
  const signals = runRules($);
  const prompt = buildPrompt(rawHtml, signals);

  if (provider === "ollama") {
    let modelName = model || "deepseek-r1:14b";
    if (/^gpt-|^gemini/i.test(modelName)) modelName = "deepseek-r1:14b";

    const r = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelName, prompt, stream: true }),
    });

    const encoder = new TextEncoder();
    const transform = new TransformStream();
    const writer = transform.writable.getWriter();
    const reader = r.body!.getReader();
    const decoder = new TextDecoder();

    (async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n").filter(Boolean);
        for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            if (obj.response) {
              await writer.write(encoder.encode(JSON.stringify({ delta: obj.response }) + "\n"));
            }
          } catch {}
        }
      }
      await writer.close();
    })();

    return new Response(transform.readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
      },
    });
  }

  if (provider === "gemini") {
    const geminiKey = key || process.env.GOOGLE_API_KEY;
    if (!geminiKey) {
      return new Response(JSON.stringify({ error: "Missing Google API key." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model || "gemini-2.5-flash-lite"}:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      }
    );

    const textBody = await r.text();
    if (!r.ok) {
      return new Response(textBody, {
        status: r.status,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    let text = "";
    try {
      const data = JSON.parse(textBody);
      type GeminiPart = { text?: string };
      const parts: GeminiPart[] = data?.candidates?.[0]?.content?.parts ?? [];
      const text = parts.map((p) => (typeof p.text === "string" ? p.text : "")).join("");
    } catch {
      text = textBody;
    }

    return new Response(JSON.stringify({ delta: `[gemini ok]\n${text || "[empty text]"}` }) + "\n", {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return new Response(JSON.stringify({ error: "Unknown provider" }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
}
