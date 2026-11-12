import { Faction } from 'sgs3v3-shared'
import { getGeneralById } from './generals'
import { draftScore } from './local-ai'
import { POSITION_ROLE_BY_ID, roleOfGeneral } from './position-roles'
import {
    bestDeployment, firstFlankOf, pickValue, positionScore, rankDeployments,
    secondFlankOf, teamValue, traitsOf,
} from './position-score'

function d(id: string) {
    const def = getGeneralById(id)
    if (!def) throw new Error(`缺少武将 ${id}`)
    return def
}

function ctx(faction: Faction, pickStep = 0, team: string[] = [], rival: string[] = []) {
    return { faction, pickStep, team: team.map(d), rival: rival.map(d) }
}

let failures = 0
function check(label: string, ok: boolean, detail = '') {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `（${detail}）`}`)
    if (!ok) failures++
}

console.log('[位置事实]')
check('冷方先行动前锋是 A', firstFlankOf(Faction.COOL) === 'flankA')
check('暖方先行动前锋是 B', firstFlankOf(Faction.WARM) === 'flankB')
check('暖方后行动前锋是 A', secondFlankOf(Faction.WARM) === 'flankA')
check('张飞前锋分高于主帅', positionScore(d('zhangfei'), 'flankA', ctx(Faction.COOL)).total >
    positionScore(d('zhangfei'), 'commander', ctx(Faction.COOL)).total)
check('华佗主帅分高于前锋', positionScore(d('huatuo'), 'commander', ctx(Faction.COOL)).total >
    positionScore(d('huatuo'), 'flankA', ctx(Faction.COOL)).total)
check('张辽冷主分高于冷边锋', positionScore(d('zhangliao'), 'commander', ctx(Faction.COOL)).total >
    positionScore(d('zhangliao'), 'flankB', ctx(Faction.COOL)).total)
check('暖方先手前锋拿 B 位加成', positionScore(d('zhangfei'), 'flankB', ctx(Faction.WARM)).total >
    positionScore(d('zhangfei'), 'flankA', ctx(Faction.WARM)).total)
check('冷方先手前锋拿 A 位加成', positionScore(d('zhangfei'), 'flankA', ctx(Faction.COOL)).total >
    positionScore(d('zhangfei'), 'flankB', ctx(Faction.COOL)).total)

console.log('[部署枚举]')
{
    const team = ['huatuo', 'lvbu_jing', 'huanggai'].map(d)
    const ranked = rankDeployments(team, ctx(Faction.COOL))
    check('三人部署有 6 种排列', ranked.length === 6, String(ranked.length))
    check('辅助坐主帅', ranked[0].assignment.commander?.id === 'huatuo',
        ranked[0].positions.map((p) => `${p.position}:${p.total.toFixed(1)}`).join(' '))
    check('两名输出占前锋',
        [ranked[0].assignment.flankA?.id, ranked[0].assignment.flankB?.id].sort().join() ===
        ['huanggai', 'lvbu_jing'].sort().join())
    check('最佳方案分数最高', ranked[0].total >= ranked[ranked.length - 1].total)
}

console.log('[抓将边际]')
{
    const empty = ctx(Faction.WARM, 0)
    const guojia = pickValue(d('guojia'), empty)
    check('郭嘉的最佳位置是主帅', guojia.bestPosition === 'commander', String(guojia.bestPosition))
    check('首抓郭嘉提升部署价值', guojia.deployGain > 0, guojia.deployGain.toFixed(2))
    check('郭嘉进队后仍是主帅',
        bestDeployment([d('guojia')], ctx(Faction.WARM, 0)).assignment.commander?.id === 'guojia')
    check('八人池深度价值高于三人',
        teamValue(['guojia', 'huatuo', 'zhangfei', 'lvbu', 'huanggai', 'sunquan', 'daqiao', 'simayi'].map(d), ctx(Faction.COOL)) >
        teamValue(['guojia', 'huatuo', 'zhangfei'].map(d), ctx(Faction.COOL)))
}

console.log('[能力向量]')
{
    const zhangfei = traitsOf(d('zhangfei'))
    const huatuo = traitsOf(d('huatuo'))
    check('张飞输出高于华佗', zhangfei.offense > huatuo.offense, `${zhangfei.offense} / ${huatuo.offense}`)
    check('华佗辅助高于张飞', huatuo.support > zhangfei.support, `${huatuo.support} / ${zhangfei.support}`)
    check('三血武将更脆弱', traitsOf(d('zhenji')).fragile > traitsOf(d('xiahoudun')).fragile)
}

console.log('[位置职责校准]')
{
    const cold = (id: string, pos: 'commander' | 'flankA' | 'flankB') =>
        positionScore(d(id), pos, ctx(Faction.COOL)).total
    const warm = (id: string, pos: 'commander' | 'flankA' | 'flankB') =>
        positionScore(d(id), pos, ctx(Faction.WARM)).total

    check('定位表键均对应现有武将', Object.keys(POSITION_ROLE_BY_ID).every((id) => !!getGeneralById(id)))
    check('界大乔定位控制', roleOfGeneral('daqiao_jie') === 'control')
    check('界大乔冷主高于冷边锋', cold('daqiao_jie', 'commander') > cold('daqiao_jie', 'flankB'))
    check('界甘宁冷主高于冷边锋', cold('ganning_jie', 'commander') > cold('ganning_jie', 'flankB'))
    check('界徐晃冷主高于冷边锋', cold('xuhuang_jie', 'commander') > cold('xuhuang_jie', 'flankB'))
    check('文聘冷主高于暖主', cold('wenpin', 'commander') > warm('wenpin', 'commander'))
    check('秦宓冷主高于冷边锋', cold('qinmi', 'commander') > cold('qinmi', 'flankB'))
    check('曹昂冷主高于冷边锋', cold('caoang', 'commander') > cold('caoang', 'flankB'))
    check('界郭嘉暖主高于暖边锋', warm('guojia_jie', 'commander') > warm('guojia_jie', 'flankB'))
    check('界华佗暖主高于暖边锋', warm('huatuo_jie', 'commander') > warm('huatuo_jie', 'flankB'))
    check('界张飞暖B高于暖主', warm('zhangfei_jie', 'flankB') > warm('zhangfei_jie', 'commander'))
    check('吕布竞暖B高于暖主', warm('lvbu_jing', 'flankB') > warm('lvbu_jing', 'commander'))
    check('界张辽冷主分高于冷边锋', cold('zhangliao_jie', 'commander') > cold('zhangliao_jie', 'flankB'))
    check('夏侯惇竞不是冷主（无控制/保护）', cold('xiahoudun_jing', 'flankB') > cold('xiahoudun_jing', 'commander'))
    check('肉盾边锋优先于双主帅', ['caocao', 'sunce', 'sunjian'].every((id) =>
        cold(id, 'flankB') > cold(id, 'commander') && warm(id, 'flankB') > warm(id, 'commander')))
    check('马超不适合主帅（马术也不补）', cold('machao', 'commander') < cold('xiahoudun_jing', 'commander'))
    check('菜刀不当主帅（有辅助时）',
        bestDeployment(['zhangfei', 'machao', 'guojia'].map(d), ctx(Faction.COOL)).assignment.commander?.id === 'guojia')
}

console.log('[抓将评分]')
{
    const score = (id: string, mine: string[] = [], rival: string[] = []) =>
        draftScore(d(id), mine.map(d), rival.map(d), { faction: Faction.COOL, pickStep: 0 }).total
    check('克制：对郭嘉时张辽分更高', score('zhangliao', [], ['guojia']) > score('zhangliao'))
    check('阵容完整：郭嘉在队时优先补边锋', score('zhangfei', ['guojia']) > score('liubei', ['guojia']))
    check('联动：郭嘉在队时张飞分更高', score('zhangfei', ['guojia']) > score('zhangfei'))
}

if (failures > 0) {
    console.error(`位置评分检查失败 ${failures} 项`)
    process.exit(1)
}
console.log('位置评分检查全部通过')
