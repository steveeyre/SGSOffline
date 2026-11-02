/**
 * 知识库与规则预算：已采纳 / 观察列表 / 负样本 / 规则数量上限。
 * 规则预算的意义：新增规则必须证明自己，否则优先调参数，避免规则膨胀。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { clientDir, readJson, stateRoot, writeJson } from './engine.mjs'

const KNOWLEDGE = join(stateRoot, 'knowledge.json')
const OBSERVATIONS = join(stateRoot, 'observations.json')
const NEGATIVES = join(stateRoot, 'negatives.json')
const BUDGET = join(stateRoot, 'budget.json')
const RULE_SITES = join(stateRoot, 'rule-sites.json')

const SYNTHETIC_SITES = [
    { key: 'respond', marker: 'export function aiRespond(' },
    { key: 'discard', marker: 'function aiDiscard(' },
    { key: 'skill', marker: 'function pickSkillOption(' },
    { key: 'negate', marker: 'const negateValue = negateScore({' },
    { key: 'unit', marker: 'function aiChooseUnitRaw(' },
    { key: 'draft', marker: 'function aiDraftRaw(' },
    { key: 'play:pass', marker: 'const passScore = thresholdFor(' },
]

export function lineOf(text, index) {
    let line = 1
    for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++
    return line
}

/** 扫描 local-ai.ts，得到每个规则 id 的源码锚点（供代码生成使用） */
export function scanRuleSites() {
    const file = join(clientDir, 'src', 'engine', 'local-ai.ts')
    const text = readFileSync(file, 'utf8')
    const rules = {}
    const pattern = /offer\(\s*'([^']+)'/g
    let match
    while ((match = pattern.exec(text)) !== null) {
        const id = match[1]
        if (!rules[id]) rules[id] = { kind: 'offer', line: lineOf(text, match.index) }
    }
    const synthetic = {}
    for (const site of SYNTHETIC_SITES) {
        const at = text.indexOf(site.marker)
        if (at >= 0) synthetic[site.key] = { kind: 'hook', line: lineOf(text, at) }
    }
    const sites = {
        file: 'client/src/engine/local-ai.ts',
        generatedAt: new Date().toISOString(),
        rules,
        synthetic,
        ruleCount: Object.keys(rules).length,
    }
    writeJson(RULE_SITES, sites)
    return sites
}

export function loadRuleSites({ refresh = false } = {}) {
    if (!refresh && existsSync(RULE_SITES)) {
        const cached = readJson(RULE_SITES, null)
        if (cached?.rules) return cached
    }
    return scanRuleSites()
}

/** 把录制到的 ruleId 归一到源码锚点上的键 */
export function normalizeRuleId(ruleId, sites) {
    if (!ruleId) return 'unknown'
    if (ruleId === 'PASS') return 'play:pass'
    if (ruleId.startsWith('skill:')) {
        const short = ruleId.split(':').slice(0, 2).join(':')
        return sites.rules[short] ? short : 'skill'
    }
    if (ruleId.startsWith('respond:')) return 'respond'
    if (ruleId.startsWith('negate:')) return 'negate'
    if (ruleId.startsWith('unit:')) return 'unit'
    if (ruleId === 'discard') return 'discard'
    if (ruleId === 'draft') return 'draft'
    return ruleId
}

export function siteOf(ruleId, sites) {
    const key = normalizeRuleId(ruleId, sites)
    return {
        key,
        ...(sites.rules[key] ?? sites.synthetic[key] ?? { kind: 'unknown', line: null }),
    }
}

function emptyKnowledge() {
    return { version: 1, adopted: [], updatedAt: new Date().toISOString() }
}
function emptyList() {
    return { version: 1, items: [], updatedAt: new Date().toISOString() }
}

export function readKnowledge() {
    return readJson(KNOWLEDGE, emptyKnowledge())
}

export function readObservations() {
    return readJson(OBSERVATIONS, emptyList())
}

export function readNegatives() {
    return readJson(NEGATIVES, emptyList())
}

export function pushRecord(file, record) {
    const data = file === KNOWLEDGE ? readKnowledge() : readJson(file, emptyList())
    if (file === KNOWLEDGE) {
        data.adopted.push(record)
    } else {
        data.items.push(record)
    }
    data.updatedAt = new Date().toISOString()
    writeJson(file, data)
}

export const KB_FILES = { KNOWLEDGE, OBSERVATIONS, NEGATIVES, BUDGET }

export function loadBudget(sites) {
    const existing = readJson(BUDGET, null)
    const baseline = sites.ruleCount
    if (existing && existing.baselineRules === baseline) return existing
    const budget = {
        baselineRules: baseline,
        cap: baseline + Math.max(3, Math.ceil(baseline * 0.05)),
        adoptedNewRules: existing?.adoptedNewRules ?? 0,
        updatedAt: new Date().toISOString(),
        note: '新增规则需在至少一个高嫌疑错手类别上带来 ≥2% 胜率提升，否则优先调整现有参数',
    }
    writeJson(BUDGET, budget)
    return budget
}

/**
 * 补丁是否新增规则：fallback 指向源码里不存在的规则 id 才算新增。
 * guard/priority/threshold/veto 都是对现有规则的调整，不占预算。
 */
export function patchCost(patch, sites) {
    let added = 0
    for (const rule of patch.rules ?? []) {
        if (rule.type !== 'fallback') continue
        const known = !!sites.rules[rule.target] || !!sites.synthetic[rule.target]
        if (!known) added++
    }
    return { added, modifies: (patch.rules ?? []).length - added }
}

export function budgetAllows(patch, sites) {
    const budget = loadBudget(sites)
    const cost = patchCost(patch, sites)
    if (cost.added === 0) return { ok: true, budget, cost, reason: '仅调整现有规则' }
    const remaining = budget.cap - budget.baselineRules - budget.adoptedNewRules
    if (cost.added <= remaining) return { ok: true, budget, cost, reason: `剩余新增名额 ${remaining}` }
    return { ok: false, budget, cost, reason: `新增规则超预算（剩余 ${remaining}，需要 ${cost.added}）` }
}
