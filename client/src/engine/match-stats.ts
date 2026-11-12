import { listMatchLogs, type MatchLogRecord } from './match-log'

/** 对局记录聚合：只读本机保存的 match-log，不做任何写入 */
export interface ModeStats {
    mode: string
    total: number
    wins: number
    losses: number
}

export interface GeneralStats {
    id: string
    name: string
    games: number
    wins: number
}

export interface RecentMatch {
    id: string
    mode: string
    endedAt: number
    win: boolean | null
    seed: number | null
    generals: string[]
}

export interface MatchStats {
    total: number
    decided: number
    wins: number
    losses: number
    byMode: ModeStats[]
    generals: GeneralStats[]
    recent: RecentMatch[]
}

const MODE_NAMES: Record<string, string> = {
    classic: '统率三军',
    doudizhu: '斗地主',
    huanle_shuang: '欢乐成双',
    hotseat: '本地对战',
}

export function matchModeName(mode: string): string {
    return MODE_NAMES[mode] ?? mode
}

/** 玩家这一局的胜负；旧记录没有 humanFaction 时无法判定 */
export function matchRecordWin(record: MatchLogRecord): boolean | null {
    if (!record.winner || !record.humanFaction) return null
    return record.winner === record.humanFaction
}

export function computeMatchStats(records: MatchLogRecord[] = listMatchLogs()): MatchStats {
    const byMode = new Map<string, ModeStats>()
    const generals = new Map<string, GeneralStats>()
    let wins = 0
    let losses = 0
    let decided = 0

    for (const record of records) {
        const win = matchRecordWin(record)
        if (win !== null) {
            decided++
            if (win) wins++
            else losses++
        }
        const mode = byMode.get(record.mode) ?? { mode: record.mode, total: 0, wins: 0, losses: 0 }
        mode.total++
        if (win === true) mode.wins++
        if (win === false) mode.losses++
        byMode.set(record.mode, mode)

        // 只统计玩家自己阵营的武将，避免把 AI 的武将算进出场率
        if (!record.humanFaction) continue
        for (const g of record.generals) {
            if (g.faction !== record.humanFaction) continue
            const entry = generals.get(g.id) ?? { id: g.id, name: g.name, games: 0, wins: 0 }
            entry.games++
            if (win === true) entry.wins++
            generals.set(g.id, entry)
        }
    }

    return {
        total: records.length,
        decided,
        wins,
        losses,
        byMode: [...byMode.values()].sort((a, b) => b.total - a.total),
        generals: [...generals.values()]
            .sort((a, b) => b.games - a.games || b.wins - a.wins)
            .slice(0, 40),
        recent: records
            .map((record) => ({
                id: record.id,
                mode: record.mode,
                endedAt: record.endedAt ?? record.startedAt,
                win: matchRecordWin(record),
                seed: record.seed,
                generals: record.generals
                    .filter((g) => !record.humanFaction || g.faction === record.humanFaction)
                    .map((g) => g.name),
            }))
            .sort((a, b) => b.endedAt - a.endedAt)
            .slice(0, 20),
    }
}

/** 单局记录：复盘页按 ID 取 */
export function getMatchRecord(id: string): MatchLogRecord | null {
    return listMatchLogs().find((record) => record.id === id) ?? null
}
