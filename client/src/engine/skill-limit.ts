import type { GameState, GeneralInstance } from 'sgs3v3-shared'

/** 同一武将技能 / 武器效果每回合的发动上限（开局“限五次”规则） */
export const SKILL_USE_LIMIT = 5

/** 规则未设置时按无限制处理：老存档与检查脚本不带该字段，行为与改动前一致 */
export function isSkillLimited(state: GameState): boolean {
    return state.skillLimitRule === 'limited'
}

export function skillUseBlocked(state: GameState, general: GeneralInstance, key: string): boolean {
    if (!isSkillLimited(state)) return false
    return (general.skillUseCountsThisTurn?.[key] ?? 0) >= SKILL_USE_LIMIT
}

/** 记一次发动；已达上限时返回 false 且不计数 */
export function consumeSkillUse(state: GameState, general: GeneralInstance, key: string): boolean {
    if (!isSkillLimited(state)) return true
    const counts = general.skillUseCountsThisTurn ?? (general.skillUseCountsThisTurn = {})
    const used = counts[key] ?? 0
    if (used >= SKILL_USE_LIMIT) return false
    counts[key] = used + 1
    return true
}

/** 回合开始时清空该角色的发动计数 */
export function resetSkillUses(general: GeneralInstance): void {
    general.skillUseCountsThisTurn = {}
}
