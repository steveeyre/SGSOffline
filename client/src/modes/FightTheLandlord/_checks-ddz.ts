import {
    Card,
    CardCategory,
    CardSuit,
    Faction,
    GameMode,
    GamePhase,
    ResponseType,
    TrickCardName,
    TrickType,
    TurnPhase,
} from 'sgs3v3-shared'
import { createDeck158 } from '../../engine/cards'
import { checkGameOver } from '../../engine/game-state'
import { getGeneralById, getGeneralPool } from '../../engine/generals'
import { dealDamage, handleRespond } from '../../engine/game-actions'
import { continueTurnFromJudge } from '../../engine/turn-manager'
import { aiLandlordDraft, buildLandlordPools, getLandlordGeneralPool, landlordSeatBonus } from './landlord-draft'
import { createLandlordMatch, landlordPickGeneral, type LandlordSide } from './landlord-match'

let failed = 0
function assert(cond: boolean, label: string): void {
    if (cond) {
        console.log(`  ok   ${label}`)
    } else {
        failed++
        console.log(`  FAIL ${label}`)
    }
}

/** 依次放弃队头待响应，直到队列清空（建局时地主可能已有技能询问待处理） */
function settleAll(state: ReturnType<typeof createLandlordMatch>): void {
    for (let i = 0; i < 200; i++) {
        const head = state.pendingResponseQueue[0]
        if (!head) return
        const responder = state.generals[head.targetGeneralIndex]
        const res = handleRespond(state, responder.playerId, { action: 'decline' } as any) as
            { error?: string } | undefined
        if (res?.error) return
    }
}

/** 依次放弃队头待响应，直到指定类型排到队首 */
function settleUntilHead(state: ReturnType<typeof createLandlordMatch>, type: ResponseType): void {
    for (let i = 0; i < 200; i++) {
        const head = state.pendingResponseQueue[0]
        if (!head || head.type === type) return
        const responder = state.generals[head.targetGeneralIndex]
        const res = handleRespond(state, responder.playerId, { action: 'decline' } as any) as
            { error?: string } | undefined
        if (res?.error) return
    }
}

function finishDraft(state: ReturnType<typeof createLandlordMatch>): void {
    for (let i = 0; i < 3; i++) {
        const pick = state.landlordPick!
        const seat = pick.picked.findIndex((id) => id === null)
        if (seat < 0) break
        aiLandlordDraft(state)
        if (state.landlordPick!.picked[seat] === null) {
            const def = state.landlordPick!.pools[seat][0]
            landlordPickGeneral(state, seat, def.id)
        }
    }
}

console.log('[斗地主：池与牌堆]')
const pool = getLandlordGeneralPool()
const luoshuSize = getGeneralPool('brawl').length
assert(pool.length === luoshuSize - 2, `模式池 = 洛书池去 2 名（${luoshuSize} → ${pool.length}）`)
assert(!pool.some((g) => g.id === 'wenpin' || g.id === 'zhugejin'), '剔除文聘、诸葛瑾')
const pools = buildLandlordPools()
assert(pools[0].length === 6 && pools[1].length === 5 && pools[2].length === 5, '三池 6/5/5')
const ids = pools.flat().map((g) => g.id)
assert(new Set(ids).size === 16, '三池互不重复（16 名）')
const deck = createDeck158('tongshuai156')
const lightnings = deck.filter((c) => c.name === TrickCardName.LIGHTNING)
assert(lightnings.length === 2, '牌堆含 2 张闪电')
assert(lightnings.some((c) => c.suit === CardSuit.SPADE && c.value === 1), '闪电♠A')
assert(lightnings.some((c) => c.suit === CardSuit.HEART && c.value === 12), '闪电♥Q')

console.log('[斗地主：建局]')
const state = createLandlordMatch('landlord', 4242)
assert(state.mode === GameMode.DOUDIZHU, 'mode = doudizhu')
assert(state.landlordPick!.pools.length === 3, '存在三池选将态')
assert(state.landlordPick!.picked[1] !== null && state.landlordPick!.picked[2] !== null,
    'AI 农民即时完成选将')
assert(state.landlordPick!.picked[0] === null, '地主席等待人类选择')

finishDraft(state)
assert(state.phase === GamePhase.PLAYING, '三方选完后进入对局')
assert(state.generals.length === 3, '三名武将落座')
assert(state.generals[0].faction === Faction.WARM && state.generals[0].seatRole === 'commander',
    '1 号位为地主（暖方主帅）')
assert(state.generals[1].faction === Faction.COOL && state.generals[2].faction === Faction.COOL,
    '2、3 号位为农民')
assert(state.generals[1].playerId === state.generals[2].playerId, '两名农民由同一玩家控制')
const landlordDef = getGeneralById(state.generals[0].generalId)!
assert(state.generals[0].maxHp === state.generals[0].hp
    && state.generals[0].maxHp === landlordDef.maxHp + 1,
    `地主体力上限+1（${state.generals[0].hp}/${state.generals[0].maxHp}，基础 ${landlordDef.maxHp}）`)
assert(state.generals[0].acquiredSkills.includes('doudizhu_feiyang')
    && state.generals[0].acquiredSkills.includes('doudizhu_bahu'), '地主获得【飞扬】【跋扈】')
assert(state.generals.every((g) => g.hand.length >= 4), '三人初始各 4 张手牌')
const totalCards = state.deck.length + state.discard.length + state.generals.reduce(
    (n, g) => n + g.hand.length + Object.values(g.equip).filter(Boolean).length, 0)
assert(totalCards === 158, `牌堆+手牌+弃牌 = 158（实际 ${totalCards}，牌堆 ${state.deck.length}）`)
settleAll(state)
assert(state.log.some((l) => l.text.includes('跋扈')), '首回合【跋扈】摸牌')
assert(state.activeGeneralIndex === 0, '地主先手')

console.log('[斗地主：飞扬]')
const landlord = state.generals[0]
const delayed: Card = {
    id: 'probe_le', suit: CardSuit.SPADE, value: 6, category: CardCategory.TRICK,
    name: TrickCardName.OVERINDULGENCE, trickType: TrickType.DELAYED,
}
landlord.judgeZone = [delayed]
state.pendingResponseQueue = []
state.negateWindow = undefined
state.attackUsedThisTurn = 0
state.turnPhase = TurnPhase.TURN_START
continueTurnFromJudge(state, false, false, false)
let pend = state.pendingResponseQueue[0]
assert(pend?.type === ResponseType.SKILL_ACTIVATE_CONFIRM
    && (pend.context as any)?.skillId === 'doudizhu_feiyang', '判定阶段入口询问【飞扬】')
const handBefore = landlord.hand.length
handleRespond(state, 'human', { action: 'confirm' })
pend = state.pendingResponseQueue[0]
assert(pend?.type === ResponseType.SKILL_PICK_CARD, '确认后进入选牌')
const picked = landlord.hand.slice(0, 2).map((c) => c.id)
const discardBefore = state.discard.length
handleRespond(state, 'human', { cardIds: picked } as any)
assert(landlord.judgeZone.length === 0, '弃置判定区一张牌')
assert(picked.every((id) => state.discard.some((c) => c.id === id)), '弃置两张手牌')
assert(state.discard.length >= discardBefore + 3, '弃牌 + 判定区牌进入弃牌堆')
assert(landlord.skillsUsedThisTurn.includes('doudizhu_feiyang'), '本回合已用【飞扬】')

console.log('[斗地主：阵亡奖励]')
const rewardState = createLandlordMatch('landlord', 777)
finishDraft(rewardState)
settleAll(rewardState)
const rLandlord = rewardState.generals[0]
const farmerA = rewardState.generals[1]
const farmerB = rewardState.generals[2]
// 该段只验证击杀奖励：地主若为新武将（如张华的【穿屋】会在造成伤害时摸牌），
// 会干扰“手牌不变”的断言，故换成无伤害触发摸牌的武将。
rLandlord.generalId = 'caocao'
farmerA.hand = []
farmerA.hp = 1
rLandlord.hand = []
const landlordHandBefore = rLandlord.hand.length
dealDamage(rewardState, rLandlord, farmerA, 2, undefined, { nature: 'thunder' })
settleUntilHead(rewardState, ResponseType.LANDLORD_REWARD)
assert(!farmerA.alive, '农民阵亡')
const rewardPending = rewardState.pendingResponseQueue[0]
assert(rewardPending?.type === ResponseType.LANDLORD_REWARD, '存活农民收到二选一询问')
assert(rewardPending?.targetGeneralIndex === rewardState.generals.indexOf(farmerB), '由存活农民选择')
assert(rLandlord.hand.length === landlordHandBefore, '地主击杀农民无奖励')
const survivorHandBefore = farmerB.hand.length
handleRespond(rewardState, farmerB.playerId, { action: 'draw' } as any)
assert(farmerB.hand.length === survivorHandBefore + 2, '选择摸两张牌')

const rewardState2 = createLandlordMatch('landlord', 778)
finishDraft(rewardState2)
settleAll(rewardState2)
const rL2 = rewardState2.generals[0]
const fA2 = rewardState2.generals[1]
const fB2 = rewardState2.generals[2]
fA2.hand = []
fA2.hp = 1
fB2.hp = Math.max(1, fB2.maxHp - 1)
const survivorHp = fB2.hp
dealDamage(rewardState2, rL2, fA2, 2)
settleUntilHead(rewardState2, ResponseType.LANDLORD_REWARD)
assert(rewardState2.pendingResponseQueue[0]?.type === ResponseType.LANDLORD_REWARD,
    '存活农民收到第二次二选一询问')
handleRespond(rewardState2, fB2.playerId, { action: 'recover' } as any)
assert(fB2.hp === Math.min(fB2.maxHp, survivorHp + 1), '选择回复1点体力')

console.log('[斗地主：胜负]')
const overState = createLandlordMatch('farmers', 909)
finishDraft(overState)
assert(!checkGameOver(overState).over, '开局未结束')
overState.generals[0].alive = false
const over1 = checkGameOver(overState)
assert(over1.over && over1.winnerFaction === Faction.COOL, '地主阵亡 → 农民胜')

const overState2 = createLandlordMatch('farmers', 910)
finishDraft(overState2)
overState2.generals[1].alive = false
overState2.generals[2].alive = false
const over2 = checkGameOver(overState2)
assert(over2.over && over2.winnerFaction === Faction.WARM, '两名农民阵亡 → 地主胜')

console.log('[斗地主：地主抓将扣掉队友向技能]')
{
    // 地主没有队友：结姻/资援/仁德/明鉴这类只能给其他角色用的增益在评分里要扣掉
    const allyOnly = [
        { id: 'sunshangxiang_jie', skills: [{ id: 'sunshangxiang_jie_jieyin' }] },
        { id: 'mizhu', skills: [{ id: 'mizhu_ziyuan' }] },
        { id: 'liubei', skills: [{ id: 'liubei_rende' }] },
        { id: 'caorui', skills: [{ id: 'caorui_mingjian' }] },
        { id: 'zhaoyun_jing', skills: [{ id: 'zhaoyun_jiuzhu' }] },
    ]
    for (const def of allyOnly) {
        assert(landlordSeatBonus(def as any) <= -8, `地主对${def.id}的队友向技能扣分`)
    }
    // 不依赖队友的技能不受影响
    const selfOnly = { id: 'zhangfei', skills: [{ id: 'zhangfei_paoxiao' }] }
    assert(landlordSeatBonus(selfOnly as any) === 0, '纯输出技能不扣分')
}

console.log(failed === 0 ? '\n斗地主检查全部通过' : `\n斗地主检查失败 ${failed} 项`)
if (failed > 0) process.exitCode = 1
