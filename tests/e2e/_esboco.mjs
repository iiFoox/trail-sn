import { chromium } from 'playwright';
const S='/tmp/claude-0/-home-claude/1355b350-d507-52b2-99e3-d63903bae67d/scratchpad/';
const b = await chromium.launch({ channel: 'chromium' });
const p = await b.newPage({ viewport: { width: 1700, height: 800 }, deviceScaleFactor: 2 });
await p.goto('file://' + S + 'esboco2.html');
await p.screenshot({ path: S + 'esboco-abas.png', fullPage: true });
await b.close();
