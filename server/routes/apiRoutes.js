// server/routes/apiRoutes.js

const express = require('express');
const { v4: uuidv4 } = require('uuid'); // 用于生成唯一 ID
const storageService = require('../services/storageService'); // 数据持久化服务
const webhookService = require('../services/webhookService'); // 处理 Webhook 发送逻辑
const taskService = require('../services/taskService');       // 处理定时任务逻辑
const authMiddleware = require('../middleware/authMiddleware'); // 通用认证中间件
const { body, param, validationResult } = require('express-validator'); // 用于输入验证
const bcrypt = require('bcryptjs'); // 用于管理员创建用户时哈希密码
const fs = require('fs').promises; 
const path = require('path'); 

const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const HISTORY_DIR = path.join(DATA_DIR, 'history'); 

const router = express.Router();

router.use(authMiddleware);

function isAdmin(req, res, next) {
    if (req.user && req.user.role === 'admin') {
        next(); 
    } else {
        res.status(403).json({ message: '权限不足: 此操作需要管理员权限。', error: 'Forbidden' });
    }
}

router.get('/health', (req, res) => {
    res.json({ status: 'ok', message: 'API is healthy and authenticated.', user: req.user });
});

router.get('/data', async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const userRole = req.user.role;
        console.log(`[API /data] 用户 ${userId} (角色: ${userRole}) 请求数据。`);

        const webhooks = await storageService.getWebhooks(userId); 
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
            currentUser: { 
                id: req.user.userId,
                username: req.user.username,
                role: userRole,
                mustChangePassword: !!req.user.mustChangePassword
            }
        });
    } catch (error) {
        console.error("[API /data] 获取数据错误:", error);
        next(error); 
    }
});

router.post('/webhooks', async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const webhooksToSave = req.body;
        if (!Array.isArray(webhooksToSave)) {
            return res.status(400).json({ message: '请求体必须是一个 Webhook 配置数组' });
        }
        
        const validatedWebhooks = webhooksToSave.map(wh => {
            const newWh = {
                ...wh,
                id: wh.id || uuidv4(), 
                userId: userId,
            };
            newWh.templateIds = Array.isArray(wh.templateIds) ? wh.templateIds : (wh.templateId ? [wh.templateId] : []);
            delete newWh.templateId; 
            return newWh;
        });
        await storageService.saveWebhooks(validatedWebhooks, userId);
        const updatedWebhooks = await storageService.getWebhooks(userId); 
        res.json({ success: true, message: 'Webhook 配置已保存', webhooks: updatedWebhooks });
    } catch (error) {
        console.error("[API /webhooks] 保存 Webhook 配置错误:", error);
        next(error);
    }
});

router.get('/templates', isAdmin, async (req, res, next) => {
    try {
        const adminUserId = req.user.userId;
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
        const templatesToSaveFromClient = req.body; 
        
        if (!Array.isArray(templatesToSaveFromClient)) {
            return res.status(400).json({ message: '请求体必须是一个模板数组' });
        }

        await storageService.saveTemplates(templatesToSaveFromClient, adminUserId);
        const updatedTemplates = await storageService.getAccessibleTemplatesForUserDisplay(adminUserId, 'admin');
        
        let savedOrNewTemplateInfo = null;
        if (templatesToSaveFromClient.length > 0) {
            const clientNewTemplate = templatesToSaveFromClient.find(t => !t.id);
            if (clientNewTemplate) {
                savedOrNewTemplateInfo = updatedTemplates.find(
                    ut => ut.name === clientNewTemplate.name && 
                          ut.type === clientNewTemplate.type &&
                          ut.isGlobal === !!clientNewTemplate.isGlobal 
                );
            } else if (templatesToSaveFromClient.length === 1 && templatesToSaveFromClient[0].id) {
                savedOrNewTemplateInfo = updatedTemplates.find(ut => ut.id === templatesToSaveFromClient[0].id);
            }
        }

        res.json({
            success: true,
            message: '地址模板已保存',
            templates: updatedTemplates,
            savedTemplate: savedOrNewTemplateInfo 
        });
    } catch (error) {
        console.error("[API /templates (POST)] 保存模板错误:", error);
        next(error);
    }
});

router.post('/send-now', async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const webhookPayloadFromClient = req.body; 

        if (!webhookPayloadFromClient || !webhookPayloadFromClient.id) {
            return res.status(400).json({ message: '无效的 Webhook 发送请求体: 缺少配置ID (id 字段)' });
        }

        const webhookConfigId = webhookPayloadFromClient.id;
        const rawUserWebhooks = await storageService.getRawWebhooksForUser(userId);
        const webhookConfig = rawUserWebhooks.find(wh => wh.id === webhookConfigId);

        if (!webhookConfig) {
            return res.status(404).json({ message: `发送失败：未找到您账户下 ID 为 ${webhookConfigId} 的 Webhook 配置。` });
        }

        const templateIdsToUse = webhookPayloadFromClient.templateIds && webhookPayloadFromClient.templateIds.length > 0 
            ? webhookPayloadFromClient.templateIds 
            : webhookConfig.templateIds;

        if (!Array.isArray(templateIdsToUse) || templateIdsToUse.length === 0) {
             return res.status(400).json({ message: `发送失败：配置 "${webhookConfig.name}" 未指定任何有效的地址模板。`});
        }
        
        const servicePayload = {
            ...webhookPayloadFromClient, 
            templateIds: templateIdsToUse  
        };
        
        const resultEntry = await webhookService.sendWebhookRequest(servicePayload, userId, webhookConfig); 
        
        // Use overallHistoryEntry for status code decision from webhookService result
        const overallStatus = resultEntry.status;
        let httpStatusCode = 200; // Default to 200 for success or partial_success

        if (overallStatus === 'failure') {
            // If there's a specific error object with a statusCode (e.g., from operational errors), use it
            httpStatusCode = resultEntry.error?.statusCode || 500;
        }
        
        res.status(httpStatusCode).json(resultEntry);

    } catch (error) {
        console.error("[API /send-now] 立即发送错误:", error);
        const clientErrorMessage = error.isOperational ? error.message : '发送 Webhook 时发生内部错误';
        const statusCode = error.statusCode || 500;
        res.status(statusCode).json({ success: false, message: clientErrorMessage, error: { name: error.name, details: error.message, stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined } });
    }
});

router.post('/schedule-task', async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const userRole = req.user.role;
        const taskDataFromClient = req.body; 
        
        if (!taskDataFromClient || !taskDataFromClient.originalWebhookId || !taskDataFromClient.scheduledTime || 
            !taskDataFromClient.webhookSnapshot || !Array.isArray(taskDataFromClient.webhookSnapshot.templateIds) || taskDataFromClient.webhookSnapshot.templateIds.length === 0) {
            return res.status(400).json({ message: '无效的定时任务数据：缺少必要字段或templateIds。' });
        }
        
        const result = await taskService.scheduleNewTask(taskDataFromClient, userId, userRole);
        
        if (result && result.success) {
            const updatedTasks = await storageService.getScheduledTasks(userId); 
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

router.get('/uuid', (req, res) => {
    res.json({ uuid: uuidv4() });
});

// --- 用户管理 API (仅限管理员) ---
router.get('/users', isAdmin, async (req, res, next) => {
    try {
        const users = await storageService.getUsers(); // This already excludes password and sensitive login data
        // To show lockout status to admin, we need to fetch with sensitive data but then filter for display
        const allUsersFullData = await Promise.all(
            users.map(u => storageService.findUserById(u.id, true)) // true to include all data
        );
        const usersForAdminDisplay = allUsersFullData.map(user => {
            if (!user) return null; // Should not happen if getUsers worked
            // Admin needs to see lockout status
            return {
                id: user.id,
                username: user.username,
                role: user.role,
                mustChangePassword: !!user.mustChangePassword,
                createdAt: user.createdAt,
                updatedAt: user.updatedAt,
                failedLoginAttempts: user.failedLoginAttempts,
                lockoutUntil: user.lockoutUntil,
                lockoutLevel: user.lockoutLevel
            };
        }).filter(Boolean);

        res.json(usersForAdminDisplay);
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
            mustChangePassword: true 
        };
        const createdUser = await storageService.createUser(newUserInput); 
        res.status(201).json({ success: true, message: '用户创建成功。', user: createdUser });
    } catch (error) {
        console.error("[API /users (POST)] 创建用户错误:", error);
        next(error);
    }
});

// 新增：管理员手动解锁用户路由
router.post('/users/:userId/unlock', isAdmin, [
    param('userId').isUUID().withMessage('用户ID格式无效。')
], async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ message: '输入验证失败。', errors: errors.array() });
    }
    try {
        const targetUserId = req.params.userId;
        const adminUsername = req.user.username;

        const targetUser = await storageService.findUserById(targetUserId, true); // true to get all fields
        if (!targetUser) {
            return res.status(404).json({ message: '目标用户未找到。' });
        }

        if (targetUser.username === 'admin' && targetUser.id !== req.user.userId) {
             // Allowing admin to unlock the primary 'admin' account if needed, but log carefully.
             console.warn(`[API /users/:userId/unlock] 管理员 '${adminUsername}' 正在解锁系统 'admin' 用户 (ID: ${targetUserId})。`);
        } else if (targetUser.id === req.user.userId) {
            return res.status(400).json({ message: '管理员不能通过此接口解锁自己 (通常也不应被锁定)。' });
        }
        
        const updates = {
            failedLoginAttempts: 0,
            lockoutUntil: null,
            lockoutLevel: 0
        };

        await storageService.updateUser(targetUserId, updates);
        console.log(`[API /users/:userId/unlock] 管理员 '${adminUsername}' (ID: ${req.user.userId}) 已手动解锁用户 '${targetUser.username}' (ID: ${targetUserId})。`);
        res.json({ success: true, message: `用户 ${targetUser.username} 已成功解锁。` });

    } catch (error) {
        console.error(`[API /users/:userId/unlock] 管理员解锁用户 (ID: ${req.params.userId}) 失败:`, error);
        next(error);
    }
});


async function readFileDataInternal(filePath, defaultValue = []) {
    try {
        const fileContent = await fs.readFile(filePath, 'utf-8');
        if (fileContent.trim() === '') return defaultValue;
        return JSON.parse(fileContent);
    } catch (error) {
        if (error.code === 'ENOENT') { return defaultValue; }
        console.error(`[apiRoutes - readFileDataInternal] 读取文件 '${filePath}' 失败:`, error);
        throw error; 
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
        const adminUserId = req.user.userId; 

        if (userIdToDelete === adminUserId) {
            return res.status(400).json({ message: '管理员不能删除自己。' });
        }

        const allUsersWithPasswords = await readFileDataInternal(path.join(DATA_DIR, 'users.json'), []);
        const userToDeleteData = allUsersWithPasswords.find(u => u.id === userIdToDelete);

        if (!userToDeleteData) {
            return res.status(404).json({ message: '未找到要删除的用户。' });
        }
        if (userToDeleteData.username === 'admin') {
             return res.status(403).json({ message: '不能删除名为 "admin" 的系统管理员账户。'});
        }

        const remainingUsersWithPasswords = allUsersWithPasswords.filter(u => u.id !== userIdToDelete);
        await writeFileDataInternal(path.join(DATA_DIR, 'users.json'), remainingUsersWithPasswords);
        console.log(`[API /users/:userId DELETE] 用户 ${userToDeleteData.username} (ID: ${userIdToDelete}) 已从 users.json 删除。`);

        const allWebhooks = await readFileDataInternal(path.join(DATA_DIR, 'webhooks.json'), []);
        const remainingWebhooks = allWebhooks.filter(wh => wh.userId !== userIdToDelete);
        if (allWebhooks.length !== remainingWebhooks.length) {
            await writeFileDataInternal(path.join(DATA_DIR, 'webhooks.json'), remainingWebhooks);
            console.log(`[API /users/:userId DELETE] 用户 ${userIdToDelete} 的 Webhook 配置已删除。`);
        }
        
        const allTemplates = await readFileDataInternal(path.join(DATA_DIR, 'templates.json'), []);
        const remainingTemplates = allTemplates.filter(t => {
            if (t.userId === userIdToDelete && !t.isGlobal) return false;
            if (t.allowedUserIds && t.allowedUserIds.includes(userIdToDelete)) {
                t.allowedUserIds = t.allowedUserIds.filter(id => id !== userIdToDelete);
            }
            return true;
        });
        if (allTemplates.length !== remainingTemplates.length || JSON.stringify(allTemplates) !== JSON.stringify(remainingTemplates)) {
            await writeFileDataInternal(path.join(DATA_DIR, 'templates.json'), remainingTemplates);
            console.log(`[API /users/:userId DELETE] 用户 ${userIdToDelete} 创建的模板已删除或其授权已从其他模板移除。`);
        }


        const allTasks = await readFileDataInternal(path.join(DATA_DIR, 'scheduledTasks.json'), []);
        const remainingTasks = allTasks.filter(t => t.userId !== userIdToDelete);
        if (allTasks.length !== remainingTasks.length) {
            await writeFileDataInternal(path.join(DATA_DIR, 'scheduledTasks.json'), remainingTasks);
            console.log(`[API /users/:userId DELETE] 用户 ${userIdToDelete} 的定时任务已删除。`);
            const tasksToDelete = allTasks.filter(t => t.userId === userIdToDelete);
            for (const task of tasksToDelete) {
                await taskService.cancelScheduledTask(task.id, userIdToDelete, true); 
            }
        }

        const userWebhooksBeforeDeletion = allWebhooks.filter(wh => wh.userId === userIdToDelete);
        for (const wh of userWebhooksBeforeDeletion) {
            const historyFilePath = path.join(HISTORY_DIR, `history_${userIdToDelete}_${wh.id}.json`);
            try {
                await fs.unlink(historyFilePath);
                console.log(`[API /users/:userId DELETE] 已删除历史文件: ${historyFilePath}`);
            } catch (err) {
                if (err.code !== 'ENOENT') { 
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