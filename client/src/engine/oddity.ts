import { GeneralDefinition, OddityOption, SkillDefinition, SkillType } from 'sgs3v3-shared'
import { getGeneralPool } from './generals'
import { shuffleInPlace } from './rng'

/** 每个席位提供的奇技候选数 */
export const ODDITY_CHOICES = 3

/**
 * 不适合作奇技的技能：
 * - 地主专技（飞扬 / 跋扈 / 强易，依赖地主身份与专属规则）
 * - 觉醒技（依赖觉醒条件与前置技能）
 * - 主公技（以“主公技”开头的才是真主公技；焚心这类仅在描述中提到主公技的技能仍可入池）
 * 限定技、以及开局补标记的怀橘/袭爵/巨贾可入池：前者按 usedLimitedSkills 正常去重，
 * 后者依赖各模式落座后的开局钩子补标记，钩子已改为同时识别 acquiredSkills。
 * 眩惑（fazheng_xuanhuo）也已入池：出杀后的出牌阶段恢复改为按“当前回合角色”收尾。
 */
const EXCLUDED_SKILL_IDS = new Set([
    'doudizhu_feiyang',
    'doudizhu_bahu',
    'doudizhu_qiangyi',
])

function isEligible(skill: SkillDefinition): boolean {
    if (EXCLUDED_SKILL_IDS.has(skill.id)) return false
    if (skill.type === SkillType.AWAKENED) return false
    if (skill.description.trimStart().startsWith('主公技')) return false
    return true
}

function optionOf(general: GeneralDefinition, skill: SkillDefinition): OddityOption {
    return {
        skillId: skill.id,
        skillName: skill.name,
        description: skill.description,
        type: skill.type,
        sourceGeneralId: general.id,
        sourceGeneralName: general.name,
    }
}

/** 乱斗池里所有可作奇技的技能 */
export function oddityCatalog(): OddityOption[] {
    const options: OddityOption[] = []
    for (const general of getGeneralPool('brawl')) {
        for (const skill of general.skills) {
            if (isEligible(skill)) options.push(optionOf(general, skill))
        }
    }
    return options
}

/**
 * 为一个席位抽奇技候选。
 * excluded 同时承担“去掉该席位武将已有技能”和“跨席位不重复”两个作用。
 */
export function drawOddities(
    excluded: readonly string[],
    count = ODDITY_CHOICES,
): OddityOption[] {
    const blocked = new Set(excluded)
    const pool = oddityCatalog().filter((o) => !blocked.has(o.skillId))
    return shuffleInPlace(pool).slice(0, count)
}

/** 奇技的一次性静态评分，供规则 AI 在候选里挑一个 */
export function oddityScore(option: OddityOption): number {
    const text = option.description
    let score = 4
    if (option.type === SkillType.ACTIVE) score += 1.2
    if (text.includes('锁定技')) score += 0.6
    if (/摸[^。]{0,6}张/.test(text)) score += 1.4
    if (/造成[^。]{0,4}点伤害/.test(text)) score += 1.5
    if (/回复[^。]{0,4}点体力/.test(text)) score += 1.2
    if (/(弃置|获得)[^。]{0,8}(手牌|牌)/.test(text)) score += 1.0
    if (/(不能|无法|防止)/.test(text)) score += 0.4
    if (/(出牌阶段限一次|每回合限一次|每轮限一次)/.test(text)) score -= 0.8
    if (/(翻面|失去[^。]{0,4}点体力)/.test(text)) score -= 0.6
    return score
}

/** 规则 AI：在候选里取评分最高者，同分时取先出现的（候选已被洗牌） */
export function pickOddity(options: readonly OddityOption[]): OddityOption | undefined {
    let best: OddityOption | undefined
    let bestScore = -Infinity
    for (const option of options) {
        const score = oddityScore(option)
        if (score > bestScore) {
            bestScore = score
            best = option
        }
    }
    return best
}
