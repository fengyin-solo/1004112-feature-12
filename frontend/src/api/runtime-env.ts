import { useSessionStore } from '@/stores/session'

// 牵引车动作必须携带的环境信息：当前操作人员和值班时段来自会话 store。
// 取不到（store 未激活、值为空）时返回 null，规则层据此拒绝动作，不允许用空值覆盖原排班。
export function currentPushbackEnv(): { operator: string; shift: string } | null {
  let store
  try {
    store = useSessionStore()
  } catch {
    // Pinia 尚未安装（例如独立校验入口），视为环境缺失。
    return null
  }
  const operator = String(store?.operator ?? '').trim()
  const shift = String(store?.shiftLabel ?? '').trim()
  if (!operator || !shift) {
    return null
  }
  return { operator, shift }
}
