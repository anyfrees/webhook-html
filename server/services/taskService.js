// server/services/taskService.js

const cron = require('node-cron'); 
const { v4: uuidv4 } = require('uuid');
const storageService = require('./storageService');
const webhookService = require('./webhookService');
const { encryptText, decryptText } = require('./cryptoService');

const activeScheduledJobs = new Map(); 

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
        
        // 通用的负载结构，webhookService.sendWebhookRequest 会处理迭代
        payloadForWebhookService = {
            originalWebhookId: preparedTaskContext.originalWebhookId,
            templateIds: webhookSnapshot.templateIds, // 传递 templateIds 数组
            // 全局的用户输入，webhookService 会将其应用于每个模板
            phone: webhookSnapshot.phoneNumber || webhookSnapshot.touser, 
            plainBody: webhookSnapshot.plainBody,
            // headers from the original webhook config might be in snapshot if saved that way
            headers: webhookSnapshot.headers, // Pass along headers from snapshot if they exist
            
            // 指示这是定时任务的运行，并传递整个快照供 webhookService 可能的参考
            isScheduledTaskRun: true,
            webhookSnapshot: webhookSnapshot, // 传递原始快照

            // templateType, finalUrl, workweixinConfig (top-level) are less relevant here now
            // as webhookService will determine type and construct details for each template in templateIds.
            // However, we can pass the primary templateType if available in the task context.
            templateType: preparedTaskContext.templateType, // Primary/overall type of the task
        };

        // If the primary type is generic, we might pass the pre-calculated finalUrl for the *first* template
        // as a hint, but webhookService should ideally recalculate for each generic template if placeholders are involved differently.
        if (preparedTaskContext.templateType === 'generic' && preparedTaskContext.finalUrl) {
            // This finalUrl was for the first/primary template.
            // webhookService will need to re-evaluate URLs if placeholders mean they differ per template context
            // (though for current design, phone/userMessage are global to the task)
            // payloadForWebhookService.url = preparedTaskContext.finalUrl.trim(); // Example for single
        } else if (preparedTaskContext.templateType === 'workweixin' && preparedTaskContext.workweixinConfig) {
            // This workweixinConfig was for the first/primary template.
            // webhookService will resolve for each WW template in the list.
            // payloadForWebhookService.workweixinConfig = preparedTaskContext.workweixinConfig; // Example for single
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

    // Ensure webhookSnapshot.templateIds exists
    const webhookSnapshot = {
        ...rawTaskFromStorage.webhookSnapshot,
        templateIds: Array.isArray(rawTaskFromStorage.webhookSnapshot.templateIds) ? rawTaskFromStorage.webhookSnapshot.templateIds : []
    };


    let decryptedFinalUrl = null; // This finalUrl was for the first/primary generic template
    if (rawTaskFromStorage.templateType === 'generic' && rawTaskFromStorage.finalUrl) {
        decryptedFinalUrl = decryptText(rawTaskFromStorage.finalUrl);
        if (typeof decryptedFinalUrl !== 'string' || decryptedFinalUrl.trim() === '') {
            console.warn(`[TaskService - prepareTask] 解密后的 finalUrl 对于任务 ${rawTaskFromStorage.id} 无效或为空: "${decryptedFinalUrl}"`);
        }
    }
    
    // Snapshot's internal template URL (if it's a single generic template snapshot) might need decryption for display/debug
    // but for multi-template, webhookService will handle individual template URL decryption.
    if (webhookSnapshot.url && rawTaskFromStorage.templateType === 'generic' && webhookSnapshot.templateIds.length <= 1) {
         webhookSnapshot.url = decryptText(webhookSnapshot.url);
    }


    const preparedTask = {
        ...rawTaskFromStorage,
        finalUrl: decryptedFinalUrl, 
        webhookSnapshot: webhookSnapshot,
    };

    // workweixinConfig on the task was for the primary/first template.
    // webhookService will resolve config for each WW template in the list.
    if (rawTaskFromStorage.templateType === 'workweixin' && rawTaskFromStorage.workweixinConfig) {
        preparedTask.workweixinConfig = {
            ...rawTaskFromStorage.workweixinConfig,
            corpid: decryptText(rawTaskFromStorage.workweixinConfig.corpid),
            agentid: decryptText(rawTaskFromStorage.workweixinConfig.agentid),
        };
    }
    return preparedTask;
}


function scheduleSingleTaskTimeout(preparedTaskContext) {
    if (!preparedTaskContext || !preparedTaskContext.id || !preparedTaskContext.scheduledTime || !preparedTaskContext.userId) {
        console.error('[TaskService - scheduleSingle] 无法调度任务：任务上下文不完整或缺少 userId。', preparedTaskContext);
        return;
    }
    
    // For generic multi-template tasks, the top-level finalUrl might be for the first template.
    // The actual sending logic in webhookService will handle URLs for each template.
    // This check is now more of a sanity check for the primary/first template if it's generic.
    if (preparedTaskContext.templateType === 'generic' && 
        preparedTaskContext.webhookSnapshot.templateIds.length > 0 && // Only if there are templates
        (!preparedTaskContext.finalUrl || typeof preparedTaskContext.finalUrl !== 'string' || preparedTaskContext.finalUrl.trim() === '')) {
        
        // Attempt to get the first template to see if it's generic and needs a URL
        // This logic becomes complex if templateIds is not yet populated with full template objects here.
        // For now, we assume if templateType is 'generic', finalUrl (for the first template) should be valid.
        console.warn(`[TaskService - scheduleSingle] 通用任务 ID: ${preparedTaskContext.id} 的 finalUrl (首要模板) 可能无效: "${preparedTaskContext.finalUrl}". 依赖 webhookService 处理。`);
    }


    const scheduledTime = new Date(preparedTaskContext.scheduledTime);
    const now = new Date();

    if (scheduledTime > now) {
        const delay = scheduledTime.getTime() - now.getTime();
        console.log(`[TaskService - scheduleSingle] 调度一次性任务 ID: ${preparedTaskContext.id} (用户: ${preparedTaskContext.userId}) 在 ${scheduledTime.toLocaleString()} (延迟: ${Math.round(delay/1000)}s)`);
        
        const timeoutId = setTimeout(async () => {
            console.log(`[TaskService - timeoutFired] 定时器触发，任务ID: ${preparedTaskContext.id}`);
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
            if (!rawTask.webhookSnapshot || !Array.isArray(rawTask.webhookSnapshot.templateIds) || rawTask.webhookSnapshot.templateIds.length === 0) {
                console.warn(`[TaskService - init] 任务 ID: ${rawTask.id} 无效 (缺少templateIds)，将被跳过并不再调度，考虑从存储中移除。`);
                // Optionally, add to a list to remove invalid tasks from storage here.
                tasksAlreadyExpiredIds.push(rawTask.id); // Treat as expired/invalid
                continue;
            }
            if (new Date(rawTask.scheduledTime).getTime() > now) {
                tasksToActuallySchedule.push(rawTask);
            } else {
                console.warn(`[TaskService - init] 启动时发现过期任务 ID: ${rawTask.id} (用户: ${rawTask.userId}, 计划: ${new Date(rawTask.scheduledTime).toLocaleString()}), 将被移除。`);
                tasksAlreadyExpiredIds.push(rawTask.id);
            }
        }

        if (tasksAlreadyExpiredIds.length > 0) {
            const currentTasksInStorage = await storageService.getAllRawScheduledTasks(); 
            const validTasksAfterExpiryCheck = currentTasksInStorage.filter(task => !tasksAlreadyExpiredIds.includes(task.id));
            await storageService.saveScheduledTasks(validTasksAfterExpiryCheck, null); 
            console.log(`[TaskService - init] 已从存储中移除 ${tasksAlreadyExpiredIds.length} 个在启动时发现的过期或无效任务。`);
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

/**
 * 调度一个新的定时任务
 * @param {Object} taskDataFromClient - 从客户端API接收的任务数据
 * - originalWebhookId
 * - scheduledTime
 * - webhookSnapshot (must include templateIds: string[])
 * - templateType (primary type, e.g., 'generic' or 'workweixin')
 * - finalUrl (optional, for first generic template)
 * @param {string} userId - 创建任务的用户ID
 * @param {string} userRole - 创建任务的用户角色 (用于模板权限校验)
 * @returns {Promise<Object>} 包含成功状态和任务ID的对象
 */
async function scheduleNewTask(taskDataFromClient, userId, userRole) {
    console.log(`[TaskService - scheduleNew] 准备调度新任务，用户ID: ${userId}, 角色: ${userRole}, 关联配置ID: ${taskDataFromClient.originalWebhookId}`);
    console.log(`[TaskService - scheduleNew] Client payload (partial):`, {
        originalWebhookId: taskDataFromClient.originalWebhookId,
        scheduledTime: taskDataFromClient.scheduledTime,
        templateIds: taskDataFromClient.webhookSnapshot?.templateIds,
        templateType: taskDataFromClient.templateType
    });

    try {
        if (!taskDataFromClient.originalWebhookId || 
            !taskDataFromClient.scheduledTime || 
            !taskDataFromClient.webhookSnapshot || 
            !Array.isArray(taskDataFromClient.webhookSnapshot.templateIds) || 
            taskDataFromClient.webhookSnapshot.templateIds.length === 0) {
            throw new Error('创建定时任务失败：缺少必要信息 (originalWebhookId, scheduledTime, webhookSnapshot with valid templateIds)。');
        }
        const scheduledTime = new Date(taskDataFromClient.scheduledTime);
        if (isNaN(scheduledTime.getTime()) || scheduledTime <= new Date()) {
            throw new Error('创建定时任务失败：计划发送时间无效或已过期。');
        }

        // 1. Permission check for each templateId
        // webhookService.sendWebhookRequest will do this at execution time.
        // For scheduling, we trust the client has selected accessible templates.
        // A stricter approach would be to validate all templateIds here.
        // For now, we'll primarily rely on execution-time checks in webhookService.
        // However, we need at least one template to determine the primary task type if not provided.
        
        const firstTemplateId = taskDataFromClient.webhookSnapshot.templateIds[0];
        const firstRawTemplate = await storageService.getRawTemplateByIdForUserAccess(firstTemplateId, userId, userRole);
        if (!firstRawTemplate) {
            throw new Error(`创建定时任务失败：无法找到或无权访问首个关联的地址模板 (ID: ${firstTemplateId})。`);
        }
        const primaryTemplateType = firstRawTemplate.type; // Determine primary type from the first template
        console.log(`[TaskService - scheduleNew] 首个模板 ${firstRawTemplate.name} (ID: ${firstRawTemplate.id}) 类型: ${primaryTemplateType}`);


        const taskId = uuidv4();
        const rawTaskToStore = {
            id: taskId,
            userId: userId,
            originalWebhookId: taskDataFromClient.originalWebhookId,
            scheduledTime: taskDataFromClient.scheduledTime,
            templateType: primaryTemplateType, // Store the primary type
            webhookSnapshot: { // Snapshot from client, should contain templateIds
                ...taskDataFromClient.webhookSnapshot,
                // Ensure necessary fields from first template are in snapshot if needed by prepareTask/executeTask
                // (e.g., method, bodyTemplate if they were global to the snapshot)
                // but with multi-template, these are per-template.
                // The snapshot *must* contain templateIds.
            },
            finalUrl: null, 
            workweixinConfig: null 
        };

        // If the primary type is generic, store the pre-calculated finalUrl for the first template (if client sent it)
        if (primaryTemplateType === 'generic' && taskDataFromClient.finalUrl) {
            if (typeof taskDataFromClient.finalUrl !== 'string' || taskDataFromClient.finalUrl.trim() === '') {
                console.warn('[TaskService - scheduleNew] 客户端为通用任务提供的 finalUrl 无效，将不存储:', taskDataFromClient.finalUrl);
            } else {
                 rawTaskToStore.finalUrl = encryptText(taskDataFromClient.finalUrl.trim());
                 console.log(`[TaskService - scheduleNew] 通用任务，首模板finalUrl加密存储。`);
            }
        } else if (primaryTemplateType === 'workweixin') {
            // Store base workweixinConfig from the first template for preparation phase
            if (!firstRawTemplate.corpid || !firstRawTemplate.agentid || !firstRawTemplate.corpsecret) {
                 throw new Error(`创建企业微信定时任务失败：首个关联模板 (ID: ${firstRawTemplate.id}) 缺少企业微信配置。`);
            }
            rawTaskToStore.workweixinConfig = {
                corpid: firstRawTemplate.corpid, 
                corpsecret: firstRawTemplate.corpsecret, 
                agentid: firstRawTemplate.agentid, 
                touser: taskDataFromClient.webhookSnapshot.touser, // From client input
                msgtype: firstRawTemplate.workweixin_msgtype, 
            };
            delete rawTaskToStore.finalUrl; 
        }
        console.log(`[TaskService - scheduleNew] 准备存储的原始任务 (部分):`, { id: rawTaskToStore.id, templateIds: rawTaskToStore.webhookSnapshot.templateIds });

        const userTasks = await storageService.getAllRawScheduledTasks(userId);
        userTasks.push(rawTaskToStore);
        await storageService.saveScheduledTasks(userTasks, userId);

        const preparedTask = prepareTaskForExecutionAndScheduling(rawTaskToStore);
        if (preparedTask) {
            scheduleSingleTaskTimeout(preparedTask);
        } else {
            console.error(`[TaskService - scheduleNew] 任务 ${taskId} 存储后准备失败，无法调度。`);
            throw new Error("任务数据存储后准备失败，无法调度。");
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
                 console.warn(`[TaskService - cancel] 权限不足: 用户 ${userId} 尝试取消不属于自己的活动任务 ${taskId} (属于 ${jobEntry.userId})`);
                 return { success: false, msg: '权限不足，无法取消此活动任务。' };
            }
            if (jobEntry.type === 'timeout') clearTimeout(jobEntry.id);
            activeScheduledJobs.delete(taskId);
            console.log(`[TaskService - cancel] 内存中的活动任务 ID: ${taskId} 已停止。`);
        } else {
            console.warn(`[TaskService - cancel] 未在内存中找到活动任务 ID: ${taskId}。将继续尝试从存储中删除。`);
        }

        const tasksForUserOrAll = forceAdminCancel ? await storageService.getAllRawScheduledTasks() : await storageService.getAllRawScheduledTasks(userId);
        const taskInStorage = tasksForUserOrAll.find(t => t.id === taskId);

        if (!taskInStorage) {
            console.warn(`[TaskService - cancel] 未在存储中找到任务 ID: ${taskId} (检查范围: ${forceAdminCancel ? '所有用户' : `用户 ${userId}`})`);
            return { success: false, msg: '未在存储中找到指定的定时任务，或任务不属于您。' };
        }
        if (!forceAdminCancel && taskInStorage.userId !== userId) {
            console.warn(`[TaskService - cancel] 权限不足: 用户 ${userId} 尝试从存储中删除不属于自己的任务 ${taskId}`);
            return { success: false, msg: '权限不足，无法从存储中删除此任务。' };
        }

        if (forceAdminCancel) {
            const allTasks = await storageService.getAllRawScheduledTasks(); 
            const remainingAllTasks = allTasks.filter(t => t.id !== taskId);
            await storageService.saveScheduledTasks(remainingAllTasks, null); 
        } else {
            const userTasks = await storageService.getAllRawScheduledTasks(userId);
            const remainingUserTasks = userTasks.filter(t => t.id !== taskId);
            await storageService.saveScheduledTasks(remainingUserTasks, userId);
        }


        console.log(`[TaskService - cancel] 任务 ID: ${taskId} (属于用户: ${taskInStorage.userId}) 已成功从存储中移除。`);
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