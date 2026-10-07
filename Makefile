.PHONY: install frontend build verify release deploy

install:
	cd frontend && npm install

frontend:
	cd frontend && npm run dev

# 牵引车调度本地校验：构建、上线、部署前都跑同一套示例数据
verify:
	cd frontend && npm run verify

build:
	cd frontend && npm run build

release:
	cd frontend && npm run release

deploy:
	docker compose up --build
