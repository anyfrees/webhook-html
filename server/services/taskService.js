// server/services/taskService.js

const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');
const storageService = require('./storageService');
const webhookService = require('./webhookService');
const { encryptText, decryptText } = require('./cryptoService');

const activeScheduledJobs = new Map();

async function executeScheduledTask(preparedTaskContext, userId) {
    const taskId = preparedTaskContext.id;
    const taskNameForLog = preparedTaskContext.webhookSnapshot?.name || '未命名任务';
    console.log(`[TaskService - execute] 开始执行任务 ID: ${taskId}, 名称: "${taskNameForLog}" (用户: ${userId})`);
    try {
        let payloadForWebhookService;

        if (preparedTaskContext.templateType === 'workweixin') {
            if (!preparedTaskContext.workweixinConfig || !preparedTaskContext.webhookSnapshot) {
                throw new Error(`企业微信任务 ${taskId} 的配置不完整 (workweixinConfig 或 webhookSnapshot 缺失)。`);
            }
            payloadForWebhookService = {
                originalWebhookId: preparedTaskContext.originalWebhookId,
                templateType: 'workweixin',
                workweixinConfig: preparedTaskContext.workweixinConfig,
                body: preparedTaskContext.webhookSnapshot.plainBody,
                webhookSnapshot: preparedTaskContext.webhookSnapshot,
                isScheduledTaskRun: true
            };
        } else if (preparedTaskContext.templateType === 'generic') {
            if (!preparedTaskContext.finalUrl || typeof preparedTaskContext.finalUrl !== 'string' || preparedTaskContext.finalUrl.trim() === '') {
                console.error(`[TaskService - execute] 通用任务 ${taskId} 的 finalUrl 无效或为空: "${preparedTaskContext.finalUrl}"`);
                throw new Error(`通用任务 ${taskId} 的 finalUrl 无效或为空。`);
            }
            if (!preparedTaskContext.webhookSnapshot) {
                 throw new Error(`通用任务 ${taskId} 的 webhookSnapshot 缺失。`);
            }
            payloadForWebhookService = {
                originalWebhookId: preparedTaskContext.originalWebhookId,
                templateType: 'generic',
                url: preparedTaskContext.finalUrl.trim(), // 确保 trim
                method: preparedTaskContext.webhookSnapshot.method,
                headers: preparedTaskContext.webhookSnapshot.headers,
                body: webhookService.constructBodyFromSnapshot(preparedTaskContext.webhookSnapshot),
                webhookSnapshot: preparedTaskContext.webhookSnapshot,
                isScheduledTaskRun: true
            };
            console.log(`[TaskService - execute] Generic task payload for webhookService, URL: "${payloadForWebhookService.url}"`);
        } else {
            throw new Error(`未知的任务模板类型: ${preparedTaskContext.templateType} for task ID: ${taskId}`);
        }

        await webhookService.sendWebhookRequest(payloadForWebhookService, userId);
        console.log(`[TaskService - execute] 任务 ID: ${taskId} (用户: ${userId}) 调用 webhookService 完成。`);

    } catch (error) {
        console.error(`[TaskService - execute] 执行任务 ID: ${taskId} (用户: ${userId}) 失败:`, error.message, error.stack);
    } finally {
        try {
            const userTasks = await storageService.getAllRawScheduledTasks(userId);
            const remainingTasks = userTasks.filter(t => t.id !== taskId);
            await storageService.saveScheduledTasks(remainingTasks, userId);
            activeScheduledJobs.delete(taskId);
            console.log(`[TaskService - execute] 任务 ID: ${taskId} (用户: ${userId}) 已从存储和活动任务列表中移除。`);
        } catch (storageError) {
            console.error(`[TaskService - execute] 从存储中移除已执行任务 ID: ${taskId} (用户: ${userId}) 失败:`, storageError);
        }
    }
}

function prepareTaskForExecutionAndScheduling(rawTaskFromStorage) {
    if (!rawTaskFromStorage || !rawTaskFromStorage.id || !rawTaskFromStorage.userId) {
        console.warn('[TaskService - prepareTask] 尝试准备的任务数据不完整或缺少userId:', rawTaskFromStorage);
        return null;
    }

    let decryptedFinalUrl = null;
    if (rawTaskFromStorage.templateType === 'generic') {
        console.log(`[TaskService - prepareTask] Raw finalUrl from storage for generic task ${rawTaskFromStorage.id}: "${rawTaskFromStorage.finalUrl}"`);
        decryptedFinalUrl = decryptText(rawTaskFromStorage.finalUrl);
        console.log(`[TaskService - prepareTask] Decrypted finalUrl for generic task ${rawTaskFromStorage.id}: "${decryptedFinalUrl}"`);
        if (typeof decryptedFinalUrl !== 'string' || decryptedFinalUrl.trim() === '') {
            console.warn(`[TaskService - prepareTask] 解密后的 finalUrl 对于任务 ${rawTaskFromStorage.id} 无效或为空: "${decryptedFinalUrl}"`);
            // 根据策略，这里可以返回 null 或抛出错误，阻止无效任务被调度
        }
    }

    const preparedTask = {
        ...rawTaskFromStorage,
        finalUrl: decryptedFinalUrl, // 只有 generic 类型有这个
        webhookSnapshot: rawTaskFromStorage.webhookSnapshot ? {
            ...rawTaskFromStorage.webhookSnapshot,
            url: decryptText(rawTaskFromStorage.webhookSnapshot.url),
        } : undefined,
    };

    if (rawTaskFromStorage.templateType === 'workweixin' && rawTaskFromStorage.workweixinConfig) {
        preparedTask.workweixinConfig = {
            ...rawTaskFromStorage.workweixinConfig,
            corpid: decryptText(rawTaskFromStorage.workweixinConfig.corpid),
            agentid: decryptText(rawTaskFromStorage.workweixinConfig.agentid),
            // corpsecret 保持加密
        };
    }
    return preparedTask;
}

function scheduleSingleTaskTimeout(preparedTaskContext) {
    // ... (之前的逻辑保持不变，但要确保 preparedTaskContext.finalUrl 对于通用类型是有效的) ...
    if (!preparedTaskContext || !preparedTaskContext.id || !preparedTaskContext.scheduledTime || !preparedTaskContext.userId) {
        console.error('[TaskService - scheduleSingle] 无法调度任务：任务上下文不完整或缺少 userId。', preparedTaskContext);
        return;
    }
    if (preparedTaskContext.templateType === 'generic' && (!preparedTaskContext.finalUrl || typeof preparedTaskContext.finalUrl !== 'string' || preparedTaskContext.finalUrl.trim() === '')) {
        console.error(`[TaskService - scheduleSingle] 无法调度通用任务 ID: ${preparedTaskContext.id} 因为 finalUrl 无效: "${preparedTaskContext.finalUrl}"`);
        // 也许应该从存储中删除这个无效的任务
        storageService.getAllRawScheduledTasks(preparedTaskContext.userId)
            .then(tasks => tasks.filter(t => t.id !== preparedTaskContext.id))
            .then(remainingTasks => storageService.saveScheduledTasks(remainingTasks, preparedTaskContext.userId))
            .then(() => console.log(`[TaskService - scheduleSingle] 已从存储中移除 finalUrl 无效的任务 ID: ${preparedTaskContext.id}`))
            .catch(err => console.error(`[TaskService - scheduleSingle] 移除无效任务 ${preparedTaskContext.id} 失败:`, err));
        return;
    }


    const scheduledTime = new Date(preparedTaskContext.scheduledTime);
    const now = new Date();

    if (scheduledTime > now) {
        const delay = scheduledTime.getTime() - now.getTime();
        console.log(`[TaskService - scheduleSingle] 调度一次性任务 ID: ${preparedTaskContext.id} (用户: ${preparedTaskContext.userId}) 在 ${scheduledTime.toLocaleString()} (延迟: ${Math.round(delay/1000)}s)`);
        console.log(`[TaskService - scheduleSingle] Task context to be executed:`, JSON.stringify(preparedTaskContext, null, 2).substring(0, 500) + "...");

        const timeoutId = setTimeout(async () => {
            activeScheduledJobs.delete(preparedTaskContext.id);
            await executeScheduledTask(preparedTaskContext, preparedTaskContext.userId);
        }, delay);
        activeScheduledJobs.set(preparedTaskContext.id, { type: 'timeout', id: timeoutId, taskContext: preparedTaskContext, userId: preparedTaskContext.userId });
    } else {
        console.warn(`[TaskService - scheduleSingle] 任务 ID: ${preparedTaskContext.id} (用户: ${preparedTaskContext.userId}) 的计划时间 (${scheduledTime.toLocaleString()}) 已过，将尝试立即执行并移除。`);
        executeScheduledTask(preparedTaskContext, preparedTaskContext.userId).catch(err => {
            console.error(`[TaskService - scheduleSingle] 立即执行过期任务 ${preparedTaskContext.id} (用户: ${preparedTaskContext.userId}) 失败:`, err);
        });
    }
}

async function initializeScheduledTasks() {
    // ... (之前的逻辑保持不变，但 scheduleSingleTaskTimeout 现在会检查 finalUrl) ...
    console.log('[TaskService - init] 正在初始化所有用户的定时任务...');
    activeScheduledJobs.forEach(jobEntry => {
        if (jobEntry.type === 'timeout') clearTimeout(jobEntry.id);
    });
    activeScheduledJobs.clear();

    try {
        const allRawTasksFromStorage = await storageService.getAllRawScheduledTasks();
        console.log(`[TaskService - init] 从存储中加载了 ${allRawTasksFromStorage.length} 个原始任务进行初始化。`);

        const tasksToActuallySchedule = [];
        const tasksAlreadyExpiredIds = [];
        const now = Date.now();

        for (const rawTask of allRawTasksFromStorage) {
            if (new Date(rawTask.scheduledTime).getTime() > now) {
                tasksToActuallySchedule.push(rawTask);
            } else {
                console.warn(`[TaskService - init] 启动时发现过期任务 ID: ${rawTask.id} (用户: ${rawTask.userId}, 计划: ${new Date(rawTask.scheduledTime).toLocaleString()}), 将被移除。`);
                tasksAlreadyExpiredIds.push(rawTask.id);
            }
        }

        if (tasksAlreadyExpiredIds.length > 0) {
            const currentTasks = await storageService.getAllRawScheduledTasks();
            const validTasksAfterExpiryCheck = currentTasks.filter(task => !tasksAlreadyExpiredIds.includes(task.id));
            await storageService.saveScheduledTasks(validTasksAfterExpiryCheck, null);
            console.log(`[TaskService - init] 已从存储中移除 ${tasksAlreadyExpiredIds.length} 个在启动时发现的过期任务。`);
        }

        for (const rawTask of tasksToActuallySchedule) {
            const preparedTask = prepareTaskForExecutionAndScheduling(rawTask);
            if (preparedTask) {
                scheduleSingleTaskTimeout(preparedTask);
            } else {
                 console.warn(`[TaskService - init] 任务数据准备失败，无法调度任务: `, rawTask);
            }
        }
        console.log(`[TaskService - init] ${activeScheduledJobs.size} 个有效任务已调度。`);
    } catch (error) {
        console.error('[TaskService - init] 初始化定时任务失败:', error);
    }
}

async function scheduleNewTask(taskDataFromClient, userId) {
    console.log(`[TaskService - scheduleNew] 准备调度新任务，用户ID: ${userId}, 关联配置ID: ${taskDataFromClient.originalWebhookId}`);
    console.log(`[TaskService - scheduleNew] Client payload:`, JSON.stringify(taskDataFromClient, null, 2).substring(0, 1000) + "...");

    try {
        if (!taskDataFromClient.originalWebhookId || !taskDataFromClient.scheduledTime || !taskDataFromClient.webhookSnapshot) {
            throw new Error('创建定时任务失败：缺少必要的任务信息。');
        }
        const scheduledTime = new Date(taskDataFromClient.scheduledTime);
        if (isNaN(scheduledTime.getTime()) || scheduledTime <= new Date()) {
            throw new Error('创建定时任务失败：计划发送时间无效或已过期。');
        }

        // 确保 finalUrl 存在且有效（对于通用类型）
        if (taskDataFromClient.templateType === 'generic' && (!taskDataFromClient.finalUrl || typeof taskDataFromClient.finalUrl !== 'string' || taskDataFromClient.finalUrl.trim() === '')) {
            console.error('[TaskService - scheduleNew] 尝试创建通用定时任务但 finalUrl 无效:', taskDataFromClient.finalUrl);
            throw new Error('创建通用定时任务失败：finalUrl 无效或未提供。');
        }


        const taskId = uuidv4();
        const rawTaskToStore = {
            id: taskId,
            userId: userId,
            originalWebhookId: taskDataFromClient.originalWebhookId,
            scheduledTime: taskDataFromClient.scheduledTime,
            templateType: taskDataFromClient.templateType,
            webhookSnapshot: {
                ...taskDataFromClient.webhookSnapshot,
                url: encryptText(taskDataFromClient.webhookSnapshot.url),
            },
            // finalUrl 只有通用类型有，并且在客户端已经准备好
            finalUrl: taskDataFromClient.templateType === 'generic' ? encryptText(taskDataFromClient.finalUrl.trim()) : null,
        };
        if (taskDataFromClient.templateType === 'generic') {
             console.log(`[TaskService - scheduleNew] Client finalUrl for generic: "${taskDataFromClient.finalUrl}", Encrypted for storage: "${rawTaskToStore.finalUrl}"`);
        }


        if (taskDataFromClient.templateType === 'workweixin') {
            if (!taskDataFromClient.workweixinConfig || !taskDataFromClient.workweixinConfig.corpid || !taskDataFromClient.workweixinConfig.agentid) {
                throw new Error('创建企业微信定时任务失败：请求体中缺少 workweixinConfig 或其内部的 corpid/agentid。');
            }
            const rawTemplate = await storageService.getRawTemplateByIdForUser(taskDataFromClient.webhookSnapshot.templateId, userId);
            if (!rawTemplate || !rawTemplate.corpsecret) {
                throw new Error(`创建企业微信定时任务失败：无法找到关联模板 (ID: ${taskDataFromClient.webhookSnapshot.templateId}) 的加密 CorpSecret。`);
            }
            rawTaskToStore.workweixinConfig = {
                corpid: encryptText(taskDataFromClient.workweixinConfig.corpid),
                corpsecret: rawTemplate.corpsecret,
                agentid: encryptText(taskDataFromClient.workweixinConfig.agentid),
                touser: taskDataFromClient.workweixinConfig.touser,
                msgtype: taskDataFromClient.workweixinConfig.msgtype,
            };
            delete rawTaskToStore.finalUrl; // 企业微信任务不使用 finalUrl
        }
        console.log(`[TaskService - scheduleNew] Raw task to store:`, JSON.stringify(rawTaskToStore, null, 2).substring(0, 1000) + "...");

        const userTasks = await storageService.getAllRawScheduledTasks(userId);
        userTasks.push(rawTaskToStore);
        await storageService.saveScheduledTasks(userTasks, userId);

        const preparedTask = prepareTaskForExecutionAndScheduling(rawTaskToStore);
        if (preparedTask) {
            scheduleSingleTaskTimeout(preparedTask);
        } else {
            throw new Error("任务数据准备失败，无法调度。");
        }
        console.log(`[TaskService - scheduleNew] 新任务 ID: ${taskId} (用户: ${userId}) 已成功创建并调度。`);
        return { success: true, taskId: taskId };

    } catch (error) {
        console.error(`[TaskService - scheduleNew] 调度新任务失败 (用户ID: ${userId}):`, error.message, error.stack);
        return { success: false, msg: error.message || '调度新任务时发生未知错误。' };
    }
}

async function cancelScheduledTask(taskId, userId) {
    // ... (之前的逻辑保持不变) ...
    console.log(`[TaskService - cancel] 用户 ${userId} 尝试取消任务 ID: ${taskId}`);
    try {
        const jobEntry = activeScheduledJobs.get(taskId);
        if (jobEntry) {
            if (jobEntry.userId !== userId) {
                 console.warn(`[TaskService - cancel] 权限不足: 用户 ${userId} 尝试取消不属于自己的活动任务 ${taskId} (属于 ${jobEntry.userId})`);
                 return { success: false, msg: '权限不足，无法取消此活动任务。' };
            }
            if (jobEntry.type === 'timeout') clearTimeout(jobEntry.id);
            activeScheduledJobs.delete(taskId);
            console.log(`[TaskService - cancel] 内存中的活动任务 ID: ${taskId} 已停止。`);
        } else {
            console.warn(`[TaskService - cancel] 未在内存中找到活动任务 ID: ${taskId}。将继续尝试从存储中删除。`);
        }

        const userTasks = await storageService.getAllRawScheduledTasks(userId);
        const taskInStorage = userTasks.find(t => t.id === taskId);

        if (!taskInStorage) {
            console.warn(`[TaskService - cancel] 未在存储中找到任务 ID: ${taskId} (用户: ${userId})`);
            return { success: false, msg: '未在存储中找到指定的定时任务，或任务不属于您。' };
        }

        const remainingTasks = userTasks.filter(t => t.id !== taskId);
        await storageService.saveScheduledTasks(remainingTasks, userId);

        console.log(`[TaskService - cancel] 任务 ID: ${taskId} (用户: ${userId}) 已成功从存储中移除。`);
        return { success: true, msg: '定时任务已取消。' };

    } catch (error) {
        console.error(`[TaskService - cancel] 取消任务 ID: ${taskId} (用户: ${userId}) 失败:`, error);
        return { success: false, msg: error.message || '取消定时任务时发生未知错误。' };
    }
}

module.exports = {
    initializeScheduledTasks,
    scheduleNewTask,
    cancelScheduledTask,
};
