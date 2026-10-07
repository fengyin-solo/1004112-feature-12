import type { EntryRow } from '@/data/types'

export const LOCK_ACTIONS: string[]
export const RELEASE_ACTIONS: string[]
export const ACTIVE_STATUSES: string[]
export const ENV_FIELDS: string[]
export const REQUIRED_FIELDS: string[]

export type PushbackEnv = {
  operator?: string
  shift?: string
  [field: string]: string | undefined
}

export type VehicleHolder = {
  taskId: number
  source: 'lock' | 'legacy'
  status: string
}

export type PushbackDecision = {
  ok: boolean
  code: 'APPLIED' | 'NOT_FOUND' | 'UNKNOWN_ACTION' | 'DUPLICATE' | 'ENV_MISSING' | 'FIELD_MISSING' | 'VEHICLE_LOCKED' | 'INVALID_FLOW'
  message: string
  effect: {
    status: string
    pending: boolean
    locks: Record<string, string>
    lockedBy: number | null
    released: boolean
  } | null
}

export type PushbackActionInput = {
  row: EntryRow | undefined
  rows: EntryRow[]
  locks: Record<string, string>
  action: string
  env: PushbackEnv | null | undefined
}

export function reconcileLocks(rows: EntryRow[], locks: Record<string, string>): Record<string, string>
export function findVehicleHolder(
  rows: EntryRow[],
  locks: Record<string, string>,
  vehicle: unknown,
  ignoreTaskId?: number,
): VehicleHolder | null
export function checkEnvironment(env: PushbackEnv | null | undefined): { ok: boolean; missing: string[] }
export function checkRequiredFields(row: EntryRow): { ok: boolean; missing: string[] }
export function decidePushbackAction(input: PushbackActionInput): PushbackDecision
