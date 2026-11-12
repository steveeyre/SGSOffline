# 点将（斗地主 / 欢乐成双）

选将阶段除本席位的小池外，还可以从**模式全池**任意选择武将。点将不改变奇技规则：开启奇技模式时仍需同时选定奇技，奇技同样可任选。

## 交互

- 每个己方席位标题右侧有「点将」按钮，未选定时可点。
- 弹窗列出模式全池，按 `generals.ts` 中 `GENERALS` 的定义顺序排列。
- 顶部搜索框按姓名（或武将 id）过滤；奇技可根据武将姓名（或武将id）或技能名称（或技能id）过滤。
- **玩家先选、AI 后选**：建局时 AI 不选将，点将弹窗里全池都可以点；人类席位全部确定后 AI 才补齐自己一方，且只在剩余武将里挑。
- 人类自己的两个席位之间仍然去重，已占用的武将会置灰并标注「已被选」。
- 标准模式：点将选中即提交；奇技模式：点将只记录为待选，选好奇技后点该列的「确认」。

## 规则

- 点将候选 = 该模式的武将池（洛书池去掉文聘、诸葛瑾），两个模式一致。
- 场上不能重复：点将与普通选将共用同一份 `picked`，引擎侧拒绝重复提交；AI 补选时会跳过玩家已占用的武将。
- 点将不消耗额外次数，每个席位仍只能选一名武将。

## 实现位置

| 文件 | 职责 |
| --- | --- |
| `client/src/modes/HappyPair/pair-draft.ts` | `getPairPointPickPool()`：按 `GENERALS` 顺序排列的模式全池 |
| `client/src/modes/FightTheLandlord/landlord-draft.ts` | `getLandlordPointPickPool()` |
| `client/src/modes/HappyPair/pair-match.ts` | `pairPointPick()`：全池校验 + 重复校验 + 奇技 |
| `client/src/modes/FightTheLandlord/landlord-match.ts` | `landlordPointPick()` |
| `client/src/components/GeneralPicker.tsx` | 点将弹窗（搜索、置灰、技能名） |
| `client/src/engine/local-dispatch.ts` | 建局不跑 AI 选将；人类席位选完后才调 `aiPairDraft` / `aiLandlordDraft` |
| `client/src/modes/*/…PickPage.tsx` | 「点将」按钮与选中处理 |

落座时 `setupPairPlay` / `setupLandlordPlay` 先在本席位池里查武将，查不到再回落到点将池，因此点将选出的池外武才能正常创建实例；AI 选将读取队友已选武将时也走同样的兜底查找。

## 验证

```bash
npm run check   # 含 src/modes/_checks-pointpick.ts
```

检查覆盖：点将池顺序、无重复、剔除项、建局时 AI 尚未选将、池外武将可选中、重复与池外武将（如经典池的曹操）被拒绝、非人类席位不可点将、人类选完后 AI 补齐且不重复、奇技模式下点将与奇技同时落位、奇技可任选。
