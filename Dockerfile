# Use a Node.js 18 base image, as specified in package.json engines
FROM node:18-alpine

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json to leverage Docker cache
# This step is optimized: if only source code changes, npm install won't re-run
# 复制 package.json 和 package-lock.json
COPY package*.json ./

# 安装应用程序依赖项
RUN npm install

# 复制 .env 文件
COPY .env ./.env

# 复制其余应用程序代码
COPY . .

# Build Tailwind CSS (as defined in package.json scripts)
# This command generates public/assets/css/output.css
RUN npm run tailwind:build

# Expose the port the app runs on (defaulting to 3000 as per server.js)
EXPOSE 3000

# Define the command to run the application
CMD ["npm", "start"]