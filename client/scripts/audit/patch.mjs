/**
 * 假设 → 补丁 → 代码片段。
 * 补丁先以数据形式参与 A/B，采纳后才生成可直接粘进 local-ai.ts 的代码。
 */
import { join } from 'node:path'
import { patchesRoot, writeJson } from './engine.mjs'
import { budgetAllows, siteOf, normalizeRuleId } from './kb.mjs'

export const PATCH_TYPES = ['guard', 'veto', 'priority', 'fallback', 'threshold']

export function describePredicate(pred) {
    if (!pred || typeof pred !== 'object') return '（空条件）'
    const op = Object.keys(pred)[0]
    if (op === 'all') return pred.all.map(describePredicate).join(' 且 ') || '恒真'
    if (op === 'any') return pred.any.map(describePredicate).join(' 或 ') || '恒假'
    if (op === 'not') {
        if (typeof pred.not === 'string') return `非（${pred.not} 为真）`
        return `非（${describePredicate(pred.not)}）`
    }
    if (op === 'cmp') {
        const [name, operator, value] = pred.cmp
        return `${name} ${operator} ${typeof value === 'boolean' ? (value ? '真' : '假') : value}`
    }
    if (op === 'in') return `${pred.in[0]} 属于 [${pred.in[1].join(', ')}]`
    return '（无法解析）'
}

export function predicateToCode(pred) {
    if (!pred || typeof pred !== 'object') return 'true'
    const op = Object.keys(pred)[0]
    if (op === 'all') {
        if (!pred.all.length) return 'true'
        return pred.all.map((item) => `(${predicateToCode(item)})`).join(' && ')
    }
    if (op === 'any') {
        if (!pred.any.length) return 'false'
        return pred.any.map((item) => `(${predicateToCode(item)})`).join(' || ')
    }
    if (op === 'not') return typeof pred.not === 'string' ? `!feats.${pred.not}` : `!(${predicateToCode(pred.not)})`
    if (op === 'cmp') {
        const [name, operator, value] = pred.cmp
        const literal = typeof value === 'boolean' ? String(value) : String(value)
        return `feats.${name} ${operator} ${literal}`
    }
    if (op === 'in') return `[${pred.in[1].map((v) => (typeof v === 'boolean' ? String(v) : String(v))).join(', ')}].includes(feats.${pred.in[0]})`
    return 'false'
}

export function patchIdFor(hypothesisId, runId) {
    const safe = String(hypothesisId ?? 'h').replace(/[^a-zA-Z0-9_.-]/g, '-')
    return `${runId ? `${runId}-` : ''}${safe}`
}

/** 把一条通过校验的假设转成补丁集（单条规则） */
export function patchFromHypothesis(hypothesis, { runId = null } = {}) {
    const patch = hypothesis.patch
    const id = patchIdFor(hypothesis.id, runId)
    const rule = { ...patch, id: `${id}-r1` }
    const set = {
        id,
        note: `${hypothesis.cluster ?? ''}｜置信度 ${hypothesis.confidence ?? 'unknown'}｜${hypothesis.suggestedBehavior ?? ''}`,
        rules: [rule],
        meta: {
            hypothesisId: hypothesis.id,
            cluster: hypothesis.cluster ?? null,
            trigger: hypothesis.trigger ?? null,
            triggerText: describePredicate(hypothesis.trigger),
            currentBehavior: hypothesis.currentBehavior ?? null,
            suggestedBehavior: hypothesis.suggestedBehavior ?? null,
            evidence: hypothesis.evidence ?? [],
            confidence: hypothesis.confidence ?? null,
        },
    }
    return set
}

export function writePatchFile(patch, { dryRun = false } = {}) {
    const path = join(patchesRoot, `${patch.id}.json`)
    if (!dryRun) writeJson(path, patch)
    return path
}

/** 供人直接落到源码的片段：包含锚点、可读条件与代码条件 */
export function renderPatchSnippet(patch, sites) {
    const rule = patch.rules[0]
    const meta = patch.meta ?? {}
    const target = rule.type === 'threshold' ? rule.name : rule.target
    const site = rule.type === 'threshold'
        ? { key: rule.name, ...(sites.synthetic['play:pass'] ?? { kind: 'hook', line: null }) }
        : siteOf(target, sites)
    const where = `${sites.file}:${site.line ?? '?'}（${site.key}）`
    const header = [
        `// 补丁 ${patch.id}`,
        `// 触发条件：${meta.triggerText ?? describePredicate(rule.when)}`,
        `// 当前行为：${meta.currentBehavior ?? '（未记录）'}`,
        `// 建议行为：${meta.suggestedBehavior ?? '（未记录）'}`,
        `// 置信度：${meta.confidence ?? 'unknown'}；证据：${(meta.evidence ?? []).join(', ') || '无'}`,
        `// 落点：${where}`,
    ].join('\n')

    const when = rule.when ? predicateToCode(rule.when) : 'true'
    let body
    switch (rule.type) {
        case 'guard':
            body = [
                `// 在 ${rule.target} 的分支条件里追加前置否定：`,
                `//   ${rule.target} 仅当以下条件为假时提供候选`,
                `const guard = ${when}`,
                `if (!guard) { /* 跳过 ${rule.target}，让低分候选或兜底规则接手 */ }`,
            ].join('\n')
            break
        case 'veto':
            body = `// 整条规则停用：删除或注释掉 ${rule.target} 的 offer 分支。`
            break
        case 'priority':
            body = [
                `// 调整冲突消解权重：${rule.target} 在命中条件下加 ${rule.delta} 分`,
                `const bias = (${when}) ? ${rule.delta} : 0`,
                `// offer('${rule.target}', BASE + bias, plans, run)`,
            ].join('\n')
            break
        case 'fallback':
            body = [
                `// 低优先级兜底：命中条件且没有候选过 PASS_SCORE 时，放行 ${rule.target}（基础分 ${rule.baseScore}）`,
                `const fallbackLift = (${when})`,
                `// 在 choosePlan 之前：if (fallbackLift && bestScore < PASS_SCORE) 提升 ${rule.target} 至 ${rule.baseScore}`,
            ].join('\n')
            break
        case 'threshold':
            body = `// 调整具名阈值：${rule.name} = ${rule.value}（原值见 ai-policy.ts / local-ai.ts）`
            break
        default:
            body = '// 未知补丁类型'
    }
    return `${header}\n${body}\n`
}

export function summarizePatch(patch, sites) {
    const rule = patch.rules[0]
    const target = rule.type === 'threshold' ? rule.name : rule.target
    const budget = budgetAllows(patch, sites)
    return {
        patchId: patch.id,
        type: rule.type,
        target,
        ruleKey: normalizeRuleId(target, sites),
        site: rule.type === 'threshold' ? sites.synthetic['play:pass'] : siteOf(target, sites),
        budget,
    }
}
