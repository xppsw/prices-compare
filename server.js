/**
 * 🏀 Sneaker Deal Finder — Render 版
 * 从 StockX HTML 提取商品数据
 */
import express from 'express';

const app = express();
const PORT = process.env.PORT || 3000;

const CSS = `*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;background:#0a0a0a;color:#e0e0e0;min-height:100vh}
.header{padding:20px 24px;border-bottom:1px solid #1a1a1a;position:sticky;top:0;background:#0a0a0a;z-index:10}
.header h1{font-size:1.5rem;background:linear-gradient(135deg,#f97316,#ef4444);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.header p{color:#666;font-size:.85rem;margin-top:4px}
.brand-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;padding:20px;max-width:1000px;margin:0 auto}
.brand-card{background:#141414;border-radius:16px;padding:28px 16px;text-align:center;text-decoration:none;color:#e0e0e0;transition:all .2s;border:1px solid #1a1a1a;display:block}
.brand-card:hover{transform:translateY(-2px);border-color:var(--accent);background:#1a1a1a}
.brand-icon{font-size:2.5rem;margin-bottom:12px}.brand-name{font-size:1rem;font-weight:600}
.product-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:14px;padding:20px;max-width:1200px;margin:0 auto}
.product-card{background:#141414;border-radius:14px;overflow:hidden;text-decoration:none;color:#e0e0e0;transition:all .2s;border:1px solid #1a1a1a;display:block}
.product-card:hover{transform:translateY(-2px);border-color:#f97316}
.product-img{width:100%;aspect-ratio:1;object-fit:contain;background:#1a1a1a}
.product-info{padding:10px 12px}
.product-name{font-size:.85rem;font-weight:500;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-bottom:6px}
.product-price{font-size:1.05rem;font-weight:700;color:#f97316}
.back-btn{display:inline-flex;align-items:center;gap:6px;color:#888;text-decoration:none;padding:8px 16px;border-radius:8px;background:#141414;font-size:.9rem;margin:16px 24px}
.back-btn:hover{color:#fff}
.loading{text-align:center;padding:60px;color:#666}
.spinner{display:inline-block;width:30px;height:30px;border:3px solid #333;border-top-color:#f97316;border-radius:50%;animation:spin .8s linear infinite;margin-bottom:12px}
@keyframes spin{to{transform:rotate(360deg)}}
.tip{background:#141414;border-radius:12px;padding:16px;margin:24px 20px;color:#666;font-size:.82rem}
.tip strong{color:#f97316}
@media(max-width:600px){.brand-grid,.product-grid{grid-template-columns:repeat(2,1fr)}.header h1{font-size:1.2rem}}`;

const BRANDS = [
  { id: 'converse', name: 'Converse', icon: '⭐', color: '#e74c3c' },
  { id: 'vans', name: 'Vans', icon: '🛹', color: '#d35400' },
  { id: 'adidas', name: 'Adidas', icon: '👟', color: '#000' },
  { id: 'nike', name: 'Nike', icon: '🏃', color: '#e67e22' },
  { id: 'newbalance', name: 'New Balance', icon: '👟', color: '#636e72' },
  { id: 'asics', name: 'ASICS', icon: '🏅', color: '#0984e3' },
];

function fmt(v) { return '¥' + Math.round(v).toLocaleString('en-US'); }

// ── 从 StockX HTML 提取商品 ──
async function fetchProducts(query) {
  try {
    const r = await fetch(`https://stockx.com/search?s=${encodeURIComponent(query)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'Accept': 'text/html' },
    });
    if (!r.ok) return [];
    const html = await r.text();

    // 方案 1: 从 __NEXT_DATA__ JSON 提取
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*type="application\/json"[^>]*>([^<]+)<\/script>/);
    if (m) {
      try {
        const data = JSON.parse(m[1]);
        // 递归搜索所有包含 name/price/urlKey 的对象数组
        function findProducts(obj, depth) {
          if (depth > 8 || !obj || typeof obj !== 'object') return [];
          if (Array.isArray(obj) && obj.length > 0 && obj[0] && typeof obj[0] === 'object') {
            // 判断是不是商品：有 name 且有 price 或 urlKey
            if (obj[0].name && (obj[0].price || obj[0].urlKey || obj[0].slug || obj[0].lowestAsk)) {
              return obj;
            }
          }
          if (Array.isArray(obj)) {
            for (const item of obj) {
              const r = findProducts(item, depth + 1);
              if (r.length) return r;
            }
          } else {
            for (const k of Object.keys(obj)) {
              const r = findProducts(obj[k], depth + 1);
              if (r.length) return r;
            }
          }
          return [];
        }
        const products = findProducts(data, 0);
        if (products.length > 0) {
          return products.map(p => ({
            id: p.urlKey || p.slug || p.id || '',
            name: p.name || p.title || p.productName || '',
            priceCNY: Math.round((p.price || p.lowestAsk || p.retailPrice || 0) * 7.25),
            thumb: (p.media?.thumbUrl || p.media?.imageUrl || p.imageUrl || p.thumbnailUrl || ''),
            url: p.urlKey ? `https://stockx.com/${p.urlKey}` : '',
          })).filter(p => p.priceCNY > 0);
        }
      } catch {}
    }

    // 方案 2: 搜 HTML 中嵌入的 JSON-LD
    const ldMatch = html.match(/<script type="application\/ld\+json"[^>]*>([^<]+)<\/script>/g);
    if (ldMatch) {
      const products = [];
      for (const script of ldMatch.slice(0, 50)) {
        const json = script.match(/>([^<]+)</);
        if (json) {
          try {
            const d = JSON.parse(json[1]);
            if (d.name && d.offers) products.push(d);
          } catch {}
        }
      }
      if (products.length > 0) {
        return products.map(p => ({
          id: p.url || '',
          name: p.name,
          priceCNY: Math.round((parseFloat(p.offers?.price || 0)) * 7.25),
          thumb: p.image || '',
          url: p.url || '',
        })).filter(p => p.priceCNY > 0);
      }
    }

    return [];
  } catch (e) {
    console.error('fetchProducts error:', e.message);
    return [];
  }
}

// ── HTML 页面 ──
function homeHTML() {
  const cards = BRANDS.map(b =>
    `<a href="/browse/${b.id}" class="brand-card" style="--accent:${b.color}"><div class="brand-icon">${b.icon}</div><div class="brand-name">${b.name}</div></a>`
  ).join('');
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>🏀 Sneaker Deal Finder</title><style>${CSS}</style></head><body>
<div class="header"><h1>🏀 Sneaker Deal Finder</h1><p>选品牌 → 挑款式 → 查看价格（数据来自 StockX）</p></div>
<div class="brand-grid">${cards}</div>
<div class="tip">💡 部署在 Render 上，从 StockX 网页提取商品数据。<br>⚠️ 价格为 StockX 最低 ask 价，不含运费关税。实际到手价需加运费 ¥200-300 + 关税。</div>
</body></html>`;
}

function browseHTML(query, products) {
  const pics = products.length > 0 ? products.map(p =>
    `<a href="${p.url}" target="_blank" class="product-card">
      <img class="product-img" src="${p.thumb}" alt="${p.name}" loading="lazy" onerror="this.style.background='#222'" />
      <div class="product-info"><div class="product-name">${p.name}</div><div class="product-price">${fmt(p.priceCNY)} <span style="font-size:.7rem;color:#666;font-weight:400">起</span></div></div></a>`
  ).join('') : '<div class="loading"><div class="spinner"></div><p>没拉到数据 — 刷新试试</p></div>';

  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${query} — SF</title><style>${CSS}</style></head><body>
<div class="header"><h1>🔍 ${query}</h1><p>${products.length} 款 · 点击直接跳转 StockX</p></div>
<a href="/" class="back-btn">← 返回首页</a>
<div class="product-grid">${pics}</div>
</body></html>`;
}

// 调试：看 HTML 里有什么
app.get('/debug', async (req, res) => {
  const r = await fetch('https://stockx.com/search?s=converse', {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' },
  });
  const html = await r.text();
  // 搜价格
  const prices = html.match(/\$\d+(?:\.\d{2})?/g) || [];
  // 搜商品链接
  const urls = html.match(/\/[\w-]+\/[\w-]+-[a-f0-9]{8,}/g) || [];
  res.json({
    htmlLen: html.length,
    uniquePrices: [...new Set(prices)].slice(0, 20),
    uniqueUrls: [...new Set(urls)].slice(0, 10),
    hasNextData: !!html.match(/__NEXT_DATA__/),
    hasProductList: !!html.match(/"products"\s*:/),
    title: html.match(/<title>([^<]+)<\/title>/)?.[1] || '?',
  });
});

app.get('/', (req, res) => res.send(homeHTML()));

app.get('/browse/:brand', async (req, res) => {
  const brand = BRANDS.find(b => b.id === req.params.brand);
  const query = brand ? brand.name : req.params.brand;
  const products = await fetchProducts(query);
  res.send(browseHTML(query, products));
});

app.listen(PORT, () => console.log(`🏀 running on port ${PORT}`));
