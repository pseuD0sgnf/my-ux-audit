import { NextResponse } from "next/server";
import * as cheerio from "cheerio";

type Provider = "ollama" | "openai" | "gemini";

function runRules($: cheerio.CheerioAPI) {
  const title = $("title").first().text().trim();
  const hasViewport = $('meta[name="viewport"]').length > 0;
  const buttons = $("button, a[role=button]").length;
  const primaryCtaGuess = $('button[type="submit"], button:contains("Sign in"), button:contains("Buy"), a.button')
    .first()
    .text()
    .trim();
  const forms = $("form").length;
  const inputs = $("input, select, textarea").length;
  const hasInlineValidationHint = $('*[aria-invalid], .error, .error-message').length > 0;
  const hasProgress = $("progress, .step, [aria-current=step]").length > 0;
  const labels = $("label").length;

  return {
    title,
    hasViewport,
    buttons,
    primaryCtaGuess,
    forms,
    inputs,
    labels,
    hasInlineValidationHint,
    hasProgress,
  };
}

function buildPrompt(html: string, signals: ReturnType<typeof runRules>) {
  return `You are a UX auditor.

Analyse the provided page using the extracted signals and the raw HTML.
Return 5–10 actionable usability improvements in **Markdown**, grouped by **High**, **Medium**, **Low** priority.
For each item include: **Issue**, **Impact**, **Recommendation**. Use British English. Be concise.

### Extracted signals
- title: ${signals.title || "(none)"}
- hasViewport: ${signals.hasViewport}
- forms: ${signals.forms}, inputs: ${signals.inputs}, labels: ${signals.labels}
- buttons: ${signals.buttons}, primaryCtaGuess: "${signals.primaryCtaGuess || "(none)"}"
- hasInlineValidationHint: ${signals.hasInlineValidationHint}
- hasProgress: ${signals.hasProgress}

Do not wrap the whole response in code fences.

### Raw HTML (truncated if too long)
${html.slice(0, 4000)}
`;
}

export async function POST(req: Request) {
  const { url, html, provider }: { url?: string; html?: string; provider: Provider } = await req.json();

  let rawHtml = html || "";
  if (url && url.startsWith("http")) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 UX-Audit-Demo" } });
      rawHtml = await r.text();
    } catch (e) {
    }
  }
  if (!rawHtml) {
    return NextResponse.json({ error: "No URL/HTML provided." }, { status: 400 });
  }

  const $ = cheerio.load(rawHtml);
  const signals = runRules($);
  const prompt = buildPrompt(rawHtml, signals);

  if (provider === "ollama") {
    const r = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "deepseek-r1:14b",
        prompt,
        stream: true,
      }),
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

  if (provider === "openai") {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        stream: true,
      }),
    });

    const encoder = new TextEncoder();
    const transform = new TransformStream();
    const writer = transform.writable.getWriter();
    const reader = r.body!.getReader();
    const decoder = new TextDecoder();

    (async () => {
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";
        for (const evt of events) {
          if (!evt.startsWith("data:")) continue;
          const json = evt.slice(5).trim();
          if (json === "[DONE]") continue;
          try {
            const obj = JSON.parse(json);
            const delta = obj.choices?.[0]?.delta?.content;
            if (delta) await writer.write(encoder.encode(JSON.stringify({ delta }) + "\n"));
          } catch {}
        }
      }
      await writer.close();
    })();

    return new Response(transform.readable, {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Transfer-Encoding": "chunked" },
    });
  }

  if (provider === "gemini") {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:streamGenerateContent?key=${process.env.GOOGLE_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      }
    );

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
            const text = obj.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) await writer.write(encoder.encode(JSON.stringify({ delta: text }) + "\n"));
          } catch {}
        }
      }
      await writer.close();
    })();

    return new Response(transform.readable, {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Transfer-Encoding": "chunked" },
    });
  }

  return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
}
