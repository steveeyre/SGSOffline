import { Faction, GamePhase } from 'sgs3v3-shared'
import { GENERALS } from '../engine/generals'
import { oddityCatalog } from '../engine/oddity'
import { aiPairDraft, getPairGeneralPool, getPairPointPickPool } from './HappyPair/pair-draft'
import { createPairMatch, pairPickGeneral, pairPointPick, setupPairPlay } from './HappyPair/pair-match'
import { aiLandlordDraft, getLandlordPointPickPool } from './FightTheLandlord/landlord-draft'
import { createLandlordMatch, landlordPointPick, setupLandlordPlay } from './FightTheLandlord/landlord-match'

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

console.log('[点将：候选池]')
const orderIds = GENERALS.map((g) => g.id)
const pairPool = getPairPointPickPool()
const expectedIds = orderIds.filter((id) => getPairGeneralPool().some((g) => g.id === id))
assert(pairPool.map((g) => g.id).join(',') === expectedIds.join(','),
    '欢乐成双点将池按 generals.ts 的 GENERALS 定义顺序排列')
assert(pairPool.length === getPairGeneralPool().length, `点将池覆盖模式全池（${pairPool.length} 名）`)
assert(new Set(pairPool.map((g) => g.id)).size === pairPool.length, '点将池无重复')
assert(!pairPool.some((g) => g.id === 'wenpin' || g.id === 'zhugejin'), '点将池同样剔除文聘、诸葛瑾')

const landlordPool = getLandlordPointPickPool()
assert(landlordPool.map((g) => g.id).join(',') === orderIds
    .filter((id) => landlordPool.some((g) => g.id === id)).join(','),
    '斗地点将池按 GENERALS 定义顺序排列')
assert(landlordPool.length === pairPool.length, '两种模式点将池规模一致')

console.log('[点将：欢乐成双]')
const st = createPairMatch(Faction.COOL, 6101, false)
const sp = st.pairPick!
assert(sp.picked[1] === null && sp.picked[2] === null, '建局后 AI 尚未选将，玩家点将时可任选全池')
const outsider = pairPool.find((g) => !sp.pools[0].some((p) => p.id === g.id))!
assert(!!outsider, '存在本席位池外的武将')
assert('error' in pairPointPick(st, 0, 'caocao'), '点将池外的武将（经典池）被拒绝')
assert('error' in pairPickGeneral(st, 0, outsider.id), '普通选将仍受本席位池限制')
assert(!('error' in pairPointPick(st, 0, outsider.id)), '点将可以选出本席位池外的武将')
assert('error' in pairPointPick(st, 3, outsider.id), '两个席位也不能选同一名武将')

const rest = pairPool.find((g) => !sp.picked.includes(g.id))!
pairPointPick(st, 3, rest.id)
assert(sp.picked[1] === null && sp.picked[2] === null, '人类两席选完后 AI 仍未开始选')
aiPairDraft(st, () => setupPairPlay(st))
assert(st.phase === GamePhase.PLAYING, '人类选完后 AI 补齐并开局')
assert(st.generals[0].generalId === outsider.id, '开局 1 号位就是点将结果')
assert(new Set(st.generals.map((g) => g.generalId)).size === st.generals.length, '场上没有重复武将')

console.log('[点将：斗地主]')
const dd = createLandlordMatch('landlord', 6102, false)
const dp = dd.landlordPick!
assert(dp.picked[1] === null && dp.picked[2] === null, '斗地主建局后 AI 两农民尚未选将')
const dOutsider = landlordPool.find((g) => !dp.pools[0].some((p) => p.id === g.id))!
assert('error' in landlordPointPick(dd, 1, dOutsider.id), '人类不能替 AI 的农民席位点将')
assert(!('error' in landlordPointPick(dd, 0, dOutsider.id)), '地主点将池外武将成功')
aiLandlordDraft(dd, () => setupLandlordPlay(dd))
assert(dd.phase === GamePhase.PLAYING, '地主选完后 AI 补齐并开局')
assert(dd.generals[0].generalId === dOutsider.id, '地主武将就是点将结果')
assert(dd.generals[0].acquiredSkills.includes('doudizhu_feiyang'), '点将后仍正常授予地主专技')
assert(new Set(dd.generals.map((g) => g.generalId)).size === dd.generals.length, '斗地主场上没有重复武将')

console.log('[点将：奇技模式]')
const od = createPairMatch(Faction.COOL, 6103, false, true)
const op = od.pairPick!
const oOutsider = pairPool.find((g) => !op.pools[0].some((p) => p.id === g.id))!
const oSkill = op.oddities![0][0].skillId
assert('error' in pairPointPick(od, 0, oOutsider.id, 'not_a_skill'), '不存在的奇技会被拒绝')
const oRes = pairPointPick(od, 0, oOutsider.id, oSkill)
assert(!('error' in oRes), '奇技模式下点将可带奇技一并提交')
assert(op.picked[0] === oOutsider.id && op.oddityPicked![0] === oSkill, '点将武将和奇技同时落位')

console.log('[奇技：任选]')
const catalog = oddityCatalog()
const od2 = createPairMatch(Faction.COOL, 6104, false, true)
const op2 = od2.pairPick!
const outsideSkill = catalog.find((o) => !op2.oddities![0].some((c) => c.skillId === o.skillId))!
const p2General = pairPool.find((g) => !op2.pools[0].some((p) => p.id === g.id))!
const freeRes = pairPointPick(od2, 0, p2General.id, outsideSkill.skillId)
assert(!('error' in freeRes), '奇技可以任选，不限于 3 个候选')
assert(op2.oddityPicked![0] === outsideSkill.skillId, '任选的奇技正常落位')

console.log(`\n点将检查${failed === 0 ? '全部通过' : `失败 ${failed} 项`}`)
if (failed > 0) process.exit(1)
