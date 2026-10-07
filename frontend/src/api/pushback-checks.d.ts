export type PushbackCheck = {
  name: string
  ok: boolean
  detail: string
}

export type PushbackChecksResult = {
  checks: PushbackCheck[]
  passed: number
  failed: number
  sampleSize: { pushback: number; stand: number }
  ok: boolean
}

export const VALID_ENV: { operator: string; shift: string }

export function runPushbackChecks(): PushbackChecksResult
export function formatReport(result: PushbackChecksResult): string
