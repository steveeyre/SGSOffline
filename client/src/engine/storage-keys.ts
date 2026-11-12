/**
 * localStorage 键名统一使用 sgsoffline. 前缀。早期版本用的是项目旧名 sgs3v3，
 * 升级后首次读取时把旧键内容搬到新键再删掉旧键，避免续局存档、对局日志、
 * 复盘清单在改名后凭空消失。
 */

const NEW_PREFIX = 'sgsoffline.'
const LEGACY_PREFIX = 'sgs3v3.'

function legacyKeyFor(key: string): string | null {
    return key.startsWith(NEW_PREFIX) ? LEGACY_PREFIX + key.slice(NEW_PREFIX.length) : null
}

/** 读键：新键缺失时回退旧键，并把它迁到新键 */
export function readStorageItem(store: Storage, key: string): string | null {
    const raw = store.getItem(key)
    if (raw !== null) return raw
    const legacy = legacyKeyFor(key)
    if (!legacy) return null
    const old = store.getItem(legacy)
    if (old === null) return null
    try {
        store.setItem(key, old)
        store.removeItem(legacy)
    } catch {
        // 配额不足导致迁移失败时仍返回旧值，至少本次读取不受影响
    }
    return old
}

/** 删键：新旧两处一起清，否则旧键会在下一次读取时被迁回来 */
export function removeStorageItem(store: Storage, key: string): void {
    store.removeItem(key)
    const legacy = legacyKeyFor(key)
    if (legacy) store.removeItem(legacy)
}
