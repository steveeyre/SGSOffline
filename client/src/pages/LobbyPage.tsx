import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGameStore } from '../store/gameStore'
import { startLocalHotseatMatch, startLocalLandlordMatch, startLocalMatch, startLocalPairMatch } from '../engine/local-dispatch'
import type { LandlordSide } from '../modes/FightTheLandlord/landlord-match'
import { getDeckPreference, setDeckPreference, type DeckType } from '../engine/cards'
import { getGeneralPool, getPoolPreference, setPoolPreference, type GeneralPoolVersion } from '../engine/generals'
import { downloadMatchLogs, listMatchLogs } from '../engine/match-log'
import { GamePhase, GameMode, Faction } from 'sgs3v3-shared'
import './LobbyPage.css'

/** 单机对局里“我”选哪一方；随机由开始按钮现场决定 */
type LocalSide = 'random' | 'cool' | 'warm' | 'hotseat' | 'landlord' | 'farmers'

export default function LobbyPage() {
    const navigate = useNavigate()
    const { gameState, error, setError } = useGameStore()

    const [deckType, setDeckType] = useState<DeckType>(() => getDeckPreference())
    const [poolVersion, setPoolVersion] = useState<GeneralPoolVersion>(() => getPoolPreference())
    const [mode, setMode] = useState<GameMode>(GameMode.CLASSIC)
    const [seedText, setSeedText] = useState('')
    const [side, setSide] = useState<LocalSide>('random')

    // 洛书版 / 平衡版的武将池里有军争牌的技能，只能配 156 张（军争）牌堆
    const poolForces156 = poolVersion === 'luoshu' || poolVersion === 'custom'
    const effectiveDeck: DeckType = poolForces156 ? 'tongshuai156' : deckType

    // 已存下的偏好若与武将池冲突（例如上次选了洛书版 + 108 张），进页面就纠正
    useEffect(() => {
        if (!poolForces156 || deckType === 'tongshuai156') return
        setDeckType('tongshuai156')
        setDeckPreference('tongshuai156')
    }, [poolForces156, deckType])

    useEffect(() => {
        if (!gameState) return
        if (gameState.phase === GamePhase.GENERAL_PICK || gameState.phase === GamePhase.DEPLOY) {
            navigate('/pick')
        } else if (gameState.phase === GamePhase.PLAYING) {
            navigate('/game')
        }
    }, [gameState?.phase])

    useEffect(() => () => setError(null), [])

    function selectMode(next: GameMode) {
        setMode(next)
        setSide('random')
    }

    function selectDeck(t: DeckType) {
        setDeckType(t)
        setDeckPreference(t)
    }

    function selectPool(v: GeneralPoolVersion) {
        setPoolVersion(v)
        setPoolPreference(v)
        // 洛书版 / 平衡版只能配 156 张牌堆
        if (v === 'luoshu' || v === 'custom') {
            setDeckType('tongshuai156')
            setDeckPreference('tongshuai156')
        }
    }

    function parseSeed(): number | undefined | null {
        const raw = seedText.trim()
        if (raw !== '' && !/^\d{1,10}$/.test(raw)) {
            setError('种子必须是 0~4294967295 之间的整数')
            return null
        }
        setDeckPreference(effectiveDeck)
        setPoolPreference(poolVersion)
        return raw === '' ? undefined : Number(raw) % 4294967296
    }

    function handleStart() {
        const seed = parseSeed()
        if (seed === null) return
        if (mode === GameMode.DOUDIZHU) {
            const landlordSide: LandlordSide = side === 'landlord' || side === 'farmers'
                ? side
                : (Math.random() < 0.5 ? 'landlord' : 'farmers')
            startLocalLandlordMatch(landlordSide, seed)
            return
        }
        if (mode === GameMode.HUANLE_SHUANG) {
            const faction = side === 'cool' ? Faction.COOL
                : side === 'warm' ? Faction.WARM
                    : (Math.random() < 0.5 ? Faction.COOL : Faction.WARM)
            startLocalPairMatch(faction, seed)
            return
        }
        if (side === 'hotseat') {
            startLocalHotseatMatch(seed)
            return
        }
        const faction = side === 'cool' ? Faction.COOL
            : side === 'warm' ? Faction.WARM
                : (Math.random() < 0.5 ? Faction.COOL : Faction.WARM)
        startLocalMatch(faction, seed)
    }

    const sideButton = (value: LocalSide, label: string) => (
        <button
            key={value}
            className={`btn lobby-btn ${side === value ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setSide(value)}
        >
            {label}
        </button>
    )

    return (
        <div className="lobby-page">
            <div className="lobby-bg" />
            <button className="btn btn-secondary lobby-log-btn" title="导出本机保存的对局日志"
                onClick={() => downloadMatchLogs()}>
                导出对局日志（{listMatchLogs().length}）
            </button>
            <div className="lobby-container">
                <div className="lobby-header">
                    <h1 className="page-title">三国杀</h1>
                </div>

                <div className="card-panel lobby-card">
                    {error && (
                        <div className="error-toast" onClick={() => setError(null)}>{error}</div>
                    )}

                    <div className="form-group">
                        <label className="form-label">模式</label>
                        <div className="lobby-actions">
                            <button
                                className={`btn lobby-btn ${mode === GameMode.CLASSIC ? 'btn-primary' : 'btn-secondary'}`}
                                onClick={() => selectMode(GameMode.CLASSIC)}
                            >统率三军</button>
                            <button
                                className={`btn lobby-btn ${mode === GameMode.DOUDIZHU ? 'btn-primary' : 'btn-secondary'}`}
                                onClick={() => selectMode(GameMode.DOUDIZHU)}
                            >斗地主</button>
                            <button
                                className={`btn lobby-btn ${mode === GameMode.HUANLE_SHUANG ? 'btn-primary' : 'btn-secondary'}`}
                                onClick={() => selectMode(GameMode.HUANLE_SHUANG)}
                            >欢乐成双</button>
                        </div>
                    </div>

                    {mode === GameMode.CLASSIC && (
                        <>
                            <div className="form-group">
                                <label className="form-label">武将池</label>
                                <div className="lobby-actions">
                                    <button
                                        className={`btn lobby-btn ${poolVersion === 'luoshu' ? 'btn-primary' : 'btn-secondary'}`}
                                        onClick={() => selectPool('luoshu')}
                                    >洛书版（{getGeneralPool('luoshu').length} 将）</button>
                                    <button
                                        className={`btn lobby-btn ${poolVersion === 'custom' ? 'btn-primary' : 'btn-secondary'}`}
                                        onClick={() => selectPool('custom')}
                                    >平衡版（60 将）</button>
                                    <button
                                        className={`btn lobby-btn ${poolVersion === 'classic2013' ? 'btn-primary' : 'btn-secondary'}`}
                                        onClick={() => selectPool('classic2013')}
                                    >2013 版（32 将）</button>
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">牌堆</label>
                                <div className="lobby-actions">
                                    <button
                                        className={`btn lobby-btn ${effectiveDeck === 'tongshuai156' ? 'btn-primary' : 'btn-secondary'}`}
                                        onClick={() => selectDeck('tongshuai156')}
                                    >156 张（军争）</button>
                                    <button
                                        className={`btn lobby-btn ${effectiveDeck === 'standard108' ? 'btn-primary' : 'btn-secondary'}`}
                                        disabled={poolForces156}
                                        title={poolForces156 ? '洛书版 / 平衡版武将池只能使用 156 张（军争）牌堆' : undefined}
                                        onClick={() => { if (!poolForces156) selectDeck('standard108') }}
                                    >108 张（标准）</button>
                                </div>
                            </div>
                        </>
                    )}

                    <div className="form-group">
                        <label className="form-label">阵营</label>
                        <div className="lobby-actions">
                            {mode === GameMode.DOUDIZHU ? (
                                <>
                                    {sideButton('random', '随机')}
                                    {sideButton('landlord', '执地主')}
                                    {sideButton('farmers', '执农民')}
                                </>
                            ) : mode === GameMode.HUANLE_SHUANG ? (
                                <>
                                    {sideButton('random', '随机')}
                                    {sideButton('cool', '执冷（1、4 号位）')}
                                    {sideButton('warm', '执暖（2、3 号位）')}
                                </>
                            ) : (
                                <>
                                    {sideButton('random', '随机')}
                                    {sideButton('cool', '执冷')}
                                    {sideButton('warm', '执暖')}
                                    {sideButton('hotseat', '本地对战')}
                                </>
                            )}
                        </div>
                    </div>
                    <div className="form-group">
                        <label className="form-label">随机种子</label>
                        <input
                            className="input"
                            placeholder="留空则随机；填入结算页的种子可复现对局"
                            value={seedText}
                            onChange={(e) => setSeedText(e.target.value.replace(/[^0-9]/g, ''))}
                            maxLength={10}
                            inputMode="numeric"
                            onKeyDown={(e) => { if (e.key === 'Enter') handleStart() }}
                        />
                    </div>
                    <div className="lobby-actions lobby-start-row">
                        <button className="btn btn-primary lobby-start-btn" onClick={handleStart}>开始</button>
                    </div>
                </div>
            </div>
        </div>
    )
}
