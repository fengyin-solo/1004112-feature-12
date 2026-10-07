.PHONY: install frontend validate build image

install:
	cd frontend && npm install

# 本地开发
frontend:
	cd frontend && npm run dev

# 牵引车调度本地校验：牵引编号、关联航班、牵引车型、操作人员、牵引状态跑同一套示例数据
validate:
	cd frontend && npm run validate:pushback

# 生产构建：npm 的 prebuild 钩子会先执行上面的同一套校验，不过就中止
build:
	cd frontend && npm run build

# 上线部署镜像：Dockerfile 构建阶段同样先校验后构建
image:
	docker build -t airport-ground-handling-frontend ./frontend
