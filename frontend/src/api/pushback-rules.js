// 牵引车调度的纯业务规则：不碰 localStorage、不依赖 Vue / Node API，
// 浏览器里的 local-service 和命令行校验脚本 scripts/validate-pushback.mjs 共用这一份，
// 保证「本地开发校验、构建、上线部署」跑的是同一套示例数据和同一套规则。

// 会锁定车辆的动作：同一台牵引车型只允许被一条任务先锁定。
export const LOCK_ACTIONS = ['派出车辆', '开始推出']
// 任务终态动作：走到这里释放车辆锁。
export const RELEASE_ACTIONS = ['确认完成']
// 仍占用车辆的状态：旧牵引记录即使没有锁台账，也按这些状态参与冲突判断，兼容历史数据。
export const ACTIVE_STATUSES = ['已就位', '推出中']

// 必须取得到的环境信息；取不到时动作直接拒绝，绝不动原排班。
export const ENV_FIELDS = ['operator', 'shift']
// 任务自身必须齐全的关键字段；旧记录字段缺失时给出明确原因，不做覆盖式补齐。
export const REQUIRED_FIELDS = ['牵引编号', '关联航班', '牵引车型', '操作人员', '牵引状态']

function sameVehicle(a, b) {
  const left = String(a ?? '').trim()
  const right = String(b ?? '').trim()
  return left !== '' && left === right
}

// 仅在锁台账与任务状态对不上时修正锁记录，绝不改写任务排班本身。
export function reconcileLocks(rows, locks) {
  const activeTaskIds = new Set(
    rows
      .filter((row) => ACTIVE_STATUSES.includes(String(row.status)))
      .map((row) => Number(row.id)),
  )
  const kept = {}
  for (const [taskId, vehicle] of Object.entries(locks)) {
    if (activeTaskIds.has(Number(taskId))) {
      kept[taskId] = vehicle
    }
  }
  return kept
}

// 先锁定车辆为准：台账锁优先；旧记录没有锁台账时，用活跃任务的牵引车型兜底判断冲突。
export function findVehicleHolder(rows, locks, vehicle, ignoreTaskId) {
  for (const [taskId, lockedVehicle] of Object.entries(locks)) {
    if (Number(taskId) !== Number(ignoreTaskId) && sameVehicle(lockedVehicle, vehicle)) {
      const owner = rows.find((row) => Number(row.id) === Number(taskId))
      return { taskId: Number(taskId), source: 'lock', status: owner ? String(owner.status) : '' }
    }
  }
  const legacy = rows.find(
    (row) =>
      Number(row.id) !== Number(ignoreTaskId) &&
      ACTIVE_STATUSES.includes(String(row.status)) &&
      sameVehicle(row['牵引车型'], vehicle),
  )
  if (legacy) {
    return { taskId: Number(legacy.id), source: 'legacy', status: String(legacy.status) }
  }
  return null
}

// 校验环境信息：缺任一项都返回原因，调用方必须原样拒绝，不允许覆盖原排班。
export function checkEnvironment(env) {
  const missing = ENV_FIELDS.filter((field) => !String((env && env[field]) ?? '').trim())
  return { ok: missing.length === 0, missing }
}

// 校验任务关键字段，兼容旧牵引记录：只指出缺什么，不做任何写入。
export function checkRequiredFields(row) {
  const missing = REQUIRED_FIELDS.filter((field) => !String(row[field] ?? '').trim())
  return { ok: missing.length === 0, missing }
}

// 决策一次牵引车动作。输入由调用方提供：当前任务行、全部任务、锁台账、动作、环境信息。
// 返回结构固定，调用方只在 effect.save 时才写状态、只在 effect.lock/release 时才动锁台账。
export function decidePushbackAction(input) {
  const { row, rows, locks, action, env } = input
  const reject = (code, message) => ({ ok: false, code, message, effect: null })

  if (!row) {
    return reject('NOT_FOUND', '没有找到对应的牵引任务')
  }
  if (!['派出车辆', '开始推出', '确认完成'].includes(action)) {
    return reject('UNKNOWN_ACTION', `牵引任务没有登记「${action}」这个动作`)
  }

  const targetMap = { 派出车辆: '已就位', 开始推出: '推出中', 确认完成: '已完成' }
  const target = targetMap[action]
  const current = String(row.status)

  // 重复调度只生效一次：同一动作重复执行直接拒绝，不产生锁、不改排班。
  if (current === target) {
    return reject('DUPLICATE', `牵引任务已经是「${target}」，重复调度只生效一次`)
  }

  // 取不到环境信息时不得覆盖原排班：在任何写入之前拦截。
  const envCheck = checkEnvironment(env)
  if (!envCheck.ok) {
    return reject(
      'ENV_MISSING',
      `环境信息缺失（${envCheck.missing.join('、')}），已保留原排班未做任何改动`,
    )
  }

  // 兼容旧牵引记录：关键字段缺失时拒绝并说明，不用空值覆盖原记录。
  const fieldCheck = checkRequiredFields(row)
  if (!fieldCheck.ok) {
    return reject(
      'FIELD_MISSING',
      `牵引任务 ${String(row['牵引编号'] ?? row.id)} 缺少关键字段（${fieldCheck.missing.join('、')}），已保留原排班`,
    )
  }

  // 简单的状态顺序约束，避免从终态回跳造成一辆车被二次锁定。
  const order = ['待牵引', '已就位', '推出中', '已完成']
  if (order.indexOf(target) < order.indexOf(current)) {
    return reject('INVALID_FLOW', `当前状态「${current}」不能执行「${action}」，已保留原排班`)
  }

  let nextLocks = locks
  if (LOCK_ACTIONS.includes(action)) {
    // 出车冲突以先锁定车辆为准。
    const holder = findVehicleHolder(rows, locks, row['牵引车型'], row.id)
    if (holder) {
      const via = holder.source === 'lock' ? '已锁定车辆' : '在执行旧牵引记录'
      return reject(
        'VEHICLE_LOCKED',
        `牵引车型「${row['牵引车型']}」已被任务 ${holder.taskId} ${via}（当前「${holder.status || '占用中'}」），以先锁定车辆为准`,
      )
    }
    nextLocks = { ...reconcileLocks(rows, locks), [String(row.id)]: String(row['牵引车型']).trim() }
  }
  if (RELEASE_ACTIONS.includes(action)) {
    const released = { ...reconcileLocks(rows, locks) }
    delete released[String(row.id)]
    nextLocks = released
  }

  return {
    ok: true,
    code: 'APPLIED',
    message: `牵引任务已${action}，当前状态「${target}」`,
    effect: {
      status: target,
      pending: target !== '已完成',
      locks: nextLocks,
      lockedBy: LOCK_ACTIONS.includes(action) ? Number(row.id) : null,
      released: RELEASE_ACTIONS.includes(action),
    },
  }
}
