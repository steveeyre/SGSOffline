import { Faction, type GeneralDefinition } from 'sgs3v3-shared'
import { getGeneralPool, type GeneralPoolVersion } from './generals'
import { POSITION_ROLE_BY_ID, POSITION_ROLE_LABEL, roleOfGeneral } from './position-roles'
import { positionScore, type Position } from './position-score'

const POSITIONS: Position[] = ['commander', 'flankA', 'flankB']
const POS_LABEL: Record<Position, string> = {
    commander: '主帅',
    flankA: '前锋A',
    flankB: '前锋B',
}

const POOLS: Array<{ version: GeneralPoolVersion; label: string }> = [
    { version: 'classic2013', label: '2013 版' },
    { version: 'balance', label: '平衡版' },
    { version: 'balance_ext', label: '平衡扩展版' },
    { version: 'brawl', label: '乱斗版' },
]

type ScoreSet = Record<Position, number>

function scoresFor(def: GeneralDefinition, faction: Faction): ScoreSet {
    return {
        commander: positionScore(def, 'commander', { faction }).total,
        flankA: positionScore(def, 'flankA', { faction }).total,
        flankB: positionScore(def, 'flankB', { faction }).total,
    }
}

function bestOf(scores: ScoreSet): { position: Position; value: number } {
    return POSITIONS
        .map((position) => ({ position, value: scores[position] }))
        .sort((a, b) => b.value - a.value)[0]
}

function fmt(value: number): string {
    return value.toFixed(1)
}

console.log('# 统率三军武将位置评分')
console.log('')
console.log('> 生成命令：`npm run report:position > ../docs/position-scores.md`')
console.log('> 口径：位置适配分，不含武将基础强度（`scoreGeneral`）、配合（`team`）与对位（`rival`）。')
console.log('> 位置职责：冷主帅=先手限制暖二连；暖 B=暖二连先手爆发；冷 B=承接冷四连；暖主帅=回合外支援。')
console.log('> 定位由使用者划定；未登记武将回退旧定位表。')
console.log('> 冷方先行动前锋 A，暖方先行动前锋 B；两套分数按各自先手/后手职责分别计算。')
console.log('> 分数越高，越适合该位置；同分时按武将名称排序。')
console.log('')

for (const pool of POOLS) {
    const generals = getGeneralPool(pool.version)
    const rows = generals.map((def) => {
        const cold = scoresFor(def, Faction.COOL)
        const warm = scoresFor(def, Faction.WARM)
        const coldBest = bestOf(cold)
        const warmBest = bestOf(warm)
        const bestValue = Math.max(...POSITIONS.map((p) => Math.max(cold[p], warm[p])))
        const roles = POSITION_ROLE_BY_ID[def.id]
            ? POSITION_ROLE_LABEL[roleOfGeneral(def.id)]
            : `未登记（${POSITION_ROLE_LABEL[roleOfGeneral(def.id)]}）`
        return { def, cold, warm, coldBest, warmBest, bestValue, roles }
    }).sort((a, b) => b.bestValue - a.bestValue || a.def.name.localeCompare(b.def.name, 'zh'))

    console.log(`## ${pool.label}（${rows.length} 将）`)
    console.log('')
    console.log('| 武将 | 体力 | 定位 | 冷·主帅 | 冷·前锋A | 冷·前锋B | 暖·主帅 | 暖·前锋A | 暖·前锋B | 最佳位置 |')
    console.log('| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |')
    for (const row of rows) {
        const best = `冷 ${POS_LABEL[row.coldBest.position]} / 暖 ${POS_LABEL[row.warmBest.position]}`
        console.log(`| ${row.def.name} \`${row.def.id}\` | ${row.def.maxHp} | ${row.roles} | ${fmt(row.cold.commander)} | ${fmt(row.cold.flankA)} | ${fmt(row.cold.flankB)} | ${fmt(row.warm.commander)} | ${fmt(row.warm.flankA)} | ${fmt(row.warm.flankB)} | ${best} |`)
    }
    console.log('')
    console.log(`> 本池最高位置分：${rows[0]?.def.name ?? '—'}（${rows[0]?.bestValue.toFixed(1) ?? '—'}）`)
    console.log('')
}
