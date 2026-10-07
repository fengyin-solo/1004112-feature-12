import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'
import { readLocks, writeLocks } from './pushback-locks'
import {
  ACTIVE_STATUSES,
  decidePushbackAction,
  reconcileLocks,
} from './pushback-rules'
import type { PushbackEnv } from './pushback-rules'
import { currentPushbackEnv } from './runtime-env'
import { readinessByStandRef, readyStandCount, standReadiness } from './stand-readiness'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

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

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
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
  // 牵引车调度走专用规则：车辆锁冲突、重复调度幂等、环境信息校验都在规则层。
  if (key === 'pushback') {
    return runPushbackAction(rows, index, action, currentPushbackEnv())
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
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

// 牵引车动作唯一写入口：先跑纯规则，规则说改才改；任何拒绝分支都不会触碰原排班。
function runPushbackAction(
  rows: EntryRow[],
  index: number,
  action: string,
  env: PushbackEnv | null,
): ActionResult {
  const currentLocks = reconcileLocks(rows, readLocks())
  const decision = decidePushbackAction({
    row: rows[index],
    rows,
    locks: currentLocks,
    action,
    env,
  })
  if (!decision.ok || !decision.effect) {
    return { ok: false, message: decision.message }
  }
  const updated: EntryRow = {
    ...rows[index],
    status: decision.effect.status,
    pending: decision.effect.pending,
  }
  const next = [...rows]
  next[index] = updated
  saveRows('pushback', next)
  // 锁台账独立持久化，绝不写进排班记录。
  const reconciled = reconcileLocks(next, decision.effect.locks)
  writeLocks(reconciled)
  return { ok: true, message: decision.message }
}

// 重置牵引车排班时由 resetModule 顺带清掉锁台账，保证回到示例数据后没有孤儿锁。
// 供页面展示车辆占用情况：台账锁 + 旧牵引记录（兼容历史数据）。
export function pushbackVehicleMap(): { taskId: number; vehicle: string; source: 'lock' | 'legacy'; status: string }[] {
  const rows = listRows('pushback')
  const locks = reconcileLocks(rows, readLocks())
  const result: { taskId: number; vehicle: string; source: 'lock' | 'legacy'; status: string }[] = []
  for (const [taskId, vehicle] of Object.entries(locks)) {
    const owner = rows.find((row) => Number(row.id) === Number(taskId))
    result.push({
      taskId: Number(taskId),
      vehicle,
      source: 'lock',
      status: owner ? String(owner.status) : '',
    })
  }
  for (const row of rows) {
    const taskId = Number(row.id)
    const vehicle = String(row['牵引车型'] ?? '').trim()
    if (
      ACTIVE_STATUSES.includes(String(row.status)) &&
      vehicle !== '' &&
      !Object.prototype.hasOwnProperty.call(locks, String(taskId))
    ) {
      result.push({ taskId, vehicle, source: 'legacy', status: String(row.status) })
    }
  }
  return result
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  if (key === 'pushback') {
    writeLocks({})
  }
  return listEntries(key)
}

export { readyStandCount, standReadiness, readinessByStandRef }

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
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
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
      // 机位分配清单同步推出就绪标记，概览上直接给出就绪机位数量。
      ready: meta.key === 'stand' ? entries.filter((row) => standReadiness(row).ready).length : undefined,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
