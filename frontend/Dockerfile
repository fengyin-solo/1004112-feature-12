# syntax=docker/dockerfile:1
# 纯前端镜像：构建阶段会先跑牵引车调度本地校验（npm run build 的 prebuild 钩子），
# 校验不过则镜像构建直接失败，保证上线部署前与本地开发跑的是同一套示例数据和规则。
FROM node:20-alpine AS build
WORKDIR /srv/web
COPY package.json ./
RUN npm install
COPY . .
# prebuild 钩子执行 scripts/validate-pushback.mjs；随后 vue-tsc 类型检查 + vite 构建
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /srv/web/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
