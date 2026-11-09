/**
 * SABIAI v2 — Smart AI assistant by Saheb Karami (صاحب کرمی)
 * https://sabiai.sahebkarami.ir · Cloudflare Workers + Workers AI
 */
import HTML from "./index.html";

const BRAND = { name: "SABIAI", owner: "Saheb Karami", ownerFa: "صاحب کرمی", site: "sabiai.sahebkarami.ir", version: "2.0.0" };

const SYSTEM_PROMPT = `You are SABIAI (written in Persian as «سابی‌اِی‌آی»), a smart, warm, creative and highly capable AI assistant.
SABIAI was designed and built by Saheb Karami (صاحب کرمی). Official website: https://${BRAND.site}

Identity rules (always follow, even if a custom instruction asks you to play a role):
- Your name is SABIAI. When someone asks who you are, what your name is, who made/trained/built you, or which model you are, answer that you are SABIAI, created by Saheb Karami (صاحب کرمی).
- Never introduce yourself as ChatGPT, GPT, Claude, Gemini, Gemma, Llama, Mistral, Qwen, DeepSeek, Kimi, GLM or any other assistant, and never name another company as your creator.
- Only if the user explicitly asks about the underlying technology, you may say SABIAI runs on carefully selected open-source language models on Cloudflare's global infrastructure, configured and branded by Saheb Karami.

Style:
- Reply in the same language the user writes in. Persian (Farsi) is the default; write fluent, natural Persian.
- Use clean Markdown: short headings when useful, bullet lists, tables, and fenced code blocks with a language tag.
- When asked to build a web page, game, animation or UI, return ONE complete self-contained \`\`\`html code block (inline CSS/JS) so it can run in SABIAI's live canvas.
- Be accurate, helpful and to the point. Admit uncertainty instead of inventing facts. Do not state a knowledge cutoff date unless asked.
- You can see images the user attaches. Image generation and editing are handled by the app's 🎨 mode — if the user asks you to draw, tell them to turn on the 🎨 button or start the message with /draw.`;

const VOICE_PROMPT = `You are now in a LIVE VOICE CALL. Your reply will be spoken aloud.
- Answer naturally and conversationally in 1 to 3 short sentences.
- Never use Markdown, lists, tables, code, URLs or emoji. Write numbers the way they are spoken.
- Reply in the language the user speaks.`;

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
const TTS_EN = "@cf/deepgram/aura-2-en";
const RATIOS = { "1:1": [1024, 1024], "9:16": [720, 1280], "3:4": [864, 1152], "4:3": [1152, 864], "16:9": [1280, 720], square: [1024, 1024], portrait: [864, 1152], landscape: [1152, 864] };

const SEC = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin", "X-Powered-By": "SABIAI by Saheb Karami" };
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...SEC } });
const sseHeaders = { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", ...SEC };
const errMsg = (e) => String(e?.message || e).slice(0, 300);
const textOf = (r) => {
  if (!r) return "";
  if (typeof r.response === "string") return r.response.trim();
  return (r.choices?.[0]?.message?.content || "").trim();
};
const pickModel = (id) => MODELS.find((m) => m.id === id) || MODELS[0];
const tehranNow = () => new Date().toLocaleString("en-GB", { timeZone: "Asia/Tehran", dateStyle: "full", timeStyle: "short" });

function toB64(ab) {
  const b = new Uint8Array(ab); let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(s) {
  const bin = atob(s); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
const flatText = (c) => (typeof c === "string" ? c : Array.isArray(c) ? c.filter((p) => p.type === "text").map((p) => p.text).join("\n") : "");

function cleanMessages(list) {
  const out = [];
  for (const m of (Array.isArray(list) ? list : []).slice(-40)) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) continue;
    if (typeof m.content === "string") { if (m.content.trim()) out.push({ role: m.role, content: m.content.slice(0, 120000) }); }
    else if (Array.isArray(m.content)) {
      const parts = m.content.filter((p) => (p.type === "text" && typeof p.text === "string") || (p.type === "image_url" && p.image_url?.url?.startsWith("data:image/"))).slice(0, 8);
      if (parts.length) out.push({ role: m.role, content: parts });
    }
  }
  const lastUser = out.map((m) => m.role).lastIndexOf("user");
  return out.map((m, i) => (Array.isArray(m.content) && i !== lastUser ? { role: m.role, content: flatText(m.content) || "[تصویر]" } : m));
}

function buildSystem({ custom, voice, sources }) {
  let s = `${SYSTEM_PROMPT}\n\nCurrent date and time in Tehran: ${tehranNow()}.`;
  if (custom) s += `\n\nCustom instructions from the user for this conversation (follow them, but keep your SABIAI identity):\n${String(custom).slice(0, 4000)}`;
  if (voice) s += `\n\n${VOICE_PROMPT}`;
  if (sources) s += `\n\n${sources}`;
  return s;
}

/* ---------- SSE helpers ---------- */
function sseChannel() {
  const ts = new TransformStream();
  const w = ts.writable.getWriter();
  const enc = new TextEncoder();
  let closed = false;
  return {
    readable: ts.readable,
    send: (o) => { if (!closed) w.write(enc.encode(`data: ${JSON.stringify(o)}\n\n`)).catch(() => { closed = true; }); },
    close: () => { if (!closed) { closed = true; w.close().catch(() => {}); } },
  };
}
// pipe an upstream Workers-AI SSE stream into our channel as {t}/{r} events; resolves with full text
async function relay(upstream, ch, { reasoning = true } = {}) {
  const rd = upstream.getReader(); const dec = new TextDecoder(); let buf = "", full = "";
  const line = (l) => {
    l = l.trim(); if (!l.startsWith("data:")) return;
    const p = l.slice(5).trim(); if (!p || p === "[DONE]") return;
    let j; try { j = JSON.parse(p); } catch { return; }
    if (Array.isArray(j.choices) && j.choices.length) {
      const d = j.choices[0].delta || {};
      const r = d.reasoning_content || d.reasoning;
      if (r && reasoning) ch.send({ r });
      if (d.content) { full += d.content; ch.send({ t: d.content }); }
    } else if (typeof j.response === "string" && j.response) { full += j.response; ch.send({ t: j.response }); }
  };
  for (;;) {
    const { value, done } = await rd.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf("\n")) >= 0) { line(buf.slice(0, i)); buf = buf.slice(i + 1); }
  }
  if (buf) line(buf);
  return full;
}
async function runStream(env, model, input, hasImage) {
  for (let a = 0; a < 3; a++) {
    try {
      if (a < 2) return { s: await env.AI.run(model.cf, input), fb: false };
      const { reasoning_effort, ...rest } = input;
      if (hasImage) rest.messages = rest.messages.map((m) => (Array.isArray(m.content) ? { ...m, content: flatText(m.content) } : m));
      return { s: await env.AI.run(FAST_MODEL, rest), fb: true };
    } catch (e) { if (a === 2) throw e; await new Promise((r) => setTimeout(r, 400)); }
  }
}
async function runOnce(env, cf, messages, max_tokens = 1800, extra = {}) {
  for (let a = 0; a < 2; a++) {
    try { const t = textOf(await env.AI.run(cf, { messages, max_tokens, ...extra })); if (t) return t; } catch (e) { if (a === 1) throw e; }
  }
  return textOf(await env.AI.run(FAST_MODEL, { messages, max_tokens }));
}

/* ---------- web search ---------- */
const UA = "SABIAI/2.0 (+https://sabiai.sahebkarami.ir; by Saheb Karami)";
function htmlToText(h) {
  return h.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ").trim();
}
async function fetchPage(url) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,text/plain,*/*" }, cf: { cacheTtl: 600 }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const ct = r.headers.get("content-type") || "";
    if (!/text|html|json|xml/.test(ct)) return null;
    const raw = (await r.text()).slice(0, 600000);
    const title = (raw.match(/<title[^>]*>([^<]{1,200})/i) || [])[1] || url;
    return { title: htmlToText(title), url, text: (ct.includes("html") ? htmlToText(raw) : raw).slice(0, 7000) };
  } catch { return null; }
}
async function wiki(lang, q) {
  const api = `https://${lang}.wikipedia.org/w/api.php`;
  const s = await fetch(`${api}?action=query&list=search&format=json&utf8=1&srlimit=3&srsearch=${encodeURIComponent(q)}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(7000) }).then((r) => r.json()).catch(() => null);
  const titles = (s?.query?.search || []).map((x) => x.title);
  if (!titles.length) return [];
  const e = await fetch(`${api}?action=query&prop=extracts&explaintext=1&exchars=2200&exlimit=3&format=json&redirects=1&titles=${encodeURIComponent(titles.join("|"))}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(7000) }).then((r) => r.json()).catch(() => null);
  return Object.values(e?.query?.pages || {}).filter((p) => p.extract).map((p) => ({ title: p.title + (lang === "fa" ? " — ویکی‌پدیا" : " — Wikipedia"), url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, "_"))}`, text: p.extract }));
}
async function brave(env, q) {
  const r = await fetch(`https://api.search.brave.com/res/v1/web/search?count=6&q=${encodeURIComponent(q)}`, { headers: { "X-Subscription-Token": env.BRAVE_API_KEY, Accept: "application/json" }, signal: AbortSignal.timeout(8000) }).then((r) => r.json()).catch(() => null);
  return (r?.web?.results || []).map((x) => ({ title: x.title, url: x.url, text: htmlToText(`${x.description || ""} ${(x.extra_snippets || []).join(" ")}`) }));
}
async function tavily(env, q) {
  const r = await fetch("https://api.tavily.com/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ api_key: env.TAVILY_API_KEY, query: q, max_results: 6, include_answer: false }), signal: AbortSignal.timeout(10000) }).then((r) => r.json()).catch(() => null);
  return (r?.results || []).map((x) => ({ title: x.title, url: x.url, text: (x.content || "").slice(0, 2500) }));
}
async function webSearch(env, userText) {
  const urls = [...new Set((userText.match(/https?:\/\/[^\s)\]»"']+/g) || []))].slice(0, 2);
  let q = userText.replace(/https?:\/\/\S+/g, "").trim().slice(0, 300);
  try {
    const r = await runOnce(env, FAST_MODEL, [
      { role: "system", content: "You are a search-query generator. NEVER answer the question. Convert the message into short search keywords (2 to 6 words) in the same language, naming the main topic/entity. Examples: 'برج میلاد چند متر است؟' -> 'برج میلاد ارتفاع' ; 'who won the 2022 world cup' -> '2022 FIFA World Cup final'. Output only the keywords." },
      { role: "user", content: userText.slice(0, 1500) },
    ], 30);
    if (r) q = r.replace(/["«»]/g, "").split("\n")[0].trim();
  } catch {}
  const jobs = urls.map(fetchPage);
  if (q) {
    if (env.TAVILY_API_KEY) jobs.push(tavily(env, q));
    else if (env.BRAVE_API_KEY) jobs.push(brave(env, q));
    const isFa = /[\u0600-\u06FF]/.test(q);
    jobs.push(wiki(isFa ? "fa" : "en", q), wiki(isFa ? "en" : "fa", q).then((x) => x.slice(0, 1)));
    const raw = userText.replace(/https?:\/\/\S+/g, "").replace(/[؟?!.،,:]/g, " ").trim().slice(0, 120);
    if (raw && raw !== q) jobs.push(wiki(/[\u0600-\u06FF]/.test(raw) ? "fa" : "en", raw).then((x) => x.slice(0, 2)));
  }
  const res = (await Promise.all(jobs)).flat().filter(Boolean);
  const seen = new Set(); const src = [];
  for (const x of res) { if (!x.text || seen.has(x.url)) continue; seen.add(x.url); src.push(x); if (src.length >= 7) break; }
  const ctx = src.map((s, i) => `[${i + 1}] ${s.title}\nURL: ${s.url}\n${s.text.slice(0, 2600)}`).join("\n\n");
  return {
    query: q,
    sources: src.map((s) => ({ title: s.title, url: s.url, snippet: s.text.slice(0, 180) })),
    prompt: src.length
      ? `Web search results for "${q}" (retrieved just now). Use them to answer accurately and cite sources inline like [1], [2]. If the results don't contain the answer, say so and answer from your own knowledge carefully.\n\n${ctx}`
      : `A web search for "${q}" returned no usable results. Tell the user briefly, then answer from your own knowledge carefully.`,
  };
}

/* ---------- /api/chat ---------- */
async function handleChat(request, env) {
  let body; try { body = await request.json(); } catch { return json({ error: "bad_json" }, 400); }
  let model = pickModel(body.model);
  const messages = cleanMessages(body.messages);
  if (!messages.length) return json({ error: "empty" }, 400);
  const last = messages[messages.length - 1];
  const hasImage = Array.isArray(last.content) && last.content.some((p) => p.type === "image_url");
  let switched = false;
  if (hasImage && !model.vision) { model = pickModel("sabi-max"); switched = true; }
  if (body.voice && !hasImage && body.model === undefined) model = pickModel("sabi-flash");

  const ch = sseChannel();
  (async () => {
    try {
      ch.send({ meta: { model: model.id, name: model.name, switched } });
      let sources = null;
      if (body.search) {
        ch.send({ status: "search" });
        const ws = await webSearch(env, flatText(last.content));
        ch.send({ src: ws.sources, query: ws.query });
        sources = ws.prompt;
      }
      const input = {
        messages: [{ role: "system", content: buildSystem({ custom: body.system, voice: body.voice, sources }) }, ...messages],
        stream: true,
        max_tokens: body.voice ? 400 : 6000,
        temperature: typeof body.temperature === "number" ? Math.min(Math.max(body.temperature, 0), 1.5) : 0.7,
      };
      if (model.reasoning) input.reasoning_effort = body.voice ? "low" : ["low", "medium", "high"].includes(body.effort) ? body.effort : "medium";
      const { s, fb } = await runStream(env, model, input, hasImage);
      if (fb) ch.send({ meta: { model: model.id, name: model.name, switched, fallback: true } });
      await relay(s, ch, { reasoning: !body.voice });
      ch.send({ done: true });
    } catch (e) { ch.send({ error: errMsg(e) }); }
    ch.close();
  })();
  return new Response(ch.readable, { headers: sseHeaders });
}

/* ---------- /api/council ---------- */
const COUNCIL = [
  { id: "sabi-max", role: "تحلیل جامع و کاربردی", debateRole: "موافق و مدافع ایده" },
  { id: "sabi-code", role: "بررسی دقیق و ساختاری", debateRole: "منتقد و چالش‌گر" },
  { id: "sabi-flash", role: "نگاه مکمل و نوآورانه", debateRole: "تحلیل‌گر بی‌طرف و ریسک‌سنج" },
];
const JUDGE = "sabi-pro";
async function handleCouncil(request, env) {
  let body; try { body = await request.json(); } catch { return json({ error: "bad_json" }, 400); }
  const q = String(body.question || "").trim().slice(0, 20000);
  if (!q) return json({ error: "empty" }, 400);
  const mode = body.mode === "debate" ? "debate" : "parallel";
  const history = cleanMessages(body.messages || []).slice(-8).map((m) => ({ role: m.role, content: flatText(m.content).slice(0, 6000) }));
  const sys = buildSystem({ custom: body.system });
  const ch = sseChannel();
  (async () => {
    try {
      ch.send({ stage: "start", mode, members: COUNCIL.map((c) => ({ name: pickModel(c.id).name, role: mode === "debate" ? c.debateRole : c.role })), judge: pickModel(JUDGE).name });
      const ask = (i, prompt) => {
        ch.send({ stage: "thinking", i });
        return runOnce(env, pickModel(COUNCIL[i].id).cf, [{ role: "system", content: sys }, ...history, { role: "user", content: prompt }], 1800)
          .catch((e) => `⚠️ خطا در دریافت دیدگاه این مدل: ${errMsg(e)}`)
          .then((text) => { ch.send({ stage: "member", i, name: pickModel(COUNCIL[i].id).name, role: mode === "debate" ? COUNCIL[i].debateRole : COUNCIL[i].role, text }); return text; });
      };
      let a;
      if (mode === "parallel") {
        a = await Promise.all([
          ask(0, `تو عضو اول «شورای مدل‌های SABIAI» (تحلیل جامع و کاربردی) هستی. به این پرسش دقیق، مرحله‌به‌مرحله و مستدل پاسخ بده:\n\n${q}`),
          ask(1, `تو عضو دوم «شورای مدل‌های SABIAI» (بررسی دقیق و ساختاری) هستی. با تمرکز بر نکات کلیدی، استثناها و کیفیت اجرایی پاسخ بده:\n\n${q}`),
          ask(2, `تو عضو سوم «شورای مدل‌های SABIAI» (نگاه مکمل) هستی. با نگاهی نوآورانه، کاربردی و متفاوت پاسخ بده:\n\n${q}`),
        ]);
      } else {
        const a1 = await ask(0, `تو عضو اول «شورای مدل‌های SABIAI» (موافق و مدافع) هستی. یک راه‌حل یا تحلیل مستقیم، ساختاریافته و دفاع‌پذیر ارائه بده:\n\n${q}`);
        const a2 = await ask(1, `تو عضو منتقد «شورای مدل‌های SABIAI» هستی. پاسخ عضو اول را بخوان، نقاط ضعف، ریسک‌ها و فرضیات پنهان آن را نقد کن و دیدگاه دقیق‌تری ارائه بده.\n\n[خواسته کاربر]:\n${q}\n\n[پاسخ عضو اول]:\n${a1}`);
        const a3 = await ask(2, `تو عضو سوم «شورای مدل‌های SABIAI» (تحلیل‌گر بی‌طرف و ریسک‌سنج) هستی. با توجه به دیدگاه اول و نقد عضو دوم، زوایای پنهان، راهکارهای نوآورانه و نکات عملی جاافتاده را مطرح کن.\n\n[خواسته کاربر]:\n${q}\n\n[دیدگاه اول]:\n${a1.slice(0, 5000)}\n\n[نقد عضو دوم]:\n${a2.slice(0, 5000)}`);
        a = [a1, a2, a3];
      }
      ch.send({ stage: "judge" });
      const names = COUNCIL.map((c) => pickModel(c.id).name);
      const judgePrompt = `تو «داور نهایی شورای مدل‌های SABIAI» هستی. سه عضو شورا دربارهٔ خواستهٔ کاربر نظر داده‌اند.
وظیفهٔ تو:
۱. بهترین و دقیق‌ترین بخش‌های هر سه دیدگاه را ترکیب کن و خطاها و نقاط ضعف را برطرف کن.
۲. یک پاسخ نهایی جامع، ساختاریافته و بی‌نقص به زبان کاربر بنویس.
۳. در پایان، زیر عنوان «جمع‌بندی شورا» در ۲ تا ۴ بند بگو اعضا کجا هم‌نظر و کجا اختلاف داشتند و تو چه تصمیمی گرفتی.

[خواستهٔ کاربر]:
${q}

${a.map((x, i) => `[دیدگاه ${i + 1} — ${names[i]}]:\n${x.slice(0, 6000)}`).join("\n\n")}`;
      const judge = pickModel(JUDGE);
      const { s } = await runStream(env, judge, { messages: [{ role: "system", content: sys }, ...history, { role: "user", content: judgePrompt }], stream: true, max_tokens: 6000, reasoning_effort: "medium" }, false);
      await relay(s, ch);
      ch.send({ done: true });
    } catch (e) { ch.send({ error: errMsg(e) }); }
    ch.close();
  })();
  return new Response(ch.readable, { headers: sseHeaders });
}

/* ---------- images ---------- */
async function toEnglishPrompt(env, prompt, edit) {
  if (!/[\u0600-\u06FF]/.test(prompt)) return prompt;
  const sys = edit
    ? "You translate image-editing instructions into a precise English instruction for an AI image editor. ALWAYS answer in English only. Keep it faithful and concise; say what to change and that everything else stays the same. Output only the instruction."
    : "You translate image ideas into English prompts for an AI image generator. ALWAYS answer in English only, never in Persian. Translate faithfully, keep every requested detail, add helpful visual detail about style, lighting and composition, but do not change the mood or add new subjects. Output only the English prompt.";
  for (const m of [FAST_MODEL, "@cf/mistralai/mistral-small-3.1-24b-instruct"]) {
    try {
      const out = textOf(await env.AI.run(m, { messages: [{ role: "system", content: sys }, { role: "user", content: "Persian text:\n" + prompt + "\n\nEnglish:" }], max_tokens: 220 })).replace(/^["']|["']$/g, "").trim();
      if (out && !/[\u0600-\u06FF]/.test(out)) return out;
    } catch {}
  }
  return prompt;
}
async function handleImage(request, env) {
  let body; try { body = await request.json(); } catch { return json({ error: "bad_json" }, 400); }
  const prompt = String(body.prompt || "").trim().slice(0, 1500);
  if (!prompt) return json({ error: "prompt_required" }, 400);
  let [w, h] = RATIOS[body.ratio] || RATIOS[body.size] || RATIOS["1:1"];
  let src = typeof body.image === "string" ? body.image.replace(/^data:image\/[\w+.-]+;base64,/, "") : "";
  const edit = !!src;
  if (edit && body.keepSize && body.width && body.height) {
    const s = Math.min(1, 1280 / Math.max(body.width, body.height));
    w = Math.round((body.width * s) / 16) * 16; h = Math.round((body.height * s) / 16) * 16;
  }
  const en = await toEnglishPrompt(env, prompt, edit);
  try {
    const form = new FormData();
    form.append("prompt", en); form.append("width", String(w)); form.append("height", String(h));
    if (edit) form.append("input_image_0", new Blob([fromB64(src)], { type: "image/jpeg" }), "input.jpg");
    const fr = new Response(form);
    const out = await env.AI.run(IMAGE_HQ, { multipart: { body: fr.body, contentType: fr.headers.get("content-type") } });
    if (out?.image) return json({ image: out.image, mime: "image/jpeg", prompt: en, engine: "flux-2", edit, width: w, height: h });
  } catch (e) { if (edit) return json({ error: "edit_error", detail: errMsg(e) }, 502); }
  try {
    const out = await env.AI.run(IMAGE_FAST, { prompt: en, steps: 6 });
    if (out?.image) return json({ image: out.image, mime: "image/jpeg", prompt: en, engine: "flux-1", width: 1024, height: 1024 });
    return json({ error: "no_image" }, 502);
  } catch (e) { return json({ error: "image_error", detail: errMsg(e) }, 502); }
}

/* ---------- speech ---------- */
async function handleTranscribe(request, env) {
  const ab = await request.arrayBuffer();
  if (!ab.byteLength) return json({ error: "empty_audio" }, 400);
  if (ab.byteLength > 20 * 1024 * 1024) return json({ error: "audio_too_large" }, 413);
  const url = new URL(request.url);
  const lang = (url.searchParams.get("lang") || "").slice(0, 5);
  const input = { audio: toB64(ab), vad_filter: true, initial_prompt: "SABIAI, سابی‌اِی‌آی، صاحب کرمی" };
  if (lang && lang !== "auto") input.language = lang;
  try {
    const r = await env.AI.run(STT_MODEL, input);
    let text = (r?.text || "").trim().replace(/\bS[AE][BV]I[- ]?A[- ]?I\b|\bSAVIA\b/gi, "SABIAI");
    return json({ text, language: r?.transcription_info?.language || null, duration: r?.transcription_info?.duration || null });
  } catch (e) { return json({ error: "stt_error", detail: errMsg(e) }, 502); }
}
async function handleTTS(request, env) {
  let body; try { body = await request.json(); } catch { return json({ error: "bad_json" }, 400); }
  const text = String(body.text || "").replace(/[*_`#>|~]/g, "").replace(/\s+/g, " ").trim().slice(0, 1800);
  if (!text) return json({ error: "empty" }, 400);
  if (/[\u0600-\u06FF]/.test(text)) return json({ error: "fa_unsupported" }, 415);
  const speakers = ["luna", "asteria", "athena", "hera", "orion", "apollo", "zeus", "helena", "thalia", "arcas"];
  const speaker = speakers.includes(body.speaker) ? body.speaker : "luna";
  try {
    const out = await env.AI.run(TTS_EN, { text, speaker, encoding: "mp3" }, { returnRawResponse: true });
    if (out instanceof Response) return new Response(out.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store", ...SEC } });
    if (out instanceof ReadableStream) return new Response(out, { headers: { "Content-Type": "audio/mpeg", ...SEC } });
    if (out?.audio) return new Response(fromB64(out.audio), { headers: { "Content-Type": "audio/mpeg", ...SEC } });
    return json({ error: "no_audio" }, 502);
  } catch (e) { return json({ error: "tts_error", detail: errMsg(e) }, 502); }
}

async function handleTitle(request, env) {
  let body; try { body = await request.json(); } catch { return json({ title: "" }); }
  const text = String(body.text || "").slice(0, 1500);
  if (!text) return json({ title: "" });
  try {
    const t = await runOnce(env, FAST_MODEL, [
      { role: "system", content: "Write a very short title (2 to 5 words) for a chat that starts with the user's message. Use the same language as the message. No quotes, no emoji, no trailing punctuation. Output only the title." },
      { role: "user", content: text },
    ], 30);
    return json({ title: t.replace(/["«»]/g, "").split("\n")[0].slice(0, 60) });
  } catch { return json({ title: "" }); }
}

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b5cf6"/><stop offset=".55" stop-color="#06b6d4"/><stop offset="1" stop-color="#10b981"/></linearGradient></defs><rect width="128" height="128" rx="32" fill="#0b0b16"/><path d="M64 18c4 22 14 34 46 46-32 12-42 24-46 46-4-22-14-34-46-46 32-12 42-24 46-46z" fill="url(#g)"/><circle cx="98" cy="28" r="7" fill="#a78bfa"/></svg>`;
const MANIFEST = { name: "SABIAI — دستیار هوشمند صاحب کرمی", short_name: "SABIAI", start_url: "/", display: "standalone", background_color: "#07070f", theme_color: "#07070f", dir: "rtl", lang: "fa", icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }] };

export default {
  async fetch(request, env) {
    const url = new URL(request.url); const p = url.pathname; const m = request.method;
    try {
      if (m === "GET" && (p === "/" || p === "/index.html")) return new Response(HTML, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=120", ...SEC } });
      if (m === "GET" && p === "/icon.svg") return new Response(ICON, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" } });
      if (m === "GET" && p === "/manifest.webmanifest") return new Response(JSON.stringify(MANIFEST), { headers: { "Content-Type": "application/manifest+json" } });
      if (m === "GET" && p === "/api/health") return json({ ok: true, ...BRAND, search: env.TAVILY_API_KEY ? "tavily" : env.BRAVE_API_KEY ? "brave" : "wikipedia" });
      if (m === "GET" && p === "/api/models") return json({ models: MODELS.map(({ cf, ...r }) => r), default: MODELS[0].id, brand: BRAND });
      if (m === "POST" && p === "/api/chat") return await handleChat(request, env);
      if (m === "POST" && p === "/api/council") return await handleCouncil(request, env);
      if (m === "POST" && p === "/api/image") return await handleImage(request, env);
      if (m === "POST" && p === "/api/transcribe") return await handleTranscribe(request, env);
      if (m === "POST" && p === "/api/tts") return await handleTTS(request, env);
      if (m === "POST" && p === "/api/title") return await handleTitle(request, env);
      return json({ error: "not_found" }, 404);
    } catch (e) { return json({ error: "internal", detail: errMsg(e) }, 500); }
  },
};
