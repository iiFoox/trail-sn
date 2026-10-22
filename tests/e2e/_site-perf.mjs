// Mede o desempenho do site (site/b3/) em cenários de celular e PC, com cache vazio.
// Uso: node tests/e2e/_site-perf.mjs [saida.json] [--font=abort|slow|none] [--only=nome]
// Servidor local com gzip (como a Vercel). A fonte do Google não é alcançável neste ambiente:
//   --font=abort  a requisição falha na hora (padrão)
//   --font=slow   simula o terceiro domínio: CSS da fonte responde em 1,2 s (handshake + DNS no celular)
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const root = process.env.SITE_ROOT ? resolve(process.env.SITE_ROOT) : resolve(here, '../../site');
const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith('--'));
const FONT = (args.find((a) => a.startsWith('--font=')) || '--font=abort').split('=')[1];
const ONLY = (args.find((a) => a.startsWith('--only=')) || '').split('=')[1];
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };
const PORT = 4491;
const srv = createServer((req, res) => {
  let p = join(root, decodeURIComponent(req.url.split('?')[0]));
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
  if (!existsSync(p)) { res.writeHead(404); return res.end(); }
  const type = mime[extname(p)] || 'application/octet-stream';
  let body = readFileSync(p); const h = { 'content-type': type };
  if (/text|javascript|json|svg/.test(type) && /gzip/.test(req.headers['accept-encoding'] || '')) { body = gzipSync(body); h['content-encoding'] = 'gzip'; }
  res.writeHead(200, h); res.end(body);
}).listen(PORT);

const MOBILE = { viewport: { width: 412, height: 823 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36' };
const DESKTOP = { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 };
// Perfis do DevTools (latência em ms, vazão em bytes/s)
const NET = {
  slow4g: { latency: 150, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 },
  fast3g: { latency: 562.5, downloadThroughput: 1.44 * 1024 * 1024 / 8 * 0.9, uploadThroughput: 675 * 1024 / 8 * 0.9 },
};
const SCEN = [
  { name: 'celular · CPU 4× · Slow 4G', ctx: MOBILE, cpu: 4, net: 'slow4g' },
  { name: 'celular · CPU 6× · Fast 3G', ctx: MOBILE, cpu: 6, net: 'fast3g' },
  { name: 'PC · sem limite', ctx: DESKTOP, cpu: 1, net: null },
  { name: 'PC · CPU 2×', ctx: DESKTOP, cpu: 2, net: null },
].filter((s) => !ONLY || s.name.includes(ONLY));

const INIT = () => {
  window.__perf = { fcp: 0, lcp: 0, lcpEl: '', cls: 0, long: [] }; window.__bgDraws = 0;
  const fr = CanvasRenderingContext2D.prototype.fillRect; CanvasRenderingContext2D.prototype.fillRect = function (...a) { if (this.canvas.id === 'trails') window.__bgDraws++; return fr.apply(this, a); };
  new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (e.name === 'first-contentful-paint') __perf.fcp = e.startTime; })).observe({ type: 'paint', buffered: true });
  new PerformanceObserver((l) => l.getEntries().forEach((e) => { __perf.lcp = e.startTime; __perf.lcpEl = (e.element?.tagName || '') + (e.element?.id ? '#' + e.element.id : '') + (e.url ? ' ' + e.url.split('/').pop() : ''); })).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) __perf.cls += e.value; })).observe({ type: 'layout-shift', buffered: true });
  new PerformanceObserver((l) => l.getEntries().forEach((e) => __perf.long.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({ type: 'longtask', buffered: true });
};

function bucket(url, type) {
  if (/fonts\.(googleapis|gstatic)/.test(url)) return 'fontes';
  if (/\/demo\/|\/assets\//.test(url)) return 'demo (iframes)';
  if (type === 'Script') return 'JS'; if (type === 'Stylesheet') return 'CSS'; if (type === 'Image') return 'imagens';
  if (type === 'Font') return 'fontes'; if (type === 'Document') return 'HTML';
  return 'outros';
}

function aggProfile(profile, topN = 12) {
  const self = new Map(); const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const dt = profile.timeDeltas; const counts = new Map();
  profile.samples.forEach((id, i) => counts.set(id, (counts.get(id) || 0) + (dt[i + 1] || 0)));
  for (const [id, us] of counts) {
    const n = byId.get(id); const cf = n.callFrame;
    const file = cf.url ? cf.url.replace(/^.*localhost:\d+/, '') : '';
    const key = cf.functionName === '(idle)' || cf.functionName === '(program)' || cf.functionName === '(garbage collector)' ? cf.functionName : `${cf.functionName || '(anônima)'} ${file}:${cf.lineNumber + 1}`;
    self.set(key, (self.get(key) || 0) + us);
  }
  const byFile = new Map();
  for (const [k, us] of self) { const f = k.startsWith('(') ? k : k.split(' ').slice(1).join(' ').replace(/:\d+$/, '') || '(nativo)'; byFile.set(f, (byFile.get(f) || 0) + us); }
  const fmt = (m) => [...m].filter(([k]) => k !== '(idle)').sort((a, b) => b[1] - a[1]).slice(0, topN).map(([k, us]) => [k, Math.round(us / 1000)]);
  return { porFuncao: fmt(self), porArquivo: fmt(byFile) };
}

async function run(s) {
  const browser = await chromium.launch({ channel: 'chromium', args: ['--enable-features=NetworkService'] });
  const ctx = await browser.newContext(s.ctx);
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, async (route) => {
    if (FONT === 'slow') { await new Promise((r) => setTimeout(r, 1200)); return route.fulfill({ status: 200, contentType: 'text/css', body: '/* fonte simulada */' }); }
    return route.abort();
  });
  const page = await ctx.newPage();
  await page.addInitScript(INIT);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  if (s.net) await cdp.send('Network.emulateNetworkConditions', { offline: false, ...NET[s.net] });
  if (s.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: s.cpu });
  const reqs = new Map(); const blocking = [];
  cdp.on('Network.requestWillBeSent', (e) => { reqs.set(e.requestId, { url: e.request.url, type: e.type, t0: e.timestamp, bytes: 0, prio: e.request.initialPriority }); if (e.initiator?.type === 'parser' && (e.type === 'Stylesheet' || e.type === 'Script')) blocking.push(e.request.url.replace(/^.*localhost:\d+/, '')); });
  cdp.on('Network.responseReceived', (e) => { const r = reqs.get(e.requestId); if (r) r.type = e.type; });
  cdp.on('Network.loadingFinished', (e) => { const r = reqs.get(e.requestId); if (r) { r.bytes = e.encodedDataLength; r.t1 = e.timestamp; } });
  cdp.on('Network.loadingFailed', (e) => { const r = reqs.get(e.requestId); if (r) { r.failed = e.errorText; r.t1 = e.timestamp; } });
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start');
  const t0 = Date.now();
  await page.goto(`http://localhost:${PORT}/b3/`, { waitUntil: 'load', timeout: 120000 });
  const loadMs = Date.now() - t0;
  // fica 12 s parada no topo, como quem lê o começo (é aí que os iframes eram puxados em segundo plano)
  await page.waitForTimeout(12000);
  const loadProfile = (await cdp.send('Profiler.stop')).profile;
  const perf = await page.evaluate(() => ({ ...__perf, dcl: performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd, load: performance.getEntriesByType('navigation')[0].loadEventEnd }));
  const reqAtIdle = [...reqs.values()];
  // TBT: tarefas longas entre FCP e 12 s; "responsiva": fim da última tarefa longa com 5 s de calmaria depois
  const longs = perf.long; const tbt = longs.filter(([st]) => st >= perf.fcp).reduce((a, [, d]) => a + Math.max(0, d - 50), 0);
  let tti = perf.fcp; for (const [st, d] of longs) { if (st - tti < 5000) tti = Math.max(tti, st + d); }
  const tti2 = Math.max(tti, perf.dcl);
  // custo de rolar: rola a página inteira em ~8 s, medindo quadro a quadro
  await cdp.send('Performance.enable');
  const gm = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  await cdp.send('Profiler.start');
  const ms0 = await gm(); const ts0 = Date.now();
  const scroll = await page.evaluate(async () => {
    const H = document.documentElement.scrollHeight - innerHeight; const frames = []; const before = __perf.long.length; const d0 = window.__bgDraws;
    await new Promise((res) => { const t0 = performance.now(); let last = t0; const dur = 8000;
      const f = (now) => { frames.push(now - last); last = now; const k = Math.min(1, (now - t0) / dur); scrollTo({ top: H * k, behavior: 'instant' }); if (k < 1) requestAnimationFrame(f); else res(); };
      requestAnimationFrame(f); });
    frames.shift(); const avg = frames.reduce((a, b) => a + b, 0) / frames.length; const sorted = [...frames].sort((a, b) => a - b);
    return { fps: +(1000 / avg).toFixed(1), quadros: frames.length, p95ms: Math.round(sorted[Math.floor(sorted.length * .95)]), maiorQuadro: Math.round(sorted.at(-1)), acima50ms: frames.filter((x) => x > 50).length, tarefasLongas: __perf.long.length - before, msTarefasLongas: __perf.long.slice(before).reduce((a, [, d]) => a + d, 0), desenhosFundoPorSeg: +((window.__bgDraws - d0) / 8).toFixed(1) };
  });
  const ms1 = await gm(); scroll.cpuOcupadaPct = Math.round((ms1.TaskDuration - ms0.TaskDuration) / ((Date.now() - ts0) / 1000) * 100);
  await page.waitForTimeout(3000);
  const scrollProfile = (await cdp.send('Profiler.stop')).profile;
  // repouso no meio da página: CPU gasta em 5 s sem fazer nada (animações contínuas)
  await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(1500);
  const g = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  const a = await g(); await page.waitForTimeout(5000); const b = await g();
  const repouso = { cpuOcupadaPct: Math.round((b.TaskDuration - a.TaskDuration) / 5 * 100), cpuScriptMs5s: Math.round((b.ScriptDuration - a.ScriptDuration) * 1000), cpuTarefasMs5s: Math.round((b.TaskDuration - a.TaskDuration) * 1000), layoutsMs5s: Math.round((b.LayoutDuration - a.LayoutDuration) * 1000), estiloMs5s: Math.round((b.RecalcStyleDuration - a.RecalcStyleDuration) * 1000) };
  const all = [...reqs.values()];
  const peso = (list) => { const o = {}; for (const r of list) { const k = bucket(r.url, r.type); o[k] = o[k] || { kb: 0, n: 0 }; o[k].kb += r.bytes / 1024; o[k].n++; } for (const k in o) o[k].kb = Math.round(o[k].kb); return o; };
  const sum = (list) => Math.round(list.reduce((x, r) => x + r.bytes, 0) / 1024);
  const tLoad = perf.load; // ms desde navegação
  const navT = reqAtIdle[0]?.t0 || 0;
  const ateLoad = reqAtIdle.filter((r) => (r.t0 - navT) * 1000 <= tLoad);
  const res = {
    cenario: s.name, fonte: FONT,
    fcp: Math.round(perf.fcp), lcp: Math.round(perf.lcp), lcpEl: perf.lcpEl, cls: +perf.cls.toFixed(3), dcl: Math.round(perf.dcl), load: Math.round(perf.load),
    tbt, responsiva: Math.round(tti2), tarefasLongas: longs.length, maiorTarefa: Math.max(0, ...longs.map(([, d]) => d)),
    reqAteLoad: ateLoad.length, kbAteLoad: sum(ateLoad), reqEm12s: reqAtIdle.length, kbEm12s: sum(reqAtIdle), reqTotal: all.length, kbTotal: sum(all),
    pesoEm12s: peso(reqAtIdle), bloqueiaRender: [...new Set(blocking)], falhas: all.filter((r) => r.failed).map((r) => r.url.slice(0, 80) + ' ' + r.failed),
    rolagem: scroll, repouso, perfilCarga: aggProfile(loadProfile), perfilRolagem: aggProfile(scrollProfile, 8),
    maioresArquivos: all.sort((x, y) => y.bytes - x.bytes).slice(0, 10).map((r) => [r.url.replace(/^.*localhost:\d+/, ''), Math.round(r.bytes / 1024)]),
  };
  await browser.close();
  return res;
}

const results = [];
for (const s of SCEN) { const r = await run(s); results.push(r); console.error(`${r.cenario}: FCP ${r.fcp} LCP ${r.lcp} TBT ${r.tbt} resp ${r.responsiva} kb12s ${r.kbEm12s} fps ${r.rolagem.fps}`); }
if (out) writeFileSync(out, JSON.stringify(results, null, 2));
else console.log(JSON.stringify(results, null, 2));
srv.close();
