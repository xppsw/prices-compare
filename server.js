/**
 * 🏀 Sneaker Deal Finder
 * 得物式体验：分类 → 品牌 → 图墙选款 → 到手价比价
 * 数据源：eBay Browse API | 托管：Render
 */
import express from 'express';

const app = express();
const PORT = process.env.PORT || 3000;

// ── eBay API ──
const EBAY_CLIENT_ID = process.env.EBAY_CLIENT_ID || '';
const EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET || '';
const USD_CNY = 7.25;
let cachedToken = null;
let tokenExpiry = 0;

async function ebayToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const auth = Buffer.from(`${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`).toString('base64');
  const r = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': `Basic ${auth}` },
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
  });
  if (!r.ok) return null;
  const d = await r.json();
  cachedToken = d.access_token;
  tokenExpiry = Date.now() + (d.expires_in - 300) * 1000;
  return cachedToken;
}

async function searchEbay(query, limit = 24, sort = 'price') {
  if (!EBAY_CLIENT_ID) return { error: 'API Key 未配置' };
  const token = await ebayToken();
  if (!token) return { error: 'eBay 认证失败' };
  try {
    const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(query)}&limit=${limit}&filter=conditions:{NEW},buyingOptions:{FIXED_PRICE}&sort=${sort}`;
    const r = await fetch(url, { headers: { 'Authorization': `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' } });
    if (!r.ok) return { error: `搜索失败 (${r.status})` };
    const d = await r.json();
    return {
      items: (d.itemSummaries || []).map(item => ({
        id: item.itemId,
        name: item.title || '',
        priceUSD: parseFloat(item.price?.value || 0),
        priceCNY: Math.round(parseFloat(item.price?.value || 0) * USD_CNY),
        thumb: item.image?.imageUrl || item.thumbnailImages?.[0]?.imageUrl || '',
        url: item.itemWebUrl || `https://www.ebay.com/itm/${item.itemId}`,
        shippingUSD: parseFloat(item.shippingOptions?.[0]?.shippingCost?.value || 0),
        location: item.itemLocation?.country || '',
      })).filter(p => p.priceUSD > 0 && p.thumb),
      total: d.total || 0,
    };
  } catch (e) { return { error: e.message }; }
}

function calcTotal(priceCNY, shippingUSD) {
  const sCNY = Math.round(shippingUSD * USD_CNY);
  const sub = priceCNY + sCNY;
  const tax = sub * 0.30 < 50 ? 0 : Math.round(sub * 0.091);
  return { sCNY, tax, total: priceCNY + sCNY + tax, note: tax === 0 ? '免税 ✓' : `含税 ¥${tax}` };
}

function fmt(v) { return '¥' + Math.round(v).toLocaleString('en-US'); }
function fmtUSD(v) { return '$' + v.toFixed(2); }

// ── 品牌数据库 ──
const CATEGORIES = [
  {
    id: 'shoes', name: '鞋类', icon: '👟',
    tiers: [
      { name: '🔥 热门', brands: [
        { id:'nike', name:'Nike', query:'Nike sneakers' },
        { id:'adidas', name:'Adidas', query:'Adidas sneakers' },
        { id:'jordan', name:'Air Jordan', query:'Air Jordan sneakers' },
        { id:'converse', name:'Converse', query:'Converse sneakers' },
        { id:'vans', name:'Vans', query:'Vans sneakers' },
        { id:'newbalance', name:'New Balance', query:'New Balance sneakers' },
        { id:'yeezy', name:'Yeezy', query:'Yeezy sneakers' },
        { id:'puma', name:'Puma', query:'Puma sneakers' },
      ]},
      { name: '📈 趋势', brands: [
        { id:'asics', name:'ASICS', query:'ASICS sneakers' },
        { id:'reebok', name:'Reebok', query:'Reebok sneakers' },
        { id:'hoka', name:'Hoka', query:'Hoka sneakers' },
        { id:'on-running', name:'On Running', query:'On Running sneakers' },
        { id:'salomon', name:'Salomon', query:'Salomon sneakers' },
        { id:'under-armour', name:'Under Armour', query:'Under Armour sneakers' },
        { id:'saucony', name:'Saucony', query:'Saucony sneakers' },
        { id:'brooks', name:'Brooks', query:'Brooks sneakers' },
      ]},
      { name: '💎 小众', brands: [
        { id:'common-projects', name:'Common Projects', query:'Common Projects sneakers' },
        { id:'maison-margiela', name:'Maison Margiela', query:'Maison Margiela sneakers' },
        { id:'golden-goose', name:'Golden Goose', query:'Golden Goose sneakers' },
        { id:'veja', name:'Veja', query:'Veja sneakers' },
        { id:'axel-arigato', name:'Axel Arigato', query:'Axel Arigato sneakers' },
        { id:'diadora', name:'Diadora', query:'Diadora sneakers' },
        { id:'karhu', name:'Karhu', query:'Karhu sneakers' },
        { id:'mizuno', name:'Mizuno', query:'Mizuno sneakers' },
      ]},
    ],
  },
  {
    id: 'clothing', name: '服饰', icon: '👔',
    tiers: [
      { name: '🔥 热门', brands: [
        { id:'carhartt', name:'Carhartt WIP', query:'Carhartt WIP clothing' },
        { id:'stussy', name:'Stussy', query:'Stussy clothing' },
        { id:'essentials', name:'Essentials', query:'Essentials clothing' },
        { id:'nike-acg', name:'Nike ACG', query:'Nike ACG clothing' },
        { id:'thenorthface', name:'The North Face', query:'The North Face clothing' },
        { id:'patagonia', name:'Patagonia', query:'Patagonia clothing' },
        { id:'arcteryx', name:"Arc'teryx", query:"Arc'teryx clothing" },
        { id:'ralph-lauren', name:'Ralph Lauren', query:'Ralph Lauren clothing' },
        { id:'tommy-hilfiger', name:'Tommy Hilfiger', query:'Tommy Hilfiger clothing' },
        { id:'levis', name:"Levi's", query:"Levi's clothing" },
        { id:'af', name:'A&F', query:'Abercrombie Fitch clothing' },
        { id:'uniqlo', name:'Uniqlo', query:'Uniqlo clothing' },
      ]},
      { name: '📈 趋势', brands: [
        { id:'supreme', name:'Supreme', query:'Supreme clothing' },
        { id:'palace', name:'Palace', query:'Palace clothing' },
        { id:'fear-of-god', name:'Fear of God', query:'Fear of God clothing' },
        { id:'bape', name:'BAPE', query:'BAPE clothing' },
        { id:'kith', name:'Kith', query:'Kith clothing' },
        { id:'aime-leon-dore', name:'Aimé Leon Dore', query:'Aime Leon Dore clothing' },
        { id:'noah', name:'Noah', query:'Noah clothing' },
        { id:'jjjjound', name:'JJJJound', query:'JJJJound clothing' },
        { id:'brain-dead', name:'Brain Dead', query:'Brain Dead clothing' },
        { id:'human-made', name:'Human Made', query:'Human Made clothing' },
        { id:'neighborhood', name:'Neighborhood', query:'Neighborhood clothing' },
      ]},
      { name: '💎 小众', brands: [
        { id:'stone-island', name:'Stone Island', query:'Stone Island clothing' },
        { id:'acne-studios', name:'Acne Studios', query:'Acne Studios clothing' },
        { id:'nanamica', name:'Nanamica', query:'Nanamica clothing' },
        { id:'kapital', name:'Kapital', query:'Kapital clothing' },
        { id:'engineered-garments', name:'Engineered Garments', query:'Engineered Garments clothing' },
        { id:'visvim', name:'Visvim', query:'Visvim clothing' },
        { id:'needles', name:'Needles', query:'Needles clothing' },
        { id:'wacko-maria', name:'Wacko Maria', query:'Wacko Maria clothing' },
        { id:'beams-plus', name:'Beams Plus', query:'Beams Plus clothing' },
        { id:'comoli', name:'Comoli', query:'Comoli clothing' },
      ]},
    ],
  },
  {
    id: 'luxury', name: '奢侈品', icon: '💎',
    tiers: [
      { name: '🔥 热门', brands: [
        { id:'gucci', name:'Gucci', query:'Gucci' },
        { id:'balenciaga', name:'Balenciaga', query:'Balenciaga' },
        { id:'off-white', name:'Off-White', query:'Off-White' },
        { id:'burberry', name:'Burberry', query:'Burberry' },
        { id:'prada', name:'Prada', query:'Prada' },
        { id:'louis-vuitton', name:'Louis Vuitton', query:'Louis Vuitton' },
        { id:'dior', name:'Dior', query:'Dior' },
        { id:'saint-laurent', name:'Saint Laurent', query:'Saint Laurent' },
        { id:'versace', name:'Versace', query:'Versace' },
        { id:'moncler', name:'Moncler', query:'Moncler' },
        { id:'canada-goose', name:'Canada Goose', query:'Canada Goose' },
        { id:'loewe', name:'Loewe', query:'Loewe' },
      ]},
      { name: '📈 趋势', brands: [
        { id:'bottega-veneta', name:'Bottega Veneta', query:'Bottega Veneta' },
        { id:'jacquemus', name:'Jacquemus', query:'Jacquemus' },
        { id:'ami-paris', name:'Ami Paris', query:'Ami Paris' },
        { id:'casablanca', name:'Casablanca', query:'Casablanca' },
        { id:'rhude', name:'Rhude', query:'Rhude' },
        { id:'maison-kitsune', name:'Maison Kitsuné', query:'Maison Kitsune' },
        { id:'isabel-marant', name:'Isabel Marant', query:'Isabel Marant' },
        { id:'fear-of-god-lux', name:'Fear of God', query:'Fear of God luxury' },
      ]},
      { name: '💎 小众', brands: [
        { id:'rick-owens', name:'Rick Owens', query:'Rick Owens' },
        { id:'maison-margiela-lux', name:'Maison Margiela', query:'Maison Margiela' },
        { id:'ann-demeulemeester', name:'Ann Demeulemeester', query:'Ann Demeulemeester' },
        { id:'undercover', name:'Undercover', query:'Undercover' },
        { id:'yohji-yamamoto', name:'Yohji Yamamoto', query:'Yohji Yamamoto' },
        { id:'comme-des-garcons', name:'Comme des Garçons', query:'Comme des Garcons' },
        { id:'junya-watanabe', name:'Junya Watanabe', query:'Junya Watanabe' },
        { id:'sacai', name:'Sacai', query:'Sacai' },
        { id:'kiko-kostadinov', name:'Kiko Kostadinov', query:'Kiko Kostadinov' },
        { id:'craig-green', name:'Craig Green', query:'Craig Green' },
      ]},
    ],
  },
  {
    id: 'accessories', name: '配饰', icon: '⌚',
    tiers: [
      { name: '🔥 热门', brands: [
        { id:'ray-ban', name:'Ray-Ban', query:'Ray-Ban' },
        { id:'oakley', name:'Oakley', query:'Oakley sunglasses' },
        { id:'casio', name:'Casio', query:'Casio watch' },
        { id:'g-shock', name:'G-Shock', query:'G-Shock watch' },
        { id:'new-era', name:'New Era', query:'New Era cap' },
        { id:'carhartt-acc', name:'Carhartt', query:'Carhartt accessories' },
        { id:'supreme-acc', name:'Supreme', query:'Supreme accessories' },
        { id:'nike-acc', name:'Nike', query:'Nike accessories' },
      ]},
      { name: '📈 趋势', brands: [
        { id:'herschel', name:'Herschel', query:'Herschel backpack' },
        { id:'fjallraven', name:'Fjallraven', query:'Fjallraven Kanken' },
        { id:'bellroy', name:'Bellroy', query:'Bellroy wallet' },
        { id:'fossil', name:'Fossil', query:'Fossil watch' },
        { id:'topo-designs', name:'Topo Designs', query:'Topo Designs backpack' },
      ]},
      { name: '💎 小众', brands: [
        { id:'moscot', name:'Moscot', query:'Moscot eyewear' },
        { id:'garrett-leight', name:'Garrett Leight', query:'Garrett Leight eyewear' },
        { id:'jacques-marie-mage', name:'Jacques Marie Mage', query:'Jacques Marie Mage eyewear' },
        { id:'porter-yoshida', name:'Porter Yoshida', query:'Porter Yoshida bag' },
        { id:'master-piece', name:'Master-Piece', query:'Master-Piece bag' },
      ]},
    ],
  },
];

// 扁平化查找品牌
function findBrand(brandId) {
  for (const cat of CATEGORIES) {
    for (const tier of cat.tiers) {
      const b = tier.brands.find(b => b.id === brandId);
      if (b) return { brand: b, category: cat, tier };
    }
  }
  return null;
}

// ── CSS ──
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
.badge{display:inline-block;padding:2px 6px;border-radius:3px;font-size:.65rem;font-weight:600;margin-right:4px}
.badge-new{background:#22c55e;color:#000}.badge-used{background:#f97316;color:#000}
.back-link{display:inline-flex;align-items:center;gap:6px;color:#888;text-decoration:none;padding:8px 0;font-size:.85rem;margin-bottom:12px}
.back-link:hover{color:#fff}
.loading{text-align:center;padding:60px;color:#666}
.spinner{display:inline-block;width:28px;height:28px;border:3px solid #333;border-top-color:#f97316;border-radius:50%;animation:spin .8s linear infinite;margin-bottom:12px}
@keyframes spin{to{transform:rotate(360deg)}}
.detail-card{background:#141414;border-radius:14px;padding:24px;max-width:600px;margin:0 auto}
.detail-card h2{font-size:1.1rem;margin-bottom:16px;line-height:1.4}
.detail-img{width:100%;max-height:350px;object-fit:contain;background:#1a1a1a;border-radius:10px;margin-bottom:16px}
.detail-row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #1a1a1a;font-size:.9rem}
.detail-row .label{color:#888}.detail-row .val{font-weight:600}
.detail-total{border-top:2px solid #f97316;margin-top:12px;padding-top:12px;font-size:1.2rem;font-weight:700;color:#f97316;text-align:right}
.btn{display:block;text-align:center;padding:14px;border-radius:10px;background:linear-gradient(135deg,#f97316,#ef4444);color:#fff;font-weight:700;text-decoration:none;margin-top:20px;font-size:1rem}
.btn:hover{opacity:.9}
.tip{background:#141414;border-radius:10px;padding:14px;margin-top:20px;color:#666;font-size:.78rem;line-height:1.5}
.tip strong{color:#f97316}
@media(max-width:600px){.cat-grid{grid-template-columns:repeat(2,1fr)}.product-grid{grid-template-columns:repeat(2,1fr)}.brand-grid{grid-template-columns:repeat(3,1fr)}.topbar{padding:10px 12px}}
`;

// ── HTML 模板 ──
function shell(title, body, extra = '') {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><style>${CSS}</style></head><body>
<div class="topbar"><a href="/" class="home">🏀</a><input id="searchInput" placeholder="搜品牌、鞋款、品类…" onkeydown="if(event.key==='Enter')go()" /><button onclick="go()" style="background:none;border:none;color:#f97316;font-size:1.2rem;cursor:pointer;padding:4px 8px">🔍</button></div>
<script>function go(){const q=document.getElementById('searchInput').value.trim();if(q)location.href='/search?q='+encodeURIComponent(q)}</script>
${body}
${extra}
</body></html>`;
}

// ── 页面 ──
function homePage() {
  const cats = CATEGORIES.map(c =>
    `<a href="/category/${c.id}" class="cat-card"><div class="cat-icon">${c.icon}</div><div class="cat-name">${c.name}</div></a>`
  ).join('');
  return shell('🏀 Sneaker Deal Finder', `
    <div class="page"><h1>🏀 Sneaker Deal Finder</h1>
    <p style="color:#888;margin-bottom:20px">海外正品比价 · 直邮中国到手价 · 含运费+关税</p>
    <div class="cat-grid">${cats}</div>
    <div class="tip">💡 数据来源 eBay 官方 API · 到手价 = 商品 + 国际运费 + 预估关税<br>
    ⚠️ 关税按跨境电商综合税 9.1% 估算 · 实际以海关核定为准</div></div>`);
}

function categoryPage(cat) {
  const tiers = cat.tiers.map(t => `
    <div class="tier-title">${t.name}</div>
    <div class="brand-grid">${t.brands.map(b => `<a href="/brand/${b.id}" class="brand-chip">${b.name}</a>`).join('')}</div>
  `).join('');
  return shell(`${cat.icon} ${cat.name} — SF`, `
    <div class="page"><h1>${cat.icon} ${cat.name}</h1>
    <a href="/" class="back-link">← 返回分类</a>
    ${tiers}
    </div>`);
}

function brandPage(brand, cat, data) {
  if (data.error) {
    return shell(`${brand.name} — SF`, `
      <div class="page"><h1>${brand.name}</h1>
      <a href="/category/${cat.id}" class="back-link">← 返回${cat.name}</a>
      <div class="loading"><p>${data.error}</p></div></div>`);
  }
  const cards = (data.items || []).map(p => {
    const cost = calcTotal(p.priceCNY, p.shippingUSD);
    return `<a href="/product/${p.id}?name=${encodeURIComponent(p.name)}&price=${p.priceUSD}&ship=${p.shippingUSD}&img=${encodeURIComponent(p.thumb)}&url=${encodeURIComponent(p.url)}" class="product-card">
      <img class="product-img" src="${p.thumb}" alt="${p.name}" loading="lazy" onerror="this.style.background='#222'" />
      <div class="product-info">
        <div class="product-name">${p.name}</div>
        <div class="product-price">${fmt(cost.total)} <span style="font-size:.65rem;color:#666;font-weight:400">到手</span></div>
        <div class="product-sub">${fmtUSD(p.priceUSD)} + 运费${fmtUSD(p.shippingUSD)} | ${cost.note}</div>
      </div></a>`;
  }).join('');
  return shell(`${brand.name} — ${cat.name}`, `
    <div class="page"><h1>${brand.name}</h1>
    <a href="/category/${cat.id}" class="back-link">← 返回${cat.name}</a>
    <p style="color:#888;font-size:.85rem;margin-bottom:12px">${(data.total||0).toLocaleString()} 件商品 · 到手价从低到高</p>
    <div class="product-grid">${cards || '<div class="loading"><p>暂无商品</p></div>'}</div>
    <div class="tip">💡 到手价 = 商品 + 国际运费 + 预估关税 · 点击卡片查看明细</div></div>`);
}

function productPage(name, priceUSD, shipUSD, img, ebayUrl) {
  const priceCNY = Math.round(parseFloat(priceUSD) * USD_CNY);
  const cost = calcTotal(priceCNY, parseFloat(shipUSD));
  return shell(name, `
    <div class="page"><a href="javascript:history.back()" class="back-link">← 返回</a>
    <div class="detail-card">
      <img class="detail-img" src="${decodeURIComponent(img)}" alt="${name}" onerror="this.style.background='#222'" />
      <h2>${name}</h2>
      <div class="detail-row"><span class="label">商品价格</span><span class="val">${fmtUSD(parseFloat(priceUSD))}（${fmt(priceCNY)}）</span></div>
      <div class="detail-row"><span class="label">国际运费</span><span class="val">${fmtUSD(parseFloat(shipUSD))}（${fmt(cost.sCNY)}）</span></div>
      <div class="detail-row"><span class="label">预估关税</span><span class="val">${cost.note}</span></div>
      <div class="detail-total">到手 ${fmt(cost.total)}</div>
      <a href="${decodeURIComponent(ebayUrl)}" target="_blank" class="btn">🔗 去 eBay 购买</a>
      <div class="tip">⚠️ 关税按跨境电商综合税 9.1% 估算（鞋靴/服饰类）<br>行邮税 30% 场景下税额更高，实际以海关核定为准</div>
    </div></div>`);
}

function searchPage(query, data) {
  if (data.error) {
    return shell(`🔍 ${query}`, `<div class="page"><h1>🔍 ${query}</h1><a href="/" class="back-link">← 返回首页</a><div class="loading"><p>${data.error}</p></div></div>`);
  }
  const cards = (data.items || []).map(p => {
    const cost = calcTotal(p.priceCNY, p.shippingUSD);
    return `<a href="/product/${p.id}?name=${encodeURIComponent(p.name)}&price=${p.priceUSD}&ship=${p.shippingUSD}&img=${encodeURIComponent(p.thumb)}&url=${encodeURIComponent(p.url)}" class="product-card">
      <img class="product-img" src="${p.thumb}" alt="${p.name}" loading="lazy" onerror="this.style.background='#222'" />
      <div class="product-info">
        <div class="product-name">${p.name}</div>
        <div class="product-price">${fmt(cost.total)} <span style="font-size:.65rem;color:#666;font-weight:400">到手</span></div>
        <div class="product-sub">${fmtUSD(p.priceUSD)} + 运费${fmtUSD(p.shippingUSD)} | ${cost.note}</div>
      </div></a>`;
  }).join('');
  return shell(`🔍 ${query}`, `<div class="page"><h1>🔍 ${query}</h1><a href="/" class="back-link">← 返回首页</a>
    <p style="color:#888;font-size:.85rem;margin-bottom:12px">${(data.total||0).toLocaleString()} 个结果 · 按相关度排序</p>
    <div class="product-grid">${cards || '<div class="loading"><p>无结果，换个关键词试试</p></div>'}</div></div>`);
}

// ── 路由 ──
app.get('/', (req, res) => res.send(homePage()));

app.get('/category/:id', (req, res) => {
  const cat = CATEGORIES.find(c => c.id === req.params.id);
  if (!cat) return res.redirect('/');
  res.send(categoryPage(cat));
});

app.get('/brand/:id', async (req, res) => {
  const found = findBrand(req.params.id);
  if (!found) return res.redirect('/');
  const data = await searchEbay(found.brand.query);
  res.send(brandPage(found.brand, found.category, data));
});

app.get('/product/:id', (req, res) => {
  const { name, price, ship, img, url } = req.query;
  if (!name || !price) return res.redirect('/');
  res.send(productPage(name, price, ship || '0', img || '', url || `https://www.ebay.com/itm/${req.params.id}`));
});

app.get('/search', async (req, res) => {
  const q = req.query.q || '';
  if (!q.trim()) return res.redirect('/');
  const data = await searchEbay(q.trim(), 30, '');
  res.send(searchPage(q.trim(), data));
});

app.listen(PORT, () => {
  console.log(`🏀 http://localhost:${PORT}`);
  console.log(`   eBay: ${EBAY_CLIENT_ID ? '✅' : '❌ not set'}`);
});
