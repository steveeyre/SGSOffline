/**
 * 审计层的断言检查：谓词 DSL、补丁覆盖、录制、确定性。
 * 用法：node scripts/run-engine-checks.mjs src/engine/_audit-checks.ts
 */
import { Faction, GamePhase } from 'sgs3v3-shared'
import { createLocalMatch } from './local-match'
import { runSelfPlayGame } from './selfplay'
import {
    beginDecision, evalPredicate, extractFeatures, featureTable, finishAuditGame, forcedRule,
    startAudit, startAuditGame, stopAudit, validatePredicate, type DecisionRecord,
} from './ai-audit'
import { applyPatchToOptions, loadPatchBank, thresholdFor, variantStats } from './ai-variant'

let failures = 0

function check(name: string, ok: boolean, detail = ''): void {
    if (ok) {
        console.log(`  ok   ${name}`)
    } else {
        failures++
        console.log(`  FAIL ${name}${detail ? ` :: ${detail}` : ''}`)
    }
}

function fingerprint(result: ReturnType<typeof runSelfPlayGame>): string {
    return [result.ok, result.winner ?? '-', result.steps, result.state.log.length, result.state.deck.length].join('|')
}

console.log('谓词 DSL')
{
    check('空 all 视为恒真', evalPredicate({ all: [] }, { my_hp: 1 }))
    check('未知特征被拒绝', validatePredicate({ cmp: ['enemy_hp', '<=', 2] }).length > 0)
    check('布尔特征不能与数字比较', validatePredicate({ cmp: ['kill_window', '<=', 2] }).length > 0)
    check('非法操作符被拒绝', validatePredicate({ cmp: ['my_hp', '=', 2] }).length > 0)
    check('合法谓词通过校验', validatePredicate({ all: [
        { cmp: ['enemy_cmd_hp', '<=', 2] },
        { not: { cmp: ['enemy_cmd_armor', '==', true] } },
    ] }).length === 0)
    check('not 简写接受布尔特征', validatePredicate({ not: 'enemy_cmd_armor' }).length === 0)
    check('not 简写拒绝数值特征', validatePredicate({ not: 'my_hp' }).length > 0)
    check('not 简写求值正确', evalPredicate({ not: 'enemy_cmd_armor' }, { enemy_cmd_armor: false }) &&
        !evalPredicate({ not: 'enemy_cmd_armor' }, { enemy_cmd_armor: true }))
    check('嵌套求值正确', evalPredicate({ all: [
        { cmp: ['enemy_cmd_hp', '<=', 2] },
        { not: { cmp: ['enemy_cmd_armor', '==', true] } },
        { in: ['slash', [1, 2, 3]] },
    ] }, { enemy_cmd_hp: 2, enemy_cmd_armor: false, slash: 2 }))
    check('any 求值正确', evalPredicate({ any: [
        { cmp: ['peach', '>=', 1] },
        { cmp: ['dodge', '>=', 5] },
    ] }, { peach: 0, dodge: 1 }) === false)
    const names = new Set(featureTable().map((spec) => spec.name))
    check('特征表无重复', names.size === featureTable().length)
}

console.log('补丁覆盖层')
{
    startAudit({ runId: 'unit', record: false })
    const state = createLocalMatch(Faction.WARM, 7)
    const context = beginDecision(state, 'human', 'play', { enemy_cmd_hp: 2 })!
    check('特征抽取包含基础项', !!context && typeof context.feats.my_hp === 'number')
    check('特征抽取允许覆盖', context.feats.enemy_cmd_hp === 2)

    const bad = loadPatchBank({ warm: { id: 'bad', rules: [{ id: 'x', type: 'guard', target: 'slash', when: { cmp: ['nope', '<=', 1] } }] } })
    check('坏补丁被校验拒绝', bad.length > 0)

    loadPatchBank({
        warm: {
            id: 'unit-test',
            rules: [
                { id: 'g1', type: 'guard', target: 'slash', when: { cmp: ['enemy_cmd_hp', '<=', 2] } },
                { id: 'p1', type: 'priority', target: 'duel', delta: 20 },
                { id: 't1', type: 'threshold', name: 'PASS_SCORE', value: 35 },
            ],
        },
    })
    const options = [
        { key: 'slash', score: 50, plans: ['burst'] },
        { key: 'duel', score: 55, plans: ['control'] },
        { key: 'peach', score: 10, plans: ['defense'] },
    ]
    const patched = applyPatchToOptions(context, options)
    check('guard 淘汰目标规则', !patched.some((option) => option.key === 'slash'))
    check('priority 改分', patched.find((option) => option.key === 'duel')?.score === 75)
    check('未命中时原样返回', applyPatchToOptions(
        { ...context, feats: { ...context.feats, enemy_cmd_hp: 4 } },
        options,
    ).length === 3)
    check('threshold 覆盖缺省值', thresholdFor(context, 'PASS_SCORE', 20) === 35)

    loadPatchBank({ warm: { id: 'fb', rules: [
        { id: 'f1', type: 'fallback', target: 'peach', baseScore: 25, when: { all: [] } },
    ] } })
    const lifted = applyPatchToOptions(context, options.map((option) => ({ ...option, score: 5 })))
    check('fallback 在全员低于门槛时兜底提分', lifted.find((option) => option.key === 'peach')?.score === 25)

    const vetoed = loadPatchBank({ cool: { id: 'v', rules: [{ id: 'v1', type: 'veto', target: 'slash' }] } })
    check('veto 补丁合法', vetoed.length === 0)
    loadPatchBank(null)
    stopAudit()
    check('卸载后不再生效', !variantStats().rules['g1'])
}

console.log('干预队列')
{
    const state = createLocalMatch(Faction.WARM, 11)
    startAudit({
        runId: 'unit',
        record: true,
        intervention: { when: { all: [] }, forceRuleId: 'slash', maxHits: 1 },
    })
    startAuditGame({ seed: 11, game: 0 })
    const context = beginDecision(state, 'human', 'play')!
    check('谓词命中返回强制规则', forcedRule(context, 'play') === 'slash')
    check('命中上限生效', forcedRule(context, 'play') === null)
    stopAudit()
}

console.log('录制与确定性')
{
    const collected: DecisionRecord[] = []
    startAudit({ runId: 'unit', record: true, playStride: 1, sink: (record) => collected.push(record) })
    startAuditGame({ seed: 1000, game: 0 })
    const result = runSelfPlayGame(1000, Faction.WARM, 60000)
    const recorded = finishAuditGame({ winner: result.winner ?? null, steps: result.steps, ok: result.ok })
    stopAudit()
    check('对局正常结束', result.ok)
    check('录制到决策点', recorded > 0, `recorded=${recorded}`)
    check('全部记录带结果', collected.every((record) => !!record.outcome))
    check('出牌决策带候选表', collected.some((record) =>
        record.kind === 'play' && record.candidates.length > 0 && record.alternative === 'enumerated'))
    check('记录含局面特征', collected.every((record) => typeof record.feats.my_hp === 'number'))
    check('响应/弃牌等非出牌决策也被记录', collected.some((record) => record.kind !== 'play'))

    loadPatchBank({ warm: { id: 'empty', rules: [] }, cool: null })
    startAudit({ runId: 'unit', record: false })
    startAuditGame({ seed: 1000, game: 0 })
    const withEmpty = runSelfPlayGame(1000, Faction.WARM, 60000)
    finishAuditGame({ winner: withEmpty.winner ?? null, steps: withEmpty.steps, ok: withEmpty.ok })
    stopAudit()
    check('空补丁对行为零影响', fingerprint(withEmpty) === fingerprint(result),
        `${fingerprint(withEmpty)} vs ${fingerprint(result)}`)

    const again = runSelfPlayGame(1000, Faction.WARM, 60000)
    check('同种子重放一致', fingerprint(again) === fingerprint(result))

    const match = createLocalMatch(Faction.WARM, 1000)
    check('对局以选将开始', match.phase === GamePhase.GENERAL_PICK)
    check('特征表非空', featureTable().length > 20)
}

console.log('反事实干预生效')
{
    const collected: DecisionRecord[] = []
    startAudit({
        runId: 'unit',
        record: true,
        playStride: 1,
        intervention: { when: { all: [] }, forceRuleId: 'slash', onlyFaction: 'warm', maxHits: 50 },
        sink: (record) => collected.push(record),
    })
    startAuditGame({ seed: 1000, game: 0 })
    const result = runSelfPlayGame(1000, Faction.WARM, 60000)
    finishAuditGame({ winner: result.winner ?? null, steps: result.steps, ok: result.ok })
    stopAudit()
    check('干预确实落到出牌结算上', collected.some((record) => record.meta?.forced === 'slash'),
        `records=${collected.length}`)
}

console.log(failures === 0 ? '\n审计层检查全部通过' : `\n审计层检查失败 ${failures} 项`)
if (failures > 0) process.exit(1)
