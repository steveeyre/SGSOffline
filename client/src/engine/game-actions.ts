import {
    GameState,
    GeneralInstance,
    Card,
    TurnPhase,
    GameMode,
    ResponseType,
    PendingResponse,
    BasicCardName,
    TrickCardName,
    TrickType,
    EquipSlot,
    CardSuit,
    Faction,
    GamePhase,
    C2S_UseCard,
    C2S_UseSkill,
    C2S_Respond,
    CardCategory,
    EquipmentCardName,
    SeatRole,
} from 'sgs3v3-shared'
import { addLog, getActiveGeneral, checkGameOver, getAttackRange, getHandLimit, getSeatDistance, isSlashLikeCard, maybeChunlaoPickup } from './game-state'
import { drawCards, ensureDeck } from './deck'
import { anyoneHasNegate, canPlayAsNegate, cardDisplayName, cardFullName, suitSymbol, valueName } from './card-utils'
import { getGeneralById } from './generals'
import { rememberCards } from './ai-memory'
import { randomInt, shuffleInPlace } from './rng'

/**
 * 翦灭（界张春华）：双方同时选色，先选一方的颜色暂存在这里，
 * 等双方都选完才公开——不允许从日志或待响应上下文里读出对方颜色。
 */
const jianmiePendingColors = new WeakMap<GameState, Map<number, string>>()

function setJianmieColor(state: GameState, generalIndex: number, color: string): void {
    let bag = jianmiePendingColors.get(state)
    if (!bag) {
        bag = new Map()
        jianmiePendingColors.set(state, bag)
    }
    bag.set(generalIndex, color)
}

function takeJianmieColor(state: GameState, generalIndex: number): string | undefined {
    const bag = jianmiePendingColors.get(state)
    const color = bag?.get(generalIndex)
    bag?.delete(generalIndex)
    return color
}
import { continueJudgePhase, continueTurnFromJudge, continueFromPrepPhase, findJudgeIntervenor, judgeInterveneSkillName, finishTurn, continueDelayedTrickJudge, beginActionPhase, advanceAfterTurn, resolveDufeng, resolveXiaoguo, finishDrawPhaseAfterXunxun, proceedAfterShuomeng, continueAfterYanyu, finishJudgePhaseAndContinue, enterDiscardPhaseOrSkip, startJudgePhase, continueEndPhase, runTurnStart } from './turn-manager'

/** 述志（界曹操）：被修改为限定技的技能是否已经用掉 */
function isLimitedSkillSpent(general: GeneralInstance, skillId: string): boolean {
    return general.shuzhiLimited === skillId && general.usedLimitedSkills.includes(skillId)
}

/** 结束阶段技能结算后推进回合；仍有待响应技能时等待 */
function advanceTurnGuarded(state: GameState): void {
    if (state.pendingResponseQueue.length > 0) return
    advanceAfterTurn(state)
}

/** 检查是否触发雌雄双股剑，如是则 unshift 确认到 pendingResponseQueue */
function maybeDoubleSwords(state: GameState, attackerIdx: number, targetIdx: number): void {
    const attacker = state.generals[attackerIdx]
    const target = state.generals[targetIdx]
    if (!attacker || !target) return
    if (attacker.equip.weapon?.name !== EquipmentCardName.DOUBLE_SWORDS) return
    const attackerDef = getGeneralById(attacker.generalId)
    const targetDef = getGeneralById(target.generalId)
    if (attackerDef && targetDef && attackerDef.gender !== targetDef.gender) {
        state.pendingResponseQueue.unshift({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: attackerIdx,
            context: {
                skillId: 'equip_double_swords',
                skillName: '雌雄双股剑',
                description: `对异性【${getGeneralName(target)}】出杀，令其弃1牌或你摸1牌`,
                targetIndex: targetIdx,
            },
        })
    }
}


// ─────────────────────────────────────────────────────────────
// 无懈可击核心逻辑
// ─────────────────────────────────────────────────────────────

// 无懈可击是否有人持有 / 牌名工具见 ./card-utils（供 turn-manager 复用，避免循环依赖）

/** 延迟锦囊效果定义 */
interface DeferredTrickEffect {
    type: string
    userIndex: number
    targetIndex: number
    triggerJizhi: boolean
    extra?: any
}

/**
 * 在锦囊效果前打开无懈可击窗口。
 * @returns true 表示已打开窗口（效果被延迟），false 表示直接跳过（不开窗口直接执行）
 */
function pushNegateCheck(
    state: GameState,
    trickCardName: string,
    trickUserIndex: number,
    trickTargetIndex: number,
    trickTargetName: string,
    deferredEffect?: DeferredTrickEffect,
    hasFollowUpResponse?: boolean,
): boolean {
    const hasNegate = anyoneHasNegate(state)

    // 伏骑（麹义）：与你距离为1的其他角色不能打出【无懈可击】响应此牌
    const fuqiBlocked = fuqiBlockedIndices(state, trickUserIndex)
    if (fuqiBlocked.length > 0) {
        // 若所有持有【无懈可击】的角色均被伏骑封锁，则无需开窗口
        const stillNegatable = state.generals.some(
            (g, idx) => g.alive && !fuqiBlocked.includes(idx)
                && g.hand.some((c) => c.name === TrickCardName.NEGATE),
        )
        if (!stillNegatable) {
            addLog(state, `【伏骑】：与【${getGeneralName(state.generals[trickUserIndex])}】距离为1的角色不能响应${cardDisplayName({ name: trickCardName } as any)}`)
            return false
        }
    }

    // 无论有没有人有无懈都要开窗口（没人有时3秒后自动结算）
    state.negateWindow = {
        trickCardName,
        trickUserIndex,
        trickTargetIndex,
        trickTargetName,
        isCurrentlyNegated: false,
        deferredEffect,
        hasFollowUpResponse: hasFollowUpResponse ?? false,
        passedPlayerIds: [],
        startedAt: Date.now(),
        anyoneHasNegate: hasNegate,
        fuqiBlockedIndices: fuqiBlocked.length > 0 ? fuqiBlocked : undefined,
    }

    addLog(state, `询问无懈可击...（${cardDisplayName({ name: trickCardName } as any)} → ${trickTargetName}）`)
    return true
}

/** 伏骑（麹义）：与使用者距离为1的其他角色下标 */
function fuqiBlockedIndices(state: GameState, userIndex: number): number[] {
    const user = state.generals[userIndex]
    if (!user?.alive || !hasSkill(user, 'quyi_fuqi')) return []
    return state.generals
        .map((g, idx) => ({ g, idx }))
        .filter(({ g, idx }) => g.alive && idx !== userIndex
            && getAttackRange(user, g, state.generals).distance === 1)
        .map(({ idx }) => idx)
}

// ─────────────────────────────────────────────────────────────
// 洛书版扩展（四）：新增武将通用工具
// ─────────────────────────────────────────────────────────────

/** 雄乱（张绣）：本回合不能使用或打出手牌 */
function cannotUseHandCards(state: GameState, general: GeneralInstance): boolean {
    return general.handForbiddenTurn !== undefined
        && general.handForbiddenTurn === state.turnSerial
}

/** 手牌数是否为全场唯一最多（骄恣） */
function isUniqueHandMax(state: GameState, general: GeneralInstance): boolean {
    const mine = general.hand.length
    return state.generals.every((g) => !g.alive || g === general || g.hand.length < mine)
}

/** 装备区里牌的数量 */
function equippedCount(general: GeneralInstance): number {
    return Object.values(general.equip).filter(Boolean).length
}

/**
 * 从谏（张绣）：当你成为目标数大于1的普通锦囊牌的目标时，
 * 你可以交给一名其他目标角色一张牌；若给出的牌为装备牌则摸两张，否则摸一张
 */
function maybeCongjian(
    state: GameState,
    user: GeneralInstance,
    trickTargets: GeneralInstance[],
): void {
    const aliveTargets = trickTargets.filter((t) => t.alive)
    if (aliveTargets.length < 2) return
    const targetIdxs = aliveTargets.map((t) => state.generals.indexOf(t))
    for (const t of aliveTargets) {
        if (t === user) continue
        if (!hasSkill(t, 'zhangxiu_congjian')) continue
        if (t.hand.length === 0) continue
        const others = targetIdxs.filter((i) => i !== state.generals.indexOf(t))
        if (others.length === 0) continue
        askSkill(state, t, 'zhangxiu_congjian', '从谏',
            '交给一名其他目标角色一张牌：若为装备牌则你摸两张牌，否则摸一张牌',
            { congjianCandidates: others })
        addLog(state, `【${getGeneralName(t)}】可发动【从谏】`)
    }
}

/**
 * 焚城（李儒）：从 order[pos] 起依次询问「弃置至少 need 张牌」或「受到2点火焰伤害」。
 * 每名角色结算完毕后 need 变为其上家因此弃置的牌数+1。
 */
function pushFenchengStep(
    state: GameState,
    order: number[],
    pos: number,
    need: number,
    userIndex: number,
): void {
    let cursor = pos
    while (cursor < order.length) {
        const g = state.generals[order[cursor]]
        if (g && g.alive) break
        cursor++
    }
    if (cursor >= order.length) return
    const general = state.generals[order[cursor]]
    const options: { action: string; label: string }[] = []
    if (general.hand.length >= need) {
        options.push({ action: 'discard', label: `弃置至少${need}张牌` })
    }
    options.push({ action: 'damage', label: '受到2点火焰伤害' })
    state.pendingResponseQueue.push({
        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
        targetGeneralIndex: order[cursor],
        context: {
            skillId: 'liru_fencheng',
            skillName: '焚城',
            description: general.hand.length >= need
                ? `弃置至少${need}张牌，或受到2点火焰伤害`
                : `手牌不足${need}张，只能受到2点火焰伤害`,
            options,
            fenchengOrder: order,
            fenchengPos: cursor + 1,
            fenchengNeed: need,
            fenchengUserIndex: userIndex,
        },
    })
}

/**
 * 兴学（孙休）：令 picks[pos] 起的角色依次摸一张牌并将一张牌置于牌堆顶
 */
function continueXingxue(
    state: GameState,
    ownerIndex: number,
    picks: number[],
    pos: number,
): void {
    let cursor = pos
    while (cursor < picks.length) {
        const g = state.generals[picks[cursor]]
        if (g && g.alive) break
        cursor++
    }
    if (cursor >= picks.length) {
        advanceTurnGuarded(state)
        return
    }
    const g = state.generals[picks[cursor]]
    const drawn = drawForGeneral(state, g, 1)
    g.hand.push(...drawn)
    addLog(state, `【${getGeneralName(g)}】因【兴学】摸了${drawn.length}张牌`)
    if (g.hand.length === 0) {
        continueXingxue(state, ownerIndex, picks, cursor + 1)
        return
    }
    state.pendingResponseQueue.push({
        type: ResponseType.SKILL_PICK_CARD,
        targetGeneralIndex: picks[cursor],
        context: {
            skillId: 'sunxiu_xingxue',
            skillName: '兴学',
            description: '将一张牌置于牌堆顶',
            count: 1,
            mode: 'topdeck',
            xingxueOwnerIndex: ownerIndex,
            xingxuePicks: picks,
            xingxuePos: cursor + 1,
        },
    })
}

/** 贞烈（王异）可响应的普通锦囊 */
const ZHENLIE_TRICK_NAMES: Record<string, string> = {
    dismantle: '过河拆桥',
    steal: '顺手牵羊',
    duel: '决斗',
    fire_attack: '火攻',
    borrow_sword: '借刀杀人',
}

/** 弃置某角色一张牌（优先装备，否则随机手牌） */
function discardOneCardOf(state: GameState, victim: GeneralInstance): Card | undefined {
    const slot = (['weapon', 'armor', 'plus_horse', 'minus_horse'] as const).find(s => victim.equip[s])
    if (slot) {
        const card = victim.equip[slot]!
        clearEquipSlot(state, victim, slot)
        state.discard.push(card)
        maybeChunlaoPickup(state, victim, [card])
        triggerXiaoji(state, victim)
        maybeZongxuan(state, victim, [card])
        return card
    }
    if (victim.hand.length > 0) {
        const card = victim.hand.splice(randomInt(victim.hand.length), 1)[0]
        state.discard.push(card)
        maybeChunlaoPickup(state, victim, [card])
        maybeZongxuan(state, victim, [card])
        return card
    }
    return undefined
}

/** 执行被延迟的锦囊效果 */
function executeDeferredTrickEffect(state: GameState, effect: DeferredTrickEffect): void {
    const user = state.generals[effect.userIndex]
    const target = effect.targetIndex >= 0 ? state.generals[effect.targetIndex] : null

    if (target) triggerJianjiang(state, target, user)

    // 贞烈（王异）：成为其他角色使用普通锦囊牌的目标后，可失去1点体力令此牌无效
    const zhenlieTrickName = ZHENLIE_TRICK_NAMES[effect.type]
    if (target && target.alive && target !== user && zhenlieTrickName
        && (hasSkill(target, 'wangyi_zhenlie') || hasSkill(target, 'wangyi_jie_zhenlie'))
        && !(effect.extra as any)?.zhenlieCancelled
        && !(effect.extra as any)?.zhenlieDeclined) {
        const zhenlieJie = hasSkill(target, 'wangyi_jie_zhenlie')
        state.pendingResponseQueue.unshift({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: effect.targetIndex,
            context: {
                skillId: zhenlieJie ? 'wangyi_jie_zhenlie' : 'wangyi_zhenlie',
                skillName: '贞烈',
                description: zhenlieJie
                    ? `失去1点体力，令【${zhenlieTrickName}】对你无效，然后获得其一张牌或于本回合结束阶段发动“秘计”`
                    : `失去1点体力，令【${zhenlieTrickName}】对你无效，然后弃置来源一张牌`,
                attackerIndex: effect.userIndex,
                zhenlieEffect: effect,
            },
        })
        return
    }

    // 舍宴（董允）：此牌对选定目标无效
    const sheyanTrickName = ZHENLIE_TRICK_NAMES[effect.type]
    if (target && sheyanTrickName && target.sheyanTrick
        && target.sheyanTrick.name === sheyanTrickName
        && target.sheyanTrick.turn === (state.turnSerial ?? 0)) {
        target.sheyanTrick = undefined
        addLog(state, `【${getGeneralName(target)}】受到【舍宴】影响，${cardDisplayName({ name: sheyanTrickName } as any)}对其无效`)
        return
    }

    switch (effect.type) {
        case 'draw_two': {
            const myAlive = state.generals.filter(g => g.faction === user.faction && g.alive).length
            const oppAlive = state.generals.filter(g => g.faction !== user.faction && g.alive).length
            const drawCount = oppAlive > myAlive ? 3 : 2
            const drawn = drawCards(state, drawCount)
            user.hand.push(...drawn)
            addLog(state, `【${getGeneralName(user)}】【无中生有】摸了 ${drawCount} 张牌${oppAlive > myAlive ? '（对方人多，额外+1）' : ''}`)
            triggerQingjian(state, user)
            break
        }
        case 'dismantle': {
            if (target && target.alive) {
                const totalCards = target.hand.length +
                    Object.values(target.equip).filter(e => e != null).length
                if (totalCards > 0) {
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.TRICK_TARGET_CARD_PICK,
                        targetGeneralIndex: effect.userIndex,
                        context: {
                            trickType: 'dismantle',
                            targetIndex: effect.targetIndex,
                        },
                    })
                }
            }
            break
        }
        case 'steal': {
            if (target && target.alive) {
                const totalCards = target.hand.length +
                    Object.values(target.equip).filter(e => e != null).length
                if (totalCards > 0) {
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.TRICK_TARGET_CARD_PICK,
                        targetGeneralIndex: effect.userIndex,
                        context: {
                            trickType: 'steal',
                            targetIndex: effect.targetIndex,
                        },
                    })
                }
            }
            break
        }
        case 'duel': {
            if (target && target.alive) {
                const requiredAttacks = hasSkill(user, 'lvbu_wushuang') ? 2 : 1
                state.pendingResponseQueue.unshift({
                    type: ResponseType.ATTACK_DUEL,
                    targetGeneralIndex: effect.targetIndex,
                    context: {
                        initiatorGeneralIndex: effect.userIndex,
                        duelTargetIndex: effect.targetIndex,
                        requiredAttacks,
                        attacksReceived: 0,
                        duelCardId: effect.extra?.duelCardId,
                        zhanjueUserIndex: effect.extra?.zhanjueUserIndex,
                    },
                })
                addLog(state, `【${getGeneralName(user)}】对【${getGeneralName(target)}】发起【决斗】`)
            }
            break
        }
        case 'borrow_sword': {
            if (target && target.alive) {
                const killTargetIndex = effect.extra?.killTargetIndex as number
                state.pendingResponseQueue.unshift({
                    type: ResponseType.BORROW_SWORD_RESPONSE,
                    targetGeneralIndex: effect.targetIndex,
                    context: {
                        userIndex: effect.userIndex,
                        killTargetIndex,
                    },
                })
            }
            break
        }
        case 'iron_chain': {
            const idxs = (effect.extra?.targetIndices as number[]) ?? [effect.targetIndex]
            for (const idx of idxs) {
                const chainedTarget = state.generals[idx]
                if (!chainedTarget || !chainedTarget.alive) continue
                if (chainedTarget.chained) {
                    chainedTarget.chained = false
                    addLog(state, `【${getGeneralName(chainedTarget)}】重置（铁索连环）`)
                } else {
                    chainGeneral(state, chainedTarget, '铁索连环')
                }
            }
            break
        }
        case 'fire_attack': {
            const target = state.generals[effect.targetIndex]
            if (!target || !target.alive) break
            if (target.hand.length === 0) {
                addLog(state, `【${getGeneralName(target)}】没有手牌，【火攻】未造成伤害`)
                break
            }
            state.pendingResponseQueue.unshift({
                type: ResponseType.FIRE_ATTACK_SHOW,
                targetGeneralIndex: effect.targetIndex,
                context: { stage: 'show', userIndex: effect.userIndex },
            })
            break
        }
    }
}

/**
 * 处理无懈可击玩家响应
 */
function handleNegateRespondImpl(
    state: GameState,
    playerId: string,
    data: { cardId?: string; generalIndex: number },
): { error: string } | void {
    const nw = state.negateWindow
    if (!nw) return { error: '当前没有无懈可击询问' }

    if (data.cardId) {
        // ── 玩家出无懈可击 ──
        const general = state.generals[data.generalIndex]
        if (!general || !general.alive) return { error: '武将不存在或已阵亡' }
        if (general.playerId !== playerId) return { error: '不能操作对方武将' }

        const cardIdx = general.hand.findIndex(c => c.id === data.cardId)
        if (cardIdx === -1) return { error: '手牌中没有此牌' }
        const card = general.hand[cardIdx]
        // 伏骑（麹义）：与你距离为1的角色不能打出【无懈可击】
        if (nw.fuqiBlockedIndices?.includes(data.generalIndex)) {
            return { error: '【伏骑】：你不能响应此牌' }
        }
        // 雄乱（张绣）：本回合不能使用或打出手牌
        if (cannotUseHandCards(state, general)) {
            return { error: '【雄乱】：本回合不能使用或打出手牌' }
        }
        // 看破（卧龙诸葛）：黑色手牌当【无懈可击】；龙魂（神赵云）：◆牌当【无懈可击】
        const kanpoPlay = card.name !== TrickCardName.NEGATE && hasSkill(general, 'wolong_kanpo')
            && (card.suit === CardSuit.SPADE || card.suit === CardSuit.CLUB)
        const longhunNegate = card.name !== TrickCardName.NEGATE && !kanpoPlay
            && hasSkill(general, 'shenzhaoyun_longhun') && card.suit === CardSuit.SPADE
        if (card.name !== TrickCardName.NEGATE && !kanpoPlay && !longhunNegate) return { error: '此牌不是无懈可击' }
        if (blockedByQianxi(general, card)) return { error: '【潜袭】：不能打出该颜色的手牌' }

        general.hand.splice(cardIdx, 1)
        const playedCard: Card = kanpoPlay || longhunNegate
            ? { ...card, name: TrickCardName.NEGATE, category: CardCategory.TRICK }
            : card
        state.discard.push(playedCard)
        checkMingzhe(state, general, card)
        if (kanpoPlay) addLog(state, `【${getGeneralName(general)}】发动【看破】，将${cardFullName(card)}当【无懈可击】使用`)
        if (longhunNegate) addLog(state, `【${getGeneralName(general)}】发动【龙魂】，将${cardFullName(card)}当【无懈可击】打出`)

        nw.isCurrentlyNegated = !nw.isCurrentlyNegated
        const trickName = cardDisplayName({ name: nw.trickCardName } as any)
        if (nw.isCurrentlyNegated) {
            addLog(state, `【${getGeneralName(general)}】打出【无懈可击】，抵消了【${trickName}】对【${nw.trickTargetName}】的效果`)
        } else {
            addLog(state, `【${getGeneralName(general)}】打出【无懈可击】，反制无懈，【${trickName}】继续生效`)
        }

        // 重新检查是否还有人有无懈（可以反制）
        nw.passedPlayerIds = []
        nw.startedAt = Date.now()
        nw.anyoneHasNegate = anyoneHasNegate(state)
        // 如果没人有了，等 3 秒自动结算（由定时器或客户端触发）
    } else {
        // ── 玩家放弃 ──
        if (!nw.passedPlayerIds.includes(playerId)) {
            nw.passedPlayerIds.push(playerId)
        }

        // 检查是否所有持有无懈的玩家都放弃了（看破/龙魂也算持有，与 anyoneHasNegate 保持一致）
        const playerIds = Object.keys(state.players)
        const allRelevantPassed = playerIds.every(pid => {
            const hasNeg = state.generals.some(g =>
                g.playerId === pid && g.alive && g.hand.some(c => canPlayAsNegate(g, c))
            )
            // 没有无懈 → 不需要放弃；有无懈 → 必须已放弃
            return !hasNeg || nw.passedPlayerIds.includes(pid)
        })

        if (allRelevantPassed) {
            resolveNegateWindow(state)
        }
    }
}

/**
 * 无懈可击超时自动结算（服务端定时器调用）
 */
function negateWindowTimeoutImpl(state: GameState): void {
    if (!state.negateWindow) return
    resolveNegateWindow(state)
}

/** 结算无懈可击窗口 */
function resolveNegateWindow(state: GameState): void {
    const nw = state.negateWindow
    if (!nw) return

    state.negateWindow = undefined

    // ── 延时锦囊判定前的无懈 ──
    if (nw.delayedTrickJudgeContext) {
        continueDelayedTrickJudge(state, nw.delayedTrickJudgeContext, nw.isCurrentlyNegated)
        return
    }

    if (nw.isCurrentlyNegated) {
        // 锦囊被无懈
        const trickName = cardDisplayName({ name: nw.trickCardName } as any)
        addLog(state, `【${trickName}】对【${nw.trickTargetName}】的效果被无懈可击抵消`)
        if (nw.hasFollowUpResponse) {
            // 移除后续的 AOE 响应（AOE_DODGE / AOE_ATTACK / HARVEST_PICK 等）
            state.pendingResponseQueue.shift()
        }
        // deferredEffect 不执行
    } else {
        // 锦囊生效
        if (nw.deferredEffect) {
            executeDeferredTrickEffect(state, nw.deferredEffect)
        }
        // hasFollowUpResponse 的情况：不修改下一个 pending 的 needsNegate
        // processAutoExecutePending 会处理当前 pending 后，checkAndOpenNegateWindow 自然为下一个目标开窗口
    }

    // 递归检查下一个 pending 是否也需要无懈
    checkAndOpenNegateWindow(state)
}

/**
 * 检查当前 pending response 是否需要无懈窗口（用于 AOE 延迟开窗口）。
 * 在每次广播前调用，确保 AOE 的每个目标都能被询问无懈。
 */
export function checkAndOpenNegateWindow(state: GameState): void {
    if (state.negateWindow) return  // 已有窗口
    const pending = state.pendingResponseQueue[0]
    if (!pending) return
    const ctx = pending.context as any
    if (!ctx?.needsNegate) return

    // 标记已处理，防止重复
    ctx.needsNegate = false

    // 打开无懈窗口
    pushNegateCheck(
        state,
        ctx.trickCardName,
        ctx.sourceGeneralIndex,
        pending.targetGeneralIndex,
        ctx.trickTargetName,
        undefined,
        true,  // hasFollowUpResponse
    )
}

// ─────────────────────────────────────────────────────────────
// 自动执行 pending response（无需用户交互）
// ─────────────────────────────────────────────────────────────

/**
 * 献图（界张松）代价：失去 1 点体力后继续该出牌阶段的收尾。
 * 失去体力可能触发濒死，此时把收尾排到濒死询问之后，等救援结算完再继续。
 */
function resolveXiantuCost(state: GameState, user: GeneralInstance): void {
    if (user.alive) loseHp(state, user, 1)
    const active = getActiveGeneral(state)
    if (!active) return
    if (state.pendingResponseQueue.length > 0) {
        state.pendingResponseQueue.push({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(active),
            context: {
                skillId: 'zhangsong_xiantu_resume',
                skillName: '献图',
                description: '献图结算完成，继续弃牌阶段',
                autoExecute: true,
            },
        })
        return
    }
    enterDiscardPhaseOrSkip(state, active)
}

function processAutoExecutePendingImpl(state: GameState): void {
    // 兜底：体力已为 0、却没有任何濒死询问在排队（询问被外部丢弃或结算异常中断）时，
    // 直接按阵亡结算，避免该角色以 0 体力继续参与对局
    if (!state.pendingResponseQueue.some((p) => p.type === ResponseType.PEACH_SAVE_ASK)) {
        const stranded = state.generals.find((g) => g.alive && g.hp <= 0)
        if (stranded) handleDeath(state, null, stranded)
    }
    // 循环处理所有队首的自动执行 pending
    while (state.pendingResponseQueue.length > 0) {
        const pending = state.pendingResponseQueue[0]
        const ctx = pending.context as any

        // 仁王盾：目标有仁王盾 + 攻击牌为黑色 + 攻击者无青釭剑 → 自动防御
        if (pending.type === ResponseType.DODGE) {
            const dodgeCtx = ctx as { attackerGeneralIndex: number; attackCard?: Card }
            const target = state.generals[pending.targetGeneralIndex]
            const attacker = dodgeCtx.attackerGeneralIndex >= 0 ? state.generals[dodgeCtx.attackerGeneralIndex] : null
            // 智迟（陈宫）：本回合受到伤害后，【杀】对其无效 → 直接取消（统一拦截所有“代为出杀”入口）
            if (target && isZhichiImmune(state, target)) {
                addLog(state, `【${getGeneralName(target)}】的【智迟】使【杀】对其无效`)
                state.pendingResponseQueue.shift()
                continue
            }
            if (target?.equip.armor?.name === EquipmentCardName.NIOH_SHIELD
                && attacker?.equip.weapon?.name !== EquipmentCardName.QINGGANG_SWORD
                && dodgeCtx.attackCard
                && (dodgeCtx.attackCard.suit === CardSuit.SPADE || dodgeCtx.attackCard.suit === CardSuit.CLUB)) {
                addLog(state, `【${getGeneralName(target)}】的仁王盾抵消了黑色【杀】`)
                handleDodgeSucceeded(state, target, dodgeCtx)
                continue
            }
        }

        // 桃园结义：无懈窗口已结算（needsNegate 为 false）且无活跃无懈窗口，自动执行治疗
        if (pending.type === ResponseType.PEACH_GARDEN_HEAL && !ctx?.needsNegate && !state.negateWindow) {
            state.pendingResponseQueue.shift()
            const target = state.generals[pending.targetGeneralIndex]
            if (target && target.alive && target.hp < target.maxHp) {
                target.hp++
                addLog(state, `【${getGeneralName(target)}】通过【桃园结义】回复至 ${target.hp}/${target.maxHp}`)
                triggerDianhuRecover(state, target)
            }
            continue
        }

        // 五谷丰登只剩最后一张时无需选择，直接收入手牌
        if (pending.type === ResponseType.HARVEST_PICK && !state.negateWindow
            && (state.harvestPool?.length ?? 0) === 1) {
            state.pendingResponseQueue.shift()
            const general = state.generals[pending.targetGeneralIndex]
            const picked = state.harvestPool!.splice(0, 1)[0]
            if (general && picked) {
                general.hand.push(picked)
                rememberCards(state, state.generals.indexOf(general), [picked], '五谷丰登')
                addLog(state, `【${getGeneralName(general)}】从五谷丰登中选择了${cardFullName(picked)}`)
            }
            if (!state.pendingResponseQueue.some(p => p.type === ResponseType.HARVEST_PICK)) {
                state.harvestPool = undefined
            }
            continue
        }

        // 其他 autoExecute pending（如苦肉摸牌）
        if (!ctx?.autoExecute) break

        state.pendingResponseQueue.shift()
        const general = state.generals[pending.targetGeneralIndex]
        if (!general) continue

        switch (ctx.skillId) {
            case 'huanggai_kurou_draw': {
                if (general.alive) {
                    const drawn = drawCards(state, 2)
                    general.hand.push(...drawn)
                    addLog(state, `【${getGeneralName(general)}】苦肉结算：摸了2张牌`)
                }
                break
            }
            case 'huanggai_zhaxiang_draw': {
                if (general.alive) {
                    const drawn = drawCards(state, 3)
                    general.hand.push(...drawn)
                    addLog(state, `【${getGeneralName(general)}】诈降结算：摸了${drawn.length}张牌`)
                }
                break
            }
            case 'chengong_mingce_draw': {
                const mcOther = state.generals[ctx.mingceDrawOtherIndex as number]
                if (general.alive) {
                    const mcOwn = drawCards(state, 1)
                    general.hand.push(...mcOwn)
                    addLog(state, `【${getGeneralName(general)}】【明策】摸1张牌`)
                }
                if (mcOther?.alive) {
                    const mcOtherDrawn = drawCards(state, 1)
                    mcOther.hand.push(...mcOtherDrawn)
                    addLog(state, `【${getGeneralName(mcOther)}】因【明策】摸1张牌`)
                }
                break
            }
            case 'sunce_jiang_jie_gain': {
                const jjGainId = ctx.jiangJieCardId as string
                const jjGainIdx = state.discard.findIndex(c => c.id === jjGainId)
                if (general.alive && jjGainIdx >= 0) {
                    const jjGainCard = state.discard.splice(jjGainIdx, 1)[0]
                    general.hand.push(jjGainCard)
                    addLog(state, `【${getGeneralName(general)}】【激昂】获得${cardFullName(jjGainCard)}`)
                }
                break
            }
            case 'yuejin_xiaoguo_apply': {
                const src = state.generals[ctx.xiaoguoSourceIndex as number]
                const tgt = state.generals[ctx.xiaoguoTargetIndex as number]
                if (tgt?.alive) dealDamage(state, src ?? null, tgt, 1)
                break
            }
            case 'dongyun_sheyan_extra': {
                resumeSheyanExtra(state, ctx)
                break
            }
            case 'zhangsong_xiantu_cost': {
                resolveXiantuCost(state, general)
                break
            }
            case 'zhangsong_xiantu_resume': {
                const xtActive = getActiveGeneral(state)
                if (xtActive) enterDiscardPhaseOrSkip(state, xtActive)
                break
            }
            case 'chengpu_lihuo_cost': {
                if (general.alive) {
                    const damaged = !!general.lihuoDamaged
                    general.lihuoFirePhase = false
                    general.lihuoDamaged = false
                    if (damaged) {
                        loseHp(state, general, 1)
                        addLog(state, `【${getGeneralName(general)}】【疠火】反噬，失去1点体力`)
                    }
                }
                break
            }
            case 'chengpu_jie_lihuo_cost': {
                if (general.alive) {
                    const damaged = !!general.lihuoDamaged
                    general.lihuoFirePhase = false
                    general.lihuoDamaged = false
                    if (damaged) {
                        if (hasCardInArea(general)) {
                            state.pendingResponseQueue.unshift({
                                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                                targetGeneralIndex: state.generals.indexOf(general),
                                context: {
                                    skillId: 'chengpu_jie_lihuo_cost',
                                    skillName: '疠火',
                                    description: '此【杀】造成过伤害，选择一项',
                                    options: [
                                        { action: 'discard', label: '弃置一张牌' },
                                        { action: 'loseHp', label: '失去1点体力' },
                                    ],
                                },
                            })
                        } else {
                            loseHp(state, general, 1)
                            addLog(state, `【${getGeneralName(general)}】【疠火】没有牌可弃，失去1点体力`)
                        }
                    }
                }
                break
            }
            default:
                break
        }
    }

    // 准备阶段的自动结算（如回合结束伤害触发濒死）清空队列后，接续本回合流程，
    // 否则 runTurnStart 因队列非空提前返回后会停在准备阶段
    if (state.pendingResponseQueue.length === 0 && state.turnPhase === TurnPhase.TURN_START) {
        continueFromPrepPhase(state)
    }
}

// ─────────────────────────────────────────────────────────────
// 通用技能判定（支持鬼才/缓释介入）
// ─────────────────────────────────────────────────────────────

/**
 * 技能判定类型：用于区分不同的判定来源
 * - delayedTrick: 延时锦囊（乐不思蜀/兵粮寸断）— 由 turn-manager 处理
 * - ganglie: 刚烈
 * - tieqi: 铁骑
 * - luoshen: 洛神
 * - eight_trigrams: 八卦阵
 * - leiji: 雷击（张角）——判定牌归属被指定的角色
 */
export type SkillJudgeType = 'ganglie' | 'tieqi' | 'tieqi_jie' | 'luoshen' | 'eight_trigrams' | 'leiji' | 'huituo' | 'chouce'

/**
 * 执行一次技能判定：翻牌 → 检查鬼才/缓释 → 结算或等待介入
 * @param extraContext 额外上下文信息，会存入 JUDGE_INTERVENE 的 context 中
 * @returns true 如果判定被介入者打断（需等待），false 如果判定已直接结算
 */
export function performSkillJudge(
    state: GameState,
    judgingGeneral: GeneralInstance,
    judgeType: SkillJudgeType,
    judgeName: string,
    extraContext: Record<string, any>,
): boolean {
    if (!ensureDeck(state)) return false

    const judgeCard = state.deck.shift()!
    state.discard.push(judgeCard)

    const name = getGeneralName(judgingGeneral)
    addLog(state, `【${name}】的【${judgeName}】判定：${cardFullName(judgeCard)}`)

    // 检查鬼才/缓释
    const intervenor = findJudgeIntervenor(state, judgingGeneral)
    if (intervenor) {
        state.pendingResponseQueue.unshift({
            type: ResponseType.JUDGE_INTERVENE,
            targetGeneralIndex: state.generals.indexOf(intervenor),
            context: {
                judgeType,
                judgingGeneralIndex: state.generals.indexOf(judgingGeneral),
                judgeCardId: judgeCard.id,
                judgeCard,
                judgeName,
                ...extraContext,
            },
        })
        const skillName = judgeInterveneSkillName(intervenor)
        addLog(state, `【${getGeneralName(intervenor)}】可发动【${skillName}】修改判定`)
        return true // 被介入，等待
    }

    // 无人介入 → 直接结算
    resolveSkillJudge(state, judgingGeneral, judgeCard, judgeType, extraContext)
    return false
}

/**
 * 结算技能判定结果（被介入后也用此函数，传入替换后的牌）
 */
export function resolveSkillJudge(
    state: GameState,
    judgingGeneral: GeneralInstance,
    judgeCard: Card,
    judgeType: SkillJudgeType,
    extraContext: Record<string, any>,
): void {
    const name = getGeneralName(judgingGeneral)

    switch (judgeType) {
        case 'ganglie': {
            const attackerIdx = extraContext.attackerGeneralIndex as number
            if (judgeCard.suit !== CardSuit.HEART) {
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_GANGLIE_CHOICE,
                    targetGeneralIndex: attackerIdx,
                    context: {
                        ganglieSourceIndex: extraContext.ganglieSourceIndex
                            ?? state.generals.indexOf(judgingGeneral),
                    },
                })
                const atkName = getGeneralName(state.generals[attackerIdx])
                addLog(state, `【刚烈】判定非♥！【${atkName}】须弃2张手牌或受1点伤害`)
            } else {
                addLog(state, `【刚烈】判定为♥，无效果`)
            }
            checkTiandu(state, judgingGeneral, judgeCard)
            break
        }
        case 'tieqi': {
            const isRed = judgeCard.suit === CardSuit.HEART || judgeCard.suit === CardSuit.DIAMOND
            const tieqiTargetIdx = extraContext.tieqiTargetIndex as number
            const tieqiTarget = state.generals[tieqiTargetIdx]
            if (isRed) {
                addLog(state, `【${name}】【铁骑】判定（${suitSymbol(judgeCard.suit)}${valueName(judgeCard.value)}）红色！【${getGeneralName(tieqiTarget)}】不能出闪`)
                // 移除紧跟的 DODGE 响应
                const dodgeIdx = state.pendingResponseQueue.findIndex(
                    p => p.type === ResponseType.DODGE && p.targetGeneralIndex === tieqiTargetIdx
                )
                if (dodgeIdx >= 0) {
                    state.pendingResponseQueue.splice(dodgeIdx, 1)
                }
                // 直接造伤
                const killDmg = calcKillDamage(state, judgingGeneral, tieqiTarget)
                dealDamage(state, judgingGeneral, tieqiTarget, killDmg, extraContext.attackCardId as string)
            } else {
                addLog(state, `【${name}】【铁骑】判定（${suitSymbol(judgeCard.suit)}${valueName(judgeCard.value)}）黑色，无效`)
            }
            checkTiandu(state, judgingGeneral, judgeCard)
            break
        }
        case 'tieqi_jie': {
            const tieqiTargetIdx = extraContext.tieqiTargetIndex as number
            const tieqiTarget = state.generals[tieqiTargetIdx]
            if (tieqiTarget?.alive) {
                const sameSuit = tieqiTarget.hand.filter(c => c.suit === judgeCard.suit)
                const suitText = `${suitSymbol(judgeCard.suit)}`
                if (sameSuit.length > 0) {
                    // 由目标自己决定是否弃牌抵消，不能替其操作
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.SKILL_PICK_CARD,
                        targetGeneralIndex: tieqiTargetIdx,
                        context: {
                            skillId: 'machao_jie_tieqi_keep',
                            skillName: '铁骑',
                            description: `弃置一张${suitText}牌以抵消【铁骑】，否则不能使用【闪】响应此【杀】`,
                            candidateCardIds: sameSuit.map(c => c.id),
                            tieqiSuit: judgeCard.suit,
                            attackerGeneralIndex: state.generals.indexOf(judgingGeneral),
                            attackCardId: extraContext.attackCardId,
                        },
                    })
                    addLog(state, `【${name}】【铁骑】判定（${suitText}${valueName(judgeCard.value)}）：【${getGeneralName(tieqiTarget)}】可弃置一张${suitText}牌抵消`)
                } else {
                    const dodgeIdx = state.pendingResponseQueue.findIndex(
                        p => p.type === ResponseType.DODGE && p.targetGeneralIndex === tieqiTargetIdx
                    )
                    if (dodgeIdx >= 0) state.pendingResponseQueue.splice(dodgeIdx, 1)
                    addLog(state, `【${name}】【铁骑】判定（${suitText}${valueName(judgeCard.value)}）：【${getGeneralName(tieqiTarget)}】无同花色牌，不能出闪`)
                    const killDmg = calcKillDamage(state, judgingGeneral, tieqiTarget)
                    dealDamage(state, judgingGeneral, tieqiTarget, killDmg, extraContext.attackCardId as string,
                        slashDamageOpts(judgingGeneral, undefined))
                }
            }
            checkTiandu(state, judgingGeneral, judgeCard)
            break
        }
        case 'luoshen': {
            const isBlack = judgeCard.suit === CardSuit.SPADE || judgeCard.suit === CardSuit.CLUB
            if (isBlack) {
                // 把判定牌从弃牌堆取出加入手牌
                const discardIdx = state.discard.indexOf(judgeCard)
                if (discardIdx >= 0) state.discard.splice(discardIdx, 1)
                judgingGeneral.hand.push(judgeCard)
                addLog(state, `【${name}】【洛神】判定黑色！获得${cardFullName(judgeCard)}`)
                // 询问是否继续
                if (state.deck.length > 0) {
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                        targetGeneralIndex: state.generals.indexOf(judgingGeneral),
                        context: {
                            skillId: 'zhenji_luoshen_continue',
                            skillName: '洛神',
                            description: '继续判定',
                        },
                    })
                }
            } else {
                addLog(state, `【${name}】【洛神】判定红色（${cardFullName(judgeCard)}），停止`)
                checkTiandu(state, judgingGeneral, judgeCard)
            }
            break
        }
        case 'eight_trigrams': {
            const isRed = judgeCard.suit === CardSuit.HEART || judgeCard.suit === CardSuit.DIAMOND
            const isAoe = extraContext.pendingType === 'AOE_DODGE'
            if (isRed) {
                addLog(state, `【${name}】【八卦阵】判定红色！视为出闪`)
                if (isAoe) {
                    // 万箭齐发：shift 掉 AOE_DODGE pending
                    const aoePendingIdx = state.pendingResponseQueue.findIndex(
                        p => p.type === ResponseType.AOE_DODGE && p.targetGeneralIndex === state.generals.indexOf(judgingGeneral)
                    )
                    if (aoePendingIdx >= 0) {
                        state.pendingResponseQueue.splice(aoePendingIdx, 1)
                    }
                    addLog(state, `【${name}】抵挡万箭齐发`)
                } else {
                    // 杀：八卦阵成功视为打出一张【闪】，同样计入无双等需要多张闪的技能
                    const dodgePendingIdx = state.pendingResponseQueue.findIndex(
                        p => p.type === ResponseType.DODGE && p.targetGeneralIndex === state.generals.indexOf(judgingGeneral)
                    )
                    if (dodgePendingIdx >= 0) {
                        const dodgePending = state.pendingResponseQueue[dodgePendingIdx]
                        const dodgeCtx = dodgePending.context as any
                        dodgeCtx.dodgesReceived = (dodgeCtx.dodgesReceived || 0) + 1
                        const required = dodgeCtx.requiredDodges ?? 1
                        if (dodgeCtx.dodgesReceived >= required) {
                            // 先用 splice 精确移除 DODGE pending，避免 shift 移除错误元素
                            state.pendingResponseQueue.splice(dodgePendingIdx, 1)
                            addLog(state, `【${name}】成功防御【杀】`)
                            // 处理武器效果（贯石斧/青龙偃月刀/猛进等）
                            handleDodgeSucceededAfterRemoval(state, judgingGeneral, dodgeCtx)
                        } else {
                            addLog(state, `【${name}】【八卦阵】视为出闪（${dodgeCtx.dodgesReceived}/${required}），还需继续响应`)
                        }
                    }
                }
            } else {
                addLog(state, `【${name}】【八卦阵】判定黑色，判定失败`)
                // 玩家仍可继续出闪或放弃
            }
            checkTiandu(state, judgingGeneral, judgeCard)
            break
        }
        case 'leiji': {
            // ♠：2点雷电伤害；♣：张角回复1点体力，然后造成1点雷电伤害
            const sourceIdx = extraContext.leijiSourceIndex as number
            const source = state.generals[sourceIdx]
            const leijiTargetIdx = (extraContext.leijiTargetIndex as number) ?? state.generals.indexOf(judgingGeneral)
            const leijiTarget = state.generals[leijiTargetIdx]
            if (source && leijiTarget) {
                if (judgeCard.suit === CardSuit.SPADE) {
                    addLog(state, `【${name}】【雷击】判定${cardFullName(judgeCard)}！【${getGeneralName(source)}】对【${getGeneralName(leijiTarget)}】造成2点雷电伤害`)
                    dealDamage(state, source, leijiTarget, 2, undefined, { nature: 'thunder' })
                } else if (judgeCard.suit === CardSuit.CLUB) {
                    addLog(state, `【${name}】【雷击】判定${cardFullName(judgeCard)}！【${getGeneralName(source)}】回复1点体力，并对【${getGeneralName(leijiTarget)}】造成1点雷电伤害`)
                    if (source.alive && source.hp > 0 && source.hp < source.maxHp) {
                        source.hp += 1
                    }
                    dealDamage(state, source, leijiTarget, 1, undefined, { nature: 'thunder' })
                } else {
                    addLog(state, `【${name}】【雷击】判定${cardFullName(judgeCard)}，无效果`)
                }
            }
            checkTiandu(state, judgingGeneral, judgeCard)
            break
        }
        case 'huituo': {
            // 恢拓（曹叡）：红色其回复1点体力；黑色其摸X张牌（X 为此伤害的伤害值）
            const htIdx = extraContext.huituoOwnerIndex as number | undefined
            const htTarget = htIdx !== undefined ? state.generals[htIdx] : undefined
            if (!htTarget?.alive) break
            const htRed = judgeCard.suit === CardSuit.HEART || judgeCard.suit === CardSuit.DIAMOND
            if (htRed) {
                if (htTarget.hp < htTarget.maxHp) {
                    htTarget.hp += 1
                    addLog(state, `【${getGeneralName(htTarget)}】因【恢拓】回复1点体力（${htTarget.hp}/${htTarget.maxHp}）`)
                    triggerDianhuRecover(state, htTarget)
                } else {
                    addLog(state, `【${getGeneralName(htTarget)}】因【恢拓】判定红色，但体力已满`)
                }
            } else {
                const htAmount = Math.max(1, (extraContext.huituoAmount as number) ?? 1)
                const htDrawn = drawForGeneral(state, htTarget, htAmount)
                htTarget.hand.push(...htDrawn)
                addLog(state, `【${getGeneralName(htTarget)}】因【恢拓】判定黑色，摸${htDrawn.length}张牌`)
            }
            checkTiandu(state, judgingGeneral, judgeCard)
            break
        }
        case 'chouce': {
            const chouceOwner = (extraContext.chouceIndex as number)
            const isBlack = judgeCard.suit === CardSuit.SPADE || judgeCard.suit === CardSuit.CLUB
            if (isBlack) {
                const cands = expAliveIdx(state, g => expHasAnyCard(g))
                if (cands.length > 0) {
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.SKILL_CHOOSE_TARGET,
                        targetGeneralIndex: chouceOwner,
                        context: {
                            skillId: 'xizhicai_chouce_black', skillName: '筹策',
                            description: '选择一名角色，弃置其区域里的一张牌',
                            candidateIndices: cands, chouceOwnerIndex: chouceOwner,
                        },
                    })
                }
                addLog(state, `【${name}】【筹策】判定黑色：弃置一名角色区域里的一张牌`)
            } else {
                const cands = expAliveIdx(state)
                if (cands.length > 0) {
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.SKILL_CHOOSE_TARGET,
                        targetGeneralIndex: chouceOwner,
                        context: {
                            skillId: 'xizhicai_chouce_red', skillName: '筹策',
                            description: '选择一名角色，令其摸一张牌（先辅角色改为摸两张）',
                            candidateIndices: cands,
                        },
                    })
                }
                addLog(state, `【${name}】【筹策】判定红色：令一名角色摸一张牌`)
            }
            checkTiandu(state, judgingGeneral, judgeCard)
            break
        }
    }
}

/** 天妒（郭嘉 / 戏志才）：判定牌生效后，获得判定牌 */
function checkTiandu(state: GameState, general: GeneralInstance, judgeCard: Card): void {
    const def = getGeneralById(general.generalId)
    if (def?.skills.some(s => s.id === 'guojia_tiandu' || s.id === 'xizhicai_tiandu')) {
        const idx = state.discard.indexOf(judgeCard)
        if (idx >= 0) {
            state.discard.splice(idx, 1)
            general.hand.push(judgeCard)
            const gName = def?.name ?? general.generalId
            addLog(state, `【${gName}】发动【天妒】，获得判定牌`)
        }
    }
}

// ─────────────────────────────────────────────────────────────
// 雷击（张角）：使用【闪】选择目标后 / 打出【闪】后，可令一名角色判定
// ─────────────────────────────────────────────────────────────

/**
 * 张角使用或打出【闪】后开雷击窗口（可选，目标为任意存活角色，含自己与敌方）。
 * 判定由被指定的角色承担（可被鬼才/缓释/鬼道改判，并按该角色触发天妒）。
 */
function maybeTriggerLeiji(state: GameState, general: GeneralInstance): void {
    if (!general.alive) return
    if (!hasSkill(general, 'zhangjiao_leiji')) return
    // 没有牌可判定时不开窗口，避免卡住 pending
    if (state.deck.length === 0) return
    const selfIdx = state.generals.indexOf(general)
    const candidateIndices = state.generals
        .map((g, idx) => ({ g, idx }))
        .filter(({ g, idx }) => g.alive && idx !== selfIdx)
        .map(({ idx }) => idx)
    if (candidateIndices.length === 0) return

    state.pendingResponseQueue.unshift({
        type: ResponseType.SKILL_LEIJI_TARGET,
        targetGeneralIndex: selfIdx,
        context: {
            skillId: 'zhangjiao_leiji',
            skillName: '雷击',
            description: '令一名其他角色判定：♠则你对其造成2点雷电伤害；♣则你回复1点体力并对其造成1点雷电伤害',
            candidateIndices,
        },
    })
    addLog(state, `【${getGeneralName(general)}】可发动【雷击】，令一名其他角色判定`)
}

// ─────────────────────────────────────────────────────────────
// 明哲（诸葛瑾）辅助：非自己回合使用/打出红色牌时摸1牌
// ─────────────────────────────────────────────────────────────

function checkMingzhe(state: GameState, general: GeneralInstance, card: Card): void {
    if (!hasSkill(general, 'zhugejin_mingzhe')) return
    // 必须非自己回合
    const activeGeneral = getActiveGeneral(state)
    if (activeGeneral === general) return
    // 红色牌
    if (card.suit === CardSuit.HEART || card.suit === CardSuit.DIAMOND) {
        const drawn = drawCards(state, 1)
        general.hand.push(...drawn)
        addLog(state, `【${getGeneralName(general)}】发动【明哲】摸1张牌`)
    }
}

function equipmentCount(general: GeneralInstance): number {
    return (['weapon', 'armor', 'plus_horse', 'minus_horse'] as const)
        .filter(s => general.equip[s]).length
}

/** 飞军（王平）结算：令目标交一张手牌，或弃置其一张装备牌 */
function applyFeijun(
    state: GameState,
    user: GeneralInstance | undefined,
    target: GeneralInstance | undefined,
    option: 'give' | 'equip',
): void {
    if (!user || !target || !target.alive) return
    let executed = false
    if (option === 'give') {
        if (target.hand.length > 0) {
            const gift = [...target.hand].sort((a, b) => a.value - b.value)[0]
            const idx = target.hand.indexOf(gift)
            if (idx >= 0) target.hand.splice(idx, 1)
            user.hand.push(gift)
            addLog(state, `【${getGeneralName(target)}】交给【${getGeneralName(user)}】一张手牌（飞军）`)
            executed = true
        }
    } else {
        const slot = (['weapon', 'armor', 'plus_horse', 'minus_horse'] as const).find(s => target.equip[s])
        if (slot) {
            const card = target.equip[slot]!
            clearEquipSlot(state, target, slot)
            state.discard.push(card)
            triggerXiaoji(state, target)
            addLog(state, `【${getGeneralName(target)}】弃置装备【${cardFullName(card)}】（飞军）`)
            executed = true
        }
    }
    if (!executed) return
    if (hasSkill(user, 'wangping_binglue')
        && !(user.feijunTargets ?? []).includes(state.generals.indexOf(target))) {
        user.feijunTargets = [...(user.feijunTargets ?? []), state.generals.indexOf(target)]
        const bonus = drawCards(state, 2)
        user.hand.push(...bonus)
        addLog(state, `【${getGeneralName(user)}】发动【兵略】，摸两张牌`)
    }
}

// ─────────────────────────────────────────────────────────────
// 枭姬（孙尚香）：失去装备区牌时摸2张；他人回合改为询问
// ─────────────────────────────────────────────────────────────
function triggerXiaoji(state: GameState, general: GeneralInstance): void {
    const isJieXiaoji = hasSkill(general, 'sunshangxiang_jie_xiaoji')
    if (!hasSkill(general, 'sunshangxiang_xiaoji') && !isJieXiaoji) return
    if (!general.alive) return
    if (state.deck.length === 0) return
    const skillId = isJieXiaoji ? 'sunshangxiang_jie_xiaoji' : 'sunshangxiang_xiaoji'
    if (!isJieXiaoji && state.activeGeneralIndex === state.generals.indexOf(general)) {
        const bonus = drawCards(state, 2)
        general.hand.push(...bonus)
        addLog(state, `【${getGeneralName(general)}】发动【枭姬】摸 ${bonus.length} 张牌`)
        return
    }
    state.pendingResponseQueue.push({
        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
        targetGeneralIndex: state.generals.indexOf(general),
        context: {
            skillId,
            skillName: '枭姬',
            description: isJieXiaoji
                ? '你失去了装备区里的一张牌，是否摸两张牌？'
                : '失去装备区里的牌，摸两张牌',
        },
    })
}

// ─────────────────────────────────────────────────────────────
// 新武将技能工具（陈宫 / 沮授 / 伏完）
// ─────────────────────────────────────────────────────────────

/**
 * 智迟（陈宫）：回合外受到伤害后，本回合【杀】和普通锦囊牌对其无效
 * 免疫标识记录“受伤时的回合”（当时行动武将下标），当前回合一致才生效
 */
function isZhichiImmune(state: GameState, target: GeneralInstance): boolean {
    if (!hasSkill(target, 'chengong_zhichi')) return false
    if (target.zhichiImmuneTurn === undefined) return false
    return target.zhichiImmuneTurn === state.activeGeneralIndex
}

/**
 * 渐营（沮授）：出牌阶段内使用与上一张花色或点数相同的牌时可以摸一张牌
 * 上一张使用的牌记录在 lastUsedCard
 */
function triggerJianying(state: GameState, general: GeneralInstance, card: Card): void {
    if (!hasSkill(general, 'jushou_jianying')) return
    const prev = general.lastUsedCard
    general.lastUsedCard = { suit: card.suit, value: card.value }
    if (!prev) return
    const sameSuit = prev.suit === card.suit
    const sameValue = prev.value === card.value
    if (!sameSuit && !sameValue) return
    const reason = sameSuit && sameValue ? '花色与点数' : sameSuit ? '花色' : '点数'
    state.pendingResponseQueue.push({
        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
        targetGeneralIndex: state.generals.indexOf(general),
        context: {
            skillId: 'jushou_jianying',
            skillName: '渐营',
            description: `与上一张${reason}相同，是否摸一张牌`,
        },
    })
}

/**
 * 矢北（沮授）：锁定技，受到伤害后 —— 本回合第一次受伤回复1点体力，否则失去1点体力
 * 必须在 damageTakenThisTurn 累加之前判定（由 dealDamage 调用）
 */
function triggerShibei(state: GameState, target: GeneralInstance): void {
    const firstDamage = !target.damageTakenThisTurn
    if (firstDamage) {
        if (target.hp < target.maxHp) {
            target.hp += 1
            addLog(state, `【${getGeneralName(target)}】发动【矢北】，回复1点体力至 ${target.hp}/${target.maxHp}`)
        } else {
            addLog(state, `【${getGeneralName(target)}】【矢北】已满体力，未回复`)
        }
    } else {
        addLog(state, `【${getGeneralName(target)}】发动【矢北】，本回合非首次受伤，失去1点体力`)
        loseHp(state, target, 1)
    }
}

// ─────────────────────────────────────────────────────────────
// 平衡版新武将：被动技能工具
// ─────────────────────────────────────────────────────────────

/** 奇制（王基）：使用非装备牌指定目标后，弃非目标角色一张牌，然后其摸一张牌 */
function triggerQizhi(
    state: GameState,
    user: GeneralInstance,
    card: Card,
    targets: GeneralInstance[],
): void {
    if (!hasSkill(user, 'wangji_qizhi')) return
    if (state.activeGeneralIndex !== state.generals.indexOf(user)) return
    if (card.category === CardCategory.EQUIPMENT) return
    const candidates = state.generals
        .map((g, idx) => ({ g, idx }))
        .filter(({ g }) => g.alive && g !== user && !targets.includes(g) &&
            (g.hand.length > 0 || Object.values(g.equip).some(Boolean)))
        .map(({ idx }) => idx)
    if (candidates.length === 0) return
    state.pendingResponseQueue.unshift({
        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
        targetGeneralIndex: state.generals.indexOf(user),
        context: {
            skillId: 'wangji_qizhi',
            skillName: '奇制',
            description: '弃置一名非目标角色的一张牌，然后其摸一张牌',
            qizhiCandidates: candidates,
        },
    })
    addLog(state, `【${getGeneralName(user)}】可发动【奇制】`)
}

/** 征荣（毌丘俭）：使用伤害牌指定目标后，可将一名手牌数不小于自己的目标的一张牌置于武将牌上 */
function triggerZhengrong(
    state: GameState,
    user: GeneralInstance,
    card: Card,
    targets: GeneralInstance[],
): void {
    if (!user.alive || !hasSkill(user, 'guanqiujian_zhengrong')) return
    if (!isDamageCard(card)) return
    const candidates = targets
        .filter(t => t.alive && t !== user && t.hand.length >= user.hand.length && t.hand.length > 0)
        .map(t => state.generals.indexOf(t))
    if (candidates.length === 0) return
    state.pendingResponseQueue.push({
        type: ResponseType.SKILL_CHOOSE_TARGET,
        targetGeneralIndex: state.generals.indexOf(user),
        context: {
            skillId: 'guanqiujian_zhengrong',
            skillName: '征荣',
            description: '将一名手牌数不小于你的目标角色的一张牌置于你的武将牌上，称为“荣”',
            candidateIndices: candidates,
        },
    })
    addLog(state, `【${getGeneralName(user)}】可发动【征荣】`)
}

/** 鸿举（毌丘俭觉醒技）：用选定手牌替换等量“荣”，然后减1点体力上限并获得【清侧】 */
function finishHongju(state: GameState, general: GeneralInstance, handIds: string[]): void {
    const pile = general.generalPile ?? (general.generalPile = [])
    const moved: Card[] = []
    for (const id of handIds) {
        const idx = general.hand.findIndex(c => c.id === id)
        if (idx >= 0) moved.push(general.hand.splice(idx, 1)[0])
    }
    const takeCount = Math.min(moved.length, pile.length)
    const taken = pile.splice(0, takeCount)
    general.hand.push(...taken)
    pile.push(...moved)
    general.awakened = true
    general.maxHp -= 1
    if (general.hp > general.maxHp) general.hp = general.maxHp
    if (!general.acquiredSkills.includes('guanqiujian_qingce')) general.acquiredSkills.push('guanqiujian_qingce')
    addLog(state, `【${getGeneralName(general)}】发动【鸿举】觉醒！替换${takeCount}张“荣”，减1点体力上限并获得【清侧】`)
}

/** 良助（SP孙尚香）：一名角色于其出牌阶段回复体力后，可选择摸1或令其摸2 */
function triggerLiangzhu(state: GameState, healer: GeneralInstance): void {
    if (state.turnPhase !== TurnPhase.ACTION) return
    if (state.activeGeneralIndex !== state.generals.indexOf(healer)) return
    for (const sp of state.generals) {
        if (!sp.alive) continue
        if (!hasSkill(sp, 'sp_sunshangxiang_liangzhu')) continue
        // 回复体力的就是 SP 孙尚香本人时同样发动，此时两项都是给自己摸牌
        const selfHeal = sp === healer
        const healerName = getGeneralName(healer)
        state.pendingResponseQueue.push({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(sp),
            context: {
                skillId: 'sp_sunshangxiang_liangzhu',
                skillName: '良助',
                description: selfHeal
                    ? '选择一项：摸一张牌，或摸两张牌'
                    : `选择一项：自己摸一张牌，或令【${healerName}】摸两张牌`,
                healerIndex: state.generals.indexOf(healer),
                options: [
                    { action: 'self', label: selfHeal ? '摸一张牌' : '自己摸一张牌' },
                    { action: 'target', label: selfHeal ? '摸两张牌' : `令【${healerName}】摸两张牌` },
                ],
            },
        })
        addLog(state, `【${getGeneralName(sp)}】可发动【良助】`)
    }
}

/**
 * 屯田（界邓艾）：回合外失去牌后，或回合内弃置【杀】后判定，
 * 非♥则将判定牌置于武将牌上（“田”）
 * @param activeIdx 失去牌时的回合角色下标：动作跨越回合切换（弃牌阶段弃完直接进入下一回合）时，
 *                  必须用动作开始时的行动者判断“回合内/回合外”，不能用此刻的行动者
 */
export function checkTuntian(
    state: GameState,
    general: GeneralInstance,
    discardedCard?: Card,
    activeIdx: number = state.activeGeneralIndex,
): void {
    if (!general.alive || !hasSkill(general, 'dengai_tuntian')) return
    const guardIdx = state.generals.indexOf(general)
    // 回合内只有弃置【杀】才触发；回合外任意失去牌都触发
    if (activeIdx === guardIdx && !(discardedCard && isSlashLikeCard(discardedCard))) return
    if (state.deck.length === 0) return
    // 同一次失去牌可能同时被直接调用和差集检测命中，已在队列中就不再重复询问
    if (state.pendingResponseQueue.some(p => (p.context as any)?.skillId === 'dengai_tuntian'
        && p.targetGeneralIndex === guardIdx)) return
    state.pendingResponseQueue.push({
        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
        targetGeneralIndex: state.generals.indexOf(general),
        context: {
            skillId: 'dengai_tuntian',
            skillName: '屯田',
            description: '进行判定，若结果不为♥，将判定牌置于武将牌上（田）',
        },
    })
}

/** 屯田判定结算 */
function resolveTuntian(state: GameState, general: GeneralInstance): void {
    if (!general.alive || !ensureDeck(state)) return
    const judgeCard = state.deck.shift()!
    state.discard.push(judgeCard)
    if (judgeCard.suit !== CardSuit.HEART) {
        const idx = state.discard.indexOf(judgeCard)
        if (idx >= 0) state.discard.splice(idx, 1)
        general.generalPile!.push(judgeCard)
        triggerLiangyin(state, 'out')
        addLog(state, `【${getGeneralName(general)}】发动【屯田】，判定${cardFullName(judgeCard)}，获得一张“田”`)
    } else {
        addLog(state, `【${getGeneralName(general)}】【屯田】判定♥，未获得“田”`)
    }
}

const tuntianBaseline = new WeakMap<GameState, Map<number, Set<string>>>()

/** 手牌+装备区的牌 id 集合（用来判断“失去牌”） */
function cardAreaIds(general: GeneralInstance): Set<string> {
    const ids = new Set<string>(general.hand.map(c => c.id))
    for (const slot of Object.values(EquipSlot)) {
        const c = general.equip[slot]
        if (c) ids.add(c.id)
    }
    return ids
}

/**
 * 屯田（邓艾）的“回合外失去牌”统一检测。
 * 引擎里有上百处直接搬运手牌/装备的代码（使用、打出、被弃置、被拿走……），
 * 逐个挂钩容易漏，这里用动作前后的牌区差集判定。
 * @param activeIdx 这些失去牌发生在谁的回合：默认取当前行动者，由动作包装函数传入动作开始时的行动者，
 *                  否则“弃牌阶段弃牌后直接切换回合”会被误判成回合外失去牌
 */
export function syncCardLosses(state: GameState, activeIdx: number = state.activeGeneralIndex): void {
    const prev = tuntianBaseline.get(state)
    const cur = new Map<number, Set<string>>()
    state.generals.forEach((g, i) => {
        if (hasSkill(g, 'dengai_tuntian')) cur.set(i, cardAreaIds(g))
    })
    tuntianBaseline.set(state, cur)
    if (!prev) return
    for (const [idx, ids] of cur) {
        const before = prev.get(idx)
        if (!before) continue
        let lost = false
        for (const id of before) {
            if (!ids.has(id)) { lost = true; break }
        }
        if (lost) checkTuntian(state, state.generals[idx], undefined, activeIdx)
    }
}

const pileBaseline = new WeakMap<GameState, Set<string>>()

/**
 * 良姻（周妃）的“武将牌上的牌”变化检测：
 * 有牌被置于武将牌上（移出游戏）→ ①；有牌从武将牌上进入手牌区 → ②。
 * 屯田/陷嗣/屯田/醇醪/推锋/珠/荣/权 等所有标记牌都走这里，避免逐个技能漏挂。
 */
function syncPileChanges(state: GameState): void {
    const prev = pileBaseline.get(state)
    const cur = new Set<string>()
    for (const g of state.generals) {
        for (const c of g.generalPile ?? []) cur.add(c.id)
    }
    pileBaseline.set(state, cur)
    if (!prev) return
    let movedOut = false
    let returned = false
    for (const id of cur) {
        if (!prev.has(id)) { movedOut = true; break }
    }
    for (const id of prev) {
        if (cur.has(id)) continue
        if (state.generals.some(g => g.hand.some(c => c.id === id))) {
            returned = true
            break
        }
    }
    if (movedOut) triggerLiangyin(state, 'out')
    if (returned) triggerLiangyin(state, 'in')
}

/** 所有需要“牌区变化”检测的入口统一调用 */
export function syncCardState(state: GameState, activeIdx: number = state.activeGeneralIndex): void {
    syncCardLosses(state, activeIdx)
    syncPileChanges(state)
}

/** 连营（界陆逊）：失去最后的手牌后，可摸一张牌 */
function triggerLianying(state: GameState, general: GeneralInstance): void {
    if (!general.alive || general.hand.length > 0) return
    if (!hasSkill(general, 'luxun_jie_lianying')) return
    if (state.deck.length === 0) return
    state.pendingResponseQueue.push({
        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
        targetGeneralIndex: state.generals.indexOf(general),
        context: {
            skillId: 'luxun_jie_lianying',
            skillName: '连营',
            description: '你失去了最后的手牌，摸一张牌',
        },
    })
    addLog(state, `【${getGeneralName(general)}】可发动【连营】`)
}

/** 点虎（黄权）：点虎目标回复体力后，黄权摸一张牌 */
function triggerDianhuRecover(state: GameState, healed: GeneralInstance): void {
    const idx = state.generals.indexOf(healed)
    if (idx < 0) return
    for (const g of state.generals) {
        if (!g.alive || g === healed) continue
        if (hasSkill(g, 'huangquan_dianhu') && g.dianhuTargetIndex === idx) {
            const drawn = drawCards(state, 1)
            g.hand.push(...drawn)
            addLog(state, `【${getGeneralName(g)}】因【${getGeneralName(healed)}】回复体力，发动【点虎】摸一张牌`)
        }
    }
}

/** 谏计（黄权）：目标获得牌后，若可立即使用则自动使用（桃/装备/无中生有） */
function tryFreeUse(state: GameState, general: GeneralInstance, card: Card): boolean {
    const idx = general.hand.findIndex(c => c.id === card.id)
    if (idx < 0) return false
    if (card.category === CardCategory.EQUIPMENT) {
        return handleEquipCard(state, general, card, idx) === undefined
    }
    if (card.name === BasicCardName.PEACH) {
        if (general.hp >= general.maxHp) return false
        general.hand.splice(idx, 1)
        state.discard.push(card)
        general.hp++
        triggerDianhuRecover(state, general)
        return true
    }
    if (card.name === TrickCardName.DRAW_TWO) {
        general.hand.splice(idx, 1)
        state.discard.push(card)
        const drawn = drawCards(state, 2)
        general.hand.push(...drawn)
        return true
    }
    return false
}

/** 谦逊（界陆逊）：成为唯一目标的普通锦囊时，可选择将所有手牌置于武将牌上 */
function maybeQianxun(state: GameState, target: GeneralInstance): void {
    if (!hasSkill(target, 'luxun_jie_qianxun')) return
    if (target.hand.length === 0) return
    state.pendingResponseQueue.push({
        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
        targetGeneralIndex: state.generals.indexOf(target),
        context: {
            skillId: 'luxun_jie_qianxun',
            skillName: '谦逊',
            description: '将所有手牌置于武将牌上，于当前回合结束时获得',
        },
    })
    addLog(state, `【${getGeneralName(target)}】可发动【谦逊】`)
}

/** 谦雅（孙乾）：成为锦囊牌目标后，可将任意张手牌交给一名其他角色 */
function maybeQianya(state: GameState, target: GeneralInstance): void {
    if (!hasSkill(target, 'sunqian_qianya')) return
    if (target.hand.length === 0) return
    const candidates = state.generals
        .map((g, idx) => ({ g, idx }))
        .filter(({ g }) => g.alive && g !== target)
        .map(({ idx }) => idx)
    if (candidates.length === 0) return
    // 谦雅在锦囊结算之前询问，必须插到队首，否则拆牌/顺牌的选牌先结算
    state.pendingResponseQueue.unshift({
        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
        targetGeneralIndex: state.generals.indexOf(target),
        context: {
            skillId: 'sunqian_qianya',
            skillName: '谦雅',
            description: '将任意张手牌交给一名其他角色',
            candidateIndices: candidates,
        },
    })
    addLog(state, `【${getGeneralName(target)}】可发动【谦雅】`)
}

// ─────────────────────────────────────────────────────────────
// 手牌/装备通用操作工具
// ─────────────────────────────────────────────────────────────

/**
 * 从手牌或装备区查找一张牌（不移除）
 * @returns 找到的 Card，或 undefined
 */
function findCardInHandOrEquip(general: GeneralInstance, cardId: string): Card | undefined {
    const hand = general.hand.find(c => c.id === cardId)
    if (hand) return hand
    for (const slot of Object.values(EquipSlot)) {
        if (general.equip[slot]?.id === cardId) return general.equip[slot]!
    }
    return undefined
}

/** 在全场（弃牌堆/手牌/装备区）查找一张牌，用于回溯伤害来源的牌面花色 */
function findCardAnywhere(state: GameState, cardId: string): Card | undefined {
    const inDiscard = state.discard.find(c => c.id === cardId)
    if (inDiscard) return inDiscard
    for (const general of state.generals) {
        const found = findCardInHandOrEquip(general, cardId)
        if (found) return found
    }
    return undefined
}

/** 失去装备区的牌：清空装备栏，并在【白银狮子】离场时回复1点体力 */
function clearEquipSlot(
    state: GameState,
    owner: GeneralInstance,
    slotName: string,
): Card | undefined {
    const slot = slotName as keyof GeneralInstance['equip']
    const card = owner.equip[slot]
    if (!card) return undefined
    owner.equip[slot] = undefined as any
    if (card.name === EquipmentCardName.SILVER_LION && owner.alive && owner.hp < owner.maxHp) {
        owner.hp += 1
        addLog(state, `【${getGeneralName(owner)}】失去【白银狮子】，回复1点体力`)
    }
    return card
}

/**
 * 从手牌或装备区移除一张牌并放入弃牌堆（自动触发枭姬）
 * @returns 被移除的 Card，或 { error } 如果找不到
 */
function removeCardFromHandOrEquip(
    state: GameState,
    general: GeneralInstance,
    cardId: string,
): Card | { error: string } {
    general.lostCardTurn = state.turnSerial
    const handIdx = general.hand.findIndex(c => c.id === cardId)
    if (handIdx >= 0) {
        const card = general.hand.splice(handIdx, 1)[0]
        state.discard.push(card)
        maybeChunlaoPickup(state, general, [card])
        checkMingzhe(state, general, card)
        checkTuntian(state, general)
        triggerLianying(state, general)
        triggerJiangJieDiscard(state, [card])
        maybeZongxuan(state, general, [card])
        return card
    }
    for (const slot of Object.values(EquipSlot)) {
        if (general.equip[slot]?.id === cardId) {
            // 奇才②（界黄月英）：其他角色弃置你装备区里的防具牌时，取消之
            if (slot === EquipSlot.ARMOR && hasSkill(general, 'huangyueying_qicai')
                && general.generalId === 'huangyueying_jie'
                && state.generals[state.activeGeneralIndex] !== general) {
                addLog(state, `【${getGeneralName(general)}】【奇才】取消了防具的弃置`)
                return { error: '【奇才】取消了防具的弃置' }
            }
            const card = general.equip[slot]!
            clearEquipSlot(state, general, slot)
            state.discard.push(card)
            maybeChunlaoPickup(state, general, [card])
            triggerXiaoji(state, general)
            checkMingzhe(state, general, card)
            checkTuntian(state, general)
            triggerJiangJieDiscard(state, [card])
            maybeZongxuan(state, general, [card])
            return card
        }
    }
    return { error: '找不到该牌' }
}

/**
 * 从手牌或装备区移除一张牌但不放入弃牌堆（用于国色/断粮等放入判定区的场景）
 * 仍然触发枭姬
 */
function detachCardFromHandOrEquip(
    state: GameState,
    general: GeneralInstance,
    cardId: string,
): Card | { error: string } {
    general.lostCardTurn = state.turnSerial
    const handIdx = general.hand.findIndex(c => c.id === cardId)
    if (handIdx >= 0) {
        const card = general.hand.splice(handIdx, 1)[0]
        checkTuntian(state, general)
        triggerLianying(state, general)
        return card
    }
    for (const slot of Object.values(EquipSlot)) {
        if (general.equip[slot]?.id === cardId) {
            // 奇才②（界黄月英）：其他角色弃置你装备区里的防具牌时，取消之
            if (slot === EquipSlot.ARMOR && hasSkill(general, 'huangyueying_qicai')
                && general.generalId === 'huangyueying_jie'
                && state.generals[state.activeGeneralIndex] !== general) {
                addLog(state, `【${getGeneralName(general)}】【奇才】取消了防具的弃置`)
                return { error: '【奇才】取消了防具的弃置' }
            }
            const card = general.equip[slot]!
            clearEquipSlot(state, general, slot)
            triggerXiaoji(state, general)
            checkTuntian(state, general)
            return card
        }
    }
    return { error: '找不到该牌' }
}

// ─────────────────────────────────────────────────────────────
// 洛书版新增技能辅助
// ─────────────────────────────────────────────────────────────

/** 寸目（许攸）：摸牌改为从牌堆底摸 */
function drawForGeneral(state: GameState, general: GeneralInstance, count: number): Card[] {
    let drawn: Card[]
    if (!hasSkill(general, 'xuyou_cunmu')) {
        drawn = drawCards(state, count)
    } else {
        drawn = []
        for (let i = 0; i < count; i++) {
            if (state.deck.length === 0) break
            drawn.push(state.deck.pop()!)
        }
    }
    if (drawn.length > 0) triggerQingjian(state, general)
    return drawn
}

/** 目标区域（手牌 / 装备区 / 判定区）里是否有牌 */
function hasCardInArea(general: GeneralInstance): boolean {
    return general.hand.length > 0
        || Object.values(general.equip).some(Boolean)
        || general.judgeZone.length > 0
}

/** 随机获得目标区域里的一张牌（制蛮 / 恩怨 / 邀名等） */
function gainRandomCardFrom(
    state: GameState,
    picker: GeneralInstance,
    victim: GeneralInstance,
): Card | undefined {
    const options: { card: Card; take: () => void }[] = []
    for (const card of victim.hand) {
        options.push({ card, take: () => { const i = victim.hand.indexOf(card); if (i >= 0) victim.hand.splice(i, 1) } })
    }
    for (const slot of Object.values(EquipSlot)) {
        const card = victim.equip[slot]
        if (!card) continue
        options.push({ card, take: () => { clearEquipSlot(state, victim, slot); triggerXiaoji(state, victim) } })
    }
    if (victim.judgeZone.length > 0) {
        const card = victim.judgeZone[victim.judgeZone.length - 1]
        options.push({ card, take: () => { victim.judgeZone.splice(victim.judgeZone.lastIndexOf(card), 1) } })
    }
    if (options.length === 0) return undefined
    const pick = options[randomInt(options.length)]
    pick.take()
    checkTuntian(state, victim)
    picker.hand.push(pick.card)
    return pick.card
}

/** 弃置目标手牌里的一张（随机），用于弓骑等 */
function discardRandomHandCardOf(state: GameState, picker: GeneralInstance, victim: GeneralInstance): Card | undefined {
    if (victim.hand.length === 0) return undefined
    const card = victim.hand.splice(randomInt(victim.hand.length), 1)[0]
    state.discard.push(card)
    maybeChunlaoPickup(state, victim, [card])
    addLog(state, `【${getGeneralName(picker)}】弃置了【${getGeneralName(victim)}】的一张手牌${cardFullName(card)}`)
    checkMingzhe(state, victim, card)
    checkTuntian(state, victim)
    return card
}

/** 距离最近的其余角色下标（矫诏用） */
function nearestOtherIndexes(state: GameState, general: GeneralInstance): number[] {
    const candidates = state.generals
        .map((g, idx) => ({ g, idx }))
        .filter(({ g }) => g.alive && g !== general)
    if (candidates.length === 0) return []
    const dist = (g: GeneralInstance) => getAttackRange(general, g, state.generals).distance
    const min = Math.min(...candidates.map(({ g }) => dist(g)))
    return candidates.filter(({ g }) => dist(g) === min).map(({ idx }) => idx)
}

/** 某个角色是否在另一角色的攻击范围内 */
function inAttackRangeOf(source: GeneralInstance, target: GeneralInstance, state: GameState): boolean {
    return getAttackRange(source, target, state.generals).inRange
}

/**
 * 距离不足的提示：把距离拆成“基础 + 各项修正”，
 * 玩家能直接看出 -1 马生效了多少、又是哪一项把距离加了回来。
 */
function distanceTooFarText(
    name: string,
    info: { distance: number; baseDistance: number; range: number; modifiers?: { label: string; value: number }[] },
): string {
    const mods = info.modifiers ?? []
    const detail = mods.length > 0
        ? `基础${info.baseDistance}，${mods.map(m => `${m.label}${m.value > 0 ? '+' : ''}${m.value}`).join('，')}`
        : `基础${info.baseDistance}`
    return `【${name}】距离太远（距离${info.distance}（${detail}），攻击范围${info.range}）`
}

// ─────────────────────────────────────────────────────────────
// 伤害处理
// ─────────────────────────────────────────────────────────────

/**
 * 失去体力（非伤害）：无来源，不触发被动技能（反馈/遗计/刚烈/奸雄等），
 * 但仍需检查濒死。例：苦肉、救主、乱武放弃等
 */
export function loseHp(state: GameState, target: GeneralInstance, amount: number): void {
    if (!target.alive) return
    target.hp -= amount
    addLog(state, `【${getGeneralName(target)}】失去${amount}点体力，剩余 ${Math.max(0, target.hp)}/${target.maxHp}`)
    triggerZhaxiang(state, target)
    if (target.hp <= 0) {
        triggerJuejing(state, target, 'enter')
        enterDyingState(state, null, target, undefined, 1, false)
    }
}

/**
 * 诈降（界黄盖）：锁定技，失去1点体力后摸三张牌；
 * 若此时在其出牌阶段，本阶段红色【杀】无距离限制、不能被【闪】响应，使用【杀】次数上限+1
 */
function triggerZhaxiang(state: GameState, target: GeneralInstance): void {
    if (!hasSkill(target, 'huanggai_zhaxiang')) return
    const idx = state.generals.indexOf(target)
    if (state.turnPhase === TurnPhase.ACTION && state.activeGeneralIndex === idx) {
        target.extraSlashCount = (target.extraSlashCount ?? 0) + 1
        target.slashRedRangeTurn = true
        target.slashUnavoidableTurn = true
        addLog(state, `【${getGeneralName(target)}】【诈降】本阶段使用红色【杀】无距离限制且不能被【闪】响应，使用【杀】的次数上限+1`)
    }
    if (target.hp > 0) {
        const drawn = drawCards(state, 3)
        target.hand.push(...drawn)
        addLog(state, `【${getGeneralName(target)}】【诈降】摸了${drawn.length}张牌`)
        return
    }
    // 濒死优先结算，摸牌排在其后
    state.pendingResponseQueue.push({
        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
        targetGeneralIndex: idx,
        context: {
            skillId: 'huanggai_zhaxiang_draw',
            skillName: '诈降（摸牌）',
            description: '诈降结算：摸3张牌',
            autoExecute: true,
        },
    })
}

/** 依据【杀】的牌面生成伤害参数（属性杀性质 / 藤甲 / 青釭剑） */
function slashDamageOpts(attacker: GeneralInstance | null, attackCard?: Card): {
    nature: 'normal' | 'fire' | 'thunder'
    fromSlash: boolean
    ignoresArmor: boolean
} {
    const nature = attackCard?.name === BasicCardName.FIRE_SLASH ? 'fire'
        : attackCard?.name === BasicCardName.THUNDER_SLASH ? 'thunder'
            : 'normal'
    const ignoresArmor = attacker?.equip.weapon?.name === EquipmentCardName.QINGGANG_SWORD
    return { nature, fromSlash: true, ignoresArmor }
}

export function dealDamage(
    state: GameState,
    attacker: GeneralInstance | null,
    target: GeneralInstance,
    amount: number,
    /** 造成伤害的牌 ID（奸雄可获得此牌） */
    damageCardId?: string,
    opts?: {
        nature?: 'normal' | 'fire' | 'thunder'
        fromSlash?: boolean
        ignoresArmor?: boolean
        /** 天香放弃后再次结算时跳过防具修正（伤害值已修正过） */
        skipArmor?: boolean
        /** 天香放弃后再次结算时不再询问天香，避免无限循环 */
        skipTianxiang?: boolean
        /** 铁索传导出的伤害不再二次传导，避免链式重复结算 */
        chainTransmit?: boolean
        /** 制蛮（马谡）已放弃，避免重复询问 */
        skipZhiman?: boolean
        /** 倾袭（曹休）已结算，避免重复询问 */
        skipQingxi?: boolean
        /** 竭缘（灵雎）已结算，避免重复询问 */
        skipJieyuan?: boolean
        /** 竭缘放弃后继续结算时沿用的选项 */
        jieyuanResumeOpts?: Record<string, unknown>
    }
): void {
    if (!target.alive) return
    // 潜袭（界马岱）：使用其展示的牌造成的伤害+1
    if (attacker && damageCardId && attacker.qianxiCardId === damageCardId
        && attacker.qianxiTurn === state.turnSerial) {
        amount += 1
        addLog(state, `【${getGeneralName(attacker)}】【潜袭】使用展示的牌，伤害+1`)
    }
    const nature = opts?.nature ?? 'normal'

    // ── 公清（潘濬）：锁定技，伤害来源的攻击范围<3 则此伤害调整为1，>3 则+1
    if (amount > 0 && attacker && attacker !== target && attacker.alive
        && hasSkill(target, 'panjun_gongqing')) {
        const gqRange = expAttackRange(state, attacker)
        if (gqRange < 3 && amount !== 1) {
            addLog(state, `【${getGeneralName(target)}】【公清】伤害来源攻击范围${gqRange}，此伤害调整为1`)
            amount = 1
        } else if (gqRange > 3) {
            addLog(state, `【${getGeneralName(target)}】【公清】伤害来源攻击范围${gqRange}，此伤害+1`)
            amount += 1
        }
    }

    // ── 逆固（孙綝）：本回合下X次造成的伤害+1
    if (amount > 0 && attacker && attacker !== target && attacker.alive
        && (attacker.niguBonus ?? 0) > 0) {
        attacker.niguBonus = (attacker.niguBonus ?? 1) - 1
        amount += 1
        addLog(state, `【${getGeneralName(attacker)}】【逆固】此伤害+1`)
    }

    // ── 竭缘（灵雎）：造成/受到伤害时可弃牌修正伤害
    if (!opts?.skipJieyuan && amount > 0 && attacker && attacker !== target && attacker.alive) {
        const jyResume = { ...(opts ?? {}) } as Record<string, unknown>
        if (hasSkill(attacker, 'lingju_jieyuan') && target.hp >= attacker.hp
            && attacker.hand.some(c => c.suit === CardSuit.SPADE || c.suit === CardSuit.CLUB)) {
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(attacker),
                context: {
                    skillId: 'lingju_jieyuan_atk', skillName: '竭缘',
                    description: `弃置一张黑色手牌，令对【${getGeneralName(target)}】的伤害+1`,
                    jieyuanAttackerIndex: state.generals.indexOf(attacker),
                    jieyuanTargetIndex: state.generals.indexOf(target),
                    jieyuanAmount: amount, jieyuanCardId: damageCardId,
                    jieyuanResumeOpts: jyResume,
                },
            })
            addLog(state, `【${getGeneralName(attacker)}】可发动【竭缘】`)
            return
        }
        if (hasSkill(target, 'lingju_jieyuan') && attacker.hp >= target.hp
            && target.hand.some(c => c.suit === CardSuit.HEART || c.suit === CardSuit.DIAMOND)) {
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(target),
                context: {
                    skillId: 'lingju_jieyuan_def', skillName: '竭缘',
                    description: `弃置一张红色手牌，令受到的伤害-1`,
                    jieyuanAttackerIndex: state.generals.indexOf(attacker),
                    jieyuanTargetIndex: state.generals.indexOf(target),
                    jieyuanAmount: amount, jieyuanCardId: damageCardId,
                    jieyuanResumeOpts: jyResume,
                },
            })
            addLog(state, `【${getGeneralName(target)}】可发动【竭缘】`)
            return
        }
    }

    // ── 武烈（界孙坚）：有“烈”标记的角色受到伤害时，防止此伤害并移去1个“烈”
    if (amount > 0 && (target.lieMarks ?? 0) > 0) {
        target.lieMarks = (target.lieMarks ?? 1) - 1
        addLog(state, `【${getGeneralName(target)}】的“烈”防止了${amount}点伤害，移去1个“烈”`
            + `（剩余${target.lieMarks}）`)
        return
    }

    // ── 宽释（阚泽）：防止其下一次受到的大于1点的伤害
    if (amount > 1 && checkKuanshiPrevent(state, target, amount)) return

    // ── 绝情（界张春华）：锁定技，你即将造成的伤害视为失去体力
    // 失去体力没有属性与来源、不触发任何受伤类技能，濒死仍由 loseHp 正常处理
    if (amount > 0 && attacker && attacker !== target && attacker.alive
        && hasSkill(attacker, 'zhangchunhua_jueqing')) {
        addLog(state, `【${getGeneralName(attacker)}】发动【绝情】，对【${getGeneralName(target)}】的${amount}点伤害视为失去体力`)
        loseHp(state, target, amount)
        return
    }

    // ── 巧言（李肃）：锁定技，其他角色于你的回合外对你造成伤害时，
    //    若你有“珠”，则其获得“珠”，否则你防止此伤害，摸一张牌并将一张牌置于武将牌上称为“珠”
    if (amount > 0 && attacker && attacker !== target && attacker.alive
        && hasSkill(target, 'lisu_qiaoyan')
        && state.activeGeneralIndex !== state.generals.indexOf(target)) {
        const qyPearls = target.generalPile?.length ?? 0
        if (qyPearls > 0) {
            // “珠”是李肃武将牌上的那张牌：来源“获得珠”即把这张牌置入其手牌
            const pearl = target.generalPile!.pop()!
            attacker.hand.push(pearl)
            target.pearlMarks = Math.max(0, (target.pearlMarks ?? 1) - 1)
            attacker.pearlMarks = (attacker.pearlMarks ?? 0) + 1
            addLog(state, `【${getGeneralName(target)}】发动【巧言】，【${getGeneralName(attacker)}】获得其武将牌上的${cardFullName(pearl)}（“珠”）`)
        } else {
            const qyDrawn = drawForGeneral(state, target, 1)
            target.hand.push(...qyDrawn)
            target.pearlMarks = (target.pearlMarks ?? 0) + 1
            const qyCard = lowValueCard(target)
            if (qyCard) {
                const qyRemoved = detachCardFromHandOrEquip(state, target, qyCard.id)
                if (!('error' in qyRemoved)) {
                    target.generalPile = [...(target.generalPile ?? []), qyCard]
                }
            }
            addLog(state, `【${getGeneralName(target)}】发动【巧言】，防止此伤害，摸${qyDrawn.length}张牌并将一张牌置于武将牌上称为“珠”`)
            return
        }
    }

    // ── 制蛮（马谡）：对其他角色造成伤害时，可防止此伤害并获得其区域里的一张牌
    if (!opts?.skipZhiman && amount > 0 && attacker && attacker !== target && attacker.alive
        && hasSkill(attacker, 'masu_zhiman') && hasCardInArea(target)) {
        state.pendingResponseQueue.unshift({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(attacker),
            context: {
                skillId: 'masu_zhiman',
                skillName: '制蛮',
                description: `防止对【${getGeneralName(target)}】的伤害，然后获得其区域里的一张牌`,
                zhimanTargetIndex: state.generals.indexOf(target),
                zhimanAmount: amount,
                zhimanCardId: damageCardId,
                zhimanNature: nature,
                zhimanFromSlash: !!opts?.fromSlash,
                zhimanResumeOpts: { ...opts, skipZhiman: true },
            },
        })
        addLog(state, `【${getGeneralName(attacker)}】可发动【制蛮】`)
        return
    }

    // ── 倾袭（界曹休）：令目标弃置等同于攻击范围张牌或令伤害+1；
    //    装备区有武器牌时改为两项依次执行，然后弃置该武器牌
    if (!opts?.skipQingxi && amount > 0 && attacker && attacker !== target && attacker.alive
        && opts?.fromSlash && hasSkill(attacker, 'caoxiu_jie_qingxi')) {
        const jqHasWeapon = !!attacker.equip[EquipSlot.WEAPON]
        const jqRange = Math.max(1, attacker.equip[EquipSlot.WEAPON]?.attackRange ?? 1)
        const jqCount = Math.min(jqRange, target.hand.length)
        state.pendingResponseQueue.unshift({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(attacker),
            context: {
                skillId: 'caoxiu_jie_qingxi',
                skillName: '倾袭',
                description: jqHasWeapon
                    ? `令【${getGeneralName(target)}】弃置${jqCount}张牌并令此伤害+1，然后弃置你的武器牌`
                    : `选择一项：令【${getGeneralName(target)}】弃置${jqCount}张牌，或令此伤害+1`,
                options: jqHasWeapon
                    ? [{ action: 'both', label: `其弃置${jqCount}张牌、此伤害+1，然后弃置武器牌` }]
                    : [
                        { action: 'discard', label: `令其弃置${jqCount}张手牌` },
                        { action: 'damage', label: '令此伤害+1' },
                    ],
                qingxiJieAttackerIndex: state.generals.indexOf(attacker),
                qingxiJieTargetIndex: state.generals.indexOf(target),
                qingxiCount: jqCount,
                qingxiAmount: amount,
                qingxiCardId: damageCardId,
                qingxiNature: nature,
                qingxiResumeOpts: { ...opts, skipQingxi: true },
            },
        })
        addLog(state, `【${getGeneralName(attacker)}】可发动【倾袭】`)
        return
    }

    // ── 倾袭（曹休）：使用【杀】造成伤害时，可令目标弃牌并弃武器，或令伤害+1
    if (!opts?.skipQingxi && amount > 0 && attacker && attacker !== target && attacker.alive
        && opts?.fromSlash && hasSkill(attacker, 'caoxiu_qingxi')
        && attacker.equip.weapon && target.hand.length > 0) {
        const qingxiRange = Math.min(
            Math.max(1, attacker.equip.weapon.attackRange ?? 1),
            target.hand.length,
        )
        state.pendingResponseQueue.unshift({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(target),
            context: {
                skillId: 'caoxiu_qingxi',
                skillName: '倾袭',
                description: `弃置 ${qingxiRange} 张手牌（其弃置武器），或令此伤害+1`,
                options: [
                    { action: 'discard', label: `弃置 ${qingxiRange} 张手牌` },
                    { action: 'damage', label: '令伤害 +1' },
                ],
                qingxiAttackerIndex: state.generals.indexOf(attacker),
                qingxiCount: qingxiRange,
                qingxiAmount: amount,
                qingxiCardId: damageCardId,
                qingxiNature: nature,
                qingxiResumeOpts: { ...opts, skipQingxi: true },
            },
        })
        addLog(state, `【${getGeneralName(attacker)}】可发动【倾袭】`)
        return
    }

    // ── 怀橘（陆绩）：有“橘”的角色受到伤害时，防止此伤害并移去 1 个“橘”
    if (amount > 0 && (target.orangeMarks ?? 0) > 0) {
        target.orangeMarks = (target.orangeMarks ?? 1) - 1
        addLog(state, `【${getGeneralName(target)}】的“橘”防止了这次伤害（剩余 ${target.orangeMarks} 个）`)
        return
    }

    // ── 链祸（岑昏）：处于连环状态且为火焰伤害起点时，伤害+1
    if (nature === 'fire' && amount > 0 && target.chained && !opts?.chainTransmit
        && hasSkill(target, 'cenhun_lianhuo')) {
        amount += 1
        addLog(state, `【${getGeneralName(target)}】发动【链祸】，火焰伤害+1`)
    }

    // ── 骄恣（麹义）：锁定技，当你造成或受到伤害时，若你的手牌数为全场唯一最多，此伤害+1
    if (amount > 0 && attacker && attacker !== target && attacker.alive
        && hasSkill(attacker, 'quyi_jiaozi') && isUniqueHandMax(state, attacker)) {
        amount += 1
        addLog(state, `【${getGeneralName(attacker)}】发动【骄恣】，此伤害+1`)
    }
    if (amount > 0 && target.alive
        && hasSkill(target, 'quyi_jiaozi') && isUniqueHandMax(state, target)) {
        amount += 1
        addLog(state, `【${getGeneralName(target)}】发动【骄恣】，此伤害+1`)
    }

    // ── 防具伤害修正（青釭剑无视防具）
    if (!opts?.skipArmor && !opts?.ignoresArmor && target.equip.armor) {
        if (target.equip.armor.name === EquipmentCardName.VINE) {
            if (opts?.fromSlash && nature === 'normal') {
                addLog(state, `【${getGeneralName(target)}】的【藤甲】使普通【杀】无效`)
                return
            }
            if (nature === 'fire') {
                amount += 1
                addLog(state, `【${getGeneralName(target)}】的【藤甲】被火焰引燃，伤害+1`)
            }
        } else if (target.equip.armor.name === EquipmentCardName.SILVER_LION && amount > 1) {
            addLog(state, `【白银狮子】防止多余的伤害（${amount} → 1）`)
            amount = 1
        }
    }

    // ── 天香（小乔）：受伤前可弃红桃手牌转移伤害（红颜：♠也算♥）
    if (!opts?.skipTianxiang && hasSkill(target, 'xiaoqiao_tianxiang')) {
        const hasHeart = target.hand.some(c =>
            c.suit === CardSuit.HEART ||
            (c.suit === CardSuit.SPADE && hasSkill(target, 'xiaoqiao_hongyan'))
        )
        if (hasHeart) {
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(target),
                context: {
                    skillId: 'xiaoqiao_tianxiang',
                    skillName: '天香',
                    description: '弃1张♥手牌，将伤害转移给另一角色',
                    damageAmount: amount,
                    attackerIndex: attacker ? state.generals.indexOf(attacker) : -1,
                    damageCardId,
                },
            })
            return // 中断伤害，等待响应
        }
    }

    // ── 天香（洛书版小乔）：弃♥手牌防止伤害，再选转移目标与后续效果（红颜：♠也算♥）
    if (!opts?.skipTianxiang && hasSkill(target, 'xiaoqiao_tianxiang_luoshu')) {
        const hasHeart = target.hand.some(c =>
            c.suit === CardSuit.HEART ||
            (c.suit === CardSuit.SPADE && hasSkill(target, 'xiaoqiao_hongyan'))
        )
        if (hasHeart) {
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(target),
                context: {
                    skillId: 'xiaoqiao_tianxiang_luoshu',
                    skillName: '天香',
                    description: '弃1张♥手牌，防止此伤害并选择另一角色',
                    damageAmount: amount,
                    attackerIndex: attacker ? state.generals.indexOf(attacker) : -1,
                    damageCardId,
                },
            })
            return // 中断伤害，等待响应
        }
    }

    // ── 帷幕②（界贾诩）：你的回合内受到伤害时，防止此伤害并摸伤害值两倍的牌
    if (amount > 0 && !(opts as any)?.skipWeimu && hasSkill(target, 'jiaxu_weimu')
        && target.generalId === 'jiaxu_jie'
        && state.activeGeneralIndex === state.generals.indexOf(target)) {
        const wmCards = drawForGeneral(state, target, amount * 2)
        target.hand.push(...wmCards)
        addLog(state, `【${getGeneralName(target)}】发动【帷幕】，防止此伤害并摸${wmCards.length}张牌`)
        return
    }

    target.hp -= amount
    // 疠火（程普）：标记本次转化【杀】造成过伤害
    if (attacker && attacker.lihuoFirePhase) attacker.lihuoDamaged = true
    // 勇略（韩浩史涣）：视为使用的【杀】已造成伤害
    if (attacker && attacker.yonglueWatchIndex === state.generals.indexOf(target)) {
        attacker.yonglueWatchIndex = undefined
        attacker.yonglueTurn = undefined
    }
    // 奋迅（丁奉）：记录本回合已对其造成过伤害
    if (attacker && attacker.fenxunTargetIndex === state.generals.indexOf(target)) {
        attacker.fenxunDamagedTarget = true
    }
    // 镇胆②（闪赵云）：受到伤害后摸X张牌
    if (target.alive) triggerZhendanDraw(state, target)
    // 绝境（神赵云）：进入濒死状态时摸一张牌
    if (target.hp <= 0) triggerJuejing(state, target, 'enter')
    const atkName = attacker ? getGeneralName(attacker) : '效果'
    const tgtName = getGeneralName(target)
    addLog(state, `【${tgtName}】受到 ${amount} 点伤害，剩余 ${Math.max(0, target.hp)}/${target.maxHp}`)

    // 酒池（界董卓）：使用【酒】【杀】造成伤害后，本回合崩坏失效
    if (amount > 0 && attacker && hasSkill(attacker, 'dongzhuo_jiuchi') && opts?.fromSlash) {
        attacker.banghuaiDisabledTurn = state.turnSerial
        addLog(state, '【酒池】使本回合【崩坏】失效')
    }

    // ── 耀武（界华雄）：锁定技，受到牌造成的伤害时，红牌由伤害来源摸一张，否则自己摸一张
    if (amount > 0 && target.alive && damageCardId && hasSkill(target, 'huaxiong_yaowu')) {
        const srcCard = findCardAnywhere(state, damageCardId)
        const isRed = !!srcCard && (srcCard.suit === CardSuit.HEART || srcCard.suit === CardSuit.DIAMOND)
        const drawer = isRed ? attacker : target
        if (drawer && drawer.alive) {
            const bonus = drawCards(state, 1)
            drawer.hand.push(...bonus)
            addLog(state, `【${tgtName}】发动【耀武】，【${getGeneralName(drawer)}】摸一张牌`)
        }
    }

    // ── 狂骨（魏延）：对距离1以内的角色造成伤害后，回复1点体力或摸一张牌
    if (amount > 0 && attacker && attacker !== target && attacker.alive
        && hasSkill(attacker, 'weiyan_kuanggu')) {
        const dist = getAttackRange(attacker, target, state.generals).distance
        if (dist <= 1) {
            const times = Math.min(amount, 2)
            for (let ki = 0; ki < times; ki++) {
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_KUANGGU_CHOICE,
                    targetGeneralIndex: state.generals.indexOf(attacker),
                    context: { targetIndex: state.generals.indexOf(target) },
                })
            }
            addLog(state, `【${getGeneralName(attacker)}】可发动【狂骨】`)
        }
    }

    // ── 智迟（陈宫）：锁定技，回合外受到伤害后，本回合【杀】和普通锦囊牌对其无效
    // 濒死时仍应置位（结算顺序：伤害→濒死→智迟仍生效），故只要求“存活”而不要求“体力>0”
    const targetIdx = state.generals.indexOf(target)
    if (amount > 0 && target.alive && hasSkill(target, 'chengong_zhichi')
        && state.activeGeneralIndex !== targetIdx && state.activeGeneralIndex >= 0) {
        target.zhichiImmuneTurn = state.activeGeneralIndex
        addLog(state, `【${tgtName}】发动【智迟】，本回合【杀】和普通锦囊牌对其无效`)
    }

    // ── 洛书版扩展（二）：造成/受到伤害后的触发
    triggerExpansionDamageHooks(state, attacker, target, amount, damageCardId, nature, !!opts?.fromSlash)

    // ── 矢北（沮授）：锁定技，受伤后立即结算（本回合第一次受伤回1血，否则失1血）
    // 判据 damageTakenThisTurn 必须在结算之后累加，故此处先判断再累加
    // 若矢北的“失1点体力”使沮授进入濒死，loseHp 已自行入队濒死询问，
    // 需要标记以避免函数末尾重复入队（否则会出现两次濒死询问）
    let dyingHandledByShibei = false
    if (amount > 0 && target.alive && target.hp > 0 && hasSkill(target, 'jushou_shibei')) {
        triggerShibei(state, target)
        if (target.hp <= 0) dyingHandledByShibei = true
    }

    // ── 被动技能触发：受伤后（仅存活且未濒死时触发）

    if (target.alive && target.hp > 0) {
        // 奸雄（曹操）：受伤后可选择获得造成伤害的牌；界曹操额外摸一张
        if ((hasSkill(target, 'caocao_jianxiong') || hasSkill(target, 'caocao_jie_jianxiong'))
            && (damageCardId || hasSkill(target, 'caocao_jie_jianxiong'))
            && !isLimitedSkillSpent(target, 'caocao_jie_jianxiong')) {
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(target),
                context: {
                    skillId: 'caocao_jianxiong',
                    skillName: '奸雄',
                    description: hasSkill(target, 'caocao_jie_jianxiong')
                        ? '获得造成伤害的牌并摸一张牌'
                        : '获得造成伤害的牌',
                    damageCardId,
                },
            })
            addLog(state, `【${tgtName}】可发动【奸雄】`)
        }

        // 殚心（界郭皇后）
        triggerDanxin(state, target)

        // 反馈（司马懿）：每受1点伤害可发动一次
        if ((hasSkill(target, 'simayi_fankui') || hasSkill(target, 'simayi_jie_fankui')) && attacker) {
            const atkCards = attacker.hand.length
            const atkEquips = Object.values(attacker.equip).filter(Boolean).length
            if (atkCards + atkEquips > 0) {
                for (let fi = 0; fi < amount; fi++) {
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                        targetGeneralIndex: state.generals.indexOf(target),
                        context: {
                            skillId: 'simayi_fankui',
                            skillName: '反馈',
                            description: `获取【${getGeneralName(attacker)}】的一张牌（第${fi + 1}/${amount}次）`,
                            sourceGeneralIndex: state.generals.indexOf(attacker),
                        },
                    })
                }
                addLog(state, `【${tgtName}】可发动【反馈】（${amount}次）`)
            }
        }

        // 遗计（郭嘉 / 界郭嘉）：每受1点伤害可发动一次
        const yijiSkillId = hasSkill(target, 'guojia_jie_yiji') ? 'guojia_jie_yiji'
            : hasSkill(target, 'guojia_yiji') ? 'guojia_yiji' : undefined
        if (yijiSkillId && state.deck.length > 0) {
            for (let yi = 0; yi < amount; yi++) {
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                    targetGeneralIndex: state.generals.indexOf(target),
                    context: {
                        skillId: yijiSkillId,
                        skillName: '遗计',
                        description: `${yijiSkillId === 'guojia_jie_yiji' ? '摸两张牌并分配' : '观看牌堆顶2张牌并分配'}（第${yi + 1}/${amount}次）`,
                    },
                })
            }
            addLog(state, `【${tgtName}】可发动【遗计】（${amount}次）`)
        }

        // 刚烈（夏侯惇）：每受1点伤害可发动一次
        if (hasSkill(target, 'xiahoudun_ganglie') && attacker && state.deck.length > 0) {
            for (let gi = 0; gi < amount; gi++) {
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                    targetGeneralIndex: state.generals.indexOf(target),
                    context: {
                        skillId: 'xiahoudun_ganglie',
                        skillName: '刚烈',
                        description: `判定，非♥则来源弃2牌或受1伤（第${gi + 1}/${amount}次）`,
                        attackerGeneralIndex: state.generals.indexOf(attacker),
                    },
                })
            }
            addLog(state, `【${tgtName}】可发动【刚烈】（${amount}次）`)
        }

        // 刚烈（夏侯惇-竞）：受到伤害后，可令一名敌方角色判定
        if (hasSkill(target, 'xiahoudun_jing_ganglie') && state.deck.length > 0) {
            const enemyCount = state.generals.filter(
                g => g.alive && g.faction !== target.faction
            ).length
            if (enemyCount > 0) {
                for (let gi = 0; gi < amount; gi++) {
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                        targetGeneralIndex: state.generals.indexOf(target),
                        context: {
                            skillId: 'xiahoudun_jing_ganglie',
                            skillName: '刚烈',
                            description: `令一名敌方角色判定，非♥则其弃2张手牌或受1点伤害（第${gi + 1}/${amount}次）`,
                        },
                    })
                }
                addLog(state, `【${tgtName}】可发动【刚烈】（${amount}次）`)
            }
        }

        // 忘隙（界李典）：造成或受到1点伤害后，可摸两张牌并交给对方一张
        const wangxiOwner = attacker && attacker !== target
            ? (hasSkill(attacker, 'lidian_wangxi') ? attacker
                : (hasSkill(target, 'lidian_wangxi') ? target : undefined))
            : undefined
        if (wangxiOwner && attacker) {
            const other = wangxiOwner === attacker ? target : attacker
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(wangxiOwner),
                context: {
                    skillId: 'lidian_wangxi',
                    skillName: '忘隙',
                    description: '摸两张牌，然后交给其一张牌',
                    otherIndex: state.generals.indexOf(other),
                },
            })
            addLog(state, `【${getGeneralName(wangxiOwner)}】可发动【忘隙】`)
        }

        // 点虎（黄权）：你对点虎目标造成伤害后摸一张牌
        if (attacker && hasSkill(attacker, 'huangquan_dianhu')
            && attacker.dianhuTargetIndex === state.generals.indexOf(target)) {
            const dianhuDrawn = drawCards(state, 1)
            attacker.hand.push(...dianhuDrawn)
            addLog(state, `【${getGeneralName(attacker)}】发动【点虎】，摸一张牌`)
        }

        // 智愚（荀攸）：受伤后可摸一张牌，若手牌颜色均相同，伤害来源弃一张手牌
        if (hasSkill(target, 'xunyou_zhiyu')) {
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(target),
                context: {
                    skillId: 'xunyou_zhiyu',
                    skillName: '智愚',
                    description: '摸一张牌并展示手牌；若颜色均相同，伤害来源弃一张手牌',
                    attackerIndex: attacker ? state.generals.indexOf(attacker) : -1,
                },
            })
            addLog(state, `【${tgtName}】可发动【智愚】`)
        }

        // 推锋（李通）：受伤后可将一张牌置于武将牌上（“锋”）
        if (hasSkill(target, 'litong_tuifeng')
            && (target.hand.length > 0 || Object.values(target.equip).some(Boolean))) {
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(target),
                context: {
                    skillId: 'litong_tuifeng',
                    skillName: '推锋',
                    description: '将一张牌置于武将牌上，称为“锋”',
                },
            })
            addLog(state, `【${tgtName}】可发动【推锋】`)
        }

        // 引兵（祖茂）：受到【杀】或【决斗】伤害后，移去一张“引兵”牌
        if (hasSkill(target, 'zumao_yinbing') && opts?.fromSlash
            && (target.generalPile?.length ?? 0) > 0) {
            const removed = target.generalPile!.pop()!
            state.discard.push(removed)
            addLog(state, `【${tgtName}】移去一张“引兵”牌`)
        }
    }

    // ── 恩怨（法正）：受到1点伤害后，伤害来源选择交给其一张手牌或失去1点体力
    if (amount > 0 && target.alive && attacker && attacker !== target && attacker.alive
        && hasSkill(target, 'fazheng_enyuan') && attacker.hand.length > 0) {
        for (let ei = 0; ei < Math.min(amount, 3); ei++) {
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(attacker),
                context: {
                    skillId: 'fazheng_enyuan',
                    skillName: '恩怨',
                    description: `交给【${getGeneralName(target)}】一张手牌，否则失去1点体力`,
                    options: [
                        { action: 'give', label: '交给其一张手牌' },
                        { action: 'loseHp', label: '失去1点体力' },
                    ],
                    enyuanTargetIndex: state.generals.indexOf(target),
                },
            })
        }
    }

    // ══ 洛书版扩展（五）：造成/受到伤害后的触发 ══
    // 权计（界钟会）：造成或受到1点伤害后，摸一张牌并令当前回合角色将一张手牌置于其武将牌上
    if (amount > 0 && target.alive) {
        const quanjiOwners = [attacker, target].filter(
            (g): g is GeneralInstance => !!g && g.alive && hasSkill(g, 'zhonghui_quanji')
        )
        for (const qj of quanjiOwners) {
            const times = Math.min(amount, 3)
            for (let qi = 0; qi < times; qi++) {
                const qjPayer = getActiveGeneral(state)
                const qjDesc = qjPayer && qjPayer !== qj && qjPayer.alive
                    ? `摸一张牌，然后由【${getGeneralName(qjPayer)}】将一张手牌置于你的武将牌上，称为“权”`
                    : '摸一张牌，然后将一张手牌置于你的武将牌上，称为“权”'
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                    targetGeneralIndex: state.generals.indexOf(qj),
                    context: {
                        skillId: 'zhonghui_quanji',
                        skillName: '权计',
                        description: qjDesc,
                        quanjiTimes: times,
                    },
                })
            }
            addLog(state, `【${getGeneralName(qj)}】可发动【权计】（${times}次）`)
        }

        // 称象（界曹冲）：受到1点伤害后，亮出牌堆顶的牌并获得点数之和不大于13的任意张
        if (hasSkill(target, 'caochong_chengxiang') && state.deck.length > 0) {
            const cxTimes = Math.min(amount, 3)
            for (let ci = 0; ci < cxTimes; ci++) {
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                    targetGeneralIndex: state.generals.indexOf(target),
                    context: {
                        skillId: 'caochong_chengxiang',
                        skillName: '称象',
                        description: `亮出牌堆顶${4 + (target.chengxiangBonus ?? 0)}张牌，获得其中点数之和不大于13的任意张（第${ci + 1}/${cxTimes}次）`,
                    },
                })
            }
            addLog(state, `【${getGeneralName(target)}】可发动【称象】（${cxTimes}次）`)
        }

        // 恢拓（曹叡）：受到伤害后，令一名角色判定，红色回复1点体力，黑色摸X张牌
        if (hasSkill(target, 'caorui_huituo') && state.deck.length > 0 && target.alive) {
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(target),
                context: {
                    skillId: 'caorui_huituo',
                    skillName: '恢拓',
                    description: '令一名角色判定：红色其回复1点体力；黑色其摸X张牌',
                    huituoAmount: amount,
                },
            })
            addLog(state, `【${getGeneralName(target)}】可发动【恢拓】`)
        }
    }

    // 伤逝（界张春华）：受伤后手牌数小于已损失的体力值时可以摸牌
    maybeShangshi(state, target)

    // ── 邀名（界全琮）：造成或受到伤害后，每回合限一次，选择一名角色结算
    if (amount > 0 && target.alive) {
        const yaomingUsers = [attacker, target].filter(
            (g): g is GeneralInstance => !!g && g.alive && hasSkill(g, 'quancong_yaoming')
        )
        for (const qc of yaomingUsers) {
            if (qc.yaomingTurn === state.turnSerial) continue
            const qcIdx = state.generals.indexOf(qc)
            // 邀名可选择任意存活角色，包括界全琮自己（手牌数相同时转入“弃一张/摸一张”选择）
            const candidates = state.generals
                .map((g, i) => ({ g, i }))
                .filter(({ g }) => g.alive)
                .map(({ i }) => i)
            if (candidates.length === 0) continue
            qc.yaomingTurn = state.turnSerial
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_CHOOSE_TARGET,
                targetGeneralIndex: qcIdx,
                context: {
                    skillId: 'quancong_yaoming',
                    skillName: '邀名',
                    description: '选择一名角色：其手牌数不少于你则弃其一张牌，不多于你则令其摸一张牌',
                    candidateIndices: candidates,
                },
            })
        }
    }

    // ── 铁索连环：属性伤害传导（受属性伤害后重置，并向其余横置角色传导）
    // 一次伤害只连锁一轮：先把所有横置角色重置，再逐个结算，传导出的伤害不再二次传导
    if ((nature === 'fire' || nature === 'thunder') && target.chained && !opts?.chainTransmit) {
        target.chained = false
        addLog(state, `【${tgtName}】重置（铁索连环）`)
        const transmitters = state.generals.filter(g => g.alive && g.chained)
        for (const chainedTarget of transmitters) chainedTarget.chained = false
        for (const chainedTarget of transmitters) {
            addLog(state, `【铁索连环】${nature === 'fire' ? '火焰' : '雷电'}伤害传导至【${getGeneralName(chainedTarget)}】`)
            dealDamage(state, attacker, chainedTarget, amount, damageCardId, { nature, chainTransmit: true })
        }
    }

    // ── 狞恶（界典韦）：一名角色每回合第二次受到伤害后，若受伤者或伤害来源为典韦，摸一张并弃其场上一张牌
    if (amount > 0) {
        target.damageTimesThisTurn = (target.damageTimesThisTurn ?? 0) + 1
        if (target.damageTimesThisTurn === 2) {
            const ningeOwner = [target, attacker].find(
                g => g && g.alive && hasSkill(g, 'dianwei_jie_ninge')
            )
            if (ningeOwner) {
                const drawn = drawCards(state, 1)
                ningeOwner.hand.push(...drawn)
                const slot = (['weapon', 'armor', 'plus_horse', 'minus_horse'] as const)
                    .find(s => target.equip[s])
                let discarded: Card | undefined
                if (slot) {
                    discarded = target.equip[slot]
                    clearEquipSlot(state, target, slot)
                } else if (target.judgeZone.length > 0) {
                    discarded = target.judgeZone.shift()
                }
                if (discarded) state.discard.push(discarded)
                addLog(state, `【${getGeneralName(ningeOwner)}】发动【狞恶】，摸一张牌`
                    + (discarded ? `并弃置【${getGeneralName(target)}】的${cardFullName(discarded)}` : ''))
            }
        }
    }

    if (target.hp <= 0 && !dyingHandledByShibei) {
        // 进入濒死状态 —— 逆时针询问桃
        enterDyingState(state, attacker, target, damageCardId, amount)
    }

    // 本回合累计受到的伤害（矢北的“第一次受伤”判据在此累加，晚于技能判定）
    target.damageTakenThisTurn = (target.damageTakenThisTurn ?? 0) + Math.max(0, amount)
    // 本阶段的伤害总量（佐定判定）与伤害来源的累计伤害（急攻 / 狂骨等）
    state.damageThisActionPhase = (state.damageThisActionPhase ?? 0) + Math.max(0, amount)
    if (attacker && attacker !== target) {
        attacker.damageDealtThisTurn = (attacker.damageDealtThisTurn ?? 0) + Math.max(0, amount)
    }
}

/**
 * 濒死处理：从濒死者开始逆时针询问每个角色是否使用桃
 * 简化实现：自动检查所有角色手中的桃
 * TODO: 完整实现需要异步响应链
 */
function enterDyingState(
    state: GameState,
    attacker: GeneralInstance | null,
    target: GeneralInstance,
    damageCardId?: string,
    damageAmount: number = 1,
    /** 因失去体力（非伤害）进入濒死时为 false：被救活后不触发受伤类技能 */
    fromDamage: boolean = true,
): void {
    // 途绝（黄权限定技）：濒死时交给一名其他角色所有牌，回复等量体力并摸等量牌
    if (target.alive && hasSkill(target, 'huangquan_tujue')
        && !target.usedLimitedSkills.includes('huangquan_tujue')) {
        const cards: Card[] = [...target.hand]
        for (const slot of Object.values(EquipSlot)) {
            if (target.equip[slot]) cards.push(target.equip[slot]!)
        }
        const receiver = state.generals
            .filter(g => g.alive && g !== target)
            .sort((a, b) => (a.faction === target.faction ? 0 : 1) - (b.faction === target.faction ? 0 : 1)
                || a.hand.length - b.hand.length)[0]
        if (cards.length > 0 && receiver) {
            target.hand = []
            for (const slot of Object.values(EquipSlot)) clearEquipSlot(state, target, slot)
            receiver.hand.push(...cards)
            target.usedLimitedSkills.push('huangquan_tujue')
            target.hp += cards.length
            const drawn = drawCards(state, cards.length)
            target.hand.push(...drawn)
            addLog(state, `【${getGeneralName(target)}】发动【途绝】，将 ${cards.length} 张牌交给【${getGeneralName(receiver)}】，回复 ${cards.length} 点体力并摸 ${drawn.length} 张牌`)
            if (target.hp > 0) return
        }
    }

    const tgtName = getGeneralName(target)

    // 陈情（SP蔡文姬）：一名角色进入濒死状态时
    triggerChenqing(state, target)

    // 涅槃（庞统）：限定技，濒死时弃置区域内所有牌，重置武将牌并摸三张，体力回复至3
    if (target.alive && hasSkill(target, 'pangtong_niepan') && !target.usedLimitedSkills.includes('pangtong_niepan')) {
        const removed: Card[] = [...target.hand]
        target.hand = []
        for (const slot of Object.values(EquipSlot)) {
            if (target.equip[slot]) {
                removed.push(target.equip[slot]!)
                target.equip[slot] = undefined as any
            }
        }
        removed.push(...target.judgeZone.splice(0))
        state.discard.push(...removed)
        target.usedLimitedSkills.push('pangtong_niepan')
        target.flipped = false
        target.chained = false
        target.hp = 3
        const npDrawn = drawCards(state, 3)
        target.hand.push(...npDrawn)
        addLog(state, `【${tgtName}】发动【涅槃】，弃置${removed.length}张牌，回复至3点体力并摸${npDrawn.length}张牌`)
        return
    }

    addLog(state, `【${tgtName}】进入濒死状态！`)

    // 建立逆时针询问顺序（从濒死者自己开始）
    const aliveGenerals = state.generals.filter(g => g.alive || g === target)
    const targetPos = aliveGenerals.indexOf(target)

    // 贾诩完杀：锁定技，你的回合内，除你以外，不处于濒死状态的角色不能使用【桃】
    // → 濒死者本人 与 完杀拥有者本人 仍然都留在询问队列中
    const activeGeneral = getActiveGeneral(state)
    const wanshaOwner = activeGeneral && activeGeneral.alive && hasSkill(activeGeneral, 'jiaxu_wansha')
        ? activeGeneral
        : undefined

    const askOrder: number[] = [] // 存储 generals 数组中的下标
    for (let i = 0; i < aliveGenerals.length; i++) {
        const idx = (targetPos - i + aliveGenerals.length) % aliveGenerals.length
        const g = aliveGenerals[idx]

        if (wanshaOwner && g !== target && g !== wanshaOwner) {
            continue
        }

        askOrder.push(state.generals.indexOf(g))
    }

    if (askOrder.length === 0) {
        // 无人可询问，直接死亡
        handleDeath(state, attacker, target)
        return
    }

    // 设置第一个被询问者的 PendingResponse
    const firstAskerIdx = askOrder[0]
    const remainingAskers = askOrder.slice(1)

    state.pendingResponseQueue.unshift({
        type: ResponseType.PEACH_SAVE_ASK,
        targetGeneralIndex: firstAskerIdx,
        context: {
            dyingGeneralIndex: state.generals.indexOf(target),
            attackerGeneralIndex: attacker ? state.generals.indexOf(attacker) : -1,
            remainingAskers,
            neededHp: 1 - target.hp, // 需要恢复的体力数
            damageCardId, // 传递伤害卡牌 ID 用于被救后触发被动技能
            damageAmount, // 传递伤害量用于遗计等技能
            // 失去体力导致的濒死不是“受伤”，被救活后不触发遗计/刚烈等受伤类技能
            dyingFromDamage: fromDamage,
        },
    })

    addLog(state, `请【${getGeneralName(state.generals[firstAskerIdx])}】选择是否使用【桃】救援【${tgtName}】`)

    // 仁心（界曹冲）：其他角色进入濒死状态时，可翻面并弃置一张装备牌，令其将体力回复至1点
    for (const rxOwner of state.generals) {
        if (!rxOwner.alive || rxOwner === target) continue
        if (!hasSkill(rxOwner, 'caochong_renxin')) continue
        // 完杀②（界贾诩）：濒死期间其他角色的非锁定技失效
        if (isSkillSuppressedByWansha(state, rxOwner)) continue
        const rxHasEquip = Object.values(rxOwner.equip).some((c) => !!c)
            || rxOwner.hand.some((c) => c.category === CardCategory.EQUIPMENT)
        if (!rxHasEquip) continue
        state.pendingResponseQueue.unshift({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(rxOwner),
            context: {
                skillId: 'caochong_renxin',
                skillName: '仁心',
                description: `翻面并弃置一张装备牌，令【${tgtName}】将体力回复至1点`,
                renxinTargetIndex: state.generals.indexOf(target),
            },
        })
        addLog(state, `【${getGeneralName(rxOwner)}】可发动【仁心】`)
    }
}

/** 乱武②（界贾诩）：所有结算结束后，可视为使用一张无距离限制的【杀】 */
function maybeLuanwuExtraSlash(state: GameState, userIdx: number): void {
    const user = state.generals[userIdx]
    if (!user?.alive || user.generalId !== 'jiaxu_jie') return
    const candidateIndices = state.generals
        .map((g, i) => ({ g, i }))
        .filter(({ g, i }) => g.alive && i !== userIdx)
        .map(({ i }) => i)
    if (candidateIndices.length === 0) return
    state.pendingResponseQueue.push({
        type: ResponseType.SKILL_LUANWU_EXTRA_SLASH,
        targetGeneralIndex: userIdx,
        context: {
            skillId: 'jiaxu_luanwu', skillName: '乱武',
            candidateIndices,
            description: '是否视为使用一张无距离限制的【杀】？',
        },
    })
    addLog(state, `【${getGeneralName(user)}】【乱武】结算结束，可视为使用一张无距离限制的【杀】`)
}

/**
 * 完杀②（界贾诩）：其回合内的濒死结算期间，除濒死者和其以外的角色非锁定技失效。
 */
export function isSkillSuppressedByWansha(state: GameState, general: GeneralInstance): boolean {
    const ask = state.pendingResponseQueue.find(p => p.type === ResponseType.PEACH_SAVE_ASK)
    if (!ask) return false
    const owner = getActiveGeneral(state)
    if (!owner?.alive || owner.generalId !== 'jiaxu_jie' || !hasSkill(owner, 'jiaxu_wansha')) return false
    if (general === owner) return false
    const dyingIdx = (ask.context as any)?.dyingGeneralIndex as number | undefined
    if (dyingIdx !== undefined && state.generals[dyingIdx] === general) return false
    return true
}

/**
 * 从濒死被救活后触发受伤被动技能（遗计/奸雄/反馈/刚烈）
 * 在 dealDamage 中 target.hp <= 0 时被动不触发，被救后在此补充触发
 */
function triggerDamagePassiveSkills(
    state: GameState,
    attacker: GeneralInstance | null,
    target: GeneralInstance,
    damageCardId?: string,
    damageAmount: number = 1
): void {
    if (!target.alive || target.hp <= 0) return
    const tgtName = getGeneralName(target)

    // 刚烈：每受1点伤害可发动一次
    if (hasSkill(target, 'xiahoudun_ganglie') && attacker && state.deck.length > 0) {
        for (let gi = 0; gi < damageAmount; gi++) {
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(target),
                context: {
                    skillId: 'xiahoudun_ganglie',
                    skillName: '刚烈',
                    description: `判定，非♥则来源弃2牌或受1伤（第${gi + 1}/${damageAmount}次）`,
                    attackerGeneralIndex: state.generals.indexOf(attacker),
                },
            })
        }
        addLog(state, `【${tgtName}】可发动【刚烈】（${damageAmount}次）`)
    }

    // 遗计：每受1点伤害可发动一次
    const yijiSkillId2 = hasSkill(target, 'guojia_jie_yiji') ? 'guojia_jie_yiji'
        : hasSkill(target, 'guojia_yiji') ? 'guojia_yiji' : undefined
    if (yijiSkillId2 && state.deck.length > 0) {
        for (let yi = 0; yi < damageAmount; yi++) {
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(target),
                context: {
                    skillId: yijiSkillId2,
                    skillName: '遗计',
                    description: `${yijiSkillId2 === 'guojia_jie_yiji' ? '摸两张牌并分配' : '观看牌堆顶2张牌并分配'}（第${yi + 1}/${damageAmount}次）`,
                },
            })
        }
        addLog(state, `【${tgtName}】可发动【遗计】（${damageAmount}次）`)
    }

    // 反馈：每受1点伤害可发动一次
    if ((hasSkill(target, 'simayi_fankui') || hasSkill(target, 'simayi_jie_fankui')) && attacker) {
        const atkCards = attacker.hand.length
        const atkEquips = Object.values(attacker.equip).filter(Boolean).length
        if (atkCards + atkEquips > 0) {
            for (let fi = 0; fi < damageAmount; fi++) {
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                    targetGeneralIndex: state.generals.indexOf(target),
                    context: {
                        skillId: 'simayi_fankui',
                        skillName: '反馈',
                        description: `获取【${getGeneralName(attacker)}】的一张牌（第${fi + 1}/${damageAmount}次）`,
                        sourceGeneralIndex: state.generals.indexOf(attacker),
                    },
                })
            }
            addLog(state, `【${tgtName}】可发动【反馈】（${damageAmount}次）`)
        }
    }

    // 奸雄
    if ((hasSkill(target, 'caocao_jianxiong') || hasSkill(target, 'caocao_jie_jianxiong'))
        && (damageCardId || hasSkill(target, 'caocao_jie_jianxiong'))
        && !isLimitedSkillSpent(target, 'caocao_jie_jianxiong')) {
        state.pendingResponseQueue.unshift({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(target),
            context: {
                skillId: 'caocao_jianxiong',
                skillName: '奸雄',
                description: hasSkill(target, 'caocao_jie_jianxiong')
                    ? '获得造成伤害的牌并摸一张牌'
                    : '获得造成伤害的牌',
                damageCardId,
            },
        })
        addLog(state, `【${tgtName}】可发动【奸雄】`)
    }

    // 殚心（界郭皇后）
    triggerDanxin(state, target)
}

/**
 * 殚心（界郭皇后）：受到伤害后，可摸X张牌（X为修改“矫诏”的次数），然后修改“矫诏”
 * 普通受伤（dealDamage）与濒死被救回（triggerDamagePassiveSkills）两处共用
 */
function triggerDanxin(state: GameState, target: GeneralInstance): void {
    if (!hasSkill(target, 'guohuanghou_danxin') || !hasSkill(target, 'simayi_jie_jiaozhao')) return
    const dxTimes = target.jiaozhaoUpgrade ?? 0
    const dxCanUpgrade = dxTimes < 2
    state.pendingResponseQueue.unshift({
        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
        targetGeneralIndex: state.generals.indexOf(target),
        context: {
            skillId: 'guohuanghou_danxin',
            skillName: '殚心',
            description: dxCanUpgrade
                ? `摸${dxTimes}张牌，然后修改“矫诏”（第${dxTimes + 1}次修改）`
                : `摸${dxTimes}张牌（“矫诏”已修改两次）`,
            options: [{
                action: 'danxin',
                label: dxCanUpgrade ? `摸${dxTimes}张牌并修改“矫诏”` : `摸${dxTimes}张牌`,
            }],
        },
    })
    addLog(state, `【${getGeneralName(target)}】可发动【殚心】`)
}

/** 处理角色死亡：弃置所有牌、击杀奖励 */
function handleDeath(
    state: GameState,
    attacker: GeneralInstance | null,
    target: GeneralInstance
): void {
    target.alive = false
    target.hp = 0
    const tgtName = getGeneralName(target)
    addLog(state, `【${tgtName}】阵亡！`)

    // 戚乱（何太后）：记录本回合击杀数与死亡数
    if (attacker && attacker !== target) {
        const killerIdx = state.generals.indexOf(attacker)
        if (killerIdx >= 0) {
            const counts = state.turnKillCounts ?? []
            counts[killerIdx] = (counts[killerIdx] ?? 0) + 1
            state.turnKillCounts = counts
        }
    }
    state.turnDeathCount = (state.turnDeathCount ?? 0) + 1
    // 焚心（灵雎）
    triggerLingjuFenxin(state, attacker, target)

    // 弃置所有牌
    state.discard.push(...target.hand)
    target.hand = []
    for (const slot of Object.values(EquipSlot)) {
        if (target.equip[slot]) {
            const lostEquip = clearEquipSlot(state, target, slot)
            if (lostEquip) state.discard.push(lostEquip)
        }
    }
    state.discard.push(...target.judgeZone)
    target.judgeZone = []

    // 斗地主：农民阵亡时由存活农民二选一（摸2张 / 回复1点体力），地主击杀无奖励
    if (state.mode === GameMode.DOUDIZHU) {
        if (target.faction === Faction.COOL) {
            const survivor = state.generals.find(
                (g) => g.faction === Faction.COOL && g.alive && g !== target)
            if (survivor) {
                state.pendingResponseQueue.push({
                    type: ResponseType.LANDLORD_REWARD,
                    targetGeneralIndex: state.generals.indexOf(survivor),
                    context: {
                        killedName: tgtName,
                        options: ['draw', 'recover'],
                    },
                })
                addLog(state, `【${getGeneralName(survivor)}】获得阵亡奖励：摸两张牌或回复1点体力`)
            }
        }
        return
    }

    // 欢乐成双：同阵营角色阵亡时，存活的队友二选一（摸2张 / 回复1点体力）
    if (state.mode === GameMode.HUANLE_SHUANG) {
        const survivor = state.generals.find(
            (g) => g.faction === target.faction && g.alive && g !== target)
        if (survivor) {
            state.pendingResponseQueue.push({
                type: ResponseType.LANDLORD_REWARD,
                targetGeneralIndex: state.generals.indexOf(survivor),
                context: {
                    killedName: tgtName,
                    options: ['draw', 'recover'],
                    pairReward: true,
                },
            })
            addLog(state, `【${getGeneralName(survivor)}】因同阵营阵亡，可选择摸两张牌或回复1点体力`)
        }
        return
    }

    // 击杀奖励（统率）：仅边锋阵亡时击杀者摸 2 张，无论敌我；主帅击杀不摸
    if (attacker && attacker.alive && target.seatRole !== SeatRole.COMMANDER) {
        const bonus = drawCards(state, 2)
        attacker.hand.push(...bonus)
        addLog(state, `【${getGeneralName(attacker)}】获得击杀奖励，摸 2 张牌`)
    }
}

// ─────────────────────────────────────────────────────────────
// 使用卡牌
// ─────────────────────────────────────────────────────────────

function handleUseCardImpl(
    state: GameState, // x
    playerId: string,
    data: C2S_UseCard
): { error: string } | void {
    const general = getActiveGeneral(state)
    if (!general || general.playerId !== playerId) {
        return { error: '不是你的出牌阶段' }
    }
    if (state.turnPhase !== TurnPhase.ACTION) {
        return { error: '当前不是出牌阶段' }
    }

    const cardIdx = general.hand.findIndex((c) => c.id === data.cardId)
    if (cardIdx === -1) {
        return { error: '手牌中没有此牌' }
    }

    const card = general.hand[cardIdx]
    const targets = data.targetIndices.map((i) => state.generals[i]).filter((g) => g?.alive)

    // 设伏（程昱）：其他角色于你的回合外使用牌时，可移去“伏兵”令此牌无效
    if (!(data.extra as any)?.shefuChecked && expShefuNegateAvailable(state, general, card)) return

    // 止息（孙鲁育）/ 屯储（李丰）：本阶段不能使用牌
    const expBlocked = expansionCardUseBlocked(general, card)
    if (expBlocked) return { error: expBlocked }

    // 穆穆（孙鲁育）：本阶段不能使用【杀】
    if (general.mumuNoSlashPhase && card.name === BasicCardName.ATTACK) {
        return { error: '【穆穆】：本阶段不能使用或打出【杀】' }
    }

    // 劝谏（黄权）：本回合不能使用手牌
    if (general.cannotUseHandTurn === state.activeGeneralIndex) {
        return { error: '【劝谏】结算：本回合不能使用手牌' }
    }

    // 雄乱（张绣）：本回合不能使用或打出手牌
    if (cannotUseHandCards(state, general)) {
        return { error: '【雄乱】：本回合不能使用或打出手牌' }
    }

    // 潜袭（马岱）：不能使用指定颜色的手牌
    if (general.qianxiColor) {
        const isRed = card.suit === CardSuit.HEART || card.suit === CardSuit.DIAMOND
        if ((general.qianxiColor === 'red') === isRed) {
            return { error: `【潜袭】：本回合不能使用${isRed ? '红' : '黑'}色手牌` }
        }
    }

    // 拒战（严颜）：本回合不能对指定角色使用牌
    if (general.forbiddenTargetIndex !== undefined
        && general.forbiddenTargetTurn === state.activeGeneralIndex
        && targets.some((t) => state.generals.indexOf(t) === general.forbiddenTargetIndex)) {
        return { error: '【拒战】：本回合不能对该角色使用牌' }
    }

    // 惴恐（界伏皇后）/ 龙临（闪赵云）：本回合（阶段）使用牌只能指定自己为目标
    if (general.useOnlySelfTurn !== undefined && general.useOnlySelfTurn === state.turnSerial
        && targets.some(t => t !== general)) {
        return { error: '【惴恐】：本回合使用牌只能指定自己为目标' }
    }
    if (general.onlySelfTargetPhase && targets.some(t => t !== general)) {
        return { error: '【龙临】：本阶段使用牌只能指定自己为目标' }
    }

    // asSkill 转换：将牌转换为技能使用（奇袭/断粮/国色等）
    if (data.asSkill) {
        return handleUseSkillImpl(state, playerId, {
            skillId: data.asSkill,
            cardIds: [data.cardId],
            targetIndices: data.targetIndices,
        })
    }

    // 武圣（关羽）：客户端激活武圣模式后，红色牌当杀使用
    if (data.extra?.wusheng && hasSkill(general, 'guanyu_wusheng')) {
        const isRedCard = card.suit === CardSuit.HEART || card.suit === CardSuit.DIAMOND
        if (!isRedCard) return { error: '武圣须使用红色牌' }
        const wushengOutcome = handleWushengAttack(state, general, card, cardIdx, targets)
        if (wushengOutcome && 'error' in wushengOutcome) return wushengOutcome
        triggerJianying(state, general, card)
        return wushengOutcome
    }

    // 朱雀羽扇：可以将一张♦手牌当【火杀】使用
    if (data.extra?.zhuque && general.equip.weapon?.name === EquipmentCardName.ZHUQUE_FAN) {
        if (card.suit !== CardSuit.DIAMOND) return { error: '朱雀羽扇须使用♦牌' }
        const zhuqueOutcome = handleBasicCard(state, general, { ...card, name: BasicCardName.FIRE_SLASH, nature: 'fire' }, cardIdx, targets)
        if (zhuqueOutcome && 'error' in zhuqueOutcome) return zhuqueOutcome
        triggerJianying(state, general, card)
        return zhuqueOutcome
    }

    // 重铸（铁索连环）：弃置此牌并摸一张牌
    if (data.extra?.recast && card.name === TrickCardName.IRON_CHAIN) {
        general.hand.splice(cardIdx, 1)
        state.discard.push(card)
        const drawn = drawCards(state, 1)
        general.hand.push(...drawn)
        addLog(state, `【${getGeneralName(general)}】重铸【铁索连环】，摸了 1 张牌`)
        return
    }

    // 疠火②（程普/界程普）：将【杀】改为火【杀】使用
    const lihuoJie = hasSkill(general, 'chengpu_jie_lihuo')
    if (data.extra?.lihuo && (hasSkill(general, 'chengpu_lihuo') || lihuoJie) && isCardUsableAsAttack(general, card)) {
        if (lihuoJie) {
            // 界程普：任何非火【杀】都可以改为火【杀】
            if (card.nature === 'fire') return { error: '【疠火】须使用不为火【杀】的【杀】' }
        } else if (card.name !== BasicCardName.ATTACK) {
            return { error: '【疠火】只能将普通【杀】改为火【杀】' }
        }
        const lihuoCard: Card = { ...card, name: BasicCardName.FIRE_SLASH, nature: 'fire' }
        general.lihuoFirePhase = true
        general.lihuoDamaged = false
        const lihuoOutcome = handleBasicCard(state, general, lihuoCard, cardIdx, targets)
        if (lihuoOutcome && 'error' in lihuoOutcome) {
            general.lihuoFirePhase = false
            return lihuoOutcome
        }
        general.cardsUsedThisTurn = (general.cardsUsedThisTurn ?? 0) + 1
        state.pendingResponseQueue.push({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(general),
            context: {
                skillId: lihuoJie ? 'chengpu_jie_lihuo_cost' : 'chengpu_lihuo_cost',
                skillName: '疠火',
                description: lihuoJie
                    ? '【杀】结算结束后若造成过伤害，选择弃置一张牌或失去1点体力'
                    : '【杀】结算结束后若造成过伤害，失去1点体力',
                autoExecute: true,
            },
        })
        triggerJianying(state, general, card)
        return
    }

    // 矫诏（郭皇后）：将展示的牌当作本回合声明的牌使用
    if (general.jiaozhaoCardId === card.id && general.jiaozhaoAs) {
        const jzName = general.jiaozhaoAs
        if (targets.some(t => t === general)) return { error: '【矫诏】不能指定自己为目标' }
        const jzBasic = [BasicCardName.ATTACK, BasicCardName.PEACH, BasicCardName.WINE]
        const jzTrick = (general.jiaozhaoUpgrade ?? 0) >= 1
            ? [TrickCardName.DRAW_TWO, TrickCardName.DISMANTLE, TrickCardName.STEAL, TrickCardName.DUEL]
            : []
        const jzNames: Record<string, string> = {
            attack: '杀', peach: '桃', wine: '酒',
            draw_two: '无中生有', dismantle: '过河拆桥', steal: '顺手牵羊', duel: '决斗',
        }
        general.jiaozhaoCardId = undefined
        general.jiaozhaoAs = undefined
        if (jzBasic.includes(jzName as BasicCardName)) {
            const converted: Card = {
                ...card,
                name: jzName as BasicCardName,
                category: CardCategory.BASIC,
                nature: jzName === BasicCardName.ATTACK ? 'normal' : undefined,
            }
            const jzOutcome = handleBasicCard(state, general, converted, cardIdx, targets)
            if (jzOutcome && 'error' in jzOutcome) return jzOutcome
            addLog(state, `【${getGeneralName(general)}】通过【矫诏】将${cardFullName(card)}当【${jzNames[jzName] ?? jzName}】使用`)
            general.cardsUsedThisTurn = (general.cardsUsedThisTurn ?? 0) + 1
            return jzOutcome
        }
        if (jzTrick.includes(jzName as TrickCardName)) {
            const converted: Card = {
                ...card,
                name: jzName as TrickCardName,
                category: CardCategory.TRICK,
                trickType: TrickType.INSTANT,
            }
            const jzOutcome = handleTrickCard(state, general, converted, cardIdx, targets, data.extra)
            if (jzOutcome && 'error' in jzOutcome) return jzOutcome
            addLog(state, `【${getGeneralName(general)}】通过【矫诏】将${cardFullName(card)}当【${jzNames[jzName] ?? jzName}】使用`)
            general.cardsUsedThisTurn = (general.cardsUsedThisTurn ?? 0) + 1
            return jzOutcome
        }
        return { error: '【矫诏】声明的牌当前无法使用' }
    }

    // 活墨（钟繇）：将一张黑色非基本牌置于牌堆顶，视为使用一张基本牌
    const huomoAs = data.extra?.huomo as string | undefined
    if (huomoAs) {
        if (!hasSkill(general, 'zhongyao_huomo')) return { error: '你没有【活墨】' }
        const hmBlack = card.suit === CardSuit.SPADE || card.suit === CardSuit.CLUB
        if (card.category === CardCategory.BASIC || !hmBlack) {
            return { error: '【活墨】须将一张黑色非基本牌置于牌堆顶' }
        }
        const hmName = huomoAs === 'attack' ? BasicCardName.ATTACK
            : huomoAs === 'peach' ? BasicCardName.PEACH
                : huomoAs === 'wine' ? BasicCardName.WINE : undefined
        if (!hmName) return { error: '【活墨】选择的牌名无效' }
        if ((general.basicUsedThisTurn ?? []).includes(hmName)) {
            return { error: `【活墨】本回合已经使用过【${cardDisplayName({ name: hmName })}】` }
        }
        const hmTargets = hmName === BasicCardName.ATTACK ? targets : [general]
        const converted: Card = {
            ...card,
            name: hmName,
            category: CardCategory.BASIC,
            nature: undefined,
            trickType: undefined,
        }
        const hmOutcome = handleBasicCard(state, general, converted, cardIdx, hmTargets)
        if (hmOutcome && 'error' in hmOutcome) return hmOutcome
        // 转化的实体牌置于牌堆顶，替代进入弃牌堆
        const dumpedIdx = state.discard.indexOf(converted)
        if (dumpedIdx >= 0) state.discard.splice(dumpedIdx, 1)
        state.deck.unshift(card)
        addLog(state, `【${getGeneralName(general)}】发动【活墨】，将${cardFullName(card)}置于牌堆顶，视为使用【${cardDisplayName({ name: hmName })}】`)
        general.cardsUsedThisTurn = (general.cardsUsedThisTurn ?? 0) + 1
        if (hmName === BasicCardName.ATTACK && hmTargets.some(t => t !== general && t.alive)) {
            general.cardsUsedOnOthersThisTurn = (general.cardsUsedOnOthersThisTurn ?? 0) + 1
        }
        return
    }

    // 求援（界伏皇后）：成为其他角色使用伤害牌的目标时，可能追加目标（延迟本次结算）
    if (maybeXuanqiu(state, general, card, targets)) return

    return dispatchCardUse(state, general, card, cardIdx, targets, data.extra)
}

/**
 * 使用牌的结算派发（洛书版扩展（五）抽出：求援等“指定目标后”技能会延迟到这里）
 */
function dispatchCardUse(
    state: GameState,
    general: GeneralInstance,
    card: Card,
    cardIdx: number,
    targets: GeneralInstance[],
    extra?: Record<string, unknown>,
): { error: string } | void {
    // 结算前队列长度：卡片自身产生的询问都排在它之后，
    // “指定目标后”的技能（佐定）要插回这里，先于牌的结算询问
    const queueBase = state.pendingResponseQueue.length
    // 蒺藜（沙摩柯）按“使用这张牌时”的攻击范围判断第 X 张：装备牌结算后武器已经换掉，
    // 若那时再取范围，装备麒麟弓（范围5）这类牌会把自己这次触发算到新范围上
    const attackRangeBeforeUse = expAttackRange(state, general)
    let outcome: { error: string } | void
    if (card.category === CardCategory.BASIC) {
        outcome = handleBasicCard(state, general, card, cardIdx, targets)
    } else if (card.category === CardCategory.TRICK) {
        outcome = handleTrickCard(state, general, card, cardIdx, targets, extra)
    } else if (card.category === CardCategory.EQUIPMENT) {
        outcome = handleEquipCard(state, general, card, cardIdx)
    } else {
        return
    }

    // 使用失败（校验报错）不计入“上一张使用的牌”
    if (outcome && 'error' in outcome) return outcome
    general.cardsUsedThisTurn = (general.cardsUsedThisTurn ?? 0) + 1
    // 竊听（蔡夫人）：记录“对其他角色使用过的牌”
    if (targets.some(t => t !== general && t.alive)) {
        general.cardsUsedOnOthersThisTurn = (general.cardsUsedOnOthersThisTurn ?? 0) + 1
    }
    // 恃才（许攸）：使用牌结算结束后，若此牌类别与本回合用过的均不同，可将其置于牌堆顶并摸一张
    if (hasSkill(general, 'xuyou_shicai')) {
        const usedCategories = general.usedCardCategories ?? []
        if (!usedCategories.includes(card.category)) {
            general.usedCardCategories = [...usedCategories, card.category]
            if (card.category !== CardCategory.EQUIPMENT) {
                state.pendingResponseQueue.push({
                    type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                    targetGeneralIndex: state.generals.indexOf(general),
                    context: {
                        skillId: 'xuyou_shicai',
                        skillName: '恃才',
                        description: '将此牌置于牌堆顶，然后摸一张牌',
                        shicaiCardId: card.id,
                    },
                })
                addLog(state, `【${getGeneralName(general)}】可发动【恃才】（${cardFullName(card)}）`)
            }
        }
    }
    // 佐定（钟繇）：其他角色于出牌阶段使用黑桃牌指定目标后，本阶段无人受伤则可令一名目标摸一张
    if (card.suit === CardSuit.SPADE && (state.damageThisActionPhase ?? 0) === 0) {
        for (const zy of state.generals) {
            if (!zy.alive || zy === general) continue
            if (!hasSkill(zy, 'zhongyao_zuoding')) continue
            // 佐定可选任意一名目标角色，包括钟繇自己
            const zuodingTargets = targets
                .filter(t => t.alive)
                .map(t => state.generals.indexOf(t))
            if (zuodingTargets.length === 0) continue
            state.pendingResponseQueue.splice(Math.min(queueBase, state.pendingResponseQueue.length), 0, {
                type: ResponseType.SKILL_CHOOSE_TARGET,
                targetGeneralIndex: state.generals.indexOf(zy),
                context: {
                    skillId: 'zhongyao_zuoding',
                    skillName: '佐定',
                    description: '令其中一名目标角色摸一张牌',
                    candidateIndices: zuodingTargets,
                },
            })
            addLog(state, `【${getGeneralName(zy)}】可发动【佐定】`)
        }
    }
    // 奇制（王基）：使用非装备牌指定目标后，弃非目标角色一张牌，然后其摸一张牌
    triggerQizhi(state, general, card, targets)
    // 征荣（毌丘俭）：使用伤害牌指定目标后，可将一名目标的一张牌置于武将牌上
    triggerZhengrong(state, general, card, targets)
    // 渐营（沮授）：使用与上一张同花色/点数的牌时摸一张
    triggerJianying(state, general, card)
    // 洛书版扩展（九）：行图 / 蒺藜 / 止息 / 戮连 / 默识
    noteExpansionCardUsed(state, general, card, targets.map(t => state.generals.indexOf(t)), attackRangeBeforeUse)
    // 洛书版扩展（四）：使用牌结算结束后的技能触发
    triggerUseCardResolvedHooks(state, general, card)
    return outcome
}

/**
 * 使用牌结算结束后的通用触发（洛书版扩展（四））
 * - 精策（界郭淮）：记录类别 / 每种花色第一张牌使手牌上限+1
 * - 誉虚（许靖）：摸一张牌，然后下一次用牌须弃一张牌
 * - 实荐（许靖）：其他角色出牌阶段第二次用牌结算结束后，可弃牌令其获得【誉虚】
 */
function triggerUseCardResolvedHooks(
    state: GameState,
    general: GeneralInstance,
    card: Card,
): void {
    const selfIdx = state.generals.indexOf(general)
    const isActive = state.activeGeneralIndex === selfIdx

    // 精策（界郭淮）：①记录“本回合”使用过的牌的类别（含回合外的响应牌）
    if (hasSkill(general, 'guohuai_jingce')) {
        const jinceCats = general.jinceCategories ?? []
        if (!jinceCats.includes(card.category)) {
            general.jinceCategories = [...jinceCats, card.category]
        }
    }

    // 精策（界郭淮）：②回合内使用每种花色的第一张牌结算结束后，手牌上限+1
    if (isActive && hasSkill(general, 'guohuai_jingce')) {
        const jinceSuits = general.jinceSuits ?? []
        if (!jinceSuits.includes(card.suit)) {
            general.jinceSuits = [...jinceSuits, card.suit]
            general.handLimitDelta = (general.handLimitDelta ?? 0) + 1
            addLog(state, `【${getGeneralName(general)}】发动【精策】，手牌上限+1（${general.handLimitDelta}）`)
        }
    }

    if (state.turnPhase !== TurnPhase.ACTION) return

    // 誉虚（许靖）：出牌阶段使用牌结算结束后，可以摸一张牌
    if (isActive && hasSkill(general, 'xujing_yuxu')) {
        if (general.yuxuPenalty) {
            general.yuxuPenalty = false
            addLog(state, `【${getGeneralName(general)}】【誉虚】：本阶段下一次使用牌结算结束后须弃置一张牌`)
            if (hasCardInArea(general)) {
                askPickCard(state, general, 'xujing_yuxu_penalty', '誉虚',
                    '弃置一张牌（誉虚的代价）', { count: 1, mode: 'discard' })
            }
        } else {
            askSkill(state, general, 'xujing_yuxu', '誉虚',
                '摸一张牌，然后本阶段下一次使用牌结算结束后不能发动此技能并弃置一张牌',
                {}, false)
        }
    }

    // 强识（界张松）：本阶段使用与展示牌同类别的牌后摸一张
    if (isActive && general.qiangshiCategory && card.category === general.qiangshiCategory) {
        const qsDrawn = drawForGeneral(state, general, 1)
        if (qsDrawn.length > 0) {
            general.hand.push(...qsDrawn)
            addLog(state, `【${getGeneralName(general)}】【强识】使用了${cardCategoryLabel(card.category)}，摸${qsDrawn.length}张牌`)
        }
    }

    // 伤逝（界张春华）：使用牌后用牌结算结束，手牌不足可以补至已损失的体力值
    maybeShangshi(state, general)

    // 实荐（许靖）：其他角色于其出牌阶段第二次使用牌结算结束后
    const activeGeneral = state.generals[state.activeGeneralIndex]
    if (activeGeneral?.alive && (activeGeneral.cardsUsedThisTurn ?? 0) === 2
        && !hasSkill(activeGeneral, 'xujing_yuxu')) {
        for (const xj of state.generals) {
            if (!xj.alive || xj === activeGeneral) continue
            if (!hasSkill(xj, 'xujing_shijian')) continue
            if (!hasCardInArea(xj)) continue
            askSkill(state, xj, 'xujing_shijian', '实荐',
                `弃置一张牌，令【${getGeneralName(activeGeneral)}】本回合获得技能“誉虚”`,
                { shijianTargetIndex: state.generals.indexOf(activeGeneral) },
                false)
            addLog(state, `【${getGeneralName(xj)}】可发动【实荐】`)
        }
    }
}

// ─── 基本牌 ──────────────────────────────────────────────────

function handleBasicCard(
    state: GameState,
    general: GeneralInstance,
    card: Card,
    cardIdx: number,
    targets: GeneralInstance[]
): { error: string } | void {
    const { name } = card

    // 桃与酒自带主动用途（回复 / 醉酒）：武圣这类“当杀使用”的转换只应作用于没有主动用途的牌，
    // 否则红色桃会进到杀分支并被“不能对自己使用【杀】”拒掉。显式当杀使用走 handleUseCardImpl 的 wusheng 分支。
    const nativePlayable = name === BasicCardName.PEACH || name === BasicCardName.WINE
    if (name === BasicCardName.ATTACK || (!nativePlayable && isCardUsableAsAttack(general, card))) {
        // 杀次数限制
        let maxAttacks = 1
        if (hasSkill(general, 'zhangfei_paoxiao')) {
            maxAttacks = 999 // 无限
        } else if (general.equip.weapon?.name === EquipmentCardName.CROSSBOW) {
            maxAttacks = 4 // 默认1 + 连弩+3
        }
        maxAttacks += (general.dufengBonus ?? 0) + (general.extraSlashCount ?? 0)
            + (general.qimouSlashBonus ?? 0)
            + (hasSkill(general, 'lvbu_jing_shenji') ? 1 : 0)
            + (general.slashLimitDelta ?? 0)
            + (general.mingjianBonus ? 1 : 0)
            + (hasSkill(general, 'doudizhu_bahu') ? 1 : 0)

        if (general.cannotSlashTurn) return { error: '【天义】：本回合不能使用【杀】' }
        // 成略（许攸）：与弃置牌同花色的牌无次数限制
        const chenglueFree = hasSkill(general, 'xuyou_chenglue')
            && (general.chenglueSuits ?? []).includes(card.suit)
        // 雄乱（张绣）：对本回合指定的角色使用牌无距离和次数限制
        const xiongluanFree = general.xiongluanTurn !== undefined
            && general.xiongluanTurn === state.turnSerial
            && general.xiongluanTarget !== undefined
            && targets.some(t => state.generals.indexOf(t) === general.xiongluanTarget)
        // 行图（裴秀）：此牌点数为上一张牌点数的倍数时无次数限制
        const xingtuFree = hasSkill(general, 'peixiu_xingtu') && general.xingtuFreeCardId === card.id
        if (!chenglueFree && !xiongluanFree && !xingtuFree && state.attackUsedThisTurn >= maxAttacks) {
            return { error: `每回合最多使用 ${maxAttacks} 张【杀】` }
        }

        // 方天画戟：最后一张手牌为杀时可额外指定最多2个目标；短兵可额外指定一名距离1的角色
        const isLastCard = general.hand.length === 1
        const hasFangtian = general.equip.weapon?.name === EquipmentCardName.FANGTIAN_HALBERD
        let maxTargets = (isLastCard && hasFangtian) ? 3 : 1
        const hasDuanbing = hasSkill(general, 'dingfeng_duanbing')
        if (hasDuanbing) maxTargets = Math.max(maxTargets, 2)
        if (hasSkill(general, 'lvbu_jing_shenji')) maxTargets = Math.max(maxTargets, 3)
        // 疠火①（程普/界程普）：使用火【杀】时可多选择一个目标
        if ((hasSkill(general, 'chengpu_lihuo') || hasSkill(general, 'chengpu_jie_lihuo')) && card.nature === 'fire') {
            maxTargets = Math.max(maxTargets, 2)
        }
        // 天义（太史慈）：目标数上限+1
        maxTargets += (general.extraSlashTargets ?? 0)
        if (targets.length < 1 || targets.length > maxTargets) {
            return { error: maxTargets > 1 ? `最多指定${maxTargets}个目标` : '【杀】需要指定一个目标' }
        }
        if (hasDuanbing && targets.length > 1) {
            const extra = targets[targets.length - 1]
            if (getAttackRange(general, extra, state.generals).distance > 1) {
                return { error: '【短兵】额外目标须在距离1以内' }
            }
        }

        // 不能杀自己
        if (targets.some(t => t === general)) {
            return { error: '不能对自己使用【杀】' }
        }

        // 空城：诸葛亮无手牌时不能被杀指定
        for (const t of targets) {
            if (hasSkill(t, 'zhugeliang_kongcheng') && t.hand.length === 0) {
                return { error: `【${getGeneralName(t)}】发动【空城】，不能被【杀】指定` }
            }
        }

        // 陷阵（高顺）拼点没赢：不能对该角色使用【杀】
        if (general.xianzhenLoseIndex !== undefined
            && targets.some(t => state.generals.indexOf(t) === general.xianzhenLoseIndex)) {
            const xzTarget = state.generals[general.xianzhenLoseIndex]
            return { error: `【陷阵】：本回合不能对【${getGeneralName(xzTarget)}】使用【杀】` }
        }
        // 长标（祝融）：本张【杀】造成过伤害后需摸牌，由技能上下文记录

        // 攻击距离检查（成略：同花色牌无距离限制；天义/诈降：本回合【杀】无距离限制；虚视为牌可自带无距离）
        const attackIsRed = card.suit === CardSuit.HEART || card.suit === CardSuit.DIAMOND
        // 诈降（界黄盖）：仅红色【杀】无距离限制
        const zhaxiangRedFree = !!general.slashRedRangeTurn && attackIsRed
        if (!chenglueFree && !xiongluanFree && !general.slashNoRangeTurn && !zhaxiangRedFree && !(card as any).noRange) {
            // 短兵：额外指定的距离1目标不受攻击范围限制
            const duanbingExtra = (hasDuanbing && targets.length > 1) ? targets[targets.length - 1] : undefined
            for (const t of targets) {
                const rangeInfo = getAttackRange(general, t, state.generals)
                if (rangeInfo.inRange) continue
                if (t === duanbingExtra && rangeInfo.distance <= 1) continue
                // 烈弓①（界黄忠）：距离不大于【杀】的点数的其他角色无距离限制
                if (hasSkill(general, 'huangzhong_liegong') && t !== general
                    && rangeInfo.distance <= card.value) continue
                return { error: distanceTooFarText(getGeneralName(t), rangeInfo) }
            }
        }

        // 帷幕：贾诩不能被黑色锦囊指定（杀不是锦囊，不受影响）

        if (cardIdx >= 0) general.hand.splice(cardIdx, 1)
        if (!card.virtual) state.discard.push(card)
        state.attackUsedThisTurn++
        markBasicUsed(general, BasicCardName.ATTACK)
        consumeWineBonus(state, general)

        const targetNames = targets.map(t => `【${getGeneralName(t)}】`).join('、')
        addLog(state, `【${getGeneralName(general)}】对${targetNames}使用了${cardFullName(card)}${hasFangtian && targets.length > 1 ? '（方天画戟）' : ''}`)

        // 激昂（孙策）：使用红色杀时摸牌
        const isRedKill = card.suit === CardSuit.HEART || card.suit === CardSuit.DIAMOND
        if (isRedKill) {
            if (hasSkill(general, 'sunce_jiang')) {
                const bonus = drawCards(state, 1)
                general.hand.push(...bonus)
                addLog(state, `【${getGeneralName(general)}】发动【激昂】摸 1 张牌`)
            }
            for (const t of targets) {
                if (hasSkill(t, 'sunce_jiang')) {
                    const bonus = drawCards(state, 1)
                    t.hand.push(...bonus)
                    addLog(state, `【${getGeneralName(t)}】发动【激昂】摸 1 张牌`)
                }
            }
        }

        const attackerIdx = state.generals.indexOf(general)
        const attackerDef = getGeneralById(general.generalId)

        // 对每个目标逐一处理（反向入队使第一个目标先处理）
        for (let i = targets.length - 1; i >= 0; i--) {
            const target = targets[i]
            const targetIdx = state.generals.indexOf(target)

            // 智迟（陈宫）：本回合受到伤害后，【杀】对其无效
            if (isZhichiImmune(state, target)) {
                addLog(state, `【${getGeneralName(target)}】的【智迟】使【杀】对其无效`)
                continue
            }

            // 父荫（诸葛瞻）：锁定技，每回合第一次成为【杀】的目标后，
            // 若其手牌数不大于使用者，此牌对其无效
            if (hasSkill(target, 'zhugezhan_fuyin') && target.fuyinTurn !== state.turnSerial
                && target.hand.length <= general.hand.length) {
                target.fuyinTurn = state.turnSerial
                addLog(state, `【${getGeneralName(target)}】发动【父荫】，${cardFullName(card)}对其无效`)
                continue
            }

            // 天命（刘协）：成为【杀】的目标后，可弃置两张牌并摸两张牌
            if (hasSkill(target, 'liuxie_tianming') && expHasAnyCard(target)
                && !state.pendingResponseQueue.some(q => (q.context as any)?.skillId === 'liuxie_tianming'
                    && q.targetGeneralIndex === targetIdx)) {
                state.pendingResponseQueue.push({
                    type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                    targetGeneralIndex: targetIdx,
                    context: {
                        skillId: 'liuxie_tianming', skillName: '天命',
                        description: '弃置两张牌（不足则全弃）并摸两张牌',
                    },
                })
                addLog(state, `【${getGeneralName(target)}】可发动【天命】`)
            }

            // 伏骑（麹义）：锁定技，与你距离为1的其他角色不能响应此牌
            const fuqiSlash = hasSkill(general, 'quyi_fuqi')
                && getAttackRange(general, target, state.generals).distance === 1
            if (fuqiSlash) {
                addLog(state, `【${getGeneralName(general)}】发动【伏骑】，【${getGeneralName(target)}】不能响应${cardFullName(card)}`)
            }

            // 马超铁骑：需手动触发（在 DODGE 之前插入确认）
            let tieqiPending = false
            if (hasSkill(general, 'machao_tieqi') && state.deck.length > 0) {
                tieqiPending = true
            }

            // 仁王盾：黑色杀无效
            if (target.equip.armor?.name === EquipmentCardName.NIOH_SHIELD && !card.virtual) {
                // 青釭剑无视防具
                if (general.equip.weapon?.name !== EquipmentCardName.QINGGANG_SWORD) {
                    if (card.suit === CardSuit.SPADE || card.suit === CardSuit.CLUB) {
                        addLog(state, `【${getGeneralName(target)}】的仁王盾抵消了黑色【杀】`)
                        continue
                    }
                }
            }

            // 吕布无双：需要 2 张闪；短兵：距离1的目标需 2 张闪
            let requiredDodges = hasSkill(general, 'lvbu_wushuang') ? 2 : 1
            // 肉林（董卓）：对女性角色使用【杀】，其需连续使用两张【闪】
            const dongzhuoRoulin = (hasSkill(general, 'dongzhuo_roulin') && (target as any).gender === 'female')
                || (hasSkill(target, 'dongzhuo_roulin') && (general as any).gender === 'female')
            if (dongzhuoRoulin) requiredDodges = Math.max(requiredDodges, 2)
            if (hasSkill(general, 'dingfeng_duanbing')
                && getAttackRange(general, target, state.generals).distance <= 1) {
                requiredDodges = Math.max(requiredDodges, 2)
            }

            // 忠勇（周仓）在【杀】结算结束后触发（见 maybeZhongyong）

            // 享乐（刘禅）：成为【杀】的目标后，使用者弃一张基本牌，否则此【杀】对其无效
            if (hasSkill(target, 'liushan_xangle')) {
                const xlBasic = general.hand.find(c => c.category === CardCategory.BASIC)
                if (xlBasic) {
                    removeCardFromHandOrEquip(state, general, xlBasic.id)
                    addLog(state, `【${getGeneralName(target)}】【享乐】：【${getGeneralName(general)}】弃置${cardFullName(xlBasic)}`)
                } else {
                    addLog(state, `【${getGeneralName(target)}】【享乐】：【${getGeneralName(general)}】没有基本牌可弃，此【杀】对其无效`)
                    continue
                }
            }

            triggerJianjiang(state, target, general)

            // 贞烈（王异/界王异）：失去1点体力令此【杀】无效，并弃置来源一张牌
            if (hasSkill(target, 'wangyi_zhenlie') || hasSkill(target, 'wangyi_jie_zhenlie')) {
                const zhenlieJie = hasSkill(target, 'wangyi_jie_zhenlie')
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                    targetGeneralIndex: targetIdx,
                    context: {
                        skillId: zhenlieJie ? 'wangyi_jie_zhenlie' : 'wangyi_zhenlie',
                        skillName: '贞烈',
                        description: zhenlieJie
                            ? '失去1点体力，令此【杀】对你无效，然后获得其一张牌或于本回合结束阶段发动“秘计”'
                            : '失去1点体力，令此【杀】对你无效，然后弃置来源一张牌',
                        attackerIndex: attackerIdx,
                        attackCard: card,
                        requiredDodges,
                    },
                })
                continue
            }

            // 流离（大乔）：被杀时可弃1牌转移目标
            if (hasSkill(target, 'daqiao_liuli') && (target.hand.length > 0 || target.equip.weapon || target.equip.armor || target.equip.plus_horse || target.equip.minus_horse)) {
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                    targetGeneralIndex: targetIdx,
                    context: {
                        skillId: 'daqiao_liuli',
                        skillName: '流离',
                        description: '弃1张牌，将此杀转移给攻击范围内另一角色',
                        attackerIndex: attackerIdx,
                        attackCard: card,
                        requiredDodges,
                    },
                })
                continue
            }

            // 推 DODGE 响应
            state.pendingResponseQueue.unshift({
                type: ResponseType.DODGE,
                targetGeneralIndex: targetIdx,
                context: {
                    attackerGeneralIndex: attackerIdx,
                    requiredDodges,
                    dodgesReceived: 0,
                    attackCard: card,
                    // 诈降/天义：红色【杀】不能被【闪】响应；伏骑：距离1的角色不能响应
                    unavoidable: (card as any).unavoidable === true || fuqiSlash
                        || (general.slashUnavoidableTurn && (card.suit === CardSuit.HEART || card.suit === CardSuit.DIAMOND)),
                },
            })

            // 慷忾（曹昂）：一名角色成为【杀】目标后，距离1以内的曹昂可摸一并交牌
            triggerKangkai(state, general, target)

            // 专对（秦宓）：使用【杀】指定目标后可与其拼点，赢则其不能使用【闪】响应
            if (hasSkill(general, 'qinmi_zhuandui') && target.hand.length > 0 && general.hand.length > 0) {
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                    targetGeneralIndex: attackerIdx,
                    context: {
                        skillId: 'qinmi_zhuandui_atk', skillName: '专对',
                        description: `与【${getGeneralName(target)}】拼点：若你赢，其不能使用【闪】响应此【杀】`,
                        zhuanDuiTargetIndex: targetIdx,
                        attackCardId: card.id,
                    },
                })
            }

            // 专对（秦宓）：成为【杀】目标后，可与其拼点，赢则此【杀】对你无效
            if (hasSkill(target, 'qinmi_zhuandui') && target.hand.length > 0 && general.hand.length > 0) {
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                    targetGeneralIndex: targetIdx,
                    context: {
                        skillId: 'qinmi_zhuandui_def', skillName: '专对',
                        description: `与【${getGeneralName(general)}】拼点：若你赢，此【杀】对你无效`,
                        zhuanDuiAttackerIndex: attackerIdx,
                        zhuanDuiTargetIndex: targetIdx,
                        attackCardId: card.id,
                    },
                })
            }

            // 烈弓②（界黄忠）：使用【杀】指定目标后，可执行符合条件的项
            if (hasSkill(general, 'huangzhong_liegong')) {
                const lgNoDodge = general.hand.length >= target.hand.length
                const lgBonus = general.hp <= target.hp
                if (lgNoDodge || lgBonus) {
                    const lgOptions: { action: string; label: string }[] = []
                    lgOptions.push({
                        action: 'liegong',
                        label: [
                            lgNoDodge ? '其不能使用【闪】响应此【杀】' : '',
                            lgBonus ? '此【杀】对其伤害+1' : '',
                        ].filter(Boolean).join('；'),
                    })
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                        targetGeneralIndex: attackerIdx,
                        context: {
                            skillId: 'huangzhong_liegong',
                            skillName: '烈弓',
                            description: `对【${getGeneralName(target)}】发动【烈弓】`,
                            options: lgOptions,
                            liegongTargetIndex: targetIdx,
                            liegongNoDodge: lgNoDodge,
                            liegongBonus: lgBonus,
                        },
                    })
                }
            }

            // 拒战（严颜）：阴 → 获得目标一张牌；阳 → 与其各摸一张牌（均由玩家选择发动）
            // 必须在【闪】之前询问：阳的效果是“成为杀的目标后”立刻各摸一张
            if (hasSkill(general, 'yanyan_juzhan') && general.juzhanYang === false) {
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                    targetGeneralIndex: state.generals.indexOf(general),
                    context: {
                        skillId: 'yanyan_juzhan',
                        skillName: '拒战',
                        description: '（阴）获得其一张牌，本回合不能再对其使用牌',
                        juzhanPhase: 'yin',
                        slashTargetIndex: targetIdx,
                        slashSourceIndex: attackerIdx,
                    },
                })
                addLog(state, `【${getGeneralName(general)}】可发动【拒战】（阴）`)
            } else if (hasSkill(target, 'yanyan_juzhan') && target.juzhanYang !== false) {
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                    targetGeneralIndex: state.generals.indexOf(target),
                    context: {
                        skillId: 'yanyan_juzhan',
                        skillName: '拒战',
                        description: '（阳）与其各摸一张牌，其本回合不能再对你使用牌',
                        juzhanPhase: 'yang',
                        slashTargetIndex: targetIdx,
                        slashSourceIndex: attackerIdx,
                    },
                })
                addLog(state, `【${getGeneralName(target)}】可发动【拒战】（阳）`)
            }

            // 铁骑确认：在 DODGE 之前插入（界马超为改版判定）
            if (hasSkill(general, 'machao_jie_tieqi') && state.deck.length > 0) {
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                    targetGeneralIndex: attackerIdx,
                    context: {
                        skillId: 'machao_jie_tieqi',
                        skillName: '铁骑',
                        description: `对【${getGeneralName(target)}】发动铁骑？判定后其须弃同花色牌，否则不能出闪`,
                        tieqiTargetIndex: targetIdx,
                        attackCardId: card.id,
                    },
                })
            } else if (tieqiPending) {
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                    targetGeneralIndex: attackerIdx,
                    context: {
                        skillId: 'machao_tieqi',
                        skillName: '铁骑',
                        description: `对【${getGeneralName(target)}】发动铁骑？判定红色则目标不能出闪`,
                        tieqiTargetIndex: targetIdx,
                        attackCardId: card.id,
                    },
                })
            }

            // 谋溃（伏完）：摸一 / 弃一 / 两项都选；只有两项都选才在杀被抵消时反噬
            if (hasSkill(general, 'fuwan_moukui')) {
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                    targetGeneralIndex: attackerIdx,
                    context: {
                        skillId: 'fuwan_moukui',
                        skillName: '谋溃',
                        description: moukuiDescription(target),
                        options: moukuiOptions(target),
                        moukuiTargetIndex: targetIdx,
                        attackerIndex: attackerIdx,
                        attackCard: card,
                        requiredDodges,
                    },
                })
            }

            // 鞬出（庞德）：杀指定目标后，可弃其一张牌
            if (hasSkill(general, 'pangde_jianchu')
                && (target.hand.length > 0 || Object.values(target.equip).some(Boolean))) {
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                    targetGeneralIndex: attackerIdx,
                    context: {
                        skillId: 'pangde_jianchu',
                        skillName: '鞬出',
                        description: `弃【${getGeneralName(target)}】一张牌：若为装备牌则其不能出闪，否则其获得此【杀】`,
                        jianchuTargetIndex: targetIdx,
                        attackCardId: card.id,
                        attackCard: card,
                    },
                })
            }

            // 雌雄双股剑：杀异性目标时可触发
            maybeDoubleSwords(state, attackerIdx, targetIdx)
        }

        // 谏征（秦宓）/ 龙临（闪赵云）：须先于【闪】结算，故在整个目标循环之后入队
        triggerJianzheng(state, general, card, targets)
        triggerLonglin(state, general, card)
        return
    }

    if (name === BasicCardName.WINE) {
        // 禁酒（界高顺）：自己的【酒】均视为点数为K的【杀】；其回合内其他角色不能使用【酒】
        if (hasSkill(general, 'gaoshun_jinjiu')) {
            if (targets.length === 0) return { error: '请选择【杀】的目标' }
            const jjSlash: Card = { ...card, name: BasicCardName.ATTACK, value: 13, nature: undefined }
            return handleBasicCard(state, general, jjSlash, cardIdx, targets)
        }
        const jinjiuOwner = getActiveGeneral(state)
        if (jinjiuOwner && jinjiuOwner !== general && jinjiuOwner.alive && hasSkill(jinjiuOwner, 'gaoshun_jinjiu')) {
            return { error: '【禁酒】：本回合其他角色不能使用【酒】' }
        }
        // 酒池（界董卓）：使用【酒】无次数限制
        if (general.wineDrunk && !hasSkill(general, 'dongzhuo_jiuchi')) return { error: '本回合已饮过酒' }
        if (cardIdx >= 0) general.hand.splice(cardIdx, 1)
        if (!card.virtual) state.discard.push(card)
        general.wineDrunk = true
        markBasicUsed(general, BasicCardName.WINE)
        addLog(state, `【${getGeneralName(general)}】饮【酒】，下一张【杀】伤害+1`)
        return
    }

    if (name === BasicCardName.PEACH) {
        // 桃只能在非濒死时对自己使用，不需要指定目标
        if (general.hp >= general.maxHp) return { error: '你已满血，不能使用【桃】' }
        if (cardIdx >= 0) general.hand.splice(cardIdx, 1)
        if (!card.virtual) state.discard.push(card)
        general.hp = Math.min(general.hp + 1, general.maxHp)
        markBasicUsed(general, BasicCardName.PEACH)
        addLog(state, `【${getGeneralName(general)}】使用${cardFullName(card)}，回复至 ${general.hp}/${general.maxHp}`)
        triggerDianhuRecover(state, general)
        triggerLiangzhu(state, general)
        return
    }

    if (name === BasicCardName.DODGE) {
        return { error: '【闪】不能主动使用' }
    }
}

/** 武圣（关羽）：将红色牌当杀使用，走完整杀逻辑（含武器效果） */
function handleWushengAttack(
    state: GameState,
    general: GeneralInstance,
    card: Card,
    cardIdx: number,
    targets: GeneralInstance[]
): { error: string } | void {
    // 杀次数限制
    let maxAttacks = 1
    if (hasSkill(general, 'zhangfei_paoxiao')) {
        maxAttacks = 999
    } else if (general.equip.weapon?.name === EquipmentCardName.CROSSBOW) {
        maxAttacks = 4
    }
    maxAttacks += (general.dufengBonus ?? 0) + (general.extraSlashCount ?? 0)
        + (general.qimouSlashBonus ?? 0)
        + (hasSkill(general, 'lvbu_jing_shenji') ? 1 : 0)
        + (general.slashLimitDelta ?? 0)
        + (general.mingjianBonus ? 1 : 0)
        + (hasSkill(general, 'doudizhu_bahu') ? 1 : 0)
    if (state.attackUsedThisTurn >= maxAttacks) return { error: `每回合最多使用 ${maxAttacks} 张【杀】` }

    // 方天画戟：最后一张手牌为杀时可额外指定最多2个目标
    const isLastCard = general.hand.length === 1
    const hasFangtian = general.equip.weapon?.name === EquipmentCardName.FANGTIAN_HALBERD
    let maxTargets = (isLastCard && hasFangtian) ? 3 : 1
    if (hasSkill(general, 'lvbu_jing_shenji')) maxTargets = Math.max(maxTargets, 3)
    if (targets.length < 1 || targets.length > maxTargets) {
        return { error: maxTargets > 1 ? `方天画戟最多指定${maxTargets}个目标` : '【杀】需要指定一个目标' }
    }

    if (targets.some(t => t === general)) return { error: '不能对自己使用【杀】' }
    for (const t of targets) {
        if (hasSkill(t, 'zhugeliang_kongcheng') && t.hand.length === 0) {
            return { error: `【${getGeneralName(t)}】发动【空城】，不能被【杀】指定` }
        }
    }
    for (const t of targets) {
        const rangeInfo = getAttackRange(general, t, state.generals)
        if (!rangeInfo.inRange) {
            return { error: distanceTooFarText(getGeneralName(t), rangeInfo) }
        }
    }

    general.hand.splice(cardIdx, 1)
    state.discard.push(card)
    state.attackUsedThisTurn++
    markBasicUsed(general, BasicCardName.ATTACK)
    consumeWineBonus(state, general)

    const targetNames = targets.map(t => `【${getGeneralName(t)}】`).join('、')
    addLog(state, `【${getGeneralName(general)}】发动【武圣】，将${suitSymbol(card.suit)}${valueName(card.value)}当杀对${targetNames}使用${hasFangtian && targets.length > 1 ? '（方天画戟）' : ''}`)

    // 激昂（孙策）：红色杀
    if (hasSkill(general, 'sunce_jiang')) {
        const bonus = drawCards(state, 1)
        general.hand.push(...bonus)
        addLog(state, `【${getGeneralName(general)}】发动【激昂】摸 1 张牌`)
    }
    for (const t of targets) {
        if (hasSkill(t, 'sunce_jiang')) {
            const bonus = drawCards(state, 1)
            t.hand.push(...bonus)
            addLog(state, `【${getGeneralName(t)}】发动【激昂】摸 1 张牌`)
        }
    }

    const attackerIdx = state.generals.indexOf(general)
    const attackerDef = getGeneralById(general.generalId)

    for (let i = targets.length - 1; i >= 0; i--) {
        const target = targets[i]
        const targetIdx = state.generals.indexOf(target)

        // 智迟（陈宫）：本回合受到伤害后，【杀】对其无效
        if (isZhichiImmune(state, target)) {
            addLog(state, `【${getGeneralName(target)}】的【智迟】使【杀】对其无效`)
            continue
        }

        let tieqiPending = false
        if (hasSkill(general, 'machao_tieqi') && state.deck.length > 0) {
            tieqiPending = true
        }

        // 仁王盾：黑色杀无效（武圣杀一定是红色，不会触发）
        const requiredDodges = hasSkill(general, 'lvbu_wushuang') ? 2 : 1

        if (hasSkill(target, 'daqiao_liuli') && (target.hand.length > 0 || target.equip.weapon || target.equip.armor || target.equip.plus_horse || target.equip.minus_horse)) {
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: targetIdx,
                context: {
                    skillId: 'daqiao_liuli',
                    skillName: '流离',
                    description: '弃1张牌，将此杀转移给攻击范围内另一角色',
                    attackerIndex: attackerIdx,
                    attackCard: card,
                    requiredDodges,
                },
            })
            continue
        }

        state.pendingResponseQueue.unshift({
            type: ResponseType.DODGE,
            targetGeneralIndex: targetIdx,
            context: {
                attackerGeneralIndex: attackerIdx,
                requiredDodges,
                dodgesReceived: 0,
                attackCard: card,
            },
        })

        if (tieqiPending) {
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: attackerIdx,
                context: {
                    skillId: 'machao_tieqi',
                    skillName: '铁骑',
                    description: `对【${getGeneralName(target)}】发动铁骑？判定红色则目标不能出闪`,
                    tieqiTargetIndex: targetIdx,
                    attackCardId: card.id,
                },
            })
        }

        // 谋溃（伏完）：摸一 / 弃一 / 两项都选；只有两项都选才在杀被抵消时反噬
        if (hasSkill(general, 'fuwan_moukui')) {
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: attackerIdx,
                context: {
                    skillId: 'fuwan_moukui',
                    skillName: '谋溃',
                    description: moukuiDescription(target),
                    options: moukuiOptions(target),
                    moukuiTargetIndex: targetIdx,
                    attackerIndex: attackerIdx,
                    attackCard: card,
                    requiredDodges,
                },
            })
        }

        maybeDoubleSwords(state, attackerIdx, targetIdx)
    }
    return
}

// ─── 锦囊牌 ──────────────────────────────────────────────────

/**
 * 舍宴（董允）：当你成为普通锦囊牌的目标时，可以令此牌额外指定或取消一名目标。
 * 目标在结算前即已确定，故这里压入询问并延迟整张牌的结算（与求援同一模式）。
 * 返回 true 表示本次用牌已延迟。
 */
function maybeSheyanDefer(
    state: GameState,
    caster: GeneralInstance,
    card: Card,
    targets: GeneralInstance[],
    extra?: Record<string, unknown>,
): boolean {
    // 群体/全场锦囊在各自分支里另行询问（目标由引擎内部展开），这里不接管
    const selfExpandNames: string[] = [
        TrickCardName.BARBARIANS, TrickCardName.ARROWS,
        TrickCardName.PEACH_GARDEN, TrickCardName.HARVEST,
    ]
    if (selfExpandNames.includes(card.name)) return false
    const owner = targets.find(t => t.alive && t !== caster && hasSkill(t, 'dongyun_sheyan'))
    if (!owner) return false
    const ownerIdx = state.generals.indexOf(owner)
    const casterIdx = state.generals.indexOf(caster)
    const baseIndices = targets.map(t => state.generals.indexOf(t))
    const isBlack = card.suit === CardSuit.SPADE || card.suit === CardSuit.CLUB
    const candidates = state.generals
        .map((g, idx) => ({ g, idx }))
        .filter(({ g, idx }) => {
            if (!g.alive || idx === ownerIdx || idx === casterIdx) return false
            // 已是目标：可以选择令此牌对其无效
            if (baseIndices.includes(idx)) return true
            if (hasSkill(g, 'jiaxu_weimu') && isBlack) return false
            if (isZhichiImmune(state, g)) return false
            if (card.name === TrickCardName.DUEL
                && hasSkill(g, 'zhugeliang_kongcheng') && g.hand.length === 0) return false
            if (card.name === TrickCardName.FIRE_ATTACK && g.hand.length === 0) return false
            return true
        })
        .map(({ idx }) => idx)
    if (candidates.length === 0) return false
    state.pendingResponseQueue.unshift({
        type: ResponseType.SKILL_CHOOSE_TARGET,
        targetGeneralIndex: ownerIdx,
        context: {
            skillId: 'dongyun_sheyan',
            skillName: '舍宴',
            description: '令此牌额外指定一名目标；若选择已是目标的角色，则此牌对其无效',
            candidateIndices: candidates,
            sheyanCardName: card.name,
            sheyanDefer: true,
            sheyanOwnerIndex: ownerIdx,
            sheyanCasterIndex: casterIdx,
            sheyanCardId: card.id,
            sheyanBaseTargets: baseIndices,
            sheyanExtra: extra ?? {},
        },
    })
    addLog(state, `【${getGeneralName(owner)}】可发动【舍宴】`)
    return true
}

/** 舍宴结算（或放弃）后，按新的目标列表继续本次用牌 */
function resumeSheyanUse(state: GameState, ctx: any, chosenIndex?: number): void {
    const owner = state.generals[(ctx.sheyanOwnerIndex as number)]
    const caster = state.generals[(ctx.sheyanCasterIndex as number)]
    if (!caster?.alive) return
    const cardIdx = caster.hand.findIndex(c => c.id === ctx.sheyanCardId)
    if (cardIdx === -1) return
    const card = caster.hand[cardIdx]
    const baseIndices = [...((ctx.sheyanBaseTargets as number[]) ?? [])]
    const baseTargets = baseIndices.map(i => state.generals[i]).filter(g => g?.alive)
    if (baseTargets.length === 0) return
    const resumeExtra = {
        ...((ctx.sheyanExtra as Record<string, unknown>) ?? {}),
        __sheyanResume: true,
    }
    const chosen = chosenIndex === undefined ? undefined : state.generals[chosenIndex]
    if (!chosen?.alive) {
        handleTrickCard(state, caster, card, cardIdx, baseTargets, resumeExtra)
        return
    }
    if (baseIndices.includes(chosenIndex as number)) {
        // 已是目标：令此牌对其无效（铁索连环的目标是显式列表，直接移除更贴合“取消目标”）
        if (card.name === TrickCardName.IRON_CHAIN && baseTargets.length > 1) {
            const kept = baseTargets.filter(t => t !== chosen)
            addLog(state, `【${getGeneralName(owner)}】发动【舍宴】，【${getGeneralName(chosen)}】不再是${cardDisplayName(card)}的目标`)
            handleTrickCard(state, caster, card, cardIdx, kept, resumeExtra)
            return
        }
        chosen.sheyanTrick = { name: card.name, turn: state.turnSerial ?? 0 }
        addLog(state, `【${getGeneralName(owner)}】发动【舍宴】，${cardDisplayName(card)}对【${getGeneralName(chosen)}】无效`)
        handleTrickCard(state, caster, card, cardIdx, baseTargets, resumeExtra)
        return
    }
    addLog(state, `【${getGeneralName(owner)}】发动【舍宴】，${cardDisplayName(card)}对【${getGeneralName(chosen)}】也生效`)
    const first = handleTrickCard(state, caster, card, cardIdx, baseTargets, resumeExtra)
    if (first && 'error' in first) {
        addLog(state, `【舍宴】${first.error}`)
        return
    }
    // 非目标角色成为额外目标：排在本次结算之后单独生效（各自有无懈窗口）
    state.pendingResponseQueue.push({
        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
        targetGeneralIndex: chosenIndex as number,
        context: {
            autoExecute: true,
            skillId: 'dongyun_sheyan_extra',
            sheyanCasterIndex: ctx.sheyanCasterIndex,
            sheyanExtraTarget: chosenIndex,
            sheyanCardId: card.id,
            sheyanExtra: ctx.sheyanExtra ?? {},
        },
    })
}

/** 舍宴的额外目标：在本次结算完成后单独生效一次 */
function resumeSheyanExtra(state: GameState, ctx: any): void {
    const caster = state.generals[(ctx.sheyanCasterIndex as number)]
    const target = state.generals[(ctx.sheyanExtraTarget as number)]
    if (!caster?.alive || !target?.alive) return
    const card = state.discard.find(c => c.id === ctx.sheyanCardId)
        ?? caster.hand.find(c => c.id === ctx.sheyanCardId)
    if (!card) return
    const outcome = handleTrickCard(state, caster, card, -1, [target], {
        ...((ctx.sheyanExtra as Record<string, unknown>) ?? {}),
        __sheyanResume: true,
        __sheyanSecond: true,
        __sheyanAdded: true,
    })
    if (outcome && 'error' in outcome) addLog(state, `【舍宴】${outcome.error}`)
}

function handleTrickCard(
    state: GameState,
    general: GeneralInstance,
    card: Card,
    cardIdx: number,
    targets: GeneralInstance[],
    extra?: Record<string, unknown>
): { error: string } | void {
    const { name } = card

    // 惴恐（界伏皇后）：拼点赢后，其本回合使用牌只能指定自己为目标（AOE 锦囊会波及其他角色）
    if (general.useOnlySelfTurn !== undefined && general.useOnlySelfTurn === state.turnSerial) {
        const aoeNames: string[] = [
            TrickCardName.BARBARIANS, TrickCardName.ARROWS,
            TrickCardName.PEACH_GARDEN, TrickCardName.HARVEST, TrickCardName.IRON_CHAIN,
        ]
        if (aoeNames.includes(name)) {
            return { error: '【惴恐】：本回合使用牌只能指定自己为目标' }
        }
    }

    // 黄月英集智：使用普通锦囊时立即摸 1 牌（在无懈可击询问之前，这样摸到无懈可击可以立即使用）
    const triggerJizhi = card.trickType === TrickType.INSTANT && hasSkill(general, 'huangyueying_jizhi')
        && !(extra as any)?.__sheyanSecond
        && (general.generalId !== 'huangyueying_jie' || !(card as any).virtual)

    // 延时锦囊
    if (card.trickType === TrickType.DELAYED) {
        if (targets.length !== 1) return { error: '延时锦囊需要指定一个目标' }
        const target = targets[0]

        // 帷幕：贾诩不能被黑色锦囊指定
        if (hasSkill(target, 'jiaxu_weimu') && (card.suit === CardSuit.SPADE || card.suit === CardSuit.CLUB)) {
            return { error: '目标发动【帷幕】，不能被黑色锦囊指定' }
        }

        // 雄乱（张绣）：判定区已废除
        if (target.abolishedJudgeZone) {
            return { error: `【${getGeneralName(target)}】的判定区已废除（雄乱），不能指定` }
        }

        // 闪电只能对自己使用（判定区由自己承担判定风险）
        if (card.name === TrickCardName.LIGHTNING && target !== general) {
            return { error: '【闪电】只能对自己使用' }
        }

        // 兵粮寸断距离限制：距离 ≤ 1（奇才无视距离限制）
        if (card.name === TrickCardName.SUPPLY_SHORTAGE) {
            if (!hasSkill(general, 'huangyueying_qicai')) {
                const rangeInfo = getAttackRange(general, target, state.generals)
                if (rangeInfo.distance > 1) return { error: '兵粮寸断目标距离太远（需距离1以内）' }
            }
        }

        if (target.judgeZone.some((c) => c.name === card.name)) {
            return { error: '目标判定区已有相同延时锦囊' }
        }
        general.hand.splice(cardIdx, 1)
        target.judgeZone.push(card)
        addLog(state, `【${getGeneralName(general)}】对【${getGeneralName(target)}】放置${cardFullName(card)}`)
        return
    }

    // 无懈可击不能主动使用
    if (name === TrickCardName.NEGATE) return { error: '【无懈可击】只能在响应时使用' }

    // ── 目标合法性检查（必须在移除手牌之前，否则 return error 后牌已消失）──
    const isBlackCard = card.suit === CardSuit.SPADE || card.suit === CardSuit.CLUB

    // 智迟（陈宫）：回合外受伤后，普通锦囊牌对其无效（延时锦囊已在上方 return，不受影响）
    const zhichiTarget = targets.find(t => isZhichiImmune(state, t))
    if (zhichiTarget) {
        return { error: `【${getGeneralName(zhichiTarget)}】发动【智迟】，【${cardDisplayName(card)}】对其无效` }
    }

    // 奋威（界甘宁限定技）：令群体锦囊对己方角色无效（由玩家决定是否发动）
    let fenweiPending: PendingResponse | undefined
    const fenweiRecipients = name === TrickCardName.IRON_CHAIN
        ? targets
        : (name === TrickCardName.BARBARIANS || name === TrickCardName.ARROWS)
            ? state.generals.filter(g => g.alive && g !== general)
            : []
    if (fenweiRecipients.length >= 2) {
        const fenwei = state.generals.find(g => g.alive && hasSkill(g, 'ganning_jie_fenwei') && !g.usedLimitedSkills.includes('ganning_jie_fenwei'))
        if (fenwei) {
            const protectedTargets = fenweiRecipients.filter(t => t.faction === fenwei.faction)
            if (protectedTargets.length > 0) {
                fenweiPending = {
                    type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                    targetGeneralIndex: state.generals.indexOf(fenwei),
                    context: {
                        skillId: 'ganning_jie_fenwei',
                        skillName: '奋威',
                        description: `令【${cardDisplayName(card)}】对 ${protectedTargets.length} 名己方角色无效（限定技）`,
                        fenweiCardId: card.id,
                        fenweiTrickName: card.name,
                        fenweiProtected: protectedTargets.map(t => state.generals.indexOf(t)),
                        fenweiFaction: fenwei.faction,
                    },
                }
                addLog(state, `【${getGeneralName(fenwei)}】可发动【奋威】`)
            }
        }
    }

    if (name === TrickCardName.DISMANTLE || name === TrickCardName.STEAL || name === TrickCardName.DUEL) {
        if (targets.length !== 1) return { error: '需要指定一名目标' }
        const target = targets[0]
        // 帷幕：不能被黑色锦囊指定
        if (hasSkill(target, 'jiaxu_weimu') && isBlackCard) {
            return { error: '目标发动【帷幕】，不能被黑色锦囊指定' }
        }
    }
    // 借刀杀人是双目标锦囊：持武器者 + 被要求出杀者，两者都受帷幕约束
    if (name === TrickCardName.BORROW_SWORD) {
        if (targets.length !== 2) return { error: '借刀杀人需要指定两名目标' }
        if (targets.some((t) => hasSkill(t, 'jiaxu_weimu') && isBlackCard)) {
            return { error: '目标发动【帷幕】，不能被黑色锦囊指定' }
        }
    }
    if (name === TrickCardName.STEAL) {
        if (targets[0] === general) return { error: '不能对自己使用【顺手牵羊】' }
        // 雄乱（张绣）：对其使用牌无距离限制
        const stealXiongluanFree = general.xiongluanTurn === state.turnSerial
            && general.xiongluanTarget === state.generals.indexOf(targets[0])
        if (!stealXiongluanFree && !hasSkill(general, 'huangyueying_qicai')
            && !(extra as any)?.__sheyanAdded) {
            const rangeInfo = getAttackRange(general, targets[0], state.generals)
            if (rangeInfo.distance > 1) return { error: '目标距离太远（需距离1以内）' }
        }
    }
    if (name === TrickCardName.DUEL) {
        const target = targets[0]
        if (target && hasSkill(target, 'zhugeliang_kongcheng') && target.hand.length === 0) {
            return { error: '目标发动【空城】，不能被决斗指定' }
        }
    }

    // 舍宴（董允）：成为普通锦囊牌的目标时，可令此牌额外指定或取消一名目标。
    // 目标在结算前即已确定，故这里先询问、整张牌延迟结算（与求援同一模式）
    if (card.trickType === TrickType.INSTANT && !(extra as any)?.__sheyanResume
        && maybeSheyanDefer(state, general, card, targets, extra)) return

    // 即时锦囊：统一先移除手牌（虚拟牌 cardIdx = -1，不移除任何手牌）
    if (cardIdx >= 0) general.hand.splice(cardIdx, 1)
    if (!(extra as any)?.__sheyanSecond) state.discard.push(card)

    // 黄月英集智：立即摸牌（在无懈可击之前，摸到无懈可击可以使用）
    if (triggerJizhi) {
        const extra = drawCards(state, 1)
        general.hand.push(...extra)
        addLog(state, `【${getGeneralName(general)}】发动【集智】摸 1 张牌`)
        // 集智②（界黄月英）才有弃牌换手牌上限这一项
        const jizhiBasic = general.generalId === 'huangyueying_jie'
            ? extra.find((c) => c.category === CardCategory.BASIC)
            : undefined
        if (jizhiBasic) {
            state.pendingResponseQueue.push({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(general),
                context: {
                    skillId: 'huangyueying_jizhi',
                    skillName: '集智',
                    description: `弃置${cardFullName(jizhiBasic)}，令你本回合的手牌上限+1`,
                    jizhiCardId: jizhiBasic.id,
                },
            })
        }
    }

    // 谦逊（界陆逊）/ 谦雅（孙乾）：成为唯一目标的普通锦囊时触发
    if (card.trickType === TrickType.INSTANT && targets.length === 1 && targets[0] !== general) {
        maybeQianxun(state, targets[0])
        maybeQianya(state, targets[0])
    }

    // 从谏（张绣）：成为目标数大于1的普通锦囊牌的目标时触发
    if (card.trickType === TrickType.INSTANT) {
        maybeCongjian(state, general, targets)
    }

    switch (name) {
        case TrickCardName.DRAW_TWO: {
            addLog(state, `【${getGeneralName(general)}】使用${cardFullName(card)}`)

            const gIdx = state.generals.indexOf(general)
            const effect: DeferredTrickEffect = { type: 'draw_two', userIndex: gIdx, targetIndex: -1, triggerJizhi: false }
            const deferred = pushNegateCheck(state, card.name, gIdx, -1, getGeneralName(general), effect)
            if (!deferred) {
                executeDeferredTrickEffect(state, effect)
            }
            break
        }
        case TrickCardName.DISMANTLE: {
            if (targets.length !== 1) return { error: '需要指定目标' }
            const target = targets[0]
            addLog(state, `【${getGeneralName(general)}】对【${getGeneralName(target)}】使用${cardFullName(card)}`)

            const gIdx = state.generals.indexOf(general)
            const tIdx = state.generals.indexOf(target)
            const effect: DeferredTrickEffect = { type: 'dismantle', userIndex: gIdx, targetIndex: tIdx, triggerJizhi: false }
            const deferred = pushNegateCheck(state, card.name, gIdx, tIdx, getGeneralName(target), effect)
            if (!deferred) {
                executeDeferredTrickEffect(state, effect)
            }
            break
        }
        case TrickCardName.STEAL: {
            if (targets.length !== 1) return { error: '需要指定目标' }
            const target = targets[0]
            addLog(state, `【${getGeneralName(general)}】对【${getGeneralName(target)}】使用${cardFullName(card)}`)

            const gIdx = state.generals.indexOf(general)
            const tIdx = state.generals.indexOf(target)
            const effect: DeferredTrickEffect = { type: 'steal', userIndex: gIdx, targetIndex: tIdx, triggerJizhi: false }
            const deferred = pushNegateCheck(state, card.name, gIdx, tIdx, getGeneralName(target), effect)
            if (!deferred) {
                executeDeferredTrickEffect(state, effect)
            }
            break
        }
        case TrickCardName.DUEL: {
            if (targets.length !== 1) return { error: '需要指定目标' }
            const target = targets[0]
            addLog(state, `【${getGeneralName(general)}】向【${getGeneralName(target)}】发起【决斗】`)

            // 父荫（诸葛瞻）：锁定技，每回合第一次成为【决斗】的目标后，
            // 若其手牌数不大于使用者，此牌对其无效
            if (hasSkill(target, 'zhugezhan_fuyin') && target.fuyinTurn !== state.turnSerial
                && target.hand.length <= general.hand.length) {
                target.fuyinTurn = state.turnSerial
                addLog(state, `【${getGeneralName(target)}】发动【父荫】，【决斗】对其无效`)
                break
            }

            // 激昂（使用时立即触发，不受无懈影响）
            if (hasSkill(general, 'sunce_jiang')) {
                const bonus = drawCards(state, 1)
                general.hand.push(...bonus)
                addLog(state, `【${getGeneralName(general)}】发动【激昂】摸 1 张牌`)
            }
            if (hasSkill(target, 'sunce_jiang')) {
                const bonus = drawCards(state, 1)
                target.hand.push(...bonus)
                addLog(state, `【${getGeneralName(target)}】发动【激昂】摸 1 张牌`)
            }

            const gIdx = state.generals.indexOf(general)
            const tIdx = state.generals.indexOf(target)
            const effect: DeferredTrickEffect = { type: 'duel', userIndex: gIdx, targetIndex: tIdx, triggerJizhi: false, extra: { duelCardId: card.id } }
            const deferred = pushNegateCheck(state, card.name, gIdx, tIdx, getGeneralName(target), effect)
            if (!deferred) {
                executeDeferredTrickEffect(state, effect)
            }
            break
        }
        case TrickCardName.BARBARIANS: {
            addLog(state, `【${getGeneralName(general)}】使用${cardFullName(card)}`)

            const direction = state.mode === GameMode.HUANLE_SHUANG
                ? 'counterclockwise'
                : ((extra?.direction as string) || 'clockwise')
            let others = getDirectionalTargets(state, general, direction).filter(t => t.alive)
            const gIdx = state.generals.indexOf(general)

            // 帷幕：跳过不能被黑色锦囊指定的角色
            if (isBlackCard) {
                others = others.filter(t => {
                    if (hasSkill(t, 'jiaxu_weimu')) {
                        addLog(state, `【${getGeneralName(t)}】发动【帷幕】，免疫黑色锦囊【南蛮入侵】`)
                        return false
                    }
                    return true
                })
            }

            // 巨象（界祝融）：【南蛮入侵】对其无效
            others = others.filter(t => {
                if (hasSkill(t, 'zhurong_juxiang')) {
                    addLog(state, `【${getGeneralName(t)}】发动【巨象】，【南蛮入侵】对其无效`)
                    return false
                }
                return true
            })

            // 藤甲：南蛮入侵（普通伤害）无效
            others = others.filter(t => {
                if (t.equip.armor?.name === EquipmentCardName.VINE) {
                    addLog(state, `【${getGeneralName(t)}】的【藤甲】使【南蛮入侵】无效`)
                    return false
                }
                return true
            })

            // 智迟（陈宫）：普通锦囊牌对其无效
            others = others.filter(t => {
                if (isZhichiImmune(state, t)) {
                    addLog(state, `【${getGeneralName(t)}】的【智迟】使【南蛮入侵】对其无效`)
                    return false
                }
                return true
            })

            for (let i = others.length - 1; i >= 0; i--) {
                const tIdx = state.generals.indexOf(others[i])
                triggerJianjiang(state, others[i], general)
                if (hasSkill(others[i], 'wangyi_zhenlie') || hasSkill(others[i], 'wangyi_jie_zhenlie')) {
                    const zhenlieJie = hasSkill(others[i], 'wangyi_jie_zhenlie')
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                        targetGeneralIndex: tIdx,
                        context: {
                            skillId: zhenlieJie ? 'wangyi_jie_zhenlie' : 'wangyi_zhenlie',
                            skillName: '贞烈',
                            description: zhenlieJie
                                ? '失去1点体力，令【南蛮入侵】对你无效，然后获得其一张牌或于本回合结束阶段发动“秘计”'
                                : '失去1点体力，令【南蛮入侵】对你无效，然后弃置来源一张牌',
                            attackerIndex: gIdx,
                            zhenlieAoe: { responseType: ResponseType.AOE_ATTACK, sourceIndex: gIdx, cardId: card.id, cardName: cardDisplayName(card) },
                        },
                    })
                    continue
                }
                state.pendingResponseQueue.unshift({
                    type: ResponseType.AOE_ATTACK,
                    targetGeneralIndex: tIdx,
                    context: {
                        sourceGeneralIndex: gIdx,
                        sourceCardId: card.id,
                        needsNegate: true,
                        trickCardName: card.name,
                        trickTargetName: getGeneralName(others[i]),
                    },
                })
            }

            // 从谏（张绣）：成为多目标普通锦囊牌的目标时触发（unshift 到最前，优先于各目标响应）
            // 舍宴（董允）：成为普通锦囊牌的目标时，可令此牌对另一名目标无效
            for (const syT of others) {
                if (!hasSkill(syT, 'dongyun_sheyan')) continue
                const syOthers = others
                    .filter((o) => o !== syT && o.alive)
                    .map((o) => state.generals.indexOf(o))
                if (syOthers.length === 0) continue
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_CHOOSE_TARGET,
                    targetGeneralIndex: state.generals.indexOf(syT),
                    context: {
                        skillId: 'dongyun_sheyan',
                        skillName: '舍宴',
                        description: '选择一名其他目标，令此牌对其无效',
                        candidateIndices: syOthers,
                        sheyanCardName: card.name,
                    },
                })
                addLog(state, `【${getGeneralName(syT)}】可发动【舍宴】`)
            }
            maybeCongjian(state, general, others)

            // 巨象②（界祝融）：其他角色使用的【南蛮入侵】结算后置入弃牌堆时，获得之
            for (const t of state.generals) {
                if (!t.alive || t === general || !hasSkill(t, 'zhurong_juxiang')) continue
                const jxIdx = state.discard.lastIndexOf(card)
                if (jxIdx < 0) break
                state.discard.splice(jxIdx, 1)
                t.hand.push(card)
                addLog(state, `【${getGeneralName(t)}】发动【巨象】，获得${cardFullName(card)}`)
                break
            }
            break
        }
        case TrickCardName.ARROWS: {
            addLog(state, `【${getGeneralName(general)}】使用${cardFullName(card)}`)

            const direction = state.mode === GameMode.HUANLE_SHUANG
                ? 'counterclockwise'
                : ((extra?.direction as string) || 'clockwise')
            let others = getDirectionalTargets(state, general, direction).filter(t => t.alive)
            const gIdx = state.generals.indexOf(general)

            // 帷幕：跳过不能被黑色锦囊指定的角色（万箭齐发是♥红色，标准不会触发，但防御性检查）
            if (isBlackCard) {
                others = others.filter(t => {
                    if (hasSkill(t, 'jiaxu_weimu')) {
                        addLog(state, `【${getGeneralName(t)}】发动【帷幕】，免疫黑色锦囊【万箭齐发】`)
                        return false
                    }
                    return true
                })
            }

            // 藤甲：万箭齐发（普通伤害）无效
            others = others.filter(t => {
                if (t.equip.armor?.name === EquipmentCardName.VINE) {
                    addLog(state, `【${getGeneralName(t)}】的【藤甲】使【万箭齐发】无效`)
                    return false
                }
                return true
            })

            // 智迟（陈宫）：普通锦囊牌对其无效
            others = others.filter(t => {
                if (isZhichiImmune(state, t)) {
                    addLog(state, `【${getGeneralName(t)}】的【智迟】使【万箭齐发】对其无效`)
                    return false
                }
                return true
            })

            for (let i = others.length - 1; i >= 0; i--) {
                const tIdx = state.generals.indexOf(others[i])
                triggerJianjiang(state, others[i], general)
                if (hasSkill(others[i], 'wangyi_zhenlie') || hasSkill(others[i], 'wangyi_jie_zhenlie')) {
                    const zhenlieJie = hasSkill(others[i], 'wangyi_jie_zhenlie')
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                        targetGeneralIndex: tIdx,
                        context: {
                            skillId: zhenlieJie ? 'wangyi_jie_zhenlie' : 'wangyi_zhenlie',
                            skillName: '贞烈',
                            description: zhenlieJie
                                ? '失去1点体力，令【万箭齐发】对你无效，然后获得其一张牌或于本回合结束阶段发动“秘计”'
                                : '失去1点体力，令【万箭齐发】对你无效，然后弃置来源一张牌',
                            attackerIndex: gIdx,
                            zhenlieAoe: { responseType: ResponseType.AOE_DODGE, sourceIndex: gIdx, cardId: card.id, cardName: cardDisplayName(card) },
                        },
                    })
                    continue
                }
                state.pendingResponseQueue.unshift({
                    type: ResponseType.AOE_DODGE,
                    targetGeneralIndex: tIdx,
                    context: {
                        sourceGeneralIndex: gIdx,
                        sourceCardId: card.id,
                        needsNegate: true,
                        trickCardName: card.name,
                        trickTargetName: getGeneralName(others[i]),
                    },
                })
            }

            // 从谏（张绣）：成为多目标普通锦囊牌的目标时触发（unshift 到最前，优先于各目标响应）
            // 舍宴（董允）：成为普通锦囊牌的目标时，可令此牌对另一名目标无效
            for (const syT of others) {
                if (!hasSkill(syT, 'dongyun_sheyan')) continue
                const syOthers = others
                    .filter((o) => o !== syT && o.alive)
                    .map((o) => state.generals.indexOf(o))
                if (syOthers.length === 0) continue
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_CHOOSE_TARGET,
                    targetGeneralIndex: state.generals.indexOf(syT),
                    context: {
                        skillId: 'dongyun_sheyan',
                        skillName: '舍宴',
                        description: '选择一名其他目标，令此牌对其无效',
                        candidateIndices: syOthers,
                        sheyanCardName: card.name,
                    },
                })
                addLog(state, `【${getGeneralName(syT)}】可发动【舍宴】`)
            }
            maybeCongjian(state, general, others)
            break
        }
        // NEGATE 已在 switch 前处理
        case TrickCardName.PEACH_GARDEN: {
            addLog(state, `【${getGeneralName(general)}】使用${cardFullName(card)}`)

            const direction = state.mode === GameMode.HUANLE_SHUANG
                ? 'counterclockwise'
                : ((extra?.direction as string) || 'clockwise')
            const allTargets = getDirectionalTargets(state, general, direction)
            const allWithSelf = [general, ...allTargets]
            const gIdx = state.generals.indexOf(general)

            // 满血角色无需结算，也不必为其询问无懈可击
            // 智迟（陈宫）：普通锦囊牌对其无效，不参与回复
            const healTargets = allWithSelf.filter(t => {
                if (isZhichiImmune(state, t)) {
                    addLog(state, `【${getGeneralName(t)}】的【智迟】使【桃园结义】对其无效`)
                    return false
                }
                return t.alive && t.hp < t.maxHp
            })
            if (healTargets.length === 0) {
                addLog(state, '所有角色均已满血，【桃园结义】没有产生效果')
                break
            }

            // 与南蛮/万箭保持一致：为每个目标入队 pending，逐目标开无懈窗口
            for (let i = healTargets.length - 1; i >= 0; i--) {
                const t = healTargets[i]
                const tIdx = state.generals.indexOf(t)
                state.pendingResponseQueue.unshift({
                    type: ResponseType.PEACH_GARDEN_HEAL,
                    targetGeneralIndex: tIdx,
                    context: {
                        sourceGeneralIndex: gIdx,
                        needsNegate: true,
                        trickCardName: card.name,
                        trickTargetName: getGeneralName(t),
                    },
                })
            }
            break
        }
        case TrickCardName.HARVEST: {
            addLog(state, `【${getGeneralName(general)}】使用${cardFullName(card)}`)

            const direction = state.mode === GameMode.HUANLE_SHUANG
                ? 'counterclockwise'
                : ((extra?.direction as string) || 'clockwise')
            const allTargets = getDirectionalTargets(state, general, direction)
            const allWithSelf = [general, ...allTargets]
            // 智迟（陈宫）：普通锦囊牌对其无效
            const alive = allWithSelf.filter(g => {
                if (isZhichiImmune(state, g)) {
                    addLog(state, `【${getGeneralName(g)}】的【智迟】使【五谷丰登】对其无效`)
                    return false
                }
                return g.alive
            })
            const gIdx = state.generals.indexOf(general)

            const harvestCards = drawCards(state, alive.length)
            addLog(state, `五谷丰登翻出 ${harvestCards.length} 张牌：${harvestCards.map(c => cardFullName(c)).join('、')}`)
            state.harvestPool = harvestCards

            for (let i = alive.length - 1; i >= 0; i--) {
                const tIdx = state.generals.indexOf(alive[i])
                state.pendingResponseQueue.unshift({
                    type: ResponseType.HARVEST_PICK,
                    targetGeneralIndex: tIdx,
                    context: {
                        sourceGeneralIndex: gIdx,
                        needsNegate: true,
                        trickCardName: card.name,
                        trickTargetName: getGeneralName(alive[i]),
                    },
                })
            }
            break
        }
        case TrickCardName.FIRE_ATTACK: {
            if (targets.length !== 1) return { error: '【火攻】需要指定一个目标' }
            const fireTarget = targets[0]
            if (fireTarget === general) return { error: '不能对自己使用【火攻】' }
            if (fireTarget.hand.length === 0) return { error: '【火攻】的目标须有手牌' }
            if (hasSkill(fireTarget, 'jiaxu_weimu') && isBlackCard) {
                return { error: `【${getGeneralName(fireTarget)}】发动【帷幕】，不能被黑色锦囊指定` }
            }
            const faGIdx = state.generals.indexOf(general)
            const faTIdx = state.generals.indexOf(fireTarget)
            addLog(state, `【${getGeneralName(general)}】对【${getGeneralName(fireTarget)}】使用${cardFullName(card)}`)
            const faEffect: DeferredTrickEffect = { type: 'fire_attack', userIndex: faGIdx, targetIndex: faTIdx, triggerJizhi: false }
            const faDeferred = pushNegateCheck(state, card.name, faGIdx, faTIdx, getGeneralName(fireTarget), faEffect)
            if (!faDeferred) executeDeferredTrickEffect(state, faEffect)
            break
        }
        case TrickCardName.IRON_CHAIN: {
            if (targets.length < 1 || targets.length > 2) return { error: '【铁索连环】需要指定 1-2 个目标' }
            for (const t of targets) {
                if (hasSkill(t, 'jiaxu_weimu') && isBlackCard) {
                    return { error: `【${getGeneralName(t)}】发动【帷幕】，不能被黑色锦囊指定` }
                }
            }
            const gIdx = state.generals.indexOf(general)
            const tIdxs = targets.map(t => state.generals.indexOf(t))
            addLog(state, `【${getGeneralName(general)}】使用${cardFullName(card)}：${targets.map(t => getGeneralName(t)).join('、')}`)
            const effect: DeferredTrickEffect = {
                type: 'iron_chain', userIndex: gIdx, targetIndex: tIdxs[0], triggerJizhi: false,
                extra: { targetIndices: tIdxs },
            }
            const deferred = pushNegateCheck(state, card.name, gIdx, tIdxs[0], getGeneralName(targets[0]), effect)
            if (!deferred) executeDeferredTrickEffect(state, effect)
            break
        }
        case TrickCardName.BORROW_SWORD: {
            // targets[0] = 持有武器的角色（被命令者），targets[1] = 杀的目标
            if (targets.length < 2) return { error: '借刀杀人需要指定两个目标' }
            const weaponHolder = targets[0]
            const killTarget = targets[1]
            if (!weaponHolder.equip.weapon) return { error: '第一个目标必须有武器' }
            if (weaponHolder === killTarget) return { error: '两个目标不能相同' }

            addLog(state, `【${getGeneralName(general)}】对【${getGeneralName(weaponHolder)}】使用${cardFullName(card)}，要求对【${getGeneralName(killTarget)}】出杀`)

            const gIdx = state.generals.indexOf(general)
            const tIdx = state.generals.indexOf(weaponHolder)
            const killIdx = state.generals.indexOf(killTarget)
            const effect: DeferredTrickEffect = {
                type: 'borrow_sword', userIndex: gIdx, targetIndex: tIdx, triggerJizhi: false,
                extra: { killTargetIndex: killIdx }
            }
            const deferred = pushNegateCheck(state, card.name, gIdx, tIdx, getGeneralName(weaponHolder), effect)
            if (!deferred) {
                executeDeferredTrickEffect(state, effect)
            }
            break
        }
        default:
            return { error: `尚未实现该锦囊：${name}` }
    }

    // 奋威询问放在所有目标响应入队之后，确保先决定是否令己方目标无效
    if (fenweiPending) state.pendingResponseQueue.unshift(fenweiPending)
}

// ─── 装备牌 ──────────────────────────────────────────────────

function handleEquipCard(
    state: GameState,
    general: GeneralInstance,
    card: Card,
    cardIdx: number
): { error: string } | void {
    const slot = card.equipSlot
    if (!slot) return { error: '装备牌槽位未定义' }

    general.hand.splice(cardIdx, 1)

    // 孙尚香枭姬：失去装备区牌时摸 2 张
    const oldEquip = general.equip[slot]
    if (oldEquip) {
        clearEquipSlot(state, general, slot)
        state.discard.push(oldEquip)
        triggerXiaoji(state, general)
    }

    general.equip[slot] = card
    addLog(state, `【${getGeneralName(general)}】装备了${cardFullName(card)}`)
}

// ─────────────────────────────────────────────────────────────
// 技能处理
// ─────────────────────────────────────────────────────────────

function handleUseSkillImpl(
    state: GameState,
    playerId: string,
    data: C2S_UseSkill
): { error: string } | void {
    const generalOrNull = getActiveGeneral(state)
    if (!generalOrNull || generalOrNull.playerId !== playerId) return { error: '不是你的出牌阶段' }
    if (state.turnPhase !== TurnPhase.ACTION) return { error: '当前不是出牌阶段' }
    const general = generalOrNull

    const name = getGeneralName(general)
    const targets = (data.targetIndices ?? []).map(i => state.generals[i]).filter(g => g?.alive)
    const cardIds = data.cardIds ?? []

    // 洛书版扩展（九）：新增武将的主动技能
    if (isExpansionActiveSkill(data.skillId)) {
        return handleExpansionActiveSkill(state, general, data)
    }

    // 限一次检查工具
    function checkOncePerTurn(skillId: string): { error: string } | void {
        if (general.skillsUsedThisTurn.includes(skillId)) {
            return { error: '本回合已使用过此技能' }
        }
    }
    function markUsed(skillId: string) {
        general.skillsUsedThisTurn.push(skillId)
    }

    // 限定技检查
    function checkLimited(skillId: string): { error: string } | void {
        if (general.usedLimitedSkills.includes(skillId)) {
            return { error: '此限定技已使用' }
        }
    }
    function markLimited(skillId: string) {
        general.usedLimitedSkills.push(skillId)
    }

    // 弃牌工具
    function removeCardsFromHand(ids: string[]): { error: string } | Card[] {
        const cards: Card[] = []
        const indices = ids.map(id => general.hand.findIndex(c => c.id === id))
        if (indices.some(i => i === -1)) return { error: '手牌中找不到指定的牌' }
        // 从后往前删
        const sorted = [...indices].sort((a, b) => b - a)
        for (const idx of sorted) {
            cards.push(general.hand.splice(idx, 1)[0])
        }
        return cards
    }

    switch (data.skillId) {

        // ── 龙魂（神赵云）：一至两张同花色的牌当对应牌使用
        case 'shenzhaoyun_longhun': {
            if (!hasSkill(general, 'shenzhaoyun_longhun')) return { error: '你没有此技能' }
            if (cardIds.length < 1 || cardIds.length > 2) return { error: '请选择一至两张同花色的牌' }
            const lhCards: Card[] = []
            for (const id of cardIds) {
                const c = findCardInHandOrEquip(general, id)
                if (!c) return { error: '找不到该牌' }
                lhCards.push(c)
            }
            const lhSuit = lhCards[0].suit
            if (lhCards.some(c => c.suit !== lhSuit)) return { error: '须选择同花色的牌' }
            if (lhSuit === CardSuit.CLUB) return { error: '【闪】只能在响应时使用' }
            if (lhSuit === CardSuit.SPADE) return { error: '【无懈可击】只能在响应时使用' }
            const lhDouble = lhCards.length === 2
            if (lhSuit === CardSuit.HEART) {
                if (general.hp >= general.maxHp) return { error: '你已满血' }
                for (const c of lhCards) {
                    const lhRemoved = removeCardFromHandOrEquip(state, general, c.id)
                    if ('error' in lhRemoved) return lhRemoved
                }
                const lhHeal = lhDouble ? 2 : 1
                general.hp = Math.min(general.hp + lhHeal, general.maxHp)
                addLog(state, `【${name}】发动【龙魂】，将${lhCards.length}张♥牌当【桃】使用，回复${lhHeal}点体力`)
                triggerDianhuRecover(state, general)
                return
            }
            if (targets.length === 0) return { error: '请选择【杀】的目标' }
            for (const c of lhCards) {
                const lhRemoved = removeCardFromHandOrEquip(state, general, c.id)
                if ('error' in lhRemoved) return lhRemoved
            }
            const lhSlash: Card = {
                id: `longhun_${state.log.length}_${general.hand.length}`,
                suit: CardSuit.DIAMOND,
                value: lhCards[0].value ?? 1,
                category: CardCategory.BASIC,
                name: BasicCardName.FIRE_SLASH,
                nature: 'fire',
                virtual: true,
            }
            if (lhDouble) general.longhunBonus = true
            addLog(state, `【${name}】发动【龙魂】，将${lhCards.length}张♦牌当火【杀】使用${lhDouble ? '（伤害+1）' : ''}`)
            return handleBasicCard(state, general, lhSlash, -1, targets)
        }

        // ── 镇胆①（闪赵云）：将一张非基本手牌当任意基本牌使用
        case 'shanzhaoyun_zhendan': {
            if (!hasSkill(general, 'shanzhaoyun_zhendan')) return { error: '你没有此技能' }
            const zdRoundNow = state.roundState?.roundNumber ?? 0
            if (general.zhendanDisabledRound === zdRoundNow) return { error: '本轮【镇胆】已失效' }
            if (cardIds.length !== 1) return { error: '请选择一张非基本手牌' }
            const zdHandCard = general.hand.find(c => c.id === cardIds[0])
            if (!zdHandCard) return { error: '只能使用手牌' }
            if (zdHandCard.category === CardCategory.BASIC) return { error: '须使用一张非基本牌' }
            const zdUsedNames = general.basicUsedRound === zdRoundNow ? (general.basicUsedThisRound ?? []) : []
            const zdAllOptions = [
                { action: 'attack', label: '杀', name: BasicCardName.ATTACK },
                { action: 'peach', label: '桃', name: BasicCardName.PEACH },
                { action: 'wine', label: '酒', name: BasicCardName.WINE },
            ]
            const zdOptions = zdAllOptions
                .filter(o => !zdUsedNames.includes(o.name))
                .map(({ action, label }) => ({ action, label }))
            if (zdOptions.length === 0) return { error: '本轮使用过的基本牌不能再用' }
            general.zhendanCardId = zdHandCard.id
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(general),
                context: {
                    skillId: 'shanzhaoyun_zhendan_declare', skillName: '镇胆',
                    description: `将${cardFullName(zdHandCard)}当一张基本牌使用`,
                    options: zdOptions,
                    targetIndices: targets.map(t => state.generals.indexOf(t)),
                },
            })
            return
        }

        // ── 强易（斗地主地主技）：获得一名其他角色的一张手牌，然后交给其一张牌
        case 'doudizhu_qiangyi': {
            if (!hasSkill(general, 'doudizhu_qiangyi')) return { error: '你没有此技能' }
            if (state.mode !== GameMode.DOUDIZHU) return { error: '【强易】仅在斗地主模式可用' }
            const qyLimitedErr = checkLimited('doudizhu_qiangyi'); if (qyLimitedErr) return qyLimitedErr
            const qyTarget = targets.find(t => t !== general && t.hand.length > 0)
            if (!qyTarget) return { error: '请选择一名有手牌的其他角色' }
            markLimited('doudizhu_qiangyi')
            const qyTaken = qyTarget.hand.splice(randomInt(qyTarget.hand.length), 1)[0]
            general.hand.push(qyTaken)
            addLog(state, `【${name}】发动【强易】，获得【${getGeneralName(qyTarget)}】的${cardFullName(qyTaken)}`)
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_GIVE_CARDS,
                targetGeneralIndex: state.generals.indexOf(general),
                context: {
                    toIndex: state.generals.indexOf(qyTarget),
                    count: 1,
                    skillName: '强易',
                    mandatory: true,
                },
            })
            return
        }

        // ══ 洛书版扩展（二）主动技 ══
        // ── 雪恨（关银屏）：弃一张红牌，横置至多X名角色并对其中一名造成1点火焰伤害
        case 'guanyinping_xuehen': {
            if (!hasSkill(general, 'guanyinping_xuehen')) return { error: '你没有此技能' }
            const xhErr = checkOncePerTurn('guanyinping_xuehen'); if (xhErr) return xhErr
            const xhCard = lowValueCard(general, c => c.suit === CardSuit.HEART || c.suit === CardSuit.DIAMOND)
            if (!xhCard) return { error: '需要弃置一张红色牌' }
            const xhMax = Math.max(1, general.maxHp - general.hp)
            const xhChosen = targets.slice(0, xhMax)
            if (xhChosen.length === 0) return { error: '请选择至少一名角色' }
            markUsed('guanyinping_xuehen')
            general.hand.splice(general.hand.indexOf(xhCard), 1)
            state.discard.push(xhCard)
            addLog(state, `【${name}】发动【雪恨】，弃置${cardFullName(xhCard)}`)
            for (const t of xhChosen) chainGeneral(state, t, '雪恨')
            dealDamage(state, general, xhChosen[0], 1, undefined, { nature: 'fire' })
            return
        }
        // ── 品第（陈群）：弃一张牌，令一名角色摸/弃X张牌
        case 'chenqun_pindi': {
            if (!hasSkill(general, 'chenqun_pindi')) return { error: '你没有此技能' }
            const pdCard = lowValueCard(general)
            if (!pdCard) return { error: '需要弃置一张牌' }
            const pdCategory = pdCard.category
            const pdCandidates = state.generals
                .map((g, i) => ({ g, i }))
                .filter(({ g, i }) => g.alive && g !== general
                    && !(general.pindiTargets ?? []).includes(i))
                .map(({ i }) => i)
            if (pdCandidates.length === 0) return { error: '本回合已对每名角色发动过【品第】' }
            if ((general.pindiCategories ?? []).includes(pdCategory)) return { error: '本回合已弃置过该类别的牌' }
            const pdTarget = targets[0] ?? state.generals[pdCandidates[0]]
            const pdCount = (general.pindiCount ?? 0) + 1
            general.pindiCount = pdCount
            general.pindiTargets = [...(general.pindiTargets ?? []), state.generals.indexOf(pdTarget)]
            general.pindiCategories = [...(general.pindiCategories ?? []), pdCategory]
            general.hand.splice(general.hand.indexOf(pdCard), 1)
            state.discard.push(pdCard)
            if (pdTarget.hp < pdTarget.maxHp) chainGeneral(state, pdTarget, '品第')
            if (pdTarget.hand.length < pdCount) {
                const pdDrawn = drawForGeneral(state, pdTarget, pdCount)
                pdTarget.hand.push(...pdDrawn)
                addLog(state, `【${name}】发动【品第】，【${getGeneralName(pdTarget)}】摸${pdDrawn.length}张牌`)
            } else {
                for (let k = 0; k < pdCount; k++) {
                    const c = lowValueCard(pdTarget)
                    if (c) removeCardFromHandOrEquip(state, pdTarget, c.id)
                }
                addLog(state, `【${name}】发动【品第】，【${getGeneralName(pdTarget)}】弃置${pdCount}张牌`)
            }
            return
        }
        // ── 驱虎（荀彧）：与体力值大于你的角色拼点
        case 'xunyu_quhu': {
            if (!hasSkill(general, 'xunyu_quhu')) return { error: '你没有此技能' }
            const qhErr = checkOncePerTurn('xunyu_quhu'); if (qhErr) return qhErr
            const qhOpp = targets[0]
            if (!qhOpp) return { error: '请选择一名角色' }
            if (qhOpp.hp <= general.hp) return { error: '只能与体力值大于你的角色拼点' }
            if (general.hand.length === 0 || qhOpp.hand.length === 0) return { error: '拼点双方都需要有手牌' }
            markUsed('xunyu_quhu')
            pindianStart(state, general, qhOpp, 'xunyu_quhu_skill', '驱虎')
            return
        }
        // ── 天义（太史慈）：与一名角色拼点
        case 'taishici_tianyi': {
            if (!hasSkill(general, 'taishici_tianyi')) return { error: '你没有此技能' }
            const tyErr = checkOncePerTurn('taishici_tianyi'); if (tyErr) return tyErr
            const tyOpp = targets[0]
            if (!tyOpp) return { error: '请选择一名角色' }
            if (general.hand.length === 0 || tyOpp.hand.length === 0) return { error: '拼点双方都需要有手牌' }
            markUsed('taishici_tianyi')
            pindianStart(state, general, tyOpp, 'taishici_tianyi', '天义')
            return
        }
        // ── 陷阵（界高顺）：与一名角色拼点
        case 'gaoshun_xianzhen': {
            if (!hasSkill(general, 'gaoshun_xianzhen')) return { error: '你没有此技能' }
            const xzErr = checkOncePerTurn('gaoshun_xianzhen'); if (xzErr) return xzErr
            const xzOpp = targets[0]
            if (!xzOpp) return { error: '请选择一名角色' }
            if (general.hand.length === 0 || xzOpp.hand.length === 0) return { error: '拼点双方都需要有手牌' }
            markUsed('gaoshun_xianzhen')
            pindianStart(state, general, xzOpp, 'gaoshun_xianzhen', '陷阵')
            return
        }
        // ── 长标（界祝融）：任意张手牌当一张无距离限制的【杀】
        case 'zhurong_changbiao': {
            if (!hasSkill(general, 'zhurong_changbiao')) return { error: '你没有此技能' }
            const cbErr = checkOncePerTurn('zhurong_changbiao'); if (cbErr) return cbErr
            const cbTarget = targets[0]
            if (!cbTarget) return { error: '请选择一名角色' }
            const cbCards = cardIds.length > 0
                ? cardIds.map(id => general.hand.find(c => c.id === id)).filter((c): c is Card => !!c)
                : (lowValueCard(general) ? [lowValueCard(general)!] : [])
            if (cbCards.length === 0) return { error: '请选择用于转化的手牌' }
            markUsed('zhurong_changbiao')
            for (const c of cbCards) {
                const ci = general.hand.indexOf(c)
                if (ci >= 0) general.hand.splice(ci, 1)
            }
            addLog(state, `【${name}】发动【长标】，将${cbCards.length}张手牌当【杀】使用`)
            const cbResult = useVirtualSlash(state, general, state.generals.indexOf(cbTarget), { noRange: true })
            if (cbResult && 'error' in cbResult) {
                general.hand.push(...cbCards)
                general.skillsUsedThisTurn = general.skillsUsedThisTurn.filter(s => s !== 'zhurong_changbiao')
                return cbResult
            }
            return
        }
        // ── 放权（刘禅）：跳过出牌阶段
        case 'liushan_fangquan': {
            if (!hasSkill(general, 'liushan_fangquan')) return { error: '你没有此技能' }
            if (general.hand.length === 0) return { error: '需要弃置一张手牌' }
            const fqOwner = state.generals.indexOf(general)
            const fqCandidates = state.generals
                .map((x, i) => ({ x, i }))
                .filter(({ x, i }) => x.alive && i !== fqOwner)
                .map(({ i }) => i)
            if (fqCandidates.length === 0) return { error: '没有其他角色' }
            addLog(state, `【${name}】发动【放权】，跳过出牌阶段`)
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_CHOOSE_TARGET,
                targetGeneralIndex: fqOwner,
                context: {
                    skillId: 'liushan_fangquan', skillName: '放权',
                    description: '选择令谁执行一个额外回合',
                    candidateIndices: fqCandidates,
                },
            })
            return
        }
        // ── 直谏（界张昭张纮）：将装备牌置入其他角色装备区，然后摸一张
        case 'zhangzhao_zhijian': {
            if (!hasSkill(general, 'zhangzhao_zhijian')) return { error: '你没有此技能' }
            const zjTarget = targets[0]
            if (!zjTarget || zjTarget === general) return { error: '请选择一名其他角色' }
            const zjCard = cardIds.length > 0
                ? general.hand.find(c => c.id === cardIds[0])
                : lowValueCard(general, c => c.category === CardCategory.EQUIPMENT)
            if (!zjCard || zjCard.category !== CardCategory.EQUIPMENT) return { error: '请选择一张装备牌' }
            const zjSlot = zjCard.equipSlot!
            const zjOld = zjTarget.equip[zjSlot]
            if (zjOld) state.discard.push(zjOld)
            general.hand.splice(general.hand.indexOf(zjCard), 1)
            zjTarget.equip[zjSlot] = zjCard
            addLog(state, `【${name}】发动【直谏】，将${cardFullName(zjCard)}置入【${getGeneralName(zjTarget)}】的装备区`)
            const zjDrawn = drawForGeneral(state, general, 1)
            general.hand.push(...zjDrawn)
            return
        }
        // ── 缔盟（鲁肃）：两名角色交换手牌
        case 'lusu_dimeng': {
            if (!hasSkill(general, 'lusu_dimeng')) return { error: '你没有此技能' }
            const dmErr = checkOncePerTurn('lusu_dimeng'); if (dmErr) return dmErr
            if (targets.length < 2) return { error: '请选择两名其他角色' }
            const [dmA, dmB] = targets
            const dmX = Math.abs(dmA.hand.length - dmB.hand.length)
            if (general.hand.length < dmX) return { error: `需要弃置 ${dmX} 张牌` }
            markUsed('lusu_dimeng')
            for (let k = 0; k < dmX; k++) {
                const c = lowValueCard(general)
                if (!c) break
                removeCardFromHandOrEquip(state, general, c.id)
            }
            const dmHandA = dmA.hand.splice(0)
            const dmHandB = dmB.hand.splice(0)
            dmA.hand.push(...dmHandB)
            dmB.hand.push(...dmHandA)
            addLog(state, `【${name}】发动【缔盟】，弃置${dmX}张牌，令【${getGeneralName(dmA)}】与【${getGeneralName(dmB)}】交换手牌`)
            return
        }
        // ── 安恤（界步练师）：获得两名角色各一张牌，再交给手牌较少者
        case 'bulianshi_anxu': {
            if (!hasSkill(general, 'bulianshi_anxu')) return { error: '你没有此技能' }
            const axErr = checkOncePerTurn('bulianshi_anxu'); if (axErr) return axErr
            if (targets.length < 2) return { error: '请选择两名其他角色' }
            const axPool = targets.slice(0, 2).filter((t) => t !== general)
            if (axPool.length < 2) return { error: '请选择两名其他角色' }
            if (axPool.some((t) => !hasCardInArea(t))) return { error: '所选角色没有可获得的牌' }
            markUsed('bulianshi_anxu')
            const gained: Card[] = []
            for (const t of axPool) {
                const gainedCard = gainRandomCardFrom(state, general, t)
                if (gainedCard) gained.push(gainedCard)
            }
            addLog(state, `【${name}】发动【安恤】，获得${gained.map((c) => cardFullName(c)).join('、')}`)
            if (gained.length === 0) return
            // 交给两名角色中手牌较少者；具体展示哪一张由发动者决定
            const axTarget = [...axPool].sort((a, b) => a.hand.length - b.hand.length)[0]
            state.pendingResponseQueue.push({
                type: ResponseType.SKILL_PICK_CARD,
                targetGeneralIndex: state.generals.indexOf(general),
                context: {
                    skillId: 'bulianshi_anxu_give',
                    skillName: '安恤',
                    description: `展示一张牌交给【${getGeneralName(axTarget)}】`,
                    count: 1,
                    exactCount: true,
                    candidateCardIds: gained.map((c) => c.id),
                    anxuReceiverIndex: state.generals.indexOf(axTarget),
                },
            })
            return
        }
        // ── 断发（周鲂）：弃置任意张黑色牌，摸等量的牌
        case 'zhoufang_duanfa': {
            if (!hasSkill(general, 'zhoufang_duanfa')) return { error: '你没有此技能' }
            const dfLeft = Math.max(0, general.hp - (general.duanfaCount ?? 0))
            if (dfLeft <= 0) return { error: '本阶段已弃置足够数量的黑色牌' }
            let dfCards = cardIds.length > 0
                ? cardIds.map(id => general.hand.find(c => c.id === id)).filter((c): c is Card => !!c)
                : [...general.hand].filter(c => c.suit === CardSuit.SPADE || c.suit === CardSuit.CLUB)
                    .sort((a, b) => cardKeepValue(a) - cardKeepValue(b)).slice(0, 1)
            dfCards = dfCards.filter(c => c.suit === CardSuit.SPADE || c.suit === CardSuit.CLUB).slice(0, dfLeft)
            if (dfCards.length === 0) return { error: '请选择至少一张黑色牌' }
            general.duanfaCount = (general.duanfaCount ?? 0) + dfCards.length
            for (const c of dfCards) {
                const di = general.hand.indexOf(c)
                if (di >= 0) general.hand.splice(di, 1)
                state.discard.push(c)
            }
            const dfDrawn = drawForGeneral(state, general, dfCards.length)
            general.hand.push(...dfDrawn)
            addLog(state, `【${name}】发动【断发】，弃置${dfCards.length}张黑色牌，摸${dfDrawn.length}张牌`)
            return
        }
        // ── 审时（蒯良蒯越）阳：交给手牌最多的其他角色一张牌，对其造成1点伤害
        case 'kuailiang_shenshi': {
            if (!hasSkill(general, 'kuailiang_shenshi')) return { error: '你没有此技能' }
            if ((general as any).shenshiYin) return { error: '【审时】当前为阴' }
            const ssErr = checkOncePerTurn('kuailiang_shenshi'); if (ssErr) return ssErr
            const ssTarget = targets[0] ?? state.generals
                .map((g, i) => ({ g, i }))
                .filter(({ g }) => g.alive && g !== general)
                .sort((a, b) => b.g.hand.length - a.g.hand.length)[0]?.g
            if (!ssTarget) return { error: '没有其他角色' }
            const ssCard = lowValueCard(general)
            if (!ssCard) return { error: '需要交给其一张牌' }
            markUsed('kuailiang_shenshi')
            general.hand.splice(general.hand.indexOf(ssCard), 1)
            ssTarget.hand.push(ssCard)
            addLog(state, `【${name}】发动【审时】，交给【${getGeneralName(ssTarget)}】${cardFullName(ssCard)}并造成1点伤害`)
            ;(general as any).shenshiYin = true
            dealDamage(state, general, ssTarget, 1)
            if (!ssTarget.alive) {
                const ssPick = state.generals
                    .map((g, i) => ({ g, i }))
                    .filter(({ g }) => g.alive && g.hand.length < 4)
                    .sort((a, b) => a.g.hand.length - b.g.hand.length)[0]?.g
                if (ssPick) {
                    const ssDrawn = drawToHandSize(state, ssPick, 4)
                    addLog(state, `【${name}】【审时】令【${getGeneralName(ssPick)}】摸${ssDrawn}张牌`)
                }
            }
            return
        }
        // ── 酒池（界董卓）：一张手牌当【酒】
        case 'dongzhuo_jiuchi': {
            if (!hasSkill(general, 'dongzhuo_jiuchi')) return { error: '你没有此技能' }
            const jcCard = cardIds.length > 0
                ? general.hand.find(c => c.id === cardIds[0])
                : lowValueCard(general, () => true)
            if (!jcCard) return { error: '需要一张手牌' }
            const jcIdx = general.hand.indexOf(jcCard)
            const jcConverted: Card = { ...jcCard, name: BasicCardName.WINE, category: CardCategory.BASIC, nature: undefined }
            return handleBasicCard(state, general, jcConverted, jcIdx, [general])
        }
        // ── 火计（卧龙诸葛）：红色手牌当【火攻】
        case 'wolong_huoji': {
            if (!hasSkill(general, 'wolong_huoji')) return { error: '你没有此技能' }
            const hjCard = cardIds.length > 0
                ? general.hand.find(c => c.id === cardIds[0])
                : lowValueCard(general, c => c.suit === CardSuit.HEART || c.suit === CardSuit.DIAMOND)
            if (!hjCard || (hjCard.suit !== CardSuit.HEART && hjCard.suit !== CardSuit.DIAMOND)) {
                return { error: '需要一张红色手牌' }
            }
            if (targets.length !== 1) return { error: '【火攻】需要指定一名目标' }
            const hjIdx = general.hand.indexOf(hjCard)
            const hjConverted: Card = {
                ...hjCard, name: TrickCardName.FIRE_ATTACK, category: CardCategory.TRICK,
                trickType: TrickType.INSTANT,
            }
            return handleTrickCard(state, general, hjConverted, hjIdx, targets, undefined)
        }
        // ── 连环（庞统）：一张手牌当【铁索连环】
        case 'pangtong_lianhuan': {
            if (!hasSkill(general, 'pangtong_lianhuan')) return { error: '你没有此技能' }
            const lhCard = cardIds.length > 0
                ? general.hand.find(c => c.id === cardIds[0])
                : lowValueCard(general)
            if (!lhCard) return { error: '请选择一张手牌' }
            const lhIdx = general.hand.indexOf(lhCard)
            const lhConverted: Card = {
                ...lhCard, name: TrickCardName.IRON_CHAIN, category: CardCategory.TRICK,
                trickType: TrickType.INSTANT,
            }
            return handleTrickCard(state, general, lhConverted, lhIdx, targets, undefined)
        }
        // ── 双雄（界颜良文丑）：与弃置牌颜色不同的手牌当【决斗】
        case 'yanliang_shuangxiong': {
            if (!hasSkill(general, 'yanliang_shuangxiong')) return { error: '你没有此技能' }
            if (!general.shuangxiongColor) return { error: '本回合尚未发动【双雄】' }
            const sxCard = cardIds.length > 0
                ? general.hand.find(c => c.id === cardIds[0])
                : lowValueCard(general, c => {
                    const red = c.suit === CardSuit.HEART || c.suit === CardSuit.DIAMOND
                    return (general.shuangxiongColor === 'red') === red
                })
            if (!sxCard) return { error: '请选择一张手牌' }
            const sxRed = sxCard.suit === CardSuit.HEART || sxCard.suit === CardSuit.DIAMOND
            if ((general.shuangxiongColor === 'red') !== sxRed) return { error: '此牌颜色与【双雄】弃置的牌相同' }
            if (targets.length !== 1) return { error: '【决斗】需要指定一名目标' }
            const sxIdx = general.hand.indexOf(sxCard)
            const sxConverted: Card = {
                ...sxCard, name: TrickCardName.DUEL, category: CardCategory.TRICK,
                trickType: TrickType.INSTANT,
            }
            return handleTrickCard(state, general, sxConverted, sxIdx, targets, undefined)
        }

        // ── 苦肉（黄盖）：出牌阶段，失去1体力，摸2张牌
        case 'huanggai_kurou': {
            if (!hasSkill(general, 'huanggai_kurou')) return { error: '你没有此技能' }
            // 界黄盖（洛书版）：出牌阶段限一次，弃置一张牌后失去1体力，摸牌由【诈降】提供
            if (hasSkill(general, 'huanggai_zhaxiang')) {
                const kurouErr = checkOncePerTurn('huanggai_kurou')
                if (kurouErr) return kurouErr
                if (cardIds.length !== 1) return { error: '请选择一张要弃置的牌' }
                const paid = removeCardFromHandOrEquip(state, general, cardIds[0])
                if ('error' in paid) return paid
                markUsed('huanggai_kurou')
                addLog(state, `【${name}】发动【苦肉】，弃置${cardFullName(paid)}`)
                loseHp(state, general, 1)
                return
            }
            addLog(state, `【${name}】发动【苦肉】`)
            loseHp(state, general, 1)
            // 如果产生了濒死（pendingResponseQueue 有 PEACH_SAVE_ASK），
            // 摸牌必须等濒死结算后再执行。插入一个自动确认的摸牌后续。
            if (general.hp <= 0) {
                // 濒死在 pendingResponseQueue[0]，摸牌在其后面
                // 被救活后由 handleRespond 中 SKILL_ACTIVATE_CONFIRM 的 auto-execute 处理
                state.pendingResponseQueue.push({
                    type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                    targetGeneralIndex: state.generals.indexOf(general),
                    context: {
                        skillId: 'huanggai_kurou_draw',
                        skillName: '苦肉（摸牌）',
                        description: '苦肉结算：摸2张牌',
                        autoExecute: true,
                    },
                })
            } else if (general.alive) {
                const drawn = drawCards(state, 2)
                general.hand.push(...drawn)
                addLog(state, `【${name}】摸了2张牌`)
            }
            return
        }

        // ── 制衡（孙权）：出牌阶段限一次，弃任意张牌摸等量
        case 'sunquan_zhiheng': {
            if (!hasSkill(general, 'sunquan_zhiheng')) return { error: '你没有此技能' }
            const err = checkOncePerTurn('sunquan_zhiheng')
            if (err) return err
            if (cardIds.length === 0) return { error: '请选择要弃置的牌' }
            let discardCount = 0
            const discardedCards: Card[] = []
            for (const cid of cardIds) {
                const card = findCardInHandOrEquip(general, cid)
                if (card) discardedCards.push(card)
                const result = removeCardFromHandOrEquip(state, general, cid)
                if ('error' in result) return result
                discardCount++
            }
            const drawn = drawCards(state, discardCount)
            general.hand.push(...drawn)
            markUsed('sunquan_zhiheng')
            addLog(state, `【${name}】发动【制衡】，弃${discardedCards.map(c => cardFullName(c)).join('、')}，摸 ${drawn.length} 张牌`)
            return
        }

        // ── 青囊（华佗）：出牌阶段限一次，弃1张手牌，目标回复1血
        // ── 秉正（董允）：令一名手牌数≠体力值的角色弃一张手牌或摸一张，之后若相等自己摸一张
        case 'dongyun_bingzheng': {
            if (!hasSkill(general, 'dongyun_bingzheng')) return { error: '你没有此技能' }
            const bzErr = checkOncePerTurn('dongyun_bingzheng')
            if (bzErr) return bzErr
            if (targets.length !== 1) return { error: '请选择一名角色' }
            const bzTarget = targets[0]
            if (bzTarget.hand.length === bzTarget.hp) return { error: '该角色的手牌数等于体力值' }
            markUsed('dongyun_bingzheng')
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(general),
                context: {
                    skillId: 'dongyun_bingzheng',
                    skillName: '秉正',
                    description: `令【${getGeneralName(bzTarget)}】弃置一张手牌，或摸一张牌`,
                    options: [
                        { action: 'discard', label: '令其弃置一张手牌' },
                        { action: 'draw', label: '令其摸一张牌' },
                    ],
                    bingzhengTargetIndex: state.generals.indexOf(bzTarget),
                },
            })
            return
        }

        // ── 伪溃（SP曹仁）：失去1点体力，观看一名有手牌的其他角色手牌
        case 'caoren_weikui': {
            if (!hasSkill(general, 'caoren_weikui')) return { error: '你没有此技能' }
            const wkErr = checkOncePerTurn('caoren_weikui')
            if (wkErr) return wkErr
            if (targets.length !== 1) return { error: '请选择一名有手牌的其他角色' }
            const wkTarget = targets[0]
            if (wkTarget === general || !wkTarget.alive) return { error: '目标无效' }
            if (wkTarget.hand.length === 0) return { error: '目标没有手牌' }
            markUsed('caoren_weikui')
            loseHp(state, general, 1)
            rememberCards(state, state.generals.indexOf(wkTarget), wkTarget.hand, '伪溃')
            addLog(state, `【${name}】发动【伪溃】，失去1点体力并观看【${getGeneralName(wkTarget)}】的手牌`)
            general.weikuiTargetSeat = state.generals.indexOf(wkTarget)
            general.weikuiTurn = state.turnSerial
            const wkHasDodge = wkTarget.hand.some((c) => c.name === BasicCardName.DODGE)
            if (wkHasDodge) {
                addLog(state, `【${getGeneralName(wkTarget)}】手牌中有【闪】，视为对其使用【杀】`)
                useVirtualSlash(state, general, state.generals.indexOf(wkTarget), { label: '【伪溃】' })
            } else {
                const wkPool = [
                    ...wkTarget.hand.map((c) => c.id),
                    ...Object.values(wkTarget.equip).filter(Boolean).map((c) => c!.id),
                ]
                if (wkPool.length > 0) removeCardFromHandOrEquip(state, wkTarget, wkPool[0])
                addLog(state, `【${getGeneralName(wkTarget)}】手牌中没有【闪】，弃置其一张牌`)
            }
            return
        }

        // ── 除疠（界华佗）：弃置与任意名势力各不相同的其他角色的各一张牌，因此弃牌的角色各摸一张
        case 'huatuo_chuli': {
            if (!hasSkill(general, 'huatuo_chuli')) return { error: '你没有此技能' }
            const chuliErr = checkOncePerTurn('huatuo_chuli')
            if (chuliErr) return chuliErr
            const chuliTargets = targets.filter((t) => t.alive && t !== general)
            if (chuliTargets.length === 0) return { error: '请选择至少一名其他角色' }
            const chuliKingdoms = new Set<string>()
            for (const t of chuliTargets) {
                const kd = getGeneralById(t.generalId)?.kingdom ?? 'qun'
                if (chuliKingdoms.has(kd)) return { error: '所选角色的势力必须各不相同' }
                chuliKingdoms.add(kd)
            }
            const selfPool = [
                ...general.hand.map((c) => c.id),
                ...Object.values(general.equip).filter(Boolean).map((c) => c!.id),
            ]
            if (selfPool.length === 0) return { error: '你没有牌可弃置' }
            markUsed('huatuo_chuli')
            const chuliSelfCard = cardIds.find((id) => selfPool.includes(id)) ?? selfPool[0]
            removeCardFromHandOrEquip(state, general, chuliSelfCard)
            for (const t of chuliTargets) {
                const pool = [
                    ...t.hand.map((c) => c.id),
                    ...Object.values(t.equip).filter(Boolean).map((c) => c!.id),
                ]
                if (pool.length === 0) continue
                const removed = removeCardFromHandOrEquip(state, t, pool[0])
                if ('error' in removed) continue
                const chuliDraw = drawCards(state, 1)
                t.hand.push(...chuliDraw)
            }
            const chuliSelfDraw = drawCards(state, 1)
            general.hand.push(...chuliSelfDraw)
            addLog(state, `【${name}】发动【除疠】，弃置与${chuliTargets.length}名角色的各一张牌，因此弃牌的角色各摸一张牌`)
            return
        }

        case 'huatuo_qingnang': {
            if (!hasSkill(general, 'huatuo_qingnang')) return { error: '你没有此技能' }
            const err = checkOncePerTurn('huatuo_qingnang')
            if (err) return err
            if (cardIds.length !== 1) return { error: '请选择1张手牌弃置' }
            if (targets.length !== 1) return { error: '请选择1个目标' }
            const target = targets[0]
            if (target.hp >= target.maxHp) return { error: '目标已满血' }
            const result = removeCardsFromHand(cardIds)
            if ('error' in result) return result
            state.discard.push(...result)
            target.hp = Math.min(target.hp + 1, target.maxHp)
            markUsed('huatuo_qingnang')
            addLog(state, `【${name}】发动【青囊】，【${getGeneralName(target)}】回复至 ${target.hp}/${target.maxHp}`)
            triggerDianhuRecover(state, target)
            triggerLiangzhu(state, target)
            return
        }

        // ── 结姻（孙尚香）：出牌阶段限一次，弃2手牌选一名已受伤男性，各回复1血
        case 'sunshangxiang_jieyin': {
            if (!hasSkill(general, 'sunshangxiang_jieyin')) return { error: '你没有此技能' }
            const err = checkOncePerTurn('sunshangxiang_jieyin')
            if (err) return err
            if (cardIds.length !== 2) return { error: '需弃置2张手牌' }
            if (targets.length !== 1) return { error: '请选择1名已受伤男性角色' }
            const target = targets[0]
            const targetDef = getGeneralById(target.generalId)
            if (targetDef?.gender !== 'male') return { error: '目标必须是男性角色' }
            if (target.hp >= target.maxHp) return { error: '目标未受伤' }
            // 结姻只能用手牌
            for (const cid of cardIds) {
                const cardIdx = general.hand.findIndex(c => c.id === cid)
                if (cardIdx === -1) return { error: '手牌中找不到此牌' }
            }
            const jieyinCards: Card[] = []
            for (const cid of cardIds) {
                const cardIdx = general.hand.findIndex(c => c.id === cid)
                const card = general.hand.splice(cardIdx, 1)[0]
                jieyinCards.push(card)
                state.discard.push(card)
                checkMingzhe(state, general, card)
            }
            if (general.hp < general.maxHp) general.hp++
            if (target.hp < target.maxHp) target.hp++
            triggerLiangzhu(state, general)
            triggerLiangzhu(state, target)
            triggerDianhuRecover(state, general)
            triggerDianhuRecover(state, target)
            markUsed('sunshangxiang_jieyin')
            addLog(state, `【${name}】发动【结姻】弃${jieyinCards.map(c => cardFullName(c)).join('、')}，与【${getGeneralName(target)}】各回复1点体力`)
            return
        }

        // ── 结姻（界孙尚香）：选一名男性角色，弃一张手牌或将一张装备牌置入其装备区
        case 'sunshangxiang_jieyuan': {
            if (!hasSkill(general, 'sunshangxiang_jieyuan')) return { error: '你没有此技能' }
            const err = checkOncePerTurn('sunshangxiang_jieyuan')
            if (err) return err
            if (targets.length !== 1) return { error: '请选择1名男性角色' }
            if (cardIds.length !== 1) return { error: '请选择1张手牌或装备牌' }
            const target = targets[0]
            if (target === general) return { error: '不能选择自己' }
            if (getGeneralById(target.generalId)?.gender !== 'male') return { error: '目标必须是男性角色' }
            const jyCard = findCardInHandOrEquip(general, cardIds[0])
            if (!jyCard) return { error: '找不到该牌' }
            const jyAsEquip = jyCard.category === CardCategory.EQUIPMENT && !!jyCard.equipSlot
            if (jyAsEquip) {
                // 将一张装备牌置入其装备区
                const detached = detachCardFromHandOrEquip(state, general, jyCard.id)
                if ('error' in detached) return detached
                const slot = detached.equipSlot!
                const replaced = target.equip[slot]
                if (replaced) {
                    state.discard.push(replaced)
                    addLog(state, `【${getGeneralName(target)}】装备区的${cardFullName(replaced)}被替换进入弃牌堆`)
                }
                target.equip[slot] = detached
                addLog(state, `【${name}】发动【结姻】，将${cardFullName(detached)}置入【${getGeneralName(target)}】的装备区`)
            } else {
                const removed = removeCardFromHandOrEquip(state, general, jyCard.id)
                if ('error' in removed) return removed
                addLog(state, `【${name}】发动【结姻】，弃置${cardFullName(removed)}`)
            }
            markUsed('sunshangxiang_jieyuan')
            if (general.hp > target.hp) {
                const drawn = drawForGeneral(state, general, 1)
                general.hand.push(...drawn)
                target.hp = Math.min(target.hp + 1, target.maxHp)
                addLog(state, `【结姻】：体力较高的【${name}】摸${drawn.length}张牌，体力较低的【${getGeneralName(target)}】回复至 ${target.hp}/${target.maxHp}`)
                triggerDianhuRecover(state, target)
                triggerLiangzhu(state, target)
            } else if (general.hp < target.hp) {
                const drawn = drawForGeneral(state, target, 1)
                target.hand.push(...drawn)
                general.hp = Math.min(general.hp + 1, general.maxHp)
                addLog(state, `【结姻】：体力较高的【${getGeneralName(target)}】摸${drawn.length}张牌，体力较低的【${name}】回复至 ${general.hp}/${general.maxHp}`)
                triggerDianhuRecover(state, general)
                triggerLiangzhu(state, general)
            } else {
                addLog(state, `【结姻】：双方体力值相同，没有角色摸牌或回复体力`)
            }
            return
        }

        // ── 国色（界大乔）：方块牌当【乐不思蜀】，或弃♦牌拆场上的【乐不思蜀】；结束后摸一张
        case 'daqiao_jie_guose': {
            if (!hasSkill(general, 'daqiao_jie_guose')) return { error: '你没有此技能' }
            const err = checkOncePerTurn('daqiao_jie_guose')
            if (err) return err
            if (cardIds.length !== 1) return { error: '请选择1张♦牌' }
            if (targets.length !== 1) return { error: '请选择1名目标' }
            const card = findCardInHandOrEquip(general, cardIds[0])
            if (!card) return { error: '找不到该牌' }
            if (card.suit !== CardSuit.DIAMOND) return { error: '须为♦牌' }
            const target = targets[0]
            if (target.abolishedJudgeZone) return { error: '目标的判定区已废除（雄乱）' }
            if (target.judgeZone.some(c => c.name === TrickCardName.OVERINDULGENCE)) return { error: '目标已有乐不思蜀' }
            const removedCard = detachCardFromHandOrEquip(state, general, cardIds[0])
            if ('error' in removedCard) return removedCard
            target.judgeZone.push({
                ...removedCard,
                originalName: removedCard.name,
                originalCategory: removedCard.category,
                name: TrickCardName.OVERINDULGENCE,
                category: CardCategory.TRICK,
                trickType: TrickType.DELAYED,
            })
            markUsed('daqiao_jie_guose')
            addLog(state, `【${name}】发动【国色】（♦牌当乐不思蜀），对【${getGeneralName(target)}】放置`)
            const gsDrawn = drawForGeneral(state, general, 1)
            general.hand.push(...gsDrawn)
            addLog(state, `【国色】结算结束，${name}摸了${gsDrawn.length}张牌`)
            return
        }

        // ── 国色（界大乔）第二项：弃一张♦牌，并弃置场上的一张【乐不思蜀】；结束后摸一张
        case 'daqiao_jie_guose_discard': {
            if (!hasSkill(general, 'daqiao_jie_guose')) return { error: '你没有此技能' }
            const err = checkOncePerTurn('daqiao_jie_guose')
            if (err) return err
            if (cardIds.length !== 1) return { error: '请选择1张♦牌弃置' }
            const card = findCardInHandOrEquip(general, cardIds[0])
            if (!card) return { error: '找不到该牌' }
            if (card.suit !== CardSuit.DIAMOND) return { error: '须为♦牌' }
            const holders = state.generals.filter(g => g.judgeZone.some(c => c.name === TrickCardName.OVERINDULGENCE))
            if (holders.length === 0) return { error: '场上没有【乐不思蜀】' }
            let chosen: GeneralInstance | undefined
            if (targets.length === 1) {
                if (!holders.includes(targets[0])) return { error: '该角色的判定区没有【乐不思蜀】' }
                chosen = targets[0]
            } else if (holders.length === 1) {
                chosen = holders[0]
            } else {
                return { error: '请选择要弃置【乐不思蜀】的角色' }
            }
            const removedCard = removeCardFromHandOrEquip(state, general, cardIds[0])
            if ('error' in removedCard) return removedCard
            const jIdx = chosen!.judgeZone.findIndex(c => c.name === TrickCardName.OVERINDULGENCE)
            if (jIdx >= 0) {
                const [delayed] = chosen!.judgeZone.splice(jIdx, 1)
                state.discard.push(delayed)
                addLog(state, `【${name}】发动【国色】，弃置${cardFullName(removedCard)}，并弃置【${getGeneralName(chosen!)}】判定区的【乐不思蜀】`)
            }
            markUsed('daqiao_jie_guose')
            const gsDrawn2 = drawForGeneral(state, general, 1)
            general.hand.push(...gsDrawn2)
            addLog(state, `【国色】结算结束，${name}摸了${gsDrawn2.length}张牌`)
            return
        }

        // ── 反间（周瑜）：出牌阶段限一次，目标选花色 → 获得你一牌 → 不同受伤
        case 'zhouyu_fanjian': {
            const fanjianId = data.skillId
            if (!hasSkill(general, fanjianId)) return { error: '你没有此技能' }
            const err = checkOncePerTurn(fanjianId)
            if (err) return err
            if (general.hand.length === 0) return { error: '你没有手牌可用' }
            if (targets.length !== 1) return { error: '请选择1名目标角色' }
            const target = targets[0]
            if (target === general) return { error: '不能选自己' }
            markUsed(fanjianId)
            // 设置 pendingResponse，让目标选花色（周瑜不需要选牌，之后随机给一张）
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_FANJIAN_SUIT,
                targetGeneralIndex: state.generals.indexOf(target),
                context: {
                    fanjianUserIndex: state.generals.indexOf(general),
                },
            })
            addLog(state, `【${name}】对【${getGeneralName(target)}】发动【反间】，请选择一种花色`)
            return
        }

        // ── 反间（界周瑜）：展示一张手牌交给目标，再令其弃同花色牌或失去1点体力
        case 'zhouyu_jie_fanjian': {
            if (!hasSkill(general, 'zhouyu_jie_fanjian')) return { error: '你没有此技能' }
            const err = checkOncePerTurn('zhouyu_jie_fanjian')
            if (err) return err
            if (cardIds.length !== 1) return { error: '请选择1张手牌展示并交给目标' }
            if (targets.length !== 1) return { error: '请选择1名其他角色' }
            const target = targets[0]
            if (target === general) return { error: '不能选自己' }
            const fanjianIdx = general.hand.findIndex(c => c.id === cardIds[0])
            if (fanjianIdx === -1) return { error: '手牌中找不到该牌' }
            markUsed('zhouyu_jie_fanjian')
            const givenCard = general.hand.splice(fanjianIdx, 1)[0]
            target.hand.push(givenCard)
            addLog(state, `【${name}】对【${getGeneralName(target)}】发动【反间】，展示并交给其${cardFullName(givenCard)}`)
            rememberCards(state, state.generals.indexOf(target), [givenCard], '反间')
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_FANJIAN_CHOICE,
                targetGeneralIndex: state.generals.indexOf(target),
                context: {
                    fanjianUserIndex: state.generals.indexOf(general),
                    fanjianSuit: givenCard.suit,
                    fanjianCardId: givenCard.id,
                },
            })
            return
        }

        // ── 挑衅（姜维）：出牌阶段限一次，指定攻击范围内角色（目标须能杀到你），其须对你出杀否则弃其一牌
        case 'jiangwei_tiaoxin': {
            if (!hasSkill(general, 'jiangwei_tiaoxin')) return { error: '你没有此技能' }
            const err = checkOncePerTurn('jiangwei_tiaoxin')
            if (err) return err
            if (targets.length !== 1) return { error: '请选择1名角色' }
            const target = targets[0]
            if (target === general) return { error: '不能挑衅自己' }
            // 校验：目标必须能攻击到姜维
            const rangeInfo = getAttackRange(target, general, state.generals)
            if (!rangeInfo.inRange) return { error: `目标攻击范围不够（距离${rangeInfo.distance}，范围${rangeInfo.range}）` }
            markUsed('jiangwei_tiaoxin')
            // 设置 pendingResponse，让目标选择出杀或放弃
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_TIAOXIN_RESPONSE,
                targetGeneralIndex: state.generals.indexOf(target),
                context: {
                    tiaoxinUserIndex: state.generals.indexOf(general),
                },
            })
            addLog(state, `【${name}】对【${getGeneralName(target)}】发动【挑衅】，请出一张【杀】或放弃`)
            return
        }

        // ── 离间（貂蝉）：出牌阶段限一次，弃1牌令两男角色决斗
        case 'diaochan_lijian': {
            if (!hasSkill(general, 'diaochan_lijian')) return { error: '你没有此技能' }
            const err = checkOncePerTurn('diaochan_lijian')
            if (err) return err
            if (cardIds.length !== 1) return { error: '请选择1张牌弃置' }
            if (targets.length !== 2) return { error: '请选择2名男性角色' }
            const [t1, t2] = targets
            const t1Def = getGeneralById(t1.generalId)
            const t2Def = getGeneralById(t2.generalId)
            if (t1Def?.gender !== 'male' || t2Def?.gender !== 'male') return { error: '目标必须是男性角色' }
            // 支持手牌和装备牌
            const result = removeCardFromHandOrEquip(state, general, cardIds[0])
            if ('error' in result) return result
            markUsed('diaochan_lijian')
            // 视为后选中的角色对先选中的角色使用【决斗】，因此先选中的武将先响应（先出杀）
            addLog(state, `【${name}】发动【离间】，视为【${getGeneralName(t2)}】对【${getGeneralName(t1)}】使用【决斗】`)
            state.pendingResponseQueue.unshift({
                type: ResponseType.ATTACK_DUEL,
                targetGeneralIndex: state.generals.indexOf(t1),
                context: {
                    initiatorGeneralIndex: state.generals.indexOf(t2),
                    duelTargetIndex: state.generals.indexOf(t1),
                    requiredAttacks: hasSkill(t2, 'lvbu_wushuang') ? 2 : 1,
                    attacksReceived: 0,
                },
            })
            return
        }

        // ── 仁德（刘备）：出牌阶段，将任意张手牌给予其他角色，每给出第2张时回1血
        case 'liubei_rende': {
            if (!hasSkill(general, 'liubei_rende')) return { error: '你没有此技能' }
            if (cardIds.length === 0) return { error: '请选择要给出的手牌' }
            if (targets.length !== 1) return { error: '请选择1名其他角色' }
            const target = targets[0]
            if (target === general) return { error: '不能给自己' }
            const result = removeCardsFromHand(cardIds)
            if ('error' in result) return result
            target.hand.push(...result)
            // 累计给牌数
            const prevGiven = general.rendeGivenThisTurn
            const newGiven = prevGiven + cardIds.length
            general.rendeGivenThisTurn = newGiven
            // 每回合最多回复1点体力：累计给出≥2张且本回合未回过血
            let healed = false
            if (!general.rendeHealedThisTurn && newGiven >= 2 && general.hp < general.maxHp) {
                general.hp++
                general.rendeHealedThisTurn = true
                healed = true
            }
            addLog(state, `【${name}】发动【仁德】，给了【${getGeneralName(target)}】${cardIds.length}张牌${healed ? '，回复1点体力' : ''}`)
            return
        }

        // ── 忠义（关羽限定技）：将一张红色手牌置于武将牌上至本轮结束，期间己方杀+1伤
        case 'guanyu_zhongyi': {
            if (!hasSkill(general, 'guanyu_zhongyi')) return { error: '你没有此技能' }
            const errL = checkLimited('guanyu_zhongyi')
            if (errL) return errL
            if (cardIds.length !== 1) return { error: '请选择1张红色手牌' }
            const cardIdx = general.hand.findIndex(c => c.id === cardIds[0])
            if (cardIdx === -1) return { error: '手牌中找不到该牌' }
            const card = general.hand[cardIdx]
            if (card.suit !== CardSuit.HEART && card.suit !== CardSuit.DIAMOND) return { error: '须为红色牌' }
            general.hand.splice(cardIdx, 1)
            general.loyaltyCard = card
            markLimited('guanyu_zhongyi')
            addLog(state, `【${name}】发动【忠义】，置入了一张红色牌，己方使用【杀】伤害+1至本轮结束`)
            return
        }

        // ── 战绝（刘谌）：将所有手牌当【决斗】使用，结算后双方各摸一张
        case 'liuchen_zhanjue': {
            if (!hasSkill(general, 'liuchen_zhanjue')) return { error: '你没有此技能' }
            if ((general.zhanjueDrawnThisPhase ?? 0) >= 3) return { error: '本阶段【战绝】已失效' }
            if (general.hand.length === 0) return { error: '没有手牌可以当作【决斗】' }
            if (targets.length !== 1) return { error: '请选择1名其他角色' }
            const zjTarget = targets[0]
            if (zjTarget === general) return { error: '不能指定自己' }
            if (!zjTarget.alive) return { error: '目标无效' }
            if (zjTarget.hand.length === 0 && hasSkill(zjTarget, 'zhugeliang_kongcheng')) {
                return { error: '【空城】目标没有手牌，不能成为【决斗】目标' }
            }
            const zjCost = [...general.hand]
            general.hand = []
            state.discard.push(...zjCost)
            addLog(state, `【${name}】发动【战绝】，将 ${zjCost.length} 张手牌当【决斗】对【${getGeneralName(zjTarget)}】使用`)
            const zjUserIdx = state.generals.indexOf(general)
            const zjTargetIdx = state.generals.indexOf(zjTarget)
            const zjEffect: DeferredTrickEffect = {
                type: 'duel',
                userIndex: zjUserIdx,
                targetIndex: zjTargetIdx,
                triggerJizhi: false,
                extra: { zhanjueUserIndex: zjUserIdx },
            }
            const zjDeferred = pushNegateCheck(
                state, TrickCardName.DUEL, zjUserIdx, zjTargetIdx, getGeneralName(zjTarget), zjEffect
            )
            if (!zjDeferred) executeDeferredTrickEffect(state, zjEffect)
            return
        }

        // ── 势斩（界华雄）：令一名其他角色视为对你使用【决斗】，每阶段限两次
        case 'huaxiong_shizhan': {
            if (!hasSkill(general, 'huaxiong_shizhan')) return { error: '你没有此技能' }
            const usedSz = general.skillsUsedThisTurn.filter((id) => id === 'huaxiong_shizhan').length
            if (usedSz >= 2) return { error: '本阶段【势斩】已使用两次' }
            if (targets.length !== 1) return { error: '请选择1名其他角色' }
            const szTarget = targets[0]
            if (szTarget === general) return { error: '不能指定自己' }
            if (!szTarget.alive) return { error: '目标无效' }
            general.skillsUsedThisTurn.push('huaxiong_shizhan')
            addLog(state, `【${name}】发动【势斩】，令【${getGeneralName(szTarget)}】视为对其使用【决斗】`)
            const szUserIdx = state.generals.indexOf(szTarget)
            const szTargetIdx = state.generals.indexOf(general)
            const szEffect: DeferredTrickEffect = {
                type: 'duel',
                userIndex: szUserIdx,
                targetIndex: szTargetIdx,
                triggerJizhi: false,
            }
            const szDeferred = pushNegateCheck(
                state, TrickCardName.DUEL, szUserIdx, szTargetIdx, getGeneralName(general), szEffect
            )
            if (!szDeferred) executeDeferredTrickEffect(state, szEffect)
            return
        }

        // ── 奇谋（魏延限定技）：失去任意点体力，换取本回合距离-X、杀次数+X
        case 'weiyan_qimou': {
            if (!hasSkill(general, 'weiyan_qimou')) return { error: '你没有此技能' }
            const errQm = checkLimited('weiyan_qimou')
            if (errQm) return errQm
            const maxLoss = general.hp - 1
            if (maxLoss < 1) return { error: '体力不足，无法发动【奇谋】' }
            markLimited('weiyan_qimou')
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_QIMOU_HP,
                targetGeneralIndex: state.generals.indexOf(general),
                context: { maxHpLoss: maxLoss },
            })
            addLog(state, `【${name}】发动【奇谋】，选择失去的体力数`)
            return
        }

        // ── 乱武（贾诩限定技）：所有其他角色依次选择：对最近角色出杀或失去1血
        case 'jiaxu_luanwu': {
            if (!hasSkill(general, 'jiaxu_luanwu')) return { error: '你没有此技能' }
            const errL = checkLimited('jiaxu_luanwu')
            if (errL) return errL
            markLimited('jiaxu_luanwu')
            addLog(state, `【${name}】发动【乱武】！所有其他角色须对距离最近的角色出杀或失去1点体力`)
            // 按逆时针从使用者下家开始（不包括贾诩本人）
            const generalIdx = state.generals.indexOf(general)
            const orderedTargets = getDirectionalTargets(state, general, 'counterclockwise')
                .filter(g => g.alive)
            if (orderedTargets.length > 0) {
                // 为第一个角色计算距离最近的目标
                const firstTarget = orderedTargets[0]
                const nearestIndices = findNearestTargets(state, firstTarget)
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_LUANWU_RESPONSE,
                    targetGeneralIndex: state.generals.indexOf(firstTarget),
                    context: {
                        luanwuUserIndex: generalIdx,
                        remainingIndices: orderedTargets.slice(1).map(g => state.generals.indexOf(g)),
                        nearestIndices,
                    },
                })
                const nearestNames = nearestIndices.map((i: number) => getGeneralName(state.generals[i])).join('、')
                addLog(state, `【${getGeneralName(firstTarget)}】：距离最近的角色为【${nearestNames}】，请出【杀】或放弃（失去1血）`)
            }
            return
        }

        // ── 奇袭（甘宁）：黑色牌当过河拆桥
        case 'ganning_qixi': {
            if (!hasSkill(general, 'ganning_qixi')) return { error: '你没有此技能' }
            if (cardIds.length !== 1) return { error: '请选择1张黑色牌' }
            if (targets.length !== 1) return { error: '请选择1名目标' }
            // 支持手牌和装备黑色牌
            const card = findCardInHandOrEquip(general, cardIds[0])
            if (!card) return { error: '找不到该牌' }
            if (card.suit !== CardSuit.SPADE && card.suit !== CardSuit.CLUB) return { error: '须为黑色牌' }
            const target = targets[0]
            // 帷幕检查（过河拆桥是黑色锦囊）
            if (hasSkill(target, 'jiaxu_weimu')) return { error: '目标发动【帷幕】' }
            // 移除牌
            removeCardFromHandOrEquip(state, general, cardIds[0])
            addLog(state, `【${name}】发动【奇袭】（黑色牌当过河拆桥），对【${getGeneralName(target)}】使用`)
            // 走过河拆桥流程：无懈可击 → TRICK_TARGET_CARD_PICK
            const gIdx = state.generals.indexOf(general)
            const tIdx = state.generals.indexOf(target)
            const effect: DeferredTrickEffect = { type: 'dismantle', userIndex: gIdx, targetIndex: tIdx, triggerJizhi: false }
            const deferred = pushNegateCheck(state, TrickCardName.DISMANTLE, gIdx, tIdx, getGeneralName(target), effect)
            if (!deferred) {
                executeDeferredTrickEffect(state, effect)
            }
            return
        }

        // ── 明策（陈宫）：出牌阶段限一次，交给一名其他角色一张装备牌或【杀】，
        //     然后其选择：视为对其攻击范围内由陈宫指定的一名角色使用【杀】；或摸一张牌
        case 'chengong_mingce': {
            if (!hasSkill(general, 'chengong_mingce')) return { error: '你没有此技能' }
            const err = checkOncePerTurn('chengong_mingce')
            if (err) return err
            if (cardIds.length !== 1) return { error: '请选择1张装备牌或【杀】' }
            if (targets.length < 1) return { error: '请选择1名受牌角色' }
            const receiver = targets[0]
            if (receiver === general) return { error: '不能交给自己' }
            // 只能交手牌中的装备牌或【杀】
            const giftCard = general.hand.find(c => c.id === cardIds[0])
            if (!giftCard) return { error: '手牌中找不到此牌' }
            const isSlashCard = giftCard.name === BasicCardName.ATTACK
                || giftCard.name === BasicCardName.FIRE_SLASH
                || giftCard.name === BasicCardName.THUNDER_SLASH
            if (giftCard.category !== CardCategory.EQUIPMENT && !isSlashCard) {
                return { error: '只能交给装备牌或【杀】' }
            }
            // 虚拟杀的目标（可省略=只提供摸牌选项），须在受牌者攻击范围内且不是受牌者自己
            const slashTarget = targets[1]
            if (slashTarget) {
                if (slashTarget === receiver) return { error: '【杀】的目标不能是受牌者自己' }
                // 与 handleBasicCard 保持一致：空城角色不能被【杀】指定
                if (hasSkill(slashTarget, 'zhugeliang_kongcheng') && slashTarget.hand.length === 0) {
                    return { error: `【${getGeneralName(slashTarget)}】发动【空城】，不能成为【杀】的目标` }
                }
                const rangeInfo = getAttackRange(receiver, slashTarget, state.generals)
                if (!rangeInfo.inRange) {
                    return { error: `【${getGeneralName(slashTarget)}】不在【${getGeneralName(receiver)}】攻击范围内` }
                }
                if (isZhichiImmune(state, slashTarget)) {
                    return { error: `【${getGeneralName(slashTarget)}】发动【智迟】，不能成为【杀】的目标` }
                }
            }
            const removed = removeCardsFromHand([giftCard.id])
            if ('error' in removed) return removed
            receiver.hand.push(...removed)
            markUsed('chengong_mingce')
            addLog(state, `【${name}】发动【明策】，将${cardFullName(giftCard)}交给【${getGeneralName(receiver)}】`)
            // 受牌者二选一（确认=视为使用杀，放弃=摸一张牌）
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(receiver),
                context: {
                    skillId: 'chengong_mingce',
                    skillName: '明策',
                    description: slashTarget
                        ? `视为对【${getGeneralName(slashTarget)}】使用一张【杀】，或摸一张牌`
                        : '摸一张牌',
                    mingceSlashTargetIndex: slashTarget ? state.generals.indexOf(slashTarget) : -1,
                    mingceFromIndex: state.generals.indexOf(general),
                },
            })
            return
        }

        // ── 断粮（徐晃）：黑色基本/装备牌当兵粮寸断
        case 'xuhuang_duanliang': {
            if (!hasSkill(general, 'xuhuang_duanliang')) return { error: '你没有此技能' }
            if (cardIds.length !== 1) return { error: '请选择1张黑色非锦囊牌' }
            if (targets.length !== 1) return { error: '请选择1名目标' }
            // 支持手牌和装备牌
            const card = findCardInHandOrEquip(general, cardIds[0])
            if (!card) return { error: '找不到该牌' }
            if (card.suit !== CardSuit.SPADE && card.suit !== CardSuit.CLUB) return { error: '须为黑色牌' }
            if (card.category === CardCategory.TRICK) return { error: '须为黑色非锦囊牌' }
            const target = targets[0]
            // 距离限制：需距离1以内（奇才无距离限制；断粮②仅界徐晃有）
            const duanliangFree = general.generalId === 'xuhuang_jie'
                && target.hand.length >= general.hand.length
            if (!hasSkill(general, 'huangyueying_qicai') && !duanliangFree) {
                const rangeInfo = getAttackRange(general, target, state.generals)
                if (rangeInfo.distance > 1) return { error: '目标距离太远（需距离1以内）' }
            }
            if (target.abolishedJudgeZone) return { error: '目标的判定区已废除（雄乱）' }
            if (target.judgeZone.some(c => c.name === TrickCardName.SUPPLY_SHORTAGE)) return { error: '目标已有兵粮寸断' }
            const removedCard = detachCardFromHandOrEquip(state, general, cardIds[0])
            if ('error' in removedCard) return removedCard
            // 将此牌当兵粮寸断放入目标判定区
            target.judgeZone.push({
                ...removedCard,
                originalName: removedCard.name,
                originalCategory: removedCard.category,
                name: TrickCardName.SUPPLY_SHORTAGE,
                category: CardCategory.TRICK,
                trickType: TrickType.DELAYED,
            })
            addLog(state, `【${name}】发动【断粮】（黑色牌当兵粮寸断），对【${getGeneralName(target)}】放置`)
            return
        }

        // ── 国色（大乔）：方块牌当乐不思蜀
        case 'daqiao_guose': {
            if (!hasSkill(general, 'daqiao_guose')) return { error: '你没有此技能' }
            if (cardIds.length !== 1) return { error: '请选择1张♦牌' }
            if (targets.length !== 1) return { error: '请选择1名目标' }
            // 支持手牌和装备牌
            const card = findCardInHandOrEquip(general, cardIds[0])
            if (!card) return { error: '找不到该牌' }
            if (card.suit !== CardSuit.DIAMOND) return { error: '须为♦牌' }
            const target = targets[0]
            if (target.abolishedJudgeZone) return { error: '目标的判定区已废除（雄乱）' }
            if (target.judgeZone.some(c => c.name === TrickCardName.OVERINDULGENCE)) return { error: '目标已有乐不思蜀' }
            const removedCard = detachCardFromHandOrEquip(state, general, cardIds[0])
            if ('error' in removedCard) return removedCard
            target.judgeZone.push({
                ...removedCard,
                originalName: removedCard.name,
                originalCategory: removedCard.category,
                name: TrickCardName.OVERINDULGENCE,
                category: CardCategory.TRICK,
                trickType: TrickType.DELAYED,
            })
            addLog(state, `【${name}】发动【国色】（♦牌当乐不思蜀），对【${getGeneralName(target)}】放置`)
            return
        }

        // ── 强袭（界典韦）：限两次，受到1点伤害或弃一张武器牌，对一名其他角色造成1点伤害
        case 'dianwei_jie_qiangxi': {
            if (!hasSkill(general, 'dianwei_jie_qiangxi')) return { error: '你没有此技能' }
            const used = general.qiangxiUsesPhase ?? 0
            if (used >= 2) return { error: '本阶段【强袭】已发动两次' }
            if (targets.length !== 1) return { error: '请选择1名其他角色' }
            const target = targets[0]
            if (target === general) return { error: '不能指定自己' }
            const targetIdx = state.generals.indexOf(target)
            if ((general.qiangxiTargetsPhase ?? []).includes(targetIdx)) {
                return { error: '本阶段已对该角色发动过【强袭】' }
            }
            let paidByCard = false
            if (cardIds.length === 1) {
                const card = findCardInHandOrEquip(general, cardIds[0])
                if (!card) return { error: '找不到该牌' }
                if (card.equipSlot !== EquipSlot.WEAPON) return { error: '须弃置一张武器牌，或受到1点伤害' }
                const removed = detachCardFromHandOrEquip(state, general, cardIds[0])
                if ('error' in removed) return removed
                state.discard.push(removed)
                triggerXiaoji(state, general)
                paidByCard = true
            }
            general.qiangxiUsesPhase = used + 1
            general.qiangxiTargetsPhase = [...(general.qiangxiTargetsPhase ?? []), targetIdx]
            general.skillsUsedThisTurn.push('dianwei_jie_qiangxi')
            addLog(state, `【${name}】发动【强袭】${paidByCard ? '（弃置武器牌）' : '（受到1点伤害）'}，对【${getGeneralName(target)}】造成1点伤害`)
            if (!paidByCard) dealDamage(state, null, general, 1)
            dealDamage(state, general, target, 1)
            return
        }

        // ── 慎行（顾雍）：弃置两张牌，摸一张牌
        case 'guyong_shenxing': {
            if (!hasSkill(general, 'guyong_shenxing')) return { error: '你没有此技能' }
            const shenxingUsed = general.skillsUsedThisTurn.filter((id) => id === 'guyong_shenxing').length
            if (shenxingUsed >= general.hp) {
                return { error: `本阶段【慎行】已发动 ${shenxingUsed} 次（上限 ${general.hp}）` }
            }
            if (cardIds.length !== 2) return { error: '请选择2张牌' }
            const cards: Card[] = []
            for (const cid of cardIds) {
                const removed = removeCardFromHandOrEquip(state, general, cid)
                if ('error' in removed) return removed
                cards.push(removed)
            }
            const sxIsRed = (c: Card) => c.suit === CardSuit.HEART || c.suit === CardSuit.DIAMOND
            const sxDifferent = sxIsRed(cards[0]) !== sxIsRed(cards[1])
            const drawn = drawCards(state, sxDifferent ? 2 : 1)
            general.hand.push(...drawn)
            markUsed('guyong_shenxing')
            addLog(state, `【${name}】发动【慎行】，弃置${cards.map(c => cardFullName(c)).join('、')}，颜色${sxDifferent ? '不同' : '相同'}，摸 ${drawn.length} 张牌`)
            return
        }

        // ── 去疾（司马朗）：弃X张牌，令至多X名角色各回复1点体力
        case 'simalang_quji': {
            if (!hasSkill(general, 'simalang_quji')) return { error: '你没有此技能' }
            const err = checkOncePerTurn('simalang_quji')
            if (err) return err
            const lostHp = general.maxHp - general.hp
            if (lostHp <= 0) return { error: '你未受伤，无法发动【去疾】' }
            if (cardIds.length !== lostHp) return { error: `须弃置 ${lostHp} 张牌` }
            if (targets.length < 1) return { error: '请选择回复体力的角色' }
            const healed = targets.filter(t => t.hp < t.maxHp).slice(0, lostHp)
            if (healed.length === 0) return { error: '目标均已满体力' }
            let hasBlack = false
            for (const cid of cardIds) {
                const card = findCardInHandOrEquip(general, cid)
                if (!card) return { error: '找不到选择的牌' }
                if (card.suit === CardSuit.SPADE || card.suit === CardSuit.CLUB) hasBlack = true
                const removed = removeCardFromHandOrEquip(state, general, cid)
                if ('error' in removed) return removed
            }
            markUsed('simalang_quji')
            for (const t of healed) {
                t.hp += 1
                addLog(state, `【${getGeneralName(t)}】因【去疾】回复1点体力至 ${t.hp}/${t.maxHp}`)
                triggerDianhuRecover(state, t)
                triggerLiangzhu(state, t)
            }
            addLog(state, `【${name}】发动【去疾】`)
            if (hasBlack) loseHp(state, general, 1)
            return
        }

        // ── 飞军（王平）：弃一张牌，令一名角色交你一张牌或令你摸两张牌
        case 'wangping_feijun': {
            if (!hasSkill(general, 'wangping_feijun')) return { error: '你没有此技能' }
            const err = checkOncePerTurn('wangping_feijun')
            if (err) return err
            if (cardIds.length !== 1) return { error: '请选择1张牌弃置' }
            if (targets.length !== 1) return { error: '请选择1名目标角色' }
            const target = targets[0]
            if (target === general) return { error: '不能指定自己' }
            if (target.hand.length <= general.hand.length && equipmentCount(target) <= equipmentCount(general)) {
                return { error: '目标的手牌数和装备区牌数都不大于你' }
            }
            const removed = removeCardFromHandOrEquip(state, general, cardIds[0])
            if ('error' in removed) return removed
            markUsed('wangping_feijun')
            addLog(state, `【${name}】发动【飞军】，弃置一张牌，对【${getGeneralName(target)}】`)

            const canGive = target.hand.length > general.hand.length
            const canEquip = equipmentCount(target) > equipmentCount(general)
            if (canGive && canEquip) {
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                    targetGeneralIndex: state.generals.indexOf(general),
                    context: {
                        skillId: 'wangping_feijun_option',
                        skillName: '飞军',
                        description: `对【${getGeneralName(target)}】：令其交给你一张牌，或弃置其一张装备牌`,
                        feijunUserIndex: state.generals.indexOf(general),
                        feijunTargetIndex: state.generals.indexOf(target),
                    },
                })
            } else {
                applyFeijun(state, general, target, canGive ? 'give' : 'equip')
            }
            return
        }

        // ── 劝谏（黄权）：令一名其他角色交给你一张牌，否则你摸一张且本回合不能使用手牌
        case 'huangquan_quanjian': {
            if (!hasSkill(general, 'huangquan_quanjian')) return { error: '你没有此技能' }
            const err = checkOncePerTurn('huangquan_quanjian')
            if (err) return err
            if (targets.length !== 1) return { error: '请选择1名其他角色' }
            const target = targets[0]
            if (target === general) return { error: '不能指定自己' }
            markUsed('huangquan_quanjian')
            addLog(state, `【${name}】对【${getGeneralName(target)}】发动【劝谏】`)
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(target),
                context: {
                    skillId: 'huangquan_quanjian',
                    skillName: '劝谏',
                    description: '交给黄权一张牌，或令其摸一张牌且本回合不能使用手牌',
                    quanjianUserIndex: state.generals.indexOf(general),
                },
            })
            return
        }

        // ── 谏计（黄权）：令一名其他角色摸一张牌，然后其可以使用该牌
        case 'huangquan_jianji': {
            if (!hasSkill(general, 'huangquan_jianji')) return { error: '你没有此技能' }
            const err = checkOncePerTurn('huangquan_jianji')
            if (err) return err
            if (targets.length !== 1) return { error: '请选择1名其他角色' }
            const target = targets[0]
            if (target === general) return { error: '不能指定自己' }
            const drawn = drawCards(state, 1)
            if (drawn.length === 0) return { error: '牌堆为空' }
            markUsed('huangquan_jianji')
            const card = drawn[0]
            target.hand.push(card)
            addLog(state, `【${name}】对【${getGeneralName(target)}】发动【谏计】，其摸一张牌`)
            // 摸到的牌由目标自己决定是否使用，不能替他做主
            const canAuto = (card.category === CardCategory.EQUIPMENT && !!card.equipSlot)
                || (card.name === BasicCardName.PEACH && target.hp < target.maxHp)
                || card.name === TrickCardName.DRAW_TWO
            const canSlash = isCardUsableAsAttack(target, card) && state.generals.some(
                (g) => g.alive && g !== target && getAttackRange(target, g, state.generals).inRange)
            if (!canAuto && !canSlash) return
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(target),
                context: {
                    skillId: 'huangquan_jianji',
                    skillName: '谏计',
                    description: `是否使用刚摸到的${cardFullName(card)}`,
                    jianjiCardId: card.id,
                    jianjiCanSlash: canSlash,
                },
            })
            return
        }

        // ── 黩武（诸葛恪）：弃X张牌（X为目标体力值），对攻击范围内一名角色造成1点伤害
        case 'zhugeke_duwu': {
            if (!hasSkill(general, 'zhugeke_duwu')) return { error: '你没有此技能' }
            if (general.duwuLockedThisPhase) return { error: '本阶段【黩武】已失效' }
            if (targets.length !== 1) return { error: '请选择1名其他角色' }
            const target = targets[0]
            if (target === general) return { error: '不能指定自己' }
            if (!getAttackRange(general, target, state.generals).inRange) return { error: '目标不在攻击范围内' }
            const x = target.hp
            if (x <= 0) return { error: '目标体力值不足' }
            if (cardIds.length !== x) return { error: `须弃置 ${x} 张牌` }
            for (const cid of cardIds) {
                if (!findCardInHandOrEquip(general, cid)) return { error: '找不到选择的牌' }
            }
            for (const cid of cardIds) removeCardFromHandOrEquip(state, general, cid)
            addLog(state, `【${name}】发动【黩武】弃 ${x} 张牌，对【${getGeneralName(target)}】造成1点伤害`)
            dealDamage(state, general, target, 1)
            if (target.hp <= 0) {
                general.duwuLockedThisPhase = true
                loseHp(state, general, 1)
                addLog(state, `【${name}】【黩武】导致濒死，失去1点体力且本阶段【黩武】失效`)
            }
            return
        }

        // ── 奋迅（丁奉）：本回合与其距离视为1；若回合结束未对其造成伤害，则弃一张牌
        case 'dingfeng_fenxun': {
            if (!hasSkill(general, 'dingfeng_fenxun')) return { error: '你没有此技能' }
            const err = checkOncePerTurn('dingfeng_fenxun')
            if (err) return err
            if (targets.length !== 1) return { error: '请选择1名其他角色' }
            const target = targets[0]
            if (target === general) return { error: '不能指定自己' }
            general.fenxunTargetIndex = state.generals.indexOf(target)
            general.fenxunDamagedTarget = false
            markUsed('dingfeng_fenxun')
            addLog(state, `【${name}】发动【奋迅】，本回合与【${getGeneralName(target)}】距离视为1`)
            return
        }

        // ── 奇策（荀攸）：将所有手牌当一张普通锦囊使用
        case 'xunyou_qice': {
            if (!hasSkill(general, 'xunyou_qice')) return { error: '你没有此技能' }
            const qiceUsed = general.skillsUsedThisTurn.filter((id) => id === 'xunyou_qice').length
            if (qiceUsed > (general.qiceBonusThisTurn ?? 0)) {
                return { error: '本阶段【奇策】已使用过' }
            }
            if (general.hand.length === 0) return { error: '你没有手牌可作为奇策的牌' }
            const cost = [...general.hand]
            general.hand = []
            state.discard.push(...cost)
            markUsed('xunyou_qice')
            addLog(state, `【${name}】发动【奇策】，将 ${cost.length} 张手牌当作普通锦囊使用`)
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_QICE_PICK,
                targetGeneralIndex: state.generals.indexOf(general),
                context: {
                    qiceTargetIndices: data.targetIndices ?? [],
                    qiceCostCount: cost.length,
                },
            })
            return
        }

        // ── 清侧（毌丘俭）：获得一张“荣”并弃置一张手牌，然后弃置场上的一张牌
        case 'guanqiujian_qingce': {
            if (!hasSkill(general, 'guanqiujian_qingce')) return { error: '你没有此技能' }
            if (state.turnPhase !== TurnPhase.ACTION) return { error: '只能在出牌阶段发动' }
            if ((general.generalPile?.length ?? 0) === 0) return { error: '你没有“荣”' }
            const qcRong = general.generalPile!.shift()!
            general.hand.push(qcRong)
            addLog(state, `【${name}】发动【清侧】，获得一张“荣”`)
            askPickCard(state, general, 'guanqiujian_qingce', '清侧', '弃置一张手牌', { count: 1, mode: 'discard' })
            return
        }

        // ── 急袭（邓艾）：将一张“田”当【顺手牵羊】使用
        case 'dengai_jixi': {
            if (!hasSkill(general, 'dengai_jixi')) return { error: '你没有此技能' }
            if ((general.generalPile?.length ?? 0) === 0) return { error: '你没有“田”' }
            if (targets.length !== 1) return { error: '请选择1名目标角色' }
            const target = targets[0]
            if (target === general) return { error: '不能指定自己' }
            const rangeInfo = getAttackRange(general, target, state.generals)
            if (rangeInfo.distance > 1 && !hasSkill(general, 'huangyueying_qicai')) {
                return { error: '目标距离太远（需距离1以内）' }
            }
            if (hasSkill(target, 'jiaxu_weimu')) return { error: '目标发动【帷幕】' }
            const tian = general.generalPile!.pop()!
            state.discard.push(tian)
            addLog(state, `【${name}】发动【急袭】，将一张“田”当【顺手牵羊】对【${getGeneralName(target)}】使用`)
            const gIdx = state.generals.indexOf(general)
            const tIdx = state.generals.indexOf(target)
            const effect: DeferredTrickEffect = { type: 'steal', userIndex: gIdx, targetIndex: tIdx, triggerJizhi: false }
            const deferred = pushNegateCheck(state, TrickCardName.STEAL, gIdx, tIdx, getGeneralName(target), effect)
            if (!deferred) executeDeferredTrickEffect(state, effect)
            return
        }

        // ── 引兵（祖茂）：将任意张非基本牌置于武将牌上
        case 'zumao_yinbing': {
            if (!hasSkill(general, 'zumao_yinbing')) return { error: '你没有此技能' }
            const err = checkOncePerTurn('zumao_yinbing')
            if (err) return err
            if (cardIds.length === 0) return { error: '请选择非基本牌' }
            const moved: Card[] = []
            for (const cid of cardIds) {
                const card = findCardInHandOrEquip(general, cid)
                if (!card) return { error: '找不到选择的牌' }
                if (card.category === CardCategory.BASIC) return { error: '只能选择非基本牌' }
                const removed = detachCardFromHandOrEquip(state, general, cid)
                if ('error' in removed) return removed
                moved.push(removed)
            }
            general.generalPile!.push(...moved)
            triggerLiangyin(state, 'out')
            markUsed('zumao_yinbing')
            addLog(state, `【${name}】发动【引兵】，将 ${moved.length} 张牌置于武将牌上`)
            return
        }

        // ── 献州（蔡夫人限定技）：将装备区所有牌交给一名其他角色
        // ── 成略（许攸）：转换技，摸牌后弃牌，弃置牌的花色本回合无距离与次数限制
        case 'xuyou_chenglue': {
            if (!hasSkill(general, 'xuyou_chenglue')) return { error: '你没有此技能' }
            const errCl = checkOncePerTurn('xuyou_chenglue')
            if (errCl) return errCl
            const isYang = general.chenglueYang !== false
            const drawCount = isYang ? 1 : 2
            const discardCount = isYang ? 2 : 1
            if (general.hand.length + drawCount < discardCount) return { error: '手牌不足，无法发动【成略】' }
            general.chenglueYang = !isYang
            const drawn = drawForGeneral(state, general, drawCount)
            general.hand.push(...drawn)
            markUsed('xuyou_chenglue')
            addLog(state, `【${name}】发动【成略】（${isYang ? '阳' : '阴'}），摸${drawn.length}张牌，须弃置${discardCount}张手牌`)
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_PICK_CARD,
                targetGeneralIndex: state.generals.indexOf(general),
                context: {
                    skillId: 'xuyou_chenglue',
                    skillName: '成略',
                    description: `弃置${discardCount}张手牌（弃置牌的花色本回合无距离与次数限制）`,
                    count: discardCount,
                    mode: 'discard',
                },
            })
            return
        }

        // ── 弓骑（韩当）：弃一张牌，本阶段攻击范围无限；弃装备牌可再拆一张
        case 'handang_gongqi': {
            if (!hasSkill(general, 'handang_gongqi')) return { error: '你没有此技能' }
            const errGq = checkOncePerTurn('handang_gongqi')
            if (errGq) return errGq
            if (cardIds.length !== 1) return { error: '请选择一张牌弃置' }
            const gqCard = findCardInHandOrEquip(general, cardIds[0])
            if (!gqCard) return { error: '找不到该牌' }
            const gqIsEquip = gqCard.category === CardCategory.EQUIPMENT
            const gqRemoved = removeCardFromHandOrEquip(state, general, gqCard.id)
            if ('error' in gqRemoved) return gqRemoved
            markUsed('handang_gongqi')
            general.infiniteRangePhase = true
            addLog(state, `【${name}】发动【弓骑】，弃置${cardFullName(gqCard)}，本阶段攻击范围无限`)
            if (gqIsEquip) {
                const gqTargets = state.generals
                    .map((g, idx) => ({ g, idx }))
                    .filter(({ g }) => g.alive && g !== general
                        && (g.hand.length > 0 || Object.values(g.equip).some(Boolean)))
                    .map(({ idx }) => idx)
                if (gqTargets.length > 0) {
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.SKILL_CHOOSE_TARGET,
                        targetGeneralIndex: state.generals.indexOf(general),
                        context: {
                            skillId: 'handang_gongqi',
                            skillName: '弓骑',
                            description: '弃置一名其他角色的一张牌',
                            candidateIndices: gqTargets,
                        },
                    })
                }
            }
            return
        }

        // ── 解烦（韩当限定技）：攻击范围内含目标者依次弃武器或让目标摸一张
        case 'handang_jiefan': {
            if (!hasSkill(general, 'handang_jiefan')) return { error: '你没有此技能' }
            const errJf = checkLimited('handang_jiefan')
            if (errJf) return errJf
            if (targets.length !== 1) return { error: '请选择一名角色' }
            const jfTarget = targets[0]
            markLimited('handang_jiefan')
            const jfTargetIdx = state.generals.indexOf(jfTarget)
            const jfSeq = state.generals
                .map((g, idx) => ({ g, idx }))
                .filter(({ g, idx }) => g.alive && idx !== jfTargetIdx
                    && getAttackRange(g, jfTarget, state.generals).inRange)
                .map(({ idx }) => idx)
            addLog(state, `【${name}】发动【解烦】，攻击范围内含【${getGeneralName(jfTarget)}】的角色依次选择`)
            if (jfSeq.length === 0) return
            const jfFirst = jfSeq.shift()!
            const jfFirstGeneral = state.generals[jfFirst]
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: jfFirst,
                context: {
                    skillId: 'handang_jiefan',
                    skillName: '解烦',
                    description: `弃置一张武器牌，或令【${getGeneralName(jfTarget)}】摸一张牌`,
                    options: [
                        ...(jfFirstGeneral.equip[EquipSlot.WEAPON]
                            ? [{ action: 'discard', label: '弃置一张武器牌' }] : []),
                        { action: 'draw', label: `令【${getGeneralName(jfTarget)}】摸一张牌` },
                    ],
                    jiefanTargetIndex: jfTargetIdx,
                    jiefanRemaining: jfSeq,
                },
            })
            return
        }

        // ── 散谣（马谡）：弃一张牌，对体力值最多 / 手牌数最多者造成1点伤害
        case 'masu_sanyao': {
            if (!hasSkill(general, 'masu_sanyao')) return { error: '你没有此技能' }
            const syHpUsed = general.skillsUsedThisTurn.includes('masu_sanyao_hp')
            const syHandUsed = general.skillsUsedThisTurn.includes('masu_sanyao_hand')
            if (syHpUsed && syHandUsed) return { error: '本阶段【散谣】两项均已使用' }
            if (cardIds.length !== 1) return { error: '请选择一张牌弃置' }
            if (targets.length !== 1) return { error: '请选择一名角色' }
            const syVictim = targets[0]
            const aliveList = state.generals.filter(g => g.alive)
            const maxHpValue = Math.max(...aliveList.map(g => g.hp))
            const maxHandValue = Math.max(...aliveList.map(g => g.hand.length))
            const canHp = !syHpUsed && syVictim.hp === maxHpValue
            const canHand = !syHandUsed && syVictim.hand.length === maxHandValue
            if (!canHp && !canHand) return { error: '该角色不是体力值最多或手牌数最多的角色' }
            const syRemoved = removeCardFromHandOrEquip(state, general, cardIds[0])
            if ('error' in syRemoved) return syRemoved
            const syMode = canHp ? 'masu_sanyao_hp' : 'masu_sanyao_hand'
            general.skillsUsedThisTurn.push(syMode)
            addLog(state, `【${name}】发动【散谣】（${canHp ? '体力值最多' : '手牌数最多'}），对【${getGeneralName(syVictim)}】造成1点伤害`)
            dealDamage(state, general, syVictim, 1)
            return
        }

        // ── 极奢（岑昏）：摸一张牌，本回合手牌上限-1
        case 'cenhun_jishe': {
            if (!hasSkill(general, 'cenhun_jishe')) return { error: '你没有此技能' }
            if (getHandLimit(general) <= 0) return { error: '手牌上限为0，不能发动【极奢】' }
            const jsheDrawn = drawForGeneral(state, general, 1)
            general.hand.push(...jsheDrawn)
            general.handLimitDelta = (general.handLimitDelta ?? 0) - 1
            general.jisheCount = (general.jisheCount ?? 0) + 1
            addLog(state, `【${name}】发动【极奢】，摸${jsheDrawn.length}张牌，本回合手牌上限-1`)
            return
        }

        // ── 匡弼（孙登）：令一名其他角色将至多三张牌置于你的武将牌上
        case 'sundeng_kuangbi': {
            if (!hasSkill(general, 'sundeng_kuangbi')) return { error: '你没有此技能' }
            const errKb = checkOncePerTurn('sundeng_kuangbi')
            if (errKb) return errKb
            if (targets.length !== 1) return { error: '请选择一名其他角色' }
            const kbTarget = targets[0]
            if (kbTarget === general) return { error: '不能选择自己' }
            if (kbTarget.hand.length === 0 && !Object.values(kbTarget.equip).some(Boolean)) {
                return { error: '该角色没有牌可以置于武将牌上' }
            }
            markUsed('sundeng_kuangbi')
            addLog(state, `【${name}】发动【匡弼】，令【${getGeneralName(kbTarget)}】将至多三张牌置于其武将牌上`)
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_PICK_CARD,
                targetGeneralIndex: state.generals.indexOf(kbTarget),
                context: {
                    skillId: 'sundeng_kuangbi',
                    skillName: '匡弼',
                    description: '将至多三张牌置于孙登的武将牌上（下回合其获得）',
                    count: 3,
                    mode: 'kuangbi',
                    kuangbiOwnerIndex: state.generals.indexOf(general),
                },
            })
            return
        }

        // ── 矫诏（界郭皇后）：将一张牌当任意基本牌；修改一/二为每轮限一次的额外用法
        case 'simayi_jie_jiaozhao':
        case 'simayi_jie_jiaozhao_mod1':
        case 'simayi_jie_jiaozhao_mod2': {
            if (!hasSkill(general, 'simayi_jie_jiaozhao')) return { error: '你没有此技能' }
            const jzMode = data.skillId === 'simayi_jie_jiaozhao_mod2' ? 2
                : data.skillId === 'simayi_jie_jiaozhao_mod1' ? 1 : 0
            const jzRound = state.roundState?.roundNumber ?? 0
            if (jzMode === 0) {
                const jzErr = checkOncePerTurn('simayi_jie_jiaozhao')
                if (jzErr) return jzErr
            } else {
                if ((general.jiaozhaoUpgrade ?? 0) < jzMode) return { error: '【矫诏】的修改等级不足' }
                const usedRound = jzMode === 1 ? general.jiaozhaoMod1Round : general.jiaozhaoMod2Round
                if (usedRound === jzRound) return { error: '本大回合已发动过此修改' }
            }
            const jzVirtual = jzMode === 2
            if (jzVirtual) {
                general.jiaozhaoCardId = undefined
                general.jiaozhaoAs = undefined
                addLog(state, `【${name}】发动【矫诏】（修改二），视为使用一张牌`)
            } else {
                if (cardIds.length !== 1) return { error: '请选择一张牌' }
                const jzCard = findCardInHandOrEquip(general, cardIds[0])
                if (!jzCard) return { error: '找不到该牌' }
                general.jiaozhaoCardId = jzCard.id
                general.jiaozhaoAs = undefined
                addLog(state, `【${name}】发动【矫诏】${jzMode === 1 ? '（修改一）' : ''}，展示${cardFullName(jzCard)}`)
            }
            if (jzMode === 0) markUsed('simayi_jie_jiaozhao')
            else if (jzMode === 1) general.jiaozhaoMod1Round = jzRound
            else general.jiaozhaoMod2Round = jzRound
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(general),
                context: {
                    skillId: 'guohuanghou_jiaozhao_declare',
                    skillName: '矫诏',
                    description: jzVirtual
                        ? '声明一种牌名，视为使用该牌'
                        : '声明一种牌名，本回合可将展示的牌当该牌使用',
                    options: [
                        { action: 'attack', label: '杀' },
                        ...(jzVirtual ? [] : [{ action: 'dodge', label: '闪' }]),
                        { action: 'peach', label: '桃' },
                        { action: 'wine', label: '酒' },
                        ...(jzMode >= 1 ? [
                            { action: 'draw_two', label: '无中生有' },
                            { action: 'dismantle', label: '过河拆桥' },
                            { action: 'steal', label: '顺手牵羊' },
                            { action: 'duel', label: '决斗' },
                        ] : []),
                    ],
                    jiaozhaoOwnerIndex: state.generals.indexOf(general),
                    jiaozhaoVirtual: jzVirtual,
                },
            })
            return
        }

        // ── 矫诏（郭皇后）：展示一张手牌，令最近的其他角色声明基本牌
        case 'guohuanghou_jiaozhao': {
            if (!hasSkill(general, 'guohuanghou_jiaozhao')) return { error: '你没有此技能' }
            const errJz = checkOncePerTurn('guohuanghou_jiaozhao')
            if (errJz) return errJz
            if (cardIds.length !== 1) return { error: '请展示一张手牌' }
            const jzCard = general.hand.find(c => c.id === cardIds[0])
            if (!jzCard) return { error: '手牌中没有此牌' }
            markUsed('guohuanghou_jiaozhao')
            general.jiaozhaoCardId = jzCard.id
            general.jiaozhaoAs = undefined
            addLog(state, `【${name}】发动【矫诏】，展示${cardFullName(jzCard)}`)
            const jzDeclareOptions = [
                { action: 'attack', label: '杀' },
                { action: 'dodge', label: '闪' },
                { action: 'peach', label: '桃' },
                { action: 'wine', label: '酒' },
                ...((general.jiaozhaoUpgrade ?? 0) >= 1 ? [
                    { action: 'draw_two', label: '无中生有' },
                    { action: 'dismantle', label: '过河拆桥' },
                    { action: 'steal', label: '顺手牵羊' },
                    { action: 'duel', label: '决斗' },
                ] : []),
            ]
            if ((general.jiaozhaoUpgrade ?? 0) >= 2) {
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                    targetGeneralIndex: state.generals.indexOf(general),
                    context: {
                        skillId: 'guohuanghou_jiaozhao_declare',
                        skillName: '矫诏',
                        description: '声明一种牌名',
                        options: jzDeclareOptions,
                        jiaozhaoOwnerIndex: state.generals.indexOf(general),
                    },
                })
            } else {
                const jzNearest = nearestOtherIndexes(state, general)
                if (jzNearest.length === 0) return { error: '没有其他角色可以声明' }
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_CHOOSE_TARGET,
                    targetGeneralIndex: state.generals.indexOf(general),
                    context: {
                        skillId: 'guohuanghou_jiaozhao',
                        skillName: '矫诏',
                        description: '选择一名距离最近的其他角色，由其声明牌名',
                        candidateIndices: jzNearest,
                        jiaozhaoOptions: jzDeclareOptions,
                    },
                })
            }
            return
        }

        // ── 燕语（夏侯氏）：重铸【杀】；本阶段重铸两张后可为一名男性角色摸两张牌
        case 'xiahoushi_yanyu': {
            if (!hasSkill(general, 'xiahoushi_yanyu')) return { error: '你没有此技能' }
            if (cardIds.length !== 1) return { error: '请选择一张【杀】重铸' }
            const yyCard = general.hand.find(c => c.id === cardIds[0])
            if (!yyCard || !isCardUsableAsAttack(general, yyCard)) return { error: '请选择一张【杀】' }
            general.hand.splice(general.hand.indexOf(yyCard), 1)
            state.discard.push(yyCard)
            general.yanyuRecast = (general.yanyuRecast ?? 0) + 1
            const yyDrawn = drawForGeneral(state, general, 1)
            general.hand.push(...yyDrawn)
            addLog(state, `【${name}】发动【燕语】重铸一张【杀】，摸${yyDrawn.length}张牌（本阶段已重铸${general.yanyuRecast}张）`)
            return
        }

        // ── 怀异（公孙渊）：展示手牌，弃一种颜色，获得等量其他角色的各一张牌
        case 'gongsunyuan_huaiyi': {
            if (!hasSkill(general, 'gongsunyuan_huaiyi')) return { error: '你没有此技能' }
            const errHy = checkOncePerTurn('gongsunyuan_huaiyi')
            if (errHy) return errHy
            if (general.hand.length === 0) return { error: '没有手牌可展示' }
            const hyRed = general.hand.filter(c => c.suit === CardSuit.HEART || c.suit === CardSuit.DIAMOND).length
            const hyBlack = general.hand.length - hyRed
            if (hyRed === 0 || hyBlack === 0) return { error: '手牌须包含两种颜色' }
            markUsed('gongsunyuan_huaiyi')
            addLog(state, `【${name}】发动【怀异】，展示${general.hand.length}张手牌`)
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(general),
                context: {
                    skillId: 'gongsunyuan_huaiyi',
                    skillName: '怀异',
                    description: `弃置一种颜色的所有手牌（红${hyRed}张 / 黑${hyBlack}张），然后获得等量其他角色的各一张牌`,
                    options: [
                        { action: 'red', label: `弃置所有红色手牌（${hyRed}张）` },
                        { action: 'black', label: `弃置所有黑色手牌（${hyBlack}张）` },
                    ],
                },
            })
            return
        }

        case 'caifuren_xianzhou': {
            if (!hasSkill(general, 'caifuren_xianzhou')) return { error: '你没有此技能' }
            const errL = checkLimited('caifuren_xianzhou')
            if (errL) return errL
            if (targets.length !== 1) return { error: '请选择1名其他角色' }
            const target = targets[0]
            if (target === general) return { error: '不能指定自己' }
            const give: Card[] = []
            for (const slot of Object.values(EquipSlot)) {
                if (general.equip[slot]) {
                    give.push(general.equip[slot]!)
                    clearEquipSlot(state, general, slot)
                }
            }
            if (give.length === 0) return { error: '你的装备区没有牌' }
            target.hand.push(...give)
            markLimited('caifuren_xianzhou')
            addLog(state, `【${name}】发动【献州】，将 ${give.length} 张装备牌交给【${getGeneralName(target)}】`)
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(target),
                context: {
                    skillId: 'caifuren_xianzhou',
                    skillName: '献州',
                    description: `令蔡夫人回复${give.length}点体力，或对其攻击范围内的至多${give.length}名角色各造成1点伤害`,
                    options: [
                        { action: 'heal', label: `令蔡夫人回复 ${give.length} 点体力` },
                        { action: 'damage', label: `对其攻击范围内的至多 ${give.length} 名角色各造成1点伤害` },
                    ],
                    xianzhouUserIndex: state.generals.indexOf(general),
                    xianzhouCount: give.length,
                    xianzhouChooserIndex: state.generals.indexOf(target),
                },
            })
            return
        }

        case 'equip_zhangba_spear': {
            // 丈八蛇矛：弃2张手牌当杀使用
            if (general.equip.weapon?.name !== EquipmentCardName.ZHANGBA_SPEAR) return { error: '未装备丈八蛇矛' }
            if (cardIds.length !== 2) return { error: '需要选择2张手牌' }
            if (targets.length !== 1) return { error: '需要指定1个目标' }

            // 杀次数限制
            let maxAttacks = 1
            if (hasSkill(general, 'zhangfei_paoxiao')) maxAttacks = 999
            maxAttacks += (general.dufengBonus ?? 0) + (general.extraSlashCount ?? 0)
                + (hasSkill(general, 'lvbu_jing_shenji') ? 1 : 0)
                + (hasSkill(general, 'doudizhu_bahu') ? 1 : 0)
            if (state.attackUsedThisTurn >= maxAttacks) return { error: '本回合出杀次数已满' }

            const card1Idx = general.hand.findIndex(c => c.id === cardIds[0])
            const card2Idx = general.hand.findIndex(c => c.id === cardIds[1])
            if (card1Idx === -1 || card2Idx === -1) return { error: '手牌中找不到选择的牌' }

            const target = targets[0]
            // 不能杀自己
            if (target === general) return { error: '不能对自己使用【杀】' }
            // 空城
            if (hasSkill(target, 'zhugeliang_kongcheng') && target.hand.length === 0) {
                return { error: '目标发动空城，不能被杀指定' }
            }

            // 弃2牌
            const cards = [general.hand[card1Idx], general.hand[card2Idx]]
            const sortedIndices = [card1Idx, card2Idx].sort((a, b) => b - a)
            sortedIndices.forEach(i => general.hand.splice(i, 1))
            state.discard.push(...cards)
            state.attackUsedThisTurn++
            consumeWineBonus(state, general)

            addLog(state, `【${name}】发动【丈八蛇矛】（弃${cards.map(c => cardFullName(c)).join('、')}）对【${getGeneralName(target)}】使用了【杀】`)

            const targetIdx = state.generals.indexOf(target)
            const attackerIdx = state.generals.indexOf(general)
            const requiredDodges = hasSkill(general, 'lvbu_wushuang') ? 2 : 1

            // 推 DODGE
            state.pendingResponseQueue.unshift({
                type: ResponseType.DODGE,
                targetGeneralIndex: targetIdx,
                context: {
                    attackerGeneralIndex: attackerIdx,
                    requiredDodges,
                    dodgesReceived: 0,
                    // 丈八蛇矛的杀没有单张 attackCard
                },
            })
            return
        }

        // ══ 洛书版扩展（四）：新增武将主动技 ══
        // ── 宴诛（孙休）：令一名有牌的其他角色选择弃一张牌，或令你获得其装备区的所有牌并失去此技能
        case 'sunxiu_yanzhu': {
            if (!hasSkill(general, 'sunxiu_yanzhu')) return { error: '你没有此技能' }
            const yzErr = checkOncePerTurn('sunxiu_yanzhu'); if (yzErr) return yzErr
            const yzTarget = targets[0]
            if (!yzTarget) return { error: '请选择一名其他角色' }
            if (yzTarget === general) return { error: '不能选择自己' }
            const yzHasEquip = Object.values(yzTarget.equip).some(Boolean)
            if (yzTarget.hand.length === 0 && !yzHasEquip) return { error: '该角色没有牌' }
            markUsed('sunxiu_yanzhu')
            const yzOptions: { action: string; label: string }[] = [
                { action: 'discard', label: '弃置一张牌' },
            ]
            if (yzHasEquip) {
                yzOptions.push({
                    action: 'equip',
                    label: '令【孙休】获得你装备区里的所有牌，然后其失去【宴诛】',
                })
            }
            addLog(state, `【${name}】发动【宴诛】，令【${getGeneralName(yzTarget)}】选择一项`)
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(yzTarget),
                context: {
                    skillId: 'sunxiu_yanzhu',
                    skillName: '宴诛',
                    description: '选择一项',
                    options: yzOptions,
                    yanzhuOwnerIndex: state.generals.indexOf(general),
                },
            })
            return
        }

        // ── 安国（朱治）：目标每有一项为全场最少，其执行对应效果；未执行的分支由你执行
        case 'zhuzhi_anguo': {
            if (!hasSkill(general, 'zhuzhi_anguo')) return { error: '你没有此技能' }
            const agErr = checkOncePerTurn('zhuzhi_anguo'); if (agErr) return agErr
            const agTarget = targets[0]
            if (!agTarget) return { error: '请选择一名其他角色' }
            if (agTarget === general) return { error: '不能选择自己' }
            markUsed('zhuzhi_anguo')
            const aliveAll = state.generals.filter(g => g.alive)
            const minHand = Math.min(...aliveAll.map(g => g.hand.length))
            const minHp = Math.min(...aliveAll.map(g => g.hp))
            const minEquip = Math.min(...aliveAll.map(g => equippedCount(g)))
            const anguoBranches: {
                key: string
                met: (g: GeneralInstance) => boolean
                run: (g: GeneralInstance) => void
            }[] = [
                {
                    key: 'hand',
                    met: (g) => g.hand.length === minHand,
                    run: (g) => {
                        const drawn = drawForGeneral(state, g, 1)
                        g.hand.push(...drawn)
                        addLog(state, `【${name}】发动【安国】，【${getGeneralName(g)}】摸${drawn.length}张牌`)
                    },
                },
                {
                    key: 'hp',
                    met: (g) => g.hp === minHp,
                    run: (g) => {
                        if (g.hp >= g.maxHp) return
                        g.hp += 1
                        addLog(state, `【${name}】发动【安国】，【${getGeneralName(g)}】回复1点体力`)
                        triggerDianhuRecover(state, g)
                    },
                },
                {
                    key: 'equip',
                    met: (g) => equippedCount(g) === minEquip,
                    run: (g) => {
                        const handEquips = g.hand.filter(c => c.category === CardCategory.EQUIPMENT && c.equipSlot)
                        if (handEquips.length === 0) {
                            addLog(state, `【${name}】【安国】：【${getGeneralName(g)}】没有装备牌可以使用`)
                            return
                        }
                        const pick = handEquips[randomInt(handEquips.length)]
                        g.hand.splice(g.hand.indexOf(pick), 1)
                        const oldEquip = g.equip[pick.equipSlot!]
                        if (oldEquip) state.discard.push(oldEquip)
                        g.equip[pick.equipSlot!] = pick
                        addLog(state, `【${name}】发动【安国】，【${getGeneralName(g)}】随机使用了${cardFullName(pick)}`)
                    },
                },
            ]
            addLog(state, `【${name}】发动【安国】，选择【${getGeneralName(agTarget)}】`)
            const anguoDone: string[] = []
            for (const branch of anguoBranches) {
                if (!branch.met(agTarget)) continue
                branch.run(agTarget)
                anguoDone.push(branch.key)
            }
            for (const branch of anguoBranches) {
                if (anguoDone.includes(branch.key)) continue
                if (!branch.met(general)) continue
                branch.run(general)
            }
            return
        }

        // ── 雄乱（张绣）：限定技，废除判定区与装备区并选择一名其他角色
        case 'zhangxiu_xiongluan': {
            if (!hasSkill(general, 'zhangxiu_xiongluan')) return { error: '你没有此技能' }
            const xlErr = checkLimited('zhangxiu_xiongluan'); if (xlErr) return xlErr
            const xlTarget = targets[0]
            if (!xlTarget) return { error: '请选择一名其他角色' }
            if (xlTarget === general) return { error: '不能选择自己' }
            markLimited('zhangxiu_xiongluan')
            if (general.judgeZone.length > 0) {
                state.discard.push(...general.judgeZone)
                general.judgeZone = []
            }
            for (const slot of Object.values(EquipSlot)) {
                const eq = general.equip[slot]
                if (!eq) continue
                clearEquipSlot(state, general, slot)
                state.discard.push(eq)
            }
            general.abolishedJudgeZone = true
            general.abolishedSlots = [...new Set([...(general.abolishedSlots ?? []), ...Object.values(EquipSlot)])]
            general.xiongluanTarget = state.generals.indexOf(xlTarget)
            general.xiongluanTurn = state.turnSerial
            xlTarget.handForbiddenTurn = state.turnSerial
            addLog(state, `【${name}】发动【雄乱】，废除判定区与装备区：本回合对【${getGeneralName(xlTarget)}】使用牌无距离和次数限制，且其不能使用或打出手牌`)
            return
        }

        // ══ 洛书版扩展（五）：新增武将主动技 ══
        // ── 排异（界钟会）：移去一张“权”，令一名角色摸两张牌或受到1点伤害
        case 'zhonghui_paiyi': {
            if (!hasSkill(general, 'zhonghui_paiyi')) return { error: '你没有此技能' }
            const pyLimit = general.paiyiLimitPhase ?? 1
            if ((general.paiyiUsesPhase ?? 0) >= pyLimit) {
                return { error: `本阶段【排异】已发动 ${general.paiyiUsesPhase ?? 0}/${pyLimit} 次` }
            }
            if (pileCount(general) === 0) return { error: '没有“权”可以移去' }
            const pyTarget = targets[0]
            if (!pyTarget) return { error: '请选择一名角色' }
            general.paiyiUsesPhase = (general.paiyiUsesPhase ?? 0) + 1
            general.skillsUsedThisTurn.push('zhonghui_paiyi')
            const pyCard = general.generalPile!.pop()!
            state.discard.push(pyCard)
            addLog(state, `【${name}】发动【排异】，移去一张“权”（剩余${pileCount(general)}），选择【${getGeneralName(pyTarget)}】`)
            state.pendingResponseQueue.push({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(general),
                context: {
                    skillId: 'zhonghui_paiyi',
                    skillName: '排异',
                    description: `对【${getGeneralName(pyTarget)}】选择一项`,
                    options: [
                        { action: 'draw', label: '令其摸两张牌' },
                        { action: 'damage', label: '对其造成1点伤害' },
                    ],
                    paiyiTargetIndex: state.generals.indexOf(pyTarget),
                },
            })
            return
        }

        // ── 翦灭（界张春华）：与一名其他角色各选一种颜色并弃置该颜色所有手牌
        case 'zhangchunhua_jianmie': {
            if (!hasSkill(general, 'zhangchunhua_jianmie')) return { error: '你没有此技能' }
            const jmErr = checkOncePerTurn('zhangchunhua_jianmie'); if (jmErr) return jmErr
            const jmTarget = targets[0]
            if (!jmTarget) return { error: '请选择一名其他角色' }
            if (jmTarget === general) return { error: '不能选择自己' }
            markUsed('zhangchunhua_jianmie')
            state.pendingResponseQueue.push({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(general),
                context: {
                    skillId: 'zhangchunhua_jianmie',
                    skillName: '翦灭',
                    description: `与【${getGeneralName(jmTarget)}】各选择一种颜色，弃置该颜色的所有手牌`,
                    options: [
                        { action: 'red', label: '红色' },
                        { action: 'black', label: '黑色' },
                    ],
                    jianmieOpponentIndex: state.generals.indexOf(jmTarget),
                },
            })
            return
        }

        // ── 胆守（界朱然）：本阶段每项限一次，选择一名角色执行一项
        case 'zhuran_danshou': {
            if (!hasSkill(general, 'zhuran_danshou')) return { error: '你没有此技能' }
            if (!hasCardInArea(general)) return { error: '你没有牌' }
            const dsTarget = targets[0]
            if (!dsTarget) return { error: '请选择一名角色' }
            const dsUsed = general.danshouItems ?? []
            const dsHasCards = hasCardInArea(dsTarget)
            const dsOptions: { action: string; label: string }[] = []
            if (!dsUsed.includes(1) && dsHasCards) {
                dsOptions.push({ action: '1', label: '①弃置其一张牌' })
            }
            if (!dsUsed.includes(2) && dsHasCards) {
                dsOptions.push({ action: '2', label: '②获得其一张牌' })
            }
            if (!dsUsed.includes(3)) {
                dsOptions.push({ action: '3', label: '③对其造成1点伤害' })
            }
            if (!dsUsed.includes(4)) {
                dsOptions.push({ action: '4', label: '④你与其各摸两张牌' })
            }
            if (dsOptions.length === 0) return { error: '本阶段可执行的项已用尽' }
            general.skillsUsedThisTurn.push('zhuran_danshou')
            addLog(state, `【${name}】发动【胆守】，选择【${getGeneralName(dsTarget)}】`)
            state.pendingResponseQueue.push({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(general),
                context: {
                    skillId: 'zhuran_danshou',
                    skillName: '胆守',
                    description: `选择一项执行（然后须弃置本次序号数张牌）`,
                    options: dsOptions,
                    danshouTargetIndex: state.generals.indexOf(dsTarget),
                },
            })
            return
        }

        // ── 资援（糜竺）：交给一名其他角色任意张点数之和为13的牌
        case 'mizhu_ziyuan': {
            if (!hasSkill(general, 'mizhu_ziyuan')) return { error: '你没有此技能' }
            const zyErr = checkOncePerTurn('mizhu_ziyuan'); if (zyErr) return zyErr
            const zyTarget = targets[0]
            if (!zyTarget) return { error: '请选择一名其他角色' }
            if (zyTarget === general) return { error: '不能选择自己' }
            if (!hasSubsetSum(general.hand, 13)) return { error: '没有点数之和为13的牌' }
            markUsed('mizhu_ziyuan')
            addLog(state, `【${name}】发动【资援】，选择【${getGeneralName(zyTarget)}】`)
            askPickCard(state, general, 'mizhu_ziyuan', '资援',
                '选择任意张点数之和为13的牌交给该角色', {
                count: general.hand.length,
                mode: 'give',
                extra: { ziyuanTargetIndex: state.generals.indexOf(zyTarget) },
            })
            return
        }

        // ── 明鉴（曹叡）：将所有手牌交给一名其他角色
        case 'caorui_mingjian': {
            if (!hasSkill(general, 'caorui_mingjian')) return { error: '你没有此技能' }
            const mjErr = checkOncePerTurn('caorui_mingjian'); if (mjErr) return mjErr
            const mjTarget = targets[0]
            if (!mjTarget) return { error: '请选择一名其他角色' }
            if (mjTarget === general) return { error: '不能选择自己' }
            if (general.hand.length === 0) return { error: '你没有手牌可以交给其' }
            markUsed('caorui_mingjian')
            const mjCards = [...general.hand]
            general.hand = []
            mjTarget.hand.push(...mjCards)
            mjTarget.mingjianBonus = true
            addLog(state, `【${name}】发动【明鉴】，将${mjCards.length}张手牌交给【${getGeneralName(mjTarget)}】，其下个回合手牌上限+1且使用【杀】次数上限+1`)
            return
        }

        // ── 灭计（李儒）：将一张黑色锦囊牌置于牌堆顶，令一名有手牌的其他角色弃置一张牌
        case 'liru_mieji': {
            if (!hasSkill(general, 'liru_mieji')) return { error: '你没有此技能' }
            const mjErr = checkOncePerTurn('liru_mieji'); if (mjErr) return mjErr
            const mjTarget = targets[0]
            if (!mjTarget || mjTarget === general) return { error: '请选择一名有牌的其他角色' }
            const mjTargetHasCard = mjTarget.hand.length > 0
                || Object.values(mjTarget.equip).some(Boolean)
            if (!mjTargetHasCard) return { error: '该角色没有牌' }
            const isBlackTrick = (c: Card) => c.category === CardCategory.TRICK
                && (c.suit === CardSuit.SPADE || c.suit === CardSuit.CLUB)
            const mjCard = cardIds.length > 0
                ? general.hand.find(c => c.id === cardIds[0] && isBlackTrick(c))
                : general.hand.find(isBlackTrick)
            if (!mjCard) return { error: '需要将一张黑色锦囊牌置于牌堆顶' }
            markUsed('liru_mieji')
            general.hand.splice(general.hand.indexOf(mjCard), 1)
            state.deck.unshift(mjCard)
            const mjTrickHand = mjTarget.hand.filter(c => c.category === CardCategory.TRICK)
            const mjNonTrickCount = mjTarget.hand.filter(c => c.category !== CardCategory.TRICK).length
                + Object.values(mjTarget.equip).filter(Boolean).length
            const mjOptions: { action: string; label: string }[] = []
            if (mjTrickHand.length > 0) mjOptions.push({ action: 'give_trick', label: '交给你一张锦囊牌' })
            if (mjNonTrickCount > 0) mjOptions.push({ action: 'discard_two', label: '依次弃置两张非锦囊牌' })
            if (mjOptions.length === 0) return
            addLog(state, `【${name}】发动【灭计】，将${cardFullName(mjCard)}置于牌堆顶，令【${getGeneralName(mjTarget)}】选择一项`)
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(mjTarget),
                context: {
                    skillId: 'liru_mieji',
                    skillName: '灭计',
                    description: '选择一项：交给其一张锦囊牌，或依次弃置两张非锦囊牌',
                    options: mjOptions,
                    miejiOwnerIndex: state.generals.indexOf(general),
                },
            })
            return
        }

        // ── 焚城（李儒）：限定技，从指定角色开始依次弃牌或受到2点火焰伤害
        case 'liru_fencheng': {
            if (!hasSkill(general, 'liru_fencheng')) return { error: '你没有此技能' }
            const fcErr = checkLimited('liru_fencheng'); if (fcErr) return fcErr
            const fcStart = targets[0] ?? general
            markLimited('liru_fencheng')
            const fcOrder: number[] = []
            for (const g of getDirectionalTargets(state, general, 'clockwise')) {
                const gi = state.generals.indexOf(g)
                if (gi !== state.generals.indexOf(general) && !fcOrder.includes(gi)) fcOrder.push(gi)
            }
            if (fcOrder.length === 0) return { error: '没有其他角色' }
            addLog(state, `【${name}】发动【焚城】，所有其他角色依次选择弃牌或受到2点火焰伤害`)
            pushFenchengStep(state, fcOrder, 0, 1, state.generals.indexOf(general))
            return
        }

        default:
            return { error: `未知技能：${data.skillId}` }
    }
}


// ─────────────────────────────────────────────────────────────
// 响应处理
// ─────────────────────────────────────────────────────────────


/**
 * 带选项的技能结算（SKILL_ACTIVATE_CONFIRM 的 context.options）。
 * 选项按钮由界面渲染，点击后通过 action 进入这里。
 */
function resolveSkillOption(
    state: GameState,
    general: GeneralInstance,
    pending: PendingResponse,
    action: string,
): { error: string } | void {
    const ctx = pending.context as any
    const skillId = ctx.skillId as string
    const selfIdx = state.generals.indexOf(general)
    const name = getGeneralName(general)

    // 洛书版扩展（九）：带选项的新技能
    const expA = expConfirmA(state, general, pending, action, ctx)
    if (expA !== EXP_UNHANDLED) return expA
    const expB = expConfirmB(state, general, pending, action, ctx)
    if (expB !== EXP_UNHANDLED) return expB

    switch (skillId) {
        // ── 良助（SP孙尚香）：摸一张牌，或令回复体力的角色摸两张牌
        case 'sp_sunshangxiang_liangzhu': {
            state.pendingResponseQueue.shift()
            const lzHealer = state.generals[ctx.healerIndex as number]
            if (action === 'target' && lzHealer?.alive) {
                const lzDrawn = drawCards(state, 2)
                lzHealer.hand.push(...lzDrawn)
                addLog(state, `【${name}】发动【良助】，令【${getGeneralName(lzHealer)}】摸${lzDrawn.length}张牌`)
            } else {
                const lzDrawn = drawCards(state, 1)
                general.hand.push(...lzDrawn)
                addLog(state, `【${name}】发动【良助】，摸了${lzDrawn.length}张牌`)
            }
            return
        }
        // ── 述志（界曹操）：游戏开始时，将【清正】或【奸雄】之一修改为限定技
        case 'caocao_jie_shuzhi': {
            state.pendingResponseQueue.shift()
            const choice = action === 'qingzheng' ? 'caocao_jie_qingzheng' : 'caocao_jie_jianxiong'
            general.shuzhiLimited = choice
            addLog(state, `【${name}】【述志】将【${choice === 'caocao_jie_qingzheng' ? '清正' : '奸雄'}】修改为限定技`)
            if ((ctx as any).shuzhiStart && state.phase === GamePhase.PLAYING
                && state.turnPhase === TurnPhase.TURN_START
                && state.activeGeneralIndex >= 0
                && state.pendingResponseQueue.length === 0) {
                runTurnStart(state)
            }
            return
        }
        // ── 魂姿②（界孙策）：觉醒回合的结束阶段选择一项
        case 'sunce_hunzi_end': {
            state.pendingResponseQueue.shift()
            if (action === 'recover') {
                general.hp = Math.min(general.maxHp, general.hp + 1)
                addLog(state, `【${name}】【魂姿】回复1点体力`)
            } else {
                const hzDrawn = drawCards(state, 2)
                general.hand.push(...hzDrawn)
                addLog(state, `【${name}】【魂姿】摸了${hzDrawn.length}张牌`)
            }
            advanceTurnGuarded(state)
            return
        }
        // ── 镇胆（闪赵云）：将一张非基本手牌当任意基本牌使用
        case 'shanzhaoyun_zhendan_declare': {
            state.pendingResponseQueue.shift()
            const zdId = general.zhendanCardId
            general.zhendanCardId = undefined
            const zdCard = zdId ? general.hand.find(c => c.id === zdId) : undefined
            if (!zdCard) {
                addLog(state, '【镇胆】的牌已不在手牌中')
                return
            }
            const zdNames: Record<string, BasicCardName> = {
                attack: BasicCardName.ATTACK, dodge: BasicCardName.DODGE,
                peach: BasicCardName.PEACH, wine: BasicCardName.WINE,
            }
            const zdName = zdNames[action]
            if (!zdName) return { error: '无效的牌名' }
            if (zdName === BasicCardName.DODGE) {
                addLog(state, '【闪】不能在出牌阶段主动使用')
                return
            }
            const zdRound = state.roundState?.roundNumber ?? 0
            const zdUsedBefore = general.basicUsedRound === zdRound ? (general.basicUsedThisRound ?? []) : []
            general.basicUsedThisRound = [...zdUsedBefore, zdName]
            general.basicUsedRound = zdRound
            if (zdName === BasicCardName.PEACH) {
                if (general.hp >= general.maxHp) return { error: '你已满血' }
                const zdRemoved = removeCardFromHandOrEquip(state, general, zdCard.id)
                if ('error' in zdRemoved) return zdRemoved
                general.hp = Math.min(general.hp + 1, general.maxHp)
                addLog(state, `【${name}】发动【镇胆】，将一张非基本牌当【桃】使用，回复1点体力`)
                triggerDianhuRecover(state, general)
                return
            }
            if (zdName === BasicCardName.WINE) {
                const zdRemoved = removeCardFromHandOrEquip(state, general, zdCard.id)
                if ('error' in zdRemoved) return zdRemoved
                general.wineDrunk = true
                addLog(state, `【${name}】发动【镇胆】，将一张非基本牌当【酒】使用`)
                return
            }
            const zdTargets = ((ctx.targetIndices as number[]) ?? [])
                .map(i => state.generals[i]).filter(g => g?.alive)
            if (zdTargets.length === 0) return { error: '请选择【杀】的目标' }
            const zdRemoved = removeCardFromHandOrEquip(state, general, zdCard.id)
            if ('error' in zdRemoved) return zdRemoved
            const zdConverted: Card = {
                ...zdCard,
                id: `zhendan_${zdCard.id}_${state.log.length}`,
                name: BasicCardName.ATTACK,
                category: CardCategory.BASIC,
                nature: 'normal',
                virtual: true,
            }
            addLog(state, `【${name}】发动【镇胆】，将一张非基本牌当【杀】使用`)
            return handleBasicCard(state, general, zdConverted, -1, zdTargets)
        }

        // ── 下书（阚泽）：获得其展示的 / 未展示的手牌
        case 'kanze_xiashu_gain': {
            state.pendingResponseQueue.shift()
            const xsOwner = state.generals[ctx.xiashuOwnerIndex as number]
            const xsTarget = state.generals[ctx.xiashuTargetIndex as number]
            if (!xsOwner?.alive || !xsTarget) return
            const xsShownSet = new Set((ctx.xiashuShownIds as string[]) ?? [])
            const xsTake = xsTarget.hand.filter(c => action === 'shown' ? xsShownSet.has(c.id) : !xsShownSet.has(c.id))
            for (const c of xsTake) {
                const ci = xsTarget.hand.indexOf(c)
                if (ci >= 0) xsTarget.hand.splice(ci, 1)
            }
            xsOwner.hand.push(...xsTake)
            addLog(state, `【${getGeneralName(xsOwner)}】发动【下书】，获得【${getGeneralName(xsTarget)}】${xsTake.length}张${action === 'shown' ? '展示的' : '未展示的'}手牌`)
            return
        }

        // ── 清正（界曹操）：选择自己弃置的花色 → 选择目标
        case 'caocao_jie_qingzheng': {
            state.pendingResponseQueue.shift()
            const qzSuit = action as CardSuit
            const qzCandidates = state.generals
                .map((g, i) => ({ g, i }))
                .filter(({ g, i }) => g.alive && i !== selfIdx && g.hand.length > 0)
                .map(({ i }) => i)
            if (qzCandidates.length === 0) {
                addLog(state, '【清正】没有可观看手牌的角色')
                return
            }
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_CHOOSE_TARGET,
                targetGeneralIndex: selfIdx,
                context: {
                    skillId: 'caocao_jie_qingzheng', skillName: '清正',
                    description: `观看一名有手牌的其他角色，弃置其中一种花色的所有牌`,
                    candidateIndices: qzCandidates,
                    qingzhengSuit: qzSuit,
                },
            })
            return
        }

        // ── 清正（界曹操）：选择目标要弃置的花色并结算
        case 'caocao_jie_qingzheng_pick': {
            state.pendingResponseQueue.shift()
            const qzOther = state.generals[ctx.qingzhengTargetIndex as number]
            if (!qzOther?.alive) return
            const qzMySuit = ctx.qingzhengSuit as CardSuit
            const qzTheirSuit = action as CardSuit
            const qzMine = general.hand.filter(c => c.suit === qzMySuit)
            let qzMineCount = 0
            for (const c of [...qzMine]) {
                const removed = removeCardFromHandOrEquip(state, general, c.id)
                if (!('error' in removed)) qzMineCount++
            }
            const qzTheirs = qzOther.hand.filter(c => c.suit === qzTheirSuit)
            let qzTheirCount = 0
            for (const c of qzTheirs) {
                const ci = qzOther.hand.indexOf(c)
                if (ci < 0) continue
                qzOther.hand.splice(ci, 1)
                state.discard.push(c)
                checkMingzhe(state, qzOther, c)
                checkTuntian(state, qzOther)
                triggerLianying(state, qzOther)
                qzTheirCount++
            }
            addLog(state, `【${name}】发动【清正】，弃置自己${qzMineCount}张${SUIT_SYMBOL[qzMySuit] ?? ''}牌，弃置【${getGeneralName(qzOther)}】${qzTheirCount}张${SUIT_SYMBOL[qzTheirSuit] ?? ''}牌`)
            if (qzTheirCount < qzMineCount) {
                dealDamage(state, general, qzOther, 1, undefined, { nature: 'normal' })
            }
            if (general.shuzhiLimited === 'caocao_jie_qingzheng' && !general.usedLimitedSkills.includes('caocao_jie_qingzheng')) {
                general.usedLimitedSkills.push('caocao_jie_qingzheng')
            }
            return
        }

        // ── 固政（界张昭张纮）：选择一张弃置的牌交还该角色，获得其余牌
        case 'zhangzhao_guzheng': {
            state.pendingResponseQueue.shift()
            const gzIds = (ctx.guzhengCardIds as string[]) ?? []
            const gzBackId = action.startsWith('return:') ? action.slice(7) : undefined
            const gzGiver = state.generals[ctx.guzhengGiverIndex as number]
            const gzPiles = gzIds
                .map(id => state.discard.find(c => c.id === id))
                .filter((c): c is Card => !!c)
            const gzBack = gzPiles.find(c => c.id === gzBackId)
                ?? [...gzPiles].sort((a, b) => (a.value ?? 0) - (b.value ?? 0))[0]
            for (const c of gzPiles) {
                const ci = state.discard.indexOf(c)
                if (ci >= 0) state.discard.splice(ci, 1)
            }
            if (gzGiver?.alive && gzBack) gzGiver.hand.push(gzBack)
            const gzGained = gzPiles.filter(c => c !== gzBack)
            general.hand.push(...gzGained)
            addLog(state, `【${name}】发动【固政】，将${gzBack ? cardFullName(gzBack) : '一张牌'}交还【${gzGiver ? getGeneralName(gzGiver) : '对方'}】，获得其余${gzGained.length}张牌`)
            return
        }
        // ── 神速（界夏侯渊）：选择跳过哪几个阶段，每项视为使用一张无距离限制的杀
        case 'xiahouyuan_shensu_jie': {
            state.pendingResponseQueue.shift()
            const ssu = state.generals[pending.targetGeneralIndex]
            if (!ssu) return
            ssu.skillsUsedThisTurn = [...(ssu.skillsUsedThisTurn ?? []), 'xiahoyuan_shensu']
            const skipJudgeDraw = action === 'one' || action === 'one_two' || action === 'one_three' || action === 'all'
            const skipActionPhase = action === 'two' || action === 'one_two' || action === 'two_three' || action === 'all'
            const skipDiscard = action === 'three' || action === 'one_three' || action === 'two_three' || action === 'all'
            const slashCount = [skipJudgeDraw, skipActionPhase, skipDiscard].filter(Boolean).length
            if (slashCount === 0) {
                continueFromPrepPhase(state)
                return
            }
            // ② 的成本：弃置一张装备牌
            if (skipActionPhase) {
                const equipSlot = Object.values(EquipSlot).find(s => ssu.equip[s])
                if (equipSlot) {
                    const eqCard = ssu.equip[equipSlot]!
                    ssu.equip[equipSlot] = undefined as any
                    state.discard.push(eqCard)
                    addLog(state, `【${getGeneralName(ssu)}】【神速】弃置${cardFullName(eqCard)}`)
                }
            }
            const ssuFoes = state.generals
                .map((g, i) => ({ g, i }))
                .filter(({ g }) => g.alive && g !== ssu && g.faction !== ssu.faction)
                .sort((a, b) => a.g.hp - b.g.hp)
            for (let k = 0; k < slashCount; k++) {
                const foe = ssuFoes[k] ?? ssuFoes[0]
                if (foe) useVirtualSlash(state, ssu, foe.i, { noRange: true, label: '（神速）' })
            }
            if (skipDiscard) flipGeneral(state, ssu, '神速')
            if (skipJudgeDraw) {
                finishJudgePhaseAndContinue(state, ssu, skipActionPhase, true)
            } else {
                continueFromPrepPhase(state)
            }
            return
        }

        // ── 崩坏（董卓）：失去1点体力或减1点体力上限
        case 'dongzhuo_banghuai': {
            state.pendingResponseQueue.shift()
            if (action === 'reduceMaxHp') {
                general.maxHp = Math.max(1, general.maxHp - 1)
                if (general.hp > general.maxHp) general.hp = general.maxHp
                addLog(state, `【${name}】【崩坏】减1点体力上限`)
            } else {
                loseHp(state, general, 1)
                addLog(state, `【${name}】【崩坏】失去1点体力`)
            }
            advanceTurnGuarded(state)
            return
        }

        // ── 疠火（界程普）：造成过伤害后，弃置一张牌或失去1点体力
        case 'chengpu_jie_lihuo_cost': {
            state.pendingResponseQueue.shift()
            if (action === 'loseHp') {
                loseHp(state, general, 1)
                addLog(state, `【${name}】【疠火】反噬，失去1点体力`)
                return
            }
            addLog(state, `【${name}】【疠火】反噬，弃置一张牌`)
            askPickCard(state, general, 'chengpu_jie_lihuo_cost', '疠火', '弃置一张牌', {
                count: 1,
                mode: 'discard',
            })
            return
        }

        // ── 倾袭（界曹休）：弃牌 / 伤害+1，有武器时两项依次执行后弃置武器
        case 'caoxiu_jie_qingxi': {
            state.pendingResponseQueue.shift()
            const jqAtk = state.generals[ctx.qingxiJieAttackerIndex as number]
            const jqTgt = state.generals[ctx.qingxiJieTargetIndex as number]
            if (!jqAtk || !jqTgt) return
            const withBonus = action === 'damage' || action === 'both'
            const discardCount = Math.min(
                Math.max(0, (ctx.qingxiCount as number) ?? 0),
                jqTgt.alive ? jqTgt.hand.length : 0,
            )
            if ((action === 'discard' || action === 'both') && discardCount > 0 && jqTgt.alive) {
                askPickCard(state, jqTgt, 'caoxiu_jie_qingxi', '倾袭',
                    `弃置${discardCount}张手牌`, {
                    count: discardCount,
                    mode: 'discard',
                    extra: {
                        qingxiJieAttackerIndex: ctx.qingxiJieAttackerIndex,
                        qingxiJieTargetIndex: ctx.qingxiJieTargetIndex,
                        qingxiAmount: ctx.qingxiAmount,
                        qingxiBonus: withBonus,
                        qingxiCardId: ctx.qingxiCardId,
                        qingxiNature: ctx.qingxiNature,
                        qingxiDropWeapon: action === 'both',
                        qingxiResumeOpts: ctx.qingxiResumeOpts,
                    },
                })
                return
            }
            finishJieQingxi(state, jqAtk, jqTgt, withBonus,
                (ctx.qingxiAmount as number) ?? 0, ctx.qingxiCardId, ctx.qingxiNature,
                action === 'both', ctx.qingxiResumeOpts)
            return
        }

        // ── 献州（蔡夫人）：回复体力，还是对攻击范围内的角色造成伤害
        case 'caifuren_xianzhou': {
            state.pendingResponseQueue.shift()
            const xzUser = state.generals[ctx.xianzhouUserIndex as number]
            const xzCount = ctx.xianzhouCount as number
            if (action === 'heal' && xzUser?.alive) {
                xzUser.hp = Math.min(xzUser.hp + xzCount, xzUser.maxHp)
                addLog(state, `【${name}】选择令【${getGeneralName(xzUser)}】回复 ${xzCount} 点体力（献州）`)
                triggerDianhuRecover(state, xzUser)
                return
            }
            if (action === 'damage') {
                const xzChooser = state.generals[ctx.xianzhouChooserIndex as number] ?? general
                const xzInRange = state.generals
                    .map((g, i) => ({ g, i }))
                    .filter(({ g }) => g.alive && g !== xzChooser
                        && getAttackRange(xzChooser, g, state.generals).inRange)
                    .map(({ i }) => i)
                if (xzInRange.length > 0) {
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.SKILL_CHOOSE_TARGET,
                        targetGeneralIndex: selfIdx,
                        context: {
                            skillId: 'caifuren_xianzhou_damage',
                            skillName: '献州',
                            description: `选择至多${xzCount}名攻击范围内的角色，各造成1点伤害`,
                            candidateIndices: xzInRange,
                            multi: true,
                            maxPicks: Math.min(xzCount, xzInRange.length),
                            xianzhouCount: xzCount,
                            xianzhouChooserIndex: ctx.xianzhouChooserIndex,
                        },
                    })
                    return
                }
            }
            return
        }

        // ── 倾袭（曹休）：弃牌还是令伤害+1
        case 'caoxiu_qingxi': {
            state.pendingResponseQueue.shift()
            const atk = state.generals[ctx.qingxiAttackerIndex as number]
            if (action === 'damage') {
                if (atk) {
                    dealDamage(state, atk, general, (ctx.qingxiAmount as number) + 1,
                        ctx.qingxiCardId, { ...(ctx.qingxiResumeOpts ?? {}), skipQingxi: true })
                }
                return
            }
            const count = Math.min(ctx.qingxiCount as number, general.hand.length)
            if (count <= 0) {
                if (atk) {
                    dealDamage(state, atk, general, ctx.qingxiAmount as number,
                        ctx.qingxiCardId, { ...(ctx.qingxiResumeOpts ?? {}), skipQingxi: true })
                }
                return
            }
            addLog(state, `【${name}】选择【倾袭】：弃置${count}张手牌`)
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_PICK_CARD,
                targetGeneralIndex: selfIdx,
                context: {
                    skillId: 'caoxiu_qingxi',
                    skillName: '倾袭',
                    description: `弃置${count}张手牌，然后其弃置武器`,
                    count,
                    mode: 'discard',
                    qingxiAttackerIndex: ctx.qingxiAttackerIndex,
                    qingxiAmount: ctx.qingxiAmount,
                    qingxiCardId: ctx.qingxiCardId,
                    qingxiResumeOpts: ctx.qingxiResumeOpts,
                },
            })
            return
        }

        // ── 恩怨（法正）：交一张手牌，或失去1点体力
        case 'fazheng_enyuan': {
            const owner = state.generals[ctx.enyuanTargetIndex as number]
            state.pendingResponseQueue.shift()
            if (action === 'give') {
                if (!owner?.alive) return
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_GIVE_CARDS,
                    targetGeneralIndex: selfIdx,
                    context: {
                        skillId: 'fazheng_enyuan',
                        skillName: '恩怨',
                        toIndex: ctx.enyuanTargetIndex,
                        count: 1,
                    },
                })
                return
            }
            addLog(state, `【${name}】选择不交牌，因【恩怨】失去1点体力`)
            loseHp(state, general, 1)
            return
        }

        // ── 邀名（界全琮）：赈赡追加的额外一次发动
        case 'quancong_yaoming_free': {
            state.pendingResponseQueue.shift()
            const qfIdx = pending.targetGeneralIndex
            const qfOwner = state.generals[qfIdx]
            if (!qfOwner?.alive) return
            const qfCandidates = state.generals
                .map((g, i) => ({ g, i }))
                .filter(({ g, i }) => g.alive && i !== qfIdx)
                .map(({ i }) => i)
            if (qfCandidates.length === 0) return
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_CHOOSE_TARGET,
                targetGeneralIndex: qfIdx,
                context: {
                    skillId: 'quancong_yaoming',
                    skillName: '邀名',
                    description: '选择一名角色：其手牌数不少于你则弃其一张牌，不多于你则令其摸一张牌',
                    candidateIndices: qfCandidates,
                },
            })
            return
        }
        // ── 邀名（界全琮）：双方手牌数相同时由发动者二选一
        case 'quancong_yaoming_equal': {
            state.pendingResponseQueue.shift()
            const qeTarget = state.generals[ctx.yaomingTargetIndex as number]
            if (!qeTarget?.alive) return
            if (action === 'discard') {
                const qeCard = discardRandomHandCardOf(state, general, qeTarget)
                if (qeCard) {
                    addLog(state, `【${name}】发动【邀名】，弃置【${getGeneralName(qeTarget)}】的${cardFullName(qeCard)}`)
                }
            } else {
                const qeDrawn = drawForGeneral(state, qeTarget, 1)
                qeTarget.hand.push(...qeDrawn)
                addLog(state, `【${name}】发动【邀名】，令【${getGeneralName(qeTarget)}】摸${qeDrawn.length}张牌`)
            }
            return
        }

        // ── 遗礼（陆绩）：失去1点体力或移去1个“橘”
        case 'luji_yili': {
            state.pendingResponseQueue.shift()
            if (action === 'loseHp') {
                addLog(state, `【${name}】选择失去1点体力（遗礼）`)
                loseHp(state, general, 1)
            } else {
                general.orangeMarks = Math.max(0, (general.orangeMarks ?? 0) - 1)
                addLog(state, `【${name}】移去1个“橘”（剩余 ${general.orangeMarks} 个）`)
            }
            if (!general.alive) return
            const candidates = state.generals
                .map((g, i) => ({ g, i }))
                .filter(({ g, i }) => g.alive && i !== selfIdx)
                .map(({ i }) => i)
            if (candidates.length === 0) return
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_CHOOSE_TARGET,
                targetGeneralIndex: selfIdx,
                context: {
                    skillId: 'luji_yili',
                    skillName: '遗礼',
                    description: '令一名其他角色获得1个“橘”',
                    candidateIndices: candidates,
                },
            })
            return
        }

        // ── 解烦（韩当）：依次弃武器或令目标摸一张牌
        case 'handang_jiefan': {
            const jfTarget = state.generals[ctx.jiefanTargetIndex as number]
            const remaining: number[] = [...((ctx.jiefanRemaining as number[]) ?? [])]
            state.pendingResponseQueue.shift()
            if (action === 'discard' && general.equip[EquipSlot.WEAPON]) {
                const weapon = general.equip[EquipSlot.WEAPON]!
                clearEquipSlot(state, general, EquipSlot.WEAPON)
                state.discard.push(weapon)
                triggerXiaoji(state, general)
                addLog(state, `【${name}】因【解烦】弃置武器${cardFullName(weapon)}`)
            } else if (jfTarget?.alive) {
                const drawn = drawForGeneral(state, jfTarget, 1)
                jfTarget.hand.push(...drawn)
                addLog(state, `【${name}】选择令【${getGeneralName(jfTarget)}】摸${drawn.length}张牌（解烦）`)
            }
            if (remaining.length === 0) return
            const nextIdx = remaining.shift()!
            const nextGeneral = state.generals[nextIdx]
            if (!nextGeneral?.alive) {
                if (remaining.length === 0) return
            }
            const options: { action: string; label: string }[] = []
            if (nextGeneral?.equip[EquipSlot.WEAPON]) options.push({ action: 'discard', label: '弃置一张武器牌' })
            options.push({ action: 'draw', label: `令【${getGeneralName(jfTarget)}】摸一张牌` })
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: nextIdx,
                context: {
                    skillId: 'handang_jiefan',
                    skillName: '解烦',
                    description: options[0].action === 'discard'
                        ? `弃置一张武器牌，或令【${getGeneralName(jfTarget)}】摸一张牌`
                        : `令【${getGeneralName(jfTarget)}】摸一张牌`,
                    options,
                    jiefanTargetIndex: ctx.jiefanTargetIndex,
                    jiefanRemaining: remaining,
                },
            })
            return
        }

        // ── 镇骨（郝昭）：摸至或弃至
        case 'haozhao_zhengu': {
            state.pendingResponseQueue.shift()
            const owner = state.generals[ctx.zhenguOwnerIndex as number]
            if (!owner) { advanceTurnGuarded(state); return }
            const ref = owner.hand.length
            if (action === 'draw') {
                const cap = Math.min(ref, 5)
                const need = Math.max(0, cap - general.hand.length)
                if (need > 0) {
                    const drawn = drawForGeneral(state, general, need)
                    general.hand.push(...drawn)
                }
                addLog(state, `【${name}】因【镇骨】将手牌摸至${Math.min(general.hand.length, cap)}张`)
            } else {
                const need = Math.max(0, general.hand.length - ref)
                for (let i = 0; i < need; i++) {
                    if (general.hand.length === 0) break
                    const card = general.hand.splice(randomInt(general.hand.length), 1)[0]
                    state.discard.push(card)
                    checkMingzhe(state, general, card)
                }
                if (need > 0) triggerLianying(state, general)
                addLog(state, `【${name}】因【镇骨】弃置至${general.hand.length}张手牌`)
            }
            advanceTurnGuarded(state)
            return
        }

        // ── 矫诏（郭皇后）：被指定的角色声明牌名
        case 'guohuanghou_jiaozhao_declare': {
            state.pendingResponseQueue.shift()
            const owner = state.generals[ctx.jiaozhaoOwnerIndex as number]
            if (!owner) return
            owner.jiaozhaoAs = action
            const declareNames: Record<string, string> = {
                attack: '杀', dodge: '闪', peach: '桃', wine: '酒',
                draw_two: '无中生有', dismantle: '过河拆桥', steal: '顺手牵羊', duel: '决斗',
            }
            addLog(state, `【${name}】为【${getGeneralName(owner)}】的【矫诏】声明了【${declareNames[action] ?? action}】`)
            // 修改二（界郭皇后）：由自己声明并直接视为使用该牌
            if ((ctx as any).jiaozhaoVirtual) {
                owner.jiaozhaoAs = undefined
                resolveJiaozhaoVirtual(state, owner, action)
            }
            return
        }

        // ── 殚心（郭皇后）：摸一张或强化矫诏
        case 'guohuanghou_danxin': {
            state.pendingResponseQueue.shift()
            if (action === 'danxin') {
                // 界郭皇后：摸X张牌（X为已修改次数），然后修改“矫诏”
                const dxTimes = general.jiaozhaoUpgrade ?? 0
                if (dxTimes > 0) {
                    const dxDrawn = drawForGeneral(state, general, dxTimes)
                    general.hand.push(...dxDrawn)
                    addLog(state, `【${name}】发动【殚心】，摸了${dxDrawn.length}张牌`)
                } else {
                    addLog(state, `【${name}】发动【殚心】`)
                }
                if (dxTimes < 2) {
                    general.jiaozhaoUpgrade = dxTimes + 1
                    addLog(state, `【${name}】【殚心】将【矫诏】修改至第${general.jiaozhaoUpgrade}层`)
                }
                return
            }
            if (action === 'upgrade' && (general.jiaozhaoUpgrade ?? 0) < 2) {
                general.jiaozhaoUpgrade = (general.jiaozhaoUpgrade ?? 0) + 1
                addLog(state, `【${name}】发动【殚心】，强化【矫诏】至第${general.jiaozhaoUpgrade}层`)
            } else {
                const drawn = drawForGeneral(state, general, 1)
                general.hand.push(...drawn)
                addLog(state, `【${name}】发动【殚心】，摸${drawn.length}张牌`)
            }
            return
        }

        // ── 怀异（公孙渊）：选择弃置的颜色
        case 'gongsunyuan_huaiyi': {
            state.pendingResponseQueue.shift()
            const isRed = action === 'red'
            const toDiscard = general.hand.filter(c => {
                const red = c.suit === CardSuit.HEART || c.suit === CardSuit.DIAMOND
                return isRed ? red : !red
            })
            for (const card of [...toDiscard]) {
                const idx = general.hand.indexOf(card)
                if (idx >= 0) general.hand.splice(idx, 1)
                state.discard.push(card)
                checkMingzhe(state, general, card)
            }
            const x = toDiscard.length
            addLog(state, `【${name}】【怀异】弃置了${x}张${isRed ? '红' : '黑'}色手牌`)
            const candidates = state.generals
                .map((g, i) => ({ g, i }))
                .filter(({ g, i }) => g.alive && i !== selfIdx
                    && (g.hand.length > 0 || Object.values(g.equip).some(Boolean)))
                .map(({ i }) => i)
            if (x === 0 || candidates.length === 0) return
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_CHOOSE_TARGET,
                targetGeneralIndex: selfIdx,
                context: {
                    skillId: 'gongsunyuan_huaiyi',
                    skillName: '怀异',
                    description: `选择至多${Math.min(x, candidates.length)}名其他角色，各获得其一张牌`,
                    candidateIndices: candidates,
                    multi: true,
                    maxPicks: Math.min(x, candidates.length),
                    huaiyiX: Math.min(x, candidates.length),
                },
            })
            return
        }

        // ── 贞烈（界王异）：获得其一张牌，或于本回合结束阶段发动一次“秘计”
        case 'wangyi_jie_zhenlie_choice': {
            state.pendingResponseQueue.shift()
            if (action === 'miji') {
                general.mijiExtraThisTurn = true
                addLog(state, `【${name}】【贞烈】将于本回合的结束阶段发动一次【秘计】`)
                return
            }
            const zlSrc = state.generals[ctx.zhenlieSourceIndex as number]
            if (zlSrc?.alive && hasCardInArea(zlSrc)) {
                addLog(state, `【${name}】【贞烈】获得【${getGeneralName(zlSrc)}】一张牌`)
                state.pendingResponseQueue.unshift({
                    type: ResponseType.TRICK_TARGET_CARD_PICK,
                    targetGeneralIndex: state.generals.indexOf(general),
                    context: {
                        trickType: 'steal',
                        targetIndex: state.generals.indexOf(zlSrc),
                        label: '贞烈',
                    },
                })
            }
            return
        }

        // ── 窃听（界蔡夫人）：取其装备区一张牌 / 摸一张牌，可两项都选
        case 'caifuren_jie_qieting': {
            state.pendingResponseQueue.shift()
            const jqEnding = state.generals[ctx.endingIndex as number]
            if (!jqEnding?.alive) {
                advanceTurnGuarded(state)
                return
            }
            if (action === 'equip' || action === 'both') {
                const slot = (Object.values(EquipSlot) as EquipSlot[]).find(s => jqEnding.equip[s])
                if (slot) {
                    const card = jqEnding.equip[slot]!
                    clearEquipSlot(state, jqEnding, slot)
                    triggerXiaoji(state, jqEnding)
                    const mySlot = card.equipSlot ?? slot
                    const old = general.equip[mySlot]
                    if (old) state.discard.push(old)
                    general.equip[mySlot] = card
                    addLog(state, `【${name}】【窃听】将【${getGeneralName(jqEnding)}】的${cardFullName(card)}置入自己的装备区`)
                }
            }
            if (action === 'draw' || action === 'both') {
                const drawn = drawForGeneral(state, general, 1)
                general.hand.push(...drawn)
                addLog(state, `【${name}】【窃听】摸了${drawn.length}张牌`)
            }
            advanceTurnGuarded(state)
            return
        }

        // ── 窃听（蔡夫人）：取其装备区一张牌，或摸一张
        case 'caifuren_qieting': {
            state.pendingResponseQueue.shift()
            const ending = state.generals[ctx.endingIndex as number]
            if (action === 'equip' && ending?.alive) {
                const slot = (Object.values(EquipSlot) as EquipSlot[]).find(s => ending.equip[s])
                if (slot) {
                    const card = ending.equip[slot]!
                    clearEquipSlot(state, ending, slot)
                    triggerXiaoji(state, ending)
                    const mySlot = card.equipSlot ?? slot
                    const old = general.equip[mySlot]
                    if (old) state.discard.push(old)
                    general.equip[mySlot] = card
                    addLog(state, `【${name}】【窃听】将【${getGeneralName(ending)}】的${cardFullName(card)}置入自己的装备区`)
                    advanceTurnGuarded(state)
                    return
                }
            }
            const drawn = drawForGeneral(state, general, 1)
            general.hand.push(...drawn)
            addLog(state, `【${name}】【窃听】摸了${drawn.length}张牌`)
            advanceTurnGuarded(state)
            return
        }

        // ── 眩惑（法正）：受牌者选择出杀，或让法正获得其两张牌
        case 'fazheng_xuanhuo': {
            state.pendingResponseQueue.shift()
            const owner = state.generals[ctx.xuanhuoUserIndex as number]
            const slashTarget = state.generals[ctx.xuanhuoSlashTargetIndex as number]
            if (action === 'slash') {
                const slashCard = general.hand.find(c => isCardUsableAsAttack(general, c))
                if (slashCard && slashTarget?.alive) {
                    general.hand.splice(general.hand.indexOf(slashCard), 1)
                    state.discard.push(slashCard)
                    addLog(state, `【${name}】因【眩惑】对【${getGeneralName(slashTarget)}】使用【杀】`)
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.DODGE,
                        targetGeneralIndex: state.generals.indexOf(slashTarget),
                        context: {
                            attackerGeneralIndex: selfIdx,
                            requiredDodges: hasSkill(general, 'lvbu_wushuang') ? 2 : 1,
                            dodgesReceived: 0,
                            attackCard: slashCard,
                        },
                    })
                }
                return
            }
            if (owner?.alive && hasCardInArea(general)) {
                const xhVisible = owner.faction === general.faction
                const xhIds = xhVisible
                    ? [...general.hand.map(c => c.id),
                       ...Object.values(general.equip).filter(Boolean).map(c => c!.id)]
                    : []
                if (xhIds.length > 0) {
                    // 同阵营手牌为明牌：由法正自行挑选获得的牌
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.SKILL_PICK_CARD,
                        targetGeneralIndex: state.generals.indexOf(owner),
                        context: {
                            skillId: 'fazheng_xuanhuo_gain',
                            skillName: '眩惑',
                            description: `从【${getGeneralName(general)}】处选择至多2张牌获得`,
                            count: Math.min(2, xhIds.length),
                            mode: 'gain',
                            candidateCardIds: xhIds,
                            xuanhuoFromIndex: state.generals.indexOf(general),
                        },
                    })
                } else {
                    let gained = 0
                    for (let i = 0; i < 2; i++) {
                        if (gainRandomCardFrom(state, owner, general)) gained++
                    }
                    addLog(state, `【${name}】选择令【${getGeneralName(owner)}】获得其${gained}张牌（眩惑）`)
                }
            }
            if (owner?.alive && state.turnPhase === TurnPhase.DRAW) beginActionPhase(state, owner)
            return
        }

        // ── 宴诛（孙休）：弃置一张牌，或令孙休获得装备区所有牌并令其失去【宴诛】
        case 'sunxiu_yanzhu': {
            state.pendingResponseQueue.shift()
            const yzOwner = state.generals[ctx.yanzhuOwnerIndex as number]
            if (action === 'equip' && yzOwner?.alive) {
                let gained = 0
                for (const slot of Object.values(EquipSlot)) {
                    const eq = general.equip[slot]
                    if (!eq) continue
                    clearEquipSlot(state, general, slot)
                    yzOwner.hand.push(eq)
                    gained++
                }
                yzOwner.lostSkills = [...(yzOwner.lostSkills ?? []), 'sunxiu_yanzhu']
                addLog(state, `【${name}】选择令【${getGeneralName(yzOwner)}】获得其装备区里的${gained}张牌，【${getGeneralName(yzOwner)}】失去【宴诛】`)
                triggerXiaoji(state, general)
                return
            }
            addLog(state, `【${name}】【宴诛】选择弃置一张牌`)
            askPickCard(state, general, 'sunxiu_yanzhu', '宴诛', '弃置一张牌', { count: 1, mode: 'discard' })
            return
        }

        // ── 集智（界黄月英）：弃置摸到的基本牌，令本回合手牌上限+1
        case 'huangyueying_jizhi': {
            state.pendingResponseQueue.shift()
            const jzCardId = ctx.jizhiCardId as string | undefined
            if (!jzCardId) return
            const jzCard = findCardInHandOrEquip(general, jzCardId)
            if (!jzCard) return
            const jzRemoved = removeCardFromHandOrEquip(state, general, jzCardId)
            if ('error' in jzRemoved) return
            general.handLimitDelta = (general.handLimitDelta ?? 0) + 1
            addLog(state, `【${name}】【集智】弃置${cardFullName(jzCard)}，本回合手牌上限+1`)
            return
        }

        // ── 灭计（李儒）：目标选择交锦囊牌或依次弃置两张非锦囊牌
        case 'liru_mieji': {
            state.pendingResponseQueue.shift()
            const mjSelf = general
            const miejiOwnerIndex = ctx.miejiOwnerIndex as number
            if (action === 'give_trick') {
                const trickIds = mjSelf.hand.filter(c => c.category === CardCategory.TRICK).map(c => c.id)
                if (trickIds.length === 0) return
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_PICK_CARD,
                    targetGeneralIndex: state.generals.indexOf(mjSelf),
                    context: {
                        skillId: 'liru_mieji_give', skillName: '灭计',
                        description: '交给其一张锦囊牌', count: 1, mode: 'discard',
                        candidateCardIds: trickIds,
                        miejiOwnerIndex,
                    },
                })
                return
            }
            const mjNonTrickIds = [
                ...mjSelf.hand.filter(c => c.category !== CardCategory.TRICK).map(c => c.id),
                ...Object.values(mjSelf.equip).filter(Boolean).map(c => c!.id),
            ]
            if (mjNonTrickIds.length === 0) return
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_PICK_CARD,
                targetGeneralIndex: state.generals.indexOf(mjSelf),
                context: {
                    skillId: 'liru_mieji', skillName: '灭计', description: '弃置一张非锦囊牌',
                    count: 1, mode: 'discard', candidateCardIds: mjNonTrickIds,
                    miejiOwnerIndex, miejiSecond: false,
                },
            })
            return
        }

        // ── 秉正（董允）：选择令其弃置一张手牌或摸一张牌
        case 'dongyun_bingzheng': {
            state.pendingResponseQueue.shift()
            const bzT = state.generals[ctx.bingzhengTargetIndex as number]
            if (!bzT?.alive) return
            if (action === 'draw') {
                const bzDraw = drawCards(state, 1)
                bzT.hand.push(...bzDraw)
            } else {
                const bzPool = [
                    ...bzT.hand.map((c) => c.id),
                    ...Object.values(bzT.equip).filter(Boolean).map((c) => c!.id),
                ]
                if (bzPool.length > 0) removeCardFromHandOrEquip(state, bzT, bzPool[0])
            }
            addLog(state, `【${name}】发动【秉正】，令【${getGeneralName(bzT)}】${action === 'draw' ? '摸一张牌' : '弃置一张牌'}`)
            if (bzT.hand.length === bzT.hp && general.alive) {
                const bzSelfDraw = drawCards(state, 1)
                general.hand.push(...bzSelfDraw)
                addLog(state, `【${name}】【秉正】其手牌数等于体力值，摸${bzSelfDraw.length}张牌`)
                if (general.hand.length > 0) {
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.SKILL_GIVE_CARDS,
                        targetGeneralIndex: state.generals.indexOf(general),
                        context: { skillId: 'dongyun_bingzheng', skillName: '秉正', toIndex: state.generals.indexOf(bzT), count: 1 },
                    })
                }
            }
            return
        }

        // ── 焚城（李儒）：弃置至少 X 张牌，或受到2点火焰伤害
        case 'liru_fencheng': {
            state.pendingResponseQueue.shift()
            const fcOrder = (ctx.fenchengOrder as number[]) ?? []
            const fcPos = (ctx.fenchengPos as number) ?? 0
            const fcNeed = (ctx.fenchengNeed as number) ?? 1
            const fcUser = state.generals[ctx.fenchengUserIndex as number] ?? null
            if (action === 'discard' && general.hand.length >= fcNeed) {
                askPickCard(state, general, 'liru_fencheng_discard', '焚城',
                    `弃置至少${fcNeed}张牌`, {
                        count: general.hand.length,
                        mode: 'discard',
                        extra: {
                            fenchengOrder: fcOrder,
                            fenchengPos: fcPos,
                            fenchengNeed: fcNeed,
                            fenchengUserIndex: ctx.fenchengUserIndex,
                        },
                    })
                return
            }
            addLog(state, `【${name}】【焚城】受到2点火焰伤害`)
            dealDamage(state, fcUser, general, 2, undefined, { nature: 'fire' })
            pushFenchengStep(state, fcOrder, fcPos, fcNeed, ctx.fenchengUserIndex as number)
            return
        }

        // ── 烈弓（界黄忠）：其不能使用【闪】响应此【杀】；此【杀】对其伤害+1
        case 'huangzhong_liegong': {
            state.pendingResponseQueue.shift()
            const lgTargetIdx = ctx.liegongTargetIndex as number
            const lgVictim = state.generals[lgTargetIdx]
            if (ctx.liegongNoDodge) {
                const lgDodge = state.pendingResponseQueue.find(p => p.type === ResponseType.DODGE)
                if (lgDodge) (lgDodge.context as any).unavoidable = true
            }
            if (ctx.liegongBonus) general.liegongBonusTarget = lgTargetIdx
            addLog(state, `【${name}】发动【烈弓】${ctx.liegongNoDodge ? '：其不能使用【闪】' : ''}${ctx.liegongBonus ? '：此【杀】伤害+1' : ''}（目标：${lgVictim ? getGeneralName(lgVictim) : '?'}）`)
            return
        }

        // ══ 洛书版扩展（五）：新增武将（选项类） ══
        // ── 自立（界钟会觉醒技）：回复1点体力 或 摸两张牌，然后减1点体力上限并获得【排异】
        case 'zhonghui_zili': {
            state.pendingResponseQueue.shift()
            if (!general.awakened) {
                general.awakened = true
                general.maxHp = Math.max(1, general.maxHp - 1)
                if (general.hp > general.maxHp) general.hp = general.maxHp
                general.acquiredSkills = [...(general.acquiredSkills ?? []), 'zhonghui_paiyi']
                addLog(state, `【${name}】发动【自立】觉醒！减1点体力上限，获得【排异】`)
            }
            if (action === 'heal') {
                if (general.hp < general.maxHp) {
                    general.hp += 1
                    addLog(state, `【${name}】【自立】回复1点体力（${general.hp}/${general.maxHp}）`)
                    triggerDianhuRecover(state, general)
                }
            } else {
                const zlDrawn = drawForGeneral(state, general, 2)
                general.hand.push(...zlDrawn)
                addLog(state, `【${name}】【自立】摸了${zlDrawn.length}张牌`)
            }
            continueFromPrepPhase(state)
            return
        }

        // ── 将驰（界曹彰）：摸牌阶段结束时选择一项
        case 'caozhang_jiangchi': {
            state.pendingResponseQueue.shift()
            if (action === 'draw') {
                const jcDrawn = drawForGeneral(state, general, 1)
                general.hand.push(...jcDrawn)
                general.slashLimitDelta = (general.slashLimitDelta ?? 0) - 1
                general.slashNotInHandLimit = true
                addLog(state, `【${name}】【将驰】：摸${jcDrawn.length}张牌，本回合使用【杀】次数上限-1且【杀】不计入手牌上限`)
            } else {
                addLog(state, `【${name}】【将驰】：重铸一张牌，本回合使用【杀】无距离限制且次数上限+1`)
                askPickCard(state, general, 'caozhang_jiangchi_recast', '将驰', '重铸一张牌', {
                    count: 1,
                    mode: 'discard',
                    extra: { jiangchiRecast: true, skipAction: ctx.skipAction },
                })
                return
            }
            finishJudgePhaseAndContinue(state, general, !!ctx.skipAction, true)
            return
        }

        // ── 献图（界张松）：摸至多两张牌然后交给其等量牌
        case 'zhangsong_xiantu': {
            state.pendingResponseQueue.shift()
            const xtTargetIdx = ctx.xiantuTargetIndex as number
            const xtTarget = state.generals[xtTargetIdx]
            const xtCount = action === 'two' ? 2 : 1
            if (!xtTarget?.alive) return
            const xtDrawn = drawForGeneral(state, general, xtCount)
            general.hand.push(...xtDrawn)
            if (xtDrawn.length === 0) {
                addLog(state, `【${name}】【献图】：牌堆已空，无法发动`)
                return
            }
            addLog(state, `【${name}】发动【献图】，摸了${xtDrawn.length}张牌，须交给【${getGeneralName(xtTarget)}】等量牌`)
            askPickCard(state, general, 'zhangsong_xiantu_give', '献图',
                `交给【${getGeneralName(xtTarget)}】${xtDrawn.length}张手牌`, {
                count: xtDrawn.length,
                mode: 'give',
                extra: {
                    xiantuGiveToIndex: xtTargetIdx,
                    xiantuGiveCount: xtDrawn.length,
                    exactCount: true,
                },
            })
            return
        }

        // ── 惴恐（界伏皇后）：与回合角色拼点
        case 'fuhuanghou_chuikong': {
            state.pendingResponseQueue.shift()
            const ckOpp = state.generals[ctx.chuikongOpponentIndex as number]
            if (!ckOpp?.alive) return
            if (!pindianStart(state, general, ckOpp, 'fuhuanghou_chuikong', '惴恐')) {                addLog(state, `【${name}】【惴恐】：拼点双方须均有手牌，发动取消`)
            }
            return
        }

        // ── 胆守（界朱然）：选择一项执行
        case 'zhuran_danshou': {
            state.pendingResponseQueue.shift()
            const dsTarget = state.generals[ctx.danshouTargetIndex as number]
            const dsItem = Number(action)
            if (!dsTarget?.alive || !dsItem) return
            general.danshouItems = [...(general.danshouItems ?? []), dsItem]
            const dsName = getGeneralName(dsTarget)
            if (dsItem === 1) {
                const dsCard = lowValueCard(dsTarget)
                if (dsCard) {
                    removeCardFromHandOrEquip(state, dsTarget, dsCard.id)
                    addLog(state, `【${name}】发动【胆守①】，弃置【${dsName}】的${cardFullName(dsCard)}`)
                }
            } else if (dsItem === 2) {
                const dsGot = gainRandomCardFrom(state, general, dsTarget)
                if (dsGot) addLog(state, `【${name}】发动【胆守②】，获得【${dsName}】的${cardFullName(dsGot)}`)
            } else if (dsItem === 3) {
                addLog(state, `【${name}】发动【胆守③】，对【${dsName}】造成1点伤害`)
                dealDamage(state, general, dsTarget, 1)
            } else {
                const dsSelfDraw = drawForGeneral(state, general, 2)
                general.hand.push(...dsSelfDraw)
                const dsOtherDraw = drawForGeneral(state, dsTarget, 2)
                dsTarget.hand.push(...dsOtherDraw)
                addLog(state, `【${name}】发动【胆守④】，你与【${dsName}】各摸${Math.min(dsSelfDraw.length, dsOtherDraw.length)}张牌`)
            }
            // 然后弃置本次执行序号数张牌（不足则全弃）
            const dsCost = Math.min(dsItem, general.hand.length)
            if (dsCost > 0) {
                askPickCard(state, general, 'zhuran_danshou_cost', '胆守',
                    `弃置${dsCost}张牌（本次执行的是第${dsItem}项）`, {
                    count: dsCost,
                    mode: 'discard',
                })
            }
            return
        }

        // ── 称象（界曹冲）：亮出牌堆顶四张，获得点数之和不大于13的任意张
        case 'caochong_chengxiang': {
            state.pendingResponseQueue.shift()
            const cxCount = Math.min(4 + (general.chengxiangBonus ?? 0), state.deck.length)
            if (cxCount === 0) return
            const cxCards = state.deck.splice(0, cxCount)
            addLog(state, `【${name}】发动【称象】，亮出牌堆顶${cxCount}张牌：${cxCards.map(c => cardFullName(c)).join('、')}`)
            state.pendingResponseQueue.push({
                type: ResponseType.SKILL_GUANXING_ARRANGE,
                targetGeneralIndex: selfIdx,
                context: {
                    guanxingCards: cxCards,
                    mode: 'chengxiang',
                    chengxiangSumLimit: 13,
                    guanxingTopLabel: '获得（点数之和≤13）',
                    guanxingBottomLabel: '置入弃牌堆',
                },
            })
            return
        }

        // ── 排异（界钟会）：令其摸两张牌 / 对其造成1点伤害，手牌数大于你则执行另一项
        case 'zhonghui_paiyi': {
            state.pendingResponseQueue.shift()
            const pyT = state.generals[ctx.paiyiTargetIndex as number]
            if (!pyT?.alive) return
            const runPaiyiItem = (draw: boolean) => {
                if (!pyT.alive) return
                if (draw) {
                    const pyDrawn = drawForGeneral(state, pyT, 2)
                    pyT.hand.push(...pyDrawn)
                    addLog(state, `【${name}】【排异】：【${getGeneralName(pyT)}】摸${pyDrawn.length}张牌`)
                } else {
                    addLog(state, `【${name}】【排异】：对【${getGeneralName(pyT)}】造成1点伤害`)
                    dealDamage(state, general, pyT, 1)
                }
            }
            const pyFirstDraw = action === 'draw'
            runPaiyiItem(pyFirstDraw)
            if (pyT.alive && pyT.hand.length > general.hand.length) {
                addLog(state, `【${name}】【排异】：【${getGeneralName(pyT)}】手牌数大于你，执行另一项`)
                runPaiyiItem(!pyFirstDraw)
                general.paiyiLimitPhase = 2
                addLog(state, `【${name}】【排异】本阶段改为限两次`)
            }
            return
        }

        // ── 翦灭（界张春华）：自己选好颜色后，由对方选择颜色（双方同时选，先选的不公开）
        case 'zhangchunhua_jianmie': {
            state.pendingResponseQueue.shift()
            const jmOpp = state.generals[ctx.jianmieOpponentIndex as number]
            if (!jmOpp?.alive) return
            setJianmieColor(state, state.generals.indexOf(general), action)
            addLog(state, `【${name}】发动【翦灭】，双方各选一种颜色`)
            state.pendingResponseQueue.push({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: ctx.jianmieOpponentIndex as number,
                context: {
                    skillId: 'zhangchunhua_jianmie_opp',
                    skillName: '翦灭',
                    description: '选择一种颜色，弃置该颜色的所有手牌',
                    options: [
                        { action: 'red', label: '红色' },
                        { action: 'black', label: '黑色' },
                    ],
                    jianmieOwnerIndex: state.generals.indexOf(general),
                },
            })
            return
        }
        case 'zhangchunhua_jianmie_opp': {
            state.pendingResponseQueue.shift()
            const jmOwner = state.generals[ctx.jianmieOwnerIndex as number]
            if (!jmOwner?.alive || !general.alive) return
            const discardByColor = (g: GeneralInstance, color: string): number => {
                const kept: Card[] = []
                const removed: Card[] = []
                for (const c of g.hand) {
                    const isRed = c.suit === CardSuit.HEART || c.suit === CardSuit.DIAMOND
                    if ((color === 'red') === isRed) removed.push(c)
                    else kept.push(c)
                }
                g.hand = kept
                if (removed.length > 0) {
                    state.discard.push(...removed)
                    maybeChunlaoPickup(state, g, removed)
                }
                return removed.length
            }
            const ownerColor = takeJianmieColor(state, ctx.jianmieOwnerIndex as number) ?? 'red'
            const ownerCount = discardByColor(jmOwner, ownerColor)
            const oppCount = discardByColor(general, action)
            addLog(state, `【翦灭】【${getGeneralName(jmOwner)}】弃置${ownerCount}张${ownerColor === 'red' ? '红' : '黑'}色手牌，【${getGeneralName(general)}】弃置${oppCount}张${action === 'red' ? '红' : '黑'}色手牌`)
            if (ownerCount === oppCount) {
                addLog(state, '【翦灭】：双方弃牌数相同，不产生【决斗】')
                return
            }
            const jmDuelUser = ownerCount > oppCount ? jmOwner : general
            const jmDuelTarget = ownerCount > oppCount ? general : jmOwner
            useVirtualDuel(state, jmDuelUser, state.generals.indexOf(jmDuelTarget), '翦灭')
            return
        }

        // ── 谋溃（伏完）：摸一 / 弃一 / 两项都选（都选才在【杀】被抵消时反噬）
        case 'fuwan_moukui': {
            resolveMoukui(state, general, ctx as any, action)
            return
        }

        default:
            return { error: "未知技能选项" };
    }
}

/** 谋溃（伏完）：摸一 / 弃一 / 两项都选（都选才在【杀】被抵消时反噬） */
function moukuiOptions(target: GeneralInstance): { action: string; label: string }[] {
    const options = [{ action: 'moukui_draw', label: '摸一张牌' }]
    const hasCard = target.hand.length > 0 || Object.values(target.equip).some((e) => e != null)
    if (hasCard) {
        options.push({ action: 'moukui_discard', label: `弃置【${getGeneralName(target)}】的一张牌` })
        options.push({ action: 'moukui_both', label: '两项都选（此【杀】被抵消时其弃你一张牌）' })
    }
    return options
}

function moukuiDescription(target: GeneralInstance): string {
    return `对【${getGeneralName(target)}】：摸一张牌 或 弃其一张牌；同时选两项则此【杀】被抵消时其弃你一张牌`
}

/**
 * 谋溃（伏完）：可以只选一项（摸一张牌 / 弃目标一张牌），也可以两项都选。
 * 只有两项都选（moukui_both）时，此【杀】被抵消才由目标弃置伏完一张牌。
 */
function resolveMoukui(
    state: GameState,
    general: GeneralInstance,
    ctx: Record<string, any>,
    action: string,
): void {
    state.pendingResponseQueue.shift()
    const name = getGeneralName(general)
    const targetIdx = ctx.moukuiTargetIndex as number
    const target = state.generals[targetIdx]
    const hasCard = !!target && target.alive && (
        target.hand.length > 0 || Object.values(target.equip).some(e => e != null)
    )
    const both = action === 'moukui_both' && hasCard
    const wantDraw = action === 'moukui_draw' || both
    const wantDiscard = (action === 'moukui_discard' || both) && hasCard
    const parts: string[] = []
    if (wantDraw) {
        const drawn = drawCards(state, 1)
        general.hand.push(...drawn)
        parts.push(`摸 ${drawn.length} 张牌`)
    }
    if (both) {
        const dodge = state.pendingResponseQueue.find(p =>
            p.type === ResponseType.DODGE && p.targetGeneralIndex === targetIdx)
        if (dodge) (dodge.context as any).moukuiPenalty = true
    }
    if (wantDiscard) {
        parts.push(`弃置【${getGeneralName(target)}】的一张牌`)
        if (parts.length > 0) addLog(state, `【${name}】发动【谋溃】，${parts.join('，')}`)
        state.pendingResponseQueue.unshift({
            type: ResponseType.TRICK_TARGET_CARD_PICK,
            targetGeneralIndex: state.generals.indexOf(general),
            context: {
                trickType: 'dismantle',
                label: '谋溃',
                targetIndex: targetIdx,
                moukuiSlash: {
                    attackerGeneralIndex: ctx.attackerIndex,
                    attackCard: ctx.attackCard,
                    requiredDodges: ctx.requiredDodges ?? 1,
                    targetIndex: targetIdx,
                    moukuiPenalty: both,
                },
            },
        })
        return
    }
    if (parts.length > 0) addLog(state, `【${name}】发动【谋溃】，${parts.join('，')}`)
}

function handleRespondImpl(state: GameState, playerId: string, data: C2S_Respond): { error: string } | void {
    const pending = state.pendingResponseQueue[0];
    if (!pending) return { error: "当前没有待响应的事件" };
    if (state.negateWindow) return { error: "等待无懈可击结算" };
    const targetGeneral = state.generals[pending.targetGeneralIndex];
    if (!targetGeneral || targetGeneral.playerId !== playerId) {
        return { error: "不是你需要响应" };
    }
    if (data.cardId && targetGeneral.hand.some((c) => c.id === data.cardId) && cannotUseHandCards(state, targetGeneral)) {
        return { error: "【雄乱】：本回合不能使用或打出手牌" };
    }
    if (data.action === "zhenshan") {
        const zsResult = applyZhenshanResponse(state, targetGeneral, pending, data);
        if (zsResult) return zsResult;
    }
    switch (pending.type) {
        case ResponseType.DODGE:
            return handleDodgeResponse(state, targetGeneral, pending, data);
        case ResponseType.ATTACK_DUEL:
            return handleDuelResponse(state, targetGeneral, pending, data);
        // 桃园结义的治疗无需玩家选择：无懈窗口结算后直接生效
        case ResponseType.PEACH_GARDEN_HEAL: {
            state.pendingResponseQueue.shift();
            if (targetGeneral.alive && targetGeneral.hp < targetGeneral.maxHp) {
                targetGeneral.hp++;
                addLog(state, `【${getGeneralName(targetGeneral)}】通过【桃园结义】回复至 ${targetGeneral.hp}/${targetGeneral.maxHp}`);
                triggerDianhuRecover(state, targetGeneral);
            }
            return;
        }
        // ── 技能确认：是否发动
        case ResponseType.SKILL_ACTIVATE_CONFIRM: {
            const ctx = pending.context as any;
            const action = data.action;
            // 洛书版扩展（九）
            const expConfirm = expConfirmA(state, targetGeneral, pending, action, ctx)
            if (expConfirm !== EXP_UNHANDLED) return expConfirm
            const expConfirm2 = expConfirmB(state, targetGeneral, pending, action, ctx)
            if (expConfirm2 !== EXP_UNHANDLED) return expConfirm2
            const ctxOptions = ctx.options;
            if (ctxOptions && ctxOptions.length > 0) {
                const picked = action && ctxOptions.some((o: any) => o.action === action) ? action : undefined;
                const skipSkill = (note?: string) => {
                    addLog(state, `【${getGeneralName(targetGeneral)}】${note ?? `放弃发动【${ctx.skillName}】`}`);
                    state.pendingResponseQueue.shift();
                    if (ctx.skillId === "caifuren_qieting" || ctx.skillId === "caifuren_jie_qieting" || ctx.skillId === "haozhao_zhengu"
                        || ctx.skillId === "sunce_hunzi_end") {
                        advanceTurnGuarded(state);
                    }
                };
                if (picked) return resolveSkillOption(state, targetGeneral, pending, picked);
                if (!action || action === "decline") {
                    if (ctx.skillId === "caocao_jie_shuzhi") {
                        return resolveSkillOption(state, targetGeneral, pending, "jianxiong");
                    }
                    if (ctx.skillId === "zhonghui_zili") {
                        return resolveSkillOption(state, targetGeneral, pending, "heal");
                    }
                    skipSkill();
                    return;
                }
                // 选项与当前询问对不上（旧界面、模型幻觉等）：按放弃处理并留痕，避免整个界面卡在这一次询问上
                skipSkill(`【${ctx.skillName}】收到无效选项「${action}」，按放弃处理`);
                return;
            }
            if (ctx.autoExecute) {
                state.pendingResponseQueue.shift();
                switch (ctx.skillId) {
                    // 献图（界张松）：此阶段结束时失去1点体力，然后继续收尾
                    case "zhangsong_xiantu_cost": {
                        const xtUser = state.generals[pending.targetGeneralIndex];
                        if (xtUser) resolveXiantuCost(state, xtUser);
                        return;
                    }
                    case "chengpu_lihuo_cost": {
                        const lihuoUser = state.generals[pending.targetGeneralIndex];
                        if (lihuoUser) {
                            const damaged = !!lihuoUser.lihuoDamaged;
                            lihuoUser.lihuoFirePhase = false;
                            lihuoUser.lihuoDamaged = false;
                            if (damaged && lihuoUser.alive) {
                                loseHp(state, lihuoUser, 1);
                                addLog(state, `【${getGeneralName(lihuoUser)}】【疠火】反噬，失去1点体力`);
                            }
                        }
                        return;
                    }
                    case "chengpu_jie_lihuo_cost": {
                        const lihuoJieUser = state.generals[pending.targetGeneralIndex];
                        if (lihuoJieUser) {
                            const damaged = !!lihuoJieUser.lihuoDamaged;
                            lihuoJieUser.lihuoFirePhase = false;
                            lihuoJieUser.lihuoDamaged = false;
                            if (damaged && lihuoJieUser.alive) {
                                if (hasCardInArea(lihuoJieUser)) {
                                    state.pendingResponseQueue.unshift({
                                        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                                        targetGeneralIndex: pending.targetGeneralIndex,
                                        context: {
                                            skillId: "chengpu_jie_lihuo_cost",
                                            skillName: "疠火",
                                            description: "此【杀】造成过伤害，选择一项",
                                            options: [
                                                { action: "discard", label: "弃置一张牌" },
                                                { action: "loseHp", label: "失去1点体力" }
                                            ]
                                        }
                                    });
                                } else {
                                    loseHp(state, lihuoJieUser, 1);
                                    addLog(state, `【${getGeneralName(lihuoJieUser)}】【疠火】没有牌可弃，失去1点体力`);
                                }
                            }
                        }
                        return;
                    }
                    case "huanggai_kurou_draw": {
                        if (targetGeneral.alive) {
                            const drawn = drawCards(state, 2);
                            targetGeneral.hand.push(...drawn);
                            addLog(state, `【${getGeneralName(targetGeneral)}】苦肉结算：摸了2张牌`);
                        }
                        return;
                    }
                    default:
                        return;
                }
            }
            if (action === "decline" || !action && !data.cardId) {
                addLog(state, `【${getGeneralName(targetGeneral)}】放弃发动【${ctx.skillName}】`);
                state.pendingResponseQueue.shift();
                if (ctx.skillId === "hanhaosihuan_yonglue") {
                    if (!state.pendingResponseQueue.some((p) => p.context?.skillId === "hanhaosihuan_yonglue")) {
                        startJudgePhase(state);
                    }
                    return;
                }
                if (ctx.endPhaseSkill) {
                    advanceTurnGuarded(state);
                    return;
                }
                if (ctx.skillId === "lusu_haoshi" || ctx.skillId === "yanliang_shuangxiong") {
                    const plainDrawn = drawForGeneral(state, targetGeneral, 2);
                    targetGeneral.hand.push(...plainDrawn);
                    addLog(state, `【${getGeneralName(targetGeneral)}】摸了 ${plainDrawn.length} 张牌`);
                    if (ctx.skipAction) {
                        state.turnPhase = TurnPhase.DISCARD;
                        if (targetGeneral.hand.length <= targetGeneral.hp) finishTurn(state);
                    } else {
                        beginActionPhase(state, targetGeneral);
                    }
                    return;
                }
                if (ctx.skillId === "zhangliao_tuxi") {
                    let drawCount = 2;
                    if (hasSkill(targetGeneral, "zhouyu_yingzi") || hasSkill(targetGeneral, "zhouyu_jie_yingzi") || hasSkill(targetGeneral, "sunce_yingzi")) drawCount = 3;
                    const drawn = drawCards(state, drawCount);
                    targetGeneral.hand.push(...drawn);
                    addLog(state, `【${getGeneralName(targetGeneral)}】摸了 ${drawn.length} 张牌`);
                    if (ctx.skipAction) {
                        state.turnPhase = TurnPhase.DISCARD;
                        if (targetGeneral.hand.length <= targetGeneral.hp) {
                            finishTurn(state);
                        }
                    } else {
                        state.turnPhase = TurnPhase.ACTION;
                        addLog(state, `【${getGeneralName(targetGeneral)}】进入出牌阶段`);
                    }
                }
                if (ctx.skillId === "daqiao_liuli") {
                    const atkCtx = ctx;
                    const attackerIdx = atkCtx.attackerIndex;
                    const attacker = state.generals[attackerIdx];
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.DODGE,
                        targetGeneralIndex: state.generals.indexOf(targetGeneral),
                        context: {
                            attackerGeneralIndex: attackerIdx,
                            requiredDodges: atkCtx.requiredDodges || 1,
                            dodgesReceived: 0,
                            attackCard: atkCtx.attackCard
                        }
                    });
                    maybeDoubleSwords(state, attackerIdx, state.generals.indexOf(targetGeneral));
                }
                if (ctx.skillId === "xiaoqiao_tianxiang") {
                    const txCtx = ctx;
                    const atkIdx = txCtx.attackerIndex;
                    const atk = atkIdx >= 0 ? state.generals[atkIdx] : null;
                    dealDamage(state, atk, targetGeneral, txCtx.damageAmount, txCtx.damageCardId, {
                        skipArmor: true,
                        skipTianxiang: true
                    });
                }
                if (ctx.skillId === "xiaoqiao_tianxiang_luoshu") {
                    const txCtx = ctx;
                    const atkIdx = txCtx.attackerIndex;
                    const atk = atkIdx >= 0 ? state.generals[atkIdx] : null;
                    dealDamage(state, atk, targetGeneral, txCtx.damageAmount, txCtx.damageCardId, {
                        skipArmor: true,
                        skipTianxiang: true
                    });
                }
                if (ctx.skillId === "chengong_mingce") {
                    const drawn = drawCards(state, 1);
                    targetGeneral.hand.push(...drawn);
                    addLog(state, `【${getGeneralName(targetGeneral)}】选择摸 ${drawn.length} 张牌（明策）`);
                }
                if (ctx.skillId === "xiahoyuan_shensu_1") {
                    continueTurnFromJudge(state, false, false, false);
                }
                if (ctx.skillId === "equip_ice_sword") {
                    const isCtx = ctx;
                    const iceTarget = state.generals[isCtx.targetIndex];
                    if (iceTarget) {
                        let killDamage = isCtx.killDamage ?? 1;
                        const allySameTeam = state.generals.filter((g) => g.alive && g.faction === targetGeneral.faction);
                        if (allySameTeam.some((g) => g.loyaltyCard)) killDamage += 1;
                        dealDamage(state, targetGeneral, iceTarget, killDamage, isCtx.attackCard?.id, slashDamageOpts(null, isCtx.attackCard));
                    }
                }
                if (ctx.skillId === "equip_kylin_bow" || ctx.skillId === "equip_kylin_bow_auto") {
                    const kbCtx = ctx;
                    const kbTarget = state.generals[kbCtx.targetIndex];
                    if (kbTarget?.alive) {
                        dealDamage(state, targetGeneral, kbTarget, kbCtx.killDamage ?? 1, kbCtx.attackCard?.id, slashDamageOpts(null, kbCtx.attackCard));
                    }
                }
                if (ctx.skillId === "xuchu_luoyi") {
                    const drawn = drawCards(state, 2);
                    targetGeneral.hand.push(...drawn);
                    addLog(state, `【${getGeneralName(targetGeneral)}】摸了 ${drawn.length} 张牌`);
                    beginActionPhase(state, targetGeneral);
                    return;
                }
                if (ctx.skillId === "wangyi_zhenlie" || ctx.skillId === "wangyi_jie_zhenlie") {
                    const zlCtx = ctx;
                    if (zlCtx.zhenlieEffect) {
                        const eff = zlCtx.zhenlieEffect;
                        eff.extra = { ...eff.extra ?? {}, zhenlieDeclined: true };
                        executeDeferredTrickEffect(state, eff);
                        return;
                    }
                    if (zlCtx.zhenlieAoe) {
                        const aoe = zlCtx.zhenlieAoe;
                        state.pendingResponseQueue.unshift({
                            type: aoe.responseType,
                            targetGeneralIndex: state.generals.indexOf(targetGeneral),
                            context: {
                                sourceGeneralIndex: aoe.sourceIndex,
                                sourceCardId: aoe.cardId,
                                needsNegate: true,
                                trickCardName: aoe.cardName,
                                trickTargetName: getGeneralName(targetGeneral)
                            }
                        });
                        return;
                    }
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.DODGE,
                        targetGeneralIndex: state.generals.indexOf(targetGeneral),
                        context: {
                            attackerGeneralIndex: zlCtx.attackerIndex,
                            requiredDodges: zlCtx.requiredDodges ?? 1,
                            dodgesReceived: 0,
                            attackCard: zlCtx.attackCard
                        }
                    });
                    return;
                }
                if (ctx.skillId === "zhanghe_qiaobian") {
                    const zbDeclinePhase = ctx.qiaobianPhase;
                    const zbDeclineSkip = !!ctx.qiaobianSkipAction;
                    if (zbDeclinePhase === "judge") continueTurnFromJudge(state, false, false, zbDeclineSkip);
                    else if (zbDeclinePhase === "draw") finishJudgePhaseAndContinue(state, targetGeneral, zbDeclineSkip, false);
                    else if (zbDeclinePhase === "action") beginActionPhase(state, targetGeneral);
                    else enterDiscardPhaseOrSkip(state, targetGeneral);
                    return;
                }
                if (ctx.skillId === "taishici_hanzhan") {
                    const hzPin = state.pindian;
                    if (hzPin) {
                        hzPin.extra = { ...hzPin.extra ?? {}, hanzhanAsked: true };
                        const hzOpp = state.generals[hzPin.opponentIndex];
                        if (hzOpp) pushPindianInitiatorPick(state, targetGeneral, hzOpp, hzPin.skillName);
                    }
                    return;
                }
                if (ctx.skillId === "wangping_feijun") {
                    const fjCtx = ctx;
                    const fjUser = state.generals[fjCtx.feijunUserIndex];
                    if (fjUser) {
                        const drawn = drawCards(state, 2);
                        fjUser.hand.push(...drawn);
                        addLog(state, `【${getGeneralName(targetGeneral)}】选择令【${getGeneralName(fjUser)}】摸两张牌（飞军）`);
                        if (hasSkill(fjUser, "wangping_binglue") && !(fjUser.feijunTargets ?? []).includes(state.generals.indexOf(targetGeneral))) {
                            fjUser.feijunTargets = [...fjUser.feijunTargets ?? [], state.generals.indexOf(targetGeneral)];
                            const bonus = drawCards(state, 2);
                            fjUser.hand.push(...bonus);
                            addLog(state, `【${getGeneralName(fjUser)}】发动【兵略】，摸两张牌`);
                        }
                    }
                    return;
                }
                if (ctx.skillId === "huangquan_quanjian") {
                    const qjCtx = ctx;
                    const qjUser = state.generals[qjCtx.quanjianUserIndex];
                    if (qjUser) {
                        const drawn = drawCards(state, 1);
                        qjUser.hand.push(...drawn);
                        qjUser.cannotUseHandTurn = state.activeGeneralIndex;
                        addLog(state, `【${getGeneralName(targetGeneral)}】拒绝劝谏，【${getGeneralName(qjUser)}】摸一张牌且本回合不能使用手牌`);
                    }
                    return;
                }
                if (ctx.skillId === "caifuren_xianzhou") {
                    const xzCtx = ctx;
                    const x = xzCtx.xianzhouCount;
                    const xzUser = state.generals[xzCtx.xianzhouUserIndex];
                    const within = state.generals.filter((g) => g.alive && g.faction !== targetGeneral.faction && getAttackRange(targetGeneral, g, state.generals).inRange);
                    const victims = within.slice(0, x);
                    for (const v of victims) dealDamage(state, targetGeneral, v, 1);
                    addLog(state, `【${getGeneralName(targetGeneral)}】选择令【${getGeneralName(xzUser)}】造成 ${victims.length} 点伤害（献州）`);
                    return;
                }
                if (ctx.skillId === "wangyi_miji") {
                    advanceTurnGuarded(state);
                    return;
                }
                if (ctx.skillId === "wangyi_miji_give") {
                    advanceTurnGuarded(state);
                    return;
                }
                if (ctx.skillId === "diaochan_biyue" || ctx.skillId === "zumao_yinbing" || ctx.skillId === "guyong_bingyi" || ctx.skillId === "yufan_zhiyan" || ctx.skillId === "caifuren_qieting" || ctx.skillId === "yuejin_xiaoguo") {
                    advanceTurnGuarded(state);
                    return;
                }
                if (ctx.skillId === "lidian_xunxun") {
                    finishDrawPhaseAfterXunxun(state, targetGeneral, !!ctx.skipAction);
                    return;
                }
                if (ctx.skillId === "lingtong_xuanfeng" && ctx.xuanfengDiscardPhase) {
                    if (state.pendingResponseQueue.length === 0) finishTurn(state);
                    return;
                }
                if (ctx.skillId === "wangji_jinqu") {
                    advanceTurnGuarded(state);
                    return;
                }
                if (ctx.skillId === "luxun_jie_lianying" && ctx.lianyingDiscardPhase) {
                    finishTurn(state);
                    return;
                }
                if (ctx.skillId === "masu_zhiman") {
                    const zhimanVictim = state.generals[ctx.zhimanTargetIndex];
                    if (zhimanVictim) {
                        dealDamage(
                            state,
                            targetGeneral,
                            zhimanVictim,
                            ctx.zhimanAmount,
                            ctx.zhimanCardId,
                            { ...ctx.zhimanResumeOpts ?? {}, skipZhiman: true }
                        );
                    }
                    return;
                }
                if (ctx.skillId === "luji_zhenglun") {
                    const zlCount = hasSkill(targetGeneral, "zhouyu_yingzi") || hasSkill(targetGeneral, "zhouyu_jie_yingzi") || hasSkill(targetGeneral, "sunce_yingzi") ? 3 : 2;
                    const zlDrawn = drawForGeneral(state, targetGeneral, zlCount);
                    targetGeneral.hand.push(...zlDrawn);
                    addLog(state, `【${getGeneralName(targetGeneral)}】摸了${zlDrawn.length}张牌`);
                    beginActionPhase(state, targetGeneral);
                    return;
                }
                if (ctx.skillId === "fazheng_xuanhuo") {
                    const xhCount = hasSkill(targetGeneral, "zhouyu_yingzi") || hasSkill(targetGeneral, "zhouyu_jie_yingzi") || hasSkill(targetGeneral, "sunce_yingzi") ? 3 : 2;
                    const xhDrawn = drawForGeneral(state, targetGeneral, xhCount);
                    targetGeneral.hand.push(...xhDrawn);
                    addLog(state, `【${getGeneralName(targetGeneral)}】摸了${xhDrawn.length}张牌`);
                    beginActionPhase(state, targetGeneral);
                    return;
                }
                if (ctx.skillId === "sunqian_shuomeng") {
                    advanceTurnGuarded(state);
                    return;
                }
                if (ctx.skillId === "guohuai_jingce") {
                    const jcActiveGen = getActiveGeneral(state);
                    if (jcActiveGen) enterDiscardPhaseOrSkip(state, jcActiveGen);
                    return;
                }
                if (ctx.skillId === "zhuhuan_fenli_draw") {
                    finishJudgePhaseAndContinue(
                        state,
                        targetGeneral,
                        !!ctx.fenliSkipAction,
                        false
                    );
                    return;
                }
                if (ctx.skillId === "zhuhuan_fenli_action") {
                    beginActionPhase(state, targetGeneral);
                    return;
                }
                if (ctx.skillId === "zhuhuan_fenli_discard") {
                    enterDiscardPhaseOrSkip(state, targetGeneral);
                    return;
                }
                if (ctx.skillId === "zhonghui_zili") {
                    return resolveSkillOption(state, targetGeneral, pending, "heal");
                }
                if (ctx.skillId === "doudizhu_feiyang") {
                    targetGeneral.skillsUsedThisTurn.push("doudizhu_feiyang");
                    addLog(state, `【${getGeneralName(targetGeneral)}】放弃发动【飞扬】`);
                    continueTurnFromJudge(state, false, false, false);
                    return;
                }
                continueFromPrepPhase(state);
                return;
            }
            state.pendingResponseQueue.shift();
            const name = getGeneralName(targetGeneral);
            switch (ctx.skillId) {
                // 激昂②（界孙策）：失去1点体力，获得因弃置进弃牌堆的红色【杀】/【决斗】
                case "sunce_jiang_jie": {
                    const jjId = ctx.jiangJieCardId as string | undefined
                    const jjIdx = jjId ? state.discard.findIndex(c => c.id === jjId) : -1
                    if (jjIdx < 0) {
                        addLog(state, "【激昂】的牌已不在弃牌堆")
                        return
                    }
                    const jjCard = state.discard.splice(jjIdx, 1)[0]
                    loseHp(state, targetGeneral, 1)
                    if (targetGeneral.hp > 0) {
                        targetGeneral.hand.push(jjCard)
                        addLog(state, `【${name}】发动【激昂】，失去1点体力并获得${cardFullName(jjCard)}`)
                    } else {
                        // 濒死优先结算，救回后再获得此牌
                        state.discard.push(jjCard)
                        state.pendingResponseQueue.push({
                            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                            targetGeneralIndex: state.generals.indexOf(targetGeneral),
                            context: {
                                skillId: "sunce_jiang_jie_gain",
                                autoExecute: true,
                                jiangJieCardId: jjCard.id,
                            },
                        })
                    }
                    return
                }
                // ══ 洛书版扩展（七） ══
                // 慎断（韩浩史涣）：选择【兵粮寸断】的目标
                case "hanhaosihuan_shenduan": {
                    const sdSelfIdx = state.generals.indexOf(targetGeneral);
                    const sdCandidates = state.generals.map((g, i) => ({ g, i })).filter(({ g, i }) => g.alive && i !== sdSelfIdx).map(({ i }) => i);
                    if (!state.discard.some((c) => c.id === ctx.shenduanCardId)) {
                        addLog(state, "【慎断】的牌已不在弃牌堆");
                        return;
                    }
                    if (sdCandidates.length === 0) {
                        addLog(state, "【慎断】没有其他角色可选");
                        return;
                    }
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.SKILL_CHOOSE_TARGET,
                        targetGeneralIndex: sdSelfIdx,
                        context: {
                            skillId: "hanhaosihuan_shenduan",
                            skillName: "慎断",
                            description: "选择一名角色，将【兵粮寸断】置入其判定区",
                            candidateIndices: sdCandidates,
                            shenduanCardId: ctx.shenduanCardId
                        }
                    });
                    return;
                }
                // 勇略（韩浩史涣）：弃其判定牌并视为使用【杀】
                case "hanhaosihuan_yonglue": {
                    resolveYonglueAttack(state, ctx.yonglueOwnerIndex, ctx.yonglueTargetIndex);
                    if (!state.pendingResponseQueue.some((p) => p.context?.skillId === "hanhaosihuan_yonglue")) {
                        startJudgePhase(state);
                    }
                    return;
                }
                // 镇胆②（闪赵云）：摸X张牌，然后本轮此技能失效
                case "shanzhaoyun_zhendan_draw": {
                    const zdCount = ctx.zhendanDrawCount ?? 1;
                    const zdDrawn = drawForGeneral(state, targetGeneral, zdCount);
                    targetGeneral.hand.push(...zdDrawn);
                    targetGeneral.zhendanDisabledRound = state.roundState?.roundNumber ?? 0;
                    addLog(state, `【${name}】发动【镇胆】，摸${zdDrawn.length}张牌，本轮此技能失效`);
                    return;
                }
                // 龙临（闪赵云）：弃一张牌令此【杀】无效
                case "shanzhaoyun_longlin": {
                    askPickCard(
                        state,
                        targetGeneral,
                        "shanzhaoyun_longlin",
                        "龙临",
                        "弃置一张牌，令此【杀】无效",
                        { count: 1, extra: { longlinUserIndex: ctx.longlinUserIndex, attackCardId: ctx.attackCardId } }
                    );
                    return;
                }
                // 龙临：视为对闪赵云使用【决斗】
                case "shanzhaoyun_longlin_duel": {
                    const llUser = state.generals[ctx.longlinUserIndex];
                    if (llUser?.alive) {
                        llUser.onlySelfTargetPhase = true;
                        useVirtualDuel(state, llUser, state.generals.indexOf(targetGeneral), "龙临");
                    }
                    return;
                }
                // 慷忾（曹昂）：摸一张牌，然后交给其一张牌
                case "caoang_kangkai": {
                    const kkDrawn = drawForGeneral(state, targetGeneral, 1);
                    targetGeneral.hand.push(...kkDrawn);
                    const kkPromptIds = [
                        ...targetGeneral.hand.map((c) => c.id),
                        ...Object.values(targetGeneral.equip).filter(Boolean).map((c) => c.id)
                    ];
                    const kkTarget = state.generals[ctx.kangkaiTargetIndex];
                    if (!kkTarget || kkPromptIds.length === 0) return;
                    askPickCard(
                        state,
                        targetGeneral,
                        "caoang_kangkai",
                        "慷忾",
                        `选择一张牌交给【${getGeneralName(kkTarget)}】并展示`,
                        { count: 1, mode: "kangkai", candidateCardIds: kkPromptIds, extra: { kangkaiTargetIndex: ctx.kangkaiTargetIndex } }
                    );
                    return;
                }
                // 慷忾：获得的装备牌可以使用
                case "caoang_kangkai_use": {
                    const kuCard = targetGeneral.hand.find((c) => c.id === ctx.kangkaiEquipId);
                    if (!kuCard || kuCard.category !== CardCategory.EQUIPMENT || !kuCard.equipSlot) return;
                    targetGeneral.hand.splice(targetGeneral.hand.indexOf(kuCard), 1);
                    const kuOld = targetGeneral.equip[kuCard.equipSlot];
                    if (kuOld) state.discard.push(kuOld);
                    targetGeneral.equip[kuCard.equipSlot] = kuCard;
                    addLog(state, `【${getGeneralName(targetGeneral)}】使用了【慷忾】获得的${cardFullName(kuCard)}`);
                    return;
                }
                // 谏征（秦宓）：将一张手牌置于牌堆顶
                case "qinmi_jianzheng": {
                    if (targetGeneral.hand.length === 0) return;
                    askPickCard(
                        state,
                        targetGeneral,
                        "qinmi_jianzheng",
                        "谏征",
                        "将一张手牌置于牌堆顶，取消此【杀】的所有目标",
                        { count: 1, mode: "topdeck", extra: {
                            jianzhengAttackerIndex: ctx.jianzhengAttackerIndex,
                            attackCardId: ctx.attackCardId,
                            attackCard: ctx.attackCard
                        } }
                    );
                    return;
                }
                // 专对（秦宓）：使用【杀】指定目标后与其拼点
                case "qinmi_zhuandui_atk": {
                    const qzAtkTarget = state.generals[ctx.zhuanDuiTargetIndex];
                    if (qzAtkTarget?.alive && targetGeneral.hand.length > 0 && qzAtkTarget.hand.length > 0) {
                        pindianStart(state, targetGeneral, qzAtkTarget, "qinmi_zhuandui_atk", "专对", {
                            attackCardId: ctx.attackCardId,
                            targetIndex: ctx.zhuanDuiTargetIndex,
                            attackerIndex: state.generals.indexOf(targetGeneral)
                        });
                    }
                    return;
                }
                // 专对（秦宓）：成为【杀】目标后与其拼点
                case "qinmi_zhuandui_def": {
                    const qzAtk = state.generals[ctx.zhuanDuiAttackerIndex];
                    if (qzAtk?.alive && targetGeneral.hand.length > 0 && qzAtk.hand.length > 0) {
                        pindianStart(state, targetGeneral, qzAtk, "qinmi_zhuandui_def", "专对", {
                            attackCardId: ctx.attackCardId,
                            targetIndex: ctx.zhuanDuiTargetIndex,
                            attackerIndex: ctx.zhuanDuiAttackerIndex
                        });
                    }
                    return;
                }
                // 下书（阚泽）：选择一名其他角色
                case "kanze_xiashu": {
                    const xsSelfIdx = state.generals.indexOf(targetGeneral);
                    const xsCandidates = state.generals.map((g, i) => ({ g, i })).filter(({ g, i }) => g.alive && i !== xsSelfIdx).map(({ i }) => i);
                    if (xsCandidates.length === 0) return;
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.SKILL_CHOOSE_TARGET,
                        targetGeneralIndex: xsSelfIdx,
                        context: {
                            skillId: "kanze_xiashu",
                            skillName: "下书",
                            description: "选择一名其他角色，将所有手牌交给其",
                            candidateIndices: xsCandidates
                        }
                    });
                    return;
                }
                // 反馈（界司马懿）：修改“矫诏”
                case "simayi_jie_upgrade": {
                    targetGeneral.jiaozhaoUpgrade = Math.min(2, (targetGeneral.jiaozhaoUpgrade ?? 0) + 1);
                    addLog(state, `【${name}】将【矫诏】修改至第${targetGeneral.jiaozhaoUpgrade}层`);
                    return;
                }
                // ══ 斗地主地主技 ══
                case "doudizhu_feiyang": {
                    if (targetGeneral.hand.length < 2) {
                        addLog(state, `【${name}】【飞扬】：手牌不足，无法发动`);
                        continueTurnFromJudge(state, false, false, false);
                        return;
                    }
                    state.pendingResponseQueue.push({
                        type: ResponseType.SKILL_PICK_CARD,
                        targetGeneralIndex: state.generals.indexOf(targetGeneral),
                        context: {
                            skillId: "doudizhu_feiyang",
                            skillName: "飞扬",
                            description: "弃置两张手牌，然后弃置自己判定区内的一张牌",
                            count: 2,
                            mode: "discard"
                        }
                    });
                    return;
                }
                // ══ 洛书版扩展（二） ══
                case "xunyu_jieming": {
                    const jmIdx = (ctx.jiemingCandidates ?? []).filter((i: any) => state.generals[i]?.alive);
                    if (jmIdx.length === 0) return;
                    if (jmIdx.length === 1) {
                        applyJieming(state, state.generals[jmIdx[0]]);
                        return;
                    }
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.SKILL_CHOOSE_TARGET,
                        targetGeneralIndex: state.generals.indexOf(targetGeneral),
                        context: {
                            skillId: "xunyu_jieming",
                            skillName: "节命",
                            description: "选择一名角色：其摸X张牌，然后将手牌弃置至X张（X为其体力上限，至多5）",
                            candidateIndices: jmIdx
                        }
                    });
                    return;
                }
                case "chenqun_faen": {
                    const faenTarget = state.generals[ctx.faenTargetIndex];
                    if (faenTarget?.alive) {
                        const feDrawn = drawForGeneral(state, faenTarget, 1);
                        faenTarget.hand.push(...feDrawn);
                        addLog(state, `【${name}】发动【法恩】，【${getGeneralName(faenTarget)}】摸一张牌`);
                    }
                    return;
                }
                case "guanyinping_wuji": {
                    if (targetGeneral.awakened) return;
                    targetGeneral.awakened = true;
                    targetGeneral.maxHp += 1;
                    targetGeneral.hp = Math.min(targetGeneral.hp + 1, targetGeneral.maxHp);
                    targetGeneral.lostSkills = [...targetGeneral.lostSkills ?? [], "guanyinping_huxiao"];
                    addLog(state, `【${name}】发动【武继】觉醒！加1点体力上限并回复1点体力，失去【虎啸】`);
                    const qlCard = state.deck.find((c) => c.name === EquipmentCardName.GREEN_DRAGON) ?? state.discard.find((c) => c.name === EquipmentCardName.GREEN_DRAGON) ?? state.generals.flatMap((g) => Object.values(g.equip)).find((c) => c?.name === EquipmentCardName.GREEN_DRAGON);
                    if (qlCard) {
                        const fromDeck = state.deck.indexOf(qlCard);
                        if (fromDeck >= 0) state.deck.splice(fromDeck, 1);
                        const fromDiscard = state.discard.indexOf(qlCard);
                        if (fromDiscard >= 0) state.discard.splice(fromDiscard, 1);
                        for (const g of state.generals) {
                            for (const slot of Object.values(EquipSlot)) {
                                if (g.equip[slot] === qlCard) g.equip[slot] = undefined;
                            }
                        }
                        targetGeneral.hand.push(qlCard);
                        addLog(state, `【${name}】【武继】获得【青龙偃月刀】`);
                    }
                    advanceTurnGuarded(state);
                    return;
                }
                case "caoren_jushou": {
                    const jushouDrawn = drawForGeneral(state, targetGeneral, 4);
                    targetGeneral.hand.push(...jushouDrawn);
                    addLog(state, `【${name}】发动【据守】，摸${jushouDrawn.length}张牌`);
                    flipGeneral(state, targetGeneral, "据守");
                    const jushouCard = lowValueCard(targetGeneral);
                    if (jushouCard) {
                        const hi = targetGeneral.hand.indexOf(jushouCard);
                        targetGeneral.hand.splice(hi, 1);
                        if (jushouCard.category === CardCategory.EQUIPMENT && jushouCard.equipSlot) {
                            const old = targetGeneral.equip[jushouCard.equipSlot];
                            if (old) state.discard.push(old);
                            targetGeneral.equip[jushouCard.equipSlot] = jushouCard;
                            addLog(state, `【${name}】【据守】使用了${cardFullName(jushouCard)}`);
                        } else {
                            state.discard.push(jushouCard);
                            addLog(state, `【${name}】【据守】弃置${cardFullName(jushouCard)}`);
                        }
                    }
                    advanceTurnGuarded(state);
                    return;
                }
                case "caoren_jiewei_front": {
                    const jwCard = lowValueCard(targetGeneral);
                    if (jwCard) {
                        const ji = targetGeneral.hand.indexOf(jwCard);
                        targetGeneral.hand.splice(ji, 1);
                        state.discard.push(jwCard);
                        addLog(state, `【${name}】【解围】弃置${cardFullName(jwCard)}`);
                        autoMoveEquip(state, targetGeneral, targetGeneral, "解围");
                    }
                    return;
                }
                case "xiahouyuan_shebian": {
                    autoMoveEquip(state, targetGeneral, targetGeneral, "设变");
                    return;
                }
                case "xunyu_quhu": {
                    const quhuOpponent = state.generals[ctx.quhuOpponentIndex];
                    if (quhuOpponent?.alive) autoPindian(state, targetGeneral, quhuOpponent, "xunyu_quhu_skill", "驱虎");
                    return;
                }
                case "taishici_tianyi": {
                    const tyOpponent = state.generals[ctx.tianyiOpponentIndex];
                    if (tyOpponent?.alive) autoPindian(state, targetGeneral, tyOpponent, "taishici_tianyi", "天义");
                    return;
                }
                case "gaoshun_xianzhen": {
                    const xzOpponent = state.generals[ctx.xianzhenOpponentIndex];
                    if (xzOpponent?.alive) autoPindian(state, targetGeneral, xzOpponent, "gaoshun_xianzhen", "陷阵");
                    return;
                }
                case "zhurong_lierend": {
                    const lrOpponent = state.generals[ctx.lierendTargetIndex];
                    if (lrOpponent?.alive) autoPindian(state, targetGeneral, lrOpponent, "zhurong_lierend", "烈刃");
                    return;
                }
                case "sunjian_wulie": {
                    const wlDirect = (data as any).targetIndices as number[] | undefined;
                    const wlUnique = Array.isArray(wlDirect) ? [...new Set(wlDirect)] : [];
                    const wlMax = Math.max(1, targetGeneral.hp - 1);
                    let wlIndices: number[];
                    if (wlUnique.length > 0) {
                        if (wlUnique.length > wlMax) return { error: `最多选择${wlMax}名角色` };
                        for (const tIdx of wlUnique) {
                            const t = state.generals[tIdx];
                            if (!t?.alive) return { error: "目标不存在" };
                            if (t === targetGeneral) return { error: "不能选择自己" };
                        }
                        wlIndices = wlUnique;
                    } else {
                        // AI 或旧界面未传目标：按“优先敌方、体力低”自动选择
                        const autoCount = Math.max(1, Math.min(2, wlMax));
                        wlIndices = state.generals.map((g, i) => ({ g, i }))
                            .filter(({ g }) => g.alive && g !== targetGeneral)
                            .sort((a, b) => Number(a.g.faction === targetGeneral.faction) - Number(b.g.faction === targetGeneral.faction)
                                || a.g.hp - b.g.hp)
                            .slice(0, autoCount)
                            .map(({ i }) => i);
                    }
                    if (wlIndices.length === 0) return { error: "没有可选择的角色" };
                    const loseCount = Math.max(1, Math.min(wlMax, wlIndices.length));
                    targetGeneral.usedLimitedSkills = [...targetGeneral.usedLimitedSkills, "sunjian_wulie"];
                    loseHp(state, targetGeneral, loseCount);
                    for (const tIdx of wlIndices.slice(0, loseCount)) {
                        const g = state.generals[tIdx];
                        if (g?.alive) g.lieMarks = (g.lieMarks ?? 0) + 1;
                    }
                    addLog(state, `【${name}】发动【武烈】，失去${loseCount}点体力，令${Math.min(loseCount, wlIndices.length)}名角色获得“烈”`);
                    advanceTurnGuarded(state);
                    return;
                }
                case "bulianshi_zhuiyi": {
                    targetGeneral.usedLimitedSkills = [...targetGeneral.usedLimitedSkills, "bulianshi_zhuiyi"];
                    const zyTarget = state.generals.map((g, i) => ({ g, i })).filter(({ g }) => g.alive && g !== targetGeneral).sort((a, b) => a.g.hp - a.g.maxHp - (b.g.hp - b.g.maxHp))[0]?.g;
                    if (zyTarget) {
                        const zyDrawn = drawForGeneral(state, zyTarget, 3);
                        zyTarget.hand.push(...zyDrawn);
                        zyTarget.hp = Math.min(zyTarget.hp + 1, zyTarget.maxHp);
                        addLog(state, `【${name}】发动【追忆】，【${getGeneralName(zyTarget)}】摸${zyDrawn.length}张牌并回复1点体力`);
                        triggerDianhuRecover(state, zyTarget);
                    }
                    advanceTurnGuarded(state);
                    return;
                }
                case "zhoufang_youdi": {
                    const ydTarget = state.generals.map((g, i) => ({ g, i })).filter(({ g }) => g.alive && g !== targetGeneral && (g.hand.length > 0 || Object.values(g.equip).some(Boolean))).sort((a, b) => b.g.hand.length - a.g.hand.length)[0]?.g;
                    if (ydTarget) {
                        const ydCard = lowValueCard(targetGeneral);
                        if (ydCard) {
                            const ydi = targetGeneral.hand.indexOf(ydCard);
                            targetGeneral.hand.splice(ydi, 1);
                            state.discard.push(ydCard);
                            addLog(state, `【${name}】【诱敌】：【${getGeneralName(ydTarget)}】弃置了${cardFullName(ydCard)}`);
                            if (ydCard.name !== BasicCardName.ATTACK) {
                                gainRandomCardFrom(state, targetGeneral, ydTarget);
                                addLog(state, `【${name}】【诱敌】获得【${getGeneralName(ydTarget)}】一张牌`);
                            }
                            if (ydCard.suit === CardSuit.SPADE || ydCard.suit === CardSuit.CLUB) {
                                const ydDrawn = drawForGeneral(state, targetGeneral, 1);
                                targetGeneral.hand.push(...ydDrawn);
                                addLog(state, `【${name}】【诱敌】摸一张牌`);
                            }
                        }
                    }
                    advanceTurnGuarded(state);
                    return;
                }
                case "yanliang_shuangxiong": {
                    const sxCard = lowValueCard(targetGeneral);
                    if (sxCard) {
                        const sxi = targetGeneral.hand.indexOf(sxCard);
                        targetGeneral.hand.splice(sxi, 1);
                        state.discard.push(sxCard);
                        const isRed = sxCard.suit === CardSuit.HEART || sxCard.suit === CardSuit.DIAMOND;
                        targetGeneral.shuangxiongColor = isRed ? "black" : "red";
                        addLog(state, `【${name}】发动【双雄】，弃置${cardFullName(sxCard)}，本回合可将${isRed ? "黑" : "红"}色手牌当【决斗】使用`);
                    }
                    const sxDrawn = drawForGeneral(state, targetGeneral, 2);
                    targetGeneral.hand.push(...sxDrawn);
                    addLog(state, `【${name}】摸了 ${sxDrawn.length} 张牌`);
                    if (ctx.skipAction) {
                        state.turnPhase = TurnPhase.DISCARD;
                        if (targetGeneral.hand.length <= targetGeneral.hp) finishTurn(state);
                    } else {
                        beginActionPhase(state, targetGeneral);
                    }
                    return;
                }
                case "lusu_haoshi": {
                    const hsDrawn = drawForGeneral(state, targetGeneral, 4);
                    targetGeneral.hand.push(...hsDrawn);
                    addLog(state, `【${name}】发动【好施】，摸了${hsDrawn.length}张牌`);
                    const pushHaoshiPhase = () => {
                        if (ctx.skipAction) {
                            state.turnPhase = TurnPhase.DISCARD;
                            if (targetGeneral.hand.length <= targetGeneral.hp) finishTurn(state);
                        } else {
                            beginActionPhase(state, targetGeneral);
                        }
                    };
                    if (targetGeneral.hand.length > 5) {
                        const giveCount = Math.floor(targetGeneral.hand.length / 2);
                        const others = state.generals.map((g, i) => ({ g, i }))
                            .filter(({ g }) => g.alive && g !== targetGeneral);
                        const minHand = Math.min(...others.map(({ g }) => g.hand.length));
                        const candidates = others.filter(({ g }) => g.hand.length === minHand).map(({ i }) => i);
                        if (candidates.length > 1) {
                            state.pendingResponseQueue.unshift({
                                type: ResponseType.SKILL_CHOOSE_TARGET,
                                targetGeneralIndex: state.generals.indexOf(targetGeneral),
                                context: {
                                    skillId: 'lusu_haoshi', skillName: '好施',
                                    description: `选择手牌最少的一名其他角色，交给其${giveCount}张手牌`,
                                    candidateIndices: candidates,
                                    haoshiCount: giveCount,
                                    haoshiSkipAction: ctx.skipAction,
                                    mandatory: true,
                                },
                            });
                            return;
                        }
                        if (candidates.length === 1) {
                            askPickCard(state, targetGeneral, 'lusu_haoshi_give', '好施',
                                `交给【${getGeneralName(others.find(({ i }) => i === candidates[0])!.g)}】${giveCount}张手牌`,
                                {
                                    count: giveCount, mode: 'give',
                                    extra: {
                                        haoshiReceiverIndex: candidates[0],
                                        haoshiSkipAction: ctx.skipAction,
                                        exactCount: true,
                                    },
                                });
                            return;
                        }
                    }
                    pushHaoshiPhase();
                    return;
                }
                case "zhoufei_kongsheng": {
                    // 箜声：由玩家自己挑任意张手牌置于武将牌上，结束阶段再结算
                    if (targetGeneral.hand.length === 0) {
                        continueFromPrepPhase(state)
                        return
                    }
                    askPickCard(state, targetGeneral, 'zhoufei_kongsheng', '箜声',
                        '将任意张手牌置于武将牌上，本回合结束阶段使用其中的装备牌并获得其余的牌',
                        { count: targetGeneral.hand.length, mode: 'kongsheng', extra: { kongshengPrep: true } })
                    return;
                }
                case "caocao_jianxiong": {
                    if (hasSkill(targetGeneral, "caocao_jie_jianxiong")
                        && targetGeneral.shuzhiLimited === "caocao_jie_jianxiong"
                        && !targetGeneral.usedLimitedSkills.includes("caocao_jie_jianxiong")) {
                        targetGeneral.usedLimitedSkills.push("caocao_jie_jianxiong")
                    }
                    const dmgCardId = ctx.damageCardId;
                    if (dmgCardId) {
                        const idx = state.discard.findIndex((c) => c.id === dmgCardId);
                        if (idx >= 0) {
                            const card2 = state.discard.splice(idx, 1)[0];
                            targetGeneral.hand.push(card2);
                            addLog(state, `【${name}】发动【奸雄】，获得造成伤害的牌（${suitSymbol(card2.suit)}${valueName(card2.value)} ${card2.name}）`);
                        }
                    }
                    // 界曹操：获得牌之后总是再摸一张，与是否能取回伤害牌无关
                    if (hasSkill(targetGeneral, "caocao_jie_jianxiong")) {
                        const drawn = drawCards(state, 1);
                        targetGeneral.hand.push(...drawn);
                        addLog(state, `【${name}】发动【奸雄】（界），摸${drawn.length}张牌`);
                    }
                    return;
                }
                case "simayi_fankui": {
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.SKILL_FANKUI_PICK,
                        targetGeneralIndex: state.generals.indexOf(targetGeneral),
                        context: {
                            sourceGeneralIndex: ctx.sourceGeneralIndex
                        }
                    });
                    addLog(state, `【${name}】发动【反馈】，选择获取一张牌`);
                    return;
                }
                case "guojia_yiji":
                case "guojia_jie_yiji": {
                    const yijiCards = state.deck.splice(0, Math.min(2, state.deck.length));
                    if (yijiCards.length > 0) {
                        targetGeneral.hand.push(...yijiCards);
                        addLog(state, `【${name}】发动【遗计】，摸了 ${yijiCards.length} 张牌`);
                        state.pendingResponseQueue.unshift({
                            type: ResponseType.SKILL_YIJI_DISTRIBUTE,
                            targetGeneralIndex: state.generals.indexOf(targetGeneral),
                            context: {
                                yijiCardIds: yijiCards.map((c) => c.id),
                                remaining: yijiCards.length
                            }
                        });
                        addLog(state, `请将 ${yijiCards.length} 张牌分配给任意角色（给自己=保留）`);
                    }
                    return;
                }
                case "xiahoudun_ganglie": {
                    performSkillJudge(state, targetGeneral, "ganglie", "刚烈", {
                        attackerGeneralIndex: ctx.attackerGeneralIndex
                    });
                    return;
                }
                case "xiahoudun_jing_ganglie": {
                    const candidates = state.generals.map((g, idx) => ({ g, idx })).filter(({ g }) => g.alive && g.faction !== targetGeneral.faction).map(({ idx }) => idx);
                    if (candidates.length === 0) return;
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.SKILL_GANGLIE_TARGET,
                        targetGeneralIndex: state.generals.indexOf(targetGeneral),
                        context: {
                            ganglieSourceIndex: state.generals.indexOf(targetGeneral),
                            candidateIndices: candidates,
                            description: "选择一名敌方角色判定，非♥则其弃2张手牌或受1点伤害"
                        }
                    });
                    addLog(state, `【${name}】发动【刚烈】，选择一名敌方角色判定`);
                    return;
                }
                case "pangde_mengjin": {
                    const mengjinCtx = ctx;
                    const mengjinTargetIdx = mengjinCtx.mengjinTargetIndex;
                    addLog(state, `【${name}】发动【猛进】，选择弃【${getGeneralName(state.generals[mengjinTargetIdx])}】的一张牌`);
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.TRICK_TARGET_CARD_PICK,
                        targetGeneralIndex: state.generals.indexOf(targetGeneral),
                        context: {
                            targetIndex: mengjinTargetIdx,
                            trickType: "dismantle"
                        }
                    });
                    return;
                }
                case "machao_tieqi": {
                    const tieqiCtx = ctx;
                    performSkillJudge(state, targetGeneral, "tieqi", "铁骑", {
                        tieqiTargetIndex: tieqiCtx.tieqiTargetIndex,
                        attackCardId: tieqiCtx.attackCardId
                    });
                    return;
                }
                case "machao_jie_tieqi": {
                    const tieqiCtx = ctx;
                    performSkillJudge(state, targetGeneral, "tieqi_jie", "铁骑", {
                        tieqiTargetIndex: tieqiCtx.tieqiTargetIndex,
                        attackCardId: tieqiCtx.attackCardId
                    });
                    return;
                }
                case "wangyi_zhenlie":
                case "wangyi_jie_zhenlie": {
                    const zlCtx = ctx;
                    const zlJie = ctx.skillId === "wangyi_jie_zhenlie";
                    loseHp(state, targetGeneral, 1);
                    const source = zlCtx.attackerIndex >= 0 ? state.generals[zlCtx.attackerIndex] : undefined;
                    const discarded = !zlJie && source?.alive ? discardOneCardOf(state, source) : undefined;
                    const zlTail = zlJie ? "" : discarded ? `，弃置【${getGeneralName(source!)}】一张牌` : "";
                    if (zlCtx.zhenlieEffect) {
                        const eff = zlCtx.zhenlieEffect;
                        eff.extra = { ...eff.extra ?? {}, zhenlieCancelled: true };
                        addLog(state, `【${name}】发动【贞烈】，令【${ZHENLIE_TRICK_NAMES[eff.type] ?? "锦囊"}】对其无效${zlTail}`);
                    } else if (zlCtx.zhenlieAoe) {
                        addLog(state, `【${name}】发动【贞烈】，令【${zlCtx.zhenlieAoe.cardName}】对其无效${zlTail}`);
                    } else {
                        const dodgeIdx = state.pendingResponseQueue.findIndex(
                            (p) => p.type === ResponseType.DODGE && p.targetGeneralIndex === state.generals.indexOf(targetGeneral)
                        );
                        if (dodgeIdx >= 0) state.pendingResponseQueue.splice(dodgeIdx, 1);
                        addLog(state, discarded ? `【${name}】发动【贞烈】，弃置【${getGeneralName(source!)}】一张牌` : `【${name}】发动【贞烈】，令此【杀】无效`);
                    }
                    if (zlJie) {
                        const zlOptions = [];
                        const canGain = !!source?.alive && (source.hand.length > 0 || Object.values(source.equip).some(Boolean));
                        if (canGain) zlOptions.push({ action: "gain", label: `获得【${getGeneralName(source)}】一张牌` });
                        zlOptions.push({ action: "miji", label: "于本回合的结束阶段发动一次“秘计”" });
                        state.pendingResponseQueue.unshift({
                            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                            targetGeneralIndex: state.generals.indexOf(targetGeneral),
                            context: {
                                skillId: "wangyi_jie_zhenlie_choice",
                                skillName: "贞烈",
                                description: "令此牌对你无效，然后选择一项",
                                options: zlOptions,
                                zhenlieSourceIndex: zlCtx.attackerIndex
                            }
                        });
                    }
                    return;
                }
                case "wangyi_miji": {
                    const x = Math.max(0, ctx.mijiDraw ?? targetGeneral.maxHp - targetGeneral.hp);
                    const drawn = drawCards(state, x);
                    targetGeneral.hand.push(...drawn);
                    addLog(state, `【${name}】发动【秘计】，摸了 ${drawn.length} 张牌`);
                    const candidates = state.generals.map((g, idx) => ({ g, idx })).filter(({ g }) => g.alive && g !== targetGeneral).map(({ idx }) => idx);
                    if (drawn.length > 0 && candidates.length > 0) {
                        state.pendingResponseQueue.unshift({
                            type: ResponseType.SKILL_MIJI_GIVE,
                            targetGeneralIndex: state.generals.indexOf(targetGeneral),
                            context: {
                                phase: "target",
                                count: drawn.length,
                                candidateIndices: candidates
                            }
                        });
                        addLog(state, `【${name}】选择交给手牌的对象`);
                    } else {
                        advanceTurnGuarded(state);
                    }
                    return;
                }
                case "wangji_qizhi": {
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.SKILL_QIZHI_TARGET,
                        targetGeneralIndex: state.generals.indexOf(targetGeneral),
                        context: {
                            candidateIndices: ctx.qizhiCandidates ?? [],
                            description: "选择弃置一名非目标角色的一张牌"
                        }
                    });
                    return;
                }
                case "wangji_jinqu": {
                    const qizhiCount = Math.max(0, ctx.jinjuQizhi ?? 0);
                    const drawn = drawCards(state, 2);
                    targetGeneral.hand.push(...drawn);
                    addLog(state, `【${name}】发动【进趋】摸了 ${drawn.length} 张牌`);
                    const overflow = targetGeneral.hand.length - qizhiCount;
                    if (overflow > 0) {
                        state.pendingResponseQueue.unshift({
                            type: ResponseType.SKILL_JINQU_DISCARD,
                            targetGeneralIndex: state.generals.indexOf(targetGeneral),
                            context: {
                                discardCount: overflow,
                                qizhiTarget: qizhiCount
                            }
                        });
                        return;
                    }
                    advanceTurnGuarded(state);
                    return;
                }
                case "luxun_jie_lianying": {
                    const drawn = drawCards(state, 1);
                    targetGeneral.hand.push(...drawn);
                    addLog(state, `【${name}】发动【连营】，摸了 ${drawn.length} 张牌`);
                    if (ctx.lianyingDiscardPhase) finishTurn(state);
                    return;
                }
                // 谏计：目标决定是否使用刚摸到的牌
                case "huangquan_jianji": {
                    const jjCardId = ctx.jianjiCardId;
                    const jjCard = targetGeneral.hand.find((c) => c.id === jjCardId);
                    if (!jjCard) return;
                    if (ctx.jianjiCanSlash) {
                        const jjSelfIdx = state.generals.indexOf(targetGeneral);
                        const candidates = state.generals.map((g, i) => ({ g, i })).filter(({ g, i }) => g.alive && i !== jjSelfIdx && getAttackRange(targetGeneral, g, state.generals).inRange).map(({ i }) => i);
                        if (candidates.length > 0) {
                            state.pendingResponseQueue.unshift({
                                type: ResponseType.SKILL_CHOOSE_TARGET,
                                targetGeneralIndex: jjSelfIdx,
                                context: {
                                    skillId: "huangquan_jianji",
                                    skillName: "谏计",
                                    candidateIndices: candidates,
                                    jianjiCardId: jjCard.id
                                }
                            });
                            return;
                        }
                    }
                    if (tryFreeUse(state, targetGeneral, jjCard)) {
                        addLog(state, `【${getGeneralName(targetGeneral)}】使用${cardFullName(jjCard)}（谏计）`);
                    }
                    return;
                }
                case "xuchu_luoyi": {
                    const revealed = state.deck.splice(0, Math.min(3, state.deck.length));
                    const gained = revealed.filter(
                        (c) => c.category === CardCategory.BASIC || c.category === CardCategory.EQUIPMENT && c.equipSlot === EquipSlot.WEAPON || c.name === TrickCardName.DUEL
                    );
                    const rest = revealed.filter((c) => !gained.includes(c));
                    targetGeneral.hand.push(...gained);
                    state.discard.push(...rest);
                    targetGeneral.luoyiActive = true;
                    addLog(state, `【${name}】发动【裸衣】，亮出${revealed.map((c) => cardFullName(c)).join("、")}，获得其中 ${gained.length} 张牌，本回合【杀】和【决斗】伤害+1`);
                    rememberCards(state, state.generals.indexOf(targetGeneral), gained, "裸衣");
                    const tm = state.generals[state.activeGeneralIndex];
                    if (tm) beginActionPhase(state, tm);
                    return;
                }
                case "sunshangxiang_xiaoji":
                case "sunshangxiang_jie_xiaoji": {
                    const drawn = drawCards(state, 2);
                    targetGeneral.hand.push(...drawn);
                    addLog(state, `【${name}】发动【枭姬】摸 ${drawn.length} 张牌`);
                    return;
                }
                case "taishici_hanzhan": {
                    const pin = state.pindian;
                    if (!pin) return;
                    const pinOpp = state.generals[pin.opponentIndex];
                    pin.extra = { ...pin.extra ?? {}, hanzhanAsked: true, hanzhanRandom: true };
                    addLog(state, `【${name}】发动【酣战】，令【${pinOpp ? getGeneralName(pinOpp) : "对方"}】改为用随机的一张手牌拼点`);
                    if (pinOpp) pushPindianInitiatorPick(state, targetGeneral, pinOpp, pin.skillName);
                    return;
                }
                case "taishici_hanzhan_gain": {
                    const hzId = ctx.hanzhanCardId;
                    const hzIdx = state.discard.findIndex((c) => c.id === hzId);
                    if (hzIdx >= 0) {
                        const hzCard = state.discard.splice(hzIdx, 1)[0];
                        targetGeneral.hand.push(hzCard);
                        addLog(state, `【${name}】发动【酣战】，获得${cardFullName(hzCard)}`);
                    }
                    return;
                }
                case "zhangfei_tishen": {
                    const tsRecover = Math.max(0, ctx.tishenRecover ?? targetGeneral.maxHp - targetGeneral.hp);
                    targetGeneral.usedLimitedSkills.push("zhangfei_tishen");
                    targetGeneral.hp = targetGeneral.maxHp;
                    const tsDrawn = drawForGeneral(state, targetGeneral, tsRecover);
                    targetGeneral.hand.push(...tsDrawn);
                    addLog(state, `【${name}】发动【替身】，体力回复至 ${targetGeneral.hp}/${targetGeneral.maxHp}，摸${tsDrawn.length}张牌`);
                    triggerDianhuRecover(state, targetGeneral);
                    continueFromPrepPhase(state);
                    return;
                }
                case "dengai_tuntian": {
                    resolveTuntian(state, targetGeneral);
                    return;
                }
                case "sunqian_shuomeng": {
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.SKILL_SHUOMENG_TARGET,
                        targetGeneralIndex: state.generals.indexOf(targetGeneral),
                        context: {
                            candidateIndices: ctx.shuomengCandidates ?? [],
                            description: "选择一名角色拼点"
                        }
                    });
                    return;
                }
                case "sp_sunshangxiang_liangzhu": {
                    const healerIdx = ctx.healerIndex;
                    const healer = state.generals[healerIdx];
                    if (healer) {
                        targetGeneral.liangzhuHelped = [...targetGeneral.liangzhuHelped ?? [], healer.generalId];
                    }
                    if (action === "target" && healer) {
                        const drawn = drawCards(state, 2);
                        healer.hand.push(...drawn);
                        addLog(state, `【${name}】发动【良助】，令【${getGeneralName(healer)}】摸 ${drawn.length} 张牌`);
                    } else {
                        const drawn = drawCards(state, 1);
                        targetGeneral.hand.push(...drawn);
                        addLog(state, `【${name}】发动【良助】，摸了 ${drawn.length} 张牌`);
                    }
                    return;
                }
                case "luxun_jie_qianxun": {
                    const count = targetGeneral.hand.length;
                    (targetGeneral.generalPile ??= []).push(...targetGeneral.hand);
                    targetGeneral.hand = [];
                    targetGeneral.qianxunPileTurn = state.activeGeneralIndex;
                    triggerLiangyin(state, "out");
                    addLog(state, `【${name}】发动【谦逊】，将 ${count} 张手牌置于武将牌上`);
                    return;
                }
                case "sunqian_qianya": {
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.SKILL_CHOOSE_TARGET,
                        targetGeneralIndex: state.generals.indexOf(targetGeneral),
                        context: {
                            skillId: "sunqian_qianya",
                            skillName: "谦雅",
                            description: "选择一名其他角色，将任意张手牌交给其",
                            candidateIndices: ctx.candidateIndices ?? []
                        }
                    });
                    return;
                }
                case "lidian_wangxi": {
                    const otherIdx = ctx.otherIndex;
                    const other = state.generals[otherIdx];
                    const drawn = drawCards(state, 2);
                    targetGeneral.hand.push(...drawn);
                    addLog(state, `【${name}】发动【忘隙】，摸了 ${drawn.length} 张牌`);
                    if (other?.alive && targetGeneral.hand.length > 0) {
                        state.pendingResponseQueue.unshift({
                            type: ResponseType.SKILL_GIVE_CARDS,
                            targetGeneralIndex: state.generals.indexOf(targetGeneral),
                            context: { skillId: "lidian_wangxi", skillName: "忘隙", toIndex: otherIdx, count: 1 }
                        });
                    }
                    return;
                }
                case "xunyou_zhiyu": {
                    const drawn = drawCards(state, 1);
                    targetGeneral.hand.push(...drawn);
                    const reds = targetGeneral.hand.filter((c) => c.suit === CardSuit.HEART || c.suit === CardSuit.DIAMOND).length;
                    const allSame = targetGeneral.hand.length > 0 && (reds === targetGeneral.hand.length || reds === 0);
                    const atkIdx = ctx.attackerIndex;
                    const atk = atkIdx >= 0 ? state.generals[atkIdx] : undefined;
                    addLog(state, `【${name}】发动【智愚】，摸 ${drawn.length} 张牌并展示手牌`);
                    rememberCards(state, state.generals.indexOf(targetGeneral), targetGeneral.hand, "智愚");
                    if (atk?.alive && atk !== targetGeneral && atk.hand.length > 0) {
                        state.pendingResponseQueue.unshift({
                            type: ResponseType.SKILL_PICK_CARD,
                            targetGeneralIndex: atkIdx,
                            context: {
                                skillId: "xunyou_zhiyu",
                                skillName: "智愚",
                                mode: "discard",
                                count: 1,
                                description: "智愚：弃置一张手牌",
                                zhiyuAllSame: allSame,
                                zhiyuOwnerIndex: state.generals.indexOf(targetGeneral)
                            }
                        });
                    }
                    return;
                }
                case "litong_tuifeng": {
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.SKILL_PICK_CARD,
                        targetGeneralIndex: state.generals.indexOf(targetGeneral),
                        context: {
                            skillId: "litong_tuifeng",
                            skillName: "推锋",
                            mode: "pile",
                            count: 1,
                            description: "选择一张牌置于武将牌上（锋）"
                        }
                    });
                    return;
                }
                case "yanyan_juzhan": {
                    const jzPhase = ctx.juzhanPhase;
                    const slashTargetIdx = ctx.slashTargetIndex;
                    const slashSourceIdx = ctx.slashSourceIndex;
                    if (jzPhase === "yin") {
                        targetGeneral.juzhanYang = true;
                        targetGeneral.forbiddenTargetIndex = slashTargetIdx;
                        targetGeneral.forbiddenTargetTurn = slashSourceIdx;
                        const victim = state.generals[slashTargetIdx];
                        if (victim?.alive && (victim.hand.length > 0 || Object.values(victim.equip).some(Boolean))) {
                            state.pendingResponseQueue.unshift({
                                type: ResponseType.TRICK_TARGET_CARD_PICK,
                                targetGeneralIndex: state.generals.indexOf(targetGeneral),
                                context: {
                                    trickType: "steal",
                                    targetIndex: slashTargetIdx,
                                    label: "拒战"
                                }
                            });
                        }
                        addLog(state, `【${name}】发动【拒战】（阴）`);
                    } else {
                        targetGeneral.juzhanYang = false;
                        targetGeneral.forbiddenTargetIndex = slashSourceIdx;
                        targetGeneral.forbiddenTargetTurn = slashTargetIdx;
                        const d1 = drawCards(state, 1);
                        targetGeneral.hand.push(...d1);
                        const src = state.generals[slashSourceIdx];
                        if (src?.alive) {
                            const d2 = drawCards(state, 1);
                            src.hand.push(...d2);
                        }
                        addLog(state, `【${name}】发动【拒战】（阳），与其各摸一张牌`);
                    }
                    return;
                }
                case "ganning_jie_fenwei": {
                    targetGeneral.usedLimitedSkills.push("ganning_jie_fenwei");
                    const protectedIdx = ctx.fenweiProtected ?? [];
                    const fenweiTrick = ctx.fenweiTrickName;
                    if (fenweiTrick === TrickCardName.IRON_CHAIN) {
                        const deferred = (state.negateWindow as any)?.deferredEffect;
                        if (deferred && deferred.type === "iron_chain") {
                            const idxs = deferred.extra?.targetIndices ?? [];
                            deferred.extra = { ...deferred.extra ?? {}, targetIndices: idxs.filter((i: any) => !protectedIdx.includes(i)) };
                        } else {
                            for (const idx of protectedIdx) {
                                const g = state.generals[idx];
                                if (g?.alive) g.chained = !g.chained;
                            }
                        }
                    } else {
                        const fenweiCardId = ctx.fenweiCardId;
                        for (let i = state.pendingResponseQueue.length - 1; i >= 0; i--) {
                            const p = state.pendingResponseQueue[i];
                            const pc = p.context;
                            if (pc?.sourceCardId === fenweiCardId && protectedIdx.includes(p.targetGeneralIndex)) {
                                state.pendingResponseQueue.splice(i, 1);
                            }
                        }
                    }
                    addLog(state, `【${name}】发动【奋威】，令 ${protectedIdx.length} 名己方角色不受该锦囊影响`);
                    return;
                }
                case "xuyou_shicai": {
                    const shicaiId = ctx.shicaiCardId;
                    const shicaiIdx = state.discard.findIndex((c) => c.id === shicaiId);
                    if (shicaiIdx >= 0) {
                        const shicaiCard = state.discard.splice(shicaiIdx, 1)[0];
                        state.deck.unshift(shicaiCard);
                        addLog(state, `【${name}】发动【恃才】，将${cardFullName(shicaiCard)}置于牌堆顶`);
                    }
                    const shicaiDrawn = drawForGeneral(state, targetGeneral, 1);
                    targetGeneral.hand.push(...shicaiDrawn);
                    addLog(state, `【${name}】【恃才】摸了${shicaiDrawn.length}张牌`);
                    return;
                }
                case "guotu_jigong": {
                    const jgDrawn = drawForGeneral(state, targetGeneral, 2);
                    targetGeneral.hand.push(...jgDrawn);
                    targetGeneral.jigongActive = true;
                    addLog(state, `【${name}】发动【急攻】，摸${jgDrawn.length}张牌，本回合手牌上限等于本阶段造成的伤害`);
                    return;
                }
                case "luji_zhenglun": {
                    targetGeneral.orangeMarks = (targetGeneral.orangeMarks ?? 0) + 1;
                    addLog(state, `【${name}】发动【整论】，跳过摸牌阶段并获得1个“橘”（共${targetGeneral.orangeMarks}个）`);
                    beginActionPhase(state, targetGeneral);
                    return;
                }
                case "fazheng_xuanhuo": {
                    const xhCandidates = state.generals.map((g, i) => ({ g, i })).filter(({ g, i }) => g.alive && i !== state.generals.indexOf(targetGeneral)).map(({ i }) => i);
                    if (xhCandidates.length === 0) {
                        beginActionPhase(state, targetGeneral);
                        return;
                    }
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.SKILL_CHOOSE_TARGET,
                        targetGeneralIndex: state.generals.indexOf(targetGeneral),
                        context: {
                            skillId: "fazheng_xuanhuo_drawer",
                            skillName: "眩惑",
                            description: "选择一名其他角色，令其摸两张牌",
                            candidateIndices: xhCandidates
                        }
                    });
                    return;
                }
                case "xiahoushi_qiaoshi": {
                    const qsPartner = state.generals[ctx.qiaoshiPartnerIndex];
                    const qsFirst = drawForGeneral(state, targetGeneral, 1);
                    targetGeneral.hand.push(...qsFirst);
                    if (qsPartner?.alive) {
                        const qsSecond = drawForGeneral(state, qsPartner, 1);
                        qsPartner.hand.push(...qsSecond);
                    }
                    addLog(state, `【${name}】发动【樵拾】，其与【${qsPartner ? getGeneralName(qsPartner) : "对方"}】各摸一张牌`);
                    return;
                }
                case "masu_zhiman": {
                    const zhimanVictimIdx = ctx.zhimanTargetIndex;
                    const zhimanVictim = state.generals[zhimanVictimIdx];
                    if (zhimanVictim?.alive && hasCardInArea(zhimanVictim)) {
                        addLog(state, `【${name}】发动【制蛮】，防止伤害并获得其一张牌`);
                        state.pendingResponseQueue.unshift({
                            type: ResponseType.TRICK_TARGET_CARD_PICK,
                            targetGeneralIndex: state.generals.indexOf(targetGeneral),
                            context: {
                                trickType: "steal",
                                targetIndex: zhimanVictimIdx,
                                label: "制蛮"
                            }
                        });
                    }
                    return;
                }
                case "caifuren_qieting": {
                    const drawn = drawCards(state, 1);
                    targetGeneral.hand.push(...drawn);
                    addLog(state, `【${name}】发动【窃听】摸 ${drawn.length} 张牌`);
                    return;
                }
                case "jushou_jianying": {
                    const drawn = drawCards(state, 1);
                    targetGeneral.hand.push(...drawn);
                    addLog(state, `【${name}】发动【渐营】摸 ${drawn.length} 张牌`);
                    return;
                }
                case "guanqiujian_hongju": {
                    const hjPile = targetGeneral.generalPile?.length ?? 0;
                    if (targetGeneral.hand.length === 0 || hjPile === 0) {
                        finishHongju(state, targetGeneral, []);
                        return;
                    }
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.SKILL_PICK_CARD,
                        targetGeneralIndex: state.generals.indexOf(targetGeneral),
                        context: {
                            skillId: "guanqiujian_hongju",
                            skillName: "鸿举",
                            mode: "discard",
                            count: Math.min(targetGeneral.hand.length, hjPile),
                            description: "选择任意张手牌替换等量“荣”（不选则直接觉醒）"
                        }
                    });
                    return;
                }
                case "yuejin_xiaoguo": {
                    if (ctx.xijueCost) {
                        if ((targetGeneral.jueMarks ?? 0) <= 0) {
                            addLog(state, `【${name}】没有“爵”，无法发动【骁果】`);
                            advanceTurnGuarded(state);
                            return;
                        }
                        targetGeneral.jueMarks = (targetGeneral.jueMarks ?? 0) - 1;
                        addLog(state, `【${name}】移去1个“爵”（剩${targetGeneral.jueMarks}个），发动【骁果】`);
                    }
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.SKILL_PICK_CARD,
                        targetGeneralIndex: state.generals.indexOf(targetGeneral),
                        context: {
                            skillId: "yuejin_xiaoguo",
                            skillName: "骁果",
                            mode: "discard",
                            count: 1,
                            candidateCardIds: ctx.candidateCardIds,
                            xiaoguoTargetIndex: ctx.xiaoguoTargetIndex,
                            description: "选择一张基本牌弃置"
                        }
                    });
                    return;
                }
                case "diaochan_biyue": {
                    const drawn = drawCards(state, 1);
                    targetGeneral.hand.push(...drawn);
                    if ((ctx.biyueCount as number) === 2 && targetGeneral.alive) {
                        const biyueExtra = drawCards(state, 1)
                        targetGeneral.hand.push(...biyueExtra)
                        addLog(state, `【${name}】【闭月】没有手牌，额外摸 ${biyueExtra.length} 张牌`)
                    }
                    addLog(state, `【${name}】发动【闭月】摸 ${drawn.length} 张牌`);
                    advanceTurnGuarded(state);
                    return;
                }
                case "zumao_yinbing": {
                    const maxCards = Math.max(1, ctx.yinbingMax ?? 1);
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.SKILL_PICK_CARD,
                        targetGeneralIndex: state.generals.indexOf(targetGeneral),
                        context: {
                            skillId: "zumao_yinbing",
                            skillName: "引兵",
                            mode: "pile",
                            count: maxCards,
                            endPhase: true,
                            description: `选择至多 ${maxCards} 张非基本牌置于武将牌上`
                        }
                    });
                    return;
                }
                case "madai_qianxi": {
                    addLog(state, `【${name}】发动【潜袭】，展示一张手牌`);
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.SKILL_QIANXI_PICK,
                        targetGeneralIndex: state.generals.indexOf(targetGeneral),
                        context: {
                            qianxiUserIndex: state.generals.indexOf(targetGeneral),
                            candidateCardIds: targetGeneral.hand.map((c) => c.id),
                        }
                    });
                    return;
                }
                case "lidian_xunxun": {
                    const top = state.deck.splice(0, Math.min(4, state.deck.length));
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.SKILL_GUANXING_ARRANGE,
                        targetGeneralIndex: state.generals.indexOf(targetGeneral),
                        context: {
                            guanxingCards: top,
                            mode: "xunxun",
                            skipAction: ctx.skipAction
                        }
                    });
                    addLog(state, `【${name}】发动【恂恂】，观看牌堆顶 ${top.length} 张牌`);
                    return;
                }
                case "lingtong_xuanfeng": {
                    const candidates = ctx.xuanfengCandidates ?? [];
                    if (candidates.length === 0) {
                        if (ctx.xuanfengDiscardPhase && state.pendingResponseQueue.length === 0) finishTurn(state);
                        return;
                    }
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.SKILL_CHOOSE_TARGET,
                        targetGeneralIndex: state.generals.indexOf(targetGeneral),
                        context: {
                            skillId: "lingtong_xuanfeng",
                            skillName: "旋风",
                            description: "选择一名其他角色弃置其一张牌",
                            candidateIndices: candidates,
                            remaining: 2,
                            xuanfengDiscardPhase: ctx.xuanfengDiscardPhase
                        }
                    });
                    return;
                }
                case "wangping_feijun_option": {
                    const fjCtx = ctx;
                    const fjUser = state.generals[fjCtx.feijunUserIndex];
                    const fjTarget = state.generals[fjCtx.feijunTargetIndex];
                    applyFeijun(state, fjUser, fjTarget, data.action === "equip" ? "equip" : "give");
                    return;
                }
                case "pangde_jianchu": {
                    const jcCtx = ctx;
                    const jcTargetIdx = jcCtx.jianchuTargetIndex;
                    const jcTarget = state.generals[jcTargetIdx];
                    if (!jcTarget?.alive) return;
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.TRICK_TARGET_CARD_PICK,
                        targetGeneralIndex: state.generals.indexOf(targetGeneral),
                        context: {
                            targetIndex: jcTargetIdx,
                            trickType: "dismantle",
                            label: "鞬出",
                            jianchuUserIndex: state.generals.indexOf(targetGeneral),
                            attackCardId: jcCtx.attackCardId,
                            attackCard: jcCtx.attackCard
                        }
                    });
                    addLog(state, `【${name}】发动【鞬出】，选择弃置【${getGeneralName(jcTarget)}】的一张牌`);
                    return;
                }
                case "wangping_feijun": {
                    const fjCtx = ctx;
                    const fjUser = state.generals[fjCtx.feijunUserIndex];
                    const slot = (["weapon", "armor", "plus_horse", "minus_horse"] as const).find((s) => targetGeneral.equip[s]);
                    if (slot) {
                        const card2 = targetGeneral.equip[slot]!;
                        clearEquipSlot(state, targetGeneral, slot);
                        fjUser.hand.push(card2);
                        triggerXiaoji(state, targetGeneral);
                        addLog(state, `【${getGeneralName(targetGeneral)}】将装备牌交给【${getGeneralName(fjUser)}】（飞军）`);
                    } else {
                        const drawn = drawCards(state, 2);
                        fjUser.hand.push(...drawn);
                        addLog(state, `【${getGeneralName(targetGeneral)}】选择令【${getGeneralName(fjUser)}】摸两张牌（飞军）`);
                    }
                    if (fjUser && hasSkill(fjUser, "wangping_binglue") && !(fjUser.feijunTargets ?? []).includes(state.generals.indexOf(targetGeneral))) {
                        fjUser.feijunTargets = [...fjUser.feijunTargets ?? [], state.generals.indexOf(targetGeneral)];
                        const bonus = drawCards(state, 2);
                        fjUser.hand.push(...bonus);
                        addLog(state, `【${getGeneralName(fjUser)}】发动【兵略】，摸两张牌`);
                    }
                    return;
                }
                case "huangquan_quanjian": {
                    const qjCtx = ctx;
                    const qjUser = state.generals[qjCtx.quanjianUserIndex];
                    if (targetGeneral.hand.length > 0 || Object.values(targetGeneral.equip).some(Boolean)) {
                        const slot = (["weapon", "armor", "plus_horse", "minus_horse"] as const).find((s) => targetGeneral.equip[s]);
                        if (slot) {
                            const card2 = targetGeneral.equip[slot]!;
                            clearEquipSlot(state, targetGeneral, slot);
                            qjUser.hand.push(card2);
                            triggerXiaoji(state, targetGeneral);
                        } else {
                            qjUser.hand.push(targetGeneral.hand.splice(randomInt(targetGeneral.hand.length), 1)[0]);
                        }
                        addLog(state, `【${getGeneralName(targetGeneral)}】交给【${getGeneralName(qjUser)}】一张牌（劝谏）`);
                    }
                    return;
                }
                case "caifuren_xianzhou": {
                    const xzCtx = ctx;
                    const xzUser = state.generals[xzCtx.xianzhouUserIndex];
                    const x = xzCtx.xianzhouCount;
                    if (xzUser) {
                        xzUser.hp = Math.min(xzUser.hp + x, xzUser.maxHp);
                        addLog(state, `【${name}】选择令【${getGeneralName(xzUser)}】回复 ${x} 点体力（献州）`);
                        triggerDianhuRecover(state, xzUser);
                    }
                    return;
                }
                case "yuejin_xiaoguo_apply": {
                    const xgCtx = ctx;
                    const src = state.generals[xgCtx.xiaoguoSourceIndex];
                    const tgt = state.generals[xgCtx.xiaoguoTargetIndex];
                    if (tgt?.alive) dealDamage(state, src ?? null, tgt, 1);
                    return;
                }
                case "chengong_mingce": {
                    const mingceCtx = ctx;
                    const slashTargetIdx = mingceCtx.mingceSlashTargetIndex;
                    const slashTarget = slashTargetIdx >= 0 ? state.generals[slashTargetIdx] : undefined;
                    const canSlash = action === "mingce_slash" && !!slashTarget?.alive && !isZhichiImmune(state, slashTarget);
                    const mingceOwner = state.generals[mingceCtx.mingceFromIndex as number];
                    // 明策②（界陈宫）：造成伤害后陈宫与受牌者各摸一张
                    const mingceJieOwnerIndex = mingceOwner?.generalId === 'chengong_jie'
                        ? (mingceCtx.mingceFromIndex as number) : -1;
                    if (canSlash && slashTarget) {
                        addLog(state, `【${name}】选择视为对【${getGeneralName(slashTarget)}】使用一张【杀】（明策）`);
                        state.pendingResponseQueue.unshift({
                            type: ResponseType.DODGE,
                            targetGeneralIndex: slashTargetIdx,
                            context: {
                                attackerGeneralIndex: state.generals.indexOf(targetGeneral),
                                requiredDodges: hasSkill(targetGeneral, "lvbu_wushuang") ? 2 : 1,
                                dodgesReceived: 0,
                                mingceJieOwnerIndex
                            }
                        });
                        return;
                    }
                    const mingceDrawn = drawCards(state, 1);
                    targetGeneral.hand.push(...mingceDrawn);
                    if (mingceJieOwnerIndex >= 0 && mingceOwner?.alive) {
                        const mingceOwnerDrawn = drawCards(state, 1);
                        mingceOwner.hand.push(...mingceOwnerDrawn);
                        addLog(state, `【${name}】选择摸牌（明策），【${getGeneralName(mingceOwner)}】与其各摸一张牌`);
                        return;
                    }
                    addLog(state, `【${name}】选择摸 ${mingceDrawn.length} 张牌（明策）`);
                    return;
                }
                case "fuwan_moukui": {
                    resolveMoukui(state, targetGeneral, ctx, action ?? '');
                    return;
                }
                case 'zhenji_luoshen_continue': {
                    // 洛神继续判定
                    const interrupted = performSkillJudge(state, targetGeneral, 'luoshen', '洛神', {})
                    if (!interrupted) {
                        // 判定直接结算（无介入），需要推进回合
                        continueFromPrepPhase(state)
                    }
                    return
                }
                case 'zhangliao_tuxi': {
                    // 袭爵（张虎乐綝）：移去1个“爵”发动
                    if ((ctx as any).xijueCost) {
                        if ((targetGeneral.jueMarks ?? 0) <= 0) {
                            addLog(state, `【${name}】没有“爵”，无法发动【突袭】`)
                            let xjDraw = 2
                            if (hasSkill(targetGeneral, 'zhouyu_yingzi') || hasSkill(targetGeneral, 'zhouyu_jie_yingzi') || hasSkill(targetGeneral, 'sunce_yingzi')) xjDraw = 3
                            const xjDrawn = drawCards(state, xjDraw)
                            targetGeneral.hand.push(...xjDrawn)
                            addLog(state, `【${getGeneralName(targetGeneral)}】摸了 ${xjDrawn.length} 张牌`)
                            if ((ctx as any).skipAction) {
                                state.turnPhase = TurnPhase.DISCARD
                                if (targetGeneral.hand.length <= targetGeneral.hp) finishTurn(state)
                            } else {
                                state.turnPhase = TurnPhase.ACTION
                                addLog(state, `【${getGeneralName(targetGeneral)}】进入出牌阶段`)
                            }
                            return
                        }
                        targetGeneral.jueMarks = (targetGeneral.jueMarks ?? 0) - 1
                        addLog(state, `【${name}】移去1个“爵”（剩${targetGeneral.jueMarks}个），发动【突袭】`)
                    }
                    // 发动时已选好目标：直接结算，不再二次询问
                    const tuxiDirect = (data as any).targetIndices as number[] | undefined
                    if (Array.isArray(tuxiDirect) && tuxiDirect.length > 0) {
                        const tuxiUnique = [...new Set(tuxiDirect)]
                        if (tuxiUnique.length !== tuxiDirect.length) return { error: '不能选择相同的角色' }
                        if (tuxiUnique.length > 2) return { error: '最多选择2名角色' }
                        const tuxiSelfIdx = state.generals.indexOf(targetGeneral)
                        for (const tIdx of tuxiUnique) {
                            const victim = state.generals[tIdx]
                            if (!victim?.alive || victim.hand.length === 0) return { error: `【${getGeneralName(victim)}】没有手牌` }
                            if (tIdx === tuxiSelfIdx) return { error: '不能选自己' }
                        }
                        for (const tIdx of tuxiUnique) {
                            const victim = state.generals[tIdx]
                            const randIdx = randomInt(victim.hand.length)
                            targetGeneral.hand.push(victim.hand.splice(randIdx, 1)[0])
                            addLog(state, `【${getGeneralName(targetGeneral)}】发动【突袭】，获取了【${getGeneralName(victim)}】的一张手牌`)
                        }
                        if (!(ctx as any).skipAction) {
                            const tuxiCount = targetGeneral.generalId === 'zhangliao' ? 0 : Math.max(0, 2 - tuxiUnique.length)
                            const tuxiDrawn = drawCards(state, tuxiCount)
                            targetGeneral.hand.push(...tuxiDrawn)
                            if (tuxiDrawn.length > 0) addLog(state, `【${getGeneralName(targetGeneral)}】【突袭】少摸${tuxiUnique.length}张，补摸${tuxiDrawn.length}张`)
                        }
                        if ((ctx as any).skipAction) {
                            state.turnPhase = TurnPhase.DISCARD
                            if (targetGeneral.hand.length <= targetGeneral.hp) finishTurn(state)
                        } else {
                            state.turnPhase = TurnPhase.ACTION
                            addLog(state, `【${getGeneralName(targetGeneral)}】进入出牌阶段`)
                        }
                        return
                    }
                    // 突袭确认：推选目标响应
                    addLog(state, `【${name}】发动【突袭】，选择至多2名有手牌的角色获取手牌`)
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.SKILL_TUXI_CHOOSE,
                        targetGeneralIndex: state.generals.indexOf(targetGeneral),
                        context: { remainingPicks: 2, skipAction: (ctx as any).skipAction },
                    })
                    return
                }
                case 'zhugejin_hongyuan': {
                    // 弘援确认：自己少摸一张（只摸 1 张），令至多两名其他己方角色各摸一张
                    state.pendingResponseQueue.shift()
                    const allies = state.generals
                        .filter(g => g.alive && g.faction === targetGeneral.faction && g !== targetGeneral)
                        .slice(0, 2)
                    const own = drawCards(state, 1)
                    targetGeneral.hand.push(...own)
                    addLog(state, `【${name}】发动【弘援】，自己摸了 1 张牌`)
                    for (const ally of allies) {
                        const bonus = drawCards(state, 1)
                        ally.hand.push(...bonus)
                        addLog(state, `【${getGeneralName(ally)}】因【弘援】摸了 1 张牌`)
                    }
                    beginActionPhase(state, targetGeneral)
                    return
                }
                case 'simalang_junbing': {
                    // 郡兵：该角色摸一张，把所有手牌交给司马朗，司马朗再还给其等量的牌
                    state.pendingResponseQueue.shift()
                    const owner = state.generals[(ctx as any).junbingOwnerIndex as number]
                    const drawn = drawCards(state, 1)
                    targetGeneral.hand.push(...drawn)
                    const moved = [...targetGeneral.hand]
                    targetGeneral.hand = []
                    if (!owner || !owner.alive) {
                        targetGeneral.hand.push(...moved)
                        return
                    }
                    owner.hand.push(...moved)
                    // 司马朗挑出等量的牌还回去：友方给好牌，敌方给废牌
                    const value = (c: Card) => {
                        if (c.name === BasicCardName.PEACH) return 100
                        if (c.name === BasicCardName.DODGE) return 90
                        if (c.name === BasicCardName.ATTACK || c.name === BasicCardName.FIRE_SLASH || c.name === BasicCardName.THUNDER_SLASH) return 80
                        if (c.category === CardCategory.EQUIPMENT) return 60
                        return 70
                    }
                    const toAlly = owner.faction === targetGeneral.faction
                    const back = [...owner.hand]
                        .sort((a, b) => toAlly ? value(b) - value(a) : value(a) - value(b))
                        .slice(0, moved.length)
                    for (const card of back) {
                        const idx = owner.hand.indexOf(card)
                        if (idx >= 0) owner.hand.splice(idx, 1)
                    }
                    targetGeneral.hand.push(...back)
                    addLog(state, `【${getGeneralName(owner)}】发动【郡兵】，【${getGeneralName(targetGeneral)}】摸一张牌并交出其手牌，随后收回等量的牌`)
                    return
                }
                case 'jiangwei_zhiji_choice': {
                    // 志继：回血或摸牌二选一（不可放弃）
                    if (action === 'heal' || action === 'confirm') {
                        targetGeneral.hp = Math.min(targetGeneral.hp + 1, targetGeneral.maxHp)
                        addLog(state, `【${name}】选择回复1点体力（${targetGeneral.hp}/${targetGeneral.maxHp}）`)
                    } else {
                        const drawn = drawCards(state, 2)
                        targetGeneral.hand.push(...drawn)
                        addLog(state, `【${name}】选择摸2张牌`)
                    }
                    continueFromPrepPhase(state)
                    return
                }
                case 'daqiao_liuli': {
                    // 流离：弃1牌（手牌或装备），将杀转移给攻击范围内另一角色
                    const atkCtx = ctx as any
                    const attackerIdx = atkCtx.attackerIndex as number
                    const attacker = state.generals[attackerIdx]

                    if (!data.cardId) return { error: '请选择一张牌弃置' }
                    // 先找到要弃的牌，检查是否是武器
                    const cardToDiscard = findCardInHandOrEquip(targetGeneral, data.cardId)
                    if (!cardToDiscard) return { error: '找不到此牌' }

                    // 模拟弃牌后的攻击范围：如果弃的是武器，临时移除来计算
                    const isWeapon = targetGeneral.equip.weapon?.id === data.cardId
                    const savedWeapon = isWeapon ? targetGeneral.equip.weapon : undefined
                    if (isWeapon) targetGeneral.equip.weapon = undefined as any

                    // 计算可转移目标
                    const candidates = state.generals.filter(g =>
                        g.alive && g !== targetGeneral && g !== attacker &&
                        getAttackRange(targetGeneral, g, state.generals).inRange
                    )

                    // 恢复武器（还没决定是否弃）
                    if (isWeapon) targetGeneral.equip.weapon = savedWeapon

                    if (candidates.length === 0) {
                        return { error: '弃此牌后无法转移目标（攻击范围内无其他角色），请重新选择' }
                    }

                    // 确认弃牌
                    const result = removeCardFromHandOrEquip(state, targetGeneral, data.cardId)
                    if ('error' in result) return result

                    if (candidates.length === 1) {
                        const newTarget = candidates[0]
                        addLog(state, `【${name}】发动【流离】，将杀转移给【${getGeneralName(newTarget)}】`)
                        state.pendingResponseQueue.unshift({
                            type: ResponseType.DODGE,
                            targetGeneralIndex: state.generals.indexOf(newTarget),
                            context: {
                                attackerGeneralIndex: attackerIdx,
                                requiredDodges: atkCtx.requiredDodges || 1,
                                dodgesReceived: 0,
                                attackCard: atkCtx.attackCard,
                            },
                        })
                        // 流离转移后，检查雌雄双股剑（对新目标）
                        maybeDoubleSwords(state, attackerIdx, state.generals.indexOf(newTarget))
                    } else {
                        const candidateIndices = candidates.map(g => state.generals.indexOf(g))
                        state.pendingResponseQueue.unshift({
                            type: ResponseType.SKILL_LIULI_REDIRECT,
                            targetGeneralIndex: state.generals.indexOf(targetGeneral),
                            context: {
                                candidateIndices,
                                attackerIndex: attackerIdx,
                                requiredDodges: atkCtx.requiredDodges || 1,
                                attackCard: atkCtx.attackCard,
                            },
                        })
                        addLog(state, `【${name}】发动【流离】，请选择转移目标`)
                    }
                    return
                }
                case 'xiaoqiao_tianxiang': {
                    // 天香：弃1张♥手牌（红颜：♠也算♥），伤害转移给另一角色
                    const txCtx = ctx as any
                    const dmgAmount = txCtx.damageAmount as number || 1

                    // 红颜：♠视为♥，所以♥和♠手牌都可以弃
                    const isHeart = (c: Card) => {
                        if (c.suit === CardSuit.HEART) return true
                        if (c.suit === CardSuit.SPADE && hasSkill(targetGeneral, 'xiaoqiao_hongyan')) return true
                        return false
                    }

                    if (!data.cardId) return { error: '请选择一张♥手牌发动天香' }
                    let heartIdx = targetGeneral.hand.findIndex(c => c.id === data.cardId && isHeart(c))
                    if (heartIdx < 0) {
                        // 无♥牌可弃 → 正常受伤
                        const atkIdx = txCtx.attackerIndex as number
                        const atk = atkIdx >= 0 ? state.generals[atkIdx] : null
                        dealDamage(state, atk, targetGeneral, dmgAmount, txCtx.damageCardId, {
                            skipArmor: true,
                            skipTianxiang: true,
                        })
                        return
                    }
                    state.discard.push(targetGeneral.hand.splice(heartIdx, 1)[0])

                    // 让玩家选择转移目标
                    const others = state.generals.filter(g => g.alive && g !== targetGeneral)
                    if (others.length > 0) {
                        state.pendingResponseQueue.unshift({
                            type: ResponseType.SKILL_TIANXIANG_CHOOSE,
                            targetGeneralIndex: state.generals.indexOf(targetGeneral),
                            context: {
                                damageAmount: dmgAmount,
                                attackerIndex: txCtx.attackerIndex as number,
                                damageCardId: txCtx.damageCardId,
                            },
                        })
                        addLog(state, `【${name}】发动【天香】，请选择转移目标`)
                    }
                    return
                }
                case 'xiaoqiao_tianxiang_luoshu': {
                    // 天香（洛书版）：弃1张♥手牌防止伤害，然后选另一角色与其后续效果
                    const txCtx = ctx as any
                    const dmgAmount = (txCtx.damageAmount as number) || 1
                    const atkIdx = txCtx.attackerIndex as number
                    const atk = atkIdx >= 0 ? state.generals[atkIdx] : null
                    const isHeart = (c: Card) => c.suit === CardSuit.HEART
                        || (c.suit === CardSuit.SPADE && hasSkill(targetGeneral, 'xiaoqiao_hongyan'))
                    const heartIdx = data.cardId
                        ? targetGeneral.hand.findIndex(c => c.id === data.cardId && isHeart(c))
                        : -1
                    const others = state.generals.filter(g => g.alive && g !== targetGeneral)
                    if (heartIdx < 0 || others.length === 0) {
                        // 无合适手牌 / 无其他角色 → 正常受伤
                        dealDamage(state, atk, targetGeneral, dmgAmount, txCtx.damageCardId, {
                            skipArmor: true,
                            skipTianxiang: true,
                        })
                        return
                    }
                    const discarded = targetGeneral.hand.splice(heartIdx, 1)[0]
                    state.discard.push(discarded)
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.SKILL_TIANXIANG_CHOOSE,
                        targetGeneralIndex: state.generals.indexOf(targetGeneral),
                        context: {
                            variant: 'luoshu',
                            damageAmount: dmgAmount,
                            attackerIndex: atkIdx,
                            damageCardId: txCtx.damageCardId,
                            discardedCardId: discarded.id,
                        },
                    })
                    addLog(state, `【${name}】发动【天香】，请选择转移目标`)
                    return
                }
                case 'xiahoyuan_shensu_1': {
                    // 神速一：跳过判定+摸牌，让玩家选杀目标
                    addLog(state, `【${name}】发动【神速一】，跳过判定和摸牌阶段`)
                    continueTurnFromJudge(state, true, true, false)
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.SKILL_SHENSU_TARGET,
                        targetGeneralIndex: state.generals.indexOf(targetGeneral),
                        context: { shensuPhase: 1 },
                    })
                    return
                }
                case 'xiahoyuan_shensu_2': {
                    // 神速二：先选弃装备牌（已装备或手牌中的），再选杀目标
                    const equipSlots = [EquipSlot.WEAPON, EquipSlot.ARMOR, EquipSlot.PLUS_HORSE, EquipSlot.MINUS_HORSE] as const
                    const validSlots = equipSlots.filter(s => targetGeneral.equip[s] != null)
                    const handEquips = targetGeneral.hand.filter(c => c.category === CardCategory.EQUIPMENT)
                    if (validSlots.length === 0 && handEquips.length === 0) return { error: '没有装备牌可弃' }
                    addLog(state, `【${name}】发动【神速二】，选择弃一张装备牌`)
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.SKILL_SHENSU_EQUIP,
                        targetGeneralIndex: state.generals.indexOf(targetGeneral),
                        context: {},
                    })
                    return
                }
                case 'equip_green_dragon': {
                    // 青龙偃月刀追杀：玩家选择一张杀牌
                    const gdCtx = ctx as any
                    const killTargetIdx = gdCtx.targetIndex as number
                    const killTarget = state.generals[killTargetIdx]
                    if (!killTarget?.alive) return { error: '目标不存在' }

                    // 使用玩家选择的杀牌
                    if (!data.cardId) return { error: '请选择一张杀牌' }
                    const killIdx = targetGeneral.hand.findIndex(c => c.id === data.cardId)
                    if (killIdx < 0) return { error: '手牌中找不到此牌' }
                    const killCard = targetGeneral.hand[killIdx]
                    if (!isCardUsableAsAttack(targetGeneral, killCard)) return { error: '此牌不能当杀使用' }
                    targetGeneral.hand.splice(killIdx, 1)
                    state.discard.push(killCard)

                    addLog(state, `【${name}】发动【青龙偃月刀】对【${getGeneralName(killTarget)}】追杀`)
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.DODGE,
                        targetGeneralIndex: killTargetIdx,
                        context: {
                            attackerGeneralIndex: state.generals.indexOf(targetGeneral),
                            attackCard: killCard,
                            requiredDodges: 1,
                            dodgesReceived: 0,
                        },
                    })
                    return
                }
                case 'equip_ice_sword': {
                    // 寒冰剑：弃目标2张牌，不造成伤害 → 推交互选牌
                    const isCtx = ctx as any
                    const iceTarget = state.generals[isCtx.targetIndex as number]
                    if (!iceTarget) return { error: '目标不存在' }

                    state.pendingResponseQueue.unshift({
                        type: ResponseType.EQUIP_ICE_SWORD_PICK,
                        targetGeneralIndex: state.generals.indexOf(targetGeneral),
                        context: {
                            iceTargetIndex: isCtx.targetIndex as number,
                            remainingPicks: 2,
                        },
                    })
                    addLog(state, `【${name}】发动【寒冰剑】，请选择弃【${getGeneralName(iceTarget)}】的牌`)
                    return
                }
                case 'equip_stone_axe': {
                    // 贯石斧：弃2张牌（手牌或装备，不含贯石斧自身），使杀仍然命中
                    const saCtx = ctx as any
                    const saTarget = state.generals[saCtx.targetIndex as number]
                    if (!saTarget?.alive) return { error: '目标不存在' }

                    const cardIds = (data as any).cardIds as string[] | undefined
                    if (!cardIds || cardIds.length !== 2) return { error: '请选择2张牌弃置' }

                    // 不能弃贯石斧自身
                    const axeId = targetGeneral.equip.weapon?.id
                    if (cardIds.includes(axeId!)) return { error: '不能弃置正在使用的贯石斧' }

                    // 验证牌存在
                    for (const cid of cardIds) {
                        const card = findCardInHandOrEquip(targetGeneral, cid)
                        if (!card) return { error: '找不到选择的牌' }
                    }
                    // 逐张弃牌
                    for (const cid of cardIds) {
                        removeCardFromHandOrEquip(state, targetGeneral, cid)
                    }

                    const axeDiscarded = cardIds.map(cid => state.discard.find(c => c.id === cid)).filter(Boolean) as Card[]
                    addLog(state, `【${name}】发动【贯石斧】弃${axeDiscarded.map(c => cardFullName(c)).join('、')}，【杀】仍然命中`)

                    // 造成伤害
                    const killDamage = calcKillDamage(state, targetGeneral, saTarget)
                    dealDamage(state, targetGeneral, saTarget, killDamage, saCtx.attackCard?.id, slashDamageOpts(null, saCtx.attackCard))
                    return
                }
                case 'equip_double_swords': {
                    // 雌雄双股剑：令目标选择弃1牌或让攻击者摸1牌
                    const dsCtx = ctx as any
                    const dsTargetIdx = dsCtx.targetIndex as number
                    const dsTarget = state.generals[dsTargetIdx]
                    if (!dsTarget?.alive) return { error: '目标不存在' }

                    state.pendingResponseQueue.unshift({
                        type: ResponseType.EQUIP_DOUBLE_SWORDS_CHOICE,
                        targetGeneralIndex: dsTargetIdx,
                        context: {
                            attackerGeneralIndex: state.generals.indexOf(targetGeneral),
                        },
                    })
                    addLog(state, `【${name}】发动【雌雄双股剑】`)
                    return
                }
                case 'equip_kylin_bow': {
                    // 麒麟弓（两匹马）：推马的选择
                    const kbCtx = ctx as any
                    const kbTargetIdx = kbCtx.targetIndex as number
                    const kbTarget = state.generals[kbTargetIdx]
                    if (!kbTarget?.alive) {
                        // 目标已死，直接造伤
                        dealDamage(state, targetGeneral, kbTarget, kbCtx.killDamage ?? 1, kbCtx.attackCard?.id, slashDamageOpts(null, kbCtx.attackCard))
                        return
                    }
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.EQUIP_KYLIN_BOW_CHOICE,
                        targetGeneralIndex: state.generals.indexOf(targetGeneral),
                        context: {
                            targetIndex: kbTargetIdx,
                            killDamage: kbCtx.killDamage ?? 1,
                            attackCard: kbCtx.attackCard,
                        },
                    })
                    return
                }
                case 'equip_kylin_bow_auto': {
                    // 麒麟弓（只有一匹马）：自动弃那匹马
                    const kaCtx = ctx as any
                    const kaTargetIdx = kaCtx.targetIndex as number
                    const kaTarget = state.generals[kaTargetIdx]
                    if (!kaTarget?.alive) {
                        // 目标已经离场：没有马可弃，也不能再对他结算伤害
                        return
                    }
                    const horseType = kaCtx.horseType as 'plus' | 'minus'
                    const slot = horseType === 'plus' ? 'plus_horse' : 'minus_horse'
                    const horseCard = kaTarget.equip[slot as keyof typeof kaTarget.equip]
                    if (horseCard) {
                        clearEquipSlot(state, kaTarget, slot as keyof typeof kaTarget.equip)
                        state.discard.push(horseCard)
                        triggerXiaoji(state, kaTarget)
                        addLog(state, `【${name}】发动【麒麟弓】弃了【${getGeneralName(kaTarget)}】的坐骑`)
                    }
                    dealDamage(state, targetGeneral, kaTarget, kaCtx.killDamage ?? 1, kaCtx.attackCard?.id, slashDamageOpts(null, kaCtx.attackCard))
                    return
                }
                case 'kuailiang_jiandjiang': {
                    const poorest = [...state.generals].filter(g => g.alive)
                        .sort((a, b) => a.hand.length - b.hand.length)[0]
                    if (poorest) {
                        const drawn = drawCards(state, 1)
                        poorest.hand.push(...drawn)
                        addLog(state, `【${name}】发动【荐降】，【${getGeneralName(poorest)}】摸${drawn.length}张牌`)
                    }
                    return
                }
                case 'zhoufei_liangyin_out': {
                    const helper = state.generals[(ctx as any).liangyinHelperIndex as number]
                    if (helper?.alive) {
                        const drawn = drawCards(state, 1)
                        helper.hand.push(...drawn)
                        addLog(state, `【${name}】发动【良姻】，【${getGeneralName(helper)}】摸${drawn.length}张牌`)
                    }
                    targetGeneral.skillsUsedThisTurn.push('zhoufei_liangyin_out')
                    return
                }
                case 'zhoufei_liangyin_in': {
                    const victim = state.generals[(ctx as any).liangyinVictimIndex as number]
                    const vCard = victim ? discardRandomHandCardOf(state, targetGeneral, victim) : undefined
                    if (vCard) addLog(state, `【${name}】发动【良姻】，【${getGeneralName(victim)}】弃置${cardFullName(vCard)}`)
                    targetGeneral.skillsUsedThisTurn.push('zhoufei_liangyin_in')
                    return
                }
                case 'xiahoudun_qingjian': {
                    const cid = (ctx as any).qingjianCardId as string
                    const idx = (ctx as any).qingjianTargetIndex as number
                    const giftIdx = targetGeneral.hand.findIndex(c => c.id === cid)
                    const recipient = state.generals[idx]
                    if (giftIdx >= 0 && recipient?.alive) {
                        const [gift] = targetGeneral.hand.splice(giftIdx, 1)
                        recipient.hand.push(gift)
                        const turnGeneral = state.generals[state.activeGeneralIndex]
                        if (turnGeneral) turnGeneral.handLimitDelta = (turnGeneral.handLimitDelta ?? 0) + 1
                        addLog(state, `【${name}】发动【清俭】，将${cardFullName(gift)}交给【${getGeneralName(recipient)}】`)
                    }
                    targetGeneral.skillsUsedThisTurn.push('xiahoudun_qingjian')
                    return
                }
                // ══ 洛书版扩展（四）：新增武将确认型技能 ══
                // 精策①（界郭淮）：摸本回合使用过的牌的类别数张牌
                case 'guohuai_jingce': {
                    const jcCount = Math.max(0, (ctx.jinceCount as number) ?? 0)
                    if (jcCount > 0) {
                        const jcDrawn = drawForGeneral(state, targetGeneral, jcCount)
                        targetGeneral.hand.push(...jcDrawn)
                        addLog(state, `【${name}】发动【精策】，摸了${jcDrawn.length}张牌`)
                    }
                    const jcActive = getActiveGeneral(state)
                    if (jcActive) enterDiscardPhaseOrSkip(state, jcActive)
                    return
                }
                // 奋励（朱桓）：跳过摸牌阶段
                case 'zhuhuan_fenli_draw': {
                    targetGeneral.fenliSkips = (targetGeneral.fenliSkips ?? 0) + 1
                    addLog(state, `【${name}】发动【奋励】，跳过摸牌阶段`)
                    finishJudgePhaseAndContinue(state, targetGeneral,
                        !!(ctx as any).fenliSkipAction, true)
                    return
                }
                // 奋励（朱桓）：跳过出牌阶段
                case 'zhuhuan_fenli_action': {
                    targetGeneral.fenliSkips = (targetGeneral.fenliSkips ?? 0) + 1
                    addLog(state, `【${name}】发动【奋励】，跳过出牌阶段`)
                    enterDiscardPhaseOrSkip(state, targetGeneral)
                    return
                }
                // 奋励（朱桓）：跳过弃牌阶段
                case 'zhuhuan_fenli_discard': {
                    targetGeneral.fenliSkips = (targetGeneral.fenliSkips ?? 0) + 1
                    addLog(state, `【${name}】发动【奋励】，跳过弃牌阶段`)
                    finishTurn(state)
                    return
                }
                // 罪论（诸葛瞻）：观看牌堆顶三张，获得其中X张，其余任意顺序放回
                case 'zhugezhan_zuilun': {
                    const zlMetCount = (((ctx as any).zuilunMet as string[]) ?? []).length
                    if (zlMetCount === 0) {
                        // 均不满足：你与一名其他角色各失去1点体力
                        const zlOthers = state.generals
                            .map((g, idx) => ({ g, idx }))
                            .filter(({ g, idx }) => g.alive && idx !== state.generals.indexOf(targetGeneral))
                            .map(({ idx }) => idx)
                        if (zlOthers.length === 0) {
                            loseHp(state, targetGeneral, 1)
                            advanceTurnGuarded(state)
                            return
                        }
                        addLog(state, `【${name}】【罪论】：均不满足，与一名其他角色各失去1点体力`)
                        askChooseTarget(state, targetGeneral, 'zhugezhan_zuilun_hp', '罪论',
                            '选择一名其他角色：你与其各失去1点体力', zlOthers,
                            { endPhaseSkill: true })
                        return
                    }
                    const zlCards = drawCards(state, 3)
                    if (zlCards.length === 0) {
                        advanceTurnGuarded(state)
                        return
                    }
                    const zlGain = Math.min(zlMetCount, zlCards.length)
                    addLog(state, `【${name}】发动【罪论】，观看牌堆顶${zlCards.length}张牌，可获得其中${zlGain}张`)
                    state.pendingResponseQueue.push({
                        type: ResponseType.SKILL_GUANXING_ARRANGE,
                        targetGeneralIndex: state.generals.indexOf(targetGeneral),
                        context: {
                            guanxingCards: zlCards,
                            mode: 'zuilun',
                            zuilunGainCount: zlGain,
                            guanxingTopLabel: `获得（${zlGain}张）`,
                            guanxingBottomLabel: '以任意顺序放回牌堆顶',
                        },
                    })
                    return
                }
                // 誉虚（许靖）：使用牌结算结束后摸一张牌，然后下一次结算后须弃置一张牌
                case 'xujing_yuxu': {
                    const yxDrawn = drawForGeneral(state, targetGeneral, 1)
                    targetGeneral.hand.push(...yxDrawn)
                    targetGeneral.yuxuPenalty = true
                    addLog(state, `【${name}】发动【誉虚】，摸了${yxDrawn.length}张牌`)
                    return
                }
                // 实荐（许靖）：弃置一张牌，令其本回合获得【誉虚】
                case 'xujing_shijian': {
                    if (targetGeneral.hand.length === 0) {
                        addLog(state, `【${name}】【实荐】：没有牌可以弃置`)
                        return
                    }
                    askPickCard(state, targetGeneral, 'xujing_shijian', '实荐', '弃置一张牌', {
                        count: 1,
                        mode: 'discard',
                        extra: { shijianTargetIndex: ctx.shijianTargetIndex },
                    })
                    return
                }
                // 从谏（张绣）：选择交给牌的其他目标角色
                case 'zhangxiu_congjian': {
                    const cjCandidates = ((ctx.congjianCandidates as number[]) ?? [])
                        .filter(i => state.generals[i]?.alive)
                    if (cjCandidates.length === 0 || targetGeneral.hand.length === 0) return
                    askChooseTarget(state, targetGeneral, 'zhangxiu_congjian', '从谏',
                        '选择一名其他目标角色，交给其一张牌', cjCandidates)
                    return
                }
                // ══ 洛书版扩展（五）：新增武将（确认类） ══
                // ── 称象（界曹冲）：亮出牌堆顶四张，获得点数之和不大于13的任意张
                case 'caochong_chengxiang': {
                    return resolveSkillOption(state, targetGeneral, pending, 'confirm')
                }
                // ── 恢拓（曹叡）：选择一名角色进行判定
                case 'caorui_huituo': {
                    state.pendingResponseQueue.shift()
                    state.pendingResponseQueue.push({
                        type: ResponseType.SKILL_CHOOSE_TARGET,
                        targetGeneralIndex: state.generals.indexOf(targetGeneral),
                        context: {
                            skillId: 'caorui_huituo',
                            skillName: '恢拓',
                            description: '令一名角色判定：红色其回复1点体力；黑色其摸X张牌',
                            candidateIndices: state.generals
                                .map((g, idx) => ({ g, idx }))
                                .filter(({ g }) => g.alive)
                                .map(({ idx }) => idx),
                            huituoAmount: ctx.huituoAmount,
                        },
                    })
                    return
                }
                // ── 权计（界钟会）：摸一张牌，然后当前回合角色将一张手牌置于你的武将牌上
                case 'zhonghui_quanji': {
                    const qjDrawn = drawForGeneral(state, targetGeneral, 1)
                    targetGeneral.hand.push(...qjDrawn)
                    addLog(state, `【${name}】发动【权计】，摸了${qjDrawn.length}张牌`)
                    const qjPayer = getActiveGeneral(state)
                    if (qjPayer && qjPayer.alive && qjPayer.hand.length > 0) {
                        askPickCard(state, qjPayer, 'zhonghui_quanji', '权计',
                            `将一张手牌置于【${name}】的武将牌上，称为“权”`, {
                            count: 1,
                            mode: 'discard',
                            extra: { quanjiOwnerIndex: state.generals.indexOf(targetGeneral) },
                        })
                    } else if (qjPayer) {
                        addLog(state, `【权计】：【${getGeneralName(qjPayer)}】没有手牌，无法放置“权”`)
                    }
                    return
                }
                // ── 伤逝（界张春华）：将手牌摸至已损失的体力值
                case 'zhangchunhua_shangshi': {
                    const ssNeed = (ctx.shangshiTarget as number) ?? 0
                    const ssDrawn = drawToHandSize(state, targetGeneral, ssNeed)
                    addLog(state, `【${name}】发动【伤逝】，摸了${ssDrawn}张牌`)
                    return
                }
                // ── 强识（界张松）：选择观看手牌的其他角色
                case 'zhangsong_qiangshi': {
                    const qsCandidates = state.generals
                        .map((g, idx) => ({ g, idx }))
                        .filter(({ g, idx }) => g.alive && idx !== state.generals.indexOf(targetGeneral)
                            && g.hand.length > 0)
                        .map(({ idx }) => idx)
                    if (qsCandidates.length === 0) {
                        addLog(state, `【${name}】【强识】：没有可观看手牌的其他角色`)
                        return
                    }
                    askChooseTarget(state, targetGeneral, 'zhangsong_qiangshi', '强识',
                        '观看一名其他角色的手牌并展示其中一张牌', qsCandidates)
                    return
                }
                // ── 惴恐（界伏皇后）：与回合角色拼点
                case 'fuhuanghou_chuikong': {
                    const ckOpp = state.generals[ctx.chuikongOpponentIndex as number]
                    if (!ckOpp?.alive) return
                    if (!pindianStart(state, targetGeneral, ckOpp, 'fuhuanghou_chuikong', '惴恐')) {
                        addLog(state, `【${name}】【惴恐】：拼点双方须均有手牌，发动取消`)
                    }
                    return
                }
                // ── 仁心（界曹冲）：翻面并弃置一张装备牌，令濒死角色回复至1点体力
                case 'caochong_renxin': {
                    const rxTarget = state.generals[ctx.renxinTargetIndex as number]
                    if (!rxTarget || !rxTarget.alive) return
                    const rxEquips: Card[] = [
                        ...Object.values(targetGeneral.equip).filter((c): c is Card => !!c),
                        ...targetGeneral.hand.filter(c => c.category === CardCategory.EQUIPMENT),
                    ]
                    if (rxEquips.length === 0) {
                        addLog(state, `【${name}】【仁心】：没有装备牌可弃置`)
                        return
                    }
                    flipGeneral(state, targetGeneral, '仁心')
                    askPickCard(state, targetGeneral, 'caochong_renxin', '仁心', '弃置一张装备牌', {
                        count: 1,
                        mode: 'discard',
                        candidateCardIds: rxEquips.map(c => c.id),
                        extra: { renxinTargetIndex: ctx.renxinTargetIndex },
                    })
                    // 先让曹冲选牌，再进入求桃询问
                    const rxPick = state.pendingResponseQueue.pop()
                    if (rxPick) state.pendingResponseQueue.unshift(rxPick)
                    return
                }
                // ── 陷嗣（刘封）：选择至多两名角色，各取一张牌置于武将牌上
                case 'liufeng_xiansi': {
                    const xsCandidates = state.generals
                        .map((g, idx) => ({ g, idx }))
                        .filter(({ g, idx }) => g.alive && idx !== state.generals.indexOf(targetGeneral)
                            && hasCardInArea(g))
                        .map(({ idx }) => idx)
                    if (xsCandidates.length === 0) {
                        addLog(state, `【${name}】【陷嗣】：没有可获得牌的其他角色`)
                        return
                    }
                    state.pendingResponseQueue.push({
                        type: ResponseType.SKILL_CHOOSE_TARGET,
                        targetGeneralIndex: state.generals.indexOf(targetGeneral),
                        context: {
                            skillId: 'liufeng_xiansi',
                            skillName: '陷嗣',
                            description: '将至多两名角色的各一张牌置于你的武将牌上，称为“逆”',
                            candidateIndices: xsCandidates,
                            multi: true,
                            maxPicks: 2,
                        },
                    })
                    return
                }
                // ── 巧变（张郃）：弃一张手牌跳过对应阶段
                case 'zhanghe_qiaobian': {
                    if (targetGeneral.hand.length === 0) return
                    askPickCard(state, targetGeneral, 'zhanghe_qiaobian', '巧变',
                        `弃置一张手牌，跳过${qiaobianPhaseLabel(ctx.qiaobianPhase as string)}阶段`, {
                        count: 1,
                        mode: 'discard',
                        extra: {
                            qiaobianPhase: ctx.qiaobianPhase,
                            qiaobianSkipAction: ctx.qiaobianSkipAction,
                        },
                    })
                    return
                }
                // ── 陷嗣②（刘封）：移去两张“逆”，视为对刘封使用一张【杀】
                case 'liufeng_xiansi_use': {
                    const lfOwner = state.generals[ctx.xiansiOwnerIndex as number]
                    if (!lfOwner?.alive || pileCount(lfOwner) < 2) {
                        continueFromPrepPhase(state)
                        return
                    }
                    const lfRemoved = lfOwner.generalPile!.splice(0, 2)
                    state.discard.push(...lfRemoved)
                    addLog(state, `【${name}】移去【${getGeneralName(lfOwner)}】的两张“逆”（剩余${pileCount(lfOwner)}），视为对其使用一张【杀】`)
                    // 先推进准备阶段（此时队列为空则进入判定阶段），再压入【杀】的响应
                    continueFromPrepPhase(state)
                    useVirtualSlash(state, targetGeneral, state.generals.indexOf(lfOwner), { noRange: true, label: '（陷嗣）' })
                    return
                }
                default:
                    addLog(state, `【${name}】发动了【${ctx.skillName}】`)
                    return
            }
        }

        // ── 奇策（荀攸）：选择当作哪张普通锦囊
        case ResponseType.SKILL_QICE_PICK: {
            const ctx = pending.context as any
            const trick = (data.action ?? '') as string
            const allowed = ['draw_two', 'duel', 'dismantle', 'steal']
            if (!allowed.includes(trick)) return { error: '请选择要使用的锦囊' }
            const gIdx = state.generals.indexOf(targetGeneral)
            const targetIdx = (ctx.qiceTargetIndices as number[] | undefined)?.[0] ?? -1
            const target = targetIdx >= 0 ? state.generals[targetIdx] : undefined
            if (trick !== 'draw_two') {
                if (!target?.alive) return { error: '该锦囊需要指定一名目标角色' }
                if (target === targetGeneral) return { error: '不能以自己为目标' }
                if (hasSkill(target, 'jiaxu_weimu')) return { error: '目标发动【帷幕】' }
                if (trick === 'duel' && hasSkill(target, 'zhugeliang_kongcheng') && target.hand.length === 0) {
                    return { error: '目标发动【空城】' }
                }
            }
            state.pendingResponseQueue.shift()
            const trickName = trick === 'draw_two' ? TrickCardName.DRAW_TWO
                : trick === 'duel' ? TrickCardName.DUEL
                    : trick === 'dismantle' ? TrickCardName.DISMANTLE
                        : TrickCardName.STEAL
            const tIdx = target ? state.generals.indexOf(target) : -1
            const effect: DeferredTrickEffect = {
                type: trick,
                userIndex: gIdx,
                targetIndex: tIdx,
                triggerJizhi: false,
                extra: trick === 'duel' ? { duelCardId: undefined } : undefined,
            }
            addLog(state, `【${getGeneralName(targetGeneral)}】发动【奇策】，视为使用${cardDisplayName({ name: trickName } as any)}`)
            const deferred = pushNegateCheck(state, trickName, gIdx, tIdx,
                target ? getGeneralName(target) : getGeneralName(targetGeneral), effect)
            if (!deferred) executeDeferredTrickEffect(state, effect)
            return
        }

        // ── 遗计分配：从手牌中选择 yiji 牌分给其他角色
        case ResponseType.SKILL_YIJI_DISTRIBUTE: {
            const ctx = pending.context as { yijiCardIds: string[]; remaining: number }
            const targetIdx = (data as any).targetIndex as number | undefined
            // 支持单张 cardId 或多张 cardIds
            const multiCardIds = (data as any).cardIds as string[] | undefined
            const singleCardId = data.cardId
            const cardIdsToGive: string[] = multiCardIds ?? (singleCardId ? [singleCardId] : [])

            if (cardIdsToGive.length > 0 && targetIdx !== undefined) {
                // 校验数量
                if (cardIdsToGive.length > ctx.remaining) return { error: `最多还能分配${ctx.remaining}张牌` }
                // 校验每张牌
                for (const cid of cardIdsToGive) {
                    if (!ctx.yijiCardIds.includes(cid)) return { error: '此牌不是遗计可分配的牌' }
                    const cardIdx = targetGeneral.hand.findIndex(c => c.id === cid)
                    if (cardIdx === -1) return { error: '手牌中找不到此牌' }
                }
                const recipient = state.generals[targetIdx]
                if (!recipient?.alive) return { error: '目标不存在' }

                const count = cardIdsToGive.length
                if (recipient !== targetGeneral) {
                    // 给别人
                    for (const cid of cardIdsToGive) {
                        const cardIdx = targetGeneral.hand.findIndex(c => c.id === cid)
                        const card = targetGeneral.hand.splice(cardIdx, 1)[0]
                        recipient.hand.push(card)
                    }
                    addLog(state, `【${getGeneralName(targetGeneral)}】将${count}张牌交给了【${getGeneralName(recipient)}】`)
                } else {
                    addLog(state, `【${getGeneralName(targetGeneral)}】保留了${count}张牌`)
                }

                ctx.yijiCardIds = ctx.yijiCardIds.filter(id => !cardIdsToGive.includes(id))
                ctx.remaining -= count
                if (ctx.remaining <= 0) {
                    state.pendingResponseQueue.shift()
                }
            } else {
                // 跳过 → 剩余牌全部保留在自己手中
                state.pendingResponseQueue.shift()
                addLog(state, `【${getGeneralName(targetGeneral)}】保留了剩余的牌`)
            }
            return
        }

        // ── 刚烈：伤害来源选择弃2手牌或受1伤
        case ResponseType.SKILL_GANGLIE_CHOICE: {
            const ctx = pending.context as { ganglieSourceIndex: number }
            const ganglieUser = state.generals[ctx.ganglieSourceIndex]
            if (data.cardId === 'discard') {
                // 选择弃2张手牌
                if (targetGeneral.hand.length < 2) {
                    // 手牌不足，只能受伤
                    dealDamage(state, ganglieUser, targetGeneral, 1)
                    state.pendingResponseQueue.shift()
                    return
                }
                const cardIds = (data as any).cardIds as string[] | undefined
                if (!cardIds || cardIds.length !== 2) return { error: '请选择2张手牌弃置' }
                for (const id of cardIds) {
                    const idx = targetGeneral.hand.findIndex(c => c.id === id)
                    if (idx === -1) return { error: '手牌中找不到指定的牌' }
                    state.discard.push(targetGeneral.hand.splice(idx, 1)[0])
                }
                addLog(state, `【${getGeneralName(targetGeneral)}】弃置了2张手牌`)
                state.pendingResponseQueue.shift()
            } else {
                // 选择受1伤（或默认放弃）
                state.pendingResponseQueue.shift()
                dealDamage(state, ganglieUser, targetGeneral, 1)
            }
            return
        }

        // ── 观星（诸葛亮）：排列牌堆顶/底
        case ResponseType.SKILL_GUANXING_ARRANGE: {
            const ctx = pending.context as { guanxingCards: Card[] }
            const topIds = (data as any).topCardIds as string[] | undefined ?? []
            const bottomIds = (data as any).bottomCardIds as string[] | undefined ?? []
            const allIds = ctx.guanxingCards.map(c => c.id)

            // 验证：所有牌必须被分配
            const submitted = [...topIds, ...bottomIds]
            if (submitted.length !== allIds.length || !submitted.every(id => allIds.includes(id))) {
                return { error: '请将所有牌分配到牌堆顶或牌堆底' }
            }

            // 按顺序放入牌堆
            const topCards = topIds.map(id => ctx.guanxingCards.find(c => c.id === id)!)
            const bottomCards = bottomIds.map(id => ctx.guanxingCards.find(c => c.id === id)!)

            // 恂恂（界李典）：两张置顶、其余置底，然后正常摸牌
            if ((ctx as any).mode === 'xunxun') {
                if (topCards.length !== Math.min(2, allIds.length)) {
                    return { error: '请将两张牌置于牌堆顶' }
                }
                state.deck.unshift(...topCards)
                state.deck.push(...bottomCards)
                state.pendingResponseQueue.shift()
                addLog(state, `【${getGeneralName(targetGeneral)}】完成【恂恂】排列（${topCards.length}张置顶，${bottomCards.length}张置底）`)
                finishDrawPhaseAfterXunxun(state, targetGeneral, !!(ctx as any).skipAction)
                return
            }

            // 罪论（诸葛瞻）：左栏为获得的牌，右栏为以任意顺序放回牌堆顶的牌
            if ((ctx as any).mode === 'zuilun') {
                const gainLimit = Math.min((ctx as any).zuilunGainCount as number ?? 0, allIds.length)
                if (topCards.length !== gainLimit) {
                    return { error: `请选择获得 ${gainLimit} 张牌` }
                }
                if (topCards.length > 0) {
                    targetGeneral.hand.push(...topCards)
                    addLog(state, `【${getGeneralName(targetGeneral)}】【罪论】获得${topCards.length}张牌：${topCards.map(c => cardFullName(c)).join('、')}`)
                }
                state.deck.unshift(...bottomCards)
                state.pendingResponseQueue.shift()
                addLog(state, `【${getGeneralName(targetGeneral)}】【罪论】将${bottomCards.length}张牌放回牌堆顶`)
                advanceTurnGuarded(state)
                return
            }

            // 称象（界曹冲）：左栏为获得的牌（点数之和≤13），右栏置入弃牌堆
            if ((ctx as any).mode === 'chengxiang') {
                const sumLimit = ((ctx as any).chengxiangSumLimit as number) ?? 13
                const cxSum = topCards.reduce((acc, c) => acc + c.value, 0)
                if (cxSum > sumLimit) {
                    return { error: `获得的牌点数之和须不大于 ${sumLimit}（当前${cxSum}）` }
                }
                state.pendingResponseQueue.shift()
                if (topCards.length > 0) {
                    targetGeneral.hand.push(...topCards)
                    addLog(state, `【${getGeneralName(targetGeneral)}】【称象】获得${topCards.length}张牌（点数之和${cxSum}）：${topCards.map(c => cardFullName(c)).join('、')}`)
                } else {
                    addLog(state, `【${getGeneralName(targetGeneral)}】【称象】未获得任何牌`)
                }
                if (bottomCards.length > 0) state.discard.push(...bottomCards)
                if (cxSum === sumLimit) {
                    targetGeneral.chengxiangBonus = (targetGeneral.chengxiangBonus ?? 0) + 1
                    addLog(state, `【${getGeneralName(targetGeneral)}】【称象】获得的牌点数之和为${sumLimit}，下次发动时亮出的牌数+1（当前+${targetGeneral.chengxiangBonus}）`)
                } else {
                    targetGeneral.chengxiangBonus = 0
                }
                return
            }

            state.deck.unshift(...topCards)
            state.deck.push(...bottomCards)

            // 观星②（界诸葛亮）：准备阶段将所有牌置于牌堆底，则本回合结束阶段可再次观星
            if (targetGeneral.generalId === 'zhugeliang_jie' && !(ctx as any).guanxingEndPhase
                && topCards.length === 0 && bottomCards.length > 0) {
                targetGeneral.guanxingEndAgain = true
                addLog(state, `【${getGeneralName(targetGeneral)}】【观星】将所有牌置于牌堆底，本回合结束阶段可再次观星`)
            }

            addLog(state, `【${getGeneralName(targetGeneral)}】完成【观星】排列（${topCards.length}张置顶，${bottomCards.length}张置底）`)
            state.pendingResponseQueue.shift()
            if ((ctx as any).guanxingEndPhase) {
                continueEndPhase(state)
                return
            }
            continueFromPrepPhase(state)
            return
        }

        // ── 突袭（张辽）：选择至多2名角色各偷1张手牌
        case ResponseType.SKILL_TUXI_CHOOSE: {
            const ctx = pending.context as { remainingPicks: number; pickedIndices?: number[] }
            if (!ctx.pickedIndices) ctx.pickedIndices = []
            // 基础张辽是放弃全部摸牌，不再补摸；界张辽为少摸等量张
            const tuxiSkipAll = targetGeneral.generalId === 'zhangliao'
            // 支持单目标 targetIndex 或 多目标 targetIndices
            const singleIdx = (data as any).targetIndex as number | undefined
            const multiIdx = (data as any).targetIndices as number[] | undefined
            const targetIndices: number[] = multiIdx ?? (singleIdx !== undefined ? [singleIdx] : [])

            if (targetIndices.length > 0) {
                // 校验数量
                if (targetIndices.length > ctx.remainingPicks) return { error: `最多还能选${ctx.remainingPicks}名角色` }
                // 校验去重
                const uniqueSet = new Set(targetIndices)
                if (uniqueSet.size !== targetIndices.length) return { error: '不能选择相同的角色' }

                for (const tIdx of targetIndices) {
                    const victim = state.generals[tIdx]
                    if (!victim?.alive || victim.hand.length === 0) return { error: `【${getGeneralName(victim)}】没有手牌` }
                    if (ctx.pickedIndices.includes(tIdx)) return { error: '已经选过此角色' }
                    if (tIdx === pending.targetGeneralIndex) return { error: '不能选自己' }
                }

                // 逐个获取手牌
                for (const tIdx of targetIndices) {
                    const victim = state.generals[tIdx]
                    const randIdx = randomInt(victim.hand.length)
                    targetGeneral.hand.push(victim.hand.splice(randIdx, 1)[0])
                    addLog(state, `【${getGeneralName(targetGeneral)}】发动【突袭】，获取了【${getGeneralName(victim)}】的一张手牌`)
                    ctx.pickedIndices.push(tIdx)
                    ctx.remainingPicks -= 1
                }

                if (ctx.remainingPicks <= 0) {
                    if (!(ctx as any).skipAction) {
                        const tuxiCount = tuxiSkipAll ? 0 : Math.max(0, 2 - ctx.pickedIndices.length)
                        const tuxiDraw = drawCards(state, tuxiCount)
                        targetGeneral.hand.push(...tuxiDraw)
                        if (tuxiDraw.length > 0) addLog(state, `【${getGeneralName(targetGeneral)}】【突袭】少摸${ctx.pickedIndices.length}张，补摸${tuxiDraw.length}张`)
                    }
                    state.pendingResponseQueue.shift()
                    if ((ctx as any).skipAction) {
                        state.turnPhase = TurnPhase.DISCARD
                        if (targetGeneral.hand.length <= targetGeneral.hp) {
                            finishTurn(state)
                        }
                    } else {
                        state.turnPhase = TurnPhase.ACTION
                        addLog(state, `【${getGeneralName(targetGeneral)}】进入出牌阶段`)
                    }
                }
            } else {
                // 手动结束
                if (!(ctx as any).skipAction) {
                    const tuxiCount2 = tuxiSkipAll ? 0 : Math.max(0, 2 - ctx.pickedIndices.length)
                    const tuxiDraw2 = drawCards(state, tuxiCount2)
                    targetGeneral.hand.push(...tuxiDraw2)
                    if (tuxiDraw2.length > 0) addLog(state, `【${getGeneralName(targetGeneral)}】【突袭】少摸${ctx.pickedIndices.length}张，补摸${tuxiDraw2.length}张`)
                }
                state.pendingResponseQueue.shift()
                if ((ctx as any).skipAction) {
                    state.turnPhase = TurnPhase.DISCARD
                    if (targetGeneral.hand.length <= targetGeneral.hp) {
                        finishTurn(state)
                    }
                } else {
                    state.turnPhase = TurnPhase.ACTION
                    addLog(state, `【${getGeneralName(targetGeneral)}】进入出牌阶段`)
                }
            }
            return
        }

        // ── 神速：选杀目标
        case ResponseType.SKILL_SHENSU_TARGET: {
            const ctx = pending.context as { shensuPhase: number }
            const shensuTargetIdx = (data as any).targetIndex as number | undefined
            if (shensuTargetIdx === undefined) return { error: '请选择一个目标' }
            const shensuTarget = state.generals[shensuTargetIdx]
            if (!shensuTarget?.alive) return { error: '目标不存在' }
            if (shensuTargetIdx === pending.targetGeneralIndex) return { error: '不能选自己' }

            addLog(state, `【${getGeneralName(targetGeneral)}】视为对【${getGeneralName(shensuTarget)}】使用了【杀】`)
            state.pendingResponseQueue.shift()
            state.pendingResponseQueue.unshift({
                type: ResponseType.DODGE,
                targetGeneralIndex: shensuTargetIdx,
                context: {
                    attackerGeneralIndex: pending.targetGeneralIndex,
                    requiredDodges: 1,
                    dodgesReceived: 0,
                },
            })
            return
        }

        // ── 神速二：选弃装备（已装备 或 手牌中的装备牌）
        case ResponseType.SKILL_SHENSU_EQUIP: {
            const action = (data as any).action as string | undefined

            if (action && ['weapon', 'armor', 'plus_horse', 'minus_horse'].includes(action)) {
                // 弃已装备的装备
                const slot = action as keyof typeof targetGeneral.equip
                const equipCard = targetGeneral.equip[slot]
                if (!equipCard) return { error: '该装备栏为空' }
                clearEquipSlot(state, targetGeneral, slot)
                state.discard.push(equipCard)
                triggerXiaoji(state, targetGeneral)
                addLog(state, `【${getGeneralName(targetGeneral)}】发动【神速二】，弃置装备${cardFullName(equipCard)}`)
            } else if (data.cardId) {
                // 弃手牌中的装备牌
                const cardIdx = targetGeneral.hand.findIndex(c => c.id === data.cardId)
                if (cardIdx === -1) return { error: '手牌中找不到此牌' }
                const card = targetGeneral.hand[cardIdx]
                if (card.category !== CardCategory.EQUIPMENT) return { error: '此牌不是装备牌' }
                targetGeneral.hand.splice(cardIdx, 1)
                state.discard.push(card)
                addLog(state, `【${getGeneralName(targetGeneral)}】发动【神速二】，弃置手牌中的装备牌${cardFullName(card)}`)
            } else {
                return { error: '请选择要弃置的装备' }
            }

            // 弃装备后，跳过出牌阶段并选杀目标
            state.pendingResponseQueue.shift()
            state.turnPhase = TurnPhase.DISCARD
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_SHENSU_TARGET,
                targetGeneralIndex: pending.targetGeneralIndex,
                context: { shensuPhase: 2 },
            })
            return
        }

        // ── 反馈（司马懿）：选伤害来源的一张牌
        case ResponseType.SKILL_FANKUI_PICK: {
            const ctx = pending.context as { sourceGeneralIndex: number }
            const source = state.generals[ctx.sourceGeneralIndex]
            if (!source || (!source.hand.length && !Object.values(source.equip).some(Boolean))) {
                state.pendingResponseQueue.shift()
                return
            }
            if (!data.cardId) {
                return { error: '请选择一张牌（已确认发动反馈，不能放弃）' }
            }
            // 随机手牌
            if (data.cardId === '__random_hand__') {
                if (source.hand.length === 0) return { error: '来源没有手牌' }
                const randIdx = randomInt(source.hand.length)
                targetGeneral.hand.push(source.hand.splice(randIdx, 1)[0])
                addLog(state, `【${getGeneralName(targetGeneral)}】发动【反馈】，获取了【${getGeneralName(source)}】的一张手牌`)
                state.pendingResponseQueue.shift()
                return
            }
            // 从来源手牌获取
            const fromHandIdx = source.hand.findIndex(c => c.id === data.cardId)
            if (fromHandIdx >= 0) {
                targetGeneral.hand.push(source.hand.splice(fromHandIdx, 1)[0])
                addLog(state, `【${getGeneralName(targetGeneral)}】发动【反馈】，获取了【${getGeneralName(source)}】的一张手牌`)
                state.pendingResponseQueue.shift()
                return
            }
            // 从来源装备获取
            for (const slot of Object.values(EquipSlot)) {
                if (source.equip[slot]?.id === data.cardId) {
                    targetGeneral.hand.push(source.equip[slot]!)
                    clearEquipSlot(state, source, slot)
                    triggerXiaoji(state, source)
                    addLog(state, `【${getGeneralName(targetGeneral)}】发动【反馈】，获取了【${getGeneralName(source)}】的装备`)
                    state.pendingResponseQueue.shift()
                    return
                }
            }
            return { error: '指定的牌不存在' }
        }

        // ── 反间（周瑜）：目标选花色
        case ResponseType.SKILL_FANJIAN_SUIT: {
            const ctx = pending.context as { fanjianUserIndex: number }
            const fanjianUser = state.generals[ctx.fanjianUserIndex]
            const chosenSuit = (data as any).suit as string | undefined
            if (!chosenSuit || !['heart', 'diamond', 'spade', 'club'].includes(chosenSuit)) {
                return { error: '请选择一种花色（heart/diamond/spade/club）' }
            }
            // 随机取周瑜一张手牌
            if (fanjianUser.hand.length === 0) {
                state.pendingResponseQueue.shift()
                addLog(state, `【${getGeneralName(fanjianUser)}】没有手牌，反间失效`)
                return
            }
            const randIdx = randomInt(fanjianUser.hand.length)
            const givenCard = fanjianUser.hand.splice(randIdx, 1)[0]
            addLog(state, `【${getGeneralName(targetGeneral)}】选择了${suitSymbol(chosenSuit as CardSuit)}`)
            addLog(state, `随机抽取的牌为【${suitSymbol(givenCard.suit)}${valueName(givenCard.value)}】`)
            if (givenCard.suit !== chosenSuit) {
                addLog(state, `花色不同！对【${getGeneralName(targetGeneral)}】造成1点伤害`)
                // 无论花色是否相同，对手都获得这张牌
                targetGeneral.hand.push(givenCard)
                state.pendingResponseQueue.shift()
                dealDamage(state, fanjianUser, targetGeneral, 1)
            } else {
                addLog(state, `花色相同，无伤害`)
                // 无论花色是否相同，对手都获得这张牌
                targetGeneral.hand.push(givenCard)
                state.pendingResponseQueue.shift()
            }
            return
        }

        // ── 挑衅：目标选择出杀或放弃
        case ResponseType.SKILL_TIAOXIN_RESPONSE: {
            const ctx = pending.context as { tiaoxinUserIndex: number }
            const tiaoxinUser = state.generals[ctx.tiaoxinUserIndex]
            if (data.cardId) {
                // 出杀
                const cardIdx = targetGeneral.hand.findIndex(c => c.id === data.cardId)
                if (cardIdx === -1) return { error: '手牌中找不到此牌' }
                const card = targetGeneral.hand[cardIdx]
                if (!isCardUsableAsAttack(targetGeneral, card)) return { error: '需要出【杀】' }
                targetGeneral.hand.splice(cardIdx, 1)
                state.discard.push(card)
                addLog(state, `【${getGeneralName(targetGeneral)}】出了一张【杀】`)
                state.pendingResponseQueue.shift()
                // 杀的效果 → 挑衅发起者需出闪
                state.pendingResponseQueue.unshift({
                    type: ResponseType.DODGE,
                    targetGeneralIndex: ctx.tiaoxinUserIndex,
                    context: {
                        attackerGeneralIndex: state.generals.indexOf(targetGeneral),
                        requiredDodges: 1,
                        dodgesReceived: 0,
                        attackCard: card,
                    },
                })
            } else {
                // 放弃 → 姜维选目标的手牌或装备弃掉
                addLog(state, `【${getGeneralName(targetGeneral)}】放弃出杀`)
                state.pendingResponseQueue.shift()
                const totalCards = targetGeneral.hand.length + Object.values(targetGeneral.equip).filter(Boolean).length
                if (totalCards > 0) {
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.TRICK_TARGET_CARD_PICK,
                        targetGeneralIndex: ctx.tiaoxinUserIndex,
                        context: {
                            targetIndex: state.generals.indexOf(targetGeneral),
                            trickType: 'dismantle',
                        },
                    })
                    addLog(state, `【${getGeneralName(tiaoxinUser)}】选择弃掉【${getGeneralName(targetGeneral)}】的一张牌`)
                }
            }
            return
        }

        // ── 乱武：每个角色依次出杀或失血
        case ResponseType.SKILL_LUANWU_RESPONSE: {
            const ctx = pending.context as {
                luanwuUserIndex: number
                remainingIndices: number[]
                nearestIndices: number[]
            }

            // 下一名角色等本次结算（出闪 / 伤害 / 濒死）全部结束后再询问
            const scheduleNext = () => {
                state.pendingLuanwu = {
                    luanwuUserIndex: ctx.luanwuUserIndex,
                    remainingIndices: ctx.remainingIndices,
                }
            }

            if (data.cardId) {
                // 出杀
                const cardIdx = targetGeneral.hand.findIndex(c => c.id === data.cardId)
                if (cardIdx === -1) return { error: '手牌中找不到此牌' }
                const card = targetGeneral.hand[cardIdx]
                if (!isCardUsableAsAttack(targetGeneral, card)) return { error: '需要出【杀】' }
                targetGeneral.hand.splice(cardIdx, 1)
                state.discard.push(card)

                state.pendingResponseQueue.shift()

                if (ctx.nearestIndices.length === 1) {
                    // 唯一最近 → 直接对该角色使用杀
                    const nearestIdx = ctx.nearestIndices[0]
                    const nearest = state.generals[nearestIdx]
                    addLog(state, `【${getGeneralName(targetGeneral)}】在乱武中对【${getGeneralName(nearest)}】使用了【杀】`)
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.DODGE,
                        targetGeneralIndex: nearestIdx,
                        context: {
                            attackerGeneralIndex: state.generals.indexOf(targetGeneral),
                            attackCard: card,
                            // 乱武视为该角色打出的【杀】，需尊重其【无双】
                            requiredDodges: hasSkill(targetGeneral, 'lvbu_wushuang') ? 2 : 1,
                            dodgesReceived: 0,
                        },
                    })
                } else if (ctx.nearestIndices.length > 1) {
                    // 多个最近 → 让玩家选目标
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.SKILL_LUANWU_PICK_TARGET,
                        targetGeneralIndex: state.generals.indexOf(targetGeneral),
                        context: {
                            attackCard: card,
                            candidateIndices: ctx.nearestIndices,
                        },
                    })
                    const names = ctx.nearestIndices.map(i => getGeneralName(state.generals[i])).join('、')
                    addLog(state, `【${getGeneralName(targetGeneral)}】在乱武中出杀，距离最近有多人（${names}），请选择目标`)
                }

                scheduleNext()
            } else {
                // 放弃 → 失去1点体力
                state.pendingResponseQueue.shift()
                loseHp(state, targetGeneral, 1)
                scheduleNext()
            }
            return
        }

        // ── 乱武②（界贾诩）：结算结束后视为使用一张无距离限制的【杀】
        case ResponseType.SKILL_LUANWU_EXTRA_SLASH: {
            const lwCtx = pending.context as { candidateIndices: number[] }
            const lwUser = state.generals[pending.targetGeneralIndex]
            if ((data as any).action === 'decline') {
                state.pendingResponseQueue.shift()
                addLog(state, `【${getGeneralName(lwUser)}】放弃【乱武】的额外【杀】`)
                return
            }
            const lwTargetIdx = (data as any).targetIndex as number | undefined
            if (lwTargetIdx === undefined || !lwCtx.candidateIndices.includes(lwTargetIdx)) {
                return { error: '请选择合法的目标' }
            }
            const lwVictim = state.generals[lwTargetIdx]
            if (!lwUser?.alive || !lwVictim?.alive) {
                return { error: '目标已死亡' }
            }
            state.pendingResponseQueue.shift()
            addLog(state, `【${getGeneralName(lwUser)}】因【乱武】视为对【${getGeneralName(lwVictim)}】使用一张无距离限制的【杀】`)
            state.pendingResponseQueue.unshift({
                type: ResponseType.DODGE,
                targetGeneralIndex: lwTargetIdx,
                context: {
                    attackerGeneralIndex: state.generals.indexOf(lwUser),
                    requiredDodges: hasSkill(lwUser, 'lvbu_wushuang') ? 2 : 1,
                    dodgesReceived: 0,
                },
            })
            return
        }

        // ── 英魂（孙坚）：选目标+模式
        case ResponseType.SKILL_YINGHUN_CHOOSE: {
            const ctx = pending.context as { lostHp: number }
            const yAction = (data as any).action as string
            const yTargetIdx = (data as any).targetIndex as number

            if (yAction === 'skip') {
                // 放弃
                addLog(state, `【${getGeneralName(targetGeneral)}】放弃发动【英魂】`)
                state.pendingResponseQueue.shift()
                continueFromPrepPhase(state)
                return
            }

            if (yTargetIdx == null || yTargetIdx < 0 || yTargetIdx >= state.generals.length) {
                return { error: '请选择一名其他角色' }
            }
            const yTarget = state.generals[yTargetIdx]
            if (!yTarget?.alive || yTarget === targetGeneral) return { error: '目标无效' }

            const lostHp = ctx.lostHp || 1

            if (yAction === 'modeB') {
                // 模式B：摸1弃X
                const drawn = drawCards(state, 1)
                yTarget.hand.push(...drawn)
                const discardCount = Math.min(lostHp, yTarget.hand.length + Object.values(yTarget.equip).filter(e => e != null).length)
                addLog(state, `【${getGeneralName(targetGeneral)}】发动【英魂】B，【${getGeneralName(yTarget)}】摸1张，需弃${discardCount}张`)
                state.pendingResponseQueue.shift()
                if (discardCount > 0) {
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.SKILL_YINGHUN_DISCARD,
                        targetGeneralIndex: yTargetIdx,
                        context: { discardCount },
                    })
                } else {
                    continueFromPrepPhase(state)
                }
            } else {
                // 模式A：摸X弃1
                const drawn = drawCards(state, lostHp)
                yTarget.hand.push(...drawn)
                const discardCount = Math.min(1, yTarget.hand.length + Object.values(yTarget.equip).filter(e => e != null).length)
                addLog(state, `【${getGeneralName(targetGeneral)}】发动【英魂】A，【${getGeneralName(yTarget)}】摸${lostHp}张，需弃1张`)
                state.pendingResponseQueue.shift()
                if (discardCount > 0) {
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.SKILL_YINGHUN_DISCARD,
                        targetGeneralIndex: yTargetIdx,
                        context: { discardCount },
                    })
                } else {
                    continueFromPrepPhase(state)
                }
            }

            return
        }

        // ── 英魂弃牌：目标选择弃哪些牌（手牌/装备）
        case ResponseType.SKILL_YINGHUN_DISCARD: {
            const ctx = pending.context as { discardCount: number }
            const cardIds = (data as any).cardIds as string[] | undefined ?? []
            const equipSlots = (data as any).equipSlots as string[] | undefined ?? []
            const totalDiscard = cardIds.length + equipSlots.length

            if (totalDiscard !== ctx.discardCount) {
                return { error: `需要弃${ctx.discardCount}张牌（当前选了${totalDiscard}张）` }
            }

            // 弃手牌
            const discardedNames: string[] = []
            for (const cid of cardIds) {
                const idx = targetGeneral.hand.findIndex(c => c.id === cid)
                if (idx === -1) return { error: '手牌中找不到该牌' }
                const card = targetGeneral.hand.splice(idx, 1)[0]
                state.discard.push(card)
                discardedNames.push(cardDisplayName(card))
            }

            // 弃装备
            for (const slot of equipSlots) {
                const s = slot as keyof typeof targetGeneral.equip
                const equipCard = targetGeneral.equip[s]
                if (!equipCard) return { error: `装备栏 ${slot} 为空` }
                clearEquipSlot(state, targetGeneral, s) as any
                state.discard.push(equipCard)
                discardedNames.push(cardDisplayName(equipCard))
                triggerXiaoji(state, targetGeneral)
            }

            addLog(state, `【${getGeneralName(targetGeneral)}】英魂弃牌：${discardedNames.join('、')}`)
            state.pendingResponseQueue.shift()
            continueFromPrepPhase(state)
            return
        }

        // ── 天香选目标
        case ResponseType.SKILL_TIANXIANG_CHOOSE: {
            const ctx = pending.context as {
                damageAmount: number; attackerIndex: number; damageCardId?: string
                variant?: string; discardedCardId?: string
            }
            const chosenIdx = (data as any).targetIndex as number
            if (chosenIdx == null || chosenIdx < 0 || chosenIdx >= state.generals.length) {
                return { error: '请选择一名其他角色' }
            }
            const newTarget = state.generals[chosenIdx]
            if (!newTarget?.alive || newTarget === targetGeneral) return { error: '目标无效' }

            if (ctx.variant === 'luoshu') {
                state.pendingResponseQueue.shift()
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_TIANXIANG_LUOSHU_OPTION,
                    targetGeneralIndex: state.generals.indexOf(targetGeneral),
                    context: {
                        chosenIndex: chosenIdx,
                        damageAmount: ctx.damageAmount,
                        attackerIndex: ctx.attackerIndex,
                        damageCardId: ctx.damageCardId,
                        discardedCardId: ctx.discardedCardId,
                    },
                })
                addLog(state, `【${getGeneralName(targetGeneral)}】发动【天香】，将伤害转移给【${getGeneralName(newTarget)}】`)
                return
            }

            addLog(state, `【${getGeneralName(targetGeneral)}】发动【天香】，将伤害转移给【${getGeneralName(newTarget)}】`)
            state.pendingResponseQueue.shift()

            // 对新目标造成伤害（会触发濒死）
            const atk = ctx.attackerIndex >= 0 ? state.generals[ctx.attackerIndex] : null
            dealDamage(state, atk, newTarget, ctx.damageAmount, ctx.damageCardId)

            // 新目标存活则摸X张牌（X=当前已损失体力值）
            if (newTarget.alive) {
                const lostHp = Math.max(0, newTarget.maxHp - newTarget.hp)
                if (lostHp > 0) {
                    const drawn = drawCards(state, lostHp)
                    newTarget.hand.push(...drawn)
                    addLog(state, `【${getGeneralName(newTarget)}】因天香摸${lostHp}张牌`)
                }
            }
            return
        }

        // ── 天香（洛书版）后续：令其受到1点伤害并摸牌，或令其失去1点体力并获得弃牌
        case ResponseType.SKILL_TIANXIANG_LUOSHU_OPTION: {
            const ctx = pending.context as {
                chosenIndex: number
                damageAmount: number
                attackerIndex: number
                damageCardId?: string
                discardedCardId?: string
            }
            const chosen = state.generals[ctx.chosenIndex]
            if (!chosen) return { error: '目标无效' }
            const action = data.action
            state.pendingResponseQueue.shift()

            if (action === 'damage') {
                const atk = ctx.attackerIndex >= 0 ? state.generals[ctx.attackerIndex] : null
                dealDamage(state, atk, chosen, 1, ctx.damageCardId)
                if (chosen.alive) {
                    const lost = Math.min(5, Math.max(0, chosen.maxHp - chosen.hp))
                    if (lost > 0) {
                        const drawn = drawCards(state, lost)
                        chosen.hand.push(...drawn)
                        addLog(state, `【${getGeneralName(chosen)}】因天香摸${lost}张牌`)
                    }
                }
                return
            }
            if (action === 'lose') {
                loseHp(state, chosen, 1)
                const discardedId = ctx.discardedCardId
                const idx = discardedId ? state.discard.findIndex(c => c.id === discardedId) : -1
                if (idx >= 0) {
                    const card = state.discard.splice(idx, 1)[0]
                    chosen.hand.push(card)
                    addLog(state, `【${getGeneralName(chosen)}】获得天香弃置的${cardFullName(card)}`)
                }
                return
            }
            return { error: '请选择天香的后续效果' }
        }

        // ── 奇谋（魏延）：选择失去的体力数
        case ResponseType.SKILL_QIMOU_HP: {
            const ctx = pending.context as { maxHpLoss: number }
            const amount = Number((data as any).amount)
            if (!Number.isFinite(amount) || amount < 1 || amount > ctx.maxHpLoss) {
                return { error: `请选择 1 到 ${ctx.maxHpLoss} 点体力` }
            }
            state.pendingResponseQueue.shift()
            loseHp(state, targetGeneral, amount)
            targetGeneral.qimouDistanceReduce = amount
            targetGeneral.qimouSlashBonus = amount
            addLog(state, `【${getGeneralName(targetGeneral)}】发动【奇谋】，失去${amount}点体力：本回合距离-${amount}，【杀】次数上限+${amount}`)
            return
        }

        // ── 狂骨（魏延）：回复1点体力或摸一张牌
        case ResponseType.SKILL_KUANGGU_CHOICE: {
            const action = data.action
            state.pendingResponseQueue.shift()
            if (action === 'heal') {
                if (targetGeneral.hp < targetGeneral.maxHp) {
                    targetGeneral.hp += 1
                    addLog(state, `【${getGeneralName(targetGeneral)}】发动【狂骨】，回复1点体力（${targetGeneral.hp}/${targetGeneral.maxHp}）`)
                } else {
                    const drawn = drawCards(state, 1)
                    targetGeneral.hand.push(...drawn)
                    addLog(state, `【${getGeneralName(targetGeneral)}】发动【狂骨】，摸一张牌`)
                }
                return
            }
            if (action === 'draw') {
                const drawn = drawCards(state, 1)
                targetGeneral.hand.push(...drawn)
                addLog(state, `【${getGeneralName(targetGeneral)}】发动【狂骨】，摸一张牌`)
                return
            }
            return
        }

        // ── 流离选目标
        case ResponseType.SKILL_LIULI_REDIRECT: {
            const ctx = pending.context as {
                candidateIndices: number[]
                attackerIndex: number
                requiredDodges: number
                attackCard?: Card
            }
            const chosenIdx = (data as any).targetIndex as number
            if (!ctx.candidateIndices.includes(chosenIdx)) return { error: '请从候选角色中选择' }
            const newTarget = state.generals[chosenIdx]
            if (!newTarget?.alive) return { error: '目标无效' }
            addLog(state, `【${getGeneralName(targetGeneral)}】将杀转移给【${getGeneralName(newTarget)}】`)
            state.pendingResponseQueue.shift()
            state.pendingResponseQueue.unshift({
                type: ResponseType.DODGE,
                targetGeneralIndex: chosenIdx,
                context: {
                    attackerGeneralIndex: ctx.attackerIndex,
                    requiredDodges: ctx.requiredDodges || 1,
                    dodgesReceived: 0,
                    attackCard: ctx.attackCard,
                },
            })
            // 流离转移后，检查雌雄双股剑（对新目标）
            maybeDoubleSwords(state, ctx.attackerIndex, chosenIdx)
            return
        }

        // ── 乱武选目标：距离最近有多人时由玩家指定
        case ResponseType.SKILL_LUANWU_PICK_TARGET: {
            const ctx = pending.context as { attackCard: Card; candidateIndices: number[] }
            const targetIdx = (data as any).targetIndex as number | undefined
            if (targetIdx === undefined || !ctx.candidateIndices.includes(targetIdx)) {
                const names = ctx.candidateIndices.map(i => getGeneralName(state.generals[i])).join('、')
                return { error: `请选择一个目标（${names}）` }
            }
            const chosen = state.generals[targetIdx]
            if (!chosen?.alive) return { error: '目标角色不存在' }

            state.pendingResponseQueue.shift()
            addLog(state, `【${getGeneralName(targetGeneral)}】在乱武中对【${getGeneralName(chosen)}】使用了【杀】`)
            state.pendingResponseQueue.unshift({
                type: ResponseType.DODGE,
                targetGeneralIndex: targetIdx,
                context: {
                    attackerGeneralIndex: state.generals.indexOf(targetGeneral),
                    attackCard: ctx.attackCard,
                    // 与 SKILL_LUANWU_RESPONSE 一致：乱武的【杀】需尊重出杀者的【无双】
                    requiredDodges: hasSkill(targetGeneral, 'lvbu_wushuang') ? 2 : 1,
                    dodgesReceived: 0,
                },
            })
            return
        }

        // ── 借刀杀人：出杀或交武器
        // ── 火攻：目标展示手牌 → 使用者弃同花色牌造成火焰伤害
        case ResponseType.FIRE_ATTACK_SHOW: {
            const ctx = pending.context as {
                stage: 'show' | 'discard'
                userIndex: number
                victimIndex?: number
                shownCard?: Card
            }

            if (ctx.stage === 'show') {
                const showIdx = targetGeneral.hand.findIndex(c => c.id === data.cardId)
                if (showIdx === -1) return { error: '请展示一张手牌' }
                const shownCard = targetGeneral.hand[showIdx]
                addLog(state, `【${getGeneralName(targetGeneral)}】展示了【${cardFullName(shownCard)}】（火攻）`)
                rememberCards(state, state.generals.indexOf(targetGeneral), [shownCard], '火攻')
                state.pendingResponseQueue.shift()
                const fireUser = state.generals[ctx.userIndex]
                if (fireUser?.alive && fireUser.hand.some(c => c.suit === shownCard.suit)) {
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.FIRE_ATTACK_SHOW,
                        targetGeneralIndex: ctx.userIndex,
                        context: {
                            stage: 'discard',
                            userIndex: ctx.userIndex,
                            victimIndex: state.generals.indexOf(targetGeneral),
                            shownCard,
                        },
                    })
                } else {
                    addLog(state, `【${getGeneralName(fireUser ?? targetGeneral)}】没有同花色的手牌，【火攻】未造成伤害`)
                }
                return
            }

            const victim = ctx.victimIndex !== undefined ? state.generals[ctx.victimIndex] : null
            const shownCard = ctx.shownCard
            if (!victim || !victim.alive || !shownCard) {
                state.pendingResponseQueue.shift()
                return
            }
            if (data.cardId) {
                const pickIdx = targetGeneral.hand.findIndex(c => c.id === data.cardId)
                if (pickIdx === -1) return { error: '手牌中没有这张牌' }
                const discardCard = targetGeneral.hand[pickIdx]
                if (discardCard.suit !== shownCard.suit) return { error: '需要弃置与展示牌同花色的手牌' }
                targetGeneral.hand.splice(pickIdx, 1)
                state.discard.push(discardCard)
                maybeZongxuan(state, targetGeneral, [discardCard])
                addLog(state, `【${getGeneralName(targetGeneral)}】弃置【${cardFullName(discardCard)}】，【火攻】对【${getGeneralName(victim)}】造成1点火焰伤害`)
                state.pendingResponseQueue.shift()
                dealDamage(state, targetGeneral, victim, 1, undefined, { nature: 'fire' })
            } else {
                addLog(state, `【${getGeneralName(targetGeneral)}】放弃弃牌，【火攻】未造成伤害`)
                state.pendingResponseQueue.shift()
            }
            return
        }

        case ResponseType.BORROW_SWORD_RESPONSE: {
            const ctx = pending.context as { userIndex: number; killTargetIndex: number }
            const user = state.generals[ctx.userIndex]
            const killTarget = state.generals[ctx.killTargetIndex]

            if (data.cardId) {
                // 出杀
                const cardIdx = targetGeneral.hand.findIndex(c => c.id === data.cardId)
                if (cardIdx === -1) return { error: '手牌中没有这张牌' }
                const card = targetGeneral.hand[cardIdx]
                if (!isCardUsableAsAttack(targetGeneral, card)) return { error: '需要出【杀】' }

                targetGeneral.hand.splice(cardIdx, 1)
                state.discard.push(card)
                addLog(state, `【${getGeneralName(targetGeneral)}】借刀杀人中对【${getGeneralName(killTarget)}】出了【杀】`)

                state.pendingResponseQueue.shift()

                // 目标需要出闪
                if (killTarget.alive) {
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.DODGE,
                        targetGeneralIndex: ctx.killTargetIndex,
                        context: {
                            attackerGeneralIndex: pending.targetGeneralIndex,
                            attackCard: card,
                            requiredDodges: 1,
                            dodgesReceived: 0,
                        },
                    })
                    // 借刀杀人属于回合外出的杀，同样应触发雌雄双股剑
                    maybeDoubleSwords(state, pending.targetGeneralIndex, ctx.killTargetIndex)
                }
            } else {
                // 不出杀 → 交出武器
                if (targetGeneral.equip.weapon) {
                    const weapon = targetGeneral.equip.weapon
                    clearEquipSlot(state, targetGeneral, 'weapon')
                    user.hand.push(weapon)
                    addLog(state, `【${getGeneralName(targetGeneral)}】放弃出杀，将武器${cardFullName(weapon)}交给【${getGeneralName(user)}】`)
                } else {
                    addLog(state, `【${getGeneralName(targetGeneral)}】放弃出杀但已无武器`)
                }
                state.pendingResponseQueue.shift()
            }
            return
        }

        // ── 过河拆桥/顺手牵羊：使用者选目标的牌
        case ResponseType.TRICK_TARGET_CARD_PICK: {
            const ctx = pending.context as { trickType: 'dismantle' | 'steal'; targetIndex: number }
            const pickTarget = state.generals[ctx.targetIndex]
            if (!pickTarget?.alive) {
                state.pendingResponseQueue.shift()
                return
            }
            const pickerName = getGeneralName(targetGeneral)
            const targetName = getGeneralName(pickTarget)
            const action = (data as any).action as string
            // 日志标签：谋溃等技能复用本协议时用自定义标签
            const trickLabel = ((ctx as any).label as string | undefined)
                ?? (ctx.trickType === 'dismantle' ? '过河拆桥' : '顺手牵羊')
            // 本协议实际移除的牌（谋溃需判断是否为【闪】）
            let pickedCard: Card | undefined

            // 奇才（黄月英）：其他角色弃置其防具牌时取消之，因此该防具不算可选目标
            const armorLocked = hasSkill(pickTarget, 'huangyueying_qicai')
                && state.generals[state.activeGeneralIndex] !== pickTarget
            const hasAnyCard = pickTarget.hand.length > 0
                || Object.entries(pickTarget.equip).some(([slot, card]) => !!card && !(slot === 'armor' && armorLocked))
                || pickTarget.judgeZone.length > 0
            if (!hasAnyCard) {
                state.pendingResponseQueue.shift()
                return
            }

            if (action === 'hand') {
                // 统率：同阵营可精确指定 cardId，敌方仍随机
                if (pickTarget.hand.length === 0) return { error: '目标没有手牌' }
                const wantCardId = (data as any).cardId as string | undefined
                let card: Card | undefined
                if (wantCardId && targetGeneral.faction === pickTarget.faction) {
                    const exactIdx = pickTarget.hand.findIndex((c) => c.id === wantCardId)
                    if (exactIdx === -1) return { error: '目标没有此手牌' }
                    card = pickTarget.hand.splice(exactIdx, 1)[0]
                } else {
                    const randIdx = randomInt(pickTarget.hand.length)
                    card = pickTarget.hand.splice(randIdx, 1)[0]
                }
                pickedCard = card
                checkTuntian(state, pickTarget)
                triggerLianying(state, pickTarget)
                if (ctx.trickType === 'dismantle') {
                    state.discard.push(card)
                    addLog(state, `【${pickerName}】【${trickLabel}】弃了【${targetName}】的手牌${cardFullName(card)}`)
                    checkMingzhe(state, pickTarget, card)
                    maybeZongxuan(state, pickTarget, [card])
                } else {
                    targetGeneral.hand.push(card)
                    addLog(state, `【${pickerName}】【${trickLabel}】从【${targetName}】处拿了一张手牌${cardFullName(card)}`)
                }
            } else if (['weapon', 'armor', 'plus_horse', 'minus_horse'].includes(action)) {
                const slot = action as keyof typeof pickTarget.equip
                const equipCard = pickTarget.equip[slot]
                if (!equipCard) return { error: '目标该装备栏为空' }
                // 奇才（界黄月英）：其他角色弃置其防具牌时，取消之
                if (slot === 'armor' && hasSkill(pickTarget, 'huangyueying_qicai')
                    && state.generals[state.activeGeneralIndex] !== pickTarget) {
                    addLog(state, `【${targetName}】【奇才】取消了防具的弃置`)
                    return { error: '【奇才】取消了防具的弃置' }
                }
                clearEquipSlot(state, pickTarget, slot)
                triggerXiaoji(state, pickTarget)
                checkTuntian(state, pickTarget)
                pickedCard = equipCard
                if (ctx.trickType === 'dismantle') {
                    state.discard.push(equipCard)
                    addLog(state, `【${pickerName}】【${trickLabel}】弃了【${targetName}】的装备${cardFullName(equipCard)}`)
                    checkMingzhe(state, pickTarget, equipCard)
                    maybeZongxuan(state, pickTarget, [equipCard])
                } else {
                    targetGeneral.hand.push(equipCard)
                    addLog(state, `【${pickerName}】【${trickLabel}】从【${targetName}】处拿了装备${cardFullName(equipCard)}`)
                }
            } else if (action === 'judge') {
                // 判定区的牌
                const judgeCardId = (data as any).cardId as string | undefined
                if (!judgeCardId) return { error: '请指定判定区的牌' }
                const judgeIdx = pickTarget.judgeZone.findIndex((c: Card) => c.id === judgeCardId)
                if (judgeIdx === -1) return { error: '目标判定区没有此牌' }
                const judgeCard = pickTarget.judgeZone.splice(judgeIdx, 1)[0]
                const judgeName = judgeCard.name === TrickCardName.OVERINDULGENCE ? '乐不思蜀' : '兵粮寸断'
                // 恢复原始身份（断粮/国色转换的牌离开判定区后恢复原貌）
                if (judgeCard.originalName) {
                    judgeCard.name = judgeCard.originalName
                    judgeCard.category = judgeCard.originalCategory!
                    delete judgeCard.originalName
                    delete judgeCard.originalCategory
                    delete judgeCard.trickType
                }
                pickedCard = judgeCard
                if (ctx.trickType === 'dismantle') {
                    state.discard.push(judgeCard)
                    addLog(state, `【${pickerName}】【${trickLabel}】弃了【${targetName}】判定区的【${judgeName}】`)
                    maybeZongxuan(state, pickTarget, [judgeCard])
                } else {
                    targetGeneral.hand.push(judgeCard)
                    addLog(state, `【${pickerName}】【${trickLabel}】从【${targetName}】判定区拿了【${judgeName}】`)
                }
            } else {
                return { error: '无效选择' }
            }

            state.pendingResponseQueue.shift()

            // 旋风（凌统）：本次弃置后若仍有额度，继续选择角色弃牌
            const xuanfengRemaining = (ctx as any).xuanfengRemaining as number | undefined
            if (xuanfengRemaining !== undefined) {
                const left = xuanfengRemaining - 1
                const xfCandidates = state.generals
                    .map((g, idx) => ({ g, idx }))
                    .filter(({ g }) => g.alive && g !== targetGeneral &&
                        (g.hand.length > 0 || Object.values(g.equip).some(Boolean)))
                    .map(({ idx }) => idx)
                if (left > 0 && xfCandidates.length > 0) {
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.SKILL_CHOOSE_TARGET,
                        targetGeneralIndex: state.generals.indexOf(targetGeneral),
                        context: {
                            skillId: 'lingtong_xuanfeng',
                            skillName: '旋风',
                            description: '继续选择一名其他角色弃置其一张牌（或结束）',
                            candidateIndices: xfCandidates,
                            remaining: left,
                            xuanfengDiscardPhase: (ctx as any).xuanfengDiscardPhase,
                        },
                    })
                } else if ((ctx as any).xuanfengDiscardPhase && state.pendingResponseQueue.length === 0) {
                    finishTurn(state)
                }
            }

            // 谋溃（伏完）：弃到【闪】→ 此【杀】被抵消（走闪避成功的现有结算路径）
            const moukuiSlash = (ctx as any).moukuiSlash as {
                attackerGeneralIndex: number
                attackCard?: Card
                requiredDodges?: number
                targetIndex: number
            } | undefined
            if (moukuiSlash && pickedCard?.name === BasicCardName.DODGE
                && moukuiSlash.targetIndex === ctx.targetIndex) {
                addLog(state, `【${targetName}】被弃置了【闪】，【杀】被抵消（谋溃）`)
                handleDodgeSucceeded(state, pickTarget, moukuiSlash)
            }

            // 鞬出（庞德）：弃到装备则目标不能出闪，否则目标获得此【杀】
            if ((ctx as any).jianchuUserIndex !== undefined && pickedCard) {
                const userIdx = (ctx as any).jianchuUserIndex as number
                const jcUser = state.generals[userIdx]
                if (jcUser?.alive) {
                    // 界庞德：非基本牌即封锁【闪】并令本回合【杀】次数上限+1；基础庞德只看装备牌
                    const jcIsJie = jcUser.generalId === 'pangde_jie'
                    const jcBlockDodge = jcIsJie
                        ? pickedCard.category !== CardCategory.BASIC
                        : pickedCard.category === CardCategory.EQUIPMENT
                    if (jcBlockDodge) {
                        const dodgeIdx = state.pendingResponseQueue.findIndex(
                            p => p.type === ResponseType.DODGE && p.targetGeneralIndex === ctx.targetIndex
                        )
                        if (dodgeIdx >= 0) state.pendingResponseQueue.splice(dodgeIdx, 1)
                        if (jcIsJie) jcUser.extraSlashCount = (jcUser.extraSlashCount ?? 0) + 1
                        addLog(state, `【${getGeneralName(jcUser)}】【鞬出】弃到${jcIsJie ? '非基本牌' : '装备'}，【${targetName}】不能出【闪】`)
                        const killDmg = calcKillDamage(state, jcUser, pickTarget)
                        dealDamage(state, jcUser, pickTarget, killDmg, (ctx as any).attackCardId,
                            slashDamageOpts(jcUser, (ctx as any).attackCard))
                    } else {
                        const slashId = (ctx as any).attackCardId as string | undefined
                        const slashIdx = slashId ? state.discard.findIndex(c => c.id === slashId) : -1
                        if (slashIdx >= 0) {
                            pickTarget.hand.push(state.discard.splice(slashIdx, 1)[0])
                        }
                        addLog(state, `【${getGeneralName(jcUser)}】【鞬出】弃到手牌，【${targetName}】获得此【杀】`)
                    }
                }
                return
            }

            // 奇制（王基）：弃牌后该角色摸一张牌
            if ((ctx as any).qizhiUserIndex !== undefined && pickedCard) {
                const qzUser = state.generals[(ctx as any).qizhiUserIndex as number]
                if (qzUser) {
                    qzUser.qizhiCount = (qzUser.qizhiCount ?? 0) + 1
                    const drawn = drawCards(state, 1)
                    pickTarget.hand.push(...drawn)
                    addLog(state, `【${getGeneralName(pickTarget)}】因【奇制】摸 ${drawn.length} 张牌`)
                }
            }
            return
        }

        // ── 无懈可击已迁移到独立的 negateWindow 机制，不再通过 pendingResponseQueue 处理 ──

        // ── 万箭齐发：出闪或受伤
        case ResponseType.AOE_DODGE: {
            const ctx = pending.context as { sourceGeneralIndex: number; sourceCardId: string }
            // 舍宴（董允）：此牌对其无效
            if (targetGeneral.sheyanTrick && targetGeneral.sheyanTrick.turn === (state.turnSerial ?? 0)
                && targetGeneral.sheyanTrick.name === (ctx as any).trickCardName) {
                targetGeneral.sheyanTrick = undefined
                state.pendingResponseQueue.shift()
                addLog(state, `【${getGeneralName(targetGeneral)}】受到【舍宴】影响，${(ctx as any).trickCardName}对其无效`)
                return
            }
            const source = state.generals[ctx.sourceGeneralIndex]
            const action = (data as any).action as string | undefined

            // 八卦阵判定
            if (action === 'eight_trigrams') {
                if (!hasBaguaArmor(targetGeneral)) return { error: '未装备八卦阵' }
                if ((ctx as any).eightTrigramsUsed) return { error: '本次响应已使用过【八卦阵】' }
                if (state.deck.length === 0) return { error: '牌堆为空' }
                ;(ctx as any).eightTrigramsUsed = true
                performSkillJudge(state, targetGeneral, 'eight_trigrams', '八卦阵', {
                    pendingType: 'AOE_DODGE',
                })
                return
            }

            if (data.cardId) {
                const cardIdx = targetGeneral.hand.findIndex(c => c.id === data.cardId)
                if (cardIdx === -1) return { error: '手牌中没有此牌' }
                const card = targetGeneral.hand[cardIdx]
                if (!isCardUsableAsDodge(targetGeneral, card)) return { error: '此牌不能当【闪】使用' }
                if (blockedByQianxi(targetGeneral, card)) return { error: '【潜袭】：不能打出该颜色的手牌' }
                targetGeneral.hand.splice(cardIdx, 1)
                state.discard.push(card)
                checkMingzhe(state, targetGeneral, card)
                addLog(state, `【${getGeneralName(targetGeneral)}】出【闪】抵挡万箭齐发`)
            } else {
                addLog(state, `【${getGeneralName(targetGeneral)}】未出【闪】`)
                state.pendingResponseQueue.shift()
                dealDamage(state, source, targetGeneral, 1, ctx.sourceCardId)
                return
            }
            state.pendingResponseQueue.shift()
            // 雷击（张角）：打出【闪】后
            maybeTriggerLeiji(state, targetGeneral)
            return
        }

        // ── 南蛮入侵：出杀或受伤
        case ResponseType.AOE_ATTACK: {
            const ctx = pending.context as { sourceGeneralIndex: number; sourceCardId: string }
            // 舍宴（董允）：此牌对其无效
            if (targetGeneral.sheyanTrick && targetGeneral.sheyanTrick.turn === (state.turnSerial ?? 0)
                && targetGeneral.sheyanTrick.name === (ctx as any).trickCardName) {
                targetGeneral.sheyanTrick = undefined
                state.pendingResponseQueue.shift()
                addLog(state, `【${getGeneralName(targetGeneral)}】受到【舍宴】影响，${(ctx as any).trickCardName}对其无效`)
                return
            }
            const source = state.generals[ctx.sourceGeneralIndex]
            if (data.cardId) {
                const cardIdx = targetGeneral.hand.findIndex(c => c.id === data.cardId)
                if (cardIdx === -1) return { error: '手牌中没有此牌' }
                const card = targetGeneral.hand[cardIdx]
                if (!isCardUsableAsAttack(targetGeneral, card)) return { error: '此牌不能当【杀】使用' }
                if (blockedByQianxi(targetGeneral, card)) return { error: '【潜袭】：不能打出该颜色的手牌' }
                targetGeneral.hand.splice(cardIdx, 1)
                state.discard.push(card)
                checkMingzhe(state, targetGeneral, card)
                addLog(state, `【${getGeneralName(targetGeneral)}】出【杀】抵挡南蛮入侵`)
            } else {
                addLog(state, `【${getGeneralName(targetGeneral)}】未出【杀】`)
                state.pendingResponseQueue.shift()
                dealDamage(state, source, targetGeneral, 1, ctx.sourceCardId)
                return
            }
            state.pendingResponseQueue.shift()
            return
        }

        // ── 雌雄双股剑：目标选择弃1牌或让对方摸1牌
        case ResponseType.EQUIP_DOUBLE_SWORDS_CHOICE: {
            const ctx = pending.context as { attackerGeneralIndex: number }
            const attacker = state.generals[ctx.attackerGeneralIndex]
            const dsAction = (data as any).action as string

            if (dsAction === 'discard') {
                if (!data.cardId) return { error: '请选择一张手牌弃置' }
                const cardIdx = targetGeneral.hand.findIndex(c => c.id === data.cardId)
                if (cardIdx === -1) return { error: '手牌中找不到此牌' }
                const card = targetGeneral.hand.splice(cardIdx, 1)[0]
                state.discard.push(card)
                addLog(state, `【${getGeneralName(targetGeneral)}】弃置1张手牌（雌雄双股剑）`)
            } else {
                // draw：让攻击者摸1牌
                const drawn = drawCards(state, 1)
                attacker.hand.push(...drawn)
                addLog(state, `【${getGeneralName(targetGeneral)}】让【${getGeneralName(attacker)}】摸1张牌（雌雄双股剑）`)
            }
            state.pendingResponseQueue.shift()
            return
        }

        // ── 麒麟弓：选择弃哪匹马
        case ResponseType.EQUIP_KYLIN_BOW_CHOICE: {
            const ctx = pending.context as { targetIndex: number; killDamage: number; attackCard?: Card }
            const kbTarget = state.generals[ctx.targetIndex]
            const horseChoice = (data as any).action as string // 'plus' or 'minus'

            if (kbTarget?.alive) {
                if (horseChoice === 'plus' && kbTarget.equip.plus_horse) {
                    state.discard.push(kbTarget.equip.plus_horse)
                    clearEquipSlot(state, kbTarget, 'plus_horse')
                    addLog(state, `【${getGeneralName(targetGeneral)}】发动【麒麟弓】弃了【${getGeneralName(kbTarget)}】的+1马`)
                } else if (horseChoice === 'minus' && kbTarget.equip.minus_horse) {
                    state.discard.push(kbTarget.equip.minus_horse)
                    clearEquipSlot(state, kbTarget, 'minus_horse')
                    addLog(state, `【${getGeneralName(targetGeneral)}】发动【麒麟弓】弃了【${getGeneralName(kbTarget)}】的-1马`)
                }
            }

            // 先移除本 pending，再结算伤害（与 handleDodgeFailed 一致）
            // dealDamage 会 unshift 濒死询问（PEACH_SAVE_ASK）等到队列头；若先造伤后 shift，
            // 被移除的是刚 unshift 进来的濒死询问，本 pending 会留在队头被反复重入 → 目标体力无限下降
            state.pendingResponseQueue.shift()
            dealDamage(state, targetGeneral, kbTarget, ctx.killDamage, ctx.attackCard?.id, slashDamageOpts(null, ctx.attackCard))
            return
        }

        // ── 寒冰剑：攻击者选择弃目标的牌
        case ResponseType.EQUIP_ICE_SWORD_PICK: {
            const ctx = pending.context as { iceTargetIndex: number; remainingPicks: number }
            const iceTarget = state.generals[ctx.iceTargetIndex]
            if (!iceTarget?.alive) {
                state.pendingResponseQueue.shift()
                return
            }
            const action = (data as any).action as string

            const hasAnyCard = iceTarget.hand.length > 0 || Object.values(iceTarget.equip).some(Boolean)
            if (!hasAnyCard) {
                addLog(state, `【${getGeneralName(iceTarget)}】已无牌可弃，寒冰剑效果结束`)
                state.pendingResponseQueue.shift()
                return
            }

            if (action === 'hand') {
                // 随机弃一张手牌
                if (iceTarget.hand.length === 0) return { error: '目标没有手牌' }
                const randIdx = randomInt(iceTarget.hand.length)
                const card = iceTarget.hand.splice(randIdx, 1)[0]
                state.discard.push(card)
                addLog(state, `【${getGeneralName(targetGeneral)}】弃了【${getGeneralName(iceTarget)}】的手牌${cardFullName(card)}`)
                checkMingzhe(state, iceTarget, card)
                maybeZongxuan(state, iceTarget, [card])
            } else if (['weapon', 'armor', 'plus_horse', 'minus_horse'].includes(action)) {
                const slot = action as keyof typeof iceTarget.equip
                const equipCard = iceTarget.equip[slot]
                if (!equipCard) return { error: '目标该装备栏为空' }
                clearEquipSlot(state, iceTarget, slot)
                state.discard.push(equipCard)
                triggerXiaoji(state, iceTarget)
                addLog(state, `【${getGeneralName(targetGeneral)}】弃了【${getGeneralName(iceTarget)}】的装备${cardFullName(equipCard)}`)
                checkMingzhe(state, iceTarget, equipCard)
                maybeZongxuan(state, iceTarget, [equipCard])
            } else {
                return { error: '无效选择' }
            }

            ctx.remainingPicks -= 1
            // 检查目标是否还有牌
            const totalLeft = iceTarget.hand.length + Object.values(iceTarget.equip).filter(Boolean).length
            if (ctx.remainingPicks <= 0 || totalLeft === 0) {
                state.pendingResponseQueue.shift()
                addLog(state, `寒冰剑效果结束，不造成伤害`)
            }
            return
        }

        // ── 五谷丰登选牌
        case ResponseType.HARVEST_PICK: {
            const pool = state.harvestPool ?? []
            if (pool.length === 0) {
                state.pendingResponseQueue.shift()
                return
            }
            const pickedId = data.cardId
            const pickedIdx = pickedId ? pool.findIndex(c => c.id === pickedId) : -1
            let picked: Card
            if (pickedIdx >= 0) {
                picked = pool.splice(pickedIdx, 1)[0]
            } else {
                // 没选或选无效 → 默认第一张
                picked = pool.splice(0, 1)[0]
            }
            targetGeneral.hand.push(picked)
            rememberCards(state, state.generals.indexOf(targetGeneral), [picked], '五谷丰登')
            addLog(state, `【${getGeneralName(targetGeneral)}】从五谷丰登中选择了${cardFullName(picked)}`)

            state.pendingResponseQueue.shift()

            // 如果没有更多 HARVEST_PICK 待处理，剩余牌进弃牌堆
            const hasMore = state.pendingResponseQueue.some(p => p.type === ResponseType.HARVEST_PICK)
            if (!hasMore && pool.length > 0) {
                state.discard.push(...pool)
                addLog(state, `五谷丰登剩余 ${pool.length} 张牌进入弃牌堆`)
                state.harvestPool = undefined
            }
            return
        }

        // ── 濒死询问：出桃 / 救主 / 急救 / 跳过
        case ResponseType.PEACH_SAVE_ASK: {
            const ctx = pending.context as {
                dyingGeneralIndex: number
                attackerGeneralIndex: number
                remainingAskers: number[]
                neededHp: number
                damageCardId?: string
                damageAmount?: number
                /** false = 因失去体力（非伤害）进入濒死 */
                dyingFromDamage?: boolean
            }
            const dyingGeneral = state.generals[ctx.dyingGeneralIndex]
            const attacker = ctx.attackerGeneralIndex >= 0 ? state.generals[ctx.attackerGeneralIndex] : null

            if (!dyingGeneral || dyingGeneral.hp > 0) {
                // 已被救，清除
                state.pendingResponseQueue.shift()
                return
            }

            const action = data.action

            // 完杀②（界贾诩）：濒死结算期间，除濒死者和其以外的角色非锁定技失效
            if (action && action !== 'peach' && action !== 'skip_all' && action !== 'decline'
                && isSkillSuppressedByWansha(state, targetGeneral)) {
                return { error: '【完杀】：此濒死结算期间你的非锁定技失效' }
            }

            if (action === 'peach' && data.cardId) {
                // 使用桃
                const cardIdx = targetGeneral.hand.findIndex(c => c.id === data.cardId)
                if (cardIdx === -1) return { error: '手牌中找不到此牌' }
                const card = targetGeneral.hand[cardIdx]
                const isWineSave = card.name === BasicCardName.WINE && targetGeneral === dyingGeneral
                const lhHeartSave = hasSkill(targetGeneral, 'shenzhaoyun_longhun') && card.suit === CardSuit.HEART
                if (card.name !== BasicCardName.PEACH && !isWineSave && !lhHeartSave) return { error: '此牌不是【桃】' }
                if (blockedByQianxi(targetGeneral, card)) return { error: '【潜袭】：不能使用该颜色的手牌' }
                targetGeneral.hand.splice(cardIdx, 1)
                state.discard.push(card)
                checkMingzhe(state, targetGeneral, card)
                dyingGeneral.hp = Math.min(dyingGeneral.hp + 1, dyingGeneral.maxHp); if (dyingGeneral.hp > 0) triggerJuejing(state, dyingGeneral, 'leave')
                addLog(state, `【${getGeneralName(targetGeneral)}】${lhHeartSave && card.name !== BasicCardName.PEACH
                    ? `发动【龙魂】，将${cardFullName(card)}当【桃】使用` : `使用【${isWineSave ? '酒' : '桃'}】`}，【${getGeneralName(dyingGeneral)}】回复至 ${dyingGeneral.hp}/${dyingGeneral.maxHp}`)
                triggerDianhuRecover(state, dyingGeneral)
                if (dyingGeneral.hp > 0) {
                    state.pendingResponseQueue.shift()
                    // 被救活后触发受伤被动技能
                    if (ctx.dyingFromDamage !== false) triggerDamagePassiveSkills(state, attacker, dyingGeneral, ctx.damageCardId, ctx.damageAmount ?? 1)
                } else {
                    // 还需要更多桃
                    ctx.neededHp = 1 - dyingGeneral.hp
                }
                return
            }

            if (action === 'huomo') {
                // 活墨（钟繇）：将一张黑色非基本牌置于牌堆顶，视为使用【桃】（自救也可用【酒】）
                if (!hasSkill(targetGeneral, 'zhongyao_huomo')) return { error: '你没有【活墨】' }
                if (!data.cardId) return { error: '请选择一张黑色非基本牌' }
                const hmIdx = targetGeneral.hand.findIndex(c => c.id === data.cardId)
                if (hmIdx === -1) return { error: '手牌中找不到此牌' }
                const hmCard = targetGeneral.hand[hmIdx]
                const hmBlack = hmCard.suit === CardSuit.SPADE || hmCard.suit === CardSuit.CLUB
                if (hmCard.category === CardCategory.BASIC || !hmBlack) {
                    return { error: '【活墨】须将一张黑色非基本牌置于牌堆顶' }
                }
                const hmCandidates = targetGeneral === dyingGeneral
                    ? [BasicCardName.PEACH, BasicCardName.WINE]
                    : [BasicCardName.PEACH]
                const hmName = hmCandidates.find(n => !(targetGeneral.basicUsedThisTurn ?? []).includes(n))
                if (!hmName) return { error: '【活墨】本回合已经使用过【桃】与【酒】' }
                if (blockedByQianxi(targetGeneral, hmCard)) return { error: '【潜袭】：不能使用该颜色的手牌' }
                targetGeneral.hand.splice(hmIdx, 1)
                state.deck.unshift(hmCard)
                markBasicUsed(targetGeneral, hmName)
                dyingGeneral.hp = Math.min(dyingGeneral.hp + 1, dyingGeneral.maxHp); if (dyingGeneral.hp > 0) triggerJuejing(state, dyingGeneral, 'leave')
                addLog(state, `【${getGeneralName(targetGeneral)}】发动【活墨】，将${cardFullName(hmCard)}置于牌堆顶，视为使用【${cardDisplayName({ name: hmName })}】，【${getGeneralName(dyingGeneral)}】回复至 ${dyingGeneral.hp}/${dyingGeneral.maxHp}`)
                triggerDianhuRecover(state, dyingGeneral)
                if (dyingGeneral.hp > 0) {
                    state.pendingResponseQueue.shift()
                    if (ctx.dyingFromDamage !== false) triggerDamagePassiveSkills(state, attacker, dyingGeneral, ctx.damageCardId, ctx.damageAmount ?? 1)
                } else {
                    ctx.neededHp = 1 - dyingGeneral.hp
                }
                return
            }

            if (action === 'chunlao') {
                // 醇醪（程普）：移去“醇”，令濒死角色视为使用一张【酒】
                // 界程普：移去 X 张（X 为本轮以此法使用【酒】的次数）
                if (!hasSkill(targetGeneral, 'chengpu_chunlao')) return { error: '你没有【醇醪】' }
                const chunPile = targetGeneral.generalPile ?? []
                if (chunPile.length === 0) return { error: '武将牌上没有“醇”' }
                const jieChunlao = hasSkill(targetGeneral, 'chengpu_jie_lihuo')
                const nowRound = state.roundState?.roundNumber ?? 0
                const usedThisRound = jieChunlao && targetGeneral.chunlaoWineRound === nowRound
                    ? (targetGeneral.chunlaoWineCount ?? 0) : 0
                const chunCost = jieChunlao ? usedThisRound : 1
                if (jieChunlao && usedThisRound > chunPile.length) {
                    return { error: `【醇醪】需移去 ${usedThisRound} 张“醇”，数量不足` }
                }
                const chunRemoved = chunPile.splice(0, chunCost)
                state.discard.push(...chunRemoved)
                if (jieChunlao) {
                    targetGeneral.chunlaoWineRound = nowRound
                    targetGeneral.chunlaoWineCount = usedThisRound + 1
                }
                dyingGeneral.hp = Math.min(dyingGeneral.hp + 1, dyingGeneral.maxHp); if (dyingGeneral.hp > 0) triggerJuejing(state, dyingGeneral, 'leave')
                addLog(state, `【${getGeneralName(targetGeneral)}】发动【醇醪】，移去${chunRemoved.length}张“醇”，【${getGeneralName(dyingGeneral)}】视为使用一张【酒】`)
                triggerDianhuRecover(state, dyingGeneral)
                if (dyingGeneral.hp > 0) {
                    state.pendingResponseQueue.shift()
                    if (ctx.dyingFromDamage !== false) triggerDamagePassiveSkills(state, attacker, dyingGeneral, ctx.damageCardId, ctx.damageAmount ?? 1)
                } else {
                    ctx.neededHp = 1 - dyingGeneral.hp
                }
                return
            }

            if (action === 'jiuzhu') {
                // 赵云救主：失去1血弃1牌（手牌或装备），救回濒死角色
                if (!hasSkill(targetGeneral, 'zhaoyun_jiuzhu')) return { error: '你没有【救主】技能' }
                if (targetGeneral === dyingGeneral) return { error: '不能对自己使用救主' }
                if (targetGeneral.faction !== dyingGeneral.faction) return { error: '只能救己方角色' }
                if (targetGeneral.hp <= 1) return { error: '体力不足（需>1）' }
                const totalCards = targetGeneral.hand.length + Object.values(targetGeneral.equip).filter(Boolean).length
                if (totalCards === 0) return { error: '没有牌可弃' }
                // 弃1张牌（手牌或装备）
                if (!data.cardId) return { error: '请选择一张牌弃置' }
                const removed = removeCardFromHandOrEquip(state, targetGeneral, data.cardId)
                if ('error' in removed) return removed
                dyingGeneral.hp = 1
                addLog(state, `【${getGeneralName(targetGeneral)}】发动【救主】，弃1牌，救回【${getGeneralName(dyingGeneral)}】`)
                loseHp(state, targetGeneral, 1)
                state.pendingResponseQueue.shift()
                // 被救活后触发受伤被动技能
                if (ctx.dyingFromDamage !== false) triggerDamagePassiveSkills(state, attacker, dyingGeneral, ctx.damageCardId, ctx.damageAmount ?? 1)
                return
            }

            if (action === 'jijiu' && data.cardId) {
                // 华佗急救：红色牌当桃（支持手牌和装备牌）
                if (!hasSkill(targetGeneral, 'huatuo_jijiu')) return { error: '你没有【急救】技能' }
                // 规则：急救只能在回合外使用。回合内（华佗即当前回合角色）兜底拒绝，
                // 不返回 error（避免调用方重试造成卡死），而是回退到下方的「放弃」逻辑
                const activeGeneral = getActiveGeneral(state)
                if (activeGeneral === targetGeneral) {
                    addLog(state, `【${getGeneralName(targetGeneral)}】回合内不能发动【急救】，视为放弃救援`)
                } else {
                    const card = findCardInHandOrEquip(targetGeneral, data.cardId)
                    if (!card) return { error: '找不到此牌' }
                    if (card.suit !== CardSuit.HEART && card.suit !== CardSuit.DIAMOND) return { error: '急救需要红色牌' }
                    removeCardFromHandOrEquip(state, targetGeneral, data.cardId)
                    dyingGeneral.hp = Math.min(dyingGeneral.hp + 1, dyingGeneral.maxHp); if (dyingGeneral.hp > 0) triggerJuejing(state, dyingGeneral, 'leave')
                    addLog(state, `【${getGeneralName(targetGeneral)}】发动【急救】，【${getGeneralName(dyingGeneral)}】回复至 ${dyingGeneral.hp}/${dyingGeneral.maxHp}`)
                    triggerDianhuRecover(state, dyingGeneral)
                    if (dyingGeneral.hp > 0) {
                        state.pendingResponseQueue.shift()
                        // 被救活后触发受伤被动技能
                        if (ctx.dyingFromDamage !== false) triggerDamagePassiveSkills(state, attacker, dyingGeneral, ctx.damageCardId, ctx.damageAmount ?? 1)
                    }
                    return
                }
            }

            // 全部跳过：不再逐个询问，直接判定阵亡
            if (action === 'skip_all') {
                ctx.remainingAskers.length = 0
                state.pendingResponseQueue.shift()
                addLog(state, `【${getGeneralName(dyingGeneral)}】无人救援`)
                handleDeath(state, attacker, dyingGeneral)
                return
            }

            // 跳过 → 轮转到下一个角色
            if (ctx.remainingAskers.length > 0) {
                const nextAskerIdx = ctx.remainingAskers.shift()!
                // 换成新对象：调用方靠对象身份判断这一步是否真的推进了（原地改下标会被当成卡死）
                state.pendingResponseQueue.shift()
                state.pendingResponseQueue.unshift({
                    type: ResponseType.PEACH_SAVE_ASK,
                    targetGeneralIndex: nextAskerIdx,
                    context: { ...(pending.context as any) },
                })
                addLog(state, `请【${getGeneralName(state.generals[nextAskerIdx])}】选择是否使用【桃】救援【${getGeneralName(dyingGeneral)}】`)
            } else {
                // 全部跳过 → 死亡
                state.pendingResponseQueue.shift()
                handleDeath(state, attacker, dyingGeneral)
            }
            return
        }

        // ── 判定介入：鬼才/缓释/鬼道 — 打出牌替换判定牌 或 跳过
        case ResponseType.JUDGE_INTERVENE: {
            const ctx = pending.context as any
            const judgingGeneral = state.generals[ctx.judgingGeneralIndex]
            const isSkillJudge = !!ctx.judgeType // 技能判定 vs 延时锦囊判定
            const declinedIntervenors: number[] = ctx.declinedIntervenors ?? []

            if (data.cardId) {
                const isHuanshi = hasSkill(targetGeneral, 'zhugejin_huanshi')
                const isGuidao = !isHuanshi && hasSkill(targetGeneral, 'zhangjiao_guidao')
                const isJieGuicai = !isHuanshi && !isGuidao && hasSkill(targetGeneral, 'simayi_jie_guicai')
                let replacementCard: Card
                if (isHuanshi || isGuidao || isJieGuicai) {
                    // 缓释 / 鬼道：手牌或装备区均可
                    if (isGuidao) {
                        const picked = findCardInHandOrEquip(targetGeneral, data.cardId)
                        if (!picked) return { error: '找不到该牌' }
                        if (picked.suit !== CardSuit.SPADE && picked.suit !== CardSuit.CLUB) {
                            return { error: '鬼道须使用黑色牌' }
                        }
                    }
                    const result = removeCardFromHandOrEquip(state, targetGeneral, data.cardId)
                    if ('error' in result) return result
                    replacementCard = result
                } else {
                    // 鬼才：只能用手牌
                    const cardIdx = targetGeneral.hand.findIndex(c => c.id === data.cardId)
                    if (cardIdx === -1) return { error: '手牌中没有此牌' }
                    replacementCard = targetGeneral.hand.splice(cardIdx, 1)[0]
                    state.discard.push(replacementCard)
                }

                const skillName = judgeInterveneSkillName(targetGeneral)
                addLog(state, `【${getGeneralName(targetGeneral)}】发动【${skillName}】，将判定牌替换为${cardFullName(replacementCard)}`)
                // 鬼道（张角）：打出的替换牌为黑桃时摸一张
                if (isGuidao && replacementCard.suit === CardSuit.SPADE) {
                    const guidaoDraw = drawCards(state, 1)
                    targetGeneral.hand.push(...guidaoDraw)
                    addLog(state, `【${getGeneralName(targetGeneral)}】【鬼道】以黑桃替换判定，摸 ${guidaoDraw.length} 张牌`)
                }

                // 替换牌已在上面各分支放入弃牌堆（鬼才：splice 后 push；鬼道/缓释：removeCardFromHandOrEquip 内 push）
                // 此处不可重复 push，否则同一张牌会在弃牌堆出现两次，洗牌后牌堆出现重牌

                state.pendingResponseQueue.shift()

                // 修改者加入已询问列表，继续询问剩余介入者
                const newDeclined = [...declinedIntervenors, state.generals.indexOf(targetGeneral)]
                const nextIntervenor = findJudgeIntervenor(state, judgingGeneral, newDeclined)

                if (nextIntervenor) {
                    // 还有其他人可以介入 → 继续询问
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.JUDGE_INTERVENE,
                        targetGeneralIndex: state.generals.indexOf(nextIntervenor),
                        context: {
                            ...ctx,
                            judgeCardId: replacementCard.id,
                            judgeCard: replacementCard,
                            declinedIntervenors: newDeclined,
                        },
                    })
                    const nextSkillName = judgeInterveneSkillName(nextIntervenor)
                    addLog(state, `【${getGeneralName(nextIntervenor)}】可发动【${nextSkillName}】修改判定`)
                    return
                }

                // 无人介入 → 结算
                if (isSkillJudge) {
                    resolveSkillJudge(state, judgingGeneral, replacementCard, ctx.judgeType as SkillJudgeType, ctx)
                    continueFromPrepPhase(state)
                } else {
                    const delayedCard = judgingGeneral.judgeZone.find((c: Card) => c.id === ctx.delayedTrickCardId)
                        ?? state.discard.find((c: Card) => c.id === ctx.delayedTrickCardId)
                    if (delayedCard && judgingGeneral) {
                        continueJudgePhase(state, judgingGeneral, replacementCard, delayedCard,
                            ctx.toJudgeCardIds, ctx.currentJudgeIndex, ctx.skipAction, ctx.skipDraw)
                    }
                }
            } else {
                // 跳过 → 查找下一个介入者
                addLog(state, `【${getGeneralName(targetGeneral)}】放弃修改判定`)

                const newDeclined = [...declinedIntervenors, pending.targetGeneralIndex]
                const nextIntervenor = findJudgeIntervenor(state, judgingGeneral, newDeclined)

                if (nextIntervenor) {
                    // 还有人可以介入 → 换成新对象指向下一个介入者（对象身份用于判断这一步是否推进）
                    const nextIntervenorIdx = state.generals.indexOf(nextIntervenor)
                    state.pendingResponseQueue.shift()
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.JUDGE_INTERVENE,
                        targetGeneralIndex: nextIntervenorIdx,
                        context: { ...ctx, declinedIntervenors: newDeclined },
                    })
                    const nextSkillName = judgeInterveneSkillName(nextIntervenor)
                    addLog(state, `【${getGeneralName(nextIntervenor)}】可发动【${nextSkillName}】修改判定`)
                    return
                }

                // 无人介入 → 用原判定牌结算
                state.pendingResponseQueue.shift()

                const origJudgeCard = state.discard.find((c: Card) => c.id === ctx.judgeCardId)
                    ?? (ctx.judgeCard as Card | undefined)
                if (!origJudgeCard || !judgingGeneral) return

                if (isSkillJudge) {
                    resolveSkillJudge(state, judgingGeneral, origJudgeCard, ctx.judgeType as SkillJudgeType, ctx)
                    continueFromPrepPhase(state)
                } else {
                    const delayedCard = judgingGeneral.judgeZone.find((c: Card) => c.id === ctx.delayedTrickCardId)
                        ?? state.discard.find((c: Card) => c.id === ctx.delayedTrickCardId)
                    if (delayedCard) {
                        continueJudgePhase(state, judgingGeneral, origJudgeCard, delayedCard,
                            ctx.toJudgeCardIds, ctx.currentJudgeIndex, ctx.skipAction, ctx.skipDraw)
                    }
                }
            }
            return
        }

        // ── 雷击（张角）：选择令哪名存活角色判定（可放弃）
        case ResponseType.SKILL_LEIJI_TARGET: {
            const leijiAction = (data as any).action as string | undefined
            const chosenIdx = (data as any).targetIndex as number | undefined
            if (leijiAction === 'decline' || chosenIdx === undefined) {
                addLog(state, `【${getGeneralName(targetGeneral)}】放弃发动【雷击】`)
                state.pendingResponseQueue.shift()
                return
            }
            const judgeTarget = state.generals[chosenIdx]
            if (!judgeTarget || !judgeTarget.alive) return { error: '目标不存在或已死亡' }

            const sourceIdx = state.generals.indexOf(targetGeneral)
            state.pendingResponseQueue.shift()
            addLog(state, `【${getGeneralName(targetGeneral)}】发动【雷击】，令【${getGeneralName(judgeTarget)}】判定`)
            // 判定牌归属被指定的角色
            performSkillJudge(state, judgeTarget, 'leiji', '雷击', {
                leijiSourceIndex: sourceIdx,
                leijiTargetIndex: chosenIdx,
            })
            return
        }

        // ── 刚烈（夏侯惇-竞）：选择令哪名敌方角色判定（可放弃）
        case ResponseType.SKILL_GANGLIE_TARGET: {
            const ganglieAction = (data as any).action as string | undefined
            const chosenIdx = (data as any).targetIndex as number | undefined
            if (ganglieAction === 'decline' || chosenIdx === undefined) {
                addLog(state, `【${getGeneralName(targetGeneral)}】放弃发动【刚烈】`)
                state.pendingResponseQueue.shift()
                return
            }
            const judgeTarget = state.generals[chosenIdx]
            if (!judgeTarget || !judgeTarget.alive) return { error: '目标不存在或已死亡' }
            if (judgeTarget.faction === targetGeneral.faction) return { error: '须选择一名敌方角色' }
            state.pendingResponseQueue.shift()
            addLog(state, `【${getGeneralName(targetGeneral)}】发动【刚烈】，令【${getGeneralName(judgeTarget)}】判定`)
            performSkillJudge(state, judgeTarget, 'ganglie', '刚烈', {
                attackerGeneralIndex: chosenIdx,
                ganglieSourceIndex: state.generals.indexOf(targetGeneral),
            })
            return
        }

        // ── 说盟（孙乾）：选择拼点对象
        // ── 通用：技能选择目标（谦雅 / 旋风 / 弘援） ──
        case ResponseType.SKILL_CHOOSE_TARGET: {
            const ctx = pending.context as any
            const skillId = ctx.skillId as string
            const candidates = (ctx.candidateIndices as number[]) ?? []
            const singleIdx = (data as any).targetIndex as number | undefined
            const multiIdx = (data as any).targetIndices as number[] | undefined

            // 洛书版扩展（九）
            const expT = expTargetA(state, targetGeneral, pending, (data as any).action, ctx, singleIdx)
            if (expT !== EXP_UNHANDLED) return expT

            if ((data as any).action === 'decline') {
                state.pendingResponseQueue.shift()
                if (skillId === 'dongyun_sheyan' && ctx.sheyanDefer) {
                    resumeSheyanUse(state, ctx)
                    return
                }
                // 求援（界伏皇后）：放弃发动也要把被延迟的这张牌接着结算完，
                // 否则【杀】会凭空消失（不造成伤害、不进弃牌堆）
                if (skillId === 'fuhuanghou_xuanqiu' && ctx.xuanqiuCardId) {
                    addLog(state, `【${getGeneralName(targetGeneral)}】放弃发动【求援】`)
                    resumeXuanqiuUse(state, ctx)
                    return
                }
                if (skillId === 'lingtong_xuanfeng' && (ctx as any).xuanfengDiscardPhase
                    && state.pendingResponseQueue.length === 0) {
                    finishTurn(state)
                }
                // 好施（鲁肃）：必须交牌，但界面仍可能放弃——不交也要把阶段推进下去
                if (skillId === 'lusu_haoshi') {
                    if (ctx.haoshiSkipAction) {
                        state.turnPhase = TurnPhase.DISCARD
                        if (targetGeneral.hand.length <= targetGeneral.hp) finishTurn(state)
                    } else {
                        beginActionPhase(state, targetGeneral)
                    }
                }
                if (skillId === 'guyong_bingyi' || skillId === 'yufan_zhiyan'
                    || skillId === 'cenhun_jishe_end' || skillId === 'haozhao_zhengu') {
                    advanceTurnGuarded(state)
                }
                if (skillId === 'xiahoushi_yanyu_end') {
                    continueAfterYanyu(state)
                }
                // 结束阶段技能（平寇/兴学/罪论/绝策）放弃 → 继续推进回合
                if ((ctx as any).endPhaseSkill) {
                    advanceTurnGuarded(state)
                }
                return
            }

            // 舍宴（董允）：令此牌额外指定或取消一名目标
            if (skillId === 'dongyun_sheyan') {
                if (ctx.sheyanDefer) {
                    if (singleIdx !== undefined && !candidates.includes(singleIdx)) return { error: '目标无效' }
                    state.pendingResponseQueue.shift()
                    resumeSheyanUse(state, ctx, singleIdx)
                    return
                }
                if (singleIdx === undefined) return { error: '请选择一名其他目标' }
                const sheyanChosen = state.generals[singleIdx]
                if (!sheyanChosen?.alive) return { error: '目标无效' }
                sheyanChosen.sheyanTrick = { name: ctx.sheyanCardName as string, turn: state.turnSerial ?? 0 }
                state.pendingResponseQueue.shift()
                addLog(state, `【${getGeneralName(targetGeneral)}】发动【舍宴】，【${getGeneralName(sheyanChosen)}】不受${cardDisplayName({ name: ctx.sheyanCardName } as any)}影响`)
                return
            }

            // ── 洛书版扩展（七） ──
            // 慎断（韩浩史涣）：目标判定区置入【兵粮寸断】
            if (skillId === 'hanhaosihuan_shenduan') {
                if (singleIdx === undefined || !candidates.includes(singleIdx)) return { error: '请选择一名角色' }
                state.pendingResponseQueue.shift()
                const sdCard = state.discard.find(c => c.id === ctx.shenduanCardId)
                const sdTarget = state.generals[singleIdx]
                if (!sdCard || !sdTarget) return
                state.discard.splice(state.discard.indexOf(sdCard), 1)
                putDelayedTrickAs(state, sdTarget, sdCard, TrickCardName.SUPPLY_SHORTAGE,
                    `【${getGeneralName(targetGeneral)}】发动【慎断】，将${cardFullName(sdCard)}当【兵粮寸断】置入【${getGeneralName(sdTarget)}】的判定区`)
                return
            }

            // 下书（阚泽）：所有手牌交给目标，目标展示任意张手牌
            if (skillId === 'kanze_xiashu') {
                if (singleIdx === undefined || !candidates.includes(singleIdx)) return { error: '请选择一名角色' }
                state.pendingResponseQueue.shift()
                const xsTarget = state.generals[singleIdx]
                if (!xsTarget?.alive) return
                const xsHand = [...targetGeneral.hand]
                targetGeneral.hand = []
                xsTarget.hand.push(...xsHand)
                addLog(state, `【${getGeneralName(targetGeneral)}】发动【下书】，将所有手牌交给【${getGeneralName(xsTarget)}】`)
                if (xsTarget.hand.length === 0) return
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_PICK_CARD,
                    targetGeneralIndex: singleIdx,
                    context: {
                        skillId: 'kanze_xiashu_show', skillName: '下书',
                        description: '展示任意张手牌（未选择的视为未展示）',
                        count: xsTarget.hand.length,
                        mode: 'show',
                        candidateCardIds: xsTarget.hand.map(c => c.id),
                        xiashuOwnerIndex: state.generals.indexOf(targetGeneral),
                        xiashuTargetIndex: singleIdx,
                    },
                })
                return
            }

            // 宽释（阚泽）：指定被保护的角色
            if (skillId === 'kanze_kuanshi') {
                if (singleIdx === undefined || !candidates.includes(singleIdx)) return { error: '请选择一名角色' }
                state.pendingResponseQueue.shift()
                const ksTarget = state.generals[singleIdx]
                if (ksTarget) {
                    ksTarget.kuanshiSourceIndex = state.generals.indexOf(targetGeneral)
                    addLog(state, `【${getGeneralName(targetGeneral)}】发动【宽释】，选择【${getGeneralName(ksTarget)}】`)
                }
                advanceTurnGuarded(state)
                return
            }

            // 清正（界曹操）：选择观看手牌的角色
            if (skillId === 'caocao_jie_qingzheng') {
                if (singleIdx === undefined || !candidates.includes(singleIdx)) return { error: '请选择一名角色' }
                state.pendingResponseQueue.shift()
                const qzTarget = state.generals[singleIdx]
                if (!qzTarget?.alive) return
                const qzSuits = [...new Set(qzTarget.hand.map(c => c.suit))] as CardSuit[]
                const qzList = qzTarget.hand
                    .map(c => `${SUIT_SYMBOL[c.suit] ?? ''}${c.value} ${cardDisplayName(c)}`).join('、')
                if (qzSuits.length === 0) {
                    addLog(state, `【${getGeneralName(targetGeneral)}】发动【清正】，【${getGeneralName(qzTarget)}】没有手牌`)
                    return
                }
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                    targetGeneralIndex: state.generals.indexOf(targetGeneral),
                    context: {
                        skillId: 'caocao_jie_qingzheng_pick', skillName: '清正',
                        description: `【${getGeneralName(qzTarget)}】的手牌：${qzList}。选择弃置其中一种花色的所有牌`,
                        options: qzSuits.map(s => ({ action: s, label: `${SUIT_SYMBOL[s] ?? s} 全部弃置` })),
                        qingzhengTargetIndex: singleIdx,
                        qingzhengSuit: ctx.qingzhengSuit,
                    },
                })
                return
            }

            // 好施（鲁肃）：选定手牌最少的角色后，再选交给其的牌
            if (skillId === 'lusu_haoshi') {
                if (singleIdx === undefined || !candidates.includes(singleIdx)) return { error: '请选择一名合法角色' }
                state.pendingResponseQueue.shift()
                const hsCount = Math.max(1, (ctx.haoshiCount as number) ?? 1)
                askPickCard(state, targetGeneral, 'lusu_haoshi_give', '好施',
                    `交给【${getGeneralName(state.generals[singleIdx])}】${hsCount}张手牌`, {
                        count: hsCount,
                        mode: 'give',
                        extra: {
                            haoshiReceiverIndex: singleIdx,
                            haoshiSkipAction: ctx.haoshiSkipAction,
                            exactCount: true,
                        },
                    })
                return
            }

            // 节命（界荀彧）：指定一名角色摸X张
            if (skillId === 'xunyu_jieming') {
                if (singleIdx === undefined || !candidates.includes(singleIdx)) return { error: '请选择一名角色' }
                state.pendingResponseQueue.shift()
                applyJieming(state, state.generals[singleIdx])
                return
            }

            // 励战（曹仁）：任意名已受伤的角色各摸一张牌
            if (skillId === 'caoren_lizhan') {
                state.pendingResponseQueue.shift()
                const lzPicks = ((data as any).targetIndices as number[] | undefined) ?? []
                for (const i of lzPicks) {
                    if (!candidates.includes(i)) continue
                    const lzG = state.generals[i]
                    if (!lzG?.alive) continue
                    const lzDrawn = drawForGeneral(state, lzG, 1)
                    lzG.hand.push(...lzDrawn)
                    addLog(state, `【${getGeneralName(lzG)}】因【励战】摸${lzDrawn.length}张牌`)
                }
                advanceTurnGuarded(state)
                return
            }

            // 邀名（界全琮）：按其与目标的手牌数差结算，然后本回合【赈赡】无次数限制
            if (skillId === 'quancong_yaoming') {
                if (singleIdx === undefined || !candidates.includes(singleIdx)) return { error: '请选择一名角色' }
                state.pendingResponseQueue.shift()
                const qcOwner = targetGeneral
                const qcOther = state.generals[singleIdx]
                if (!qcOther?.alive) return
                qcOwner.zhenshanFreeSeat = singleIdx
                const qcDiff = qcOther.hand.length - qcOwner.hand.length
                if (qcDiff > 0) {
                    const qcCard = discardRandomHandCardOf(state, qcOwner, qcOther)
                    if (qcCard) {
                        addLog(state, `【${getGeneralName(qcOwner)}】发动【邀名】，弃置【${getGeneralName(qcOther)}】的${cardFullName(qcCard)}`)
                    }
                } else if (qcDiff < 0) {
                    const qcDrawn = drawForGeneral(state, qcOther, 1)
                    qcOther.hand.push(...qcDrawn)
                    addLog(state, `【${getGeneralName(qcOwner)}】发动【邀名】，令【${getGeneralName(qcOther)}】摸${qcDrawn.length}张牌`)
                } else {
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                        targetGeneralIndex: state.generals.indexOf(qcOwner),
                        context: {
                            skillId: 'quancong_yaoming_equal',
                            skillName: '邀名',
                            description: '双方手牌数相同：弃置其一张牌，或令其摸一张牌',
                            options: [
                                { action: 'discard', label: '弃置其一张牌' },
                                { action: 'draw', label: '令其摸一张牌' },
                            ],
                            yaomingTargetIndex: singleIdx,
                        },
                    })
                    return
                }
                addLog(state, `【${getGeneralName(qcOwner)}】因【邀名】，【${getGeneralName(qcOther)}】的回合内发动【赈赡】无次数限制`)
                return
            }

            // 放权（刘禅）：选定获得额外回合的角色，再弃一张手牌
            if (skillId === 'liushan_fangquan') {
                state.pendingResponseQueue.shift()
                if (singleIdx === undefined || !candidates.includes(singleIdx)) {
                    state.turnPhase = TurnPhase.ACTION
                    addLog(state, '【放权】未选择角色，取消发动')
                    return
                }
                state.turnPhase = TurnPhase.TURN_END
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_PICK_CARD,
                    targetGeneralIndex: state.generals.indexOf(targetGeneral),
                    context: {
                        skillId: 'liushan_fangquan', skillName: '放权', count: 1, mode: 'discard',
                        description: '弃置一张手牌，令其执行额外回合',
                        fangquanTargetIndex: singleIdx, endPhase: true,
                    },
                })
                return
            }

            // 征荣（毌丘俭）：取一名目标角色的一张手牌置于武将牌上
            if (skillId === 'guanqiujian_zhengrong') {
                if (singleIdx === undefined || !candidates.includes(singleIdx)) return { error: '请选择一名目标角色' }
                state.pendingResponseQueue.shift()
                const zrVictim = state.generals[singleIdx]
                if (zrVictim?.alive && zrVictim.hand.length > 0) {
                    const zrCard = zrVictim.hand.splice(randomInt(zrVictim.hand.length), 1)[0]
                    targetGeneral.generalPile = [...(targetGeneral.generalPile ?? []), zrCard]
                    addLog(state, `【${getGeneralName(targetGeneral)}】发动【征荣】，将【${getGeneralName(zrVictim)}】的一张牌置于武将牌上，称为“荣”`)
                }
                return
            }

            // 清侧（毌丘俭）：弃置场上的一张牌
            if (skillId === 'guanqiujian_qingce') {
                if (singleIdx === undefined || !candidates.includes(singleIdx)) return { error: '请选择一名角色' }
                state.pendingResponseQueue.shift()
                state.pendingResponseQueue.unshift({
                    type: ResponseType.TRICK_TARGET_CARD_PICK,
                    targetGeneralIndex: state.generals.indexOf(targetGeneral),
                    context: { trickType: 'dismantle', targetIndex: singleIdx, label: '清侧' },
                })
                return
            }

            if (skillId === 'gongsunyuan_huaiyi') {
                const picks = [...new Set((multiIdx ?? (singleIdx !== undefined ? [singleIdx] : []))
                    .filter(idx => candidates.includes(idx)))]
                if (picks.length === 0) return { error: '请选择至少一名角色' }
                const hyMax = (ctx.maxPicks as number) ?? picks.length
                if (picks.length > hyMax) return { error: `最多选择 ${hyMax} 名角色` }
                state.pendingResponseQueue.shift()
                let hyGained = 0
                for (const idx of picks) {
                    const victim = state.generals[idx]
                    if (!victim?.alive) continue
                    if (gainRandomCardFrom(state, targetGeneral, victim)) hyGained++
                }
                addLog(state, `【${getGeneralName(targetGeneral)}】发动【怀异】，获得${hyGained}张牌`)
                if (hyGained > 1) {
                    addLog(state, `【${getGeneralName(targetGeneral)}】【怀异】获得的牌大于一张，失去1点体力`)
                    loseHp(state, targetGeneral, 1)
                }
                return
            }

            if (skillId === 'zhugejin_hongyuan') {
                const picks = [...new Set((multiIdx ?? (singleIdx !== undefined ? [singleIdx] : []))
                    .filter(idx => candidates.includes(idx)))]
                if (picks.length === 0) return { error: '请选择至少一名己方角色' }
                if (picks.length > 2) return { error: '最多选择两名己方角色' }
                state.pendingResponseQueue.shift()
                ;(targetGeneral as any).hongyuanAllies = picks
                addLog(state, `【${getGeneralName(targetGeneral)}】发动【弘援】，令${picks.map(i => `【${getGeneralName(state.generals[i])}】`).join('')}各摸一张牌`)
                continueFromPrepPhase(state)
                return
            }

            if (skillId === 'guyong_bingyi') {
                const picks = [...new Set((multiIdx ?? (singleIdx !== undefined ? [singleIdx] : []))
                    .filter(idx => candidates.includes(idx)))]
                if (picks.length === 0) return { error: '请选择至少一名角色' }
                if (picks.length > ((ctx.maxPicks as number) ?? picks.length)) return { error: '选择人数超出上限' }
                state.pendingResponseQueue.shift()
                for (const idx of picks) {
                    const g = state.generals[idx]
                    if (!g?.alive) continue
                    const drawn = drawCards(state, 1)
                    g.hand.push(...drawn)
                }
                addLog(state, `【${getGeneralName(targetGeneral)}】发动【秉壹】，${picks.length} 名角色各摸一张牌`)
                advanceTurnGuarded(state)
                return
            }

            // 矫诏（界郭皇后·修改二）：视为使用的牌选定目标后直接结算
            if (skillId === 'guohuanghou_jiaozhao_virtual') {
                if (singleIdx === undefined || !candidates.includes(singleIdx)) {
                    return { error: '请选择一名合法角色' }
                }
                const vTarget = state.generals[singleIdx]
                if (!vTarget?.alive) return { error: '目标已阵亡' }
                state.pendingResponseQueue.shift()
                const vName = ctx.jiaozhaoVirtualName as string
                if (vName === 'attack') {
                    useVirtualSlash(state, targetGeneral, singleIdx, { label: '【矫诏】' })
                } else {
                    const vTrickName = vName === 'dismantle' ? TrickCardName.DISMANTLE
                        : vName === 'steal' ? TrickCardName.STEAL : TrickCardName.DUEL
                    const vCard: Card = {
                        id: `jiaozhao_virtual_${state.log.length}`,
                        suit: CardSuit.SPADE,
                        value: 1,
                        category: CardCategory.TRICK,
                        name: vTrickName,
                        trickType: TrickType.INSTANT,
                        virtual: true,
                    }
                    addLog(state, `【${getGeneralName(targetGeneral)}】【矫诏】视为对【${getGeneralName(vTarget)}】使用${cardDisplayName(vCard)}`)
                    const vOutcome = handleTrickCard(state, targetGeneral, vCard, -1, [vTarget])
                    if (vOutcome && 'error' in vOutcome) addLog(state, `【矫诏】${vOutcome.error}`)
                }
                return
            }

            if (skillId === 'caifuren_xianzhou_damage') {
                const picks = [...new Set((multiIdx ?? (singleIdx !== undefined ? [singleIdx] : []))
                    .filter(idx => candidates.includes(idx)))]
                if (picks.length === 0) return { error: '请选择至少一名角色' }
                const xzChooser = state.generals[ctx.xianzhouChooserIndex as number]
                state.pendingResponseQueue.shift()
                for (const idx of picks) {
                    const victim = state.generals[idx]
                    if (victim?.alive) dealDamage(state, xzChooser ?? null, victim, 1)
                }
                addLog(state, `【${getGeneralName(targetGeneral)}】因【献州】对${picks.length}名角色各造成1点伤害`)
                return
            }
            if (skillId === 'cenhun_jishe_end') {
                const picks = [...new Set((multiIdx ?? (singleIdx !== undefined ? [singleIdx] : []))
                    .filter(idx => candidates.includes(idx)))]
                if (picks.length === 0) return { error: '请选择至少一名角色' }
                state.pendingResponseQueue.shift()
                for (const idx of picks) {
                    const g = state.generals[idx]
                    if (g?.alive) chainGeneral(state, g, '极奢')
                }
                addLog(state, `【${getGeneralName(targetGeneral)}】发动【极奢】，横置了${picks.length}名角色`)
                advanceTurnGuarded(state)
                return
            }
            if (skillId === 'haozhao_zhengu') {
                if (singleIdx === undefined || !candidates.includes(singleIdx)) return { error: '请选择一名合法角色' }
                const zgTarget = state.generals[singleIdx]
                if (!zgTarget?.alive) return { error: '目标已阵亡' }
                state.pendingResponseQueue.shift()
                zgTarget.zhenguBy = state.generals.indexOf(targetGeneral)
                addLog(state, `【${getGeneralName(targetGeneral)}】发动【镇骨】，选择【${getGeneralName(zgTarget)}】`)
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                    targetGeneralIndex: singleIdx,
                    context: {
                        skillId: 'haozhao_zhengu',
                        skillName: '镇骨',
                        description: `【${getGeneralName(targetGeneral)}】的【镇骨】：将手牌摸至或弃置至与其相同`,
                        options: [
                            { action: 'draw', label: '将手牌摸至与其相同（至多五张）' },
                            { action: 'discard', label: '将手牌弃置至与其相同' },
                        ],
                        zhenguOwnerIndex: state.generals.indexOf(targetGeneral),
                    },
                })
                return
            }
            if (skillId === 'xiahoushi_yanyu_end') {
                if (singleIdx === undefined || !candidates.includes(singleIdx)) return { error: '请选择一名男性角色' }
                const yyTarget = state.generals[singleIdx]
                state.pendingResponseQueue.shift()
                const yyDrawn = drawCards(state, 2)
                yyTarget.hand.push(...yyDrawn)
                addLog(state, `【${getGeneralName(targetGeneral)}】发动【燕语】，【${getGeneralName(yyTarget)}】摸${yyDrawn.length}张牌`)
                continueAfterYanyu(state)
                return
            }
            // ── 洛书版扩展（四）：新增武将选目标 ──
            // 平寇（朱桓）：对至多X名其他角色各造成1点伤害
            if (skillId === 'zhuhuan_pingkou') {
                const picks = [...new Set((multiIdx ?? (singleIdx !== undefined ? [singleIdx] : []))
                    .filter(idx => candidates.includes(idx)))]
                state.pendingResponseQueue.shift()
                for (const idx of picks) {
                    const victim = state.generals[idx]
                    if (!victim?.alive) continue
                    dealDamage(state, targetGeneral, victim, 1)
                    if (targetGeneral.alive) {
                        const pkouDraw = drawCards(state, 1)
                        targetGeneral.hand.push(...pkouDraw)
                        addLog(state, `【${getGeneralName(targetGeneral)}】因【平寇】摸 ${pkouDraw.length} 张牌`)
                    }
                }
                if (picks.length > 0) {
                    addLog(state, `【${getGeneralName(targetGeneral)}】发动【平寇】，对${picks.length}名角色各造成1点伤害`)
                }
                advanceTurnGuarded(state)
                return
            }
            // 兴学（孙休）：令至多X名角色依次摸一张牌并将一张牌置于牌堆顶
            if (skillId === 'sunxiu_xingxue') {
                const picks = [...new Set((multiIdx ?? (singleIdx !== undefined ? [singleIdx] : []))
                    .filter(idx => candidates.includes(idx)))]
                state.pendingResponseQueue.shift()
                if (picks.length === 0) {
                    advanceTurnGuarded(state)
                    return
                }
                addLog(state, `【${getGeneralName(targetGeneral)}】发动【兴学】，令${picks.length}名角色依次摸牌并置牌于牌堆顶`)
                continueXingxue(state, state.generals.indexOf(targetGeneral), picks, 0)
                return
            }
            // 绝策（李儒）：对一名没有手牌的其他角色造成1点伤害
            if (skillId === 'liru_juece') {
                state.pendingResponseQueue.shift()
                const jcVictim = singleIdx !== undefined ? state.generals[singleIdx] : undefined
                if (jcVictim?.alive && candidates.includes(singleIdx!)) {
                    addLog(state, `【${getGeneralName(targetGeneral)}】发动【绝策】，对【${getGeneralName(jcVictim)}】造成1点伤害`)
                    dealDamage(state, targetGeneral, jcVictim, 1)
                }
                advanceTurnGuarded(state)
                return
            }
            // 罪论（诸葛瞻）：均不满足时，你与一名其他角色各失去1点体力
            if (skillId === 'zhugezhan_zuilun_hp') {
                state.pendingResponseQueue.shift()
                const zlOther = singleIdx !== undefined ? state.generals[singleIdx] : undefined
                if (zlOther?.alive && candidates.includes(singleIdx!)) {
                    addLog(state, `【${getGeneralName(targetGeneral)}】【罪论】：与【${getGeneralName(zlOther)}】各失去1点体力`)
                    loseHp(state, targetGeneral, 1)
                    if (zlOther.alive) loseHp(state, zlOther, 1)
                }
                advanceTurnGuarded(state)
                return
            }
            // 献珠（李肃）：选择令其获得“珠”的角色
            if (skillId === 'lisu_xianzhu') {
                state.pendingResponseQueue.shift()
                const xzHolder = singleIdx !== undefined ? state.generals[singleIdx] : undefined
                if (!xzHolder || !candidates.includes(singleIdx!)) {
                    addLog(state, `【${getGeneralName(targetGeneral)}】【献珠】：未选择角色`)
                    return
                }
                xzHolder.pearlMarks = (xzHolder.pearlMarks ?? 0) + 1
                // “珠”只存在于李肃的武将牌上：获得珠即把那张牌置入获得者手牌
                const xzPearl = (targetGeneral.generalPile ?? []).pop()
                if (xzPearl) {
                    xzHolder.hand.push(xzPearl)
                    if (targetGeneral !== xzHolder) {
                        targetGeneral.pearlMarks = Math.max(0, (targetGeneral.pearlMarks ?? 1) - 1)
                    }
                    addLog(state, `【${getGeneralName(targetGeneral)}】【献珠】：【${getGeneralName(xzHolder)}】获得其武将牌上的${cardFullName(xzPearl)}（“珠”）`)
                } else {
                    addLog(state, `【${getGeneralName(targetGeneral)}】【献珠】：【${getGeneralName(xzHolder)}】获得一枚“珠”`)
                }
                if (xzHolder === targetGeneral) return
                // 其视为对你攻击范围内你指定的一名角色使用一张【杀】
                const xzSlashCandidates = state.generals
                    .map((g, idx) => ({ g, idx }))
                    .filter(({ g, idx }) => g.alive && idx !== singleIdx
                        && getAttackRange(targetGeneral, g, state.generals).inRange)
                    .map(({ idx }) => idx)
                if (xzSlashCandidates.length === 0) {
                    addLog(state, `【${getGeneralName(targetGeneral)}】【献珠】：攻击范围内没有合法目标`)
                    return
                }
                askChooseTarget(state, targetGeneral, 'lisu_xianzhu_slash', '献珠',
                    '选择【杀】的目标（由获得“珠”的角色视为使用【杀】）', xzSlashCandidates,
                    { xianzhuHolderIndex: singleIdx })
                return
            }
            // 献珠（李肃）：视为使用【杀】
            if (skillId === 'lisu_xianzhu_slash') {
                state.pendingResponseQueue.shift()
                const xzHolder = state.generals[ctx.xianzhuHolderIndex as number]
                const xzVictim = singleIdx !== undefined ? state.generals[singleIdx] : undefined
                if (xzHolder?.alive && xzVictim?.alive && candidates.includes(singleIdx!)) {
                    if (cannotUseHandCards(state, xzHolder)) {
                        addLog(state, `【${getGeneralName(xzHolder)}】因【雄乱】不能使用手牌，【献珠】的【杀】未生效`)
                        return
                    }
                    useVirtualSlash(state, xzHolder, singleIdx!, { noRange: true, label: '（献珠）' })
                }
                return
            }
            // 从谏（张绣）：选择交给牌的其他目标角色
            if (skillId === 'zhangxiu_congjian') {
                state.pendingResponseQueue.shift()
                const cjReceiver = singleIdx !== undefined ? state.generals[singleIdx] : undefined
                if (!cjReceiver?.alive || !candidates.includes(singleIdx!)) return
                askPickCard(state, targetGeneral, 'zhangxiu_congjian_give', '从谏',
                    '交给其一张牌：若为装备牌则你摸两张牌，否则摸一张牌',
                    { count: 1, mode: 'give', extra: { congjianReceiverIndex: singleIdx } })
                return
            }
            // 陷嗣（刘封）：将至多两名角色的各一张牌置于武将牌上
            if (skillId === 'liufeng_xiansi') {
                const picks = [...new Set((multiIdx ?? (singleIdx !== undefined ? [singleIdx] : []))
                    .filter(idx => candidates.includes(idx)))]
                if (picks.length === 0) return { error: '请选择至少一名角色' }
                if (picks.length > ((ctx.maxPicks as number) ?? 2)) return { error: '最多选择两名角色' }
                state.pendingResponseQueue.shift()
                for (const idx of picks) {
                    const victim = state.generals[idx]
                    if (!victim?.alive) continue
                    const taken = gainRandomCardFrom(state, targetGeneral, victim)
                    if (!taken) continue
                    const handIdx = targetGeneral.hand.indexOf(taken)
                    if (handIdx >= 0) targetGeneral.hand.splice(handIdx, 1)
                    pushToGeneralPile(state, targetGeneral, taken)
                    addLog(state, `【${getGeneralName(targetGeneral)}】因【陷嗣】将【${getGeneralName(victim)}】的一张牌置于武将牌上，称为“逆”（${pileCount(targetGeneral)}）`)
                }
                continueFromPrepPhase(state)
                return
            }
            // 巧变（张郃）：跳过摸牌阶段后，获得至多两名角色的各一张手牌
            if (skillId === 'zhanghe_qiaobian_draw') {
                const picks = [...new Set((multiIdx ?? (singleIdx !== undefined ? [singleIdx] : []))
                    .filter(idx => candidates.includes(idx)))]
                if (picks.length > ((ctx.maxPicks as number) ?? 2)) return { error: '最多选择两名角色' }
                state.pendingResponseQueue.shift()
                for (const idx of picks) {
                    const victim = state.generals[idx]
                    if (!victim?.alive || victim.hand.length === 0) continue
                    const got = victim.hand.splice(randomInt(victim.hand.length), 1)[0]
                    targetGeneral.hand.push(got)
                    addLog(state, `【${getGeneralName(targetGeneral)}】【巧变】获得【${getGeneralName(victim)}】的一张手牌`)
                }
                finishJudgePhaseAndContinue(state, targetGeneral, !!ctx.qiaobianSkipAction, true)
                return
            }
            if (singleIdx === undefined || !candidates.includes(singleIdx)) return { error: '请选择一名合法角色' }
            const chosen = state.generals[singleIdx]
            if (!chosen?.alive) return { error: '目标已阵亡' }

            // 谏计：目标用刚摸到的【杀】指定攻击范围内的角色
            if (skillId === 'huangquan_jianji') {
                const jjCardId = (ctx as any).jianjiCardId as string
                const jjIdx = targetGeneral.hand.findIndex(c => c.id === jjCardId)
                if (jjIdx === -1) return { error: '手牌中没有此牌' }
                const jjCard = targetGeneral.hand[jjIdx]
                if (!isCardUsableAsAttack(targetGeneral, jjCard)) return { error: '此牌不能当【杀】使用' }
                targetGeneral.hand.splice(jjIdx, 1)
                state.discard.push(jjCard)
                state.pendingResponseQueue.shift()
                addLog(state, `【${getGeneralName(targetGeneral)}】通过【谏计】对【${getGeneralName(chosen)}】使用【杀】`)
                state.pendingResponseQueue.unshift({
                    type: ResponseType.DODGE,
                    targetGeneralIndex: singleIdx,
                    context: {
                        attackerGeneralIndex: state.generals.indexOf(targetGeneral),
                        requiredDodges: hasSkill(targetGeneral, 'lvbu_wushuang') ? 2 : 1,
                        dodgesReceived: 0,
                        attackCard: jjCard,
                    },
                })
                return
            }

            if (skillId === 'yufan_zhiyan') {
                state.pendingResponseQueue.shift()
                const drawn = drawCards(state, 1)
                if (drawn.length > 0) {
                    const c = drawn[0]
                    addLog(state, `【${getGeneralName(targetGeneral)}】发动【直言】，【${getGeneralName(chosen)}】展示${cardFullName(c)}`)
                    if (c.category === CardCategory.EQUIPMENT && c.equipSlot) {
                        chosen.equip[c.equipSlot] = c
                        if (chosen.hp < chosen.maxHp) chosen.hp += 1
                        addLog(state, `【${getGeneralName(chosen)}】使用装备并回复1点体力`)
                    } else {
                        chosen.hand.push(c)
                        // 界虞翻：若其体力值不等于你，其失去1点体力
                        if (hasSkill(targetGeneral, 'yufan_zhiyan') && chosen.hp !== targetGeneral.hp) {
                            loseHp(state, chosen, 1)
                            addLog(state, `【${getGeneralName(chosen)}】体力值与【${getGeneralName(targetGeneral)}】不同，失去1点体力（直言）`)
                        }
                    }
                }
                advanceTurnGuarded(state)
                return
            }

            if (skillId === 'luji_yili') {
                state.pendingResponseQueue.shift()
                chosen.orangeMarks = (chosen.orangeMarks ?? 0) + 1
                addLog(state, `【${getGeneralName(targetGeneral)}】发动【遗礼】，令【${getGeneralName(chosen)}】获得1个“橘”`)
                return
            }
            if (skillId === 'handang_gongqi') {
                state.pendingResponseQueue.shift()
                const gqTaken = gainRandomCardFrom(state, targetGeneral, chosen)
                if (gqTaken) {
                    const gqIdx = targetGeneral.hand.indexOf(gqTaken)
                    if (gqIdx >= 0) {
                        targetGeneral.hand.splice(gqIdx, 1)
                        state.discard.push(gqTaken)
                    }
                    addLog(state, `【${getGeneralName(targetGeneral)}】因【弓骑】弃置【${getGeneralName(chosen)}】的${cardFullName(gqTaken)}`)
                }
                return
            }
            if (skillId === 'guohuanghou_jiaozhao') {
                state.pendingResponseQueue.shift()
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                    targetGeneralIndex: singleIdx,
                    context: {
                        skillId: 'guohuanghou_jiaozhao_declare',
                        skillName: '矫诏',
                        description: '声明一种牌名',
                        options: ctx.jiaozhaoOptions,
                        jiaozhaoOwnerIndex: state.generals.indexOf(targetGeneral),
                    },
                })
                return
            }
            if (skillId === 'zhongyao_zuoding') {
                state.pendingResponseQueue.shift()
                const zdDrawn = drawForGeneral(state, chosen, 1)
                chosen.hand.push(...zdDrawn)
                addLog(state, `【${getGeneralName(targetGeneral)}】发动【佐定】，【${getGeneralName(chosen)}】摸${zdDrawn.length}张牌`)
                return
            }
            if (skillId === 'fazheng_xuanhuo_drawer') {
                state.pendingResponseQueue.shift()
                const xhDrawn = drawForGeneral(state, chosen, 2)
                chosen.hand.push(...xhDrawn)
                addLog(state, `【${getGeneralName(targetGeneral)}】发动【眩惑】，【${getGeneralName(chosen)}】摸${xhDrawn.length}张牌`)
                const xhCandidates = state.generals
                    .map((g, idx) => ({ g, idx }))
                    .filter(({ g, idx }) => g.alive && idx !== singleIdx
                        && getAttackRange(chosen, g, state.generals).inRange)
                    .map(({ idx }) => idx)
                if (xhCandidates.length === 0) return
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_CHOOSE_TARGET,
                    targetGeneralIndex: state.generals.indexOf(targetGeneral),
                    context: {
                        skillId: 'fazheng_xuanhuo_target',
                        skillName: '眩惑',
                        description: `选择【${getGeneralName(chosen)}】攻击范围内的一名角色`,
                        candidateIndices: xhCandidates,
                        xuanhuoDrawerIndex: singleIdx,
                    },
                })
                return
            }
            if (skillId === 'fazheng_xuanhuo_target') {
                state.pendingResponseQueue.shift()
                const xhDrawer = state.generals[(ctx.xuanhuoDrawerIndex as number)]
                if (!xhDrawer?.alive) return
                const xhOptions: { action: string; label: string }[] = []
                if (xhDrawer.hand.some(c => isCardUsableAsAttack(xhDrawer, c))) {
                    xhOptions.push({ action: 'slash', label: `对【${getGeneralName(chosen)}】使用【杀】` })
                }
                xhOptions.push({ action: 'gain', label: '令法正获得你两张牌' })
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                    targetGeneralIndex: state.generals.indexOf(xhDrawer),
                    context: {
                        skillId: 'fazheng_xuanhuo',
                        skillName: '眩惑',
                        description: '选择一项',
                        options: xhOptions,
                        xuanhuoUserIndex: state.generals.indexOf(targetGeneral),
                        xuanhuoSlashTargetIndex: singleIdx,
                    },
                })
                return
            }
            if (skillId === 'sunqian_qianya') {
                state.pendingResponseQueue.shift()
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_GIVE_CARDS,
                    targetGeneralIndex: state.generals.indexOf(targetGeneral),
                    context: { skillId, skillName: '谦雅', toIndex: singleIdx, count: 0 },
                })
                return
            }
            if (skillId === 'lingtong_xuanfeng') {
                state.pendingResponseQueue.shift()
                state.pendingResponseQueue.unshift({
                    type: ResponseType.TRICK_TARGET_CARD_PICK,
                    targetGeneralIndex: state.generals.indexOf(targetGeneral),
                    context: {
                        trickType: 'dismantle',
                        targetIndex: singleIdx,
                        label: '旋风',
                        xuanfengRemaining: Math.max(1, (ctx.remaining as number) ?? 2),
                        xuanfengDiscardPhase: ctx.xuanfengDiscardPhase,
                    },
                })
                return
            }
            // ══ 洛书版扩展（五）：新增武将选目标 ══
            // 强识（界张松）：观看一名其他角色的手牌并展示其中一张牌
            if (skillId === 'zhangsong_qiangshi') {
                if (singleIdx === undefined || !candidates.includes(singleIdx)) {
                    return { error: '请选择一名合法角色' }
                }
                const qsVictim = state.generals[singleIdx]
                if (!qsVictim?.alive || qsVictim.hand.length === 0) return { error: '该角色没有手牌' }
                state.pendingResponseQueue.shift()
                const qsCard = qsVictim.hand[randomInt(qsVictim.hand.length)]
                targetGeneral.qiangshiCategory = qsCard.category
                addLog(state, `【${getGeneralName(targetGeneral)}】发动【强识】，观看【${getGeneralName(qsVictim)}】的手牌并展示${cardFullName(qsCard)}，本阶段使用${cardCategoryLabel(qsCard.category)}后摸一张牌`)
                return
            }
            // 求援（界伏皇后）：被选中的角色交给其一张同类别不同名的牌，否则成为此牌的额外目标
            if (skillId === 'fuhuanghou_xuanqiu') {
                if (singleIdx === undefined || !candidates.includes(singleIdx)) {
                    return { error: '请选择一名合法角色' }
                }
                const xqChosen = state.generals[singleIdx]
                if (!xqChosen?.alive) return { error: '目标已阵亡' }
                state.pendingResponseQueue.shift()
                const xqCategory = ctx.xuanqiuCardCategory as string
                const xqName = ctx.xuanqiuCardName as string
                const xqGiveable = xqChosen.hand
                    .filter(c => c.category === xqCategory && c.name !== xqName)
                    .map(c => c.id)
                if (xqGiveable.length === 0) {
                    addLog(state, `【${getGeneralName(xqChosen)}】没有可交出的${cardCategoryLabel(xqCategory as CardCategory)}，成为此牌的额外目标（求援）`)
                    resumeXuanqiuUse(state, ctx, singleIdx)
                    return
                }
                state.pendingResponseQueue.push({
                    type: ResponseType.SKILL_PICK_CARD,
                    targetGeneralIndex: singleIdx,
                    context: {
                        skillId: 'fuhuanghou_xuanqiu_give',
                        skillName: '求援',
                        description: `交给【${getGeneralName(targetGeneral)}】一张${cardCategoryLabel(xqCategory as CardCategory)}（牌名不同），否则你成为此牌的额外目标`,
                        count: 1,
                        mode: 'give',
                        candidateCardIds: xqGiveable,
                        xuanqiuCtx: { ...ctx },
                    },
                })
                return
            }
            // 恢拓（曹叡）：令一名角色判定
            if (skillId === 'caorui_huituo') {
                if (singleIdx === undefined || !candidates.includes(singleIdx)) {
                    return { error: '请选择一名合法角色' }
                }
                const htTarget = state.generals[singleIdx]
                if (!htTarget?.alive) return { error: '目标已阵亡' }
                state.pendingResponseQueue.shift()
                addLog(state, `【${getGeneralName(targetGeneral)}】发动【恢拓】，令【${getGeneralName(htTarget)}】进行判定`)
                performSkillJudge(state, htTarget, 'huituo', '恢拓', {
                    huituoOwnerIndex: singleIdx,
                    huituoAmount: (ctx.huituoAmount as number) ?? 1,
                })
                return
            }
            // 巧变（张郃）：跳过出牌阶段后，移动场上的一张牌（先选来源）
            if (skillId === 'zhanghe_qiaobian_move') {
                if (singleIdx === undefined || !candidates.includes(singleIdx)) {
                    return { error: '请选择装备牌的来源角色' }
                }
                const zbSource = state.generals[singleIdx]
                if (!zbSource?.alive) return { error: '目标已阵亡' }
                state.pendingResponseQueue.shift()
                const moveDest = state.generals
                    .map((g, idx) => ({ g, idx }))
                    .filter(({ g, idx }) => g.alive && idx !== singleIdx)
                    .map(({ idx }) => idx)
                if (moveDest.length === 0) {
                    enterDiscardPhaseOrSkip(state, targetGeneral)
                    return
                }
                state.pendingResponseQueue.push({
                    type: ResponseType.SKILL_CHOOSE_TARGET,
                    targetGeneralIndex: state.generals.indexOf(targetGeneral),
                    context: {
                        skillId: 'zhanghe_qiaobian_move_to',
                        skillName: '巧变',
                        description: `选择【${getGeneralName(zbSource)}】装备牌的获得者`,
                        candidateIndices: moveDest,
                        qiaobianMoveSource: singleIdx,
                    },
                })
                return
            }
            if (skillId === 'zhanghe_qiaobian_move_to') {
                if (singleIdx === undefined || !candidates.includes(singleIdx)) {
                    return { error: '请选择一名合法角色' }
                }
                const zbDest = state.generals[singleIdx]
                const zbSrc = state.generals[ctx.qiaobianMoveSource as number]
                state.pendingResponseQueue.shift()
                if (zbDest?.alive && zbSrc?.alive) {
                    const slot = Object.values(EquipSlot).find(s => zbSrc.equip[s])
                    if (slot) {
                        const eqCard = clearEquipSlot(state, zbSrc, slot)
                        if (eqCard) {
                            const oldEq = zbDest.equip[slot]
                            if (oldEq) state.discard.push(oldEq)
                            zbDest.equip[slot] = eqCard
                            addLog(state, `【${getGeneralName(targetGeneral)}】发动【巧变】，将【${getGeneralName(zbSrc)}】的${cardFullName(eqCard)}移动到【${getGeneralName(zbDest)}】的装备区`)
                        }
                    }
                }
                enterDiscardPhaseOrSkip(state, targetGeneral)
                return
            }
            return { error: '未知技能' }
        }

        // ── 通用：选择交给指定角色的手牌（谦雅 / 忘隙） ──
        case ResponseType.SKILL_GIVE_CARDS: {
            const ctx = pending.context as any
            const action = (data as any).action as string | undefined
            const receiver = state.generals[ctx.toIndex as number]
            // 洛书版扩展（九）
            const expG = expGiveA(state, targetGeneral, pending, action, ctx,
                ((data as any).cardIds as string[] | undefined) ?? [])
            if (expG !== EXP_UNHANDLED) return expG
            if (action === 'decline') {
                if (ctx.mandatory) return { error: `【${ctx.skillName}】必须选择手牌交给对方` }
                addLog(state, `【${getGeneralName(targetGeneral)}】放弃发动【${ctx.skillName}】`)
                state.pendingResponseQueue.shift()
                return
            }
            if (!receiver?.alive) {
                state.pendingResponseQueue.shift()
                return
            }
            const cardIds = ((data as any).cardIds as string[] | undefined) ?? []
            const need = Math.max(0, (ctx.count as number) ?? 0)
            if (cardIds.length < Math.max(1, need) || (need > 0 && cardIds.length !== need)) {
                return { error: need > 0 ? `请选择 ${need} 张手牌` : '请至少选择 1 张手牌' }
            }
            const cards: Card[] = []
            for (const id of [...new Set(cardIds)]) {
                const i = targetGeneral.hand.findIndex(c => c.id === id)
                if (i === -1) return { error: '手牌中没有此牌' }
                cards.push(targetGeneral.hand.splice(i, 1)[0])
            }
            receiver.hand.push(...cards)
            state.pendingResponseQueue.shift()
            addLog(state, `【${getGeneralName(targetGeneral)}】发动【${ctx.skillName}】，将${cards.map(c => cardFullName(c)).join('、')}交给【${getGeneralName(receiver)}】`)
            triggerLianying(state, targetGeneral)
            return
        }

        // ── 通用：选择自己的一张牌（弃置 / 置于武将牌上） ──
        // ── 斗地主：存活农民的阵亡奖励二选一 ──
        case ResponseType.LANDLORD_REWARD: {
            const action = (data as any).action as string | undefined
            state.pendingResponseQueue.shift()
            if (action === 'recover') {
                const before = targetGeneral.hp
                targetGeneral.hp = Math.min(targetGeneral.maxHp, targetGeneral.hp + 1)
                addLog(state, `【${getGeneralName(targetGeneral)}】选择回复1点体力（${before}→${targetGeneral.hp}）`)
            } else {
                const rewardDrawn = drawCards(state, 2)
                targetGeneral.hand.push(...rewardDrawn)
                addLog(state, `【${getGeneralName(targetGeneral)}】选择摸${rewardDrawn.length}张牌`)
            }
            return
        }

        case ResponseType.SKILL_PICK_CARD: {
            const ctx = pending.context as any
            const action = (data as any).action as string | undefined
            const ids = [...new Set(((data as any).cardIds as string[] | undefined)
                ?? ((data as any).cardId ? [(data as any).cardId as string] : []))]

            // 洛书版扩展（九）
            const expP = expPickA(state, targetGeneral, pending, action, ctx, ids)
            if (expP !== EXP_UNHANDLED) return expP

            // 箜声（周妃）：把选中的手牌置于武将牌上，结束阶段再处理
            if (ctx.skillId === 'zhoufei_kongsheng') {
                state.pendingResponseQueue.shift()
                const placed: Card[] = []
                if (action !== 'decline') {
                    for (const id of ids) {
                        const idx = targetGeneral.hand.findIndex((c) => c.id === id)
                        if (idx >= 0) placed.push(targetGeneral.hand.splice(idx, 1)[0])
                    }
                }
                if (placed.length > 0) {
                    targetGeneral.generalPile = [...targetGeneral.generalPile ?? [], ...placed]
                    targetGeneral.kongshengActive = true
                    triggerLiangyin(state, 'out')
                    addLog(state, `【${getGeneralName(targetGeneral)}】发动【箜声】，将${placed.length}张手牌置于武将牌上`)
                } else {
                    addLog(state, `【${getGeneralName(targetGeneral)}】放弃发动【箜声】`)
                }
                continueFromPrepPhase(state)
                return
            }

            // 纵玄（界虞翻）：把因弃置进入弃牌堆的牌置于牌堆顶
            if (ctx.skillId === 'yufan_zongxuan') {
                state.pendingResponseQueue.shift()
                const toTop: Card[] = []
                if (action !== 'decline') {
                    for (const id of ids) {
                        const di = state.discard.findIndex((c) => c.id === id)
                        if (di < 0) continue
                        toTop.push(state.discard.splice(di, 1)[0])
                    }
                }
                if (toTop.length > 0) {
                    // 先选的牌放在牌堆最上方
                    for (const c of [...toTop].reverse()) state.deck.unshift(c)
                    addLog(state, `【${getGeneralName(targetGeneral)}】发动【纵玄】，将${toTop.length}张牌置于牌堆顶`)
                } else {
                    addLog(state, `【${getGeneralName(targetGeneral)}】放弃发动【纵玄】`)
                }
                // 弃牌阶段的回合在纵玄询问处停住，结算完在这里收尾
                if (state.turnPhase === TurnPhase.DISCARD && state.pendingResponseQueue.length === 0) {
                    const discarder = getActiveGeneral(state)
                    if (discarder && discarder.hand.length <= getHandLimit(discarder)) finishTurn(state)
                }
                return
            }

            // 界马超【铁骑】：目标自行决定是否弃置同花色牌，弃了才能用【闪】
            if (ctx.skillId === 'machao_jie_tieqi_keep') {
                state.pendingResponseQueue.shift()
                const tieqiSuit = ctx.tieqiSuit as CardSuit
                const keepCard = action === 'decline'
                    ? undefined
                    : targetGeneral.hand.find((c) => c.id === ids[0] && c.suit === tieqiSuit)
                if (keepCard) {
                    targetGeneral.hand.splice(targetGeneral.hand.indexOf(keepCard), 1)
                    state.discard.push(keepCard)
                    maybeZongxuan(state, targetGeneral, [keepCard])
                    addLog(state, `【${getGeneralName(targetGeneral)}】弃置${cardFullName(keepCard)}，抵消【铁骑】`)
                    return
                }
                const tieqiDodgeIdx = state.pendingResponseQueue.findIndex(
                    (p) => p.type === ResponseType.DODGE
                        && p.targetGeneralIndex === state.generals.indexOf(targetGeneral))
                if (tieqiDodgeIdx >= 0) state.pendingResponseQueue.splice(tieqiDodgeIdx, 1)
                addLog(state, `【${getGeneralName(targetGeneral)}】未弃置${suitSymbol(tieqiSuit)}牌，不能使用【闪】`)
                const tieqiAttacker = state.generals[(ctx.attackerGeneralIndex as number) ?? -1]
                if (tieqiAttacker) {
                    const tieqiDmg = calcKillDamage(state, tieqiAttacker, targetGeneral)
                    dealDamage(state, tieqiAttacker, targetGeneral, tieqiDmg, ctx.attackCardId as string,
                        slashDamageOpts(tieqiAttacker, undefined))
                }
                return
            }

            // 安恤（界步练师）：展示获得的一张牌交给手牌较少者；非黑桃则再摸一张
            if (ctx.skillId === 'bulianshi_anxu_give') {
                state.pendingResponseQueue.shift()
                if (action === 'decline') return
                const axGive = targetGeneral.hand.find((c) => c.id === ids[0])
                if (!axGive) return { error: '请选择一张获得的牌' }
                targetGeneral.hand.splice(targetGeneral.hand.indexOf(axGive), 1)
                const axReceiver = state.generals[(ctx.anxuReceiverIndex as number) ?? -1]
                if (!axReceiver?.alive) {
                    state.discard.push(axGive)
                    return
                }
                axReceiver.hand.push(axGive)
                addLog(state, `【${getGeneralName(targetGeneral)}】【安恤】展示${cardFullName(axGive)}，交给【${getGeneralName(axReceiver)}】`)
                if (axGive.suit !== CardSuit.SPADE) {
                    const axDrawn = drawForGeneral(state, targetGeneral, 1)
                    targetGeneral.hand.push(...axDrawn)
                    if (axDrawn.length > 0) {
                        addLog(state, `【${getGeneralName(targetGeneral)}】【安恤】摸${axDrawn.length}张牌`)
                    }
                }
                return
            }

            // 眩惑（法正）：同阵营手牌可见，可精确选出获得的牌
            if (ctx.skillId === 'fazheng_xuanhuo_gain') {
                state.pendingResponseQueue.shift()
                if (action === 'decline') return
                const xhFrom = state.generals[(ctx.xuanhuoFromIndex as number)]
                if (!xhFrom?.alive) return
                const picked: Card[] = []
                for (const id of ids) {
                    if (picked.length >= 2) break
                    if (!findCardInHandOrEquip(xhFrom, id)) continue
                    const detached = detachCardFromHandOrEquip(state, xhFrom, id)
                    if ('error' in detached) continue
                    picked.push(detached)
                }
                for (const c of picked) targetGeneral.hand.push(c)
                addLog(state, `【${getGeneralName(targetGeneral)}】发动【眩惑】，获得【${getGeneralName(xhFrom)}】的${picked.length}张牌`)
                return
            }

            // ── 洛书版扩展（七） ──
            // 节命（界荀彧）：将手牌弃置至 X 张
            // 智愚（界荀攸）：伤害来源弃置一张手牌；若荀攸手牌颜色均相同，荀攸获得该牌且奇策次数上限+1
            if (ctx.skillId === 'xunyou_zhiyu') {
                state.pendingResponseQueue.shift()
                if (action === 'decline' || ids.length === 0) return
                const zyPick = targetGeneral.hand.find((c) => c.id === ids[0])
                if (!zyPick) return { error: '手牌中没有此牌' }
                targetGeneral.hand.splice(targetGeneral.hand.indexOf(zyPick), 1)
                const zyOwner = state.generals[ctx.zhiyuOwnerIndex as number]
                if (ctx.zhiyuAllSame && zyOwner?.alive) {
                    zyOwner.hand.push(zyPick)
                    zyOwner.qiceBonusThisTurn = (zyOwner.qiceBonusThisTurn ?? 0) + 1
                    addLog(state, `【${getGeneralName(zyOwner)}】【智愚】获得${cardFullName(zyPick)}，本回合【奇策】发动次数上限+1`)
                } else {
                    state.discard.push(zyPick)
                    addLog(state, `【${getGeneralName(targetGeneral)}】因【智愚】弃置${cardFullName(zyPick)}`)
                }
                return
            }

            // 好施（鲁肃）：把选定的牌交给手牌最少的角色，然后继续阶段
            if (ctx.skillId === 'lusu_haoshi_give') {
                state.pendingResponseQueue.shift()
                const hsReceiver = state.generals[ctx.haoshiReceiverIndex as number]
                const hsNeed = Math.max(1, (ctx.count as number) ?? 1)
                const hsPicked = ids
                    .filter(id => targetGeneral.hand.some(c => c.id === id))
                    .slice(0, hsNeed)
                if (hsReceiver?.alive && hsPicked.length > 0) {
                    for (const id of hsPicked) {
                        const hi = targetGeneral.hand.findIndex(c => c.id === id)
                        if (hi < 0) continue
                        hsReceiver.hand.push(targetGeneral.hand.splice(hi, 1)[0])
                    }
                    addLog(state, `【${getGeneralName(targetGeneral)}】【好施】将${hsPicked.length}张牌交给【${getGeneralName(hsReceiver)}】`)
                }
                if (ctx.haoshiSkipAction) {
                    state.turnPhase = TurnPhase.DISCARD
                    if (targetGeneral.hand.length <= targetGeneral.hp) finishTurn(state)
                } else {
                    beginActionPhase(state, targetGeneral)
                }
                return
            }

            if (ctx.skillId === 'xunyu_jieming') {
                const jmX = (ctx.jiemingX as number | undefined) ?? Math.min(targetGeneral.maxHp, 5)
                state.pendingResponseQueue.shift()
                const need = targetGeneral.hand.length - jmX
                if (action === 'decline' || need <= 0) return
                const picked = ids.filter(id => targetGeneral.hand.some(c => c.id === id))
                if (picked.length !== need) return { error: `请选择 ${need} 张手牌弃置` }
                for (const id of picked) {
                    const removed = removeCardFromHandOrEquip(state, targetGeneral, id)
                    if ('error' in removed) return removed
                }
                addLog(state, `【${getGeneralName(targetGeneral)}】因【节命】弃置${picked.length}张手牌`)
                return
            }

            // 慷忾（曹昂）：交给目标一张牌并展示
            if (ctx.skillId === 'caoang_kangkai' && action !== 'decline') {
                if (ids.length !== 1) return { error: '请选择一张牌' }
                const kkGift = findCardInHandOrEquip(targetGeneral, ids[0])
                if (!kkGift) return { error: '找不到该牌' }
                const kkTo = state.generals[ctx.kangkaiTargetIndex as number]
                if (!kkTo?.alive) return { error: '目标不存在' }
                state.pendingResponseQueue.shift()
                const kkDetached = detachCardFromHandOrEquip(state, targetGeneral, kkGift.id)
                if ('error' in kkDetached) return kkDetached
                kkTo.hand.push(kkGift)
                addLog(state, `【${getGeneralName(targetGeneral)}】发动【慷忾】，将${cardFullName(kkGift)}交给【${getGeneralName(kkTo)}】并展示`)
                if (kkGift.category === CardCategory.EQUIPMENT) {
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                        targetGeneralIndex: state.generals.indexOf(kkTo),
                        context: {
                            skillId: 'caoang_kangkai_use', skillName: '慷忾',
                            description: `使用刚获得的${cardFullName(kkGift)}`,
                            kangkaiEquipId: kkGift.id,
                        },
                    })
                }
                return
            }

            // 谏征（秦宓）：将一张手牌置于牌堆顶，取消此【杀】的所有目标
            if (ctx.skillId === 'qinmi_jianzheng' && action !== 'decline') {
                if (ids.length !== 1) return { error: '请选择一张手牌' }
                const jzCard = targetGeneral.hand.find(c => c.id === ids[0])
                if (!jzCard) return { error: '只能选择手牌' }
                state.pendingResponseQueue.shift()
                targetGeneral.hand.splice(targetGeneral.hand.indexOf(jzCard), 1)
                state.deck.unshift(jzCard)
                addLog(state, `【${getGeneralName(targetGeneral)}】发动【谏征】，将一张手牌置于牌堆顶，取消此【杀】的所有目标`)
                const jzAttackId = ctx.attackCardId as string
                state.pendingResponseQueue = state.pendingResponseQueue.filter(p => !(
                    p.type === ResponseType.DODGE && (p.context as any)?.attackCard?.id === jzAttackId))
                const jzSlash = ctx.attackCard as Card | undefined
                const jzBlack = jzSlash?.suit === CardSuit.SPADE || jzSlash?.suit === CardSuit.CLUB
                const jzAtk = state.generals[ctx.jianzhengAttackerIndex as number]
                if (jzSlash && !jzBlack && jzAtk?.alive) {
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.DODGE,
                        targetGeneralIndex: state.generals.indexOf(targetGeneral),
                        context: {
                            attackerGeneralIndex: state.generals.indexOf(jzAtk),
                            requiredDodges: 1, dodgesReceived: 0, attackCard: jzSlash,
                        },
                    })
                    addLog(state, `【${getGeneralName(targetGeneral)}】因【谏征】成为此【杀】的目标`)
                }
                return
            }

            // 龙临（闪赵云）：弃一张牌令此【杀】无效，并可被对方视为【决斗】
            if (ctx.skillId === 'shanzhaoyun_longlin' && action !== 'decline') {
                if (ids.length !== 1) return { error: '请选择一张牌' }
                const llCard = findCardInHandOrEquip(targetGeneral, ids[0])
                if (!llCard) return { error: '找不到该牌' }
                state.pendingResponseQueue.shift()
                const llDetached = detachCardFromHandOrEquip(state, targetGeneral, llCard.id)
                if ('error' in llDetached) return llDetached
                state.discard.push(llCard)
                addLog(state, `【${getGeneralName(targetGeneral)}】发动【龙临】，弃置${cardFullName(llCard)}令此【杀】无效`)
                const llAttackId = ctx.attackCardId as string
                state.pendingResponseQueue = state.pendingResponseQueue.filter(p => !(
                    p.type === ResponseType.DODGE && (p.context as any)?.attackCard?.id === llAttackId))
                const llUser = state.generals[ctx.longlinUserIndex as number]
                if (llUser?.alive) {
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                        targetGeneralIndex: state.generals.indexOf(llUser),
                        context: {
                            skillId: 'shanzhaoyun_longlin_duel', skillName: '龙临',
                            description: `视为对【${getGeneralName(targetGeneral)}】使用一张【决斗】`,
                            longlinUserIndex: state.generals.indexOf(llUser),
                        },
                    })
                }
                return
            }

            // 下书（阚泽）：目标展示任意张手牌
            if (ctx.skillId === 'kanze_xiashu_show') {
                const xsOwner = state.generals[ctx.xiashuOwnerIndex as number]
                const xsSelfIdx = state.generals.indexOf(targetGeneral)
                state.pendingResponseQueue.shift()
                const xsShown = action === 'decline'
                    ? []
                    : ids.filter(id => ((ctx.candidateCardIds as string[]) ?? []).includes(id))
                targetGeneral.xiashuShownIds = xsShown
                addLog(state, action === 'decline'
                    ? `【${getGeneralName(targetGeneral)}】不展示手牌（下书）`
                    : `【${getGeneralName(targetGeneral)}】展示了${xsShown.length}张手牌（下书）`)
                if (!xsOwner?.alive) return
                const xsRemaining = targetGeneral.hand.length
                const xsShowCount = xsShown.length
                const xsOptions = [
                    ...(xsShowCount > 0 ? [{ action: 'shown', label: `获得其展示的${xsShowCount}张牌` }] : []),
                    ...(xsRemaining > xsShowCount ? [{ action: 'hidden', label: `获得其未展示的${xsRemaining - xsShowCount}张牌` }] : []),
                ]
                if (xsOptions.length === 0) return
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                    targetGeneralIndex: state.generals.indexOf(xsOwner),
                    context: {
                        skillId: 'kanze_xiashu_gain', skillName: '下书',
                        description: '选择获得其展示的或未展示的手牌',
                        options: xsOptions,
                        xiashuOwnerIndex: state.generals.indexOf(xsOwner),
                        xiashuTargetIndex: xsSelfIdx,
                        xiashuShownIds: xsShown,
                    },
                })
                return
            }

            // 飞扬（斗地主地主技）：弃2张手牌后，弃置判定区第一张牌
            if (ctx.skillId === 'doudizhu_feiyang') {
                if (ids.length !== 2) return { error: '须选择2张手牌' }
                if (ids.some((id) => !targetGeneral.hand.some((c) => c.id === id))) {
                    return { error: '只能弃置手牌' }
                }
                const fyRemoved: Card[] = []
                for (const id of ids) {
                    const removed = removeCardFromHandOrEquip(state, targetGeneral, id)
                    if ('error' in removed) return removed
                    fyRemoved.push(removed)
                }
                const judgeCard = targetGeneral.judgeZone[0]
                if (judgeCard) {
                    targetGeneral.judgeZone = targetGeneral.judgeZone.filter((c) => c.id !== judgeCard.id)
                    state.discard.push(judgeCard)
                }
                targetGeneral.skillsUsedThisTurn.push('doudizhu_feiyang')
                state.pendingResponseQueue.shift()
                addLog(state, `【${getGeneralName(targetGeneral)}】发动【飞扬】，弃置2张手牌`
                    + (judgeCard ? `，并弃置判定区的${cardFullName(judgeCard)}` : ''))
                continueTurnFromJudge(state, false, false, false)
                return
            }
            // 鸿举（毌丘俭）：不替换手牌也要继续觉醒
            if (action === 'decline' && ctx.skillId === 'guanqiujian_hongju') {
                state.pendingResponseQueue.shift()
                finishHongju(state, targetGeneral, [])
                return
            }
            // 清侧（毌丘俭）：放弃弃置场上的牌
            if (action === 'decline' && ctx.skillId === 'guanqiujian_qingce') {
                state.pendingResponseQueue.shift()
                addLog(state, `【${getGeneralName(targetGeneral)}】【清侧】未弃置场上的牌`)
                return
            }
            if (action === 'decline') {
                addLog(state, `【${getGeneralName(targetGeneral)}】放弃发动【${ctx.skillName}】`)
                state.pendingResponseQueue.shift()
                // 倾袭（界曹休）：弃牌是强制项，放弃选择时按“不弃牌”继续结算伤害
                if (ctx.skillId === 'caoxiu_jie_qingxi') {
                    const jqAtk = state.generals[ctx.qingxiJieAttackerIndex as number]
                    const jqTgt = state.generals[ctx.qingxiJieTargetIndex as number]
                    if (jqAtk && jqTgt) {
                        finishJieQingxi(state, jqAtk, jqTgt, !!ctx.qingxiBonus,
                            (ctx.qingxiAmount as number) ?? 0, ctx.qingxiCardId, ctx.qingxiNature,
                            !!ctx.qingxiDropWeapon, ctx.qingxiResumeOpts)
                    }
                    return
                }
                if ((ctx as any).endPhase) advanceTurnGuarded(state)
                // 求援（界伏皇后）：拒绝交牌 → 其成为此牌的额外目标
                if (ctx.skillId === 'fuhuanghou_xuanqiu_give' && ctx.xuanqiuCtx) {
                    addLog(state, `【${getGeneralName(targetGeneral)}】拒绝交牌，成为此牌的额外目标（求援）`)
                    resumeXuanqiuUse(state, ctx.xuanqiuCtx, state.generals.indexOf(targetGeneral))
                }
                return
            }
            // 鸿举（毌丘俭）：替换手牌与“荣”
            if (ctx.skillId === 'guanqiujian_hongju') {
                const hjMax = (ctx.count as number) ?? 0
                if (ids.length > hjMax) return { error: `最多替换 ${hjMax} 张牌` }
                state.pendingResponseQueue.shift()
                finishHongju(state, targetGeneral, ids)
                return
            }
            // 清侧（毌丘俭）：弃置一张手牌后，弃置场上的一张牌
            if (ctx.skillId === 'guanqiujian_qingce') {
                const qcCard = targetGeneral.hand.find(c => ids.includes(c.id))
                if (!qcCard) return { error: '请选择一张手牌' }
                const qcRemoved = removeCardFromHandOrEquip(state, targetGeneral, qcCard.id)
                if ('error' in qcRemoved) return qcRemoved
                state.pendingResponseQueue.shift()
                addLog(state, `【${getGeneralName(targetGeneral)}】【清侧】弃置了${cardFullName(qcRemoved)}`)
                const qcCandidates = state.generals
                    .map((g, i) => ({ g, i }))
                    .filter(({ g }) => g.alive && hasCardInArea(g))
                    .map(({ i }) => i)
                if (qcCandidates.length === 0) return
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_CHOOSE_TARGET,
                    targetGeneralIndex: state.generals.indexOf(targetGeneral),
                    context: {
                        skillId: 'guanqiujian_qingce', skillName: '清侧',
                        description: '弃置场上的一张牌', candidateIndices: qcCandidates,
                    },
                })
                return
            }
            // 匡弼（孙登）：目标把牌置于孙登的武将牌上
            if (ctx.skillId === 'sundeng_kuangbi') {
                if (ids.length === 0) return { error: '请选择至少一张牌' }
                if (ids.length > 3) return { error: '最多选择 3 张牌' }
                const kbOwner = state.generals[ctx.kuangbiOwnerIndex as number]
                const moved: Card[] = []
                for (const id of ids) {
                    const detached = detachCardFromHandOrEquip(state, targetGeneral, id)
                    if ('error' in detached) return detached
                    moved.push(detached)
                }
                state.pendingResponseQueue.shift()
                if (!kbOwner) {
                    state.discard.push(...moved)
                    return
                }
                kbOwner.generalPile = [...(kbOwner.generalPile ?? []), ...moved]
                kbOwner.kuangbiGiver = state.generals.indexOf(targetGeneral)
                kbOwner.kuangbiCount = moved.length
                triggerLiangyin(state, 'out')
                addLog(state, `【${getGeneralName(targetGeneral)}】因【匡弼】将${moved.length}张牌置于【${getGeneralName(kbOwner)}】的武将牌上`)
                return
            }
            // ── 洛书版扩展（四）：新增武将选牌 ──
            // 焚城（李儒）：须弃置至少 X 张牌，下家的 X 为其弃置数+1
            if (ctx.skillId === 'liru_fencheng_discard') {
                const fcNeed = Math.max(1, (ctx.fenchengNeed as number) ?? 1)
                if (ids.length < fcNeed) return { error: `须弃置至少 ${fcNeed} 张牌` }
                const fcRemoved: Card[] = []
                for (const id of ids) {
                    const detached = detachCardFromHandOrEquip(state, targetGeneral, id)
                    if ('error' in detached) return detached
                    fcRemoved.push(detached)
                }
                state.discard.push(...fcRemoved)
                state.pendingResponseQueue.shift()
                addLog(state, `【${getGeneralName(targetGeneral)}】【焚城】弃置了${fcRemoved.length}张牌`)
                pushFenchengStep(state, (ctx.fenchengOrder as number[]) ?? [],
                    (ctx.fenchengPos as number) ?? 0, fcRemoved.length + 1,
                    ctx.fenchengUserIndex as number)
                return
            }
            // 兴学（孙休）：将一张牌置于牌堆顶
            if (ctx.skillId === 'sunxiu_xingxue') {
                const xxCard = targetGeneral.hand.find(c => ids.includes(c.id))
                if (!xxCard) return { error: '请选择一张手牌' }
                targetGeneral.hand.splice(targetGeneral.hand.indexOf(xxCard), 1)
                state.deck.unshift(xxCard)
                state.pendingResponseQueue.shift()
                addLog(state, `【${getGeneralName(targetGeneral)}】因【兴学】将${cardFullName(xxCard)}置于牌堆顶`)
                continueXingxue(state, ctx.xingxueOwnerIndex as number,
                    (ctx.xingxuePicks as number[]) ?? [], (ctx.xingxuePos as number) ?? 0)
                return
            }
            // 从谏（张绣）：交给一名其他目标角色一张牌，然后摸牌
            if (ctx.skillId === 'zhangxiu_congjian_give') {
                const cjReceiver = state.generals[ctx.congjianReceiverIndex as number]
                const cjCard = targetGeneral.hand.find(c => ids.includes(c.id))
                if (!cjCard) return { error: '请选择一张手牌' }
                if (!cjReceiver?.alive) return { error: '目标已阵亡' }
                targetGeneral.hand.splice(targetGeneral.hand.indexOf(cjCard), 1)
                cjReceiver.hand.push(cjCard)
                state.pendingResponseQueue.shift()
                const cjDraw = cjCard.category === CardCategory.EQUIPMENT ? 2 : 1
                const cjDrawn = drawForGeneral(state, targetGeneral, cjDraw)
                targetGeneral.hand.push(...cjDrawn)
                addLog(state, `【${getGeneralName(targetGeneral)}】发动【从谏】，将${cardFullName(cjCard)}交给【${getGeneralName(cjReceiver)}】，摸了${cjDrawn.length}张牌`)
                return
            }
            // ── 洛书版扩展（五）：新增武将选牌 ──
            // 权计（界钟会）：当前回合角色将一张手牌置于钟会的武将牌上
            if (ctx.skillId === 'zhonghui_quanji') {
                const qjOwner = state.generals[ctx.quanjiOwnerIndex as number]
                const qjCard = targetGeneral.hand.find(c => ids.includes(c.id))
                if (!qjCard) return { error: '请选择一张手牌' }
                if (!qjOwner) {
                    state.pendingResponseQueue.shift()
                    return
                }
                targetGeneral.hand.splice(targetGeneral.hand.indexOf(qjCard), 1)
                state.pendingResponseQueue.shift()
                pushToGeneralPile(state, qjOwner, qjCard)
                addLog(state, `【${getGeneralName(targetGeneral)}】因【权计】将一张手牌置于【${getGeneralName(qjOwner)}】的武将牌上，称为“权”（${pileCount(qjOwner)}）`)
                return
            }
            // 献图（界张松）：交给目标等量的牌
            if (ctx.skillId === 'zhangsong_xiantu_give') {
                const xtTo = state.generals[ctx.xiantuGiveToIndex as number]
                const xtNeed = (ctx.xiantuGiveCount as number) ?? 1
                if (!xtTo?.alive) {
                    state.pendingResponseQueue.shift()
                    return
                }
                const xtCards = ids
                    .map(id => targetGeneral.hand.find(c => c.id === id))
                    .filter((c): c is Card => !!c)
                if (xtCards.length !== xtNeed) return { error: `须选择 ${xtNeed} 张手牌` }
                for (const c of xtCards) {
                    targetGeneral.hand.splice(targetGeneral.hand.indexOf(c), 1)
                    xtTo.hand.push(c)
                }
                targetGeneral.xiantuTargetIndex = state.generals.indexOf(xtTo)
                targetGeneral.xiantuCount = xtCards.length
                targetGeneral.xiantuTurn = state.turnSerial
                targetGeneral.xiantuDamageBaseline = xtTo.damageDealtThisTurn ?? 0
                state.pendingResponseQueue.shift()
                addLog(state, `【${getGeneralName(targetGeneral)}】发动【献图】，将${xtCards.length}张牌交给【${getGeneralName(xtTo)}】`)
                return
            }
            // 资援（糜竺）：交给一名其他角色任意张点数之和为13的牌
            if (ctx.skillId === 'mizhu_ziyuan') {
                const zyTo = state.generals[ctx.ziyuanTargetIndex as number]
                if (!zyTo?.alive) {
                    state.pendingResponseQueue.shift()
                    return
                }
                const zyCards = ids
                    .map(id => targetGeneral.hand.find(c => c.id === id))
                    .filter((c): c is Card => !!c)
                if (zyCards.length === 0) return { error: '请选择点数之和为13的牌' }
                const zySum = zyCards.reduce((acc, c) => acc + c.value, 0)
                if (zySum !== 13) return { error: `所选牌的点数之和须为13（当前${zySum}）` }
                for (const c of zyCards) {
                    targetGeneral.hand.splice(targetGeneral.hand.indexOf(c), 1)
                    zyTo.hand.push(c)
                }
                state.pendingResponseQueue.shift()
                addLog(state, `【${getGeneralName(targetGeneral)}】发动【资援】，将${zyCards.length}张牌交给【${getGeneralName(zyTo)}】`)
                if (zyTo.hp < zyTo.maxHp) {
                    zyTo.hp += 1
                    addLog(state, `【${getGeneralName(zyTo)}】因【资援】回复1点体力（${zyTo.hp}/${zyTo.maxHp}）`)
                    triggerDianhuRecover(state, zyTo)
                }
                return
            }
            // 巧变（张郃）：弃置一张手牌并跳过对应阶段
            if (ctx.skillId === 'zhanghe_qiaobian') {
                const zbCard = targetGeneral.hand.find(c => ids.includes(c.id))
                if (!zbCard) return { error: '请选择一张手牌' }
                targetGeneral.hand.splice(targetGeneral.hand.indexOf(zbCard), 1)
                state.discard.push(zbCard)
                maybeChunlaoPickup(state, targetGeneral, [zbCard])
                state.pendingResponseQueue.shift()
                const zbPhase = ctx.qiaobianPhase as string
                addLog(state, `【${getGeneralName(targetGeneral)}】发动【巧变】，弃置${cardFullName(zbCard)}并跳过${qiaobianPhaseLabel(zbPhase)}阶段`)
                applyQiaobianSkip(state, targetGeneral, zbPhase, !!ctx.qiaobianSkipAction)
                return
            }
            // 求援（界伏皇后）：交给其一张同类别不同名的牌，避免成为额外目标
            if (ctx.skillId === 'fuhuanghou_xuanqiu_give') {
                const xqCtx = ctx.xuanqiuCtx as any
                const xqOwner = state.generals[(xqCtx?.xuanqiuOwnerIndex as number)]
                const xqCard = targetGeneral.hand.find(c => ids.includes(c.id))
                if (!xqCard) return { error: '请选择一张手牌' }
                if (!xqOwner?.alive) {
                    state.pendingResponseQueue.shift()
                    return
                }
                targetGeneral.hand.splice(targetGeneral.hand.indexOf(xqCard), 1)
                xqOwner.hand.push(xqCard)
                state.pendingResponseQueue.shift()
                addLog(state, `【${getGeneralName(targetGeneral)}】因【求援】将${cardFullName(xqCard)}交给【${getGeneralName(xqOwner)}】，不再成为此牌的目标`)
                resumeXuanqiuUse(state, xqCtx)
                return
            }
            // 将驰（界曹彰）：重铸一张牌，然后本回合【杀】无距离限制且次数上限+1
            if (ctx.skillId === 'caozhang_jiangchi_recast') {
                const jcCard = targetGeneral.hand.find(c => ids.includes(c.id))
                if (!jcCard) return { error: '请选择一张手牌' }
                targetGeneral.hand.splice(targetGeneral.hand.indexOf(jcCard), 1)
                state.discard.push(jcCard)
                maybeChunlaoPickup(state, targetGeneral, [jcCard])
                const jcDrawn = drawForGeneral(state, targetGeneral, 1)
                targetGeneral.hand.push(...jcDrawn)
                targetGeneral.slashNoRangeTurn = true
                targetGeneral.slashLimitDelta = (targetGeneral.slashLimitDelta ?? 0) + 1
                state.pendingResponseQueue.shift()
                addLog(state, `【${getGeneralName(targetGeneral)}】【将驰】重铸${cardFullName(jcCard)}并摸${jcDrawn.length}张牌，本回合使用【杀】无距离限制且次数上限+1`)
                finishJudgePhaseAndContinue(state, targetGeneral, !!ctx.skipAction, true)
                return
            }
            // 仁心（界曹冲）：弃置一张装备牌，令濒死角色将体力回复至1点
            if (ctx.skillId === 'caochong_renxin') {
                const rxIdx = ctx.renxinTargetIndex as number
                state.pendingResponseQueue.shift()
                for (let qi = state.pendingResponseQueue.length - 1; qi >= 0; qi--) {
                    const rp = state.pendingResponseQueue[qi]
                    if (rp.type === ResponseType.PEACH_SAVE_ASK
                        && (rp.context as any)?.dyingGeneralIndex === rxIdx) {
                        state.pendingResponseQueue.splice(qi, 1)
                    }
                }
                const rxT = state.generals[rxIdx]
                if (rxT?.alive) {
                    rxT.hp = 1
                    addLog(state, `【${getGeneralName(targetGeneral)}】发动【仁心】，【${getGeneralName(rxT)}】将体力回复至1点（${rxT.hp}/${rxT.maxHp}）`)
                }
                return
            }
            // 拼点：双方各选一张手牌，比点数
            if (ctx.mode === 'pindian') {
                const pin = state.pindian
                if (!pin) {
                    state.pendingResponseQueue.shift()
                    return
                }
                const pinCard = ids.length > 0 ? targetGeneral.hand.find(c => c.id === ids[0]) : undefined
                if (!pinCard) return { error: '请选择一张手牌拼点' }
                targetGeneral.hand.splice(targetGeneral.hand.indexOf(pinCard), 1)
                state.pendingResponseQueue.shift()
                if (pin.stage === 'initiator') {
                    pin.stage = 'opponent'
                    pin.firstCard = pinCard
                    addLog(state, `【${getGeneralName(targetGeneral)}】【${pin.skillName}】拼点打出${cardFullName(pinCard)}`)
                    // 酣战①（界太史慈）：对方改为用随机的一张手牌拼点
                    if ((pin.extra as any)?.hanzhanRandom) {
                        const pinOpp = state.generals[pin.opponentIndex]
                        if (!pinOpp?.alive || pinOpp.hand.length === 0) {
                            resolvePindian(state, pinCard, undefined)
                            return
                        }
                        const rndCard = pinOpp.hand.splice(randomInt(pinOpp.hand.length), 1)[0]
                        addLog(state, `【${getGeneralName(pinOpp)}】【酣战】随机打出${cardFullName(rndCard)}`)
                        resolvePindian(state, pinCard, rndCard)
                        return
                    }
                    state.pendingResponseQueue.unshift({
                        type: ResponseType.SKILL_PICK_CARD,
                        targetGeneralIndex: pin.opponentIndex,
                        context: {
                            skillId: 'pindian', skillName: pin.skillName, count: 1, mode: 'pindian',
                            description: `与【${getGeneralName(targetGeneral)}】拼点：选择一张手牌`,
                            pindianStage: 'opponent',
                        },
                    })
                    return
                }
                if (!pin.firstCard) {
                    state.discard.push(pinCard)
                    state.pindian = undefined
                    return
                }
                resolvePindian(state, pin.firstCard, pinCard)
                return
            }
            // 灭计（李儒）：交给其一张锦囊牌
            if (ctx.skillId === 'liru_mieji_give') {
                const mjOwner2 = state.generals[ctx.miejiOwnerIndex as number]
                const giveCard = ids.length > 0 ? findCardInHandOrEquip(targetGeneral, ids[0]) : undefined
                if (!giveCard) return { error: '请选择一张锦囊牌' }
                if (giveCard.category !== CardCategory.TRICK) return { error: '须为锦囊牌' }
                state.pendingResponseQueue.shift()
                const removedGive = removeCardFromHandOrEquip(state, targetGeneral, giveCard.id)
                if (!('error' in removedGive) && mjOwner2?.alive) mjOwner2.hand.push(removedGive)
                addLog(state, `【${getGeneralName(targetGeneral)}】【灭计】将${cardFullName(giveCard)}交给【${getGeneralName(mjOwner2)}】`)
                return
            }
            const maxCount = Math.max(1, (ctx.count as number) ?? 1)
            if (ids.length === 0) return { error: '请选择至少一张牌' }
            if (ids.length > maxCount) return { error: `最多选择 ${maxCount} 张牌` }
            const candidateCardIds = (ctx.candidateCardIds as string[] | undefined) ?? []
            const cards: Card[] = []
            for (const id of ids) {
                if (candidateCardIds.length > 0 && !candidateCardIds.includes(id)) return { error: '该牌不可选' }
                const c = findCardInHandOrEquip(targetGeneral, id)
                if (!c) return { error: '找不到该牌' }
                cards.push(c)
            }
            if (ctx.mode === 'pile') {
                for (const card of cards) {
                    const handIdx = targetGeneral.hand.indexOf(card)
                    if (handIdx >= 0) {
                        targetGeneral.hand.splice(handIdx, 1)
                    } else {
                        for (const slot of Object.values(EquipSlot)) {
                            if (targetGeneral.equip[slot]?.id === card.id) {
                                clearEquipSlot(state, targetGeneral, slot)
                                triggerXiaoji(state, targetGeneral)
                            }
                        }
                    }
                    targetGeneral.generalPile!.push(card)
                }
                addLog(state, `【${getGeneralName(targetGeneral)}】发动【${ctx.skillName}】，将 ${cards.length} 张牌置于武将牌上`)
            } else {
                for (const card of cards) {
                    const removed = removeCardFromHandOrEquip(state, targetGeneral, card.id)
                    if ('error' in (removed as any)) return { error: (removed as any).error }
                    addLog(state, `【${getGeneralName(targetGeneral)}】因【${ctx.skillName}】弃置了${cardFullName(card)}`)
                }
            }
            // 成略（许攸）：记录弃置牌的花色，本回合这些花色无距离与次数限制
            if (ctx.skillId === 'xuyou_chenglue') {
                const suits = cards.map(c => c.suit)
                targetGeneral.chenglueSuits = [...(targetGeneral.chenglueSuits ?? []), ...suits]
                addLog(state, `【${getGeneralName(targetGeneral)}】【成略】弃置${suits.map(s => suitSymbol(s)).join('')}，本回合这些花色无距离与次数限制`)
            }
            // 倾袭（曹休）：弃牌后其弃置武器，并恢复伤害结算
            if (ctx.skillId === 'caoxiu_qingxi') {
                const qxAttacker = state.generals[ctx.qingxiAttackerIndex as number]
                if (qxAttacker?.equip[EquipSlot.WEAPON]) {
                    const qxWeapon = qxAttacker.equip[EquipSlot.WEAPON]!
                    clearEquipSlot(state, qxAttacker, EquipSlot.WEAPON)
                    state.discard.push(qxWeapon)
                    addLog(state, `【${getGeneralName(qxAttacker)}】【倾袭】弃置武器${cardFullName(qxWeapon)}`)
                }
                state.pendingResponseQueue.shift()
                if (qxAttacker) {
                    dealDamage(state, qxAttacker, targetGeneral, ctx.qingxiAmount as number,
                        ctx.qingxiCardId, { ...((ctx.qingxiResumeOpts as any) ?? {}), skipQingxi: true })
                }
                return
            }
            // 倾袭（界曹休）：目标弃牌后其弃置武器并恢复伤害结算
            if (ctx.skillId === 'caoxiu_jie_qingxi') {
                state.pendingResponseQueue.shift()
                const jqAtk = state.generals[ctx.qingxiJieAttackerIndex as number]
                const jqTgt = state.generals[ctx.qingxiJieTargetIndex as number]
                if (jqAtk && jqTgt) {
                    finishJieQingxi(state, jqAtk, jqTgt, !!ctx.qingxiBonus,
                        (ctx.qingxiAmount as number) ?? 0, ctx.qingxiCardId, ctx.qingxiNature,
                        !!ctx.qingxiDropWeapon, ctx.qingxiResumeOpts)
                }
                return
            }
            // 灭计（李儒）：依次弃置两张非锦囊牌，不足则只弃一张
            if (ctx.skillId === 'liru_mieji') {
                state.pendingResponseQueue.shift()
                if (!ctx.miejiSecond) {
                    const mjRest = [
                        ...targetGeneral.hand.filter(c => c.category !== CardCategory.TRICK).map(c => c.id),
                        ...Object.values(targetGeneral.equip).filter(Boolean).map(c => c!.id),
                    ]
                    if (mjRest.length > 0) {
                        addLog(state, `【${getGeneralName(targetGeneral)}】【灭计】须再弃置一张非锦囊牌`)
                        askPickCard(state, targetGeneral, 'liru_mieji', '灭计', '弃置第二张非锦囊牌',
                            { count: 1, mode: 'discard', candidateCardIds: mjRest,
                                extra: { miejiSecond: true, miejiOwnerIndex: ctx.miejiOwnerIndex } })
                    }
                }
                return
            }
            // 实荐（许靖）：弃置一张牌，令其本回合获得【誉虚】
            if (ctx.skillId === 'xujing_shijian') {
                state.pendingResponseQueue.shift()
                const sjTarget = state.generals[ctx.shijianTargetIndex as number]
                if (sjTarget?.alive && !hasSkill(sjTarget, 'xujing_yuxu')) {
                    sjTarget.acquiredSkills = [...(sjTarget.acquiredSkills ?? []), 'xujing_yuxu']
                    sjTarget.yuxuGrantedTurn = state.turnSerial
                    addLog(state, `【${getGeneralName(targetGeneral)}】发动【实荐】，【${getGeneralName(sjTarget)}】本回合获得【誉虚】`)
                }
                return
            }
            // 醇醪（程普）：已放置“醇”
            if (ctx.skillId === 'chengpu_chunlao') {
                targetGeneral.chunlaoPlaced = true
            }
            // 放权（刘禅）：记下额外回合的角色，回合结束阶段交给 advanceAfterTurn
            if (ctx.skillId === 'liushan_fangquan' && typeof ctx.fangquanTargetIndex === 'number') {
                state.fangquanFor = ctx.fangquanTargetIndex
                state.turnPhase = TurnPhase.TURN_END
                addLog(state, `【${getGeneralName(targetGeneral)}】【放权】令【${getGeneralName(state.generals[ctx.fangquanTargetIndex])}】执行额外回合`)
            }
            state.pendingResponseQueue.shift()
            if (typeof (ctx as any).xiaoguoTargetIndex === 'number') {
                const xiaoguoTarget = state.generals[(ctx as any).xiaoguoTargetIndex]
                if (xiaoguoTarget?.alive) resolveXiaoguo(state, targetGeneral, xiaoguoTarget)
            }
            if ((ctx as any).endPhase) advanceTurnGuarded(state)
            return
        }

        case ResponseType.SKILL_SHUOMENG_TARGET: {
            const chosenIdx = (data as any).targetIndex as number | undefined
            const atActionEnd = !!(pending.context as any)?.atActionEnd
            if (chosenIdx === undefined) {
                state.pendingResponseQueue.shift()
                addLog(state, `【${getGeneralName(targetGeneral)}】放弃发动【说盟】`)
                if (atActionEnd) proceedAfterShuomeng(state)
                else advanceTurnGuarded(state)
                return
            }
            const chosen = state.generals[chosenIdx]
            if (!chosen || !chosen.alive || chosen === targetGeneral) {
                return { error: '须选择一名其他存活角色' }
            }
            if (targetGeneral.hand.length === 0 || chosen.hand.length === 0) {
                return { error: '双方都须有手牌' }
            }
            state.pendingResponseQueue.shift()
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_SHUOMENG_CARD,
                targetGeneralIndex: state.generals.indexOf(targetGeneral),
                context: {
                    phase: 'first',
                    opponentIndex: chosenIdx,
                    atActionEnd,
                },
            })
            addLog(state, `【${getGeneralName(targetGeneral)}】发动【说盟】，与【${getGeneralName(chosen)}】拼点，选择一张手牌`)
            return
        }

        // ── 说盟（孙乾）：选择拼点用的手牌
        case ResponseType.SKILL_SHUOMENG_CARD: {
            const sctx = pending.context as any
            const cardId = data.cardId
            if (!cardId) return { error: '请选择一张手牌拼点' }
            const cardIdx = targetGeneral.hand.findIndex((c: Card) => c.id === cardId)
            if (cardIdx === -1) return { error: '手牌中没有此牌' }
            const card = targetGeneral.hand.splice(cardIdx, 1)[0]
            state.discard.push(card)
            state.pendingResponseQueue.shift()

            if (sctx.phase !== 'second') {
                const opponent = state.generals[sctx.opponentIndex as number]
                if (!opponent || !opponent.alive || opponent.hand.length === 0) {
                    const drawn = drawCards(state, 2)
                    targetGeneral.hand.push(...drawn)
                    addLog(state, `【${getGeneralName(targetGeneral)}】与【${opponent ? getGeneralName(opponent) : '对手'}】拼点（对方无手牌），视为使用【无中生有】摸 ${drawn.length} 张牌`)
                    if (sctx.atActionEnd) proceedAfterShuomeng(state)
                    else advanceTurnGuarded(state)
                    return
                }
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_SHUOMENG_CARD,
                    targetGeneralIndex: state.generals.indexOf(opponent),
                    context: {
                        phase: 'second',
                        opponentIndex: state.generals.indexOf(targetGeneral),
                        firstCard: card,
                        firstOwnerIndex: state.generals.indexOf(targetGeneral),
                        atActionEnd: !!(sctx as any).atActionEnd,
                    },
                })
                addLog(state, `【${getGeneralName(targetGeneral)}】拼点亮出${cardFullName(card)}`)
                return
            }

            const firstCard = sctx.firstCard as Card
            const initiator = state.generals[sctx.firstOwnerIndex as number]
            if (!firstCard || !initiator) {
                advanceTurnGuarded(state)
                return
            }
            const win = firstCard.value > card.value
            addLog(state, `【${getGeneralName(initiator)}】发动【说盟】与【${getGeneralName(targetGeneral)}】拼点：${valueName(firstCard.value)} vs ${valueName(card.value)}，${win ? '赢' : '没赢'}`)
            if (win) {
                // 视为使用【无中生有】
                const drawn = drawCards(state, 2)
                initiator.hand.push(...drawn)
                addLog(state, `【${getGeneralName(initiator)}】视为使用【无中生有】，摸 ${drawn.length} 张牌`)
            } else {
                // 其视为对孙乾使用【过河拆桥】：弃置孙乾一张牌（由对方挑选）
                const pool: { card: Card; from: 'hand' | 'equip' }[] = [
                    ...initiator.hand.map(c => ({ card: c, from: 'hand' as const })),
                    ...Object.values(EquipSlot)
                        .map(slot => initiator.equip[slot])
                        .filter((c): c is Card => !!c)
                        .map(c => ({ card: c, from: 'equip' as const })),
                ]
                if (pool.length > 0) {
                    const score = (c: Card) => {
                        if (c.name === BasicCardName.PEACH) return 100
                        if (c.name === BasicCardName.DODGE) return 90
                        if (c.category === CardCategory.EQUIPMENT) return 85
                        return 70
                    }
                    const pick = [...pool].sort((a, b) => score(b.card) - score(a.card))[0]
                    if (pick.from === 'hand') {
                        const i = initiator.hand.indexOf(pick.card)
                        if (i >= 0) initiator.hand.splice(i, 1)
                    } else {
                        for (const slot of Object.values(EquipSlot)) {
                            if (initiator.equip[slot]?.id === pick.card.id) {
                                initiator.equip[slot] = undefined as any
                                triggerXiaoji(state, initiator)
                                break
                            }
                        }
                    }
                    state.discard.push(pick.card)
                    checkMingzhe(state, initiator, pick.card)
                    checkTuntian(state, initiator)
                    triggerLianying(state, initiator)
                    addLog(state, `【${getGeneralName(targetGeneral)}】视为对【${getGeneralName(initiator)}】使用【过河拆桥】，弃置了${cardFullName(pick.card)}`)
                }
            }
            if (sctx.atActionEnd) proceedAfterShuomeng(state)
            else advanceTurnGuarded(state)
            return
        }

        // ── 秘计（王异）：选择交牌对象与手牌
        case ResponseType.SKILL_MIJI_GIVE: {
            const mctx = pending.context as any
            const giverIdx = state.generals.indexOf(targetGeneral)
            if (mctx.phase === 'target') {
                const chosenIdx = (data as any).targetIndex as number | undefined
                if (chosenIdx === undefined || (data as any).action === 'decline') {
                    state.pendingResponseQueue.shift()
                    addLog(state, `【${getGeneralName(targetGeneral)}】放弃交牌（秘计）`)
                    advanceTurnGuarded(state)
                    return
                }
                const receiver = state.generals[chosenIdx]
                const candidates = (mctx.candidateIndices as number[]) ?? []
                if (!receiver || !receiver.alive || !candidates.includes(chosenIdx)) {
                    return { error: '须选择一名其他存活角色' }
                }
                state.pendingResponseQueue.shift()
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_MIJI_GIVE,
                    targetGeneralIndex: giverIdx,
                    context: {
                        phase: 'cards',
                        count: mctx.count ?? 0,
                        receiverIndex: chosenIdx,
                    },
                })
                addLog(state, `【${getGeneralName(targetGeneral)}】选择将手牌交给【${getGeneralName(receiver)}】`)
                return
            }

            const count = Math.max(0, mctx.count ?? 0)
            const receiverIdx = mctx.receiverIndex as number | undefined
            const receiver = receiverIdx !== undefined ? state.generals[receiverIdx] : undefined
            if (!receiver?.alive) {
                state.pendingResponseQueue.shift()
                advanceTurnGuarded(state)
                return
            }
            const ids: string[] = (data as any).cardIds
                ?? ((data as any).cardId ? [(data as any).cardId] : [])
            if (ids.length === 0 || (data as any).action === 'decline') {
                state.pendingResponseQueue.shift()
                addLog(state, `【${getGeneralName(targetGeneral)}】放弃交牌（秘计）`)
                advanceTurnGuarded(state)
                return
            }
            // 界王异可只交至多等量的手牌，基础王异须交足等量
            if (ids.length > count) return { error: `最多只能交 ${count} 张手牌` }
            if (targetGeneral.generalId !== 'wangyi_jie' && ids.length !== count) return { error: `须选择 ${count} 张手牌` }
            if (new Set(ids).size !== ids.length) return { error: '选择的牌重复' }
            const indices: number[] = []
            for (const id of ids) {
                const i = targetGeneral.hand.findIndex((c: Card) => c.id === id)
                if (i === -1) return { error: '手牌中没有此牌' }
                indices.push(i)
            }
            const gift = indices.sort((a, b) => b - a).map(i => targetGeneral.hand.splice(i, 1)[0])
            receiver.hand.push(...gift)
            state.pendingResponseQueue.shift()
            addLog(state, `【${getGeneralName(targetGeneral)}】将 ${gift.length} 张手牌交给【${getGeneralName(receiver)}】（秘计）`)
            advanceTurnGuarded(state)
            return
        }

        // ── 奇制（王基）：选择弃牌目标
        case ResponseType.SKILL_QIZHI_TARGET: {
            const chosenIdx = (data as any).targetIndex as number | undefined
            if (chosenIdx === undefined) {
                state.pendingResponseQueue.shift()
                addLog(state, `【${getGeneralName(targetGeneral)}】放弃发动【奇制】`)
                return
            }
            const victim = state.generals[chosenIdx]
            const candidates = ((pending.context as any)?.candidateIndices as number[]) ?? []
            if (!victim || !victim.alive || !candidates.includes(chosenIdx)) {
                return { error: '须选择一名非目标角色' }
            }
            if (victim.hand.length === 0 && !Object.values(victim.equip).some(Boolean)) {
                return { error: '该角色没有可弃置的牌' }
            }
            state.pendingResponseQueue.shift()
            state.pendingResponseQueue.unshift({
                type: ResponseType.TRICK_TARGET_CARD_PICK,
                targetGeneralIndex: state.generals.indexOf(targetGeneral),
                context: {
                    targetIndex: chosenIdx,
                    trickType: 'dismantle',
                    label: '奇制',
                    qizhiUserIndex: state.generals.indexOf(targetGeneral),
                },
            })
            addLog(state, `【${getGeneralName(targetGeneral)}】发动【奇制】，弃置【${getGeneralName(victim)}】一张牌`)
            return
        }

        // ── 独锋（凌操）：失去1点体力或废除一个装备栏
        case ResponseType.SKILL_DUFENG_CHOICE: {
            const action = (data as any).action as string | undefined
            const slot = (data as any).slot as EquipSlot | undefined
            state.pendingResponseQueue.shift()
            resolveDufeng(state, targetGeneral, action === 'abolish' ? 'abolish' : 'loseHp', slot)
            return
        }

        // ── 进趋（王基）：选择弃置哪些手牌
        case ResponseType.SKILL_JINQU_DISCARD: {
            const count = Math.max(0, ((pending.context as any)?.discardCount as number) ?? 0)
            const ids: string[] = (data as any).cardIds
                ?? ((data as any).cardId ? [(data as any).cardId] : [])
            if (ids.length !== count) return { error: `须弃置 ${count} 张手牌` }
            if (new Set(ids).size !== ids.length) return { error: '选择的牌重复' }
            const indices: number[] = []
            for (const id of ids) {
                const i = targetGeneral.hand.findIndex((c: Card) => c.id === id)
                if (i === -1) return { error: '手牌中没有此牌' }
                indices.push(i)
            }
            const discarded = indices.sort((a, b) => b - a).map(i => targetGeneral.hand.splice(i, 1)[0])
            state.discard.push(...discarded)
            state.pendingResponseQueue.shift()
            addLog(state, `【${getGeneralName(targetGeneral)}】将手牌弃置至 ${(pending.context as any)?.qizhiTarget ?? 0} 张（进趋）`)
            advanceTurnGuarded(state)
            return
        }

        // ── 点虎（黄权）：游戏开始时选择一名其他角色
        case ResponseType.SKILL_DIANHU_TARGET: {
            const chosenIdx = (data as any).targetIndex as number | undefined
            if (chosenIdx === undefined) {
                addLog(state, `【${getGeneralName(targetGeneral)}】放弃发动【点虎】`)
                state.pendingResponseQueue.shift()
                continueFromPrepPhase(state)
                return
            }
            const chosen = state.generals[chosenIdx]
            if (!chosen || !chosen.alive || chosen === targetGeneral) return { error: '须选择一名其他存活角色' }
            targetGeneral.dianhuTargetIndex = chosenIdx
            state.pendingResponseQueue.shift()
            addLog(state, `【${getGeneralName(targetGeneral)}】发动【点虎】，指定【${getGeneralName(chosen)}】`)
            continueFromPrepPhase(state)
            return
        }

        // ── 潜袭（马岱）：弃一张牌，令一名距离1的角色不能用/打出同色手牌
        case ResponseType.SKILL_QIANXI_PICK: {
            if (data.cardId === 'decline' || (data as any).action === 'decline') {
                addLog(state, `【${getGeneralName(targetGeneral)}】放弃发动【潜袭】`)
                state.pendingResponseQueue.shift()
                continueFromPrepPhase(state)
                return
            }
            const qianxiCardId = ((data as any).cardIds ?? [])[0] ?? data.cardId
            if (!qianxiCardId) return { error: '请选择一张手牌展示' }
            const qianxiShown = targetGeneral.hand.find((c) => c.id === qianxiCardId)
            if (!qianxiShown) return { error: '须展示一张手牌' }
            const isRed = qianxiShown.suit === CardSuit.HEART || qianxiShown.suit === CardSuit.DIAMOND
            targetGeneral.qianxiCardId = qianxiShown.id
            targetGeneral.qianxiTurn = state.turnSerial
            const qianxiBlocked: string[] = []
            for (const g of state.generals) {
                if (!g.alive || g === targetGeneral) continue
                if (getAttackRange(targetGeneral, g, state.generals).distance > 1) continue
                g.qianxiColor = isRed ? 'red' : 'black'
                qianxiBlocked.push(getGeneralName(g))
            }
            state.pendingResponseQueue.shift()
            addLog(state, `【${getGeneralName(targetGeneral)}】发动【潜袭】，展示${cardFullName(qianxiShown)}，本回合使用此牌造成的伤害+1`)
            if (qianxiBlocked.length > 0) {
                addLog(state, `【潜袭】：【${qianxiBlocked.join('】【')}】本回合不能使用或打出${isRed ? '红' : '黑'}色手牌`)
            }
            continueFromPrepPhase(state)
            return
        }

        // ── 反间（界周瑜）：目标选择弃同花色手牌或失去1点体力
        case ResponseType.SKILL_FANJIAN_CHOICE: {
            const fjCtx = pending.context as {
                fanjianUserIndex: number
                fanjianSuit: CardSuit
                fanjianCardId: string
            }
            const action = (data as any).action as string | undefined
            state.pendingResponseQueue.shift()
            if (action === 'discard') {
                const suit = fjCtx.fanjianSuit
                const kept: Card[] = []
                let discarded = 0
                for (const c of targetGeneral.hand) {
                    if (c.suit === suit) {
                        state.discard.push(c)
                        discarded++
                    } else {
                        kept.push(c)
                    }
                }
                targetGeneral.hand = kept
                addLog(state, `【${getGeneralName(targetGeneral)}】展示所有手牌，弃置 ${discarded} 张${suitSymbol(suit)}牌`)
                triggerLianying(state, targetGeneral)
            } else if (action === 'loseHp') {
                addLog(state, `【${getGeneralName(targetGeneral)}】选择失去1点体力（反间）`)
                loseHp(state, targetGeneral, 1)
            } else {
                return { error: '请选择：弃置同花色牌或失去1点体力' }
            }
            return
        }

        // ── 忠勇（周仓）：选择把杀/闪交给哪名角色
        case ResponseType.SKILL_ZHONGYONG_GIVE: {
            const zyCtx = pending.context as any
            const action = (data as any).action as string | undefined
            if (!action || action === 'decline') {
                addLog(state, `【${getGeneralName(targetGeneral)}】放弃发动【忠勇】`)
                state.pendingResponseQueue.shift()
                return
            }
            const recipientIdx = (data as any).targetIndex as number | undefined
            if (recipientIdx === undefined) return { error: '请选择一名其他角色' }
            const recipient = state.generals[recipientIdx]
            const selfIdx = state.generals.indexOf(targetGeneral)
            if (!recipient?.alive || recipientIdx === selfIdx) return { error: '请选择一名其他角色' }
            const cardId = action === 'give_slash'
                ? zyCtx.attackCardId as string | undefined
                : (zyCtx.dodgeCardIds as string[] | undefined)?.[0]
            if (!cardId) return { error: '没有可交出的牌' }
            const discardIdx = state.discard.findIndex(c => c.id === cardId)
            if (discardIdx === -1) return { error: '此牌已不在弃牌堆' }
            const given = state.discard.splice(discardIdx, 1)[0]
            recipient.hand.push(given)
            state.pendingResponseQueue.shift()
            addLog(state, `【${getGeneralName(targetGeneral)}】发动【忠勇】，将${cardFullName(given)}交给【${getGeneralName(recipient)}】`)
            if (given.suit === CardSuit.SPADE || given.suit === CardSuit.CLUB) {
                const zyDraw = drawCards(state, 1)
                recipient.hand.push(...zyDraw)
                addLog(state, `【${getGeneralName(recipient)}】因【忠勇】获得黑色牌，摸 ${zyDraw.length} 张牌`)
            } else if (given.suit === CardSuit.HEART || given.suit === CardSuit.DIAMOND) {
                pushZhongyongSlash(state, recipientIdx, selfIdx, given)
            }
            return
        }

        // ── 忠勇：受牌者视为使用一张【杀】
        case ResponseType.SKILL_ZHONGYONG_SLASH: {
            const zyCtx = pending.context as any
            const action = (data as any).action as string | undefined
            const selfIdx = state.generals.indexOf(targetGeneral)
            if (!action || action === 'decline') {
                addLog(state, `【${getGeneralName(targetGeneral)}】放弃出杀（忠勇）`)
                state.pendingResponseQueue.shift()
                return
            }
            const slashTargetIdx = (data as any).targetIndex as number | undefined
            if (!data.cardId || slashTargetIdx === undefined) return { error: '请选择【杀】和目标' }
            const slashTarget = state.generals[slashTargetIdx]
            if (!slashTarget?.alive || slashTargetIdx === selfIdx) return { error: '请选择一名其他角色' }
            if (!getAttackRange(targetGeneral, slashTarget, state.generals).inRange) {
                return { error: '目标不在攻击范围内' }
            }
            const handIdx = targetGeneral.hand.findIndex(c => c.id === data.cardId)
            if (handIdx === -1) return { error: '手牌中没有此牌' }
            const slashCard = targetGeneral.hand[handIdx]
            if (!isCardUsableAsAttack(targetGeneral, slashCard)) return { error: '此牌不能当【杀】使用' }
            if (blockedByQianxi(targetGeneral, slashCard)) return { error: '【潜袭】：不能打出该颜色的手牌' }
            targetGeneral.hand.splice(handIdx, 1)
            state.discard.push(slashCard)
            state.pendingResponseQueue.shift()
            addLog(state, `【${getGeneralName(targetGeneral)}】通过【忠勇】视为对【${getGeneralName(slashTarget)}】使用【杀】`)
            state.pendingResponseQueue.unshift({
                type: ResponseType.DODGE,
                targetGeneralIndex: slashTargetIdx,
                context: {
                    attackerGeneralIndex: selfIdx,
                    requiredDodges: hasSkill(targetGeneral, 'lvbu_wushuang') ? 2 : 1,
                    dodgesReceived: 0,
                    attackCard: slashCard,
                },
            })
            return
        }

        default:
            return { error: '未知响应类型' }
    }
}

/** 赈赡（界全琮）：当前响应需要哪张基本牌 */
function zhenshanRequiredBasic(pending: PendingResponse): BasicCardName | undefined {
    switch (pending.type) {
        case ResponseType.DODGE:
        case ResponseType.AOE_DODGE:
            return BasicCardName.DODGE
        case ResponseType.ATTACK_DUEL:
        case ResponseType.AOE_ATTACK:
            return BasicCardName.ATTACK
        case ResponseType.PEACH_SAVE_ASK:
            return BasicCardName.PEACH
        default:
            return undefined
    }
}

/**
 * 赈赡（界全琮）：与手牌数少于自己的一名角色交换手牌，视为使用或打出了所需基本牌。
 * 成功后会把一张虚拟基本牌写回 data.cardId，由原有响应分支继续结算。
 */
function applyZhenshanResponse(
    state: GameState,
    general: GeneralInstance,
    pending: PendingResponse,
    data: C2S_Respond,
): { error: string } | void {
    if (!hasSkill(general, 'quancong_zhenshan')) return { error: '你没有【赈赡】' }
    if ((pending.context as any)?.unavoidable) return { error: '此【杀】不能被响应' }
    const required = zhenshanRequiredBasic(pending)
    if (!required) return { error: '当前不是需要使用或打出基本牌的时机' }
    const freeActive = general.zhenshanFreeSeat === state.activeGeneralIndex
    if (!freeActive && general.zhenshanUseTurn === state.turnSerial) {
        return { error: '本回合已发动过【赈赡】' }
    }
    const selfIdx = state.generals.indexOf(general)
    const candidates = state.generals
        .map((g, i) => ({ g, i }))
        .filter(({ g, i }) => g.alive && i !== selfIdx && g.hand.length < general.hand.length)
        .map(({ i }) => i)
    if (candidates.length === 0) return { error: '没有手牌数少于你的角色' }
    const chosenIdx = (data as any).targetIndex as number | undefined
    if (chosenIdx === undefined || !candidates.includes(chosenIdx)) {
        return { error: '请选择一名手牌数少于你的角色' }
    }
    const partner = state.generals[chosenIdx]
    const ownHand = general.hand
    general.hand = partner.hand
    partner.hand = ownHand
    general.zhenshanUseTurn = state.turnSerial
    const basicName = required === BasicCardName.DODGE ? '闪'
        : required === BasicCardName.ATTACK ? '杀' : '桃'
    addLog(state, `【${getGeneralName(general)}】发动【赈赡】，与【${getGeneralName(partner)}】交换手牌，视为使用或打出【${basicName}】`)
    // 虚拟牌的颜色避开【潜袭】的封锁
    const suitOrder: CardSuit[] = general.qianxiColor === 'red'
        ? [CardSuit.SPADE, CardSuit.CLUB, CardSuit.HEART, CardSuit.DIAMOND]
        : [CardSuit.DIAMOND, CardSuit.HEART, CardSuit.SPADE, CardSuit.CLUB]
    const suit: CardSuit = suitOrder.find(s => !blockedByQianxi(general, { suit: s } as Card)) ?? CardSuit.DIAMOND
    const virtualId = `zhenshan_${state.turnSerial}_${selfIdx}_${state.log.length}`
    general.hand.push({
        id: virtualId,
        name: required,
        suit,
        value: 1,
        category: CardCategory.BASIC,
        virtual: true,
    } as Card)
    ;(data as any).cardId = virtualId
    ;(data as any).action = pending.type === ResponseType.PEACH_SAVE_ASK ? 'peach' : undefined
    // 然后可以发动一次【邀名】（排在当前响应之后结算）
    state.pendingResponseQueue.push({
        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
        targetGeneralIndex: selfIdx,
        context: {
            skillId: 'quancong_yaoming_free',
            skillName: '邀名',
            description: '是否发动【邀名】？',
            options: [{ action: 'yaoming', label: '发动【邀名】' }],
        },
    })
    return
}

function handleDodgeResponse(
    state: GameState,
    targetGeneral: GeneralInstance,
    pending: PendingResponse,
    data: C2S_Respond
): { error: string } | void {
    const ctx = pending.context as {
        attackerGeneralIndex: number
        requiredDodges: number
        dodgesReceived: number
        attackCard?: Card
        dodgeCards?: Card[]
    }
    const attacker = ctx.attackerGeneralIndex >= 0 ? state.generals[ctx.attackerGeneralIndex] : null
    const action = (data as any).action as string | undefined

    // 此【杀】不能被响应（伏骑/烈弓/诈降/天义）：只能放弃出【闪】
    if ((ctx as any).unavoidable && (data.cardId || action)) {
        return { error: '此【杀】不能被【闪】响应' }
    }

    // ── 傲才（诸葛恪）：回合外观看牌堆顶两张，使用其中一张【闪】
    if (action === 'aocai') {
        if (!hasSkill(targetGeneral, 'zhugeke_aocai')) return { error: '你没有此技能' }
        if (state.activeGeneralIndex === state.generals.indexOf(targetGeneral)) {
            return { error: '【傲才】只能在回合外发动' }
        }
        if (state.deck.length === 0) return { error: '牌堆为空' }
        const aocaiCtx = ctx as any
        if (aocaiCtx.aocaiTried) return { error: '本次响应已使用过【傲才】' }
        aocaiCtx.aocaiTried = true
        const top = state.deck.splice(0, Math.min(2, state.deck.length))
        const usable = top.find(c => isCardUsableAsDodge(targetGeneral, c) && !blockedByQianxi(targetGeneral, c))
        if (!usable) {
            state.deck.unshift(...top)
            addLog(state, `【${getGeneralName(targetGeneral)}】发动【傲才】未找到可用的【闪】`)
            return { error: '【傲才】未找到可用的【闪】' }
        }
        state.deck.unshift(...top.filter(c => c !== usable))
        state.discard.push(usable)
        ctx.dodgeCards = [...(ctx.dodgeCards ?? []), usable]
        ctx.dodgesReceived = (ctx.dodgesReceived || 0) + 1
        addLog(state, `【${getGeneralName(targetGeneral)}】发动【傲才】，视为打出【闪】（${ctx.dodgesReceived}/${ctx.requiredDodges}）`)
        if (ctx.dodgesReceived >= ctx.requiredDodges) {
            addLog(state, `【${getGeneralName(targetGeneral)}】成功防御【杀】`)
            handleDodgeSucceeded(state, targetGeneral, ctx)
        }
        return
    }

    // ── 活墨（钟繇）：将一张黑色非基本牌置于牌堆顶，视为使用【闪】
    if (action === 'huomo') {
        if (!hasSkill(targetGeneral, 'zhongyao_huomo')) return { error: '你没有此技能' }
        if (!data.cardId) return { error: '请选择一张黑色非基本牌' }
        const hmCard = findCardInHandOrEquip(targetGeneral, data.cardId)
        if (!hmCard) return { error: '找不到该牌' }
        const isBlackCard = hmCard.suit === CardSuit.SPADE || hmCard.suit === CardSuit.CLUB
        if (hmCard.category === CardCategory.BASIC || !isBlackCard) {
            return { error: '【活墨】须将一张黑色非基本牌置于牌堆顶' }
        }
        const hmRemoved = detachCardFromHandOrEquip(state, targetGeneral, hmCard.id)
        if ('error' in hmRemoved) return hmRemoved
        state.deck.unshift(hmCard)
        ctx.dodgesReceived = (ctx.dodgesReceived || 0) + 1
        addLog(state, `【${getGeneralName(targetGeneral)}】发动【活墨】，将${cardFullName(hmCard)}置于牌堆顶，视为使用【闪】`)
        if (ctx.dodgesReceived >= ctx.requiredDodges) {
            addLog(state, `【${getGeneralName(targetGeneral)}】成功防御【杀】`)
            handleDodgeSucceeded(state, targetGeneral, ctx)
        }
        return
    }

    // ── 饰非（郭图逢纪）：令当前回合角色摸一张，然后弃手牌最多者一张牌，视为使用【闪】
    if (action === 'shifei') {
        if (!hasSkill(targetGeneral, 'guotu_shifei')) return { error: '你没有此技能' }
        const shifeiCtx = ctx as any
        if (shifeiCtx.shifeiTried) return { error: '本次响应已使用过【饰非】' }
        const turnGeneral = state.generals[state.activeGeneralIndex]
        if (!turnGeneral) return { error: '没有当前回合角色' }
        shifeiCtx.shifeiTried = true
        const sfDrawn = drawForGeneral(state, turnGeneral, 1)
        turnGeneral.hand.push(...sfDrawn)
        addLog(state, `【${getGeneralName(targetGeneral)}】发动【饰非】，【${getGeneralName(turnGeneral)}】摸${sfDrawn.length}张牌`)
        const othersMax = Math.max(0, ...state.generals
            .filter(g => g.alive && g !== turnGeneral)
            .map(g => g.hand.length))
        if (turnGeneral.hand.length <= othersMax) {
            const wealthiest = state.generals
                .filter(g => g.alive && g.hand.length > 0)
                .sort((a, b) => b.hand.length - a.hand.length)[0]
            if (wealthiest) discardRandomHandCardOf(state, targetGeneral, wealthiest)
            ctx.dodgesReceived = (ctx.dodgesReceived || 0) + 1
            addLog(state, `【${getGeneralName(targetGeneral)}】因【饰非】视为使用【闪】`)
            if (ctx.dodgesReceived >= ctx.requiredDodges) {
                addLog(state, `【${getGeneralName(targetGeneral)}】成功防御【杀】`)
                handleDodgeSucceeded(state, targetGeneral, ctx)
            }
        }
        return
    }

    // ── 八卦阵判定 ──
    if (action === 'eight_trigrams') {
        if (!hasBaguaArmor(targetGeneral)) return { error: '未装备八卦阵' }
        // 青釭剑无视防具
        if (attacker?.equip.weapon?.name === EquipmentCardName.QINGGANG_SWORD) return { error: '青釭剑无视防具，无法使用八卦阵' }
        if ((ctx as any).eightTrigramsUsed) return { error: '本次响应已使用过【八卦阵】' }
        if (state.deck.length === 0) return { error: '牌堆为空' }
        ;(ctx as any).eightTrigramsUsed = true
        performSkillJudge(state, targetGeneral, 'eight_trigrams', '八卦阵', {})
        return
    }

    if (data.cardId) {
        const cardIdx = targetGeneral.hand.findIndex((c) => c.id === data.cardId)
        if (cardIdx === -1) return { error: '手牌中没有此牌' }
        const card = targetGeneral.hand[cardIdx]

        if (!isCardUsableAsDodge(targetGeneral, card)) return { error: '此牌不能当【闪】使用' }
        if (blockedByQianxi(targetGeneral, card)) return { error: '【潜袭】：不能打出该颜色的手牌' }

        targetGeneral.hand.splice(cardIdx, 1)
        state.discard.push(card)
        ctx.dodgeCards = [...(ctx.dodgeCards ?? []), card]
        checkMingzhe(state, targetGeneral, card)
        ctx.dodgesReceived = (ctx.dodgesReceived || 0) + 1
        if (card.name !== BasicCardName.DODGE && hasSkill(targetGeneral, 'shenzhaoyun_longhun')) {
            addLog(state, `【${getGeneralName(targetGeneral)}】发动【龙魂】，将${cardFullName(card)}当【闪】打出（${ctx.dodgesReceived}/${ctx.requiredDodges}）`)
        } else {
            addLog(state, `【${getGeneralName(targetGeneral)}】出了【闪】（${ctx.dodgesReceived}/${ctx.requiredDodges}）`)
        }

        if (ctx.dodgesReceived >= ctx.requiredDodges) {
            addLog(state, `【${getGeneralName(targetGeneral)}】成功防御【杀】`)
            handleDodgeSucceeded(state, targetGeneral, ctx)
        }
        // 雷击（张角）：使用【闪】选择目标后
        maybeTriggerLeiji(state, targetGeneral)
    } else {
        // 放弃出闪
        addLog(state, `【${getGeneralName(targetGeneral)}】没有出【闪】`)
        handleDodgeFailed(state, targetGeneral, ctx)
    }
}

/** 杀被闪成功后的武器效果 */
function handleDodgeSucceeded(
    state: GameState,
    targetGeneral: GeneralInstance,
    ctx: { attackerGeneralIndex: number; attackCard?: Card }
): void {
    // 先移除 DODGE pending（必须在 unshift 武器效果之前，否则 shift 会移错对象）
    state.pendingResponseQueue.shift()
    handleDodgeSucceededAfterRemoval(state, targetGeneral, ctx)
}

/** 杀被闪成功后的武器效果（DODGE pending 已被移除） */
function handleDodgeSucceededAfterRemoval(
    state: GameState,
    targetGeneral: GeneralInstance,
    ctx: { attackerGeneralIndex: number; attackCard?: Card; dodgeCards?: Card[]; moukuiPenalty?: boolean }
): void {
    const attacker = state.generals[ctx.attackerGeneralIndex]

    // 谋溃（伏完）：依次执行两项时，此【杀】被抵消则目标弃置伏完的一张牌
    if (ctx.moukuiPenalty && attacker?.alive) {
        const mkHandIdx = attacker.hand.length > 0 ? randomInt(attacker.hand.length) : -1
        if (mkHandIdx >= 0) {
            const mkCard = attacker.hand[mkHandIdx]
            const mkRemoved = removeCardFromHandOrEquip(state, attacker, mkCard.id)
            if (!('error' in mkRemoved)) {
                addLog(state, `【${getGeneralName(targetGeneral)}】因【谋溃】弃置【${getGeneralName(attacker)}】的一张牌`)
            }
        } else {
            const mkSlot = Object.values(EquipSlot).find(s => attacker.equip[s])
            if (mkSlot) {
                const mkLost = clearEquipSlot(state, attacker, mkSlot)
                if (mkLost) state.discard.push(mkLost)
                triggerXiaoji(state, attacker)
                checkTuntian(state, attacker)
                addLog(state, `【${getGeneralName(targetGeneral)}】因【谋溃】弃置【${getGeneralName(attacker)}】的一张装备牌`)
            }
        }
    }

    // 咆哮②（界张飞）：【杀】被【闪】抵消后，本回合下一次【杀】造成伤害时此伤害+1
    if (attacker?.alive && hasSkill(attacker, 'zhangfei_paoxiao') && hasSkill(attacker, 'zhangfei_tishen')) {
        attacker.paoxiaoBonus = true
        addLog(state, `【${getGeneralName(attacker)}】【咆哮】：本回合下一次【杀】造成伤害时，此伤害+1`)
    }

    // 忠勇（周仓）：杀结算结束后，可将此【杀】或目标使用的【闪】交给另一名角色
    maybeZhongyong(state, ctx.attackerGeneralIndex, state.generals.indexOf(targetGeneral), ctx)

    // 猛进（庞德）：可弃目标一牌（可选）
    if (attacker && hasSkill(attacker, 'pangde_mengjin')) {
        const totalCards = targetGeneral.hand.length + Object.values(targetGeneral.equip).filter(Boolean).length
        if (totalCards > 0) {
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(attacker),
                context: {
                    skillId: 'pangde_mengjin',
                    skillName: '猛进',
                    description: `弃【${getGeneralName(targetGeneral)}】的一张牌`,
                    mengjinTargetIndex: state.generals.indexOf(targetGeneral),
                },
            })
        }
    }

    // 贯石斧：弃2张牌使杀仍然命中
    if (attacker?.equip.weapon?.name === EquipmentCardName.STONE_AXE) {
        const totalCards = attacker.hand.length +
            Object.values(attacker.equip).filter(e => e != null && e !== attacker.equip.weapon).length
        if (totalCards >= 2) {
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(attacker),
                context: {
                    skillId: 'equip_stone_axe',
                    skillName: '贯石斧',
                    description: `弃2张牌（手牌），使【杀】仍然对【${getGeneralName(targetGeneral)}】造成伤害`,
                    targetIndex: state.generals.indexOf(targetGeneral),
                    attackCard: ctx.attackCard,
                },
            })
            return
        }
    }

    // 青龙偃月刀：杀被闪时可继续出杀
    if (attacker?.equip.weapon?.name === EquipmentCardName.GREEN_DRAGON) {
        state.pendingResponseQueue.unshift({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: state.generals.indexOf(attacker),
            context: {
                skillId: 'equip_green_dragon',
                skillName: '青龙偃月刀',
                description: `杀被闪抵消，是否对【${getGeneralName(targetGeneral)}】再出一张杀？（请先选择杀牌）`,
                targetIndex: state.generals.indexOf(targetGeneral),
            },
        })
    }
}

/** 杀命中（未出闪）后的处理 */
function handleDodgeFailed(
    state: GameState,
    targetGeneral: GeneralInstance,
    ctx: { attackerGeneralIndex: number; attackCard?: Card }
): void {
    const attacker = ctx.attackerGeneralIndex >= 0 ? state.generals[ctx.attackerGeneralIndex] : null

    // 寒冰剑：弃目标2牌不造伤
    if (attacker?.equip.weapon?.name === EquipmentCardName.ICE_SWORD) {
        const targetTotalCards = targetGeneral.hand.length +
            Object.values(targetGeneral.equip).filter(e => e != null).length
        if (targetTotalCards > 0) {
            state.pendingResponseQueue.shift()
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: state.generals.indexOf(attacker),
                context: {
                    skillId: 'equip_ice_sword',
                    skillName: '寒冰剑',
                    description: `弃【${getGeneralName(targetGeneral)}】2张牌，不造成伤害`,
                    targetIndex: state.generals.indexOf(targetGeneral),
                    killDamage: 1,
                    attackCard: ctx.attackCard,
                },
            })
            return
        }
    }

    // 麒麟弓：弃目标坐骑
    if (attacker?.equip.weapon?.name === EquipmentCardName.KYLIN_BOW) {
        const hasPlus = !!targetGeneral.equip.plus_horse
        const hasMinus = !!targetGeneral.equip.minus_horse
        if (hasPlus || hasMinus) {
            state.pendingResponseQueue.shift()
            const killDamage = calcKillDamage(state, attacker, targetGeneral)
            if (hasPlus && hasMinus) {
                // 两匹马，需要选择
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                    targetGeneralIndex: state.generals.indexOf(attacker),
                    context: {
                        skillId: 'equip_kylin_bow',
                        skillName: '麒麟弓',
                        description: `是否弃【${getGeneralName(targetGeneral)}】一匹坐骑？`,
                        targetIndex: state.generals.indexOf(targetGeneral),
                        killDamage,
                        attackCard: ctx.attackCard,
                    },
                })
            } else {
                // 只有一匹马，询问是否发动
                state.pendingResponseQueue.unshift({
                    type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                    targetGeneralIndex: state.generals.indexOf(attacker),
                    context: {
                        skillId: 'equip_kylin_bow_auto',
                        skillName: '麒麟弓',
                        description: `是否弃【${getGeneralName(targetGeneral)}】的坐骑？`,
                        targetIndex: state.generals.indexOf(targetGeneral),
                        killDamage,
                        attackCard: ctx.attackCard,
                        horseType: hasPlus ? 'plus' : 'minus',
                    },
                })
            }
            return
        }
    }

    // 计算伤害（含忠义加成）
    const killDamage = calcKillDamage(state, attacker, targetGeneral)
    const mingceJieOwnerIdx = (ctx as any).mingceJieOwnerIndex as number | undefined
    const mingceHpBefore = targetGeneral.hp
    // 先移除 DODGE 响应，再造成伤害（dealDamage 可能 unshift 被动技能到队列头部）
    state.pendingResponseQueue.shift()
    // 忠勇：先入队，随后 dealDamage 的濒死/伤害技能会排在它前面
    maybeZhongyong(state, ctx.attackerGeneralIndex, state.generals.indexOf(targetGeneral), ctx)
    dealDamage(state, attacker, targetGeneral, killDamage, ctx.attackCard?.id, slashDamageOpts(attacker, ctx.attackCard))
    // 明策②（界陈宫）：此【杀】造成伤害后，陈宫与使用者各摸一张
    if (mingceJieOwnerIdx !== undefined && mingceJieOwnerIdx >= 0 && targetGeneral.hp < mingceHpBefore) {
        state.pendingResponseQueue.push({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: mingceJieOwnerIdx,
            context: {
                skillId: 'chengong_mingce_draw',
                autoExecute: true,
                mingceDrawOtherIndex: state.generals.indexOf(targetGeneral),
            },
        })
    }
}

/** 忠勇（周仓）：杀结算结束后，询问是否将此【杀】或目标使用的【闪】交给另一名角色 */
function maybeZhongyong(
    state: GameState,
    attackerIdx: number,
    targetIdx: number,
    ctx: { attackCard?: Card; dodgeCards?: Card[] }
): void {
    const attacker = state.generals[attackerIdx]
    if (!attacker?.alive || !hasSkill(attacker, 'zhoucang_zhongyong')) return
    if (attackerIdx === targetIdx) return
    if (!state.generals.some(g => g.alive && g !== attacker)) return

    const inDiscard = (c: Card) => state.discard.some(d => d.id === c.id)
    const attackCard = ctx.attackCard && inDiscard(ctx.attackCard) ? ctx.attackCard : undefined
    const dodgeCards = (ctx.dodgeCards ?? []).filter(inDiscard)
    if (!attackCard && dodgeCards.length === 0) return

    state.pendingResponseQueue.unshift({
        type: ResponseType.SKILL_ZHONGYONG_GIVE,
        targetGeneralIndex: attackerIdx,
        context: {
            skillId: 'zhoucang_zhongyong',
            skillName: '忠勇',
            attackCardId: attackCard?.id,
            attackCardLabel: attackCard ? cardFullName(attackCard) : undefined,
            dodgeCardIds: dodgeCards.map(c => c.id),
            dodgeCardLabel: dodgeCards.length > 0 ? cardFullName(dodgeCards[0]) : undefined,
            zhongyongTargetIndex: targetIdx,
        },
    })
}

/** 忠勇：受牌者用一张【杀】指定攻击范围内的角色 */
function pushZhongyongSlash(state: GameState, recipientIdx: number, fromIdx: number, givenCard: Card): void {
    const recipient = state.generals[recipientIdx]
    if (!recipient?.alive) return
    const candidateIndices = state.generals
        .map((g, i) => ({ g, i }))
        .filter(({ g, i }) => g.alive && i !== recipientIdx && getAttackRange(recipient, g, state.generals).inRange)
        .map(({ i }) => i)
    if (candidateIndices.length === 0) return
    state.pendingResponseQueue.unshift({
        type: ResponseType.SKILL_ZHONGYONG_SLASH,
        targetGeneralIndex: recipientIdx,
        context: {
            zhongyongFromIndex: fromIdx,
            zhongyongCardId: givenCard.id,
            candidateIndices,
        },
    })
}

/** 酒的加成绑定到本回合使用的下一张【杀】，用掉即清除，避免延续到后续的【杀】 */
function consumeWineBonus(state: GameState, general: GeneralInstance): void {
    if (!general.wineDrunk) return
    general.wineDrunk = false
    general.wineBonusAttackNo = state.attackUsedThisTurn
}

/** 计算杀伤害（含忠义/酒/古锭刀加成） */function calcKillDamage(state: GameState, attacker: GeneralInstance | null, target?: GeneralInstance | null): number {
    let dmg = 1
    if (attacker) {
        const allySameTeam = state.generals.filter(g => g.alive && g.faction === attacker.faction)
        if (allySameTeam.some(g => g.loyaltyCard)) {
            dmg += 1
            addLog(state, `【忠义】加成！杀伤害+1`)
        }
        // 同一张【杀】的多个目标各自加成，但换成下一张【杀】时酒已耗尽
        if (attacker.wineDrunk
            || (attacker.wineBonusAttackNo !== undefined && attacker.wineBonusAttackNo === state.attackUsedThisTurn)) {
            dmg += 1
            addLog(state, `【酒】加成！杀伤害+1`)
        }
        // 龙魂（神赵云）：两张红色牌转化的【杀】伤害+1
        if (attacker.longhunBonus) {
            dmg += 1
            attacker.longhunBonus = false
            addLog(state, '【龙魂】加成！杀伤害+1')
        }
        if (target && attacker.equip.weapon?.name === EquipmentCardName.GUDING_BLADE && target.hand.length === 0) {
            dmg += 1
            addLog(state, `【古锭刀】加成！目标无手牌，杀伤害+1`)
        }
        if (attacker.luoyiActive) {
            dmg += 1
            addLog(state, `【裸衣】加成！杀伤害+1`)
        }
        // 咆哮②（界张飞）：【杀】被【闪】抵消后，本回合下一次【杀】造成伤害时此伤害+1（结算一次）
        if (attacker.paoxiaoBonus) {
            dmg += 1
            attacker.paoxiaoBonus = false
            addLog(state, `【咆哮】加成！杀伤害+1`)
        }
        // 烈弓②（界黄忠）：此【杀】对指定目标造成的伤害+1（结算一次）
        if (target && attacker.liegongBonusTarget !== undefined
            && state.generals.indexOf(target) === attacker.liegongBonusTarget) {
            dmg += 1
            attacker.liegongBonusTarget = undefined
            addLog(state, `【烈弓】加成！杀伤害+1`)
        }
    }
    return dmg
}

/** 杀的属性：火杀/雷杀取牌面，朱雀羽扇将普通杀视为火杀 */
function getAttackNature(attacker: GeneralInstance | null, attackCard?: Card): 'normal' | 'fire' | 'thunder' {
    const nature = attackCard?.nature ?? 'normal'
    return nature as 'normal' | 'fire' | 'thunder'
}

function handleDuelResponse(
    state: GameState,
    targetGeneral: GeneralInstance,
    pending: PendingResponse,
    data: C2S_Respond
): { error: string } | void {
    const ctx = pending.context as {
        initiatorGeneralIndex: number
        requiredAttacks: number
        attacksReceived: number
        duelCardId?: string
        duelTargetIndex?: number
        zhanjueUserIndex?: number
    }
    const initiator = state.generals[ctx.initiatorGeneralIndex]
    const targetIdx = pending.targetGeneralIndex
    // 决斗双方：发起者 vs 目标。当前轮到谁出杀，对方就是另一个
    const duelTargetIdx = ctx.duelTargetIndex ?? targetIdx // 决斗被指定的那个人
    const opponentIdx = targetIdx === ctx.initiatorGeneralIndex
        ? duelTargetIdx
        : ctx.initiatorGeneralIndex

    if (data.cardId) {
        const cardIdx = targetGeneral.hand.findIndex((c) => c.id === data.cardId)
        if (cardIdx === -1) return { error: '手牌中没有这张牌' }
        const card = targetGeneral.hand[cardIdx]
        if (!isCardUsableAsAttack(targetGeneral, card)) return { error: '决斗中需要出【杀】' }
        if (blockedByQianxi(targetGeneral, card)) return { error: '【潜袭】：不能打出该颜色的手牌' }

        targetGeneral.hand.splice(cardIdx, 1)
        state.discard.push(card)
        ctx.attacksReceived = (ctx.attacksReceived || 0) + 1
        addLog(state, `【${getGeneralName(targetGeneral)}】在决斗中出了【杀】（${ctx.attacksReceived}/${ctx.requiredAttacks}）`)

        if (ctx.attacksReceived >= ctx.requiredAttacks) {
            // 完成本轮出杀，切换到对方
            // 计算对方需要出几张杀（吕布无双：若刚出完杀的人有无双，对方需出2杀）
            const opponent = state.generals[opponentIdx]
            const nextRequired = hasSkill(targetGeneral, 'lvbu_wushuang') ? 2 : 1

            // 先移除当前，再推入新的
            state.pendingResponseQueue.shift()
            state.pendingResponseQueue.unshift({
                type: ResponseType.ATTACK_DUEL,
                targetGeneralIndex: opponentIdx,
                context: {
                    initiatorGeneralIndex: ctx.initiatorGeneralIndex,
                    duelTargetIndex: duelTargetIdx,
                    requiredAttacks: nextRequired,
                    attacksReceived: 0,
                    duelCardId: ctx.duelCardId,
                    zhanjueUserIndex: ctx.zhanjueUserIndex,
                },
            })
        }
    } else {
        // 放弃出杀 → 受到伤害，来源是对方
        const opponent = state.generals[opponentIdx]
        addLog(state, `【${getGeneralName(targetGeneral)}】决斗中放弃，受到伤害`)
        state.pendingResponseQueue.shift()
        const duelDamage = opponent && opponent.luoyiActive ? 2 : 1
        dealDamage(state, opponent || null, targetGeneral, duelDamage, ctx.duelCardId)

        // 战绝（刘谌）：决斗结算后，使用者与受伤角色各摸一张
        if (ctx.zhanjueUserIndex !== undefined) {
            const zjUser = state.generals[ctx.zhanjueUserIndex]
            if (zjUser) {
                const drawers = new Set([zjUser, targetGeneral])
                for (const g of drawers) {
                    if (!g.alive) continue
                    const drawn = drawCards(state, 1)
                    g.hand.push(...drawn)
                    addLog(state, `【${getGeneralName(g)}】因【战绝】摸一张牌`)
                }
                zjUser.zhanjueDrawnThisPhase = (zjUser.zhanjueDrawnThisPhase ?? 0) + 1
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────
// 方向选择工具
// ─────────────────────────────────────────────────────────────

/** 找出距离某角色最近的所有其他存活角色的 index 列表（用于乱武） */
function findNearestTargets(state: GameState, general: GeneralInstance): number[] {
    const others = state.generals.filter(g => g.alive && g !== general)
    if (others.length === 0) return []
    let minDist = Infinity
    for (const o of others) {
        const d = getAttackRange(general, o, state.generals).distance
        if (d < minDist) minDist = d
    }
    return others
        .filter(o => getAttackRange(general, o, state.generals).distance === minDist)
        .map(o => state.generals.indexOf(o))
}

/** 根据方向获取除发动者外的角色列表 */
function getDirectionalTargets(
    state: GameState,
    caster: GeneralInstance,
    direction: string
): GeneralInstance[] {
    const alive = state.generals.filter(g => g.alive)
    const casterIdx = alive.indexOf(caster)
    if (casterIdx === -1) return alive.filter(g => g !== caster)

    const result: GeneralInstance[] = []
    const n = alive.length
    const ccw = direction === 'counterclockwise'
    // 统率三军的座次数组按顺时针排列；欢乐成双的座次数组按逆时针排列，
    // 因此“逆时针”在该模式下取数组递增方向。
    const step = (ccw ? -1 : 1) * (state.mode === GameMode.HUANLE_SHUANG ? -1 : 1)
    for (let i = 1; i < n; i++) {
        result.push(alive[((casterIdx + step * i) % n + n) % n])
    }

    return result
}

// ─────────────────────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────────────────────

/** 潜袭（马岱）：该角色本回合不能使用/打出指定颜色的手牌 */
function blockedByQianxi(general: GeneralInstance, card: Card): boolean {
    if (!general.qianxiColor) return false
    const isRed = card.suit === CardSuit.HEART || card.suit === CardSuit.DIAMOND
    return (general.qianxiColor === 'red') === isRed
}

/** 记录本回合使用过的基本牌（活墨：本回合用过的基本牌不能再被转化） */
// ══════════════════════════════════════════════════════════════
// 洛书版扩展（二）：通用工具
// ══════════════════════════════════════════════════════════════

function indexOfGeneral(state: GameState, general: GeneralInstance): number {
    return state.generals.indexOf(general)
}

/** 荐降（蒯良蒯越）：成为其他角色使用牌的目标后，令手牌数最少的一名角色摸一张牌 */
function triggerJianjiang(state: GameState, target: GeneralInstance, source?: GeneralInstance): void {
    if (!target || !target.alive || target === source) return
    if (!hasSkill(target, 'kuailiang_jiandjiang')) return
    // 追加到队尾：目标结算完响应后再询问，避免与出闪等响应抢占
    askSkill(state, target, 'kuailiang_jiandjiang', '荐降', '令全场手牌数最少的一名角色摸一张牌', {}, false)
}

/** 良姻（周妃）：有牌移出游戏 / 游戏外的牌进入手牌区 */
function triggerLiangyin(state: GameState, kind: 'out' | 'in'): void {
    for (const g of state.generals) {
        if (!g.alive || !hasSkill(g, 'zhoufei_liangyin')) continue
        const key = kind === 'out' ? 'zhoufei_liangyin_out' : 'zhoufei_liangyin_in'
        if (g.skillsUsedThisTurn.includes(key)) continue
        // 同一动作里可能既被技能直接调用又被牌区差集命中，已在队列中就不再重复询问
        if (state.pendingResponseQueue.some(p => (p.context as any)?.skillId === key
            && p.targetGeneralIndex === state.generals.indexOf(g))) continue
        if (kind === 'out') {
            const helper = state.generals
                .filter(o => o !== g && o.alive && o.hand.length > g.hand.length)
                .sort((a, b) => b.hand.length - a.hand.length)[0]
            if (!helper) continue
            askSkill(state, g, key, '良姻', `令【${getGeneralName(helper)}】摸一张牌`, { liangyinHelperIndex: state.generals.indexOf(helper) })
        } else {
            const victim = state.generals
                .filter(o => o !== g && o.alive && o.hand.length < g.hand.length)
                .sort((a, b) => a.hand.length - b.hand.length)[0]
            if (!victim) continue
            askSkill(state, g, key, '良姻', `令【${getGeneralName(victim)}】弃置一张牌`, { liangyinVictimIndex: state.generals.indexOf(victim) })
        }
    }
}

/** 清俭（界夏侯惇）：摸牌阶段外获得牌后，可将一张牌交给其他角色，当前回合角色手牌上限+1 */
function triggerQingjian(state: GameState, general: GeneralInstance): void {
    if (!general.alive || !hasSkill(general, 'xiahoudun_qingjian')) return
    if (state.generals[state.activeGeneralIndex] !== general) return
    if (state.turnPhase === TurnPhase.DRAW) return
    if (general.skillsUsedThisTurn.includes('xiahoudun_qingjian')) return
    if (general.hand.length === 0) return
    const friend = state.generals
        .filter(o => o !== general && o.alive && o.faction === general.faction)
        .sort((a, b) => a.hand.length - b.hand.length)[0]
    if (!friend) return
    const gift = [...general.hand].sort((a, b) => (a.value ?? 0) - (b.value ?? 0))[0]
    askSkill(state, general, 'xiahoudun_qingjian', '清俭',
        `将${cardFullName(gift)}交给【${getGeneralName(friend)}】，当前回合角色本回合手牌上限+1`,
        { qingjianCardId: gift.id, qingjianTargetIndex: state.generals.indexOf(friend) })
}

/** 询问是否发动一个可选技能（immediate=true 时插到队首） */
function askSkill(
    state: GameState,
    general: GeneralInstance,
    skillId: string,
    skillName: string,
    description: string,
    extra: Record<string, unknown> = {},
    immediate = true,
): void {
    const pending: PendingResponse = {
        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
        targetGeneralIndex: indexOfGeneral(state, general),
        context: { skillId, skillName, description, ...extra },
    }
    if (immediate) state.pendingResponseQueue.unshift(pending)
    else state.pendingResponseQueue.push(pending)
}

/** 询问选择一个目标 */
function askChooseTarget(
    state: GameState,
    general: GeneralInstance,
    skillId: string,
    skillName: string,
    description: string,
    candidateIndices: number[],
    extra: Record<string, unknown> = {},
): void {
    state.pendingResponseQueue.push({
        type: ResponseType.SKILL_CHOOSE_TARGET,
        targetGeneralIndex: indexOfGeneral(state, general),
        context: { skillId, skillName, description, candidateIndices, ...extra },
    })
}

/** 询问选择自己的牌 */
function askPickCard(
    state: GameState,
    general: GeneralInstance,
    skillId: string,
    skillName: string,
    description: string,
    opts: { count?: number; mode?: string; candidateCardIds?: string[]; extra?: Record<string, unknown> } = {},
): void {
    state.pendingResponseQueue.push({
        type: ResponseType.SKILL_PICK_CARD,
        targetGeneralIndex: indexOfGeneral(state, general),
        context: {
            skillId, skillName, description,
            count: opts.count ?? 1,
            mode: opts.mode ?? 'discard',
            candidateCardIds: opts.candidateCardIds,
            ...(opts.extra ?? {}),
        },
    })
}

/** 询问把若干手牌交给某人 */
function askGiveCards(
    state: GameState,
    general: GeneralInstance,
    toIndex: number,
    skillId: string,
    skillName: string,
    description: string,
    count: number,
): void {
    state.pendingResponseQueue.push({
        type: ResponseType.SKILL_GIVE_CARDS,
        targetGeneralIndex: indexOfGeneral(state, general),
        context: { skillId, skillName, description, toIndex, count },
    })
}

/** 翻面：切换正/背面并触发设变、解围、法恩 */
function flipGeneral(state: GameState, general: GeneralInstance, reason: string): void {
    if (!general.alive) return
    general.flipped = !general.flipped
    const nm = getGeneralName(general)
    addLog(state, `【${nm}】${general.flipped ? '翻面（背面朝上）' : '翻回正面'}${reason ? `（${reason}）` : ''}`)
    if (general.flipped) {
        if (hasSkill(general, 'xiahouyuan_shebian')) {
            askSkill(state, general, 'xiahouyuan_shebian', '设变', '移动场上一张装备牌')
        }
        return
    }
    // 法恩（陈群）：任意角色翻至正面
    for (const g of state.generals) {
        if (!g.alive || g === general) continue
        if (hasSkill(g, 'chenqun_faen')) {
            askSkill(state, g, 'chenqun_faen', '法恩', `令【${nm}】摸一张牌`, { faenTargetIndex: indexOfGeneral(state, general) })
        }
    }
    // 解围②（曹仁）：从背面翻至正面
    if (hasSkill(general, 'caoren_jiewei')) {
        askSkill(state, general, 'caoren_jiewei_front', '解围', '弃置一张牌，然后移动场上的一张牌')
    }
}

/** 横置（触发法恩） */
function chainGeneral(state: GameState, general: GeneralInstance, reason: string): void {
    if (!general.alive || general.chained) return
    general.chained = true
    addLog(state, `【${getGeneralName(general)}】横置（${reason}）`)
    for (const g of state.generals) {
        if (!g.alive || g === general) continue
        if (hasSkill(g, 'chenqun_faen')) {
            askSkill(state, g, 'chenqun_faen', '法恩', `令【${getGeneralName(general)}】摸一张牌`, { faenTargetIndex: indexOfGeneral(state, general) })
        }
    }
}

/** 移动场上一张装备牌：先选来源，再选目标角色 */
function startMoveEquip(state: GameState, owner: GeneralInstance, skillId: string, skillName: string): boolean {
    const candidates = state.generals
        .map((g, i) => ({ g, i }))
        .filter(({ g }) => g.alive && Object.values(g.equip).some(Boolean))
        .map(({ i }) => i)
    if (candidates.length === 0) {
        addLog(state, `【${getGeneralName(owner)}】的【${skillName}】没有可移动的装备牌`)
        return false
    }
    askChooseTarget(state, owner, 'move_equip_source', skillName, '选择要移动谁的装备牌', candidates, { moveOwnerIndex: indexOfGeneral(state, owner) })
    return true
}

/** 开始拼点：双方各选一张手牌（拼点牌结算后进入弃牌堆） */
function pindianStart(
    state: GameState,
    initiator: GeneralInstance,
    opponent: GeneralInstance,
    skillId: string,
    skillName: string,
    extra: Record<string, unknown> = {},
): boolean {
    if (initiator.hand.length === 0 || opponent.hand.length === 0 || initiator === opponent) return false
    state.pindian = {
        initiatorIndex: indexOfGeneral(state, initiator),
        opponentIndex: indexOfGeneral(state, opponent),
        skillId, skillName, stage: 'initiator', extra,
    }
    // 天辩①（秦宓）：可以改为用牌堆顶的一张牌拼点
    if (hasSkill(initiator, 'qinmi_tianbian') && state.deck.length > 0) {
        const tbCard = state.deck.shift()!
        state.pindian.stage = 'opponent'
        state.pindian.firstCard = tbCard
        addLog(state, `【${getGeneralName(initiator)}】发动【天辩】，以牌堆顶的${cardFullName(tbCard)}拼点`)
        state.pendingResponseQueue.unshift({
            type: ResponseType.SKILL_PICK_CARD,
            targetGeneralIndex: indexOfGeneral(state, opponent),
            context: {
                skillId: 'pindian', skillName, count: 1, mode: 'pindian',
                description: `与【${getGeneralName(initiator)}】拼点：选择一张手牌`,
                pindianStage: 'opponent',
            },
        })
        return true
    }
    // 酣战①（界太史慈）：拼点开始时，可令对方改为用随机的一张手牌拼点
    if (hasSkill(initiator, 'taishici_hanzhan') && !(extra as any).hanzhanAsked) {
        askSkill(state, initiator, 'taishici_hanzhan', '酣战',
            `令【${getGeneralName(opponent)}】改为用随机的一张手牌拼点`,
            { hanzhanStart: true })
        return true
    }
    askPickCard(state, initiator, 'pindian', skillName,
        `与【${getGeneralName(opponent)}】拼点：选择一张手牌`,
        { count: 1, mode: 'pindian', extra: { pindianStage: 'initiator' } })
    return true
}

/** 拼点发起方的选牌提示（酣战确认后继续） */
function pushPindianInitiatorPick(state: GameState, initiator: GeneralInstance, opponent: GeneralInstance, skillName: string): void {
    askPickCard(state, initiator, 'pindian', skillName,
        `与【${getGeneralName(opponent)}】拼点：选择一张手牌`,
        { count: 1, mode: 'pindian', extra: { pindianStage: 'initiator' } })
}

/** 拼点结算：比较点数并执行各技能后续 */
function resolvePindian(state: GameState, initiatorCard: Card, opponentCard?: Card): void {
    const pin = state.pindian
    if (!pin) return
    state.pindian = undefined
    const initiator = state.generals[pin.initiatorIndex]
    const opponent = state.generals[pin.opponentIndex]
    if (opponentCard) state.discard.push(opponentCard)
    state.discard.push(initiatorCard)
    if (!initiator || !opponent) return
    // 天辩（秦宓）：拼点牌花色为♥时，点数视为K
    const iVal = tianbianValue(initiator, initiatorCard)
    const oVal = opponentCard ? tianbianValue(opponent, opponentCard) : 0
    const won = iVal > oVal
    addLog(state, `【${getGeneralName(initiator)}】与【${getGeneralName(opponent)}】拼点：${valueName(iVal)} vs ${opponentCard ? valueName(oVal) : '无牌'}，${won ? '赢' : '没赢'}`)

    switch (pin.skillId) {
        // 专对（秦宓）：拼点赢则此【杀】对其无效 / 其不能使用【闪】响应
        case 'qinmi_zhuandui_def':
        case 'qinmi_zhuandui_atk': {
            if (!won) break
            const qzPinCtx = pin.extra as any
            const qzPinTargetIdx = qzPinCtx?.targetIndex as number | undefined
            const qzPinAttackId = qzPinCtx?.attackCardId as string | undefined
            if (qzPinAttackId && qzPinTargetIdx !== undefined) {
                dropSlashDodgePrompts(state, qzPinAttackId, qzPinTargetIdx)
            }
            if (pin.skillId === 'qinmi_zhuandui_def') {
                addLog(state, `【${getGeneralName(initiator)}】发动【专对】获胜，此【杀】对其无效`)
            } else {
                addLog(state, `【${getGeneralName(initiator)}】发动【专对】获胜，【${getGeneralName(opponent)}】不能使用【闪】响应`)
                const qzKillDamage = calcKillDamage(state, initiator, opponent)
                dealDamage(state, initiator, opponent, qzKillDamage, qzPinAttackId,
                    slashDamageOpts(initiator, undefined))
            }
            break
        }
        case 'xunyu_quhu': {
            // 引用的 skillId 实际由上下文传入（见 handleUseSkill）
            break
        }
        case 'xunyu_quhu_skill': {
            if (won) {
                const candidates = state.generals
                    .map((g, i) => ({ g, i }))
                    .filter(({ g }) => g.alive && g !== opponent && getAttackRange(opponent, g, state.generals).inRange)
                    .map(({ i }) => i)
                if (candidates.length > 0) {
                    askChooseTarget(state, initiator, 'xunyu_quhu_damage', '驱虎',
                        `令【${getGeneralName(opponent)}】对一名角色造成1点伤害`, candidates)
                } else {
                    addLog(state, `【${getGeneralName(opponent)}】攻击范围内没有可选角色，【驱虎】未造成伤害`)
                }
            } else {
                addLog(state, `【${getGeneralName(opponent)}】【驱虎】对【${getGeneralName(initiator)}】造成1点伤害`)
                dealDamage(state, opponent, initiator, 1)
            }
            break
        }
        case 'taishici_tianyi': {
            if (won) {
                initiator.extraSlashCount = (initiator.extraSlashCount ?? 0) + 1
                initiator.extraSlashTargets = (initiator.extraSlashTargets ?? 0) + 1
                initiator.slashNoRangeTurn = true
                addLog(state, `【${getGeneralName(initiator)}】【天义】拼点赢：本回合【杀】次数+1、无距离限制、目标数+1`)
            } else {
                initiator.cannotSlashTurn = true
                addLog(state, `【${getGeneralName(initiator)}】【天义】拼点没赢：本回合不能使用【杀】`)
            }
            break
        }
        case 'gaoshun_xianzhen': {
            const opIdx = pin.opponentIndex
            if (won) {
                initiator.ignoreArmorTargetIndex = opIdx
                initiator.unlimitedTargetIndex = opIdx
                initiator.extraTargetIndex = opIdx
                addLog(state, `【${getGeneralName(initiator)}】【陷阵】拼点赢：无视【${getGeneralName(opponent)}】防具，对其用牌无距离与次数限制`)
            } else {
                initiator.xianzhenLoseIndex = opIdx
                addLog(state, `【${getGeneralName(initiator)}】【陷阵】拼点没赢：本回合不能对【${getGeneralName(opponent)}】使用【杀】`)
            }
            break
        }
        case 'zhurong_lierend': {
            if (won) {
                const got = gainRandomCardFrom(state, initiator, opponent)
                if (got) addLog(state, `【${getGeneralName(initiator)}】【烈刃】获得【${getGeneralName(opponent)}】一张牌`)
            }
            break
        }
        // 惴恐（界伏皇后）：赢则对方本回合使用牌只能指定自己为目标；否则获得其拼点的牌并被其视为使用【杀】
        case 'fuhuanghou_chuikong': {
            if (won) {
                opponent.useOnlySelfTurn = state.turnSerial
                addLog(state, `【${getGeneralName(initiator)}】【惴恐】拼点赢：【${getGeneralName(opponent)}】本回合使用牌只能指定自己为目标`)
            } else {
                if (opponentCard) {
                    const dcIdx = state.discard.indexOf(opponentCard)
                    if (dcIdx >= 0) state.discard.splice(dcIdx, 1)
                    initiator.hand.push(opponentCard)
                    addLog(state, `【${getGeneralName(initiator)}】【惴恐】拼点没赢：获得【${getGeneralName(opponent)}】拼点的牌（${cardFullName(opponentCard)}）`)
                }
                useVirtualSlash(state, opponent, pin.initiatorIndex, { noRange: true, label: '（惴恐）' })
            }
            break
        }
        default:
            break
    }

    // 酣战②（界太史慈）：拼点结束后，可获得拼点牌中点数最大的【杀】
    for (const owner of [initiator, opponent]) {
        if (!owner.alive || !hasSkill(owner, 'taishici_hanzhan')) continue
        const slashCards = [initiatorCard, opponentCard]
            .filter((c): c is Card => !!c && isSlashLikeCard(c))
        if (slashCards.length === 0) continue
        const best = slashCards.reduce((a, b) => (b.value > a.value ? b : a))
        askSkill(state, owner, 'taishici_hanzhan_gain', '酣战',
            `获得拼点牌中点数最大的【杀】（${cardFullName(best)}）`,
            { hanzhanCardId: best.id })
    }
}

/** 将一名角色的手牌摸至指定张数（不超过上限 cap） */
function drawToHandSize(state: GameState, general: GeneralInstance, targetSize: number, cap = 99): number {
    const goal = Math.min(targetSize, cap)
    const need = Math.max(0, goal - general.hand.length)
    if (need === 0) return 0
    const drawn = drawForGeneral(state, general, need)
    general.hand.push(...drawn)
    return drawn.length
}

/** 倾袭（界曹休）：收尾——可选弃置武器，然后恢复伤害结算（伤害+1 或不加） */
function finishJieQingxi(
    state: GameState,
    attacker: GeneralInstance,
    target: GeneralInstance,
    bonus: boolean,
    amount: number,
    damageCardId: string | undefined,
    nature: 'normal' | 'fire' | 'thunder' | undefined,
    dropWeapon: boolean,
    resumeOpts: Record<string, unknown> | undefined,
): void {
    if (dropWeapon && attacker.equip[EquipSlot.WEAPON]) {
        const weapon = attacker.equip[EquipSlot.WEAPON]!
        clearEquipSlot(state, attacker, EquipSlot.WEAPON)
        state.discard.push(weapon)
        addLog(state, `【${getGeneralName(attacker)}】【倾袭】弃置武器${cardFullName(weapon)}`)
    }
    if (!target.alive) return
    dealDamage(state, attacker, target, amount + (bonus ? 1 : 0), damageCardId, {
        ...(resumeOpts as any ?? {}),
        nature,
        skipQingxi: true,
    })
}

/** 矫诏（界郭皇后·修改二）：视为使用一张基本牌或普通锦囊牌 */
function resolveJiaozhaoVirtual(state: GameState, owner: GeneralInstance, name: string): void {
    const selfIdx = indexOfGeneral(state, owner)
    const ownerName = getGeneralName(owner)
    if (name === 'peach') {
        owner.hp = Math.min(owner.hp + 1, owner.maxHp)
        addLog(state, `【${ownerName}】【矫诏】视为使用【桃】，回复至 ${owner.hp}/${owner.maxHp}`)
        triggerDianhuRecover(state, owner)
        return
    }
    if (name === 'wine') {
        owner.wineDrunk = true
        addLog(state, `【${ownerName}】【矫诏】视为使用【酒】，本回合下一张【杀】伤害+1`)
        return
    }
    if (name === 'draw_two') {
        const drawn = drawCards(state, 2)
        owner.hand.push(...drawn)
        addLog(state, `【${ownerName}】【矫诏】视为使用【无中生有】，摸了 ${drawn.length} 张牌`)
        triggerQingjian(state, owner)
        return
    }
    // 杀 / 过河拆桥 / 顺手牵羊 / 决斗：需要选择目标
    const candidates = state.generals
        .map((g, i) => ({ g, i }))
        .filter(({ g, i }) => {
            if (!g.alive || i === selfIdx) return false
            if (name === 'attack') return getAttackRange(owner, g, state.generals).inRange
            if (name === 'dismantle' || name === 'steal') {
                return g.hand.length > 0 || Object.values(g.equip).some(Boolean)
                    || (name === 'dismantle' && g.judgeZone.length > 0)
            }
            return true
        })
        .map(({ i }) => i)
    if (candidates.length === 0) {
        addLog(state, `【${ownerName}】【矫诏】没有合法目标，视为使用失败`)
        return
    }
    askChooseTarget(state, owner, 'guohuanghou_jiaozhao_virtual', '矫诏',
        '选择【矫诏】视为使用的牌的目标', candidates,
        { jiaozhaoVirtualName: name })
}

/** 视为使用一张【杀】 */
function useVirtualSlash(
    state: GameState,
    source: GeneralInstance,
    targetIndex: number,
    opts: { noRange?: boolean; unavoidable?: boolean; label?: string; nature?: 'normal' | 'fire' | 'thunder' } = {},
): { error: string } | void {
    const target = state.generals[targetIndex]
    const label = opts.label ?? ''
    if (!target || !target.alive) return { error: '目标无效' }
    if (target === source) return { error: '不能对自己使用【杀】' }
    if (!opts.noRange) {
        const ri = getAttackRange(source, target, state.generals)
        if (!ri.inRange) return { error: distanceTooFarText(getGeneralName(target), ri) }
    }
    const vc: Card = {
        id: `virtual_slash_${state.log.length}_${targetIndex}`,
        suit: CardSuit.SPADE,
        value: 1,
        category: CardCategory.BASIC,
        name: BasicCardName.ATTACK,
        nature: opts.nature ?? 'normal',
        virtual: true,
    }
    if (opts.unavoidable) (vc as any).unavoidable = true
    if (opts.noRange) (vc as any).noRange = true
    // 视为使用同样是“使用【杀】”，需受止息/屯储等限制
    const blocked = expansionCardUseBlocked(source, vc)
    if (blocked) {
        addLog(state, `【${getGeneralName(source)}】${label}${blocked}，无法对【${getGeneralName(target)}】使用【杀】`)
        return { error: blocked }
    }
    addLog(state, `【${getGeneralName(source)}】${label}视为对【${getGeneralName(target)}】使用一张【杀】`)
    return handleBasicCard(state, source, vc, -1, [target])
}

/** 洛书版扩展（二）：伤害结算后的技能触发 */
function triggerExpansionDamageHooks(
    state: GameState,
    attacker: GeneralInstance | null,
    target: GeneralInstance,
    amount: number,
    damageCardId: string | undefined,
    nature: 'normal' | 'fire' | 'thunder',
    fromSlash: boolean,
): void {
    if (amount <= 0) return
    const targetIdx = state.generals.indexOf(target)
    // 双雄②（界颜良文丑）：记录本回合对你造成伤害的牌
    if (target.alive && damageCardId && hasSkill(target, 'yanliang_shuangxiong')) {
        target.damagedCardIds = [...(target.damagedCardIds ?? []), damageCardId]
    }
    // 虎啸（关银屏）：对一名角色造成火焰伤害后，其摸一张牌，本回合你对其使用牌无次数限制
    if (attacker && attacker.alive && attacker !== target && hasSkill(attacker, 'guanyinping_huxiao')
        && nature === 'fire') {
        const drawn = drawForGeneral(state, target, 1)
        target.hand.push(...drawn)
        attacker.unlimitedTargetIndex = targetIdx
        addLog(state, `【${getGeneralName(attacker)}】发动【虎啸】，【${getGeneralName(target)}】摸一张牌`)
    }
    // 烈刃（界祝融）：使用【杀】造成伤害后，可与其拼点
    if (attacker && attacker.alive && attacker !== target && fromSlash && target.alive
        && hasSkill(attacker, 'zhurong_lierend')) {
        askSkill(state, attacker, 'zhurong_lierend', '烈刃',
            `与【${getGeneralName(target)}】拼点，赢则获得其一张牌`,
            { lierendTargetIndex: targetIdx })
    }
    // 节命（界荀彧）：受到1点伤害后，可令一名角色摸X张，然后其将手牌弃置至X张（X为体力上限，至多5）
    if (target.alive && hasSkill(target, 'xunyu_jieming')) {
        const candidates = state.generals
            .map((g, i) => ({ g, i }))
            .filter(({ g }) => g.alive)
            .map(({ i }) => i)
        if (candidates.length > 0) {
            askSkill(state, target, 'xunyu_jieming', '节命', '令一名角色摸X张，然后其将手牌弃置至X张（X为其体力上限，至多5）',
                { jiemingCandidates: candidates }, false)
        }
    }
    // ── 洛书版扩展（九）：受伤后的新技能 ──
    if (target.alive) {
        // 筹策（戏志才）：受到1点伤害后判定
        if (hasSkill(target, 'xizhicai_chouce')) {
            askSkill(state, target, 'xizhicai_chouce', '筹策',
                '进行一次判定：黑色你弃置一名角色区域里的一张牌；红色你令一名角色摸一张牌', {}, false)
        }
        // 贲育（程昱）
        if (hasSkill(target, 'chengyu_benyu') && attacker) {
            const byX = attacker.hand.length
            if (target.hand.length < byX) {
                askSkill(state, target, 'chengyu_benyu_draw', '贲育',
                    `将手牌摸至${Math.min(5, byX)}张（至多摸五张）`, { benyuX: byX }, false)
            } else if (target.hand.length > byX) {
                askSkill(state, target, 'chengyu_benyu_discard', '贲育',
                    `弃置至少${byX + 1}张手牌，对【${getGeneralName(attacker)}】造成1点伤害`,
                    { benyuX: byX, benyuSourceIndex: state.generals.indexOf(attacker) }, false)
            }
        }
        // 先辅（戏志才）
        triggerXianfuDamage(state, target, amount)
    }
    // 毅谋（鲍信）
    triggerYimou(state, target)
}

/** 牌的保留价值（仅用于自动选择最不值钱的牌） */
// ═════════════════════════════════════════════════════════════
// 洛书版扩展（五）：新增武将辅助
// ═════════════════════════════════════════════════════════════

/** 是否为会造成伤害的牌（【杀】与伤害类普通锦囊） */
function isDamageCard(card: Card): boolean {
    if (isSlashLikeCard(card)) return true
    const damageTricks: string[] = [
        TrickCardName.DUEL, TrickCardName.BARBARIANS,
        TrickCardName.ARROWS, TrickCardName.FIRE_ATTACK,
    ]
    return damageTricks.includes(card.name)
}

/** 伤逝（界张春华）：手牌数小于已损失的体力值时，可以将手牌摸至该值 */
function maybeShangshi(state: GameState, general: GeneralInstance): void {
    if (!general.alive || !hasSkill(general, 'zhangchunhua_shangshi')) return
    const lost = general.maxHp - general.hp
    if (lost <= 0 || general.hand.length >= lost) return
    const idx = indexOfGeneral(state, general)
    // 已经在等待同一个询问时不重复压入
    if (state.pendingResponseQueue.some(p => p.targetGeneralIndex === idx
        && (p.context as any)?.skillId === 'zhangchunhua_shangshi')) return
    state.pendingResponseQueue.push({
        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
        targetGeneralIndex: idx,
        context: {
            skillId: 'zhangchunhua_shangshi',
            skillName: '伤逝',
            description: `将手牌摸至${lost}张（X为你已损失的体力值）`,
            shangshiTarget: lost,
        },
    })
}

/**
 * 求援（界伏皇后）：当你成为其他角色使用伤害牌的目标时，
 * 可以选择另一名角色（锦囊牌则须为非目标角色）成为此牌的额外目标。
 * 返回 true 表示已压入询问、本次用牌需要延迟结算。
 */
function maybeXuanqiu(
    state: GameState,
    user: GeneralInstance,
    card: Card,
    targets: GeneralInstance[],
): boolean {
    if (!isDamageCard(card)) return false
    const owner = targets.find(t => t !== user && t.alive
        && hasSkill(t, 'fuhuanghou_xuanqiu'))
    if (!owner) return false
    const targetIndices = targets.map(t => indexOfGeneral(state, t))
    const isTrick = card.category === CardCategory.TRICK
    const candidates = state.generals
        .map((g, idx) => ({ g, idx }))
        .filter(({ g, idx }) => g.alive
            && idx !== indexOfGeneral(state, owner)
            && idx !== indexOfGeneral(state, user)
            && (!isTrick || !targetIndices.includes(idx)))
        .map(({ idx }) => idx)
    if (candidates.length === 0) return false
    state.pendingResponseQueue.push({
        type: ResponseType.SKILL_CHOOSE_TARGET,
        targetGeneralIndex: indexOfGeneral(state, owner),
        context: {
            skillId: 'fuhuanghou_xuanqiu',
            skillName: '求援',
            description: isTrick
                ? '选择另一名不为目标的其他角色：除非其交给你一张与此牌类别相同且牌名不同的牌，否则其也成为此牌的目标'
                : '选择另一名其他角色：除非其交给你一张与此牌类别相同且牌名不同的牌，否则其也成为此牌的目标',
            candidateIndices: candidates,
            xuanqiuOwnerIndex: indexOfGeneral(state, owner),
            xuanqiuUserIndex: indexOfGeneral(state, user),
            xuanqiuCardId: card.id,
            xuanqiuCardName: card.name,
            xuanqiuCardCategory: card.category,
            xuanqiuTargetIndices: targetIndices,
        },
    })
    addLog(state, `【${getGeneralName(owner)}】可发动【求援】`)
    return true
}

/** 求援结算（或放弃）后，按新的目标列表继续本次用牌 */
function resumeXuanqiuUse(
    state: GameState,
    ctx: any,
    extraTargetIndex?: number,
): void {
    const user = state.generals[ctx.xuanqiuUserIndex as number]
    if (!user?.alive) return
    const cardIdx = user.hand.findIndex(c => c.id === ctx.xuanqiuCardId)
    if (cardIdx === -1) return
    const card = user.hand[cardIdx]
    const targetIndices = [...((ctx.xuanqiuTargetIndices as number[]) ?? [])]
    let added = false
    if (extraTargetIndex !== undefined && !targetIndices.includes(extraTargetIndex)) {
        targetIndices.push(extraTargetIndex)
        added = true
    }
    const targets = targetIndices.map(i => state.generals[i]).filter(g => g?.alive)
    // 【杀】默认只能指定一名目标，求援追加的目标靠天义同款的目标额度过校验
    if (added && (card.name === BasicCardName.ATTACK || isCardUsableAsAttack(user, card))) {
        user.extraSlashTargets = (user.extraSlashTargets ?? 0) + 1
    }
    const outcome = dispatchCardUse(state, user, card, cardIdx, targets)
    if (added && (card.name === BasicCardName.ATTACK || isCardUsableAsAttack(user, card))) {
        user.extraSlashTargets = (user.extraSlashTargets ?? 0) - 1
    }
    if (outcome && 'error' in outcome) addLog(state, `【求援】${outcome.error}`)
}

/** 权计 / 陷嗣：武将牌上的“权”“逆”数量 */
function pileCount(general: GeneralInstance): number {
    return general.generalPile?.length ?? 0
}

/** 将一张牌置于某角色的武将牌上 */
function pushToGeneralPile(
    state: GameState,
    owner: GeneralInstance,
    card: Card,
): void {
    owner.generalPile = [...(owner.generalPile ?? []), card]
    triggerLiangyin(state, 'out')
}

/** 牌的类别名称（强识等技能日志用） */
function cardCategoryLabel(category: CardCategory): string {
    return category === CardCategory.BASIC ? '基本牌'
        : category === CardCategory.TRICK ? '锦囊牌'
            : category === CardCategory.EQUIPMENT ? '装备牌' : '牌'
}

/** 是否存在点数之和恰好为 target 的牌子集（资援） */
function hasSubsetSum(cards: Card[], target: number): boolean {
    const reachable = new Array<boolean>(target + 1).fill(false)
    reachable[0] = true
    for (const c of cards) {
        const v = Math.min(c.value, target)
        if (v <= 0) continue
        for (let s = target; s >= v; s--) {
            if (reachable[s - v]) reachable[s] = true
        }
    }
    return reachable[target]
}

/** 视为使用一张【决斗】（翦灭等） */
function useVirtualDuel(
    state: GameState,
    source: GeneralInstance,
    targetIndex: number,
    label: string,
): { error: string } | void {
    const target = state.generals[targetIndex]
    if (!target?.alive || target === source) return { error: '目标无效' }
    const duelCard: Card = {
        id: `virtual_duel_${state.log.length}_${targetIndex}`,
        suit: CardSuit.SPADE,
        value: 1,
        category: CardCategory.TRICK,
        name: TrickCardName.DUEL,
        trickType: TrickType.INSTANT,
        virtual: true,
    }
    addLog(state, `【${getGeneralName(source)}】${label ? `【${label}】` : ''}视为对【${getGeneralName(target)}】使用一张【决斗】`)
    return handleTrickCard(state, source, duelCard, -1, [target])
}

/** 巧变：阶段名称 */
function qiaobianPhaseLabel(phase: string): string {
    return phase === 'judge' ? '判定'
        : phase === 'draw' ? '摸牌'
            : phase === 'action' ? '出牌'
                : phase === 'discard' ? '弃牌' : ''
}

/** 巧变：按被跳过的阶段给后续收益并推进回合 */
function applyQiaobianSkip(
    state: GameState,
    general: GeneralInstance,
    phase: string,
    skipAction: boolean,
): void {
    if (phase === 'judge') {
        continueTurnFromJudge(state, true, false, skipAction)
        return
    }
    if (phase === 'draw') {
        const candidates = state.generals
            .map((g, idx) => ({ g, idx }))
            .filter(({ g, idx }) => g.alive && idx !== indexOfGeneral(state, general)
                && g.hand.length > 0)
            .map(({ idx }) => idx)
        if (candidates.length > 0) {
            state.pendingResponseQueue.push({
                type: ResponseType.SKILL_CHOOSE_TARGET,
                targetGeneralIndex: indexOfGeneral(state, general),
                context: {
                    skillId: 'zhanghe_qiaobian_draw',
                    skillName: '巧变',
                    description: '获得至多两名角色的各一张手牌',
                    candidateIndices: candidates,
                    multi: true,
                    maxPicks: 2,
                    qiaobianSkipAction: skipAction,
                },
            })
            return
        }
        finishJudgePhaseAndContinue(state, general, skipAction, true)
        return
    }
    if (phase === 'action') {
        const equipSources = state.generals
            .map((g, idx) => ({ g, idx }))
            .filter(({ g }) => g.alive && Object.values(g.equip).some(Boolean))
            .map(({ idx }) => idx)
        if (equipSources.length > 0) {
            state.pendingResponseQueue.push({
                type: ResponseType.SKILL_CHOOSE_TARGET,
                targetGeneralIndex: indexOfGeneral(state, general),
                context: {
                    skillId: 'zhanghe_qiaobian_move',
                    skillName: '巧变',
                    description: '移动场上的一张牌：选择装备牌的来源角色',
                    candidateIndices: equipSources,
                },
            })
            return
        }
        enterDiscardPhaseOrSkip(state, general)
        return
    }
    // 弃牌阶段：跳过弃牌阶段，直接结算结束阶段
    finishTurn(state)
}

function cardKeepValue(c: Card): number {
    if (c.name === BasicCardName.PEACH) return 100
    if (c.name === BasicCardName.DODGE) return 80
    if (c.name === BasicCardName.ATTACK || c.name === BasicCardName.FIRE_SLASH
        || c.name === BasicCardName.THUNDER_SLASH) return 70
    if (c.name === BasicCardName.WINE) return 55
    if (c.category === CardCategory.EQUIPMENT) return 50
    return 30
}

/** 自动挑选一张价值最低的手牌 */
function lowValueCard(general: GeneralInstance, filter: (c: Card) => boolean = () => true): Card | undefined {
    return [...general.hand].filter(filter).sort((a, b) => cardKeepValue(a) - cardKeepValue(b))[0]
}

/** 自动挑选一名装备牌最多的角色（优先敌方） */
function equipRichest(state: GameState, exclude?: GeneralInstance, preferEnemyOf?: GeneralInstance): GeneralInstance | undefined {
    const pool = state.generals.filter(g => g.alive && g !== exclude && Object.values(g.equip).some(Boolean))
    if (pool.length === 0) return undefined
    const enemy = preferEnemyOf ? pool.filter(g => g.faction !== preferEnemyOf.faction) : []
    const list = enemy.length > 0 ? enemy : pool
    return list.sort((a, b) => Object.values(b.equip).filter(Boolean).length - Object.values(a.equip).filter(Boolean).length)[0]
}

/** 自动移动一张装备牌到目标角色 */
function autoMoveEquip(state: GameState, dest: GeneralInstance, preferEnemyOf?: GeneralInstance, skillName = '移动装备'): boolean {
    const source = equipRichest(state, dest, preferEnemyOf)
    if (!source) return false
    const slot = Object.values(EquipSlot).find(s => source.equip[s])!
    const card = source.equip[slot]!
    const old = dest.equip[slot]
    if (old) state.discard.push(old)
    source.equip[slot] = undefined as any
    dest.equip[slot] = card
    addLog(state, `【${skillName}】将【${getGeneralName(source)}】的${cardFullName(card)}移动到【${getGeneralName(dest)}】的装备区`)
    return true
}

/** 拼点（双方自动选择价值最低的手牌） */
function autoPindian(state: GameState, initiator: GeneralInstance, opponent: GeneralInstance, skillId: string, skillName: string): void {
    const a = lowValueCard(initiator)
    const b = lowValueCard(opponent)
    if (!a || !b) {
        addLog(state, `【${skillName}】拼点条件不足（一方没有手牌）`)
        return
    }
    const ai = initiator.hand.indexOf(a)
    const bi = opponent.hand.indexOf(b)
    initiator.hand.splice(ai, 1)
    opponent.hand.splice(bi, 1)
    state.pindian = {
        initiatorIndex: state.generals.indexOf(initiator),
        opponentIndex: state.generals.indexOf(opponent),
        skillId, skillName, stage: 'initiator', firstCard: a,
    }
    resolvePindian(state, a, b)
}

function markBasicUsed(general: GeneralInstance, name: string): void {
    const used = general.basicUsedThisTurn ?? []
    if (!used.includes(name)) general.basicUsedThisTurn = [...used, name]
}

/** 节命（界荀彧）：令其摸X张（X为其体力上限，至多5），然后手牌弃置至X张 */
function applyJieming(state: GameState, who: GeneralInstance): void {
    if (!who?.alive) return
    const x = Math.min(who.maxHp, 5)
    const drawn = drawForGeneral(state, who, x)
    who.hand.push(...drawn)
    addLog(state, `【${getGeneralName(who)}】因【节命】摸${drawn.length}张牌（X=${x}）`)
    const excess = who.hand.length - x
    if (excess <= 0) return
    state.pendingResponseQueue.unshift({
        type: ResponseType.SKILL_PICK_CARD,
        targetGeneralIndex: state.generals.indexOf(who),
        context: {
            skillId: 'xunyu_jieming', skillName: '节命', mode: 'discard',
            count: excess,
            description: `将手牌弃置至${x}张`,
        },
    })
}

/** 八卦阵判定：装备八卦阵，或卧龙诸葛无防具时的【八阵】 */
function hasBaguaArmor(general: GeneralInstance): boolean {
    if (general.equip.armor) return general.equip.armor.name === EquipmentCardName.EIGHT_TRIGRAMS
    return hasSkill(general, 'wolong_bazhen')
}

function hasSkill(general: GeneralInstance, skillId: string): boolean {
    if (general.lostSkills?.includes(skillId)) return false
    const def = getGeneralById(general.generalId)
    return (def?.skills.some((s) => s.id === skillId) ?? false)
        || (general.acquiredSkills?.includes(skillId) ?? false)
}

function isCardUsableAsDodge(general: GeneralInstance, card: Card): boolean {
    if (card.name === BasicCardName.DODGE) return true
    if (hasSkill(general, 'zhaoyun_longdan') && card.name === BasicCardName.ATTACK) return true
    if (hasSkill(general, 'zhenji_qingguo') && (card.suit === CardSuit.SPADE || card.suit === CardSuit.CLUB)) return true
    if (hasSkill(general, 'shenzhaoyun_longhun') && card.suit === CardSuit.CLUB) return true
    return false
}

function isCardUsableAsAttack(general: GeneralInstance, card: Card): boolean {
    if (card.name === BasicCardName.ATTACK || card.name === BasicCardName.FIRE_SLASH || card.name === BasicCardName.THUNDER_SLASH) return true
    if (hasSkill(general, 'zhaoyun_longdan') && card.name === BasicCardName.DODGE) return true
    if (hasSkill(general, 'guanyu_wusheng') && (card.suit === CardSuit.HEART || card.suit === CardSuit.DIAMOND)) return true
    return false
}

/** 从目标移除一张牌（手牌优先，然后装备） */
function removeOneCardFrom(target: GeneralInstance, state: GameState): boolean {
    if (target.hand.length > 0) {
        state.discard.push(target.hand.splice(0, 1)[0])
        checkTuntian(state, target)
        triggerLianying(state, target)
        return true
    }
    for (const slot of Object.values(EquipSlot)) {
        if (target.equip[slot]) {
            const lostEquip = clearEquipSlot(state, target, slot)
            if (lostEquip) state.discard.push(lostEquip)
            triggerXiaoji(state, target)
            checkTuntian(state, target)
            return true
        }
    }
    return false
}

function getGeneralName(general: GeneralInstance): string {
    const def = getGeneralById(general.generalId)
    return def?.name ?? general.generalId
}

// ─────────────────────────────────────────────────────────────
// 对外入口：统一在动作结束后补一次“失去牌”检测
// ─────────────────────────────────────────────────────────────

export function handleNegateRespond(
    state: GameState,
    playerId: string,
    data: { cardId?: string; generalIndex: number },
): { error: string } | void {
    // 一次响应可能直接结束回合：失去牌仍属于动作开始时的回合角色
    const activeBefore = state.activeGeneralIndex
    const result = handleNegateRespondImpl(state, playerId, data)
    syncCardState(state, activeBefore)
    return result
}

export function negateWindowTimeout(state: GameState): void {
    const activeBefore = state.activeGeneralIndex
    negateWindowTimeoutImpl(state)
    syncCardState(state, activeBefore)
}

export function processAutoExecutePending(state: GameState): void {
    const activeBefore = state.activeGeneralIndex
    processAutoExecutePendingImpl(state)
    syncCardState(state, activeBefore)
    resumeLuanwuIfIdle(state)
}

export function handleUseCard(
    state: GameState,
    playerId: string,
    data: C2S_UseCard
): { error: string } | void {
    const activeBefore = state.activeGeneralIndex
    const result = handleUseCardImpl(state, playerId, data)
    syncCardState(state, activeBefore)
    return result
}

export function handleUseSkill(
    state: GameState,
    playerId: string,
    data: C2S_UseSkill
): { error: string } | void {
    const activeBefore = state.activeGeneralIndex
    const result = handleUseSkillImpl(state, playerId, data)
    syncCardState(state, activeBefore)
    return result
}

/**
 * 技能发动时已一并选好目标/手牌：确认结算后若紧接着弹出的仍是同一技能的选择询问，
 * 直接用这些输入作答，省掉第二次询问。仅在询问同属该技能、且玩家就是响应者时生效。
 */
function applyActivationInputs(
    state: GameState,
    playerId: string,
    data: C2S_Respond,
    confirmSkillId: string,
): void {
    const targets = [...new Set((data.targetIndices as number[] | undefined) ?? [])]
    const cards = [...new Set((data.cardIds as string[] | undefined) ?? [])]
    if (targets.length === 0 && cards.length === 0) return
    const next = state.pendingResponseQueue[0]
    if (!next) return
    const responder = state.generals[next.targetGeneralIndex]
    if (!responder || responder.playerId !== playerId) return
    const nextCtx = next.context as any
    const nextSkillId = nextCtx?.skillId as string | undefined
    if (!nextSkillId) return
    if (nextSkillId !== confirmSkillId && !nextSkillId.startsWith(confirmSkillId + '_')) return

    if (next.type === ResponseType.SKILL_CHOOSE_TARGET) {
        const candidates = (nextCtx.candidateIndices as number[] | undefined) ?? []
        const picks = targets.filter(i => candidates.includes(i))
        if (picks.length === 0) return
        handleRespondImpl(state, playerId, {
            action: 'confirm',
            ...(picks.length === 1 ? { targetIndex: picks[0] } : {}),
            targetIndices: picks,
        })
        return
    }
    if (next.type === ResponseType.SKILL_PICK_CARD) {
        const allowed = nextCtx.candidateCardIds as string[] | undefined
        const picks = cards.filter(id => !allowed || allowed.includes(id))
        if (picks.length === 0) return
        handleRespondImpl(state, playerId, { action: 'confirm', cardIds: picks })
    }
}

/**
 * 乱武（贾诩）：等上一名角色的【杀】结算（出闪 / 伤害 / 濒死）全部完成、
 * 队列空下来之后，再创建下一名角色的询问
 */
export function resumeLuanwuIfIdle(state: GameState): void {
    const scheduled = state.pendingLuanwu
    if (!scheduled) return
    if (state.pendingResponseQueue.length > 0 || state.negateWindow) return
    state.pendingLuanwu = undefined
    const remaining = scheduled.remainingIndices
    while (remaining.length > 0 && !checkGameOver(state).over) {
        const nextIdx = remaining.shift()!
        const nextGeneral = state.generals[nextIdx]
        if (!nextGeneral?.alive) continue
        const nextNearest = findNearestTargets(state, nextGeneral)
        if (nextNearest.length === 0) continue
        state.pendingResponseQueue.push({
            type: ResponseType.SKILL_LUANWU_RESPONSE,
            targetGeneralIndex: nextIdx,
            context: {
                luanwuUserIndex: scheduled.luanwuUserIndex,
                remainingIndices: remaining,
                nearestIndices: nextNearest,
            },
        })
        const nearestNames = nextNearest.map((i: number) => getGeneralName(state.generals[i])).join('、')
        addLog(state, `【${getGeneralName(nextGeneral)}】：距离最近的角色为【${nearestNames}】，请出【杀】或放弃（失去1血）`)
        return
    }
    maybeLuanwuExtraSlash(state, scheduled.luanwuUserIndex)
}

export function handleRespond(
    state: GameState,
    playerId: string,
    data: C2S_Respond
): { error: string } | void {
    const head = state.pendingResponseQueue[0]
    const confirmSkillId = head?.type === ResponseType.SKILL_ACTIVATE_CONFIRM
        ? (head.context as any)?.skillId as string | undefined
        : undefined
    const activeBefore = state.activeGeneralIndex
    const result = handleRespondImpl(state, playerId, data)
    if (!result && confirmSkillId) applyActivationInputs(state, playerId, data, confirmSkillId)
    syncCardState(state, activeBefore)
    if (!result) resumeLuanwuIfIdle(state)
    return result
}

// ═════════════════════════════════════════════════════════════
// 洛书版扩展（七）：新增/调整武将技能
/** 取走区域里的一张牌（装备 / 判定区） */
function expTakeAreaCard(state: GameState, owner: GeneralInstance, cardId: string, discardIt = true): Card | undefined {
    for (const slot of Object.values(EquipSlot)) {
        if (owner.equip[slot]?.id === cardId) {
            const card = owner.equip[slot]!
            clearEquipSlot(state, owner, slot)
            if (discardIt) state.discard.push(card)
            return card
        }
    }
    const jIdx = owner.judgeZone.findIndex(c => c.id === cardId)
    if (jIdx >= 0) {
        const [card] = owner.judgeZone.splice(jIdx, 1)
        if (discardIt) state.discard.push(card)
        return card
    }
    return undefined
}

function expPickA(
    state: GameState,
    general: GeneralInstance,
    pending: PendingResponse,
    action: string | undefined,
    ctx: any,
    cardIds: string[],
): ExpDispatch {
    const selfIdx = indexOfGeneral(state, general)

    // ── 陈琳：笔伐 选牌扣置 ──
    if (ctx.skillId === 'chenlin_bifa') {
        state.pendingResponseQueue.shift()
        if (action === 'decline') return
        const targetIdx = ctx.bifaTargetIndex as number
        const target = state.generals[targetIdx]
        if (!target?.alive || cardIds.length === 0) return
        const taken = detachCardFromHandOrEquip(state, general, cardIds[0])
        if ('error' in taken) return
        target.bifaCards = [...(target.bifaCards ?? []), taken]
        target.bifaSourceIndex = selfIdx
        addLog(state, `【${getGeneralName(general)}】【笔伐】将${cardFullName(taken)}扣置于【${getGeneralName(target)}】的武将牌上`)
        return
    }

    // ── 陈琳：笔伐 交出同类别手牌，获得此牌 ──
    if (ctx.skillId === 'chenlin_bifa_start_give') {
        state.pendingResponseQueue.shift()
        if (action === 'decline') return
        const cardId = ctx.bifaCardId as string
        const cards = general.bifaCards ?? []
        const bifa = cards.find(c => c.id === cardId)
        const source = state.generals[general.bifaSourceIndex ?? -1]
        if (!bifa || !source || cardIds.length === 0) return
        const given = detachCardFromHandOrEquip(state, general, cardIds[0])
        if ('error' in given) return
        source.hand.push(given)
        general.bifaCards = cards.filter(c => c.id !== cardId)
        general.hand.push(bifa)
        addLog(state, `【${getGeneralName(general)}】将${cardFullName(given)}交给【${getGeneralName(source)}】，获得【笔伐】牌${cardFullName(bifa)}`)
        if ((general.bifaCards?.length ?? 0) > 0) triggerBifaTurnStart(state, general)
        return
    }

    // ── 陈琳：颂词 目标弃两张 ──
    if (ctx.skillId === 'chenlin_songci_discard') {
        state.pendingResponseQueue.shift()
        if (action === 'decline') return
        const cnt = (ctx.count as number) ?? 2
        let discarded = 0
        for (const id of cardIds.slice(0, cnt)) {
            const res = removeCardFromHandOrEquip(state, general, id)
            if (!('error' in res)) discarded++
        }
        addLog(state, `【${getGeneralName(general)}】【颂词】弃置${discarded}张牌`)
        return
    }

    // ── 何太后：鸩毒 ──
    if (ctx.skillId === 'hetaihou_zhendu') {
        state.pendingResponseQueue.shift()
        if (action === 'decline' || cardIds.length === 0) return
        const res = removeCardFromHandOrEquip(state, general, cardIds[0])
        if ('error' in res) return
        const targetIdx = ctx.zhenduTargetIndex as number
        const target = state.generals[targetIdx]
        if (!target?.alive) return
        target.zhenduWine = true
        addLog(state, `【${getGeneralName(general)}】发动【鸩毒】，弃置${cardFullName(res)}，令【${getGeneralName(target)}】视为使用一张【酒】`)
        if (target !== general) dealDamage(state, general, target, 1)
        return
    }

    // ── 孙鲁育：魅步 ──
    if (ctx.skillId === 'sunluyu_meibu') {
        state.pendingResponseQueue.shift()
        if (action === 'decline' || cardIds.length === 0) return
        const res = removeCardFromHandOrEquip(state, general, cardIds[0])
        if ('error' in res) return
        const targetIdx = ctx.meibuTargetIndex as number
        const target = state.generals[targetIdx]
        if (!target?.alive) return
        target.meibuZhixi = true
        addLog(state, `【${getGeneralName(general)}】发动【魅步】，弃置${cardFullName(res)}，令【${getGeneralName(target)}】本阶段视为拥有“止息”`)
        const isSlash = res.name === BasicCardName.ATTACK
        const isBlackTrick = res.category === CardCategory.TRICK
            && (res.suit === CardSuit.SPADE || res.suit === CardSuit.CLUB)
        if (!isSlash && !isBlackTrick) {
            target.meibuSeat = selfIdx
            addLog(state, `【${getGeneralName(target)}】本阶段计算与【${getGeneralName(general)}】的距离视为1`)
        }
        return
    }

    // ── 孙鲁育：穆穆 弃置场上的装备牌 ──
    if (ctx.skillId === 'sunluyu_mumu' && ctx.mumuMode === 'discard') {
        state.pendingResponseQueue.shift()
        if (action === 'decline') return
        const ownerIdx = ctx.areaOwnerIndex as number
        const owner = state.generals[ownerIdx]
        if (!owner || cardIds.length === 0) return
        const taken = expTakeAreaCard(state, owner, cardIds[0])
        if (!taken) return
        addLog(state, `【${getGeneralName(general)}】【穆穆】弃置【${getGeneralName(owner)}】的${cardFullName(taken)}`)
        return
    }

    // ── 曹纯：缮甲 ──
    if (ctx.skillId === 'caochun_shanjia') {
        state.pendingResponseQueue.shift()
        const cnt = (ctx.count as number) ?? 1
        const discarded: Card[] = []
        if (action !== 'decline') {
            for (const id of cardIds.slice(0, cnt)) {
                const res = removeCardFromHandOrEquip(state, general, id)
                if (!('error' in res)) discarded.push(res)
            }
        }
        addLog(state, `【${getGeneralName(general)}】【缮甲】弃置${discarded.length}张牌`)
        expApplyShanjia(state, general, discarded)
        return
    }

    // ── SP蔡文姬：陈情 目标弃四张 ──
    if (ctx.skillId === 'caiwenji_sp_chenqing_discard') {
        state.pendingResponseQueue.shift()
        const cnt = (ctx.count as number) ?? 4
        const suits: CardSuit[] = []
        for (const id of cardIds.slice(0, cnt)) {
            const res = removeCardFromHandOrEquip(state, general, id)
            if (!('error' in res)) suits.push(res.suit)
        }
        addLog(state, `【${getGeneralName(general)}】【陈情】弃置${suits.length}张牌`)
        const allDiff = suits.length >= 4 && new Set(suits).size === suits.length
        const dying = state.generals[ctx.chenqingDyingIndex as number]
        const healer = state.generals[ctx.chenqingOwnerIndex as number]
        if (allDiff && dying?.alive && healer?.alive) {
            expChenqingSave(state, dying, healer)
        }
        return
    }

    // ── SP蔡文姬：默识 选一张手牌转化 ──
    if (ctx.skillId === 'caiwenji_sp_moshi') {
        state.pendingResponseQueue.shift()
        if (action === 'decline' || cardIds.length === 0) return
        const handIdx = general.hand.findIndex(c => c.id === cardIds[0])
        if (handIdx < 0) return
        const card = general.hand[handIdx]
        const moshiName = String(ctx.moshiName)
        const moshiCategory = ctx.moshiCategory as CardCategory
        card.originalName = card.originalName ?? card.name
        card.originalCategory = card.originalCategory ?? card.category
        card.name = moshiName as any
        card.category = moshiCategory
        general.moshiUseIndex = (general.moshiUseIndex ?? 0) + 1
        addLog(state, `【${getGeneralName(general)}】【默识】将${cardFullName(card)}当${cardDisplayName({ name: moshiName } as Card)}使用`)
        state.pendingResponseQueue.unshift({
            type: ResponseType.SKILL_CHOOSE_TARGET,
            targetGeneralIndex: selfIdx,
            context: {
                skillId: 'caiwenji_sp_moshi_use', skillName: '默识',
                description: '为该牌选择目标',
                candidateIndices: expAliveIdx(state, g => g !== general),
                moshiCardId: card.id,
                moshiStage: ctx.moshiStage,
            },
        })
        return
    }

    // ── 李丰：屯储 置于武将牌上 ──
    if (ctx.skillId === 'lifeng_tunchu') {
        state.pendingResponseQueue.shift()
        if (action === 'decline') {
            addLog(state, `【${getGeneralName(general)}】【屯储】未将手牌置于武将牌上`)
            return
        }
        const placed: Card[] = []
        for (const id of cardIds) {
            const taken = detachCardFromHandOrEquip(state, general, id)
            if (!('error' in taken)) placed.push(taken)
        }
        general.liangCards = [...(general.liangCards ?? []), ...placed]
        if (placed.length > 0) {
            addLog(state, `【${getGeneralName(general)}】【屯储】将${placed.length}张手牌置于武将牌上称为“粮”`)
        }
        return
    }

    // ── 程昱：设伏 扣置“伏兵” ──
    if (ctx.skillId === 'chengyu_shefu') {
        state.pendingResponseQueue.shift()
        if (action === 'decline' || cardIds.length === 0) return
        const taken = detachCardFromHandOrEquip(state, general, cardIds[0])
        if ('error' in taken) return
        general.fubing = [...(general.fubing ?? []), { card: taken, name: String(ctx.fubingName) }]
        addLog(state, `【${getGeneralName(general)}】【设伏】扣置${cardFullName(taken)}，记录牌名${cardDisplayName({ name: String(ctx.fubingName) } as Card)}`)
        return
    }

    // ── 程昱：贲育 弃牌造成伤害 ──
    if (ctx.skillId === 'chengyu_benyu_discard') {
        state.pendingResponseQueue.shift()
        const src = state.generals[ctx.benyuSourceIndex as number]
        let discarded = 0
        for (const id of cardIds) {
            const res = removeCardFromHandOrEquip(state, general, id)
            if (!('error' in res)) discarded++
        }
        addLog(state, `【${getGeneralName(general)}】【贲育】弃置${discarded}张手牌`)
        if (discarded > 0 && src?.alive) dealDamage(state, general, src, 1)
        return
    }

    // ── 刘协：天命 弃牌摸牌 ──
    if (ctx.skillId === 'liuxie_tianming' || ctx.skillId === 'liuxie_tianming_other') {
        state.pendingResponseQueue.shift()
        let discarded = 0
        for (const id of cardIds) {
            const res = removeCardFromHandOrEquip(state, general, id)
            if (!('error' in res)) discarded++
        }
        const n = expDrawTo(state, general, 2)
        addLog(state, `【${getGeneralName(general)}】【天命】弃置${discarded}张牌，摸${n}张牌`)
        if (ctx.skillId === 'liuxie_tianming') {
            const maxHp = Math.max(...state.generals.filter(g => g.alive && g !== general).map(g => g.hp))
            const candidates = state.generals
                .map((g, i) => ({ g, i }))
                .filter(({ g }) => g.alive && g !== general && g.hp === maxHp)
            if (candidates.length === 1 && expHasAnyCard(candidates[0].g)) {
                state.pendingResponseQueue.push({
                    type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                    targetGeneralIndex: candidates[0].i,
                    context: {
                        skillId: 'liuxie_tianming_other', skillName: '天命',
                        description: '你可以弃置两张牌（不足则全弃）并摸两张牌',
                    },
                })
            }
        }
        return
    }

    // ── 灵雎：竭缘 ──
    if (ctx.skillId === 'lingju_jieyuan_atk' || ctx.skillId === 'lingju_jieyuan_def') {
        state.pendingResponseQueue.shift()
        const atkSlot = ctx.skillId === 'lingju_jieyuan_atk'
        let ok = false
        if (action !== 'decline' && cardIds.length > 0) {
            const res = removeCardFromHandOrEquip(state, general, cardIds[0])
            ok = !('error' in res)
        }
        const attackerIdx = ctx.jieyuanAttackerIndex as number
        const targetIdx = ctx.jieyuanTargetIndex as number
        const amount = ((ctx.jieyuanAmount as number) ?? 1) + (ok ? (atkSlot ? 1 : -1) : 0)
        if (ok) addLog(state, `【${getGeneralName(general)}】【竭缘】令此伤害${atkSlot ? '+1' : '-1'}`)
        if (amount > 0) {
            dealDamage(state, state.generals[attackerIdx], state.generals[targetIdx], amount,
                ctx.jieyuanCardId as string | undefined)
        }
        return
    }

    // ── 裴秀：爵制 ──
    if (ctx.skillId === 'peixiu_juezhi') {
        state.pendingResponseQueue.shift()
        if (action === 'decline') return
        let sum = 0
        let cnt = 0
        for (const id of cardIds) {
            const res = removeCardFromHandOrEquip(state, general, id)
            if (!('error' in res)) { sum += res.value; cnt++ }
        }
        if (cnt < 2) {
            addLog(state, '【爵制】至少需要弃置两张牌')
            return
        }
        const x = sum % 13 === 0 ? 13 : sum % 13
        const deckIdx = state.deck.findIndex(c => c.value === x)
        if (deckIdx >= 0) {
            const [card] = state.deck.splice(deckIdx, 1)
            general.hand.push(card)
            addLog(state, `【${getGeneralName(general)}】【爵制】弃置${cnt}张牌（点数之和${sum}），获得点数为${x}的${cardFullName(card)}`)
        } else {
            addLog(state, `【${getGeneralName(general)}】【爵制】牌堆中没有点数为${x}的牌`)
        }
        return
    }

    // ── 孙綝：逆固 ──
    if (ctx.skillId === 'sunchen_nigu') {
        state.pendingResponseQueue.shift()
        if (action === 'decline') return
        const used: CardSuit[] = []
        let cnt = 0
        for (const id of cardIds) {
            const handCard = general.hand.find(c => c.id === id)
            const equipCard = Object.values(general.equip).find(c => c?.id === id)
            const card = handCard ?? equipCard
            if (!card) continue
            if (used.includes(card.suit)) continue
            const res = removeCardFromHandOrEquip(state, general, id)
            if ('error' in res) continue
            used.push(card.suit)
            cnt++
        }
        if (cnt === 0) {
            addLog(state, '【逆固】没有弃置合法的牌（花色不能重复）')
            return
        }
        addLog(state, `【${getGeneralName(general)}】【逆固】弃置${cnt}张花色不同的牌`)
        const cands = expAliveIdx(state, g => g !== general && getAttackRange(general, g, state.generals).inRange)
        for (const idx of cands) {
            state.pendingResponseQueue.push({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: idx,
                context: {
                    skillId: 'sunchen_nigu_give', skillName: '逆固',
                    description: `是否交给【${getGeneralName(general)}】一张牌？（不交则其本回合下一次伤害+1）`,
                    options: [
                        { action: 'give', label: `交给【${getGeneralName(general)}】一张牌` },
                        { action: 'decline', label: '不交' },
                    ],
                    niguOwnerIndex: selfIdx,
                },
            })
        }
        return
    }

    // ── 潘濬：观微 ──
    if (ctx.skillId === 'panjun_guanwei') {
        state.pendingResponseQueue.shift()
        if (action === 'decline' || cardIds.length === 0) return
        const res = removeCardFromHandOrEquip(state, general, cardIds[0])
        if ('error' in res) return
        const target = state.generals[ctx.guanweiTargetIndex as number]
        if (!target?.alive) return
        general.guanweiTurn = state.turnSerial
        const n = expDrawTo(state, target, 2)
        target.extraActionPhase = true
        addLog(state, `【${getGeneralName(general)}】发动【观微】，弃置${cardFullName(res)}，令【${getGeneralName(target)}】摸${n}张牌并获得一个额外的出牌阶段`)
        return
    }

    return EXP_UNHANDLED
}

function expTargetA(
    state: GameState,
    general: GeneralInstance,
    pending: PendingResponse,
    action: string | undefined,
    ctx: any,
    chosenIdx?: number,
): ExpDispatch {
    const selfIdx = indexOfGeneral(state, general)
    const targetIdx = chosenIdx ?? (pending.context?.targetIndex as number | undefined)
    const chosen = typeof targetIdx === 'number' ? state.generals[targetIdx] : undefined

    // ── 陈琳：笔伐 选择目标 ──
    if (ctx.skillId === 'chenlin_bifa' && ctx.bifaStage === 'target') {
        state.pendingResponseQueue.shift()
        if (action === 'decline' || !chosen) return
        state.pendingResponseQueue.unshift({
            type: ResponseType.SKILL_PICK_CARD,
            targetGeneralIndex: selfIdx,
            context: {
                skillId: 'chenlin_bifa', skillName: '笔伐',
                description: `选择一张手牌扣置于【${getGeneralName(chosen)}】的武将牌上`,
                count: 1, mode: 'bifa', bifaTargetIndex: targetIdx as number,
            },
        })
        return
    }

    // ── 孙鲁育：穆穆 ──
    if (ctx.skillId === 'sunluyu_mumu') {
        state.pendingResponseQueue.shift()
        if (action === 'decline' || !chosen) return
        if (ctx.mumuMode === 'discard') {
            const equipIds = Object.values(chosen.equip).filter(Boolean).map(c => c!.id)
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_PICK_CARD,
                targetGeneralIndex: selfIdx,
                context: {
                    skillId: 'sunluyu_mumu', skillName: '穆穆',
                    description: `选择【${getGeneralName(chosen)}】装备区里的一张牌弃置`,
                    count: 1, mode: 'mumu',
                    candidateCardIds: equipIds, areaOwnerIndex: targetIdx, mumuMode: 'discard',
                },
            })
            return
        }
        const armor = chosen.equip[EquipSlot.ARMOR]
        if (!armor) return
        clearEquipSlot(state, chosen, EquipSlot.ARMOR)
        general.hand.push(armor)
        general.mumuNoSlashPhase = true
        addLog(state, `【${getGeneralName(general)}】【穆穆】获得【${getGeneralName(chosen)}】的${cardFullName(armor)}，本阶段不能使用或打出【杀】`)
        return
    }

    // ── SP蔡文姬：陈情 ──
    if (ctx.skillId === 'caiwenji_sp_chenqing') {
        state.pendingResponseQueue.shift()
        if (action === 'decline' || !chosen) return
        const n = expDrawTo(state, chosen, 4)
        const cnt = Math.min(4, chosen.hand.length)
        addLog(state, `【${getGeneralName(general)}】【陈情】令【${getGeneralName(chosen)}】摸${n}张牌`)
        state.pendingResponseQueue.unshift({
            type: ResponseType.SKILL_PICK_CARD,
            targetGeneralIndex: targetIdx as number,
            context: {
                skillId: 'caiwenji_sp_chenqing_discard', skillName: '陈情',
                description: `弃置${cnt}张牌（花色均不相同则视为对濒死角色使用【桃】）`,
                count: cnt, mode: 'discard',
                chenqingDyingIndex: ctx.chenqingDyingIndex,
                chenqingOwnerIndex: selfIdx,
            },
        })
        return
    }

    // ── SP蔡文姬：默识 ──
    if (ctx.skillId === 'caiwenji_sp_moshi_use') {
        state.pendingResponseQueue.shift()
        if (action !== 'confirm' || !chosen) return
        handleUseCardImpl(state, general.playerId, {
            cardId: ctx.moshiCardId as string,
            targetIndices: [targetIdx as number],
        } as C2S_UseCard)
        const list = general.moshiCards ?? []
        const stage = (ctx.moshiStage as number) ?? 0
        if (list[stage + 1] && general.hand.length > 0) {
            state.pendingResponseQueue.push({
                type: ResponseType.SKILL_ACTIVATE_CONFIRM,
                targetGeneralIndex: selfIdx,
                context: {
                    skillId: 'caiwenji_sp_moshi', skillName: '默识',
                    description: `将一张手牌当${list[stage + 1].name}使用`,
                    moshiStage: stage + 1, endPhaseSkill: true,
                },
            })
        }
        return
    }

    // ── 神鲁肃：榻谟 ──
    if (ctx.skillId === 'shenlusu_tamo') {
        state.pendingResponseQueue.shift()
        if (action === 'decline' || !chosen) return
        const stage = (ctx.tamoStage as number) ?? 1
        if (stage === 1) {
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_CHOOSE_TARGET,
                targetGeneralIndex: selfIdx,
                context: {
                    skillId: 'shenlusu_tamo', skillName: '榻谟',
                    description: `选择与【${getGeneralName(chosen)}】换位的角色`,
                    candidateIndices: expAliveIdx(state, g => g !== chosen),
                    tamoStage: 2, tamoPartnerIndex: targetIdx,
                },
            })
            return
        }
        const partner = state.generals[ctx.tamoPartnerIndex as number]
        if (partner && partner !== chosen) {
            const aIdx = state.generals.indexOf(partner)
            const bIdx = state.generals.indexOf(chosen)
            state.generals[aIdx] = chosen
            state.generals[bIdx] = partner
            addLog(state, `【榻谟】：【${getGeneralName(partner)}】与【${getGeneralName(chosen)}】交换座次`)
        }
        state.pendingResponseQueue.unshift({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: selfIdx,
            context: {
                skillId: 'shenlusu_tamo', skillName: '榻谟',
                description: '可以继续换位，或结束换位',
                options: [
                    { action: 'continue', label: '继续换位' },
                    { action: 'decline', label: '结束' },
                ],
            },
        })
        return
    }

    // ── 鲍信：毅谋 ──
    if (ctx.skillId === 'baoxin_yimou_give') {
        state.pendingResponseQueue.shift()
        if (action === 'decline' || !chosen) return
        const fromIdx = ctx.yimouFromIndex as number
        const from = state.generals[fromIdx]
        if (!from?.alive || from.hand.length === 0) return
        state.pendingResponseQueue.unshift({
            type: ResponseType.SKILL_PICK_CARD,
            targetGeneralIndex: fromIdx,
            context: {
                skillId: 'baoxin_yimou_give', skillName: '毅谋',
                description: `选择一张手牌交给【${getGeneralName(chosen)}】`,
                count: 1, mode: 'yimouGive', yimouToIndex: targetIdx,
            },
        })
        return
    }

    // ── 戏志才：先辅 ──
    if (ctx.skillId === 'xizhicai_xianfu') {
        state.pendingResponseQueue.shift()
        if (!chosen) return
        general.xianfuIndex = targetIdx
        addLog(state, `【${getGeneralName(general)}】【先辅】选择【${getGeneralName(chosen)}】`)
        return
    }

    // ── 曹纯：缮甲 视为使用【杀】 ──
    if (ctx.skillId === 'caochun_shanjia_slash') {
        state.pendingResponseQueue.shift()
        if (action === 'decline' || !chosen) return
        addLog(state, `【${getGeneralName(general)}】【缮甲】视为对【${getGeneralName(chosen)}】使用一张【杀】`)
        const slash = {
            id: `shanjia_${state.turnSerial}_${targetIdx}`, name: BasicCardName.ATTACK,
            suit: CardSuit.SPADE, value: 7, category: CardCategory.BASIC, virtual: true,
        } as unknown as Card
        state.pendingResponseQueue.unshift({
            type: ResponseType.DODGE,
            targetGeneralIndex: targetIdx as number,
            context: {
                attackCard: slash, attackerGeneralIndex: selfIdx,
                requiredDodges: hasSkill(general, 'lvbu_wushuang') ? 2 : 1,
                dodgesReceived: 0, virtual: true,
            },
        })
        return
    }

    // ── 戏志才：筹策（黑） ──
    if (ctx.skillId === 'xizhicai_chouce_black') {
        state.pendingResponseQueue.shift()
        if (action === 'decline' || !chosen) return
        state.pendingResponseQueue.unshift({
            type: ResponseType.TRICK_TARGET_CARD_PICK,
            targetGeneralIndex: selfIdx,
            context: {
                trickType: 'dismantle', label: '筹策',
                targetIndex: targetIdx as number,
            },
        })
        return
    }

    // ── 孙綝：戮连 对一名体力值不为最小的角色造成1点火焰伤害 ──
    if (ctx.skillId === 'sunchen_lulian') {
        if (!chosen) return { error: '请选择一名体力值不为最小的角色' }
        state.pendingResponseQueue.shift()
        addLog(state, `【${getGeneralName(general)}】【戮连】对【${getGeneralName(chosen)}】造成1点火焰伤害`)
        dealDamage(state, general, chosen, 1, undefined, { nature: 'fire' })
        return
    }

    // ── 戏志才：筹策（红） ──
    if (ctx.skillId === 'xizhicai_chouce_red') {
        state.pendingResponseQueue.shift()
        if (!chosen) return
        const isXianfuTarget = state.generals.some(g => g.alive && hasSkill(g, 'xizhicai_xianfu')
            && g.xianfuIndex === targetIdx)
        const n = expDrawTo(state, chosen, isXianfuTarget ? 2 : 1)
        addLog(state, `【${getGeneralName(general)}】【筹策】令【${getGeneralName(chosen)}】摸${n}张牌`)
        return
    }

    return EXP_UNHANDLED
}

function expGiveA(
    state: GameState,
    general: GeneralInstance,
    pending: PendingResponse,
    action: string | undefined,
    ctx: any,
    cardIds: string[],
): ExpDispatch {
    // ── 神鲁肃：定州 ──
    if (ctx.skillId === 'shenlusu_dingzhou') {
        if (action !== 'decline') {
            const need = Math.max(0, (ctx.count as number) ?? 0)
            if (need > 0 && cardIds.length !== need) return { error: `请选择 ${need} 张牌` }
        }
        state.pendingResponseQueue.shift()
        if (action === 'decline') return
        const target = state.generals[ctx.toIndex as number]
        if (!target) return
        const given: Card[] = []
        for (const id of cardIds) {
            const taken = detachCardFromHandOrEquip(state, general, id)
            if (!('error' in taken)) given.push(taken)
        }
        target.hand.push(...given)
        addLog(state, `【${getGeneralName(general)}】【定州】交给【${getGeneralName(target)}】${given.length}张牌`)
        expDingzhouTake(state, general, target)
        return
    }

    // ── 孙綝：逆固 ──
    if (ctx.skillId === 'sunchen_nigu_give') {
        state.pendingResponseQueue.shift()
        const owner = state.generals[ctx.toIndex as number]
        if (action === 'decline' || cardIds.length === 0 || !owner) {
            if (owner) {
                owner.niguBonus = (owner.niguBonus ?? 0) + 1
                addLog(state, `【${getGeneralName(general)}】不交给【${getGeneralName(owner)}】牌，其本回合下一次伤害+1`)
            }
            return
        }
        const taken = detachCardFromHandOrEquip(state, general, cardIds[0])
        if ('error' in taken) return
        owner.hand.push(taken)
        addLog(state, `【${getGeneralName(general)}】因【逆固】交给【${getGeneralName(owner)}】${cardFullName(taken)}`)
        return
    }

    return EXP_UNHANDLED
}

/** 缮甲：根据弃置的牌给予本阶段加成 */
function expApplyShanjia(state: GameState, general: GeneralInstance, discarded: Card[]): void {
    const hasBasic = discarded.some(c => c.category === CardCategory.BASIC)
    const hasTrick = discarded.some(c => c.category === CardCategory.TRICK)
    const hasNonEquip = discarded.some(c => c.category !== CardCategory.EQUIPMENT)
    const notes: string[] = []
    if (!hasBasic) {
        general.slashLimitDelta = (general.slashLimitDelta ?? 0) + 1
        notes.push('本阶段使用【杀】的次数上限+1')
    }
    if (!hasTrick) {
        general.infiniteRangePhase = true
        notes.push('本阶段使用牌无距离限制')
    }
    if (!hasNonEquip) {
        notes.push('可视为使用一张不计入次数的【杀】')
    }
    if (notes.length > 0) {
        addLog(state, `【${getGeneralName(general)}】【缮甲】：${notes.join('；')}`)
    }
    if (!hasNonEquip && state.generals.some(g => g.alive && g !== general)) {
        state.pendingResponseQueue.unshift({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: indexOfGeneral(state, general),
            context: {
                skillId: 'caochun_shanjia_slash', skillName: '缮甲',
                description: '视为使用一张不计入次数的【杀】',
                options: [{ action: 'use', label: '选择目标使用【杀】' }],
            },
        })
    }
}

/** 陈情：救回濒死角色（视为使用一张【桃】） */
function expChenqingSave(state: GameState, dying: GeneralInstance, healer: GeneralInstance): void {
    if (!dying.alive || dying.hp > 0) return
    dying.hp = Math.min(dying.maxHp, dying.hp + 1)
    addLog(state, `【${getGeneralName(healer)}】视为对【${getGeneralName(dying)}】使用一张【桃】，其回复1点体力（${dying.hp}/${dying.maxHp}）`)
    triggerXianfuHeal(state, dying, 1)
}

function expConfirmA(
    state: GameState,
    general: GeneralInstance,
    pending: PendingResponse,
    action: string | undefined,
    ctx: any,
): ExpDispatch {
    const selfIdx = indexOfGeneral(state, general)

    // ── 陈琳：笔伐（结束阶段扣置） ──
    if (ctx.skillId === 'chenlin_bifa') {
        state.pendingResponseQueue.shift()
        if (action !== 'confirm') return
        const cands = expAliveIdx(state, g => g !== general && (g.bifaCards?.length ?? 0) === 0)
        if (cands.length === 0) return
        state.pendingResponseQueue.unshift({
            type: ResponseType.SKILL_CHOOSE_TARGET,
            targetGeneralIndex: selfIdx,
            context: {
                skillId: 'chenlin_bifa', skillName: '笔伐',
                description: '选择一名没有“笔伐”牌的其他角色',
                candidateIndices: cands, bifaStage: 'target', endPhaseSkill: true,
            },
        })
        return
    }

    // ── 陈琳：笔伐（回合开始时的抉择） ──
    if (ctx.skillId === 'chenlin_bifa_start') {
        state.pendingResponseQueue.shift()
        const cardId = ctx.bifaCardId as string
        const cards = general.bifaCards ?? []
        const card = cards.find(c => c.id === cardId)
        if (!card) return
        if (action === 'give') {
            const sameCat = general.hand.filter(c => c.category === card.category)
            if (sameCat.length === 0) return
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_PICK_CARD,
                targetGeneralIndex: selfIdx,
                context: {
                    skillId: 'chenlin_bifa_start_give', skillName: '笔伐',
                    description: '选择一张同类别手牌交出', count: 1, mode: 'discard',
                    candidateCardIds: sameCat.map(c => c.id), bifaCardId: card.id,
                },
            })
            return
        }
        general.bifaCards = cards.filter(c => c.id !== card.id)
        state.discard.push(card)
        addLog(state, `【${getGeneralName(general)}】移去【笔伐】牌${cardFullName(card)}，失去1点体力`)
        loseHp(state, general, 1)
        if ((general.bifaCards?.length ?? 0) > 0) triggerBifaTurnStart(state, general)
        return
    }

    // ── 何太后：鸩毒 ──
    if (ctx.skillId === 'hetaihou_zhendu') {
        state.pendingResponseQueue.shift()
        if (action !== 'confirm') return
        askPickCard(state, general, 'hetaihou_zhendu', '鸩毒', '弃置一张手牌', {
            count: 1, mode: 'discard', extra: { zhenduTargetIndex: ctx.zhenduTargetIndex },
        })
        return
    }

    // ── 何太后：戚乱 ──
    if (ctx.skillId === 'hetaihou_qiluan') {
        state.pendingResponseQueue.shift()
        if (action !== 'confirm') return
        const n = expDrawTo(state, general, (ctx.qiluanCount as number) ?? 0)
        addLog(state, `【${getGeneralName(general)}】发动【戚乱】，摸${n}张牌`)
        return
    }

    // ── 孙鲁育：魅步 ──
    if (ctx.skillId === 'sunluyu_meibu') {
        state.pendingResponseQueue.shift()
        if (action !== 'confirm') return
        askPickCard(state, general, 'sunluyu_meibu', '魅步', '弃置一张牌', {
            count: 1, mode: 'discard', extra: { meibuTargetIndex: ctx.meibuTargetIndex },
        })
        return
    }

    // ── 孙鲁育：穆穆 ──
    if (ctx.skillId === 'sunluyu_mumu') {
        state.pendingResponseQueue.shift()
        if (action !== 'discard' && action !== 'gainArmor') return
        const cands = action === 'discard'
            ? expAliveIdx(state, g => expEquipCount(g) > 0)
            : expAliveIdx(state, g => !!g.equip[EquipSlot.ARMOR])
        if (cands.length === 0) return
        state.pendingResponseQueue.unshift({
            type: ResponseType.SKILL_CHOOSE_TARGET,
            targetGeneralIndex: selfIdx,
            context: {
                skillId: 'sunluyu_mumu', skillName: '穆穆',
                description: action === 'discard' ? '选择要弃置装备牌的角色' : '选择要获得防具牌的角色',
                candidateIndices: cands, mumuMode: action,
            },
        })
        return
    }

    // ── 曹纯：缮甲 ──
    if (ctx.skillId === 'caochun_shanjia') {
        state.pendingResponseQueue.shift()
        if (action !== 'confirm') return
        const drawn = expDrawTo(state, general, 3)
        addLog(state, `【${getGeneralName(general)}】发动【缮甲】，摸${drawn}张牌`)
        const x = (ctx.shanjiaX as number) ?? 0
        if (x > 0 && general.hand.length > 0) {
            const cnt = Math.min(x, general.hand.length)
            askPickCard(state, general, 'caochun_shanjia', '缮甲', `弃置${cnt}张牌`, {
                count: cnt, mode: 'discard', extra: { shanjiaX: cnt },
            })
        } else {
            expApplyShanjia(state, general, [])
        }
        return
    }

    // ── SP蔡文姬：陈情 ──
    if (ctx.skillId === 'caiwenji_sp_chenqing') {
        state.pendingResponseQueue.shift()
        if (action !== 'confirm') return
        general.chenqingRound = state.roundState?.roundNumber ?? 0
        const dyingIdx = ctx.chenqingDyingIndex as number
        const cands = expAliveIdx(state, g => g !== general && indexOfGeneral(state, g) !== dyingIdx)
        if (cands.length === 0) return
        state.pendingResponseQueue.unshift({
            type: ResponseType.SKILL_CHOOSE_TARGET,
            targetGeneralIndex: selfIdx,
            context: {
                skillId: 'caiwenji_sp_chenqing', skillName: '陈情',
                description: '令另一名其他角色摸四张牌并弃置四张牌',
                candidateIndices: cands, chenqingDyingIndex: dyingIdx,
            },
        })
        return
    }

    // ── SP蔡文姬：默识 ──
    if (ctx.skillId === 'caiwenji_sp_moshi') {
        state.pendingResponseQueue.shift()
        if (action !== 'confirm') return
        const stage = (ctx.moshiStage as number) ?? 0
        const list = general.moshiCards ?? []
        if (!list[stage]) return
        if (general.hand.length === 0) return
        askPickCard(state, general, 'caiwenji_sp_moshi', '默识',
            `将一张手牌当${cardDisplayName({ name: list[stage].name } as Card)}使用`,
            {
                count: 1, mode: 'moshi',
                extra: { moshiStage: stage, moshiName: list[stage].name, moshiCategory: list[stage].category },
            })
        return
    }

    return EXP_UNHANDLED
}

function expConfirmB(
    state: GameState,
    general: GeneralInstance,
    pending: PendingResponse,
    action: string | undefined,
    ctx: any,
): ExpDispatch {
    const selfIdx = indexOfGeneral(state, general)

    // ── 神鲁肃：榻谟（换位循环与结束） ──
    if (ctx.skillId === 'shenlusu_tamo') {
        state.pendingResponseQueue.shift()
        if (action === 'continue') {
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_CHOOSE_TARGET,
                targetGeneralIndex: selfIdx,
                context: {
                    skillId: 'shenlusu_tamo', skillName: '榻谟',
                    description: '选择第一名要换位的角色（换位不影响行动顺序）',
                    candidateIndices: expAliveIdx(state), tamoStage: 1,
                },
            })
            return
        }
        const x = Math.max(0, general.hp - (general.dingzhouUses ?? 0))
        addLog(state, `【${getGeneralName(general)}】【榻谟】结束换位，须失去${x}点体力`)
        if (x > 0) loseHp(state, general, x)
        return
    }

    // ── 孙綝：逆固（受影响角色选择是否交给孙綝一张牌） ──
    if (ctx.skillId === 'sunchen_nigu_give') {
        state.pendingResponseQueue.shift()
        const owner = state.generals[(ctx.niguOwnerIndex as number)]
        if (!owner?.alive) return
        if (action === 'give') {
            state.pendingResponseQueue.unshift({
                type: ResponseType.SKILL_GIVE_CARDS,
                targetGeneralIndex: selfIdx,
                context: {
                    skillId: 'sunchen_nigu_give', skillName: '逆固',
                    toIndex: indexOfGeneral(state, owner), count: 1,
                    description: '交给【' + getGeneralName(owner) + '】一张牌',
                },
            })
            return
        }
        owner.niguBonus = (owner.niguBonus ?? 0) + 1
        addLog(state, `【${getGeneralName(general)}】不交给【${getGeneralName(owner)}】牌，其本回合下一次伤害+1`)
        return
    }

    // ── 潘濬：观微 ──
    if (ctx.skillId === 'panjun_guanwei') {
        state.pendingResponseQueue.shift()
        if (action !== 'confirm') return
        askPickCard(state, general, 'panjun_guanwei', '观微', '弃置一张牌', {
            count: 1, mode: 'discard', extra: { guanweiTargetIndex: ctx.guanweiTargetIndex },
        })
        return
    }

    // ── 灵雎：竭缘（造成伤害 / 受到伤害） ──
    if (ctx.skillId === 'lingju_jieyuan_atk' || ctx.skillId === 'lingju_jieyuan_def') {
        state.pendingResponseQueue.shift()
        const atkSlot = ctx.skillId === 'lingju_jieyuan_atk'
        if (action !== 'confirm') {
            dealDamage(state, state.generals[ctx.jieyuanAttackerIndex as number],
                state.generals[ctx.jieyuanTargetIndex as number],
                ctx.jieyuanAmount as number, ctx.jieyuanCardId as string | undefined,
                { ...(ctx.jieyuanResumeOpts ?? {}), skipJieyuan: true } as any)
            return
        }
        const cands = general.hand.filter(c => atkSlot
            ? (c.suit === CardSuit.SPADE || c.suit === CardSuit.CLUB)
            : (c.suit === CardSuit.HEART || c.suit === CardSuit.DIAMOND))
        if (cands.length === 0) return
        askPickCard(state, general, ctx.skillId as string, '竭缘',
            atkSlot ? '弃置一张黑色手牌，令此伤害+1' : '弃置一张红色手牌，令此伤害-1',
            { count: 1, mode: 'discard', candidateCardIds: cands.map(c => c.id), extra: { ...ctx } })
        return
    }

    // ── 灵雎：焚心 ──
    if (ctx.skillId === 'lingju_fenxin') {
        state.pendingResponseQueue.shift()
        if (action !== 'confirm') return
        const deadIdx = ctx.fenxinDeadIndex as number
        const dead = state.generals[deadIdx]
        if (!dead) return
        const def = getGeneralById(dead.generalId)
        const skipped = ['limited', 'awakened']
        const gained: string[] = []
        for (const skill of def?.skills ?? []) {
            if (skipped.includes(String(skill.type))) continue
            if (general.acquiredSkills?.includes(skill.id)) continue
            general.acquiredSkills = [...(general.acquiredSkills ?? []), skill.id]
            gained.push(skill.name)
        }
        general.fenxinGained = true
        if (gained.length > 0) {
            addLog(state, `【${getGeneralName(general)}】发动【焚心】，获得【${def?.name ?? dead.generalId}】的技能：${gained.join('、')}`)
        }
        return
    }

    // ── 鲍信：毅谋 ──
    if (ctx.skillId === 'baoxin_yimou') {
        state.pendingResponseQueue.shift()
        const targetIdx = ctx.yimouTargetIndex as number
        const target = state.generals[targetIdx]
        if (!target?.alive) return
        if (action === 'gainSlash') {
            const deckIdx = state.deck.findIndex(c => c.name === BasicCardName.ATTACK)
            if (deckIdx >= 0) {
                const [slash] = state.deck.splice(deckIdx, 1)
                target.hand.push(slash)
                addLog(state, `【${getGeneralName(target)}】因【毅谋】从牌堆中获得【杀】`)
            } else {
                addLog(state, '【毅谋】：牌堆中没有【杀】')
            }
            return
        }
        if (action !== 'giveDraw') return
        const cands = expAliveIdx(state, g => g !== target)
        if (cands.length === 0) return
        state.pendingResponseQueue.unshift({
            type: ResponseType.SKILL_CHOOSE_TARGET,
            targetGeneralIndex: targetIdx,
            context: {
                skillId: 'baoxin_yimou_give', skillName: '毅谋',
                description: '选择获得手牌的另一名角色',
                candidateIndices: cands, yimouFromIndex: targetIdx,
            },
        })
        return
    }

    // ── 程昱：设伏（结束阶段扣置） ──
    if (ctx.skillId === 'chengyu_shefu') {
        state.pendingResponseQueue.shift()
        if (!action || action === 'decline' || action === 'confirm') return
        askPickCard(state, general, 'chengyu_shefu', '设伏',
            `扣置一张手牌作为记录【${cardDisplayName({ name: action } as Card)}】的“伏兵”`,
            { count: 1, mode: 'shefu', extra: { fubingName: action } })
        return
    }

    // ── 程昱：设伏（令他人使用的牌无效） ──
    if (ctx.skillId === 'chengyu_shefu_negate') {
        state.pendingResponseQueue.shift()
        const useData = ctx.shefuUseData as C2S_UseCard
        if (action !== 'confirm') {
            if (useData) {
                handleUseCardImpl(state, ctx.shefuUserId as string, {
                    ...useData,
                    extra: { ...(useData.extra ?? {}), shefuChecked: true },
                })
            }
            return
        }
        const fubing = general.fubing ?? []
        const idx = fubing.findIndex(f => f.name === String(ctx.shefuName))
        if (idx < 0) return
        const removed = fubing[idx]
        general.fubing = fubing.filter((_, i) => i !== idx)
        state.discard.push(removed.card)
        const user = state.generals[ctx.shefuUserIndex as number]
        if (user?.alive) {
            const cardIdx = user.hand.findIndex(c => c.id === (ctx.shefuCardId as string))
            if (cardIdx >= 0) {
                state.discard.push(user.hand.splice(cardIdx, 1)[0])
            }
        }
        expDrawTo(state, general, 1)
        addLog(state, `【${getGeneralName(general)}】发动【设伏】，移去“伏兵”令此牌无效并摸一张牌`)
        return
    }

    // ── 程昱：贲育（摸牌 / 弃牌造成伤害） ──
    if (ctx.skillId === 'chengyu_benyu_draw') {
        state.pendingResponseQueue.shift()
        if (action !== 'confirm') return
        const x = (ctx.benyuX as number) ?? 0
        const need = Math.min(5, Math.max(0, x - general.hand.length))
        if (need > 0) {
            const n = expDrawTo(state, general, need)
            addLog(state, `【${getGeneralName(general)}】发动【贲育】，摸${n}张牌`)
        }
        return
    }
    if (ctx.skillId === 'chengyu_benyu_discard') {
        state.pendingResponseQueue.shift()
        if (action !== 'confirm') return
        const need = Math.min(general.hand.length, ((ctx.benyuX as number) ?? 0) + 1)
        if (need <= 0) return
        askPickCard(state, general, 'chengyu_benyu_discard', '贲育',
            `弃置${need}张手牌，然后对伤害来源造成1点伤害`,
            { count: need, mode: 'discard', extra: { benyuSourceIndex: ctx.benyuSourceIndex } })
        return
    }

    // ── 戏志才：筹策 ──
    if (ctx.skillId === 'xizhicai_chouce') {
        state.pendingResponseQueue.shift()
        if (action !== 'confirm') return
        performSkillJudge(state, general, 'chouce', '筹策', { chouceIndex: selfIdx })
        return
    }

    // ── 刘协：天命 ──
    if (ctx.skillId === 'liuxie_tianming' || ctx.skillId === 'liuxie_tianming_other') {
        state.pendingResponseQueue.shift()
        if (action !== 'confirm') return
        const total = general.hand.length + expEquipCount(general)
        const cnt = Math.min(2, total)
        if (cnt <= 0) return
        askPickCard(state, general, ctx.skillId as string, '天命',
            `弃置${cnt}张牌（不足则全弃），然后摸两张牌`,
            { count: cnt, mode: 'discard', extra: { tianmingSelf: ctx.skillId === 'liuxie_tianming' } })
        return
    }

    // ── 李丰：屯储 ──
    if (ctx.skillId === 'lifeng_tunchu') {
        state.pendingResponseQueue.shift()
        if (action !== 'confirm') return
        const n = expDrawTo(state, general, 2)
        addLog(state, `【${getGeneralName(general)}】发动【屯储】，多摸${n}张牌`)
        if (general.hand.length > 0) {
            askPickCard(state, general, 'lifeng_tunchu', '屯储',
                '可以将任意张手牌置于武将牌上称为“粮”',
                { count: general.hand.length, mode: 'tunchu', extra: { tunchuPlace: true } })
        }
        return
    }

    // ── 李丰：输粮 ──
    if (ctx.skillId === 'lifeng_shuliang') {
        state.pendingResponseQueue.shift()
        const liang = general.liangCards ?? []
        if (action !== 'confirm' || liang.length === 0) {
            // 结束阶段的询问（无论发动与否）都必须把回合推进走，否则整局停在 TURN_END
            continueEndPhase(state)
            return
        }
        const [used] = liang.splice(0, 1)
        general.liangCards = [...liang]
        state.discard.push(used)
        const target = state.generals[ctx.shuliangTargetIndex as number]
        if (target?.alive) {
            const n = expDrawTo(state, target, 2)
            addLog(state, `【${getGeneralName(general)}】发动【输粮】，移去一张“粮”，【${getGeneralName(target)}】摸${n}张牌`)
        }
        continueEndPhase(state)
        return
    }

    // ── 沙摩柯：蒺藜 ──
    if (ctx.skillId === 'shamoke_jili') {
        state.pendingResponseQueue.shift()
        if (action !== 'confirm') return
        const n = expDrawTo(state, general, (ctx.jiliCount as number) ?? 0)
        addLog(state, `【${getGeneralName(general)}】发动【蒺藜】，摸${n}张牌`)
        return
    }

    // ── 曹纯：缮甲（视为使用一张不计次数的【杀】） ──
    if (ctx.skillId === 'caochun_shanjia_slash') {
        state.pendingResponseQueue.shift()
        if (action !== 'use' && action !== 'confirm') return
        const cands = expAliveIdx(state, g => g !== general)
        if (cands.length === 0) return
        state.pendingResponseQueue.unshift({
            type: ResponseType.SKILL_CHOOSE_TARGET,
            targetGeneralIndex: selfIdx,
            context: {
                skillId: 'caochun_shanjia_slash', skillName: '缮甲',
                description: '选择视为使用【杀】的目标',
                candidateIndices: cands, shanjiaSlash: true,
            },
        })
        return
    }

    return EXP_UNHANDLED
}

// ═════════════════════════════════════════════════════════════
// 洛书版扩展（九）：主动技能入口
// ═════════════════════════════════════════════════════════════

/** 属于本批次新增的主动技能（由 handleUseSkillImpl 转发） */
export function isExpansionActiveSkill(skillId: string): boolean {
    return [
        'chenlin_songci', 'shenlusu_tamo', 'shenlusu_dingzhou', 'sunchen_nigu',
        'peixiu_juezhi', 'baoxin_taotao', 'liuxie_mizhao',
    ].includes(skillId)
}

export function handleExpansionActiveSkill(
    state: GameState,
    general: GeneralInstance,
    data: C2S_UseSkill,
): { error: string } | void {
    const name = getGeneralName(general)
    const targets = (data.targetIndices ?? []).map(i => state.generals[i]).filter(g => g?.alive)
    const selfIdx = indexOfGeneral(state, general)
    const usedThisTurn = (id: string) => general.skillsUsedThisTurn.includes(id)

    switch (data.skillId) {
        case 'chenlin_songci': {
            if (!hasSkill(general, 'chenlin_songci')) return { error: '你没有此技能' }
            if (targets.length !== 1) return { error: '请选择一名角色' }
            const target = targets[0]
            const tIdx = indexOfGeneral(state, target)
            if (target === general) return { error: '不能选择自己' }
            const used = general.songciUsedSeats ?? []
            if (used.includes(tIdx)) return { error: '该角色已接受过【颂词】' }
            if (target.hand.length === target.hp) return { error: '目标手牌数等于体力值，无法发动【颂词】' }
            general.songciUsedSeats = [...used, tIdx]
            if (target.hand.length < target.hp) {
                const n = expDrawTo(state, target, 2)
                addLog(state, `【${name}】发动【颂词】，【${getGeneralName(target)}】摸${n}张牌`)
            } else {
                const cnt = Math.min(2, target.hand.length)
                addLog(state, `【${name}】发动【颂词】，【${getGeneralName(target)}】须弃置${cnt}张牌`)
                state.pendingResponseQueue.push({
                    type: ResponseType.SKILL_PICK_CARD,
                    targetGeneralIndex: tIdx,
                    context: {
                        skillId: 'chenlin_songci_discard', skillName: '颂词',
                        description: `弃置${cnt}张手牌`, count: cnt, mode: 'discard',
                    },
                })
            }
            return
        }

        case 'shenlusu_tamo': {
            if (!hasSkill(general, 'shenlusu_tamo')) return { error: '你没有此技能' }
            if (general.usedLimitedSkills.includes('shenlusu_tamo')) return { error: '此限定技已使用' }
            if (state.generals.filter(g => g.alive).length < 2) return { error: '角色不足，无法换位' }
            general.usedLimitedSkills.push('shenlusu_tamo')
            state.pendingResponseQueue.push({
                type: ResponseType.SKILL_CHOOSE_TARGET,
                targetGeneralIndex: selfIdx,
                context: {
                    skillId: 'shenlusu_tamo', skillName: '榻谟',
                    description: '选择第一名要换位的角色（换位不影响行动顺序）',
                    candidateIndices: expAliveIdx(state),
                    tamoStage: 1,
                },
            })
            addLog(state, `【${name}】发动【榻谟】，重新分配所有角色的座次`)
            return
        }

        case 'shenlusu_dingzhou': {
            if (!hasSkill(general, 'shenlusu_dingzhou')) return { error: '你没有此技能' }
            if (usedThisTurn('shenlusu_dingzhou')) return { error: '本回合已发动过【定州】' }
            if (targets.length !== 1) return { error: '请选择一名场上有牌的其他角色' }
            const dzTarget = targets[0]
            if (dzTarget === general) return { error: '不能选择自己' }
            const dzCount = expEquipCount(dzTarget) + dzTarget.judgeZone.length
            if (dzCount <= 0) return { error: '该角色场上没有牌' }
            if (general.hand.length < dzCount) return { error: `需要交给其${dzCount}张牌` }
            general.skillsUsedThisTurn.push('shenlusu_dingzhou')
            general.dingzhouUses = (general.dingzhouUses ?? 0) + 1
            askGiveCards(state, general, indexOfGeneral(state, dzTarget), 'shenlusu_dingzhou', '定州',
                `交给其${dzCount}张牌，然后获得其场上的所有牌`, dzCount)
            addLog(state, `【${name}】发动【定州】，须交给【${getGeneralName(dzTarget)}】${dzCount}张牌`)
            return
        }

        case 'sunchen_nigu': {
            if (!hasSkill(general, 'sunchen_nigu')) return { error: '你没有此技能' }
            if (usedThisTurn('sunchen_nigu')) return { error: '本回合已发动过【逆固】' }
            if (general.hand.length === 0) return { error: '没有手牌可弃置' }
            general.skillsUsedThisTurn.push('sunchen_nigu')
            askPickCard(state, general, 'sunchen_nigu', '逆固',
                '弃置任意张花色不同的牌（花色不能重复）',
                { count: general.hand.length, mode: 'discard', extra: { minCount: 1 } })
            addLog(state, `【${name}】发动【逆固】`)
            return
        }

        case 'peixiu_juezhi': {
            if (!hasSkill(general, 'peixiu_juezhi')) return { error: '你没有此技能' }
            if (general.hand.length < 2) return { error: '至少需要两张牌' }
            askPickCard(state, general, 'peixiu_juezhi', '爵制',
                '弃置至少两张牌（点数之和除以13的余数决定获得的牌）',
                { count: general.hand.length, mode: 'discard', extra: { minCount: 2 } })
            addLog(state, `【${name}】发动【爵制】`)
            return
        }

        case 'baoxin_taotao': {
            if (!hasSkill(general, 'baoxin_taotao')) return { error: '你没有此技能' }
            if (usedThisTurn('baoxin_taotao')) return { error: '本回合已发动过【募讨】' }
            if (targets.length !== 1) return { error: '请选择一名角色' }
            const ttTarget = targets[0]
            const slashes = ttTarget.hand.filter(c => c.name === BasicCardName.ATTACK)
            if (slashes.length === 0) return { error: '该角色手牌中没有【杀】' }
            general.skillsUsedThisTurn.push('baoxin_taotao')
            ttTarget.hand = ttTarget.hand.filter(c => c.name !== BasicCardName.ATTACK)
            const pool = shuffleInPlace([...slashes])
            const alive = state.generals.filter(g => g.alive)
            const startPos = alive.indexOf(ttTarget)
            let last: GeneralInstance | undefined
            for (let i = 0; i < pool.length; i++) {
                const receiver = alive[(startPos + 1 + i) % alive.length]
                receiver.hand.push(pool[i])
                last = receiver
            }
            addLog(state, `【${name}】发动【募讨】，将【${getGeneralName(ttTarget)}】的${pool.length}张【杀】依次随机发给其下家起的每一名角色`)
            if (last) {
                const x = Math.min(2, last.hand.filter(c => c.name === BasicCardName.ATTACK).length)
                addLog(state, `【${getGeneralName(ttTarget)}】【募讨】：最后一名角色【${getGeneralName(last)}】手中有${x}张【杀】`)
                if (x > 0) dealDamage(state, ttTarget, last, x)
            }
            return
        }

        case 'liuxie_mizhao': {
            if (!hasSkill(general, 'liuxie_mizhao')) return { error: '你没有此技能' }
            if (usedThisTurn('liuxie_mizhao')) return { error: '本回合已发动过【密诏】' }
            if (general.hand.length === 0) return { error: '至少需要一张手牌' }
            if (targets.length !== 2) return { error: '请依次选择手牌接收者与拼点对象' }
            const receiver = targets[0]
            const opponent = targets[1]
            if (receiver === general || opponent === general || receiver === opponent) {
                return { error: '接收者与拼点对象须为两名不同的其他角色' }
            }
            general.skillsUsedThisTurn.push('liuxie_mizhao')
            const hand = [...general.hand]
            general.hand = []
            receiver.hand.push(...hand)
            addLog(state, `【${name}】发动【密诏】，将所有手牌交给【${getGeneralName(receiver)}】`)
            const started = pindianStart(state, receiver, opponent, 'liuxie_mizhao', '密诏',
                { mizhaoOwnerIndex: selfIdx })
            if (!started) addLog(state, `【密诏】：拼点双方须均有手牌，拼点未能进行`)
            return
        }

        default:
            return { error: '未知技能' }
    }
}

// ── 神鲁肃 ────────────────────────────────────────────

/** 定州（神鲁肃）：把目标场上的所有牌转移到自己手中 */
function expDingzhouTake(state: GameState, owner: GeneralInstance, target: GeneralInstance): void {
    const taken: Card[] = []
    for (const slot of Object.values(EquipSlot)) {
        const card = target.equip[slot]
        if (!card) continue
        clearEquipSlot(state, target, slot)
        taken.push(card)
    }
    taken.push(...target.judgeZone.splice(0))
    for (const card of taken) {
        if (card.originalName) {
            card.name = card.originalName
            card.category = card.originalCategory ?? card.category
            delete card.originalName
            delete card.originalCategory
        }
        owner.hand.push(card)
    }
    if (taken.length > 0) {
        addLog(state, `【${getGeneralName(owner)}】【定州】获得【${getGeneralName(target)}】场上的${taken.length}张牌`)
        triggerLianying(state, target)
    }
}

// ── 潘濬 ──────────────────────────────────────────────

/** 观微（潘濬）：一名角色的出牌阶段结束时 */
export function triggerGuanwei(state: GameState, active: GeneralInstance): void {
    const suits = active.guanweiSuits ?? []
    if (suits.length < 2 || new Set(suits).size !== 1) return
    const activeIdx = indexOfGeneral(state, active)
    for (const owner of state.generals) {
        if (!owner.alive || owner === active) continue
        if (!hasSkill(owner, 'panjun_guanwei')) continue
        if (owner.guanweiTurn === state.turnSerial) continue
        if (!expHasAnyCard(owner)) continue
        askSkill(state, owner, 'panjun_guanwei', '观微',
            `弃置一张牌，令【${getGeneralName(active)}】摸两张牌并于此阶段结束后执行一个额外的出牌阶段`,
            { guanweiTargetIndex: activeIdx }, false)
        addLog(state, `【${getGeneralName(owner)}】可发动【观微】`)
    }
}

// ── 鲍信 ──────────────────────────────────────────────

/** 毅谋（鲍信）：一名角色受到伤害后，距离1以内可令其执行一项 */
export function triggerYimou(state: GameState, damaged: GeneralInstance): void {
    for (const owner of state.generals) {
        if (!owner.alive || owner === damaged) continue
        if (!hasSkill(owner, 'baoxin_yimou')) continue
        if (getAttackRange(owner, damaged, state.generals).distance > 1) continue
        askSkill(state, owner, 'baoxin_yimou', '毅谋',
            `令【${getGeneralName(damaged)}】选择一项：1.从牌堆中获得一张【杀】；2.将一张手牌交给另一名角色，然后摸一张牌`,
            {
                yimouTargetIndex: indexOfGeneral(state, damaged),
                options: [
                    { action: 'gainSlash', label: `其从牌堆中获得一张【杀】` },
                    { action: 'giveDraw', label: '其将一张手牌交给另一名角色，然后摸一张牌' },
                ],
            }, false)
        addLog(state, `【${getGeneralName(owner)}】可发动【毅谋】`)
    }
}

// ── 程昱 ──────────────────────────────────────────────

/** 设伏（程昱）：结束阶段扣置“伏兵” */
export function triggerShefu(state: GameState, general: GeneralInstance): void {
    if (!general.alive || !hasSkill(general, 'chengyu_shefu')) return
    if (general.hand.length === 0) return
    if ((general.fubing?.length ?? 0) >= 5) return
    const names: { action: string; label: string }[] = [
        { action: 'attack', label: '杀' },
        { action: 'dodge', label: '闪' },
        { action: 'peach', label: '桃' },
        { action: 'wine', label: '酒' },
        { action: 'duel', label: '决斗' },
        { action: 'dismantle', label: '过河拆桥' },
        { action: 'steal', label: '顺手牵羊' },
        { action: 'draw_two', label: '无中生有' },
        { action: 'barbarians', label: '南蛮入侵' },
        { action: 'arrows', label: '万箭齐发' },
        { action: 'peach_garden', label: '桃园结义' },
        { action: 'harvest', label: '五谷丰登' },
        { action: 'iron_chain', label: '铁索连环' },
        { action: 'negate', label: '无懈可击' },
        { action: 'borrow_sword', label: '借刀杀人' },
        { action: 'fire_attack', label: '火攻' },
    ]
    state.pendingResponseQueue.push({
        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
        targetGeneralIndex: indexOfGeneral(state, general),
        context: {
            skillId: 'chengyu_shefu', skillName: '设伏',
            description: '扣置一张手牌并记录一个非装备牌的牌名，称为“伏兵”',
            options: names,
            endPhaseSkill: true,
        },
    })
    addLog(state, `【${getGeneralName(general)}】可发动【设伏】`)
}

/** 设伏②：其他角色于你的回合外使用牌时，可令此牌无效 */
function expShefuNegateAvailable(state: GameState, user: GeneralInstance, card: Card): boolean {
    if (state.activeGeneralIndex === indexOfGeneral(state, user)) return false
    for (const owner of state.generals) {
        if (!owner.alive || owner === user) continue
        if (!hasSkill(owner, 'chengyu_shefu')) continue
        const idx = (owner.fubing ?? []).findIndex(f => f.name === String(card.name))
        if (idx < 0) continue
        state.pendingResponseQueue.unshift({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: indexOfGeneral(state, owner),
            context: {
                skillId: 'chengyu_shefu_negate', skillName: '设伏',
                description: `移去一张“伏兵”，令【${getGeneralName(user)}】使用的${cardFullName(card)}无效，然后摸一张牌`,
                shefuUserIndex: indexOfGeneral(state, user),
                shefuCardId: card.id,
                shefuName: String(card.name),
                shefuUsedData: true,
            },
        })
        addLog(state, `【${getGeneralName(owner)}】可发动【设伏】令此牌无效`)
        return true
    }
    return false
}

// ── 戏志才 ────────────────────────────────────────────

/** 先辅（戏志才）：首次回合开始时选择一名其他角色 */
export function triggerXianfuChoose(state: GameState, general: GeneralInstance): boolean {
    if (!general.alive || !hasSkill(general, 'xizhicai_xianfu')) return false
    if (general.xianfuIndex !== undefined) return false
    const cands = expAliveIdx(state, g => g !== general)
    if (cands.length === 0) return false
    state.pendingResponseQueue.push({
        type: ResponseType.SKILL_CHOOSE_TARGET,
        targetGeneralIndex: indexOfGeneral(state, general),
        context: {
            skillId: 'xizhicai_xianfu', skillName: '先辅',
            description: '选择一名其他角色：其受到伤害后你受到等量伤害，其回复体力后你回复等量体力',
            candidateIndices: cands,
            xianfuChoose: true,
        },
    })
    addLog(state, `【${getGeneralName(general)}】发动【先辅】，选择一名其他角色`)
    return true
}

/** 先辅：目标受到伤害后 */
export function triggerXianfuDamage(state: GameState, damaged: GeneralInstance, amount: number): void {
    for (const owner of state.generals) {
        if (!owner.alive || owner === damaged) continue
        if (!hasSkill(owner, 'xizhicai_xianfu')) continue
        if (owner.xianfuIndex !== indexOfGeneral(state, damaged)) continue
        addLog(state, `【${getGeneralName(owner)}】【先辅】：【${getGeneralName(damaged)}】受到${amount}点伤害，其失去等量体力`)
        loseHp(state, owner, amount)
    }
}

/** 先辅：目标回复体力后 */
export function triggerXianfuHeal(state: GameState, healed: GeneralInstance, amount: number): void {
    if (amount <= 0) return
    for (const owner of state.generals) {
        if (!owner.alive || owner === healed) continue
        if (!hasSkill(owner, 'xizhicai_xianfu')) continue
        if (owner.xianfuIndex !== indexOfGeneral(state, healed)) continue
        owner.hp = Math.min(owner.maxHp, owner.hp + amount)
        addLog(state, `【${getGeneralName(owner)}】【先辅】：【${getGeneralName(healed)}】回复${amount}点体力，其回复等量体力（${owner.hp}/${owner.maxHp}）`)
    }
}

// ── 李丰 ──────────────────────────────────────────────

/** 屯储（李丰）：摸牌阶段 */
export function triggerTunchu(state: GameState, general: GeneralInstance): void {
    if (!general.alive || !hasSkill(general, 'lifeng_tunchu')) return
    if ((general.liangCards?.length ?? 0) > 0) return
    askSkill(state, general, 'lifeng_tunchu', '屯储',
        '多摸两张牌，然后可以将任意张手牌置于武将牌上称为“粮”（有“粮”时不能使用【杀】）', { tunchuDraw: true }, false)
    addLog(state, `【${getGeneralName(general)}】可发动【屯储】`)
}

/** 输粮（李丰）：一名角色的结束阶段 */
export function triggerShuliang(state: GameState, ending: GeneralInstance): void {
    if (!ending.alive || ending.hand.length >= ending.hp) return
    for (const owner of state.generals) {
        if (!owner.alive) continue
        if (!hasSkill(owner, 'lifeng_shuliang')) continue
        if ((owner.liangCards?.length ?? 0) === 0) continue
        askSkill(state, owner, 'lifeng_shuliang', '输粮',
            `移去一张“粮”，令【${getGeneralName(ending)}】摸两张牌`,
            { shuliangTargetIndex: indexOfGeneral(state, ending), endPhaseSkill: true }, false)
        addLog(state, `【${getGeneralName(owner)}】可发动【输粮】`)
    }
}

// ═════════════════════════════════════════════════════════════

/** 焚心（灵雎）：被你杀死的角色亮出身份牌前，可获得其武将牌上的技能 */
export function triggerLingjuFenxin(
    state: GameState,
    killer: GeneralInstance | null,
    dead: GeneralInstance,
): void {
    if (!killer || killer === dead || !killer.alive) return
    if (!hasSkill(killer, 'lingju_fenxin')) return
    if (killer.fenxinGained) return
    const skip = ['limited', 'awakened', 'mission', 'lord']
    const usable = (getGeneralById(dead.generalId)?.skills ?? [])
        .filter(s => !skip.includes(String(s.type)))
        .filter(s => !(killer.acquiredSkills ?? []).includes(s.id))
    if (usable.length === 0) return
    state.pendingResponseQueue.push({
        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
        targetGeneralIndex: state.generals.indexOf(killer),
        context: {
            skillId: 'lingju_fenxin', skillName: '焚心',
            description: `获得【${getGeneralName(dead)}】的技能：${usable.map(s => s.name).join('、')}`,
            fenxinDeadIndex: state.generals.indexOf(dead),
        },
    })
    addLog(state, `【${getGeneralName(killer)}】可发动【焚心】`)
}

const SUIT_SYMBOL: Record<string, string> = {
    [CardSuit.SPADE]: '♠', [CardSuit.HEART]: '♥',
    [CardSuit.CLUB]: '♣', [CardSuit.DIAMOND]: '♦',
}

/** 取走判定区内的一张牌（默认第一张） */
function takeJudgeCardOf(state: GameState, owner: GeneralInstance, cardId?: string): Card | undefined {
    const idx = cardId ? owner.judgeZone.findIndex(c => c.id === cardId) : 0
    if (idx < 0 || !owner.judgeZone[idx]) return undefined
    const [card] = owner.judgeZone.splice(idx, 1)
    state.discard.push(card)
    return card
}

/** 把一张牌当延时锦囊放入目标判定区 */
function putDelayedTrickAs(
    state: GameState, target: GeneralInstance, card: Card, name: TrickCardName, text: string,
): void {
    const converted = {
        ...card,
        name,
        category: CardCategory.TRICK,
        trickType: TrickType.DELAYED,
        originalName: card.name,
        originalCategory: card.category,
    } as unknown as Card
    target.judgeZone.push(converted)
    addLog(state, text)
}

/** 慎断（韩浩史涣）：黑色基本牌因弃置进入弃牌堆时，可当无距离限制的【兵粮寸断】使用 */
export function triggerShenduan(state: GameState, general: GeneralInstance, discarded: Card[]): void {
    if (!general.alive || !hasSkill(general, 'hanhaosihuan_shenduan')) return
    if (state.pendingResponseQueue.some(p => (p.context as any)?.skillId === 'hanhaosihuan_shenduan')) return
    const black = discarded.find(c => (c.suit === CardSuit.SPADE || c.suit === CardSuit.CLUB)
        && c.category !== CardCategory.TRICK)
    if (!black) return
    askSkill(state, general, 'hanhaosihuan_shenduan', '慎断',
        `将${cardFullName(black)}当【兵粮寸断】使用（无距离限制）`,
        { shenduanCardId: black.id }, false)
    addLog(state, `【${getGeneralName(general)}】可发动【慎断】`)
}

/**
 * 激昂②（界孙策）：每回合首次有【决斗】或红色【杀】因弃置进入弃牌堆后，
 * 孙策可失去1点体力并获得之
 */
export function triggerJiangJieDiscard(state: GameState, cards: Card[]): void {
    const target = cards.find(c => c.name === TrickCardName.DUEL
        || (c.name === BasicCardName.ATTACK
            && (c.suit === CardSuit.HEART || c.suit === CardSuit.DIAMOND)))
    if (!target) return
    if (!state.discard.some(c => c.id === target.id)) return
    for (const owner of state.generals) {
        if (!owner.alive || owner.generalId !== 'sunce_jie') continue
        if (!hasSkill(owner, 'sunce_jiang')) continue
        if (owner.jiangJieTurn !== undefined && owner.jiangJieTurn === state.turnSerial) continue
        owner.jiangJieTurn = state.turnSerial
        askSkill(state, owner, 'sunce_jiang_jie', '激昂',
            `失去1点体力，获得${cardFullName(target)}`,
            { jiangJieCardId: target.id })
        addLog(state, `【${getGeneralName(owner)}】可发动【激昂】获得${cardFullName(target)}`)
    }
}

/**
 * 纵玄（界虞翻）：自己的牌因弃置进入弃牌堆时，或上家的牌每回合第一次因弃置进入弃牌堆时，
 * 可以将其中任意张牌置于牌堆顶。cards 必须已经进入 state.discard。
 */
export function maybeZongxuan(state: GameState, discarder: GeneralInstance | undefined, cards: Card[]): void {
    if (!discarder || cards.length === 0) return
    const ids = cards.filter((c) => state.discard.some((d) => d.id === c.id)).map((c) => c.id)
    if (ids.length === 0) return
    const discarderIdx = state.generals.indexOf(discarder)
    if (discarderIdx < 0) return
    const aliveSeats = state.generals.map((g, i) => ({ g, i })).filter(({ g }) => g.alive)
    for (const [idx, owner] of state.generals.entries()) {
        if (!owner.alive || !hasSkill(owner, 'yufan_zongxuan')) continue
        if (idx !== discarderIdx) {
            const pos = aliveSeats.findIndex(({ i }) => i === idx)
            if (pos < 0) continue
            const prevSeat = aliveSeats[(pos - 1 + aliveSeats.length) % aliveSeats.length]
            if (prevSeat.i !== discarderIdx) continue
            // 上家的牌每回合只问一次
            if (owner.zongxuanUpstreamTurn !== undefined
                && owner.zongxuanUpstreamTurn === state.turnSerial) continue
            owner.zongxuanUpstreamTurn = state.turnSerial
        }
        const existing = state.pendingResponseQueue.find((p) => p.type === ResponseType.SKILL_PICK_CARD
            && (p.context as any)?.skillId === 'yufan_zongxuan' && p.targetGeneralIndex === idx)
        if (existing) {
            const ctx = existing.context as any
            const merged: string[] = [...new Set([...(ctx.candidateCardIds ?? []), ...ids])]
            ctx.candidateCardIds = merged
            ctx.count = merged.length
            continue
        }
        state.pendingResponseQueue.push({
            type: ResponseType.SKILL_PICK_CARD,
            targetGeneralIndex: idx,
            context: {
                skillId: 'yufan_zongxuan',
                skillName: '纵玄',
                description: '将其中任意张牌置于牌堆顶',
                candidateCardIds: [...ids],
                count: ids.length,
            },
        })
        addLog(state, `【${getGeneralName(owner)}】可发动【纵玄】`)
    }
}

/** 勇略（韩浩史涣）：其他角色的判定阶段开始时入队询问 */
export function triggerYonglueQueue(state: GameState, judging: GeneralInstance): boolean {
    const judgingIdx = state.generals.indexOf(judging)
    let queued = false
    for (const owner of state.generals) {
        if (!owner.alive || owner === judging) continue
        if (!hasSkill(owner, 'hanhaosihuan_yonglue')) continue
        if (judging.judgeZone.length === 0) continue
        askSkill(state, owner, 'hanhaosihuan_yonglue', '勇略',
            `弃置【${getGeneralName(judging)}】判定区的一张牌；若其在你攻击范围内，你摸一张牌，否则视为对其使用一张【杀】`,
            { yonglueOwnerIndex: state.generals.indexOf(owner), yonglueTargetIndex: judgingIdx }, false)
        addLog(state, `【${getGeneralName(owner)}】可发动【勇略】`)
        queued = true
    }
    return queued
}

/** 勇略：弃置判定牌后视为使用【杀】 */
export function resolveYonglueAttack(state: GameState, ownerIdx: number, targetIdx: number): void {
    const owner = state.generals[ownerIdx]
    const target = state.generals[targetIdx]
    if (!owner?.alive || !target?.alive) return
    const removed = takeJudgeCardOf(state, target)
    if (removed) {
        addLog(state, `【${getGeneralName(owner)}】发动【勇略】，弃置【${getGeneralName(target)}】判定区的${cardFullName(removed)}`)
    }
    if (getAttackRange(owner, target, state.generals).inRange) {
        const drawn = drawForGeneral(state, owner, 1)
        owner.hand.push(...drawn)
        addLog(state, `【${getGeneralName(owner)}】【勇略】：【${getGeneralName(target)}】在其攻击范围内，摸${drawn.length}张牌`)
        return
    }
    owner.yonglueWatchIndex = targetIdx
    owner.yonglueTurn = state.turnSerial
    const res = useVirtualSlash(state, owner, targetIdx, { noRange: true, label: '【勇略】' })
    if (res && 'error' in res) {
        owner.yonglueWatchIndex = undefined
        owner.yonglueTurn = undefined
    }
}

/** 绝境（神赵云）：进入/脱离濒死状态时摸一张牌 */
export function triggerJuejing(state: GameState, general: GeneralInstance, phase: 'enter' | 'leave'): void {
    if (!general.alive || !hasSkill(general, 'shenzhaoyun_juejing')) return
    if (phase === 'enter') {
        if (general.juejingDying) return
        general.juejingDying = true
    } else {
        if (!general.juejingDying) return
        general.juejingDying = false
    }
    const drawn = drawForGeneral(state, general, 1)
    general.hand.push(...drawn)
    addLog(state, `【${getGeneralName(general)}】发动【绝境】，摸${drawn.length}张牌`)
}

/** 镇胆②（闪赵云）：受伤后或轮末摸X张牌，然后本轮此技能失效 */
export function triggerZhendanDraw(state: GameState, general: GeneralInstance): void {
    if (!general.alive || !hasSkill(general, 'shanzhaoyun_zhendan')) return
    const round = state.roundState?.roundNumber ?? 0
    if (general.zhendanDisabledRound === round) return
    if (state.pendingResponseQueue.some(p => (p.context as any)?.skillId === 'shanzhaoyun_zhendan_draw')) return
    const x = Math.max(1, Math.min(5, state.roundState?.turnsThisRound ?? 1))
    askSkill(state, general, 'shanzhaoyun_zhendan_draw', '镇胆',
        `摸${x}张牌，然后本轮此技能失效`, { zhendanDrawCount: x }, false)
    addLog(state, `【${getGeneralName(general)}】可发动【镇胆】摸牌`)
}

/** 龙临（闪赵云）：其他角色于其出牌阶段内第一次使用【杀】指定目标后 */
export function triggerLonglin(state: GameState, user: GeneralInstance, card: Card): void {
    const owner = state.generals.find(g => g.alive && g !== user && hasSkill(g, 'shanzhaoyun_longlin'))
    if (!owner) return
    if (user.longlinUsedSerial === state.turnSerial) return
    if (owner.hand.length === 0) return
    user.longlinUsedSerial = state.turnSerial
    askSkill(state, owner, 'shanzhaoyun_longlin', '龙临',
        `弃置一张牌，令【${getGeneralName(user)}】的【杀】无效；然后其可以视为对你使用一张【决斗】`,
        { longlinUserIndex: state.generals.indexOf(user), attackCardId: card.id }, false)
    addLog(state, `【${getGeneralName(owner)}】可发动【龙临】`)
}

/** 慷忾（曹昂）：一名角色成为【杀】的目标后，距离1以内可摸一并交给其一张牌 */
export function triggerKangkai(state: GameState, attacker: GeneralInstance, target: GeneralInstance): void {
    const targetIdx = state.generals.indexOf(target)
    for (const kk of state.generals) {
        if (!kk.alive || kk === attacker || kk === target) continue
        if (!hasSkill(kk, 'caoang_kangkai')) continue
        if (kk.kangkaiSlashTurn === state.turnSerial) continue
        if (getAttackRange(kk, target, state.generals).distance > 1) continue
        kk.kangkaiSlashTurn = state.turnSerial
        askSkill(state, kk, 'caoang_kangkai', '慷忾',
            `摸一张牌，然后交给【${getGeneralName(target)}】一张牌并展示（若为装备牌其可使用）`,
            { kangkaiTargetIndex: targetIdx }, false)
        addLog(state, `【${getGeneralName(kk)}】可发动【慷忾】`)
    }
}

/** 谏征（秦宓）：其他角色使用【杀】指定目标时 */
export function triggerJianzheng(
    state: GameState, attacker: GeneralInstance, card: Card, targets: GeneralInstance[],
): void {
    for (const qm of state.generals) {
        if (!qm.alive || qm === attacker) continue
        if (!hasSkill(qm, 'qinmi_jianzheng')) continue
        if (targets.includes(qm)) continue
        if (qm.hand.length === 0) continue
        if (qm.jianzhengTurn === state.turnSerial) continue
        if (!getAttackRange(attacker, qm, state.generals).inRange) continue
        qm.jianzhengTurn = state.turnSerial
        const blackSlash = card.suit === CardSuit.SPADE || card.suit === CardSuit.CLUB
        askSkill(state, qm, 'qinmi_jianzheng', '谏征',
            '将一张手牌置于牌堆顶，取消此【杀】的所有目标'
            + (blackSlash ? '' : '，然后你成为此【杀】的目标'),
            { jianzhengAttackerIndex: state.generals.indexOf(attacker), attackCardId: card.id, attackCard: card }, false)
        addLog(state, `【${getGeneralName(qm)}】可发动【谏征】`)
    }
}

/** 移除某张【杀】对某目标的响应询问（用于“此杀无效”类效果） */
function dropSlashDodgePrompts(state: GameState, cardId: string, targetIdx: number): boolean {
    const before = state.pendingResponseQueue.length
    state.pendingResponseQueue = state.pendingResponseQueue.filter(p => !(
        p.type === ResponseType.DODGE && p.targetGeneralIndex === targetIdx
        && (p.context as any)?.attackCard?.id === cardId))
    return state.pendingResponseQueue.length !== before
}

/** 天辩（秦宓）：拼点牌♥时点数视为K */
export function tianbianValue(general: GeneralInstance, card: Card): number {
    if (!hasSkill(general, 'qinmi_tianbian')) return card.value ?? 0
    if (card.suit === CardSuit.HEART) return 13
    return card.value ?? 0
}

/** 下书（阚泽）：出牌阶段开始时询问 */
export function triggerXiashu(state: GameState, general: GeneralInstance): void {
    if (!general.alive || !hasSkill(general, 'kanze_xiashu')) return
    if (general.hand.length === 0) return
    if (general.xiashuTurn === state.turnSerial) return
    general.xiashuTurn = state.turnSerial
    askSkill(state, general, 'kanze_xiashu', '下书',
        '将所有手牌交给一名其他角色，令其展示任意张手牌，然后你获得其展示的或未展示的手牌', {})
    addLog(state, `【${getGeneralName(general)}】可发动【下书】`)
}

/** 宽释（阚泽）：结束阶段选择一名角色，其下一次受到大于1点的伤害被防止 */
export function triggerKuanshi(state: GameState, general: GeneralInstance): void {
    if (!general.alive || !hasSkill(general, 'kanze_kuanshi')) return
    const cands = state.generals.map((g, i) => ({ g, i })).filter(({ g }) => g.alive).map(({ i }) => i)
    state.pendingResponseQueue.push({
        type: ResponseType.SKILL_CHOOSE_TARGET,
        targetGeneralIndex: state.generals.indexOf(general),
        context: {
            skillId: 'kanze_kuanshi', skillName: '宽释',
            description: '选择一名角色：直到你的下个回合开始，其下一次受到大于1点的伤害被防止，然后你跳过下个摸牌阶段',
            candidateIndices: cands, endPhaseSkill: true,
        },
    })
}

/** 宽释的伤害防止（dealDamage 前置检查） */
export function checkKuanshiPrevent(state: GameState, target: GeneralInstance, amount: number): boolean {
    const srcIdx = target.kuanshiSourceIndex
    if (srcIdx === undefined || amount <= 1) return false
    target.kuanshiSourceIndex = undefined
    const src = state.generals[srcIdx]
    if (src?.alive) src.skipDrawNextTurn = true
    addLog(state, `【宽释】防止了【${getGeneralName(target)}】受到的${amount}点伤害`
        + (src?.alive ? `，【${getGeneralName(src)}】将跳过下个摸牌阶段` : ''))
    return true
}

/** 清正（界曹操）：出牌阶段开始时询问 */
export function triggerQingzheng(state: GameState, general: GeneralInstance): void {
    if (!general.alive || !hasSkill(general, 'caocao_jie_qingzheng')) return
    if (isLimitedSkillSpent(general, 'caocao_jie_qingzheng')) return
    if (general.hand.length === 0) return
    const suits = [...new Set(general.hand.map(c => c.suit))] as CardSuit[]
    const targetCands = state.generals
        .map((g, i) => ({ g, i }))
        .filter(({ g, i }) => g.alive && i !== state.generals.indexOf(general) && g.hand.length > 0)
        .map(({ i }) => i)
    if (suits.length === 0 || targetCands.length === 0) return
    askSkill(state, general, 'caocao_jie_qingzheng', '清正',
        '弃置手牌中一种花色的所有牌，并观看一名其他角色的手牌，弃置其中一种花色的所有牌',
        {
            qingzhengSuits: suits,
            options: suits.map(s => ({
                action: s,
                label: `弃置手牌中所有${SUIT_SYMBOL[s] ?? s}牌`,
            })),
        })
}

/** 述志（界曹操）：游戏开始时，将【清正】或【奸雄】之一修改为限定技 */
export function triggerShuzhiChoose(state: GameState): void {
    for (let i = 0; i < state.generals.length; i++) {
        const general = state.generals[i]
        if (!general.alive || !hasSkill(general, 'caocao_jie_shuzhi') || general.shuzhiLimited) continue
        state.pendingResponseQueue.push({
            type: ResponseType.SKILL_ACTIVATE_CONFIRM,
            targetGeneralIndex: i,
            context: {
                skillId: 'caocao_jie_shuzhi',
                skillName: '述志',
                description: '选择【清正】或【奸雄】之一修改为限定技',
                options: [
                    { action: 'qingzheng', label: '修改【清正】为限定技' },
                    { action: 'jianxiong', label: '修改【奸雄】为限定技' },
                ],
                mandatory: true,
                shuzhiStart: true,
            },
        })
        addLog(state, `【${getGeneralName(general)}】发动【述志】，选择修改为限定技的技能`)
    }
}

/** 励战（曹仁）：结束阶段结束时，令任意名已受伤的角色各摸一张牌 */
export function triggerLizhan(state: GameState, general: GeneralInstance): void {
    if (!general.alive || !hasSkill(general, 'caoren_lizhan')) return
    if (general.lizhanTurn === state.turnSerial) return
    const wounded = state.generals
        .map((g, i) => ({ g, i }))
        .filter(({ g }) => g.alive && g.hp < g.maxHp)
        .map(({ i }) => i)
    if (wounded.length === 0) return
    general.lizhanTurn = state.turnSerial
    state.pendingResponseQueue.push({
        type: ResponseType.SKILL_CHOOSE_TARGET,
        targetGeneralIndex: state.generals.indexOf(general),
        context: {
            skillId: 'caoren_lizhan', skillName: '励战',
            description: '令任意名已受伤的角色各摸一张牌',
            candidateIndices: wounded, multi: true, endPhaseSkill: true,
        },
    })
    addLog(state, `【${getGeneralName(general)}】可发动【励战】`)
}
// ═════════════════════════════════════════════════════════════
// 洛书版扩展（九）：新增武将技能
// ═════════════════════════════════════════════════════════════

/** 统一返回值：EXP_UNHANDLED 表示该技能不属于本组处理范围 */
const EXP_UNHANDLED = Symbol('exp-unhandled')
type ExpResult = { error: string } | void
type ExpDispatch = ExpResult | typeof EXP_UNHANDLED

function expAliveIdx(state: GameState, filter?: (g: GeneralInstance) => boolean): number[] {
    return state.generals
        .map((g, i) => ({ g, i }))
        .filter(({ g }) => g.alive && (!filter || filter(g)))
        .map(({ i }) => i)
}

function expDrawTo(state: GameState, general: GeneralInstance, count: number): number {
    const drawn = drawForGeneral(state, general, count)
    general.hand.push(...drawn)
    return drawn.length
}

function expAttackRange(state: GameState, general: GeneralInstance): number {
    const other = state.generals.find((g) => g !== general) ?? general
    return getAttackRange(general, other, state.generals).range
}

function expCategoryName(category: CardCategory): string {
    if (category === CardCategory.BASIC) return '基本牌'
    if (category === CardCategory.TRICK) return '锦囊牌'
    return '装备牌'
}

function expEquipCount(general: GeneralInstance): number {
    return Object.values(general.equip).filter(Boolean).length
}

function expHasAnyCard(general: GeneralInstance): boolean {
    return general.hand.length > 0 || expEquipCount(general) > 0
}

/** 止息 / 屯储：判断此牌能否使用 */
export function expansionCardUseBlocked(general: GeneralInstance, card?: Card): string | undefined {
    if (general.zhixiPhase || general.meibuZhixi) return '【止息】：本阶段不能再使用牌'
    if ((general.liangCards?.length ?? 0) > 0 && card?.name === BasicCardName.ATTACK) {
        return '【屯储】：武将牌上有“粮”，不能使用【杀】'
    }
    return undefined
}

/** 行图（裴秀）：使用前判断是否无次数限制（倍数） */
export function expansionXingtuFree(general: GeneralInstance, card: Card): boolean {
    if (!hasSkill(general, 'peixiu_xingtu')) return false
    const prev = general.xingtuLastPoint
    if (prev === undefined || prev <= 0 || card.value <= 0) return false
    if (prev % card.value === 0) return false
    if (card.value % prev === 0) {
        general.xingtuFreeCardId = card.id
        return true
    }
    return false
}

/** 使用或打出一张牌后的触发（行图 / 蒺藜 / 止息 / 戮连 / 默识） */
export function noteExpansionCardUsed(
    state: GameState,
    general: GeneralInstance,
    card: Card,
    targetIndices: number[] = [],
    attackRange?: number,
): void {
    if (!general.alive) return
    const selfIdx = indexOfGeneral(state, general)
    const isActive = state.activeGeneralIndex === selfIdx
    general.cardsUsedTurnCount = (general.cardsUsedTurnCount ?? 0) + 1
    if (isActive) general.cardsUsedPhaseCount = (general.cardsUsedPhaseCount ?? 0) + 1

    // 默识（SP蔡文姬）：记录出牌阶段使用的第一/第二张基本牌或普通锦囊
    if (hasSkill(general, 'caiwenji_sp_moshi') && isActive && state.turnPhase === TurnPhase.ACTION
        && (card.category === CardCategory.BASIC || card.category === CardCategory.TRICK)) {
        const list = general.moshiCards ?? []
        if (list.length < 2) {
            general.moshiCards = [...list, { name: String(card.name), category: String(card.category) }]
        }
    }

    // 行图（裴秀）
    if (hasSkill(general, 'peixiu_xingtu') && card.value > 0) {
        const prev = general.xingtuLastPoint
        if (prev !== undefined && prev > 0) {
            if (prev % card.value === 0) {
                const n = expDrawTo(state, general, 1)
                addLog(state, `【${getGeneralName(general)}】【行图】${card.value} 是 ${prev} 的约数，摸${n}张牌`)
            } else if (card.value % prev === 0) {
                addLog(state, `【${getGeneralName(general)}】【行图】${card.value} 是 ${prev} 的倍数，此牌无次数限制`)
            }
        }
        general.xingtuLastPoint = card.value
        if (general.xingtuFreeCardId === card.id) general.xingtuFreeCardId = undefined
    }

    // 蒺藜（沙摩柯）：一回合内使用或打出的第X张牌（X为攻击范围）
    if (hasSkill(general, 'shamoke_jili')) {
        // 装备牌会立刻改变自己的攻击范围，必须用“使用这张牌时”的范围
        const range = attackRange ?? expAttackRange(state, general)
        if (range > 0 && general.cardsUsedTurnCount === range) {
            const cnt = range
            askSkill(state, general, 'shamoke_jili', '蒺藜',
                `你本回合使用或打出的第${cnt}张牌：摸${cnt}张牌`, { jiliCount: cnt }, false)
            addLog(state, `【${getGeneralName(general)}】可发动【蒺藜】`)
        }
    }


    // 戮连（孙綝）：使用手牌中某类别的最后一张牌结算完成后
    // ①有目标体力值不大于你 → 此牌的全部目标进入连环状态；②有目标装备区牌数不大于你 → 你摸一张牌
    // 两项都成立时，由你选择一名体力值不为最小的角色，对其造成1点火焰伤害
    if (hasSkill(general, 'sunchen_lulian') && targetIndices.length > 0
        && !general.hand.some(c => c.category === card.category)) {
        const lulianTargets = targetIndices
            .map(i => state.generals[i])
            .filter(g => g?.alive)
        const hpOk = lulianTargets.some(g => g.hp <= general.hp)
        const equipOk = lulianTargets.some(g => expEquipCount(g) <= expEquipCount(general))
        if (hpOk) {
            for (const g of lulianTargets) {
                if (!g.chained) chainGeneral(state, g, '戮连')
            }
            addLog(state, `【${getGeneralName(general)}】【戮连】：此牌的所有目标进入连环状态`)
        }
        if (equipOk) {
            expDrawTo(state, general, 1)
            addLog(state, `【${getGeneralName(general)}】【戮连】：摸一张牌`)
        }
        if (hpOk && equipOk) {
            const minHp = Math.min(...state.generals.filter(g => g.alive).map(g => g.hp))
            const victims = expAliveIdx(state, g => g.hp > minHp)
            if (victims.length > 0) {
                state.pendingResponseQueue.push({
                    type: ResponseType.SKILL_CHOOSE_TARGET,
                    targetGeneralIndex: selfIdx,
                    context: {
                        skillId: 'sunchen_lulian', skillName: '戮连',
                        description: '对一名体力值不为最小的角色造成1点火焰伤害',
                        candidateIndices: victims, mandatory: true,
                    },
                })
                addLog(state, `【${getGeneralName(general)}】【戮连】：选择一名体力值不为最小的角色`)
            }
        }
    }

    // 止息（孙鲁育 / 魅步授予）：第X张牌后或锦囊牌结算后，本阶段不能再使用牌
    const hasZhixi = hasSkill(general, 'sunluyu_zhixi') || !!general.meibuZhixi
    if (hasZhixi && isActive && state.turnPhase === TurnPhase.ACTION) {
        const used = general.cardsUsedPhaseCount ?? 0
        if (used >= general.hp || card.category === CardCategory.TRICK) {
            if (!general.zhixiPhase) {
                general.zhixiPhase = true
                addLog(state, `【${getGeneralName(general)}】【止息】：本阶段不能再使用牌`)
            }
        }
    }
}

// ── 陈琳 ──────────────────────────────────────────────

/** 笔伐（陈琳）：结束阶段扣置一张手牌 */
export function triggerBifa(state: GameState, general: GeneralInstance): void {
    if (!general.alive || !hasSkill(general, 'chenlin_bifa')) return
    if (general.hand.length === 0) return
    const selfIdx = indexOfGeneral(state, general)
    const cands = expAliveIdx(state, g => indexOfGeneral(state, g) !== selfIdx && (g.bifaCards?.length ?? 0) === 0)
    if (cands.length === 0) return
    askSkill(state, general, 'chenlin_bifa', '笔伐',
        '将一张手牌扣置于一名没有“笔伐”牌的其他角色武将牌上', { endPhaseSkill: true })
    addLog(state, `【${getGeneralName(general)}】可发动【笔伐】`)
}

/** 笔伐：有“笔伐”牌的角色回合开始时处理 */
export function triggerBifaTurnStart(state: GameState, general: GeneralInstance): boolean {
    const cards = general.bifaCards ?? []
    if (cards.length === 0) return false
    const card = cards[0]
    const source = state.generals[general.bifaSourceIndex ?? -1]
    const sameCat = general.hand.filter(c => c.category === card.category)
    const options: { action: string; label: string }[] = []
    if (source?.alive && sameCat.length > 0) {
        options.push({
            action: 'give',
            label: `交给【${getGeneralName(source)}】一张${expCategoryName(card.category)}手牌，获得此牌`,
        })
    }
    options.push({ action: 'loseHp', label: '移去此牌，失去1点体力' })
    state.pendingResponseQueue.unshift({
        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
        targetGeneralIndex: indexOfGeneral(state, general),
        context: {
            skillId: 'chenlin_bifa_start', skillName: '笔伐',
            description: `观看【笔伐】牌：${cardFullName(card)}（${expCategoryName(card.category)}）`,
            bifaCardId: card.id,
            options,
        },
    })
    addLog(state, `【${getGeneralName(general)}】的【笔伐】牌生效：${cardFullName(card)}`)
    return true
}

// ── 何太后 ────────────────────────────────────────────

/** 鸩毒（何太后）：一名角色出牌阶段开始时 */
export function triggerZhendu(state: GameState, active: GeneralInstance): void {
    const activeIdx = indexOfGeneral(state, active)
    for (const owner of state.generals) {
        if (!owner.alive || owner === active) continue
        if (!hasSkill(owner, 'hetaihou_zhendu')) continue
        if (owner.hand.length === 0) continue
        askSkill(state, owner, 'hetaihou_zhendu', '鸩毒',
            `弃置一张手牌，令【${getGeneralName(active)}】视为使用一张【酒】，然后你对其造成1点伤害`,
            { zhenduTargetIndex: activeIdx }, false)
        addLog(state, `【${getGeneralName(owner)}】可发动【鸩毒】`)
    }
}

/** 戚乱（何太后）：一名角色的回合结束时 */
export function triggerQiluan(state: GameState, _ending: GeneralInstance): void {
    const deaths = state.turnDeathCount ?? 0
    for (const owner of state.generals) {
        if (!owner.alive || !hasSkill(owner, 'hetaihou_qiluan')) continue
        const idx = indexOfGeneral(state, owner)
        const kills = state.turnKillCounts?.[idx] ?? 0
        const x = kills * 2 + deaths
        if (x <= 0) continue
        askSkill(state, owner, 'hetaihou_qiluan', '戚乱',
            `你本回合杀死 ${kills} 名角色、死亡 ${deaths} 名角色：摸${x}张牌`,
            { qiluanCount: x, endPhaseSkill: true }, false)
        addLog(state, `【${getGeneralName(owner)}】可发动【戚乱】`)
    }
}

// ── 孙鲁育 ────────────────────────────────────────────

/** 魅步（孙鲁育）：其他角色的出牌阶段开始时 */
export function triggerMeibu(state: GameState, active: GeneralInstance): void {
    const activeIdx = indexOfGeneral(state, active)
    for (const owner of state.generals) {
        if (!owner.alive || owner === active) continue
        if (!hasSkill(owner, 'sunluyu_meibu')) continue
        if (!expHasAnyCard(owner)) continue
        if (!getAttackRange(active, owner, state.generals).inRange) continue
        askSkill(state, owner, 'sunluyu_meibu', '魅步',
            `弃置一张牌，令【${getGeneralName(active)}】本阶段视为拥有技能“止息”（若弃置的牌不为【杀】或黑色锦囊牌，其本阶段计算与你的距离视为1）`,
            { meibuTargetIndex: activeIdx }, false)
        addLog(state, `【${getGeneralName(owner)}】可发动【魅步】`)
    }
}

/** 穆穆（孙鲁育）：出牌阶段开始时 */
export function triggerMumu(state: GameState, general: GeneralInstance): void {
    if (!general.alive || !hasSkill(general, 'sunluyu_mumu')) return
    const selfIdx = indexOfGeneral(state, general)
    const hasEquipOnField = state.generals.some(g => g.alive && expEquipCount(g) > 0)
    const hasArmor = state.generals.some(g => g.alive && !!g.equip[EquipSlot.ARMOR])
    const options: { action: string; label: string }[] = []
    if (hasEquipOnField) options.push({ action: 'discard', label: '弃置场上的一张装备牌' })
    if (hasArmor) options.push({ action: 'gainArmor', label: '获得场上的一张防具牌（本阶段不能使用或打出【杀】）' })
    if (options.length === 0) return
    state.pendingResponseQueue.push({
        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
        targetGeneralIndex: selfIdx,
        context: {
            skillId: 'sunluyu_mumu', skillName: '穆穆',
            description: '选择一项：弃置场上一张装备牌，或获得场上一张防具牌（本阶段不能使用【杀】）',
            options,
        },
    })
    addLog(state, `【${getGeneralName(general)}】可发动【穆穆】`)
}

// ── 沙摩柯：蒺藜在 noteExpansionCardUsed 中处理 ──

// ── 曹纯 ──────────────────────────────────────────────

/** 缮甲（曹纯）：出牌阶段开始时 */
export function triggerShanjia(state: GameState, general: GeneralInstance): void {
    if (!general.alive || !hasSkill(general, 'caochun_shanjia')) return
    const x = Math.max(0, 3 - (general.shanjiaLostEquip ?? 0))
    askSkill(state, general, 'caochun_shanjia', '缮甲',
        `摸三张牌，然后弃置${x}张牌；依据弃置的牌获得对应的本阶段加成`, { shanjiaX: x })
    addLog(state, `【${getGeneralName(general)}】可发动【缮甲】`)
}

// ── SP蔡文姬 ──────────────────────────────────────────

/** 陈情（SP蔡文姬）：一名角色进入濒死状态时 */
export function triggerChenqing(state: GameState, dying: GeneralInstance): void {
    const round = state.roundState?.roundNumber ?? 0
    const dyingIdx = indexOfGeneral(state, dying)
    for (const owner of state.generals) {
        if (!owner.alive || owner === dying) continue
        if (!hasSkill(owner, 'caiwenji_sp_chenqing')) continue
        if (owner.chenqingRound === round) continue
        const others = expAliveIdx(state, g => g !== owner && indexOfGeneral(state, g) !== dyingIdx)
        if (others.length === 0) continue
        askSkill(state, owner, 'caiwenji_sp_chenqing', '陈情',
            '令另一名其他角色摸四张牌并弃置四张牌，若其弃置的牌花色均不相同，其视为对濒死角色使用一张【桃】',
            { chenqingDyingIndex: dyingIdx })
        addLog(state, `【${getGeneralName(owner)}】可发动【陈情】`)
    }
}

/** 默识（SP蔡文姬）：结束阶段 */
export function triggerMoshi(state: GameState, general: GeneralInstance): void {
    if (!general.alive || !hasSkill(general, 'caiwenji_sp_moshi')) return
    const list = general.moshiCards ?? []
    if (list.length === 0 || general.hand.length === 0) return
    state.pendingResponseQueue.push({
        type: ResponseType.SKILL_ACTIVATE_CONFIRM,
        targetGeneralIndex: indexOfGeneral(state, general),
        context: {
            skillId: 'caiwenji_sp_moshi', skillName: '默识',
            description: `将一张手牌当本回合出牌阶段使用的第一张基本牌或普通锦囊（${list[0].name}）使用`,
            moshiStage: 0,
            endPhaseSkill: true,
        },
    })
    addLog(state, `【${getGeneralName(general)}】可发动【默识】`)
}


/** 反馈（界司马懿）：获得牌后修改“矫诏” */
export function triggerJiaozhaoUpgrade(state: GameState, general: GeneralInstance): void {
    if (!general.alive || !hasSkill(general, 'simayi_jie_jiaozhao')) return
    const lv = general.jiaozhaoUpgrade ?? 0
    if (lv >= 2) return
    askSkill(state, general, 'simayi_jie_upgrade', '反馈',
        `修改【矫诏】至第${lv + 1}层`, {}, false)
    addLog(state, `【${getGeneralName(general)}】可以修改【矫诏】`)
}


