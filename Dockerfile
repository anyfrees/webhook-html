# --- STAGE 1: Build Environment ---
# 使用一个完整的 Node.js 镜像作为构建器，并命名为 "builder"
FROM node:18-alpine AS builder

# 设置工作目录
WORKDIR /app

# 复制 package.json 和 lock 文件
COPY package*.json ./

# 安装所有依赖，包括 devDependencies 以便运行构建脚本
RUN npm install

# 复制所有源代码
COPY . .

# 运行 Tailwind CSS 构建命令
RUN npm run tailwind:build


# --- STAGE 2: Production Environment ---
# 使用一个全新的、干净的 Node.js 镜像作为最终的生产环境
FROM node:18-alpine

WORKDIR /app

# 从 "builder" 阶段复制 package.json 和 lock 文件
COPY --from=builder /app/package*.json ./

# 只安装生产环境必需的依赖项
RUN npm install --omit=dev

# 从 "builder" 阶段复制已构建好的前端资源 (包括 output.css)
COPY --from=builder /app/public /app/public

# 从 "builder" s阶段复制后端服务器代码
COPY --from=builder /app/server /app/server

# 暴露端口
EXPOSE 3000

# 定义最终的启动命令
CMD [ "node", "server/server.js" ]