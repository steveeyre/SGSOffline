/**
 * 自对弈失误分类：把“明显不该这样走”的决策从 trace 里挑出来，按类型计数。
 *
 * 只统计规则上明确错误的动作，不评价风格差异；命中数用于看改动有没有
 * 把某类失误压下去，比单看总胜率更敏感。
 */
import { Faction } from 'sgs3v3-shared'
import type { PlayTrace } from './local-ai'

export interface DecisionTrace {
    seed: number
    step: number
    round: number
    faction?: Faction
    activeIndex: number
    play: PlayTrace
}

export type MistakeKind = 'missed-kill' | 'focus-drift' | 'landlord-passive'

export interface Mistake {
    kind: MistakeKind
    seed: number
    step: number
    detail: string
}

const KILL_KEYS = new Set([
    'slash', 'lihuo', 'longdan', 'wusheng', 'duel', 'fire_attack',
    'barbarians', 'arrows', 'wine',
])

const PRESSURE_KEYS = new Set([
    ...KILL_KEYS,
    'overindulgence', 'supply_shortage', 'dismantle', 'steal', 'borrow_sword',
])

const PASSIVE_VALUE_KEYS = new Set(['draw_two', 'harvest', 'peach'])

function chosenKey(play: PlayTrace): string | null {
    return play.candidates.find((candidate) => candidate.chosen)?.key ?? null
}

function hasCandidate(play: PlayTrace, keys: Set<string>): boolean {
    return play.candidates.some((candidate) => keys.has(candidate.key))
}

function scoreOf(play: PlayTrace, key: string): number {
    return play.candidates.find((candidate) => candidate.key === key)?.score ?? -Infinity
}

/** 命中返回一种失误；同一决策只归入最严重的一类 */
export function classifyMistake(
    trace: DecisionTrace,
    opts: { firstOfTurn?: boolean } = {},
): Mistake | null {
    const chosen = chosenKey(trace.play)
    if (!chosen) return null
    const objective = trace.play.objective

    // 已经进入斩杀线，却既没补刀也没做酒/铁索这类前置
    if (objective?.kind === 'focus-core' && objective.reason.includes('斩杀') &&
        !KILL_KEYS.has(chosen)) {
        return {
            kind: 'missed-kill', seed: trace.seed, step: trace.step,
            detail: `${objective.reason}，却选择了 ${chosen}`,
        }
    }

    // 集火目标明确，却去摸牌/上装备，且伤害候选的分数并不低
    if (objective?.kind === 'focus-core' && (PASSIVE_VALUE_KEYS.has(chosen) || chosen.startsWith('equip_')) &&
        hasCandidate(trace.play, KILL_KEYS) &&
        Math.max(...[...KILL_KEYS].map((key) => scoreOf(trace.play, key))) >=
            scoreOf(trace.play, chosen)) {
        return {
            kind: 'focus-drift', seed: trace.seed, step: trace.step,
            detail: `集火目标未变，却选择了 ${chosen}`,
        }
    }

    // 地主首回合的第一手没有做任何压制（伤害或延时控制）
    if (opts.firstOfTurn && trace.faction === Faction.WARM && trace.round === 1 &&
        trace.activeIndex === 0 && !PRESSURE_KEYS.has(chosen)) {
        return {
            kind: 'landlord-passive', seed: trace.seed, step: trace.step,
            detail: `地主首回合选择了 ${chosen}`,
        }
    }

    return null
}

export function summarizeMistakes(mistakes: Mistake[]): Record<MistakeKind, number> {
    const out: Record<MistakeKind, number> = {
        'missed-kill': 0,
        'focus-drift': 0,
        'landlord-passive': 0,
    }
    for (const mistake of mistakes) out[mistake.kind]++
    return out
}
