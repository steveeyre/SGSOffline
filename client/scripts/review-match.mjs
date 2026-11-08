#!/usr/bin/env node
/**
 * 按复盘 ID 从导出的对局日志里取出完整上下文，输出成可直接粘贴给模型/人的 Markdown。
 *
 * 用法：
 *   node scripts/review-match.mjs matchlogs.json                列出所有对局
 *   node scripts/review-match.mjs matchlogs.json <matchId>      输出整局摘要
 *   node scripts/review-match.mjs matchlogs.json d12 a3 ...     输出指定决策/操作（可批量）
 *
 * ID 规则：对局 m{开局时间36}-{种子36}；操作 .a{seq}；决策 .d{seq}；日志 .l{seq}。
 */
import { readFileSync } from 'node:fs'

const [, , file, ...ids] = process.argv
if (!file) {
    console.error('用法：node scripts/review-match.mjs <对局日志.json> [ID...]')
    process.exit(1)
}

let records
try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    records = Array.isArray(parsed) ? parsed : [parsed]
} catch (err) {
    console.error(`读取失败：${err?.message ?? err}`)
    process.exit(1)
}

function recordId(record) {
    if (record.id) return record.id
    const seed = ((record.seed ?? 0) >>> 0).toString(36)
    return `m${(record.startedAt ?? 0).toString(36)}-${seed}`
}

function splitId(id) {
    const dot = id.lastIndexOf('.')
    if (dot < 0) return { matchId: id, kind: null, seq: null }
    return {
        matchId: id.slice(0, dot),
        kind: id.slice(dot + 1, dot + 2),
        seq: Number(id.slice(dot + 2)),
    }
}

function fmtTime(ms) {
    if (!ms) return '未知'
    const d = new Date(ms)
    const pad = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function listMatches() {
    if (records.length === 0) {
        console.log('没有对局记录。')
        return
    }
    for (const record of records) {
        const decisions = record.decisions?.length ?? 0
        const actions = record.actions?.length ?? 0
        console.log([
            recordId(record),
            record.mode ?? '?',
            `seed=${record.seed ?? '?'}`,
            fmtTime(record.startedAt),
            record.winner ? `胜方=${record.winner}` : '未结束',
            `决策 ${decisions} / 操作 ${actions}`,
        ].join('  |  '))
    }
}

function decideCandidateRows(decision) {
    const candidates = [...(decision.candidates ?? [])]
    if (candidates.length === 0) return ['  （没有记录候选）']
    candidates.sort((a, b) => (b.finalScore ?? b.score ?? 0) - (a.finalScore ?? a.score ?? 0))
    return candidates.map((c) => {
        const score = c.finalScore !== undefined && c.finalScore !== c.score
            ? `${c.score} → ${c.finalScore}`
            : String(c.score ?? '?')
        return `  ${c.chosen ? '✓' : ' '} [${score}] ${c.ruleId ?? '?'} — ${c.label ?? c.id ?? ''}`
    })
}

function snapshotLines(snapshot) {
    if (!snapshot) return ['  （没有局面快照）']
    const lines = [
        `  回合 ${snapshot.round} / 行动序号 ${snapshot.turnSerial} / ${snapshot.phase}·${snapshot.turnPhase} / 当前座次 ${snapshot.activeSeat}`,
        `  牌堆 ${snapshot.deckCount} 张 / 本回合已用杀 ${snapshot.attackUsed} / 弃牌堆顶 ${snapshot.discardTop ?? '无'}`,
    ]
    for (const seat of snapshot.seats ?? []) {
        lines.push(
            `  座位${seat.seat} ${seat.name}（${seat.faction}/${seat.role}）`
            + ` ${seat.hp}/${seat.maxHp} 手牌${seat.handCount}张 [${(seat.hand ?? []).join(' ')}]`
            + ` 装备[${(seat.equip ?? []).join(' ')}] 判定[${(seat.judge ?? []).join(' ')}]`
            + `${seat.chained ? ' 横置' : ''}${seat.alive ? '' : ' 已阵亡'}`,
        )
    }
    return lines
}

function printDecision(record, decision) {
    console.log(`## ${recordId(record)}.d${decision.seq}  ${decision.actor ?? '?'}（${decision.kind}/${decision.source}）`)
    console.log(`计划：${decision.plan ?? '无'}`)
    if (decision.events?.length) console.log(`关键事件：${decision.events.join(', ')}`)
    console.log('候选（按最终分排序）：')
    console.log(decideCandidateRows(decision).join('\n'))
    if (decision.chosen) {
        const chosen = decision.chosen
        console.log(`实际选择：${chosen.label ?? chosen.id ?? '?'}（${chosen.ruleId ?? '?'}）`)
    }
    console.log('局面快照：')
    console.log(snapshotLines(decision.snapshot).join('\n'))
    console.log('引擎日志：')
    console.log((decision.logs ?? []).map((text) => `  - ${text}`).join('\n') || '  （无）')
}

function printAction(record, action) {
    console.log(`## ${recordId(record)}.a${action.seq}  ${action.actor ?? '?'}（${action.kind}）`)
    console.log(`第 ${action.round} 大回合 / 行动序号 ${action.turnSerial} / ${action.phase} / ${action.side}`)
    if (action.payload !== undefined) {
        console.log(`操作参数：${JSON.stringify(action.payload)}`)
    }
    if (action.error) console.log(`失败原因：${action.error}`)
    console.log('引擎日志：')
    console.log((action.logs ?? []).map((text) => `  - ${text}`).join('\n') || '  （无）')
}

function printRecordHeader(record) {
    console.log(`# 对局 ${recordId(record)}`)
    console.log(`模式 ${record.mode ?? '?'} / 种子 ${record.seed ?? '?'} / 开始 ${fmtTime(record.startedAt)}`
        + ` / ${record.winner ? `胜方 ${record.winner}` : '未结束'}`)
    if (record.generals?.length) {
        console.log('武将：' + record.generals
            .map((g) => `座位${g.seat} ${g.name}(${g.faction}/${g.role})`)
            .join('  '))
    }
}

for (const id of ids) {
    const { matchId, kind, seq } = splitId(id)
    const record = records.find((r) => recordId(r) === matchId)
    if (!record) {
        console.error(`找不到对局 ${matchId}`)
        continue
    }
    console.log('')
    if (!kind) {
        printRecordHeader(record)
        continue
    }
    if (kind === 'd') {
        const decision = (record.decisions ?? []).find((d) => d.seq === seq)
        if (!decision) {
            console.error(`${id}：没有这条决策（现有 ${record.decisions?.length ?? 0} 条）`)
            continue
        }
        printRecordHeader(record)
        printDecision(record, decision)
    } else if (kind === 'a') {
        const action = (record.actions ?? []).find((a) => a.seq === seq)
        if (!action) {
            console.error(`${id}：没有这条操作（现有 ${record.actions?.length ?? 0} 条）`)
            continue
        }
        printRecordHeader(record)
        printAction(record, action)
    } else if (kind === 'l') {
        console.log(`${id}：这条日志没有归属到操作或决策，无法从导出记录里还原上下文。`)
    } else {
        console.error(`${id}：无法识别的 ID 类型 .${kind}`)
    }
}

if (ids.length === 0) listMatches()
