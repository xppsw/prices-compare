# 🏀 Sneaker Deal Finder — 项目开发日志

## 项目目标
做一个类似「得物」的海外正品比价平台：
分类浏览 → 热门/小众品牌 → 商品图墙 → 点商品 → 跨平台（StockX/GOAT/Farfetch）比价 → 直邮中国到手价

---

## ⚠️ 产品框架 — 严格执行不得更改

> 以下架构为最终确定版本。数据源可切换，但交互流程、页面层级、品牌体系不可变。

### 页面层级
```
/ (首页)
│
├── 全局搜索栏 [所有页面顶部]
│   └── /search?q={keyword} → 相关度排序 → 商品图墙
│
├── /category/shoes      → 鞋类
├── /category/clothing   → 服饰
├── /category/luxury     → 奢侈品
└── /category/accessories → 配饰
     │
     └── 品牌列表（分三级：🔥热门 / 📈趋势 / 💎小众）
          │
          └── /brand/{brandId} → 商品图墙（图片+名称+到手价）
               │
               └── /product/{id} → 多平台价格对比 → 到手价明细
```

### 分类 & 品牌体系
```
鞋类 (shoes)      → search query 后缀: "sneakers"
  🔥热门: Nike, Adidas, Converse, Vans, New Balance, Jordan, Yeezy, Puma
  📈趋势: ASICS, Reebok, Hoka, On Running, Salomon, Under Armour, Saucony, Brooks
  💎小众: Common Projects, Maison Margiela, Rick Owens, Hender Scheme,
         Golden Goose, Veja, Axel Arigato, Diadora, Karhu, Mizuno, Eytys

服饰 (clothing)    → search query 后缀: "clothing"
  🔥热门: A&F, Carhartt WIP, Stussy, Essentials, Nike ACG, The North Face,
         Patagonia, Arc'teryx, Ralph Lauren, Tommy Hilfiger, Levi's, Uniqlo
  📈趋势: Supreme, Palace, Fear of God, BAPE, Kith, Aimé Leon Dore,
         Noah, JJJJound, Brain Dead, Yeezy Gap, Human Made, Neighborhood
  💎小众: Stone Island, Acne Studios, Nanamica, White Mountaineering,
         Kapital, Engineered Garments, Visvim, Auralee, Comoli,
         Needles, Wacko Maria, Beams Plus

奢侈品 (luxury)     → search query 后缀: ""
  🔥热门: Gucci, Balenciaga, Off-White, Burberry, Prada, Louis Vuitton,
         Dior, Saint Laurent, Versace, Moncler, Canada Goose, Loewe
  📈趋势: Bottega Veneta, Jacquemus, Ami Paris, Casablanca, Rhude,
         Fear of God, Maison Kitsuné, Acne Studios, Isabel Marant
  💎小众: Maison Margiela, Rick Owens, Visvim, Kapital,
         Ann Demeulemeester, Undercover, Yohji Yamamoto, Comme des Garçons,
         Junya Watanabe, Sacai, Kiko Kostadinov, Craig Green

配饰 (accessories)  → search query 后缀: ""
  🔥热门: Ray-Ban, Oakley, Casio, G-Shock, New Era, Carhartt,
         The North Face, Nike, Adidas, Supreme
  📈趋势: Herschel, Fjallraven, Bellroy, Fossil, Topo Designs
  💎小众: Moscot, Garrett Leight, Jacques Marie Mage,
         Porter Yoshida, Master-Piece
```

### 到手价计算公式
- 商品 CNY = 商品 USD × 7.25
- 运费 CNY = 运费 USD × 7.25
- 关税: (商品CNY + 运费CNY) × 9.1%（跨境电商综合税），若 < 50 元则免税
- 到手价 = 商品CNY + 运费CNY + 关税

### 技术约束
- 路由: Express.js，SSR 直出 HTML
- 无数据库、无缓存、无前端框架
- 全局搜索 + 相关度排序
- 移动端响应式

---

## 技术演进历程

### 第 1 轮：本地 Node.js 脚本（爬虫方案）
**日期**: 2026-07-21 上午
**文件**: `run.js`, `src/platforms/*.js`
**数据源**: StockX API, GOAT API, END Clothing, ASOS, Farfetch
**结果**: ❌ 失败
**原因**: 所有目标网站要么返回 Cloudflare 403，要么是 JS 渲染的 SPA 无 SSR 数据，纯 HTTP 请求无法获取

### 第 2 轮：Cloudflare Worker
**日期**: 2026-07-21 下午
**文件**: `worker.js` → `raspy-shadow-886d.xiaoppshiwo.workers.dev`
**方案**: Worker 在 CF 海外节点跑，直接 fetch StockX/GOAT
**结果**: ❌ 失败
**原因**: StockX/GOAT 自己也在 Cloudflare 上，CF→CF 的请求被 Bot Fight Mode 拦截。`workers.dev` 域名国内 DNS 污染，不开 VPN 无法访问

### 第 3 轮：Render.com (AWS 网络)
**日期**: 2026-07-21 晚上
**文件**: `server.js` → `prices-compare.onrender.com`
**方案**: Render 在 AWS 上，不在 CF 网络，尝试 HTTP 请求各平台
**测试结果**:
- StockX API 所有端点 → 404（已关闭所有老 API）
- StockX HTML → 200 但 NEXT_DATA 无商品数据（客户端渲染）
- GOAT API → 403
- Farfetch API → 403 "Access Denied"
- eBay HTML → 403
- Google Shopping → 200 但无搜索结果（反爬）
**结论**: 所有海外电商要么关了 API，要么 JS 渲染，要么反爬

### 第 4 轮：eBay Browse API
**日期**: 2026-07-21 深夜
**文件**: `server.js` (eBay API 版)
**方案**: eBay 官方 Browse API（免费 5000 调用/天，审核制）
**状态**: 🟡 开发者账号审核中（1 工作日）。代码完整已部署到 Render，缺 API Key

### 第 5 轮：本地 Playwright 真实浏览器
**日期**: 2026-07-21 深夜
**文件**: `server.js` (Playwright 版, G:\compare\)
**方案**: 本机 Express + Playwright → 启动真实 Chrome → 抓取 StockX/GOAT/Farfetch
**遇到的问题**:
1. `headless: true` → StockX 检测并拦截（"Please login to continue"）
2. `channel: 'chrome'`（系统 Chrome）→ `launchPersistentContext` 报错不兼容
3. `headless: false` + Playwright Chromium → Chrome 窗口成功弹出
4. `/setup` 路由手动过人机验证 → VPN 不稳定，StockX 页面加载超时（15s timeout）
5. 未完成手动登录测试

**状态**: ❌ 未完成，暂停。理论可行但需要稳定 VPN + 手动过一次验证

---

## 失败方案完整清单

| # | 方案 | 失败原因 | 平台/网络要求 |
|---|------|---------|-------------|
| 1 | StockX 公开 API | 2024年关闭，全部返回 404 | VPN |
| 2 | CF Worker → StockX | CF→CF Bot Fight Mode 拦截 | 无 |
| 3 | CF Worker → GOAT | CF→CF Bot Fight Mode 拦截 | 无 |
| 4 | CF Worker → Farfetch | CF→CF Bot Fight Mode 拦截 | 无 |
| 5 | Render → StockX API | API 已死，所有端点 404 | 无 |
| 6 | Render → StockX HTML | 客户端渲染，NEXT_DATA 无商品 | 无 |
| 7 | Render → GOAT API | 403 Forbidden | 无 |
| 8 | Render → Farfetch API | 403 Access Denied | 无 |
| 9 | Render → eBay HTML | 403 Forbidden | 无 |
| 10 | Render → Google Shopping | 200 但无结果，反爬 | 无 |
| 11 | Sneaks-API (GitHub) | 2年未维护，所有端点已死 | N/A |
| 12 | workers.dev 直连 | 国内 DNS 污染/SNI 封锁 | N/A |
| 13 | Playwright headless → StockX | StockX 检测 headless 标识 | VPN |
| 14 | Playwright system Chrome | launchPersistentContext 不兼容 | VPN |
| 15 | Playwright visible → StockX | VPN 不稳定导致超时 | VPN |

---

## 部署记录

| 时间 | 平台 | URL | 状态 |
|------|------|-----|------|
| 2026-07-21 19:53 | Cloudflare Workers | raspy-shadow-886d.xiaoppshiwo.workers.dev | 🗑️ 废弃 |
| 2026-07-21 21:42 | Render | prices-compare.onrender.com | 🟡 缺 eBay Key |

### 环境变量 (Render)
- `EBAY_CLIENT_ID` — eBay Developer App Client ID
- `EBAY_CLIENT_SECRET` — eBay Developer App Client Secret

### GitHub
- 仓库: https://github.com/xppsw/prices-compare
- 分支: main

### 本地文件
- `G:\compare\server.js` — 当前版本（Playwright 爬虫）
- `G:\compare\PROJECT_LOG.md` — 本日志
- `G:\compare\.chrome-data\` — Playwright 浏览器 profile
- `G:\Ai project\small-talk\` — 早期废弃文件

---

## 如果继续 — 三条路线

| 路线 | 做法 | 优点 | 风险 |
|------|------|------|------|
| **A. eBay API** | 等审核 → 贴 Key → Render 直接用 | 稳定、免费、不需 VPN | 只有 eBay 商品，不是 StockX/GOAT 的球鞋价 |
| **B. Playwright 继续** | VPN 稳定后 → `/setup` 登录一次 → cookies 持久化 | 真正的 StockX 比价 | 随时被封、需 VPN |
| **C. 简化版** | 只做手动比价计算器 | 无依赖、马上能用 | 没图墙浏览体验 |
