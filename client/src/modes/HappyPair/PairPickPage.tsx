import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Faction, GamePhase } from 'sgs3v3-shared'
import { useGameStore } from '../../store/gameStore'
import { emit } from '../../socket/client'
import { GENERAL_IMAGE } from '../../data/generalImages'
import { useTooltip, generalTooltipContent, TooltipBubble } from '../../components/Tooltip'
import { pairSeatsOf } from './pair-draft'
import '../FightTheLandlord/LandlordPickPage.css'
import './PairPickPage.css'

const SEAT_LABELS = ['1 号位', '2 号位', '3 号位', '4 号位']
const SEAT_FACTIONS = [Faction.COOL, Faction.WARM, Faction.WARM, Faction.COOL]

export default function PairPickPage() {
    const navigate = useNavigate()
    const gameState = useGameStore((s) => s.gameState)
    const llmThinking = useGameStore((s) => s.llmThinking)
    const pick = gameState?.pairPick
    const humanSide = gameState?.pairHumanSide
    const phase = gameState?.phase
    const [pendingPick, setPendingPick] = useState<Record<number, string>>({})
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

    function pickCard(seat: number, generalId: string): void {
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

    return (
        <div className="landlord-pick-page">
            <div className="landlord-pick-title">欢乐成双 · 选将</div>

            <div className="landlord-pick-columns pair-pick-columns">
                {pick.pools.map((pool, seat) => {
                    const mine = isHumanSeat(seat)
                    const pickedId = pick.picked[seat]
                    const pendingId = mine ? pendingPick[seat] : undefined
                    const faction = SEAT_FACTIONS[seat]
                    return (
                        <div
                            key={seat}
                            className={`landlord-pick-column pair-pick-column ${faction === Faction.WARM ? 'warm' : 'cool'} ${mine ? 'mine' : 'rival'}`}
                        >
                            <div className="landlord-pick-seat">
                                {SEAT_LABELS[seat]}
                                <span className="landlord-pick-owner">
                                    {faction === Faction.WARM ? '暖色方' : '冷色方'}
                                </span>
                            </div>
                            {mine ? (
                                <div className="landlord-pick-cards">
                                    {pool.map((g, i) => {
                                        const isPicked = pickedId === g.id
                                        const isPending = !pickedId && pendingId === g.id
                                        const selectable = !pickedId && !allPicked
                                        return (
                                            <div
                                                key={g.id}
                                                className={`landlord-pick-card ${isPicked ? 'picked' : ''} ${isPending ? 'pending' : ''} ${selectable ? 'selectable' : ''}`}
                                                style={{ animationDelay: `${Math.min(i, 8) * 0.03}s` }}
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
                                                        ? <img src={GENERAL_IMAGE[g.id]} alt={g.name} className="lpc-portrait-img"
                                                            onError={(e) => { e.currentTarget.style.display = 'none' }} />
                                                        : <span className="lpc-avatar">{g.name[0]}</span>}
                                                    <span className="lpc-name">{g.name}</span>
                                                    <span className="lpc-hp">{'♥'.repeat(Math.max(1, g.maxHp))}</span>
                                                    {isPicked && <div className="landlord-pick-badge">已选</div>}
                                                    {isPending && <div className="landlord-pick-badge pending">再点确定</div>}
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            ) : (
                                <div className="landlord-pick-hidden">
                                    <div className="landlord-pick-hidden-mark">？</div>
                                    <div className="landlord-pick-hidden-text">
                                        {pickedId
                                            ? '对手已选定武将'
                                            : llmThinking === '选将' ? '对手（AI）正在思考…' : '对手正在选将…'}
                                    </div>
                                </div>
                            )}
                            <div className="landlord-pick-status">
                                {mine
                                    ? pickedId
                                        ? `已选：${pool.find((g) => g.id === pickedId)?.name ?? pickedId}`
                                        : pendingId
                                            ? `待确认：${pool.find((g) => g.id === pendingId)?.name ?? pendingId}（再点一次确定）`
                                            : '点一次高亮，再点一次确认'
                                    : pickedId ? '对手已锁定' : '等待对手选将…'}
                            </div>
                        </div>
                    )
                })}
            </div>

            <TooltipBubble tooltip={tooltip} />
        </div>
    )
}
