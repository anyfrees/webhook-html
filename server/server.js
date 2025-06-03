// server/server.js

const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

// 从 cryptoService 导入加解密函数
const { encryptText, decryptText } = require('./services/cryptoService');

// 导入路由模块
const authRoutes = require('./routes/authRoutes'); // 处理 /api/auth/*
const apiRoutes = require('./routes/apiRoutes');   // 处理 /api/* (除auth外)
const taskService = require('./services/taskService');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// --- API 路由 ---
// 认证相关路由应在业务API路由之前或独立挂载
app.use('/api/auth', authRoutes);
// 业务 API 路由
app.use('/api', apiRoutes); // <--- 确保这一行存在并且路径正确

// --- 静态文件服务 ---
const publicPath = path.join(__dirname, '..', 'public');
app.use(express.static(publicPath));
console.log(`静态文件服务目录: ${publicPath}`);

app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
        return next();
    }
    // 对于前端路由，通常所有非API、非静态文件的请求都返回 index.html
    // login.html 和 change-password.html 应该能通过 express.static 访问
    const indexPath = path.join(publicPath, 'index.html');
    res.sendFile(indexPath, (err) => {
        if (err) {
            console.error(`发送 index.html 失败: ${indexPath}`, err);
            // 如果 index.html 也不存在，返回一个标准的 404
            if (!res.headersSent) { // 避免在已发送响应后再发送
                 res.status(404).send('资源未找到或应用入口配置错误。');
            }
        }
    });
});

// --- 全局错误处理中间件 ---
app.use((err, req, res, next) => {
    console.error("全局错误处理器捕获到错误:", err.stack || err.message || err);
    const statusCode = err.status || err.statusCode || 500;
    const message = process.env.NODE_ENV === 'production' && statusCode === 500
        ? '服务器发生了一个内部错误，请稍后再试。'
        : (err.message || '服务器错误');

    // 确保在发送JSON错误前检查头部是否已发送
    if (res.headersSent) {
        return next(err); // 如果头部已发送，将错误传递给Express的默认错误处理器
    }

    res.status(statusCode).json({
        error: {
            message: message,
            type: err.name || 'Error',
            ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
        }
    });
});

// --- 启动服务器 ---
const server = app.listen(PORT, async () => {
    console.log(`服务器已启动，运行在 http://localhost:${PORT}`);
    console.log(`当前环境 (NODE_ENV): ${process.env.NODE_ENV || 'development'}`);
    try {
        console.log("正在初始化定时任务...");
        await taskService.initializeScheduledTasks();
        console.log("定时任务初始化完成。");
    } catch (error) {
        console.error("初始化定时任务失败:", error);
    }
});

const gracefulShutdown = (signal) => {
    console.log(`接收到 ${signal} 信号，开始优雅关闭...`);
    server.close(async () => {
        console.log('HTTP 服务器已关闭。');
        try {
            console.log('所有资源已清理，应用退出。');
            process.exit(0);
        } catch (error) {
            console.error('关闭期间发生错误:', error);
            process.exit(1);
        }
    });
    setTimeout(() => {
        console.error('无法在超时内优雅关闭，强制退出。');
        process.exit(1);
    }, 10000);
};
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

module.exports = app;
