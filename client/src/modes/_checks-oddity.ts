import { Faction, GamePhase, SkillType } from 'sgs3v3-shared'
import { getGeneralById } from '../engine/generals'
import {
    drawOddities, ODDITY_CHOICES, oddityCatalog, oddityScore, pickOddity,
} from '../engine/oddity'
import { createPairMatch, pairConfirmPick, setupPairPlay } from './HappyPair/pair-match'
import { aiPairDraft } from './HappyPair/pair-draft'
import { createLandlordMatch, landlordConfirmPick, setupLandlordPlay } from './FightTheLandlord/landlord-match'
import { aiLandlordDraft } from './FightTheLandlord/landlord-draft'

let failed = 0
function assert(cond: boolean, label: string, detail?: unknown): void {
    if (cond) {
        console.log(`  ok   ${label}`)
    } else {
        failed++
        console.log(`  FAIL ${label}`)
        if (detail !== undefined) console.log('       ', detail)
    }
}

console.log('[奇技：目录与抽取]')
const catalog = oddityCatalog()
assert(catalog.length > 200, `目录覆盖洛书池技能（实际 ${catalog.length} 项）`)
assert(catalog.every((o) => !!getGeneralById(o.sourceGeneralId)), '每项奇技都能追溯到原武将')
assert(catalog.every((o) => o.type !== SkillType.AWAKENED), '目录不含觉醒技')
assert(catalog.some((o) => o.type === SkillType.LIMITED), '目录收录限定技')
assert(['luji_huaiyu', 'zhanghulelin_xijue', 'mizhu_jujia']
    .every((id) => catalog.some((o) => o.skillId === id)), '目录收录怀橘/袭爵/巨贾')
assert(['doudizhu_feiyang', 'doudizhu_bahu', 'doudizhu_qiangyi']
    .every((id) => !catalog.some((o) => o.skillId === id)), '地主三专技（飞扬/跋扈/强易）不入池')
assert(catalog.some((o) => o.skillId === 'lingju_fenxin'),
    '焚心入池（描述提到主公技，但本身不是主公技）')
assert(catalog.some((o) => o.skillId === 'fazheng_xuanhuo'),
    '眩惑入池（出杀后的出牌阶段按当前回合角色恢复）')
assert(catalog.every((o) => o.description.length > 0), '奇技都带技能描述')

const drawn = drawOddities([])
assert(drawn.length === ODDITY_CHOICES, `一次抽 ${ODDITY_CHOICES} 个候选（实际 ${drawn.length}）`)
assert(new Set(drawn.map((o) => o.skillId)).size === drawn.length, '同一次抽取不重复')
const excluded = drawn.map((o) => o.skillId)
const drawn2 = drawOddities(excluded)
assert(drawn2.every((o) => !excluded.includes(o.skillId)), '排除列表生效')

const scored = pickOddity(catalog)
assert(!!scored && Number.isFinite(oddityScore(scored)), '规则 AI 能在目录里挑出一个奇技')

console.log('[奇技：欢乐成双建局]')
const pair = createPairMatch(Faction.COOL, 4321, false, true)
const pp = pair.pairPick!
assert(pair.oddityMode === true, 'state.oddityMode 已标记')
assert(pp.oddities?.[0].length === ODDITY_CHOICES && pp.oddities?.[3].length === ODDITY_CHOICES,
    '人类两席各抽到 3 个奇技候选')
assert(pp.oddities?.[1].length === 0 && pp.oddities?.[2].length === 0,
    'AI 席位暂不抽候选（玩家先选、电脑后选）')
assert(pp.oddityPicked?.join(',') === ',,,', '奇技尚未选定')
assert([0, 3].every((i) => {
    const own = new Set(pp.pools[i].flatMap((g) => g.skills.map((s) => s.id)))
    return pp.oddities![i].every((o) => !own.has(o.skillId))
}), '候选不含本席位武将已有技能')
const humanCandidates = [...pp.oddities![0], ...pp.oddities![3]].map((o) => o.skillId)
assert(new Set(humanCandidates).size === humanCandidates.length, '人类两席候选之间不重复')

console.log('[奇技：欢乐成双确认选将]')
const badPick = pairConfirmPick(pair, 0, pp.pools[0][0].id, 'not_a_real_skill')
assert('error' in badPick, '提交不存在的奇技被拒绝')

const humanSkill0 = pp.oddities![0][0].skillId
const humanSkill3 = pp.oddities![3][0].skillId
const firstPick = pairConfirmPick(pair, 0, pp.pools[0][0].id, humanSkill0)
assert(!('error' in firstPick), '1 号位武将与奇技一并提交')
assert(pp.oddityPicked![1] === null && pp.oddityPicked![2] === null, '玩家选完前 AI 尚未选奇技')
const last = pairConfirmPick(pair, 3, pp.pools[3][0].id, humanSkill3)
assert(!('error' in last), '4 号位武将与奇技一并提交')
assert(pair.phase === GamePhase.GENERAL_PICK, '人类两席选完后仍在等 AI')
aiPairDraft(pair, () => setupPairPlay(pair))
assert(pp.oddityPicked!.every((id) => id !== null), 'AI 在玩家之后补齐奇技')
assert(new Set(pp.oddityPicked!).size === 4, '四席奇技互不重复')
assert(pair.phase === GamePhase.PLAYING, '四席选定后进入对局')
assert(pair.generals[0].acquiredSkills.includes(humanSkill0), '1 号位获得选中奇技')
assert(pair.generals[3].acquiredSkills.includes(humanSkill3), '4 号位获得选中奇技')
assert(pair.generals[1].acquiredSkills.length === 1 && pair.generals[2].acquiredSkills.length === 1,
    'AI 两席各获得 1 个奇技')
assert(pair.log.some((l) => l.text.includes('获得奇技')), '日志记录奇技授予')

console.log('[奇技：斗地主确认选将]')
const ddz = createLandlordMatch('landlord', 4323, false, true)
const dp = ddz.landlordPick!
assert(ddz.oddityMode === true, '斗地主同样标记奇技模式')
assert(dp.oddities?.[0].length === ODDITY_CHOICES, '地主席位抽到 3 个奇技候选')
assert(dp.oddities?.[1].length === 0 && dp.oddities?.[2].length === 0, '农民席位等 AI 后选')
const landlordSkill = dp.oddities![0][0].skillId
const ddzDone = landlordConfirmPick(ddz, 0, dp.pools[0][0].id, landlordSkill)
assert(!('error' in ddzDone) && ddz.phase === GamePhase.GENERAL_PICK, '地主选完后等 AI 农民')
aiLandlordDraft(ddz, () => setupLandlordPlay(ddz))
assert(ddz.phase === GamePhase.PLAYING, 'AI 农民补齐后进入对局')
assert(ddz.generals[0].acquiredSkills.includes(landlordSkill), '地主获得选中奇技')
assert(ddz.generals[0].acquiredSkills.includes('doudizhu_feiyang'), '地主专技未被奇技覆盖')
const ddzSkills = dp.oddityPicked!.filter((id): id is string => !!id)
assert(new Set(ddzSkills).size === 3, '斗地主三方奇技互不重复')

console.log('[奇技：开局钩子识别奇技]')
const mk = createPairMatch(Faction.COOL, 9011, false, true)
const mp = mk.pairPick!
// 人为把开局类技能塞进人类两席候选，验证落座后的钩子按 acquiredSkills 发标记
const fill = (seat: number, skillId: string, skillName: string): void => {
    mp.oddities![seat] = [{
        skillId, skillName, description: '', type: SkillType.LOCKED,
        sourceGeneralId: '', sourceGeneralName: '',
    }, ...mp.oddities![seat]]
}
fill(0, 'mizhu_jujia', '巨贾')
fill(3, 'luji_huaiyu', '怀橘')
const ownerJujia = mp.pools[0].find((g) => g.id !== 'mizhu')!
const ownerHuaiyu = mp.pools[3].find((g) => g.id !== 'luji')!
const mkA = pairConfirmPick(mk, 0, ownerJujia.id, 'mizhu_jujia')
const mkB = pairConfirmPick(mk, 3, ownerHuaiyu.id, 'luji_huaiyu')
assert(!('error' in mkA) && !('error' in mkB), '人为置入的开局类奇技可提交')
aiPairDraft(mk, () => setupPairPlay(mk))
assert(mk.phase === GamePhase.PLAYING, 'AI 补齐后进入对局')
// 1 号位落座后即进入摸牌阶段，手牌数含常规摸牌，故按日志里的多摸张数断言
const jujiaLog = mk.log.find((l) => l.text.includes('巨贾') && l.text.includes('多摸'))?.text ?? ''
assert(jujiaLog.includes(`多摸${mk.generals[0].maxHp}张牌`),
    `奇技巨贾按体力上限多摸牌（${jujiaLog}）`)
assert(mk.generals[3].orangeMarks === 3, '奇技怀橘在开局补 3 个“橘”')

console.log(`\n奇技检查${failed === 0 ? '全部通过' : `失败 ${failed} 项`}`)
if (failed > 0) process.exit(1)
