"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { motion } from "framer-motion";

export default function Home() {
  const [url, setUrl] = useState("");
  const [htmlInput, setHtmlInput] = useState("");
  const [provider, setProvider] = useState("ollama");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState("");

  const outRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (outRef.current) outRef.current.scrollTop = outRef.current.scrollHeight;
  }, [result]);

  async function handleAnalyze() {
    if (!url && !htmlInput) return;
    setLoading(true);
    setResult("");

    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, html: htmlInput, provider }),
    });

    const reader = res.body?.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader!.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          if (obj.delta) setResult((prev) => prev + obj.delta);
        } catch {
          // ignore non-JSON lines
        }
      }
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center
                    bg-[linear-gradient(25deg,#ed67be,#f69ebd,#fccfbb,#fdffb7)]">

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
          <h1 className="text-3xl font-extrabold text-gray-900">
            AI UX Audit Tool
          </h1>
          <p className="text-gray-500">Analyse your webpage in seconds ✨</p>
        </div>

        <motion.div
          initial={{ scale: 0.97 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.25 }}
          className="space-y-4"
        >
          <input
            className="w-full p-3 border rounded-lg bg-white text-gray-900
                       placeholder-gray-400 focus:ring-2 focus:ring-pink-400 focus:outline-none"
            placeholder="Paste a page URL (preferred)…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <textarea
            className="w-full p-3 border rounded-lg bg-white text-gray-900
                       placeholder-gray-400 h-32 focus:ring-2 focus:ring-pink-400 focus:outline-none"
            placeholder="Or paste HTML here…"
            value={htmlInput}
            onChange={(e) => setHtmlInput(e.target.value)}
          />
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="w-full p-3 border rounded-lg bg-white text-gray-900
                       focus:ring-2 focus:ring-pink-400 focus:outline-none"
          >
            <option value="ollama">Ollama (local)</option>
            <option value="openai">OpenAI</option>
            <option value="gemini">Google Gemini</option>
          </select>

          <motion.button
            whileHover={{
              scale: 1.03,
              boxShadow: "0 0 24px rgba(253,255,183,0.85)",
              y: -1,
            }}
            whileTap={{ scale: 0.97 }}
            onClick={handleAnalyze}
            disabled={loading}
            className="w-full py-3 rounded-lg shadow-lg transition
                       bg-[linear-gradient(25deg,#ed67be,#f69ebd,#fccfbb,#fdffb7)]
                       disabled:opacity-60"
          >
            <span
              className="font-extrabold text-transparent bg-clip-text
                         bg-[linear-gradient(25deg,#7a1f5b,#c8458b,#e07f61,#9f8c08)]"
            >
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
              <ReactMarkdown
                components={{
                  h1: (p) => <h1 className="text-2xl font-bold mb-2 text-gray-900" {...p} />,
                  h2: (p) => <h2 className="text-xl font-semibold mt-4 mb-2 text-gray-900" {...p} />,
                  h3: (p) => <h3 className="text-lg font-semibold mt-3 mb-1 text-gray-900" {...p} />,
                  p:  (p) => <p className="mb-2 leading-relaxed text-gray-900" {...p} />,
                  ul: (p) => <ul className="list-disc list-inside space-y-1 text-gray-900" {...p} />,
                  ol: (p) => <ol className="list-decimal list-inside space-y-1 text-gray-900" {...p} />,
                  strong: (p) => <strong className="font-semibold text-gray-900" {...p} />,
                  em: (p) => <em className="italic text-gray-900" {...p} />,
                }}
              >
                {result}
              </ReactMarkdown>
            </div>
          </motion.div>
        )}


      </motion.div>
    </div>
  );
}
