#!/usr/bin/env node
// 牵引车调度本地开发校验入口（命令行）。
// 在本地开发、构建（npm run build 的 prebuild 钩子）、上线部署（Dockerfile 构建阶段）跑同一套示例数据。
// 只用 Node 内置模块，未执行 npm install 也能运行；环境或依赖缺失时给出明确说明而不是直接崩。
import { access } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const frontendDir = join(here, '..')
const projectPkgPath = join(frontendDir, 'package.json')

function fail(message) {
  console.error(`牵引车调度本地校验未执行：${message}`)
  process.exit(2)
}

// 1) 运行环境：需要 Node 18+（用到内置 ESM / fs/promises）。
const nodeMajor = Number(process.versions.node.split('.')[0])
if (!Number.isFinite(nodeMajor) || nodeMajor < 18) {
  fail(`当前 Node 版本为 ${process.version}，需要 Node 18 及以上；请升级 Node 后重试。`)
}

// 2) 关键文件：示例数据与规则文件必须存在，缺失通常是打包裁剪或分支合并不全。
const requiredFiles = [
  'src/data/seed.js',
  'src/api/pushback-rules.js',
  'src/api/stand-rules.js',
  'src/api/pushback-checks.js',
]
for (const rel of requiredFiles) {
  try {
    await access(join(frontendDir, rel))
  } catch {
    fail(`缺少文件 ${rel}。该项目为纯前端工程，请在 frontend/ 目录下取全代码（git 拉取完整仓库）后重试。`)
  }
}

// 3) 项目依赖：本脚本本身不需要 node_modules，但构建前校验顺带提示依赖是否已安装。
const requireFromProject = createRequire(projectPkgPath)
try {
  requireFromProject.resolve('vue/package.json')
} catch {
  console.warn('[提示] 未检测到 node_modules（vue 未安装）。命令行校验可继续，但若要 npm run dev / build，请先在 frontend/ 下执行 npm install。')
}

let runPushbackChecks
let formatReport
try {
  ;({ runPushbackChecks, formatReport } = await import(
    pathToFileURL(join(frontendDir, 'src', 'api', 'pushback-checks.js')).href
  ))
} catch (error) {
  fail(`加载校验规则失败：${error instanceof Error ? error.message : String(error)}。请确认 src/api 下规则文件未被破坏。`)
}

const result = runPushbackChecks()
console.log(formatReport(result))
process.exit(result.ok ? 0 : 1)
