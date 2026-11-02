/**
 * 规则补丁覆盖层。
 *
 * 补丁是数据而不是源码修改：A/B 验证期间只叠加这一层，
 * 回滚就是丢弃 patch 文件，不会污染 local-ai.ts。
 */
import { Faction } from 'sgs3v3-shared'
import { PASS_SCORE } from './ai-policy'
import {
    auditEnabled, evalPredicate, forcedRule, interventionEnabled, validatePredicate,
    type DecisionContext, type Predicate,
} from './ai-audit'

export type ThresholdName = 'PASS_SCORE' | 'NEGATE_THRESHOLD'

export const THRESHOLD_NAMES: ThresholdName[] = ['PASS_SCORE', 'NEGATE_THRESHOLD']

/** 具名阈值的当前默认值，供审计层向复盘模型说明「原值是多少」 */
export const THRESHOLD_DEFAULTS: Record<ThresholdName, number> = {
    PASS_SCORE,
    NEGATE_THRESHOLD: 55,
}

/**
 * 补丁作用的决策阶段。缺省 play，保持既有补丁文件不变。
 * respond / discard 走 applyChoicePatches：两者的候选不是「出牌选项」而是
 * 若干具名动作或具体一张牌，用同一套 veto/guard/priority/fallback 语义处理。
 */
export type PatchHook = 'play' | 'respond' | 'discard'

export const PATCH_HOOKS: PatchHook[] = ['play', 'respond', 'discard']

export type PatchRule =
    | { id: string; type: 'guard'; target: string; when: Predicate; hook?: PatchHook; note?: string }
    | { id: string; type: 'veto'; target: string; hook?: PatchHook; note?: string }
    | { id: string; type: 'priority'; target: string; delta: number; when?: Predicate; hook?: PatchHook; note?: string }
    | { id: string; type: 'fallback'; target: string; baseScore: number; when: Predicate; hook?: PatchHook; note?: string }
    | { id: string; type: 'threshold'; name: ThresholdName; value: number; hook?: PatchHook; note?: string }

/** 规则的生效阶段；threshold 只用于出牌阶段的门槛，归入 play */
export function patchHookOf(rule: PatchRule): PatchHook {
    return rule.hook ?? 'play'
}

/** 响应 / 弃牌阶段的候选：一个具名动作或一张具体的牌 */
export interface Choice {
    ruleId: string
    score: number
}

export interface PatchSet {
    id: string
    note?: string
    rules: PatchRule[]
}

/** 按阵营分别加载：成对 A/B 里同一补丁轮流套在暖方/冷方 */
export interface PatchBank {
    warm?: PatchSet | null
    cool?: PatchSet | null
}

export interface PlayOptionLike {
    key: string
    score: number
    plans: string[]
}

const MAX_REASONABLE_SCORE = 500
let bank: PatchBank | null = null
const counters: Record<string, number> = {}
const thresholdCounters: Record<string, number> = {}

export function resetVariantStats(): void {
    for (const key of Object.keys(counters)) delete counters[key]
    for (const key of Object.keys(thresholdCounters)) delete thresholdCounters[key]
}

export function variantStats(): { rules: Record<string, number>; thresholds: Record<string, number> } {
    return { rules: { ...counters }, thresholds: { ...thresholdCounters } }
}

/** 校验补丁集；返回错误列表，空数组表示可用 */
export function validatePatchSet(patch: PatchSet): string[] {
    const errors: string[] = []
    if (!patch || typeof patch !== 'object') return ['补丁集不是对象']
    if (!patch.id || typeof patch.id !== 'string') errors.push('补丁集缺少 id')
    if (!Array.isArray(patch.rules)) return [...errors, '补丁集缺少 rules 数组']
    patch.rules.forEach((rule, index) => {
        const at = `rules[${index}]`
        if (!rule || typeof rule !== 'object') return errors.push(`${at} 不是对象`)
        if (!rule.id) errors.push(`${at} 缺少 id`)
        switch (rule.type) {
            case 'guard':
                if (!rule.target) errors.push(`${at}.target 缺失`)
                errors.push(...validatePredicate(rule.when, `${at}.when`))
                break
            case 'veto':
                if (!rule.target) errors.push(`${at}.target 缺失`)
                break
            case 'priority':
                if (!rule.target) errors.push(`${at}.target 缺失`)
                if (typeof rule.delta !== 'number' || !Number.isFinite(rule.delta)) errors.push(`${at}.delta 必须是数字`)
                if (rule.when) errors.push(...validatePredicate(rule.when, `${at}.when`))
                break
            case 'fallback':
                if (!rule.target) errors.push(`${at}.target 缺失`)
                if (typeof rule.baseScore !== 'number') errors.push(`${at}.baseScore 必须是数字`)
                errors.push(...validatePredicate(rule.when, `${at}.when`))
                break
            case 'threshold':
                if (!THRESHOLD_NAMES.includes(rule.name)) errors.push(`${at}.name 必须是 ${THRESHOLD_NAMES.join(' / ')}`)
                if (typeof rule.value !== 'number' || !Number.isFinite(rule.value)) errors.push(`${at}.value 必须是数字`)
                break
            default:
                errors.push(`${at}.type 非法：${String((rule as { type?: unknown }).type)}`)
        }
        if (rule.hook !== undefined && !PATCH_HOOKS.includes(rule.hook)) {
            errors.push(`${at}.hook 必须是 ${PATCH_HOOKS.join(' / ')}`)
        }
    })
    return errors
}

/** 装载补丁；返回校验错误（非空时调用方应中止，不能带着坏补丁跑对局） */
export function loadPatchBank(next: PatchBank | null): string[] {
    bank = next
    resetVariantStats()
    const errors: string[] = []
    for (const side of ['warm', 'cool'] as const) {
        const patch = next?.[side]
        if (!patch) continue
        for (const error of validatePatchSet(patch)) errors.push(`${side}: ${error}`)
        for (const rule of patch.rules ?? []) {
            if (rule.type === 'priority' && Math.abs(rule.delta) > MAX_REASONABLE_SCORE) {
                errors.push(`${side}: ${rule.id} 的 delta ${rule.delta} 超出合理范围`)
            }
        }
    }
    return errors
}

export function variantEnabled(): boolean {
    return !!bank && (!!bank.warm || !!bank.cool)
}

export function reviewEnabled(): boolean {
    return variantEnabled() || auditEnabled() || interventionEnabled()
}

function patchFor(faction: string): PatchSet | null {
    if (!bank) return null
    return faction === Faction.WARM ? bank.warm ?? null : bank.cool ?? null
}

/**
 * 把补丁叠加到候选表上：veto/guard 淘汰，priority 改分，fallback 在全员低于门槛时兜底提分。
 * 未命中任何补丁时原样返回（同一个数组引用），避免无谓分配。
 */
export function applyPatchToOptions<T extends PlayOptionLike>(context: DecisionContext, options: T[]): T[] {
    const patch = patchFor(context.faction)
    if (!patch || options.length === 0) return options
    const dropped = new Set<string>()
    const deltas = new Map<string, number>()
    const fallbacks = new Map<string, number>()
    for (const rule of patch.rules) {
        switch (rule.type) {
            case 'veto':
                dropped.add(rule.target)
                counters[rule.id] = (counters[rule.id] ?? 0) + 1
                break
            case 'guard':
                if (evalPredicate(rule.when, context.feats)) {
                    dropped.add(rule.target)
                    counters[rule.id] = (counters[rule.id] ?? 0) + 1
                }
                break
            case 'priority':
                if (!rule.when || evalPredicate(rule.when, context.feats)) {
                    deltas.set(rule.target, (deltas.get(rule.target) ?? 0) + rule.delta)
                    counters[rule.id] = (counters[rule.id] ?? 0) + 1
                }
                break
            case 'fallback':
                if (evalPredicate(rule.when, context.feats)) {
                    fallbacks.set(rule.target, rule.baseScore)
                    counters[rule.id] = (counters[rule.id] ?? 0) + 1
                }
                break
            default:
                break
        }
    }
    if (dropped.size === 0 && deltas.size === 0 && fallbacks.size === 0) return options
    const bestScore = Math.max(...options.map((option) => option.score))
    const lifted = bestScore < PASS_SCORE
    let changed = false
    const result: T[] = []
    for (const option of options) {
        if (dropped.has(option.key)) {
            changed = true
            continue
        }
        let score = option.score + (deltas.get(option.key) ?? 0)
        if (lifted && fallbacks.has(option.key)) score = Math.max(score, fallbacks.get(option.key)!)
        if (score !== option.score) {
            changed = true
            result.push({ ...option, score })
        } else {
            result.push(option)
        }
    }
    return changed ? result : options
}

/** 干预命中时返回必须执行的规则 id（出牌阶段） */
export function forcedPlayRule(context: DecisionContext): string | null {
    return forcedRule(context, 'play')
}

/**
 * 该阶段的补丁是否可能生效（有对应 hook 的规则且本阵营已配补丁）。
 * 调用方在进入昂贵路径前用它做早退，保证「无补丁 = 零行为变化」。
 */
export function hasHookRules(context: DecisionContext, hook: Exclude<PatchHook, 'play'>): boolean {
    const patch = patchFor(context.faction)
    if (!patch) return false
    return patch.rules.some((rule) => patchHookOf(rule) === hook)
}

/**
 * 响应 / 弃牌阶段的补丁求值。
 *
 * 与出牌阶段的区别只在于候选形态：这里的候选是「具名动作」或「一张具体的牌」，
 * 没有计划加成，也不参与 PASS_SCORE 门槛，所以只做三种变换：
 *   veto    —— 无条件删掉该候选
 *   guard   —— 谓词命中时删掉该候选
 *   priority / fallback —— 调整候选分，最终由调用方取分数最高者
 *
 * candidates 允许为空（例如响应阶段还没决定要用哪张牌）；
 * 为空时 guard/veto 依然计数，便于判断补丁是否在该批次里命中过。
 */
export function applyChoicePatches(
    context: DecisionContext,
    hook: Exclude<PatchHook, 'play'>,
    candidates: Choice[],
): Choice[] {
    const patch = patchFor(context.faction)
    if (!patch) return candidates
    const dropped = new Set<string>()
    const deltas = new Map<string, number>()
    const fallbacks = new Map<string, number>()
    for (const rule of patch.rules) {
        if (patchHookOf(rule) !== hook) continue
        switch (rule.type) {
            case 'veto':
                dropped.add(rule.target)
                counters[rule.id] = (counters[rule.id] ?? 0) + 1
                break
            case 'guard':
                if (evalPredicate(rule.when, context.feats)) {
                    dropped.add(rule.target)
                    counters[rule.id] = (counters[rule.id] ?? 0) + 1
                }
                break
            case 'priority':
                if (!rule.when || evalPredicate(rule.when, context.feats)) {
                    deltas.set(rule.target, (deltas.get(rule.target) ?? 0) + rule.delta)
                    counters[rule.id] = (counters[rule.id] ?? 0) + 1
                }
                break
            case 'fallback':
                if (evalPredicate(rule.when, context.feats)) {
                    fallbacks.set(rule.target, rule.baseScore)
                    counters[rule.id] = (counters[rule.id] ?? 0) + 1
                }
                break
            default:
                break
        }
    }
    if (candidates.length === 0) return candidates
    if (dropped.size === 0 && deltas.size === 0 && fallbacks.size === 0) return candidates
    const bestScore = Math.max(...candidates.map((c) => c.score))
    const lifted = fallbacks.size > 0 && bestScore <= 0
    const result: Choice[] = []
    for (const candidate of candidates) {
        if (dropped.has(candidate.ruleId)) continue
        let score = candidate.score + (deltas.get(candidate.ruleId) ?? 0)
        if (lifted && fallbacks.has(candidate.ruleId)) score = Math.max(score, fallbacks.get(candidate.ruleId)!)
        result.push(score === candidate.score ? candidate : { ...candidate, score })
    }
    return result
}

/**
 * 响应/弃牌阶段：在补丁之后挑出分数最高的候选。
 * 返回 null 表示没有可用候选（调用方应保留自己的默认动作）。
 */
export function pickBestChoice(candidates: Choice[]): Choice | null {
    if (candidates.length === 0) return null
    return candidates.reduce((best, c) => (c.score > best.score ? c : best))
}

/** 读取具名阈值（补丁可调），未配置时返回缺省值 */
export function thresholdFor(context: DecisionContext | null, name: ThresholdName, fallback: number): number {
    const patch = context ? patchFor(context.faction) : null
    if (!patch) return fallback
    let value = fallback
    for (const rule of patch.rules) {
        if (rule.type === 'threshold' && rule.name === name) value = rule.value
    }
    if (value !== fallback) thresholdCounters[name] = (thresholdCounters[name] ?? 0) + 1
    return value
}
