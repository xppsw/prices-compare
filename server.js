/**
 * 🏀 Sneaker Deal Finder
 * 数据源：eBay Browse API（官方免费）
 * 部署：Render / 任何 Node.js 环境
 */

import express from 'express';
import crypto from 'crypto';

const app = express();
const PORT = process.env.PORT || 3000;

// ── eBay API 配置 ──
// 从环境变量读取，本地开发可以用 .env
const EBAY_CLIENT_ID = process.env.EBAY_CLIENT_ID || '';
const EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET || '';
const EBAY_TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const EBAY_API_URL = 'https://api.ebay.com/buy/browse/v1/item_summary/search';

// 汇率 (≈)
const USD_TO_CNY = 7.25;

let cachedToken = null;
let tokenExpiry = 0;

async function getEbayToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const auth = Buffer.from(`${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`).toString('base64');
  const resp = await fetch(EBAY_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${auth}`,
    },
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
  });

  if (!resp.ok) {
    console.error('eBay auth failed:', resp.status);
    return null;
  }

  const data = await resp.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 300) * 1000; // 提前 5 分钟刷新
  return cachedToken;
}

async function searchEbay(query, limit = 24) {
  if (!EBAY_CLIENT_ID) return { error: 'eBay API Key 未配置，请在环境变量中设置 EBAY_CLIENT_ID 和 EBAY_CLIENT_SECRET' };

  const token = await getEbayToken();
  if (!token) return { error: 'eBay 认证失败' };

  try {
    const url = `${EBAY_API_URL}?q=${encodeURIComponent(query)}&limit=${limit}&filter=conditions:{NEW},buyingOptions:{FIXED_PRICE}&sort=price`;
    const resp = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' },
    });

    if (!resp.ok) {
      console.error('eBay search error:', resp.status);
      return { error: `搜索失败 (${resp.status})` };
    }

    const data = await resp.json();
    return {
      items: (data.itemSummaries || []).map(item => ({
        id: item.itemId || '',
        name: item.title || '',
        priceUSD: parseFloat(item.price?.value || 0),
        priceCNY: Math.round(parseFloat(item.price?.value || 0) * USD_TO_CNY),
        thumb: item.image?.imageUrl || item.thumbnailImages?.[0]?.imageUrl || '',
        url: item.itemWebUrl || item.itemAffiliateWebUrl || `https://www.ebay.com/itm/${item.itemId}`,
        condition: item.condition || 'New',
        shippingUSD: parseFloat(item.shippingOptions?.[0]?.shippingCost?.value || 0),
        location: item.itemLocation?.country || '',
      })).filter(p => p.priceUSD > 0 && p.thumb),
      total: data.total || 0,
    };
  } catch (e) {
    console.error('eBay search exception:', e.message);
    return { error: e.message };
  }
}

// ── CSS ──
const CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;background:#0a0a0a;color:#e0e0e0;min-height:100vh}
.header{padding:20px 24px;border-bottom:1px solid #1a1a1a;position:sticky;top:0;background:#0a0a0a;z-index:10}
.header h1{font-size:1.5rem;background:linear-gradient(135deg,#f97316,#ef4444);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.header p{color:#666;font-size:.85rem;margin-top:4px}
.brand-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;padding:20px;max-width:1000px;margin:0 auto}
.brand-card{background:#141414;border-radius:16px;padding:28px 16px;text-align:center;text-decoration:none;color:#e0e0e0;transition:all .2s;border:1px solid #1a1a1a;display:block}
.brand-card:hover{transform:translateY(-2px);border-color:var(--accent);background:#1a1a1a}
.brand-icon{font-size:2.5rem;margin-bottom:12px}.brand-name{font-size:1rem;font-weight:600}
.search-bar{display:flex;gap:8px;padding:12px 24px;max-width:600px;margin:16px auto}
.search-bar input{flex:1;padding:12px 16px;border-radius:10px;border:1px solid #222;background:#141414;color:#fff;font-size:1rem;outline:none}
.search-bar input:focus{border-color:#f97316}
.search-bar button{padding:12px 20px;border-radius:10px;border:none;background:linear-gradient(135deg,#f97316,#ef4444);color:#fff;font-weight:600;cursor:pointer;font-size:1rem}
.product-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px;padding:20px;max-width:1300px;margin:0 auto}
.product-card{background:#141414;border-radius:14px;overflow:hidden;text-decoration:none;color:#e0e0e0;transition:all .2s;border:1px solid #1a1a1a;display:block}
.product-card:hover{transform:translateY(-2px);border-color:#f97316}
.product-img{width:100%;aspect-ratio:1;object-fit:contain;background:#1a1a1a}
.product-info{padding:10px 12px}
.product-name{font-size:.85rem;font-weight:500;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-bottom:4px}
.product-meta{font-size:.75rem;color:#888;margin-bottom:4px}
.product-price{font-size:1.05rem;font-weight:700;color:#f97316}
.product-ship{font-size:.75rem;color:#666}
.back-btn{display:inline-flex;align-items:center;gap:6px;color:#888;text-decoration:none;padding:8px 16px;border-radius:8px;background:#141414;font-size:.9rem;margin:16px 24px;border:none;cursor:pointer}
.back-btn:hover{color:#fff}
.loading{text-align:center;padding:60px;color:#666}
.spinner{display:inline-block;width:30px;height:30px;border:3px solid #333;border-top-color:#f97316;border-radius:50%;animation:spin .8s linear infinite;margin-bottom:12px}
@keyframes spin{to{transform:rotate(360deg)}}
.tip{background:#141414;border-radius:12px;padding:16px;margin:24px 20px;color:#666;font-size:.82rem;max-width:1200px;margin-left:auto;margin-right:auto}
.tip strong{color:#f97316}
.error-box{text-align:center;padding:60px;color:#e74c3c;max-width:500px;margin:0 auto}
.error-box code{display:block;margin-top:12px;padding:12px;background:#141414;border-radius:8px;color:#888;font-size:.85rem}
.badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:.7rem;font-weight:600;margin-left:6px}
.badge-new{background:#22c55e;color:#000}
.badge-ship{background:#f97316;color:#000}
@media(max-width:600px){.brand-grid{grid-template-columns:repeat(3,1fr)}.product-grid{grid-template-columns:repeat(2,1fr)}.header h1{font-size:1.2rem}}
`;

const BRANDS = [
  { id: 'converse', name: 'Converse', icon: '⭐', color: '#e74c3c', query: 'Converse sneakers' },
  { id: 'vans', name: 'Vans', icon: '🛹', color: '#d35400', query: 'Vans sneakers' },
  { id: 'adidas', name: 'Adidas', icon: '👟', color: '#2c3e50', query: 'Adidas sneakers' },
  { id: 'nike', name: 'Nike', icon: '🏃', color: '#e67e22', query: 'Nike sneakers' },
  { id: 'newbalance', name: 'New Balance', icon: '👟', color: '#636e72', query: 'New Balance sneakers' },
  { id: 'asics', name: 'ASICS', icon: '🏅', color: '#0984e3', query: 'ASICS sneakers' },
  { id: 'af', name: 'A&F', icon: '👕', color: '#2d3436', query: 'Abercrombie Fitch clothing' },
  { id: 'carhartt', name: 'Carhartt', icon: '🧥', color: '#e17055', query: 'Carhartt WIP clothing' },
  { id: 'stussy', name: 'Stussy', icon: '🎨', color: '#00b894', query: 'Stussy clothing' },
];

function fmt(v) { return '¥' + Math.round(v).toLocaleString('en-US'); }
function fmtUSD(v) { return '$' + v.toFixed(2); }

// ── 国内到手价估算 ──
function calcTotal(priceCNY, shippingUSD) {
  const shippingCNY = Math.round(shippingUSD * USD_TO_CNY);
  const subtotal = priceCNY + shippingCNY;
  const tax = subtotal * 0.30 < 50 ? 0 : Math.round(subtotal * 0.091); // 跨境电商综合税
  return {
    shippingCNY,
    taxCNY: tax,
    totalCNY: priceCNY + shippingCNY + tax,
    taxNote: tax === 0 ? '免税 ✓' : `综合税 9.1% ≈ ¥${tax}`,
  };
}

// ── HTML ──
function homeHTML() {
  const cards = BRANDS.map(b =>
    `<a href="/browse/${b.id}" class="brand-card" style="--accent:${b.color}"><div class="brand-icon">${b.icon}</div><div class="brand-name">${b.name}</div></a>`
  ).join('');
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>🏀 Sneaker Deal Finder</title><style>${CSS}</style></head><body>
<div class="header"><h1>🏀 Sneaker Deal Finder</h1><p>选品牌 → 选款式 → 看直邮中国到手价（数据来源：eBay）</p></div>
<div class="search-bar"><input id="q" placeholder="搜任意品牌或鞋款…" onkeydown="if(event.key==='Enter')go()" /><button onclick="go()">🔍</button></div>
<div class="brand-grid">${cards}</div>
<div class="tip">💡 全球 eBay 商品 · 价格每小时更新 · 自动估算直邮中国运费 + 关税<br>
⚠️ 关税按跨境电商综合税 9.1% 估算，实际以海关核定为准。<br>
🔗 <a href="https://github.com/xppsw/prices-compare" style="color:#60a5fa">开源代码 GitHub</a> | 一键部署到自己 Render</div>
<script>function go(){const q=document.getElementById('q').value.trim();if(q)location.href='/browse/search?q='+encodeURIComponent(q)}</script>
</body></html>`;
}

function browseHTML(query, data, isBrand = true) {
  if (data.error) {
    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>错误 — SF</title><style>${CSS}</style></head><body>
<div class="header"><h1>⚠️ 出错了</h1></div><a href="/" class="back-btn">← 返回首页</a>
<div class="error-box"><p>${data.error}</p>
<code>检查：EBAY_CLIENT_ID 和 EBAY_CLIENT_SECRET 环境变量是否已设置？<br>eBay 开发者账号审核通过了吗？</code></div></body></html>`;
  }

  const items = data.items || [];
  const cards = items.map(p => {
    const cost = calcTotal(p.priceCNY, p.shippingUSD);
    return `<a href="${p.url}" target="_blank" class="product-card">
      <img class="product-img" src="${p.thumb}" alt="${p.name}" loading="lazy" onerror="this.style.background='#222'" />
      <div class="product-info">
        <div class="product-name">${p.name}</div>
        <div class="product-meta">${p.location} ${p.condition === 'New' ? '<span class="badge badge-new">NEW</span>' : ''}</div>
        <div class="product-price">${fmt(cost.totalCNY)} <span style="font-size:.7rem;color:#666;font-weight:400">到手</span></div>
        <div class="product-ship">${fmtUSD(p.priceUSD)} + 运费${fmtUSD(p.shippingUSD)} | ${cost.taxNote}</div>
      </div></a>`;
  }).join('');

  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${query} — SF</title><style>${CSS}</style></head><body>
<div class="header"><h1>${isBrand ? BRANDS.find(b => b.id === query)?.icon + ' ' : ''}${isBrand ? BRANDS.find(b => b.id === query)?.name || query : '🔍 ' + query}</h1><p>${items.length} 款 · 到手价含运费+关税 · 排序：从低到高</p></div>
<a href="/" class="back-btn">← 返回首页</a>
<div class="product-grid">${cards || '<div class="loading"><div class="spinner"></div><p>暂无商品</p></div>'}</div>
<div class="tip">💡 到手价 = 商品价格 + 国际运费 + 预估关税（跨境电商综合税 9.1%）<br>点击卡片跳转 eBay 商品页。运费为估算值，实际以卖家设置为准。</div>
</body></html>`;
}

// ── 路由 ──
app.get('/', (req, res) => res.send(homeHTML()));

app.get('/browse/:id', async (req, res) => {
  const brand = BRANDS.find(b => b.id === req.params.id);
  const q = brand ? brand.query : req.params.id;
  const data = await searchEbay(q);
  res.send(browseHTML(req.params.id, data, !!brand));
});

app.get('/browse/search', async (req, res) => {
  const q = req.query.q || 'sneakers';
  const data = await searchEbay(q);
  res.send(browseHTML(q, data, false));
});

// ── 健康检查 ──
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    ebayConfigured: !!EBAY_CLIENT_ID,
    uptime: process.uptime(),
  });
});

app.listen(PORT, () => {
  console.log(`🏀 Sneaker Deal Finder on port ${PORT}`);
  console.log(`   eBay API: ${EBAY_CLIENT_ID ? '✅ configured' : '❌ not configured'}`);
});
