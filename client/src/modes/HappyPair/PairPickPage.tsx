import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Faction, GamePhase, OddityOption } from 'sgs3v3-shared'
import { useGameStore } from '../../store/gameStore'
import { emit } from '../../actions'
import { GENERAL_IMAGE } from '../../data/generalImages'
import { useTooltip, generalTooltipContent, TooltipBubble } from '../../components/Tooltip'
import { GeneralPicker } from '../../components/GeneralPicker'
import { OddityPicker } from '../../components/OddityPicker'
import { oddityCatalog } from '../../engine/oddity'
import { getPairPointPickPool, pairSeatsOf } from './pair-draft'
import '../FightTheLandlord/LandlordPickPage.css'
import './PairPickPage.css'

const SEAT_LABELS = ['1 号位', '2 号位', '3 号位', '4 号位']
const SEAT_FACTIONS = [Faction.COOL, Faction.WARM, Faction.WARM, Faction.COOL]

function oddityTooltip(o: OddityOption) {
    return {
        title: `奇技 · ${o.skillName}`,
        items: [{ name: o.sourceGeneralName, desc: o.description }],
    }
}

export default function PairPickPage() {
    const navigate = useNavigate()
    const gameState = useGameStore((s) => s.gameState)
    const pick = gameState?.pairPick
    const humanSide = gameState?.pairHumanSide
    const phase = gameState?.phase
    const oddityMode = !!gameState?.oddityMode
    // 标准模式：一次点击高亮，再点同一张提交；奇技模式：单击只高亮，由“确认”按钮提交
    const [pendingPick, setPendingPick] = useState<Record<number, string>>({})
    const [pendingOddity, setPendingOddity] = useState<Record<number, string>>({})
    // 点将弹窗当前服务哪个座位；pointSeats 记录该座位的武将来自点将（确认时走点将提交）
    const [pointSeat, setPointSeat] = useState<number | null>(null)
    const [pointSeats, setPointSeats] = useState<Record<number, boolean>>({})
    const pointPool = useMemo(() => getPairPointPickPool(), [])
    const oddityPool = useMemo(() => oddityCatalog(), [])
    // 奇技任选弹窗当前服务哪个座位
    const [oddityPickerSeat, setOddityPickerSeat] = useState<number | null>(null)
    const { tooltip, onEnter, onMove, onLeave } = useTooltip(400)

    useEffect(() => {
        if (phase === GamePhase.PLAYING) navigate('/game', { replace: true })
    }, [phase, navigate])

    if (!gameState || !pick || !humanSide) {
        return (
            <div className="landlord-pick-page">
                <div className="landlord-pick-empty">
                    没有进行中的欢乐成双选将
                    <button className="btn btn-secondary" onClick={() => navigate('/')}>返回首页</button>
                </div>
            </div>
        )
    }

    const mySeats = pairSeatsOf(humanSide)
    const isHumanSeat = (seat: number) => mySeats.includes(seat)
    const allPicked = pick.picked.every((id) => id !== null)
    const oddities = pick.oddities
    const oddityPicked = pick.oddityPicked
    const usedIds = pick.picked.filter((id): id is string => !!id)
    const nameById = new Map(pointPool.map((g) => [g.id, g.name]))
    const nameOf = (id: string) => nameById.get(id) ?? id
    const oddityNameOf = (skillId: string) =>
        oddityPool.find((o) => o.skillId === skillId)?.skillName ?? skillId

    function pickCard(seat: number, generalId: string): void {
        if (oddityMode) {
            setPendingPick((prev) => ({ ...prev, [seat]: generalId }))
            return
        }
        if (pendingPick[seat] !== generalId) {
            setPendingPick((prev) => ({ ...prev, [seat]: generalId }))
            return
        }
        setPendingPick((prev) => {
            const next = { ...prev }
            delete next[seat]
            return next
        })
        emit.pairPick({ seat, generalId })
    }

    function pickOddity(seat: number, skillId: string): void {
        setPendingOddity((prev) => ({ ...prev, [seat]: skillId }))
    }

    function confirmSeat(seat: number): void {
        const generalId = pendingPick[seat]
        const oddityId = pendingOddity[seat]
        if (!generalId || !oddityId) return
        setPendingPick((prev) => {
            const next = { ...prev }
            delete next[seat]
            return next
        })
        setPendingOddity((prev) => {
            const next = { ...prev }
            delete next[seat]
            return next
        })
        if (pointSeats[seat]) {
            emit.pairPointPick({ seat, generalId, oddityId })
        } else {
            emit.pairConfirmPick({ seat, generalId, oddityId })
        }
        setPointSeats((prev) => {
            const next = { ...prev }
            delete next[seat]
            return next
        })
    }

    /** 点将选中：奇技模式只记录为待确认，标准模式直接提交 */
    function handlePointPick(seat: number, generalId: string): void {
        setPointSeat(null)
        if (oddityMode) {
            setPointSeats((prev) => ({ ...prev, [seat]: true }))
            setPendingPick((prev) => ({ ...prev, [seat]: generalId }))
            return
        }
        emit.pairPointPick({ seat, generalId })
    }

    return (
        <div className={`landlord-pick-page ${oddityMode ? 'oddity-mode' : ''}`}>
            <div className="landlord-pick-title">
                欢乐成双 · 选将{oddityMode ? '（奇技模式）' : ''}
            </div>

            <div className="landlord-pick-columns pair-pick-columns">
                {pick.pools.map((pool, seat) => {
                    const mine = isHumanSeat(seat)
                    const pickedId = pick.picked[seat]
                    const pendingId = mine ? pendingPick[seat] : undefined
                    const pendingSkill = mine ? pendingOddity[seat] : undefined
                    const pickedSkill = oddityPicked?.[seat]
                    const options = oddities?.[seat] ?? []
                    const faction = SEAT_FACTIONS[seat]
                    return (
                        <div
                            key={seat}
                            className={`landlord-pick-column pair-pick-column ${faction === Faction.WARM ? 'warm' : 'cool'} ${mine ? 'mine' : 'rival'}`}
                        >
                            <div className="landlord-pick-seat">
                                <span>{SEAT_LABELS[seat]}</span>
                                <span className="landlord-pick-seat-right">
                                    {mine && !pickedId && !allPicked && (
                                        <button className="gp-open" onClick={() => setPointSeat(seat)}>点将</button>
                                    )}
                                    <span className="landlord-pick-owner">
                                        {faction === Faction.WARM ? '暖色方' : '冷色方'}
                                    </span>
                                </span>
                            </div>
                            {mine ? (
                                <>
                                    <div className="landlord-pick-cards">
                                        {pool.map((g, i) => {
                                            const isPicked = pickedId === g.id
                                            const isPending = !pickedId && pendingId === g.id
                                            const selectable = !pickedId && !allPicked
                                            return (
                                                <div
                                                    key={g.id}
                                                    className={`landlord-pick-card ${isPicked ? 'picked' : ''} ${isPending ? 'selected' : ''} ${selectable ? 'selectable' : ''}`}
                                                    style={isPending ? undefined : { animationDelay: `${Math.min(i, 8) * 0.03}s` }}
                                                    onClick={() => {
                                                        if (!selectable) return
                                                        pickCard(seat, g.id)
                                                    }}
                                                    onMouseEnter={(e) => onEnter(e, generalTooltipContent(g))}
                                                    onMouseMove={onMove}
                                                    onMouseLeave={onLeave}
                                                >
                                                    <div className="lpc-portrait">
                                                        {GENERAL_IMAGE[g.id]
                                                            ? <img src={GENERAL_IMAGE[g.id]} alt={g.name} className="lpc-portrait-img" loading="lazy" decoding="async"
                                                                onError={(e) => { e.currentTarget.style.display = 'none' }} />
                                                            : <span className="lpc-avatar">{g.name[0]}</span>}
                                                        <span className="lpc-name">{g.name}</span>
                                                        <span className="lpc-hp">{'♥'.repeat(Math.max(1, g.maxHp))}</span>
                                                        {isPicked && <div className="landlord-pick-badge">已选</div>}
                                                        {isPending && <div className="landlord-pick-badge pending">
                                                            {oddityMode ? '已选中' : '再点确定'}
                                                        </div>}
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                    {oddityMode && (
                                        <div className="oddity-block">
                                            <div className="oddity-label">
                                                <span>奇技</span>
                                                {!pickedSkill && !allPicked && (
                                                    <button
                                                        className="gp-open"
                                                        onClick={() => setOddityPickerSeat(seat)}
                                                    >任选</button>
                                                )}
                                            </div>
                                            <div className="oddity-list">
                                                {options.map((o) => {
                                                    const isPending = !pickedSkill && pendingSkill === o.skillId
                                                    const isTaken = !!pickedSkill && pickedSkill === o.skillId
                                                    return (
                                                        <div
                                                            key={o.skillId}
                                                            className={`oddity-card ${isPending ? 'selected' : ''} ${isTaken ? 'taken' : ''} ${!pickedSkill && !allPicked ? 'selectable' : ''}`}
                                                            onClick={() => {
                                                                if (pickedSkill || allPicked) return
                                                                pickOddity(seat, o.skillId)
                                                            }}
                                                            onMouseEnter={(e) => onEnter(e, oddityTooltip(o))}
                                                            onMouseMove={onMove}
                                                            onMouseLeave={onLeave}
                                                        >
                                                            <div className="oddity-head">
                                                                <span className="oddity-name">{o.skillName}</span>
                                                                <span className="oddity-source">{o.sourceGeneralName}</span>
                                                            </div>
                                                            <div className="oddity-desc">{o.description}</div>
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                            {!pickedId && (
                                                <button
                                                    className="btn btn-primary oddity-confirm"
                                                    disabled={!pendingId || !pendingSkill}
                                                    onClick={() => confirmSeat(seat)}
                                                >确认</button>
                                            )}
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div className="landlord-pick-hidden">
                                    <div className="landlord-pick-hidden-mark">？</div>
                                    <div className="landlord-pick-hidden-text">
                                        {pickedId ? '对手已选定武将' : '对手正在选将…'}
                                    </div>
                                </div>
                            )}
                            <div className="landlord-pick-status">
                                {mine
                                    ? pickedId
                                        ? `已选：${nameOf(pickedId)}`
                                            + (pickedSkill ? ` · 奇技 ${oddityNameOf(pickedSkill)}` : '')
                                        : oddityMode
                                            ? `${pendingId ? `武将 ${nameOf(pendingId)}` : '请选武将'}`
                                                + ` ／ ${pendingSkill ? `奇技 ${oddityNameOf(pendingSkill)}` : '请选奇技'}`
                                                + '，选好后点确认'
                                            : pendingId
                                                ? `待确认：${nameOf(pendingId)}（再点一次确定）`
                                                : '点一次高亮，再点一次确认'
                                    : pickedId ? '对手已锁定' : '等待对手选将…'}
                            </div>
                        </div>
                    )
                })}
            </div>

            <GeneralPicker
                open={pointSeat !== null}
                title={pointSeat === null ? '点将' : `点将 · ${SEAT_LABELS[pointSeat]}`}
                pool={pointPool}
                usedIds={usedIds}
                onPick={(id) => {
                    if (pointSeat !== null) handlePointPick(pointSeat, id)
                }}
                onClose={() => setPointSeat(null)}
            />

            <OddityPicker
                open={oddityPickerSeat !== null}
                title={oddityPickerSeat === null ? '奇技任选' : `奇技任选 · ${SEAT_LABELS[oddityPickerSeat]}`}
                pool={oddityPool}
                usedIds={oddityPicked ? oddityPicked.filter((id): id is string => !!id) : []}
                onPick={(skillId) => {
                    if (oddityPickerSeat === null) return
                    setPendingOddity((prev) => ({ ...prev, [oddityPickerSeat]: skillId }))
                    setOddityPickerSeat(null)
                }}
                onClose={() => setOddityPickerSeat(null)}
            />

            <TooltipBubble tooltip={tooltip} />
        </div>
    )
}
