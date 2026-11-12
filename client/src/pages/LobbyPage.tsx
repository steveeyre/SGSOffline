import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGameStore } from '../store/gameStore'
import { getResumeInfo, resumeLocalMatch, startLocalHotseatMatch, startLocalLandlordMatch, startLocalMatch, startLocalPairMatch, type ResumeInfo } from '../engine/local-dispatch'
import type { LandlordSide } from '../modes/FightTheLandlord/landlord-match'
import { getDeckPreference, setDeckPreference, type DeckType } from '../engine/cards'
import { getGeneralPool, getPoolPreference, setPoolPreference, type GeneralPoolVersion } from '../engine/generals'
import { downloadMatchLogs, listMatchLogs } from '../engine/match-log'
import { GamePhase, GameMode, Faction, type SkillLimitRule } from 'sgs3v3-shared'
import './LobbyPage.css'

const SKILL_LIMIT_KEY = 'sgsoffline.skillLimitRule'
const WEAPON_ENHANCE_KEY = 'sgsoffline.weaponEnhance'

function getSkillLimitPreference(): SkillLimitRule {
    try {
        return typeof localStorage !== 'undefined' && localStorage.getItem(SKILL_LIMIT_KEY) === 'unlimited'
            ? 'unlimited' : 'limited'
    } catch {
        return 'limited'
    }
}

function setSkillLimitPreference(rule: SkillLimitRule): void {
    try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(SKILL_LIMIT_KEY, rule)
    } catch {
        /* ignore */
    }
}

function getWeaponEnhancePreference(): boolean {
    try {
        return typeof localStorage !== 'undefined' && localStorage.getItem(WEAPON_ENHANCE_KEY) === 'on'
    } catch {
        return false
    }
}

function setWeaponEnhancePreference(on: boolean): void {
    try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(WEAPON_ENHANCE_KEY, on ? 'on' : 'off')
    } catch {
        /* ignore */
    }
}

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
    /** 斗地主 / 欢乐成双的奇技模式：选将时额外从洛书池抽 3 个技能 */
    const [oddity, setOddity] = useState(false)
    /** 开局技能规则：同一武将技能/武器效果每回合至多发动五次，或不受限制 */
    const [skillLimitRule, setSkillLimitRule] = useState<SkillLimitRule>(() => getSkillLimitPreference())
    /** 武器牌加强：开启后七件武器按加强版规则结算 */
    const [weaponEnhance, setWeaponEnhance] = useState<boolean>(() => getWeaponEnhancePreference())
    // 进大厅时读一次未打完的对局；没有存档时不显示入口
    const [resumeInfo] = useState<ResumeInfo | null>(() => getResumeInfo())

    // 平衡版 / 平衡扩展版 / 乱斗版含有军争牌技能，只能配 156 张（军争）牌堆
    const poolForces156 = poolVersion !== 'classic2013'
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
        // 平衡版 / 平衡扩展版 / 乱斗版只能配 156 张牌堆
        if (v !== 'classic2013') {
            setDeckType('tongshuai156')
            setDeckPreference('tongshuai156')
        }
    }

    function selectSkillLimitRule(rule: SkillLimitRule) {
        setSkillLimitRule(rule)
        setSkillLimitPreference(rule)
    }

    function selectWeaponEnhance(on: boolean) {
        setWeaponEnhance(on)
        setWeaponEnhancePreference(on)
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

    function resumeLabel(info: ResumeInfo): string {
        const modeName = info.mode === GameMode.DOUDIZHU ? '斗地主'
            : info.mode === GameMode.HUANLE_SHUANG ? '欢乐成双'
                : '统率三军'
        const stage = info.phase === GamePhase.PLAYING
            ? `第 ${info.round} 回合`
            : info.phase === GamePhase.DEPLOY ? '部署中' : '选将中'
        return `${modeName} · ${stage}`
    }

    function handleStart() {
        const seed = parseSeed()
        if (seed === null) return
        if (mode === GameMode.DOUDIZHU) {
            const landlordSide: LandlordSide = side === 'landlord' || side === 'farmers'
                ? side
                : (Math.random() < 0.5 ? 'landlord' : 'farmers')
            startLocalLandlordMatch(landlordSide, seed, oddity, skillLimitRule, weaponEnhance)
            return
        }
        if (mode === GameMode.HUANLE_SHUANG) {
            const faction = side === 'cool' ? Faction.COOL
                : side === 'warm' ? Faction.WARM
                    : (Math.random() < 0.5 ? Faction.COOL : Faction.WARM)
            startLocalPairMatch(faction, seed, oddity, skillLimitRule, weaponEnhance)
            return
        }
        if (side === 'hotseat') {
            startLocalHotseatMatch(seed, skillLimitRule, weaponEnhance)
            return
        }
        const faction = side === 'cool' ? Faction.COOL
            : side === 'warm' ? Faction.WARM
                : (Math.random() < 0.5 ? Faction.COOL : Faction.WARM)
        startLocalMatch(faction, seed, skillLimitRule, weaponEnhance)
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
                                        className={`btn lobby-btn ${poolVersion === 'brawl' ? 'btn-primary' : 'btn-secondary'}`}
                                        onClick={() => selectPool('brawl')}
                                    >乱斗版（{getGeneralPool('brawl').length} 将）</button>
                                    <button
                                        className={`btn lobby-btn ${poolVersion === 'balance_ext' ? 'btn-primary' : 'btn-secondary'}`}
                                        onClick={() => selectPool('balance_ext')}
                                    >平衡扩展版（{getGeneralPool('balance_ext').length} 将）</button>
                                    <button
                                        className={`btn lobby-btn ${poolVersion === 'balance' ? 'btn-primary' : 'btn-secondary'}`}
                                        onClick={() => selectPool('balance')}
                                    >平衡版（{getGeneralPool('balance').length} 将）</button>
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

                    {(mode === GameMode.DOUDIZHU || mode === GameMode.HUANLE_SHUANG) && (
                        <div className="form-group">
                            <label className="form-label">玩法</label>
                            <div className="lobby-actions">
                                <button
                                    className={`btn lobby-btn ${!oddity ? 'btn-primary' : 'btn-secondary'}`}
                                    onClick={() => setOddity(false)}
                                >标准</button>
                                <button
                                    className={`btn lobby-btn ${oddity ? 'btn-primary' : 'btn-secondary'}`}
                                    title="选将时每名角色额外从洛书池抽 3 个技能，选定武将时一并选择"
                                    onClick={() => setOddity(true)}
                                >奇技模式</button>
                            </div>
                        </div>
                    )}

                    <div className="form-group">
                        <label className="form-label">武将技能 / 武器效果</label>
                        <div className="lobby-actions">
                            <button
                                className={`btn lobby-btn ${skillLimitRule === 'limited' ? 'btn-primary' : 'btn-secondary'}`}
                                title="同一武将技能 / 武器效果每回合至多发动或触发五次"
                                onClick={() => selectSkillLimitRule('limited')}
                            >限五次（每回合至多五次）</button>
                            <button
                                className={`btn lobby-btn ${skillLimitRule === 'unlimited' ? 'btn-primary' : 'btn-secondary'}`}
                                title="同一武将技能 / 武器效果每回合发动次数不限"
                                onClick={() => selectSkillLimitRule('unlimited')}
                            >无限制</button>
                        </div>
                    </div>

                    <div className="form-group">
                        <label className="form-label">武器牌加强</label>
                        <div className="lobby-actions">
                            <button
                                className={`btn lobby-btn ${!weaponEnhance ? 'btn-primary' : 'btn-secondary'}`}
                                title="七件武器按标准规则结算"
                                onClick={() => selectWeaponEnhance(false)}
                            >标准</button>
                            <button
                                className={`btn lobby-btn ${weaponEnhance ? 'btn-primary' : 'btn-secondary'}`}
                                title="雌雄双股剑 / 青龙偃月刀 / 麒麟弓 / 青釭剑 / 连弩 / 方天画戟 / 朱雀羽扇按加强版规则结算"
                                onClick={() => selectWeaponEnhance(true)}
                            >加强</button>
                        </div>
                    </div>

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
                    <div className="lobby-actions lobby-start-row">
                        <button className="btn btn-secondary lobby-start-btn" onClick={() => navigate('/review')}>
                            复盘与统计（{listMatchLogs().length} 局）
                        </button>
                    </div>
                    {resumeInfo && (
                        <div className="lobby-actions lobby-start-row">
                            <button
                                className="btn btn-secondary lobby-start-btn"
                                title="接着打上次没打完的对局：局面、随机序列与对局日志都原样恢复"
                                onClick={() => { resumeLocalMatch() }}
                            >
                                继续上次对局（{resumeLabel(resumeInfo)}）
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
