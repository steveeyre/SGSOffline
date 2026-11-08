# 三国杀单机版 — 开发文档

> 最后更新：2026-11-07 ｜ 对应版本 1.0

本项目是纯前端的三国杀单机版：规则引擎、规则 AI 与界面全部运行在浏览器里，没有后端服务、没有联机模式，也不依赖任何本地大模型。

## 一、技术栈与启动

- TypeScript + React 18 + Vite 6 + Zustand
- npm workspaces：`client/`（前端与引擎）、`shared/`（共享类型）
- 启动：双击仓库根目录的 `SGSOffline.html`（无需 Node.js，不起服务、不留终端窗口）；开发时用根目录 `npm run dev:client` 启动开发服务器（http://localhost:5174）

```bash
npm install
npm run dev:client        # 开发服务器
npm run build             # 构建 shared + client
npm run build:standalone  # 生成根目录的离线单文件 SGSOffline.html
npm run check             # 引擎规则自检
```

## 二、目录结构

```
SGSOffline/
├── client/
│   ├── public/generals/      武将原画
│   ├── scripts/              引擎自检、离线打包、复盘与审计脚本
│   └── src/
│       ├── engine/           规则引擎、规则 AI、本地对局调度
│       ├── modes/            斗地主（FightTheLandlord）、欢乐成双（HappyPair）
│       ├── pages/            大厅、选将、对战、本地对战、结算
│       ├── store/            Zustand 状态
│       ├── actions.ts        页面操作 → 本地引擎的派发层
│       └── main.tsx / App.tsx
├── shared/src/index.ts       引擎与页面共用的类型定义
├── docs/                     开发文档与 AI 设计说明
├── SGSOffline.html           离线单文件（构建生成，不入库）
└── package.json              workspaces 根配置
```

## 三、引擎（client/src/engine）

| 模块 | 职责 |
|------|------|
| `game-actions.ts` | 使用牌/技能、响应链、判定、伤害与濒死结算 |
| `turn-manager.ts` | 回合阶段、弃牌、行动单元与响应队列推进 |
| `game-state.ts` | 状态工具、距离、客户端视图（`toClientView`）与胜负判定 |
| `generals.ts` / `general-meta.ts` / `general-playbook.ts` | 武将定义、定位与角色标签、技能专用决策手册 |
| `cards.ts` / `deck.ts` / `card-utils.ts` / `deck-meta.ts` | 牌堆构造、摸牌、牌面工具与牌池统计 |
| `rng.ts` | 可复现的随机数与种子 |
| `local-match.ts` | 统率三军建局、选将/部署入口 |
| `local-dispatch.ts` | 单机对局调度：人类操作、AI 推进节奏、日志记录 |
| `local-ai.ts` | 规则 AI 主入口（出牌、响应、选将、弃牌、技能选择） |
| `match-log.ts` / `review.ts` | 对局日志、决策快照与复盘 ID |
| `position-roles.ts` / `position-score.ts` | 位置职责与部署评分 |

规则 AI 的分层模块：

- `ai-policy.ts`：出牌基础分与动态修正分
- `ai-memory.ts`：只基于公开信息的对手手牌推断（`hand-tendency.ts` 提供出牌倾向）
- `ai-forecast.ts`：对手能打出什么、伤害与桃/闪概率预测
- `ai-strategy.ts` / `ai-taunt.ts` / `ai-synergy.ts`：集火目标、威胁度、技能与牌的配合
- `ai-audit.ts` / `ai-variant.ts`：决策审计（特征词表、决策记录）与规则补丁/实验层

AI 只读取公开信息与自己的手牌，不读取对手暗牌。

## 四、玩法模式（client/src/modes）

- **FightTheLandlord**：`landlord-match.ts` 建局与落座，`landlord-draft.ts` 三方选将，`landlord-turn.ts` 地主专技与回合差异
- **HappyPair**：`pair-match.ts` 四方落座，`pair-draft.ts` 四池选将与固定座次（1/4 冷、2/3 暖）

两个模式各自带自对弈入口（如 `selfplay-pair.ts`），用于校验规则与胜率。

## 五、界面与状态

- `pages/LobbyPage.tsx`：选择模式、武将池、牌堆、阵营与随机种子后开本地对局
- `pages/GeneralPickPage.tsx` 与 `modes/*/LandlordPickPage.tsx`、`PairPickPage.tsx`：选将与部署
- `pages/GamePage.tsx`：主对局界面（含 AI 出牌节奏切换、日志与复盘入口）
- `pages/HotseatGamePage.tsx`：同屏两方轮流操作的本地对战
- `store/gameStore.ts`：对局状态、选牌/选目标、错误提示等

页面通过 `actions.ts` 派发操作，所有调用直接进入浏览器内引擎，不经过网络。

## 六、自检、复盘与审计

```bash
npm run check               # 统率三军 + 斗地主 + 欢乐成双 + 复盘/位置检查
npm run check:selfplay      # 统率三军自对弈
npm run check:selfplay-pair # 欢乐成双自对弈
npm run check:selfplay-ddz  # 斗地主自对弈（地主/农民分开统计）
npm run check:regression    # 固定种子回归，对比 scripts/baselines/selfplay.json
npm run check:audit         # 决策审计
npm run report:position     # 位置评分报表
npm run review              # 复盘本机导出的对局日志
npm run audit               # 规则审计流水线
```

自对弈的三层验证（固定种子回归、分模式胜率、失误分类）见 `docs/selfplay-validation.md`。

检查脚本以 `_checks*.ts`、`_selfplay.ts`、`selfplay-*.ts`、`_audit*.ts` 等形式直接放在源码目录里，由 `scripts/run-engine-checks.mjs` 执行；改动规则后应先跑通再提交。

对局日志保存在浏览器 localStorage（大厅可导出），包含每一步操作、决策快照、候选动作与得分，`review` / `audit` 脚本据此做离线分析。`client/scripts/audit/` 下的模型复盘脚本可选装 Ollama，只用于离线调参，不参与游戏运行。

## 七、约定

- 新规则一律走「引擎校验 + 规则 AI 评分」两条路径，避免只改界面不改进引擎
- 修改技能时同步更新对应的 `_checks` 用例与 `docs/skill-implementation-plan.md`
- 不引入后端或联网依赖；单机可离线运行是 1.0 的硬性目标
