/**
 * 单机引擎回归检查：npm run check --workspace=client
 * 全部用例使用固定随机种子，失败时退出码非 0。
 */
import {
    Faction, SeatRole, GamePhase, TurnPhase, CardSuit, CardCategory, ActionUnitType,
    BasicCardName, TrickCardName, EquipSlot, EquipmentCardName, ResponseType,
} from 'sgs3v3-shared'
import { createGeneralInstance, getHandLimit, toClientView } from './game-state'
import { getGeneralById, BRAWL_POOL_IDS, BALANCE_POOL_IDS, BALANCE_EXT_POOL_IDS, CLASSIC_POOL_IDS } from './generals'
import { POSITION_ROLE_BY_ID } from './position-roles'
import {
    dealDamage, handleRespond, handleUseCard, handleUseSkill, negateWindowTimeout, processAutoExecutePending,
    triggerJiangJieDiscard, triggerQingzheng, triggerShuzhiChoose, loseHp, syncCardState, triggerGoude,
    markDaili, triggerDaili, maybeZhuri, kingdomOf, maybePingjian, performSkillJudge, maybeHongyuan,
    maybeZongxuan,
} from './game-actions'
import { beginMatchLog } from './match-log'
import { createLocalMatch, localDeployGenerals, HUMAN_PLAYER_ID, HUMAN2_PLAYER_ID, AI_PLAYER_ID } from './local-match'
import { createPairMatch, pairPickGeneral } from '../modes/HappyPair/pair-match'
import { createLandlordMatch, landlordPickGeneral } from '../modes/FightTheLandlord/landlord-match'
import { skillUseBlocked } from './skill-limit'
import {
    finishJudgePhaseAndContinue, handleEndTurn, finishTurn, chooseActionUnit, handleYieldChoice, handleDiscard,
    runTurnStart, enterDiscardPhaseOrSkip, beginActionPhase,
} from './turn-manager'
import { runSelfPlayGame } from './selfplay'
import { aiAct, aiDraft, aiRespond } from './local-ai'
import { atLeastOneChance, expectedSlashes, KEY_CARD_COUNTS } from './deck-meta'
import { ensureDeck } from './deck'
import { bestGiftTarget, cardFit, damageBackfire } from './ai-synergy'
import { analyzeStrategy } from './ai-strategy'
import { delayedSuccessChance, dodgeHoldValue, negateRisk, predictAoe, predictSlash, teamView } from './ai-forecast'
import { estimateAction, presetPriority, turnValueOf } from './ai-policy'
import { detectObjective } from './ai-objective'
import {
    enemyPlans, guessHand, handDodgeChance, knownHand, poolView, predictEnemyTurn, rememberCards,
    teamResource,
} from './ai-memory'
import {
    activeAbility, healthState, identityValue, passiveAbility, tauntPresetOf, tauntScore, tauntVector,
} from './ai-taunt'

let failures = 0

function check(name: string, ok: boolean, detail?: unknown): void {
    if (ok) {
        console.log(`  ok   ${name}`)
        return
    }
    failures++
    console.log(`  FAIL ${name}`)
    if (detail !== undefined) console.log('       ', detail)
}

function card(id: string, name: any, suit: CardSuit, value: number, category = CardCategory.BASIC, extra: any = {}) {
    return { id, name, suit, value, category, ...extra } as any
}

function build(humanIds: string[], aiIds: string[], seed = 7) {
    const state = createLocalMatch(Faction.WARM, seed)
    state.phase = GamePhase.PLAYING
    state.turnPhase = TurnPhase.ACTION
    state.deck = []
    const roles: any[] = [SeatRole.FLANK_A, SeatRole.COMMANDER, SeatRole.FLANK_B]
    state.generals = [
        ...aiIds.map((id, i) => createGeneralInstance(getGeneralById(id)!, AI_PLAYER_ID, Faction.COOL, roles[i])),
        ...humanIds.map((id, i) => createGeneralInstance(getGeneralById(id)!, HUMAN_PLAYER_ID, Faction.WARM, roles[i])),
    ]
    state.activeGeneralIndex = aiIds.length
    state.activePlayerFaction = Faction.WARM
    state.roundState = { roundNumber: 1, firstMover: Faction.WARM, currentActionStep: 3 }
    state.log = []
    return state
}

const queue = (state: any) => state.pendingResponseQueue.map((p: any) => p.type + '/' + ((p.context as any)?.skillId ?? ''))
const findPending = (state: any, skillId: string) =>
    state.pendingResponseQueue.find((p: any) => (p.context as any)?.skillId === skillId)

console.log('[洛书池武将]')
{
    const ids = BRAWL_POOL_IDS
    const missing = ids.filter((id) => !getGeneralById(id))
    check('池内武将均有定义', missing.length === 0, missing)
    check('池内无重复', new Set(ids).size === ids.length)
    const unregistered = ids.filter((id) => !POSITION_ROLE_BY_ID[id])
    check('池内武将均有定位', unregistered.length === 0, unregistered)
    check('界版已替换洛书池旧版',
        ids.includes('jushou_jie') && ids.includes('lusu_jie') && ids.includes('guanyu_jie'))
}

console.log('[统率三军将池]')
{
    check('平衡版为 40 人', BALANCE_POOL_IDS.length === 40, BALANCE_POOL_IDS.length)
    check('平衡扩展版为 60 人', BALANCE_EXT_POOL_IDS.length === 60, BALANCE_EXT_POOL_IDS.length)
    for (const [label, ids] of [['平衡版', BALANCE_POOL_IDS], ['平衡扩展版', BALANCE_EXT_POOL_IDS]] as const) {
        check(`${label}无重复`, new Set(ids).size === ids.length)
        check(`${label}武将均有定义`, ids.every((id) => !!getGeneralById(id)),
            ids.filter((id) => !getGeneralById(id)))
        check(`${label}武将均有定位`, ids.every((id) => !!POSITION_ROLE_BY_ID[id]),
            ids.filter((id) => !POSITION_ROLE_BY_ID[id]))
    }
    check('司马朗已移出将池', !BALANCE_EXT_POOL_IDS.includes('simalang')
        && !BRAWL_POOL_IDS.includes('simalang'))
    check('蒋琬-竞已加入乱斗版', BRAWL_POOL_IDS.includes('jiangwan_jing'))
}

console.log('[螽集]')
{
    const s = build(['zhangmancheng', 'huatuo', 'sunquan'], ['caocao', 'guojia', 'zhenji'], 71)
    const zm = s.generals[3]
    zm.hand = [card('zj1', TrickCardName.DRAW_TWO, CardSuit.SPADE, 7, CardCategory.TRICK, { trickType: 'instant' })]
    s.deck = Array.from({ length: 10 }, (_, i) =>
        card('zd' + i, BasicCardName.PEACH, CardSuit.HEART, (i % 9) + 1))
    handleUseCard(s, HUMAN_PLAYER_ID, { cardId: 'zj1', targetIndices: [] } as any)
    negateWindowTimeout(s)
    // 使用时触发：摸至体力上限 4 张、弃 1 张（余 3），随后无中生有再摸 2 张
    check('无同花色手牌时摸至体力上限并弃一张',
        zm.hand.length === zm.maxHp + 1, `${zm.hand.length}/${zm.maxHp}`)
}

console.log('[通用状态位：护甲/手牌上限/翻面]')
{
    // 护甲先抵扣伤害：完全吸收时体力不变
    const s = build(['sunquan', 'huatuo', 'caocao'], ['guojia', 'zhenji', 'xiahoudun'], 72)
    const armored = s.generals[1]
    armored.armorPoints = 2
    const hpBefore = armored.hp
    dealDamage(s, s.generals[0], armored, 1)
    check('护甲吸收伤害且不扣体力',
        armored.hp === hpBefore && armored.armorPoints === 1, `${armored.hp}/${armored.armorPoints}`)
    dealDamage(s, s.generals[0], armored, 2)
    check('护甲被打穿后剩余伤害扣体力',
        armored.hp === hpBefore - 1 && armored.armorPoints === 0, `${armored.hp}/${armored.armorPoints}`)
    dealDamage(s, s.generals[0], armored, 1)
    check('护甲清零后伤害正常结算', armored.hp === hpBefore - 2, armored.hp)
    armored.armorPoints = 3
    const view = toClientView(s, HUMAN_PLAYER_ID)
    check('护甲进入客户端视图', (view.generals[1] as any).armorPoints === 3,
        (view.generals[1] as any).armorPoints)

    // 手牌上限：永久修正与回合级修正叠加
    const h = build(['sunquan', 'huatuo', 'caocao'], ['guojia', 'zhenji', 'xiahoudun'], 73)
    const lim = h.generals[1]
    lim.hp = 4
    lim.maxHp = 4
    lim.handLimitDelta = 0
    check('无修正时上限等于体力值', getHandLimit(lim) === 4, getHandLimit(lim))
    lim.handLimitPenalty = 2
    check('永久上限修正生效', getHandLimit(lim) === 2, getHandLimit(lim))
    lim.handLimitDelta = 1
    check('回合级修正与永久修正叠加', getHandLimit(lim) === 3, getHandLimit(lim))
    lim.handLimitPenalty = 5
    check('上限不会被压到负数', getHandLimit(lim) === 0, getHandLimit(lim))

    // 翻面：背面朝上的角色在回合开始时翻回正面并跳过整个回合
    const f = build(['sunquan', 'huatuo', 'caocao'], ['guojia', 'zhenji', 'xiahoudun'], 74)
    const flipped = f.generals[1]
    flipped.flipped = true
    f.activeGeneralIndex = 1
    runTurnStart(f)
    const stillFlipped = flipped.flipped as boolean
    check('背面朝上跳过回合并翻回正面',
        stillFlipped === false && flipped.hasActed === true, `${stillFlipped}/${flipped.hasActed}`)

    // 狭援（谋于禁）：护甲被打穿后，弃两张手牌令目标重新获得护甲
    const y = build(['yujin_mou', 'huatuo', 'sunquan'], ['guojia', 'zhenji', 'xiahoudun'], 75)
    const xiayuanOwner = y.generals[3]
    const xyAlly = y.generals[4]
    xiayuanOwner.hand = [
        card('yj1', BasicCardName.ATTACK, CardSuit.SPADE, 3),
        card('yj2', BasicCardName.ATTACK, CardSuit.SPADE, 4),
        card('yj3', BasicCardName.DODGE, CardSuit.HEART, 5),
    ]
    xyAlly.armorPoints = 2
    const xyHp = xyAlly.hp
    dealDamage(y, y.generals[0], xyAlly, 3)
    check('护甲被打穿后询问狭援', !!findPending(y, 'yujin_mou_xiayuan'), queue(y))
    check('打穿护甲后剩余伤害照常扣体力', xyAlly.hp === xyHp - 1 && xyAlly.armorPoints === 0,
        `${xyAlly.hp}/${xyAlly.armorPoints}`)
    {
        const ask = findPending(y, 'yujin_mou_xiayuan')
        if (ask) {
            y.pendingResponseQueue = [ask]
            const handBefore = xiayuanOwner.hand.length
            handleRespond(y, HUMAN_PLAYER_ID, { action: 'confirm' } as any)
            check('狭援补回失去的护甲', xyAlly.armorPoints === 2, xyAlly.armorPoints)
            check('狭援弃置两张手牌', xiayuanOwner.hand.length === handBefore - 2,
                `${handBefore} -> ${xiayuanOwner.hand.length}`)
            check('狭援记录本轮已发动', xiayuanOwner.xiayuanRound === y.roundState?.roundNumber,
                `${xiayuanOwner.xiayuanRound}/${y.roundState?.roundNumber}`)
        }
    }

    // 节钺（谋于禁）：结束阶段令其他角色获得护甲
    const jy = build(['yujin_mou', 'huatuo', 'sunquan'], ['guojia', 'zhenji', 'xiahoudun'], 76)
    jy.generals[4].hp = 2
    jy.generals[4].hand = [card('jyg', BasicCardName.PEACH, CardSuit.HEART, 3)]
    handleEndTurn(jy, HUMAN_PLAYER_ID)
    check('结束阶段询问节钺', !!findPending(jy, 'yujin_mou_jieyue'), queue(jy))
    {
        const ask = findPending(jy, 'yujin_mou_jieyue')
        if (ask) {
            jy.pendingResponseQueue = [ask]
            handleRespond(jy, HUMAN_PLAYER_ID, { action: 'confirm' } as any)
            check('节钺令目标获得1点护甲', (jy.generals[4].armorPoints ?? 0) === 1,
                jy.generals[4].armorPoints)
            check('节钺收回目标一张牌', jy.generals[3].hand.some((c: any) => c.id === 'jyg'),
                jy.generals[3].hand.map((c: any) => c.id))
        }
    }

    // 流矢 / 斩腕（曹性）
    const cx = build(['caoxing', 'huatuo', 'sunquan'], ['guojia', 'zhenji', 'xiahoudun'], 77)
    const caoxing = cx.generals[3]
    const lsVictim = cx.generals[0]
    caoxing.hand = [
        card('ls-heart', BasicCardName.DODGE, CardSuit.HEART, 5),
        card('ls-other', BasicCardName.ATTACK, CardSuit.SPADE, 6),
    ]
    cx.deck = [card('ls-top', BasicCardName.PEACH, CardSuit.CLUB, 3)]
    const lsRes = handleUseSkill(cx, HUMAN_PLAYER_ID, {
        skillId: 'caoxing_liushi', cardIds: ['ls-heart'], targetIndices: [0],
    } as any)
    check('流矢可以发动', !(lsRes && 'error' in lsRes), lsRes)
    check('流矢把♥牌置于牌堆顶', cx.deck[0]?.id === 'ls-heart', cx.deck.map((c: any) => c.id).slice(0, 2))
    handleRespond(cx, AI_PLAYER_ID, {} as any)
    check('流矢造成伤害后目标手牌上限-1', lsVictim.handLimitPenalty === 1, lsVictim.handLimitPenalty)
    check('曹性记录流矢上限惩罚', lsVictim.liushiPenalty === 1, lsVictim.liushiPenalty)

    // 斩腕：目标弃牌阶段弃过牌 → 曹性摸等量牌并恢复上限
    cx.deck = Array.from({ length: 6 }, (_, i) => card('zwd' + i, BasicCardName.PEACH, CardSuit.CLUB, (i % 9) + 1))
    lsVictim.discardedHandThisPhase = 2
    cx.activeGeneralIndex = 0
    cx.activePlayerFaction = Faction.COOL
    cx.turnPhase = TurnPhase.DISCARD
    const cxHandBefore = caoxing.hand.length
    finishTurn(cx)
    check('斩腕令曹性摸等量牌', caoxing.hand.length === cxHandBefore + 2,
        `${cxHandBefore} -> ${caoxing.hand.length}`)
    check('斩腕恢复因流矢减少的上限',
        (lsVictim.handLimitPenalty ?? 0) === 0 && (lsVictim.liushiPenalty ?? 0) === 0,
        `${lsVictim.handLimitPenalty}/${lsVictim.liushiPenalty}`)

    // 魄袭（神甘宁）：目标手里凑齐四花色 → 自己一张没弃 → 减1点体力上限
    const px = build(['ganning_shen', 'huatuo', 'sunquan'], ['guojia', 'zhenji', 'xiahoudun'], 78)
    const poxi = px.generals[3]
    const poxiVictim = px.generals[0]
    poxi.hand = [
        card('px1', BasicCardName.ATTACK, CardSuit.SPADE, 3),
        card('px2', BasicCardName.DODGE, CardSuit.HEART, 4),
    ]
    poxiVictim.hand = [
        card('pv1', BasicCardName.ATTACK, CardSuit.SPADE, 5),
        card('pv2', BasicCardName.DODGE, CardSuit.CLUB, 6),
        card('pv3', BasicCardName.PEACH, CardSuit.DIAMOND, 7),
        card('pv4', BasicCardName.WINE, CardSuit.HEART, 8),
    ]
    const poxiMax = poxi.maxHp
    const poxiRes = handleUseSkill(px, HUMAN_PLAYER_ID, {
        skillId: 'ganning_shen_poxi', cardIds: [], targetIndices: [0],
    } as any)
    check('魄袭可以发动', !(poxiRes && 'error' in poxiRes), poxiRes)
    check('魄袭从目标手中凑齐四花色', poxiVictim.hand.length === 0, poxiVictim.hand.length)
    check('自己未被弃牌时减1点体力上限', poxi.maxHp === poxiMax - 1, `${poxiMax} -> ${poxi.maxHp}`)

    // 悲歌（界蔡文姬）：受到【杀】伤害后判定，♦令受伤者摸两张
    // 受害者用曹操：郭嘉有【天妒】会把判定牌也拿走，干扰断言
    const bg = build(['caiwenji_jie', 'sunquan', 'huatuo'], ['caocao', 'zhenji', 'xiahoudun'], 79)
    const beigeOwner = bg.generals[3]
    const beigeVictim = bg.generals[0]
    beigeOwner.hand = [card('bg1', BasicCardName.ATTACK, CardSuit.SPADE, 3)]
    bg.deck = [
        card('bg-judge', BasicCardName.DODGE, CardSuit.DIAMOND, 5),
        card('bg-d1', BasicCardName.PEACH, CardSuit.CLUB, 1),
        card('bg-d2', BasicCardName.PEACH, CardSuit.CLUB, 2),
    ]
    dealDamage(bg, bg.generals[4], beigeVictim, 1, 'slash-x', { fromSlash: true })
    const beigeAsk = findPending(bg, 'caiwenji_jie_beige')
    check('受到杀伤害后询问悲歌', !!beigeAsk, queue(bg))
    if (beigeAsk) {
        bg.pendingResponseQueue = [beigeAsk]
        handleRespond(bg, HUMAN_PLAYER_ID, { action: 'confirm' } as any)
        check('悲歌令受伤者摸两张（判定♦）', beigeVictim.hand.length === 2,
            beigeVictim.hand.map((c: any) => c.id))
        check('悲歌发动者弃置一张牌', beigeOwner.hand.length === 0,
            beigeOwner.hand.map((c: any) => c.id))
    }

    // 奋激（周泰）：他人失去手牌后，失去1点体力令其摸两张
    const fj = build(['sunquan', 'huatuo', 'zhoutai'], ['guojia', 'zhenji', 'xiahoudun'], 80)
    const zhoutai = fj.generals[5]
    const fjVictim = fj.generals[0]
    fjVictim.hand = []
    fj.deck = [
        card('fj-d1', BasicCardName.PEACH, CardSuit.CLUB, 1),
        card('fj-d2', BasicCardName.PEACH, CardSuit.CLUB, 2),
    ]
    const ztHp = zhoutai.hp
    fj.pendingResponseQueue = [{
        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
        targetGeneralIndex: 5,
        context: { skillId: 'zhoutai_fenji', skillName: '奋激', fenjiVictimIndex: 0 },
    }]
    handleRespond(fj, HUMAN_PLAYER_ID, { action: 'confirm' } as any)
    check('奋激失去1点体力', zhoutai.hp === ztHp - 1, `${ztHp} -> ${zhoutai.hp}`)
    check('奋激令失去手牌的角色摸两张', fjVictim.hand.length === 2,
        fjVictim.hand.map((c: any) => c.id))

    // 诛害（界徐庶）：造成过伤害的角色结束阶段，界徐庶可对其使用一张【杀】
    const zh = build(['sunquan', 'huatuo', 'xushu'], ['guojia', 'zhenji', 'xiahoudun'], 81)
    zh.activeGeneralIndex = 0
    zh.activePlayerFaction = Faction.COOL
    zh.generals[0].damageDealtThisTurn = 1
    zh.turnPhase = TurnPhase.DISCARD
    zh.deck = [card('zh-d', BasicCardName.PEACH, CardSuit.CLUB, 1)]
    finishTurn(zh)
    check('造成伤害的角色结束阶段询问诛害', !!findPending(zh, 'xushu_zhuhai'), queue(zh))

    // 龙吟（关平）：其他角色使用【杀】时弃一张牌，令此【杀】不计入次数
    const ly = build(['sunquan', 'guanping', 'huatuo'], ['guojia', 'zhenji', 'xiahoudun'], 82)
    const lyUser = ly.generals[3]
    const guanping = ly.generals[4]
    lyUser.hand = [card('ly-slash', BasicCardName.ATTACK, CardSuit.HEART, 7)]
    guanping.hand = [card('ly-cost', BasicCardName.ATTACK, CardSuit.SPADE, 3)]
    ly.deck = [card('ly-draw', BasicCardName.PEACH, CardSuit.CLUB, 1)]
    handleUseCard(ly, HUMAN_PLAYER_ID, { cardId: 'ly-slash', targetIndices: [2] } as any)
    check('使用【杀】时询问龙吟', !!findPending(ly, 'guanping_longyin'), queue(ly))
    {
        const ask = findPending(ly, 'guanping_longyin')
        if (ask) {
            ly.pendingResponseQueue = [ask]
            const usedBefore = ly.attackUsedThisTurn
            handleRespond(ly, HUMAN_PLAYER_ID, { action: 'confirm' } as any)
            check('龙吟让此【杀】不计入次数', ly.attackUsedThisTurn === usedBefore - 1,
                `${usedBefore} -> ${ly.attackUsedThisTurn}`)
            check('红色【杀】令关平摸一张', guanping.hand.some((c: any) => c.id === 'ly-draw'),
                guanping.hand.map((c: any) => c.id))
        }
    }

    // 承诏（董承）：本回合获得过两张牌，结束阶段拼点
    const cc = build(['dongcheng', 'huatuo', 'sunquan'], ['guojia', 'zhenji', 'xiahoudun'], 83)
    const dongcheng = cc.generals[3]
    dongcheng.gainedCardsThisTurn = 2
    dongcheng.hand = [card('cc1', BasicCardName.ATTACK, CardSuit.SPADE, 9)]
    cc.generals[0].hand = [card('cc2', BasicCardName.DODGE, CardSuit.HEART, 3)]
    cc.turnPhase = TurnPhase.DISCARD
    finishTurn(cc)
    check('本回合获得两张牌时询问承诏', !!findPending(cc, 'dongcheng_chengzhao'), queue(cc))
    {
        const ask = findPending(cc, 'dongcheng_chengzhao')
        if (ask) {
            cc.pendingResponseQueue = [ask]
            handleRespond(cc, HUMAN_PLAYER_ID, { action: 'confirm' } as any)
            check('承诏确认后进入拼点',
                queue(cc).some((q: string) => q.startsWith('skill_pick_card')), queue(cc))
        }
    }

    // 不屈（周泰）：濒死时翻出“创”，点数不重复则回复至1点体力；有“创”时手牌上限等于“创”数
    const bq = build(['sunquan', 'huatuo', 'zhoutai'], ['guojia', 'zhenji', 'xiahoudun'], 84)
    const buqu = bq.generals[5]
    buqu.hp = 1
    bq.deck = [
        card('bq1', BasicCardName.ATTACK, CardSuit.SPADE, 7),
        card('bq2', BasicCardName.PEACH, CardSuit.CLUB, 1),
    ]
    dealDamage(bq, bq.generals[0], buqu, 2)
    check('不屈翻出“创”并回复至1点体力',
        buqu.hp === 1 && (buqu.generalPile?.length ?? 0) === 1,
        `${buqu.hp}/${buqu.generalPile?.length}`)
    check('有“创”时手牌上限等于“创”数', getHandLimit(buqu) === 1, getHandLimit(buqu))

    // 劫营（神甘宁）：回合开始获得“营”，结束阶段交给其他角色
    const jy2 = build(['ganning_shen', 'huatuo', 'sunquan'], ['guojia', 'zhenji', 'xiahoudun'], 86)
    const jieying = jy2.generals[3]
    jy2.activeGeneralIndex = 3
    jy2.deck = Array.from({ length: 10 }, (_, i) =>
        card('jy-d' + i, BasicCardName.PEACH, CardSuit.CLUB, (i % 9) + 1))
    runTurnStart(jy2)
    check('劫营回合开始获得“营”', jieying.yingMark === true, jieying.yingMark)
    jy2.pendingResponseQueue = []
    jy2.turnPhase = TurnPhase.DISCARD
    finishTurn(jy2)
    const jyAsk = jy2.pendingResponseQueue.find((p: any) =>
        (p.context as any)?.skillId === 'ganning_shen_jieying_give')
    check('劫营结束阶段询问是否交出“营”', !!jyAsk, queue(jy2))
    if (jyAsk) {
        jy2.pendingResponseQueue = [jyAsk]
        handleRespond(jy2, HUMAN_PLAYER_ID, { action: 'confirm', targetIndex: 0 } as any)
        check('劫营确认后把“营”交给选定的角色',
            !jieying.yingMark && !!jy2.generals[0].yingMark,
            jy2.generals.map((g: any) => `${g.generalId}:${!!g.yingMark}`))
    }

    // 克己（界吕蒙）：本回合未出杀则跳过弃牌阶段
    const lvNoSlash = build(['lvmeng_jie', 'huatuo', 'sunquan'], ['guojia', 'zhenji', 'xiahoudun'], 87)
    const lvNo = lvNoSlash.generals[3]
    lvNo.hp = 3
    lvNo.hand = Array.from({ length: 6 }, (_, i) =>
        card('lv' + i, BasicCardName.PEACH, CardSuit.CLUB, (i % 9) + 1))
    lvNoSlash.attackUsedThisTurn = 0
    lvNoSlash.turnPhase = TurnPhase.ACTION
    enterDiscardPhaseOrSkip(lvNoSlash, lvNo)
    const lvNoPhase = lvNoSlash.turnPhase as TurnPhase
    check('克己在未出杀时跳过弃牌阶段', lvNoPhase !== TurnPhase.DISCARD, lvNoPhase)
    const lvSlash = build(['lvmeng_jie', 'huatuo', 'sunquan'], ['guojia', 'zhenji', 'xiahoudun'], 87)
    const lvYes = lvSlash.generals[3]
    lvYes.hp = 3
    lvYes.hand = lvNo.hand.map((c: any) => ({ ...c }))
    lvSlash.attackUsedThisTurn = 1
    lvSlash.turnPhase = TurnPhase.ACTION
    enterDiscardPhaseOrSkip(lvSlash, lvYes)
    const lvSlashPhase = lvSlash.turnPhase as TurnPhase
    check('出过杀时不触发克己', lvSlashPhase === TurnPhase.DISCARD, lvSlashPhase)

    // 勤学（界吕蒙）：结束阶段手牌数减体力值≥2 → 减1点上限、摸两张、获得攻心
    const qx = build(['lvmeng_jie', 'huatuo', 'sunquan'], ['guojia', 'zhenji', 'xiahoudun'], 88)
    const qxmeng = qx.generals[3]
    qxmeng.hp = 2
    qxmeng.maxHp = 4
    qxmeng.hand = Array.from({ length: 5 }, (_, i) =>
        card('qx' + i, BasicCardName.PEACH, CardSuit.CLUB, (i % 9) + 1))
    qx.deck = Array.from({ length: 6 }, (_, i) =>
        card('qxd' + i, BasicCardName.PEACH, CardSuit.HEART, (i % 9) + 1))
    qx.turnPhase = TurnPhase.TURN_END
    finishTurn(qx)
    check('勤学觉醒减1点体力上限', qxmeng.maxHp === 3, `${qxmeng.maxHp}`)
    {
        const qxAsk = findPending(qx, 'lvmeng_jie_qinxue')
        check('勤学觉醒后进入结算询问', !!qxAsk, queue(qx))
        if (qxAsk) {
            qx.pendingResponseQueue = [qxAsk]
            handleRespond(qx, HUMAN_PLAYER_ID, { action: 'confirm' } as any)
            check('勤学觉醒摸两张', qxmeng.hand.length === 7, qxmeng.hand.length)
            check('勤学觉醒获得攻心',
                (qxmeng.acquiredSkills ?? []).includes('lvmeng_jie_gongxin'), qxmeng.acquiredSkills)
        }
    }

    // 攻心（界吕蒙·觉醒后）：观看手牌并弃置其中一张♥
    const gx = build(['lvmeng_jie', 'huatuo', 'sunquan'], ['guojia', 'zhenji', 'xiahoudun'], 89)
    const gxmeng = gx.generals[3]
    gxmeng.acquiredSkills = ['lvmeng_jie_gongxin']
    gx.generals[0].hand = [
        card('gxh', BasicCardName.DODGE, CardSuit.HEART, 5),
        card('gxs', BasicCardName.ATTACK, CardSuit.SPADE, 6),
    ]
    const gxRes = handleUseSkill(gx, HUMAN_PLAYER_ID, {
        skillId: 'lvmeng_jie_gongxin', cardIds: [], targetIndices: [0],
    } as any)
    check('攻心可以发动', !(gxRes && 'error' in gxRes), gxRes)
    check('攻心弃置目标一张♥',
        !gx.generals[0].hand.some((c: any) => c.suit === CardSuit.HEART),
        gx.generals[0].hand.map((c: any) => c.id))

    // 博图（界吕蒙）：本回合置入弃牌堆的牌包含四种花色，回合结束时执行一个额外回合
    const bt = build(['lvmeng_jie', 'huatuo', 'sunquan'], ['guojia', 'zhenji', 'xiahoudun'], 90)
    const botumeng = bt.generals[3]
    bt.activeGeneralIndex = 3
    bt.activePlayerFaction = Faction.WARM
    bt.turnPhase = TurnPhase.TURN_END
    botumeng.discardBaseline = []
    bt.discard = [
        card('bt1', BasicCardName.ATTACK, CardSuit.SPADE, 7),
        card('bt2', BasicCardName.DODGE, CardSuit.HEART, 2),
        card('bt3', BasicCardName.ATTACK, CardSuit.CLUB, 8),
        card('bt4', BasicCardName.DODGE, CardSuit.DIAMOND, 9),
    ]
    finishTurn(bt)
    check('凑齐四种花色时询问博图', !!findPending(bt, 'lvmeng_jie_botu'), queue(bt))
    {
        const ask = findPending(bt, 'lvmeng_jie_botu')
        if (ask) {
            bt.pendingResponseQueue = [ask]
            handleRespond(bt, HUMAN_PLAYER_ID, { action: 'confirm' } as any)
            check('博图确认后由本人获得额外回合', bt.activeGeneralIndex === 3, bt.activeGeneralIndex)
            check('博图本轮发动次数+1', botumeng.botuUses === 1, botumeng.botuUses)
        }
    }
    const bt3 = build(['lvmeng_jie', 'huatuo', 'sunquan'], ['guojia', 'zhenji', 'xiahoudun'], 91)
    const botumeng3 = bt3.generals[3]
    bt3.activeGeneralIndex = 3
    bt3.activePlayerFaction = Faction.WARM
    bt3.turnPhase = TurnPhase.TURN_END
    botumeng3.discardBaseline = []
    bt3.discard = [
        card('bt3-1', BasicCardName.ATTACK, CardSuit.SPADE, 7),
        card('bt3-2', BasicCardName.DODGE, CardSuit.HEART, 2),
        card('bt3-3', BasicCardName.ATTACK, CardSuit.CLUB, 8),
    ]
    finishTurn(bt3)
    check('花色不足四种时不询问博图', !findPending(bt3, 'lvmeng_jie_botu'), queue(bt3))
    const bt4 = build(['lvmeng_jie', 'huatuo', 'sunquan'], ['guojia', 'zhenji', 'xiahoudun'], 92)
    const botumeng4 = bt4.generals[3]
    bt4.activeGeneralIndex = 3
    bt4.activePlayerFaction = Faction.WARM
    bt4.turnPhase = TurnPhase.TURN_END
    botumeng4.discardBaseline = []
    botumeng4.botuRound = bt4.roundState?.roundNumber
    botumeng4.botuUses = 3
    bt4.discard = [
        card('bt4-1', BasicCardName.ATTACK, CardSuit.SPADE, 7),
        card('bt4-2', BasicCardName.DODGE, CardSuit.HEART, 2),
        card('bt4-3', BasicCardName.ATTACK, CardSuit.CLUB, 8),
        card('bt4-4', BasicCardName.DODGE, CardSuit.DIAMOND, 9),
    ]
    finishTurn(bt4)
    check('本轮已达次数上限时不询问博图', !findPending(bt4, 'lvmeng_jie_botu'), queue(bt4))
}

console.log('[随机种子]')
{
    const a = createLocalMatch(Faction.WARM, 20251023)
    const b = createLocalMatch(Faction.WARM, 20251023)
    const c = createLocalMatch(Faction.WARM, 424242)
    const ids = (s: any) => s.pickState.pool.map((g: any) => g.id).join(',')
    check('同种子选将池一致', ids(a) === ids(b))
    check('不同种子选将池不同', ids(a) !== ids(c))
    check('种子写入对局日志', a.log.some((l) => l.text.includes('20251023')), a.log.slice(0, 2))
}

console.log('[铁索连环]')
{
    const s = build(['sunquan', 'huatuo', 'caocao'], ['guojia', 'zhenji', 'xiahoudun'])
    s.generals[3].hand = [card('ic1', TrickCardName.IRON_CHAIN, CardSuit.SPADE, 3, CardCategory.TRICK, { trickType: 'instant' })]
    const res = handleUseCard(s, HUMAN_PLAYER_ID, { cardId: 'ic1', targetIndices: [] } as any)
    check('未选目标时拒绝使用', !!res && 'error' in res && res.error.includes('铁索连环'), res)
}
{
    const s = build(['sunquan', 'huatuo', 'caocao'], ['guojia', 'zhenji', 'xiahoudun'])
    s.generals[3].hand = [card('ic1', TrickCardName.IRON_CHAIN, CardSuit.SPADE, 3, CardCategory.TRICK, { trickType: 'instant' })]
    const res = handleUseCard(s, HUMAN_PLAYER_ID, { cardId: 'ic1', targetIndices: [0] } as any)
    check('指定目标后可以使用', !(res && 'error' in res), res)
    negateWindowTimeout(s)
    processAutoExecutePending(s)
    check('目标被横置', s.generals[0].chained === true, s.log.slice(-3))
}

console.log('[横置触发法恩]')
{
    // 陈群（暖方）在其他角色被铁索连环横置时应被询问法恩
    const s = build(['chenqun', 'sunquan', 'huatuo'], ['daqiao_jie', 'mizhu', 'sunquan'], 91)
    const dq = s.generals[0]
    dq.hand = [card('ic-fa', TrickCardName.IRON_CHAIN, CardSuit.CLUB, 3, CardCategory.TRICK, { trickType: 'instant' })]
    s.activeGeneralIndex = 0
    s.activePlayerFaction = Faction.COOL
    const res = handleUseCard(s, AI_PLAYER_ID, {
        cardId: 'ic-fa',
        targetIndices: [1, 4],
    } as any)
    check('铁索连环可以使用', !(res && 'error' in res), res)
    negateWindowTimeout(s)
    const faen = findPending(s, 'chenqun_faen')
    check('横置后询问陈群法恩', !!faen, queue(s))
    check('两名目标都已横置', s.generals[1].chained && s.generals[4].chained,
        s.generals.map((g) => `${g.generalId}:${g.chained}`))
}

console.log('[献图代价]')
{
    const s = build(['sunquan', 'zhangsong_jie', 'huatuo'], ['guojia', 'zhenji', 'xiahoudun'], 92)
    const sq = s.generals[3]
    const zs = s.generals[4]
    s.turnSerial = 7
    sq.damageDealtThisTurn = 2
    zs.xiantuTurn = 7
    zs.xiantuTargetIndex = 3
    zs.xiantuCount = 2
    zs.xiantuDamageBaseline = 1
    zs.hp = 3
    handleEndTurn(s, HUMAN_PLAYER_ID)
    processAutoExecutePending(s)
    check('献图代价失去1点体力', zs.hp === 2, zs.hp)
    check('献图结算后结束出牌阶段', s.activeGeneralIndex !== 3 || s.turnPhase !== TurnPhase.ACTION,
        `active=${s.activeGeneralIndex} phase=${s.turnPhase}`)
}

console.log('[距离修正]')
{
    const minusHorse = () => card('mh-x', EquipmentCardName.MINUS_HORSE, CardSuit.HEART, 5,
        CardCategory.EQUIPMENT, { equipSlot: EquipSlot.MINUS_HORSE })
    const plusHorse = () => card('ph-x', EquipmentCardName.PLUS_HORSE, CardSuit.SPADE, 5,
        CardCategory.EQUIPMENT, { equipSlot: EquipSlot.PLUS_HORSE })
    const slashInHand = () => [card('sl-x', BasicCardName.ATTACK, CardSuit.SPADE, 7)]

    // 基础距离 3、-1马：距离 2，提示里要看得到 -1马
    {
        const s = build(['sunquan', 'huatuo', 'caocao'], ['daqiao_jie', 'zhenji', 'xiahoudun'], 93)
        const sq = s.generals[3]
        sq.equip.minus_horse = minusHorse()
        sq.hand = slashInHand()
        const res = handleUseCard(s, HUMAN_PLAYER_ID, { cardId: 'sl-x', targetIndices: [0] } as any)
        check('提示包含基础距离与-1马',
            !!res && 'error' in res && res.error.includes('距离2（基础3，-1马-1）'), res)
    }

    // 用户报告的情况：基础距离 2、-1马 → 距离 1，可以出杀
    {
        const s = build(['sunquan', 'huatuo', 'caocao'], ['zhenji', 'daqiao_jie', 'xiahoudun'], 94)
        const sq = s.generals[3]
        sq.equip.minus_horse = minusHorse()
        sq.hand = slashInHand()
        const res = handleUseCard(s, HUMAN_PLAYER_ID, { cardId: 'sl-x', targetIndices: [1] } as any)
        check('基础距离2经-1马后可以出杀', !(res && 'error' in res), res)
    }

    // 目标有 +1马：距离又被加回 2
    {
        const s = build(['sunquan', 'huatuo', 'caocao'], ['zhenji', 'daqiao_jie', 'xiahoudun'], 95)
        const sq = s.generals[3]
        sq.equip.minus_horse = minusHorse()
        sq.hand = slashInHand()
        s.generals[1].equip.plus_horse = plusHorse()
        const res = handleUseCard(s, HUMAN_PLAYER_ID, { cardId: 'sl-x', targetIndices: [1] } as any)
        check('提示说明目标+1马把距离加了回来',
            !!res && 'error' in res && res.error.includes('-1马-1') && res.error.includes('目标+1马+1'), res)
    }

    // 目标方有文聘（镇卫）：距离 +1
    {
        const s = build(['sunquan', 'huatuo', 'caocao'], ['wenpin', 'daqiao_jie', 'xiahoudun'], 96)
        const sq = s.generals[3]
        sq.equip.minus_horse = minusHorse()
        sq.hand = slashInHand()
        const res = handleUseCard(s, HUMAN_PLAYER_ID, { cardId: 'sl-x', targetIndices: [1] } as any)
        check('提示说明镇卫把距离加了回来',
            !!res && 'error' in res && res.error.includes('-1马-1') && res.error.includes('镇卫+1'), res)
    }
}

console.log('[渐营]')
{
    const state = build(['jushou', 'huatuo', 'sunquan'], ['caocao', 'guojia', 'zhenji'])
    const js = state.generals[3]
    js.hand = [
        card('w1', TrickCardName.DRAW_TWO, CardSuit.HEART, 7, CardCategory.TRICK, { trickType: 'instant' }),
        card('w2', TrickCardName.DRAW_TWO, CardSuit.HEART, 9, CardCategory.TRICK, { trickType: 'instant' }),
    ]
    state.deck = Array.from({ length: 12 }, (_, i) => card('d' + i, BasicCardName.PEACH, CardSuit.CLUB, (i % 9) + 1))
    handleUseCard(state, HUMAN_PLAYER_ID, { cardId: 'w1', targetIndices: [] } as any)
    negateWindowTimeout(state)
    state.pendingResponseQueue = []
    handleUseCard(state, HUMAN_PLAYER_ID, { cardId: 'w2', targetIndices: [] } as any)
    negateWindowTimeout(state)
    const prompt = findPending(state, 'jushou_jianying')
    check('同花色后询问发动', !!prompt, queue(state))
    if (prompt) {
        state.pendingResponseQueue = [prompt]
        const before = js.hand.length
        handleRespond(state, HUMAN_PLAYER_ID, { action: 'confirm' } as any)
        check('确认后摸一张牌', js.hand.length === before + 1, `${before} -> ${js.hand.length}`)
    }
}

console.log('[窃听]')
{
    const state = build(['caifuren', 'huatuo', 'sunquan'], ['caocao', 'guojia', 'zhenji'])
    const cf = state.generals[3]
    cf.hand = []
    state.deck = [card('q1', BasicCardName.PEACH, CardSuit.HEART, 3), card('q2', BasicCardName.PEACH, CardSuit.HEART, 4)]
    state.activeGeneralIndex = 0
    state.activePlayerFaction = Faction.COOL
    handleEndTurn(state, AI_PLAYER_ID)
    const prompt = findPending(state, 'caifuren_qieting')
    check('他人回合结束询问发动', !!prompt, queue(state))
    if (prompt) {
        state.pendingResponseQueue = [prompt]
        handleRespond(state, HUMAN_PLAYER_ID, { action: 'draw' } as any)
        check('确认后摸一张牌', cf.hand.map((c: any) => c.id).join() === 'q1', cf.hand.map((c: any) => c.id))
    }
}

console.log('[骁果]')
{
    const state = build(['sunquan', 'huatuo', 'caocao'], ['yuejin', 'guojia', 'zhenji'])
    const yj = state.generals[0]
    yj.hand = [card('b1', BasicCardName.PEACH, CardSuit.HEART, 5)]
    const victim = state.generals[3]
    victim.hp = 2
    state.activeGeneralIndex = 3
    state.activePlayerFaction = Faction.WARM
    handleEndTurn(state, HUMAN_PLAYER_ID)
    const prompt = findPending(state, 'yuejin_xiaoguo')
    check('结束阶段询问发动', !!prompt, queue(state))
    if (prompt) {
        state.pendingResponseQueue = [prompt]
        handleRespond(state, AI_PLAYER_ID, { action: 'confirm' } as any)
        check('确认后进入选牌', queue(state).some((q: string) => q.startsWith('skill_pick_card')), queue(state))
        handleRespond(state, AI_PLAYER_ID, { cardIds: ['b1'] } as any)
        processAutoExecutePending(state)
        check('无装备时目标受 1 点伤害', victim.hp === 1, victim.hp)
    }
}

console.log('[选将]')
{
    const picks = (list: string[]) => list.map((id) => getGeneralById(id)!)
    const pickState = (pool: string[], mine: string[], rival: string[]) => {
        const s = createLocalMatch(Faction.COOL, 21)
        s.phase = GamePhase.GENERAL_PICK
        s.pickState = {
            pool: picks(pool),
            pickStep: 0,
            warmPicked: picks(mine),
            coolPicked: picks(rival),
            waitingForPickYield: false,
            yieldedPick: false,
        }
        return s
    }
    const chosen = (s: any, mine: string[]) => {
        aiDraft(s, AI_PLAYER_ID)
        return s.pickState.warmPicked.filter((g: any) => !mine.includes(g.id)).map((g: any) => g.id)[0]
    }

    check('首抓按强度拿郭嘉', chosen(pickState(['guojia', 'huatuo', 'huangyueying', 'zhangfei'], [], []), []) === 'guojia')
    check('已有两输出时补辅助',
        chosen(pickState(['machao', 'sunshangxiang'], ['zhangfei', 'huanggai'], []), ['zhangfei', 'huanggai']) === 'sunshangxiang')
    check('抢对手的郭嘉搭档', chosen(pickState(['huangyueying', 'zhaoyun_jing'], [], ['guojia']), []) === 'huangyueying')

    const deploy = createLocalMatch(Faction.COOL, 22)
    deploy.phase = GamePhase.DEPLOY
    deploy.deployState = { warmDeployed: false, coolDeployed: true }
    deploy.pickState = {
        pool: [],
        pickStep: 16,
        warmPicked: picks(['huatuo', 'lvbu_jing', 'huanggai']),
        coolPicked: [],
        waitingForPickYield: false,
        yieldedPick: false,
    }
    aiDraft(deploy, AI_PLAYER_ID)
    const bySeat = (role: SeatRole) => deploy.generals.find((g) => g.seatRole === role)?.generalId
    check('辅助坐主帅', bySeat(SeatRole.COMMANDER) === 'huatuo', deploy.generals.map((g) => `${g.generalId}/${g.seatRole}`))
    check('两名输出占前锋',
        [bySeat(SeatRole.FLANK_A), bySeat(SeatRole.FLANK_B)].sort().join() === ['huanggai', 'lvbu_jing'].sort().join())
}

console.log('[牌序]')
{
    const actionState = (hand: any[], setup?: (s: any) => void, inspect?: (s: any) => void) => {
        const s = createLocalMatch(Faction.COOL, 31)
        s.phase = GamePhase.PLAYING
        s.turnPhase = TurnPhase.ACTION
        const roles: any[] = [SeatRole.FLANK_A, SeatRole.COMMANDER, SeatRole.FLANK_B]
        s.generals = [
            ...['caocao', 'zhaoyun_jing', 'zhenji'].map((id, i) =>
                createGeneralInstance(getGeneralById(id)!, AI_PLAYER_ID, Faction.WARM, roles[i])),
            ...['caocao', 'guojia', 'huatuo'].map((id, i) =>
                createGeneralInstance(getGeneralById(id)!, HUMAN_PLAYER_ID, Faction.COOL, roles[i])),
        ]
        s.activeGeneralIndex = 2
        s.activePlayerFaction = Faction.WARM
        s.roundState = { roundNumber: 1, firstMover: Faction.WARM, currentActionStep: 3 }
        s.attackUsedThisTurn = 0
        s.log = []
        s.deck = Array.from({ length: 8 }, (_, i) => card('d' + i, BasicCardName.PEACH, CardSuit.CLUB, (i % 9) + 1))
        for (const g of s.generals) {
            g.hand = []
            g.hp = g.maxHp
        }
        s.generals[2].hand = hand
        setup?.(s)
        aiAct(s, AI_PLAYER_ID)
        inspect?.(s)
        return s.log.map((l) => l.text).join(' || ')
    }

    check('先摸牌再出杀', actionState([
        card('t1', TrickCardName.DRAW_TWO, CardSuit.HEART, 7, CardCategory.TRICK, { trickType: 'instant' }),
        card('s1', BasicCardName.ATTACK, CardSuit.SPADE, 7),
    ]).includes('无中生有'))
    check('先拆牌再出杀', actionState([
        card('t2', TrickCardName.DISMANTLE, CardSuit.SPADE, 3, CardCategory.TRICK, { trickType: 'instant' }),
        card('s2', BasicCardName.ATTACK, CardSuit.SPADE, 8),
    ], (s) => {
        s.generals[3].hand = [card('h1', BasicCardName.DODGE, CardSuit.HEART, 2)]
    }).includes('过河拆桥'))
    check('火杀前先铁索', actionState([
        card('t3', TrickCardName.IRON_CHAIN, CardSuit.SPADE, 3, CardCategory.TRICK, { trickType: 'instant' }),
        card('f1', BasicCardName.FIRE_SLASH, CardSuit.HEART, 4),
    ], (s) => {
        s.generals[2].equip.weapon = card('w1', EquipmentCardName.KYLIN_BOW, CardSuit.HEART, 5,
            CardCategory.EQUIPMENT, { equipSlot: EquipSlot.WEAPON, attackRange: 5 })
    }).includes('铁索连环'))
    check('无属性伤害时铁索先重铸', actionState([
        card('t4', TrickCardName.IRON_CHAIN, CardSuit.SPADE, 3, CardCategory.TRICK, { trickType: 'instant' }),
        card('s4', BasicCardName.ATTACK, CardSuit.SPADE, 9),
    ]).includes('重铸'))
    check('酒紧接在杀之前', actionState([
        card('w1', BasicCardName.WINE, CardSuit.DIAMOND, 9),
        card('s5', BasicCardName.ATTACK, CardSuit.SPADE, 8),
    ], (s) => {
        s.generals[3].hp = 1
    }).includes('饮【酒】'))
    check('延时锦囊先于输出（不能斩杀时）', (() => {
        const log = actionState([
            card('s6', BasicCardName.ATTACK, CardSuit.SPADE, 9),
            card('o1', TrickCardName.OVERINDULGENCE, CardSuit.SPADE, 6, CardCategory.TRICK, { trickType: 'delayed' }),
        ], (s) => {
            s.generals[3].hp = 3
        })
        return log.includes('乐不思蜀') && !log.includes('【杀】')
    })())
    check('能斩杀的目标不贴延时', (() => {
        const log = actionState([
            card('s7', BasicCardName.ATTACK, CardSuit.SPADE, 9),
            card('o2', TrickCardName.OVERINDULGENCE, CardSuit.SPADE, 6, CardCategory.TRICK, { trickType: 'delayed' }),
        ], (s) => {
            for (const i of [3, 4, 5]) s.generals[i].hp = 1
            s.generals[2].equip.weapon = card('w9', EquipmentCardName.KYLIN_BOW, CardSuit.HEART, 5,
                CardCategory.EQUIPMENT, { equipSlot: EquipSlot.WEAPON, attackRange: 5 })
        })
        return log.includes('【杀】') && !log.includes('乐不思蜀')
    })())
    check('延时后到先判：已有兵粮时贴乐，乐先判', (() => {
        let first = ''
        actionState([
            card('o3', TrickCardName.OVERINDULGENCE, CardSuit.SPADE, 6, CardCategory.TRICK, { trickType: 'delayed' }),
        ], (s) => {
            for (const foe of s.generals.slice(3)) {
                foe.judgeZone = [
                    card('j-' + foe.generalId, TrickCardName.SUPPLY_SHORTAGE, CardSuit.CLUB, 3, CardCategory.TRICK, { trickType: 'delayed' }),
                ]
            }
        }, (s) => {
            const hit = s.generals.slice(3).find((g: any) =>
                g.judgeZone.some((c: any) => c.name === TrickCardName.OVERINDULGENCE))
            first = hit ? hit.judgeZone[hit.judgeZone.length - 1].name : ''
        })
        return first === TrickCardName.OVERINDULGENCE
    })())
}

console.log('[技能联动]')
{
    const s = build(['sunquan', 'huatuo', 'caocao'], ['guojia', 'zhangfei', 'zhenji'])
    const guojia = s.generals[0]
    const zhangfei = s.generals[1]
    const slash = card('sx1', BasicCardName.ATTACK, CardSuit.SPADE, 7)
    check('张飞比郭嘉更看重【杀】', cardFit(zhangfei, slash) > cardFit(guojia, slash),
        `${cardFit(zhangfei, slash)} vs ${cardFit(guojia, slash)}`)
    check('郭嘉挨打会触发遗计，收益记为负', damageBackfire(guojia) > 0 && damageBackfire(zhangfei) === 0,
        `${damageBackfire(guojia)} / ${damageBackfire(zhangfei)}`)
    const target = bestGiftTarget([{ g: guojia, index: 0 }, { g: zhangfei, index: 1 }], slash, 'sunquan')
    check('给牌优先给能吃下这张牌的队友', target?.index === 1, target?.g.generalId)

    // 单回合演练：指定技能持有者作为行动角色
    const skillTurn = (generalId: string, hand: any[], setup?: (s: any) => void) => {
        const s = createLocalMatch(Faction.COOL, 41)
        s.phase = GamePhase.PLAYING
        s.turnPhase = TurnPhase.ACTION
        const roles: any[] = [SeatRole.FLANK_A, SeatRole.COMMANDER, SeatRole.FLANK_B]
        s.generals = [
            createGeneralInstance(getGeneralById(generalId)!, AI_PLAYER_ID, Faction.WARM, roles[1]),
            createGeneralInstance(getGeneralById('caocao')!, AI_PLAYER_ID, Faction.WARM, roles[0]),
            createGeneralInstance(getGeneralById('zhenji')!, AI_PLAYER_ID, Faction.WARM, roles[2]),
            ...['sunquan', 'huatuo', 'zhenji'].map((id, i) =>
                createGeneralInstance(getGeneralById(id)!, HUMAN_PLAYER_ID, Faction.COOL, roles[i])),
        ]
        s.activeGeneralIndex = 0
        s.activePlayerFaction = Faction.WARM
        s.roundState = { roundNumber: 1, firstMover: Faction.WARM, currentActionStep: 3 }
        s.attackUsedThisTurn = 0
        s.log = []
        s.deck = Array.from({ length: 8 }, (_, i) => card('k' + i, BasicCardName.PEACH, CardSuit.CLUB, (i % 9) + 1))
        for (const g of s.generals) {
            g.hand = []
            g.hp = g.maxHp
        }
        s.generals[0].hand = hand
        setup?.(s)
        aiAct(s, AI_PLAYER_ID)
        return s.log.map((l) => l.text).join(' || ')
    }

    check('制衡会先把废牌换掉', skillTurn('sunquan', [
        card('z1', TrickCardName.BORROW_SWORD, CardSuit.SPADE, 3, CardCategory.TRICK, { trickType: 'instant' }),
    ]).includes('制衡'))
    check('刘备受伤时会用仁德换回血', skillTurn('liubei', [
        card('z2', TrickCardName.BORROW_SWORD, CardSuit.SPADE, 3, CardCategory.TRICK, { trickType: 'instant' }),
        card('z3', TrickCardName.FIRE_ATTACK, CardSuit.HEART, 2, CardCategory.TRICK, { trickType: 'instant' }),
    ], (s) => {
        s.generals[0].hp = 2
    }).includes('仁德'))
}

console.log('[战略]')
{
    const fresh = () => {
        const s = build(['guojia', 'huatuo', 'xiahoudun'], ['sunquan', 'caocao', 'zhenji'])
        s.log = []
        for (const g of s.generals) {
            g.hand = []
            g.hp = g.maxHp
        }
        return s
    }
    const s1 = fresh()
    check('集火目标优先敌方主帅', analyzeStrategy(s1, AI_PLAYER_ID).focusIndex === 4,
        `focus=${analyzeStrategy(s1, AI_PLAYER_ID).focusIndex}`)

    const s2 = fresh()
    s2.generals[3].hp = 1
    s2.generals[4].hand = [
        card('h1', BasicCardName.DODGE, CardSuit.HEART, 2),
        card('h2', BasicCardName.DODGE, CardSuit.HEART, 3),
        card('h3', BasicCardName.DODGE, CardSuit.HEART, 4),
    ]
    check('残血目标优先于满血主帅', analyzeStrategy(s2, AI_PLAYER_ID).focusIndex === 3,
        `focus=${analyzeStrategy(s2, AI_PLAYER_ID).focusIndex}`)

    const s3 = fresh()
    const enemyName = getGeneralById(s3.generals[4].generalId)?.name ?? ''
    const allyName = getGeneralById(s3.generals[1].generalId)?.name ?? ''
    s3.log.push({ timestamp: 0, text: `【${enemyName}】对【${allyName}】使用了【杀】` })
    s3.log.push({ timestamp: 0, text: `【${allyName}】受到 1 点伤害，剩余 3/4` })
    const pressed = analyzeStrategy(s3, AI_PLAYER_ID)
    check('能看出对手在针对谁', pressed.pressureIndex === 1 && pressed.pressure[1] >= 3,
        `pressure=${pressed.pressure.join(',')}`)

    const s4 = fresh()
    for (const g of s4.generals.slice(3)) {
        g.hand = [card('x' + g.generalId, BasicCardName.ATTACK, CardSuit.SPADE, 7)]
        g.hand.push(card('y' + g.generalId, BasicCardName.DODGE, CardSuit.HEART, 8))
        g.hand.push(card('z' + g.generalId, BasicCardName.DODGE, CardSuit.HEART, 9))
    }
    check('对手攒牌时判定为保守局面', analyzeStrategy(s4, AI_PLAYER_ID).enemySaving === true,
        `saving=${analyzeStrategy(s4, AI_PLAYER_ID).enemySaving}`)
}

console.log('[评分]')
{
    const est = estimateAction({ preset: 50, gain: 12, risk: 4, strategic: 6 })
    check('动作评分 = 预设 + 收益 - 风险 + 战略', est.immediate === 64, est)
    check('预设优先级取基础分',
        presetPriority('draw_two') === 90 && presetPriority('slash') === 50,
        `${presetPriority('draw_two')}/${presetPriority('slash')}`)
    check('技能与装备走兜底预设分',
        presetPriority('skill:kurou') === 60 && presetPriority('equip_weapon') === 30)
    const peers = [
        { immediate: 60, plans: ['burst' as const] },
        { immediate: 40, plans: ['burst' as const] },
        { immediate: 30, plans: ['value' as const] },
    ]
    const turn = turnValueOf(50, ['burst'], peers)
    check('回合总收益计入同计划后续动作',
        Math.abs(turn - (50 + 0.35 * (0.85 * 60 + 0.7 * 40 + 0.5 * 30))) < 1e-9, turn)
    check('没有后续动作时回合收益等于即时价值',
        turnValueOf(50, ['burst'], []) === 50)
}

console.log('[目标]')
{
    const s = build(['sunquan', 'huatuo', 'caocao'], ['guojia', 'zhenji', 'xiahoudun'])
    const allies = s.generals.map((g, index) => ({ g, index })).filter(({ index }) => index < 3)
    const enemies = s.generals.map((g, index) => ({ g, index })).filter(({ index }) => index >= 3)
    s.generals[0].judgeZone.push(card('jm1', TrickCardName.OVERINDULGENCE, CardSuit.SPADE, 6,
        CardCategory.TRICK, { trickType: 'delayed' }))
    const breakDelayed = detectObjective({
        focusIndex: 4, allies, enemies, plans: [], killWindow: false, commanderKill: false,
    })
    check('队友被贴乐 → 先解除延时',
        breakDelayed?.kind === 'break-ally-delayed' && breakDelayed.targetIndex === 0, breakDelayed)
    s.generals[0].judgeZone = []
    const kill = detectObjective({
        focusIndex: 4, allies, enemies, plans: [], killWindow: true, commanderKill: true,
    })
    check('敌方主帅可斩杀 → 集火核心',
        kill?.kind === 'focus-core' && kill.priority === 120, kill)
    const limit = detectObjective({
        focusIndex: 3, allies, enemies, killWindow: false, commanderKill: false,
        plans: [{ index: 4, rawDamage: 2, damage: 2, reachesCommander: true,
            actsThisRound: true, threat: 20 }],
    })
    check('高威胁敌人即将行动 → 先限制',
        limit?.kind === 'limit-enemy-next' && limit.targetIndex === 4, limit)
}

console.log('[预测]')
{
    const s = createLocalMatch(Faction.COOL, 41)
    s.phase = GamePhase.PLAYING
    const roles: any[] = [SeatRole.FLANK_A, SeatRole.COMMANDER, SeatRole.FLANK_B]
    s.generals = [
        ...['zhenji', 'guojia', 'caocao'].map((id, i) =>
            createGeneralInstance(getGeneralById(id)!, AI_PLAYER_ID, Faction.WARM, roles[i])),
        ...['zhenji', 'guojia', 'caocao'].map((id, i) =>
            createGeneralInstance(getGeneralById(id)!, HUMAN_PLAYER_ID, Faction.COOL, roles[i])),
    ]
    for (const g of s.generals) {
        g.hand = []
        g.hasActed = true
    }
    s.generals[0].hasActed = false
    s.generals[3].hasActed = false
    // 剩余行动数：为后续回合的取舍提供依据
    const view = teamView(s, AI_PLAYER_ID)
    check('统计双方剩余行动数', view.ourRemainingTurns === 1 && view.enemyRemainingTurns === 1, view)
    const slash = card('x1', BasicCardName.ATTACK, CardSuit.SPADE, 7)
    // 空手目标：没有闪，必中
    check('空手目标挡不住杀', Math.abs(predictSlash(s.generals[3], slash).hitChance - 1) < 0.001)
    // 八卦阵：仍有一半概率判红
    s.generals[3].equip.armor = card('a1', EquipmentCardName.EIGHT_TRIGRAMS, CardSuit.SPADE, 2,
        CardCategory.EQUIPMENT, { equipSlot: EquipSlot.ARMOR })
    const withBagua = predictSlash(s.generals[3], slash)
    check('八卦阵给空手目标一半的防御', Math.abs(withBagua.hitChance - 0.5) < 0.01, withBagua)
    // 青釭剑无视防具
    check('青釭剑无视八卦阵',
        Math.abs(predictSlash(s.generals[3], slash, { ignoresArmor: true }).hitChance - 1) < 0.001)
    // 藤甲挡普通杀
    s.generals[3].equip.armor = card('a2', EquipmentCardName.VINE, CardSuit.SPADE, 2,
        CardCategory.EQUIPMENT, { equipSlot: EquipSlot.ARMOR })
    check('藤甲让普通杀失效', predictSlash(s.generals[3], slash).hitChance === 0)
    s.generals[3].equip.armor = undefined

    // 群体锦囊：敌方空手、己方满手时净收益为正
    for (const g of s.generals.slice(3)) g.hand = []
    for (let i = 0; i < 4; i++) {
        s.generals[0].hand.push(card('y' + i, BasicCardName.ATTACK, CardSuit.SPADE, 7))
        s.generals[1].hand.push(card('w' + i, BasicCardName.ATTACK, CardSuit.SPADE, 7))
    }
    const aoe = predictAoe(s, AI_PLAYER_ID, 'arrows')
    check('万箭齐发在敌方空手时净赚', aoe.net > 0.5, aoe)

    // 改判将：同阵营有鬼才时延时锦囊成功率下降
    const before = delayedSuccessChance(s, s.generals[3])
    s.generals[4] = createGeneralInstance(getGeneralById('simayi')!, HUMAN_PLAYER_ID, Faction.COOL, roles[1])
    s.generals[4].hand = [card('g1', BasicCardName.DODGE, CardSuit.HEART, 2)]
    check('同阵营有鬼才时延时更难生效', delayedSuccessChance(s, s.generals[3]) < before,
        `${before} -> ${delayedSuccessChance(s, s.generals[3])}`)
}

console.log('[记忆]')
{
    // 五谷丰登的选牌是公开的：选完就进记忆，牌离手后记忆自动作废
    const s = build(['sunquan', 'huatuo', 'caocao'], ['guojia', 'zhenji', 'xiahoudun'])
    s.harvestPool = [
        card('hp1', BasicCardName.PEACH, CardSuit.HEART, 3),
        card('hp2', BasicCardName.ATTACK, CardSuit.SPADE, 7),
    ]
    s.pendingResponseQueue = [{ type: ResponseType.HARVEST_PICK, targetGeneralIndex: 0, context: {} } as any]
    handleRespond(s, AI_PLAYER_ID, { cardId: 'hp1' } as any)
    check('五谷丰登选牌被记住', knownHand(s, 0).some((c) => c.id === 'hp1'), knownHand(s, 0))
    s.generals[0].hand = s.generals[0].hand.filter((c) => c.id !== 'hp1')
    check('牌离手后明牌记忆作废', knownHand(s, 0).every((c) => c.id !== 'hp1'))

    // 明牌没有闪：这一杀必中，不必再按手牌数硬猜
    const s2 = build(['sunquan', 'huatuo', 'caocao'], ['guojia', 'zhenji', 'xiahoudun'])
    s2.generals[0].hand = [
        card('k1', BasicCardName.ATTACK, CardSuit.SPADE, 3),
        card('k2', BasicCardName.ATTACK, CardSuit.SPADE, 4),
    ]
    rememberCards(s2, 0, s2.generals[0].hand, '智愚')
    const guessed = guessHand(s2, HUMAN_PLAYER_ID, 0)
    check('明牌两张杀直接算进估计', guessed.expected.slash >= 2 && guessed.atLeastOne('slash') === 1,
        guessed.expected)
    const certainty = predictSlash(
        s2.generals[0],
        card('x1', BasicCardName.ATTACK, CardSuit.SPADE, 7),
        { dodgeChance: handDodgeChance(s2, HUMAN_PLAYER_ID, 0) },
    )
    check('明牌没有闪 → 杀必中', certainty.hitChance === 1, certainty)

    // 弃牌堆里闪越多，未知牌里能摸到的闪就越少
    const s3 = build(['sunquan', 'huatuo', 'caocao'], ['guojia', 'zhenji', 'xiahoudun'])
    s3.discard = Array.from({ length: 22 }, (_, i) =>
        card('dc' + i, BasicCardName.DODGE, CardSuit.HEART, (i % 9) + 1))
    const pool = poolView(s3, HUMAN_PLAYER_ID)
    check('弃牌堆里的闪会压低未知牌池的闪密度',
        pool.rate('dodge') < KEY_CARD_COUNTS.dodge / 156, pool.rate('dodge'))

    // 明牌里有无懈：关键锦囊被无懈的风险不再是概率，而是事实
    const s4 = build(['sunquan', 'huatuo', 'caocao'], ['guojia', 'zhenji', 'xiahoudun'])
    s4.generals[0].hand = [card('n1', TrickCardName.NEGATE, CardSuit.SPADE, 2, CardCategory.TRICK)]
    rememberCards(s4, 0, s4.generals[0].hand, '五谷丰登')
    check('看到明牌无懈 → 无懈风险拉满', negateRisk(s4, HUMAN_PLAYER_ID) === 1,
        negateRisk(s4, HUMAN_PLAYER_ID))

    // 预测对手下一回合：三张明牌杀能打到主帅，贴乐之后就基本废掉
    const s5 = createLocalMatch(Faction.WARM, 47)
    s5.phase = GamePhase.PLAYING
    const roles: any[] = [SeatRole.FLANK_A, SeatRole.COMMANDER, SeatRole.FLANK_B]
    s5.generals = [
        ...['guojia', 'zhenji', 'xiahoudun'].map((id, i) =>
            createGeneralInstance(getGeneralById(id)!, AI_PLAYER_ID, Faction.COOL, roles[i])),
        ...['sunquan', 'huatuo', 'caocao'].map((id, i) =>
            createGeneralInstance(getGeneralById(id)!, HUMAN_PLAYER_ID, Faction.WARM, roles[i])),
    ]
    // 座位 5 与座位 0 相邻：让 Our 主帅正好落在敌方边锋的攻击范围里
    s5.generals[4].seatRole = SeatRole.FLANK_B
    s5.generals[5].seatRole = SeatRole.COMMANDER
    for (const g of s5.generals) g.hand = []
    s5.generals[0].hand = [
        card('e1', BasicCardName.ATTACK, CardSuit.SPADE, 3),
        card('e2', BasicCardName.ATTACK, CardSuit.SPADE, 4),
        card('e3', BasicCardName.ATTACK, CardSuit.SPADE, 5),
    ]
    rememberCards(s5, 0, s5.generals[0].hand, '智愚')
    const plan = predictEnemyTurn(s5, HUMAN_PLAYER_ID, 0, 5)
    check('明牌三杀 → 预测到对主帅的伤害', plan.reachesCommander && plan.rawDamage > 0.5, plan)
    s5.generals[0].judgeZone.push(
        card('j1', TrickCardName.OVERINDULGENCE, CardSuit.SPADE, 6, CardCategory.TRICK, { trickType: 'delayed' }))
    const slowed = predictEnemyTurn(s5, HUMAN_PLAYER_ID, 0, 5)
    check('乐不思蜀把下一回合的伤害压到三成以下', slowed.damage < plan.rawDamage * 0.3, slowed)
    check('威胁最高的敌人排在预测列表首位', enemyPlans(s5, HUMAN_PLAYER_ID)[0].index === 0,
        enemyPlans(s5, HUMAN_PLAYER_ID).map((x) => `${x.index}:${x.threat}`))

    // 同一张公开牌同时出现在弃牌堆和将牌上，只能扣一次
    const sDedup = build(['sunquan', 'huatuo', 'caocao'], ['guojia', 'zhenji', 'xiahoudun'])
    const dup = card('dup1', BasicCardName.DODGE, CardSuit.HEART, 2)
    sDedup.discard = [dup]
    sDedup.generals[0].generalPile = [dup]
    const sNoDup = build(['sunquan', 'huatuo', 'caocao'], ['guojia', 'zhenji', 'xiahoudun'])
    sNoDup.discard = [dup]
    check('同一张公开牌只扣一次',
        poolView(sDedup, HUMAN_PLAYER_ID).unseen === poolView(sNoDup, HUMAN_PLAYER_ID).unseen,
        `${poolView(sDedup, HUMAN_PLAYER_ID).unseen} vs ${poolView(sNoDup, HUMAN_PLAYER_ID).unseen}`)

    // 国色/断粮等转化牌要按 originalName 扣牌
    const sConvert = build(['sunquan', 'huatuo', 'caocao'], ['guojia', 'zhenji', 'xiahoudun'])
    sConvert.discard = [card('conv1', TrickCardName.OVERINDULGENCE, CardSuit.DIAMOND, 6,
        CardCategory.TRICK, { trickType: 'delayed', originalName: BasicCardName.DODGE })]
    const convPool = poolView(sConvert, HUMAN_PLAYER_ID)
    check('转化牌按原牌名扣除',
        convPool.left('dodge') === KEY_CARD_COUNTS.dodge - 1 &&
        convPool.left('overindulgence') === KEY_CARD_COUNTS.overindulgence,
        { dodge: convPool.left('dodge'), overindulgence: convPool.left('overindulgence') })

    // 至少一张按无放回超几何算（目标武将没有留牌倾向，便于和裸牌池对齐）
    const sOdds = build(['sunquan', 'huatuo', 'caocao'], ['diaochan', 'zhenji', 'xiahoudun'])
    sOdds.discard = Array.from({ length: 20 }, (_, i) =>
        card('od' + i, BasicCardName.DODGE, CardSuit.HEART, (i % 9) + 1))
    sOdds.generals[0].hand = Array.from({ length: 3 }, (_, i) =>
        card('oh' + i, BasicCardName.ATTACK, CardSuit.SPADE, (i % 9) + 2))
    const oddsGuess = guessHand(sOdds, HUMAN_PLAYER_ID, 0)
    const oddsPool = poolView(sOdds, HUMAN_PLAYER_ID)
    check('至少一张闪按无放回计算',
        Math.abs(oddsGuess.atLeastOne('dodge') -
            atLeastOneChance(oddsGuess.unknown, oddsPool.left('dodge'), oddsPool.unseen)) < 0.02,
        { model: oddsGuess.atLeastOne('dodge'), raw: atLeastOneChance(oddsGuess.unknown, oddsPool.left('dodge'), oddsPool.unseen) })

    // 技能留牌：张飞的未知手牌更偏向杀
    const sZhangfei = build(['sunquan', 'huatuo', 'caocao'], ['zhangfei', 'zhenji', 'xiahoudun'])
    const sSunquan = build(['sunquan', 'huatuo', 'caocao'], ['sunquan', 'zhenji', 'xiahoudun'])
    for (const s of [sZhangfei, sSunquan]) {
        s.generals[0].hand = Array.from({ length: 4 }, (_, i) =>
            card('t' + i, BasicCardName.ATTACK, CardSuit.SPADE, (i % 9) + 2))
    }
    const zfGuess = guessHand(sZhangfei, HUMAN_PLAYER_ID, 0)
    const sqGuess = guessHand(sSunquan, HUMAN_PLAYER_ID, 0)
    check('张飞留杀倾向高于孙权', zfGuess.expected.slash > sqGuess.expected.slash,
        `${zfGuess.expected.slash.toFixed(3)} vs ${sqGuess.expected.slash.toFixed(3)}`)

    // 明牌固定，未知部分才按概率
    const sKnown = build(['sunquan', 'huatuo', 'caocao'], ['guojia', 'zhenji', 'xiahoudun'])
    sKnown.generals[0].hand = [
        card('kh1', BasicCardName.DODGE, CardSuit.HEART, 2),
        card('kh2', BasicCardName.ATTACK, CardSuit.SPADE, 7),
    ]
    rememberCards(sKnown, 0, [sKnown.generals[0].hand[0]], '智愚')
    const knownGuess = guessHand(sKnown, HUMAN_PLAYER_ID, 0)
    check('明牌有闪则至少一张闪为 1', knownGuess.atLeastOne('dodge') === 1)
    check('明牌比例进入置信度', knownGuess.knownRatio === 0.5 && knownGuess.confidence === 0.5,
        `${knownGuess.knownRatio}/${knownGuess.confidence}`)

    // 弃牌堆里的闪：已使用/已弃置的牌压低剩余手牌期望
    const sPlayed = build(['sunquan', 'huatuo', 'caocao'], ['guojia', 'zhenji', 'xiahoudun'])
    sPlayed.generals[0].hand = Array.from({ length: 3 }, (_, i) =>
        card('ph' + i, BasicCardName.ATTACK, CardSuit.SPADE, (i % 9) + 2))
    const beforePlayed = guessHand(sPlayed, HUMAN_PLAYER_ID, 0).expected.dodge
    const playedBefore = poolView(sPlayed, HUMAN_PLAYER_ID).played('dodge')
    sPlayed.discard = [...sPlayed.discard, ...Array.from({ length: 20 }, (_, i) =>
        card('pd' + i, BasicCardName.DODGE, CardSuit.HEART, (i % 9) + 1))]
    const afterPlayed = guessHand(sPlayed, HUMAN_PLAYER_ID, 0).expected.dodge
    check('已弃置的闪压低剩余手牌闪期望', afterPlayed < beforePlayed,
        `${beforePlayed.toFixed(3)} -> ${afterPlayed.toFixed(3)}`)
    check('弃牌堆统计已使用/已弃置的闪',
        poolView(sPlayed, HUMAN_PLAYER_ID).played('dodge') - playedBefore === 20,
        poolView(sPlayed, HUMAN_PLAYER_ID).played('dodge') - playedBefore)

    // 桃与无懈是全队共享：任一存活队友手里有，全队就有一张
    const sTeam = build(['sunquan', 'huatuo', 'caocao'], ['guojia', 'zhenji', 'xiahoudun'])
    for (const g of sTeam.generals) g.hand = []
    const teamPeachCard = card('tm1', BasicCardName.PEACH, CardSuit.HEART, 3)
    const teamNegateCard = card('tm2', TrickCardName.NEGATE, CardSuit.SPADE, 2, CardCategory.TRICK)
    sTeam.generals[0].hand = [teamPeachCard]
    sTeam.generals[1].hand = [teamNegateCard]
    rememberCards(sTeam, 0, [teamPeachCard], '五谷丰登')
    rememberCards(sTeam, 1, [teamNegateCard], '五谷丰登')
    const teamPeach = teamResource(sTeam, HUMAN_PLAYER_ID, 'peach')
    const teamNegate = teamResource(sTeam, HUMAN_PLAYER_ID, 'negate')
    check('团队桃资源合并队友明牌', teamPeach.known === 1 && teamPeach.atLeastOne === 1, teamPeach)
    check('团队无懈合并队友明牌', teamNegate.known === 1 && teamNegate.atLeastOne === 1, teamNegate)
    check('单人猜牌看不到队友的桃',
        guessHand(sTeam, HUMAN_PLAYER_ID, 2).atLeastOne('peach') === 0)

    // 未知手牌也要按全队合并，不能只取某一个人的概率
    const sTeamU = build(['sunquan', 'huatuo', 'caocao'], ['guojia', 'zhenji', 'xiahoudun'])
    for (const g of sTeamU.generals) g.hand = []
    for (let i = 0; i < 5; i++) {
        sTeamU.generals[0].hand.push(card('tu0' + i, BasicCardName.ATTACK, CardSuit.SPADE, i + 2))
        sTeamU.generals[1].hand.push(card('tu1' + i, BasicCardName.ATTACK, CardSuit.SPADE, i + 2))
    }
    const soloPeachChance = guessHand(sTeamU, HUMAN_PLAYER_ID, 0).atLeastOne('peach')
    const teamPeachChance = teamResource(sTeamU, HUMAN_PLAYER_ID, 'peach').atLeastOne
    check('团队桃概率高于任一单人',
        teamPeachChance > soloPeachChance && teamPeachChance > 0.1,
        `${soloPeachChance.toFixed(3)} -> ${teamPeachChance.toFixed(3)}`)

    // 已使用的桃同样从全队资源里扣
    const beforeUsedPeach = teamResource(sTeamU, HUMAN_PLAYER_ID, 'peach').expected
    sTeamU.discard = Array.from({ length: 10 }, (_, i) =>
        card('ud' + i, BasicCardName.PEACH, CardSuit.HEART, (i % 9) + 1))
    check('已使用的桃压低全队桃期望',
        teamResource(sTeamU, HUMAN_PLAYER_ID, 'peach').expected < beforeUsedPeach,
        `${beforeUsedPeach.toFixed(3)} -> ${teamResource(sTeamU, HUMAN_PLAYER_ID, 'peach').expected.toFixed(3)}`)

    // 阵亡队友的桃不再计入团队救援
    sTeam.generals[0].alive = false
    const deadPeach = teamResource(sTeam, HUMAN_PLAYER_ID, 'peach')
    check('阵亡队友的桃不计入团队资源', deadPeach.known === 0 && deadPeach.atLeastOne === 0, deadPeach)
}

console.log('[结算修复]')
{
    // 骁果：目标体力健康时也要询问（旧实现只在体力<=2时问）
    const s = build(['sunquan', 'huatuo', 'guojia'], ['yuejin', 'caocao', 'zhenji'])
    s.generals[0].hand = [card('xg1', BasicCardName.DODGE, CardSuit.HEART, 2)]
    for (const g of s.generals) g.hasActed = false
    s.activeGeneralIndex = 4
    s.activePlayerFaction = Faction.WARM
    s.generals[4].hand = []
    s.generals[4].hp = s.generals[4].maxHp
    handleEndTurn(s, HUMAN_PLAYER_ID)
    check('骁果在目标满血时也询问', !!findPending(s, 'yuejin_xiaoguo'), queue(s))
}
{
    // 拒战（阳）：询问要在【闪】之前
    const s = build(['yanyan', 'caocao', 'zhenji'], ['sunquan', 'huatuo', 'guojia'])
    s.generals[3].juzhanYang = true
    s.generals[3].hand = []
    s.generals[2].hand = [card('jz1', BasicCardName.ATTACK, CardSuit.SPADE, 7)]
    s.activeGeneralIndex = 2
    s.activePlayerFaction = Faction.COOL
    handleUseCard(s, AI_PLAYER_ID, { cardId: 'jz1', targetIndices: [3] } as any)
    check('拒战在出闪之前询问', queue(s)[0] === 'skill_activate_confirm/yanyan_juzhan', queue(s))
}
{
    // 铁索：一次属性伤害只沿链传导一轮
    const s = build(['caocao', 'zhenji', 'xiahoudun'], ['sunquan', 'huatuo', 'guojia'])
    for (const g of s.generals) { g.hp = g.maxHp; g.chained = true; g.hand = [] }
    dealDamage(s, null, s.generals[0], 1, undefined, { nature: 'thunder' })
    check('铁索连环只传导一轮', s.generals.every((g) => g.hp === g.maxHp - 1), s.generals.map((g) => g.hp))
    check('传导后全部重置', s.generals.every((g) => !g.chained))
}
{
    // 白银狮子：被拆掉时回复1点体力
    const s = build(['zhaoyun_jing', 'caocao', 'zhenji'], ['sunquan', 'huatuo', 'guojia'])
    const zy = s.generals[3]
    zy.hp = zy.maxHp - 1
    zy.equip.armor = card('sl1', EquipmentCardName.SILVER_LION, CardSuit.SPADE, 2,
        CardCategory.EQUIPMENT, { equipSlot: EquipSlot.ARMOR })
    zy.hand = []
    s.generals[2].hand = [card('sl2', TrickCardName.DISMANTLE, CardSuit.SPADE, 3, CardCategory.TRICK, { trickType: 'instant' })]
    s.activeGeneralIndex = 2
    s.activePlayerFaction = Faction.COOL
    handleUseCard(s, AI_PLAYER_ID, { cardId: 'sl2', targetIndices: [3] } as any)
    negateWindowTimeout(s)
    processAutoExecutePending(s)
    const pick = s.pendingResponseQueue.find((p) => p.type === ResponseType.TRICK_TARGET_CARD_PICK)
    if (pick) handleRespond(s, AI_PLAYER_ID, { action: 'armor' } as any)
    check('失去白银狮子回复体力', zy.hp === zy.maxHp, `${zy.hp}/${zy.maxHp}`)
}
{
    // 谏计：摸到【杀】要询问受牌者，再由其选目标
    const s = build(['huangquan_jing', 'caocao', 'zhenji'], ['sunquan', 'huatuo', 'guojia'])
    s.activeGeneralIndex = 3
    s.activePlayerFaction = Faction.WARM
    s.generals[3].hand = [card('jj0', BasicCardName.DODGE, CardSuit.HEART, 2)]
    s.deck = [card('jj1', BasicCardName.ATTACK, CardSuit.SPADE, 9), card('jj2', BasicCardName.DODGE, CardSuit.HEART, 3)]
    handleUseSkill(s, HUMAN_PLAYER_ID, { skillId: 'huangquan_jianji', targetIndices: [4], cardIds: [] } as any)
    check('谏计询问是否使用', !!findPending(s, 'huangquan_jianji'), queue(s))
    handleRespond(s, HUMAN_PLAYER_ID, { action: 'confirm' } as any)
    check('谏计确认后选杀的目标', s.pendingResponseQueue.some(
        (p) => p.type === ResponseType.SKILL_CHOOSE_TARGET && (p.context as any)?.skillId === 'huangquan_jianji'),
        queue(s))
}
{
    // 裸衣（界许褚）：亮三张拿基本牌/武器/决斗，不额外摸两张
    const s = build(['xuchu_jie', 'caocao', 'zhenji'], ['sunquan', 'huatuo', 'guojia'])
    const xc = s.generals[3]
    xc.hand = []
    s.deck = [
        card('ly1', BasicCardName.ATTACK, CardSuit.SPADE, 9),
        card('ly2', BasicCardName.DODGE, CardSuit.HEART, 3),
        card('ly3', TrickCardName.DUEL, CardSuit.CLUB, 9, CardCategory.TRICK, { trickType: 'instant' }),
        card('ly4', BasicCardName.PEACH, CardSuit.HEART, 5),
        card('ly5', BasicCardName.PEACH, CardSuit.HEART, 6),
    ]
    s.activeGeneralIndex = 3
    s.activePlayerFaction = Faction.WARM
    s.turnPhase = TurnPhase.DRAW
    finishJudgePhaseAndContinue(s, xc, false, false)
    const ly = findPending(s, 'xuchu_jie_luoyi')
    if (ly) {
        s.pendingResponseQueue = [ly]
        handleRespond(s, HUMAN_PLAYER_ID, { action: 'confirm' } as any)
    }
    check('裸衣亮三张拿基本牌/武器/决斗', xc.hand.length === 3 && s.deck.length === 2,
        `${xc.hand.map((c) => c.name)} deck=${s.deck.length}`)
    check('裸衣进入伤害加成状态', (xc as any).luoyiActive === true)
}
{
    // 界马超铁骑：AI 不该放弃
    const s = build(['machao_jie', 'caocao', 'zhenji'], ['sunquan', 'huatuo', 'guojia'])
    s.turnPhase = TurnPhase.ACTION
    s.activeGeneralIndex = 0
    s.activePlayerFaction = Faction.COOL
    s.deck = [card('tq1', BasicCardName.PEACH, CardSuit.HEART, 5)]
    s.pendingResponseQueue = [{
        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
        targetGeneralIndex: 0,
        context: { skillId: 'machao_jie_tieqi', skillName: '铁骑', tieqiTargetIndex: 3 },
    }]
    aiAct(s, AI_PLAYER_ID)
    check('界马超铁骑会发动', !s.pendingResponseQueue.some(
        (p) => (p.context as any)?.skillId === 'machao_jie_tieqi'), queue(s))
}
{
    // 铁骑：借刀杀人逼着砍队友时不发动
    const s = build(['machao_jie', 'caocao', 'zhenji'], ['sunquan', 'huatuo', 'guojia'])
    s.turnPhase = TurnPhase.ACTION
    s.activeGeneralIndex = 0
    s.deck = [card('tq2', BasicCardName.PEACH, CardSuit.HEART, 5)]
    s.pendingResponseQueue = [{
        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
        targetGeneralIndex: 0,
        context: { skillId: 'machao_jie_tieqi', skillName: '铁骑', tieqiTargetIndex: 1, attackCardId: 'x' },
    }]
    aiAct(s, AI_PLAYER_ID)
    check('铁骑不对队友发动', s.deck.length === 1 && !s.log.some((l: any) => l.text.includes('【铁骑】判定')), queue(s))
}
{
    // 牌堆用尽时把弃牌堆洗回牌堆，判定阶段不能无提示卡住
    const s = build(['sunquan', 'huatuo', 'guojia'], ['caocao', 'zhenji', 'machao'])
    s.deck = []
    s.discard = [
        card('rs1', BasicCardName.ATTACK, CardSuit.SPADE, 7),
        card('rs2', BasicCardName.DODGE, CardSuit.HEART, 2),
    ]
    const ok = ensureDeck(s)
    check('牌堆空时弃牌堆洗回牌堆', ok && s.deck.length === 2 && s.discard.length === 0,
        `deck=${s.deck.length} discard=${s.discard.length}`)
}

console.log('[界黄盖]')
{
    const s = build(['huanggai_jie', 'huatuo', 'sunquan'], ['caocao', 'guojia', 'zhenji'])
    const hg = s.generals[3]
    hg.hand = [
        card('hg1', BasicCardName.ATTACK, CardSuit.SPADE, 7),
        card('hg2', BasicCardName.ATTACK, CardSuit.HEART, 8),
    ]
    s.deck = Array.from({ length: 8 }, (_, i) => card('kd' + i, BasicCardName.PEACH, CardSuit.CLUB, (i % 9) + 1))
    const noPay = handleUseSkill(s, HUMAN_PLAYER_ID, { skillId: 'huanggai_kurou', targetIndices: [], cardIds: [] } as any)
    check('界苦肉必须先弃一张牌', !!noPay && 'error' in noPay, noPay)
    handleUseSkill(s, HUMAN_PLAYER_ID, { skillId: 'huanggai_kurou', targetIndices: [], cardIds: ['hg1'] } as any)
    check('弃1摸3并失去1体力', hg.hand.length === 4 && hg.hp === 3, `hand=${hg.hand.length} hp=${hg.hp}`)
    check('诈降给出红杀增益', (hg.extraSlashCount ?? 0) === 1 && !!hg.slashRedRangeTurn && !!hg.slashUnavoidableTurn)
    const again = handleUseSkill(s, HUMAN_PLAYER_ID, { skillId: 'huanggai_kurou', targetIndices: [], cardIds: [hg.hand[0].id] } as any)
    check('界苦肉限一次', !!again && 'error' in again, again)
    const redSlash = handleUseCard(s, HUMAN_PLAYER_ID, { cardId: 'hg2', targetIndices: [0] } as any)
    check('诈降后红色【杀】无距离限制', !(redSlash && 'error' in redSlash), redSlash)
    const zdDodge = s.pendingResponseQueue.find((p: any) => p.type === ResponseType.DODGE)
    check('诈降后红色【杀】不可被【闪】响应', (zdDodge?.context as any)?.unavoidable === true, zdDodge?.context)
}
{
    const s = build(['huanggai', 'huatuo', 'sunquan'], ['caocao', 'guojia', 'zhenji'])
    const hg = s.generals[3]
    hg.hand = []
    s.deck = Array.from({ length: 8 }, (_, i) => card('kd' + i, BasicCardName.PEACH, CardSuit.CLUB, (i % 9) + 1))
    handleUseSkill(s, HUMAN_PLAYER_ID, { skillId: 'huanggai_kurou', targetIndices: [], cardIds: [] } as any)
    check('原版苦肉无需弃牌、摸2张', hg.hand.length === 2 && hg.hp === 3, `hand=${hg.hand.length} hp=${hg.hp}`)
    check('原版苦肉不触发诈降', !hg.slashRedRangeTurn && !hg.slashUnavoidableTurn)
}

console.log('[界将分家]')
{
    const deckOf = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => card(prefix + i, BasicCardName.PEACH, CardSuit.CLUB, 3))
    // 张辽：基础放弃全部摸牌，界版少摸等量
    const base = build(['zhangliao', 'sunquan', 'huatuo'], ['caocao', 'guojia', 'zhenji'])
    const zlBase = base.generals[3]
    zlBase.hand = []
    base.generals[0].hand = [card('tx1', BasicCardName.DODGE, CardSuit.HEART, 2)]
    base.deck = deckOf('txd', 4)
    base.pendingResponseQueue = [{ type: ResponseType.SKILL_TUXI_CHOOSE, targetGeneralIndex: 3, context: { remainingPicks: 2 } }]
    handleRespond(base, HUMAN_PLAYER_ID, { targetIndex: 0 } as any)
    handleRespond(base, HUMAN_PLAYER_ID, {} as any)
    check('基础张辽突袭放弃全部摸牌', zlBase.hand.length === 1, `hand=${zlBase.hand.length}`)

    const jie = build(['zhangliao_jie', 'sunquan', 'huatuo'], ['caocao', 'guojia', 'zhenji'])
    const zlJie = jie.generals[3]
    zlJie.hand = []
    jie.generals[0].hand = [card('tx2', BasicCardName.DODGE, CardSuit.HEART, 2)]
    jie.deck = deckOf('txe', 4)
    jie.pendingResponseQueue = [{ type: ResponseType.SKILL_TUXI_CHOOSE, targetGeneralIndex: 3, context: { remainingPicks: 2 } }]
    handleRespond(jie, HUMAN_PLAYER_ID, { targetIndex: 0 } as any)
    handleRespond(jie, HUMAN_PLAYER_ID, {} as any)
    check('界张辽突袭少摸1张补摸1张', zlJie.hand.length === 2, `hand=${zlJie.hand.length}`)
}
{
    // 貂蝉闭月：基础摸1张，界貂蝉无手牌摸2张
    const base = build(['diaochan', 'sunquan', 'huatuo'], ['caocao', 'guojia', 'zhenji'])
    base.activeGeneralIndex = 3
    const dcBase = base.generals[3]
    dcBase.hand = []
    base.deck = Array.from({ length: 4 }, (_, i) => card('byd' + i, BasicCardName.PEACH, CardSuit.CLUB, 3))
    finishTurn(base)
    const byBase = findPending(base, 'diaochan_biyue')
    if (byBase) handleRespond(base, HUMAN_PLAYER_ID, { skillId: 'diaochan_biyue', action: 'confirm' } as any)
    check('基础貂蝉闭月摸1张', dcBase.hand.length === 1, `hand=${dcBase.hand.length} q=${queue(base)}`)

    const jie = build(['diaochan_jie', 'sunquan', 'huatuo'], ['caocao', 'guojia', 'zhenji'])
    jie.activeGeneralIndex = 3
    const dcJie = jie.generals[3]
    dcJie.hand = []
    jie.deck = Array.from({ length: 4 }, (_, i) => card('bye' + i, BasicCardName.PEACH, CardSuit.CLUB, 3))
    finishTurn(jie)
    const byJie = findPending(jie, 'diaochan_biyue')
    if (byJie) handleRespond(jie, HUMAN_PLAYER_ID, { skillId: 'diaochan_biyue', action: 'confirm' } as any)
    check('界貂蝉无手牌时闭月摸2张', dcJie.hand.length === 2, `hand=${dcJie.hand.length}`)
}
{
    // 华佗：基础青囊，界华佗青囊（红色可重复）
    const baseHuatuo = getGeneralById('huatuo')!
    const jieHuatuo = getGeneralById('huatuo_jie')!
    check('基础华佗拥有青囊', baseHuatuo.skills.some(s => s.id === 'huatuo_qingnang'))
    check('界华佗拥有青囊（可重复发动）',
        jieHuatuo.skills.some(s => s.id === 'huatuo_jie_qingnang')
        && jieHuatuo.skills.some(s => s.description.includes('再次发动')))
}
{
    // 洛书版第十一批：文聘改版、界孙坚、界姜维、界孙乾
    const wenpin = getGeneralById('wenpin')!
    const wenpinJing = getGeneralById('wenpin_jing')!
    check('文聘镇卫改为转移/无效', wenpin.skills.some(s => s.id === 'wenpin_zhenwei'
        && s.description.includes('转移')))
    check('文聘-竞保留距离镇卫',
        wenpinJing.name === '文聘-竞' && wenpinJing.skills.some(s => s.id === 'wenpin_zhenwei_jing'))

    const jiangweiJie = getGeneralById('jiangwei_jie')!
    check('界姜维拥有挑衅与志继',
        jiangweiJie.name === '界姜维' && jiangweiJie.maxHp === 4
        && jiangweiJie.skills.some(s => s.id === 'jiangwei_jie_tiaoxin')
        && jiangweiJie.skills.some(s => s.id === 'jiangwei_jie_zhiji'))

    const sunqianJie = getGeneralById('sunqian_jie')!
    check('界孙乾说盟改为无中生有/过河拆桥',
        sunqianJie.name === '界孙乾'
        && sunqianJie.skills.some(s => s.id === 'sunqian_jie_shuomeng' && s.description.includes('无中生有')))

    const sunjianJie = getGeneralById('sunjian_jie')!
    check('界孙坚体力上限改为5且英魂开局失血',
        sunjianJie.maxHp === 5
        && sunjianJie.skills.some(s => s.id === 'sunjian_jie_yinghun' && s.description.startsWith('游戏开始时')))
}
{
    // 说盟（界孙乾）：没赢时视为对孙乾使用【过河拆桥】，由对方选择拆哪张牌
    const tm = build(['sunqian_jie', 'sunquan', 'huatuo'], ['caocao', 'zhenji', 'machao'], 250)
    const tmSq = tm.generals[3]
    tmSq.hand = [
        card('sm-peach2', BasicCardName.PEACH, CardSuit.HEART, 5),
        card('sm-attack2', BasicCardName.ATTACK, CardSuit.SPADE, 2),
    ]
    tm.generals[4].hand = [card('sm-king2', BasicCardName.ATTACK, CardSuit.SPADE, 13)]
    tm.pendingResponseQueue = [{
        type: ResponseType.SKILL_SHUOMENG_CARD,
        targetGeneralIndex: 4,
        context: { phase: 'second', firstCard: tmSq.hand[1], firstOwnerIndex: 3, atActionEnd: false },
    }]
    handleRespond(tm, HUMAN_PLAYER_ID, { cardId: 'sm-king2' } as any)
    const smPrompt = tm.pendingResponseQueue.find(
        (p) => p.type === ResponseType.TRICK_TARGET_CARD_PICK)
    check('界孙乾说盟没赢时由对方选择拆牌',
        !!smPrompt && smPrompt.targetGeneralIndex === 4
        && (smPrompt.context as any)?.targetIndex === 3,
        queue(tm))
    if (smPrompt) {
        tm.pendingResponseQueue = [smPrompt]
        handleRespond(tm, HUMAN_PLAYER_ID, { action: 'hand', cardId: 'sm-peach2' } as any)
        check('界孙乾说盟拆牌按对方选择结算',
            !tmSq.hand.some(c => c.id === 'sm-peach2') && tmSq.hand.some(c => c.id === 'sm-attack2'),
            tmSq.hand.map(c => c.id))
    }
}
{
    // 缓释（诸葛瑾）：由判定角色选择诸葛瑾的一张手牌替换判定牌
    const s = build(['sunquan', 'zhugejin', 'huatuo'], ['caocao', 'zhenji', 'machao'], 260)
    s.deck = [card('hs-judge', BasicCardName.ATTACK, CardSuit.SPADE, 7)]
    const judge = s.generals[3]
    const zj = s.generals[4]
    zj.hand = [card('hs-card', BasicCardName.PEACH, CardSuit.HEART, 3)]
    performSkillJudge(s, judge, 'ganglie', '刚烈', {
        attackerGeneralIndex: 0, ganglieSourceIndex: 3,
    })
    const hsPrompt = s.pendingResponseQueue.find(p => p.type === ResponseType.JUDGE_INTERVENE)
    check('缓释由判定角色选择诸葛瑾手牌',
        hsPrompt?.targetGeneralIndex === 3
        && (hsPrompt?.context as any)?.huanshiOwnerIndex === 4, queue(s))
    if (hsPrompt) {
        handleRespond(s, HUMAN_PLAYER_ID, { cardId: 'hs-card' } as any)
        check('缓释消耗诸葛瑾手牌替换判定', zj.hand.length === 0, zj.hand.length)
    }
}
{
    // 弘援（诸葛瑾）：一次获得至少两张牌后，由诸葛瑾选择交牌角色与牌
    const s = build(['zhugejin', 'sunquan', 'huatuo'], ['caocao', 'zhenji', 'machao'], 270)
    s.pendingResponseQueue = []
    const zj = s.generals[3]
    zj.hand = [
        card('hy1', BasicCardName.DODGE, CardSuit.HEART, 2),
        card('hy2', BasicCardName.PEACH, CardSuit.HEART, 3),
    ]
    maybeHongyuan(s, zj, 2)
    const hyConfirm = s.pendingResponseQueue.find(p => (p.context as any)?.skillId === 'zhugejin_hongyuan')
    check('弘援在一次获得两张牌后询问', !!hyConfirm, queue(s))
    if (hyConfirm) {
        handleRespond(s, HUMAN_PLAYER_ID, { action: 'confirm' } as any)
        const hyTargets = s.pendingResponseQueue.find(p => (p.context as any)?.skillId === 'zhugejin_hongyuan')
        check('弘援由诸葛瑾选择交牌角色',
            hyTargets?.type === ResponseType.SKILL_CHOOSE_TARGET
            && (hyTargets.context as any)?.multi === true, queue(s))
        if (hyTargets) {
            handleRespond(s, HUMAN_PLAYER_ID, { targetIndices: [4, 5] } as any)
            const give1 = s.pendingResponseQueue.find(p => p.type === ResponseType.SKILL_GIVE_CARDS)
            check('弘援依次询问第一名角色的交牌',
                (give1?.context as any)?.toIndex === 4, queue(s))
            if (give1) {
                handleRespond(s, HUMAN_PLAYER_ID, { cardIds: ['hy1'] } as any)
                const give2 = s.pendingResponseQueue.find(p => p.type === ResponseType.SKILL_GIVE_CARDS)
                check('弘援继续询问第二名角色的交牌',
                    (give2?.context as any)?.toIndex === 5, queue(s))
                if (give2) handleRespond(s, HUMAN_PLAYER_ID, { cardIds: ['hy2'] } as any)
                check('弘援把牌交给所选角色',
                    s.generals[4].hand.some(c => c.id === 'hy1')
                    && s.generals[5].hand.some(c => c.id === 'hy2'),
                    `4:${s.generals[4].hand.map(c => c.id)} 5:${s.generals[5].hand.map(c => c.id)}`)
            }
        }
    }
}
{
    // 界华佗青囊：弃红牌可再次发动，但每名角色每阶段限一次
    const s = build(['huatuo_jie', 'sunquan', 'guojia'], ['caocao', 'zhenji', 'machao'])
    const ht = s.generals[3]
    s.turnPhase = TurnPhase.ACTION
    s.activeGeneralIndex = 3
    s.activePlayerFaction = Faction.COOL
    ht.hand = [
        card('qn1', BasicCardName.DODGE, CardSuit.HEART, 2),
        card('qn2', BasicCardName.PEACH, CardSuit.HEART, 3),
    ]
    s.generals[0].hp = 2
    const qnFirst = handleUseSkill(s, HUMAN_PLAYER_ID, {
        skillId: 'huatuo_qingnang', targetIndices: [0], cardIds: ['qn1'],
    } as any)
    check('界华佗青囊弃红牌回复并可再次发动',
        !(qnFirst && 'error' in qnFirst) && s.generals[0].hp === 3, qnFirst)
    const qnSame = handleUseSkill(s, HUMAN_PLAYER_ID, {
        skillId: 'huatuo_qingnang', targetIndices: [0], cardIds: ['qn2'],
    } as any)
    check('界华佗青囊每名角色每阶段限一次', !!qnSame && 'error' in qnSame, qnSame)
}
{
    // 镇卫（文聘）：另一角色成为【杀】的唯一目标时可转移
    const s = build(['wenpin', 'sunquan', 'huatuo'], ['caocao', 'zhenji', 'machao'])
    const wp = s.generals[3]
    const victim = s.generals[5]
    victim.hp = 3
    wp.hand = [
        card('zw1', BasicCardName.DODGE, CardSuit.HEART, 2),
        card('zw2', BasicCardName.PEACH, CardSuit.HEART, 3),
    ]
    s.generals[0].hand = [card('zw-slash', BasicCardName.ATTACK, CardSuit.SPADE, 7)]
    s.deck = [card('zw-d', BasicCardName.PEACH, CardSuit.CLUB, 3)]
    s.activeGeneralIndex = 0
    s.activePlayerFaction = Faction.COOL
    const zwBefore = wp.hand.length
    handleUseCard(s, AI_PLAYER_ID, { cardId: 'zw-slash', targetIndices: [5] } as any)
    check('镇卫在目标体力低于文聘时询问', !!findPending(s, 'wenpin_zhenwei'), queue(s))
    s.pendingResponseQueue = [findPending(s, 'wenpin_zhenwei')!].filter(Boolean)
    handleRespond(s, HUMAN_PLAYER_ID, { action: 'transfer' } as any)
    const zwPick = s.pendingResponseQueue.find(p => p.type === ResponseType.SKILL_PICK_CARD)
    check('镇卫询问弃置哪张牌', !!zwPick, queue(s))
    if (zwPick) {
        s.pendingResponseQueue = [zwPick]
        handleRespond(s, HUMAN_PLAYER_ID, { cardIds: ['zw2'] } as any)
        check('镇卫转移后文聘摸一张牌', wp.hand.length === zwBefore, `${zwBefore} -> ${wp.hand.length}`)
        check('镇卫转移后【杀】的目标改为文聘',
            s.pendingResponseQueue.some(p => p.type === ResponseType.DODGE && p.targetGeneralIndex === 3),
            queue(s))
    }
}
{
    // 挑衅（界姜维）：可选择攻击范围外的角色，但对方不能出杀
    const s = build(['jiangwei_jie', 'sunquan', 'huatuo'], ['caocao', 'zhenji', 'machao'])
    const res = handleUseSkill(s, HUMAN_PLAYER_ID, {
        skillId: 'jiangwei_tiaoxin', targetIndices: [0],
    } as any)
    check('界姜维挑衅可选攻击范围外的角色', !(res && 'error' in res), res)
    const tx = s.pendingResponseQueue.find(p => p.type === ResponseType.SKILL_TIAOXIN_RESPONSE)
    check('界姜维挑衅标记范围外不能出杀', (tx?.context as any)?.tiaoxinCanSlash === false, tx?.context)
    const bad = handleRespond(s, AI_PLAYER_ID, { cardId: 'not-there' } as any)
    check('界姜维挑衅：范围外出杀被拒', !!bad && 'error' in bad, bad)
}
{
    // 郭嘉遗计与贾诩帷幕的界限版本独立
    const baseGuojia = getGeneralById('guojia')!
    const jieGuojia = getGeneralById('guojia_jie')!
    check('郭嘉遗计分家为独立技能',
        baseGuojia.skills.some(s => s.id === 'guojia_yiji')
        && jieGuojia.skills.some(s => s.id === 'guojia_jie_yiji'))
}

console.log('[第四类：界限突破效果]')
{
    // 帷幕②（界贾诩）：自己回合内受到伤害时防止并摸2倍
    const base = build(['jiaxu', 'sunquan', 'huatuo'], ['caocao', 'guojia', 'zhenji'])
    base.activeGeneralIndex = 3
    const jxBase = base.generals[3]
    jxBase.hp = 3
    dealDamage(base, null, jxBase, 1)
    check('基础贾诩帷幕不防止回合内伤害', jxBase.hp === 2, `hp=${jxBase.hp}`)

    const jie = build(['jiaxu_jie', 'sunquan', 'huatuo'], ['caocao', 'guojia', 'zhenji'])
    jie.activeGeneralIndex = 3
    const jxJie = jie.generals[3]
    jxJie.hp = 3
    jxJie.hand = []
    jie.deck = Array.from({ length: 6 }, (_, i) => card('wmd' + i, BasicCardName.PEACH, CardSuit.CLUB, 3))
    dealDamage(jie, null, jxJie, 1)
    check('界贾诩帷幕②防止伤害并摸2张', jxJie.hp === 3 && jxJie.hand.length === 2, `hp=${jxJie.hp} hand=${jxJie.hand.length}`)
}
{
    // 激昂②（界孙策）：失去1点体力，获得因弃置进入弃牌堆的红色【杀】
    const s = build(['sunce_jie', 'sunquan', 'huatuo'], ['caocao', 'guojia', 'zhenji'])
    const sc = s.generals[3]
    sc.hp = 4
    sc.hand = []
    const redSlash = card('jj1', BasicCardName.ATTACK, CardSuit.HEART, 7)
    s.discard = [redSlash]
    triggerJiangJieDiscard(s, [redSlash])
    const pend = findPending(s, 'sunce_jiang_jie')
    check('界孙策激昂②触发询问', !!pend, queue(s))

    const s2 = build(['sunce', 'sunquan', 'huatuo'], ['caocao', 'guojia', 'zhenji'])
    const sc2 = s2.generals[3]
    const redSlash2 = card('jj2', BasicCardName.ATTACK, CardSuit.HEART, 8)
    s2.discard = [redSlash2]
    triggerJiangJieDiscard(s2, [redSlash2])
    check('基础孙策没有激昂②', !findPending(s2, 'sunce_jiang_jie'))
}
{
    // 魂姿②（界孙策）：觉醒回合的结束阶段选择摸两张或回复1点体力
    const s = build(['sunce_jie', 'sunquan', 'huatuo'], ['caocao', 'guojia', 'zhenji'])
    s.activeGeneralIndex = 3
    const sc = s.generals[3]
    sc.hp = 2
    sc.hand = []
    sc.hunziEndChoice = true
    s.deck = Array.from({ length: 6 }, (_, i) => card('hzd' + i, BasicCardName.PEACH, CardSuit.CLUB, 3))
    finishTurn(s)
    const pend = findPending(s, 'sunce_hunzi_end')
    check('魂姿②在结束阶段给出选项', !!pend, queue(s))
    const handBefore = sc.hand.length
    if (pend) handleRespond(s, HUMAN_PLAYER_ID, { skillId: 'sunce_hunzi_end', action: 'draw' } as any)
    check('魂姿②选择摸两张牌', sc.hand.length === handBefore + 2, `hand=${sc.hand.length}`)
}
{
    // 观星②（界诸葛亮）：全部置底后本回合结束阶段可再次观星
    const s = build(['zhugeliang_jie', 'sunquan', 'huatuo'], ['caocao', 'guojia', 'zhenji'])
    const zg = s.generals[3]
    s.deck = Array.from({ length: 5 }, (_, i) => card('gx' + i, BasicCardName.PEACH, CardSuit.CLUB, 3))
    const viewed = s.deck.splice(0, 5)
    s.pendingResponseQueue = [{
        type: ResponseType.SKILL_GUANXING_ARRANGE,
        targetGeneralIndex: 3,
        context: { guanxingCards: viewed },
    }]
    handleRespond(s, HUMAN_PLAYER_ID, { topCardIds: [], bottomCardIds: viewed.map(c => c.id) } as any)
    check('界诸葛亮全部置底后获得再次观星', zg.guanxingEndAgain === true && s.deck.length === 5)
}
{
    // 完杀②（界贾诩）：濒死期间其他角色的非锁定技失效
    const jie = build(['jiaxu_jie', 'sunquan', 'huatuo'], ['caocao', 'guojia', 'zhenji'])
    jie.activeGeneralIndex = 3
    jie.generals[0].hp = 0
    jie.pendingResponseQueue = [{
        type: ResponseType.PEACH_SAVE_ASK,
        targetGeneralIndex: 4,
        context: { dyingGeneralIndex: 0, attackerGeneralIndex: 3, remainingAskers: [], neededHp: 1 },
    }]
    const res = handleRespond(jie, HUMAN_PLAYER_ID, { action: 'jijiu', cardId: 'x' } as any)
    check('完杀②压制其他角色的非锁定技', !!res && 'error' in res && res.error.includes('完杀'), res)

    const base = build(['jiaxu', 'sunquan', 'huatuo'], ['caocao', 'guojia', 'zhenji'])
    base.activeGeneralIndex = 3
    base.generals[0].hp = 0
    base.pendingResponseQueue = [{
        type: ResponseType.PEACH_SAVE_ASK,
        targetGeneralIndex: 4,
        context: { dyingGeneralIndex: 0, attackerGeneralIndex: 3, remainingAskers: [], neededHp: 1 },
    }]
    const resBase = handleRespond(base, HUMAN_PLAYER_ID, { action: 'jijiu', cardId: 'x' } as any)
    check('基础贾诩不压制技能（仅限制桃）', !resBase || !String((resBase as any).error ?? '').includes('完杀'), resBase)
}
{
    // 乱武②（界贾诩）：结算结束后可视为使用一张无距离限制的【杀】
    const s = build(['jiaxu_jie', 'sunquan', 'huatuo'], ['caocao', 'guojia', 'zhenji'])
    s.pendingResponseQueue = [{
        type: ResponseType.SKILL_LUANWU_EXTRA_SLASH,
        targetGeneralIndex: 3,
        context: { candidateIndices: [0, 1, 2] },
    }]
    handleRespond(s, HUMAN_PLAYER_ID, { targetIndex: 0 } as any)
    check('乱武②可视为使用无距离限制的【杀】',
        s.pendingResponseQueue.some(p => p.type === ResponseType.DODGE))
}
{
    // 明策②（界陈宫）：选择摸牌时陈宫与其各摸一张
    const s = build(['chengong_jie', 'sunquan', 'huatuo'], ['caocao', 'guojia', 'zhenji'])
    const cg = s.generals[3]
    const receiver = s.generals[0]
    cg.hand = []
    receiver.hand = []
    s.deck = Array.from({ length: 6 }, (_, i) => card('mcd' + i, BasicCardName.PEACH, CardSuit.CLUB, 3))
    s.pendingResponseQueue = [{
        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
        targetGeneralIndex: 0,
        context: { skillId: 'chengong_mingce', skillName: '明策', mingceSlashTargetIndex: -1, mingceFromIndex: 3 },
    }]
    handleRespond(s, AI_PLAYER_ID, { action: 'mingce_draw' } as any)
    check('界陈宫明策双方各摸一张', cg.hand.length === 1 && receiver.hand.length === 1,
        `cg=${cg.hand.length} receiver=${receiver.hand.length}`)
}

{
    // 断粮②（界徐晃）：对手牌数不少于自己的角色无距离限制
    const jie = build(['xuhuang_jie', 'sunquan', 'huatuo'], ['caocao', 'guojia', 'zhenji'])
    const xhJie = jie.generals[3]
    xhJie.hand = Array.from({ length: 4 }, (_, i) => card('dl' + i, BasicCardName.ATTACK, CardSuit.SPADE, 7))
    jie.generals[0].hand = Array.from({ length: 4 }, (_, i) => card('dd' + i, BasicCardName.DODGE, CardSuit.HEART, 2))
    const jieRes = handleUseSkill(jie, HUMAN_PLAYER_ID, { skillId: 'xuhuang_jie_duanliang', targetIndices: [0], cardIds: ['dl0'] } as any)
    check('界徐晃断粮对手牌不少于自己的角色无距离限制', !(jieRes && 'error' in jieRes), jieRes)

    const base = build(['xuhuang_jie', 'sunquan', 'huatuo'], ['caocao', 'guojia', 'zhenji'])
    const xh = base.generals[3]
    xh.hand = Array.from({ length: 4 }, (_, i) => card('dm' + i, BasicCardName.ATTACK, CardSuit.SPADE, 7))
    base.generals[0].hand = Array.from({ length: 2 }, (_, i) => card('dn' + i, BasicCardName.DODGE, CardSuit.HEART, 2))
    const baseRes = handleUseSkill(base, HUMAN_PLAYER_ID, { skillId: 'xuhuang_jie_duanliang', targetIndices: [0], cardIds: ['dm0'] } as any)
    check('界徐晃断粮对手牌少于自己的角色仍受距离限制', !!baseRes && 'error' in baseRes && baseRes.error.includes('距离'), baseRes)
}
{
    // 集智②（界黄月英）：摸到的基本牌可弃置换取手牌上限+1
    const jie = build(['huangyueying_jie', 'sunquan', 'huatuo'], ['caocao', 'guojia', 'zhenji'])
    const hyyJie = jie.generals[3]
    hyyJie.hand = [card('jc1', TrickCardName.DISMANTLE, CardSuit.SPADE, 3, CardCategory.TRICK, { trickType: 'instant' })]
    jie.generals[0].hand = [card('jct', BasicCardName.DODGE, CardSuit.HEART, 2)]
    jie.deck = [card('jcd1', BasicCardName.DODGE, CardSuit.HEART, 2)]
    handleUseCard(jie, HUMAN_PLAYER_ID, { cardId: 'jc1', targetIndices: [0] } as any)
    check('界黄月英集智②摸到基本牌可弃置换上限', !!findPending(jie, 'huangyueying_jizhi'), queue(jie))

    const base = build(['huangyueying', 'sunquan', 'huatuo'], ['caocao', 'guojia', 'zhenji'])
    const hyy = base.generals[3]
    hyy.hand = [card('jc2', TrickCardName.DISMANTLE, CardSuit.SPADE, 3, CardCategory.TRICK, { trickType: 'instant' })]
    base.generals[0].hand = [card('jcu', BasicCardName.DODGE, CardSuit.HEART, 2)]
    base.deck = [card('jcd2', BasicCardName.DODGE, CardSuit.HEART, 2)]
    handleUseCard(base, HUMAN_PLAYER_ID, { cardId: 'jc2', targetIndices: [0] } as any)
    check('基础黄月英集智无②选项', !findPending(base, 'huangyueying_jizhi'), queue(base))
}
{
    // 激昂②（界孙策）：确认后失去1点体力并获得该牌
    const s = build(['sunce_jie', 'sunquan', 'huatuo'], ['caocao', 'guojia', 'zhenji'])
    const sc = s.generals[3]
    sc.hp = 4
    sc.hand = []
    const redSlash = card('jj3', BasicCardName.ATTACK, CardSuit.DIAMOND, 9)
    s.discard = [redSlash]
    triggerJiangJieDiscard(s, [redSlash])
    handleRespond(s, HUMAN_PLAYER_ID, { skillId: 'sunce_jiang_jie', action: 'confirm' } as any)
    check('界孙策激昂②失去1点体力并获得该牌',
        sc.hp === 3 && sc.hand.some(c => c.id === 'jj3') && !s.discard.some(c => c.id === 'jj3'),
        `hp=${sc.hp} hand=${sc.hand.map(c => c.id).join(',')}`)
}

console.log('[述志]')
{
    const s = build(['caocao_jie', 'sunquan', 'huatuo'], ['guojia', 'zhenji', 'xiahoudun'], 61)
    const cc = s.generals[3]
    cc.hand = [
        card('sz1', BasicCardName.PEACH, CardSuit.HEART, 3),
        card('sz2', BasicCardName.ATTACK, CardSuit.SPADE, 7),
    ]
    s.generals[0].hand = [card('sz3', BasicCardName.ATTACK, CardSuit.CLUB, 8)]
    triggerShuzhiChoose(s)
    const prompt = findPending(s, 'caocao_jie_shuzhi')
    check('开局询问述志', !!prompt, queue(s))
    check('述志不可放弃', (prompt?.context as any)?.mandatory === true)
    handleRespond(s, HUMAN_PLAYER_ID, { action: 'qingzheng' } as any)
    check('述志可选择清正', cc.shuzhiLimited === 'caocao_jie_qingzheng')
    check('述志询问已结算', !findPending(s, 'caocao_jie_shuzhi'), queue(s))
}
{
    const s = build(['sunquan', 'huatuo', 'guojia'], ['caocao_jie', 'zhenji', 'xiahoudun'], 67)
    const cc = s.generals[0]
    cc.hand = [
        card('sz4', BasicCardName.ATTACK, CardSuit.SPADE, 7),
        card('sz5', BasicCardName.DODGE, CardSuit.HEART, 2),
    ]
    s.generals[3].hand = [card('sz6', BasicCardName.DODGE, CardSuit.CLUB, 3)]
    triggerShuzhiChoose(s)
    handleRespond(s, AI_PLAYER_ID, { action: 'decline' } as any)
    check('述志不可放弃，放弃时默认保留奸雄', cc.shuzhiLimited === 'caocao_jie_jianxiong', cc.shuzhiLimited)
}
{
    const s = build(['sunquan', 'huatuo', 'guojia'], ['caocao_jie', 'zhenji', 'xiahoudun'], 68)
    const cc = s.generals[0]
    cc.hand = [
        card('sz7', BasicCardName.ATTACK, CardSuit.SPADE, 7),
        card('sz8', BasicCardName.DODGE, CardSuit.HEART, 2),
    ]
    s.generals[3].hand = [card('sz9', BasicCardName.DODGE, CardSuit.CLUB, 3)]
    triggerShuzhiChoose(s)
    aiAct(s, AI_PLAYER_ID)
    check('规则 AI 会自动完成述志', !!cc.shuzhiLimited && !findPending(s, 'caocao_jie_shuzhi'),
        `${cc.shuzhiLimited} ${queue(s)}`)
}
{
    // 统率三军：述志尚未结算时先完成让先/行动单元选择，述志结算后回合要能继续
    const s = build(['caocao_jie', 'sunquan', 'huatuo'], ['guojia', 'xiahoudun', 'zhenji'], 69)
    s.phase = GamePhase.PLAYING
    s.turnPhase = TurnPhase.TURN_START
    s.activeGeneralIndex = -1
    s.roundState = {
        roundNumber: 0, firstMover: Faction.COOL, waitingForYield: true, currentActionStep: 0,
    }
    s.deck = Array.from({ length: 10 }, (_, i) => card('szd' + i, BasicCardName.PEACH, CardSuit.CLUB, (i % 9) + 1))
    triggerShuzhiChoose(s)
    handleYieldChoice(s, AI_PLAYER_ID, false)
    const unitChoice = chooseActionUnit(s, AI_PLAYER_ID, ActionUnitType.COMMANDER)
    check('述志未结算也能选择行动单元', !unitChoice || !('error' in unitChoice), unitChoice)
    handleRespond(s, HUMAN_PLAYER_ID, { action: 'jianxiong' } as any)
    check('述志结算后继续已选中的回合',
        s.activeGeneralIndex === 1 && String(s.turnPhase) === TurnPhase.ACTION && s.generals[1].hand.length === 2,
        `active=${s.activeGeneralIndex} phase=${s.turnPhase} hand=${s.generals[1].hand.length} ${queue(s)}`)
}
{
    const s = build(['caocao_jie', 'sunquan', 'huatuo'], ['guojia', 'zhenji', 'xiahoudun'], 62)
    const cc = s.generals[3]
    cc.hand = [card('qz1', BasicCardName.ATTACK, CardSuit.SPADE, 7)]
    s.generals[0].hand = [card('qz2', BasicCardName.DODGE, CardSuit.HEART, 2)]
    triggerQingzheng(s, cc)
    check('未使用的限定清正仍可发动', !!findPending(s, 'caocao_jie_qingzheng'), queue(s))
    s.pendingResponseQueue = []
    cc.shuzhiLimited = 'caocao_jie_qingzheng'
    cc.usedLimitedSkills = ['caocao_jie_qingzheng']
    triggerQingzheng(s, cc)
    check('限定清正用过后不再询问', !findPending(s, 'caocao_jie_qingzheng'), queue(s))
}
{
    const s = build(['caocao_jie', 'sunquan', 'huatuo'], ['guojia', 'zhenji', 'xiahoudun'], 63)
    const cc = s.generals[3]
    cc.shuzhiLimited = 'caocao_jie_jianxiong'
    cc.usedLimitedSkills = []
    s.deck = [card('jx1', BasicCardName.PEACH, CardSuit.HEART, 5)]
    dealDamage(s, s.generals[0], cc, 1, 'dmg1')
    check('限定奸雄首次可发动', !!findPending(s, 'caocao_jianxiong'), queue(s))
    const jx = findPending(s, 'caocao_jianxiong')
    if (jx) {
        s.pendingResponseQueue = [jx]
        handleRespond(s, HUMAN_PLAYER_ID, { action: 'confirm' } as any)
    }
    check('奸雄发动后标记限定技已用', cc.usedLimitedSkills.includes('caocao_jie_jianxiong'), cc.usedLimitedSkills)
    s.pendingResponseQueue = []
    dealDamage(s, s.generals[0], cc, 1, 'dmg2')
    check('限定奸雄用过后不再询问', !findPending(s, 'caocao_jianxiong'), queue(s))
}
{
    const s = build(['zhangliao_jie', 'sunquan', 'huatuo'], ['guojia', 'zhenji', 'xiahoudun'], 64)
    const zl = s.generals[3]
    zl.hand = []
    s.generals[0].hand = [card('tx1', BasicCardName.ATTACK, CardSuit.SPADE, 7)]
    s.deck = [card('txd1', BasicCardName.PEACH, CardSuit.HEART, 1), card('txd2', BasicCardName.DODGE, CardSuit.DIAMOND, 2)]
    s.pendingResponseQueue = [{
        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
        targetGeneralIndex: 3,
        context: { skillId: 'zhangliao_tuxi', skillName: '突袭', skipAction: false },
    }]
    handleRespond(s, HUMAN_PLAYER_ID, { action: 'confirm', targetIndices: [0] } as any)
    check('突袭直接获得选定目标的手牌', zl.hand.some(c => c.id === 'tx1'), zl.hand.map(c => c.id))
    check('突袭不再二次询问目标', !s.pendingResponseQueue.some(p => p.type === ResponseType.SKILL_TUXI_CHOOSE), queue(s))
    check('界张辽按已选目标数少摸并补摸', zl.hand.length === 2, zl.hand.map(c => c.id))
    check('突袭后进入出牌阶段', s.turnPhase === TurnPhase.ACTION)
}
{
    const s = build(['zhangliao', 'sunquan', 'huatuo'], ['guojia', 'zhenji', 'xiahoudun'], 65)
    const zl = s.generals[3]
    zl.hand = []
    s.generals[0].hand = [card('tx2', BasicCardName.ATTACK, CardSuit.SPADE, 8)]
    s.deck = [card('txd3', BasicCardName.PEACH, CardSuit.HEART, 1)]
    s.pendingResponseQueue = [{
        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
        targetGeneralIndex: 3,
        context: { skillId: 'zhangliao_tuxi', skillName: '突袭', skipAction: false },
    }]
    handleRespond(s, HUMAN_PLAYER_ID, { action: 'confirm', targetIndices: [0] } as any)
    check('基础张辽放弃摸牌不补摸', zl.hand.length === 1 && zl.hand[0].id === 'tx2', zl.hand.map(c => c.id))
}
{
    const s = build(['sunjian', 'sunquan', 'huatuo'], ['guojia', 'zhenji', 'xiahoudun'], 66)
    const sj = s.generals[3]
    sj.hp = 4
    sj.usedLimitedSkills = []
    s.pendingResponseQueue = [
        {
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: 3,
            context: { skillId: 'sunjian_wulie', skillName: '武烈', endPhaseSkill: true, targetSelectOnActivate: true, maxTargets: 3 },
        },
        { type: ResponseType.SKILL_ACTIVATE_CONFIRM, targetGeneralIndex: 0, context: { skillId: 'dummy' } },
    ]
    handleRespond(s, HUMAN_PLAYER_ID, { action: 'confirm', targetIndices: [1] } as any)
    check('武烈只给选定角色“烈”',
        s.generals[1].lieMarks === 1 && !s.generals[0].lieMarks && !s.generals[2].lieMarks,
        s.generals.map(g => g.lieMarks ?? 0))
    check('武烈按目标数失去体力', sj.hp === 3, sj.hp)
    check('武烈标记限定技已用', sj.usedLimitedSkills.includes('sunjian_wulie'), sj.usedLimitedSkills)
}

console.log('[技能发动时一并选目标/选牌]')
{
    // 陷嗣（刘封）：确认时已选好目标 → 直接结算，不再弹出选目标询问
    const s = build(['liufeng', 'sunquan', 'huatuo'], ['guojia', 'zhenji', 'xiahoudun'], 67)
    const lf = s.generals[3]
    lf.hand = []
    s.generals[0].hand = [card('xs1', BasicCardName.DODGE, CardSuit.HEART, 2)]
    s.pendingResponseQueue = [{
        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
        targetGeneralIndex: 3,
        context: { skillId: 'liufeng_xiansi', skillName: '陷嗣' },
    }]
    handleRespond(s, HUMAN_PLAYER_ID, { action: 'confirm', targetIndices: [0] } as any)
    check('陷嗣直接结算选定目标', (lf.generalPile?.length ?? 0) === 1, lf.generalPile?.map(c => c.id))
    check('陷嗣不再二次询问目标',
        !s.pendingResponseQueue.some(p => p.type === ResponseType.SKILL_CHOOSE_TARGET), queue(s))
}
{
    // 巧变（张郃）：确认时已选好手牌 → 直接弃置并跳过阶段
    const s = build(['zhanghe', 'sunquan', 'huatuo'], ['guojia', 'zhenji', 'xiahoudun'], 68)
    const zh = s.generals[3]
    zh.hand = [card('qb1', BasicCardName.PEACH, CardSuit.HEART, 3)]
    s.deck = [card('qbd1', BasicCardName.PEACH, CardSuit.CLUB, 4), card('qbd2', BasicCardName.PEACH, CardSuit.CLUB, 5)]
    s.pendingResponseQueue = [{
        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
        targetGeneralIndex: 3,
        context: { skillId: 'zhanghe_qiaobian', skillName: '巧变', qiaobianPhase: 'draw', qiaobianSkipAction: false },
    }]
    handleRespond(s, HUMAN_PLAYER_ID, { action: 'confirm', cardIds: ['qb1'] } as any)
    check('巧变直接用已选牌弃置', s.discard.some((c: any) => c.id === 'qb1'), s.discard.map((c: any) => c.id))
    check('巧变不再二次询问选牌',
        !s.pendingResponseQueue.some(p => p.type === ResponseType.SKILL_PICK_CARD), queue(s))
}
{
    // 视图层声明：界面据此在“是否发动”时就允许点角色/手牌
    const s = build(['zhangliao', 'sunquan', 'huatuo'], ['guojia', 'zhenji', 'xiahoudun'], 69)
    s.generals[0].hand = [card('vt1', BasicCardName.DODGE, CardSuit.HEART, 2)]
    s.pendingResponseQueue = [{
        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
        targetGeneralIndex: 3,
        context: { skillId: 'zhangliao_tuxi', skillName: '突袭' },
    }]
    const view = toClientView(s, HUMAN_PLAYER_ID) as any
    const ctx = view.pendingResponse?.context ?? {}
    check('突袭询问声明可提前选目标',
        ctx.targetSelectOnActivate === true && ctx.targetCandidates?.includes(0), ctx)
    check('突袭询问给出目标数上限', ctx.maxTargets === 2, ctx.maxTargets)

    const s2 = build(['zhanghe', 'sunquan', 'huatuo'], ['guojia', 'zhenji', 'xiahoudun'], 70)
    s2.generals[3].hand = [card('vt2', BasicCardName.PEACH, CardSuit.HEART, 3)]
    s2.pendingResponseQueue = [{
        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
        targetGeneralIndex: 3,
        context: { skillId: 'zhanghe_qiaobian', skillName: '巧变', qiaobianPhase: 'draw' },
    }]
    const ctx2 = ((toClientView(s2, HUMAN_PLAYER_ID) as any).pendingResponse?.context) ?? {}
    check('巧变询问声明可提前选牌',
        ctx2.cardSelectOnActivate === true && ctx2.maxCards === 1, ctx2)
}
{
    // 下书（阚泽）：确认时选好受牌者 → 直接交牌
    const s = build(['kanze', 'sunquan', 'huatuo'], ['guojia', 'zhenji', 'xiahoudun'], 71)
    const kz = s.generals[3]
    kz.hand = [
        card('xs1', BasicCardName.ATTACK, CardSuit.SPADE, 7),
        card('xs2', BasicCardName.DODGE, CardSuit.HEART, 2),
    ]
    s.generals[0].hand = []
    s.pendingResponseQueue = [{
        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
        targetGeneralIndex: 3,
        context: { skillId: 'kanze_xiashu', skillName: '下书' },
    }]
    handleRespond(s, HUMAN_PLAYER_ID, { action: 'confirm', targetIndices: [0] } as any)
    check('下书直接把所有手牌交给选定角色', s.generals[0].hand.length === 2, s.generals[0].hand.map((c: any) => c.id))
    check('下书不再二次询问目标',
        !s.pendingResponseQueue.some(p => p.type === ResponseType.SKILL_CHOOSE_TARGET), queue(s))
}
{
    // 推锋（李通）：确认时选好手牌 → 直接置于武将牌上
    const s = build(['litong', 'sunquan', 'huatuo'], ['guojia', 'zhenji', 'xiahoudun'], 72)
    const lt = s.generals[3]
    lt.hand = [card('tf1', BasicCardName.ATTACK, CardSuit.SPADE, 9)]
    s.pendingResponseQueue = [{
        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
        targetGeneralIndex: 3,
        context: { skillId: 'litong_tuifeng', skillName: '推锋' },
    }]
    handleRespond(s, HUMAN_PLAYER_ID, { action: 'confirm', cardIds: ['tf1'] } as any)
    check('推锋直接用已选牌置于武将牌上',
        (lt.generalPile ?? []).some((c: any) => c.id === 'tf1'), lt.generalPile?.map((c: any) => c.id))
    check('推锋不再二次询问选牌',
        !s.pendingResponseQueue.some(p => p.type === ResponseType.SKILL_PICK_CARD), queue(s))
}
{
    // 天香（洛书版）：确认时同时给出♥牌与转移目标 → 不再二次询问
    const s = build(['xiaoqiao', 'sunquan', 'huatuo'], ['guojia', 'zhenji', 'xiahoudun'], 74)
    const xq = s.generals[3]
    xq.hand = [card('txh', BasicCardName.DODGE, CardSuit.HEART, 2)]
    s.pendingResponseQueue = [{
        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
        targetGeneralIndex: 3,
        context: { skillId: 'xiaoqiao_tianxiang', skillName: '天香', damageAmount: 1, attackerIndex: 0 },
    }]
    const txCtx = ((toClientView(s, HUMAN_PLAYER_ID) as any).pendingResponse?.context) ?? {}
    check('天香询问声明可提前选牌与目标',
        txCtx.cardSelectOnActivate === true && txCtx.targetSelectOnActivate === true, txCtx)
    check('天香候选牌只列♥',
        Array.isArray(txCtx.candidateCardIds) && txCtx.candidateCardIds.length === 1
        && txCtx.candidateCardIds[0] === 'txh', txCtx.candidateCardIds)
    handleRespond(s, HUMAN_PLAYER_ID, { action: 'confirm', cardIds: ['txh'], targetIndices: [0] } as any)
    check('天香弃掉所选的♥牌', s.discard.some((c: any) => c.id === 'txh'), s.discard.map((c: any) => c.id))
    check('天香直接进入转移后续选择',
        s.pendingResponseQueue[0]?.type === ResponseType.SKILL_TIANXIANG_LUOSHU_OPTION, queue(s))
    check('天香不再二次询问转移目标',
        !s.pendingResponseQueue.some(p => p.type === ResponseType.SKILL_TIANXIANG_CHOOSE), queue(s))
}
{
    // 强识（界张松）：确认时选好目标 → 直接观看并记录类别
    const s = build(['zhangsong_jie', 'sunquan', 'huatuo'], ['guojia', 'zhenji', 'xiahoudun'], 75)
    const zs = s.generals[3]
    s.generals[0].hand = [card('qs1', BasicCardName.ATTACK, CardSuit.SPADE, 7)]
    s.pendingResponseQueue = [{
        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
        targetGeneralIndex: 3,
        context: { skillId: 'zhangsong_qiangshi', skillName: '强识' },
    }]
    const qsCtx = ((toClientView(s, HUMAN_PLAYER_ID) as any).pendingResponse?.context) ?? {}
    check('强识询问声明可提前选目标', qsCtx.targetSelectOnActivate === true, qsCtx)
    handleRespond(s, HUMAN_PLAYER_ID, { action: 'confirm', targetIndices: [0] } as any)
    check('强识按已选目标直接结算', zs.qiangshiCategory === CardCategory.BASIC, zs.qiangshiCategory)
    check('强识不再二次询问目标',
        !s.pendingResponseQueue.some(p => p.type === ResponseType.SKILL_CHOOSE_TARGET), queue(s))
}
{
    // 献图（界张松）：选项询问上先选好交牌 → 摸牌后直接交出
    const s = build(['zhangsong_jie', 'sunquan', 'huatuo'], ['guojia', 'zhenji', 'xiahoudun'], 76)
    const zs = s.generals[3]
    zs.hand = [card('xt1', BasicCardName.ATTACK, CardSuit.SPADE, 3), card('xt2', BasicCardName.DODGE, CardSuit.HEART, 4)]
    s.deck = [card('xtd1', BasicCardName.PEACH, CardSuit.CLUB, 5), card('xtd2', BasicCardName.PEACH, CardSuit.CLUB, 6)]
    const before = s.generals[0].hand.length
    s.pendingResponseQueue = [{
        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
        targetGeneralIndex: 3,
        context: {
            skillId: 'zhangsong_xiantu', skillName: '献图', xiantuTargetIndex: 0,
            options: [{ action: 'one', label: '摸一张' }, { action: 'two', label: '摸两张' }],
        },
    }]
    const xtCtx = ((toClientView(s, HUMAN_PLAYER_ID) as any).pendingResponse?.context) ?? {}
    check('献图选项询问声明可提前选交牌', xtCtx.cardSelectOnActivate === true, xtCtx)
    handleRespond(s, HUMAN_PLAYER_ID, { action: 'two', cardIds: ['xt1', 'xt2'] } as any)
    check('献图把已选牌直接交给目标', s.generals[0].hand.length === before + 2,
        { before, after: s.generals[0].hand.length })
    check('献图不再二次询问选牌',
        !s.pendingResponseQueue.some(p => p.type === ResponseType.SKILL_PICK_CARD), queue(s))
}
{
    // 燕语（夏侯氏）：结束阶段询问本身就是“点目标即结算”
    const s = build(['xiahoushi', 'sunquan', 'huatuo'], ['guojia', 'zhenji', 'xiahoudun'], 77)
    const yyTarget = s.generals[0]
    s.deck = [card('yyd1', BasicCardName.PEACH, CardSuit.CLUB, 5), card('yyd2', BasicCardName.PEACH, CardSuit.CLUB, 6)]
    const before = yyTarget.hand.length
    s.pendingResponseQueue = [{
        type: ResponseType.SKILL_CHOOSE_TARGET,
        targetGeneralIndex: 3,
        context: {
            skillId: 'xiahoushi_yanyu_end', skillName: '燕语',
            description: '令一名男性角色摸两张牌', candidateIndices: [0, 1, 2, 4, 5],
        },
    }]
    handleRespond(s, HUMAN_PLAYER_ID, { targetIndex: 0 } as any)
    check('燕语点选目标即结算摸牌', yyTarget.hand.length === before + 2,
        { before, after: yyTarget.hand.length })
}

console.log('[好施与缔盟（界鲁肃）]')
{
    // 好施：给牌后记录受益者，受益者成为普通锦囊牌的目标后可交给鲁肃一张手牌
    const s = build(['lusu_jie', 'sunquan', 'huatuo'], ['guojia', 'zhenji', 'xiahoudun'], 90)
    const lsj = s.generals[3]
    const hsBeneficiary = s.generals[4]
    lsj.hand = [
        card('lj1', BasicCardName.PEACH, CardSuit.HEART, 3),
        card('lj2', BasicCardName.DODGE, CardSuit.HEART, 4),
    ]
    hsBeneficiary.hand = []
    s.generals[1].hand = [card('ljb1', BasicCardName.PEACH, CardSuit.CLUB, 1), card('ljb2', BasicCardName.PEACH, CardSuit.CLUB, 2)]
    s.generals[2].hand = [card('ljc1', BasicCardName.PEACH, CardSuit.CLUB, 3), card('ljc2', BasicCardName.PEACH, CardSuit.CLUB, 4)]
    s.generals[0].hand = [card('ljd1', BasicCardName.PEACH, CardSuit.DIAMOND, 5), card('ljd2', BasicCardName.PEACH, CardSuit.DIAMOND, 6), card('ljd3', BasicCardName.PEACH, CardSuit.DIAMOND, 7)]
    s.generals[5].hand = [card('lje1', BasicCardName.PEACH, CardSuit.SPADE, 8), card('lje2', BasicCardName.PEACH, CardSuit.SPADE, 9), card('lje3', BasicCardName.PEACH, CardSuit.SPADE, 1)]
    s.deck = [
        card('ljd5', BasicCardName.PEACH, CardSuit.SPADE, 2),
        card('ljd6', BasicCardName.PEACH, CardSuit.SPADE, 3),
        card('ljd7', BasicCardName.PEACH, CardSuit.SPADE, 4),
        card('ljd8', BasicCardName.PEACH, CardSuit.SPADE, 5),
    ]
    s.pendingResponseQueue = [{
        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
        targetGeneralIndex: 3,
        context: { skillId: 'lusu_jie_haoshi', skillName: '好施' },
    }]
    handleRespond(s, HUMAN_PLAYER_ID, { action: 'confirm' } as any)
    const hsGive = s.pendingResponseQueue[0]
    check('好施（界）唯一最少目标时直接进入选牌',
        hsGive?.type === ResponseType.SKILL_PICK_CARD && (hsGive.context as any)?.haoshiReceiverIndex === 4,
        queue(s))
    handleRespond(s, HUMAN_PLAYER_ID, { cardIds: lsj.hand.slice(-3).map(c => c.id) } as any)
    check('好施（界）交出指定张数', hsBeneficiary.hand.length === 3, hsBeneficiary.hand.length)
    check('好施（界）记录受益者', lsj.haoshiGuardReceiver === 4, lsj.haoshiGuardReceiver)

    // 鲁肃使用【杀】指定受益者 → 触发反哺询问
    lsj.hand.push(card('ljslash', BasicCardName.ATTACK, CardSuit.SPADE, 7))
    s.activeGeneralIndex = 3
    s.activePlayerFaction = Faction.WARM
    s.turnPhase = TurnPhase.ACTION
    handleUseCard(s, HUMAN_PLAYER_ID, { cardId: 'ljslash', targetIndices: [4] } as any)
    const guardAsk = findPending(s, 'lusu_jie_haoshi_guard')
    check('成为【杀】的目标后询问反哺', !!guardAsk, queue(s))
    {
        const ownerHand = lsj.hand.length
        s.pendingResponseQueue = [guardAsk!]
        // 反哺由受益者（同为暖方，玩家座位）决定是否交牌
        handleRespond(s, HUMAN_PLAYER_ID, { action: 'confirm' } as any)
        check('反哺交给鲁肃一张手牌',
            lsj.hand.length === ownerHand + 1 && hsBeneficiary.hand.length === 2,
            `${ownerHand} -> ${lsj.hand.length}, 受益者 ${hsBeneficiary.hand.length}`)
    }
}
{
    // 缔盟（界）：交换手牌不立即弃牌，代价延后到本阶段结束
    const s = build(['lusu_jie', 'sunquan', 'huatuo'], ['guojia', 'zhenji', 'xiahoudun'], 91)
    const lsj = s.generals[3]
    const dmRich = s.generals[4]
    const dmPoor = s.generals[5]
    lsj.hand = [
        card('dm1', BasicCardName.PEACH, CardSuit.HEART, 3),
        card('dm2', BasicCardName.DODGE, CardSuit.HEART, 4),
        card('dm3', BasicCardName.ATTACK, CardSuit.CLUB, 5),
    ]
    dmRich.hand = [
        card('dmr1', BasicCardName.PEACH, CardSuit.CLUB, 1),
        card('dmr2', BasicCardName.PEACH, CardSuit.CLUB, 2),
        card('dmr3', BasicCardName.PEACH, CardSuit.CLUB, 3),
    ]
    dmPoor.hand = [card('dmp1', BasicCardName.DODGE, CardSuit.DIAMOND, 9)]
    s.activeGeneralIndex = 3
    s.activePlayerFaction = Faction.WARM
    s.turnPhase = TurnPhase.ACTION
    const dmRes = handleUseSkill(s, HUMAN_PLAYER_ID, {
        skillId: 'lusu_jie_dimeng', targetIndices: [4, 5],
    } as any)
    check('缔盟（界）可以发动', !(dmRes && 'error' in dmRes), dmRes)
    check('缔盟（界）交换双方手牌',
        dmRich.hand.length === 1 && dmPoor.hand.length === 3,
        `${dmRich.hand.length}/${dmPoor.hand.length}`)
    check('缔盟（界）发动时不立即弃牌', lsj.hand.length === 3, lsj.hand.length)
    check('缔盟（界）记录延后弃牌数', lsj.dimengDebt === 2, lsj.dimengDebt)
    lsj.hand.push(card('dm9', BasicCardName.PEACH, CardSuit.HEART, 1))
    enterDiscardPhaseOrSkip(s, lsj)
    check('缔盟（界）阶段结束时弃置等量牌', lsj.hand.length === 2, lsj.hand.length)
    check('缔盟（界）代价结算后清零', (lsj.dimengDebt ?? 0) === 0, lsj.dimengDebt)
}
{
    // 好施（界）：自己下个回合开始时受益者标记作废
    const s = build(['lusu_jie', 'sunquan', 'huatuo'], ['guojia', 'zhenji', 'xiahoudun'], 92)
    const lsj = s.generals[3]
    lsj.haoshiGuardReceiver = 0
    s.activeGeneralIndex = 3
    s.activePlayerFaction = Faction.WARM
    runTurnStart(s)
    check('好施（界）受益者标记在自己回合开始时作废',
        lsj.haoshiGuardReceiver === undefined, lsj.haoshiGuardReceiver)
}

console.log('[晏如（费祎）]')
{
    // 奇数：先摸三张，再弃置至少半数
    const s = build(['feiyi', 'sunquan', 'huatuo'], ['guojia', 'zhenji', 'xiahoudun'], 93)
    const fy = s.generals[3]
    fy.hand = [
        card('yr1', BasicCardName.PEACH, CardSuit.HEART, 3),
        card('yr2', BasicCardName.DODGE, CardSuit.HEART, 4),
        card('yr3', BasicCardName.ATTACK, CardSuit.CLUB, 5),
    ]
    s.activeGeneralIndex = 3
    s.activePlayerFaction = Faction.WARM
    s.turnPhase = TurnPhase.ACTION
    s.deck = Array.from({ length: 6 }, (_, i) => card('yrd' + i, BasicCardName.PEACH, CardSuit.SPADE, (i % 9) + 1))
    const oddRes = handleUseSkill(s, HUMAN_PLAYER_ID, { skillId: 'feiyi_yanru' } as any)
    check('晏如奇数形态可以发动', !(oddRes && 'error' in oddRes), oddRes)
    check('晏如奇数形态先摸三张', fy.hand.length === 6, fy.hand.length)
    check('晏如询问弃置至少半数', !!findPending(s, 'feiyi_yanru_discard'), queue(s))
    handleRespond(s, HUMAN_PLAYER_ID, { cardIds: fy.hand.slice(0, 3).map(c => c.id) } as any)
    check('晏如奇数形态弃置后剩三张', fy.hand.length === 3, fy.hand.length)
    const oddAgain = handleUseSkill(s, HUMAN_PLAYER_ID, { skillId: 'feiyi_yanru' } as any)
    check('晏如奇数形态本阶段限一次', !!(oddAgain && 'error' in oddAgain), oddAgain)
}
{
    // 偶数：先弃置至少半数，再摸三张
    const s = build(['feiyi', 'sunquan', 'huatuo'], ['guojia', 'zhenji', 'xiahoudun'], 94)
    const fy = s.generals[3]
    fy.hand = [
        card('ys1', BasicCardName.PEACH, CardSuit.HEART, 3),
        card('ys2', BasicCardName.DODGE, CardSuit.HEART, 4),
        card('ys3', BasicCardName.ATTACK, CardSuit.CLUB, 5),
        card('ys4', BasicCardName.ATTACK, CardSuit.CLUB, 6),
    ]
    s.activeGeneralIndex = 3
    s.activePlayerFaction = Faction.WARM
    s.turnPhase = TurnPhase.ACTION
    s.deck = Array.from({ length: 6 }, (_, i) => card('ysd' + i, BasicCardName.PEACH, CardSuit.SPADE, (i % 9) + 1))
    const evenRes = handleUseSkill(s, HUMAN_PLAYER_ID, { skillId: 'feiyi_yanru' } as any)
    check('晏如偶数形态可以发动', !(evenRes && 'error' in evenRes), evenRes)
    check('晏如偶数形态先不摸牌', fy.hand.length === 4, fy.hand.length)
    const evenAsk = findPending(s, 'feiyi_yanru_discard')
    check('晏如偶数形态询问弃置至少半数', !!evenAsk, queue(s))
    handleRespond(s, HUMAN_PLAYER_ID, { cardIds: ['ys1', 'ys2'] } as any)
    check('晏如偶数形态弃牌后摸三张',
        fy.hand.length === 5, fy.hand.length)
}

console.log('[和衷（费祎）]')
{
    const s = build(['feiyi', 'sunquan', 'huatuo'], ['guojia', 'zhenji', 'xiahoudun'], 95)
    const fy = s.generals[3]
    fy.hand = [
        card('hz1', BasicCardName.DODGE, CardSuit.HEART, 2),
        card('hz2', BasicCardName.DODGE, CardSuit.CLUB, 3),
    ]
    s.activeGeneralIndex = 3
    s.activePlayerFaction = Faction.WARM
    s.turnPhase = TurnPhase.ACTION
    s.deck = Array.from({ length: 8 }, (_, i) => card('hzd' + i, BasicCardName.PEACH, CardSuit.SPADE, (i % 9) + 1))
    // 建立基线（2 张），再减到 1 张 → 手牌数变化为 1
    syncCardState(s)
    fy.hand.splice(1, 1)
    syncCardState(s)
    const hzAsk = findPending(s, 'feiyi_hezhong')
    check('手牌数变化为1后询问和衷', !!hzAsk, queue(s))
    {
        const beforeDraw = fy.hand.length
        s.pendingResponseQueue = [hzAsk!]
        handleRespond(s, HUMAN_PLAYER_ID, { action: 'confirm' } as any)
        check('和衷展示后摸一张牌', fy.hand.length === beforeDraw + 1, fy.hand.length)
        const modeAsk = findPending(s, 'feiyi_hezhong_mode')
        check('和衷随后询问额外结算方向', !!modeAsk, queue(s))
        {
            s.pendingResponseQueue = [modeAsk!]
            handleRespond(s, HUMAN_PLAYER_ID, { action: 'greater' } as any)
            check('和衷记录展示牌点数',
                fy.hezhongValue === 2 && fy.hezhongMode === 'greater',
                `${fy.hezhongValue}/${fy.hezhongMode}`)
            fy.hand.push(card('hzwz', TrickCardName.DRAW_TWO, CardSuit.SPADE, 7, CardCategory.TRICK, { trickType: 'instant' }))
            const beforeUse = fy.hand.length
            handleUseCard(s, HUMAN_PLAYER_ID, { cardId: 'hzwz', targetIndices: [] } as any)
            // 额外结算会另开一次无懈可击窗口，逐次关闭
            for (let i = 0; i < 3; i++) negateWindowTimeout(s)
            check('和衷让满足点数条件的普通锦囊额外结算一次',
                s.log.some(l => l.text.includes('和衷') && l.text.includes('额外结算一次')),
                s.log.slice(-4).map(l => l.text))
            check('和衷额外结算至少多摸一次牌',
                fy.hand.length >= beforeUse - 1 + 2, fy.hand.length)
            check('和衷额外结算后清除标记',
                fy.hezhongValue === undefined && fy.hezhongMode === undefined,
                `${fy.hezhongValue}/${fy.hezhongMode}`)
        }
    }
}

console.log('[督粮与腹鳞（李严）]')
{
    const s = build(['liyan', 'sunquan', 'huatuo'], ['guojia', 'zhenji', 'xiahoudun'], 96)
    const ly = s.generals[3]
    ly.hp = 3
    ly.gainedCardsThisTurn = 2
    check('腹鳞让回合内获得的牌不计入手牌上限', getHandLimit(ly) === 5, getHandLimit(ly))
    ly.gainedCardsThisTurn = 0
    s.generals[0].hand = [card('dl1', BasicCardName.PEACH, CardSuit.HEART, 5)]
    s.deck = [
        card('dld1', BasicCardName.ATTACK, CardSuit.SPADE, 7),
        card('dld2', TrickCardName.DISMANTLE, CardSuit.CLUB, 3, CardCategory.TRICK, { trickType: 'instant' }),
    ]
    s.activeGeneralIndex = 3
    s.activePlayerFaction = Faction.WARM
    s.turnPhase = TurnPhase.ACTION
    const dlRes = handleUseSkill(s, HUMAN_PLAYER_ID, { skillId: 'liyan_duliang', targetIndices: [0] } as any)
    check('督粮可以发动', !(dlRes && 'error' in dlRes), dlRes)
    check('督粮获得目标一张牌', s.generals[0].hand.length === 0, s.generals[0].hand.length)
    const dlAsk = findPending(s, 'liyan_duliang_choice')
    check('督粮询问二选一', !!dlAsk, queue(s))
    if (dlAsk) {
        s.pendingResponseQueue = [dlAsk]
        handleRespond(s, HUMAN_PLAYER_ID, { action: 'peek' } as any)
        check('督粮把牌堆顶基本牌交给目标',
            s.generals[0].hand.some(c => c.id === 'dld1'), s.generals[0].hand.map(c => c.id))
        check('督粮非基本牌留在牌堆顶', s.deck[0]?.id === 'dld2', s.deck.map(c => c.id).slice(0, 2))
    }
}
{
    const s = build(['liyan', 'sunquan', 'huatuo'], ['guojia', 'zhenji', 'xiahoudun'], 97)
    s.generals[0].hand = [card('db1', BasicCardName.PEACH, CardSuit.HEART, 5)]
    s.deck = [card('dbd1', BasicCardName.PEACH, CardSuit.CLUB, 3)]
    s.activeGeneralIndex = 3
    s.activePlayerFaction = Faction.WARM
    s.turnPhase = TurnPhase.ACTION
    handleUseSkill(s, HUMAN_PLAYER_ID, { skillId: 'liyan_duliang', targetIndices: [0] } as any)
    const dbAsk = findPending(s, 'liyan_duliang_choice')
    if (dbAsk) {
        s.pendingResponseQueue = [dbAsk]
        handleRespond(s, HUMAN_PLAYER_ID, { action: 'draw' } as any)
        check('督粮令目标下个回合摸牌阶段多摸一张',
            s.generals[0].duliangDrawBonus === true, s.generals[0].duliangDrawBonus)
    }
}

console.log('[治严（星徐晃）]')
{
    const s = build(['xuhuang_xing', 'sunquan', 'huatuo'], ['guojia', 'zhenji', 'xiahoudun'], 98)
    const zy = s.generals[3]
    zy.hand = [card('zy1', BasicCardName.PEACH, CardSuit.HEART, 3)]
    s.deck = [
        card('zyd1', BasicCardName.PEACH, CardSuit.CLUB, 1),
        card('zyd2', BasicCardName.PEACH, CardSuit.CLUB, 2),
        card('zyd3', BasicCardName.PEACH, CardSuit.CLUB, 3),
    ]
    s.activeGeneralIndex = 3
    s.activePlayerFaction = Faction.WARM
    s.turnPhase = TurnPhase.ACTION
    const fillRes = handleUseSkill(s, HUMAN_PLAYER_ID, { skillId: 'xuhuang_xing_zhiyan' } as any)
    check('治严可以补至体力上限', !(fillRes && 'error' in fillRes), fillRes)
    check('治严补牌到体力上限', zy.hand.length === zy.maxHp, `${zy.hand.length}/${zy.maxHp}`)
    const fillAgain = handleUseSkill(s, HUMAN_PLAYER_ID, { skillId: 'xuhuang_xing_zhiyan' } as any)
    check('治严补牌形态本阶段限一次', !!(fillAgain && 'error' in fillAgain), fillAgain)
}
{
    const s = build(['xuhuang_xing', 'sunquan', 'huatuo'], ['guojia', 'zhenji', 'xiahoudun'], 99)
    const zy = s.generals[3]
    zy.hp = 4
    zy.maxHp = 4
    zy.hand = [
        card('zg1', BasicCardName.PEACH, CardSuit.HEART, 3),
        card('zg2', BasicCardName.PEACH, CardSuit.HEART, 4),
        card('zg3', BasicCardName.PEACH, CardSuit.HEART, 5),
        card('zg4', BasicCardName.PEACH, CardSuit.HEART, 6),
        card('zg5', BasicCardName.PEACH, CardSuit.HEART, 7),
    ]
    const ally = s.generals[4]
    const allyBefore = ally.hand.length
    s.activeGeneralIndex = 3
    s.activePlayerFaction = Faction.WARM
    s.turnPhase = TurnPhase.ACTION
    const giveRes = handleUseSkill(s, HUMAN_PLAYER_ID, {
        skillId: 'xuhuang_xing_zhiyan', targetIndices: [4],
    } as any)
    check('治严可以交出手牌', !(giveRes && 'error' in giveRes), giveRes)
    check('治严把超出体力值的手牌交给目标',
        zy.hand.length === 4 && ally.hand.length === allyBefore + 1,
        `${zy.hand.length}/${ally.hand.length}`)
}

console.log('[过论与展骥（SP庞统）]')
{
    const s = build(['pangtong_sp', 'sunquan', 'huatuo'], ['guojia', 'zhenji', 'xiahoudun'], 100)
    const pt = s.generals[3]
    pt.hand = [card('gl1', BasicCardName.ATTACK, CardSuit.SPADE, 3)]
    const glFoe = s.generals[0]
    glFoe.hand = [card('gl2', BasicCardName.PEACH, CardSuit.HEART, 12)]
    s.deck = [
        card('gld1', BasicCardName.PEACH, CardSuit.CLUB, 5),
        card('gld2', BasicCardName.PEACH, CardSuit.CLUB, 6),
    ]
    s.activeGeneralIndex = 3
    s.activePlayerFaction = Faction.WARM
    s.turnPhase = TurnPhase.ACTION
    const glRes = handleUseSkill(s, HUMAN_PLAYER_ID, {
        skillId: 'pangtong_sp_guolun', targetIndices: [0],
    } as any)
    check('过论可以发动', !(glRes && 'error' in glRes), glRes)
    check('过论交换双方各一张牌',
        pt.hand.some(c => c.id === 'gl2') && glFoe.hand.some(c => c.id === 'gl1'),
        `${pt.hand.map(c => c.id)}/${glFoe.hand.map(c => c.id)}`)
    // 交换前点数 3 < 12：庞统摸 1 张，展骥再摸 1 张
    check('过论交换前点数小的一方摸一张（含展骥）', pt.hand.length === 3, pt.hand.length)
}
{
    // 送丧：其他角色死亡时回复体力并获得展骥
    const s = build(['pangtong_sp', 'sunquan', 'huatuo'], ['guojia', 'zhenji', 'xiahoudun'], 102)
    const pt = s.generals[3]
    pt.hp = 2
    const victim = s.generals[0]
    victim.hp = 1
    dealDamage(s, s.generals[1], victim, 1)
    // 先响应濒死等询问，遇到送丧询问就停下由本人确认
    for (let i = 0; i < 10 && s.pendingResponseQueue.length > 0; i++) {
        const head = s.pendingResponseQueue[0]
        if ((head.context as any)?.skillId === 'pangtong_sp_songsang') break
        const responder = s.generals[head.targetGeneralIndex]?.playerId === HUMAN_PLAYER_ID
            ? HUMAN_PLAYER_ID : AI_PLAYER_ID
        handleRespond(s, responder, { action: 'decline' } as any)
    }
    const songsangAsk = s.pendingResponseQueue.find((p: any) =>
        (p.context as any)?.skillId === 'pangtong_sp_songsang')
    check('其他角色死亡时询问送丧', !!songsangAsk, queue(s))
    if (songsangAsk) {
        s.pendingResponseQueue = [songsangAsk]
        handleRespond(s, HUMAN_PLAYER_ID, { action: 'confirm' } as any)
        check('送丧确认后回复体力并获得展骥',
            pt.hp === 3 && (pt.acquiredSkills ?? []).includes('pangtong_sp_zhanji'),
            `${pt.hp}/${pt.acquiredSkills}`)
    }
}

console.log('[巧说与纵适（界简雍）]')
{
    const s = build(['jianyong', 'sunquan', 'huatuo'], ['guojia', 'zhenji', 'xiahoudun'], 103)
    const jy = s.generals[3]
    const foe = s.generals[0]
    jy.hand = [card('qs1', BasicCardName.ATTACK, CardSuit.SPADE, 13)]
    foe.hand = [card('qs2', BasicCardName.PEACH, CardSuit.HEART, 2)]
    s.deck = [card('qsd1', BasicCardName.PEACH, CardSuit.CLUB, 5)]
    s.activeGeneralIndex = 3
    s.activePlayerFaction = Faction.WARM
    s.turnPhase = TurnPhase.ACTION
    s.turnSerial = 5
    const qsRes = handleUseSkill(s, HUMAN_PLAYER_ID, {
        skillId: 'jianyong_qiaoshuo', targetIndices: [0],
    } as any)
    check('巧说可以发动', !(qsRes && 'error' in qsRes), qsRes)
    handleRespond(s, HUMAN_PLAYER_ID, { cardIds: ['qs1'] } as any)
    handleRespond(s, AI_PLAYER_ID, { cardIds: ['qs2'] } as any)
    check('巧说拼点赢后进入生效状态', jy.qiaoshuoWin === true, jy.qiaoshuoWin)
    check('纵适获得点数较小的拼点牌', jy.hand.some(c => c.id === 'qs2'), jy.hand.map(c => c.id))
    jy.hand = [card('qs-slash', BasicCardName.ATTACK, CardSuit.SPADE, 7)]
    jy.qiaoshuoWin = true
    const slashRes = handleUseCard(s, HUMAN_PLAYER_ID, { cardId: 'qs-slash', targetIndices: [4, 2] } as any)
    check('巧说赢后【杀】可以增加一个目标', !(slashRes && 'error' in slashRes), slashRes)
}
{
    const s = build(['jianyong', 'sunquan', 'huatuo'], ['guojia', 'zhenji', 'xiahoudun'], 104)
    const jy = s.generals[3]
    const foe = s.generals[0]
    jy.hand = [card('ql1', BasicCardName.PEACH, CardSuit.HEART, 2)]
    foe.hand = [card('ql2', BasicCardName.ATTACK, CardSuit.SPADE, 13)]
    s.deck = [card('qld1', BasicCardName.PEACH, CardSuit.CLUB, 5)]
    s.activeGeneralIndex = 3
    s.activePlayerFaction = Faction.WARM
    s.turnPhase = TurnPhase.ACTION
    s.turnSerial = 5
    handleUseSkill(s, HUMAN_PLAYER_ID, { skillId: 'jianyong_qiaoshuo', targetIndices: [0] } as any)
    handleRespond(s, HUMAN_PLAYER_ID, { cardIds: ['ql1'] } as any)
    handleRespond(s, AI_PLAYER_ID, { cardIds: ['ql2'] } as any)
    check('巧说没赢后本回合不能使用锦囊牌',
        jy.cannotUseTrickTurn !== undefined, jy.cannotUseTrickTurn)
    check('纵适没赢收回自己的拼点牌', jy.hand.some(c => c.id === 'ql1'), jy.hand.map(c => c.id))
    jy.hand.push(card('ql-trick', TrickCardName.DRAW_TWO, CardSuit.SPADE, 7, CardCategory.TRICK, { trickType: 'instant' }))
    const trickRes = handleUseCard(s, HUMAN_PLAYER_ID, { cardId: 'ql-trick', targetIndices: [] } as any)
    check('巧说没赢时锦囊被拒绝', !!(trickRes && 'error' in trickRes), trickRes)
}

console.log('[巧说·增加目标]')
{
    const s = build(['jianyong', 'sunquan', 'huatuo'], ['guojia', 'zhenji', 'xiahoudun'], 105)
    const jy = s.generals[3]
    jy.hand = [card('et1', TrickCardName.DISMANTLE, CardSuit.SPADE, 7, CardCategory.TRICK, { trickType: 'instant' })]
    jy.qiaoshuoWin = true
    s.generals[4].hand = [card('et2', BasicCardName.PEACH, CardSuit.HEART, 3)]
    s.generals[2].hand = [card('et3', BasicCardName.PEACH, CardSuit.CLUB, 4)]
    s.deck = [card('etd', BasicCardName.PEACH, CardSuit.CLUB, 5)]
    s.activeGeneralIndex = 3
    s.activePlayerFaction = Faction.WARM
    s.turnPhase = TurnPhase.ACTION
    const etRes = handleUseCard(s, HUMAN_PLAYER_ID, { cardId: 'et1', targetIndices: [4, 2] } as any)
    check('巧说赢后单个目标锦囊可以增加一个目标', !(etRes && 'error' in etRes), etRes)
}

console.log('[群体锦囊取消目标]')
{
    const s = build(['sunquan', 'huatuo', 'caocao'], ['guojia', 'zhenji', 'xiahoudun'], 106)
    const user = s.generals[3]
    user.hand = [card('aoe1', TrickCardName.BARBARIANS, CardSuit.SPADE, 7, CardCategory.TRICK, { trickType: 'instant' })]
    s.deck = [card('aoed', BasicCardName.PEACH, CardSuit.CLUB, 5)]
    s.activeGeneralIndex = 3
    s.activePlayerFaction = Faction.WARM
    s.turnPhase = TurnPhase.ACTION
    handleUseCard(s, HUMAN_PLAYER_ID, {
        cardId: 'aoe1', targetIndices: [], extra: { excludeTargetIndices: [0] },
    } as any)
    const aoeTargets = s.pendingResponseQueue
        .filter(p => p.type === ResponseType.AOE_ATTACK)
        .map(p => p.targetGeneralIndex)
    check('群体锦囊可以取消一个目标', aoeTargets.length > 0 && !aoeTargets.includes(0), aoeTargets)
}

console.log('[屯储与视为使用杀]')
{
    const setup = (withLiang: boolean) => {
        const s = build(['lisu', 'sunquan', 'huatuo'], ['lifeng', 'zhenji', 'xiahoudun'], 75)
        const lf = s.generals[0]
        lf.liangCards = withLiang ? [card('liang1', BasicCardName.PEACH, CardSuit.HEART, 3)] : []
        s.generals[4].hand = [card('vd2', BasicCardName.DODGE, CardSuit.HEART, 2)]
        s.deck = [card('vd1', BasicCardName.DODGE, CardSuit.HEART, 2)]
        s.pendingResponseQueue = [{
            type: ResponseType.SKILL_CHOOSE_TARGET,
            targetGeneralIndex: 3,
            context: { skillId: 'lisu_xianzhu', skillName: '献珠', candidateIndices: [0, 1, 2, 4, 5] },
        }]
        handleRespond(s, HUMAN_PLAYER_ID, { targetIndex: 0 } as any)
        // 李肃攻击范围内、且不是李丰自己的角色（座位距离 1）
        handleRespond(s, HUMAN_PLAYER_ID, { targetIndex: 4 } as any)
        return s
    }
    const withLiang = setup(true)
    check('屯储有“粮”时视为使用的杀不生效',
        !withLiang.pendingResponseQueue.some(p => p.type === ResponseType.DODGE)
        && withLiang.log.some(l => l.text.includes('屯储')), queue(withLiang))
    const noLiang = setup(false)
    check('没有“粮”时视为使用的杀正常结算',
        noLiang.pendingResponseQueue.some(p => p.type === ResponseType.DODGE), queue(noLiang))
}

console.log('[清正 AI]')
{
    // 候选只有队友时，规则 AI 应放弃而不是留下空负载（旧实现会让这一步无进展）
    const s = build(['caocao_jie', 'sunquan', 'huatuo'], ['guojia', 'zhenji', 'xiahoudun'], 76)
    s.generals[0].hand = [card('qz1', BasicCardName.PEACH, CardSuit.HEART, 4)]
    s.generals[1].hand = [card('qz2', BasicCardName.DODGE, CardSuit.CLUB, 5)]
    s.pendingResponseQueue = [{
        type: ResponseType.SKILL_CHOOSE_TARGET,
        targetGeneralIndex: 0,
        context: { skillId: 'caocao_jie_qingzheng', skillName: '清正', candidateIndices: [1] },
    }]
    aiRespond(s, AI_PLAYER_ID)
    check('清正没有敌方目标时 AI 放弃并移除询问', s.pendingResponseQueue.length === 0, queue(s))
}
{
    // 候选里有敌方时仍应正常选人
    const s = build(['caocao_jie', 'sunquan', 'huatuo'], ['guojia', 'zhenji', 'xiahoudun'], 77)
    s.generals[0].hand = [card('qz1', BasicCardName.PEACH, CardSuit.HEART, 4)]
    s.generals[3].hand = [card('qz2', BasicCardName.DODGE, CardSuit.CLUB, 5)]
    s.pendingResponseQueue = [{
        type: ResponseType.SKILL_CHOOSE_TARGET,
        targetGeneralIndex: 0,
        context: { skillId: 'caocao_jie_qingzheng', skillName: '清正', candidateIndices: [1, 3] },
    }]
    aiRespond(s, AI_PLAYER_ID)
    const head = s.pendingResponseQueue[0]
    check('清正有敌方目标时 AI 选择敌方',
        head?.type === ResponseType.SKILL_ACTIVATE_CONFIRM
        && (head.context as any)?.qingzhengTargetIndex === 3, queue(s))
}

console.log('[珠只在李肃武将牌上]')
{
    // 巧言：有“珠”时来源获得该牌（进手牌），李肃武将牌上不再有它
    const s = build(['lisu', 'sunquan', 'huatuo'], ['dianwei_jie', 'zhenji', 'xiahoudun'], 78)
    const lisu = s.generals[3]
    const dw = s.generals[0]
    dw.hand = []
    lisu.generalPile = [card('pearl1', BasicCardName.DODGE, CardSuit.HEART, 2)]
    lisu.pearlMarks = 1
    s.activeGeneralIndex = 0
    dealDamage(s, dw, lisu, 1)
    check('巧言让来源获得李肃武将牌上的那张牌',
        dw.hand.some(c => c.id === 'pearl1'), dw.hand.map(c => c.id))
    check('巧言转移后李肃武将牌上不再有“珠”',
        (lisu.generalPile ?? []).length === 0, lisu.generalPile)
}
{
    // 献珠：同样从李肃武将牌取牌给获得者
    const s = build(['lisu', 'sunquan', 'huatuo'], ['dianwei_jie', 'zhenji', 'xiahoudun'], 79)
    const lisu = s.generals[3]
    const dw = s.generals[0]
    dw.hand = []
    lisu.generalPile = [card('pearl2', BasicCardName.DODGE, CardSuit.HEART, 3)]
    lisu.pearlMarks = 1
    s.pendingResponseQueue = [{
        type: ResponseType.SKILL_CHOOSE_TARGET,
        targetGeneralIndex: 3,
        context: { skillId: 'lisu_xianzhu', skillName: '献珠', candidateIndices: [0, 1, 2, 4, 5] },
    }]
    handleRespond(s, HUMAN_PLAYER_ID, { targetIndex: 0 } as any)
    check('献珠把李肃武将牌上的“珠”交给获得者',
        dw.hand.some(c => c.id === 'pearl2'), dw.hand.map(c => c.id))
}

console.log('[蒺藜]')
{
    // 攻击范围按“使用这张牌时”算：装备麒麟弓（范围5）这一张牌本身要按装备前的朱雀羽扇（范围4）判断
    const weapon = (id: string, name: any, suit: CardSuit, value: number, range: number) =>
        card(id, name, suit, value, CardCategory.EQUIPMENT, { equipSlot: EquipSlot.WEAPON, attackRange: range })
    const s = build(['shamoke', 'huatuo', 'sunquan'], ['guojia', 'zhenji', 'xiahoudun'], 98)
    const smk = s.generals[3]
    smk.equip.weapon = weapon('eq-zhuque', EquipmentCardName.ZHUQUE_FAN, CardSuit.DIAMOND, 1, 4)
    smk.cardsUsedTurnCount = 3
    smk.hand = [
        weapon('eq-kylin', EquipmentCardName.KYLIN_BOW, CardSuit.HEART, 5, 5),
        card('sl-4', BasicCardName.ATTACK, CardSuit.CLUB, 11),
    ]
    s.deck = Array.from({ length: 12 }, (_, i) => card('jd' + i, BasicCardName.PEACH, CardSuit.CLUB, (i % 9) + 1))
    const equipRes = handleUseCard(s, HUMAN_PLAYER_ID, { cardId: 'eq-kylin', targetIndices: [] } as any)
    check('装备麒麟弓可以使用', !(equipRes && 'error' in equipRes), equipRes)
    const jili4 = findPending(s, 'shamoke_jili')
    check('第4张装备牌按朱雀羽扇的范围4触发蒺藜',
        !!jili4 && (jili4.context as any).jiliCount === 4,
        jili4 ? (jili4.context as any).jiliCount : queue(s))
    if (jili4) {
        const before = smk.hand.length
        handleRespond(s, HUMAN_PLAYER_ID, { action: 'confirm' } as any)
        check('蒺藜摸4张牌', smk.hand.length === before + 4, `${before} -> ${smk.hand.length}`)
    }
    const slashRes = handleUseCard(s, HUMAN_PLAYER_ID, { cardId: 'sl-4', targetIndices: [0] } as any)
    check('第5张【杀】可以使用', !(slashRes && 'error' in slashRes), slashRes)
    const jili5 = findPending(s, 'shamoke_jili')
    check('第5张牌按麒麟弓的范围5触发蒺藜',
        !!jili5 && (jili5.context as any).jiliCount === 5,
        jili5 ? (jili5.context as any).jiliCount : queue(s))
}
{
    // 打出【闪】同样计入“本回合使用或打出的第 X 张牌”
    const s = build(['sunquan', 'huatuo', 'caocao'], ['shamoke', 'zhenji', 'xiahoudun'], 99)
    const smk = s.generals[0]
    smk.cardsUsedTurnCount = 0
    smk.hand = [card('jd-dodge', BasicCardName.DODGE, CardSuit.HEART, 2)]
    s.pendingResponseQueue = [{
        type: ResponseType.DODGE,
        targetGeneralIndex: 0,
        context: {
            attackerGeneralIndex: 3,
            requiredDodges: 1,
            dodgesReceived: 0,
            attackCard: card('jd-slash', BasicCardName.ATTACK, CardSuit.SPADE, 7),
        },
    }]
    handleRespond(s, AI_PLAYER_ID, { cardId: 'jd-dodge' } as any)
    const jiliPlayed = findPending(s, 'shamoke_jili')
    check('打出【闪】也触发蒺藜（无武器时范围1）',
        !!jiliPlayed && (jiliPlayed.context as any).jiliCount === 1, queue(s))
}
{
    // 使用【杀】后蒺藜应先于出闪/伤害结算询问
    const s = build(['shamoke', 'sunquan', 'huatuo'], ['zhenji', 'xiahoudun', 'simayi_jing'], 100)
    const smk = s.generals[3]
    smk.cardsUsedTurnCount = 0
    smk.hand = [card('jd-sl', BasicCardName.ATTACK, CardSuit.SPADE, 7)]
    s.generals[2].hand = [card('jd-dd', BasicCardName.DODGE, CardSuit.HEART, 2)]
    const res = handleUseCard(s, HUMAN_PLAYER_ID, { cardId: 'jd-sl', targetIndices: [2] } as any)
    check('沙摩柯对司马懿-竞使用【杀】', !(res && 'error' in res), res)
    check('蒺藜在出闪之前询问',
        (s.pendingResponseQueue[0]?.context as any)?.skillId === 'shamoke_jili'
        && s.pendingResponseQueue.some(p => p.type === ResponseType.DODGE), queue(s))
}

console.log('[胆守：弃置装备]')
{
    const s = build(['zhuran_jie', 'sunquan', 'huatuo'], ['caocao', 'guojia', 'zhenji'], 101)
    const zr = s.generals[3]
    s.activeGeneralIndex = 3
    zr.hand = []
    zr.equip.weapon = card('ds-eq', EquipmentCardName.QINGGANG_SWORD, CardSuit.SPADE, 6,
        CardCategory.EQUIPMENT, { equipSlot: EquipSlot.WEAPON, attackRange: 2 })
    s.generals[0].hand = [card('ds-t', BasicCardName.PEACH, CardSuit.HEART, 3)]
    s.pendingResponseQueue = [{
        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
        targetGeneralIndex: 3,
        context: {
            skillId: 'zhuran_danshou', skillName: '胆守',
            options: [{ action: '1', label: '①弃置其一张牌' }],
            danshouTargetIndex: 0,
        },
    }]
    handleRespond(s, HUMAN_PLAYER_ID, { action: '1' } as any)
    const pick = findPending(s, 'zhuran_danshou_cost')
    check('胆守的弃牌代价可选装备',
        !!pick && ((pick.context as any).candidateCardIds ?? []).includes('ds-eq'), queue(s))
    if (pick) {
        handleRespond(s, HUMAN_PLAYER_ID, { cardIds: ['ds-eq'] } as any)
        check('胆守弃置了装备区的牌',
            !zr.equip.weapon && s.discard.some(c => c.id === 'ds-eq'),
            `weapon=${zr.equip.weapon?.name ?? 'none'}`)
    }
}

console.log('[留闪]')
{
    const slashSetup = (opts: { hp?: number; wineCard?: boolean; crossbow?: boolean }) => {
        const s = build(['sunquan', 'huatuo', 'caocao'], ['guojia', 'zhenji', 'xiahoudun'], 110)
        const atk = s.generals[3]
        const me = s.generals[0]
        me.hp = opts.hp ?? 4
        atk.hand = [card('ah0', BasicCardName.ATTACK, CardSuit.SPADE, 7)]
        if (opts.wineCard) atk.hand.push(card('ah1', BasicCardName.WINE, CardSuit.DIAMOND, 9))
        if (opts.crossbow) {
            atk.equip.weapon = card('eq-cb', EquipmentCardName.CROSSBOW, CardSuit.CLUB, 1,
                CardCategory.EQUIPMENT, { equipSlot: EquipSlot.WEAPON, attackRange: 1 })
        }
        return { s, atk, me }
    }

    // 普通一刀：正常出闪
    {
        const { s, me } = slashSetup({ hp: 4 })
        const v = dodgeHoldValue(s, HUMAN_PLAYER_ID, s.generals.indexOf(me), 3)
        check('普通一刀不省闪', !v.hold && v.currentDamage === 1, v)
    }
    // 这一刀就是酒杀：必须闪
    {
        const { s, atk, me } = slashSetup({ hp: 4 })
        atk.wineDrunk = true
        const v = dodgeHoldValue(s, HUMAN_PLAYER_ID, s.generals.indexOf(me), 3)
        check('酒杀这一刀必须闪', !v.hold && v.currentDamage === 2, v)
    }
    // 体力厚、对方手里还留着酒 + 连弩，且自己有桃兜底：留闪给之后的酒杀
    {
        const { s, me } = slashSetup({ hp: 4, wineCard: true, crossbow: true })
        me.hand.push(card('me-peach', BasicCardName.PEACH, CardSuit.HEART, 3))
        const v = dodgeHoldValue(s, HUMAN_PLAYER_ID, s.generals.indexOf(me), 3)
        check('有桃时留闪给之后的酒杀', v.hold && v.futureDamage >= 2 && v.futureRisk >= 0.5, v)
    }
    // 同场景但没有桃：不能为了留闪送命
    {
        const { s, me } = slashSetup({ hp: 4, wineCard: true, crossbow: true })
        const v = dodgeHoldValue(s, HUMAN_PLAYER_ID, s.generals.indexOf(me), 3)
        check('没有救援资源时不拿命留闪', !v.hold, v)
    }
    // 1 血、对方连弩 + 明牌酒，但自己有桃：先吃这一刀，濒死用桃救，闪留给下一刀
    {
        const { s, me } = slashSetup({ hp: 1, wineCard: true, crossbow: true })
        me.hand.push(card('me-peach-low', BasicCardName.PEACH, CardSuit.HEART, 3))
        const v = dodgeHoldValue(s, HUMAN_PLAYER_ID, s.generals.indexOf(me), 3)
        check('1 血有桃时也留闪', v.hold && v.currentDamage === 1, v)
    }
    // 体力只剩 2：不能为了留闪送命
    {
        const { s, me } = slashSetup({ hp: 2 })
        const v = dodgeHoldValue(s, HUMAN_PLAYER_ID, s.generals.indexOf(me), 3)
        check('体力不足时不冒险留闪', !v.hold, v)
    }
    // 对方只有一张杀、没连弩、没明牌酒：没有能再出一刀的证据，照常出闪
    {
        const { s, me } = slashSetup({ hp: 4 })
        const v = dodgeHoldValue(s, HUMAN_PLAYER_ID, s.generals.indexOf(me), 3)
        check('没有二次出杀证据时不留闪', !v.hold, v)
    }
}

console.log('[牌堆估计]')
{
    check('两张未知牌摸到杀约 50%', Math.abs(atLeastOneChance(2, KEY_CARD_COUNTS.slash) - 0.49) < 0.03)
    check('两张未知牌摸到桃约 15%', Math.abs(atLeastOneChance(2, KEY_CARD_COUNTS.peach) - 0.148) < 0.02)
    check('四张手牌期望杀数约 1.1', Math.abs(expectedSlashes(4) - 1.13) < 0.02)
}

console.log('[自对弈]')
{
    const a = runSelfPlayGame(20251023, Faction.WARM)
    const b = runSelfPlayGame(20251023, Faction.WARM)
    const fingerprint = (r: typeof a) => `${r.winner}/${r.steps}/${r.state.log.length}/${r.state.deck.length}`
    check('同种子对局完全一致', fingerprint(a) === fingerprint(b), `${fingerprint(a)} vs ${fingerprint(b)}`)
    check('对局能正常结束', a.ok, `steps=${a.steps}`)
    const c = runSelfPlayGame(1010, Faction.COOL)
    check('换边后对局能正常结束', c.ok, `steps=${c.steps}`)
}

console.log('[戮连]')
{
    const make = (seed: number) => {
        const s = build(['sunchen_shi', 'huatuo', 'sunquan'], ['caocao', 'guojia', 'zhenji'], seed)
        s.deck = Array.from({ length: 12 }, (_, i) => card('ld' + i, BasicCardName.PEACH, CardSuit.CLUB, (i % 9) + 1))
        return s
    }
    // ① 有目标体力值不大于孙綝 → 此牌所有目标横置；② 有目标装备区牌数不大于孙綝 → 摸一张
    // 两项都满足 → 由孙綝选择一名体力值不为最小的角色，造成 1 点火焰伤害
    {
        const s = make(71)
        const sc = s.generals[3]
        sc.hp = 4
        s.generals[0].hp = 5
        s.generals[1].hp = 3
        s.generals[2].hp = 3
        sc.hand = [
            card('ld-nm', TrickCardName.BARBARIANS, CardSuit.SPADE, 7, CardCategory.TRICK, { trickType: 'instant' }),
            card('ld-eq', EquipmentCardName.KYLIN_BOW, CardSuit.HEART, 5, CardCategory.EQUIPMENT,
                { equipSlot: EquipSlot.WEAPON, attackRange: 5 }),
        ]
        const res = handleUseCard(s, HUMAN_PLAYER_ID, { cardId: 'ld-nm', targetIndices: [0, 1, 2] } as any)
        check('南蛮入侵可以使用', !(res && 'error' in res), res)
        check('体力值高于孙綝的目标也进入连环状态', s.generals.slice(0, 3).every((g) => g.chained),
            s.generals.slice(0, 3).map((g) => `${g.generalId}:${g.hp}/${g.chained}`))
        check('装备区条件满足时摸一张牌', sc.hand.some((c) => c.id === 'ld0'), sc.hand.map((c) => c.id))
        const ask = findPending(s, 'sunchen_shi_lulian')
        check('两项都满足时询问火焰伤害目标', !!ask, queue(s))
        if (ask) {
            s.pendingResponseQueue = [ask]
            const before = s.generals[1].hp
            handleRespond(s, HUMAN_PLAYER_ID, { targetIndex: 1 } as any)
            check('对所选角色造成1点火焰伤害', s.generals[1].hp <= before - 1,
                `${before} -> ${s.generals[1].hp}`)
        }
    }
    {
        const s = make(72)
        s.generals[3].hp = 4
        s.generals[3].hand = [
            card('ld-a1', BasicCardName.ATTACK, CardSuit.SPADE, 7),
            card('ld-a2', BasicCardName.ATTACK, CardSuit.SPADE, 8),
        ]
        handleUseCard(s, HUMAN_PLAYER_ID, { cardId: 'ld-a1', targetIndices: [2] } as any)
        check('同类手牌仍有剩余时不发动戮连',
            !s.generals[2].chained && !findPending(s, 'sunchen_shi_lulian'), queue(s))
    }
}

console.log('[纵玄]')
{
    const s = build(['yufan', 'huatuo', 'sunquan'], ['caocao', 'guojia', 'zhenji'], 73)
    s.turnPhase = TurnPhase.DISCARD
    const yf = s.generals[3]
    yf.hp = 2
    yf.hand = [
        card('zx1', BasicCardName.PEACH, CardSuit.HEART, 3),
        card('zx2', BasicCardName.DODGE, CardSuit.HEART, 4),
        card('zx3', BasicCardName.ATTACK, CardSuit.SPADE, 5),
        card('zx4', BasicCardName.ATTACK, CardSuit.SPADE, 6),
    ]
    s.deck = [card('zxk', BasicCardName.PEACH, CardSuit.CLUB, 1)]
    handleDiscard(s, HUMAN_PLAYER_ID, ['zx1', 'zx2'])
    const ask = s.pendingResponseQueue.find((p: any) => ['yufan_zongxuan', 'yufan_jie_zongxuan'].includes((p.context as any)?.skillId))
    check('弃牌后询问纵玄', !!ask, queue(s))
    if (ask) {
        s.pendingResponseQueue = [ask]
        const res = handleRespond(s, HUMAN_PLAYER_ID, { cardIds: ['zx1'] } as any)
        check('纵玄结算成功', !(res && 'error' in res), res)
        check('所选牌置于牌堆顶', s.deck[0]?.id === 'zx1', s.deck.map((c) => c.id))
        check('未选择的牌留在弃牌堆', s.discard.some((c) => c.id === 'zx2'), s.discard.map((c) => c.id))
        check('虞翻没有获得这些牌', !yf.hand.some((c) => c.id === 'zx1' || c.id === 'zx2'),
            yf.hand.map((c) => c.id))
        check('纵玄结算后不再停在弃牌阶段', s.turnPhase !== TurnPhase.DISCARD, `phase=${s.turnPhase}`)
    }
}

console.log('[纵玄：其他弃置来源]')
{
    // 过河拆桥弃置虞翻的手牌：不在弃牌阶段也要询问纵玄
    const s = build(['huatuo', 'sunquan', 'yufan'], ['zhenji', 'caocao', 'guojia'], 74)
    const yf = s.generals[5]
    yf.hand = [card('zx-dm', BasicCardName.PEACH, CardSuit.HEART, 3)]
    s.generals[0].hand = [card('dm-trick', TrickCardName.DISMANTLE, CardSuit.SPADE, 3,
        CardCategory.TRICK, { trickType: 'instant' })]
    s.activeGeneralIndex = 0
    s.activePlayerFaction = Faction.COOL
    s.turnPhase = TurnPhase.ACTION
    const res = handleUseCard(s, AI_PLAYER_ID, { cardId: 'dm-trick', targetIndices: [5] } as any)
    check('过河拆桥可以使用', !(res && 'error' in res), res)
    negateWindowTimeout(s)
    const pick = s.pendingResponseQueue.find((p: any) => p.type === ResponseType.TRICK_TARGET_CARD_PICK)
    check('进入拆牌选择', !!pick, queue(s))
    if (pick) {
        s.pendingResponseQueue = [pick]
        handleRespond(s, AI_PLAYER_ID, { action: 'hand' } as any)
        const ask = s.pendingResponseQueue.find((p: any) => ['yufan_zongxuan', 'yufan_jie_zongxuan'].includes((p.context as any)?.skillId))
        check('拆掉虞翻的牌后询问纵玄', !!ask, queue(s))
        if (ask) {
            s.pendingResponseQueue = [ask]
            handleRespond(s, HUMAN_PLAYER_ID, { cardIds: ['zx-dm'] } as any)
            check('拆掉的牌被置于牌堆顶', s.deck[0]?.id === 'zx-dm', s.deck.map((c) => c.id))
            check('该牌已离开弃牌堆', !s.discard.some((c) => c.id === 'zx-dm'), s.discard.map((c) => c.id))
        }
    }
}
{
    // 上家的牌每回合第一次因弃置进入弃牌堆时询问（甄姬是虞翻的上家）
    const s = build(['huatuo', 'sunquan', 'zhenji', 'yufan_jie', 'guojia', 'caocao'], [], 75)
    const zj = s.generals[2]
    const yf = s.generals[3]
    s.activeGeneralIndex = 2
    s.turnPhase = TurnPhase.DISCARD
    s.turnSerial = 5
    zj.hp = 2
    zj.hand = [
        card('zj1', BasicCardName.PEACH, CardSuit.HEART, 3),
        card('zj2', BasicCardName.DODGE, CardSuit.HEART, 4),
        card('zj3', BasicCardName.ATTACK, CardSuit.SPADE, 5),
        card('zj4', BasicCardName.ATTACK, CardSuit.SPADE, 6),
    ]
    s.deck = [card('d1', BasicCardName.PEACH, CardSuit.CLUB, 1), card('d2', BasicCardName.PEACH, CardSuit.CLUB, 2)]
    handleDiscard(s, HUMAN_PLAYER_ID, ['zj1', 'zj2'])
    const ask = s.pendingResponseQueue.find((p: any) => ['yufan_zongxuan', 'yufan_jie_zongxuan'].includes((p.context as any)?.skillId))
    check('上家的弃置询问纵玄', !!ask && ask.targetGeneralIndex === 3, queue(s))
    if (ask) {
        s.pendingResponseQueue = [ask]
        handleRespond(s, HUMAN_PLAYER_ID, { cardIds: ['zj1', 'zj2'] } as any)
        check('上家弃置的牌置于牌堆顶', s.deck.slice(0, 2).map((c) => c.id).join() === 'zj1,zj2',
            s.deck.map((c) => c.id))
    }
    check('虞翻没有获得上家的牌', !yf.hand.some((c) => c.id === 'zj1' || c.id === 'zj2'),
        yf.hand.map((c) => c.id))
}
{
    // 虞翻由 AI 操作时也要能自行结算纵玄
    const s = build(['huatuo', 'sunquan', 'zhenji'], ['yufan_jie', 'guojia', 'caocao'], 76)
    const yf = s.generals[0]
    s.activeGeneralIndex = 5
    s.turnPhase = TurnPhase.DISCARD
    s.turnSerial = 9
    s.generals[5].hp = 2
    s.generals[5].hand = [
        card('ca1', BasicCardName.PEACH, CardSuit.HEART, 3),
        card('ca2', BasicCardName.DODGE, CardSuit.HEART, 4),
        card('ca3', BasicCardName.ATTACK, CardSuit.SPADE, 5),
        card('ca4', BasicCardName.ATTACK, CardSuit.SPADE, 6),
    ]
    s.deck = [card('dd1', BasicCardName.PEACH, CardSuit.CLUB, 1)]
    handleDiscard(s, HUMAN_PLAYER_ID, ['ca1', 'ca2'])
    const ask = s.pendingResponseQueue.find((p: any) => ['yufan_zongxuan', 'yufan_jie_zongxuan'].includes((p.context as any)?.skillId))
    check('AI 的虞翻也会被询问纵玄', !!ask, queue(s))
    if (ask) {
        s.pendingResponseQueue = [ask]
        aiRespond(s, AI_PLAYER_ID)
        check('AI 成功后纵玄询问已结算', !s.pendingResponseQueue.some(
            (p: any) => ['yufan_zongxuan', 'yufan_jie_zongxuan'].includes((p.context as any)?.skillId)), queue(s))
        check('AI 把牌放回牌堆顶', s.deck.slice(0, 2).map((c) => c.id).sort().join() === 'ca1,ca2',
            s.deck.map((c) => c.id))
        check('AI 没有把牌留在手里', !yf.hand.some((c) => c.id === 'ca1' || c.id === 'ca2'),
            yf.hand.map((c) => c.id))
    }
}

console.log('[良助]')
{
    // SP孙尚香在自己出牌阶段用【桃】回复体力，也要询问良助
    const s = build(['sunshangxiang_sp', 'huatuo', 'sunquan'], ['caocao', 'guojia', 'zhenji'], 81)
    const sp = s.generals[3]
    sp.hp = 2
    sp.hand = [
        card('lz-peach', BasicCardName.PEACH, CardSuit.HEART, 3),
        card('lz-dodge', BasicCardName.DODGE, CardSuit.HEART, 4),
    ]
    s.deck = Array.from({ length: 12 }, (_, i) => card('lzd' + i, BasicCardName.PEACH, CardSuit.CLUB, (i % 9) + 1))
    const res = handleUseCard(s, HUMAN_PLAYER_ID, { cardId: 'lz-peach', targetIndices: [] } as any)
    check('使用桃可以使用', !(res && 'error' in res), res)
    const ask = findPending(s, 'sp_sunshangxiang_liangzhu')
    check('SP孙尚香自己回血也询问良助', !!ask, queue(s))
    if (ask) {
        check('良助给出两个选项', ((ask.context as any).options ?? []).length === 2, (ask.context as any).options)
        s.pendingResponseQueue = [ask]
        const before = sp.hand.length
        handleRespond(s, HUMAN_PLAYER_ID, { action: 'target' } as any)
        check('选择摸两张时摸2张', sp.hand.length === before + 2, `${before} -> ${sp.hand.length}`)
    }
}

console.log('[英魂]')
{
    const s = build(['sunjian_jie', 'huatuo', 'sunquan'], ['caocao', 'guojia', 'zhenji'], 80)
    const sj = s.generals[3]
    sj.hp = sj.maxHp - 2
    s.deck = Array.from({ length: 12 }, (_, i) => card('yh' + i, BasicCardName.PEACH, CardSuit.CLUB, (i % 9) + 1))
    runTurnStart(s)
    const ask = s.pendingResponseQueue.find((p: any) => p.type === ResponseType.SKILL_YINGHUN_CHOOSE)
    check('已受伤的孙坚准备阶段询问英魂', !!ask && (ask.context as any).lostHp === 2, queue(s))
    if (ask) {
        s.pendingResponseQueue = [ask]
        const victim = s.generals[1]
        victim.hand = [
            card('yh-a', BasicCardName.ATTACK, CardSuit.SPADE, 7),
            card('yh-b', BasicCardName.ATTACK, CardSuit.SPADE, 8),
        ]
        const handBefore = victim.hand.length
        handleRespond(s, HUMAN_PLAYER_ID, { action: 'modeB', targetIndex: 1 } as any)
        check('模式B先令目标摸1张', victim.hand.length === handBefore + 1,
            `${handBefore} -> ${victim.hand.length}`)
        const discardAsk = s.pendingResponseQueue.find((p: any) => p.type === ResponseType.SKILL_YINGHUN_DISCARD)
        check('模式B再要求目标弃X张', !!discardAsk && (discardAsk.context as any).discardCount === 2,
            discardAsk ? (discardAsk.context as any).discardCount : queue(s))
    }
}

console.log('[武烈的“烈”]')
{
    const s = build(['sunjian', 'huatuo', 'sunquan'], ['caocao', 'guojia', 'zhenji'], 82)
    const marked = s.generals[4]
    marked.lieMarks = 1
    const hpBefore = marked.hp
    dealDamage(s, s.generals[0], marked, 2)
    check('有“烈”时伤害被防止', marked.hp === hpBefore, `${hpBefore} -> ${marked.hp}`)
    check('结算后移去1个“烈”', (marked.lieMarks ?? 0) === 0, marked.lieMarks)
    dealDamage(s, s.generals[0], marked, 1)
    check('“烈”用掉后伤害正常结算', marked.hp === hpBefore - 1, `${hpBefore} -> ${marked.hp}`)
}

console.log('[乱武：结算完再问下一人]')
{
    const s = build(['jiaxu', 'guanyu', 'huatuo'], ['huanggai', 'zhangfei', 'sunquan'], 83)
    s.activeGeneralIndex = 3
    s.generals.forEach((g, i) => { g.hand = [card('lw' + i, BasicCardName.ATTACK, CardSuit.SPADE, 7)] })
    const res = handleUseSkill(s, HUMAN_PLAYER_ID, {
        skillId: 'jiaxu_luanwu', cardIds: [], targetIndices: [],
    } as any)
    check('乱武可以发动', !(res && 'error' in res), res)
    const pidFor = (idx: number) => s.generals[idx].playerId
    const firstAsk = s.pendingResponseQueue[0]
    check('先询问第一名角色', firstAsk?.type === ResponseType.SKILL_LUANWU_RESPONSE, queue(s))
    const firstIdx = firstAsk.targetGeneralIndex
    handleRespond(s, pidFor(firstIdx), { cardId: 'lw' + firstIdx } as any)
    const pick = s.pendingResponseQueue.find((p: any) => p.type === ResponseType.SKILL_LUANWU_PICK_TARGET)
    check('多人最近时进入选目标', !!pick, queue(s))
    check('选目标阶段没有提前询问下一名角色',
        !s.pendingResponseQueue.some((p: any) => p.type === ResponseType.SKILL_LUANWU_RESPONSE), queue(s))
    if (pick) {
        const victimIdx = ((pick.context as any).candidateIndices as number[])[0]
        handleRespond(s, pidFor(firstIdx), { targetIndex: victimIdx } as any)
        check('选完目标后队列里只剩出【闪】询问',
            s.pendingResponseQueue.length === 1
            && s.pendingResponseQueue[0].type === ResponseType.DODGE, queue(s))
        const logFrom = s.log.length
        handleRespond(s, pidFor(victimIdx), {} as any)
        const damageAt = s.log.findIndex((l: any, i: number) => i >= logFrom
            && l.text.includes('受到 1 点伤害'))
        const nextAskAt = s.log.findIndex((l: any, i: number) => i >= logFrom
            && l.text.includes('距离最近的角色为'))
        check('【杀】结算完才询问下一名角色', damageAt >= 0 && nextAskAt > damageAt,
            { damageAt, nextAskAt, tail: s.log.slice(-4).map((l: any) => l.text) })
    }
}

console.log('[失去体力进濒死不触发遗计]')
{
    // 乱武放弃出杀 = 失去体力，不是受到伤害：濒死被救回后不应询问遗计
    const setup = (seed: number) => {
        const s = build(['jiaxu', 'guojia', 'sunquan'], ['huanggai', 'huatuo', 'zhangfei'], seed)
        const gj = s.generals[4]
        gj.hp = 1
        gj.hand = [card('yj-peach', BasicCardName.PEACH, CardSuit.HEART, 3)]
        s.deck = Array.from({ length: 12 }, (_, i) => card('yjd' + i, BasicCardName.PEACH, CardSuit.CLUB, (i % 9) + 1))
        return { s, gj }
    }
    {
        const { s, gj } = setup(84)
        loseHp(s, gj, 1)
        const ask = s.pendingResponseQueue.find((p: any) => p.type === ResponseType.PEACH_SAVE_ASK)
        check('失去体力濒死会询问救援', !!ask, queue(s))
        if (ask) {
            const rescueRes = handleRespond(s, HUMAN_PLAYER_ID, { action: 'peach', cardId: 'yj-peach' } as any)
            check('救援结算成功', !(rescueRes && 'error' in rescueRes), rescueRes)
            check('失去体力濒死被救回后不询问遗计',
                !s.pendingResponseQueue.some((p: any) => (p.context as any)?.skillId === 'guojia_yiji'),
                queue(s))
        }
    }
    {
        // 对照：真正受到伤害后（濒死被救回）仍然询问遗计
        const { s, gj } = setup(85)
        dealDamage(s, s.generals[0], gj, 1)
        const ask = s.pendingResponseQueue.find((p: any) => p.type === ResponseType.PEACH_SAVE_ASK)
        check('受到伤害濒死也会询问救援', !!ask, queue(s))
        if (ask) {
            handleRespond(s, HUMAN_PLAYER_ID, { action: 'peach', cardId: 'yj-peach' } as any)
            check('受到伤害后正常询问遗计',
                s.pendingResponseQueue.some((p: any) => ['guojia_yiji', 'guojia_jie_yiji'].includes((p.context as any)?.skillId)),
                queue(s))
        }
    }
}

console.log('[濒死询问：轮转换对象 + 兜底结算]')
{
    const s = build(['sunquan', 'huatuo', 'jiangwei'], ['zhangfei', 'guojia', 'zhenji'], 86)
    const zf = s.generals[0]
    const jw = s.generals[5]
    s.activeGeneralIndex = 5
    zf.hp = 2
    zf.hand = []
    jw.hand = [
        card('dy-w', BasicCardName.WINE, CardSuit.DIAMOND, 9),
        card('dy-s', BasicCardName.ATTACK, CardSuit.SPADE, 7),
    ]
    s.deck = Array.from({ length: 12 }, (_, i) => card('dyd' + i, BasicCardName.PEACH, CardSuit.CLUB, (i % 9) + 1))
    handleUseCard(s, HUMAN_PLAYER_ID, { cardId: 'dy-w', targetIndices: [] } as any)
    handleUseCard(s, HUMAN_PLAYER_ID, { cardId: 'dy-s', targetIndices: [0] } as any)
    handleRespond(s, AI_PLAYER_ID, {} as any)   // 张飞不出闪 → 2 点伤害 → 濒死
    const firstAsk = s.pendingResponseQueue[0]
    check('酒杀造成濒死并询问救援',
        firstAsk?.type === ResponseType.PEACH_SAVE_ASK && zf.hp <= 0,
        { type: firstAsk?.type, hp: zf.hp })
    const before = s.pendingResponseQueue[0]
    const beforeAsker = before?.targetGeneralIndex
    handleRespond(s, AI_PLAYER_ID, {} as any)   // 张飞放弃
    const after = s.pendingResponseQueue[0]
    check('放弃后轮转给下一名角色', !!after && after.type === ResponseType.PEACH_SAVE_ASK
        && after.targetGeneralIndex !== beforeAsker,
        { before: beforeAsker, after: after?.targetGeneralIndex })
    check('轮转时换成新的询问对象（调用方靠身份判断推进）', after !== before, 'same object')

    // 模拟旧 bug：濒死询问被外部丢弃
    s.pendingResponseQueue = s.pendingResponseQueue.filter((p: any) => p.type !== ResponseType.PEACH_SAVE_ASK)
    processAutoExecutePending(s)
    check('濒死询问丢失时兜底判定阵亡', !zf.alive, `alive=${zf.alive} hp=${zf.hp}`)
}

console.log('[嘲讽向量]')
{
    const hand = (n: number) => Array.from({ length: n }, (_, i) =>
        card(`tv-h${i}`, BasicCardName.ATTACK, CardSuit.SPADE, (i % 9) + 1))

    const s = build(['sunquan', 'huatuo', 'caocao'], ['guojia', 'lusu_jie', 'zhangfei'], 120)
    const gj = s.generals[0]
    const ls = s.generals[1]
    const zf = s.generals[2]
    check('郭嘉：主动低、被动强（负值）', activeAbility(s, gj) < 40 && passiveAbility(s, gj) < -60,
        { active: activeAbility(s, gj), passive: passiveAbility(s, gj) })
    check('鲁肃：主动高、无被动防御', activeAbility(s, ls) > 80 && passiveAbility(s, ls) === 0,
        { active: activeAbility(s, ls), passive: passiveAbility(s, ls) })
    check('指定武将近战预设生效',
        tauntPresetOf('lusu_jie').active === 95 && tauntPresetOf('lusu_jie').hand === 9 &&
        tauntPresetOf('shenlusu').active === 90 && tauntPresetOf('shenlusu').hand === 9 &&
        tauntPresetOf('lvbu').active === 40 && tauntPresetOf('lvbu_jing').active === 40 &&
        tauntPresetOf('zhangfei').hand === 7 && tauntPresetOf('zhangfei_jie').hand === 7,
        [tauntPresetOf('lusu_jie'), tauntPresetOf('shenlusu'), tauntPresetOf('lvbu'), tauntPresetOf('zhangfei')])
    check('无防御被动为 0，防御被动为负',
        tauntPresetOf('lusu_jie').passive === 0 && tauntPresetOf('shenlusu').passive === 0 &&
        tauntPresetOf('guojia').passive < 0 && tauntPresetOf('xiahoudun').passive < 0)

    const zfBase = activeAbility(s, zf)
    zf.hand = hand(6)
    check('张飞手牌越多主动能力越高', activeAbility(s, zf) > zfBase + 10,
        { before: zfBase, after: activeAbility(s, zf) })
    zf.hand = []

    const activeBase = activeAbility(s, gj)
    gj.judgeZone = [card('tv-le', TrickCardName.OVERINDULGENCE, CardSuit.HEART, 6,
        CardCategory.TRICK, { trickType: 'delayed' })]
    const withLe = activeAbility(s, gj)
    gj.judgeZone = [card('tv-bing', TrickCardName.SUPPLY_SHORTAGE, CardSuit.CLUB, 6,
        CardCategory.TRICK, { trickType: 'delayed' })]
    const withBing = activeAbility(s, gj)
    gj.judgeZone = []
    check('乐不思蜀明显降低主动能力', withLe < activeBase - 20, { base: activeBase, withLe })
    check('兵粮寸断降低主动能力但弱于乐', withBing < activeBase && withBing > withLe,
        { withBing, withLe })
    gj.flipped = true
    check('翻面降低主动能力', activeAbility(s, gj) < activeBase - 30, activeAbility(s, gj))
    gj.flipped = false

    const s2 = build(['sunquan', 'huatuo', 'caocao'], ['weiyan', 'lusu_jie', 'zhangfei'], 121)
    const wy = s2.generals[0]
    const wyBase = activeAbility(s2, wy)
    wy.usedLimitedSkills = ['weiyan_qimou']
    check('限定技用掉后主动能力下降', activeAbility(s2, wy) < wyBase - 15,
        { before: wyBase, after: activeAbility(s2, wy) })

    const s3 = build(['sunquan', 'huatuo', 'caocao'], ['sunce', 'lusu_jie', 'zhangfei'], 122)
    const sc = s3.generals[0]
    const scBase = activeAbility(s3, sc)
    sc.awakened = true
    check('觉醒后主动能力提升', activeAbility(s3, sc) > scBase + 10,
        { before: scBase, after: activeAbility(s3, sc) })

    const s4 = build(['sunquan', 'huatuo', 'caocao'], ['zhangfei', 'lusu_jie', 'guojia'], 123)
    const t = s4.generals[0]
    t.hp = t.maxHp
    t.hand = hand(4)
    t.equip.armor = card('tv-armor', EquipmentCardName.EIGHT_TRIGRAMS, CardSuit.SPADE, 2,
        CardCategory.EQUIPMENT, { equipSlot: EquipSlot.ARMOR })
    t.equip.plus_horse = card('tv-horse', EquipmentCardName.PLUS_HORSE, CardSuit.HEART, 5,
        CardCategory.EQUIPMENT, { equipSlot: EquipSlot.PLUS_HORSE })
    const healthy = healthState(s4, t)
    t.hp = 1
    t.hand = []
    delete t.equip.armor
    delete t.equip.plus_horse
    const weak = healthState(s4, t)
    check('体力/手牌/防具越差健康状态越低', healthy > weak + 30, { healthy, weak })

    const commander = s4.generals[1]
    check('主帅身份单独计价', identityValue(commander) === 100 && identityValue(t) === 0,
        { commander: identityValue(commander), flank: identityValue(t) })

    // 同一健康状态下，主动高的鲁肃比卖血的郭嘉更该先压
    const gja = s4.generals[2]
    const lsa = s4.generals[1]
    for (const g of [gja, lsa]) {
        g.seatRole = SeatRole.FLANK_A
        g.hp = g.maxHp
        g.hand = hand(2)
        g.equip = {}
    }
    check('主动高的目标嘲讽更高',
        tauntScore(tauntVector(s4, lsa)) > tauntScore(tauntVector(s4, gja)) + 50,
        { lusu: tauntScore(tauntVector(s4, lsa)), guojia: tauntScore(tauntVector(s4, gja)) })

    // 连携：郭嘉 + 小乔比郭嘉 + 无关武将更能放大主动/被动
    const withSynergy = build(['sunquan', 'huatuo', 'caocao'], ['guojia', 'xiaoqiao', 'zhangfei'], 124)
    const alone = build(['sunquan', 'huatuo', 'caocao'], ['guojia', 'lusu_jie', 'zhangfei'], 124)
    check('队友连携使郭嘉的被动更负',
        activeAbility(withSynergy, withSynergy.generals[0]) > activeAbility(alone, alone.generals[0]) + 3 &&
        passiveAbility(withSynergy, withSynergy.generals[0]) < passiveAbility(alone, alone.generals[0]) - 2)
}

console.log('[曹髦]')
{
    // 忿肆：锁定的【杀】走完整结算（距离、闪），不是直接扣血
    const fs = build(['caomao', 'huatuo', 'sunquan'], ['guojia', 'zhenji', 'xiahoudun'], 90)
    const fsCao = fs.generals[3]
    fs.generals[0].hp = 2
    fs.generals[1].hp = 2
    fs.generals[2].hp = 3
    fs.generals[4].hp = 1
    fs.generals[5].hp = 1
    const fsVictim = fs.generals[2]
    fsVictim.hand = []
    fs.activeGeneralIndex = 3
    fs.activePlayerFaction = Faction.WARM
    fs.turnPhase = TurnPhase.TURN_START
    fs.deck = Array.from({ length: 8 }, (_, i) =>
        card('fsd' + i, BasicCardName.PEACH, CardSuit.HEART, (i % 9) + 1))
    const fsHp = fsCao.hp
    const fsVictimHp = fsVictim.hp
    runTurnStart(fs)
    check('忿肆令体力最高者受到1点伤害', fsVictim.hp === fsVictimHp - 1, `${fsVictimHp} -> ${fsVictim.hp}`)
    const fsDodge = fs.pendingResponseQueue.find((p: any) => p.type === ResponseType.DODGE)
    check('忿肆的【杀】进入闪响应结算', !!fsDodge, queue(fs))
    if (fsDodge) {
        fs.pendingResponseQueue = [fsDodge]
        handleRespond(fs, HUMAN_PLAYER_ID, {} as any)
        check('忿肆的【杀】命中后曹髦受到伤害', fsCao.hp === fsHp - 1, `${fsHp} -> ${fsCao.hp}`)
    }

    // 决讨：出牌阶段开始时询问，确认后依次使用牌堆底的牌直到不能使用
    const jt = build(['caomao', 'huatuo', 'sunquan'], ['guojia', 'zhenji', 'xiahoudun'], 91)
    const jtCao = jt.generals[3]
    jtCao.hp = 1
    jt.generals[2].hand = []
    jt.deck = [
        card('jt-top', BasicCardName.DODGE, CardSuit.HEART, 2),
        card('jt-bottom', BasicCardName.ATTACK, CardSuit.SPADE, 7),
    ]
    beginActionPhase(jt, jtCao)
    const jtAsk = findPending(jt, 'caomao_juetao')
    check('体力为1时出牌阶段开始询问决讨', !!jtAsk, queue(jt))
    if (jtAsk) {
        jt.pendingResponseQueue = [jtAsk]
        const jtDeckBefore = jt.deck.length
        handleRespond(jt, HUMAN_PLAYER_ID, { action: 'confirm', targetIndex: 2 } as any)
        check('决讨从牌堆底取牌使用', jt.deck.length === jtDeckBefore - 1 && jt.deck[0]?.id === 'jt-top',
            jt.deck.map((c: any) => c.id))
        check('决讨标记为已发动', jtCao.usedLimitedSkills.includes('caomao_juetao'), jtCao.usedLimitedSkills)
        const jtDodge = jt.pendingResponseQueue.find((p: any) => p.type === ResponseType.DODGE)
        check('决讨使用的【杀】正常询问闪', !!jtDodge, queue(jt))
        if (jtDodge) {
            jt.pendingResponseQueue = [jtDodge]
            handleRespond(jt, AI_PLAYER_ID, { action: 'pass' } as any)
            check('决讨使用的【杀】照常结算伤害', jt.generals[2].hp === 3, jt.generals[2].hp)
        }
    }

    // 决讨：牌堆底是不能主动使用的【闪】时立刻停止，牌留在牌堆底
    const jt2 = build(['caomao', 'huatuo', 'sunquan'], ['guojia', 'zhenji', 'xiahoudun'], 92)
    const jt2Cao = jt2.generals[3]
    jt2Cao.hp = 1
    jt2.deck = [card('jt2-bottom', BasicCardName.DODGE, CardSuit.HEART, 4)]
    jt2.pendingResponseQueue = [{
        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
        targetGeneralIndex: 3,
        context: { skillId: 'caomao_juetao', skillName: '决讨', juetaoCandidates: [0, 1, 2] },
    }]
    handleRespond(jt2, HUMAN_PLAYER_ID, { action: 'confirm', targetIndex: 0 } as any)
    check('不能使用的牌留在牌堆底并停止',
        jt2.deck.length === 1 && jt2.deck[0].id === 'jt2-bottom' && jt2Cao.hand.length === 0,
        { deck: jt2.deck.map((c: any) => c.id), hand: jt2Cao.hand.map((c: any) => c.id) })
}

console.log('[洛书版第十批]')
{
    // 峻刑：弃牌后目标选择翻面摸牌
    const jx = build(['manchong', 'huatuo', 'sunquan'], ['caocao', 'guojia', 'zhenji'], 108)
    const jxMan = jx.generals[3]
    jx.deck = Array.from({ length: 6 }, (_, i) =>
        card('jxd' + i, BasicCardName.PEACH, CardSuit.HEART, (i % 9) + 1))
    jxMan.hand = [
        card('jx1', BasicCardName.ATTACK, CardSuit.SPADE, 7),
        card('jx2', BasicCardName.DODGE, CardSuit.HEART, 2),
    ]
    const jxTarget = jx.generals[0]
    jxTarget.hand = [card('jxt1', BasicCardName.PEACH, CardSuit.HEART, 3)]
    handleUseSkill(jx, HUMAN_PLAYER_ID, { skillId: 'manchong_junxing', targetIndices: [0] } as any)
    handleRespond(jx, HUMAN_PLAYER_ID, { cardIds: ['jx1'] } as any)
    check('峻刑询问目标', !!findPending(jx, 'manchong_junxing_choice'), queue(jx))
    handleRespond(jx, AI_PLAYER_ID, { action: 'flip' } as any)
    check('峻刑翻面并摸等量牌', jxTarget.flipped === true && jxTarget.hand.length === 2,
        { flipped: jxTarget.flipped, hand: jxTarget.hand.length })

    // 御策：受伤后来源选择令其回复体力
    const yc = build(['manchong', 'huatuo', 'sunquan'], ['caocao', 'guojia', 'zhenji'], 109)
    const ycMan = yc.generals[3]
    ycMan.hand = [card('yc1', BasicCardName.ATTACK, CardSuit.SPADE, 5)]
    dealDamage(yc, yc.generals[0], ycMan, 1)
    const ycAsk = findPending(yc, 'manchong_yuce')
    check('御策受伤后询问来源', !!ycAsk, queue(yc))
    if (ycAsk) {
        yc.pendingResponseQueue = [ycAsk]
        handleRespond(yc, AI_PLAYER_ID, { action: 'heal' } as any)
        check('御策令满宠回复1点体力', ycMan.hp === ycMan.maxHp, `${ycMan.hp}/${ycMan.maxHp}`)
    }

    // 弼昏：手牌数大于上限时，指定他人的牌被取消并由唯一目标获得
    const bh = build(['zhanghua', 'huatuo', 'sunquan'], ['caocao', 'guojia', 'zhenji'], 110)
    const bhZhang = bh.generals[3]
    bhZhang.hp = 3
    bhZhang.handLimitDelta = -2
    bhZhang.hand = [
        card('bh-trick', TrickCardName.DISMANTLE, CardSuit.SPADE, 3, CardCategory.TRICK, { trickType: 'instant' }),
        card('bh2', BasicCardName.DODGE, CardSuit.HEART, 2),
    ]
    bh.generals[0].hand = [card('bh-peach', BasicCardName.PEACH, CardSuit.HEART, 4)]
    handleUseCard(bh, HUMAN_PLAYER_ID, { cardId: 'bh-trick', targetIndices: [0] } as any)
    check('弼昏取消并令唯一目标获得此牌',
        bh.generals[0].hand.some((c: any) => c.id === 'bh-trick'), bh.generals[0].hand.map((c: any) => c.id))

    // 辟田：受伤后手牌上限+1
    const pt = build(['zhenghun', 'huatuo', 'sunquan'], ['caocao', 'guojia', 'zhenji'], 111)
    const ptZheng = pt.generals[3]
    dealDamage(pt, pt.generals[0], ptZheng, 1)
    check('辟田受伤后手牌上限+1', ptZheng.pitianBonus === 1, ptZheng.pitianBonus)

    // 移荣：摸至手牌上限，然后手牌上限-1
    const yr = build(['wuxian_zu', 'huatuo', 'sunquan'], ['caocao', 'guojia', 'zhenji'], 112)
    const yrWu = yr.generals[3]
    yr.deck = Array.from({ length: 6 }, (_, i) =>
        card('yrd' + i, BasicCardName.PEACH, CardSuit.HEART, (i % 9) + 1))
    yrWu.hand = [card('yr1', BasicCardName.ATTACK, CardSuit.SPADE, 7)]
    handleUseSkill(yr, HUMAN_PLAYER_ID, { skillId: 'wuxian_zu_yirong' } as any)
    handleRespond(yr, HUMAN_PLAYER_ID, { action: 'draw' } as any)
    check('移荣摸至上限并令上限-1', yrWu.hand.length === 3 && yrWu.handLimitDelta === -1,
        { hand: yrWu.hand.length, delta: yrWu.handLimitDelta })

    // 泥首：装备区的牌进入弃牌堆后，可当【闪电】置于判定区
    const ns = build(['quhuang', 'huatuo', 'sunquan'], ['caocao', 'guojia', 'zhenji'], 115)
    const nsQu = ns.generals[3]
    nsQu.equip.weapon = card('ns-old', EquipmentCardName.CROSSBOW, CardSuit.SPADE, 1,
        CardCategory.EQUIPMENT, { equipSlot: EquipSlot.WEAPON })
    nsQu.hand = [card('ns-new', EquipmentCardName.KYLIN_BOW, CardSuit.HEART, 5,
        CardCategory.EQUIPMENT, { equipSlot: EquipSlot.WEAPON })]
    handleUseCard(ns, HUMAN_PLAYER_ID, { cardId: 'ns-new', targetIndices: [] } as any)
    const nsAsk = findPending(ns, 'quhuang_nishou')
    check('泥首装备牌进弃牌堆后询问', !!nsAsk, queue(ns))
    if (nsAsk) {
        ns.pendingResponseQueue = [nsAsk]
        handleRespond(ns, HUMAN_PLAYER_ID, { action: 'lightning' } as any)
        check('泥首将弃牌当闪电置于判定区',
            nsQu.judgeZone.length === 1 && nsQu.judgeZone[0].name === TrickCardName.LIGHTNING,
            nsQu.judgeZone.map((c: any) => c.name))
    }

    // 冲阵：以【龙胆】将【闪】当【杀】使用后询问
    const cz = build(['zhaoyun_sp', 'huatuo', 'sunquan'], ['caocao', 'guojia', 'zhenji'], 116)
    const czZhao = cz.generals[3]
    const czFoe = cz.generals[2]
    czZhao.hand = [card('cz-dodge', BasicCardName.DODGE, CardSuit.HEART, 7), card('cz-keep', BasicCardName.ATTACK, CardSuit.SPADE, 6)]
    czFoe.hand = [card('cz-f1', BasicCardName.PEACH, CardSuit.DIAMOND, 3), card('cz-f2', BasicCardName.DODGE, CardSuit.CLUB, 4)]
    cz.deck = Array.from({ length: 6 }, (_, i) => card('czd' + i, BasicCardName.ATTACK, CardSuit.CLUB, (i % 9) + 1))
    handleUseCard(cz, HUMAN_PLAYER_ID, { cardId: 'cz-dodge', targetIndices: [2] } as any)
    const czAsk = findPending(cz, 'zhaoyun_sp_chongzhen')
    check('冲阵龙胆当杀后询问', !!czAsk, queue(cz))
    if (czAsk) {
        const czFoeBefore = czFoe.hand.length
        cz.pendingResponseQueue = [czAsk]
        handleRespond(cz, HUMAN_PLAYER_ID, { action: 'steal' } as any)
        check('冲阵获得对方一张手牌',
            czZhao.hand.length === 2 && czFoe.hand.length === czFoeBefore - 1,
            { own: czZhao.hand.length, foe: czFoe.hand.length })
    }

    // 苟得：同势力角色本回合执行过项后，回合结束时可执行一个未执行过的项
    const gd = build(['mengda', 'huatuo', 'sunquan'], ['caocao', 'guojia', 'zhenji'], 117)
    const gdMeng = gd.generals[3]
    gd.turnSerial = 5
    gd.deck = Array.from({ length: 6 }, (_, i) => card('gdd' + i, BasicCardName.PEACH, CardSuit.HEART, (i % 9) + 1))
    gdMeng.goudeTurn = 5
    gdMeng.goudeMask = 1
    triggerGoude(gd, gd.generals[0])
    const gdAsk = findPending(gd, 'mengda_goude')
    check('苟得同势力执行过项后询问', !!gdAsk && ((gdAsk.context as any).options ?? []).length === 3, queue(gd))
    if (gdAsk) {
        gd.pendingResponseQueue = [gdAsk]
        handleRespond(gd, HUMAN_PLAYER_ID, { action: '2' } as any)
        check('苟得弃置一名角色一张手牌',
            gdMeng.goudeMask === 3 && gd.generals.slice(0, 3).some((g: any) => g.hand.length === 0),
            { mask: gdMeng.goudeMask, hands: gd.generals.map((g: any) => g.hand.length) })
    }

    // 慨公：对他人造成伤害后，可展示手牌与牌堆底交换
    const kg = build(['lidian_ji', 'huatuo', 'sunquan'], ['caocao', 'guojia', 'zhenji'], 118)
    const kgOwner = kg.generals[3]
    kgOwner.hand = [
        card('kg1', BasicCardName.ATTACK, CardSuit.SPADE, 3),
        card('kg2', BasicCardName.DODGE, CardSuit.HEART, 4),
    ]
    kg.deck = Array.from({ length: 6 }, (_, i) => card('kgd' + i, BasicCardName.PEACH, CardSuit.CLUB, (i % 9) + 1))
    kg.generals[0].hand = []
    dealDamage(kg, kgOwner, kg.generals[0], 1)
    const kgAsk = findPending(kg, 'lidian_ji_kaigong')
    check('慨公对他人造成伤害后询问', !!kgAsk, queue(kg))
    if (kgAsk) {
        kg.pendingResponseQueue = [kgAsk]
        handleRespond(kg, HUMAN_PLAYER_ID, { action: 'self' } as any)
        const kgPick = findPending(kg, 'lidian_ji_kaigong_pick')
        check('慨公可展示自己的手牌', !!kgPick, queue(kg))
        if (kgPick) {
            kg.pendingResponseQueue = [kgPick]
            handleRespond(kg, HUMAN_PLAYER_ID, { action: 'confirm', cardIds: ['kg1'] } as any)
            check('慨公展示牌与牌堆底交换',
                !kgOwner.hand.some((c: any) => c.id === 'kg1')
                && kg.deck[kg.deck.length - 1]?.id === 'kg1'
                && kgOwner.kaigongTurn === kg.turnSerial,
                { hand: kgOwner.hand.map((c: any) => c.id), bottom: kg.deck[kg.deck.length - 1]?.id })
        }
    }

    // 带砺：手牌被展示时标记，回合结束时偶数张可翻面摸三张并展示
    const dl = build(['luoxian', 'huatuo', 'sunquan'], ['caocao', 'guojia', 'zhenji'], 119)
    const dlLuo = dl.generals[3]
    dlLuo.hand = [
        card('dl1', BasicCardName.ATTACK, CardSuit.SPADE, 3),
        card('dl2', BasicCardName.DODGE, CardSuit.HEART, 4),
        card('dl3', BasicCardName.PEACH, CardSuit.CLUB, 5),
    ]
    dl.deck = Array.from({ length: 6 }, (_, i) => card('dld' + i, BasicCardName.PEACH, CardSuit.DIAMOND, (i % 9) + 1))
    markDaili(dl, dlLuo, [dlLuo.hand[0], dlLuo.hand[1]])
    check('带砺标记展示的手牌', (dlLuo.dailiCardIds ?? []).length === 2, { ids: dlLuo.dailiCardIds })
    triggerDaili(dl, dl.generals[0])
    const dlAsk = findPending(dl, 'luoxian_daili')
    check('带砺偶数张回合结束询问', !!dlAsk, queue(dl))
    if (dlAsk) {
        dl.pendingResponseQueue = [dlAsk]
        handleRespond(dl, HUMAN_PLAYER_ID, { action: 'flip' } as any)
        check('带砺翻面摸三张并展示',
            dlLuo.flipped === true && dlLuo.hand.length === 6 && (dlLuo.dailiCardIds ?? []).length === 5,
            { flipped: dlLuo.flipped, hand: dlLuo.hand.length, ids: dlLuo.dailiCardIds })
    }

    // 带砺：奇数张时不询问
    const dl2 = build(['luoxian', 'huatuo', 'sunquan'], ['caocao', 'guojia', 'zhenji'], 120)
    const dl2Luo = dl2.generals[3]
    dl2Luo.hand = [
        card('dl2a', BasicCardName.ATTACK, CardSuit.SPADE, 3),
        card('dl2b', BasicCardName.DODGE, CardSuit.HEART, 4),
    ]
    markDaili(dl2, dl2Luo, [dl2Luo.hand[0]])
    triggerDaili(dl2, dl2.generals[0])
    check('带砺奇数张不询问', !findPending(dl2, 'luoxian_daili'), queue(dl2))

    // 贵相：本回合第 X 个阶段（X=手牌上限）改为出牌阶段
    const gx = build(['wuxian_zu', 'huatuo', 'sunquan'], ['caocao', 'guojia', 'zhenji'], 121)
    const gxWu = gx.generals[3]
    gxWu.hp = 2
    gx.activeGeneralIndex = 3
    gx.turnPhase = TurnPhase.TURN_START
    gx.pendingResponseQueue = []
    runTurnStart(gx)
    check('贵相将第2个阶段（判定）改为出牌阶段',
        gxWu.guixiangPhases === 2 && (gx.turnPhase as TurnPhase) === TurnPhase.ACTION,
        { phases: gxWu.guixiangPhases, phase: gx.turnPhase, queue: queue(gx) })

    // 逐日：阶段结束时手牌数变化则拼点
    const zr = build(['jiangwei_mou', 'huatuo', 'sunquan'], ['caocao', 'guojia', 'zhenji'], 122)
    const zrJw = zr.generals[3]
    zrJw.hand = [card('zr1', BasicCardName.ATTACK, CardSuit.SPADE, 13)]
    zr.generals[0].hand = [card('zr-f1', BasicCardName.PEACH, CardSuit.CLUB, 3)]
    maybeZhuri(zr, zrJw)
    zrJw.hand.push(card('zr2', BasicCardName.ATTACK, CardSuit.HEART, 13))
    zr.turnPhase = TurnPhase.DRAW
    maybeZhuri(zr, zrJw)
    const zrAsk = findPending(zr, 'jiangwei_mou_zhuri')
    check('逐日手牌数变化后询问拼点', !!zrAsk, queue(zr))
    if (zrAsk) {
        zr.pendingResponseQueue = [zrAsk]
        handleRespond(zr, HUMAN_PLAYER_ID, { targetIndex: 0 } as any)
        const zrPick = findPending(zr, 'pindian_pick')
        check('逐日拼点由发起者自选手牌', !!zrPick && zrPick.targetGeneralIndex === 3, queue(zr))
        if (zrPick) {
            zr.pendingResponseQueue = [zrPick]
            handleRespond(zr, HUMAN_PLAYER_ID, { action: 'confirm', cardIds: ['zr1'] } as any)
            const zrOppPick = findPending(zr, 'pindian_pick')
            check('拼点由对方自选手牌', !!zrOppPick && zrOppPick.targetGeneralIndex === 0, queue(zr))
            if (zrOppPick) {
                zr.pendingResponseQueue = [zrOppPick]
                handleRespond(zr, AI_PLAYER_ID, { action: 'confirm', cardIds: ['zr-f1'] } as any)
            }
            check('逐日拼点赢后可选用拼点牌', !!findPending(zr, 'jiangwei_mou_zhuri_use'), queue(zr))
        }
    }

    // 燃己：按本回合用牌阶段数获得【困奋】/【诈降】，然后调整手牌或体力
    const rj = build(['jiangwei_mou', 'huatuo', 'sunquan'], ['caocao', 'guojia', 'zhenji'], 126)
    const rjJw = rj.generals[3]
    rjJw.hp = rjJw.maxHp - 1
    rjJw.hand = [card('rj1', BasicCardName.ATTACK, CardSuit.SPADE, 7)]
    rj.pendingResponseQueue = [{
        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
        targetGeneralIndex: 3,
        context: {
            skillId: 'jiangwei_mou_ranji', skillName: '燃己',
            description: '本回合于1个阶段使用过牌，获得一个技能',
            options: [
                { action: 'kunfen', label: '获得【困奋】' },
                { action: 'zhaoxiang', label: '获得【诈降】' },
            ],
        },
    }]
    handleRespond(rj, HUMAN_PLAYER_ID, { action: 'zhaoxiang' } as any)
    check('燃己获得【诈降】并限定技已用',
        rjJw.acquiredSkills.includes('huanggai_zhaxiang')
        && rjJw.usedLimitedSkills.includes('jiangwei_mou_ranji'),
        { acquired: rjJw.acquiredSkills, limited: rjJw.usedLimitedSkills })
    const rjAdjust = findPending(rj, 'jiangwei_mou_ranji_adjust')
    check('燃己随后询问调整手牌或体力', !!rjAdjust, queue(rj))
    if (rjAdjust) {
        rj.pendingResponseQueue = [rjAdjust]
        handleRespond(rj, HUMAN_PLAYER_ID, { action: 'hp' } as any)
    }
    check('燃己调整体力至上限并禁止回复',
        rjJw.hp === rjJw.maxHp && rjJw.noRecoverUntilKill === true,
        { hp: rjJw.hp, maxHp: rjJw.maxHp, noRecover: rjJw.noRecoverUntilKill })

    // 困奋：结束阶段失去1点体力，摸两张牌
    const kf = build(['jiangwei_mou', 'huatuo', 'sunquan'], ['caocao', 'guojia', 'zhenji'], 127)
    const kfJw = kf.generals[3]
    kfJw.hp = kfJw.maxHp - 1
    const kfHpBefore = kfJw.hp
    const kfHandBefore = kfJw.hand.length
    for (let i = 0; i < 4; i++) {
        kf.deck.push(card(`kf-deck-${i}`, BasicCardName.DODGE, CardSuit.HEART, i + 2))
    }
    kf.pendingResponseQueue = [{
        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
        targetGeneralIndex: 3,
        context: {
            skillId: 'jiangwei_mou_kunfen', skillName: '困奋',
            description: '失去1点体力，摸两张牌',
            options: [
                { action: 'loseHp', label: '失去1点体力，摸两张牌' },
                { action: 'decline', label: '不发动' },
            ],
        },
    }]
    handleRespond(kf, HUMAN_PLAYER_ID, { action: 'loseHp' } as any)
    check('困奋失去1点体力并摸两张牌',
        kfJw.hp === kfHpBefore - 1 && kfJw.hand.length === kfHandBefore + 2,
        { hp: kfJw.hp, hand: kfJw.hand.length, queue: queue(kf) })

    // 晖云：一张牌当【火攻】，结算后令目标摸牌
    const hy = build(['huban', 'huatuo', 'sunquan'], ['caocao', 'guojia', 'zhenji'], 128)
    const hyHuban = hy.generals[3]
    hy.activeGeneralIndex = 3
    hy.turnPhase = TurnPhase.ACTION
    hyHuban.hand = [card('hy1', BasicCardName.ATTACK, CardSuit.SPADE, 7)]
    hy.generals[0].hand = [card('hy-t', BasicCardName.DODGE, CardSuit.HEART, 2)]
    for (let i = 0; i < 4; i++) {
        hy.deck.push(card(`hy-d${i}`, BasicCardName.DODGE, CardSuit.CLUB, i + 2))
    }
    const hyOut = handleUseSkill(hy, HUMAN_PLAYER_ID, { skillId: 'huban_huiyun', cardIds: ['hy1'], targetIndices: [0] } as any)
    for (let i = 0; i < 4 && hy.negateWindow; i++) negateWindowTimeout(hy)
    const hyShow = hy.pendingResponseQueue.find(p => p.type === ResponseType.FIRE_ATTACK_SHOW)
    check('晖云将手牌当【火攻】使用', !!hyShow, { queue: queue(hy), err: hyOut })
    if (hyShow) {
        hy.pendingResponseQueue = [hyShow]
        handleRespond(hy, AI_PLAYER_ID, { cardId: 'hy-t' } as any)
        const hyAsk = findPending(hy, 'huban_huiyun')
        check('晖云火攻结算后询问选项', !!hyAsk, queue(hy))
        if (hyAsk) {
            const hyFoeBefore = hy.generals[0].hand.length
            hy.pendingResponseQueue = [hyAsk]
            handleRespond(hy, HUMAN_PLAYER_ID, { action: 'draw' } as any)
            check('晖云选项令目标摸一张牌', hy.generals[0].hand.length === hyFoeBefore + 1,
                { hand: hy.generals[0].hand.length })
        }
    }

    // 评荐：随机抽取三个技能并获得其中一个
    const pj = build(['xushao', 'huatuo', 'sunquan'], ['caocao', 'guojia', 'zhenji'], 129)
    const pjXu = pj.generals[3]
    maybePingjian(pj, pjXu)
    const pjAsk = findPending(pj, 'xushao_pingjian')
    const pjOptions = ((pjAsk?.context as any)?.options ?? []) as { action: string }[]
    check('评荐随机抽取三个技能', !!pjAsk && pjOptions.length === 3, pjOptions.map(o => o.action))
    if (pjAsk) {
        pj.pendingResponseQueue = [pjAsk]
        handleRespond(pj, HUMAN_PLAYER_ID, { action: pjOptions[0].action } as any)
    }
    check('评荐获得所选技能',
        pjOptions.length > 0 && pjXu.acquiredSkills.includes(pjOptions[0].action)
        && (pjXu.pingjianGained ?? []).includes(pjOptions[0].action),
        { acquired: pjXu.acquiredSkills, gained: pjXu.pingjianGained })

    // 每轮机制：同一角色第二次行动时轮次+1
    const rd = build(['huatuo', 'sunquan', 'caocao'], ['guojia', 'zhenji', 'zhangfei'], 123)
    const rdStartRound = rd.roundSerial ?? 0
    rd.activeGeneralIndex = 3
    runTurnStart(rd)
    check('首轮不推进轮次', (rd.roundSerial ?? 0) === rdStartRound,
        { serial: rd.roundSerial, seen: rd.roundSeen })
    rd.activeGeneralIndex = 3
    runTurnStart(rd)
    check('同一角色再次行动时轮次+1', (rd.roundSerial ?? 0) === rdStartRound + 1,
        { serial: rd.roundSerial, seen: rd.roundSeen })

    // 泥首：交换选项为每阶段限一次
    const ns2 = build(['quhuang', 'huatuo', 'sunquan'], ['caocao', 'guojia', 'zhenji'], 124)
    const ns2Qu = ns2.generals[3]
    ns2Qu.nishouSwapPhase = `${ns2.turnSerial ?? 0}:${ns2.turnPhase}`
    ns2Qu.equip.weapon = card('ns2-old', EquipmentCardName.CROSSBOW, CardSuit.SPADE, 1,
        CardCategory.EQUIPMENT, { equipSlot: EquipSlot.WEAPON })
    ns2Qu.hand = [card('ns2-new', EquipmentCardName.KYLIN_BOW, CardSuit.HEART, 5,
        CardCategory.EQUIPMENT, { equipSlot: EquipSlot.WEAPON })]
    handleUseCard(ns2, HUMAN_PLAYER_ID, { cardId: 'ns2-new', targetIndices: [] } as any)
    const ns2Ask = findPending(ns2, 'quhuang_nishou')
    const ns2Options = ((ns2Ask?.context as any)?.options ?? []) as { action: string }[]
    check('泥首本阶段已交换过则不再提供交换选项',
        !!ns2Ask && !ns2Options.some(o => o.action === 'swap'),
        ns2Options.map(o => o.action))

    // 苟得：变更势力按魏/蜀/吴/群轮换
    const gd2 = build(['mengda', 'huatuo', 'sunquan'], ['caocao', 'guojia', 'zhenji'], 125)
    const gd2Meng = gd2.generals[3]
    gd2.generals[0].kingdomOverride = undefined
    gd2Meng.kingdomOverride = undefined
    gd2.turnSerial = 3
    gd2.turnPhase = TurnPhase.TURN_END
    gd2Meng.goudeTurn = 3
    gd2Meng.goudeMask = 1
    const gd2KingdomBefore = kingdomOf(gd2Meng)
    triggerGoude(gd2, gd2Meng)
    const gd2Ask = findPending(gd2, 'mengda_goude')
    check('苟得询问包含变更势力项',
        !!gd2Ask && ((gd2Ask.context as any)?.options ?? []).some((o: any) => o.action === '8'),
        ((gd2Ask?.context as any)?.options ?? []).map((o: any) => o.action))
    if (gd2Ask) {
        gd2.pendingResponseQueue = [gd2Ask]
        handleRespond(gd2, HUMAN_PLAYER_ID, { action: '8' } as any)
    }
    check('变更势力后势力随之改变', kingdomOf(gd2Meng) !== gd2KingdomBefore,
        { before: gd2KingdomBefore, after: kingdomOf(gd2Meng) })
}

console.log('[界刘备仁德 / 司马懿-竞]')
{
    const s = build(['liubei_jie', 'huatuo', 'sunquan'], ['caocao', 'guojia', 'zhenji'], 431)
    s.activeGeneralIndex = 3
    s.turnPhase = TurnPhase.ACTION
    const liu = s.generals[3]
    liu.hp = 2
    liu.hand = [
        card('rd1', BasicCardName.ATTACK, CardSuit.SPADE, 7),
        card('rd2', BasicCardName.DODGE, CardSuit.HEART, 2),
        card('rd3', BasicCardName.PEACH, CardSuit.DIAMOND, 3),
    ]
    const allyA = s.generals[4]
    const allyB = s.generals[5]
    handleUseSkill(s, HUMAN_PLAYER_ID, {
        skillId: 'liubei_jie_rende',
        targetIndices: [s.generals.indexOf(allyA)],
        cardIds: ['rd1'],
    } as any)
    check('界刘备首张仁德不触发基本牌', !findPending(s, 'liubei_jie_rende_use'), queue(s))
    handleUseSkill(s, HUMAN_PLAYER_ID, {
        skillId: 'liubei_jie_rende',
        targetIndices: [s.generals.indexOf(allyB)],
        cardIds: ['rd2'],
    } as any)
    const rdAsk = findPending(s, 'liubei_jie_rende_use')
    check('界刘备第二张仁德触发基本牌选择', !!rdAsk, queue(s))
    if (rdAsk) {
        s.pendingResponseQueue = [rdAsk]
        handleRespond(s, HUMAN_PLAYER_ID, { action: 'peach' } as any)
    }
    check('界刘备仁德选择桃回复1点体力', liu.hp === 3, { hp: liu.hp })
    const rdDup = handleUseSkill(s, HUMAN_PLAYER_ID, {
        skillId: 'liubei_jie_rende',
        targetIndices: [s.generals.indexOf(allyA)],
        cardIds: ['rd3'],
    } as any)
    check('界刘备同一角色本阶段不能重复获得仁德牌', !!rdDup && 'error' in rdDup, rdDup)

    const s2 = build(['simayi_jing', 'huatuo', 'sunquan'], ['caocao', 'guojia', 'zhenji'], 432)
    const sim = s2.generals[3]
    const attacker = s2.generals[0]
    attacker.hand = [card('cq1', BasicCardName.ATTACK, CardSuit.CLUB, 8)]
    dealDamage(s2, attacker, sim, 1)
    const cqAsk = findPending(s2, 'simayi_fankui')
    check('藏器在受伤后提供反馈/获得牌询问', !!cqAsk, queue(s2))
    if (cqAsk) {
        s2.pendingResponseQueue = [cqAsk]
        handleRespond(s2, HUMAN_PLAYER_ID, { action: 'confirm' } as any)
    }
    check('藏器修改一次矫诏', sim.jiaozhaoUpgrade === 1, { upgrade: sim.jiaozhaoUpgrade })
    check('藏器随后进入获得伤害来源牌的询问',
        s2.pendingResponseQueue.some(p => p.type === ResponseType.SKILL_FANKUI_PICK), queue(s2))
}

console.log('[祖茂 / 蒋琬-竞]')
{
    const s = build(['zumao', 'huatuo', 'sunquan'], ['caocao', 'guojia', 'zhenji'], 433)
    s.activeGeneralIndex = 3
    s.turnPhase = TurnPhase.ACTION
    const zumao = s.generals[3]
    zumao.hp = 4
    zumao.hand = [
        card('yb1', BasicCardName.ATTACK, CardSuit.SPADE, 7),
        card('yb2', TrickCardName.DRAW_TWO, CardSuit.HEART, 8, CardCategory.TRICK, { trickType: 'instant' }),
        card('yb3', EquipmentCardName.EIGHT_TRIGRAMS, CardSuit.CLUB, 2, CardCategory.EQUIPMENT,
            { equipSlot: EquipSlot.ARMOR }),
    ]
    enterDiscardPhaseOrSkip(s, zumao)
    check('引兵在出牌阶段结束时询问', !!findPending(s, 'zumao_yinbing'), queue(s))
    const ybAsk = findPending(s, 'zumao_yinbing')
    if (ybAsk) {
        s.pendingResponseQueue = [ybAsk]
        handleRespond(s, HUMAN_PLAYER_ID, { action: 'confirm' } as any)
        const ybPick = findPending(s, 'zumao_yinbing')
        check('引兵进入非基本牌选择', !!ybPick && ybPick.type === ResponseType.SKILL_PICK_CARD, queue(s))
        const ybIds = (ybPick?.context as any)?.candidateCardIds ?? []
        check('引兵候选只含非基本牌', ybIds.length === 2
            && !ybIds.includes('yb1') && ybIds.includes('yb2') && ybIds.includes('yb3'), ybIds)
        if (ybPick) {
            s.pendingResponseQueue = [ybPick]
            handleRespond(s, HUMAN_PLAYER_ID, { cardIds: ['yb2', 'yb3'] } as any)
        }
        check('引兵将牌置于武将牌上', (zumao.generalPile?.length ?? 0) === 2,
            zumao.generalPile?.map((c: any) => c.id))
    }

    s.deck = Array.from({ length: 5 }, (_, i) =>
        card('ybd' + i, BasicCardName.PEACH, CardSuit.HEART, (i % 9) + 1))
    const ybHand = zumao.hand.length
    dealDamage(s, s.generals[0], zumao, 1, 'yb-slash', { fromSlash: true })
    check('引兵受伤后移去一张并摸一张',
        (zumao.generalPile?.length ?? 0) === 1 && zumao.hand.length === ybHand + 1,
        `${zumao.generalPile?.length}/${ybHand}->${zumao.hand.length}`)

    zumao.generalPile = [card('jd1', TrickCardName.DRAW_TWO, CardSuit.HEART, 8,
        CardCategory.TRICK, { trickType: 'instant' })]
    s.activeGeneralIndex = 3
    s.activePlayerFaction = Faction.WARM
    s.turnPhase = TurnPhase.TURN_START
    runTurnStart(s)
    const jdAsk = findPending(s, 'zumao_juedi')
    check('绝地在准备阶段提供两个选项', !!jdAsk
        && ((jdAsk.context as any).options as any[]).length === 2, queue(s))
    if (jdAsk) {
        s.pendingResponseQueue = [jdAsk]
        handleRespond(s, HUMAN_PLAYER_ID, { action: 'draw' } as any)
    }
    check('绝地移去所有引兵并摸至体力上限',
        (zumao.generalPile?.length ?? 0) === 0 && zumao.hand.length >= zumao.maxHp,
        `${zumao.generalPile?.length}/${zumao.hand.length}/${zumao.maxHp}`)

    const sx = build(['jiangwan_jing', 'huatuo', 'sunquan'], ['caocao', 'guojia', 'zhenji'], 434)
    sx.activeGeneralIndex = 3
    sx.turnPhase = TurnPhase.ACTION
    const jiangwan = sx.generals[3]
    jiangwan.hp = 2
    jiangwan.hand = [
        card('sx1', BasicCardName.ATTACK, CardSuit.SPADE, 4),
        card('sx2', BasicCardName.DODGE, CardSuit.HEART, 5),
    ]
    handleEndTurn(sx, HUMAN_PLAYER_ID)
    const sxAsk = findPending(sx, 'jiangwan_jing_shengxi')
    check('生息在受伤角色回合结束时询问', !!sxAsk, queue(sx))
    if (sxAsk) {
        sx.pendingResponseQueue = [sxAsk]
        handleRespond(sx, HUMAN_PLAYER_ID, { action: 'confirm' } as any)
        const sxPick = findPending(sx, 'jiangwan_jing_shengxi')
        check('生息进入弃牌选择', !!sxPick && sxPick.type === ResponseType.SKILL_PICK_CARD, queue(sx))
        if (sxPick) {
            sx.pendingResponseQueue = [sxPick]
            handleRespond(sx, HUMAN_PLAYER_ID, { cardIds: ['sx1', 'sx2'] } as any)
        }
    }
    check('生息弃两张后回复1点体力', jiangwan.hp === 3, jiangwan.hp)

    const sc = build(['sunquan', 'huatuo', 'jiangwan_jing'], ['caocao', 'guojia', 'zhenji'], 435)
    const scVictim = sc.generals[0]
    scVictim.hand = [card('sc1', BasicCardName.ATTACK, CardSuit.SPADE, 6)]
    sc.activeGeneralIndex = 3
    sc.turnPhase = TurnPhase.DISCARD
    sc.deck = [card('scd1', BasicCardName.PEACH, CardSuit.CLUB, 1)]
    syncCardState(sc, 3)
    scVictim.hand = []
    syncCardState(sc, 3)
    const scAsk = findPending(sc, 'jiangwan_jing_shoucheng')
    check('守成在出牌阶段外失去最后手牌时询问', !!scAsk, queue(sc))
    if (scAsk) {
        sc.pendingResponseQueue = [scAsk]
        handleRespond(sc, HUMAN_PLAYER_ID, { action: 'confirm' } as any)
    }
    check('守成令失去最后手牌的角色摸一张', scVictim.hand.length === 1,
        scVictim.hand.map((c: any) => c.id))
}

console.log('[武将调整：孙权/周仓/张角/孙乾]')
{
    check('已删除基础徐晃', !getGeneralById('xuhuang'))
    check('已删除界司马懿', !getGeneralById('simayi_jie'))
    check('新增界孙权与界张角', !!getGeneralById('sunquan_jie') && !!getGeneralById('zhangjiao_jie'))
    check('乱斗版使用孙权-竞/界张角/界徐晃',
        BRAWL_POOL_IDS.includes('sunquan_jing') && !BRAWL_POOL_IDS.includes('sunquan_jie')
        && BRAWL_POOL_IDS.includes('zhangjiao_jie')
        && BRAWL_POOL_IDS.includes('xuhuang_jie') && !BRAWL_POOL_IDS.includes('xuhuang'))
    check('平衡版/平衡扩展版使用界大乔，乱斗版使用界大乔',
        BALANCE_POOL_IDS.includes('daqiao_jie') && !BALANCE_POOL_IDS.includes('daqiao')
        && BALANCE_EXT_POOL_IDS.includes('daqiao_jie') && !BALANCE_EXT_POOL_IDS.includes('daqiao')
        && BRAWL_POOL_IDS.includes('daqiao_jie'))
    check('乱斗版使用甘宁-竞并新增陆抗',
        BRAWL_POOL_IDS.includes('ganning_jing') && !BRAWL_POOL_IDS.includes('ganning_jie')
        && BRAWL_POOL_IDS.includes('lukang')
        && !!getGeneralById('lukang') && !!getGeneralById('ganning_jing'))
    check('经典/平衡池使用徐晃-竞',
        CLASSIC_POOL_IDS.includes('xuhuang_jing') && BALANCE_POOL_IDS.includes('xuhuang_jing')
        && BALANCE_EXT_POOL_IDS.includes('xuhuang_jing'))
}
{
    // 界制衡：弃置所有手牌后多摸一张
    const s = build(['sunquan_jie', 'huatuo', 'guojia'], ['caocao', 'zhenji', 'machao'], 501)
    const sq = s.generals[3]
    sq.hand = [
        card('zh1', BasicCardName.ATTACK, CardSuit.SPADE, 7),
        card('zh2', BasicCardName.DODGE, CardSuit.HEART, 2),
    ]
    s.deck = Array.from({ length: 6 }, (_, i) => card('zhd' + i, BasicCardName.PEACH, CardSuit.CLUB, 3))
    const res = handleUseSkill(s, HUMAN_PLAYER_ID, { skillId: 'sunquan_jie_zhiheng', cardIds: ['zh1', 'zh2'] } as any)
    check('界孙权制衡弃尽手牌多摸一张', !(res && 'error' in res) && sq.hand.length === 3,
        `res=${JSON.stringify(res)} hand=${sq.hand.length}`)

    const b = build(['sunquan', 'huatuo', 'guojia'], ['caocao', 'zhenji', 'machao'], 502)
    const sqb = b.generals[3]
    sqb.hand = [
        card('zh3', BasicCardName.ATTACK, CardSuit.SPADE, 7),
        card('zh4', BasicCardName.DODGE, CardSuit.HEART, 2),
    ]
    b.deck = Array.from({ length: 6 }, (_, i) => card('zhb' + i, BasicCardName.PEACH, CardSuit.CLUB, 3))
    handleUseSkill(b, HUMAN_PLAYER_ID, { skillId: 'sunquan_zhiheng', cardIds: ['zh3', 'zh4'] } as any)
    check('基础孙权制衡不多摸', sqb.hand.length === 2, sqb.hand.length)
}
{
    // 忠勇：交黑牌不再摸牌，交红牌可令受牌者出杀
    const s = build(['zhoucang', 'sunquan', 'huatuo'], ['caocao', 'guojia', 'zhenji'], 503)
    const zc = s.generals[3]
    const receiver = s.generals[0]
    zc.hand = []
    receiver.hand = []
    s.discard = [card('zyb', BasicCardName.ATTACK, CardSuit.SPADE, 7)]
    s.pendingResponseQueue = [{
        type: ResponseType.SKILL_ZHONGYONG_GIVE,
        targetGeneralIndex: 3,
        context: {
            skillId: 'zhoucang_zhongyong', skillName: '忠勇',
            attackCardId: 'zyb', dodgeCardIds: [], zhongyongTargetIndex: 0,
        },
    }]
    handleRespond(s, HUMAN_PLAYER_ID, { action: 'give_slash', targetIndex: 0 } as any)
    check('周仓忠勇交黑牌不再摸牌', receiver.hand.length === 1,
        receiver.hand.map((c: any) => c.id))

    const s2 = build(['zhoucang', 'sunquan', 'huatuo'], ['caocao', 'guojia', 'zhenji'], 504)
    const zc2 = s2.generals[3]
    const receiver2 = s2.generals[0]
    zc2.hand = []
    receiver2.hand = []
    s2.discard = [card('zyr', BasicCardName.ATTACK, CardSuit.HEART, 7)]
    s2.pendingResponseQueue = [{
        type: ResponseType.SKILL_ZHONGYONG_GIVE,
        targetGeneralIndex: 3,
        context: {
            skillId: 'zhoucang_zhongyong', skillName: '忠勇',
            attackCardId: 'zyr', dodgeCardIds: [], zhongyongTargetIndex: 0,
        },
    }]
    handleRespond(s2, HUMAN_PLAYER_ID, { action: 'give_slash', targetIndex: 0 } as any)
    check('周仓忠勇交红牌后受牌者可出杀',
        s2.pendingResponseQueue.some(p => p.type === ResponseType.SKILL_ZHONGYONG_SLASH),
        queue(s2))
}
{
    // 界周仓忠勇：此【杀】与目标使用的【闪】一并交出；红牌可出杀，黑牌摸一张
    const s = build(['zhoucang_jie', 'sunquan', 'huatuo'], ['caocao', 'guojia', 'zhenji'], 5081)
    const zc = s.generals[3]
    const receiver = s.generals[0]
    zc.hand = []
    receiver.hand = []
    s.deck = [card('zyjd', BasicCardName.PEACH, CardSuit.CLUB, 4)]
    s.discard = [
        card('zyj1', BasicCardName.ATTACK, CardSuit.SPADE, 7),
        card('zyj2', BasicCardName.DODGE, CardSuit.HEART, 2),
    ]
    s.pendingResponseQueue = [{
        type: ResponseType.SKILL_ZHONGYONG_GIVE,
        targetGeneralIndex: 3,
        context: {
            skillId: 'zhoucang_jie_zhongyong', skillName: '忠勇', zhongyongAll: true,
            attackCardId: 'zyj1', dodgeCardIds: ['zyj2'], zhongyongTargetIndex: 0,
        },
    }]
    handleRespond(s, HUMAN_PLAYER_ID, { action: 'confirm', targetIndex: 0 } as any)
    check('界周仓忠勇一次交出杀与闪', receiver.hand.some(c => c.id === 'zyj1')
        && receiver.hand.some(c => c.id === 'zyj2'), receiver.hand.map((c: any) => c.id))
    check('界周仓忠勇红牌可出杀、黑牌摸一张',
        s.pendingResponseQueue.some(p => p.type === ResponseType.SKILL_ZHONGYONG_SLASH)
        && receiver.hand.some(c => c.id === 'zyjd'), queue(s))
}
{
    // 界张角：出闪 → 雷击判定 → 黑色选择角色
    const s = build(['zhangjiao_jie', 'sunquan', 'huatuo'], ['caocao', 'guojia', 'zhenji'], 505)
    const zj = s.generals[3]
    const victim = s.generals[0]
    victim.hp = 4
    zj.hand = [card('zjd', BasicCardName.DODGE, CardSuit.HEART, 2)]
    s.deck = [card('jdg', BasicCardName.ATTACK, CardSuit.SPADE, 7)]
    s.pendingResponseQueue = [{
        type: ResponseType.DODGE,
        targetGeneralIndex: 3,
        context: {
            attackerGeneralIndex: 0,
            requiredDodges: 1,
            dodgesReceived: 0,
            attackCard: card('zja', BasicCardName.ATTACK, CardSuit.SPADE, 8),
        },
    }]
    handleRespond(s, HUMAN_PLAYER_ID, { cardId: 'zjd' } as any)
    const ask = findPending(s, 'zhangjiao_jie_leiji')
    check('界张角出闪后询问雷击判定', !!ask, queue(s))
    if (ask) {
        s.pendingResponseQueue = [ask]
        handleRespond(s, HUMAN_PLAYER_ID, { action: 'confirm' } as any)
    }
    const after = findPending(s, 'zhangjiao_jie_leiji_after')
    check('界张角判定黑色后可选择角色',
        !!after && after.type === ResponseType.SKILL_CHOOSE_TARGET, queue(s))
    if (after) {
        s.pendingResponseQueue = [after]
        handleRespond(s, HUMAN_PLAYER_ID, { targetIndex: 0 } as any)
    }
    check('界张角♠判定造成2点雷电伤害', victim.hp === 2, victim.hp)
}
{
    // 孙乾说盟：赢 → 视为使用无中生有，并可触发谦雅
    const s = build(['sunqian', 'sunquan', 'huatuo'], ['caocao', 'guojia', 'zhenji'], 506)
    const sq = s.generals[3]
    const opp = s.generals[0]
    sq.hand = [
        card('sm1', BasicCardName.ATTACK, CardSuit.SPADE, 13),
        card('sm2', BasicCardName.PEACH, CardSuit.HEART, 3),
    ]
    opp.hand = [card('sm3', BasicCardName.ATTACK, CardSuit.CLUB, 1)]
    s.deck = Array.from({ length: 6 }, (_, i) => card('smd' + i, BasicCardName.PEACH, CardSuit.DIAMOND, 4))
    handleEndTurn(s, HUMAN_PLAYER_ID)
    const targetAsk = s.pendingResponseQueue.find(p => p.type === ResponseType.SKILL_SHUOMENG_TARGET)
    check('孙乾出牌阶段结束可发动说盟', !!targetAsk, queue(s))
    if (targetAsk) {
        s.pendingResponseQueue = [targetAsk]
        handleRespond(s, HUMAN_PLAYER_ID, { targetIndex: 0 } as any)
        handleRespond(s, HUMAN_PLAYER_ID, { cardId: 'sm1' } as any)
        handleRespond(s, AI_PLAYER_ID, { cardId: 'sm3' } as any)
    }
    const qianya = findPending(s, 'sunqian_qianya')
    check('说盟赢后触发谦雅', !!qianya, queue(s))
    if (qianya) handleRespond(s, HUMAN_PLAYER_ID, { action: 'decline' } as any)
    processAutoExecutePending(s)
    check('说盟赢后视为使用无中生有摸两张', sq.hand.length === 3,
        `hand=${sq.hand.length} ${queue(s)}`)
}
{
    // 界张角鬼道：打出♠2~9替换判定后摸一张
    const s = build(['zhangjiao_jie', 'sunquan', 'huatuo'], ['caocao', 'guojia', 'zhenji'], 507)
    const zj = s.generals[3]
    const oldJudge = card('gjudge', BasicCardName.PEACH, CardSuit.HEART, 3)
    zj.hand = [card('gspade', BasicCardName.ATTACK, CardSuit.SPADE, 5)]
    s.discard = [oldJudge]
    s.deck = [card('gdraw', BasicCardName.PEACH, CardSuit.CLUB, 4)]
    s.pendingResponseQueue = [{
        type: ResponseType.JUDGE_INTERVENE,
        targetGeneralIndex: 3,
        context: {
            judgeType: 'leiji_jie',
            judgingGeneralIndex: 3,
            judgeCardId: 'gjudge',
            judgeCard: oldJudge,
            judgeName: '雷击',
        },
    }]
    handleRespond(s, HUMAN_PLAYER_ID, { cardId: 'gspade' } as any)
    check('界张角鬼道以♠2~9替换判定后摸一张', zj.hand.length === 1,
        zj.hand.map((c: any) => c.id))
}

{
    // 尚义（蒋钦）：弃一张牌，令目标观看你的手牌，然后你观看其手牌并获得其中一张
    const s = build(['jiangqin', 'sunquan', 'huatuo'], ['caocao', 'guojia', 'zhenji'], 508)
    const jq = s.generals[3]
    const opp = s.generals[0]
    jq.hand = [
        card('sy1', BasicCardName.ATTACK, CardSuit.SPADE, 7),
        card('sy2', BasicCardName.DODGE, CardSuit.HEART, 2),
    ]
    opp.hand = [card('sy3', BasicCardName.PEACH, CardSuit.HEART, 9)]
    const syRes = handleUseSkill(s, HUMAN_PLAYER_ID, {
        skillId: 'jiangqin_shangyi', targetIndices: [0], cardIds: ['sy2'],
    } as any)
    check('尚义弃置一张牌后询问选牌', !(syRes && 'error' in syRes) && jq.hand.length === 1, syRes)
    const syPick = findPending(s, 'jiangqin_shangyi')
    check('尚义进入观看手牌选牌', !!syPick, queue(s))
    if (syPick) {
        s.pendingResponseQueue = [syPick]
        handleRespond(s, HUMAN_PLAYER_ID, { cardId: 'sy3' } as any)
    }
    check('尚义获得目标一张手牌', jq.hand.length === 2 && opp.hand.length === 0,
        `jq=${jq.hand.length} opp=${opp.hand.length}`)
}
{
    // 俭衣（蒋钦）：其他角色回合结束时，获得本回合因弃置置入的防具牌
    const s = build(['jiangqin', 'caocao', 'guojia'], ['sunquan', 'huatuo', 'zhenji'], 509)
    const jq = s.generals[3]
    s.turnSerial = 21
    s.activeGeneralIndex = 0
    s.turnPhase = TurnPhase.TURN_END
    const armor = card('jy1', EquipmentCardName.EIGHT_TRIGRAMS, CardSuit.SPADE, 2,
        CardCategory.EQUIPMENT, { equipSlot: EquipSlot.ARMOR, discardTurn: 21 })
    const usedArmor = card('jy2', EquipmentCardName.SILVER_LION, CardSuit.CLUB, 2,
        CardCategory.EQUIPMENT, { equipSlot: EquipSlot.ARMOR, discardTurn: 20 })
    s.discard = [armor, usedArmor]
    finishTurn(s)
    const jyPick = findPending(s, 'jiangqin_jianyi')
    check('俭衣只认本回合弃置的防具牌', !!jyPick
        && ((jyPick.context as any)?.jianyiCardIds ?? []).length === 1, queue(s))
    if (jyPick) {
        s.pendingResponseQueue = [jyPick]
        handleRespond(s, HUMAN_PLAYER_ID, { action: 'take:jy1' } as any)
    }
    check('俭衣获得该防具牌', jq.hand.some(c => c.id === 'jy1')
        && !s.discard.some(c => c.id === 'jy1'), jq.hand.map(c => c.id))
}

console.log('[酒：每回合限一次]')
{
    const s = build(['huanggai_jie', 'huatuo', 'sunquan'], ['guojia', 'zhenji', 'xiahoudun'], 511)
    const hg = s.generals[3]
    hg.hand = [
        card('w1', BasicCardName.WINE, CardSuit.SPADE, 9),
        card('w2', BasicCardName.WINE, CardSuit.CLUB, 9),
    ]
    const first = handleUseCard(s, HUMAN_PLAYER_ID, { cardId: 'w1', targetIndices: [] } as any)
    check('第一口酒可以喝', !(first && 'error' in first), first)
    // 酒杀结算会把 wineDrunk 清掉，这里按“刚喝完酒杀”的状态模拟
    hg.wineDrunk = false
    const second = handleUseCard(s, HUMAN_PLAYER_ID, { cardId: 'w2', targetIndices: [] } as any)
    check('酒杀后同一回合不能再喝', !!second && 'error' in second, second)
    check('第二张酒没有离手', hg.hand.some(c => c.id === 'w2'), hg.hand.map(c => c.id))
}

console.log('[武烈：只标记己方并列出名字]')
{
    const s = build(['sunjian_jie', 'huatuo', 'sunquan'], ['guojia', 'zhenji', 'xiahoudun'], 512)
    const sj = s.generals[3]
    s.activeGeneralIndex = 3
    s.pendingResponseQueue = [{
        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
        targetGeneralIndex: 3,
        context: { skillId: 'sunjian_wulie', skillName: '武烈', targetSelectOnActivate: true, maxTargets: 3 },
    } as any]
    handleRespond(s, HUMAN_PLAYER_ID, { action: 'confirm', targetIndices: [] } as any)
    const marked = s.generals.filter(g => (g.lieMarks ?? 0) > 0)
    check('武烈自动选中己方角色', marked.length > 0 && marked.every(g => g.faction === sj.faction),
        marked.map(g => `${g.generalId}:${g.faction}`))
    const wlLog = s.log.map(l => l.text).find(text => text.includes('【武烈】')) ?? ''
    check('武烈日志列出获得“烈”的角色',
        marked.length > 0 && marked.every(g => wlLog.includes(getGeneralById(g.generalId)!.name)), wlLog)
}

console.log('[界虞翻：纵玄每回合一次]')
{
    const s = build(['yufan_jie', 'huatuo', 'sunquan'], ['guojia', 'zhenji', 'xiahoudun'], 513)
    const yf = s.generals[3]
    s.turnSerial = 7
    const c1 = card('zx1', BasicCardName.ATTACK, CardSuit.SPADE, 3)
    const c2 = card('zx2', BasicCardName.DODGE, CardSuit.HEART, 4)
    s.discard = [c1, c2]
    maybeZongxuan(s, yf, [c1])
    check('纵玄：本回合第一次弃置询问', !!findPending(s, 'yufan_jie_zongxuan'), queue(s))
    s.pendingResponseQueue = []
    maybeZongxuan(s, yf, [c2])
    check('纵玄：同一回合第二次弃置不再询问', !findPending(s, 'yufan_jie_zongxuan'), queue(s))
    s.turnSerial = 8
    maybeZongxuan(s, yf, [c2])
    check('纵玄：下一回合重新可以询问', !!findPending(s, 'yufan_jie_zongxuan'), queue(s))
    s.pendingResponseQueue = []
    maybeZongxuan(s, s.generals[0], [c1])
    check('纵玄：距离之外的角色弃置不询问', !findPending(s, 'yufan_jie_zongxuan'), queue(s))
}

console.log('[开局日志带复盘 ID]')
{
    const s = build(['sunquan', 'huatuo', 'caocao'], ['guojia', 'zhenji', 'xiahoudun'], 514)
    s.log = [{ timestamp: 0, text: '随机种子 809170953（出现异常时可用此种子复现本局）' } as any]
    beginMatchLog(s, 809170953, 'classic', {})
    check('开局日志补上本局 ID', s.log[0].matchId === s.matchId && !!s.matchId,
        `${s.log[0].matchId}/${s.matchId}`)
}

console.log('[突袭日志：只在我方看得到时写出牌面]')
{
    const s = build(['huatuo', 'sunquan', 'caocao'], ['zhangliao', 'guojia', 'zhenji'], 515)
    s.generals[0].hand = [card('tx0', BasicCardName.DODGE, CardSuit.HEART, 3)]
    s.generals[3].hand = [card('txa', BasicCardName.PEACH, CardSuit.HEART, 3)]
    s.pendingResponseQueue = [{
        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
        targetGeneralIndex: 0,
        context: { skillId: 'zhangliao_tuxi', skillName: '突袭', description: '' },
    }]
    handleRespond(s, AI_PLAYER_ID, { action: 'confirm', targetIndices: [3] } as any)
    const ownLog = s.log.map(l => l.text).join('\n')
    check('突袭拿我方手牌时日志写出牌面', ownLog.includes('♥3【桃】'), ownLog)

    const h = build(['huatuo', 'sunquan', 'caocao'], ['zhangliao', 'guojia', 'zhenji'], 516)
    h.generals[0].hand = [card('tx1', BasicCardName.DODGE, CardSuit.HEART, 3)]
    h.generals[2].hand = [card('txb', BasicCardName.PEACH, CardSuit.HEART, 5)]
    h.pendingResponseQueue = [{
        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
        targetGeneralIndex: 0,
        context: { skillId: 'zhangliao_tuxi', skillName: '突袭', description: '' },
    }]
    handleRespond(h, AI_PLAYER_ID, { action: 'confirm', targetIndices: [2] } as any)
    const foeLog = h.log.map(l => l.text).join('\n')
    check('突袭拿敌方手牌时不写牌面',
        foeLog.includes('的一张手牌') && !foeLog.includes('♥5【桃】'), foeLog)
}

console.log('[龙胆：日志说明转化]')
{
    const s = build(['zhaoyun_jing', 'huatuo', 'sunquan'], ['caocao', 'guojia', 'zhenji'], 517)
    s.generals[3].hand = [card('ld1', BasicCardName.DODGE, CardSuit.DIAMOND, 11)]
    const res = handleUseCard(s, HUMAN_PLAYER_ID, { cardId: 'ld1', targetIndices: [4] } as any)
    const text = s.log.map(l => l.text).join('\n')
    check('龙胆当杀时日志写明转化',
        !(res && 'error' in res) && text.includes('发动【龙胆】') && text.includes('当【杀】使用'),
        text || JSON.stringify(res))
}

console.log('[密诏：拼点赢后视为使用杀]')
{
    const s = build(['liuxie', 'lvbu', 'sunquan'], ['zhaoyun_jing', 'guojia', 'zhenji'], 518)
    s.generals[3].hand = [card('mz1', BasicCardName.ATTACK, CardSuit.SPADE, 13)]
    s.generals[4].hand = [card('mz2', BasicCardName.ATTACK, CardSuit.HEART, 12)]
    s.generals[0].hand = [card('mz3', BasicCardName.DODGE, CardSuit.DIAMOND, 4)]
    handleUseSkill(s, HUMAN_PLAYER_ID, { skillId: 'liuxie_mizhao', targetIndices: [4, 0] } as any)
    handleRespond(s, HUMAN_PLAYER_ID, { cardIds: ['mz2'] } as any)
    handleRespond(s, AI_PLAYER_ID, { cardIds: ['mz3'] } as any)
    const text = s.log.map(l => l.text).join('\n')
    check('密诏拼点赢视为出杀',
        text.includes('【密诏】拼点赢') && queue(s).some((q: string) => q.startsWith('dodge/')),
        text + ' || ' + queue(s))
}

console.log('[天命：先于出闪询问]')
{
    const s = build(['lvbu_jing', 'liuxie', 'sunquan'], ['zhaoyun_jing', 'guojia', 'zhenji'], 519)
    s.generals[3].hand = [card('tm1', BasicCardName.ATTACK, CardSuit.SPADE, 7)]
    s.generals[4].hand = [
        card('tm2', BasicCardName.DODGE, CardSuit.HEART, 2),
        card('tm3', BasicCardName.ATTACK, CardSuit.CLUB, 3),
    ]
    handleUseCard(s, HUMAN_PLAYER_ID, { cardId: 'tm1', targetIndices: [4] } as any)
    check('天命询问排在出闪之前',
        queue(s)[0] === 'skill_activate_confirm/liuxie_tianming', queue(s))
}

console.log('[行动单元：缺人时自动改选]')
{
    const s = build(['sunquan', 'huatuo', 'caocao'], ['guojia', 'zhenji', 'xiahoudun'], 520)
    // 暖方边锋全灭只剩主帅：客户端只会发 FLANKS，引擎应改选主帅而不是拒绝
    s.generals[3].alive = false
    s.generals[5].alive = false
    s.roundState = { roundNumber: 2, firstMover: Faction.COOL, currentActionStep: 2 }
    s.activePlayerFaction = Faction.WARM
    s.activeGeneralIndex = -1
    const res = chooseActionUnit(s, HUMAN_PLAYER_ID, ActionUnitType.FLANKS)
    check('边锋全灭时改选主帅而不是报错',
        !(res && 'error' in res) && s.roundState.secondMoverChoice === ActionUnitType.COMMANDER,
        `${JSON.stringify(res)}/${s.roundState.secondMoverChoice}`)
}

console.log('[开局技能规则：限五次]')
{
    // 黄盖【苦肉】没有每回合一次的声明，正好用来验证“同一技能至多五次”
    const limited = build(['huanggai', 'huatuo', 'sunquan'], ['guojia', 'zhenji', 'xiahoudun'], 521)
    limited.skillLimitRule = 'limited'
    const kurou = limited.generals[3]
    kurou.hp = 8
    kurou.maxHp = 8
    limited.deck = Array.from({ length: 20 }, (_, i) =>
        card('kr' + i, BasicCardName.PEACH, CardSuit.CLUB, (i % 9) + 1))
    let allowed = 0
    for (let i = 0; i < 6; i++) {
        const res = handleUseSkill(limited, HUMAN_PLAYER_ID, { skillId: 'huanggai_kurou' } as any)
        if (!(res && 'error' in res)) allowed++
    }
    check('限五次：同一技能每回合只放行五次', allowed === 5, allowed)

    const free = build(['huanggai', 'huatuo', 'sunquan'], ['guojia', 'zhenji', 'xiahoudun'], 522)
    free.skillLimitRule = 'unlimited'
    const freeKurou = free.generals[3]
    freeKurou.hp = 8
    freeKurou.maxHp = 8
    free.deck = Array.from({ length: 20 }, (_, i) =>
        card('kf' + i, BasicCardName.PEACH, CardSuit.CLUB, (i % 9) + 1))
    let freeAllowed = 0
    for (let i = 0; i < 6; i++) {
        const res = handleUseSkill(free, HUMAN_PLAYER_ID, { skillId: 'huanggai_kurou' } as any)
        if (!(res && 'error' in res)) freeAllowed++
    }
    check('无限制：同一技能可以连续发动', freeAllowed === 6, freeAllowed)

    const legacy = build(['huanggai', 'huatuo', 'sunquan'], ['guojia', 'zhenji', 'xiahoudun'], 523)
    legacy.skillLimitRule = undefined
    check('未设置规则的老存档按无限制处理', !skillUseBlocked(legacy, legacy.generals[3], 'huanggai_kurou'))
}

console.log('[武器牌加强]')
{
    // 青釭剑：目标需连续两张闪
    const s = build(['huanggai', 'huatuo', 'sunquan'], ['guojia', 'zhenji', 'xiahoudun'], 524)
    s.weaponEnhance = true
    const atk = s.generals[3]
    atk.equip.weapon = card('qg-eq', EquipmentCardName.QINGGANG_SWORD, CardSuit.SPADE, 6)
    atk.hand = [card('qg-slash', BasicCardName.ATTACK, CardSuit.CLUB, 7)]
    s.pendingResponseQueue = []
    const qgRes = handleUseCard(s, HUMAN_PLAYER_ID, { cardId: 'qg-slash', targetIndices: [2] } as any)
    const qgDodge = s.pendingResponseQueue.find(p => p.type === ResponseType.DODGE)
    check('加强青釭：需连续两张闪',
        !(qgRes && 'error' in qgRes) && (qgDodge?.context as any)?.requiredDodges === 2,
        `${JSON.stringify(qgRes)} ${queue(s)}`)
}
{
    // 连弩：加强版出牌阶段只能额外使用三张杀
    const s = build(['huanggai', 'huatuo', 'sunquan'], ['guojia', 'zhenji', 'xiahoudun'], 525)
    s.weaponEnhance = true
    const atk = s.generals[3]
    atk.equip.weapon = card('cb-eq', EquipmentCardName.CROSSBOW, CardSuit.CLUB, 1)
    atk.hand = [
        card('cb-s1', BasicCardName.ATTACK, CardSuit.SPADE, 7),
        card('cb-s2', BasicCardName.ATTACK, CardSuit.HEART, 8),
    ]
    s.attackUsedThisTurn = 3
    s.pendingResponseQueue = []
    const first = handleUseCard(s, HUMAN_PLAYER_ID, { cardId: 'cb-s1', targetIndices: [2] } as any)
    const second = handleUseCard(s, HUMAN_PLAYER_ID, { cardId: 'cb-s2', targetIndices: [2] } as any)
    check('加强连弩：第 5 张杀被拒',
        !(first && 'error' in first) && !!(second && 'error' in second),
        `${JSON.stringify(first)} / ${JSON.stringify(second)}`)
}
{
    // 雌雄双股剑：加强版不再限制异性
    const s = build(['huanggai', 'huatuo', 'sunquan'], ['guojia', 'zhenji', 'xiahoudun'], 526)
    s.weaponEnhance = true
    const atk = s.generals[3]
    atk.equip.weapon = card('ds-eq2', EquipmentCardName.DOUBLE_SWORDS, CardSuit.SPADE, 2)
    atk.hand = [card('ds-slash', BasicCardName.ATTACK, CardSuit.CLUB, 9)]
    s.pendingResponseQueue = []
    const res = handleUseCard(s, HUMAN_PLAYER_ID, { cardId: 'ds-slash', targetIndices: [2] } as any)
    check('加强雌雄：同性目标也能触发',
        !(res && 'error' in res)
        && s.pendingResponseQueue.some(p => (p.context as any)?.skillId === 'equip_double_swords'),
        `${JSON.stringify(res)} ${queue(s)}`)
}
{
    // 方天画戟：加强版在敌众我寡时可额外指定两个目标
    const s = build(['huanggai', 'huatuo', 'sunquan'], ['guojia', 'zhenji', 'xiahoudun'], 527)
    s.weaponEnhance = true
    s.generals[4].alive = false
    s.generals[5].alive = false
    const atk = s.generals[3]
    atk.equip.weapon = card('ft-eq', EquipmentCardName.FANGTIAN_HALBERD, CardSuit.DIAMOND, 12, CardCategory.EQUIPMENT, { attackRange: 3 })
    atk.hand = [
        card('ft-s1', BasicCardName.ATTACK, CardSuit.SPADE, 7),
        card('ft-s2', BasicCardName.DODGE, CardSuit.HEART, 8),
    ]
    s.pendingResponseQueue = []
    const res = handleUseCard(s, HUMAN_PLAYER_ID, { cardId: 'ft-s1', targetIndices: [0, 1, 2] } as any)
    check('加强方天：敌众我寡时可指定三个目标',
        !(res && 'error' in res), `${JSON.stringify(res)} ${queue(s)}`)
}

console.log('[谯周 / 刘焉 / 界吕布]')
{
    // 知命：准备阶段摸一张并询问置顶
    const s = build(['qiaozhou', 'sunquan', 'huatuo'], ['caocao', 'zhenji', 'machao'], 601)
    const qz = s.generals[3]
    qz.hand = []
    s.deck = [
        card('zm0', BasicCardName.PEACH, CardSuit.HEART, 3),
        card('zm1', BasicCardName.DODGE, CardSuit.DIAMOND, 4),
    ]
    s.pendingResponseQueue = []
    runTurnStart(s)
    check('知命：准备阶段摸一张并询问置顶',
        qz.hand.length === 1 && queue(s).includes('skill_pick_card/qiaozhou_zhiming_top'), queue(s))

    // 置顶：用一张手牌换到牌堆顶（插入占位响应避免继续推进回合）
    s.pendingResponseQueue.push({
        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
        targetGeneralIndex: 0,
        context: { skillId: 'dummy' },
    } as any)
    const placedId = qz.hand[0].id
    handleRespond(s, HUMAN_PLAYER_ID, { cardId: placedId } as any)
    check('知命：可将一张手牌置于牌堆顶', s.deck[0]?.id === placedId, s.deck[0]?.id)
}
{
    // 星卜：结束阶段亮出三张；2 张红牌 → 杀次数-1、跳过弃牌阶段
    const s = build(['qiaozhou', 'sunquan', 'huatuo'], ['caocao', 'zhenji', 'machao'], 602)
    s.turnPhase = TurnPhase.TURN_END
    s.pendingResponseQueue = []
    s.deck = [
        card('xb_r1', BasicCardName.ATTACK, CardSuit.HEART, 7),
        card('xb_r2', BasicCardName.DODGE, CardSuit.DIAMOND, 8),
        card('xb_b1', BasicCardName.ATTACK, CardSuit.SPADE, 9),
        card('xb_b2', BasicCardName.PEACH, CardSuit.CLUB, 10),
    ]
    finishTurn(s)
    check('星卜：结束阶段询问', queue(s).includes('skill_activate_confirm/qiaozhou_xingbu'), queue(s))
    s.pendingResponseQueue.push({
        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
        targetGeneralIndex: 0,
        context: { skillId: 'dummy' },
    } as any)
    handleRespond(s, HUMAN_PLAYER_ID, { action: 'confirm' } as any)
    check('星卜：亮出三张后进入选目标',
        s.pendingResponseQueue[0]?.type === ResponseType.SKILL_CHOOSE_TARGET
        && (s.pendingResponseQueue[0].context as any)?.skillId === 'qiaozhou_xingbu_target',
        queue(s))
    handleRespond(s, HUMAN_PLAYER_ID, { targetIndex: 4 } as any)
    check('星卜：红色牌为2时设置下回合效果', s.generals[4].xingbuMode === 'two',
        s.generals[4].xingbuMode)
}
{
    // 星卜效果在目标下个回合开始时生效
    const s = build(['qiaozhou', 'sunquan', 'huatuo'], ['caocao', 'zhenji', 'machao'], 603)
    const target = s.generals[4]
    target.xingbuMode = 'two'
    s.activeGeneralIndex = 4
    s.activePlayerFaction = target.faction
    s.pendingResponseQueue = []
    s.deck = Array.from({ length: 6 }, (_, i) =>
        card('xbd' + i, BasicCardName.PEACH, CardSuit.CLUB, 3))
    s.turnPhase = TurnPhase.TURN_START
    runTurnStart(s)
    check('星卜：目标回合开始时杀次数-1并跳过弃牌',
        target.xingbuMode === undefined && target.slashLimitDelta === -1 && target.skipDiscardPhase === true,
        `mode=${target.xingbuMode} delta=${target.slashLimitDelta} skip=${target.skipDiscardPhase}`)
}
{
    // 图射：使用非装备牌指定目标后，若没有基本牌则摸目标数张
    const s = build(['liuyan', 'sunquan', 'huatuo'], ['caocao', 'zhenji', 'machao'], 604)
    const ly = s.generals[3]
    ly.hp = 2
    ly.hand = [card('ts_peach', BasicCardName.PEACH, CardSuit.HEART, 3)]
    s.deck = [card('ts_draw', BasicCardName.DODGE, CardSuit.CLUB, 4)]
    s.pendingResponseQueue = []
    const res = handleUseCard(s, HUMAN_PLAYER_ID, { cardId: 'ts_peach', targetIndices: [3] } as any)
    check('图射：使用非装备牌后询问',
        !(res && 'error' in res) && queue(s).some((q: string) => q.startsWith('skill_activate_confirm/liuyan_tushe')),
        `${JSON.stringify(res)} ${queue(s)}`)
    handleRespond(s, HUMAN_PLAYER_ID, { action: 'confirm' } as any)
    check('图射：摸目标数张牌', ly.hand.length === 1, ly.hand.map(c => c.id))
}
{
    // 立牧：将一张牌当乐不思蜀置于自己判定区并回复1点体力
    const s = build(['liuyan', 'sunquan', 'huatuo'], ['caocao', 'zhenji', 'machao'], 605)
    const ly = s.generals[3]
    ly.hp = 2
    ly.hand = [card('lm_junk', TrickCardName.DRAW_TWO, CardSuit.HEART, 7, CardCategory.TRICK)]
    const res = handleUseSkill(s, HUMAN_PLAYER_ID, { skillId: 'liuyan_limu', cardIds: ['lm_junk'] } as any)
    check('立牧：放置乐不思蜀并回复1点体力',
        !(res && 'error' in res)
        && ly.judgeZone.some(c => c.name === TrickCardName.OVERINDULGENCE)
        && ly.hp === 3,
        `${JSON.stringify(res)} hp=${ly.hp} judge=${ly.judgeZone.map(c => c.name)}`)
}
{
    // 立牧②：判定区有牌时，对攻击范围内的其他角色用牌无次数与距离限制
    const s = build(['liuyan', 'sunquan', 'huatuo'], ['caocao', 'zhenji', 'machao'], 606)
    const ly = s.generals[3]
    s.attackUsedThisTurn = 1
    ly.hand = [card('lm_s1', BasicCardName.ATTACK, CardSuit.SPADE, 7)]
    const blocked = handleUseCard(s, HUMAN_PLAYER_ID, { cardId: 'lm_s1', targetIndices: [2] } as any)
    check('立牧②：判定区无牌时仍受杀次数限制', !!(blocked && 'error' in blocked),
        JSON.stringify(blocked))

    ly.judgeZone = [{
        id: 'lm_le', name: TrickCardName.OVERINDULGENCE, suit: CardSuit.SPADE,
        value: 1, category: CardCategory.TRICK,
    } as any]
    ly.hand = [card('lm_s2', BasicCardName.ATTACK, CardSuit.HEART, 8)]
    const allowed = handleUseCard(s, HUMAN_PLAYER_ID, { cardId: 'lm_s2', targetIndices: [2] } as any)
    check('立牧②：判定区有牌时无距离与次数限制', !(allowed && 'error' in allowed),
        JSON.stringify(allowed))
}
{
    // 无双：界吕布使用杀需目标出两张闪
    const s = build(['lvbu_jie', 'sunquan', 'huatuo'], ['caocao', 'zhenji', 'machao'], 607)
    const lj = s.generals[3]
    lj.hand = [card('lj_slash', BasicCardName.ATTACK, CardSuit.SPADE, 7)]
    s.pendingResponseQueue = []
    const res = handleUseCard(s, HUMAN_PLAYER_ID, { cardId: 'lj_slash', targetIndices: [2] } as any)
    const dodge = s.pendingResponseQueue.find(p => p.type === ResponseType.DODGE)
    check('界吕布：无双需两张闪',
        !(res && 'error' in res) && (dodge?.context as any)?.requiredDodges === 2,
        `${JSON.stringify(res)} ${queue(s)}`)
}
{
    // 利驭：获得非装备牌 → 目标摸一张
    const s = build(['lvbu_jie', 'sunquan', 'huatuo'], ['caocao', 'zhenji', 'machao'], 608)
    const lj = s.generals[3]
    const victim = s.generals[0]
    victim.hp = 3
    victim.hand = [card('ly_hand', TrickCardName.DRAW_TWO, CardSuit.HEART, 7, CardCategory.TRICK)]
    s.pendingResponseQueue = []
    s.deck = [card('ly_draw', BasicCardName.DODGE, CardSuit.CLUB, 5)]
    dealDamage(s, lj, victim, 1, undefined, { fromSlash: true })
    check('利驭：使用杀造成伤害后询问', queue(s).includes('skill_activate_confirm/lvbu_jie_liyu'), queue(s))
    handleRespond(s, HUMAN_PLAYER_ID, { action: 'confirm' } as any)
    check('利驭：确认后进入选牌', s.pendingResponseQueue[0]?.type === ResponseType.SKILL_FANKUI_PICK,
        queue(s))
    handleRespond(s, HUMAN_PLAYER_ID, { cardId: 'ly_hand' } as any)
    check('利驭：获得非装备牌后目标摸一张',
        lj.hand.some(c => c.id === 'ly_hand') && victim.hand.length === 1,
        `lj=${lj.hand.map(c => c.id)} victim=${victim.hand.map(c => c.id)}`)
}
{
    // 利驭：获得装备牌 → 视为对另一名其他角色使用决斗
    const s = build(['lvbu_jie', 'sunquan', 'huatuo'], ['caocao', 'zhenji', 'machao'], 609)
    const lj = s.generals[3]
    const victim = s.generals[0]
    victim.hp = 3
    victim.hand = []
    victim.equip.weapon = card('ly_eq', EquipmentCardName.QINGGANG_SWORD, CardSuit.SPADE, 6,
        CardCategory.EQUIPMENT, { equipSlot: EquipSlot.WEAPON, attackRange: 2 })
    s.pendingResponseQueue = []
    dealDamage(s, lj, victim, 1, undefined, { fromSlash: true })
    handleRespond(s, HUMAN_PLAYER_ID, { action: 'confirm' } as any)
    handleRespond(s, HUMAN_PLAYER_ID, { cardId: 'ly_eq' } as any)
    const duelPick = s.pendingResponseQueue.find(p =>
        p.type === ResponseType.SKILL_CHOOSE_TARGET
        && (p.context as any)?.skillId === 'lvbu_jie_liyu_duel')
    check('利驭：获得装备牌后进入决斗目标选择', !!duelPick, queue(s))
}

console.log('[竞版调整：战神/恪守/孙权-竞]')
{
    // 战神：准备阶段选择一项未获得的效果
    const s = build(['sunquan', 'huatuo', 'lvbu_jing'], ['caocao', 'zhenji', 'guojia'], 700)
    const lv = s.generals[5]
    s.activeGeneralIndex = 5
    s.turnPhase = TurnPhase.TURN_START
    runTurnStart(s)
    const zsAsk = findPending(s, 'lvbu_jing_zhanshen')
    check('战神准备阶段提供效果选项', !!zsAsk
        && (((zsAsk.context as any).options as any[])?.length ?? 0) >= 3, queue(s))
    if (zsAsk) {
        s.pendingResponseQueue = [zsAsk]
        handleRespond(s, HUMAN_PLAYER_ID, { action: '2' } as any)
    }
    check('战神记录已获得效果', (lv.zhanshenEffects ?? []).includes(2), lv.zhanshenEffects)
}
{
    // 恪守：受伤时弃两张同色手牌令伤害-1，红色判定摸一张
    const s = build(['huatuo', 'guojia', 'lukang'], ['caocao', 'zhenji', 'sunquan'], 701)
    const lukang = s.generals[5]
    lukang.hp = 4
    lukang.hand = [
        card('ks1', BasicCardName.ATTACK, CardSuit.SPADE, 1),
        card('ks2', BasicCardName.DODGE, CardSuit.CLUB, 2),
    ]
    s.deck = [
        card('ks_judge', BasicCardName.PEACH, CardSuit.HEART, 3),
        card('ks_draw', BasicCardName.PEACH, CardSuit.DIAMOND, 4),
    ]
    const before = lukang.hp
    dealDamage(s, s.generals[0], lukang, 1, undefined, { fromSlash: true })
    const ksAsk = findPending(s, 'lukang_keshou')
    check('恪守受伤时提供发动窗口', !!ksAsk, queue(s))
    if (ksAsk) {
        s.pendingResponseQueue = [ksAsk]
        handleRespond(s, HUMAN_PLAYER_ID, { cardIds: ['ks1', 'ks2'] } as any)
    }
    check('恪守弃两张同色手牌令伤害-1', lukang.hp === before,
        `${before}->${lukang.hp} ${queue(s)}`)
    check('恪守红色判定摸一张', lukang.hand.length === 1,
        lukang.hand.map(c => c.id))
}
{
    // 孙权-竞制衡：己方阵亡且弃尽手牌时额外摸阵亡数张
    const s = build(['sunquan_jing', 'huatuo', 'guojia'], ['caocao', 'zhenji', 'machao'], 702)
    const sq = s.generals[3]
    s.activeGeneralIndex = 3
    s.turnPhase = TurnPhase.ACTION
    sq.hand = [
        card('zhj1', BasicCardName.ATTACK, CardSuit.SPADE, 7),
        card('zhj2', BasicCardName.DODGE, CardSuit.HEART, 2),
    ]
    s.generals[4].alive = false
    s.generals[5].alive = false
    s.deck = Array.from({ length: 8 }, (_, i) => card('zhjd' + i, BasicCardName.PEACH, CardSuit.CLUB, 3))
    handleUseSkill(s, HUMAN_PLAYER_ID, {
        skillId: 'sunquan_jing_zhiheng', cardIds: ['zhj1', 'zhj2'],
    } as any)
    check('孙权-竞制衡按阵亡数额外摸牌', sq.hand.length === 4,
        `hand=${sq.hand.length} ${queue(s)}`)
}

console.log('[界荀彧 / 吴景]')
{
    // 节命：受伤后必须先选一项
    const s = build(['xunyu'], ['caocao'])
    const jm = s.generals[1]
    s.turnSerial = 1
    jm.hand = [card('jm1', BasicCardName.DODGE, CardSuit.HEART, 2)]
    dealDamage(s, s.generals[0], jm, 1)
    const jmPrompt: any = findPending(s, 'xunyu_jieming')
    check('节命：受伤后提供两个选项', jmPrompt?.context?.options?.length === 2, queue(s))

    s.deck = [
        card('jmd1', BasicCardName.DODGE, CardSuit.HEART, 3),
        card('jmd2', BasicCardName.DODGE, CardSuit.DIAMOND, 4),
    ]
    handleRespond(s, HUMAN_PLAYER_ID, { action: 'mode2' } as any)
    handleRespond(s, HUMAN_PLAYER_ID, { action: 'target', targetIndex: 1 } as any)
    check('节命②：目标摸两张', jm.hand.length === 3, jm.hand.map(c => c.id))

    const s2 = build(['xunyu'], ['caocao'])
    const jm2 = s2.generals[1]
    s2.turnSerial = 1
    jm2.hand = Array.from({ length: 5 }, (_, i) => card('jmh' + i, BasicCardName.DODGE, CardSuit.HEART, 2))
    s2.deck = Array.from({ length: 4 }, (_, i) => card('jmb' + i, BasicCardName.PEACH, CardSuit.CLUB, 3))
    dealDamage(s2, s2.generals[0], jm2, 1)
    handleRespond(s2, HUMAN_PLAYER_ID, { action: 'mode1' } as any)
    handleRespond(s2, HUMAN_PLAYER_ID, { action: 'target', targetIndex: 1 } as any)
    const jmDiscard: any = findPending(s2, 'xunyu_jieming')
    check('节命①：摸X张后弃至体力上限', jmDiscard?.type === ResponseType.SKILL_PICK_CARD
        && jmDiscard.context.count === 5, queue(s2))
}
{
    // 流兵①：出牌阶段第一张非虚拟杀花色视为♦
    const s = build(['wujing'], ['caocao'])
    const wj = s.generals[1]
    s.turnSerial = 1
    const slash = card('lj1', BasicCardName.ATTACK, CardSuit.SPADE, 7)
    wj.hand = [slash]
    handleUseCard(s, HUMAN_PLAYER_ID, { cardId: 'lj1', targetIndices: [0] } as any)
    check('流兵①：第一张杀花色视为♦', (slash as any).suitOverride === CardSuit.DIAMOND, slash)
    check('流兵①：正常进入杀结算', queue(s).some((q: string) => q.startsWith('dodge/')), queue(s))
}
{
    // 流兵②：其他角色黑色杀被闪避后获得之
    const s = build(['wujing'], ['caocao'])
    const cc = s.generals[0]
    const wj = s.generals[1]
    s.activeGeneralIndex = 0
    s.activePlayerFaction = Faction.COOL
    s.turnSerial = 1
    cc.hand = [card('lj2', BasicCardName.ATTACK, CardSuit.SPADE, 5)]
    wj.hand = [card('lj3', BasicCardName.DODGE, CardSuit.HEART, 2)]
    handleUseCard(s, AI_PLAYER_ID, { cardId: 'lj2', targetIndices: [1] } as any)
    handleRespond(s, HUMAN_PLAYER_ID, { cardId: 'lj3' } as any)
    check('流兵②：获得未造成伤害的黑色杀', wj.hand.some(c => c.id === 'lj2'), wj.hand.map(c => c.id))
    check('流兵②：此牌离开弃牌堆', !s.discard.some(c => c.id === 'lj2'))
}
{
    // 合击：红色杀结算结束后，可对原目标再使用一张杀
    const s = build(['wujing'], ['caocao', 'zhangfei'])
    const cc = s.generals[0]
    const zf = s.generals[1]
    const wj = s.generals[2]
    s.activeGeneralIndex = 0
    s.activePlayerFaction = Faction.COOL
    s.turnSerial = 1
    cc.hand = [card('hj1', BasicCardName.ATTACK, CardSuit.HEART, 9)]
    wj.hand = [card('hj2', BasicCardName.ATTACK, CardSuit.DIAMOND, 6)]
    handleUseCard(s, AI_PLAYER_ID, { cardId: 'hj1', targetIndices: [1] } as any)
    handleRespond(s, AI_PLAYER_ID, {} as any)
    check('合击：红色杀结算结束后询问', !!findPending(s, 'wujing_heji'), queue(s))
    handleRespond(s, HUMAN_PLAYER_ID, { action: 'confirm' } as any)
    const hjPick: any = findPending(s, 'wujing_heji')
    check('合击：确认后进入选牌', hjPick?.type === ResponseType.SKILL_PICK_CARD, queue(s))
    const zfHpBefore = zf.hp
    handleRespond(s, HUMAN_PLAYER_ID, { cardIds: ['hj2'] } as any)
    check('合击：对原目标使用一张【杀】', s.pendingResponseQueue.some(p => p.type === ResponseType.DODGE
        && p.targetGeneralIndex === 1), queue(s))
    check('合击：目标尚未再次结算伤害', zf.hp === zfHpBefore, zf.hp)
}

console.log('[神甘宁开局体力]')
{
    // 魄袭：6 体力上限，游戏开始时失去 3 点体力
    const s = createLocalMatch(Faction.WARM, 7031)
    s.phase = GamePhase.DEPLOY
    s.deployState = { warmDeployed: false, coolDeployed: false }
    const pick = s.pickState!
    pick.warmPicked = ['huatuo', 'ganning_shen', 'sunquan'].map((id) => getGeneralById(id)!)
    pick.coolPicked = ['guojia', 'zhenji', 'xiahoudun'].map((id) => getGeneralById(id)!)
    pick.pickStep = 6
    localDeployGenerals(s, Faction.WARM, 'huatuo', 'ganning_shen', 'sunquan')
    localDeployGenerals(s, Faction.COOL, 'guojia', 'zhenji', 'xiahoudun')
    const gan = s.generals.find((g) => g.generalId === 'ganning_shen')!
    check('神甘宁开局 3/6（6 上限失去 3 点体力）', gan.hp === 3 && gan.maxHp === 6, `${gan.hp}/${gan.maxHp}`)
}

console.log('[文鸯]')
{
    // 却敌：获得目标一张手牌
    const s = build(['wenyang', 'huatuo', 'sunquan'], ['caocao', 'guojia', 'zhenji'], 81)
    const wy = s.generals[3]
    const cc = s.generals[2]
    s.turnSerial = 1
    wy.hand = [
        card('wd1', BasicCardName.ATTACK, CardSuit.SPADE, 10),
        card('wd2', BasicCardName.DODGE, CardSuit.HEART, 2),
    ]
    cc.hand = [
        card('wc1', BasicCardName.DODGE, CardSuit.HEART, 3),
        card('wc2', BasicCardName.PEACH, CardSuit.DIAMOND, 4),
    ]
    handleUseCard(s, HUMAN_PLAYER_ID, { cardId: 'wd1', targetIndices: [2] } as any)
    check('却敌：使用【杀】后询问', !!findPending(s, 'wenyang_quedi'), queue(s))
    handleRespond(s, HUMAN_PLAYER_ID, { action: 'gain' } as any)
    check('却敌：获得目标一张手牌', wy.hand.some(c => c.id === 'wc1' || c.id === 'wc2'),
        wy.hand.map(c => c.id))
    check('却敌：本回合次数已用', wy.quediCount === 1, wy.quediCount)
}
{
    // 却敌：弃基本牌令伤害+1
    const s = build(['wenyang', 'huatuo', 'sunquan'], ['caocao', 'guojia', 'zhenji'], 82)
    const wy = s.generals[3]
    const cc = s.generals[2]
    s.turnSerial = 1
    wy.hand = [
        card('we1', BasicCardName.ATTACK, CardSuit.SPADE, 10),
        card('we2', BasicCardName.DODGE, CardSuit.HEART, 2),
    ]
    cc.hand = []
    handleUseCard(s, HUMAN_PLAYER_ID, { cardId: 'we1', targetIndices: [2] } as any)
    handleRespond(s, HUMAN_PLAYER_ID, { action: 'bonus' } as any)
    const pick = findPending(s, 'wenyang_quedi_discard')
    check('却敌：进入弃基本牌选择', !!pick && pick.type === ResponseType.SKILL_PICK_CARD, queue(s))
    handleRespond(s, HUMAN_PLAYER_ID, { cardIds: ['we2'] } as any)
    check('却敌：已挂上伤害加成', wy.quediBonusCardId === 'we1', wy.quediBonusCardId)
    handleRespond(s, AI_PLAYER_ID, {} as any)
    check('却敌：此【杀】伤害+1', cc.hp === cc.maxHp - 2, `${cc.hp}/${cc.maxHp}`)
    check('却敌：伤害加成用完即清', wy.quediBonusCardId === undefined, wy.quediBonusCardId)
}
{
    // 却敌：两项都选，减1点体力上限
    const s = build(['wenyang', 'huatuo', 'sunquan'], ['caocao', 'guojia', 'zhenji'], 83)
    const wy = s.generals[3]
    const cc = s.generals[2]
    s.turnSerial = 1
    const maxHpBefore = wy.maxHp
    wy.hand = [
        card('wf1', BasicCardName.ATTACK, CardSuit.SPADE, 10),
        card('wf2', BasicCardName.DODGE, CardSuit.HEART, 2),
    ]
    cc.hand = [card('wc3', BasicCardName.PEACH, CardSuit.DIAMOND, 4)]
    handleUseCard(s, HUMAN_PLAYER_ID, { cardId: 'wf1', targetIndices: [2] } as any)
    handleRespond(s, HUMAN_PLAYER_ID, { action: 'both' } as any)
    handleRespond(s, HUMAN_PLAYER_ID, { cardIds: ['wf2'] } as any)
    check('却敌：两项都选后减1点体力上限', wy.maxHp === maxHpBefore - 1, wy.maxHp)
    check('却敌：两项都选也获得手牌', wy.hand.some(c => c.id === 'wc3'), wy.hand.map(c => c.id))
}
{
    // 仇决：杀死角色后加体力上限、摸两张、却敌上限+1
    const s = build(['wenyang', 'huatuo', 'sunquan'], ['caocao', 'guojia', 'zhenji'], 84)
    const wy = s.generals[3]
    const cc = s.generals[0]
    cc.seatRole = SeatRole.COMMANDER
    s.turnSerial = 5
    cc.hp = 1
    wy.maxHp = 4
    wy.quediTurn = 5
    wy.quediCount = 0
    wy.quediExtra = 0
    const handBefore = wy.hand.length
    s.deck = Array.from({ length: 10 }, (_, i) =>
        card('qd' + i, BasicCardName.PEACH, CardSuit.HEART, (i % 9) + 1))
    dealDamage(s, wy, cc, 1)
    for (let i = 0; i < 12 && s.pendingResponseQueue.length > 0; i++) {
        const head = s.pendingResponseQueue[0]
        handleRespond(s, s.generals[head.targetGeneralIndex].playerId, { action: 'skip_all' } as any)
    }
    check('仇决：目标阵亡', !cc.alive)
    check('仇决：加1点体力上限', wy.maxHp === 5, wy.maxHp)
    check('仇决：摸两张牌', wy.hand.length === handBefore + 2, wy.hand.length)
    check('仇决：本回合却敌次数上限+1', (wy.quediExtra ?? 0) === 1, wy.quediExtra)
}
{
    // 椎锋：失去1点体力视为使用【决斗】；因掉血时防止并失效
    const s = build(['wenyang', 'huatuo', 'sunquan'], ['zhangfei', 'guojia', 'zhenji'], 85)
    const wy = s.generals[3]
    const zf = s.generals[2]
    s.turnSerial = 1
    wy.hp = 4
    wy.hand = []
    zf.hand = [card('zf1', BasicCardName.ATTACK, CardSuit.SPADE, 8)]
    handleUseSkill(s, HUMAN_PLAYER_ID, { skillId: 'wenyang_zhuifeng', targetIndices: [2] } as any)
    check('椎锋：失去1点体力', wy.hp === 3, wy.hp)
    check('椎锋：视为使用【决斗】（无懈窗口）', !!s.negateWindow, queue(s))
    negateWindowTimeout(s)
    check('椎锋：决斗进入响应', s.pendingResponseQueue.some(p => p.type === ResponseType.ATTACK_DUEL),
        queue(s))
    handleRespond(s, HUMAN_PLAYER_ID, { action: 'decline' } as any)
    handleRespond(s, AI_PLAYER_ID, { cardId: 'zf1' } as any)
    handleRespond(s, HUMAN_PLAYER_ID, {} as any)
    check('椎锋：防止决斗反伤', wy.hp === 3, wy.hp)
    check('椎锋：本阶段失效', wy.zhuifengDisabledTurn === 1, wy.zhuifengDisabledTurn)
    const again = handleUseSkill(s, HUMAN_PLAYER_ID, { skillId: 'wenyang_zhuifeng', targetIndices: [2] } as any)
    check('椎锋：失效后再用被拒', !!again && 'error' in again, again)
}

console.log('[新增武将：田畴 / 高览 / 崔琰 / 张翼]')

/** 场上所有区域的牌数（善刀/峻攻等的牌数守恒断言用） */
const tableCardCount = (s: any): number => {
    let n = s.deck.length + s.discard.length + (s.harvestPool?.length ?? 0)
    for (const g of s.generals) {
        n += g.hand.length + g.judgeZone.length
        n += Object.values(g.equip ?? {}).filter(Boolean).length
        n += g.generalPile?.length ?? 0
    }
    return n
}

{
    // 善刀（田畴）：取被选角色的各一张牌置顶 → 对这些角色五谷丰登 → 对其余角色万箭齐发
    const s = build(['tianchou', 'huatuo', 'sunquan'], ['xiahouyuan', 'guanyu', 'machao'], 910)
    s.turnSerial = 1
    const tc = s.generals[3]
    const xy = s.generals[0]
    const gy = s.generals[1]
    const mc = s.generals[2]
    tc.hand = [card('tc1', BasicCardName.ATTACK, CardSuit.SPADE, 7)]
    xy.hand = [card('xy1', BasicCardName.DODGE, CardSuit.HEART, 2), card('xy2', BasicCardName.PEACH, CardSuit.HEART, 3)]
    gy.hand = [card('gy1', BasicCardName.WINE, CardSuit.DIAMOND, 9)]
    mc.hand = [card('mc1', BasicCardName.ATTACK, CardSuit.CLUB, 6)]
    s.deck = Array.from({ length: 12 }, (_, i) => card('sd' + i, BasicCardName.DODGE, CardSuit.HEART, (i % 9) + 1))
    const before = tableCardCount(s)
    const res = handleUseSkill(s, HUMAN_PLAYER_ID, { skillId: 'tianchou_shandao', targetIndices: [0] } as any)
    check('善刀：可以发动', !(res && 'error' in res), res)
    check('善刀：本阶段已使用过', tc.shandaoUsedPhase === true, tc.shandaoUsedPhase)
    check('善刀：被选角色少了一张牌', xy.hand.length === 1, xy.hand.map(c => c.id))
    const again = handleUseSkill(s, HUMAN_PLAYER_ID, { skillId: 'tianchou_shandao', targetIndices: [1] } as any)
    check('善刀：本阶段再发动被拒', !!(again && 'error' in again), again)
    check('善刀：先结算五谷丰登',
        s.pendingResponseQueue[0]?.type === ResponseType.HARVEST_PICK
        && s.pendingResponseQueue[0].targetGeneralIndex === 0, queue(s))
    const arrows = s.pendingResponseQueue
        .filter(p => p.type === ResponseType.AOE_DODGE)
        .map(p => p.targetGeneralIndex)
        .sort()
    check('善刀：万箭齐发目标为除被选角色外的其他存活角色（不含田畴）',
        JSON.stringify(arrows) === JSON.stringify([1, 2, 4, 5]), arrows)
    check('善刀：牌数守恒', tableCardCount(s) === before, `${before} -> ${tableCardCount(s)}`)
    const harvestId = s.harvestPool?.[0]?.id
    handleRespond(s, AI_PLAYER_ID, { cardId: harvestId } as any)
    check('善刀：五谷丰登的牌进入目标手牌',
        !!harvestId && xy.hand.some(c => c.id === harvestId), xy.hand.map(c => c.id))
    let guard = 0
    while (s.pendingResponseQueue.length > 0 && guard++ < 12) {
        const head = s.pendingResponseQueue[0]
        const who = s.generals[head.targetGeneralIndex]
        handleRespond(s, who.playerId, { action: 'decline' } as any)
    }
    check('善刀：万箭齐发造成伤害', gy.hp === gy.maxHp - 1, `${gy.hp}/${gy.maxHp}`)
    check('善刀：两次结算后牌数仍守恒', tableCardCount(s) === before, `${before} -> ${tableCardCount(s)}`)
}

{
    // 峻攻（高览）：X = 本阶段发动次数 + 1；造成伤害后本回合失效
    const s = build(['huatuo', 'sunquan', 'machao'], ['gaolan', 'xiahouyuan', 'guanyu'], 911)
    s.activeGeneralIndex = 0
    s.activePlayerFaction = Faction.COOL
    s.turnSerial = 1
    const gl = s.generals[0]
    gl.hp = 4
    gl.hand = [card('jg1', BasicCardName.DODGE, CardSuit.HEART, 2), card('jg2', BasicCardName.PEACH, CardSuit.HEART, 3)]
    const r1 = handleUseSkill(s, AI_PLAYER_ID, { skillId: 'gaolan_jungong' } as any)
    check('峻攻：可以发动', !(r1 && 'error' in r1), r1)
    const costPend = findPending(s, 'gaolan_jungong')
    const costOpts = ((costPend?.context as any)?.options ?? []) as { action: string }[]
    check('峻攻：X=1 时询问代价',
        (costPend?.context as any)?.jungongCost === 1
        && costOpts.some(o => o.action === 'discard') && costOpts.some(o => o.action === 'loseHp'),
        costOpts.map(o => o.action))
    handleRespond(s, AI_PLAYER_ID, { action: 'discard' } as any)
    const pickPend = findPending(s, 'gaolan_jungong_discard')
    check('峻攻：弃牌分支需要选 1 张', (pickPend?.context as any)?.count === 1, queue(s))
    handleRespond(s, AI_PLAYER_ID, { cardIds: ['jg1'] } as any)
    check('峻攻：弃牌后选择【杀】目标', !!findPending(s, 'gaolan_jungong_target'), queue(s))
    handleRespond(s, AI_PLAYER_ID, { targetIndex: 3 } as any)
    check('峻攻：本阶段发动次数 +1', (gl.jungongCount ?? 0) === 1, gl.jungongCount)
    check('峻攻：造成伤害前技能未失效', gl.jungongDisabledTurn === undefined, gl.jungongDisabledTurn)
    handleRespond(s, HUMAN_PLAYER_ID, {} as any)
    check('峻攻：此【杀】造成伤害后本回合失效', gl.jungongDisabledTurn === 1, gl.jungongDisabledTurn)
    const r2 = handleUseSkill(s, AI_PLAYER_ID, { skillId: 'gaolan_jungong' } as any)
    check('峻攻：失效后再用被拒', !!(r2 && 'error' in r2), r2)
}

{
    // 峻攻：X 递增（出闪则技能不失效，可继续发动）
    const s = build(['huatuo', 'sunquan', 'machao'], ['gaolan', 'xiahouyuan', 'guanyu'], 912)
    s.activeGeneralIndex = 0
    s.activePlayerFaction = Faction.COOL
    s.turnSerial = 2
    const gl = s.generals[0]
    const ht = s.generals[3]
    gl.hp = 4
    gl.hand = [card('jk1', BasicCardName.DODGE, CardSuit.HEART, 4), card('jk2', BasicCardName.PEACH, CardSuit.HEART, 5)]
    ht.hand = [card('jk3', BasicCardName.DODGE, CardSuit.DIAMOND, 6)]
    ht.hp = 3
    handleUseSkill(s, AI_PLAYER_ID, { skillId: 'gaolan_jungong' } as any)
    handleRespond(s, AI_PLAYER_ID, { action: 'loseHp' } as any)
    check('峻攻：失去体力分支（X=1）', gl.hp === 3, gl.hp)
    handleRespond(s, AI_PLAYER_ID, { targetIndex: 3 } as any)
    handleRespond(s, HUMAN_PLAYER_ID, { cardId: 'jk3' } as any)
    check('峻攻：出闪则本回合不失效', gl.jungongDisabledTurn === undefined, gl.jungongDisabledTurn)
    handleUseSkill(s, AI_PLAYER_ID, { skillId: 'gaolan_jungong' } as any)
    const costPend2 = findPending(s, 'gaolan_jungong')
    check('峻攻：第二次发动 X=2', (costPend2?.context as any)?.jungongCost === 2,
        (costPend2?.context as any)?.jungongCost)
}

{
    // 等力（高览）：体力值相等时使用【杀】指定目标 / 成为【杀】目标都可摸一张
    const s = build(['gaolan', 'huatuo', 'sunquan'], ['xiahouyuan', 'guanyu', 'machao'], 913)
    s.turnSerial = 1
    const gl = s.generals[3]
    const xy = s.generals[0]
    gl.hp = 4
    xy.hp = 4
    gl.equip.weapon = card('dl_bow', EquipmentCardName.KYLIN_BOW, CardSuit.SPADE, 5,
        CardCategory.EQUIPMENT, { attackRange: 5 })
    gl.hand = [card('dl1', BasicCardName.ATTACK, CardSuit.SPADE, 8)]
    handleUseCard(s, HUMAN_PLAYER_ID, { cardId: 'dl1', targetIndices: [0] } as any)
    check('等力：使用【杀】且体力相等时询问', !!findPending(s, 'gaolan_dengli'), queue(s))
    const dlHandBefore = gl.hand.length
    handleRespond(s, HUMAN_PLAYER_ID, { action: 'confirm' } as any)
    check('等力：摸一张牌', gl.hand.length === dlHandBefore + 1, gl.hand.length)

    const s2 = build(['gaolan', 'huatuo', 'sunquan'], ['xiahouyuan', 'guanyu', 'machao'], 914)
    const gl2 = s2.generals[3]
    gl2.hp = 3
    s2.generals[0].hp = 4
    gl2.equip.weapon = card('dl_bow2', EquipmentCardName.KYLIN_BOW, CardSuit.SPADE, 5,
        CardCategory.EQUIPMENT, { attackRange: 5 })
    gl2.hand = [card('dl2', BasicCardName.ATTACK, CardSuit.SPADE, 9)]
    handleUseCard(s2, HUMAN_PLAYER_ID, { cardId: 'dl2', targetIndices: [0] } as any)
    check('等力：体力值不相等不询问', !findPending(s2, 'gaolan_dengli'), queue(s2))

    const s3 = build(['gaolan', 'huatuo', 'sunquan'], ['xiahouyuan', 'guanyu', 'machao'], 915)
    s3.activeGeneralIndex = 0
    s3.activePlayerFaction = Faction.COOL
    const gl3 = s3.generals[3]
    gl3.hp = 4
    s3.generals[0].hp = 4
    s3.generals[0].equip.weapon = card('dl_bow3', EquipmentCardName.KYLIN_BOW, CardSuit.SPADE, 5,
        CardCategory.EQUIPMENT, { attackRange: 5 })
    s3.generals[0].hand = [card('dl3', BasicCardName.ATTACK, CardSuit.SPADE, 10)]
    handleUseCard(s3, AI_PLAYER_ID, { cardId: 'dl3', targetIndices: [3] } as any)
    const hisSlash = findPending(s3, 'gaolan_dengli')
    check('等力：成为其他角色【杀】的目标时由高览确认',
        !!hisSlash && hisSlash.targetGeneralIndex === 3, queue(s3))
}

{
    // 雅俊①（崔琰）：摸牌阶段多摸一张牌
    const s = build(['cuiyan', 'huatuo', 'sunquan'], ['xiahouyuan', 'guanyu', 'machao'], 916)
    const cy = s.generals[3]
    cy.hand = []
    s.deck = Array.from({ length: 12 }, (_, i) => card('yj' + i, BasicCardName.DODGE, CardSuit.HEART, 3))
    finishJudgePhaseAndContinue(s, cy, false, false)
    check('雅俊①：摸牌阶段多摸一张（3 张）', cy.hand.length === 3, cy.hand.length)
    const s2 = build(['huatuo', 'sunquan', 'machao'], ['xiahouyuan', 'guanyu', 'zhenji'], 917)
    const ht2 = s2.generals[3]
    ht2.hand = []
    s2.deck = Array.from({ length: 12 }, (_, i) => card('yj2_' + i, BasicCardName.DODGE, CardSuit.HEART, 3))
    finishJudgePhaseAndContinue(s2, ht2, false, false)
    check('雅俊①：对照组只摸两张', ht2.hand.length === 2, ht2.hand.length)
}

{
    // 雅俊②：出牌阶段开始时用本回合获得的牌拼点；赢则可把拼点牌置于牌堆顶
    const s = build(['cuiyan', 'huatuo', 'sunquan'], ['xiahouyuan', 'guanyu', 'machao'], 918)
    s.turnSerial = 3
    const cy = s.generals[3]
    const ht = s.generals[4]
    cy.hand = [card('cy_k', BasicCardName.ATTACK, CardSuit.SPADE, 13), card('cy_2', BasicCardName.DODGE, CardSuit.HEART, 2)]
    cy.gainedCardIdsThisTurn = ['cy_k']
    ht.hand = [card('ht_2', BasicCardName.ATTACK, CardSuit.CLUB, 2)]
    s.deck = Array.from({ length: 8 }, (_, i) => card('pin' + i, BasicCardName.DODGE, CardSuit.HEART, 4))
    beginActionPhase(s, cy)
    const yjPend = findPending(s, 'cuiyan_yajun')
    check('雅俊②：出牌阶段开始时询问拼点', !!yjPend, queue(s))
    handleRespond(s, HUMAN_PLAYER_ID, { action: 'confirm' } as any)
    check('雅俊②：选择拼点对象', !!findPending(s, 'cuiyan_yajun_target'), queue(s))
    handleRespond(s, HUMAN_PLAYER_ID, { targetIndex: 4 } as any)
    const pinPick = s.pendingResponseQueue[0]
    check('雅俊②：进入选拼点牌', pinPick?.type === ResponseType.SKILL_PICK_CARD
        && (pinPick.context as any)?.mode === 'pindian', queue(s))
    const badPick = handleRespond(s, HUMAN_PLAYER_ID, { cardId: 'cy_2' } as any)
    check('雅俊②：非本回合获得的牌被拒', !!(badPick && 'error' in badPick), badPick)
    handleRespond(s, HUMAN_PLAYER_ID, { cardId: 'cy_k' } as any)
    handleRespond(s, HUMAN_PLAYER_ID, { cardId: 'ht_2' } as any)
    const placePend = findPending(s, 'cuiyan_yajun_place')
    check('雅俊②：拼点赢后可选择一张拼点牌置顶', !!placePend, queue(s))
    const deckBefore = s.deck.length
    handleRespond(s, HUMAN_PLAYER_ID, { action: 'place:cy_k' } as any)
    check('雅俊②：拼点牌置于牌堆顶', s.deck[0]?.id === 'cy_k' && s.deck.length === deckBefore + 1,
        s.deck[0]?.id)

    // 没赢：本回合手牌上限 -1
    const s2 = build(['cuiyan', 'huatuo', 'sunquan'], ['xiahouyuan', 'guanyu', 'machao'], 919)
    s2.turnSerial = 4
    const cy2 = s2.generals[3]
    const ht2 = s2.generals[4]
    cy2.hand = [card('cy2_small', BasicCardName.ATTACK, CardSuit.SPADE, 2)]
    cy2.gainedCardIdsThisTurn = ['cy2_small']
    ht2.hand = [card('ht2_big', BasicCardName.ATTACK, CardSuit.CLUB, 13)]
    beginActionPhase(s2, cy2)
    handleRespond(s2, HUMAN_PLAYER_ID, { action: 'confirm' } as any)
    handleRespond(s2, HUMAN_PLAYER_ID, { targetIndex: 4 } as any)
    handleRespond(s2, HUMAN_PLAYER_ID, { cardId: 'cy2_small' } as any)
    handleRespond(s2, HUMAN_PLAYER_ID, { cardId: 'ht2_big' } as any)
    check('雅俊②：拼点没赢则本回合手牌上限-1', (cy2.handLimitDelta ?? 0) === -1, cy2.handLimitDelta)
}

{
    // 尊嫡（崔琰）：判定黑色 → 目标摸三张牌
    const s = build(['cuiyan', 'huatuo', 'sunquan'], ['xiahouyuan', 'guanyu', 'machao'], 920)
    s.turnSerial = 5
    const cy = s.generals[3]
    const xy = s.generals[0]
    cy.hand = [card('zd1', BasicCardName.DODGE, CardSuit.CLUB, 2), card('zd2', BasicCardName.ATTACK, CardSuit.SPADE, 7)]
    s.deck = [
        card('jd_black', BasicCardName.ATTACK, CardSuit.SPADE, 5),
        ...Array.from({ length: 8 }, (_, i) => card('zd_deck' + i, BasicCardName.DODGE, CardSuit.HEART, 4)),
    ]
    const zres = handleUseSkill(s, HUMAN_PLAYER_ID, { skillId: 'cuiyan_zundi', targetIndices: [0], cardIds: ['zd1'] } as any)
    check('尊嫡：可以发动', !(zres && 'error' in zres), zres)
    check('尊嫡：本阶段已使用过', cy.zundiUsedPhase === true, cy.zundiUsedPhase)
    check('尊嫡：判定黑色时目标摸三张牌', xy.hand.length === 3, xy.hand.length)
    check('尊嫡：判定黑色不产生移动询问', !findPending(s, 'cuiyan_zundi_move'), queue(s))

    // 尊嫡：判定红色 → 目标可以移动场上的一张牌
    const s2 = build(['cuiyan', 'huatuo', 'sunquan'], ['xiahouyuan', 'guanyu', 'machao'], 921)
    s2.turnSerial = 6
    const cy2 = s2.generals[3]
    const xy2 = s2.generals[0]
    const mc2 = s2.generals[2]
    cy2.hand = [card('zd3', BasicCardName.DODGE, CardSuit.CLUB, 3)]
    s2.deck = [
        card('jd_red', BasicCardName.PEACH, CardSuit.HEART, 9),
        ...Array.from({ length: 8 }, (_, i) => card('zd_deck2_' + i, BasicCardName.DODGE, CardSuit.HEART, 4)),
    ]
    mc2.equip.weapon = card('zd_eq', EquipmentCardName.KYLIN_BOW, CardSuit.SPADE, 5,
        CardCategory.EQUIPMENT, { attackRange: 5 })
    handleUseSkill(s2, HUMAN_PLAYER_ID, { skillId: 'cuiyan_zundi', targetIndices: [0], cardIds: ['zd3'] } as any)
    const movePend = findPending(s2, 'cuiyan_zundi_move')
    check('尊嫡：判定红色时目标可以移动场上的一张牌',
        !!movePend && movePend.targetGeneralIndex === 0, queue(s2))
    handleRespond(s2, AI_PLAYER_ID, { action: 'confirm' } as any)
    check('尊嫡：选择装备来源', !!findPending(s2, 'cuiyan_zundi_move_src'), queue(s2))
    handleRespond(s2, AI_PLAYER_ID, { targetIndex: 2 } as any)
    check('尊嫡：选择装备获得者', !!findPending(s2, 'cuiyan_zundi_move_dst'), queue(s2))
    handleRespond(s2, AI_PLAYER_ID, { targetIndex: 0 } as any)
    check('尊嫡：装备牌已移动到目标装备区',
        s2.generals[0].equip.weapon?.id === 'zd_eq' && !mc2.equip.weapon,
        s2.generals[0].equip.weapon?.id)
    check('尊嫡：目标没有额外摸牌', xy2.hand.length === 0, xy2.hand.length)
}

{
    // 执义（张翼）：结束阶段选择视为使用本回合用过的基本牌
    const s = build(['zhangyi', 'huatuo', 'sunquan'], ['xiahouyuan', 'guanyu', 'machao'], 930)
    s.turnPhase = TurnPhase.TURN_END
    s.pendingResponseQueue = []
    const zy = s.generals[3]
    const gy = s.generals[1]
    zy.hand = []
    zy.hp = 4
    zy.equip.weapon = card('zy_bow', EquipmentCardName.KYLIN_BOW, CardSuit.SPADE, 5,
        CardCategory.EQUIPMENT, { attackRange: 5 })
    zy.basicUsedThisTurn = [BasicCardName.ATTACK]
    s.deck = Array.from({ length: 8 }, (_, i) => card('yy' + i, BasicCardName.DODGE, CardSuit.HEART, 3))
    finishTurn(s)
    const yiyiPend = findPending(s, 'zhangyi_yiyi')
    const yiyiOpts = ((yiyiPend?.context as any)?.options ?? []) as { action: string }[]
    check('执义：任意角色结束阶段会询问', !!yiyiPend, queue(s))
    check('执义：选项 1 可选择本回合用过的基本牌',
        yiyiOpts.some(o => o.action === 'use:attack'), yiyiOpts.map(o => o.action))
    check('执义：选项 2 摸一张牌', yiyiOpts.some(o => o.action === 'draw'), yiyiOpts.map(o => o.action))
    handleRespond(s, HUMAN_PLAYER_ID, { action: 'use:attack' } as any)
    check('执义：视为使用【杀】须选择目标', !!findPending(s, 'zhangyi_yiyi_target'), queue(s))
    handleRespond(s, HUMAN_PLAYER_ID, { targetIndex: 1 } as any)
    check('执义：视为使用的【杀】进入响应', s.pendingResponseQueue.some(p => p.type === ResponseType.DODGE),
        queue(s))
    handleRespond(s, AI_PLAYER_ID, {} as any)
    check('执义：视为使用的【杀】造成伤害', gy.hp === gy.maxHp - 1, `${gy.hp}/${gy.maxHp}`)

    // 执义：选择摸一张牌
    const s2 = build(['zhangyi', 'huatuo', 'sunquan'], ['xiahouyuan', 'guanyu', 'machao'], 931)
    s2.turnPhase = TurnPhase.TURN_END
    s2.pendingResponseQueue = []
    const zy2 = s2.generals[3]
    zy2.hand = []
    zy2.basicUsedThisTurn = [BasicCardName.DODGE]
    s2.deck = Array.from({ length: 8 }, (_, i) => card('yy2_' + i, BasicCardName.DODGE, CardSuit.HEART, 3))
    finishTurn(s2)
    const yiyiPend2 = findPending(s2, 'zhangyi_yiyi')
    const yiyiOpts2 = ((yiyiPend2?.context as any)?.options ?? []) as { action: string }[]
    check('执义：只记录到【闪】时没有可视为使用的基本牌',
        !yiyiOpts2.some(o => o.action.startsWith('use:')), yiyiOpts2.map(o => o.action))
    const zy2HandBefore = zy2.hand.length
    handleRespond(s2, HUMAN_PLAYER_ID, { action: 'draw' } as any)
    check('执义：选择摸一张牌', zy2.hand.length === zy2HandBefore + 1, zy2.hand.length)
}

console.log('[本地对战：欢乐成双 / 斗地主]')
{
    const s = createPairMatch(Faction.WARM, 901, false, false, undefined, undefined, true)
    check('欢乐成双本地对战：双方都是本地玩家',
        !!s.players[HUMAN_PLAYER_ID] && !!s.players[HUMAN2_PLAYER_ID], Object.keys(s.players))
    check('欢乐成双本地对战：冷方为本地玩家', s.coolPlayerId === HUMAN2_PLAYER_ID, s.coolPlayerId)
    check('欢乐成双本地对战：不自动补齐 AI 选将',
        !!s.pairPick?.picked.every((id) => id === null), s.pairPick?.picked)
    for (const seat of [0, 1, 2, 3]) {
        const result = pairPickGeneral(s, seat, s.pairPick!.pools[seat][0].id)
        check(`欢乐成双本地对战：${seat + 1} 号位可选`, !(result && 'error' in result), result)
    }
    check('欢乐成双本地对战：四方选完即开局', s.phase === GamePhase.PLAYING, s.phase)
    check('欢乐成双本地对战：席位归属两名本地玩家',
        s.generals.filter(g => g.faction === Faction.WARM).every(g => g.playerId === HUMAN_PLAYER_ID)
        && s.generals.filter(g => g.faction === Faction.COOL).every(g => g.playerId === HUMAN2_PLAYER_ID))
}
{
    const s = createLandlordMatch('landlord', 902, false, false, undefined, undefined, true)
    check('斗地主本地对战：地主与农民都是本地玩家',
        !!s.players[HUMAN_PLAYER_ID] && !!s.players[HUMAN2_PLAYER_ID], Object.keys(s.players))
    check('斗地主本地对战：农民为本地玩家', s.coolPlayerId === HUMAN2_PLAYER_ID, s.coolPlayerId)
    for (const seat of [0, 1, 2]) {
        const result = landlordPickGeneral(s, seat, s.landlordPick!.pools[seat][0].id)
        check(`斗地主本地对战：${seat === 0 ? '地主' : `农民${seat}`} 可选`,
            !(result && 'error' in result), result)
    }
    check('斗地主本地对战：三方选完即开局', s.phase === GamePhase.PLAYING, s.phase)
    check('斗地主本地对战：地主/农民归属两名本地玩家',
        s.generals[0]?.playerId === HUMAN_PLAYER_ID
        && s.generals.slice(1).every(g => g.playerId === HUMAN2_PLAYER_ID))
}

if (failures > 0) {
    console.log(`\n共 ${failures} 项检查失败`)
    process.exit(1)
}
console.log('\n全部检查通过')
