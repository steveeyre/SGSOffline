/**
 * 统率三军位置评分：把“武将能力”与“座位职责”拆开，供抓将、部署与复盘共用。
 *
 * 座位事实（引擎座次）：
 *   冷 A(0) → 冷主(1) → 冷 B(2) → 暖 B(3) → 暖主(4) → 暖 A(5)
 *
 * 位置职责按实际行动次序定义，而不是“主帅一定辅助、前锋一定输出”：
 * - 冷主帅第一个行动，目标是限制暖二连：阻断、拆牌、防御优先。
 * - 暖 B 第二个行动，形成暖二连：伤害、控制、距离优先。
 * - 冷 B 第三个行动，承接冷方连续行动：伤害、控制、持续作战。
 * - 暖主帅最后行动：回合外支援与保护优先，回合内主动进攻权重低。
 * - 冷 A / 暖 A 分别沿用两边的边锋职责，只按先手/后手做小幅修正。
 */
import { Faction, GeneralDefinition, SkillType } from 'sgs3v3-shared'
import { synergyWeight } from './general-meta'
import {
    POSITION_ROLE_LABEL,
    ROLE_TRAITS,
    SLOT_OVERRIDE,
    roleOfGeneral,
    type PositionRole,
    type RoleTraits,
    type SlotKey,
} from './position-roles'

export type Position = 'commander' | 'flankA' | 'flankB'
export type GeneralTraits = RoleTraits
export type { PositionRole, SlotKey }

export interface PositionContext {
    faction: Faction
    /** 抓将步数，0 为首抓 */
    pickStep?: number
    /** 己方已选武将（含候选前） */
    team?: GeneralDefinition[]
    /** 对手已选武将，用于估算对位压力 */
    rival?: GeneralDefinition[]
}

export interface PositionScore {
    position: Position
    slot: SlotKey
    role: PositionRole
    total: number
    base: number
    traitFit: number
    override: number
    synergy: number
    matchup: number
    faction: number
    reasons: string[]
}

export interface DeploymentScore {
    assignment: Record<Position, GeneralDefinition | null>
    total: number
    positions: PositionScore[]
}

export interface PickValue {
    deployGain: number
    bestPosition: Position | null
    before: number
    after: number
    reasons: string[]
}

const POSITIONS: Position[] = ['commander', 'flankA', 'flankB']

/** 冷方先行动 A，暖方先行动 B */
export function firstFlankOf(faction: Faction): 'flankA' | 'flankB' {
    return faction === Faction.COOL ? 'flankA' : 'flankB'
}

export function secondFlankOf(faction: Faction): 'flankA' | 'flankB' {
    return firstFlankOf(faction) === 'flankA' ? 'flankB' : 'flankA'
}

export function slotOf(faction: Faction, position: Position): SlotKey {
    if (position === 'commander') {
        return faction === Faction.COOL ? 'coldCommander' : 'warmCommander'
    }
    if (faction === Faction.COOL) {
        return position === 'flankA' ? 'coldFlankA' : 'coldFlankB'
    }
    return position === 'flankA' ? 'warmFlankA' : 'warmFlankB'
}

const SKILL_HINTS: Array<[RegExp, Partial<GeneralTraits>]> = [
    [/yiji|rende|jieyin|qingnang|mingce|zhichi|qice|zhiyu|huituo|mingjian|ziyuan|jujia|xianzhou|qieting|danxin|shenxing|bingyi|renxin|xianzhu|qiaoyan|qingjian/, { support: 1, anchor: 1 }],
    [/wusheng|paoxiao|tieqi|wushuang|mengjin|jianchu|qiangxi|duwu|liegong|juece|mieji|fencheng|xiongluan|quanji|jiangchi|zhanshen|lihuo|qingxi|duanbing|juedi|qiaobian/, { offense: 1 }],
    [/qixi|tuxi|guose|luoshen|fanjian|luanwu|wansha|duanliang|qianxi|tiaoxin|zongxuan|zhiyan|bingyi|weimu|kongcheng|fangzhu|yinfeng|juejing|qianxun|zhenwei/, { control: 1 }],
    [/qingguo|jijiu|longdan|jiuzhu|tianxiang|liuli|weimu|kongcheng|fangzhu|yinfeng|renxin|qiaoyan|xianzhu|juejing|buqu|ganglie|jueqing/, { survive: 1 }],
    [/mashu|shensu|qianju|feijun|duanbing|liegong|qimou/, { reach: 1 }],
    [/zhiheng|guanxing|qice|tunjian|jixi|zaoxian|shefu|yuxu|shijian|qianya/, { tempo: 1 }],
]

const TRAIT_CACHE = new Map<string, GeneralTraits>()

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value))
}

/**
 * 能力向量以定位为基础，体力与技能只做小幅修正。
 * 这样同一武将的位置分可解释为“定位适配 + 个体偏差”，而不是关键词堆叠。
 */
export function traitsOf(def: GeneralDefinition): GeneralTraits {
    const cached = TRAIT_CACHE.get(def.id)
    if (cached) return cached

    const traits: GeneralTraits = { ...ROLE_TRAITS[roleOfGeneral(def.id)] }
    traits.survive += Math.max(0, def.maxHp - 3) * 1.5
    if (def.maxHp <= 3) traits.fragile += 1.5

    for (const skill of def.skills ?? []) {
        for (const [pattern, delta] of SKILL_HINTS) {
            if (!pattern.test(skill.id)) continue
            for (const [key, value] of Object.entries(delta)) {
                traits[key as keyof GeneralTraits] += value ?? 0
            }
            break
        }
        if (skill.type === SkillType.ACTIVE) traits.tempo += 0.5
        else if (skill.type === SkillType.LOCKED) traits.anchor += 0.5
        else if (skill.type === SkillType.LIMITED) traits.offense += 0.5
        else if (skill.type === SkillType.AWAKENED) traits.survive += 0.5
    }

    for (const key of Object.keys(traits) as Array<keyof GeneralTraits>) {
        traits[key] = clamp(traits[key], 0, 10)
    }
    TRAIT_CACHE.set(def.id, traits)
    return traits
}

export type WeightProfile = Record<keyof GeneralTraits, number>

export const POSITION_WEIGHTS: Record<SlotKey, WeightProfile> = {
    coldCommander: {
        survive: 0.95, offense: 0.15, control: 1.15, support: 0.35,
        tempo: 0.65, reach: 0.15, fragile: -0.95, anchor: 0.60,
    },
    coldFlankA: {
        survive: 0.50, offense: 1.05, control: 0.80, support: 0.15,
        tempo: 0.85, reach: 0.55, fragile: -0.50, anchor: 0.15,
    },
    coldFlankB: {
        survive: 0.65, offense: 1.10, control: 0.75, support: 0.20,
        tempo: 0.55, reach: 0.60, fragile: -0.50, anchor: 0.20,
    },
    warmCommander: {
        survive: 0.95, offense: 0.10, control: 0.50, support: 1.20,
        tempo: 0.10, reach: 0.10, fragile: -0.85, anchor: 1.00,
    },
    warmFlankA: {
        survive: 0.55, offense: 1.00, control: 0.75, support: 0.20,
        tempo: 0.55, reach: 0.60, fragile: -0.50, anchor: 0.20,
    },
    warmFlankB: {
        survive: 0.45, offense: 1.20, control: 0.90, support: 0.15,
        tempo: 0.85, reach: 0.65, fragile: -0.50, anchor: 0.10,
    },
}

export const POSITION_TRAIT_SCALE = 0.85
export const POSITION_BASE: Record<SlotKey, number> = {
    coldCommander: 4,
    coldFlankA: 2,
    coldFlankB: 1.5,
    warmCommander: 4.5,
    warmFlankA: 1.5,
    warmFlankB: 2.5,
}

function slotText(slot: SlotKey): string {
    switch (slot) {
        case 'coldCommander': return '冷主帅：先手限制暖二连，控制/阻断/防御优先'
        case 'coldFlankA': return '冷先手边锋：建立冷方连续行动，输出/控制优先'
        case 'coldFlankB': return '冷后手边锋：承接冷四连，输出/减员优先'
        case 'warmCommander': return '暖主帅：最后行动，回合外支援/保护优先'
        case 'warmFlankA': return '暖后手边锋：收尾并配合暖二连'
        case 'warmFlankB': return '暖先手边锋：直接击杀冷主或破坏冷边锋'
    }
}

function positionFit(
    def: GeneralDefinition,
    position: Position,
    ctx: PositionContext,
): PositionScore {
    const traits = traitsOf(def)
    const role = roleOfGeneral(def.id)
    const slot = slotOf(ctx.faction, position)
    const weights = POSITION_WEIGHTS[slot]

    let traitFit = 0
    for (const key of Object.keys(weights) as Array<keyof GeneralTraits>) {
        traitFit += traits[key] * weights[key]
    }
    traitFit *= POSITION_TRAIT_SCALE

    const override = SLOT_OVERRIDE[def.id]?.[slot] ?? 0

    let synergy = 0
    for (const mate of ctx.team ?? []) {
        if (mate.id === def.id) continue
        synergy += synergyWeight(def.id, mate.id) * (position === 'commander' ? 0.8 : 1)
    }
    synergy = Math.min(synergy, 12)

    let matchup = 0
    const rival = ctx.rival ?? []
    if (rival.length > 0) {
        const rivalTraits = rival.map((g) => traitsOf(g))
        const avg = (key: keyof GeneralTraits) =>
            rivalTraits.reduce((sum, t) => sum + t[key], 0) / rivalTraits.length
        if (position === 'commander') {
            const guard = ctx.faction === Faction.COOL ? traits.control : traits.support
            matchup = clamp((guard + traits.survive - avg('offense')) * 0.12, -2, 2)
        } else if (slot === 'coldFlankA' || slot === 'warmFlankB') {
            matchup = clamp((traits.offense - avg('survive')) * 0.25, -2.5, 2.5)
        } else {
            matchup = clamp(
                (traits.offense + traits.control * 0.5 - avg('survive') - avg('control') * 0.5) * 0.18,
                -2.5,
                2.5,
            )
        }
    }

    const reasons = [slotText(slot), `定位：${POSITION_ROLE_LABEL[role]}`]
    if (override > 0) reasons.push(`位置先验 +${override}`)
    if (override < 0) reasons.push(`位置先验 ${override}`)
    if (synergy > 0) reasons.push(`与已选配合 +${synergy.toFixed(1)}`)
    if (matchup !== 0) reasons.push(`对位修正 ${matchup > 0 ? '+' : ''}${matchup.toFixed(1)}`)
    if (slot === 'coldCommander') reasons.push('冷方主帅第 1 回合先动、起手 4 牌')
    if (slot === 'warmCommander') reasons.push('暖方主帅起手 5 牌，但第一轮最后行动')

    const total = POSITION_BASE[slot] + traitFit + override + synergy + matchup
    return {
        position,
        slot,
        role,
        total,
        base: POSITION_BASE[slot],
        traitFit,
        override,
        synergy,
        matchup,
        faction: 0,
        reasons,
    }
}

export function positionScore(
    def: GeneralDefinition,
    position: Position,
    ctx: PositionContext,
): PositionScore {
    return positionFit(def, position, ctx)
}

function positionAssignments(count: number): Position[][] {
    const out: Position[][] = []
    const walk = (prefix: Position[], used: Set<Position>) => {
        if (prefix.length === count) { out.push(prefix); return }
        for (const position of POSITIONS) {
            if (used.has(position)) continue
            used.add(position)
            walk([...prefix, position], used)
            used.delete(position)
        }
    }
    walk([], new Set())
    return out
}

function combinations<T>(items: T[], count: number): T[][] {
    const out: T[][] = []
    const walk = (start: number, prefix: T[]) => {
        if (prefix.length === count) { out.push(prefix); return }
        for (let i = start; i < items.length; i++) {
            walk(i + 1, [...prefix, items[i]])
        }
    }
    walk(0, [])
    return out
}

export type PositionScoreOf = (def: GeneralDefinition, position: Position) => number

/**
 * 枚举“从队伍里选 min(3, 人数) 人，分配到三个位置”的全部方案。
 * 8 人池最多 336 种，选将阶段每个候选都重算也足够小。
 */
export function rankDeployments(
    team: GeneralDefinition[],
    ctx: PositionContext,
    scoreOf?: PositionScoreOf,
): DeploymentScore[] {
    const take = Math.min(3, team.length)
    if (take === 0) {
        return [{ assignment: { commander: null, flankA: null, flankB: null }, total: 0, positions: [] }]
    }

    const score = (def: GeneralDefinition, position: Position) =>
        scoreOf ? scoreOf(def, position) : positionFit(def, position, ctx).total

    const results: DeploymentScore[] = []
    for (const group of combinations(team, take)) {
        for (const slots of positionAssignments(take)) {
            const assignment: Record<Position, GeneralDefinition | null> = {
                commander: null, flankA: null, flankB: null,
            }
            const positions: PositionScore[] = []
            let total = 0
            slots.forEach((position, index) => {
                const def = group[index]
                const value = score(def, position)
                assignment[position] = def
                positions.push({ ...positionFit(def, position, ctx), total: value })
                total += value
            })
            results.push({ assignment, total, positions })
        }
    }
    results.sort((a, b) => b.total - a.total)
    return results
}

export function bestDeployment(
    team: GeneralDefinition[],
    ctx: PositionContext,
    scoreOf?: PositionScoreOf,
): DeploymentScore {
    return rankDeployments(team, ctx, scoreOf)[0]
}

/**
 * 选将价值：最佳三人阵容的提升，加上替补席的小幅深度价值。
 * 替补价值不能按正选计价，否则第 4-8 抓会和前三抓抢同样的位置分。
 */
export function teamValue(
    team: GeneralDefinition[],
    ctx: PositionContext,
    scoreOf?: PositionScoreOf,
): number {
    const best = bestDeployment(team, ctx, scoreOf)
    const starters = new Set(Object.values(best.assignment).filter(Boolean).map((g) => g!.id))
    const score = (def: GeneralDefinition, position: Position) =>
        scoreOf ? scoreOf(def, position) : positionFit(def, position, ctx).total
    let bench = 0
    for (const def of team) {
        if (starters.has(def.id)) continue
        bench += Math.max(...POSITIONS.map((position) => score(def, position))) * 0.12
    }
    return best.total + bench
}

/**
 * 抓将阶段用：加入该武将后，队伍最佳部署价值的提升。
 * 未进入最佳三人时提升可能为 0，此时由基础强度、配合与抢人项决定。
 */
export function pickValue(
    def: GeneralDefinition,
    ctx: PositionContext,
    scoreOf?: PositionScoreOf,
): PickValue {
    const team = ctx.team ?? []
    const before = teamValue(team, ctx, scoreOf)
    const afterTeam = [...team, def]
    const afterBest = bestDeployment(afterTeam, ctx, scoreOf)
    const after = teamValue(afterTeam, ctx, scoreOf)
    const bestPosition = POSITIONS.find((position) => afterBest.assignment[position]?.id === def.id) ?? null
    const reasons: string[] = []
    if (bestPosition) reasons.push(`最佳位置 ${bestPosition}`)
    const own = bestPosition ? positionFit(def, bestPosition, ctx) : null
    if (own) reasons.push(...own.reasons)
    return { deployGain: after - before, bestPosition, before, after, reasons }
}
