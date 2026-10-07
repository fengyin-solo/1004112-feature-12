import { listRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'
import { evaluateStandReadiness, findStandReadiness } from './stand-rules'

export type { StandReadiness } from './stand-rules'

// 机位就绪口径统一定在 stand-rules.js，浏览器页面与命令行校验共用同一份纯函数。
export function standReadiness(row: EntryRow) {
  return evaluateStandReadiness(row)
}

// 用「机位编号」或「匹配航班」反查机位就绪状态；查不到时不伪造就绪。
export function readinessByStandRef(ref: unknown) {
  return findStandReadiness(listRows('stand'), ref)
}

export function readyStandCount(): number {
  return listRows('stand').filter((row) => evaluateStandReadiness(row).ready).length
}
