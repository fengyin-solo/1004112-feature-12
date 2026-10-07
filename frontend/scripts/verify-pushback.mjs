#!/usr/bin/env node
// 牵引车调度本地开发校验入口：构建、上线、部署前都跑这一份。
// 校验用的示例数据与页面播种的是同一套（src/data/pushback-sample.json），
// 覆盖五个关键字段：牵引编号、关联航班、牵引车型、操作人员、牵引状态。
// 环境或依赖缺失会逐条说明，并以非零退出码拦住后续流程。
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const passes = []
const warnings = []
const failures = []

const pass = (text) => passes.push(text)
const warn = (text) => warnings.push(text)
const fail = (text) => failures.push(text)

// 1. Node 版本：Vite 5 要求 Node 18+。
const major = Number(process.versions.node.split('.')[0])
if (major >= 18) {
  pass(`Node 版本 ${process.versions.node}（要求 >= 18）`)
} else {
  fail(`环境缺失：Node 版本 ${process.versions.node} 过低，Vite 5 要求 >= 18，请升级 Node`)
}

// 2. package.json 与关键依赖。
const pkgPath = join(root, 'package.json')
if (!existsSync(pkgPath)) {
  fail('环境缺失：未找到 frontend/package.json，项目骨架不完整')
} else {
  pass('package.json 读取正常')
}
const requiredDeps = ['vue', 'vue-router', 'pinia', 'vite', 'typescript', 'vue-tsc', '@vitejs/plugin-vue']
if (!existsSync(join(root, 'node_modules'))) {
  fail('依赖缺失：未找到 node_modules，请先在 frontend 目录执行 npm install')
} else {
  const missing = requiredDeps.filter(
    (dep) => !existsSync(join(root, 'node_modules', ...dep.split('/'), 'package.json')),
  )
  if (missing.length > 0) {
    fail(`依赖缺失：${missing.join('、')} 未安装，请重新执行 npm install`)
  } else {
    pass(`关键依赖齐全（${requiredDeps.join('、')}）`)
  }
}

// 3. 环境文件：缺了不阻断（代码里有默认值），但必须说明。
const envPath = join(root, '.env.development')
if (!existsSync(envPath)) {
  warn('环境说明：缺少 .env.development，页面将使用代码内默认值（VITE_APP_NAME 等）')
} else {
  const envText = readFileSync(envPath, 'utf8')
  if (/^VITE_APP_NAME=.+/m.test(envText)) {
    pass('.env.development 就绪，VITE_APP_NAME 已配置')
  } else {
    warn('环境说明：.env.development 未配置 VITE_APP_NAME，页面标题将使用默认值')
  }
}

// 4. 示例数据：与页面播种同一套（src/data/pushback-sample.json）。
const REQUIRED_FIELDS = ['牵引编号', '关联航班', '牵引车型', '操作人员', '牵引状态']
const STATUSES = ['待牵引', '已就位', '推出中', '已完成']
const samplePath = join(root, 'src', 'data', 'pushback-sample.json')
let sample = null
if (!existsSync(samplePath)) {
  fail('缺少 src/data/pushback-sample.json，牵引车调度示例数据未就位')
} else {
  try {
    sample = JSON.parse(readFileSync(samplePath, 'utf8'))
  } catch (error) {
    fail(`pushback-sample.json 解析失败：${error.message}`)
  }
}
if (Array.isArray(sample)) {
  const failuresBefore = failures.length
  if (sample.length === 0) {
    fail('示例数据为空，无法校验牵引车调度')
  }
  const ids = new Set()
  for (const [index, row] of sample.entries()) {
    const label = row?.牵引编号 ?? `第 ${index + 1} 行`
    if (typeof row?.id !== 'number' || ids.has(row.id)) {
      fail(`示例数据 ${label}：id 缺失或重复`)
    }
    ids.add(row?.id)
    for (const field of REQUIRED_FIELDS) {
      if (typeof row?.[field] !== 'string' || row[field].trim() === '') {
        fail(`示例数据 ${label}：字段「${field}」缺失或为空`)
      }
    }
    if (typeof row?.牵引编号 === 'string' && !/^PUSH-\d{4}$/.test(row.牵引编号)) {
      fail(`示例数据 ${label}：牵引编号格式应为 PUSH-XXXX`)
    }
    if (!STATUSES.includes(row?.status)) {
      fail(`示例数据 ${label}：status 必须是 ${STATUSES.join('/')} 之一`)
    }
    if (row?.牵引状态 !== row?.status) {
      fail(`示例数据 ${label}：牵引状态「${row?.牵引状态}」与内部状态「${row?.status}」不一致`)
    }
    if (row?.锁定车辆 !== undefined && row.锁定车辆 !== row.牵引车型) {
      fail(`示例数据 ${label}：锁定车辆「${row?.锁定车辆}」与牵引车型「${row?.牵引车型}」不一致`)
    }
  }
  if (failures.length === failuresBefore && sample.length > 0) {
    pass(`示例数据校验通过：${sample.length} 条牵引任务，五个关键字段齐全`)
  }
}

// 5. 模块元数据：modules.ts 里牵引车调度的字段与动作要登记齐全。
const modulesPath = join(root, 'src', 'data', 'modules.ts')
if (!existsSync(modulesPath)) {
  fail('缺少 src/data/modules.ts，模块元数据未就位')
} else {
  const modulesText = readFileSync(modulesPath, 'utf8')
  const after = modulesText.split('key: "pushback"')[1]
  const block = after ? after.split('key: "')[0] : ''
  if (!block) {
    fail('modules.ts 中没有登记 key 为 pushback 的模块')
  } else {
    const missingMeta = [...REQUIRED_FIELDS, '派出车辆', '开始推出', '确认完成'].filter(
      (name) => !block.includes(`"${name}"`),
    )
    if (missingMeta.length > 0) {
      fail(`modules.ts 的牵引车调度缺少：${missingMeta.join('、')}`)
    } else {
      pass('modules.ts 牵引车调度元数据齐全（五个关键字段 + 三个动作）')
    }
  }
}

// 汇总报告。
console.log('牵引车调度本地开发校验')
console.log('='.repeat(40))
for (const text of passes) console.log(`✓ ${text}`)
for (const text of warnings) console.log(`⚠ ${text}`)
for (const text of failures) console.log(`✗ ${text}`)
console.log('='.repeat(40))
if (failures.length > 0) {
  console.error(`校验未通过：${failures.length} 项失败、${warnings.length} 项提醒，请先处理再构建/上线/部署`)
  process.exit(1)
}
console.log(`校验通过：${passes.length} 项通过、${warnings.length} 项提醒`)
