/**
 * 🏀 Sneaker Deal Finder — Render 版
 * 跑在 Render 上（非 CF 网络，能抓 StockX）
 */
import express from 'express';

const app = express();
const PORT = process.env.PORT || 3000;

// ── 配置 ──
const RATES = { USD: 7.25, GBP: 9.10, EUR: 7.85, JPY: 0.048 };

const SHIPPING = {
  stockx:  { name: 'StockX',    fee: 290, freeAt: null, note: '运费约 $40，关税另计' },
  goat:    { name: 'GOAT',      fee: 255, freeAt: null, note: '运费约 $35-45，关税另计' },
  end:     { name: 'END.',       fee: 90, freeAt: 2300, note: '满 £250 免邮，可能被税' },
  farfetch:{ name: 'Farfetch',  fee: 180, freeAt: null, note: 'DDP 含税，清关无忧' },
};

const BRANDS = [
  { id: 'converse', name: 'Converse', icon: '⭐', color: '#e74c3c', query: 'Converse' },
  { id: 'vans', name: 'Vans', icon: '🛹', color: '#d35400', query: 'Vans' },
  { id: 'adidas', name: 'Adidas', icon: '👟', color: '#000', query: 'Adidas' },
  { id: 'nike', name: 'Nike', icon: '🏃', color: '#e67e22', query: 'Nike' },
  { id: 'newbalance', name: 'New Balance', icon: '👟', color: '#636e72', query: 'New Balance' },
  { id: 'asics', name: 'ASICS', icon: '🏅', color: '#0984e3', query: 'ASICS' },
];

function fmt(v) { return '¥' + Math.round(v).toLocaleString('en-US'); }

function calcTax(priceCNY, shipCNY, incl) {
  if (incl) return { tax: 0, note: '已含税 ✓' };
  const total = priceCNY + shipCNY;
  const pt = total * 0.30;
  if (pt < 50) return { tax: 0, note: `行邮税 ${Math.round(pt)}元 < 50 免征 ✓` };
  const ct = total * 0.091;
  if (ct < pt) return { tax: ct, note: `跨境综合税 9.1% ≈ ¥${Math.round(ct)}` };
  return { tax: pt, note: `行邮税 30% ≈ ¥${Math.round(pt)}` };
}

// ── 爬虫 ──
async function getStockXProducts(query, limit = 20) {
  try {
    const url = `https://stockx.com/api/browse?productCategory=sneakers&_search=${encodeURIComponent(query)}&sort=price_asc&limit=${limit}`;
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Accept': 'application/json',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
    });
    if (!r.ok) return [];
    const data = await r.json();
    return (data.Products || []).map(p => {
      const price = p.market?.lowestAsk || 0;
      if (!price) return null;
      return {
        id: p.urlKey || '',
        name: p.title || p.name || '',
        priceUSD: price,
        priceCNY: Math.round(price * RATES.USD),
        thumb: p.media?.thumbUrl || p.media?.smallImageUrl || p.media?.imageUrl || '',
        url: p.urlKey ? `https://stockx.com/${p.urlKey}` : '',
      };
    }).filter(Boolean);
  } catch (e) {
    console.error('StockX catalog error:', e.message);
    return [];
  }
}

async function comparePrice(query) {
  async function stockx(q) {
    try {
      const u = `https://stockx.com/api/browse?productCategory=sneakers&_search=${encodeURIComponent(q)}&sort=price_asc&limit=3`;
      const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } });
      if (!r.ok) return [];
      return ((await r.json()).Products || []).slice(0, 3).map(p => ({
        platform: 'stockx', pname: 'StockX', name: p.title || q, size: p.shoeSize || '',
        priceCNY: Math.round((p.market?.lowestAsk || 0) * RATES.USD), priceOrig: p.market?.lowestAsk || 0, curr: 'USD',
        url: p.urlKey ? `https://stockx.com/${p.urlKey}` : '',
      })).filter(p => p.priceCNY > 0);
    } catch { return []; }
  }
  async function goat(q) {
    try {
      const r = await fetch('https://www.goat.com/web-api/v1/search', {
        method: 'POST', headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, filters: {}, page: 0, sort: 'price_asc' }),
      });
      if (!r.ok) return [];
      return ((await r.json()).results || []).slice(0, 3).map(p => ({
        platform: 'goat', pname: 'GOAT', name: p.name || q, size: (p.size_options || []).slice(0, 3).map(s => s.size).join(', ') || '',
        priceCNY: Math.round((p.lowest_price_cents || 0) / 100 * RATES.USD), priceOrig: (p.lowest_price_cents || 0) / 100, curr: 'USD',
        url: p.slug ? `https://www.goat.com/sneakers/${p.slug}` : '',
      })).filter(p => p.priceCNY > 0);
    } catch { return []; }
  }
  async function farfetch(q) {
    try {
      const u = `https://www.farfetch.com/plpslice/search?query=${encodeURIComponent(q)}&view=product&sort=price-asc&limit=3`;
      const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } });
      if (!r.ok) return [];
      const d = await r.json();
      const items = d.listingItems || d.products || (Array.isArray(d) ? d : []);
      return items.slice(0, 3).map(p => {
        if (typeof p === 'string') return null;
        const price = p.price?.amount || 0;
        if (!price) return null;
        return { platform: 'farfetch', pname: 'Farfetch', name: (p.shortDescription || p.name || q), size: '',
          priceCNY: Math.round(price), priceOrig: price, curr: 'CNY',
          url: p.id ? `https://www.farfetch.com/cn/shopping/item-${p.id}.aspx` : '',
        };
      }).filter(Boolean);
    } catch { return []; }
  }

  const [sx, gt, ff] = await Promise.all([stockx(query), goat(query), farfetch(query)]);
  return [...sx, ...gt, ...ff].map(item => {
    const rule = SHIPPING[item.platform] || { fee: 200, freeAt: null, note: '' };
    const sf = (rule.freeAt && item.priceCNY >= rule.freeAt) ? 0 : rule.fee;
    const tax = calcTax(item.priceCNY, sf, item.platform === 'farfetch');
    return { ...item, shippingCNY: sf, taxCNY: tax.tax, totalCNY: item.priceCNY + sf + tax.tax, note: `${rule.note || ''} | ${tax.note}` };
  }).sort((a, b) => a.totalCNY - b.totalCNY);
}

// ── CSS ──
const CSS = `*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;background:#0a0a0a;color:#e0e0e0;min-height:100vh}
.header{padding:20px 24px;border-bottom:1px solid #1a1a1a;position:sticky;top:0;background:#0a0a0a;z-index:10}
.header h1{font-size:1.5rem;background:linear-gradient(135deg,#f97316,#ef4444);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.header p{color:#666;font-size:.85rem;margin-top:4px}
.brand-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;padding:20px;max-width:1000px;margin:0 auto}
.brand-card{background:#141414;border-radius:16px;padding:28px 16px;text-align:center;text-decoration:none;color:#e0e0e0;transition:all .2s;border:1px solid #1a1a1a;display:block}
.brand-card:hover{transform:translateY(-2px);border-color:var(--accent);background:#1a1a1a}
.brand-icon{font-size:2.5rem;margin-bottom:12px}
.brand-name{font-size:1rem;font-weight:600}
.product-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:14px;padding:20px;max-width:1200px;margin:0 auto}
.product-card{background:#141414;border-radius:14px;overflow:hidden;text-decoration:none;color:#e0e0e0;transition:all .2s;border:1px solid #1a1a1a;display:block}
.product-card:hover{transform:translateY(-2px);border-color:#f97316}
.product-img{width:100%;aspect-ratio:1;object-fit:contain;background:#1a1a1a}
.product-info{padding:10px 12px}
.product-name{font-size:.85rem;font-weight:500;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-bottom:6px}
.product-price{font-size:1.05rem;font-weight:700;color:#f97316}
.back-btn{display:inline-flex;align-items:center;gap:6px;color:#888;text-decoration:none;padding:8px 16px;border-radius:8px;background:#141414;font-size:.9rem;margin:16px 24px}
.back-btn:hover{color:#fff}
.compare-page{max-width:800px;margin:0 auto;padding:20px}
.compare-card{background:#141414;border-radius:14px;padding:18px;margin-bottom:12px;border-left:4px solid #333}
.compare-card.best{border-left-color:#22c55e;background:#0d1a0d}
.compare-card h3{font-size:1.05rem;margin-bottom:6px}
.compare-card .row{display:flex;flex-wrap:wrap;gap:10px;color:#888;font-size:.85rem;margin-bottom:4px}
.compare-card .total{font-size:1.2rem;font-weight:700;color:#f97316;margin-top:8px}
.compare-card.best .total{color:#22c55e}
.compare-card .link{display:inline-block;margin-top:8px;color:#60a5fa;text-decoration:none;font-size:.9rem}
.loading{text-align:center;padding:60px;color:#666}
.spinner{display:inline-block;width:30px;height:30px;border:3px solid #333;border-top-color:#f97316;border-radius:50%;animation:spin .8s linear infinite;margin-bottom:12px}
@keyframes spin{to{transform:rotate(360deg)}}
.tip{background:#141414;border-radius:12px;padding:16px;margin:24px 20px;color:#666;font-size:.82rem}
.tip strong{color:#f97316}
.search-bar{display:flex;gap:8px;padding:12px 24px;max-width:600px;margin:16px auto}
.search-bar input{flex:1;padding:12px 16px;border-radius:10px;border:1px solid #222;background:#141414;color:#fff;font-size:1rem;outline:none}
.search-bar input:focus{border-color:#f97316}
.search-bar button{padding:12px 20px;border-radius:10px;border:none;background:linear-gradient(135deg,#f97316,#ef4444);color:#fff;font-weight:600;cursor:pointer}
@media(max-width:600px){.brand-grid{grid-template-columns:repeat(2,1fr)}.product-grid{grid-template-columns:repeat(2,1fr)}.header h1{font-size:1.2rem}}`;

// ── HTML 页面 ──
function homeHTML() {
  const cards = BRANDS.map(b =>
    `<a href="/browse/${b.id}" class="brand-card" style="--accent:${b.color}"><div class="brand-icon">${b.icon}</div><div class="brand-name">${b.name}</div></a>`
  ).join('');
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>🏀 Sneaker Deal Finder</title><style>${CSS}</style></head><body>
<div class="header"><h1>🏀 Sneaker Deal Finder</h1><p>选品牌 → 挑款式 → 跨平台比价（StockX · GOAT · Farfetch）</p></div>
<div class="search-bar"><input id="q" placeholder="或直接搜鞋款…" /><button onclick="location.href='/browse?q='+encodeURIComponent(document.getElementById('q').value)">🔍</button></div>
<div class="brand-grid">${cards}</div>
<div class="tip">💡 Server 跑在 Render 上，直连海外。商品数据来自 StockX；比价覆盖 StockX / GOAT / Farfetch。<br>⚠️ 关税为估算，实际以海关核定为准。</div>
</body></html>`;
}

function browseHTML(query, products) {
  const pics = products.length > 0 ? products.map(p =>
    `<a href="/compare/${encodeURIComponent(p.id)}?name=${encodeURIComponent(p.name)}" class="product-card">
      <img class="product-img" src="${p.thumb}" alt="${p.name}" loading="lazy" onerror="this.style.background='#222'" />
      <div class="product-info"><div class="product-name">${p.name}</div><div class="product-price">${fmt(p.priceCNY)} <span style="font-size:.7rem;color:#666;font-weight:400">起</span></div></div></a>`
  ).join('') : '<div class="loading"><div class="spinner"></div><p>没拉到数据 — 可能 StockX 抽风了，刷新试试</p></div>';

  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${query} — SF</title><style>${CSS}</style></head><body>
<div class="header"><h1>🔍 ${query}</h1><p>${products.length} 款 · 点击查看跨平台比价</p></div>
<a href="/" class="back-btn">← 返回首页</a>
<div class="product-grid">${pics}</div>
</body></html>`;
}

function compareHTML(name, urlKey) {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>比价 — ${name}</title><style>${CSS}</style></head><body>
<div class="header"><h1>🔍 正在比价…</h1><p>${name}</p></div>
<a href="javascript:history.back()" class="back-btn">← 返回</a>
<div class="compare-page" id="content"><div class="loading"><div class="spinner"></div><p>正在抓取 StockX / GOAT / Farfetch …</p></div></div>
${urlKey ? `<div class="tip" style="text-align:center"><a class="link" href="https://stockx.com/${urlKey}" target="_blank" style="color:#60a5fa">🔗 在 StockX 查看原商品 →</a></div>` : ''}
<script>
(async function(){
  try {
    const resp = await fetch('/api/compare?q=${encodeURIComponent(name)}');
    const data = await resp.json();
    if (!data.results || !data.results.length) {
      document.getElementById('content').innerHTML = '<div class="loading"><p>😕 各平台暂无此商品<br><small>换个款式试试</small></p></div>';
      return;
    }
    let html = '';
    data.results.forEach((r, i) => {
      html += '<div class="compare-card' + (i===0?' best':'') + '">';
      html += '<h3>' + (i===0?'🏆 ':'') + r['平台'] + ' — ' + r['商品'] + '</h3>';
      html += '<div class="row"><span>👟 ' + (r['尺码'] || '多码可选') + '</span><span>💰 ' + r['原价'] + '</span></div>';
      html += '<div class="row"><span>🚚 ' + r['运费'] + '</span><span>🏛️ ' + r['关税'] + '</span></div>';
      html += '<div class="total">到手 ' + r['到手总价'] + '</div>';
      html += '<div class="row" style="color:#888;font-size:.8rem">📝 ' + r['备注'] + '</div>';
      if (r['链接']) html += '<a class="link" href="' + r['链接'] + '" target="_blank">🔗 去购买 →</a>';
      html += '</div>';
    });
    document.getElementById('content').innerHTML = html;
    document.querySelector('.header h1').textContent = '🏆 比价结果';
  } catch(e) {
    document.getElementById('content').innerHTML = '<div class="loading"><p>❌ 加载失败: ' + e.message + '</p></div>';
  }
})();
</script></body></html>`;
}

// ── 路由 ──
app.get('/', (req, res) => res.send(homeHTML()));

app.get('/browse/:brand', async (req, res) => {
  const brand = BRANDS.find(b => b.id === req.params.brand);
  const query = brand ? brand.query : req.params.brand;
  const products = await getStockXProducts(query);
  res.send(browseHTML(query, products));
});

app.get('/browse', async (req, res) => {
  const q = req.query.q || '';
  if (!q) return res.redirect('/');
  const products = await getStockXProducts(q);
  res.send(browseHTML(q, products));
});

app.get('/compare/:id', (req, res) => {
  const name = req.query.name || decodeURIComponent(req.params.id);
  res.send(compareHTML(name, req.params.id));
});

app.get('/api/compare', async (req, res) => {
  const q = req.query.q;
  if (!q) return res.status(400).json({ error: 'missing q' });
  const results = await comparePrice(q);
  res.json({
    query: q, count: results.length,
    summary: results.length > 0 ? `🏆 最低: ${results[0].pname} ${fmt(results[0].totalCNY)}` : '未找到',
    results: results.map(r => ({
      '平台': r.pname, '商品': r.name, '尺码': r.size || '多码可选',
      '原价': `${r.priceOrig.toFixed(2)} ${r.curr} → ${fmt(r.priceCNY)}`,
      '运费': fmt(r.shippingCNY), '关税': fmt(r.taxCNY),
      '到手总价': fmt(r.totalCNY), '链接': r.url, '备注': r.note,
    })),
  });
});

// 调试：直接看 StockX 返回什么
app.get('/debug', async (req, res) => {
  try {
    const u = `https://stockx.com/api/browse?productCategory=sneakers&_search=converse&limit=3`;
    const r = await fetch(u, {
      headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15', 'Accept': 'application/json' },
    });
    const text = await r.text();
    res.json({
      stockx_status: r.status,
      ok: r.ok,
      body_len: text.length,
      body_preview: text.substring(0, 800),
    });
  } catch (e) {
    res.json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`🏀 Sneaker Deal Finder running on port ${PORT}`));
