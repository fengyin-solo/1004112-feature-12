// 牵引车车辆锁台账：单独存一个 localStorage 键，只记「任务id -> 牵引车型」。
// 与排班数据（airport-ground-handling:entries）物理隔离，锁逻辑出问题也不会覆盖原排班。
const LOCK_KEY = 'airport-ground-handling:pushback-locks'

export function readLocks(): Record<string, string> {
  if (typeof window === 'undefined' || !window.localStorage) {
    return {}
  }
  const raw = window.localStorage.getItem(LOCK_KEY)
  if (!raw) {
    return {}
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const result: Record<string, string> = {}
      for (const [taskId, vehicle] of Object.entries(parsed as Record<string, unknown>)) {
        result[String(taskId)] = String(vehicle)
      }
      return result
    }
  } catch {
    // 锁台账损坏时不当作排班异常，忽略即可；冲突判断仍可用旧牵引记录兜底。
  }
  return {}
}

export function writeLocks(locks: Record<string, string>): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  window.localStorage.setItem(LOCK_KEY, JSON.stringify(locks))
}

export function lockStorageKey(): string {
  return LOCK_KEY
}
