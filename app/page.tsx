"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { motion } from "framer-motion";

export default function Home() {
  const [url, setUrl] = useState("");
  const [htmlInput, setHtmlInput] = useState("");

  const [provider, setProvider] = useState("gemini");
  const [model, setModel] = useState("gemini-2.5-flash-lite");
  const [apiKey, setApiKey] = useState("");

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState("");
  const [statusText, setStatusText] = useState("");
  const [errorText, setErrorText] = useState("");

  const outRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (outRef.current) outRef.current.scrollTop = outRef.current.scrollHeight;
  }, [result]);

  useEffect(() => {
    if (provider === "gemini") setModel("gemini-2.5-flash-lite");
    else if (provider === "ollama") setModel("deepseek-r1:14b");
  }, [provider]);

  function stripCodeFences(s: string) {
    return s.replace(/```[a-zA-Z0-9_-]*\s?/g, "").replace(/```/g, "");
  }

  async function handleAnalyze() {
    if (!url && !htmlInput) return;
    setLoading(true);
    setResult("");
    setErrorText("");
    setStatusText("");

    try {
      const hasKey = provider !== "ollama" && !!apiKey;
      console.log("[analyze] provider:", provider, "model:", model, "hasKey:", hasKey);

      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, html: htmlInput, provider, key: apiKey, model }),
      });

      console.log("[analyze] response status:", res.status, res.statusText);
      setStatusText(`HTTP ${res.status} ${res.statusText}`);

      if (!res.ok) {
        const text = await res.text();
        console.error("[analyze] non-OK body:", text);
        let msg = text;
        try {
          const j = JSON.parse(text);
          msg = j.error || JSON.stringify(j);
        } catch {}
        setErrorText(msg);
        setLoading(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        console.warn("[analyze] no readable stream; fallback to text()");
        const text = await res.text();
        console.debug("[fallback text]:", text);
        try {
          const maybe = JSON.parse(text);
          if (maybe?.delta) {
            setResult(stripCodeFences(maybe.delta));
          } else {
            setResult(text || "[empty response body]");
          }
        } catch {
          setResult(text || "[empty response body]");
        }
        setLoading(false);
        return;
      }

      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        console.debug("[stream chunk]:", chunk);

        const lines = chunk.split("\n").filter(Boolean);
        for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            if (obj.delta) {
              const cleaned = stripCodeFences(obj.delta);
              setResult((prev) => prev + cleaned);
            } else {
              console.debug("[stream line no delta]:", line);
            }
          } catch {
            console.warn("[stream parse fail]:", line);
          }
        }
      }
    } catch (err: any) {
      console.error("[analyze] exception:", err);
      setErrorText(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[linear-gradient(25deg,#ed67be,#f69ebd,#fccfbb,#fdffb7)]">
      <motion.div
        initial={{ opacity: 0, y: 36 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="bg-white/90 backdrop-blur-md shadow-2xl rounded-2xl p-8 w-full max-w-3xl"
      >
        <div className="flex flex-col items-center mb-6">
          <motion.img
            src="/logo.png"
            alt="Logo"
            className="w-16 h-16 mb-2"
            animate={{ rotate: [0, 10, -10, 0] }}
            transition={{ repeat: Infinity, duration: 6, ease: "easeInOut" }}
          />
        <h1 className="text-3xl font-extrabold text-gray-900">AI UX Audit Tool</h1>
          <p className="text-gray-500">Analyse your webpage in seconds ✨</p>
        </div>

        <motion.div initial={{ scale: 0.97 }} animate={{ scale: 1 }} transition={{ duration: 0.25 }} className="space-y-4">
          <input
            className="w-full p-3 border rounded-lg bg-white text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-pink-400 focus:outline-none"
            placeholder="Paste a page URL (preferred)…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <textarea
            className="w-full p-3 border rounded-lg bg-white text-gray-900 placeholder-gray-400 h-32 focus:ring-2 focus:ring-pink-400 focus:outline-none"
            placeholder="Or paste HTML here…"
            value={htmlInput}
            onChange={(e) => setHtmlInput(e.target.value)}
          />

          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="w-full p-3 border rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-pink-400 focus:outline-none"
          >
            <option value="ollama">Ollama (local)</option>
            <option value="gemini">Google Gemini</option>
          </select>

          {provider !== "ollama" && (
            <>
              <input
                type="password"
                className="w-full p-3 border rounded-lg bg-white text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-pink-400 focus:outline-none"
                placeholder={`Paste your ${provider} API key here…`}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <input
                type="text"
                className="w-full p-3 border rounded-lg bg-white text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-pink-400 focus:outline-none"
                placeholder={`Enter ${provider} model name (default: ${provider === "gemini" ? "gemini-2.5-flash-lite" : ""})`}
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
            </>
          )}

          {statusText && <div className="mt-1 text-sm text-gray-600">Status: {statusText}</div>}
          {errorText && <div className="mt-2 p-3 rounded border border-red-300 bg-red-50 text-red-700 text-sm">{errorText}</div>}

          <motion.button
            whileHover={{ scale: 1.03, boxShadow: "0 0 24px rgba(253,255,183,0.85)", y: -1 }}
            whileTap={{ scale: 0.97 }}
            onClick={handleAnalyze}
            disabled={loading}
            className="w-full py-3 rounded-lg shadow-lg transition bg-[linear-gradient(25deg,#ed67be,#f69ebd,#fccfbb,#fdffb7)] disabled:opacity-60"
          >
            <span className="font-extrabold text-transparent bg-clip-text bg-[linear-gradient(25deg,#7a1f5b,#c8458b,#e07f61,#9f8c08)]">
              {loading ? "Analyzing…" : "Analyze"}
            </span>
          </motion.button>
        </motion.div>

        {result && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4 }}
            ref={outRef}
            className="mt-8 p-4 bg-white border rounded-lg max-h-80 overflow-y-auto text-gray-900"
          >
            <div className="prose max-w-none text-gray-900">
              <ReactMarkdown>{result}</ReactMarkdown>
            </div>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}
