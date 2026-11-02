import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGameStore } from '../store/gameStore'
import { emit } from '../socket/client'
import { GENERAL_IMAGE } from '../data/generalImages'
import { useTooltip, generalTooltipContent, TooltipBubble } from '../components/Tooltip'
import {
    GamePhase,
    Faction,
    GameStateClientView,
} from 'sgs3v3-shared'
import { pickSequenceFor } from '../engine/local-match'
import HotseatSplit from './HotseatSplit'
import './GeneralPickPage.css'
import './HotseatSplit.css'

type DeploySelection = {
    commander?: string
    flankA?: string
    flankB?: string
}

/** 单方部署面板：普通对局占满全屏，左右手对弈时放进各自的分屏 */
function DeployPanel({ view, faction }: { view: GameStateClientView; faction: Faction }) {
    const [selection, setSelection] = useState<DeploySelection>({})
    const { tooltip, onEnter, onMove, onLeave } = useTooltip(400)
    const { pickState, deployState } = view

    if (view.phase !== GamePhase.DEPLOY || !pickState || !deployState) return null

    const myPicked = faction === Faction.WARM ? pickState.warmPicked : pickState.coolPicked
    const myDeployed = faction === Faction.WARM ? deployState.warmDeployed : deployState.coolDeployed
    const oppPicked = faction === Faction.WARM ? pickState.coolPicked : pickState.warmPicked
    const oppDeployed = faction === Faction.WARM ? deployState.coolDeployed : deployState.warmDeployed
    const oppFaction = faction === Faction.WARM ? Faction.COOL : Faction.WARM
    const factionLabel = faction === Faction.WARM ? '暖色方' : '冷色方'

    function selectForSlot(slot: 'commander' | 'flankA' | 'flankB', gId: string) {
        setSelection((prev) => {
            const clean = { ...prev }
            if (clean.commander === gId) clean.commander = undefined
            if (clean.flankA === gId) clean.flankA = undefined
            if (clean.flankB === gId) clean.flankB = undefined
            return { ...clean, [slot]: gId }
        })
    }

    function handleDeploy() {
        const { commander, flankA, flankB } = selection
        if (!commander || !flankA || !flankB) return
        emit.deployGenerals({ commander, flankA, flankB })
    }

    const deployReady = selection.commander && selection.flankA && selection.flankB

    return (
        <div className="pick-page">
            <div className="pick-header">
                <div className="pick-title page-title">部署武将</div>
                <div className="pick-turn-info">
                    你是 <span className={faction === Faction.WARM ? 'faction-warm' : 'faction-cool'}>{factionLabel}</span>
                    ，将 3 名武将分配到阵营位置
                </div>
            </div>

            <div className="deploy-main">
                <div className="deploy-slots">
                    {(['flankA', 'commander', 'flankB'] as const).map((slot) => {
                        const label = { commander: '主帅', flankA: '前锋A', flankB: '前锋B' }[slot]
                        const assigned = myPicked.find((g) => g.id === selection[slot])
                        const isCommander = slot === 'commander'
                        return (
                            <div key={slot} className={`deploy-slot ${assigned ? 'filled' : ''} ${isCommander ? 'deploy-slot-commander' : ''}`}>
                                <div className="deploy-slot-label">{label}</div>
                                <div className="deploy-slot-content">
                                    {assigned
                                        ? <div className="deploy-assigned">
                                            <div className="gpc-avatar small">
                                                {GENERAL_IMAGE[assigned.id]
                                                    ? <img src={GENERAL_IMAGE[assigned.id]} alt={assigned.name} className="gpc-portrait-img" />
                                                    : <span className="gpc-avatar-placeholder">{assigned.name[0]}</span>
                                                }
                                            </div>
                                            <span>{assigned.name}</span>
                                        </div>
                                        : <span className="deploy-empty">未选择</span>
                                    }
                                </div>
                            </div>
                        )
                    })}
                </div>

                <div className="deploy-pool">
                    {myPicked.map((g) => (
                        <div key={g.id} className="deploy-general-card"
                            onMouseEnter={(e) => onEnter(e, generalTooltipContent(g))}
                            onMouseMove={onMove}
                            onMouseLeave={onLeave}
                        >
                            <div className="gpc-avatar small">
                                {GENERAL_IMAGE[g.id]
                                    ? <img src={GENERAL_IMAGE[g.id]} alt={g.name} className="gpc-portrait-img" />
                                    : <span className="gpc-avatar-placeholder">{g.name[0]}</span>
                                }
                            </div>
                            <div className="deploy-general-info">
                                <div className="gpc-name">{g.name}</div>
                                <div className="deploy-assign-btns">
                                    {(['flankA', 'commander', 'flankB'] as const).map((slot) => (
                                        <button
                                            key={slot}
                                            className={`btn deploy-assign-btn ${selection[slot] === g.id ? 'active' : ''}`}
                                            onClick={() => selectForSlot(slot, g.id)}
                                        >
                                            {{ commander: '主帅', flankA: '前锋A', flankB: '前锋B' }[slot]}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="deploy-opponent">
                    <div className="deploy-opponent-title">
                        <span className={oppFaction === Faction.WARM ? 'faction-warm' : 'faction-cool'}>
                            {oppFaction === Faction.WARM ? '暖色方' : '冷色方'}
                        </span>
                        选将（{oppPicked.length} 名）{oppDeployed ? ' · 已完成部署' : ''}
                    </div>
                    <div className="deploy-opponent-list">
                        {oppPicked.map((g) => (
                            <div key={g.id} className="deploy-opponent-item"
                                onMouseEnter={(e) => onEnter(e, generalTooltipContent(g))}
                                onMouseMove={onMove}
                                onMouseLeave={onLeave}>
                                <span className="deploy-opponent-name">{g.name}</span>
                                <span className="deploy-opponent-skills">{g.skills.map((s) => s.name).join(' / ')}</span>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="deploy-confirm-area">
                    {myDeployed
                        ? <div className="deploy-waiting">已确认，等待对方部署...</div>
                        : <button className="btn btn-primary deploy-confirm-btn" disabled={!deployReady} onClick={handleDeploy}>
                            确认部署
                        </button>
                    }
                </div>
            </div>
            <TooltipBubble tooltip={tooltip} />
        </div>
    )
}

/** 单方选将面板：普通对局占满全屏，左右手对弈时放进各自的分屏 */
function PickPanel({ view, faction }: { view: GameStateClientView; faction: Faction }) {
    const isSpectator = useGameStore((s) => s.isSpectator)
    const { tooltip, onEnter, onMove, onLeave } = useTooltip(400)
    const { phase, pickState } = view

    // ── 选将前的先选/让先（暖色方操作，冷色方等待） ──────────────────
    if (phase === GamePhase.GENERAL_PICK && pickState?.waitingForPickYield) {
        const canChoose = !isSpectator && faction === Faction.WARM
        return (
            <div className="pick-page">
                <div className="pick-header">
                    <div className="pick-title page-title">武将选择</div>
                    {!canChoose && <div className="pick-turn-info">等待暖色方选择先选/让先...</div>}
                </div>
                <div className="pick-main">
                    <div className="pick-pool">
                        {pickState.pool.map((g, gIndex) => (
                            <div key={g.id} className="general-pick-card preview"
                                style={{ animationDelay: `${Math.min(gIndex, 24) * 0.02}s` }}
                                onMouseEnter={(e) => onEnter(e, generalTooltipContent(g))}
                                onMouseMove={onMove}
                                onMouseLeave={onLeave}>
                                <div className="gpc-card-portrait">
                                    {GENERAL_IMAGE[g.id]
                                        ? <img src={GENERAL_IMAGE[g.id]} alt={g.name} className="gpc-portrait-img" />
                                        : <span className="gpc-avatar-placeholder">{g.name[0]}</span>
                                    }
                                </div>
                                <div className="gpc-info">
                                    <div className="gpc-name">{g.name}</div>
                                    <div className="gpc-hp">{'♥'.repeat(g.maxHp)}</div>
                                    <div className="gpc-skills">
                                        {g.skills.map((s) => (
                                            <span key={s.id} className="gpc-skill-tag" title={s.description}>{s.name}</span>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
                {canChoose && (
                    <div className="yield-choice-bar">
                        <button className="btn btn-primary"
                            onClick={() => emit.yieldChoice({ yield: false, phase: 'pick' })}>
                            先选（我方先选将）
                        </button>
                        <button className="btn btn-secondary"
                            onClick={() => emit.yieldChoice({ yield: true, phase: 'pick' })}>
                            让先（对方先选将）
                        </button>
                    </div>
                )}
                <TooltipBubble tooltip={tooltip} />
            </div>
        )
    }

    // ── 选将阶段 ──────────────────────────────────────────────
    if (phase === GamePhase.GENERAL_PICK && pickState) {
        const currentFaction = pickSequenceFor(view)[pickState.pickStep]
        const isMyTurn = !isSpectator && currentFaction === faction
        const pickedIds = new Set([
            ...pickState.warmPicked.map((g) => g.id),
            ...pickState.coolPicked.map((g) => g.id),
        ])

        return (
            <div className="pick-page">
                <div className="pick-header">
                    <div className="pick-title page-title">武将选择</div>
                    <div className="pick-turn-info">
                        <span className={currentFaction === Faction.WARM ? 'faction-warm' : 'faction-cool'}>
                            {currentFaction === Faction.WARM ? '暖色方' : '冷色方'}
                        </span>
                        <span> 选将中</span>
                        <span className="pick-step">（{pickState.pickStep + 1} / 16）</span>
                    </div>
                    {isMyTurn && <div className="pick-my-turn-badge">轮到你选了！</div>}
                    {isSpectator && <div className="pick-my-turn-badge" style={{ background: 'rgba(255,180,0,0.15)', color: '#ffb400' }}>👁 观战中</div>}
                </div>

                <div className="pick-main">
                    <div className="pick-pool">
                        {pickState.pool.map((g, gIndex) => {
                            const isPicked = pickedIds.has(g.id)
                            return (
                                <div
                                    key={g.id}
                                    className={`general-pick-card ${isPicked ? 'picked' : ''} ${isMyTurn && !isPicked ? 'selectable' : ''}`}
                                    style={{ animationDelay: `${Math.min(gIndex, 24) * 0.02}s` }}
                                    onClick={() => {
                                        if (isMyTurn && !isPicked) emit.pickGeneral({ generalId: g.id })
                                    }}
                                    onMouseEnter={(e) => onEnter(e, generalTooltipContent(g))}
                                    onMouseMove={onMove}
                                    onMouseLeave={onLeave}
                                >
                                    <div className="gpc-card-portrait">
                                        {GENERAL_IMAGE[g.id]
                                            ? <img src={GENERAL_IMAGE[g.id]} alt={g.name} className="gpc-portrait-img" />
                                            : <span className="gpc-avatar-placeholder">{g.name[0]}</span>
                                        }
                                    </div>
                                    <div className="gpc-info">
                                        <div className="gpc-name">{g.name}</div>
                                        <div className="gpc-hp">{'♥'.repeat(g.maxHp)}</div>
                                        <div className="gpc-skills">
                                            {g.skills.map((s) => (
                                                <span key={s.id} className="gpc-skill-tag" title={s.description}>{s.name}</span>
                                            ))}
                                        </div>
                                    </div>
                                    {isPicked && <div className="gpc-picked-overlay">已选</div>}
                                </div>
                            )
                        })}
                    </div>

                    <div className="pick-sidebar">
                        <div className="pick-sidebar-section">
                            <div className="pick-sidebar-title faction-warm">暖色方 ({pickState.warmPicked.length}/8)</div>
                            <div className="pick-picked-list">
                                {pickState.warmPicked.map((g) => <div key={g.id} className="pick-picked-item">{g.name}</div>)}
                            </div>
                        </div>
                        <div className="pick-sidebar-section">
                            <div className="pick-sidebar-title faction-cool">冷色方 ({pickState.coolPicked.length}/8)</div>
                            <div className="pick-picked-list">
                                {pickState.coolPicked.map((g) => <div key={g.id} className="pick-picked-item">{g.name}</div>)}
                            </div>
                        </div>
                    </div>
                </div>
                <TooltipBubble tooltip={tooltip} />
            </div>
        )
    }

    return null
}

export default function GeneralPickPage() {
    const navigate = useNavigate()
    const { gameState, myFaction, isSpectator, hotseat, hotseatViews } = useGameStore()

    useEffect(() => {
        if (gameState?.phase === GamePhase.PLAYING) navigate('/game')
    }, [gameState?.phase])

    if (!gameState) return null

    const { phase, pickState, deployState } = gameState
    // 左右手对弈：两边各看自己的视角，暖方在上、冷方在下
    const warmView = hotseat ? hotseatViews?.warm ?? null : null
    const coolView = hotseat ? hotseatViews?.cool ?? null : null
    const split = warmView && coolView ? { warm: warmView, cool: coolView } : null

    // 观战者在部署阶段看到等待提示
    if (isSpectator && phase === GamePhase.DEPLOY) {
        return (
            <div className="pick-page">
                <div className="pick-header">
                    <div className="pick-title page-title">武将部署</div>
                    <div className="pick-my-turn-badge" style={{ background: 'rgba(255,180,0,0.15)', color: '#ffb400' }}>👁 观战中</div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1, fontSize: 20, color: '#aaa' }}>
                    正在部署中，请稍后...
                </div>
            </div>
        )
    }

    if (phase === GamePhase.GENERAL_PICK) {
        if (split) {
            return (
                <HotseatSplit
                    warm={<PickPanel view={split.warm} faction={Faction.WARM} />}
                    cool={<PickPanel view={split.cool} faction={Faction.COOL} />}
                />
            )
        }
        return <PickPanel view={gameState} faction={myFaction ?? Faction.WARM} />
    }

    // ── 部署阶段 ──────────────────────────────────────────────
    if (phase === GamePhase.DEPLOY && pickState && deployState) {
        // 左右手对弈：两边各在自己的分屏上同时部署，两方都确认后开局
        if (split) {
            return (
                <HotseatSplit
                    warm={<DeployPanel view={split.warm} faction={Faction.WARM} />}
                    cool={<DeployPanel view={split.cool} faction={Faction.COOL} />}
                />
            )
        }
        return <DeployPanel view={gameState} faction={myFaction ?? Faction.WARM} />
    }

    return null
}
