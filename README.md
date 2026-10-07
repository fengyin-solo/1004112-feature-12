# 机场地面保障调度管理系统

面向航班机位分配、廊桥调度、行李转运、货物装卸、航空加油、航食配餐与客舱清洁全流程的机场地面保障调度管理平台。

这是一个**纯前端**管理平台：Vue 3 + Vite + TypeScript，仓库里没有后端服务。业务数据由
`frontend/src/data/` 下的本地数据层提供：首次打开用示例数据播种，之后的登记、筛选与状态流转
结果都持久化在浏览器 `localStorage` 里，刷新或重开浏览器都还在。dev server 已关掉自动打开页面，
启动后按终端打印的地址手工打开。

## 目录结构

```text
.
├── frontend/                 Vue 3 + Vite + TypeScript 前端（唯一运行单元）
│   ├── src/views/            每个业务模块一个页面
│   ├── src/api/local-service.ts   本地数据服务：列表、筛选、动作流转、导出
│   ├── src/data/             模块元数据 / 示例数据 / localStorage 持久化
│   ├── src/stores/           会话与筛选状态
│   └── vite.config.ts        dev server 配置（open: false，无 /api 代理）
├── .gitignore
└── docker-compose.yml
```

## 启动

```bash
cd frontend
npm install
npm run dev
```

前端默认监听 `http://127.0.0.1:5173/`，dev server 不会自动打开浏览器，需要自己访问。

生产构建：

```bash
cd frontend
npm run build
```

`npm run build` 会先执行 `prebuild` 钩子（`node scripts/validate-pushback.mjs`），牵引车调度
校验不过就中止构建；Docker 镜像（`docker build` / `docker compose build`）在构建阶段跑的是同一条
命令，所以**本地开发、构建、上线部署**跑的是同一套示例数据（`frontend/src/data/seed.js`）和同一套规则。

## 牵引车调度本地校验

牵引车调度页（`/pushback`）在开发模式下提供「DEV 本地校验」面板；命令行、CI、镜像构建则统一走：

```bash
cd frontend
npm run validate:pushback   # 或 make validate
```

校验内容覆盖：

- 牵引编号、关联航班、牵引车型、操作人员、牵引状态五个关键字段齐全；
- 环境信息（操作人员、值班时段）齐全才放行，取不到时拒绝且**不覆盖原排班**；
- 出车冲突**以先锁定车辆为准**：同牵引车型已被「已就位/推出中」的任务占有时，再调度会被拒绝；
- **重复调度只生效一次**：同一动作重复执行返回幂等拒绝，不新增锁、不改排班；
- 完整流转「派出车辆 → 开始推出 → 确认完成」后释放车辆锁，同车型其它任务才能再派；
- 兼容既有排班与旧牵引记录：没有锁台账时，用旧记录的活跃状态兜底判冲突；旧记录缺字段时拒绝并说明。

规则实现只有一份：`frontend/src/api/pushback-rules.js`（浏览器服务层与 Node 校验脚本共同引用）。
车辆锁单独存放在 `localStorage` 的 `airport-ground-handling:pushback-locks` 键，与排班数据
`airport-ground-handling:entries` 物理隔离，锁逻辑任何异常都不会改写原排班。

### 环境或依赖缺失时的表现

- 命令行校验只用 Node 内置模块，**不依赖 `npm install`**，未安装依赖也能运行；检测到 `node_modules`
  缺失时会提示先 `npm install`，但校验本身照常执行。
- Node 版本低于 18、规则/示例数据文件缺失时，校验脚本以非零码退出并打印明确原因，而不是抛堆栈。
- 浏览器里取不到会话（操作人员/值班时段）时，牵引车动作直接被拒绝，页面保留原排班不动。

## 机位就绪标记

机位就绪口径统一定义在 `frontend/src/api/stand-rules.js`，全系统只算一次、所有页面共享：

- 机位状态为「已分配」、已匹配真实航班、且无异常标记，才算**就绪**；其它状态给出具体未就绪原因。
- 机位分配清单（`/stand`）直接展示「就绪标记」列；廊桥调度、地面电源、牵引车调度页面的机位/
  推出机位单元格同步展示同一标记；运营概览给出就绪机位数量。
- 标记是只读派生结果，不会回写机位数据；查不到关联机位时显示「未就绪」而不是伪造就绪。

## 业务模块

| 模块 | 目录 | 业务对象 | 主要字段 |
| --- | --- | --- | --- |
| 机位分配 | `stand` | 机位分配 | 机位编号、机位类型、所属航站楼 |
| 廊桥调度 | `bridge` | 廊桥 | 廊桥编号、所属机位、对接机型 |
| 地面电源 | `ground_power` | 地面电源 | 设备编号、设备类型、所属机位 |
| 行李转运 | `baggage` | 行李转运 | 转运编号、关联航班、行李件数 |
| 货物装卸 | `cargo` | 货物装卸 | 装卸编号、关联航班、货物品类 |
| 航空加油 | `fueling` | 加油记录 | 加油编号、关联航班、燃油型号 |
| 航食配餐 | `catering` | 配餐任务 | 配餐编号、关联航班、餐食类型 |
| 客舱清洁 | `cabin_clean` | 清洁任务 | 清洁编号、关联航班、清洁类型 |
| 排污服务 | `lavatory` | 排污记录 | 排污编号、关联航班、服务车型 |
| 除冰作业 | `deicing` | 除冰记录 | 除冰编号、关联航班、除冰液类型 |
| 牵引车调度 | `pushback` | 牵引任务 | 牵引编号、关联航班、牵引车型 |
| 地勤排班 | `crew_schedule` | 地勤人员 | 人员编号、姓名、岗位类别 |
| 特种车辆 | `special_vehicle` | 特种车辆 | 车辆编号、车辆类型、品牌型号 |
| 航班保障 | `flight_ops` | 航班保障 | 航班号、机尾号、计划到港 |
| 过站监控 | `turnaround` | 过站记录 | 过站编号、关联航班、计划到港 |
| 机坪安全 | `apron_safety` | 机坪安全 | 巡查编号、巡查区域、巡查人员 |
| 装卸设备 | `load_equip` | 装卸设备 | 设备编号、设备类型、适用机型 |
| 应急保障 | `air_emergency` | 应急保障 | 应急编号、事件类型、涉及航班 |

## 约定

- 每个模块的页面在 `frontend/src/views/<模块>/index.vue`，页面只负责渲染，读写统一走
  `frontend/src/api/local-service.ts`。
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；示例数据在
  `frontend/src/data/seed.js`（用 `.js` 是为了让命令行校验脚本免依赖直接复用同一份数据，配套
  类型声明在 `seed.d.ts`）。
- 状态流转只允许在 `local-service.ts` 里改，页面组件不做业务判断；牵引车调度的规则收口在
  `src/api/pushback-rules.js`，`local-service.ts` 只在规则放行后写入。
- 想回到初始数据：清掉浏览器里 `airport-ground-handling:entries`（牵引车还要清
  `airport-ground-handling:pushback-locks`）这一项，或调用 `resetModule(模块)`。
