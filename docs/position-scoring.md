# 统率三军位置评分体系（v2）

面向“规则 AI 选将”的位置评分。目标不是给武将排一个绝对强弱榜，而是回答：

> 同一个武将，在我方当前阵营、当前抓将轮次、当前阵容缺口下，放到主帅 / 前锋 A / 前锋 B 哪个位置最有价值？这个价值是否值得现在抢？

统率三军先做，因为它的位置差异最大：主帅阵亡即负、主帅默认够不到敌方前锋、两边先行动的前锋还错位对位。v2 以使用者划定的七类定位为基础，把位置职责从“主帅/前锋 A/前锋 B”三档扩展为冷主、冷 A、冷 B、暖主、暖 A、暖 B 六个位置角色。

## 1. 位置事实

### 1.1 座次与距离

引擎座次固定为顺时针：

```
冷 FLANK_A(0) → 冷 COMMANDER(1) → 冷 FLANK_B(2)
→ 暖 FLANK_B(3) → 暖 COMMANDER(4) → 暖 FLANK_A(5)
```

开局无坐骑时：

| 关系 | 距离 |
| --- | --- |
| 同阵营主帅 ↔ 己方前锋 | 1 |
| 同阵营前锋 A ↔ 前锋 B | 2（隔着主帅） |
| 冷 A ↔ 暖 A、冷 B ↔ 暖 B | 1 |
| 前锋 ↔ 敌方主帅 | 2 |
| 主帅 ↔ 敌方主帅 | 3 |
| 冷 A ↔ 暖 B | 3 |

关键结论：

- 主帅默认攻击范围 1，**够不到敌方任何前锋**（距离 2），只能靠武器、-1 马、马术/远程技能参与进攻；因此主帅位主要吃“生存、辅助、低手牌启动”，纯输出会浪费站位。
- 前锋与对位前锋距离 1，天然承担输出与承伤；前锋 A/B 不是对称的，差别来自行动顺序与对位。

### 1.2 行动顺序与手牌

- 冷方先手；第 1 大回合先手方只能选主帅行动，且冷方主帅起手 4 张。
- 暖方后手；暖方主帅起手 5 张（引擎在部署后给暖方主帅多 1 张）。
- 前锋单元按座次顺序行动：冷方 A → B，暖方 B → A。
- 每方先行动的前锋，对位的是对方**后行动**的前锋：
  - 冷 A（先动）对位暖 A（后动）；
  - 暖 B（先动）对位冷 B（后动）。

所以“先行动边锋”适合爆发、控制、低手牌也能做事；“后行动边锋”适合承伤、续航、收割。旧部署逻辑把排序后的第一名前锋固定放 FLANK_A，对暖方是反的；新部署枚举按位置分自然修正。v2 进一步把冷/暖与 A/B 拆成六个位置角色。

### 1.3 位置职责

位置职责按“行动目标”定义，而不是“主帅=辅助、前锋=输出”。同一个主帅位，冷方与暖方的职责不同；同一个边锋位，先手与后手也不同。

| 位置角色 | 主要职责 | 关键能力 | 最怕 |
| --- | --- | --- | --- |
| 冷主帅 | 冷方第一个主帅行动，限制暖二连 | 阻断、拆牌、防御、先手节奏 | 暖 B 爆发直接击杀；纯辅助/纯输出占位 |
| 冷 A | 冷方先手边锋，建立冷方连续行动 | 输出、控制、先手压制 | 打不动对位肉盾；被反手集火 |
| 冷 B | 冷方后手边锋，承接冷四连、造成减员 | 输出、控制、持续作战 | 被暖 B 先手打穿 |
| 暖 B | 暖方先手边锋，暖二连的爆发点 | 伤害、控制、距离 | 冷主干扰到位；被反手集火 |
| 暖 A | 暖方后手边锋，收尾并配合暖二连 | 输出、收割、生存 | 被冷方先手减员 |
| 暖主帅 | 暖方最后行动，为暖二连提供支援 | 辅助、回复、回合外收益 | 被冷方连续行动直接击杀 |

引擎座次仍是 `冷 A → 冷主 → 冷 B → 暖 B → 暖主 → 暖 A`；上表的“先手/后手”指同一阵营内部的边锋次序。冷主与冷 A 都服务冷方开局，但冷主吃“限制暖二连”的防御/控制，冷 A 吃“先手建立优势”的输出/控制。

## 2. 评分模型

### 2.1 能力向量

位置评分不直接给每个武将写“主帅 80 分”，而是先算 8 个能力维度（0–10），再用位置权重组合。能力向量以使用者划定的七类定位为基础：

| 定位 | survive | offense | control | support | tempo | reach | fragile | anchor |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 辅助 | 4 | 1 | 4 | 9 | 4 | 1 | 3 | 7 |
| 牌差 | 4 | 2 | 5 | 6 | 8 | 2 | 3 | 4 |
| 菜刀 | 5 | 9 | 3 | 1 | 7 | 4 | 4 | 2 |
| 直伤 | 3 | 9 | 4 | 1 | 7 | 6 | 6 | 2 |
| 控制 | 5 | 3 | 9 | 3 | 6 | 3 | 4 | 5 |
| 肉盾 | 9 | 2 | 4 | 3 | 2 | 1 | 1 | 7 |
| 回复 | 7 | 1 | 2 | 8 | 3 | 1 | 2 | 8 |

在此基础上只做三类小幅修正：

1. **体力**：`survive += 1.5 × (maxHp - 3)`；3 血武将 `fragile += 1.5`。
2. **技能关键词**：给牌/回复、输出、控制、防御、距离、节奏六组；每个技能只取第一组命中，每组 +1。
3. **技能类型**：主动 +0.5 tempo，锁定 +0.5 anchor，限定 +0.5 offense，觉醒 +0.5 survive。

定位表在 `client/src/engine/position-roles.ts`，技能只做位置倾向修正，不覆盖定位。未登记的武将回退旧定位表或按牌差处理。

输出示例：

- 张飞（菜刀）：offense 高，暖 B / 冷 A 明显高于主帅。
- 华佗（回复）：support/anchor 高，暖主最高。
- 界大乔（控制）：冷主最高，符合“阻断暖二连”。
- 张辽（控制）：突袭直接压制手牌，符合冷主限制暖二连；冷主与边锋都可。

### 2.2 位置权重

`POSITION_WEIGHTS`（`client/src/engine/position-score.ts`）按六个位置角色分别给权重：

| 维度 | 冷主 | 冷 A | 冷 B | 暖主 | 暖 A | 暖 B |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| survive | 0.95 | 0.50 | 0.65 | 0.95 | 0.55 | 0.45 |
| offense | 0.15 | 1.05 | 1.10 | 0.10 | 1.00 | 1.20 |
| control | 1.15 | 0.80 | 0.75 | 0.50 | 0.75 | 0.90 |
| support | 0.35 | 0.15 | 0.20 | 1.20 | 0.20 | 0.15 |
| tempo | 0.65 | 0.85 | 0.55 | 0.10 | 0.55 | 0.85 |
| reach | 0.15 | 0.55 | 0.60 | 0.10 | 0.60 | 0.65 |
| fragile | -0.95 | -0.50 | -0.50 | -0.85 | -0.50 | -0.50 |
| anchor | 0.60 | 0.15 | 0.20 | 1.00 | 0.20 | 0.10 |

位置基准 `POSITION_BASE`：冷主 +4、冷 A +2、冷 B +1.5、暖主 +4.5、暖 A +1.5、暖 B +2.5。

权重方向：

- **冷主**：control 1.15 最高，offense 0.15 最低；阻断/拆牌/防御优先，纯输出扣分。
- **暖主**：support 1.20、anchor 1.00 最高，tempo 0.10 最低；回合外支援优先。
- **暖 B**：offense 1.20、control 0.90 最高；先手爆发，直接威胁冷主。
- **冷 B / 暖 A**：offense 1.10 / 1.00，survive 0.65 / 0.55；承接连续行动，兼顾持续作战。
- **冷 A**：tempo 0.85、offense 1.05；先手建立冷方优势。

### 2.3 位置分公式

```
Slot = slotOf(faction, position)
PositionScore(g, p) =
    POSITION_BASE[Slot]
  + POSITION_TRAIT_SCALE × Σ_d POSITION_WEIGHTS[Slot][d] × trait[g][d]
  + SLOT_OVERRIDE[g][Slot]
  + Synergy(g, team)
  + Matchup(g, p, rival)
```

其中：

- `POSITION_TRAIT_SCALE = 0.85`。
- `slotOf` 把 `(faction, position)` 映射到 `coldCommander / coldFlankA / coldFlankB / warmCommander / warmFlankA / warmFlankB`。冷暖差异与先手/后手差异都在 slot 权重与 base 里，不再额外加 `Faction` 项。
- `Synergy`：与己方已选武将的 `synergyWeight` 累加，主帅位 ×0.8，封顶 12。
- `Matchup`：对手 8 人名单的平均能力做粗略对位；冷主看“己方 control + survive − 对方平均 offense”，暖主看“己方 support + survive − 对方平均 offense”，暖 B / 冷 A 看“己方 offense − 对方平均 survive”，冷 B / 暖 A 看“己方 offense + 0.5 control − 对方平均 survive − 0.5 control”；限制在 ±2.5。

### 2.4 位置先验

`SLOT_OVERRIDE` 只记录定位表无法表达的偏离，例如：

```ts
daqiao_jie: { coldCommander: 4 }
ganning_jie: { coldCommander: 3 }
xuhuang_jie: { coldCommander: 3 }
wenpin: { coldCommander: 4 }
qinmi: { coldCommander: 3 }
caoang: { coldCommander: 3 }
guojia_jie: { warmCommander: 4 }
huatuo_jie: { warmCommander: 3 }
zhangliao_jie: { coldFlankB: 1 }
zhangfei_jie: { warmFlankB: 2 }
```

这些是“先验”，不是官方数值。它们的作用是让第一版在没有校准数据时也能给出符合社区经验的排序；后续应被自对弈数据替换或修正。

## 3. 抓将：边际部署价值

统率三军选 8 人，但只上 3 人。因此不能把 8 个人的位置分简单相加，而要看“加入这个武将后，我方最佳三人阵容能提升多少”。

### 3.1 队伍价值

```
BestDeployment(T) = max over 3 人子集 × 3 座位的全部排列
TeamValue(T) = BestDeployment(T).total
             + 0.12 × Σ_{g 不在最佳三人} max_p PositionScore(g, p)
```

- 前三人的位置分按 100% 计入。
- 第 4–8 人的位置分只按 12% 计入“替补深度”，避免后几抓和前三抓抢同样的位置权重。
- 3 人时最多 6 种排列；8 人时最多 336 种，选将每个候选重算也足够小。

### 3.2 抓将总分

`draftScore` 当前实现：

```
PickScore(g) =
    Base(g)
  + Synergy(g, 己方已选)
  + Denial(g, 对手已选)
  + Composition(g, 己方已选)
  + 0.5 × (TeamValue(己方 ∪ {g}) − TeamValue(己方))
```

- `Base`：体力 ×10 + 抓将梯度 + 技能权重与技能类型，沿用既有 `scoreGeneral`。
- `Synergy`：现有 `synergyWeight` 累加，封顶 12。
- `Denial`：对手已有搭档时，抢走其缺的一半；`min(10, round(best × 1.2))`。抢核心搭档的价值高于普通同定位补位。
- `Composition`：补输出/辅助缺口，同定位堆叠 −3。
- 位置项系数 **0.5**：位置分只做同强度下的排序修正，不能盖过武将强度与抢人价值。

### 3.3 抓将轮次

当前总分不显式加“轮次分”，轮次通过三项自然体现：

- 首抓：`Base` 最高的武将天然领先；位置项帮助判断“这个强将是否适合我现在最缺的位置”。
- 双抓：第一抓拿核心，第二抓由 `Synergy` / `Composition` 补位。
- 末抓：`TeamValue` 的替补项只有 12%，位置提升很小；此时主要由 `Denial` 抢对手关键将、`Base` 补深度。

如果后续校准发现末抓仍过度追求位置分，可以在 `draftScore` 中把位置项按 `pickStep` 再乘一个折扣（例如末抓 ×0.5），但这需要 A/B 证据后再加，避免先验叠先验。

## 4. 部署：6 排列枚举

部署阶段对已选 8 人枚举“任取 3 人 × 3 座位”的全部方案，取总分最高：

```
DeployScore(assignment) = Σ_{i=1..3} [ Base(g_i) + PositionScore(g_i, p_i) ]
```

`rankDeployments` 返回按总分降序的方案，`bestDeployment` 取第一条。三人时固定 6 种排列；不足三人时枚举所有“位置分配”（1 人 3 种、2 人 6 种），便于抓将阶段计算边际价值。

平局处理：当前按枚举顺序稳定排序；如需更保守，可用旧的 `scoreGeneralForRole` 作为第二排序键。

## 5. 可解释与复盘

### 5.1 分解字段

`draftScore` 返回：

```ts
{ base, synergy, denial, composition, position, total }
```

`positionScore` 返回：

```ts
{ position, slot, role, total, base, traitFit, override, synergy, matchup, faction, reasons }
```

`reasons` 是中文短句，例如“冷主帅：先手限制暖二连，控制/阻断/防御优先”“定位：控制”“位置先验 +4”“与已选配合 +8.0”“对位修正 +1.2”。这些可以直接进选将提示或复盘报告。

### 5.2 与现有复盘体系衔接

- 选将/部署的 `DraftTrace` 已记录候选与选中项；后续可把 `position` 分解写入 `ai-audit` 的 `DecisionRecord.payload`。
- 对局日志的复盘 ID（`matchId.d{seq}` / `.a{seq}`）可以把“某次选将/部署”与整局结果对上。
- 建议 UI：
  - 选将卡片角标显示“推荐位置：主帅/前锋 A/前锋 B”；
  - 部署面板每个槽位显示该武将在此位置的分数与前三项理由；
  - 点击分数可复制复盘 ID，沿用现有剪贴板链路。

## 6. 校准流程

第一版是人工先验，必须用自对弈数据校准，否则只是“看起来合理”。

### 6.1 数据采集

每局记录：

- `seed`、`matchId`、双方阵营；
- 16 步抓将的候选与选中（`pickStep`、`picked`）；
- 双方部署（`commander` / `flankA` / `flankB`）；
- 胜负、回合数、是否卡死。

`runSelfPlayGame` 与 `match-log` 已有种子和决策记录，补一个部署快照即可。

### 6.2 指标

- 阵容价值与胜率的相关性：`TeamValue(warm) − TeamValue(cool)` 对 `warm 胜=1` 做 logistic 回归，看系数是否显著、AUC 是否高于 0.5。
- 位置权重校准：固定能力向量与 `Base`，只调 `POSITION_WEIGHTS` / `POSITION_BASE` / `SLOT_OVERRIDE`，用坐标上升或小网格搜索最大化 AUC / 最小化对数损失。
- 定位向量校准：如果七类定位内部差异过大，再调 `ROLE_TRAITS`；但应优先修正技能微调，而不是直接改定位基础向量。
- 分层：按将池版本（2013 / 平衡 / 洛书）、先手方、是否让先分层，避免把版本差异学进权重。

### 6.3 A/B

- 用 `client/scripts/audit/pipeline.mjs` 的配对种子，同一批种子只让一方使用新评分。
- 统计用配对 McNemar；沿用项目现有 `minGain = 2%` 门槛。
- 先跑 500 局冒烟，再跑 3000 局确认；如果位置项只带来 <2% 提升，保留 observe，不直接采纳。

### 6.4 参数更新纪律

- 每次只改一组参数（例如只改前锋权重），并记录改动前后的 AUC 与 A/B。
- 单次权重变化不超过 ±20%，防止过拟合小样本。
- 先验表（`SLOT_OVERRIDE`）应逐步缩小：能被数据解释的条目删除，只保留数据也解释不了的“版本特性”。

## 7. 扩展到其他模式

当前模块把“位置集合、位置权重、先手修正、对位映射”写在统率三军常量里。扩展到其他模式时，建议抽成 `PositionProfile`：

```ts
interface PositionProfile {
  positions: string[]
  weights: Record<string, WeightProfile>
  base: Record<string, number>
  firstMoverBonus: (position: string) => number
  matchup: (position: string, rival: GeneralDefinition[]) => number
}
```

- 斗地主：位置 = 地主 / 农民上 / 农民下；地主吃输出与生存，农民吃配合与保护。
- 欢乐成双：位置 = 1 号位 / 2 号位；先手位吃压制，后手位吃承伤。
- 统率三军继续使用 `commander / flankA / flankB` 与冷暖先手规则。

## 8. 已知限制

- 权重与先验表是人工估计，尚未经过大规模自对弈校准。
- 对位只用对手 8 人名单的平均能力，没有建模对手的具体部署；部署同时暗置，精确对位本来也不可得。
- 位置评分只影响选将/部署，不影响出牌决策；出牌阶段仍由 `ai-policy` / `ai-forecast` 等模块负责。
- 主帅 +1 体力上限、暖方主帅起手 5 牌已在规则层生效，评分不重复计算这些数值。
- 3 血武将的 `fragile` 是位置风险，不是绝对强度；`Base` 里的 3 血扣分仍保留，两者分别服务“选不选”和“放哪”。

## 9. 代码与命令

- 定位表：`client/src/engine/position-roles.ts`
- 评分模块：`client/src/engine/position-score.ts`
- AI 接入：`client/src/engine/local-ai.ts` 的 `draftScore` / `aiDraftRaw`
- 检查：`client/src/engine/_position-check.ts`
- 全量检查：`npm run check`
- 自对弈冒烟：`node scripts/run-engine-checks.mjs src/engine/_selfplay.ts 20`
- 历史对局复盘：`npm run review -- <matchlogs.json> <复盘 ID>`

当前 `_position-check.ts` 覆盖：

- 冷暖先手前锋的 A/B 归属；
- 华佗主帅、张飞前锋、张辽不适合主帅；
- 三人部署恰好 6 种排列且辅助坐主帅；
- 郭嘉首抓的主帅推荐与部署价值提升；
- 八人池深度价值高于三人；
- 张飞/华佗/甄姬/夏侯惇的能力向量方向；
- 冷主点名武将（界大乔、界甘宁、界徐晃、文聘、秦宓、曹昂）冷主分高于边锋；
- 暖主点名武将（界郭嘉、界华佗）暖主分高于暖边锋；
- 暖 B 点名武将（界张飞、吕布-竞）暖 B 分高于暖主；
- 界张辽冷主分高于冷边锋。
