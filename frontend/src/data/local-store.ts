import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'airport-ground-handling:entries'

// 存储是否可信：读不出来、写不进去都视为环境缺失，之后只动内存，绝不写回覆盖原排班。
let storageHealthy = true

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function localStore(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return null
    }
    return window.localStorage
  } catch {
    return null
  }
}

function persist(rows: Record<string, EntryRow[]>): boolean {
  const store = localStore()
  if (!store) {
    storageHealthy = false
    return false
  }
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(rows))
    storageHealthy = true
    return true
  } catch {
    storageHealthy = false
    return false
  }
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  const store = localStore()
  if (!store) {
    storageHealthy = false
    return fallback
  }
  const raw = store.getItem(STORAGE_KEY)
  if (!raw) {
    persist(fallback)
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    // 兼容既有排班：老数据里缺的新模块用示例数据补齐，已有的记录原样保留。
    return { ...fallback, ...parsed }
  } catch {
    // 既有排班解析失败（数据受损或环境异常）：只用示例数据顶班，绝不写回覆盖原排班。
    storageHealthy = false
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  // 取不到环境信息（存储不可用或已受损）时只更新内存，不得覆盖原排班。
  if (storageHealthy) {
    persist(next)
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  cache = { ...allRows(), [key]: rows }
  // 重置是用户主动恢复：尝试写回，写成功则存储恢复健康。
  persist(cache)
  return rows
}

export function storageAvailable(): boolean {
  return storageHealthy && localStore() !== null
}

export function storageKey(): string {
  return STORAGE_KEY
}
