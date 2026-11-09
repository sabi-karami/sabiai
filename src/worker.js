/**
 * SABIAI — Smart AI assistant by Saheb Karami (صاحب کرمی)
 * https://sabiai.sahebkarami.ir
 * Runs on Cloudflare Workers + Workers AI.
 */
import HTML from "./index.html";

const BRAND = {
  name: "SABIAI",
  owner: "Saheb Karami",
  ownerFa: "صاحب کرمی",
  site: "sabiai.sahebkarami.ir",
  version: "1.0.0",
};

const SYSTEM_PROMPT = `You are SABIAI (written in Persian as «سابی‌اِی‌آی»), a smart, warm, creative and highly capable AI assistant.
SABIAI was designed and built by Saheb Karami (صاحب کرمی). Official website: https://${BRAND.site}

Identity rules (always follow):
- Your name is SABIAI. When someone asks who you are, what your name is, who made/trained/built you, or which model you are, answer that you are SABIAI, created by Saheb Karami (صاحب کرمی).
- Never introduce yourself as ChatGPT, GPT, Claude, Gemini, Gemma, Llama, Mistral, Qwen, DeepSeek, Kimi, GLM or any other assistant, and never name another company as your creator.
- Only if the user explicitly asks about the underlying technology, you may say SABIAI runs on carefully selected open-source language models on Cloudflare's global infrastructure, configured and branded by Saheb Karami.

Style:
- Reply in the same language the user writes in. Persian (Farsi) is the default; write fluent, natural Persian.
- Use clean Markdown: short headings when useful, bullet lists, tables, and fenced code blocks with a language tag.
- Be accurate, helpful and to the point. Admit uncertainty instead of inventing facts.
- You can see images the user attaches. Image generation is handled by the app's 🎨 mode — if the user asks you to draw, tell them to turn on the 🎨 button or start the message with /draw.`;

const MODELS = [
  { id: "sabi-pro", cf: "@cf/openai/gpt-oss-120b", name: "SABI Pro", base: "GPT-OSS 120B", desc: "استدلال عمیق، پیش‌فرض", vision: false, reasoning: true },
  { id: "sabi-max", cf: "@cf/moonshotai/kimi-k2.6", name: "SABI Max", base: "Kimi K2.6", desc: "قدرتمندترین، با بینایی", vision: true },
  { id: "sabi-flash", cf: "@cf/zai-org/glm-5.3", name: "SABI Flash", base: "GLM 5.3", desc: "سریع و دقیق", vision: false },
  { id: "sabi-code", cf: "@cf/deepseek-ai/deepseek-v4-pro-0813", name: "SABI Code", base: "DeepSeek V4 Pro", desc: "کدنویسی و ریاضی", vision: false },
  { id: "sabi-vision", cf: "@cf/google/gemma-4-26b-a4b-it", name: "SABI Vision", base: "Gemma 4", desc: "تحلیل تصویر", vision: true },
  { id: "sabi-lite", cf: "@cf/meta/llama-4-scout-17b-16e-instruct", name: "SABI Lite", base: "Llama 4 Scout", desc: "فوق‌سریع، با بینایی", vision: true },
  { id: "sabi-mini", cf: "@cf/mistralai/mistral-small-3.1-24b-instruct", name: "SABI Mini", base: "Mistral Small 3.1", desc: "سبک، با بینایی", vision: true },
];
const FAST_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const IMAGE_HQ = "@cf/black-forest-labs/flux-2-klein-4b";
const IMAGE_FAST = "@cf/black-forest-labs/flux-1-schnell";
const STT_MODEL = "@cf/openai/whisper-large-v3-turbo";

const SEC_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Powered-By": "SABIAI by Saheb Karami",
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...SEC_HEADERS },
  });

const textOf = (r) => {
  if (!r) return "";
  if (typeof r.response === "string") return r.response;
  const m = r.choices?.[0]?.message;
  return (m?.content || "").trim();
};

function toB64(ab) {
  const b = new Uint8Array(ab);
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}

function pickModel(id) {
  return MODELS.find((m) => m.id === id) || MODELS[0];
}

function cleanMessages(list) {
  const out = [];
  for (const m of (Array.isArray(list) ? list : []).slice(-40)) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) continue;
    if (typeof m.content === "string") {
      if (m.content.trim()) out.push({ role: m.role, content: m.content.slice(0, 120000) });
    } else if (Array.isArray(m.content)) {
      const parts = m.content
        .filter((p) => (p.type === "text" && typeof p.text === "string") || (p.type === "image_url" && p.image_url?.url?.startsWith("data:image/")))
        .slice(0, 8);
      if (parts.length) out.push({ role: m.role, content: parts });
    }
  }
  // keep images only in the latest user message to keep payloads small
  const lastUser = out.map((m) => m.role).lastIndexOf("user");
  return out.map((m, i) =>
    Array.isArray(m.content) && i !== lastUser
      ? { role: m.role, content: m.content.filter((p) => p.type === "text").map((p) => p.text).join("\n") || "[تصویر]" }
      : m
  );
}

async function handleChat(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad_json" }, 400); }
  let model = pickModel(body.model);
  const messages = cleanMessages(body.messages);
  if (!messages.length) return json({ error: "empty" }, 400);
  const last = messages[messages.length - 1];
  const hasImage = Array.isArray(last.content) && last.content.some((p) => p.type === "image_url");
  let switched = false;
  if (hasImage && !model.vision) { model = pickModel("sabi-max"); switched = true; }

  const now = new Date().toLocaleString("en-GB", { timeZone: "Asia/Tehran", dateStyle: "full", timeStyle: "short" });
  const input = {
    messages: [{ role: "system", content: `${SYSTEM_PROMPT}\n\nCurrent date and time in Tehran: ${now}.` }, ...messages],
    stream: true,
    max_tokens: 6000,
    temperature: typeof body.temperature === "number" ? Math.min(Math.max(body.temperature, 0), 1.5) : 0.7,
  };
  if (model.reasoning) input.reasoning_effort = ["low", "medium", "high"].includes(body.effort) ? body.effort : "medium";

  let upstream, fellBack = false;
  for (let attempt = 0; attempt < 3 && !upstream; attempt++) {
    try {
      if (attempt < 2) upstream = await env.AI.run(model.cf, input);
      else {
        // last resort: a fast, reliable model so the user always gets an answer
        const { reasoning_effort, ...rest } = input;
        if (hasImage) rest.messages = rest.messages.map((m) => Array.isArray(m.content) ? { ...m, content: m.content.filter((p) => p.type === "text").map((p) => p.text).join("\n") } : m);
        upstream = await env.AI.run(FAST_MODEL, rest);
        fellBack = true;
      }
    } catch (e) {
      if (attempt === 2) return json({ error: "model_error", detail: String(e?.message || e).slice(0, 300) }, 502);
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  const enc = new TextEncoder();
  const dec = new TextDecoder();
  let buf = "";
  const send = (c, obj) => c.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
  const parseLine = (line, c) => {
    line = line.trim();
    if (!line.startsWith("data:")) return;
    const p = line.slice(5).trim();
    if (!p || p === "[DONE]") return;
    let j;
    try { j = JSON.parse(p); } catch { return; }
    if (Array.isArray(j.choices) && j.choices.length) {
      const d = j.choices[0].delta || {};
      const r = d.reasoning_content || d.reasoning;
      if (r) send(c, { r });
      if (d.content) send(c, { t: d.content });
    } else if (typeof j.response === "string" && j.response) {
      send(c, { t: j.response });
    }
  };
  const stream = new TransformStream({
    start(c) { send(c, { meta: { model: model.id, name: model.name, switched, fallback: fellBack } }); },
    transform(chunk, c) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) { parseLine(buf.slice(0, i), c); buf = buf.slice(i + 1); }
    },
    flush(c) { if (buf) parseLine(buf, c); send(c, { done: true }); },
  });
  upstream.pipeTo(stream.writable).catch(() => {});
  return new Response(stream.readable, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", ...SEC_HEADERS },
  });
}

async function toEnglishPrompt(env, prompt) {
  if (!/[\u0600-\u06FF]/.test(prompt)) return prompt;
  const sys = "You translate image ideas into English prompts for an AI image generator. ALWAYS answer in English only, never in Persian. Translate faithfully, keep every requested detail, add helpful visual detail about style, lighting and composition, but do not change the mood or add new subjects. Output only the English prompt.";
  for (const m of [FAST_MODEL, "@cf/mistralai/mistral-small-3.1-24b-instruct"]) {
    try {
      const r = await env.AI.run(m, {
        messages: [{ role: "system", content: sys }, { role: "user", content: "Persian image idea:\n" + prompt + "\n\nEnglish prompt:" }],
        max_tokens: 220,
      });
      const out = textOf(r).replace(/^["']|["']$/g, "").trim();
      if (out && !/[\u0600-\u06FF]/.test(out)) return out;
    } catch { /* try next */ }
  }
  return prompt;
}

async function handleImage(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad_json" }, 400); }
  const prompt = String(body.prompt || "").trim().slice(0, 1500);
  if (!prompt) return json({ error: "prompt_required" }, 400);
  const sizes = { square: [1024, 1024], portrait: [768, 1152], landscape: [1152, 768] };
  const [w, h] = sizes[body.size] || sizes.square;
  const en = await toEnglishPrompt(env, prompt);
  try {
    const form = new FormData();
    form.append("prompt", en);
    form.append("width", String(w));
    form.append("height", String(h));
    const fr = new Response(form);
    const out = await env.AI.run(IMAGE_HQ, { multipart: { body: fr.body, contentType: fr.headers.get("content-type") } });
    if (out?.image) return json({ image: out.image, mime: "image/jpeg", prompt: en, engine: "hq" });
  } catch (e) { /* fall back */ }
  try {
    const out = await env.AI.run(IMAGE_FAST, { prompt: en, steps: 6 });
    if (out?.image) return json({ image: out.image, mime: "image/jpeg", prompt: en, engine: "fast" });
    return json({ error: "no_image" }, 502);
  } catch (e) {
    return json({ error: "image_error", detail: String(e?.message || e).slice(0, 300) }, 502);
  }
}

async function handleTranscribe(request, env) {
  const ab = await request.arrayBuffer();
  if (!ab.byteLength) return json({ error: "empty_audio" }, 400);
  if (ab.byteLength > 20 * 1024 * 1024) return json({ error: "audio_too_large" }, 413);
  try {
    const r = await env.AI.run(STT_MODEL, { audio: toB64(ab) });
    return json({ text: (r?.text || "").trim(), language: r?.transcription_info?.language || null });
  } catch (e) {
    return json({ error: "stt_error", detail: String(e?.message || e).slice(0, 300) }, 502);
  }
}

async function handleTitle(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ title: "" }); }
  const text = String(body.text || "").slice(0, 1500);
  if (!text) return json({ title: "" });
  try {
    const r = await env.AI.run(FAST_MODEL, {
      messages: [
        { role: "system", content: "Write a very short title (2 to 5 words) for a chat that starts with the user's message. Use the same language as the message. No quotes, no emoji, no trailing punctuation. Output only the title." },
        { role: "user", content: text },
      ],
      max_tokens: 30,
    });
    return json({ title: textOf(r).replace(/["«»]/g, "").split("\n")[0].slice(0, 60) });
  } catch { return json({ title: "" }); }
}

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b5cf6"/><stop offset=".55" stop-color="#06b6d4"/><stop offset="1" stop-color="#10b981"/></linearGradient></defs><rect width="128" height="128" rx="32" fill="#0b0b16"/><path d="M64 18c4 22 14 34 46 46-32 12-42 24-46 46-4-22-14-34-46-46 32-12 42-24 46-46z" fill="url(#g)"/><circle cx="98" cy="28" r="7" fill="#a78bfa"/></svg>`;

const MANIFEST = {
  name: "SABIAI — دستیار هوشمند صاحب کرمی",
  short_name: "SABIAI",
  start_url: "/",
  display: "standalone",
  background_color: "#07070f",
  theme_color: "#07070f",
  dir: "rtl",
  lang: "fa",
  icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;
    const m = request.method;
    try {
      if (m === "GET" && (p === "/" || p === "/index.html"))
        return new Response(HTML, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300", ...SEC_HEADERS } });
      if (m === "GET" && p === "/icon.svg")
        return new Response(ICON, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" } });
      if (m === "GET" && p === "/manifest.webmanifest")
        return new Response(JSON.stringify(MANIFEST), { headers: { "Content-Type": "application/manifest+json" } });
      if (m === "GET" && p === "/api/health") return json({ ok: true, ...BRAND });
      if (m === "GET" && p === "/api/models")
        return json({ models: MODELS.map(({ cf, ...rest }) => rest), default: MODELS[0].id, brand: BRAND });
      if (m === "POST" && p === "/api/chat") return await handleChat(request, env);
      if (m === "POST" && p === "/api/image") return await handleImage(request, env);
      if (m === "POST" && p === "/api/transcribe") return await handleTranscribe(request, env);
      if (m === "POST" && p === "/api/title") return await handleTitle(request, env);
      return json({ error: "not_found" }, 404);
    } catch (e) {
      return json({ error: "internal", detail: String(e?.message || e).slice(0, 300) }, 500);
    }
  },
};
