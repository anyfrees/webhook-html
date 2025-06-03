// server/services/taskService.js

const cron = require('node-cron'); // 虽然当前未使用 cron 表达式调度，但保留以备将来使用
const { v4: uuidv4 } = require('uuid');
const storageService = require('./storageService');
const webhookService = require('./webhookService');
const { encryptText, decryptText } = require('./cryptoService');

const activeScheduledJobs = new Map(); // 用于存储 setTimeout 的 ID，以便可以取消

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

        // 根据任务类型构造发送给 webhookService 的负载
        if (preparedTaskContext.templateType === 'workweixin') {
            if (!preparedTaskContext.workweixinConfig || !preparedTaskContext.webhookSnapshot) {
                throw new Error(`企业微信任务 ${taskId} 的配置不完整 (workweixinConfig 或 webhookSnapshot 缺失)。`);
            }
            payloadForWebhookService = {
                originalWebhookId: preparedTaskContext.originalWebhookId, // 原始Webhook配置ID
                templateType: 'workweixin',
                workweixinConfig: preparedTaskContext.workweixinConfig, // 包含解密的corpid, agentid; 加密的corpsecret
                body: preparedTaskContext.webhookSnapshot.plainBody,    // 用户消息
                webhookSnapshot: preparedTaskContext.webhookSnapshot,    // 任务创建时的快照
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
                url: preparedTaskContext.finalUrl.trim(), // 最终解析后的URL (已解密)
                method: preparedTaskContext.webhookSnapshot.method,
                headers: preparedTaskContext.webhookSnapshot.headers,
                body: webhookService.constructBodyFromSnapshot(preparedTaskContext.webhookSnapshot), // 根据快照重新构造请求体
                webhookSnapshot: preparedTaskContext.webhookSnapshot,
                isScheduledTaskRun: true
            };
            console.log(`[TaskService - execute] Generic task payload for webhookService, URL: "${payloadForWebhookService.url}"`);
        } else {
            throw new Error(`未知的任务模板类型: ${preparedTaskContext.templateType} for task ID: ${taskId}`);
        }
        
        // 调用 webhookService.sendWebhookRequest
        // 注意：如果 webhookService 需要原始模板数据，而 preparedTaskContext 没有包含，
        // 那么 webhookService 内部需要能够处理这种情况（例如，通过原始模板ID重新获取，并校验权限）。
        // 当前 webhookService.sendWebhookRequest 的设计是，如果 rawTemplateFromApi 未提供，它会尝试自己获取。
        // 对于定时任务执行，我们通常不直接传递 rawTemplate，依赖 webhookService 的内部逻辑。
        // 重要的是，webhookService 在获取模板时必须使用 getRawTemplateByIdForUserAccess 来确保权限。
        await webhookService.sendWebhookRequest(payloadForWebhookService, userId /*, rawTemplate (可选) */);
        console.log(`[TaskService - execute] 任务 ID: ${taskId} (用户: ${userId}) 调用 webhookService 完成。`);

    } catch (error) {
        console.error(`[TaskService - execute] 执行任务 ID: ${taskId} (用户: ${userId}) 失败:`, error.message, error.stack);
        // 可以在这里添加更详细的错误记录逻辑，例如记录到特定的任务失败日志中
    } finally {
        // 任务执行后（无论成功或失败），从存储中移除该一次性任务
        try {
            const userTasks = await storageService.getAllRawScheduledTasks(userId);
            const remainingTasks = userTasks.filter(t => t.id !== taskId);
            await storageService.saveScheduledTasks(remainingTasks, userId);
            activeScheduledJobs.delete(taskId); // 从内存中移除
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

    let decryptedFinalUrl = null;
    if (rawTaskFromStorage.templateType === 'generic' && rawTaskFromStorage.finalUrl) {
        decryptedFinalUrl = decryptText(rawTaskFromStorage.finalUrl);
        if (typeof decryptedFinalUrl !== 'string' || decryptedFinalUrl.trim() === '') {
            console.warn(`[TaskService - prepareTask] 解密后的 finalUrl 对于任务 ${rawTaskFromStorage.id} 无效或为空: "${decryptedFinalUrl}"`);
            // 可以决定是否返回null来阻止调度无效任务
        }
    }

    const preparedTask = {
        ...rawTaskFromStorage,
        finalUrl: decryptedFinalUrl, // 解密后的最终URL (仅通用类型)
        webhookSnapshot: { // 解密快照中的原始模板URL (如果存在且为通用类型)
            ...rawTaskFromStorage.webhookSnapshot,
            url: (rawTaskFromStorage.webhookSnapshot.url && rawTaskFromStorage.templateType === 'generic')
                 ? decryptText(rawTaskFromStorage.webhookSnapshot.url)
                 : rawTaskFromStorage.webhookSnapshot.url, // 企业微信的URL是占位符，无需解密
        },
    };

    if (rawTaskFromStorage.templateType === 'workweixin' && rawTaskFromStorage.workweixinConfig) {
        preparedTask.workweixinConfig = {
            ...rawTaskFromStorage.workweixinConfig,
            corpid: decryptText(rawTaskFromStorage.workweixinConfig.corpid),
            agentid: decryptText(rawTaskFromStorage.workweixinConfig.agentid),
            // corpsecret 保持加密，webhookService 会处理
        };
    }
    return preparedTask;
}


/**
 * 使用 setTimeout 调度单个一次性任务
 * @param {Object} preparedTaskContext - 经过 prepareTaskForExecutionAndScheduling 处理的任务对象
 */
function scheduleSingleTaskTimeout(preparedTaskContext) {
    if (!preparedTaskContext || !preparedTaskContext.id || !preparedTaskContext.scheduledTime || !preparedTaskContext.userId) {
        console.error('[TaskService - scheduleSingle] 无法调度任务：任务上下文不完整或缺少 userId。', preparedTaskContext);
        return;
    }
    // 对于通用类型，再次校验 finalUrl
    if (preparedTaskContext.templateType === 'generic' && (!preparedTaskContext.finalUrl || typeof preparedTaskContext.finalUrl !== 'string' || preparedTaskContext.finalUrl.trim() === '')) {
        console.error(`[TaskService - scheduleSingle] 无法调度通用任务 ID: ${preparedTaskContext.id} 因为 finalUrl 无效: "${preparedTaskContext.finalUrl}"`);
        // 考虑从存储中移除这个无效的任务
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
        // console.log(`[TaskService - scheduleSingle] Task context to be executed:`, JSON.stringify(preparedTaskContext, null, 2).substring(0, 500) + "...");

        const timeoutId = setTimeout(async () => {
            console.log(`[TaskService - timeoutFired] 定时器触发，任务ID: ${preparedTaskContext.id}`);
            activeScheduledJobs.delete(preparedTaskContext.id); // 从活动列表中移除
            await executeScheduledTask(preparedTaskContext, preparedTaskContext.userId);
        }, delay);
        activeScheduledJobs.set(preparedTaskContext.id, { type: 'timeout', id: timeoutId, taskContext: preparedTaskContext, userId: preparedTaskContext.userId });
    } else {
        console.warn(`[TaskService - scheduleSingle] 任务 ID: ${preparedTaskContext.id} (用户: ${preparedTaskContext.userId}) 的计划时间 (${scheduledTime.toLocaleString()}) 已过，将尝试立即执行并移除。`);
        // 立即执行并确保从存储中移除（executeScheduledTask的finally块会处理移除）
        executeScheduledTask(preparedTaskContext, preparedTaskContext.userId).catch(err => {
            console.error(`[TaskService - scheduleSingle] 立即执行过期任务 ${preparedTaskContext.id} (用户: ${preparedTaskContext.userId}) 失败:`, err);
        });
    }
}

/**
 * 初始化所有用户的定时任务 (通常在应用启动时调用)
 */
async function initializeScheduledTasks() {
    console.log('[TaskService - init] 正在初始化所有用户的定时任务...');
    // 清理旧的、可能存在的内存中的job (如果服务重启前未正常关闭)
    activeScheduledJobs.forEach(jobEntry => {
        if (jobEntry.type === 'timeout') clearTimeout(jobEntry.id);
    });
    activeScheduledJobs.clear();

    try {
        const allRawTasksFromStorage = await storageService.getAllRawScheduledTasks(); // 获取所有用户的任务
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

        // 从存储中批量移除已过期的任务
        if (tasksAlreadyExpiredIds.length > 0) {
            // 注意：storageService.saveScheduledTasks(validTasksAfterExpiryCheck, null) 会覆盖整个文件
            // 需要确保这是期望的行为，或者修改 saveScheduledTasks 以支持更细粒度的删除
            const currentTasksInStorage = await storageService.getAllRawScheduledTasks(); // 重新获取以防万一
            const validTasksAfterExpiryCheck = currentTasksInStorage.filter(task => !tasksAlreadyExpiredIds.includes(task.id));
            await storageService.saveScheduledTasks(validTasksAfterExpiryCheck, null); // null userId 表示操作所有任务
            console.log(`[TaskService - init] 已从存储中移除 ${tasksAlreadyExpiredIds.length} 个在启动时发现的过期任务。`);
        }

        // 调度未过期的任务
        for (const rawTask of tasksToActuallySchedule) {
            const preparedTask = prepareTaskForExecutionAndScheduling(rawTask);
            if (preparedTask) {
                scheduleSingleTaskTimeout(preparedTask);
            } else {
                 console.warn(`[TaskService - init] 任务数据准备失败，无法调度任务: `, rawTask);
                 // 考虑是否也从存储中删除这种准备失败的任务
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
 * @param {string} userId - 创建任务的用户ID
 * @param {string} userRole - 创建任务的用户角色 (用于模板权限校验)
 * @returns {Promise<Object>} 包含成功状态和任务ID的对象
 */
async function scheduleNewTask(taskDataFromClient, userId, userRole) {
    console.log(`[TaskService - scheduleNew] 准备调度新任务，用户ID: ${userId}, 角色: ${userRole}, 关联配置ID: ${taskDataFromClient.originalWebhookId}`);
    console.log(`[TaskService - scheduleNew] Client payload:`, JSON.stringify(taskDataFromClient, null, 2).substring(0, 1000) + "...");

    try {
        if (!taskDataFromClient.originalWebhookId || !taskDataFromClient.scheduledTime || !taskDataFromClient.webhookSnapshot || !taskDataFromClient.templateType) {
            throw new Error('创建定时任务失败：缺少必要的任务信息 (originalWebhookId, scheduledTime, webhookSnapshot, templateType)。');
        }
        const scheduledTime = new Date(taskDataFromClient.scheduledTime);
        if (isNaN(scheduledTime.getTime()) || scheduledTime <= new Date()) {
            throw new Error('创建定时任务失败：计划发送时间无效或已过期。');
        }

        // 1. 获取原始模板，并进行权限校验
        const templateId = taskDataFromClient.webhookSnapshot.templateId;
        if (!templateId) {
            throw new Error('创建定时任务失败：任务快照中缺少 templateId。');
        }
        // 使用 getRawTemplateByIdForUserAccess 进行权限检查
        const rawTemplate = await storageService.getRawTemplateByIdForUserAccess(templateId, userId, userRole);
        if (!rawTemplate) {
            throw new Error(`创建定时任务失败：无法找到或无权访问关联的地址模板 (ID: ${templateId})。`);
        }
        console.log(`[TaskService - scheduleNew] 成功获取并验证模板: ${rawTemplate.name} (ID: ${rawTemplate.id})`);

        // 2. 根据模板类型准备任务数据
        const taskId = uuidv4();
        const rawTaskToStore = {
            id: taskId,
            userId: userId,
            originalWebhookId: taskDataFromClient.originalWebhookId,
            scheduledTime: taskDataFromClient.scheduledTime,
            templateType: rawTemplate.type, // 使用从数据库获取的模板类型，更可靠
            webhookSnapshot: { // 快照信息，部分从客户端来，部分从模板来
                ...taskDataFromClient.webhookSnapshot, // 包含 name, plainBody, phoneNumber/touser
                templateId: rawTemplate.id, // 确保是真实的模板ID
                // 对于通用模板，存储加密的原始模板URL；对于企业微信，存储占位符
                url: (rawTemplate.type === 'generic' && rawTemplate.url) ? encryptText(rawTemplate.url) : rawTemplate.url,
                method: rawTemplate.method, // 从模板获取
                bodyTemplate: rawTemplate.bodyTemplate, // 从模板获取
                workweixin_msgtype: rawTemplate.workweixin_msgtype // 从模板获取
            },
            finalUrl: null, // 通用类型时，由客户端预先计算并加密
            workweixinConfig: null // 企业微信类型时，从模板提取并加密
        };

        if (rawTemplate.type === 'generic') {
            if (!taskDataFromClient.finalUrl || typeof taskDataFromClient.finalUrl !== 'string' || taskDataFromClient.finalUrl.trim() === '') {
                console.error('[TaskService - scheduleNew] 尝试创建通用定时任务但 finalUrl 无效:', taskDataFromClient.finalUrl);
                throw new Error('创建通用定时任务失败：finalUrl 无效或未提供。');
            }
            rawTaskToStore.finalUrl = encryptText(taskDataFromClient.finalUrl.trim()); // 加密最终URL
            console.log(`[TaskService - scheduleNew] 通用任务，客户端 finalUrl: "${taskDataFromClient.finalUrl}", 加密后存储: "${rawTaskToStore.finalUrl}"`);
        } else if (rawTemplate.type === 'workweixin') {
            if (!rawTemplate.corpid || !rawTemplate.agentid || !rawTemplate.corpsecret) {
                 throw new Error(`创建企业微信定时任务失败：关联模板 (ID: ${rawTemplate.id}) 缺少必要的企业微信配置 (corpid, agentid, corpsecret)。`);
            }
            rawTaskToStore.workweixinConfig = {
                // 从原始模板中获取加密的 corpid 和 agentid，再次加密以确保一致性（虽然它们已经是加密的）
                // 或者直接使用 rawTemplate 中的加密值，因为它们是从 storageService 获取的
                corpid: rawTemplate.corpid, // 直接使用从storage获取的已加密值
                corpsecret: rawTemplate.corpsecret, // 直接使用模板中已加密的secret
                agentid: rawTemplate.agentid, // 直接使用从storage获取的已加密值
                touser: taskDataFromClient.webhookSnapshot.touser, // 来自客户端输入
                msgtype: rawTemplate.workweixin_msgtype, // 来自模板
            };
            delete rawTaskToStore.finalUrl; // 企业微信任务不使用 finalUrl
        }
        console.log(`[TaskService - scheduleNew] 准备存储的原始任务:`, JSON.stringify(rawTaskToStore, null, 2).substring(0, 1000) + "...");

        // 3. 保存任务到存储
        const userTasks = await storageService.getAllRawScheduledTasks(userId);
        userTasks.push(rawTaskToStore);
        await storageService.saveScheduledTasks(userTasks, userId);

        // 4. 准备并调度任务
        const preparedTask = prepareTaskForExecutionAndScheduling(rawTaskToStore);
        if (preparedTask) {
            scheduleSingleTaskTimeout(preparedTask);
        } else {
            // 如果准备失败，可能需要回滚存储操作或记录错误
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


/**
 * 取消一个已调度的任务
 * @param {string} taskId - 要取消的任务ID
 * @param {string} userId - 操作用户ID
 * @param {boolean} forceAdminCancel - (可选) 是否由管理员强制取消，绕过userId检查（用于删除用户数据时）
 * @returns {Promise<Object>} 包含成功状态和消息的对象
 */
async function cancelScheduledTask(taskId, userId, forceAdminCancel = false) {
    console.log(`[TaskService - cancel] 用户 ${userId} 尝试取消任务 ID: ${taskId}, forceAdmin: ${forceAdminCancel}`);
    try {
        const jobEntry = activeScheduledJobs.get(taskId);
        if (jobEntry) {
            if (!forceAdminCancel && jobEntry.userId !== userId) { // 仅当非强制取消时检查所有权
                 console.warn(`[TaskService - cancel] 权限不足: 用户 ${userId} 尝试取消不属于自己的活动任务 ${taskId} (属于 ${jobEntry.userId})`);
                 return { success: false, msg: '权限不足，无法取消此活动任务。' };
            }
            if (jobEntry.type === 'timeout') clearTimeout(jobEntry.id);
            activeScheduledJobs.delete(taskId);
            console.log(`[TaskService - cancel] 内存中的活动任务 ID: ${taskId} 已停止。`);
        } else {
            console.warn(`[TaskService - cancel] 未在内存中找到活动任务 ID: ${taskId}。将继续尝试从存储中删除。`);
        }

        // 从存储中移除
        // 如果是 forceAdminCancel，我们可能需要获取所有任务，而不仅仅是特定用户的
        const tasksForUserOrAll = forceAdminCancel ? await storageService.getAllRawScheduledTasks() : await storageService.getAllRawScheduledTasks(userId);
        const taskInStorage = tasksForUserOrAll.find(t => t.id === taskId);

        if (!taskInStorage) {
            console.warn(`[TaskService - cancel] 未在存储中找到任务 ID: ${taskId} (检查范围: ${forceAdminCancel ? '所有用户' : `用户 ${userId}`})`);
            return { success: false, msg: '未在存储中找到指定的定时任务，或任务不属于您。' };
        }
        // 如果是管理员强制删除，且任务不属于操作的管理员，也允许删除
        if (!forceAdminCancel && taskInStorage.userId !== userId) {
            console.warn(`[TaskService - cancel] 权限不足: 用户 ${userId} 尝试从存储中删除不属于自己的任务 ${taskId}`);
            return { success: false, msg: '权限不足，无法从存储中删除此任务。' };
        }

        // 保存时，如果是 forceAdminCancel，我们需要更新整个任务文件
        // 如果是用户自己取消，我们只更新该用户的任务部分
        if (forceAdminCancel) {
            const allTasks = await storageService.getAllRawScheduledTasks(); // 获取所有任务
            const remainingAllTasks = allTasks.filter(t => t.id !== taskId);
            await storageService.saveScheduledTasks(remainingAllTasks, null); // null userId 表示操作所有任务
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
