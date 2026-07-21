# 🏀 Sneaker Deal Finder — 项目开发日志

## 项目目标
做一个类似「得物」的海外正品比价平台——浏览品牌 → 看图选款 → 跨平台比价直邮中国到手价。

---

## 技术演进历程

### 第 1 轮：本地 Node.js 脚本（爬虫方案）
**文件**: `run.js`, `src/platforms/*.js`
**数据源**: StockX API, GOAT API, END Clothing, ASOS, Farfetch
**结果**: ❌ 失败
**原因**: 
- StockX API (`stockx.com/api/browse`) → Cloudflare 403 拦截
- GOAT API → Cloudflare 403
- END Clothing → JS 渲染页面，无 SSR 数据
- ASOS → JS 渲染 SPA
- Google Shopping → 国内 DNS 污染

### 第 2 轮：Cloudflare Worker
**文件**: `worker.js` (部署到 `raspy-shadow-886d.xiaoppshiwo.workers.dev`)
**方案**: Worker 在 Cloudflare 海外节点运行，通过 fetch 请求 StockX/GOAT
**结果**: ❌ 失败
**原因**: StockX/GOAT 自己就在 Cloudflare 上，CF→CF 的请求被 Bot Fight Mode 拦截（自己打自己）
**额外问题**: `workers.dev` 域名在国内 DNS 污染，不开 VPN 无法访问

### 第 3 轮：Render.com 免费托管
**文件**: `server.js` (部署到 `prices-compare.onrender.com`)
**方案**: Render 在 AWS 网络上，不在 Cloudflare，理论上能避开 CF 封锁
**测试结果**:
- StockX API 所有端点 → 404（StockX 已关闭所有旧版公开 API）
- StockX HTML SSR (`stockx.com/search?s=converse`) → 200 OK，但 `__NEXT_DATA__` 中无商品数据（客户端渲染）
- GOAT API → 403
- Farfetch API → 403 "Access Denied"
- eBay HTML → 403
- Google Shopping HTML → 200 但无搜索结果（反爬）
**结论**: 所有海外电商要么关 API，要么纯客户端渲染，HTTP 请求无法获取数据

### 第 4 轮：eBay Browse API（当前方案）
**状态**: 🟡 等待 eBay 开发者账号审核（约 1 个工作日）
**方案**:
- 数据源: eBay Browse API（官方，免费 5000 调用/天）
- 托管: Render (512MB Free)
- 域名: `prices-compare.onrender.com`
- 代码: GitHub `xppsw/prices-compare`

**经验教训**:
1. 不要试图爬取 Cloudflare 保护的站点
2. 不要依赖未维护的第三方 API（Sneaks-API 已停更 2 年）
3. 电商网站的公开 API 随时可能被关闭（StockX 2024 年关闭老 API）
4. SSR 不等于有数据——很多网站是客户端渲染的壳
5. 官方 API（eBay）是唯一可靠方案

---

## 当前架构

```
用户浏览器 → prices-compare.onrender.com → eBay Browse API → eBay 商品数据
                 (Render 512MB)              (免费 5000/天)
```

### 数据流
1. 用户访问首页 → 显示分类（鞋类/服饰/奢侈品）
2. 点击分类 → 显示品牌列表
3. 点击品牌 → 服务器调用 `searchEbay(brandQuery)` → 返回商品图片+价格
4. 点击商品 → 显示到手价明细（商品价格 + 运费 + 预估关税）
5. 跳转 eBay 购买

### 价格计算
- 商品价格: eBay API `price.value` → USD → CNY (×7.25)
- 国际运费: eBay API `shippingOptions[0].shippingCost.value` → CNY
- 关税: 跨境电商综合税 9.1%（(商品+运费) × 9.1%）
- 行邮税免征: 税额 < 50 元则免税
- 到手价 = 商品 + 运费 + 关税

### 分类结构（计划）
```
鞋类 → Nike, Adidas, Converse, Vans, New Balance, ASICS, Puma, Reebok...
服饰 → A&F, Carhartt, Stussy, Supreme, Palace, Fear of God...
奢侈品 → Gucci, Balenciaga, Off-White, Louis Vuitton...
配饰 → 帽子, 包袋, 手表...
```

---

## 部署记录

| 时间 | 平台 | URL | 状态 |
|------|------|-----|------|
| 2026-07-21 19:53 | Cloudflare Workers | raspy-shadow-886d.xiaoppshiwo.workers.dev | 🟡 运行中但无用 |
| 2026-07-21 21:42 | Render | prices-compare.onrender.com | 🟡 等待 API Key |

### 环境变量 (Render)
- `EBAY_CLIENT_ID` — eBay Developer App Client ID
- `EBAY_CLIENT_SECRET` — eBay Developer App Client Secret

### GitHub
- 仓库: https://github.com/xppsw/prices-compare
- 分支: main
- 部署: Render 自动从 main 分支部署

---

## 失败方案清单

| # | 方案 | 失败原因 |
|---|------|---------|
| 1 | StockX 公开 API | 2024年关闭，全部返回 404 |
| 2 | Cloudflare Worker → StockX | CF→CF 被 Bot Fight Mode 拦截 |
| 3 | Cloudflare Worker → GOAT | 同上 |
| 4 | Render → StockX API | API 已死 |
| 5 | Render → StockX HTML SSR | 客户端渲染，NEXT_DATA 无商品 |
| 6 | Render → GOAT API | 403 Forbidden |
| 7 | Render → Farfetch API | 403 Access Denied |
| 8 | Render → eBay HTML | 403 |
| 9 | Render → Google Shopping | 200 但无结果（反爬） |
| 10 | Sneaks-API (GitHub) | 2年未维护 |
| 11 | workers.dev 直连 | 国内 DNS 污染 |

---

## ⚠️ 产品框架 — 严格执行不得更改

> 以下架构为最终确定版本，所有开发严格按此执行。

### 页面层级

```
/ (首页)
│
├── 搜索 [全局顶部搜索栏]
│   └── /search?q={keyword}
│        搜索结果按相关度排序（eBay 默认排序）
│        显示商品图墙，含到手价
│
├── /category/shoes      → 鞋类
├── /category/clothing   → 服饰
├── /category/luxury     → 奢侈品
└── /category/accessories → 配饰
     │
     └── 品牌列表（分三级：🔥热门 / 📈趋势 / 💎小众）
          │
          └── /brand/{brandId}
               │
               └── 商品图墙（eBay API 抓取）
                    图片 + 名称 + 到手价
                     │
                     └── 点击 → /product/{id}
                          到手价明细拆解
                          跳转 eBay 购买
```

### 分类 & 品牌体系

```
鞋类 (shoes)      → query 后缀: "sneakers"
  🔥热门: Nike, Adidas, Converse, Vans, New Balance, Jordan, Yeezy, Puma
  📈趋势: ASICS, Reebok, Hoka, On Running, Salomon, Under Armour, Saucony, Brooks
  💎小众: Common Projects, Maison Margiela, Rick Owens, Visvim, Hender Scheme, 
         Golden Goose, Veja, Axel Arigato, Diadora, Karhu, Mizuno, Eytys

服饰 (clothing)    → query 后缀: "clothing"
  🔥热门: A&F, Carhartt WIP, Stussy, Essentials, Nike ACG, The North Face, 
         Patagonia, Arc'teryx, Ralph Lauren, Tommy Hilfiger, Levi's, Uniqlo
  📈趋势: Supreme, Palace, Fear of God, BAPE, Kith, Aimé Leon Dore, 
         Noah, JJJJound, Brain Dead, Yeezy Gap, Human Made, Neighborhood
  💎小众: Stone Island, Acne Studios, Nanamica, White Mountaineering, 
         Kapital, Engineered Garments, Visvim, Auralee, Comoli, 
         Needles, Wacko Maria, Beams Plus

奢侈品 (luxury)     → query 后缀: ""
  🔥热门: Gucci, Balenciaga, Off-White, Burberry, Prada, Louis Vuitton, 
         Dior, Saint Laurent, Versace, Moncler, Canada Goose, Loewe
  📈趋势: Bottega Veneta, Jacquemus, Ami Paris, Casablanca, Rhude, 
         Fear of God, Maison Kitsuné, Acne Studios, Isabel Marant
  💎小众: Maison Margiela, Rick Owens, Visvim, Kapital, 
         Ann Demeulemeester, Undercover, Yohji Yamamoto, Comme des Garçons,
         Junya Watanabe, Sacai, Kiko Kostadinov, Craig Green

配饰 (accessories)  → query 后缀: ""
  🔥热门: Ray-Ban, Oakley, Casio, G-Shock, New Era, Carhartt, 
         The North Face, Nike, Adidas, Supreme
  📈趋势: Warby Parker, MVMT, Daniel Wellington, Fossil, 
         Herschel, Fjallraven, Bellroy, Topo Designs
  💎小众: Moscot, Garrett Leight, Akila, Jacques Marie Mage, 
         Porter Yoshida, Master-Piece, Want Les Essentiels
```

### 数据获取规则
- 品牌浏览页 (`/brand/{id}`) 调用 eBay API: `{brandName} {categorySuffix}`
- 例: Nike → `Nike sneakers`, A&F → `Abercrombie Fitch clothing`
- 每次请求 limit=24, sort=price (从低到高)
- 过滤: conditions=NEW, buyingOptions=FIXED_PRICE

### 价格展示规则
- 商品卡片显示 **到手价**（含运费 + 关税），不是原价
- 到手价 = 商品USD价格 × 7.25 + 运费USD × 7.25 + 预估关税
- 关税: (商品CNY + 运费CNY) × 9.1%，若 < 50元则免税
- 卡片副标题显示: "$XX.XX + 运费$X.XX | 免税/含税¥XX"

### 搜索规则
- 全局搜索框，位于首页顶部 + 每个页面顶部
- 搜任意关键词 → `/search?q={keyword}`
- 直接调 eBay API search，不做本地过滤
- 默认 sort 为 eBay 相关度排序（不传 sort 参数）
- 结果页显示搜索词 + 命中数量 + 商品图墙

### 技术约束
- 数据源: eBay Browse API 唯一
- 托管: Render 512MB
- 路由: Express.js，SSR 直出 HTML
- 无数据库、无缓存、无前端框架
- 每次请求实时调 eBay API

---

## 下一步
1. eBay 开发者审核通过 → 配置 API Key
2. 按上述框架实现完整 server.js
3. 测试搜索、分类、品牌、商品全流程
4. 移动端适配
5. 开源发布
