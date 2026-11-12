/** 动效时长（毫秒）。节奏参照 sgs-unity：位移 300ms、连线生长 300ms、停留 800ms、尾部回缩 200ms */
export const DUR = {
    card: 300,
    gather: 220,
    lineGrow: 300,
    lineHold: 800,
    lineRetract: 200,
    float: 700,
    gem: 240,
} as const

export const EASE = {
    /** 发牌/入场：快出慢收 */
    deal: 'cubic-bezier(0.16, 1, 0.3, 1)',
    /** 位移：接近匀减速 */
    move: 'cubic-bezier(0.33, 1, 0.68, 1)',
    /** 收尾 */
    out: 'cubic-bezier(0.4, 0, 1, 1)',
} as const
