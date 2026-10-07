FROM node:20-alpine
WORKDIR /srv/web
COPY package.json ./
RUN npm install
COPY . .
# 部署前先跑牵引车调度本地校验（与构建、上线用的是同一套示例数据）
RUN node scripts/verify-pushback.mjs
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
