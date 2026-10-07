import type { EntryRow } from '@/data/types'

export type StandReadiness = {
  ready: boolean
  reason: string
}

export function evaluateStandReadiness(row: EntryRow): StandReadiness
export function findStandReadiness(standRows: EntryRow[], ref: unknown): StandReadiness
