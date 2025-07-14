// server/services/taskService.js

const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');
const storageService = require('./storageService');
const webhookService = require('./webhookService');
const { encryptText, decryptText } = require('./cryptoService');

const activeScheduledJobs = new Map();

/**
 * 将前端的循环规则转换为 Cron 表达式。
 * @param {Object} recurrenceRule - { type: 'daily'/'weekly', time: 'HH:mm', daysOfWeek: [0-6] }
 * @returns {string|null} Cron 表达式或 null。
 */
function convertRecurrenceToCron(recurrenceRule) {
    if (!recurrenceRule || !recurrenceRule.type || !recurrenceRule.time) {
        return null;
    }
    const [hour, minute] = recurrenceRule.time.split(':');

    switch (recurrenceRule.type) {
        case 'daily':
            // 每天在指定时间执行: "分 时 * * *"
            return `${minute} ${hour} * * *`;
        case 'weekly':
            if (!recurrenceRule.daysOfWeek || recurrenceRule.daysOfWeek.length === 0) {
                return null;
            }
            // 每周在指定天的指定时间执行: "分 时 * * 天" (0=周日, 1=周一, ...)
            const days = recurrenceRule.daysOfWeek.join(',');
            return `${minute} ${hour} * * ${days}`;
        default:
            return null;
    }
}


/**
 * 执行已准备好的定时任务上下文
 * @param {Object} preparedTaskContext - 经过 prepareTaskForExecutionAndScheduling 处理的任务对象
 * @param {string} userId - 执行任务的用户ID (通常与 preparedTaskContext.userId 相同)
 */
async function executeScheduledTask(preparedTaskContext, userId) {
    const taskId = preparedTaskContext.id;
    const taskNameForLog = preparedTaskContext.webhookSnapshot?.name || '未命名任务';
    console.log(`[TaskService - execute] 开始执行任务 ID: ${taskId}, 名称: "${taskNameForLog}" (用户: ${userId})`);
    try {
        let payloadForWebhookService;
        const webhookSnapshot = preparedTaskContext.webhookSnapshot;

        if (!webhookSnapshot || !Array.isArray(webhookSnapshot.templateIds) || webhookSnapshot.templateIds.length === 0) {
            throw new Error(`任务 ${taskId} 的快照无效或缺少 templateIds。`);
        }

        payloadForWebhookService = {
            originalWebhookId: preparedTaskContext.originalWebhookId,
            templateIds: webhookSnapshot.templateIds,
            phone: webhookSnapshot.phoneNumber || webhookSnapshot.touser,
            plainBody: webhookSnapshot.plainBody,
            headers: webhookSnapshot.headers,
            isScheduledTaskRun: true,
            webhookSnapshot: webhookSnapshot,
            templateType: preparedTaskContext.templateType,
        };

        if (preparedTaskContext.templateType === 'generic' && preparedTaskContext.finalUrl) {
        } else if (preparedTaskContext.templateType === 'workweixin' && preparedTaskContext.workweixinConfig) {
        }

        console.log(`[TaskService - execute] 任务 ${taskId} 构造的 payloadForWebhookService (部分):`, {
            originalWebhookId: payloadForWebhookService.originalWebhookId,
            templateIds: payloadForWebhookService.templateIds,
            isScheduledTaskRun: payloadForWebhookService.isScheduledTaskRun,
            primaryTemplateType: payloadForWebhookService.templateType
        });

        await webhookService.sendWebhookRequest(payloadForWebhookService, userId);
        console.log(`[TaskService - execute] 任务 ID: ${taskId} (用户: ${userId}) 调用 webhookService 完成。`);

    } catch (error) {
        console.error(`[TaskService - execute] 执行任务 ID: ${taskId} (用户: ${userId}) 失败:`, error.message, error.stack);
    } finally {
        // 对于非循环任务，执行后删除
        if (!preparedTaskContext.recurrenceRule || preparedTaskContext.recurrenceRule.type === 'once') {
            try {
                // [BUG修复] 调用新的原子化删除函数
                await storageService.removeScheduledTask(taskId);
                activeScheduledJobs.delete(taskId);
                console.log(`[TaskService - execute] 一次性任务 ID: ${taskId} (用户: ${userId}) 已从存储和活动任务列表中移除。`);
            } catch (storageError) {
                console.error(`[TaskService - execute] 从存储中移除已执行的一次性任务 ID: ${taskId} (用户: ${userId}) 失败:`, storageError);
            }
        }
    }
}

/**
 * 准备从存储中加载的任务以供执行和调度 (解密必要字段)
 * @param {Object} rawTaskFromStorage - 从 storageService.getAllRawScheduledTasks 获取的原始任务对象
 * @returns {Object|null} 处理过的任务对象，或 null 如果任务无效
 */
function prepareTaskForExecutionAndScheduling(rawTaskFromStorage) {
    if (!rawTaskFromStorage || !rawTaskFromStorage.id || !rawTaskFromStorage.userId || !rawTaskFromStorage.webhookSnapshot) {
        console.warn('[TaskService - prepareTask] 尝试准备的任务数据不完整或缺少 userId/webhookSnapshot:', rawTaskFromStorage);
        return null;
    }

    const webhookSnapshot = {
        ...rawTaskFromStorage.webhookSnapshot,
        templateIds: Array.isArray(rawTaskFromStorage.webhookSnapshot.templateIds) ? rawTaskFromStorage.webhookSnapshot.templateIds : []
    };

    let decryptedFinalUrl = null;
    if (rawTaskFromStorage.templateType === 'generic' && rawTaskFromStorage.finalUrl) {
        decryptedFinalUrl = decryptText(rawTaskFromStorage.finalUrl);
        if (typeof decryptedFinalUrl !== 'string' || decryptedFinalUrl.trim() === '') {
            console.warn(`[TaskService - prepareTask] 解密后的 finalUrl 对于任务 ${rawTaskFromStorage.id} 无效或为空: "${decryptedFinalUrl}"`);
        }
    }

    if (webhookSnapshot.url && rawTaskFromStorage.templateType === 'generic' && webhookSnapshot.templateIds.length <= 1) {
         webhookSnapshot.url = decryptText(webhookSnapshot.url);
    }

    const preparedTask = {
        ...rawTaskFromStorage,
        finalUrl: decryptedFinalUrl,
        webhookSnapshot: webhookSnapshot,
    };

    if (rawTaskFromStorage.templateType === 'workweixin' && rawTaskFromStorage.workweixinConfig) {
        preparedTask.workweixinConfig = {
            ...rawTaskFromStorage.workweixinConfig,
            corpid: decryptText(rawTaskFromStorage.workweixinConfig.corpid),
            agentid: decryptText(rawTaskFromStorage.workweixinConfig.agentid),
        };
    }
    return preparedTask;
}


function scheduleTaskJob(preparedTaskContext) {
    if (!preparedTaskContext || !preparedTaskContext.id || !preparedTaskContext.userId) {
        console.error('[TaskService - scheduleTaskJob] 无法调度任务：任务上下文不完整。', preparedTaskContext);
        return;
    }

    const { id: taskId, scheduledTime, recurrenceRule, userId } = preparedTaskContext;
    const cronExpression = recurrenceRule ? convertRecurrenceToCron(recurrenceRule) : null;

    if (cronExpression) { // 循环任务
        if (cron.validate(cronExpression)) {
            console.log(`[TaskService - scheduleTaskJob] 调度循环任务 ID: ${taskId}, Cron: "${cronExpression}"`);
            const job = cron.schedule(cronExpression, async () => {
                console.log(`[TaskService - cronFired] Cron 任务触发，ID: ${taskId}`);
                await executeScheduledTask(preparedTaskContext, userId);
            });
            activeScheduledJobs.set(taskId, { type: 'cron', job: job, taskContext: preparedTaskContext, userId: userId });
        } else {
            console.error(`[TaskService - scheduleTaskJob] 任务 ID: ${taskId} 的 Cron 表达式 "${cronExpression}" 无效。`);
        }
    } else { // 一次性任务
        const scheduledDate = new Date(scheduledTime);
        const now = new Date();
        if (scheduledDate > now) {
            const delay = scheduledDate.getTime() - now.getTime();
            console.log(`[TaskService - scheduleTaskJob] 调度一次性任务 ID: ${taskId} 在 ${scheduledDate.toLocaleString()} (延迟: ${Math.round(delay/1000)}s)`);
            const timeoutId = setTimeout(async () => {
                console.log(`[TaskService - timeoutFired] 定时器触发，任务ID: ${taskId}`);
                activeScheduledJobs.delete(taskId);
                await executeScheduledTask(preparedTaskContext, userId);
            }, delay);
            activeScheduledJobs.set(taskId, { type: 'timeout', id: timeoutId, taskContext: preparedTaskContext, userId: userId });
        } else {
            console.warn(`[TaskService - scheduleTaskJob] 一次性任务 ID: ${taskId} 的计划时间 (${scheduledDate.toLocaleString()}) 已过，将尝试立即执行并移除。`);
            executeScheduledTask(preparedTaskContext, userId).catch(err => {
                console.error(`[TaskService - scheduleTaskJob] 立即执行过期任务 ${taskId} 失败:`, err);
            });
        }
    }
}

async function initializeScheduledTasks() {
    console.log('[TaskService - init] 正在初始化所有用户的定时任务...');
    activeScheduledJobs.forEach(jobEntry => {
        if (jobEntry.type === 'cron') jobEntry.job.stop();
        if (jobEntry.type === 'timeout') clearTimeout(jobEntry.id);
    });
    activeScheduledJobs.clear();

    try {
        const allRawTasksFromStorage = await storageService.getAllRawScheduledTasks();
        console.log(`[TaskService - init] 从存储中加载了 ${allRawTasksFromStorage.length} 个原始任务进行初始化。`);

        const tasksToProcess = [];
        const tasksToRemoveIds = [];
        const now = Date.now();

        for (const rawTask of allRawTasksFromStorage) {
            if (!rawTask.webhookSnapshot || !Array.isArray(rawTask.webhookSnapshot.templateIds) || rawTask.webhookSnapshot.templateIds.length === 0) {
                console.warn(`[TaskService - init] 任务 ID: ${rawTask.id} 无效 (缺少templateIds)，将被移除。`);
                tasksToRemoveIds.push(rawTask.id);
                continue;
            }
            // 只有一次性任务才检查是否过期
            if (!rawTask.recurrenceRule || rawTask.recurrenceRule.type === 'once') {
                if (new Date(rawTask.scheduledTime).getTime() <= now) {
                    console.warn(`[TaskService - init] 启动时发现过期的一次性任务 ID: ${rawTask.id} (用户: ${rawTask.userId}), 将被移除。`);
                    tasksToRemoveIds.push(rawTask.id);
                } else {
                    tasksToProcess.push(rawTask);
                }
            } else { // 循环任务总是需要被调度
                tasksToProcess.push(rawTask);
            }
        }

        if (tasksToRemoveIds.length > 0) {
            const currentTasksInStorage = await storageService.getAllRawScheduledTasks();
            const validTasksAfterExpiryCheck = currentTasksInStorage.filter(task => !tasksToRemoveIds.includes(task.id));
            // [BUG修复] 调用 saveScheduledTasks 进行批量覆盖
            await storageService.saveScheduledTasks(validTasksAfterExpiryCheck);
            console.log(`[TaskService - init] 已从存储中移除 ${tasksToRemoveIds.length} 个在启动时发现的过期或无效任务。`);
        }

        for (const rawTask of tasksToProcess) {
            const preparedTask = prepareTaskForExecutionAndScheduling(rawTask);
            if (preparedTask) {
                scheduleTaskJob(preparedTask);
            } else {
                 console.warn(`[TaskService - init] 任务数据准备失败，无法调度任务: `, rawTask);
            }
        }
        console.log(`[TaskService - init] ${activeScheduledJobs.size} 个有效任务已调度。`);
    } catch (error) {
        console.error('[TaskService - init] 初始化定时任务失败:', error);
    }
}

/**
 * 调度一个新的定时任务
 * @param {Object} taskDataFromClient - 从客户端API接收的任务数据
 * - originalWebhookId, scheduledTime, webhookSnapshot, recurrenceRule
 * @param {string} userId - 创建任务的用户ID
 * @param {string} userRole - 创建任务的用户角色
 * @returns {Promise<Object>} 包含成功状态和任务ID的对象
 */
async function scheduleNewTask(taskDataFromClient, userId, userRole) {
    console.log(`[TaskService - scheduleNew] 准备调度新任务，用户ID: ${userId}, 关联配置ID: ${taskDataFromClient.originalWebhookId}`);
    try {
        const { originalWebhookId, scheduledTime, webhookSnapshot, recurrenceRule } = taskDataFromClient;

        if (!originalWebhookId || !webhookSnapshot || !Array.isArray(webhookSnapshot.templateIds) || webhookSnapshot.templateIds.length === 0) {
            throw new Error('创建定时任务失败：缺少必要信息 (配置ID, 快照, 模板ID列表)。');
        }
        if ((!recurrenceRule || recurrenceRule.type === 'once') && (!scheduledTime || new Date(scheduledTime) <= new Date())) {
            throw new Error('创建一次性定时任务失败：计划发送时间无效或已过期。');
        }
        if (recurrenceRule && recurrenceRule.type !== 'once' && !recurrenceRule.time) {
            throw new Error('创建循环定时任务失败：缺少执行时间。');
        }

        const firstTemplateId = webhookSnapshot.templateIds[0];
        const firstRawTemplate = await storageService.getRawTemplateByIdForUserAccess(firstTemplateId, userId, userRole);
        if (!firstRawTemplate) {
            throw new Error(`创建定时任务失败：无法找到或无权访问首个关联的地址模板 (ID: ${firstTemplateId})。`);
        }
        const primaryTemplateType = firstRawTemplate.type;

        const taskId = uuidv4();
        const rawTaskToStore = {
            id: taskId,
            userId: userId,
            originalWebhookId: originalWebhookId,
            scheduledTime: scheduledTime, // 对循环任务，这可能是“首次”或仅作参考
            recurrenceRule: recurrenceRule, // 存储循环规则
            templateType: primaryTemplateType,
            webhookSnapshot: webhookSnapshot,
            finalUrl: null,
            workweixinConfig: null
        };

        if (primaryTemplateType === 'generic' && taskDataFromClient.finalUrl) {
            rawTaskToStore.finalUrl = encryptText(taskDataFromClient.finalUrl.trim());
        } else if (primaryTemplateType === 'workweixin') {
            if (!firstRawTemplate.corpid || !firstRawTemplate.agentid || !firstRawTemplate.corpsecret) {
                 throw new Error(`创建企业微信定时任务失败：模板 (ID: ${firstRawTemplate.id}) 缺少配置。`);
            }
            rawTaskToStore.workweixinConfig = {
                corpid: firstRawTemplate.corpid,
                corpsecret: firstRawTemplate.corpsecret,
                agentid: firstRawTemplate.agentid,
                touser: webhookSnapshot.touser,
                msgtype: firstRawTemplate.workweixin_msgtype,
            };
            delete rawTaskToStore.finalUrl;
        }

        // [BUG修复] 调用新的原子化添加函数
        await storageService.addScheduledTask(rawTaskToStore);

        const preparedTask = prepareTaskForExecutionAndScheduling(rawTaskToStore);
        if (preparedTask) {
            scheduleTaskJob(preparedTask);
        } else {
            console.error(`[TaskService - scheduleNew] 任务 ${taskId} 存储后准备失败，无法调度。`);
            throw new Error("任务数据存储后准备失败。");
        }
        console.log(`[TaskService - scheduleNew] 新任务 ID: ${taskId} (用户: ${userId}) 已成功创建并调度。`);
        return { success: true, taskId: taskId };

    } catch (error) {
        console.error(`[TaskService - scheduleNew] 调度新任务失败 (用户ID: ${userId}):`, error.message, error.stack);
        return { success: false, msg: error.message || '调度新任务时发生未知错误。' };
    }
}


async function cancelScheduledTask(taskId, userId, forceAdminCancel = false) {
    console.log(`[TaskService - cancel] 用户 ${userId} 尝试取消任务 ID: ${taskId}, forceAdmin: ${forceAdminCancel}`);
    try {
        const jobEntry = activeScheduledJobs.get(taskId);
        if (jobEntry) {
            if (!forceAdminCancel && jobEntry.userId !== userId) {
                 console.warn(`[TaskService - cancel] 权限不足: 用户 ${userId} 尝试取消不属于自己的活动任务 ${taskId}`);
                 return { success: false, msg: '权限不足，无法取消此活动任务。' };
            }
            if (jobEntry.type === 'cron') jobEntry.job.stop();
            if (jobEntry.type === 'timeout') clearTimeout(jobEntry.id);
            activeScheduledJobs.delete(taskId);
            console.log(`[TaskService - cancel] 内存中的活动任务 ID: ${taskId} 已停止。`);
        } else {
            console.warn(`[TaskService - cancel] 未在内存中找到活动任务 ID: ${taskId}。将继续尝试从存储中删除。`);
        }

        // [BUG修复] 检查任务是否存在于存储中，然后再删除
        const allTasks = await storageService.getAllRawScheduledTasks();
        const taskInStorage = allTasks.find(t => t.id === taskId);

        if (!taskInStorage) {
            console.warn(`[TaskService - cancel] 未在存储中找到任务 ID: ${taskId}`);
            return { success: false, msg: '未在存储中找到指定的定时任务。' };
        }
        if (!forceAdminCancel && taskInStorage.userId !== userId) {
            console.warn(`[TaskService - cancel] 权限不足: 用户 ${userId} 尝试从存储中删除不属于自己的任务 ${taskId}`);
            return { success: false, msg: '权限不足，无法从存储中删除此任务。' };
        }

        // [BUG修复] 调用新的原子化删除函数
        await storageService.removeScheduledTask(taskId);

        console.log(`[TaskService - cancel] 任务 ID: ${taskId} 已成功从存储中移除。`);
        return { success: true, msg: '定时任务已取消。' };

    } catch (error) {
        console.error(`[TaskService - cancel] 取消任务 ID: ${taskId} 失败:`, error);
        return { success: false, msg: error.message || '取消定时任务时发生未知错误。' };
    }
}

module.exports = {
    initializeScheduledTasks,
    scheduleNewTask,
    cancelScheduledTask,
};