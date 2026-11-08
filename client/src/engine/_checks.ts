/**
 * 单机引擎回归检查：npm run check --workspace=client
 * 全部用例使用固定随机种子，失败时退出码非 0。
 */
import {
    Faction, SeatRole, GamePhase, TurnPhase, CardSuit, CardCategory, ActionUnitType,
    BasicCardName, TrickCardName, EquipSlot, EquipmentCardName, ResponseType,
} from 'sgs3v3-shared'
import { createGeneralInstance, toClientView } from './game-state'
import { getGeneralById } from './generals'
import {
    dealDamage, handleRespond, handleUseCard, handleUseSkill, negateWindowTimeout, processAutoExecutePending,
    triggerJiangJieDiscard, triggerQingzheng, triggerShuzhiChoose, loseHp,
} from './game-actions'
import { createLocalMatch, HUMAN_PLAYER_ID, AI_PLAYER_ID } from './local-match'
import {
    finishJudgePhaseAndContinue, handleEndTurn, finishTurn, chooseActionUnit, handleYieldChoice, handleDiscard,
    runTurnStart,
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
    const ly = findPending(s, 'xuchu_luoyi')
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
    // 华佗：基础青囊，界华佗除疠
    const baseHuatuo = getGeneralById('huatuo')!
    const jieHuatuo = getGeneralById('huatuo_jie')!
    check('基础华佗拥有青囊', baseHuatuo.skills.some(s => s.id === 'huatuo_qingnang'))
    check('界华佗拥有除疠', jieHuatuo.skills.some(s => s.id === 'huatuo_chuli'))
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
    const jieRes = handleUseSkill(jie, HUMAN_PLAYER_ID, { skillId: 'xuhuang_duanliang', targetIndices: [0], cardIds: ['dl0'] } as any)
    check('界徐晃断粮对手牌不少于自己的角色无距离限制', !(jieRes && 'error' in jieRes), jieRes)

    const base = build(['xuhuang', 'sunquan', 'huatuo'], ['caocao', 'guojia', 'zhenji'])
    const xh = base.generals[3]
    xh.hand = Array.from({ length: 4 }, (_, i) => card('dm' + i, BasicCardName.ATTACK, CardSuit.SPADE, 7))
    base.generals[0].hand = Array.from({ length: 4 }, (_, i) => card('dn' + i, BasicCardName.DODGE, CardSuit.HEART, 2))
    const baseRes = handleUseSkill(base, HUMAN_PLAYER_ID, { skillId: 'xuhuang_duanliang', targetIndices: [0], cardIds: ['dm0'] } as any)
    check('基础徐晃断粮受距离限制', !!baseRes && 'error' in baseRes && baseRes.error.includes('距离'), baseRes)
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
        context: { skillId: 'xiaoqiao_tianxiang_luoshu', skillName: '天香', damageAmount: 1, attackerIndex: 0 },
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

console.log('[好施]')
{
    const s = build(['lusu', 'sunquan', 'huatuo'], ['guojia', 'zhenji', 'xiahoudun'], 73)
    const ls = s.generals[3]
    ls.hand = [card('hs1', BasicCardName.PEACH, CardSuit.HEART, 3), card('hs2', BasicCardName.DODGE, CardSuit.HEART, 4)]
    const two = (tag: string) => [
        card(tag + 'a', BasicCardName.PEACH, CardSuit.CLUB, 1),
        card(tag + 'b', BasicCardName.PEACH, CardSuit.CLUB, 2),
    ]
    s.generals[0].hand = two('h0')
    s.generals[1].hand = two('h1')
    s.generals[2].hand = [...two('h2'), card('h2c', BasicCardName.PEACH, CardSuit.CLUB, 3)]
    s.generals[4].hand = [...two('h4'), card('h4c', BasicCardName.PEACH, CardSuit.CLUB, 3), card('h4d', BasicCardName.PEACH, CardSuit.CLUB, 4)]
    s.generals[5].hand = [...two('h5'), card('h5c', BasicCardName.PEACH, CardSuit.CLUB, 3), card('h5d', BasicCardName.PEACH, CardSuit.CLUB, 4)]
    s.deck = [
        card('hsd1', BasicCardName.PEACH, CardSuit.SPADE, 5),
        card('hsd2', BasicCardName.PEACH, CardSuit.SPADE, 6),
        card('hsd3', BasicCardName.PEACH, CardSuit.SPADE, 7),
        card('hsd4', BasicCardName.PEACH, CardSuit.SPADE, 8),
    ]
    s.pendingResponseQueue = [{
        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
        targetGeneralIndex: 3,
        context: { skillId: 'lusu_haoshi', skillName: '好施' },
    }]
    handleRespond(s, HUMAN_PLAYER_ID, { action: 'confirm' } as any)
    const prompt = s.pendingResponseQueue.find(p =>
        p.type === ResponseType.SKILL_CHOOSE_TARGET && (p.context as any)?.skillId === 'lusu_haoshi')
    check('好施手牌大于5时询问给牌目标', !!prompt, queue(s))
    const cands: number[] = ((prompt?.context as any)?.candidateIndices as number[]) ?? []
    check('好施只列出手牌最少的角色', cands.length === 2 && cands.includes(0) && cands.includes(1), cands)
    handleRespond(s, HUMAN_PLAYER_ID, { targetIndex: 0 } as any)
    const givePrompt = s.pendingResponseQueue[0]
    check('好施选定目标后进入选牌',
        givePrompt?.type === ResponseType.SKILL_PICK_CARD
        && (givePrompt.context as any)?.skillId === 'lusu_haoshi_give', queue(s))
    const handBefore = s.generals[0].hand.length
    const picked = ls.hand.map(c => c.id).slice(0, 3)
    handleRespond(s, HUMAN_PLAYER_ID, { cardIds: picked } as any)
    check('好施交出指定张数并恢复回合',
        s.generals[0].hand.length === handBefore + 3 && s.turnPhase === TurnPhase.ACTION,
        `${handBefore} -> ${s.generals[0].hand.length}, ${s.turnPhase}`)
}
{
    // 只有一名手牌最少的角色：不必再问，直接进入选牌
    const s = build(['lusu', 'sunquan', 'huatuo'], ['guojia', 'zhenji', 'xiahoudun'], 74)
    const ls = s.generals[3]
    ls.hand = [card('hs1', BasicCardName.PEACH, CardSuit.HEART, 3), card('hs2', BasicCardName.DODGE, CardSuit.HEART, 4)]
    s.generals[0].hand = []
    s.generals[1].hand = [card('u1', BasicCardName.PEACH, CardSuit.CLUB, 1), card('u2', BasicCardName.PEACH, CardSuit.CLUB, 2)]
    s.generals[2].hand = [card('u3', BasicCardName.PEACH, CardSuit.CLUB, 3), card('u4', BasicCardName.PEACH, CardSuit.CLUB, 4), card('u5', BasicCardName.PEACH, CardSuit.CLUB, 5)]
    s.generals[4].hand = [card('u6', BasicCardName.PEACH, CardSuit.CLUB, 6), card('u7', BasicCardName.PEACH, CardSuit.CLUB, 7), card('u8', BasicCardName.PEACH, CardSuit.CLUB, 8), card('u9', BasicCardName.PEACH, CardSuit.CLUB, 9)]
    s.generals[5].hand = [card('v1', BasicCardName.PEACH, CardSuit.DIAMOND, 1), card('v2', BasicCardName.PEACH, CardSuit.DIAMOND, 2), card('v3', BasicCardName.PEACH, CardSuit.DIAMOND, 3), card('v4', BasicCardName.PEACH, CardSuit.DIAMOND, 4)]
    s.deck = [
        card('hsd1', BasicCardName.PEACH, CardSuit.SPADE, 5),
        card('hsd2', BasicCardName.PEACH, CardSuit.SPADE, 6),
        card('hsd3', BasicCardName.PEACH, CardSuit.SPADE, 7),
        card('hsd4', BasicCardName.PEACH, CardSuit.SPADE, 8),
    ]
    s.pendingResponseQueue = [{
        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
        targetGeneralIndex: 3,
        context: { skillId: 'lusu_haoshi', skillName: '好施' },
    }]
    handleRespond(s, HUMAN_PLAYER_ID, { action: 'confirm' } as any)
    const head = s.pendingResponseQueue[0]
    check('好施唯一最少目标时直接进入选牌',
        head?.type === ResponseType.SKILL_PICK_CARD && (head.context as any)?.haoshiReceiverIndex === 0,
        queue(s))
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
    const s = build(['shamoke', 'sunquan', 'huatuo'], ['zhenji', 'xiahoudun', 'simayi_jie'], 100)
    const smk = s.generals[3]
    smk.cardsUsedTurnCount = 0
    smk.hand = [card('jd-sl', BasicCardName.ATTACK, CardSuit.SPADE, 7)]
    s.generals[2].hand = [card('jd-dd', BasicCardName.DODGE, CardSuit.HEART, 2)]
    const res = handleUseCard(s, HUMAN_PLAYER_ID, { cardId: 'jd-sl', targetIndices: [2] } as any)
    check('沙摩柯对界司马懿使用【杀】', !(res && 'error' in res), res)
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
        const s = build(['sunchen', 'huatuo', 'sunquan'], ['caocao', 'guojia', 'zhenji'], seed)
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
        const ask = findPending(s, 'sunchen_lulian')
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
            !s.generals[2].chained && !findPending(s, 'sunchen_lulian'), queue(s))
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
    const ask = s.pendingResponseQueue.find((p: any) => (p.context as any)?.skillId === 'yufan_zongxuan')
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
        const ask = s.pendingResponseQueue.find((p: any) => (p.context as any)?.skillId === 'yufan_zongxuan')
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
    const s = build(['huatuo', 'sunquan', 'zhenji', 'yufan', 'guojia', 'caocao'], [], 75)
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
    const ask = s.pendingResponseQueue.find((p: any) => (p.context as any)?.skillId === 'yufan_zongxuan')
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
    const s = build(['huatuo', 'sunquan', 'zhenji'], ['yufan', 'guojia', 'caocao'], 76)
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
    const ask = s.pendingResponseQueue.find((p: any) => (p.context as any)?.skillId === 'yufan_zongxuan')
    check('AI 的虞翻也会被询问纵玄', !!ask, queue(s))
    if (ask) {
        s.pendingResponseQueue = [ask]
        aiRespond(s, AI_PLAYER_ID)
        check('AI 成功后纵玄询问已结算', !s.pendingResponseQueue.some(
            (p: any) => (p.context as any)?.skillId === 'yufan_zongxuan'), queue(s))
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
    sj.hp = 2
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
                s.pendingResponseQueue.some((p: any) => (p.context as any)?.skillId === 'guojia_yiji'),
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

    const s = build(['sunquan', 'huatuo', 'caocao'], ['guojia', 'lusu', 'zhangfei'], 120)
    const gj = s.generals[0]
    const ls = s.generals[1]
    const zf = s.generals[2]
    check('郭嘉：主动低、被动强（负值）', activeAbility(s, gj) < 40 && passiveAbility(s, gj) < -60,
        { active: activeAbility(s, gj), passive: passiveAbility(s, gj) })
    check('鲁肃：主动高、无被动防御', activeAbility(s, ls) > 80 && passiveAbility(s, ls) === 0,
        { active: activeAbility(s, ls), passive: passiveAbility(s, ls) })
    check('指定武将近战预设生效',
        tauntPresetOf('lusu').active === 95 && tauntPresetOf('lusu').hand === 9 &&
        tauntPresetOf('shenlusu').active === 90 && tauntPresetOf('shenlusu').hand === 9 &&
        tauntPresetOf('lvbu').active === 40 && tauntPresetOf('lvbu_jing').active === 40 &&
        tauntPresetOf('zhangfei').hand === 7 && tauntPresetOf('zhangfei_jie').hand === 7,
        [tauntPresetOf('lusu'), tauntPresetOf('shenlusu'), tauntPresetOf('lvbu'), tauntPresetOf('zhangfei')])
    check('无防御被动为 0，防御被动为负',
        tauntPresetOf('lusu').passive === 0 && tauntPresetOf('shenlusu').passive === 0 &&
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

    const s2 = build(['sunquan', 'huatuo', 'caocao'], ['weiyan', 'lusu', 'zhangfei'], 121)
    const wy = s2.generals[0]
    const wyBase = activeAbility(s2, wy)
    wy.usedLimitedSkills = ['weiyan_qimou']
    check('限定技用掉后主动能力下降', activeAbility(s2, wy) < wyBase - 15,
        { before: wyBase, after: activeAbility(s2, wy) })

    const s3 = build(['sunquan', 'huatuo', 'caocao'], ['sunce', 'lusu', 'zhangfei'], 122)
    const sc = s3.generals[0]
    const scBase = activeAbility(s3, sc)
    sc.awakened = true
    check('觉醒后主动能力提升', activeAbility(s3, sc) > scBase + 10,
        { before: scBase, after: activeAbility(s3, sc) })

    const s4 = build(['sunquan', 'huatuo', 'caocao'], ['zhangfei', 'lusu', 'guojia'], 123)
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
    const alone = build(['sunquan', 'huatuo', 'caocao'], ['guojia', 'lusu', 'zhangfei'], 124)
    check('队友连携使郭嘉的被动更负',
        activeAbility(withSynergy, withSynergy.generals[0]) > activeAbility(alone, alone.generals[0]) + 3 &&
        passiveAbility(withSynergy, withSynergy.generals[0]) < passiveAbility(alone, alone.generals[0]) - 2)
}

if (failures > 0) {
    console.log(`\n共 ${failures} 项检查失败`)
    process.exit(1)
}
console.log('\n全部检查通过')
