<template>
  <section class="page" data-module="pushback">
    <header class="page-head">
      <div>
        <h2>牵引车调度管理</h2>
        <p class="page-desc">维护牵引任务，围绕牵引编号、关联航班、牵引车型、操作人员做登记、筛选与状态流转。出车冲突以先锁定车辆为准，重复调度只生效一次。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记牵引任务</button>
        <button class="btn" type="button" @click="exportRows">导出牵引车调度清单</button>
      </div>
    </header>

    <!-- 本地开发校验入口：仅开发构建出现；命令行 / 构建 / 部署前用 npm run validate:pushback 跑同一套示例数据 -->
    <div v-if="isDev" class="dev-check" data-testid="dev-validate-panel">
      <div class="dev-check-head">
        <span class="dev-check-tag">DEV 本地校验</span>
        <span>对牵引编号、关联航班、牵引车型、操作人员、牵引状态跑同一套示例数据（src/data/seed.js）</span>
        <button class="btn" type="button" :disabled="checking" @click="runDevChecks">
          {{ checking ? '校验中…' : '运行本地校验' }}
        </button>
        <span v-if="checkResult" :class="checkResult.ok ? 'success-text' : 'error-text'">
          {{ checkResult.passed }}/{{ checkResult.checks.length }} 通过
        </span>
      </div>
      <p v-if="cliHint" class="page-desc">{{ cliHint }}</p>
      <ol v-if="checkResult" class="dev-check-list">
        <li v-for="item in checkResult.checks" :key="item.name" :class="item.ok ? 'pass' : 'fail'">
          {{ item.ok ? 'PASS' : 'FAIL' }} {{ item.name }}
          <span class="dev-check-detail">—— {{ item.detail }}</span>
        </li>
      </ol>
    </div>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>车辆锁定</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">
            <span v-if="column === '推出机位'" class="stand-ref">
              <span>{{ row[column] || '—' }}</span>
              <span
                class="ready-badge"
                :class="standBadge(row[column]).ready ? 'is-ready' : 'not-ready'"
                :title="standBadge(row[column]).reason"
              >
                {{ standBadge(row[column]).ready ? '机位就绪' : '机位未就绪' }}
              </span>
            </span>
            <template v-else>{{ row[column] || '—' }}</template>
          </td>
          <td>
            <span
              v-if="lockOf(row)"
              class="lock-tag"
              :class="lockOf(row)?.source"
              :title="lockOf(row)?.source === 'legacy' ? '来自旧牵引记录的占用状态' : '已写入车辆锁台账'"
            >
              {{ lockOf(row)?.source === 'legacy' ? '旧记录占用' : '已锁定' }}
            </span>
            <span v-else>—</span>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无牵引车调度数据，可先登记牵引任务</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条牵引车调度记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  pushbackVehicleMap,
  readinessByStandRef,
  runAction as applyAction,
} from '@/api/local-service'
import { formatReport, runPushbackChecks } from '@/api/pushback-checks'
import type { PushbackChecksResult } from '@/api/pushback-checks'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('pushback')
const columns = ["牵引编号", "关联航班", "牵引车型", "操作人员", "推出机位", "推出方向", "完成时间", "牵引状态"]
const actions = ["派出车辆", "开始推出", "确认完成"]
const statuses = ["待牵引", "已就位", "推出中", "已完成"]
const stats = [{"label": "待牵引航班", "value": 0}, {"label": "推出中航班", "value": 0}, {"label": "已完成牵引", "value": 0}]

const isDev = import.meta.env.DEV
const cliHint = '构建、上线与部署前由 npm run build 的 prebuild 钩子自动执行同一校验，也可单独运行 npm run validate:pushback。'

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const checkResult = ref<PushbackChecksResult | null>(null)
const checking = ref(false)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const lockMap = computed(() => {
  const map = new Map<number, { source: 'lock' | 'legacy'; status: string; vehicle: string }>()
  for (const item of pushbackVehicleMap()) {
    map.set(item.taskId, { source: item.source, status: item.status, vehicle: item.vehicle })
  }
  return map
})

function lockOf(row: EntryRow) {
  return lockMap.value.get(Number(row.id)) ?? null
}

function standBadge(ref: unknown) {
  return readinessByStandRef(ref)
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '牵引任务登记入口尚未接入审批流'
}

// 本地开发校验：与 scripts/validate-pushback.mjs、prebuild 钩子共用同一份示例数据与规则。
function runDevChecks() {
  checking.value = true
  errorMessage.value = ''
  try {
    const result = runPushbackChecks()
    checkResult.value = result
    if (!result.ok) {
      errorMessage.value = '本地校验未全部通过，详见上方清单'
      console.warn(formatReport(result))
    }
  } finally {
    checking.value = false
  }
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '牵引车调度列表读取失败'
  }
}

onMounted(reload)
</script>
