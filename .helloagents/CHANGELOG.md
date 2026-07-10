# CHANGELOG

## 2026-07-10(下午)

- **conviction 评分纠偏:换手山形 + 动量去追高**: 诊断(真实面板):层信号名义占 60% 但当日实际只 ±6 分(SOL flat 不投票、动态标的无 sector/launchpad tag、dexCex 小额)→ 排名被标的因子主导;且旧换手 `log10 clamp` **只加不减、≥10x 一律满分**(LAB 43.8x 最浅赌桌拿满分),动量 24h 权重 0.5 使日涨 +25% 近满分(纯追涨)。修:① **换手改"甜区"山形**——<0.5x=0、0.5~2x 上坡、2~15x 甜区=1、15~40x 衰减到 0;**>25x 加「极端换手(赌场池形态)」风险旗降一档**;② **动量正向单窗截 +30%**(超出部分不计,短窗不跟分数上不去;负向不截,跌全额扣)。真实标的离线重算验证:LAB 换手 +10→0+赌场旗;MORPHO(1.86x 健康换手)9→16 反超链逆风的 TAG 登顶——层信号话语权自然回升;今日无 >30% 单窗,动量全员不变(cap 是防未来暴拉的保险丝);全员档位无跳变。类型: 修改。文件: `src/cockpit/engine.mjs`, `tests/cockpit-engine.test.mjs`(+2 形状锁定测试)。测试 142→**144** 绿。

## 2026-07-10

- **链流动性热度体检:2 个新数据源 + 链热度一览卡(sparkline)**: 以真实案例(BSC 7-06 峰值 0.46→7-09 收 −0.23 降温;HOOD 7-08 升温 0.27~0.69)体检出三个缺口并补齐:
  ① **新源 `chain-pools`**(GT 每链头部20池,按 24h 量排序):聚合 池量/池液/换手(量÷液)——**GMGN"每链 top100 币日交易量"的免费等价**(GMGN 无公开 API+CF 防护,CI 不可行);换手当场证明价值:SOL 63x(浅水激流,pump.fun 池)vs Base/ETH 1.5-1.7x(深水慢流)vs BSC 11x。**429 教训**:watchlist trending(4 并发)与本源同窗口打 GT 必被限速 → 本源改**严格串行(1.2s 间隔)+ 429 重试 2 次(5s/10s)+ 在采集流程最后执行**(与 trending 拉开最远),测试锁定串行行为(maxInFlight===1)。robinhood 无 GT → missing 诚实。
  ② **新源 `chain-tvl`**(DeFiLlama v2/chains,1 次调用):全链 TVL 存量水深,含 robinhood($93M)——无 GT 的链热度卡回退显示 TVL。
  ③ **历史扩展**:条目新增 `chainDexVol/chainTvl/chainPoolsVol/chainPoolsLiq`(与 chainScores 同 late-patch 模式,`buildChainMetricsPatch` 只存有限值)——量/流动性时间序列从今天开始积累。
  ④ **UI 链热度一览卡**(L2 表上方,每链一卡):**现状**=热度分(综合分×100,正流入/负流出)、**趋势**=vs24h 分数变化箭头 + 近48h sparkline(内联 SVG 零依赖,数据来自前端并行拉取的 cockpit-history.json,分数历史自 07-06 起,不足显"积累中")、**持续性**=复用 persistCell 短标;副行 量/池液(或 TVL)/换手。实测卡片直接画出 BSC 降温曲线(−28↓−30 红线下行)与 HOOD 回落曲线。fieldNote 补「热度卡」「池液/换手」术语。类型: 新增。文件: `src/cockpit/providers/chain-pools.mjs`(新), `src/cockpit/providers/chain-tvl.mjs`(新), `src/cockpit/history.mjs`, `scripts/collect-cockpit.mjs`, `public/main.js`, `public/index.html`, 测试×3。测试 135→**142** 绿。

## 2026-07-08(下午2)

- **新增第 5 条链 Robinhood Chain(Codex 实现 + 本会话 review)**: ① `config.mjs` `SUPPORTED_CHAINS` 加 `{id:robinhood, label:Robinhood, llamaName:"Robinhood Chain", ecosystemSymbols:[]}`——DeFiLlama 三源都有(稳定币$254M、DEX 24h≈$32M/+69%),但费用=0、**无 GeckoTerminal**(fast 6h 缺失→综合分降级到 mid+slow 归一化);② **新链脏数据去噪** `capDexChangePct()`(chain-flow):DEX 变化% 超 ±1000% 时截断并保留 raw + 标 `新链·基数低`(robinhood 7d 原始达 2.1亿%,除零假象),前端 L2 表 7d 列显示 `≫+1000% 新链·基数低` + title 带原始值;③ watchlist 对无 GT/CoinGecko 映射的链逐链 catch 优雅降级(不加假映射);④ 健康信号取舍:robinhood 结构性缺 GT/费用 → `geckoterminal-trending` 源 + `chain` 层显 `partial`,**接受为诚实标注**(不豁免)。测试 132→**135**(config/cap/降级三个新测试)。**Review 结论**:实现正确、端到端跑通(5 行渲染/7d 限幅/降级不崩/无控制台报错),review 侧顺手修 1 处漏改文案(fieldNote「四链」→「所列链」)。类型: 新增。文件: `src/config.mjs`, `src/cockpit/layers/chain-flow.mjs`, `public/main.js`, `tests/config.test.mjs`, `tests/cockpit-chain-flow.test.mjs`, `tests/cockpit-provider-watchlist.test.mjs`。

## 2026-07-08(下午)

- **全站字段消歧:每表加「字段说明」可展开 + 表头 title**: 应"字段含义都标上、禁止歧义"——6 张数据表(L2 链间 / L3 发射台 / L4 DEX↔CEX / L5 板块 / App 收入 / 仓位建议)每张下方加一个 tap 可展开的「字段说明 · 点击展开」`<details>`,逐列列出`表头=精确含义`+ 关键徽章(方向词/持续性四档/flowType/仓位档/数据质量…)+ 口径提示(如 L2 的 12h/3d 免费源无、L4 闸门信号不指导单标、App 活动热度非净流入)。**移动端专门用 tap 展开而非 title 悬停**(手机 hover 不出);桌面端同时给每个 `<th>` 加 title 即时悬停。新增 `fieldNote()` helper + `.field-note/.fn-*` 样式(复用 `.deriv` 的 accent summary、32px 触达)。纯前端。文件: `public/main.js`, `public/index.html`。测试 132 绿,移动端 375px 目验(6 表字段说明齐全、可展开、不溢出)。

## 2026-07-08

- **L2 链间表加 DEX 量绝对值 + 多窗变化列**: 应需求把链间层的 DEX 量摊开——新增 4 列 `量24h`(24h 绝对成交额,如 SOL $25.19亿)、`6h`(近6h vs 全天均速加速)、`24h`(原「DEX量1d」重命名)、`7d`(DEX 量环比)。① 引擎 `applyComposite` 透传 `dexVol24hUsd`+`dexVolChange7dPct` 到组件(此前只算不展示;广度仍在 collect 单独取 7d,不受影响);② 前端 `chainPanel` 加列,`6h` 用 accelCell(比率×100、死区±10%),绝对量 nowrap 防"亿"换行;③ **数据诚实脚注**:用户要的 12h/3d 在任何免费源都不存在(DeFiLlama 日粒度只有 24h/7d/30d;GeckoTerminal 只有 1h/6h/24h)→ 用 6h 替 12h、7d 替 3d,表格与脚注明确标注"12h/3d 免费源无",不硬凑;④ 顺带把「费用」口径在脚注讲清=协议收入(DeFiLlama revenue)动量。移动端 375px 表格 `.table-scroll` 内滚不溢出。类型: 新增。文件: `src/cockpit/layers/chain-flow.mjs`, `public/main.js`。测试 132 绿,真实数据目验(SOL/Base/ETH/BSC 量+多窗+颜色分级)。

## 2026-07-07(下午4)

- **持续性标签去歧义 + 广度人类友好**: ① 引擎中性 tier 词 `升温(1-3d)→持续(1-3d)`——"升温"隐含流入,但持续性对**流出**链同样成立(SOL 净流出却标升温=歧义),改中性词由前端加方向前缀;② 前端持续性统一加**方向前缀**(流入/外流,来自 `c.direction`/边目的地)——L2 表 `persistCell(p, direction)`、轮动边徽章(恒流入)、边推导行;③ **广度改 `N/4窗`** 并加 title 悬停全解释("1h/6h/24h/7d 中与当前方向一致的时间窗数,越多越可信"),不再是无说明的裸数字;④ 顺手修推导文案 `入>+0.15→入>+0.10`(阈值早已降到 0.10,文案漏改)。纯前端 + 1 处引擎标签串。文件: `src/cockpit/layers/chain-flow.mjs`, `public/main.js`。测试 132 绿。

## 2026-07-07(下午3)

- **仓位详情行加风险标记全文**: 移动端此前只在结论卡/仓位表看到风险"数量",具体内容看不全 → 详情行新增「风险标记」板块,逐条列出全文(如"流动性薄(<$30万),出场滑点风险"),带数量角标,无风险显示"无"。纯前端。文件: `public/main.js`, `public/index.html`。

## 2026-07-07(下午2)

- **仓位详情行加顺风/逆风(移动端可见)**: 仓位表的顺风/逆风两列在移动端本用 `.hide-mobile` 隐藏(省宽度),导致手机看不到 → 现把顺风/逆风移进可展开详情行(桌面列保留),且带层名+原因(如"chain(SOL 链上资金净流出)")比原列更详细。纯前端。文件: `public/main.js`。

## 2026-07-07(下午)

- **费用驱动边过滤 + 交易阈值降 + L2 持续性列**: ① 轮动地图**过滤掉费用驱动(flowType=fee)的链边**(如 ETH 被 Titan Builder 出块费用抬起、交易在降的假象),只画真实交易轮动;② 交易型目的地阈值 0.15→0.10(费用虚抬已去,交易 0.10+ 即真实)→ 实测 `SOL→BSC[交易热钱]` 归位显示;③ 被过滤的链仍在 L2 链间表可见并标 ⚠费用尖刺+"费用/交易"驱动;④ **L2 链间表新增「持续性」列**——每条链的可持续热度(闪现/升温/结构性/积累中·Nh·动量)常驻可见,不再只在轮动边上露出。类型: 修复/新增。文件: `src/cockpit/layers/chain-flow.mjs`, `public/main.js`。测试 132 绿。

## 2026-07-07

- **轮动多目的地 + 费用去噪 + 链间面板前移**: ① 轮动边从"只画最强一条"改为**画出所有轮入目的地**(SOL→ETH 和 SOL→BSC 并列,不再互相掩盖);② 每条链边分类 **flowType: trading(交易热钱,6h/24hDEX 放量)/ fee(费用驱动,交易冷、仅靠协议费用)**;③ **费用去噪**:单一协议占该链 fee >60%(如以太坊 Titan Builder 出块/MEV)按集中度线性折价(60%→不折,100%→归零),防止一个 builder 的费用暴涨把链虚抬成头号目的地——实测 Titan 85% 时 ETH 从 +0.21 降到 flat、BSC 归位为头号目的地;④ 前端边行加 [交易热钱]/[费用驱动] 徽章 + ⚠费用尖刺(协议名+份额),推导块加"驱动"说明;⑤ L2 链间面板移到轮动地图正下方交叉对照。类型: 修复/新增。文件: `src/cockpit/layers/chain-flow.mjs`, `public/main.js`, `tests/cockpit-chain-flow.test.mjs`。测试 131→132。

## 2026-07-06(夜2)

- **轮动地图加支持数据+推导 + 前移**: 轮动地图从页面靠后移到**结论卡/可信度栏之后第 3 位**(资金往哪轮是核心视图);新增可展开「推导过程 + 支持数据」——逐条边按类型摊开:链间边(综合分选端点 fast6h×0.45+mid24h×0.35+slow存量×0.20、非对称阈值、两端点 6h加速/24hDEX/费用/存量Δ、分级、慢钱跟进、持续性)、板块边(最强←最弱 7d 差值+目的地成分协议)、发射台边(最热←最冷动量+收入/份额+体量门槛)。标题改「轮动地图 · 资金往哪轮」。纯前端。文件: `public/main.js`。

## 2026-07-06(夜)

- **L5 板块轮动加支持数据+推导过程**: narrative 层原本只聚合板块 TVL/加权变化、丢弃成分协议 → 现保留每板块 top3 成分协议(名称/TVL/7d/1d),透传 change1dPct/strength/protocolCount、轮动边 fromChange/toChange、方向阈值 eps7dPct。前端板块表加「1d」「强度」列 + 可展开「推导过程 + 支持数据」块:逐板块显示方向规则(7d 加权变化 vs ±2% 死区)、强度分位、成分协议明细,轮动边推导(最强端←最弱端+差值),以及口径警告(USD-TVL 含币价噪声、热门搜索是可刷注意力代理不进引擎)。真实数据实测(CEX=Binance/OKX/Bitfinex 明细可见)。类型: 新增/修改。文件: `src/cockpit/layers/narrative.mjs`, `public/main.js`, `public/index.html`, `tests/cockpit-narrative.test.mjs`。测试 129→131。

## 2026-07-06(晚)

- **P-B 提速:GeckoTerminal 链级 6h/1h 快信号**: watchlist provider 从**同一份** trending_pools 响应聚合每链 `accel6h=(6h/6)/(24h/24)−1`(近6h vs 全天均值加速)、accel1h、量加权 6h 价动量、6h 买卖不平衡(零新增 API 调用);接入链间综合的 fast 层(0.45),使轮动可在 **6h 内早期发现**(仅快信号→edge stage=early;24h 追上→confirmed)。chain-volume 加 `change_7d`(持续性 7d 窗口)。GT h1 量/txns.h6 缺失优雅降级。
- **P-C 持续性签名**: 新增 `computeChainPersistence`——广度(1h/6h/24h/7d 同向计数)× 连续性(综合分连续同向小时数,来自历史)× 动量(复用 CUSUM/EMA 缺口判 building/fading)× 慢钱跟进(稳定币份额是否同向)→ 标签 `闪现(日内)/升温(1-3d)/结构性(多日)/积累中`(诚实:当前形态刻画**非未来预测**,需历史积累)。history 新增每链综合分快照 + `buildChainScoreSeries`;持续性挂到每链组件与每条轮动边(边=目的地链签名)。前端结论卡/轮动地图显示分级+持续性徽章。类型: 新增/修改。文件: `src/cockpit/providers/watchlist.mjs`, `src/cockpit/providers/chain-volume.mjs`, `src/cockpit/layers/chain-flow.mjs`, `src/cockpit/history.mjs`, `scripts/collect-cockpit.mjs`, `public/main.js`, `tests/cockpit-chain-flow.test.mjs`。测试 127→129。

## 2026-07-06(下午)

- **轮动治本:边改用综合信号选端点(修 SOL→BSC 漏判)**: 轮动边原来只按"稳定币供应份额(存量)"选端点并卡阈值,存量 intraday 几乎不动 → 昨天 SOL 冷/BSC 热(DEX −11%/+43%、费用背离)明明白白却画不出边。改为按**多时间轴综合分**(fast 6h / mid 24h / slow 存量 = 0.45/0.35/0.20,缺失层归一化)选端点;非对称阈值(目的地 >+0.15、来源 <−0.05);边分两级 **stage: early(仅快信号)/ confirmed(24h 确认)** + slowFollow(慢钱是否跟进)。真实数据实测:`SOL→BSC 已确认` 现在会亮(strength 24)。前端结论卡链间行+轮动地图显示分级徽章。fast(6h)入口(chainActivity)已在 chain-flow 留好,GT 聚合快信号(P-B)与持续性(P-C)随后接。向后兼容:无 activity 时退回 mid+slow,无任何增强参数时退回旧存量边。类型: 修复/修改。文件: `src/cockpit/layers/chain-flow.mjs`, `public/main.js`, `tests/cockpit-chain-flow.test.mjs`。测试 126→127。

- **标的详情加 GMGN 跳转**: 合约地址行新增「GMGN ↗」外链(`gmgn.ai/{sol|eth|base|bsc}/token/{ca}`,链 slug 映射,仅有 CA 且已知链时显示;`target=_blank rel=noopener noreferrer`)。纯展示。文件: `public/main.js`, `public/index.html`。

- **标的链+合约地址(CA)点击复制**: watchlist provider 从 GeckoTerminal `base_token.data.id`(`链_地址`,按首个下划线切)解析 CA 写入 metrics.ca(CoinGecko 兜底无地址=null 诚实标注);仓位主行加链标签 chip(SOL/ETH/Base/BSC),详情行加合约地址行——截断显示(前6…后4)+ 完整地址进 title/data-ca + 复制按钮(navigator.clipboard,execCommand 兜底,复用点击事件委托、stopPropagation 不误触发行展开,复制完整地址)。Codex 实现+审查(实测复制全址、不撑破 390px)。测试 125→126。类型: 新增/修改。文件: `src/cockpit/providers/watchlist.mjs`, `public/main.js`, `public/index.html`, `tests/cockpit-provider-watchlist.test.mjs`。
- **展示数字人类友好**: usd 改中文万/亿/万亿去尾零;新增 price(不足 $1 不再抹成 $0)、ratio(合约/现货 ×)、fundingAnnual(每 8h 费率年化%/年)、countCn(N 笔)、relTime(相对时间);改造 L4 费率/量比、仓位详情 metrics、宏观净流动性、footer 时间。纯展示层,引擎/数据不变。文件: `public/main.js`, `public/guide.html`。

## 2026-07-04

- **决策优先 UI 改版(Codex 实现 + Claude 审查)**: 新增顶部「结论卡」(水位/链间/发射台/潮汐+杠杆/行动五行,红绿灯语义,缺失层如实标注)与「可信度栏」(相对更新时间+五层质量点+可展开源状态);每面板加"怎么读"一行;关键数值好坏着色;版面重排(结论→可信→仓位→L3+L2→L4+L5→辅助);宏观三曲线挪页尾 <details> 默认折叠+首次展开才渲染;移动端(≤480px)表格容器内横滚、guidance 隐藏顺风/逆风列、触控≥32px。审查修复 8 处: 潮汐/杠杆独立组合(dexCex missing 不再吞掉潮汐)、水位行不因宏观缺失隐藏 flowState 信息、链间行轮动边按 type=chain 过滤(发射台边误挂)、拐点警报带链名、风险 0 不显示、guidance 表移动端 min-width 特异性、grid 项 min-width:0 防页面撑宽、错误提示脚本名。类型: 修改。文件: `public/index.html`, `public/main.js`。

## 2026-07-03

- **Telegram 状态变化推送**: 采集后对比上一次已提交快照,仅状态变化时推送(regime/钱位/仓位档/轮动边/层质量/潮汐方向);无 secret 静默跳过、发送失败与畸形快照均隔离(CLI 兜底 catch,永不 fail workflow)、token 不落日志、消息 20 行截断。类型: 新增。文件: `scripts/notify-telegram.mjs`, `tests/notify-telegram.test.mjs`, `.github/workflows/collect-and-deploy.yml`。
- **敏锐度包(1h 采集+潮汐+时间锚定+检测器)**: 采集 4h→1h(cron `17 * * * *`),历史上限 720 点≈30 天;链流 delta 改真实时间 4h 锚定(与采集频率解耦,旧纯数字序列路径不变);新增稳定币总量潮汐旁路 `stableTide`(24h/7d 锚定变化+EMA 缺口+CUSUM,不进引擎 v1);`stats.mjs` 新增 `emaGap`/`cusum`/`resampleByTime`;`replay-detectors.mjs` 回放验证(Base 链 313h 内 0 方向翻转但 CUSUM 捕获 4 段慢漂移)。类型: 新增/修改。文件: `src/config.mjs`, `src/cockpit/history.mjs`, `src/cockpit/stats.mjs`, `src/cockpit/layers/chain-flow.mjs`, `src/cockpit/layers/stable-tide.mjs`, `src/cockpit/contract.mjs`, `scripts/collect-cockpit.mjs`, `scripts/replay-detectors.mjs`, `public/main.js`, 相应测试。
- **L4 Hyperliquid 云端回退**: OKX 451(美区 runner)时自动回退 Hyperliquid 公共 API(免 key;funding 小时率×8 对齐 OKX 8h 口径,OI×markPx,无现货腿→层标 partial 不造 ratio);两者都失败才 missing。类型: 新增/修改。文件: `src/cockpit/providers/hyperliquid.mjs`, `scripts/collect-cockpit.mjs`, `src/cockpit/layers/dexcex.mjs`, `tests/cockpit-provider-hyperliquid.test.mjs`, `tests/cockpit-dexcex.test.mjs`。
- **审查修复(ha-reviewer 6 项采纳)**: 三处 `Number(null)=0` 陷阱(hyperliquid num / buildHistoryEntry totalUsd / resampleByTime+anchoredDeltas 前置拒绝);CUSUM 加 `stepsSinceAlarm` 时效闩锁(>24h 旧警报不再当"当前拐点")+ z 值 ±4 winsorize(停采缺口压缩不再单步假警报);dexCex 无现货腿时 quality 如实 partial;潮汐 ok 门槛提高到 24h+7d 锚点双达;notify 畸形形状硬化。遗留(P1 记录): 重采样网格纪元对齐、缺口分段 CUSUM、strength 分位样本自相关说明。类型: 修复。文件: 同上各模块。

## 2026-06-29

- **GitHub Actions 定时采集 + Pages 托管**: 新增 `collect-and-deploy.yml`,schedule(cron 每 4h)+ workflow_dispatch + push 触发;步骤 checkout → setup-node@v4(node 22)→ `npm test` 门禁 → `node scripts/collect-cockpit.mjs` 直连采集 → 把 `cockpit.json`/`cockpit-history.json` commit 回 main 累积滚动历史 → upload-pages-artifact + deploy-pages 部署 `public/`。零 secret / 零代理 / 零新依赖(仅官方 actions);OKX 在美区 runner 多半 451,靠现有失败隔离标 L4 `missing` 且 workflow 不失败(已本地注入 loadDexCex 抛错验证 collectCockpit 仍 resolve、CLI exit 0)。防自我触发:push.paths-ignore 忽略两数据文件 + 提交信息 `[skip ci]` + 默认 GITHUB_TOKEN 推送不再触发新 run。`.gitignore` 放行 `public/data/cockpit*.json`。前端 `./data/...` 为文档相对路径(无 `<base>`),在 Pages 子路径下解析正确,无需改动。类型: 新增/修改。文件: `.github/workflows/collect-and-deploy.yml`, `.gitignore`, `docs/project-handover.md`。

## 2026-06-22

- **App 收入热度辅助信号**: 新增 cockpit/v2 顶层 `appRevenueHeat` side-channel，按 DeFiLlama chain fees 采集各链协议 24h revenue 排名，标注活动热度而非流动性/净流入；前端新增辅助面板，低份额动量去噪并标记单协议 spike。类型: 新增/修改。文件: `src/cockpit/layers/app-revenue.mjs`, `src/cockpit/providers/app-revenue.mjs`, `scripts/collect-cockpit.mjs`, `src/cockpit/contract.mjs`, `public/main.js`, `tests/cockpit-app-revenue.test.mjs`, `tests/cockpit-provider-app-revenue.test.mjs`, `README.md`, `docs/PRD-capital-flow-cockpit.md`。

## 2026-06-17

- **历史数据导出入口**: `dashboard.meta.exports.history` 新增历史 JSON 导出元数据，前端总览区新增 `public/data/history.json` 下载入口，展示历史点数和最新采集时间，方便离线复盘。类型: 修改。文件: `src/scoring.mjs`, `public/index.html`, `public/main.js`, `public/styles.css`, `tests/dashboard.test.mjs`, `README.md`, `technical-solution.md`, `docs/real-data-hot-money-flow-technical-plan.md`, `docs/project-handover.md`。
- **数据源健康历史统计**: `sourceHealth` 新增最近成功时间、最近失败时间、最近观测状态和连续失败次数，统计来自 `public/data/history.json` 与本轮 `meta.sourceStatus`；前端健康卡片同步展示这些字段。类型: 修改。文件: `src/source-health.mjs`, `src/scoring.mjs`, `public/main.js`, `public/styles.css`, `tests/dashboard.test.mjs`, `README.md`, `technical-solution.md`, `docs/real-data-hot-money-flow-technical-plan.md`, `docs/project-handover.md`。
- **交接文档状态补充**: 更新项目交接文档，补充当前本机验证快照、`meta.sourceStatus` 字段位置、OKX/GMGN 代理失败原因、Dune 当前边界和接手优先级。类型: 修改。文件: `docs/project-handover.md`。
- **项目交接文档**: 新增面向接手人的交接文档，覆盖项目定位、启动方式、数据流、数据源凭据、打分与热钱逻辑、部署、测试、排错、限制和后续优先级。类型: 新增。文件: `docs/project-handover.md`。
- **Dune API 结构化辅助采集**: 新增 `src/providers/dune.mjs`，支持 `DUNE_API_KEY` 与 `DUNE_LAUNCHPAD_QUERIES` 拉取 Dune latest query results，并将 launchpad 24h 创建、毕业、成交、交易者和手续费汇总展示到 Dune 辅助信号与链卡 hover；未配置时继续使用 iframe/外链，不入主分。类型: 新增/修改。文件: `src/providers/dune.mjs`, `scripts/collect.mjs`, `src/scoring.mjs`, `src/insights.mjs`, `src/history.mjs`, `public/main.js`, `public/styles.css`, `tests/dune-provider.test.mjs`, `tests/collect.test.mjs`, `tests/dashboard.test.mjs`, `.env.example`, `README.md`, `technical-solution.md`, `docs/real-data-hot-money-flow-technical-plan.md`, `docs/project-handover.md`。
- **数据源健康检查面板**: 新增 `sourceHealth` 模型和前端健康面板，区分 DeFiLlama/OKX 核心源、GMGN/Dune 辅助源、DeFiLlama Bridges 付费受限源和钱包级聪明钱缺口；将 `bridges.llama.fi` 当前 402 付费限制明确标注为 `paid_unavailable`，不入主分。类型: 新增/修改。文件: `src/source-health.mjs`, `src/scoring.mjs`, `public/index.html`, `public/main.js`, `public/styles.css`, `tests/dashboard.test.mjs`, `README.md`, `technical-solution.md`, `docs/real-data-hot-money-flow-technical-plan.md`, `docs/project-handover.md`。
- **GMGN 链级辅助热度分**: 为 GMGN 24h trending 汇总新增 `hotTokenHeatScore`、分档和驱动说明，按热门币成交、流动性、ATH、smart/KOL 和数量聚合，并对 ATH 异常扣分；结果只展示在辅助信号和 hover 中，不进入一级主分。类型: 修改。文件: `src/providers/gmgn.mjs`, `src/scoring.mjs`, `public/main.js`, `public/styles.css`, `tests/gmgn-provider.test.mjs`, `tests/dashboard.test.mjs`, `README.md`, `technical-solution.md`, `docs/real-data-hot-money-flow-technical-plan.md`, `docs/project-handover.md`。

## 2026-05-16

- **MVP 实现**: 新增免费、本地优先的流动性信号面板 MVP。包含 Node.js 采集脚本、链级评分逻辑、静态前端、本地服务、测试和部署说明。类型: 新增。文件: `package.json`, `src/`, `scripts/`, `public/`, `tests/`, `README.md`, `vercel.json`, `technical-solution.md`。
- **悬浮原始数据与定时刷新**: 分数卡和链卡新增悬浮原始指标，本地服务启动后采集并每 4 小时自动更新静态 JSON，前端每 4 小时重新读取数据。类型: 修改。文件: `src/scoring.mjs`, `src/config.mjs`, `public/main.js`, `public/styles.css`, `public/index.html`, `scripts/collect.mjs`, `scripts/serve.mjs`, `README.md`, `technical-solution.md`。
- **可解释性与有效性可视化**: 新增数据可信等级、打分原理、链间资金流图、24h/3天/7天链指标曲线，并修复一级分数详情中原始指标展示为 0 的问题。类型: 修改。文件: `src/insights.mjs`, `src/scoring.mjs`, `public/index.html`, `public/main.js`, `public/styles.css`, `tests/dashboard.test.mjs`, `README.md`, `technical-solution.md`。
- **严格真实历史曲线与 OKX 代理**: 新增 `public/data/history.json` 真实采集快照持久化，趋势曲线不再由快照推导；OKX Public REST 支持浏览器化请求头、代理环境读取和 chunked 响应解析。类型: 修改。文件: `src/history.mjs`, `src/insights.mjs`, `src/scoring.mjs`, `src/providers/okx.mjs`, `scripts/collect.mjs`, `tests/history.test.mjs`, `tests/okx-provider.test.mjs`, `README.md`, `technical-solution.md`。

## 2026-05-18

- **真实数据热钱流向方案**: 新增真实数据热钱流向技术方案，明确生产 dashboard 不允许 mock/fallback 入分，热钱流向只使用真实历史点。类型: 新增。文件: `docs/real-data-hot-money-flow-technical-plan.md`。
- **真实源门控与交易可用性**: 移除生产采集的 sample fallback，DeFiLlama / OKX 失败时对应分项为 `null`，总分为 `null`，状态为“数据不足”；新增 `tradeReadiness`。类型: 修改。文件: `scripts/collect.mjs`, `src/scoring.mjs`, `src/config.mjs`, `tests/dashboard.test.mjs`, `tests/scoring.test.mjs`。
- **真实历史热钱流向可视化**: 链指标曲线过滤非真实 DeFiLlama 历史点，新增 `hotMoneyFlow`，链间箭头基于最近两个真实历史点的 DEX 交易量、稳定币、TVL 和量效变化。类型: 修改。文件: `src/insights.mjs`, `public/main.js`, `public/styles.css`, `public/index.html`, `README.md`, `technical-solution.md`。
- **交易热度与资金流入拆分**: `hotMoneyFlow` 拆成 `tradingHeat` 与 `capitalFlow`，前端资金迁移区新增可悬浮信号卡；DeFiLlama stablecoin charts 接入稳定币桥接/铸造代理，DeFiLlama Bridges 作为付费缺口显示。类型: 修改。文件: `src/insights.mjs`, `src/providers/defillama.mjs`, `src/history.mjs`, `src/scoring.mjs`, `public/main.js`, `public/styles.css`, `tests/dashboard.test.mjs`, `tests/history.test.mjs`, `README.md`, `technical-solution.md`, `docs/real-data-hot-money-flow-technical-plan.md`。
- **数据口径与窗口标注**: `hotMoneyFlow` hover 新增比较窗口、DEX 24h 指标口径、稳定币口径；方法论面板新增数据字典，并修正“活跃动量/交易动量”的真实含义。类型: 修改。文件: `src/insights.mjs`, `src/scoring.mjs`, `public/main.js`, `public/styles.css`, `tests/dashboard.test.mjs`, `README.md`, `technical-solution.md`, `docs/real-data-hot-money-flow-technical-plan.md`。
- **缺失指标出分隔离**: 一级链打分移除真实桥净流和新池活动的无支撑入分，改用稳定币桥接代理作为可解释 proxy；hover 和数据字典标注真实桥净流、新池/新币成交取不到，GMGN 可作为后续补充源。类型: 修改。文件: `src/scoring.mjs`, `src/providers/defillama.mjs`, `src/insights.mjs`, `tests/scoring.test.mjs`, `README.md`, `technical-solution.md`, `docs/real-data-hot-money-flow-technical-plan.md`。
- **Dune 辅助信号目录**: 新增 Dune launchpad 辅助信号源目录，覆盖 Four.meme、Pump.fun、LetsBonk、Solana launchpad、Clanker、Zora Creator Coins、Flaunch 和 ETH 新池代理；前端方法论面板展示候选源，未自动采集前不入分。类型: 修改。文件: `src/insights.mjs`, `public/main.js`, `public/styles.css`, `tests/dashboard.test.mjs`, `README.md`, `technical-solution.md`, `docs/real-data-hot-money-flow-technical-plan.md`。
- **GMGN 参考实现对齐**: 新增 `src/providers/gmgn.mjs`，按 `D:\trea\proj\test\tools\system` 的用法实现 `npx gmgn-cli ... --raw` 命令构造、链名映射、payload normalize、Solana 质量过滤和链级汇总；方法论和文档同步标注 GMGN 当前为候选 API 源，未默认入分。类型: 新增。文件: `src/providers/gmgn.mjs`, `tests/gmgn-provider.test.mjs`, `src/insights.mjs`, `public/main.js`, `public/styles.css`, `tests/dashboard.test.mjs`, `README.md`, `technical-solution.md`, `docs/real-data-hot-money-flow-technical-plan.md`。
- **GMGN 默认辅助采集**: `npm run collect` 默认执行 GMGN 四链 24h trending 采集，读取项目 `.env`、参考项目 `.env` 或用户级 GMGN 配置，并继承代理变量；成功时在热钱流向区和链卡 hover 展示热门币成交、ATH、流动性和 smart/KOL 汇总，链级 ATH 汇总过滤超大异常值，失败时只标注 `sourceStatus.gmgn=error`，不阻塞主分。类型: 修改。文件: `scripts/collect.mjs`, `src/providers/gmgn.mjs`, `src/config.mjs`, `src/insights.mjs`, `src/scoring.mjs`, `src/history.mjs`, `public/main.js`, `public/styles.css`, `tests/collect.test.mjs`, `tests/dashboard.test.mjs`, `tests/history.test.mjs`, `tests/gmgn-provider.test.mjs`, `README.md`, `technical-solution.md`, `docs/real-data-hot-money-flow-technical-plan.md`。
- **Dune iframe 辅助看板**: 资金流向区新增 Dune launchpad iframe/外链看板，覆盖 Four.meme、Pump.fun、LetsBonk、Clanker、Zora Creator Coins、Flaunch 和 ETH 新池代理；新增 `DUNE_API_KEY` 环境占位，当前 iframe 不入主分，后续可用 Dune API query id 做结构化采集。类型: 修改。文件: `src/insights.mjs`, `src/config.mjs`, `public/main.js`, `public/styles.css`, `tests/dashboard.test.mjs`, `.env.example`, `.env`, `README.md`, `technical-solution.md`, `docs/real-data-hot-money-flow-technical-plan.md`。
