# 奇技模式（斗地主 / 欢乐成双）

选将时每名角色额外获得 3 个奇技候选，与武将同时选定。奇技取自洛书池武将技能，选定后直接写入该武将的 `acquiredSkills`，引擎按原有 `hasSkill` 路径识别。

## 入口

大厅选择「斗地主」或「欢乐成双」后，「玩法」一栏可切换：

- **标准**：原有选将（点一次高亮，再点一次确认）
- **奇技模式**：选将时每席额外出现 3 个奇技卡，武将与奇技都选好后点该列的「确认」按钮

两种模式共用同一套选将流程，差别只在是否有奇技候选与确认按钮。

## 规则

- 每名角色 3 个奇技候选，四（三）个席位各自独立抽取；候选之外还有「任选」入口，可以搜索并挑选目录里的任意奇技。
- **玩家先选、电脑后选**：建局只为人类席位抽候选，AI 席位等玩家全部确认后才现场抽取，并避开玩家已定的奇技；因此玩家任选时不会被 AI 抢走技能。
- 候选先排除该席位武将已有的技能，再排除其他席位已抽到的技能；任选时只要求技能在目录内、且不与已提交的奇技重复（同一方两个席位之间仍去重）。
- 奇技与武将必须同时确认：只选武将或只选奇技时「确认」按钮保持禁用。
- 单击武将卡或奇技卡即选中并触发闪动光效，不需要二次点击。
- 选定后奇技进入武将的 `acquiredSkills`，界面上按原技能名展示。

## 抽取范围

`client/src/engine/oddity.ts` 的 `oddityCatalog()` 铺平洛书池全部武将技能，并排除：

| 排除项 | 原因 |
| --- | --- |
| 地主专技（飞扬 / 跋扈 / 强易） | 只属于地主 |
| 觉醒技 | 依赖觉醒条件与前置技能 |
| 主公技（描述以「主公技」开头） | 依赖势力与身份 |

排除后池外只有 8 个觉醒技，其余洛书技能全部在池内。

限定技与怀橘、袭爵、巨贾都在池内：限定技按 `usedLimitedSkills` 正常去重，发动后即标记已用；这三个开局类技能依赖落座后的开局钩子补标记，钩子改用 `hasSkillOnGeneral` 判定，奇技版本同样发出“橘”“爵”并结算巨贾的多摸。

主公技按「描述是否以主公技开头」判定，避免误伤：焚心的描述是“获得其武将牌上的所有技能（限定技、觉醒技、使命技、主公技和持恒技除外）”，只是提到主公技，本身仍可作奇技。

眩惑（法正）也可作奇技：它令他人出杀后，结算结束会往队列尾部补一个「把出牌阶段还给当前回合角色」的任务，因此不会出现回合停在摸牌阶段的问题。

规则 AI 用 `oddityScore()` 在候选里选：摸牌、造成伤害、回复、拿牌等高价值关键词加分，「每回合限一次」「翻面」「失去体力」等代价减分。评分只用于 AI 与脚本兜底，界面仍是玩家自选。

## 实现位置

| 文件 | 职责 |
| --- | --- |
| `shared/src/index.ts` | `OddityOption`、选将态的 `oddities` / `oddityPicked`、`GameState.oddityMode` |
| `client/src/engine/oddity.ts` | 技能目录、抽取、AI 评分 |
| `client/src/modes/HappyPair/pair-match.ts` | 开局抽奇技、`pairConfirmPick`、落座时授予 |
| `client/src/modes/FightTheLandlord/landlord-match.ts` | 同上，`landlordConfirmPick` |
| `client/src/modes/*/…-draft.ts` | AI 席位选将时现场抽奇技并选一个，避开已定奇技 |
| `client/src/components/OddityPicker.tsx` | 「任选」弹窗（搜索技能名/武将名，已被选的置灰） |
| `client/src/pages/LobbyPage.tsx` | 「玩法」开关 |
| `client/src/modes/*/…PickPage.tsx` / `…PickPage.css` | 奇技卡、确认按钮、选中闪动光效 |

`pairPickGeneral` / `landlordPickGeneral` 保留原签名；奇技模式下若调用方没给奇技，会由 `pickOddity` 兜底，因此自对弈与固定种子回归无需改造。自对弈走 `autoDraft=true`（建局即全席抽候选），真人路径走 `autoDraft=false`（玩家先选）。

## 扩展

新增武将技能后不需要额外登记，`oddityCatalog()` 会自动收录。若某个技能不能作为奇技（例如依赖觉醒前置或其他武将专属状态），把技能 id 加入 `EXCLUDED_SKILL_IDS`，并在 `client/src/modes/_checks-oddity.ts` 补一条断言固定该排除行为。

新增开局类技能时，落座钩子要用 `hasSkillOnGeneral` 而不是 `def.skills` 判断，否则被选作奇技时不会触发。

## 验证

```bash
npm run check                 # 含 src/modes/_checks-oddity.ts
npm run check:selfplay-pair   # 标准模式
npm run check:selfplay-ddz
```

自对弈支持奇技模式：

```bash
node scripts/run-engine-checks.mjs src/modes/HappyPair/selfplay-pair.ts 6 oddity
node scripts/run-engine-checks.mjs src/modes/FightTheLandlord/selfplay-ddz.ts 6 oddity
```

第三个参数为 `oddity` 时开启奇技模式，用于确认授予技能后不会让 AI 卡死。
