# 项目交接文档 — 资金流向与轮动驾驶舱 (cockpit/v2)

> 最后整理: 2026-06-20
> 本文档对应**全新系统 cockpit/v2**;旧 v1(链上活跃度分数面板)已退役并归档至 `_legacy/`。

## 1. 项目定位

"**跟着钱走 (follow the money)**" 的本地优先、免费数据面板:把加密资金流动拆成**五层**捕捉,合成为**对具体标的的仓位建议**(纯决策辅助,**不自动下单**)。

- 回答:钱在哪一层 / 往哪流 / 轮动到哪 / 据此对某标的(链上现货 or CEX 合约)该不该上、上多少。
- **明确不是**:订单簿微观结构流动性(spread/深度/滑点),也不是旧 v1 的"活跃度分数"。
- 完整规格见 `docs/PRD-capital-flow-cockpit.md`;调研依据见 `docs/capital-flow-rotation-survey-2026-06-19.md`(目标方向)与 `docs/liquidity-measurement-survey-2026-06-18.md`(对照/排除项)。

## 2. 当前状态

- 五层全部实现,本机实跑 **4/5 层有实时数据**(L4 OKX 经代理,云端 451 由 Hyperliquid 回退);测试 **104/104 绿**。
- 旁路辅助:`appRevenueHeat`(各链协议收入热度);页面最上方 `macro-context` 宏观背景三曲线。
- 交易可用等级上限 `watch_only`(信号增强,仍不自动下单)。

## 3. 快速启动

环境:**Node.js 22+,无第三方依赖**。

```bash
npm test          # 65 单元测试(纯函数 + 契约 + provider 解析 + 数据校验)
npm run collect   # 采集一次 → public/data/cockpit.json
npm run serve     # 启动服务(默认 :4173),启动即采集,之后每 1h 自动采集
```

打开 `http://localhost:4173/`;端口占用用 `PORT=4181 npm run serve`。
⚠️ 服务进程随终端/会话结束而停;要常驻用 pm2/systemd 或自己终端长跑。

## 4. 架构与目录

```
src/cockpit/
  stats.mjs / envelope.mjs        # 滚动百分位/z + 指标信封(value/percentile/z/dataQuality)
  engine.mjs                      # computeFlowState + computePositionGuidance(仓位逻辑)
  contract.mjs                    # 组装 cockpit/v2 → public/data/cockpit.json
  history.mjs                     # 滚动历史(链间份额序列)
  layers/{macro,chain-flow,launchpad,narrative,dexcex}.mjs   # 五层 normalize+signal
  layers/app-revenue.mjs          # 旁路:各链协议收入热度(不进五层引擎)
  providers/{macro,stablecoins,launchpad,narrative,dexcex,app-revenue,mindshare}.mjs
  providers/http.mjs              # 代理感知 getJsonViaProxy(CONNECT 隧道,给被墙的 OKX/CoinGecko 用)
scripts/{collect-cockpit,serve-cockpit}.mjs   # 采集编排 + 静态服务(npm run collect/serve 指向它们)
public/index.html                # 前端(纯静态,<script type="module">)
public/main.js                   # 渲染 cockpit.json(无构建)
public/macro-context-chart.js    # 纯 SVG 时序图坐标/路径数学(ESM 模块)
public/data/macro-context.json   # 手工维护的宏观背景数据(源数据,入库)
public/data/cockpit.json         # 采集生成(不入库)
```

数据流:`providers(各源,失败隔离) → layers(normalize+signal) → engine(flowState+guidance) → contract(cockpit/v2) → main.js 渲染`。

## 5. 五层 + 数据源 + 状态

| 层 | 含义 | 免费数据源 | 状态 |
|---|---|---|---|
| L1 宏观 | 放水/收水 | FRED 净流动性 `WALCL−TGA−RRP`(fredgraph.csv,无 key) | ✅ |
| L2 链间 | 资金在 SOL/Base/ETH/BSC 间迁移 | `stablecoins.llama.fi/stablecoinchains`(稳定币份额变化) | ✅(桥净流付费,用份额代理) |
| L3 发射台 | 打新资金在哪个台子升温 | `api.llama.fi/overview/fees`(pump.fun/BONK.fun/believe/moonshot/four.meme 收入+动量+份额) | ✅ |
| L4 DEX↔CEX | 钱在链上现货还是 CEX 合约 + 拥挤 | OKX 衍生品(funding/perp-spot);不可达时回退 Hyperliquid(仅 perp 腿 → partial) | ✅(本机经代理;云端 HL 回退) |
| L5 主题 | 资金在哪个板块/叙事 | `api.llama.fi/protocols`(板块 TVL 动量)+ CoinGecko trending(mindshare 注意力代理,可操纵,仅展示) | ✅ |
| 旁路 | 协议收入热度 | `api.llama.fi/overview/fees/{chain}` 各链 top 协议 | ✅(活动热度,**不进引擎/conviction**) |
| 顶部 | 宏观背景(大科技 capex / AI ARR / 存储价) | **手工维护** `macro-context.json`(无免费实时 API,数据带来源) | ✅(非实时) |

## 6. 引擎 / 仓位逻辑

- 每层输出 `LayerSignal{ direction, strength, confidence, components[], rotationEdges[], dataQuality }`。
- `computeFlowState` → regime(宏观闸门)+ moneyLocation + 跨层 rotationEdges + 多层一致度。
- `computePositionGuidance` → 每标的 `conviction → 仓位档(空仓/试探/小仓/标准)`,受 **regime 闸门**(收水压制并封顶 probe)、**风险降档**(链上出场流动性、合约 funding/OI 拥挤)、**发射台硬下限**(某台升温且非收水 → 该台标的 ≥ 试探)约束。
- 安全边界:`guidance` 永远是建议,**绝不下单/不接私钥**。

## 7. 数据诚实纪律(项目铁律)

取不到 → `missing`/`partial`,**绝不用 0 或样例冒充**;各源失败相互隔离;**走 API 端点不爬前端**(前端 403 反爬);信号基于**变化率/相对强弱/滚动分位**,不绑死绝对阈值(易被刷/时间敏感)。

## 8. 关键 gotcha(已踩过的坑,务必知道)

- **OKX / CoinGecko 直连被墙** → 经本机代理 `127.0.0.1:7897` 访问(`providers/http.mjs` 的 CONNECT 隧道,读 `HTTPS_PROXY` env)。2026-07-03 起 L4 有 **Hyperliquid 免 key 回退**(OKX 失败自动切换,funding 小时率×8 对齐 OKX 8h 口径、无现货腿 → partial);mindshare 仍无回退,代理失效时 `missing`。
- **FRED**:多序列合并端点返回 **ZIP**,必须分序列拉;单位 **WALCL/WTREGEN(TGA)= 百万、RRPONTSYD = 十亿**,净流动性 = `WALCL/1000 − TGA/1000 − RRP`。
- **DeFiLlama 前端 403 反爬** → 一律用 API 端点(`api.llama.fi` / `stablecoins.llama.fi`);桥端点 `bridges.llama.fi` 为 **402 付费**。
- **OKX SWAP 的 `volCcy24h` 是 base 币数量**,USD 量 = `volCcy24h × last`(spot 的已是 USDT)。
- **launchpad 按精确(小写)协议名匹配**:pump.fun=`pump.fun`、LetsBonk=`BONK.fun Launchpad`、four.meme=`four.meme`。
- **代理 HTTP 解析按 Buffer 字节**(chunked + 多字节,如 CoinGecko 大响应)。
- 份额 <1% 的微量发射台/单点尖刺(如博彩 app)**不计方向**,避免带偏。

## 9. 已知缺口 / P1

- 真实桥净流(DeFiLlama 付费、Artemis 需 key)→ 现用稳定币份额代理。
- 交易所净流(CryptoQuant/Glassnode/Nansen 均付费)→ 无干净免费源,记缺口。
- 主题层 USD-TVL 含币价噪声 → BTC/ETH 计价去噪待做。
- watchlist 现为占位(`scripts/collect-cockpit.mjs` 的 `DEFAULT_WATCHLIST`)→ 需用户配置入口。
- `macro-context.json` **手工维护、会过时** → 需定期联网更新(capex/ARR/存储价)。
- 发射台毕业率/bonding curve;`technical-solution.md` 仍是旧 v1 设计,待刷新或归档。

## 10. 接手检查清单

- [ ] Node.js 22+;`npm test` 全绿(65)。
- [ ] `npm run collect` 生成 `public/data/cockpit.json`(无 `npm install`,无依赖)。
- [ ] `npm run serve` 打开 `http://localhost:4173/`:页面最上方三条宏观曲线 + 五层 + 仓位表。
- [ ] `.env` 保存 GMGN/Dune 等 key,**不进仓库**(已 gitignore);代理在 `127.0.0.1:7897` 时 L4/mindshare 才有数。
- [ ] 数据缺失处显示 missing/partial,不应出现 0 冒充。
- [ ] 对照 `docs/PRD-capital-flow-cockpit.md` 理解设计边界。

## 11. 部署:GitHub Actions + GitHub Pages(已实施 2026-06-29)

**形态**:GitHub Actions(cron 每 1h 第 17 分跑 `npm run collect`)+ GitHub Pages(托管静态前端 + 生成的 JSON)。Actions 是定时跑批,**不是常驻服务器**;这条路对应"静态部署 + 外部 cron 生成 JSON"。可选 Telegram 状态变化推送(`TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` secret,缺省跳过)。

**适配性**:无依赖、无构建、**无 secret**(采集只用免费无 key API:FRED/DeFiLlama/OKX/CoinGecko)→ 天然适合。

**要点 / 约束**:
- workflow:`schedule` cron 每 4h + `workflow_dispatch` + push;步骤 checkout → setup-node@v4(node 22) → `npm test` → `node scripts/collect-cockpit.mjs` → **commit `public/data/cockpit.json` + `cockpit-history.json` 回仓库** → 部署 `public/` 到 Pages。
- **历史持久化(关键)**:Actions 每次是临时环境,链间轮动/百分位依赖 `cockpit-history.json`,必须每次 commit 回仓库才能累积 → 需**放行 `.gitignore`**(当前忽略了 `public/data/cockpit*.json`),或改用单独 data 分支存数据。
- **代理**:云端 runner 在境外,直连可达,**不用本机的 7897 代理**(`getJsonViaProxy` 无 `HTTPS_PROXY` 时自动直连)。
- **⚠️ OKX 封美国 IP**:GitHub 托管 runner 多在美国/Azure → L4(OKX)可能 451/被拒 → **自动回退 Hyperliquid**(免 key、不封美区;仅 perp 腿 → L4 标 partial),两者都失败才 missing,workflow 不因此失败。DeFiLlama/FRED/CoinGecko 不受影响。
- **GitHub Pages 公开可见**(无密钥泄露风险,但面板公开);前端 `fetch('./data/...')` 为文档相对路径(`index.html` 无 `<base>`,`<script src="./main.js">`),在 Pages 子路径 `user.github.io/<repo>/` 下解析为 `.../<repo>/data/...`,**已确认无需改动**。
- **前置**:本仓库目前**无 remote**,需先建 GitHub repo → `git remote add origin` → push;Pages 设置里 Source 选 "GitHub Actions"。

> **已实施**:见 `.github/workflows/collect-and-deploy.yml`(单 job:`npm test` → collect → commit 数据回 main → 部署 Pages;`concurrency: pages` 串行化)。防自我触发三重防护:`push.paths-ignore` 忽略两数据文件 + 提交 `[skip ci]` + 默认 `GITHUB_TOKEN`。OKX 失败隔离已本地验证(L4 标 missing、collectCockpit 不抛错、exit 0)。
> **启用前置(需手动)**:① GitHub 建 repo → `git remote add origin <url>` → `git push -u origin main`;② Settings → Pages → Source 选 **"GitHub Actions"**;③ 之后可在 Actions 页 "Run workflow" 手动 dispatch 验证。
