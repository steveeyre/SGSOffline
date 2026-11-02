/** 单机引擎随机源：固定种子即可完整复现一局，便于回归测试与 bug 复现 */

let seed = 0x2f6e2b1
let cursor = seed

/** 设定随机种子并重置随机序列 */
export function setRandomSeed(next: number): void {
    seed = next >>> 0
    cursor = seed === 0 ? 0x9e3779b9 : seed
}

/** 当前种子（配合全新对局可复现整局） */
export function getRandomSeed(): number {
    return seed
}

/** 生成新种子（仅开局使用，真随机） */
export function newRandomSeed(): number {
    return Math.floor(Math.random() * 0x100000000) >>> 0
}

/** mulberry32：小而稳定、可序列化的伪随机数发生器 */
export function random(): number {
    cursor = (cursor + 0x6d2b79f5) | 0
    let t = Math.imul(cursor ^ (cursor >>> 15), 1 | cursor)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export function randomInt(maxExclusive: number): number {
    if (maxExclusive <= 0) return 0
    return Math.floor(random() * maxExclusive)
}

/** Fisher-Yates 原地洗牌 */
export function shuffleInPlace<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
        const j = randomInt(i + 1)
        const tmp = items[i]
        items[i] = items[j]
        items[j] = tmp
    }
    return items
}
