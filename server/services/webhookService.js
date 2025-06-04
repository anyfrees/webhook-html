// server/services/webhookService.js

const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const storageService = require('./storageService');
const workweixinService = require('./workweixinService');
const { encryptText, decryptText } = require('./cryptoService');

function constructBodyFromSnapshot(webhookSnapshot) {
    if (!webhookSnapshot) return '';
    let body = webhookSnapshot.bodyTemplate || ''; 
    const phone = webhookSnapshot.phoneNumber || webhookSnapshot.touser || ''; 
    const message = webhookSnapshot.plainBody || ''; 

    body = body.replace(/{phoneNumber}|{phone}/g, (phone || "").replace(/"/g, '\\"'));
    
    const escapedMessage = (message || "").replace(/\\/g, '\\\\')
                                       .replace(/"/g, '\\"')
                                       .replace(/\n/g, '\\n')
                                       .replace(/\r/g, '\\r')
                                       .replace(/\t/g, '\\t');
    body = body.replace(/{userMessage}/g, escapedMessage);
    return body;
}

/**
 * 构建单个模板的请求负载对象。
 * @param {Object} webhookConfig - 用户保存的 Webhook 配置 (来自 storageService.getRawWebhooksForUser)
 * @param {Object} rawTemplate - 单个原始模板数据 (已通过权限检查)
 * @param {string} recipientOrPhone - 实际的接收者或电话号码 (通常来自 clientPayload 或 webhookConfig)
 * @param {string} userMessageText - 用户输入的纯文本消息 (通常来自 clientPayload 或 webhookConfig)
 * @returns {Promise<Object>} 准备好的请求对象 (用于单个模板发送)
 */
async function buildRequestPayload(webhookConfig, rawTemplate, recipientOrPhone, userMessageText) {
    console.log(`[WebhookService-BuildPayload] 开始为模板构建: ${rawTemplate?.name}, Webhook配置名: ${webhookConfig?.name}, 接收者: ${recipientOrPhone}`);
    if (!rawTemplate) {
        console.error('[WebhookService-BuildPayload] 错误：地址模板 (rawTemplate) 无效或未提供。Webhook配置ID:', webhookConfig?.id);
        throw new Error('构建请求失败：地址模板无效或未提供。');
    }

    const decryptedCorpid = rawTemplate.type === 'workweixin' && rawTemplate.corpid ? decryptText(rawTemplate.corpid) : undefined;
    const decryptedAgentid = rawTemplate.type === 'workweixin' && rawTemplate.agentid ? decryptText(rawTemplate.agentid) : undefined;

    if (rawTemplate.type === 'workweixin') {
        console.log(`[WebhookService-BuildPayload] 构建企业微信类型。解密后CorpID: ${decryptedCorpid}, AgentID: ${decryptedAgentid}, CorpSecret存在: ${!!rawTemplate.corpsecret}`);
        if (!decryptedCorpid || !decryptedAgentid || !rawTemplate.corpsecret) {
            console.error(`[WebhookService-BuildPayload] 企业微信模板 ${rawTemplate.name} (ID: ${rawTemplate.id}) 缺少 CorpID, AgentID 或加密的 CorpSecret。`);
            throw new Error(`构建请求失败：所选企业微信模板 ${rawTemplate.name} 缺少 CorpID, AgentID 或加密的 CorpSecret。`);
        }
        // 快照中保存的是与此模板相关的信息
        const snapshot = {
            name: webhookConfig.name, // 或者 rawTemplate.name 如果更合适上下文
            templateId: rawTemplate.id,
            templateName: rawTemplate.name, // 添加模板名称到快照
            plainBody: userMessageText, 
            touser: recipientOrPhone, 
            workweixin_msgtype: rawTemplate.workweixin_msgtype || 'text',
            url: "WORKWEIXIN_APP_MESSAGE_API_PLACEHOLDER_IN_SNAPSHOT", // 指示这是企微类型
        };
        return {
            // id: webhookConfig.id, // 这个ID是webhook配置的ID，在循环外层处理
            // name: webhookConfig.name,
            templateId: rawTemplate.id, // 当前处理的模板ID
            templateName: rawTemplate.name, // 当前处理的模板名称
            templateType: 'workweixin',
            workweixinConfig: { 
                corpid: decryptedCorpid,
                corpsecret: rawTemplate.corpsecret, 
                agentid: decryptedAgentid,
                touser: recipientOrPhone,
                msgtype: rawTemplate.workweixin_msgtype || 'text',
            },
            body: userMessageText, 
            webhookSnapshot: snapshot // 这个快照是针对当前模板的
        };
    } else { // 通用 Webhook
        const decryptedTemplateUrl = decryptText(rawTemplate.url);
        console.log(`[WebhookService-BuildPayload] 构建通用类型。模板 ${rawTemplate.name} 解密后URL: ${decryptedTemplateUrl}`);
        if (!decryptedTemplateUrl || decryptedTemplateUrl.trim() === '') {
            throw new Error(`构建请求失败：所选地址模板 ${rawTemplate.name} (ID: ${rawTemplate.id}) 没有有效的URL。`);
        }

        let finalUrl = decryptedTemplateUrl;
        finalUrl = finalUrl.replace(/{phoneNumber}|{phone}/g, (recipientOrPhone || "").replace(/"/g, '\\"'));
        console.log(`[WebhookService-BuildPayload] Generic - 替换占位符后URL for template ${rawTemplate.name}: "${finalUrl}"`);

        const templateHeaders = (rawTemplate.headers || []).map(h => ({ ...h })); 
        const configHeaders = (webhookConfig.headers || []).map(h => ({ ...h })); 

        const combinedHeadersMap = new Map();
        templateHeaders.forEach(h => combinedHeadersMap.set(h.key.toLowerCase(), h));
        configHeaders.forEach(h => combinedHeadersMap.set(h.key.toLowerCase(), h)); 
        const finalCombinedHeaders = Array.from(combinedHeadersMap.values());
        
        const snapshotForBodyConstruction = {
            bodyTemplate: rawTemplate.bodyTemplate || `{"text":"{userMessage}"}`,
            phoneNumber: recipientOrPhone,
            plainBody: userMessageText
        };
        let finalBody = constructBodyFromSnapshot(snapshotForBodyConstruction);
        console.log(`[WebhookService-BuildPayload] Generic - 最终请求体 for template ${rawTemplate.name}:`, finalBody);

        const snapshot = {
            name: webhookConfig.name, // 或 rawTemplate.name
            templateId: rawTemplate.id,
            templateName: rawTemplate.name,
            method: rawTemplate.method || 'POST',
            headers: finalCombinedHeaders, 
            plainBody: userMessageText, 
            phoneNumber: recipientOrPhone,
            bodyTemplate: rawTemplate.bodyTemplate, 
            url: rawTemplate.url // 存储加密的原始模板URL
        };

        return {
            // id: webhookConfig.id,
            // name: webhookConfig.name,
            templateId: rawTemplate.id,
            templateName: rawTemplate.name,
            templateType: 'generic',
            method: rawTemplate.method || 'POST',
            url: finalUrl, 
            headers: finalCombinedHeaders, 
            body: finalBody, 
            webhookSnapshot: snapshot
        };
    }
}


/**
 * 发送Webhook请求 (可能包含多个模板)
 * @param {Object} clientPayload - 从客户端接收的负载，或从定时任务构造的负载。
 * 应包含 webhookConfigId (对于立即发送是 clientPayload.id), 
 * templateIds (array), phone, plainBody.
 * 对于定时任务，应包含 originalWebhookId, webhookSnapshot (内含templateIds), 等。
 * @param {string} userId - 执行操作的用户ID
 * @param {Object} [initialWebhookConfig] - 可选的、已经获取的原始 Webhook 配置对象。
 * 如果提供，则直接使用；否则，将尝试根据clientPayload中的ID获取。
 * @returns {Promise<Object>} 发送历史条目对象 (可能包含多个结果)
 */
async function sendWebhookRequest(clientPayload, userId, initialWebhookConfig = null) {
    const overallHistoryEntryId = uuidv4();
    const webhookConfigIdForHistory = clientPayload.isScheduledTaskRun ? clientPayload.originalWebhookId : clientPayload.id;

    console.log(`[WebhookService-Send] 开始发送 (可能多模板)。用户: ${userId}, 类型: ${clientPayload.isScheduledTaskRun ? '定时' : '立即'}, History将关联到配置ID: ${webhookConfigIdForHistory}`);
    console.log(`[WebhookService-Send] 完整clientPayload接收到:`, JSON.stringify(clientPayload, null, 2));

    let overallHistoryEntry = {
        id: overallHistoryEntryId,
        webhookId: webhookConfigIdForHistory,
        userId: userId,
        status: 'pending', // Overall status
        timestamp: new Date().toISOString(),
        request: { // 主请求的快照信息
            webhookConfigName: initialWebhookConfig?.name || 'N/A',
            clientPayload: { // 存储部分客户端原始意图
                id: clientPayload.id,
                templateIds: clientPayload.templateIds, // 存储请求的模板ID列表
                phone: clientPayload.phone,
                plainBody: clientPayload.plainBody
            }
        },
        results: [], // Array to store results for each template send
        error: null // For overall errors before individual sends
    };

    let webhookConfigToUse = initialWebhookConfig;
    let templateIdsToSend = [];

    try {
        // 1. 确定 Webhook 配置和要发送的 Template IDs
        if (clientPayload.isScheduledTaskRun && clientPayload.webhookSnapshot) {
            console.log(`[WebhookService-Send] 处理定时任务: ${clientPayload.webhookSnapshot.name}`);
            webhookConfigToUse = clientPayload.webhookSnapshot; // 定时任务快照作为配置基础
            templateIdsToSend = clientPayload.webhookSnapshot.templateIds || [];
            overallHistoryEntry.request.webhookConfigName = webhookConfigToUse.name;
            overallHistoryEntry.request.isScheduledTaskRun = true;
            overallHistoryEntry.request.scheduledTaskSnapshot = clientPayload.webhookSnapshot;
        } else { // 立即发送
            console.log(`[WebhookService-Send] 处理立即发送。配置ID (clientPayload.id): ${clientPayload.id}`);
            if (!webhookConfigToUse) {
                const rawUserWebhooks = await storageService.getRawWebhooksForUser(userId);
                webhookConfigToUse = rawUserWebhooks.find(wh => wh.id === clientPayload.id);
            }
            if (!webhookConfigToUse) {
                throw { message: `发送失败：未找到 ID 为 ${clientPayload.id} 的 Webhook 配置。`, statusCode: 404, isOperational: true };
            }
            overallHistoryEntry.request.webhookConfigName = webhookConfigToUse.name;
            templateIdsToSend = clientPayload.templateIds || webhookConfigToUse.templateIds || []; // 优先客户端，其次配置
        }

        if (!Array.isArray(templateIdsToSend) || templateIdsToSend.length === 0) {
            throw { message: `发送失败：配置 "${webhookConfigToUse.name}" (ID: ${webhookConfigIdForHistory}) 未指定任何有效的地址模板ID。`, statusCode: 400, isOperational: true };
        }
        console.log(`[WebhookService-Send] 将尝试发送 ${templateIdsToSend.length} 个模板: [${templateIdsToSend.join(', ')}] for config "${webhookConfigToUse.name}"`);

        const recipientOrPhone = clientPayload.phone || webhookConfigToUse.phone || '';
        const userMessageText = clientPayload.plainBody || webhookConfigToUse.plainBody || '';

        const userMakingRequest = await storageService.findUserById(userId);
        if (!userMakingRequest) {
            throw new Error("无法获取当前用户信息以校验模板权限。");
        }
        const userRole = userMakingRequest.role;

        // 2. 迭代处理每个 Template ID
        let allSucceeded = true;
        let anySucceeded = false;

        for (const templateId of templateIdsToSend) {
            let singleTemplateResult = {
                templateId: templateId,
                templateName: 'N/A',
                status: 'pending',
                requestSnapshot: null,
                response: null,
                error: null
            };

            try {
                const rawTemplate = await storageService.getRawTemplateByIdForUserAccess(templateId, userId, userRole);
                if (!rawTemplate) {
                    throw { message: `模板 (ID: ${templateId}) 未找到或无权访问。`, statusCode: 404, isOperational: true };
                }
                singleTemplateResult.templateName = rawTemplate.name;

                // 构建针对此模板的请求
                // 对于定时任务，webhookConfigToUse 是快照，可能已包含一些解析过的信息。
                // buildRequestPayload 需要原始的 webhookConfig 和原始模板来正确构建。
                // 如果是定时任务，我们可能需要从 webhookConfigToUse (快照) 中提取信息，
                // 或者确保 buildRequestPayload 能处理这种情况。
                // 当前的 buildRequestPayload 需要一个标准的 webhookConfig 和一个 rawTemplate.
                
                let effectiveWebhookConfigForPayload;
                if (clientPayload.isScheduledTaskRun) {
                     // For scheduled tasks, the 'webhookConfigToUse' IS the snapshot.
                     // We need to ensure that buildRequestPayload gets what it expects.
                     // The snapshot *itself* becomes the 'config' for building the payload for that specific template run.
                     // However, if buildRequestPayload expects specific fields from a *live* webhook config
                     // (like `headers` that might not be in the template snapshot but in the original webhook config),
                     // this needs careful handling.
                     // Let's assume the snapshot (`webhookConfigToUse`) contains enough context,
                     // or for scheduled tasks, we might need a slightly different payload builder.

                     // For now, pass the task's `webhookSnapshot` (which is `webhookConfigToUse` here)
                     // and the `rawTemplate`.
                    effectiveWebhookConfigForPayload = webhookConfigToUse;
                } else {
                    effectiveWebhookConfigForPayload = webhookConfigToUse; // The live webhook config
                }


                const requestForThisTemplate = await buildRequestPayload(effectiveWebhookConfigForPayload, rawTemplate, recipientOrPhone, userMessageText);
                singleTemplateResult.requestSnapshot = requestForThisTemplate.webhookSnapshot; // Store snapshot for this template

                console.log(`[WebhookService-Send] [Template: ${rawTemplate.name}] 请求已准备发送。类型: ${requestForThisTemplate.templateType}`);

                // 实际发送逻辑 (针对单个模板)
                if (requestForThisTemplate.templateType === 'workweixin') {
                    const { corpid, corpsecret, agentid, touser, msgtype } = requestForThisTemplate.workweixinConfig;
                    const messageContent = requestForThisTemplate.body;
                    const accessToken = await workweixinService.getWorkWeixinToken(corpid, corpsecret);
                    const sendMessageUrl = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${accessToken}`;
                    const agentIdInt = parseInt(agentid, 10);
                    if (isNaN(agentIdInt)) throw new Error(`企业微信 AgentID "${agentid}" 无效 (模板: ${rawTemplate.name})。`);

                    let messagePayload;
                    if (msgtype === 'text') {
                        messagePayload = { touser, msgtype: "text", agentid: agentIdInt, text: { content: messageContent }, safe: 0 };
                    } else if (msgtype === 'markdown') {
                        messagePayload = { touser, msgtype: "markdown", agentid: agentIdInt, markdown: { content: messageContent } };
                    } else {
                        throw { message: `不支持的企业微信消息类型: ${msgtype} (模板: ${rawTemplate.name})`, statusCode: 400, isOperational: true };
                    }
                    
                    singleTemplateResult.requestSnapshot.urlForDisplay = `qyapi.weixin.qq.com/.../message/send`;
                    singleTemplateResult.requestSnapshot.actualSentBody = messagePayload;

                    const response = await axios.post(sendMessageUrl, messagePayload, { timeout: 15000 });
                    if (response.data && response.data.errcode === 0) {
                        singleTemplateResult.status = 'success';
                        singleTemplateResult.response = { status: response.status, data: response.data };
                    } else {
                        singleTemplateResult.status = 'failure';
                        singleTemplateResult.error = { message: `企业微信 API 错误: ${response.data.errmsg || '未知错误'} (模板: ${rawTemplate.name})`, code: response.data.errcode, data: response.data };
                        allSucceeded = false;
                    }
                } else { // 通用 Webhook
                    const { method, headers, body, url: urlForAxios } = requestForThisTemplate;
                     if (!urlForAxios || typeof urlForAxios !== 'string' || urlForAxios.trim() === '') {
                        throw new Error(`发送通用请求的URL无效或为空 (模板: ${rawTemplate.name})。`);
                    }
                    try { new URL(urlForAxios); } catch (urlError) {
                        throw new Error(`预检URL无效: "${urlForAxios}" (模板: ${rawTemplate.name}) - ${urlError.message}`);
                    }

                    singleTemplateResult.requestSnapshot.urlForDisplay = urlForAxios;
                    singleTemplateResult.requestSnapshot.actualSentBody = body;

                    let parsedBody = body;
                    if (typeof body === 'string') {
                        try {
                            const tempParsed = JSON.parse(body);
                            if (typeof tempParsed === 'object' && tempParsed !== null) parsedBody = tempParsed;
                        } catch (e) { /* Ignore, send as string */ }
                    }
                    
                    const axiosConfig = {
                        method: method || 'POST',
                        url: urlForAxios,
                        headers: (headers || []).reduce((acc, cur) => { if (cur.key) acc[cur.key] = cur.value; return acc; }, {}),
                        data: parsedBody,
                        timeout: 15000
                    };
                    const response = await axios(axiosConfig);
                    singleTemplateResult.status = 'success';
                    singleTemplateResult.response = { status: response.status, statusText: response.statusText, headers: response.headers, data: response.data };
                }
                if(singleTemplateResult.status === 'success') anySucceeded = true;

            } catch (error) { // Error specific to this template's send attempt
                console.error(`[WebhookService-Send] [Template ID: ${templateId}, Name: ${singleTemplateResult.templateName}] 发送失败:`, error.message);
                allSucceeded = false;
                singleTemplateResult.status = 'failure';
                if (error.response) { // Axios error with response
                    singleTemplateResult.error = { message: error.message, code: error.code, status: error.response.status, data: error.response.data };
                } else if (error.request) { // Axios error, no response
                    singleTemplateResult.error = { message: error.message, code: error.code || 'NO_RESPONSE', requestDetails: "请求已发出但未收到响应" };
                } else { // Other errors
                    singleTemplateResult.error = { message: error.message, code: error.code || 'UNKNOWN_ERROR', name: error.name, isOperational: error.isOperational, statusCode: error.statusCode };
                }
            }
            overallHistoryEntry.results.push(singleTemplateResult);
        } // End of for loop for templateIds

        // Determine overall status
        if (allSucceeded) {
            overallHistoryEntry.status = 'success';
        } else if (anySucceeded) {
            overallHistoryEntry.status = 'partial_success';
        } else {
            overallHistoryEntry.status = 'failure';
        }

    } catch (error) { // Overall error (e.g., config not found, no templates)
        console.error(`[WebhookService-Send] 顶层错误 (配置ID: ${webhookConfigIdForHistory}, 用户: ${userId}) 失败:`, error.message, error.stack);
        overallHistoryEntry.status = 'failure';
        overallHistoryEntry.error = { 
            message: error.message, 
            code: error.code || 'OVERALL_SETUP_ERROR', 
            isOperational: error.isOperational, 
            statusCode: error.statusCode 
        };
    } finally {
        // Clean sensitive data from snapshots before storing, if necessary
        // e.g., overallHistoryEntry.results.forEach(res => delete res.requestSnapshot?.workweixinConfig?.corpsecret);
        // However, buildRequestPayload already handles not putting raw secrets into the snapshot in a problematic way.
        // The `corpsecret` in `workweixinConfig` within `requestForThisTemplate` is the encrypted one from storage.
        // What's crucial is that `getWorkWeixinToken` handles decryption internally and doesn't expose it.

        console.log(`[WebhookService-Send] 准备存储历史条目，ID: ${overallHistoryEntry.id}, Webhook关联ID: ${webhookConfigIdForHistory}`);
        await storageService.addHistoryEntry(webhookConfigIdForHistory, overallHistoryEntry, userId);
        console.log(`[WebhookService-Send] 历史条目已存储。`);
    }

    // Prepare result for client, potentially removing very sensitive parts if they were included
    // For now, the overallHistoryEntry structure should be suitable.
    return overallHistoryEntry;
}


module.exports = {
    sendWebhookRequest,
    constructBodyFromSnapshot, 
    // buildRequestPayload, // Export if needed directly by other services, but typically internal
};