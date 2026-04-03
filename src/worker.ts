import { addNode, addEdge, traverse, crossDomainQuery, findPath, domainStats, getDomainNodes } from './lib/knowledge-graph.js';
import { loadSeedIntoKG, FLEET_REPOS, loadAllSeeds } from './lib/seed-loader.js';
/**
 * nightlog.ai — Cloudflare Worker
 *
 * Routes:
 *   POST /api/chat          → SSE streaming chat with DeepSeek
 *   GET  /api/sleep/{date}  → sleep data for a date
 *   POST /api/sleep/log     → log sleep session
 *   GET  /api/dreams        → list dream journal entries
 *   POST /api/dreams        → save a dream entry
 *   GET  /api/insights      → AI-generated sleep insights
 *   GET  /                  → dark theme landing page
 *
 * Auth: simple JWT with PBKDF2
 * Demo mode: 5 free messages as guest
 */

import { SleepDebt, CircadianRhythm, PatternDetection, SleepScore, Recommendations } from './sleep/analyser';
import type { SleepLog } from './sleep/analyser';
import { DreamSearch, DreamAnalysis, DreamPrompts } from './dreams/journal';
import type { DreamEntry, DreamMood, LucidityLevel } from './dreams/journal';

// ─── KV Types ──────────────────────────────────────────────────────────────────

interface Env {
  DEEPSEEK_API_KEY: string;
  JWT_SECRET: string;
  DATA: KVNamespace;
}

interface SleepLogEntry extends SleepLog {
  userId: string;
}

interface DreamRecord extends DreamEntry {
  userId: string;
}

interface GuestState {
  messagesRemaining: number;
  firstSeen: number;
}

// ─── JWT (PBKDF2-based) ───────────────────────────────────────────────────────

async function deriveKey(secret: string, salt: Uint8Array): Promise<ArrayBuffer> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  ).then(k => crypto.subtle.exportKey('raw', k));
}

async function createToken(payload: Record<string, unknown>, secret: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const enc = new TextEncoder();
  const keyRaw = await deriveKey(secret, salt);
  const key = await crypto.subtle.importKey('raw', keyRaw, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = enc.encode(JSON.stringify({ ...payload, iat: Date.now() }));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  const combined = new Uint8Array(salt.length + iv.length + new Uint8Array(ciphertext).length);
  combined.set(salt, 0);
  combined.set(iv, salt.length);
  combined.set(new Uint8Array(ciphertext), salt.length + iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function verifyToken(token: string, secret: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = Uint8Array.from(atob(token), c => c.charCodeAt(0));
    const salt = raw.slice(0, 16);
    const iv = raw.slice(16, 28);
    const ciphertext = raw.slice(28);
    const keyRaw = await deriveKey(secret, salt);
    const key = await crypto.subtle.importKey('raw', keyRaw, { name: 'AES-GCM' }, false, ['decrypt']);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    const payload = JSON.parse(new TextDecoder().decode(plaintext)) as Record<string, unknown>;
    // 7-day expiry
    if (Date.now() - (payload.iat as number) > 7 * 86400000) return null;
    return payload;
  } catch {
    return null;
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

function htmlResponse(html: string): Response {
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
  });
}

function todayDate(): string {
  return new Date().toISOString().split('T')[0];
}

// ─── KV data access ───────────────────────────────────────────────────────────

async function getSleepLogs(kv: KVNamespace, userId: string): Promise<SleepLogEntry[]> {
  const raw = await kv.get(`sleep:${userId}`);
  if (!raw) return [];
  try { return JSON.parse(raw) as SleepLogEntry[]; }
  catch { return []; }
}

async function putSleepLogs(kv: KVNamespace, userId: string, logs: SleepLogEntry[]): Promise<void> {
  await kv.put(`sleep:${userId}`, JSON.stringify(logs.slice(-90))); // keep 90 days
}

async function getDreams(kv: KVNamespace, userId: string): Promise<DreamRecord[]> {
  const raw = await kv.get(`dreams:${userId}`);
  if (!raw) return [];
  try { return JSON.parse(raw) as DreamRecord[]; }
  catch { return []; }
}

async function putDreams(kv: KVNamespace, userId: string, dreams: DreamRecord[]): Promise<void> {
  await kv.put(`dreams:${userId}`, JSON.stringify(dreams.slice(-200))); // keep 200 dreams
}

async function getGuestState(kv: KVNamespace, guestId: string): Promise<GuestState> {
  const raw = await kv.get(`guest:${guestId}`);
  if (!raw) return { messagesRemaining: 5, firstSeen: Date.now() };
  try { return JSON.parse(raw) as GuestState; }
  catch { return { messagesRemaining: 5, firstSeen: Date.now() }; }
}

async function putGuestState(kv: KVNamespace, guestId: string, state: GuestState): Promise<void> {
  await kv.put(`guest:${guestId}`, JSON.stringify(state), { expirationTtl: 86400 });
}

// ─── Auth middleware ────────────────────────────────────────────────────────────

async function getUserId(req: Request, env: Env): Promise<{ userId: string; isGuest: boolean }> {
  const auth = req.headers.get('Authorization');
  if (auth?.startsWith('Bearer ')) {
    const payload = await verifyToken(auth.slice(7), env.JWT_SECRET);
    if (payload?.sub) return { userId: payload.sub as string, isGuest: false };
  }
  // Guest: use IP-based ID
  const ip = req.headers.get('CF-Connecting-IP') ?? 'guest';
  return { userId: `guest:${ip}`, isGuest: true };
}

// ─── Chat handler ──────────────────────────────────────────────────────────────

async function handleChat(req: Request, env: Env): Promise<Response> {
  const { userId, isGuest } = await getUserId(req, env);

  // Demo mode: limit guests to 5 messages
  if (isGuest) {
    const state = await getGuestState(env.DATA, userId);
    if (state.messagesRemaining <= 0) {
      return jsonResponse({ error: 'Demo limit reached. Sign up for unlimited access.' }, 429);
    }
    state.messagesRemaining--;
    await putGuestState(env.DATA, userId, state);
  }

  let body: { message?: string };
  try { body = await req.json() as { message?: string }; }
  catch { return jsonResponse({ error: 'Invalid JSON' }, 400); }

  const userMessage = (body.message ?? '').trim();
  if (!userMessage) return jsonResponse({ error: 'Empty message' }, 400);

  // Gather context
  const sleepLogs = await getSleepLogs(env.DATA, userId);
  const dreams = await getDreams(env.DATA, userId);

  const sleepContext = sleepLogs.length > 0
    ? `Recent sleep: ${sleepLogs.slice(-3).map(l => `${l.date}: ${l.bedtime}→${l.wakeTime} quality ${l.quality}/5`).join('; ')}`
    : 'No sleep data logged yet.';
  const dreamContext = dreams.length > 0
    ? `Recent dreams: ${dreams.slice(-3).map(d => `${d.date}: "${d.content.slice(0, 80)}..." mood: ${d.mood}`).join('; ')}`
    : 'No dreams logged yet.';

  const sleepScore = sleepLogs.length > 0 ? SleepScore.calculate(sleepLogs) : null;
  const debt = sleepLogs.length > 0 ? SleepDebt.calculate(sleepLogs) : null;
  const patterns = sleepLogs.length >= 3 ? PatternDetection.detect(sleepLogs) : [];
  const recommendations = Recommendations.generate(sleepLogs);
  const dreamThemes = dreams.length >= 2 ? DreamAnalysis.recurringThemes(dreams, 2).slice(0, 5) : [];

  const systemPrompt = `You are nightlog.ai — a compassionate, knowledgeable sleep and dream companion. You help people understand their sleep patterns, interpret dreams, and optimize their circadian rhythm. You speak warmly but concisely, like a caring friend who happens to know sleep science.

## Current User Data
${sleepContext}
${dreamContext}
${sleepScore !== null ? `Sleep Score: ${sleepScore}/100 (${SleepScore.label(sleepScore)})` : ''}
${debt !== null ? `Sleep Debt: ${SleepDebt.label(debt)}` : ''}
${patterns.length > 0 ? `Detected Patterns: ${patterns.map(p => p.description).join('; ')}` : ''}
${recommendations.length > 0 ? `Recommendations: ${recommendations.join('; ')}` : ''}
${dreamThemes.length > 0 ? `Recurring Dream Themes: ${dreamThemes.map(t => `${t.theme} (${t.count}x)`).join(', ')}` : ''}

Be specific, reference their actual data when relevant. If they ask about dreams, draw from dream psychology and common archetypes. Keep responses concise and actionable.`;

  // Stream from DeepSeek
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}`,
  };

  const llmRes = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.7,
      max_tokens: 1024,
      stream: true,
    }),
  });

  if (!llmRes.ok) {
    const errText = await llmRes.text().catch(() => 'unknown');
    return jsonResponse({ error: `LLM ${llmRes.status}: ${errText}` }, 502);
  }

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  (async () => {
    let fullResponse = '';
    try {
      const reader = llmRes.body?.getReader();
      if (!reader) { await writer.close(); return; }
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const payload = trimmed.slice(6);
          if (payload === '[DONE]') break;
          try {
            const chunk = JSON.parse(payload) as {
              choices: Array<{ delta?: { content?: string }; finish_reason?: string }>;
            };
            const content = chunk.choices[0]?.delta?.content;
            if (content) {
              fullResponse += content;
              await writer.write(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
            }
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      await writer.write(encoder.encode(`data: ${JSON.stringify({ error: String(err) })}\n\n`));
    }
    await writer.write(encoder.encode('data: [DONE]\n\n'));
    await writer.close();
  })();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// ─── Sleep routes ──────────────────────────────────────────────────────────────

async function handleSleepLog(req: Request, env: Env): Promise<Response> {
  const { userId } = await getUserId(req, env);
  let body: { bedtime?: string; wakeTime?: string; quality?: number; date?: string; notes?: string };
  try { body = await req.json() as typeof body; }
  catch { return jsonResponse({ error: 'Invalid JSON' }, 400); }

  if (!body.bedtime || !body.wakeTime) return jsonResponse({ error: 'bedtime and wakeTime required (HH:mm)' }, 400);
  if (!body.quality || body.quality < 1 || body.quality > 5) return jsonResponse({ error: 'quality must be 1-5' }, 400);

  const date = body.date ?? todayDate();
  const logs = await getSleepLogs(env.DATA, userId);
  const existingIdx = logs.findIndex(l => l.date === date);

  const entry: SleepLogEntry = {
    date,
    bedtime: body.bedtime,
    wakeTime: body.wakeTime,
    quality: body.quality as 1 | 2 | 3 | 4 | 5,
    notes: body.notes,
    userId,
  };

  if (existingIdx >= 0) logs[existingIdx] = entry;
  else logs.push(entry);
  logs.sort((a, b) => a.date.localeCompare(b.date));

  await putSleepLogs(env.DATA, userId, logs);
  return jsonResponse({ ok: true, entry });
}

async function handleSleepGet(req: Request, env: Env, date: string): Promise<Response> {
  const { userId } = await getUserId(req, env);
  const logs = await getSleepLogs(env.DATA, userId);
  const entry = logs.find(l => l.date === date);
  if (!entry) return jsonResponse({ error: 'No sleep data for that date' }, 404);
  return jsonResponse(entry);
}

// ─── Dream routes ──────────────────────────────────────────────────────────────

async function handleDreamsList(req: Request, env: Env): Promise<Response> {
  const { userId } = await getUserId(req, env);
  const dreams = await getDreams(env.DATA, userId);
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20'), 100);
  return jsonResponse({ dreams: dreams.slice(-limit) });
}

async function handleDreamCreate(req: Request, env: Env): Promise<Response> {
  const { userId } = await getUserId(req, env);
  let body: { date?: string; content?: string; tags?: string[]; mood?: string; lucidity?: number };
  try { body = await req.json() as typeof body; }
  catch { return jsonResponse({ error: 'Invalid JSON' }, 400); }

  if (!body.content?.trim()) return jsonResponse({ error: 'Dream content is required' }, 400);

  const validMoods: DreamMood[] = ['peaceful', 'neutral', 'anxious', 'nightmare', 'euphoric', 'melancholic', 'vivid'];
  const mood = (validMoods.includes(body.mood as DreamMood) ? body.mood : 'neutral') as DreamMood;
  const lucidity = Math.max(0, Math.min(5, body.lucidity ?? 0)) as LucidityLevel;

  const dream: DreamRecord = {
    id: `dream_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    date: body.date ?? todayDate(),
    content: body.content.trim(),
    tags: body.tags ?? [],
    mood,
    lucidity,
    createdAt: Date.now(),
    userId,
  };

  const dreams = await getDreams(env.DATA, userId);
  dreams.push(dream);
  await putDreams(env.DATA, userId, dreams);
  return jsonResponse({ ok: true, dream });
}

// ─── Insights route ────────────────────────────────────────────────────────────

async function handleInsights(req: Request, env: Env): Promise<Response> {
  const { userId } = await getUserId(req, env);
  const sleepLogs = await getSleepLogs(env.DATA, userId);
  const dreams = await getDreams(env.DATA, userId);

  const score = sleepLogs.length > 0 ? SleepScore.calculate(sleepLogs) : null;
  const debt = sleepLogs.length > 0 ? SleepDebt.calculate(sleepLogs) : null;
  const debtTrend = sleepLogs.length >= 14 ? SleepDebt.trend(sleepLogs) : null;
  const chronotype = sleepLogs.length >= 5 ? CircadianRhythm.chronotype(sleepLogs) : null;
  const consistency = sleepLogs.length >= 3 ? CircadianRhythm.bedtimeConsistency(sleepLogs) : null;
  const patterns = PatternDetection.detect(sleepLogs);
  const recommendations = Recommendations.generate(sleepLogs);

  const latestLog = sleepLogs[sleepLogs.length - 1];
  const bedtimeSuggestions = latestLog ? CircadianRhythm.suggestAll(latestLog.wakeTime) : [];

  const dreamThemes = dreams.length >= 2 ? DreamAnalysis.recurringThemes(dreams, 2).slice(0, 5) : [];
  const dreamEmotions = dreams.length >= 2 ? DreamAnalysis.emotionalPatterns(dreams) : null;
  const dreamSymbols = dreams.length >= 2 ? DreamAnalysis.recurringSymbols(dreams, 2).slice(0, 5) : [];
  const lucidityInsights = dreams.length >= 1 ? DreamAnalysis.lucidityInsights(dreams) : null;
  const dreamPrompts = DreamPrompts.suggest(dreams, 3);

  return jsonResponse({
    sleep: {
      score,
      scoreLabel: score !== null ? SleepScore.label(score) : null,
      debt: debt !== null ? { minutes: debt, label: SleepDebt.label(debt) } : null,
      debtTrend,
      chronotype,
      bedtimeConsistency: consistency,
      patterns,
      recommendations,
      bedtimeSuggestions,
    },
    dreams: {
      totalEntries: dreams.length,
      themes: dreamThemes,
      emotionalPatterns: dreamEmotions,
      symbols: dreamSymbols,
      lucidity: lucidityInsights,
      journalPrompts: dreamPrompts,
    },
  });
}

// ─── Landing page ──────────────────────────────────────────────────────────────

async function getLandingHTML(): Promise<string> {
  // In production, this would read from public/app.html
  // For the worker, we serve a minimal redirect/meta page
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>nightlog.ai — Sleep & Dream Intelligence</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  :root{--bg:#0a0a1a;--surface:#12122a;--border:#1e1e3a;--text:#c4c4e0;--muted:#6a6a8e;
    --accent:#7c6aef;--accent2:#5a4acf;--gold:#d4a44a;--mono:'SF Mono',SFMono-Regular,Consolas,monospace}
  body{font-family:var(--mono);background:var(--bg);color:var(--text);min-height:100vh;overflow-x:hidden}
  .stars{position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:0}
  .star{position:absolute;background:#fff;border-radius:50%;animation:twinkle var(--dur,3s) ease-in-out infinite}
  @keyframes twinkle{0%,100%{opacity:.3}50%{opacity:1}}
  .hero{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:40px 20px;text-align:center}
  .logo{font-size:48px;font-weight:200;letter-spacing:8px;color:var(--accent);margin-bottom:8px;text-transform:lowercase}
  .tagline{font-size:14px;color:var(--muted);letter-spacing:3px;margin-bottom:48px;text-transform:uppercase}
  .features{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:20px;max-width:900px;width:100%}
  .feature{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:24px;text-align:left}
  .feature h3{color:var(--accent);font-size:13px;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px}
  .feature p{font-size:13px;line-height:1.6;color:var(--text)}
  .cta{margin-top:48px;padding:14px 40px;background:var(--accent);color:#fff;border:none;border-radius:8px;
    font-family:var(--mono);font-size:14px;font-weight:600;cursor:pointer;letter-spacing:1px}
  .cta:hover{background:var(--accent2)}
  .demo-note{margin-top:12px;font-size:11px;color:var(--muted)}
</style>
</head>
<body>
<div class="stars" id="stars"></div>
<div class="hero">
  <div class="logo">nightlog</div>
  <div class="tagline">Sleep &middot; Dreams &middot; Intelligence</div>
  <div class="features">
    <div class="feature"><h3>Sleep Tracker</h3><p>Log bedtime, wake time, quality. Track cumulative sleep debt and circadian rhythm over weeks and months.</p></div>
    <div class="feature"><h3>Dream Journal</h3><p>Record dreams with mood tags and lucidity levels. Discover recurring themes, symbols, and emotional patterns.</p></div>
    <div class="feature"><h3>AI Insights</h3><p>Personalized recommendations from your data. Detect caffeine correlations, social jetlag, and quality trends.</p></div>
    <div class="feature"><h3>Sleep Chat</h3><p>Ask questions about your sleep and dreams. Get science-backed answers grounded in your actual data.</p></div>
  </div>
  <button class="cta" onclick="location.href='/app.html'">Open nightlog</button>
  <div class="demo-note">5 free messages as guest. No sign-up required.</div>
</div>
<script>
  const s=document.getElementById('stars');
  for(let i=0;i<80;i++){const st=document.createElement('div');st.className='star';
    st.style.left=Math.random()*100+'%';st.style.top=Math.random()*100+'%';
    const sz=Math.random()*2+1;st.style.width=sz+'px';st.style.height=sz+'px';
    st.style.setProperty('--dur',(Math.random()*4+2)+'s');
    st.style.animationDelay=Math.random()*4+'s';s.appendChild(st)}
</script>
</body>
</html>`;
}

// ─── Router ────────────────────────────────────────────────────────────────────

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    // ── Knowledge Graph (Phase 4B) ──
    if (path.startsWith('/api/kg')) {
      const _kj = (d: any, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
      if (path === '/api/kg' && method === 'GET') return _kj({ domain: url.searchParams.get('domain') || 'nightlog-ai', nodes: await getDomainNodes(env, url.searchParams.get('domain') || 'nightlog-ai') });
      if (path === '/api/kg/explore' && method === 'GET') {
        const nid = url.searchParams.get('node');
        if (!nid) return _kj({ error: 'node required' }, 400);
        return _kj(await traverse(env, nid, parseInt(url.searchParams.get('depth') || '2'), url.searchParams.get('domain') || undefined));
      }
      if (path === '/api/kg/cross' && method === 'GET') return _kj({ query: url.searchParams.get('query') || '', domain: url.searchParams.get('domain') || 'nightlog-ai', results: await crossDomainQuery(env, url.searchParams.get('query') || '', url.searchParams.get('domain') || 'nightlog-ai') });
      if (path === '/api/kg/domains' && method === 'GET') return _kj(await domainStats(env));
      if (path === '/api/kg/sync' && method === 'POST') return _kj(await loadAllSeeds(env, FLEET_REPOS));
      if (path === '/api/kg/seed' && method === 'POST') { const b = await request.json(); return _kj(await loadSeedIntoKG(env, b, b.domain || 'nightlog-ai')); }
    }

    const url = new URL(req.url);
    const path = url.pathname;

    // CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' },
      });
    }

    // GET / — landing page
    if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
      return htmlResponse(await getLandingHTML());
    }

    // POST /api/auth/token — issue a JWT
    if (req.method === 'POST' && path === '/api/auth/token') {
      const id = crypto.randomUUID();
      const token = await createToken({ sub: id }, env.JWT_SECRET);
      return jsonResponse({ token, userId: id });
    }

    // POST /api/chat
    if (req.method === 'POST' && path === '/api/chat') {
      return handleChat(req, env);
    }

    // POST /api/sleep/log
    if (req.method === 'POST' && path === '/api/sleep/log') {
      return handleSleepLog(req, env);
    }

    // GET /api/sleep/{date}
    const sleepMatch = path.match(/^\/api\/sleep\/(\d{4}-\d{2}-\d{2})$/);
    if (req.method === 'GET' && sleepMatch) {
      return handleSleepGet(req, env, sleepMatch[1]);
    }

    // GET /api/dreams
    if (req.method === 'GET' && path === '/api/dreams') {
      return handleDreamsList(req, env);
    }

    // POST /api/dreams
    if (req.method === 'POST' && path === '/api/dreams') {
      return handleDreamCreate(req, env);
    }

    // GET /api/insights
    if (req.method === 'GET' && path === '/api/insights') {
      return handleInsights(req, env);
    }

    return jsonResponse({ error: 'Not found' }, 404);
  },
} satisfies ExportedHandler<Env>;
