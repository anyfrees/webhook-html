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
// 注意：cryptoService 中的 encryptText, decryptText 通常在各自的服务模块内部使用，
// apiRoutes.js 本身一般不直接调用它们，除非有特殊情况。
// const { encryptText, decryptText } = require('../services/cryptoService');

// DATA_DIR 用于辅助删除用户数据时的文件路径拼接
const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const HISTORY_DIR = path.join(DATA_DIR, 'history'); // 定义 HISTORY_DIR

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
        console.log(`[API /data] 用户 ${userId} (角色: ${userRole}) 请求数据。`);

        const webhooks = await storageService.getWebhooks(userId);
        // storageService.getAccessibleTemplatesForUserDisplay 会根据角色返回合适的模板列表
        const templates = await storageService.getAccessibleTemplatesForUserDisplay(userId, userRole);
        const scheduledTasks = await storageService.getScheduledTasks(userId);
        
        let history = {};
        if (webhooks && webhooks.length > 0) {
            for (const wh of webhooks) {
                if (wh.id) {
                    history[wh.id] = await storageService.getHistory(wh.id, userId);
                }
            }
        }
        console.log(`[API /data] 为用户 ${userId} 返回数据: ${webhooks.length} webhooks, ${templates.length} templates, ${scheduledTasks.length} tasks.`);
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
        console.error("[API /data] 获取数据错误:", error);
        next(error); // 交给全局错误处理器
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
        const validatedWebhooks = webhooksToSave.map(wh => ({
            ...wh,
            id: wh.id || uuidv4(), // 如果没有ID，则认为是新建，分配一个
            userId: userId,        // 强制设置为当前用户ID
        }));
        await storageService.saveWebhooks(validatedWebhooks, userId);
        const updatedWebhooks = await storageService.getWebhooks(userId); // 返回更新后的列表
        res.json({ success: true, message: 'Webhook 配置已保存', webhooks: updatedWebhooks });
    } catch (error) {
        console.error("[API /webhooks] 保存 Webhook 配置错误:", error);
        next(error);
    }
});

// --- 地址模板管理 (只有管理员可以管理) ---
router.get('/templates', isAdmin, async (req, res, next) => {
    try {
        const adminUserId = req.user.userId;
        // 管理员获取的是自己创建的 + 所有全局的模板
        const templates = await storageService.getAccessibleTemplatesForUserDisplay(adminUserId, 'admin');
        res.json(templates);
    } catch (error) {
        console.error("[API /templates (GET)] 获取模板错误:", error);
        next(error);
    }
});

router.post('/templates', isAdmin, async (req, res, next) => {
    try {
        const adminUserId = req.user.userId;
        const templatesToSaveFromClient = req.body; // 客户端应发送完整的模板列表
        
        if (!Array.isArray(templatesToSaveFromClient)) {
            return res.status(400).json({ message: '请求体必须是一个模板数组' });
        }

        // storageService.saveTemplates 负责处理加密和ID分配
        await storageService.saveTemplates(templatesToSaveFromClient, adminUserId);
        
        // 返回更新后的、对管理员可见的模板列表
        const updatedTemplates = await storageService.getAccessibleTemplatesForUserDisplay(adminUserId, 'admin');

        // 尝试找到刚刚被新增或修改的模板，以便客户端可能需要其ID
        let savedOrNewTemplateInfo = null;
        if (templatesToSaveFromClient.length > 0) {
            // 启发式查找：如果客户端发送的模板中有一个没有ID，那它可能是新创建的
            const clientNewTemplate = templatesToSaveFromClient.find(t => !t.id);
            if (clientNewTemplate) {
                savedOrNewTemplateInfo = updatedTemplates.find(
                    ut => ut.name === clientNewTemplate.name && 
                          ut.type === clientNewTemplate.type &&
                          ut.isGlobal === !!clientNewTemplate.isGlobal // 比较isGlobal状态
                );
            } else if (templatesToSaveFromClient.length === 1 && templatesToSaveFromClient[0].id) {
                // 如果只发送了一个带ID的模板，那就是被修改的那个
                savedOrNewTemplateInfo = updatedTemplates.find(ut => ut.id === templatesToSaveFromClient[0].id);
            }
        }


        res.json({
            success: true,
            message: '地址模板已保存',
            templates: updatedTemplates,
            savedTemplate: savedOrNewTemplateInfo // 包含一个可能的被保存/新建的模板信息
        });
    } catch (error) {
        console.error("[API /templates (POST)] 保存模板错误:", error);
        next(error);
    }
});

// --- 发送 Webhook (所有登录用户可发送自己的配置) ---
router.post('/send-now', async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const userRole = req.user.role;
        const webhookPayloadFromClient = req.body; // 包含 id, templateId, phone, plainBody, headers

        if (!webhookPayloadFromClient || !webhookPayloadFromClient.id) {
            return res.status(400).json({ message: '无效的 Webhook 发送请求体: 缺少配置ID (id 字段)' });
        }

        const webhookConfigId = webhookPayloadFromClient.id;
        // 1. 获取用户自己的 Webhook 配置原始数据
        const rawUserWebhooks = await storageService.getRawWebhooksForUser(userId);
        const webhookConfig = rawUserWebhooks.find(wh => wh.id === webhookConfigId);

        if (!webhookConfig) {
            return res.status(404).json({ message: `发送失败：未找到您账户下 ID 为 ${webhookConfigId} 的 Webhook 配置。` });
        }

        // 2. 获取模板 ID (优先使用客户端提供的，其次用配置中存的)
        const templateIdToFetch = webhookPayloadFromClient.templateId || webhookConfig.templateId;
        if (!templateIdToFetch) {
             return res.status(400).json({ message: `发送失败：配置 "${webhookConfig.name}" 未指定地址模板。`});
        }

        // 3. 获取原始模板数据，并校验用户权限
        // storageService.getRawTemplateByIdForUserAccess 会检查用户是否有权访问此模板
        const rawTemplate = await storageService.getRawTemplateByIdForUserAccess(templateIdToFetch, userId, userRole);

        if (!rawTemplate) {
            return res.status(404).json({ message: `发送失败：配置 "${webhookConfig.name}" (ID: ${webhookConfigId}) 未关联有效或您可访问的模板 (模板ID: ${templateIdToFetch})。请检查模板是否存在或是否已设为全局。`});
        }
        
        // 4. 调用 webhookService 发送 (传递原始配置和原始模板)
        // webhookService.sendWebhookRequest 内部会使用 webhookConfig 和 rawTemplate 来构建最终请求
        const resultEntry = await webhookService.sendWebhookRequest(webhookPayloadFromClient, userId, rawTemplate); // 注意：这里可能需要调整webhookService的参数
        
        res.status(resultEntry.status === 'success' ? 200 : (resultEntry.error?.statusCode || resultEntry.error?.status || 500) ).json(resultEntry);
    } catch (error) {
        console.error("[API /send-now] 立即发送错误:", error);
        const clientErrorMessage = error.isOperational ? error.message : '发送 Webhook 时发生内部错误';
        const statusCode = error.statusCode || 500;
        res.status(statusCode).json({ success: false, message: clientErrorMessage, error: { name: error.name, details: error.message, stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined } });
    }
});

// --- 定时任务管理 (所有登录用户可管理自己的) ---
router.post('/schedule-task', async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const userRole = req.user.role;
        const taskDataFromClient = req.body; // 包含 originalWebhookId, scheduledTime, webhookSnapshot, templateType, 等
        
        if (!taskDataFromClient || !taskDataFromClient.originalWebhookId || !taskDataFromClient.scheduledTime || !taskDataFromClient.webhookSnapshot || !taskDataFromClient.templateType) {
            return res.status(400).json({ message: '无效的定时任务数据：缺少必要字段。' });
        }

        // taskService.scheduleNewTask 内部会根据 templateId (在 webhookSnapshot 中) 获取模板并校验权限
        const result = await taskService.scheduleNewTask(taskDataFromClient, userId, userRole);
        
        if (result && result.success) {
            const updatedTasks = await storageService.getScheduledTasks(userId); // 获取更新后的任务列表
            res.status(201).json({ success: true, message: '定时任务已创建', taskId: result.taskId, scheduledTasks: updatedTasks });
        } else {
            res.status(400).json({ success: false, message: result ? result.msg : "创建定时任务失败" });
        }
    } catch (error) {
        console.error("[API /schedule-task (POST)] 创建定时任务错误:", error);
        next(error);
    }
});

router.delete('/schedule-task/:taskId', async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const { taskId } = req.params;
        // taskService.cancelScheduledTask 内部应验证任务是否属于该用户
        const result = await taskService.cancelScheduledTask(taskId, userId);
        if (result && result.success) {
            const updatedTasks = await storageService.getScheduledTasks(userId);
            res.json({ success: true, message: '定时任务已取消', scheduledTasks: updatedTasks });
        } else {
            res.status(404).json({ success: false, message: result ? result.msg : "未找到要取消的任务或取消失败" });
        }
    } catch (error) {
        console.error(`[API /schedule-task/${req.params.taskId} (DELETE)] 取消定时任务错误:`, error);
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
        res.json(users);
    } catch (error) {
        console.error("[API /users (GET)] 获取用户列表错误:", error);
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
        console.error("[API /users (POST)] 创建用户错误:", error);
        next(error);
    }
});

// 辅助函数，仅用于此文件简化用户删除操作时读取原始用户数据，实际应在 storageService 中有更完善的删除机制
async function readFileDataInternal(filePath, defaultValue = []) {
    try {
        const fileContent = await fs.readFile(filePath, 'utf-8');
        if (fileContent.trim() === '') return defaultValue;
        return JSON.parse(fileContent);
    } catch (error) {
        if (error.code === 'ENOENT') { return defaultValue; }
        console.error(`[apiRoutes - readFileDataInternal] 读取文件 '${filePath}' 失败:`, error);
        throw error; // 或者返回defaultValue并记录更严重的错误
    }
}
async function writeFileDataInternal(filePath, data) {
    const tempFilePath = `${filePath}.${uuidv4()}.tmp`;
    try {
        await fs.writeFile(tempFilePath, JSON.stringify(data, null, 2), 'utf-8');
        await fs.rename(tempFilePath, filePath);
    } catch (error) {
        console.error(`[apiRoutes - writeFileDataInternal] 写入文件 '${filePath}' 失败:`, error);
        try { await fs.unlink(tempFilePath); } catch (e) { /* ignore */ }
        throw error;
    }
}


router.delete('/users/:userId', isAdmin, async (req, res, next) => {
    try {
        const userIdToDelete = req.params.userId;
        const adminUserId = req.user.userId; // 当前操作的管理员ID

        if (userIdToDelete === adminUserId) {
            return res.status(400).json({ message: '管理员不能删除自己。' });
        }

        const allUsersWithPasswords = await readFileDataInternal(path.join(DATA_DIR, 'users.json'), []);
        const userToDeleteData = allUsersWithPasswords.find(u => u.id === userIdToDelete);

        if (!userToDeleteData) {
            return res.status(404).json({ message: '未找到要删除的用户。' });
        }
        // 进一步保护，例如不允许删除名为 'admin' 的用户，如果它是系统初始管理员
        if (userToDeleteData.username === 'admin') {
             // 可以增加更复杂的判断，比如检查是否是系统中唯一的管理员等
             return res.status(403).json({ message: '不能删除名为 "admin" 的管理员账户。'});
        }

        // 1. 删除用户记录
        const remainingUsersWithPasswords = allUsersWithPasswords.filter(u => u.id !== userIdToDelete);
        await writeFileDataInternal(path.join(DATA_DIR, 'users.json'), remainingUsersWithPasswords);
        console.log(`[API /users/:userId DELETE] 用户 ${userToDeleteData.username} (ID: ${userIdToDelete}) 已从 users.json 删除。`);

        // 2. 删除该用户的 Webhook 配置
        const allWebhooks = await readFileDataInternal(path.join(DATA_DIR, 'webhooks.json'), []);
        const remainingWebhooks = allWebhooks.filter(wh => wh.userId !== userIdToDelete);
        if (allWebhooks.length !== remainingWebhooks.length) {
            await writeFileDataInternal(path.join(DATA_DIR, 'webhooks.json'), remainingWebhooks);
            console.log(`[API /users/:userId DELETE] 用户 ${userIdToDelete} 的 Webhook 配置已删除。`);
        }
        
        // 3. 删除该用户创建的模板 (如果模板是用户私有的，全局模板通常不应删除)
        // 注意：如果一个模板是全局的，但创建者是此用户，是否删除？当前逻辑是删除。
        // 如果希望保留全局模板，即使创建者被删除，这里的逻辑需要调整。
        const allTemplates = await readFileDataInternal(path.join(DATA_DIR, 'templates.json'), []);
        const remainingTemplates = allTemplates.filter(t => t.userId !== userIdToDelete);
        if (allTemplates.length !== remainingTemplates.length) {
            await writeFileDataInternal(path.join(DATA_DIR, 'templates.json'), remainingTemplates);
            console.log(`[API /users/:userId DELETE] 用户 ${userIdToDelete} 创建的模板已删除。`);
        }

        // 4. 删除该用户的定时任务
        const allTasks = await readFileDataInternal(path.join(DATA_DIR, 'scheduledTasks.json'), []);
        const remainingTasks = allTasks.filter(t => t.userId !== userIdToDelete);
        if (allTasks.length !== remainingTasks.length) {
            await writeFileDataInternal(path.join(DATA_DIR, 'scheduledTasks.json'), remainingTasks);
            console.log(`[API /users/:userId DELETE] 用户 ${userIdToDelete} 的定时任务已删除。`);
            // 也需要通知 taskService 取消这些任务的内存调度
            const tasksToDelete = allTasks.filter(t => t.userId === userIdToDelete);
            for (const task of tasksToDelete) {
                await taskService.cancelScheduledTask(task.id, userIdToDelete, true); // true表示强制取消，不校验操作者
            }
        }

        // 5. 删除该用户的发送历史文件
        // 需要知道该用户有哪些webhook ID
        const userWebhooksBeforeDeletion = allWebhooks.filter(wh => wh.userId === userIdToDelete);
        for (const wh of userWebhooksBeforeDeletion) {
            const historyFilePath = path.join(HISTORY_DIR, `history_${userIdToDelete}_${wh.id}.json`);
            try {
                await fs.unlink(historyFilePath);
                console.log(`[API /users/:userId DELETE] 已删除历史文件: ${historyFilePath}`);
            } catch (err) {
                if (err.code !== 'ENOENT') { // ENOENT 表示文件本就不存在，可以忽略
                    console.error(`[API /users/:userId DELETE] 删除历史文件 ${historyFilePath} 失败:`, err);
                }
            }
        }

        res.json({ success: true, message: `用户 ${userToDeleteData.username} 及其所有关联数据已删除。` });
    } catch (error) {
        console.error(`[API /users/${req.params.userId} (DELETE)] 删除用户错误:`, error);
        next(error);
    }
});


module.exports = router;
