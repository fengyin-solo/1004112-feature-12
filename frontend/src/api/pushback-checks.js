// 牵引车调度本地开发校验：跑的是 seed.js 里的同一套示例数据，用的是 pushback-rules.js 里同一套规则。
// 浏览器「本地校验」入口（pushback 页面 dev 面板）和 scripts/validate-pushback.mjs 都调用本文件，
// 因此本地开发、npm run build、上线镜像构建三个阶段的校验结果完全一致。
import { SEED_ROWS } from '../data/seed.js'
import {
  checkEnvironment,
  checkRequiredFields,
  decidePushbackAction,
  findVehicleHolder,
  reconcileLocks,
} from './pushback-rules.js'
import { evaluateStandReadiness, findStandReadiness } from './stand-rules.js'

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

// 模拟一次完整动作：返回决策结果以及模拟后的任务清单 / 锁台账（不改 seed 原对象）。
function simulate(rows, locks, taskId, action, env) {
  const index = rows.findIndex((row) => Number(row.id) === Number(taskId))
  const row = index >= 0 ? rows[index] : undefined
  const decision = decidePushbackAction({ row, rows, locks, action, env })
  let nextRows = rows
  let nextLocks = locks
  if (decision.ok && decision.effect) {
    nextRows = clone(rows)
    nextRows[index] = { ...nextRows[index], status: decision.effect.status, pending: decision.effect.pending }
    nextLocks = reconcileLocks(nextRows, decision.effect.locks)
  }
  return { decision, rows: nextRows, locks: nextLocks }
}

export const VALID_ENV = { operator: '本地校验-值班管理员', shift: '白班 08:00-20:00' }

// 每条校验：name 通过条件、check 返回 boolean、detail 给出说明。
export function runPushbackChecks() {
  const checks = []
  const pushback = clone(SEED_ROWS.pushback || [])
  const stand = clone(SEED_ROWS.stand || [])
  const add = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail })

  // 1. 示例数据关键字段齐全：牵引编号、关联航班、牵引车型、操作人员、牵引状态。
  const fieldChecks = pushback.map((row) => ({
    id: Number(row.id),
    code: String(row['牵引编号'] ?? ''),
    result: checkRequiredFields(row),
  }))
  add(
    '示例数据五个关键字段（牵引编号/关联航班/牵引车型/操作人员/牵引状态）齐全',
    fieldChecks.every((item) => item.result.ok),
    fieldChecks
      .filter((item) => !item.result.ok)
      .map((item) => `${item.code || item.id} 缺 ${item.result.missing.join('、')}`)
      .join('；') || `共 ${pushback.length} 条牵引示例，字段全部齐全`,
  )

  // 2. 环境信息：齐全时放行，缺失时必须拒绝。
  const envOk = checkEnvironment(VALID_ENV)
  const envBad = checkEnvironment(null)
  const envPartial = checkEnvironment({ operator: '只有操作员' })
  add(
    '环境信息齐全时允许调度',
    envOk.ok,
    envOk.ok ? '操作人员与值班时段均已取到' : `缺少 ${envOk.missing.join('、')}`,
  )
  add(
    '环境信息取不到时拒绝且不覆盖排班',
    !envBad.ok && !envPartial.ok,
    `空环境缺 ${envBad.missing.join('、')}；残缺环境缺 ${envPartial.missing.join('、')}`,
  )

  // 3. 出车冲突以先锁定车辆为准：先派出 PUSH-0001 锁车，再派同车型的 PUSH-0004 必须被拒。
  const first = simulate(pushback, {}, 1, '派出车辆', VALID_ENV)
  const second = simulate(first.rows, first.locks, 4, '派出车辆', VALID_ENV)
  const holder = findVehicleHolder(pushback, first.locks, pushback.find((r) => Number(r.id) === 4)['牵引车型'], 4)
  add(
    '先派出 PUSH-0001 成功锁定牵引车型',
    first.decision.ok && first.decision.effect.lockedBy === 1,
    first.decision.message,
  )
  add(
    '同车型的 PUSH-0004 再出车被判定为冲突（先锁定车辆为准）',
    !second.decision.ok && second.decision.code === 'VEHICLE_LOCKED' && holder && holder.taskId === 1,
    second.decision.message,
  )
  add(
    '冲突被拒后原排班与锁台账保持不变',
    second.rows === first.rows && second.locks === first.locks &&
      String(second.rows.find((r) => Number(r.id) === 4).status) === '待牵引',
    'PUSH-0004 仍为「待牵引」，锁台账仍只记录 PUSH-0001',
  )

  // 4. 重复调度只生效一次：对同一条任务连续两次「派出车辆」，第二次必须幂等拒绝。
  const repeat = simulate(first.rows, first.locks, 1, '派出车辆', VALID_ENV)
  add(
    '重复调度只生效一次（同任务重复派出被幂等拒绝）',
    !repeat.decision.ok && repeat.decision.code === 'DUPLICATE' && repeat.rows === first.rows,
    repeat.decision.message,
  )

  // 5. 完整流转 + 锁释放：派出 -> 开始推出 -> 确认完成，完成后车辆允许被同车型的其它任务再锁定。
  const start = simulate(first.rows, first.locks, 1, '开始推出', VALID_ENV)
  const finish = simulate(start.rows, start.locks, 1, '确认完成', VALID_ENV)
  const afterFinish = simulate(finish.rows, finish.locks, 4, '派出车辆', VALID_ENV)
  add(
    '完整流转「已就位 -> 推出中 -> 已完成」全部成功',
    start.decision.ok && finish.decision.ok &&
      String(finish.rows.find((r) => Number(r.id) === 1).status) === '已完成',
    `开始推出：${start.decision.ok}；确认完成：${finish.decision.ok}`,
  )
  add(
    '确认完成后释放车辆锁，同车型其它任务可再派出',
    afterFinish.decision.ok && afterFinish.decision.effect.lockedBy === 4,
    afterFinish.decision.message,
  )

  // 6. 兼容旧牵引记录：没有锁台账时，已就位/推出中的旧记录仍参与车辆冲突判断。
  const legacyRows = [
    { id: 101, status: '推出中', pending: false, abnormal: false, 牵引编号: 'OLD-1', 关联航班: 'CA001', 牵引车型: '旧型车-A', 操作人员: '甲', 牵引状态: '推出中' },
    { id: 102, status: '待牵引', pending: true, abnormal: false, 牵引编号: 'NEW-1', 关联航班: 'CA002', 牵引车型: '旧型车-A', 操作人员: '乙', 牵引状态: '待牵引' },
  ]
  const legacyAttempt = simulate(legacyRows, {}, 102, '派出车辆', VALID_ENV)
  add(
    '无锁台账时旧牵引记录仍触发车辆冲突（兼容历史数据）',
    !legacyAttempt.decision.ok && legacyAttempt.decision.code === 'VEHICLE_LOCKED' &&
      legacyAttempt.rows === legacyRows,
    legacyAttempt.decision.message,
  )

  // 7. 兼容字段缺失的旧记录：缺字段时拒绝并说明，不用空值覆盖。
  const brokenRows = [
    { id: 201, status: '待牵引', pending: true, abnormal: false, 牵引编号: 'OLD-X', 关联航班: '', 牵引车型: '旧型车-B', 操作人员: '丙', 牵引状态: '待牵引' },
  ]
  const brokenAttempt = simulate(brokenRows, {}, 201, '派出车辆', VALID_ENV)
  add(
    '字段缺失的旧牵引记录被拒绝且保留原排班',
    !brokenAttempt.decision.ok && brokenAttempt.decision.code === 'FIELD_MISSING' &&
      brokenAttempt.rows === brokenRows,
    brokenAttempt.decision.message,
  )

  // 8. 机位就绪标记：同一口径在清单与跨页面反查中结果一致。
  const standResults = stand.map((row) => ({ code: String(row['机位编号'] ?? row.id), ...evaluateStandReadiness(row) }))
  const readyStands = standResults.filter((item) => item.ready)
  const readyRef = findStandReadiness(stand, 'STAN-0004')
  const flightRef = findStandReadiness(stand, 'CA1858')
  add(
    '机位分配清单可推出就绪标记',
    readyStands.length >= 1 && readyRef.ready && flightRef.ready,
    `就绪机位：${readyStands.map((item) => item.code).join('、') || '无'}；按机位号与按航班反查结果一致：${readyRef.ready === flightRef.ready}`,
  )
  add(
    '未就绪机位给出明确原因（不同步伪造成就绪）',
    standResults.filter((item) => !item.ready).every((item) => item.reason) &&
      !findStandReadiness(stand, '不存在的机位').ready,
    standResults
      .filter((item) => !item.ready)
      .map((item) => `${item.code}=${item.reason}`)
      .join('；'),
  )

  const passed = checks.filter((item) => item.ok).length
  return {
    checks,
    passed,
    failed: checks.length - passed,
    sampleSize: { pushback: pushback.length, stand: stand.length },
    ok: checks.every((item) => item.ok),
  }
}

export function formatReport(result) {
  const lines = []
  lines.push('牵引车调度本地开发校验')
  lines.push(`示例数据：牵引任务 ${result.sampleSize.pushback} 条，机位 ${result.sampleSize.stand} 条（src/data/seed.js）`)
  lines.push('')
  result.checks.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.ok ? 'PASS' : 'FAIL'}  ${item.name}`)
    lines.push(`    ${item.detail}`)
  })
  lines.push('')
  lines.push(`结果：${result.passed}/${result.checks.length} 通过${result.failed ? `，${result.failed} 条失败` : ''}`)
  return lines.join('\n')
}
