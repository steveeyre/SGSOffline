import { create } from 'zustand'
import {
    GameStateClientView,
    GamePhase,
    GameMode,
    Faction,
    GeneralClientView,
} from 'sgs3v3-shared'

interface AppState {
    // 连接状态
    playerId: string | null
    nickname: string
    roomCode: string | null
    myFaction: Faction | null
    isSpectator: boolean
    /** 对局模式 */
    mode: GameMode
    /** 斗地主：本地玩家执哪一方 */
    landlordSide: 'landlord' | 'farmers' | null

    // 游戏状态
    gameState: GameStateClientView | null
    winnerFaction: Faction | null
    /** 左右手对弈：同屏两方各自的视角 */
    hotseat: boolean
    hotseatViews: { warm: GameStateClientView | null; cool: GameStateClientView | null } | null

    // 选牌状态（客户端 UI 交互）
    selectedCardIds: string[]
    selectedTargets: number[]

    // 错误信息
    error: string | null

    /** 本地模型正在思考时显示的场景名（如“出牌”），空闲为 null */
    llmThinking: string | null

    // Actions
    setPlayerId: (id: string | null) => void
    setNickname: (n: string) => void
    setRoomCode: (code: string | null) => void
    setMyFaction: (f: Faction | null) => void
    setIsSpectator: (v: boolean) => void
    setMode: (m: GameMode) => void
    setLandlordSide: (s: 'landlord' | 'farmers' | null) => void
    setGameState: (state: GameStateClientView | null) => void
    setWinnerFaction: (f: Faction | null) => void
    setHotseat: (v: boolean) => void
    setHotseatViews: (v: { warm: GameStateClientView | null; cool: GameStateClientView | null } | null) => void
    setError: (msg: string | null) => void
    setLlmThinking: (scene: string | null) => void
    toggleCardSelection: (cardId: string) => void
    toggleTargetSelection: (index: number) => void
    clearSelection: () => void
}

export const useGameStore = create<AppState>((set) => ({
    playerId: null,
    nickname: '',
    roomCode: null,
    myFaction: null,
    isSpectator: false,
    mode: GameMode.CLASSIC,
    landlordSide: null,
    gameState: null,
    winnerFaction: null,
    hotseat: false,
    hotseatViews: null,
    selectedCardIds: [],
    selectedTargets: [],
    error: null,
    llmThinking: null,

    setPlayerId: (id) => set({ playerId: id }),
    setNickname: (n) => set({ nickname: n }),
    setRoomCode: (code) => set({ roomCode: code }),
    setMyFaction: (f) => set({ myFaction: f }),
    setIsSpectator: (v) => set({ isSpectator: v }),
    setMode: (m) => set({ mode: m }),
    setLandlordSide: (s) => set({ landlordSide: s }),
    setGameState: (state) => set({ gameState: state }),
    setWinnerFaction: (f) => set({ winnerFaction: f }),
    setHotseat: (v) => set({ hotseat: v }),
    setHotseatViews: (v) => set({ hotseatViews: v }),
    setError: (msg) => set({ error: msg }),
    setLlmThinking: (scene) => set({ llmThinking: scene }),

    toggleCardSelection: (cardId) =>
        set((s) => ({
            selectedCardIds: s.selectedCardIds.includes(cardId)
                ? s.selectedCardIds.filter((id) => id !== cardId)
                : [...s.selectedCardIds, cardId],
        })),

    toggleTargetSelection: (index) =>
        set((s) => ({
            selectedTargets: s.selectedTargets.includes(index)
                ? s.selectedTargets.filter((i) => i !== index)
                : [...s.selectedTargets, index],
        })),

    clearSelection: () => set({ selectedCardIds: [], selectedTargets: [] }),
}))
