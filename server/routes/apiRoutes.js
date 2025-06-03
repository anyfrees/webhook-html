// server/routes/apiRoutes.js

const express = require('express');
const { v4: uuidv4 } = require('uuid'); // 用于生成唯一 ID
const storageService = require('../services/storageService'); // 数据持久化服务
const webhookService = require('../services/webhookService'); // 处理 Webhook 发送逻辑
const taskService = require('../services/taskService');       // 处理定时任务逻辑
const authMiddleware = require('../middleware/authMiddleware'); // 通用认证中间件
const { body, validationResult } = require('express-validator'); // 用于输入验证
const bcrypt = require('bcryptjs'); // 用于管理员创建用户时哈希密码
const fs = require('fs').promises; // 用于管理员删除用户时直接操作文件 (简化实现)
const path = require('path'); // 用于管理员删除用户时直接操作文件 (简化实现)

// multer 用于处理文件上传 (恢复配置功能已移除，但如果将来有其他文件上传可以保留)
// const multer = require('multer');
// const upload = multer({ storage: multer.memoryStorage() });

const router = express.Router();

// 应用通用认证中间件到此路由文件下的所有路由
router.use(authMiddleware);

/**
 * 中间件：检查用户是否为管理员
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function isAdmin(req, res, next) {
    if (req.user && req.user.role === 'admin') {
        next(); // 用户是管理员，继续
    } else {
        res.status(403).json({ message: '权限不足: 此操作需要管理员权限。', error: 'Forbidden' });
    }
}

// --- 健康检查/心跳路由 (所有登录用户可访问) ---
router.get('/health', (req, res) => {
    res.json({ status: 'ok', message: 'API is healthy and authenticated.', user: req.user });
});

// --- 获取所有与当前用户相关的数据 ---
router.get('/data', async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const userRole = req.user.role;

        const webhooks = await storageService.getWebhooks(userId);
        // 模板数据：管理员获取自己的，普通用户获取空数组（或将来定义的全局/共享模板）
        // 后端 /api/data 应该根据用户角色返回合适的模板列表
        const templates = (userRole === 'admin') ? await storageService.getTemplates(userId) : [];
        const scheduledTasks = await storageService.getScheduledTasks(userId);
        let history = {};
        if (webhooks && webhooks.length > 0) {
            for (const wh of webhooks) {
                if (wh.id) {
                    // storageService.getHistory 应该返回已为前端显示处理好的数据
                    history[wh.id] = await storageService.getHistory(wh.id, userId);
                }
            }
        }
        res.json({
            webhooks,
            webhookUrlTemplates: templates,
            history,
            scheduledTasks,
            currentUser: { // 确保 currentUser 信息与 /api/auth/me 一致
                id: req.user.userId,
                username: req.user.username,
                role: userRole,
                mustChangePassword: !!req.user.mustChangePassword
            }
        });
    } catch (error) {
        console.error("API /data - 获取数据错误:", error);
        next(error);
    }
});

// --- Webhook 配置管理 (所有登录用户可管理自己的) ---
router.post('/webhooks', async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const webhooksToSave = req.body;
        if (!Array.isArray(webhooksToSave)) {
            return res.status(400).json({ message: '请求体必须是一个 Webhook 配置数组' });
        }
        // 确保所有 webhooks 都关联到当前用户，并分配ID（如果新建）
        const validatedWebhooks = webhooksToSave.map(wh => ({...wh, userId: userId, id: wh.id || uuidv4() }));
        await storageService.saveWebhooks(validatedWebhooks, userId);
        const updatedWebhooks = await storageService.getWebhooks(userId); // 返回更新后的列表
        res.json({ success: true, message: 'Webhook 配置已保存', webhooks: updatedWebhooks });
    } catch (error) {
        console.error("API /webhooks - 保存 Webhook 配置错误:", error);
        next(error);
    }
});

// --- 地址模板管理 (只有管理员可以管理) ---
router.get('/templates', isAdmin, async (req, res, next) => {
    try {
        // 管理员获取的是属于自己的模板（如果模板是按用户存储的）
        // 或者，如果模板是全局的，这里可以获取所有模板
        // 当前 storageService.getTemplates(userId) 是获取指定用户的模板
        const userIdForTemplates = req.user.userId;
        const templates = await storageService.getTemplates(userIdForTemplates);
        res.json(templates);
    } catch (error) {
        console.error("API /templates (GET) - 获取模板错误:", error);
        next(error);
    }
});

router.post('/templates', isAdmin, async (req, res, next) => {
    try {
        const userIdForTemplates = req.user.userId; // 管理员操作自己的模板
        const templatesToSave = req.body;
        if (!Array.isArray(templatesToSave)) {
            return res.status(400).json({ message: '请求体必须是一个模板数组' });
        }
        const validatedTemplates = templatesToSave.map(t => ({...t, userId: userIdForTemplates, id: t.id || uuidv4() }));
        await storageService.saveTemplates(validatedTemplates, userIdForTemplates);
        const updatedTemplates = await storageService.getTemplates(userIdForTemplates);
        res.json({ success: true, message: '地址模板已保存', templates: updatedTemplates });
    } catch (error) {
        console.error("API /templates (POST) - 保存模板错误:", error);
        next(error);
    }
});

// --- 发送 Webhook (所有登录用户可发送自己的配置) ---
router.post('/send-now', async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const webhookPayloadFromClient = req.body;
        if (!webhookPayloadFromClient || !webhookPayloadFromClient.id) {
            return res.status(400).json({ message: '无效的 Webhook 发送请求体' });
        }
        // TODO: 验证 webhook config (clientPayload.id) 是否属于当前 userId
        const resultEntry = await webhookService.sendWebhookRequest(webhookPayloadFromClient, userId);
        res.status(resultEntry.status === 'success' ? 200 : (resultEntry.error?.statusCode || 500) ).json(resultEntry);
    } catch (error) {
        console.error("API /send-now - 立即发送错误:", error);
        const clientErrorMessage = error.isOperational ? error.message : '发送 Webhook 时发生内部错误';
        const statusCode = error.statusCode || 500;
        res.status(statusCode).json({ success: false, message: clientErrorMessage, error: { name: error.name } });
    }
});

// --- 定时任务管理 (所有登录用户可管理自己的) ---
router.post('/schedule-task', async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const taskDataFromClient = req.body;
        if (!taskDataFromClient || !taskDataFromClient.originalWebhookId || !taskDataFromClient.scheduledTime) {
            return res.status(400).json({ message: '无效的定时任务数据' });
        }
        // TODO: 验证 originalWebhookId 是否属于当前 userId
        const result = await taskService.scheduleNewTask(taskDataFromClient, userId);
        if (result && result.success) {
            const updatedTasks = await storageService.getScheduledTasks(userId);
            res.status(201).json({ success: true, message: '定时任务已创建', taskId: result.taskId, scheduledTasks: updatedTasks });
        } else {
            res.status(400).json({ success: false, message: result ? result.msg : "创建定时任务失败" });
        }
    } catch (error) {
        console.error("API /schedule-task (POST) - 创建定时任务错误:", error);
        next(error);
    }
});

router.delete('/schedule-task/:taskId', async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const { taskId } = req.params;
        // cancelScheduledTask in taskService 应该会验证任务是否属于该用户
        const result = await taskService.cancelScheduledTask(taskId, userId);
        if (result && result.success) {
            const updatedTasks = await storageService.getScheduledTasks(userId);
            res.json({ success: true, message: '定时任务已取消', scheduledTasks: updatedTasks });
        } else {
            res.status(404).json({ success: false, message: result ? result.msg : "未找到要取消的任务或取消失败" });
        }
    } catch (error) {
        console.error("API /schedule-task/:taskId (DELETE) - 取消定时任务错误:", error);
        next(error);
    }
});

// --- 获取 UUID (所有登录用户可访问) ---
router.get('/uuid', (req, res) => {
    res.json({ uuid: uuidv4() });
});

// --- 用户管理 API (仅限管理员) ---
router.get('/users', isAdmin, async (req, res, next) => {
    try {
        const users = await storageService.getUsers(); // getUsers 返回不含密码的用户信息
        res.json(users); // users 数组已经处理好，可以直接返回
    } catch (error) {
        console.error("API /users (GET) - 获取用户列表错误:", error);
        next(error);
    }
});

router.post('/users', isAdmin, [
    body('username').trim().notEmpty().withMessage('用户名不能为空。').isLength({ min: 3 }).withMessage('用户名长度至少为3个字符。').escape(),
    body('password').notEmpty().withMessage('密码不能为空。').isLength({ min: 6 }).withMessage('密码长度至少为6个字符。'),
    body('role').optional().isIn(['admin', 'user']).withMessage('角色必须是 "admin" 或 "user"。')
], async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ message: '输入验证失败。', errors: errors.array() });
    }
    try {
        const { username, password, role } = req.body;
        const existingUser = await storageService.findUserByUsername(username);
        if (existingUser) {
            return res.status(409).json({ message: '用户名已存在。' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUserInput = {
            username,
            password: hashedPassword,
            role: role || 'user',
            mustChangePassword: true // 新用户由管理员创建，首次登录强制修改密码
        };
        const createdUser = await storageService.createUser(newUserInput); // createUser 返回不含密码的用户信息
        res.status(201).json({ success: true, message: '用户创建成功。', user: createdUser });
    } catch (error) {
        console.error("API /users (POST) - 创建用户错误:", error);
        next(error);
    }
});

router.delete('/users/:userId', isAdmin, async (req, res, next) => {
    try {
        const userIdToDelete = req.params.userId;
        const adminUserId = req.user.userId; // 当前操作的管理员ID

        if (userIdToDelete === adminUserId) {
            return res.status(400).json({ message: '管理员不能删除自己。' });
        }

        const users = await storageService.getUsers(); // 获取所有用户（不含密码）
        const userToDelete = users.find(u => u.id === userIdToDelete);

        if (!userToDelete) {
            return res.status(404).json({ message: '未找到要删除的用户。' });
        }

        // 假设第一个用户是主管理员，且用户名为 'admin'，不允许删除
        // 这个逻辑可以根据实际情况调整，例如，通过ID或特定标志来识别不可删除的管理员
        if (users.length > 0 && users[0].id === userIdToDelete && users[0].username === 'admin') {
             return res.status(403).json({ message: '不能删除初始的管理员账户。'});
        }

        // 从 storageService 删除用户 (storageService 需要一个 deleteUser 方法)
        // 简化版：直接重写用户文件 (不推荐用于生产)
        const allUsersWithPasswords = await readFileData(path.join(DATA_DIR, 'users.json')); // 需要一个内部函数来读取带密码的
        const remainingUsersWithPasswords = allUsersWithPasswords.filter(u => u.id !== userIdToDelete);
        await writeFileData(path.join(DATA_DIR, 'users.json'), remainingUsersWithPasswords);


        // TODO: 在 storageService 中实现更原子和安全的 deleteUser(userId) 方法
        // TODO: 同时，考虑删除该用户的所有关联数据 (webhooks, templates, tasks, history)
        // 例如:
        // await storageService.deleteWebhooksForUser(userIdToDelete);
        // await storageService.deleteTemplatesForUser(userIdToDelete);
        // await storageService.deleteTasksForUser(userIdToDelete);
        // await storageService.deleteHistoryForUser(userIdToDelete);

        res.json({ success: true, message: `用户 ${userToDelete.username} 已删除。` });
    } catch (error) {
        console.error(`API /users/${req.params.userId} (DELETE) - 删除用户错误:`, error);
        next(error);
    }
});

// 辅助函数，仅用于此文件简化用户删除操作，实际应在 storageService 中
async function readFileData(filePath, defaultValue = []) {
    try {
        const fileContent = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(fileContent);
    } catch (error) {
        if (error.code === 'ENOENT') { return defaultValue; }
        throw error;
    }
}
async function writeFileData(filePath, data) {
    const tempFilePath = `${filePath}.${uuidv4()}.tmp`;
    try {
        await fs.writeFile(tempFilePath, JSON.stringify(data, null, 2), 'utf-8');
        await fs.rename(tempFilePath, filePath);
    } catch (error) {
        try { await fs.unlink(tempFilePath); } catch (e) { /* ignore */ }
        throw error;
    }
}


module.exports = router;
