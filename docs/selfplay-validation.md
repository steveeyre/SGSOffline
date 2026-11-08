# 自对弈验证

三层验证，从“行为有没有变”到“变好还是变坏”：

1. **固定种子回归**：同一批种子跑同一批局面，比较胜负、选将、首个出牌与失误分类。
2. **自对弈胜率**：按模式统计；斗地主必须分开统计地主胜率与农民胜率。
3. **失误分类**：只统计规则上明显错误的动作，用错误率下降衡量进展。

## 固定种子回归

```bash
cd client
node scripts/run-engine-checks.mjs src/engine/_regression.ts            # 打印当前结果
node scripts/run-engine-checks.mjs src/engine/_regression.ts --write    # 写入基线
node scripts/run-engine-checks.mjs src/engine/_regression.ts --check    # 与基线对比
```

基线文件：`client/scripts/baselines/selfplay.json`。

当前覆盖：

| id | 模式 | 种子 | 关注点 |
| --- | --- | --- | --- |
| `3v3-warm` | 统率三军 | 1000 | 暖方先手、选将分支 |
| `3v3-cool` | 统率三军 | 1001 | 冷方先手、冷四连 |
| `pair-warm` | 欢乐成双 | 7000 | 暖方集火 |
| `pair-cool` | 欢乐成双 | 7001 | 冷方集火 |
| `ddz-landlord` | 斗地主 | 8000 | 地主首回合压制 |
| `ddz-farmers` | 斗地主 | 8000 | 农民协同 |

对比项：胜方、选将结果、首个出牌的 `key` 与目标、三类失误计数。`steps` 不参与对比，避免长局波动误报。

更新基线的时机：

- 有意改变 AI 目标或选将逻辑，且新结果符合预期；
- 规则改动导致同一个种子必然走出不同局面，旧基线已失效。

不要为了让 `--check` 变绿而直接覆盖基线；先看差异是否在预期方向。

## 自对弈胜率

```bash
cd client
npm run check:selfplay        # 统率三军，20 局
npm run check:selfplay-pair   # 欢乐成双，20 局
npm run check:selfplay-ddz    # 斗地主，地主/农民各 20 局
```

斗地主是不对称模式：地主多 1 点体力上限、多摸牌、有飞扬/跋扈。总体胜率 50% 可能同时意味着“地主偏弱、农民偏强”，所以脚本按 `landlord` / `farmers` 两组分别输出胜率与失败局数。

### 新 AI vs 旧 AI

严格 A/B 用两个 worktree，跑同一批种子：

```bash
git worktree add .rebon/worktrees/ai-baseline <baseline-commit>
cd .rebon/worktrees/ai-baseline/client
npm ci
npm run check:selfplay
npm run check:selfplay-pair
npm run check:selfplay-ddz
```

当前工作区跑同样命令，对比三组数字。斗地主必须分别看地主/农民两行，不要只比较总数。

只改一处评分或补丁时，也可以用 `ai-variant.ts` 的 patch 做同代码 A/B，避免跨版本环境差异；但跨版本对比仍以 worktree 为准。

## 失误分类

定义在 `client/src/engine/_mistakes.ts`：

| 类型 | 判定 | 说明 |
| --- | --- | --- |
| `missed-kill` | 目标已进入斩杀线，选择的不是伤害牌或酒/铁索前置 | 该杀不杀 |
| `focus-drift` | 集火目标明确，却去摸牌/上装备，且伤害候选分数不低于它 | 集火目标漂移 |
| `landlord-passive` | 地主首回合第一手没有伤害或延时控制 | 地主首轮不压制 |

错误率 = 命中数 / 出牌决策数。比总胜率更敏感，适合验证“这处改动有没有减少某类失误”。

局限：

- 只覆盖规则上明确错误的动作，不评价风格差异（例如主动留牌、提前布防）。
- `focus-drift` 依赖 `PlayTrace.objective`；目标层没有给出目标时不计。
- 不统计响应阶段（留闪、无懈）的失误，因为这些 trace 还没有接入。

## 回归节奏

1. 改 AI 前：`--write` 存一份基线，跑三组胜率。
2. 改 AI 后：`npm run check` → `--check` → 三组胜率。
3. 看差异：预期方向内的变化才更新基线；胜率提升但某类失误上升，要单独说明。
