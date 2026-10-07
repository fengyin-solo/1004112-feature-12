// 机位就绪口径的纯函数：不依赖 localStorage，页面服务和命令行校验共用同一判定。
// 就绪 = 状态「已分配」+ 已匹配真实航班 + 无异常；其它情况给出未就绪原因。
export function evaluateStandReadiness(row) {
  const status = String((row && row.status) ?? '')
  const flight = String((row && row['匹配航班']) ?? '').trim()
  if (row && row.abnormal) {
    return { ready: false, reason: '机位记录存在异常' }
  }
  if (status === '已分配' && flight !== '') {
    return { ready: true, reason: '机位已分配并匹配航班' }
  }
  if (status === '已分配') {
    return { ready: false, reason: '已分配但缺少匹配航班' }
  }
  if (status === '占用中') {
    return { ready: false, reason: '机位已被占用' }
  }
  if (status === '已释放') {
    return { ready: false, reason: '机位已释放，待重新分配' }
  }
  return { ready: false, reason: '机位空闲，尚未分配' }
}

// 用机位编号或匹配航班在机位清单里反查，查不到不伪造就绪。
export function findStandReadiness(standRows, ref) {
  const value = String(ref ?? '').trim()
  if (!value) {
    return { ready: false, reason: '未关联机位' }
  }
  const stand = (standRows || []).find(
    (row) =>
      String(row['机位编号'] ?? '').trim() === value ||
      String(row['匹配航班'] ?? '').trim() === value,
  )
  if (!stand) {
    return { ready: false, reason: `未找到机位 ${value}` }
  }
  return evaluateStandReadiness(stand)
}
