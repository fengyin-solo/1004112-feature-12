import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows, storageAvailable } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 牵引车调度的出车锁定：派出车辆时按牵引车型锁定，先锁定车辆为准，重复调度只生效一次。
const PUSHBACK_KEY = 'pushback'
const PUSHBACK_DISPATCH_ACTION = '派出车辆'
const PUSHBACK_LOCK_FIELD = '锁定车辆'
const PUSHBACK_ACTIVE_STATUSES = ['已就位', '推出中']

// 机位分配清单的推出就绪标记：关联航班的牵引任务越过「待牵引」就算就绪。
const STAND_KEY = 'stand'
const STAND_FLIGHT_FIELD = '匹配航班'
const PUSHBACK_FLIGHT_FIELD = '关联航班'
export const STAND_READY_FIELD = '推出就绪'
const STAND_READY_SOURCE_STATUSES = ['已就位', '推出中', '已完成']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

// 调度前先看环境：运行模式或本地存储拿不到时，宁可不动，也不能覆盖原排班。
function runtimeEnv(): { ok: boolean; reason: string } {
  let mode = ''
  try {
    mode = String(import.meta.env?.MODE ?? '')
  } catch {
    return { ok: false, reason: 'import.meta.env 不可读' }
  }
  if (!mode) {
    return { ok: false, reason: '运行模式 MODE 为空' }
  }
  if (!storageAvailable()) {
    return { ok: false, reason: '本地存储不可用或数据受损' }
  }
  return { ok: true, reason: '' }
}

function vehicleOf(row: EntryRow): string {
  return String(row['牵引车型'] ?? '').trim()
}

function holdsActiveLock(row: EntryRow): boolean {
  // 兼容旧牵引记录：没有「锁定车辆」字段的老数据，按状态认定它仍占着车。
  return PUSHBACK_ACTIVE_STATUSES.includes(String(row.status))
}

function dispatchPushback(rows: EntryRow[], index: number, meta: ModuleMeta): ActionResult {
  const env = runtimeEnv()
  if (!env.ok) {
    return { ok: false, message: `取不到环境信息（${env.reason}），已保留原排班不做覆盖` }
  }
  const row = rows[index]
  const code = String(row['牵引编号'] ?? row.id)
  const vehicle = vehicleOf(row)
  if (!vehicle) {
    return { ok: false, message: `牵引任务 ${code} 缺少牵引车型，无法派出车辆` }
  }
  if (holdsActiveLock(row)) {
    // 重复调度只生效一次：任务已经占着同一辆车，直接确认，不再重复写。
    const locked = String(row[PUSHBACK_LOCK_FIELD] ?? '').trim()
    if (locked === '' || locked === vehicle) {
      return { ok: true, message: `牵引任务 ${code} 已锁定车辆 ${vehicle}，重复调度只生效一次` }
    }
    return { ok: false, message: `牵引任务 ${code} 已锁定车辆 ${locked}，与当前牵引车型 ${vehicle} 不一致` }
  }
  // 出车冲突以先锁定车辆为准：别的任务已经占着这辆车，就拒绝本次派出。
  const holder = rows.find(
    (other, otherIndex) =>
      otherIndex !== index && vehicleOf(other) === vehicle && holdsActiveLock(other),
  )
  if (holder) {
    const holderCode = String(holder['牵引编号'] ?? holder.id)
    return { ok: false, message: `车辆 ${vehicle} 已被牵引编号 ${holderCode} 先锁定，出车冲突以先锁定车辆为准` }
  }
  const target = meta.actionTargets[PUSHBACK_DISPATCH_ACTION]
  const updated: EntryRow = {
    ...row,
    status: target,
    pending: true,
    abnormal: false,
    [PUSHBACK_LOCK_FIELD]: vehicle,
  }
  const next = [...rows]
  next[index] = updated
  saveRows(PUSHBACK_KEY, next)
  return { ok: true, message: `牵引任务 ${code} 已派出车辆并锁定 ${vehicle}，当前状态「${target}」` }
}

function readyFlights(): Set<string> {
  const flights = listRows(PUSHBACK_KEY)
    .filter((row) => STAND_READY_SOURCE_STATUSES.includes(String(row.status)))
    .map((row) => String(row[PUSHBACK_FLIGHT_FIELD] ?? '').trim())
    .filter((flight) => flight !== '')
  return new Set(flights)
}

// 机位分配清单的推出就绪标记：在数据层统一计算，哪个页面取清单都是同一份结果。
export function withStandReadiness(rows: EntryRow[]): EntryRow[] {
  const ready = readyFlights()
  return rows.map((row) => ({
    ...row,
    [STAND_READY_FIELD]: ready.has(String(row[STAND_FLIGHT_FIELD] ?? '').trim()) ? '就绪' : '未就绪',
  }))
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  const items = key === STAND_KEY ? withStandReadiness(matched) : matched
  return { items, total: items.length, page: 1, size: items.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  if (key === PUSHBACK_KEY && action === PUSHBACK_DISPATCH_ACTION) {
    return dispatchPushback(rows, index, meta)
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  if (key === PUSHBACK_KEY && target === lastStatus) {
    // 确认完成后释放车辆锁定，后续任务可以再用这辆车。
    delete updated[PUSHBACK_LOCK_FIELD]
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  // 机位分配清单导出时同样带上推出就绪标记，和页面看到的保持一致。
  const fields = key === STAND_KEY ? [...meta.fields, STAND_READY_FIELD] : meta.fields
  const rows = key === STAND_KEY ? withStandReadiness(listRows(key)) : listRows(key)
  const header = ['编号', ...fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of rows) {
    lines.push([row.id, ...fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    const summary: OverviewResult['modules'][number] = {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
    if (meta.key === STAND_KEY) {
      // 概览页同步推出就绪标记：机位分配模块给出已就绪的机位数量。
      summary.ready = withStandReadiness(entries).filter(
        (row) => row[STAND_READY_FIELD] === '就绪',
      ).length
    }
    return summary
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
