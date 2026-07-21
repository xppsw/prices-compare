/**
 * 🏀 Sneaker Deal Finder — 本地 Playwright 版
 * 真实浏览器抓取 StockX + GOAT + Farfetch
 * 用法: npm start → 浏览器打开 http://localhost:3000
 * 要求: 挂 VPN（本机浏览器需要访问海外网站）
 */
import express from 'express';
import { chromium } from 'playwright';

const app = express();
const PORT = 3000;

// ── 全局浏览器实例（复用，不重启） ──
let browser = null;

async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  const context = await chromium.launchPersistentContext('./.chrome-data', {
    headless: false,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  browser = { context, isConnected: () => true };
  return browser;
}

// ── 工具 ──
const USD_CNY = 7.25;
function fmt(v) { return '¥' + Math.round(v).toLocaleString('en-US'); }
function fmtUSD(v) { return '$' + v.toFixed(2); }

// ── 到手价计算 ──
function calcTotal(priceCNY, shipCNY, dutiesIncluded = false) {
  if (dutiesIncluded) return { shipCNY, tax: 0, total: priceCNY + shipCNY, note: '已含税 ✓' };
  const sub = priceCNY + shipCNY;
  const pt = sub * 0.30;
  if (pt < 50) return { shipCNY, tax: 0, total: sub, note: `行邮税 ${Math.round(pt)} 元 < 50 免征 ✓` };
  const ct = Math.round(sub * 0.091);
  return { shipCNY, tax: ct, total: sub + ct, note: `跨境综合税 9.1% ≈ ¥${ct}` };
}

// ──= StockX 爬虫 =─
async function scrapeStockX(query) {
  const b = await getBrowser();
  const page = await b.context.newPage();
  try {
    await page.goto(`https://stockx.com/search?s=${encodeURIComponent(query)}`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    // 先保存截图调试
    await page.screenshot({ path: `G:/compare/debug_stockx_${Date.now()}.png`, fullPage: false });

    // 提取页面关键文本调试
    const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));

    const products = await page.evaluate(() => {
      const items = [];
      // StockX 用各种 class 名，暴力搜所有 a 标签带 href 包含 /buy/ 的
      const links = document.querySelectorAll('a[href*="/buy/"]');
      links.forEach(a => {
        const name = a.querySelector('p, span, div')?.textContent?.trim() || a.textContent?.trim()?.slice(0, 60);
        const priceText = a.textContent?.match(/\$\d{1,3}(?:,\d{3})*(?:\.\d{2})?/)?.[0];
        const price = priceText ? parseFloat(priceText.replace(/[$,]/g, '')) : 0;
        const img = a.querySelector('img')?.src || '';
        if (name && price > 10) items.push({ name, price, img, link: a.href });
      });
      return items;
    });

    console.log('StockX debug:', { query, bodyPreview: bodyText.slice(0, 200), productCount: products.length });

    await page.close();
    return products.slice(0, 20).map(p => ({
      id: Buffer.from(p.link).toString('base64').slice(0, 20),
      name: p.name,
      priceUSD: p.price,
      priceCNY: Math.round(p.price * USD_CNY),
      thumb: p.img,
      url: p.link,
      source: 'StockX',
    }));
  } catch (e) {
    await page.close();
    console.error('StockX scrape error:', e.message);
    return [];
  }
}

// ──= GOAT 爬虫 =─
async function scrapeGOAT(query) {
  const b = await getBrowser();
  const page = await b.context.newPage();
  try {
    await page.goto(`https://www.goat.com/search?query=${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    const products = await page.evaluate(() => {
      const items = [];
      const cards = document.querySelectorAll('[data-testid="product-cell"], a[href*="/sneakers/"], div[class*="ProductCell"]');
      cards.forEach(card => {
        const name = card.querySelector('p, span[class*="name"], [class*="title"]')?.textContent?.trim();
        const priceText = card.textContent?.match(/\$\d+(?:,\d{3})*(?:\.\d{2})?/)?.[0];
        const price = priceText ? parseFloat(priceText.replace(/[$,]/g, '')) : 0;
        const img = card.querySelector('img')?.src || '';
        const link = card.closest('a')?.href || card.querySelector('a')?.href || '';
        if (name && price > 0) items.push({ name, price, img, link });
      });
      return items;
    });

    await page.close();
    return products.slice(0, 10).map(p => ({
      id: Buffer.from(p.link).toString('base64').slice(0, 20),
      name: p.name,
      priceUSD: p.price,
      priceCNY: Math.round(p.price * USD_CNY),
      thumb: p.img,
      url: p.link,
      source: 'GOAT',
    }));
  } catch (e) {
    await page.close();
    console.error('GOAT scrape error:', e.message);
    return [];
  }
}

// ──= Farfetch 爬虫 =─
async function scrapeFarfetch(query) {
  const b = await getBrowser();
  const page = await b.context.newPage();
  try {
    await page.goto(`https://www.farfetch.com/cn/shopping/search?q=${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    const products = await page.evaluate(() => {
      const items = [];
      const cards = document.querySelectorAll('[data-testid="productCard"], a[href*="/item-"], div[class*="ProductCard"]');
      cards.forEach(card => {
        const name = card.querySelector('p[class*="description"], [class*="title"], span[class*="name"]')?.textContent?.trim();
        const priceText = card.textContent?.match(/¥\s?[\d,]+/)?.[0];
        const price = priceText ? parseFloat(priceText.replace(/[¥,\s]/g, '')) : 0;
        const img = card.querySelector('img')?.src || '';
        const link = card.closest('a')?.href || card.querySelector('a')?.href || '';
        if (name && price > 0) items.push({ name, price, img, link });
      });
      return items;
    });

    await page.close();
    return products.slice(0, 10).map(p => ({
      id: Buffer.from(p.link).toString('base64').slice(0, 20),
      name: p.name,
      priceCNY: Math.round(p.price), // Farfetch CN 已是人民币
      priceUSD: p.price / USD_CNY,
      thumb: p.img,
      url: p.link,
      source: 'Farfetch',
      dutiesIncluded: true,
    }));
  } catch (e) {
    await page.close();
    console.error('Farfetch scrape error:', e.message);
    return [];
  }
}

// ── 跨平台比价 ──
async function comparePrice(query) {
  const [stockx, goat, farfetch] = await Promise.all([
    scrapeStockX(query).catch(() => []),
    scrapeGOAT(query).catch(() => []),
    scrapeFarfetch(query).catch(() => []),
  ]);

  const all = [...stockx.map(p => ({ ...p, platform: 'StockX', shipUSD: 40 })),
               ...goat.map(p => ({ ...p, platform: 'GOAT', shipUSD: 35 })),
               ...farfetch.map(p => ({ ...p, platform: 'Farfetch', shipUSD: 0, dutiesIncluded: true }))];

  return all.map(p => {
    const shipCNY = Math.round((p.shipUSD || 0) * USD_CNY);
    const cost = calcTotal(p.priceCNY, shipCNY, p.dutiesIncluded);
    return { ...p, shipCNY: cost.shipCNY, taxCNY: cost.tax, totalCNY: cost.total, note: cost.note };
  }).sort((a, b) => a.totalCNY - b.totalCNY);
}

// ── CSS （同框架，不在文件里重复了。用之前本地版的 CSS） ──
const CSS = `*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;background:#0a0a0a;color:#e0e0e0;min-height:100vh}
.topbar{position:sticky;top:0;z-index:100;background:#0a0a0a;border-bottom:1px solid #1a1a1a;padding:12px 16px;display:flex;align-items:center;gap:12px}
.topbar a.home{font-size:1.4rem;text-decoration:none;flex-shrink:0}
.topbar input{flex:1;padding:10px 14px;border-radius:8px;border:1px solid #222;background:#141414;color:#fff;font-size:.95rem;outline:none;min-width:0}
.topbar input:focus{border-color:#f97316}
.page{padding:20px;max-width:1300px;margin:0 auto}
h1{font-size:1.4rem;margin-bottom:16px;background:linear-gradient(135deg,#f97316,#ef4444);-webkit-background-clip:text;-webkit-text-fill-color:transparent;display:inline-block}
.cat-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-bottom:24px}
.cat-card{background:#141414;border-radius:14px;padding:24px 16px;text-align:center;text-decoration:none;color:#e0e0e0;transition:all .2s;border:1px solid #1a1a1a;display:block}
.cat-card:hover{transform:translateY(-2px);border-color:#f97316}
.cat-icon{font-size:2rem;margin-bottom:8px}.cat-name{font-size:.95rem;font-weight:600}
.tier-title{color:#888;font-size:.9rem;margin:20px 0 10px;padding-left:4px}
.brand-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;margin-bottom:20px}
.brand-chip{background:#141414;border:1px solid #1a1a1a;border-radius:10px;padding:10px 8px;text-align:center;text-decoration:none;color:#ccc;font-size:.82rem;transition:all .2s;display:block}
.brand-chip:hover{border-color:#f97316;color:#fff;background:#1a1a1a}
.product-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:14px}
.product-card{background:#141414;border-radius:12px;overflow:hidden;text-decoration:none;color:#e0e0e0;transition:all .2s;border:1px solid #1a1a1a;display:block}
.product-card:hover{transform:translateY(-2px);border-color:#f97316}
.product-img{width:100%;aspect-ratio:1;object-fit:contain;background:#1a1a1a}
.product-info{padding:10px 12px}
.product-name{font-size:.8rem;font-weight:500;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-bottom:4px;color:#ccc}
.product-price{font-size:1rem;font-weight:700;color:#f97316}
.product-sub{font-size:.7rem;color:#666;margin-top:2px}
.back-link{display:inline-flex;align-items:center;gap:6px;color:#888;text-decoration:none;padding:8px 0;font-size:.85rem;margin-bottom:12px}
.back-link:hover{color:#fff}
.loading{text-align:center;padding:60px;color:#666}
.spinner{display:inline-block;width:28px;height:28px;border:3px solid #333;border-top-color:#f97316;border-radius:50%;animation:spin .8s linear infinite;margin-bottom:12px}
@keyframes spin{to{transform:rotate(360deg)}}
.compare-card{background:#141414;border-radius:14px;padding:18px;margin-bottom:10px;border-left:4px solid #333}
.compare-card.best{border-left-color:#22c55e;background:#0d1a0d}
.compare-card h3{font-size:1rem;margin-bottom:8px}
.compare-card .row{display:flex;flex-wrap:wrap;gap:10px;color:#888;font-size:.82rem;margin-bottom:4px}
.compare-card .total{font-size:1.15rem;font-weight:700;color:#f97316;margin-top:6px}
.compare-card.best .total{color:#22c55e}
.compare-card .link{display:inline-block;margin-top:6px;color:#60a5fa;text-decoration:none;font-size:.85rem}
.tip{background:#141414;border-radius:10px;padding:14px;margin-top:20px;color:#666;font-size:.78rem;line-height:1.5}
.tip strong{color:#f97316}
@media(max-width:600px){.cat-grid{grid-template-columns:repeat(2,1fr)}.product-grid{grid-template-columns:repeat(2,1fr)}.brand-grid{grid-template-columns:repeat(3,1fr)}.topbar{padding:10px 12px}}`;

// ── 品牌数据（精简到鞋类为主，后续扩展） ──
const CATEGORIES = [
  {
    id: 'shoes', name: '鞋类', icon: '👟',
    tiers: [
      { name: '🔥 热门', brands: [
        { id:'nike', name:'Nike', query:'Nike' },
        { id:'adidas', name:'Adidas', query:'Adidas' },
        { id:'jordan', name:'Air Jordan', query:'Air Jordan' },
        { id:'converse', name:'Converse', query:'Converse' },
        { id:'vans', name:'Vans', query:'Vans' },
        { id:'newbalance', name:'New Balance', query:'New Balance' },
        { id:'yeezy', name:'Yeezy', query:'Yeezy' },
        { id:'puma', name:'Puma', query:'Puma' },
      ]},
      { name: '📈 趋势', brands: [
        { id:'asics', name:'ASICS', query:'ASICS' },
        { id:'reebok', name:'Reebok', query:'Reebok' },
        { id:'hoka', name:'Hoka', query:'Hoka' },
        { id:'on-running', name:'On Running', query:'On Running' },
        { id:'salomon', name:'Salomon', query:'Salomon' },
        { id:'under-armour', name:'Under Armour', query:'Under Armour' },
        { id:'saucony', name:'Saucony', query:'Saucony' },
        { id:'brooks', name:'Brooks', query:'Brooks' },
      ]},
      { name: '💎 小众', brands: [
        { id:'common-projects', name:'Common Projects', query:'Common Projects' },
        { id:'maison-margiela', name:'Maison Margiela', query:'Maison Margiela' },
        { id:'golden-goose', name:'Golden Goose', query:'Golden Goose' },
        { id:'veja', name:'Veja', query:'Veja' },
        { id:'diadora', name:'Diadora', query:'Diadora' },
      ]},
    ],
  },
  {
    id: 'clothing', name: '服饰', icon: '👔',
    tiers: [
      { name: '🔥 热门', brands: [
        { id:'carhartt', name:'Carhartt WIP', query:'Carhartt WIP' },
        { id:'stussy', name:'Stussy', query:'Stussy' },
        { id:'essentials', name:'Essentials', query:'Essentials' },
        { id:'thenorthface', name:'The North Face', query:'The North Face' },
        { id:'patagonia', name:'Patagonia', query:'Patagonia' },
        { id:'arcteryx', name:"Arc'teryx", query:"Arc'teryx" },
        { id:'ralph-lauren', name:'Ralph Lauren', query:'Ralph Lauren' },
        { id:'af', name:'A&F', query:'Abercrombie Fitch' },
      ]},
      { name: '📈 趋势', brands: [
        { id:'supreme', name:'Supreme', query:'Supreme' },
        { id:'palace', name:'Palace', query:'Palace' },
        { id:'fear-of-god', name:'Fear of God', query:'Fear of God' },
        { id:'bape', name:'BAPE', query:'BAPE' },
        { id:'kith', name:'Kith', query:'Kith' },
        { id:'noah', name:'Noah', query:'Noah' },
      ]},
      { name: '💎 小众', brands: [
        { id:'stone-island', name:'Stone Island', query:'Stone Island' },
        { id:'acne-studios', name:'Acne Studios', query:'Acne Studios' },
        { id:'visvim', name:'Visvim', query:'Visvim' },
        { id:'kapital', name:'Kapital', query:'Kapital' },
      ]},
    ],
  },
];

function findBrand(brandId) {
  for (const cat of CATEGORIES) {
    for (const tier of cat.tiers) {
      const b = tier.brands.find(b => b.id === brandId);
      if (b) return { brand: b, category: cat };
    }
  }
  return null;
}

// ── HTML ──
function shell(title, body, extra = '') {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><style>${CSS}</style></head><body>
<div class="topbar"><a href="/" class="home">🏀</a><input id="searchInput" placeholder="搜品牌、鞋款…（挂VPN）" onkeydown="if(event.key==='Enter')go()" /><button onclick="go()" style="background:none;border:none;color:#f97316;font-size:1.2rem;cursor:pointer;padding:4px 8px">🔍</button></div>
<script>function go(){const q=document.getElementById('searchInput').value.trim();if(q)location.href='/search?q='+encodeURIComponent(q)}</script>
${body}${extra}</body></html>`;
}

function homeHTML() {
  const cats = CATEGORIES.map(c =>
    `<a href="/category/${c.id}" class="cat-card"><div class="cat-icon">${c.icon}</div><div class="cat-name">${c.name}</div></a>`
  ).join('');
  return shell('🏀 Sneaker Deal Finder', `<div class="page"><h1>🏀 Sneaker Deal Finder</h1>
    <p style="color:#888;margin-bottom:20px">跨平台比价 StockX · GOAT · Farfetch | 直邮到手价</p>
    <div class="cat-grid">${cats}</div>
    <div class="tip">💡 本地 Playwright 真实浏览器抓取 · 需挂 VPN<br>
    ⚠️ 每次浏览品牌需等待 5-10 秒（浏览器加载页面）<br>
    🏆 点进商品可对比 StockX / GOAT / Farfetch 三个平台到手价</div></div>`);
}

function categoryHTML(cat) {
  const tiers = cat.tiers.map(t => `
    <div class="tier-title">${t.name}</div>
    <div class="brand-grid">${t.brands.map(b => `<a href="/brand/${b.id}" class="brand-chip">${b.name}</a>`).join('')}</div>
  `).join('');
  return shell(`${cat.icon} ${cat.name}`, `<div class="page"><h1>${cat.icon} ${cat.name}</h1>
    <a href="/" class="back-link">← 返回分类</a>${tiers}</div>`);
}

function brandHTML(brand, cat, data) {
  if (data.error) {
    return shell(`${brand.name}`, `<div class="page"><h1>${brand.name}</h1><a href="/category/${cat.id}" class="back-link">← 返回${cat.name}</a><div class="loading"><p>${data.error}</p></div></div>`);
  }
  const cards = (data.items || []).map(p => {
    const shipCNY = Math.round((p.shipUSD || 0) * USD_CNY);
    const cost = calcTotal(p.priceCNY, shipCNY, p.dutiesIncluded);
    return `<a href="/product/${encodeURIComponent(p.name)}?img=${encodeURIComponent(p.thumb)}&url=${encodeURIComponent(p.url)}" class="product-card">
      <img class="product-img" src="${p.thumb}" alt="${p.name}" loading="lazy" onerror="this.style.background='#222'" />
      <div class="product-info"><div class="product-name">${p.name}</div>
      <div class="product-price">${fmt(cost.total)} <span style="font-size:.65rem;color:#666;font-weight:400">到手</span></div>
      <div class="product-sub">${fmtUSD(p.priceUSD)} + 运费${fmtUSD(p.shipUSD||0)} | ${cost.note}</div></div></a>`;
  }).join('');
  return shell(`${brand.name}`, `<div class="page"><h1>${brand.name}</h1>
    <a href="/category/${cat.id}" class="back-link">← 返回${cat.name}</a>
    <p style="color:#888;font-size:.85rem;margin-bottom:12px">${(data.items||[]).length} 件 · StockX 最低价排序</p>
    <div class="product-grid">${cards || '<div class="loading"><p>没抓到数据，刷新试试</p></div>'}</div></div>`);
}

function compareHTML(name, img, stockxUrl) {
  return shell(name, `<div class="page"><a href="javascript:history.back()" class="back-link">← 返回</a>
    <h1>🔍 比价中…</h1>
    <div id="content"><div class="loading"><div class="spinner"></div><p>正在抓取 StockX / GOAT / Farfetch … (5-15秒)</p></div></div>
    <div class="tip">💡 价格含预估运费 + 关税 (行邮税30%，50元以下免征)</div>
    <script>
    (async function(){
      try {
        const resp = await fetch('/api/compare?q=${encodeURIComponent(name)}');
        const data = await resp.json();
        if (!data.results || !data.results.length) {
          document.getElementById('content').innerHTML = '<div class="loading"><p>😕 各平台均未找到此商品</p></div>';
          return;
        }
        let html = '';
        data.results.forEach((r, i) => {
          html += '<div class="compare-card' + (i===0?' best':'') + '">';
          html += '<h3>' + (i===0?'🏆 ':'') + r.platform + ' — ' + r.name + '</h3>';
          html += '<div class="row"><span>💰 ' + fmtUSD(r.priceUSD) + ' (' + fmt(r.priceCNY) + ')</span><span>🚚 ' + fmt(r.shipCNY) + '</span><span>🏛️ ' + r.note + '</span></div>';
          html += '<div class="total">到手 ' + fmt(r.totalCNY) + '</div>';
          if (r.url) html += '<a class="link" href="' + r.url + '" target="_blank">🔗 去购买 →</a>';
          html += '</div>';
        });
        document.getElementById('content').innerHTML = html;
        document.querySelector('h1').textContent = '🏆 比价结果';
      } catch(e) {
        document.getElementById('content').innerHTML = '<div class="loading"><p>❌ 失败: ' + e.message + '</p></div>';
      }
    })();
    </script></div>`);
}

function searchHTML(query, data) {
  if (data.error) return shell(`🔍 ${query}`, `<div class="page"><h1>🔍 ${query}</h1><a href="/" class="back-link">← 返回</a><div class="loading"><p>${data.error}</p></div></div>`);
  const cards = (data.items || []).map(p => `<a href="/product/${encodeURIComponent(p.name)}?img=${encodeURIComponent(p.thumb)}&url=${encodeURIComponent(p.url)}" class="product-card">
    <img class="product-img" src="${p.thumb}" alt="${p.name}" loading="lazy" onerror="this.style.background='#222'" />
    <div class="product-info"><div class="product-name">${p.name}</div><div class="product-price">${fmt(p.priceCNY)} <span style="font-size:.65rem;color:#666;font-weight:400">起</span></div>
    <div class="product-sub">${p.source}</div></div></a>`).join('');
  return shell(`🔍 ${query}`, `<div class="page"><h1>🔍 ${query}</h1><a href="/" class="back-link">← 返回</a>
    <p style="color:#888;font-size:.85rem;margin-bottom:12px">${(data.items||[]).length} 个结果 · StockX</p>
    <div class="product-grid">${cards || '<div class="loading"><p>无结果</p></div>'}</div></div>`);
}

// ── 路由 ──
app.get('/', (req, res) => res.send(homeHTML()));
app.get('/category/:id', (req, res) => {
  const cat = CATEGORIES.find(c => c.id === req.params.id);
  if (!cat) return res.redirect('/');
  res.send(categoryHTML(cat));
});

app.get('/brand/:id', async (req, res) => {
  const found = findBrand(req.params.id);
  if (!found) return res.redirect('/');
  const data = await scrapeStockX(found.brand.query);
  res.send(brandHTML(found.brand, found.category, { items: data }));
});

app.get('/product/:name', (req, res) => {
  res.send(compareHTML(req.params.name, req.query.img || '', req.query.url || ''));
});

app.get('/search', async (req, res) => {
  const q = req.query.q || '';
  if (!q.trim()) return res.redirect('/');
  const data = await scrapeStockX(q.trim());
  res.send(searchHTML(q.trim(), { items: data }));
});

app.get('/api/compare', async (req, res) => {
  const q = req.query.q;
  if (!q) return res.json({ error: 'missing q' });
  const results = await comparePrice(q);
  res.json({ query: q, count: results.length, results });
});

// 人机验证：弹 Chrome 窗口，让用户手动过
app.get('/setup', async (req, res) => {
  res.send(shell('验证', `<div class="page"><h1>🖐️ 手动验证</h1>
    <p style="color:#888;margin:12px 0">Chrome 窗口已弹出，在里面点一下 StockX 的验证按钮</p>
    <a href="/setup/check" class="btn" style="display:inline-block;width:auto;padding:12px 24px">✅ 点完这里继续</a></div>`));
});

app.get('/setup/check', async (req, res) => {
  try {
    const b = await getBrowser();
    const page = await b.context.newPage();
    await page.goto('https://stockx.com/search?s=nike', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2000);
    const body = await page.evaluate(() => document.body.innerText);
    const blocked = body.includes('login to continue') || body.includes('not a bot');
    await page.close();
    res.send(shell(blocked ? '❌ 失败' : '✅ 成功', `<div class="page">
      <h1>${blocked ? '❌ 还是被挡了，在弹窗里多点几下再试' : '🎉 验证成功！'}</h1>
      <a href="${blocked ? '/setup/check' : '/'}" class="btn" style="display:inline-block;width:auto;padding:12px 24px">${blocked ? '🔁 重试' : '🏀 开始使用'}</a></div>`));
  } catch (e) {
    res.send(shell('错误', `<div class="page"><h1>${e.message}</h1><a href="/" class="back-link">← 返回</a></div>`));
  }
});

// 启动
const server = app.listen(PORT, async () => {
  console.log(`\n🏀 Sneaker Deal Finder`);
  console.log(`   打开 → http://localhost:${PORT}`);
  console.log(`   确保已挂 VPN！`);
  console.log(`   第一步：先访问 → http://localhost:${PORT}/setup 过人机验证\n`);
  await getBrowser();
  console.log('   Chrome 已启动\n');
});

// 优雅关闭
process.on('SIGINT', async () => {
  if (browser) await browser.close();
  server.close();
  process.exit();
});
