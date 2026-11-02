import {
    BasicCardName,
    Card,
    CardCategory,
    CardSuit,
    EquipSlot,
    EquipmentCardName,
    Faction,
    GameMode,
    GamePhase,
    ResponseType,
    TrickCardName,
    TrickType,
    TurnPhase,
} from 'sgs3v3-shared'
import { createDeck158 } from '../../engine/cards'
import { checkGameOver, toClientView } from '../../engine/game-state'
import { getGeneralPool, getGeneralById } from '../../engine/generals'
import {
    dealDamage, handleRespond, handleUseCard, negateWindowTimeout, syncCardState,
} from '../../engine/game-actions'
import { handleDiscard, handleEndTurn } from '../../engine/turn-manager'
import { listPlayOptions } from '../../engine/local-ai'
import { AI_PLAYER_ID, HUMAN_PLAYER_ID } from '../../engine/local-match'
import { applyLlmDraft, buildLlmDraftPrompt, draftFingerprint } from '../../engine/llm-ai'
import { buildPairPools, getPairGeneralPool, pairSeatsOf } from './pair-draft'
import { createPairMatch, pairBoardSeats, pairPickGeneral, setupPairPlay } from './pair-match'

let failed = 0
function assert(cond: boolean, label: string): void {
    if (cond) {
        console.log(`  ok   ${label}`)
    } else {
        failed++
        console.log(`  FAIL ${label}`)
    }
}

console.log('[欢乐成双：池与牌堆]')
const pool = getPairGeneralPool()
const luoshuSize = getGeneralPool('luoshu').length
assert(pool.length === luoshuSize - 2, `模式池 = 洛书池去 2 名（${luoshuSize} → ${pool.length}）`)
assert(!pool.some((g) => g.id === 'wenpin' || g.id === 'zhugejin'), '剔除文聘、诸葛瑾')
const pools = buildPairPools()
assert(pools.length === 4 && pools.every((p) => p.length === 5), '四池各 5 名')
assert(new Set(pools.flat().map((g) => g.id)).size === 20, '四池互不重复（20 名）')
const fullDeck = createDeck158('tongshuai156')
assert(fullDeck.length === 158, `158 张牌堆 = 156 统率 + 2 闪电（实际 ${fullDeck.length}）`)
const lightnings = fullDeck.filter((c) => c.name === TrickCardName.LIGHTNING)
assert(lightnings.length === 2, '牌堆含 2 张闪电')
assert(lightnings.some((c) => c.suit === CardSuit.SPADE && c.value === 1), '闪电♠A')
assert(lightnings.some((c) => c.suit === CardSuit.HEART && c.value === 12), '闪电♥Q')

console.log('[欢乐成双：建局与选将]')
const state = createPairMatch(Faction.COOL, 4242)
assert(state.mode === GameMode.HUANLE_SHUANG, 'mode = huanle_shuang')
assert(state.pairHumanSide === Faction.COOL, '人类执冷色')
assert(state.pairPick!.pools.length === 4, '存在四池选将态')
assert(state.pairPick!.picked[1] !== null && state.pairPick!.picked[2] !== null, 'AI 暖色两席即时选将')
assert(state.pairPick!.picked[0] === null && state.pairPick!.picked[3] === null, '冷色两席等待人类选择')
assert(pairSeatsOf(Faction.COOL).join(',') === '0,3', '冷色座位为 1、4 号位')
assert(pairSeatsOf(Faction.WARM).join(',') === '1,2', '暖色座位为 2、3 号位')

pairPickGeneral(state, 0, state.pairPick!.pools[0][0].id)
assert(state.phase === GamePhase.GENERAL_PICK, '只选一席时仍在选将阶段')
pairPickGeneral(state, 3, state.pairPick!.pools[3][0].id)
assert(state.phase === GamePhase.PLAYING, '两席选完后进入对局')
assert(state.generals.length === 4, '四名武将落座')
assert(state.generals.map((g) => g.faction).join(',') === 'cool,warm,warm,cool', '座次：冷、暖、暖、冷')
assert(state.generals[0].playerId === HUMAN_PLAYER_ID && state.generals[3].playerId === HUMAN_PLAYER_ID,
    '冷色两席由本地玩家控制')
assert(state.generals[1].playerId === AI_PLAYER_ID && state.generals[2].playerId === AI_PLAYER_ID,
    '暖色两席由 AI 控制')
assert(state.activeGeneralIndex === 0 && state.activePlayerFaction === Faction.COOL, '1 号位（冷色）先手')

console.log('[欢乐成双：执暖色]')
const warmState = createPairMatch(Faction.WARM, 555)
assert(warmState.pairHumanSide === Faction.WARM, '人类执暖色')
assert(warmState.pairPick!.picked[0] !== null && warmState.pairPick!.picked[3] !== null,
    'AI 冷色两席即时选将')
assert(warmState.pairPick!.picked[1] === null && warmState.pairPick!.picked[2] === null,
    '暖色两席等待人类选择')
const aiSeatPick = pairPickGeneral(warmState, 0, warmState.pairPick!.pools[0][0].id)
assert('error' in aiSeatPick, '人类不能替 AI 的冷色座位选将')
pairPickGeneral(warmState, 1, warmState.pairPick!.pools[1][0].id)
pairPickGeneral(warmState, 2, warmState.pairPick!.pools[2][0].id)
assert(warmState.phase === GamePhase.PLAYING, '暖色两席选完后进入对局')
assert(warmState.generals[1].playerId === HUMAN_PLAYER_ID && warmState.generals[2].playerId === HUMAN_PLAYER_ID,
    '暖色两席由本地玩家控制')
assert(warmState.generals[0].playerId === AI_PLAYER_ID && warmState.generals[3].playerId === AI_PLAYER_ID,
    '冷色两席由 AI 控制')
assert(warmState.activeGeneralIndex === 0 && warmState.activePlayerFaction === Faction.COOL,
    'AI 的 1 号位仍然先手')

console.log('[欢乐成双：固定座次]')
const coolRows = pairBoardSeats(Faction.COOL)
assert(coolRows.mySeats.join(',') === '0,3' && coolRows.oppSeats.join(',') === '1,2',
    '执冷：上排 1/4 号位，下排 2/3 号位')
assert(coolRows.mineOnTop, '执冷时己方行显示在上方')
const warmRows = pairBoardSeats(Faction.WARM)
assert(warmRows.mySeats.join(',') === '1,2' && warmRows.oppSeats.join(',') === '0,3',
    '执暖：上排 1/4 号位，下排 2/3 号位')
assert(!warmRows.mineOnTop, '执暖时己方行显示在下方')

console.log('[欢乐成双：1 号位初始手牌 -1]')
// 固定四名无摸牌阶段加成的武将，便于核对初始手牌数
const fixed = createPairMatch(Faction.COOL, 777, false)
const fixedDefs = ['guanyu', 'zhangfei', 'sunquan', 'huatuo'].map((id) => getGeneralById(id)!)
fixed.pairPick!.pools = fixedDefs.map((def) => [def])
fixed.pairPick!.picked = fixedDefs.map((def) => def.id)
setupPairPlay(fixed)
assert(fixed.log.some((l) => l.text.includes('初始手牌 -1')), '日志记录 1 号位初始手牌 -1')
assert(fixed.generals[0].hand.length === 5, `1 号位起手 3 张 + 首回合摸 2 张（实际 ${fixed.generals[0].hand.length}）`)
assert(fixed.generals.slice(1).every((g) => g.hand.length === 4),
    `其余三席各 4 张（实际 ${fixed.generals.slice(1).map((g) => g.hand.length).join('/')}）`)
assert(fixed.deck.length === 141, `158 张牌堆扣除起手 17 张（实际 ${fixed.deck.length}）`)

console.log('[欢乐成双：述志开局]')
const shuzhiState = createPairMatch(Faction.COOL, 778, false)
const shuzhiDefs = ['caocao_jie', 'zhangfei', 'sunquan', 'huatuo'].map((id) => getGeneralById(id)!)
shuzhiState.pairPick!.pools = shuzhiDefs.map((def) => [def])
shuzhiState.pairPick!.picked = shuzhiDefs.map((def) => def.id)
setupPairPlay(shuzhiState)
const shuzhiCc = shuzhiState.generals[0]
assert(!!shuzhiState.pendingResponseQueue.find((p) => (p.context as any)?.skillId === 'caocao_jie_shuzhi'),
    '1 号位界曹操开局询问述志')
const shuzhiHandBefore = shuzhiCc.hand.length
handleRespond(shuzhiState, HUMAN_PLAYER_ID, { action: 'qingzheng' } as any)
assert(shuzhiCc.shuzhiLimited === 'caocao_jie_qingzheng', '述志把【清正】改为限定技')
assert(shuzhiCc.hand.length === shuzhiHandBefore + 2 && shuzhiState.turnPhase === TurnPhase.ACTION,
    `述志结算后继续 1 号位回合（手牌 ${shuzhiHandBefore} → ${shuzhiCc.hand.length}）`)

console.log('[欢乐成双：群体锦囊逆时针]')
const aoeState = createPairMatch(Faction.COOL, 888, false)
const aoeDefs = ['guanyu', 'zhangfei', 'sunquan', 'huatuo'].map((id) => getGeneralById(id)!)
aoeState.pairPick!.pools = aoeDefs.map((def) => [def])
aoeState.pairPick!.picked = aoeDefs.map((def) => def.id)
setupPairPlay(aoeState)
aoeState.pendingResponseQueue = []
aoeState.negateWindow = undefined
aoeState.turnPhase = TurnPhase.ACTION
const nanman: Card = {
    id: 'probe_nanman', suit: CardSuit.SPADE, value: 7, category: CardCategory.TRICK,
    name: TrickCardName.BARBARIANS, trickType: TrickType.INSTANT,
}
aoeState.generals[0].hand.push(nanman)
const nanmanUse = handleUseCard(aoeState, HUMAN_PLAYER_ID, {
    cardId: nanman.id, targetIndices: [], extra: { direction: 'clockwise' },
} as any)
assert(!nanmanUse || !('error' in nanmanUse), '南蛮入侵可以正常使用')
const aoeOrder = aoeState.pendingResponseQueue
    .filter((p) => p.type === ResponseType.AOE_ATTACK)
    .map((p) => p.targetGeneralIndex)
assert(aoeOrder.join(',') === '1,2,3', `按 1→2→3→4 逆时针结算（实际 ${aoeOrder.join(',')}）`)

console.log('[欢乐成双：同阵营手牌可见]')
const humanView = toClientView(fixed, HUMAN_PLAYER_ID)
assert(humanView.generals[0].hand?.length === fixed.generals[0].hand.length
    && humanView.generals[3].hand?.length === fixed.generals[3].hand.length, '冷色玩家可见 1、4 号位手牌')
assert(humanView.generals[1].hand === undefined && humanView.generals[2].hand === undefined, '对方手牌不可见')
const aiView = toClientView(fixed, AI_PLAYER_ID)
assert(!!aiView.generals[1].hand && !!aiView.generals[2].hand, 'AI 可见自身两个座位的手牌')
assert(aiView.generals[0].hand === undefined, 'AI 看不到冷色手牌')

console.log('[欢乐成双：同阵营阵亡补偿]')
const rewardState = createPairMatch(Faction.COOL, 999, false)
const rewardDefs = ['guanyu', 'zhangfei', 'sunquan', 'huatuo'].map((id) => getGeneralById(id)!)
rewardState.pairPick!.pools = rewardDefs.map((def) => [def])
rewardState.pairPick!.picked = rewardDefs.map((def) => def.id)
setupPairPlay(rewardState)
const attacker = rewardState.generals[1]
const victim = rewardState.generals[3]
victim.hp = 1
victim.hand = []
dealDamage(rewardState, attacker, victim, 3)
// 依次放弃濒死救援，直到死亡并弹出补偿
for (let i = 0; i < 20; i++) {
    const head = rewardState.pendingResponseQueue[0]
    if (!head || head.type === ResponseType.LANDLORD_REWARD) break
    const responder = rewardState.generals[head.targetGeneralIndex]
    const res = handleRespond(rewardState, responder.playerId, { action: 'decline' } as any) as
        { error?: string } | undefined
    if (res?.error) break
}
const reward = rewardState.pendingResponseQueue[0]
assert(reward?.type === ResponseType.LANDLORD_REWARD, '队友阵亡后弹出二选一询问')
assert(reward?.targetGeneralIndex === 0, '由存活的同阵营角色（1 号位）选择')
const survivor = rewardState.generals[0]
const hpBefore = survivor.hp
handleRespond(rewardState, HUMAN_PLAYER_ID, { action: 'recover' } as any)
assert(survivor.hp === Math.min(survivor.maxHp, hpBefore + 1), '选择回复 1 点体力生效')

console.log('[欢乐成双：本地模型选将]')
const llmState = createPairMatch(Faction.COOL, 2024, false)
const llmReq = buildLlmDraftPrompt(llmState, AI_PLAYER_ID)
assert(!!llmReq, 'AI 两席未选时生成模型选将请求')
assert(llmReq!.options.length === 25, `两席组合共 25 个选项（实际 ${llmReq!.options.length}）`)
assert(llmReq!.options.every((o) => o.key.startsWith('pair-pair:1:')),
    '人类执冷色时模型为 2、3 号位合并选将')
const llmFpBefore = draftFingerprint(llmState)
const llmPick = llmReq!.options[3]
assert(applyLlmDraft(llmState, AI_PLAYER_ID, llmPick), '模型组合可以落子')
assert(llmState.pairPick!.picked[1] === llmPick.key.split(':')[2]
    && llmState.pairPick!.picked[2] === llmPick.key.split(':')[4], 'AI 两席一次性选好')
assert(llmState.pairPick!.picked[0] === null && llmState.pairPick!.picked[3] === null,
    '人类两席不受模型影响')
assert(draftFingerprint(llmState) !== llmFpBefore, '选将指纹随已选武将变化')
assert(!applyLlmDraft(llmState, AI_PLAYER_ID, llmPick), '同一组合不能重复落子')
pairPickGeneral(llmState, 0, llmState.pairPick!.pools[0][0].id)
pairPickGeneral(llmState, 3, llmState.pairPick!.pools[3][0].id)
assert(llmState.phase === GamePhase.PLAYING, '模型 + 人类选完后进入对局')

const badPairState = createPairMatch(Faction.COOL, 2027, false)
const badPairOption = {
    id: 'x',
    key: `pair-pair:0:${badPairState.pairPick!.pools[0][0].id}:3:${badPairState.pairPick!.pools[3][0].id}`,
    label: '非法组合',
    score: 0,
}
assert(!applyLlmDraft(badPairState, AI_PLAYER_ID, badPairOption), '模型不能替人类座位选将')

const singlePairState = createPairMatch(Faction.COOL, 2025, false)
singlePairState.pairPick!.picked[1] = singlePairState.pairPick!.pools[1][0].id
const singlePairReq = buildLlmDraftPrompt(singlePairState, AI_PLAYER_ID)
assert(!!singlePairReq && singlePairReq.options.length === 5, '只差一席时只给该席 5 个选项')
assert(singlePairReq!.options.every((o) => o.key.startsWith('pair-seat:2:')),
    '只差一席时单独询问 3 号位')

const llmWarmState = createPairMatch(Faction.WARM, 2026, false)
const llmWarmReq = buildLlmDraftPrompt(llmWarmState, AI_PLAYER_ID)
assert(!!llmWarmReq && llmWarmReq.options.every((o) => o.key.startsWith('pair-pair:0:')),
    '人类执暖色时模型为 1、4 号位合并选将')

console.log('[欢乐成双：全员阵亡判负]')
const overState = createPairMatch(Faction.COOL, 123, false)
// 直接构造：暖色两名阵亡、冷色仍存活
overState.generals = fixed.generals.map((g) => ({ ...g, alive: true }))
overState.generals[1].alive = false
overState.generals[2].alive = false
assert(checkGameOver(overState).winnerFaction === Faction.COOL, '暖色全员阵亡 → 冷色胜')
overState.generals[1].alive = true
overState.generals[2].alive = true
overState.generals[0].alive = false
overState.generals[3].alive = false
assert(checkGameOver(overState).winnerFaction === Faction.WARM, '冷色全员阵亡 → 暖色胜')

// ── 顺手牵羊日志 / 屯田归属 / 恃才询问 / AI 出牌顺序 ──
function fixedPairState(ids: string[], seed = 9100) {
    const st = createPairMatch(Faction.COOL, seed, false)
    const defs = ids.map((id) => getGeneralById(id)!)
    st.pairPick!.pools = defs.map((def) => [def])
    st.pairPick!.picked = defs.map((def) => def.id)
    setupPairPlay(st)
    return st
}

/** 把局面直接摆到某位角色的出牌阶段 */
function enterActionFor(st: ReturnType<typeof fixedPairState>, index: number): void {
    st.pendingResponseQueue = []
    st.negateWindow = undefined
    st.phase = GamePhase.PLAYING
    st.turnPhase = TurnPhase.ACTION
    st.activeGeneralIndex = index
    st.activePlayerFaction = st.generals[index].faction
    st.attackUsedThisTurn = 0
}

function probeCard(
    id: string, name: string, suit: CardSuit, value: number,
    category = CardCategory.BASIC, extra: Record<string, unknown> = {},
): Card {
    return { id, name, suit, value, category, ...extra } as Card
}

console.log('[欢乐成双：顺手牵羊日志写明拿到的牌]')
const stealLogState = fixedPairState(['xuyou', 'dengai', 'liubei', 'mizhu'], 9101)
enterActionFor(stealLogState, 0)
stealLogState.generals[0].hand = [
    probeCard('probe_steal', TrickCardName.STEAL, CardSuit.SPADE, 3, CardCategory.TRICK,
        { trickType: TrickType.INSTANT }),
]
stealLogState.generals[1].hand = [probeCard('probe_wine', 'wine', CardSuit.CLUB, 9)]
const stealUse = handleUseCard(stealLogState, HUMAN_PLAYER_ID, {
    cardId: 'probe_steal', targetIndices: [1],
} as any)
assert(!stealUse || !('error' in stealUse), '顺手牵羊可以正常使用')
if (stealLogState.negateWindow) negateWindowTimeout(stealLogState)
handleRespond(stealLogState, HUMAN_PLAYER_ID, { action: 'hand', cardId: 'probe_wine' } as any)
assert(stealLogState.log.some((l) => l.text.includes('从【界邓艾】处拿了一张手牌♣9【酒】')),
    '日志写明拿到的牌名、花色与点数')

console.log('[欢乐成双：屯田的回合归属]')
const tuntianState = fixedPairState(['xuyou', 'dengai', 'liubei', 'mizhu'], 9102)
enterActionFor(tuntianState, 1) // 界邓艾的回合
const tuntianDengai = tuntianState.generals[1]
while (tuntianDengai.hand.length < 5) {
    tuntianDengai.hand.push(probeCard(`probe_filler_${tuntianDengai.hand.length}`, 'attack', CardSuit.SPADE, 7))
}
syncCardState(tuntianState) // 界面刷新，建立“失去牌”基线
handleEndTurn(tuntianState, AI_PLAYER_ID)
handleDiscard(tuntianState, AI_PLAYER_ID, [tuntianDengai.hand[0].id])
assert(tuntianState.activeGeneralIndex === 2, '弃牌后回合交给刘备')
syncCardState(tuntianState) // 下一回合的界面刷新
const tuntianPrompts = tuntianState.pendingResponseQueue
    .filter((p) => (p.context as any)?.skillId === 'dengai_tuntian')
assert(tuntianPrompts.length === 0, '自己回合内弃掉的牌不会被当成回合外失去牌（屯田不该触发）')

const tuntianState2 = fixedPairState(['xuyou', 'dengai', 'liubei', 'mizhu'], 9103)
enterActionFor(tuntianState2, 2) // 刘备的回合
syncCardState(tuntianState2)
tuntianState2.generals[1].hand.splice(0, 1) // 回合外被顺走一张牌
syncCardState(tuntianState2)
assert(tuntianState2.pendingResponseQueue.some((p) => (p.context as any)?.skillId === 'dengai_tuntian'),
    '其他人的回合里失去牌仍然询问屯田')

console.log('[欢乐成双：恃才首次使用锦囊]')
const shicaiState = fixedPairState(['xuyou', 'dengai', 'liubei', 'mizhu'], 9104)
enterActionFor(shicaiState, 0)
shicaiState.generals[0].usedCardCategories = []
shicaiState.generals[0].hand = [
    probeCard('probe_draw_two', TrickCardName.DRAW_TWO, CardSuit.SPADE, 8, CardCategory.TRICK,
        { trickType: TrickType.INSTANT }),
]
const shicaiUse = handleUseCard(shicaiState, HUMAN_PLAYER_ID, {
    cardId: 'probe_draw_two', targetIndices: [0],
} as any)
assert(!shicaiUse || !('error' in shicaiUse), '无中生有可以正常使用')
if (shicaiState.negateWindow) negateWindowTimeout(shicaiState)
assert(shicaiState.pendingResponseQueue.some((p) => (p.context as any)?.skillId === 'xuyou_shicai'),
    '本回合第一次使用锦囊时询问恃才')
assert(shicaiState.log.some((l) => l.text.includes('可发动【恃才】')), '日志记录恃才询问')

console.log('[欢乐成双：AI 酒杀与延时锦囊目标]')
const aiOrder = fixedPairState(['xuyou', 'dengai', 'liubei', 'mizhu'], 9105)
enterActionFor(aiOrder, 1) // 界邓艾（暖色 AI）的回合
const aiDengai = aiOrder.generals[1]
const aiTarget = aiOrder.generals[0]
aiDengai.hand = [
    probeCard('probe_ai_wine', 'wine', CardSuit.CLUB, 9),
    probeCard('probe_ai_slash', 'thunder_slash', CardSuit.SPADE, 8),
    probeCard('probe_ai_supply', TrickCardName.SUPPLY_SHORTAGE, CardSuit.CLUB, 4, CardCategory.TRICK,
        { trickType: TrickType.DELAYED }),
]
aiTarget.hp = 3
aiTarget.hand = []
aiTarget.equip.armor = undefined
aiOrder.generals[3].hand = [
    probeCard('probe_mizhu_1', 'dodge', CardSuit.HEART, 2),
    probeCard('probe_mizhu_2', 'dodge', CardSuit.HEART, 3),
]
const optionKeys = listPlayOptions(aiOrder, AI_PLAYER_ID).map((o) => o.key)
assert(optionKeys.includes('wine'),
    `空手无防具的目标面前会先喝酒（3 点体力也值得，实际选项 ${optionKeys.join('/')}）`)

aiTarget.hp = 2
const optionKeys2 = listPlayOptions(aiOrder, AI_PLAYER_ID).map((o) => o.key)
assert(optionKeys2.includes('wine'), '酒杀可以致死时先喝酒')
assert(!optionKeys2.includes('supply_shortage'), '不会给可能被击杀的目标贴兵粮寸断')

console.log('[欢乐成双：火攻的展示询问]')
const fireState = fixedPairState(['xuyou', 'dengai', 'liubei', 'mizhu'], 9106)
enterActionFor(fireState, 0)
fireState.generals[0].hand = [
    probeCard('probe_fire', TrickCardName.FIRE_ATTACK, CardSuit.HEART, 2, CardCategory.TRICK,
        { trickType: TrickType.INSTANT }),
    probeCard('probe_fire_suit', 'attack', CardSuit.HEART, 7),
]
fireState.generals[1].hand = [probeCard('probe_fire_victim', 'dodge', CardSuit.HEART, 5)]
const fireUse = handleUseCard(fireState, HUMAN_PLAYER_ID, {
    cardId: 'probe_fire', targetIndices: [1],
} as any)
assert(!fireUse || !('error' in fireUse), '火攻可以正常使用')
if (fireState.negateWindow) negateWindowTimeout(fireState)
const firePrompt = fireState.pendingResponseQueue[0]
assert(firePrompt?.type === ResponseType.FIRE_ATTACK_SHOW
    && firePrompt.targetGeneralIndex === 1
    && (firePrompt.context as any)?.stage === 'show',
    '火攻先询问目标展示一张手牌')
handleRespond(fireState, AI_PLAYER_ID, { cardId: 'probe_fire_victim' } as any)
const fireDiscardPrompt = fireState.pendingResponseQueue[0]
assert(fireDiscardPrompt?.type === ResponseType.FIRE_ATTACK_SHOW
    && fireDiscardPrompt.targetGeneralIndex === 0
    && (fireDiscardPrompt.context as any)?.stage === 'discard',
    '展示后由使用者选择是否弃同花色牌')

console.log('[欢乐成双：麒麟弓两匹马]')
{
    const kb = fixedPairState(['shamoke', 'chengpu_jie', 'liubei', 'mizhu'], 9107)
    enterActionFor(kb, 0)
    const smk = kb.generals[0]
    const cp = kb.generals[1]
    smk.equip.weapon = probeCard('kb-bow', EquipmentCardName.KYLIN_BOW, CardSuit.HEART, 5,
        CardCategory.EQUIPMENT, { equipSlot: EquipSlot.WEAPON, attackRange: 5 })
    cp.equip.minus_horse = probeCard('kb-minus', EquipmentCardName.MINUS_HORSE, CardSuit.SPADE, 5,
        CardCategory.EQUIPMENT, { equipSlot: EquipSlot.MINUS_HORSE })
    cp.equip.plus_horse = probeCard('kb-plus', EquipmentCardName.PLUS_HORSE, CardSuit.SPADE, 6,
        CardCategory.EQUIPMENT, { equipSlot: EquipSlot.PLUS_HORSE })
    smk.hand = [probeCard('kb-slash', BasicCardName.ATTACK, CardSuit.CLUB, 11)]
    kb.deck = Array.from({ length: 12 }, (_, i) =>
        probeCard('kbd' + i, BasicCardName.PEACH, CardSuit.CLUB, (i % 9) + 1))
    handleUseCard(kb, HUMAN_PLAYER_ID, { cardId: 'kb-slash', targetIndices: [1] } as any)
    handleRespond(kb, AI_PLAYER_ID, { action: 'decline' } as any)
    const bowPrompt = kb.pendingResponseQueue[0]
    assert(bowPrompt?.type === ResponseType.SKILL_ACTIVATE_CONFIRM
        && (bowPrompt.context as any)?.skillId === 'equip_kylin_bow',
        '两匹马时先询问是否发动麒麟弓')
    handleRespond(kb, HUMAN_PLAYER_ID, { action: 'confirm' } as any)
    const choicePrompt = kb.pendingResponseQueue[0]
    assert(choicePrompt?.type === ResponseType.EQUIP_KYLIN_BOW_CHOICE
        && choicePrompt.targetGeneralIndex === 0,
        '确认后由使用者选择弃哪匹马')
    handleRespond(kb, HUMAN_PLAYER_ID, { action: 'minus' } as any)
    assert(!cp.equip.minus_horse && !!cp.equip.plus_horse, '只弃掉所选的-1马')
    assert(cp.hp === 3, `被弃坐骑后仍然造成1点伤害（实际 ${cp.hp}）`)
}

console.log(failed === 0 ? '\n欢乐成双检查全部通过' : `\n欢乐成双检查失败 ${failed} 项`)
process.exit(failed === 0 ? 0 : 1)