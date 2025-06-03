// server/services/webhookService.js

const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const storageService = require('./storageService');
const workweixinService = require('./workweixinService');
const { encryptText, decryptText } = require('./cryptoService');

function constructBodyFromSnapshot(webhookSnapshot) {
    if (!webhookSnapshot) return '';
    let body = webhookSnapshot.bodyTemplate || ''; // 使用快照中的 bodyTemplate
    const phone = webhookSnapshot.phoneNumber || webhookSnapshot.touser || ''; // 考虑企业微信的 touser
    const message = webhookSnapshot.plainBody || ''; // 用户消息

    // 替换手机号占位符
    body = body.replace(/{phoneNumber}|{phone}/g, (phone || "").replace(/"/g, '\\"'));

    // 为JSON兼容性转义用户消息，然后替换占位符
    // 更健壮的JSON字符串值转义：
    const escapedMessage = (message || "").replace(/\\/g, '\\\\')  // 1. 首先转义反斜杠
                                       .replace(/"/g, '\\"')   // 2. 转义双引号
                                       .replace(/\n/g, '\\n')  // 3. 转义换行符
                                       .replace(/\r/g, '\\r')  // 4. 转义回车符
                                       .replace(/\t/g, '\\t'); // 5. 转义制表符
                                       // 如果需要，添加其他转义 (例如，换页符 \f, 退格符 \b)

    body = body.replace(/{userMessage}/g, escapedMessage);
    return body;
}


/**
 * 构建请求负载对象，用于实际发送或存储为快照。
 * @param {Object} webhookConfig - 用户保存的 Webhook 配置 (来自 storageService.getRawWebhooksForUser)
 * @param {Object} rawTemplate - 原始模板数据 (已通过权限检查，来自 storageService.getRawTemplateByIdForUserAccess)
 * @param {string} recipientOrPhone - 实际的接收者或电话号码
 * @param {string} userMessageText - 用户输入的纯文本消息
 * @returns {Promise<Object>} 准备好的请求对象
 */
async function buildRequestPayload(webhookConfig, rawTemplate, recipientOrPhone, userMessageText) {
    console.log(`[WebhookService-BuildPayload] 开始构建。Webhook配置名: ${webhookConfig?.name}, 模板名: ${rawTemplate?.name}, 接收者: ${recipientOrPhone}`);
    if (!rawTemplate) {
        console.error('[WebhookService-BuildPayload] 错误：地址模板 (rawTemplate) 无效或未提供。Webhook配置ID:', webhookConfig?.id);
        throw new Error('构建请求失败：地址模板无效或未提供。');
    }

    // 解密企业微信特定字段
    const decryptedCorpid = rawTemplate.type === 'workweixin' && rawTemplate.corpid ? decryptText(rawTemplate.corpid) : undefined;
    const decryptedAgentid = rawTemplate.type === 'workweixin' && rawTemplate.agentid ? decryptText(rawTemplate.agentid) : undefined;

    if (rawTemplate.type === 'workweixin') {
        console.log(`[WebhookService-BuildPayload] 构建企业微信类型。解密后CorpID: ${decryptedCorpid}, AgentID: ${decryptedAgentid}, CorpSecret存在: ${!!rawTemplate.corpsecret}`);
        if (!decryptedCorpid || !decryptedAgentid || !rawTemplate.corpsecret) {
            console.error(`[WebhookService-BuildPayload] 企业微信模板缺少 CorpID, AgentID 或加密的 CorpSecret。CorpID: ${decryptedCorpid}, AgentID: ${decryptedAgentid}, Secret Exists: ${!!rawTemplate.corpsecret}`);
            throw new Error('构建请求失败：所选企业微信模板缺少 CorpID, AgentID 或加密的 CorpSecret。');
        }
        // 对于企业微信，返回的 requestToSend 对象中的 'body' 字段将直接是 userMessageText。
        // 实际发送给企业微信API的消息负载将在 sendWebhookRequest 中构建。
        const snapshot = {
            name: webhookConfig.name,
            templateId: rawTemplate.id,
            plainBody: userMessageText, // 用户的直接消息
            touser: recipientOrPhone, // 发送对象
            workweixin_msgtype: rawTemplate.workweixin_msgtype || 'text',
            url: "WORKWEIXIN_APP_MESSAGE_API", // 占位符，不是此对象中axios直接调用的真实URL
        };
        return {
            id: webhookConfig.id,
            name: webhookConfig.name,
            templateType: 'workweixin',
            workweixinConfig: { //此配置用于 sendWebhookRequest 进行实际的API调用
                corpid: decryptedCorpid, // 已解密
                corpsecret: rawTemplate.corpsecret, // 仍然加密，getWorkWeixinToken 将解密它
                agentid: decryptedAgentid, // 已解密
                touser: recipientOrPhone,
                msgtype: rawTemplate.workweixin_msgtype || 'text',
            },
            body: userMessageText, // 此类型的用户消息内容
            webhookSnapshot: snapshot
        };
    } else { // 通用 Webhook
        const decryptedTemplateUrl = decryptText(rawTemplate.url);
        console.log(`[WebhookService-BuildPayload] 构建通用类型。解密后模板URL: ${decryptedTemplateUrl}`);
        if (!decryptedTemplateUrl || decryptedTemplateUrl.trim() === '') {
            throw new Error('构建请求失败：所选地址模板没有有效的URL。');
        }

        let finalUrl = decryptedTemplateUrl;
        // 替换URL中的占位符
        finalUrl = finalUrl.replace(/{phoneNumber}|{phone}/g, (recipientOrPhone || "").replace(/"/g, '\\"'));
        console.log(`[WebhookService-BuildPayload] Generic - 替换占位符后URL: "${finalUrl}"`);

        // 合并请求头：模板请求头优先，然后配置特定的请求头会覆盖或添加
        const templateHeaders = (rawTemplate.headers || []).map(h => ({ ...h })); // 克隆
        const configHeaders = (webhookConfig.headers || []).map(h => ({ ...h })); // 克隆

        const combinedHeadersMap = new Map();
        templateHeaders.forEach(h => combinedHeadersMap.set(h.key.toLowerCase(), h));
        configHeaders.forEach(h => combinedHeadersMap.set(h.key.toLowerCase(), h)); // 覆盖或添加
        const finalCombinedHeaders = Array.from(combinedHeadersMap.values());

        // 使用模板和用户消息构造请求体
        // 通用类型的快照需要 bodyTemplate 和 phoneNumber 以便 constructBodyFromSnapshot 使用
        const snapshotForBodyConstruction = {
            bodyTemplate: rawTemplate.bodyTemplate || `{"text":"{userMessage}"}`, // 如果模板请求体为空，则使用默认值
            phoneNumber: recipientOrPhone,
            plainBody: userMessageText
        };
        let finalBody = constructBodyFromSnapshot(snapshotForBodyConstruction);
        console.log(`[WebhookService-BuildPayload] Generic - 最终请求体:`, finalBody);

        const snapshot = {
            name: webhookConfig.name,
            templateId: rawTemplate.id,
            method: rawTemplate.method || 'POST',
            headers: finalCombinedHeaders, // 在快照中存储合并后的请求头
            plainBody: userMessageText, // 用户的直接消息
            phoneNumber: recipientOrPhone,
            bodyTemplate: rawTemplate.bodyTemplate, // 原始模板请求体
            url: rawTemplate.url // 原始模板URL（存储时为加密形式，来自rawTemplate）
        };

        return {
            id: webhookConfig.id,
            name: webhookConfig.name,
            templateType: 'generic',
            method: rawTemplate.method || 'POST',
            url: finalUrl, // 已解析占位符的URL
            headers: finalCombinedHeaders, // 实际用于请求的请求头
            body: finalBody, // 已解析占位符的请求体
            webhookSnapshot: snapshot
        };
    }
}


/**
 * 发送Webhook请求
 * @param {Object} clientPayload - 从客户端接收的负载，或从定时任务构造的负载
 * @param {string} userId - 执行操作的用户ID
 * @param {Object} [rawTemplateFromApi] - 可选的、已经过权限检查的原始模板对象。如果提供，则直接使用；否则，将尝试根据clientPayload中的templateId获取。
 * @returns {Promise<Object>} 发送历史条目对象
 */
async function sendWebhookRequest(clientPayload, userId, rawTemplateFromApi = null) {
    const historyEntryId = uuidv4();
    // 对于立即发送，clientPayload.id 是 webhookConfigId。
    // 对于定时任务，clientPayload.originalWebhookId 是相关的 webhookConfigId，用于历史记录。
    const webhookConfigIdForHistory = clientPayload.isScheduledTaskRun ? clientPayload.originalWebhookId : clientPayload.id;

    console.log(`[WebhookService-Send] 开始发送。用户: ${userId}, 类型: ${clientPayload.isScheduledTaskRun ? '定时' : '立即'}, History将关联到ID: ${webhookConfigIdForHistory}`);
    console.log(`[WebhookService-Send] 完整clientPayload接收到:`, JSON.stringify(clientPayload, null, 2));
    if (rawTemplateFromApi) {
        console.log(`[WebhookService-Send] 已提供 rawTemplateFromApi: ${rawTemplateFromApi.name} (ID: ${rawTemplateFromApi.id})`);
    }

    let historyEntry = {
        id: historyEntryId,
        webhookId: webhookConfigIdForHistory, // 为历史记录使用正确的ID
        userId: userId,
        status: 'pending',
        timestamp: new Date().toISOString(),
        request: {}, // 将用快照填充
        response: null,
        error: null
    };
    let requestToSend; // 这将保存完全准备好的请求（URL、请求体、请求头等）

    try {
        if (clientPayload.isScheduledTaskRun && clientPayload.webhookSnapshot) {
            console.log(`[WebhookService-Send] 处理定时任务: ${clientPayload.webhookSnapshot.name}`);
            // 对于定时任务，clientPayload 应该已经包含了几乎所有需要的信息。
            // webhookSnapshot.url 是 *原始* 模板URL (已加密)
            // clientPayload.url 是通用任务的 *最终、已解析、已解密* 的URL
            // clientPayload.workweixinConfig 包含已解密的corpid, agentid, 和 *已加密* 的corpsecret
            // clientPayload.body 是企业微信的userMessageText，或通用任务的已解析请求体 (来自taskService)

            requestToSend = {
                id: clientPayload.originalWebhookId, // 原始webhook配置ID
                name: clientPayload.webhookSnapshot.name,
                templateType: clientPayload.templateType,
                // clientPayload中的webhookSnapshot已由taskService准备好
                webhookSnapshot: { ...clientPayload.webhookSnapshot }
            };
            // 确保快照URL已为历史记录存储加密（如果taskService解密了它）
            // 假设来自taskService的webhookSnapshot.url已经是原始的（可能已加密的）URL。
            // 如果它被解密了，确保为历史记录的快照重新加密它。
            // 然而，storageService.addHistoryEntry不会重新加密，所以它应该是原始的加密URL。


            if (clientPayload.templateType === 'workweixin') {
                if (!clientPayload.workweixinConfig) throw new Error("定时任务的企业微信配置缺失。");
                requestToSend.workweixinConfig = clientPayload.workweixinConfig; // 包括解密的corpid, agentid, 加密的corpsecret
                requestToSend.body = clientPayload.body; // 这是userMessageText
            } else { // 通用定时任务
                if (!clientPayload.url || typeof clientPayload.url !== 'string' || clientPayload.url.trim() === '') {
                    throw new Error(`定时任务的 URL 无效或为空: "${clientPayload.url}"`);
                }
                requestToSend.url = clientPayload.url; // 这是最终的、已解析、已解密的URL
                requestToSend.method = clientPayload.webhookSnapshot.method; // 来自快照
                requestToSend.headers = clientPayload.webhookSnapshot.headers; // 来自快照
                requestToSend.body = clientPayload.body; // 这是已解析的请求体
            }
            historyEntry.request = requestToSend.webhookSnapshot; // 用于历史记录的快照
        } else { // 立即发送
            console.log(`[WebhookService-Send] 处理立即发送。配置ID (clientPayload.id): ${clientPayload.id}`);
            const rawWebhooks = await storageService.getRawWebhooksForUser(userId);
            const webhookConfig = rawWebhooks.find(wh => wh.id === clientPayload.id); // clientPayload.id 是 webhookConfig 的 ID
            if (!webhookConfig) {
                console.error(`[WebhookService-Send] Webhook配置未找到 ID: ${clientPayload.id}, 用户: ${userId}`);
                throw { message: `发送失败：未找到 ID 为 ${clientPayload.id} 的 Webhook 配置。`, statusCode: 404, isOperational: true };
            }

            let effectiveRawTemplate = rawTemplateFromApi; // 优先使用API路由层传递过来的模板
            if (!effectiveRawTemplate) {
                console.warn(`[WebhookService-Send] 未从API路由层接收到rawTemplate，将尝试根据templateId获取。`);
                const templateIdToFetch = clientPayload.templateId || webhookConfig.templateId;
                if (!templateIdToFetch) {
                    console.error(`[WebhookService-Send] 模板ID未在clientPayload或webhookConfig中指定。WebhookConfig ID: ${webhookConfig.id}`);
                    throw { message: `发送失败：配置 "${webhookConfig.name}" (ID: ${webhookConfig.id}) 未指定地址模板。`, statusCode: 400, isOperational: true };
                }
                // 此处调用需要用户角色信息进行权限校验
                const userMakingRequest = await storageService.findUserById(userId); // 获取当前用户信息以得到角色
                if (!userMakingRequest) { // 理论上 authMiddleware 会确保用户存在
                    console.error(`[WebhookService-Send] 无法获取用户 ${userId} 的信息以校验模板权限。`);
                    throw new Error("无法获取当前用户信息以校验模板权限。");
                }

                effectiveRawTemplate = await storageService.getRawTemplateByIdForUserAccess(templateIdToFetch, userId, userMakingRequest.role);
                if (!effectiveRawTemplate) {
                    console.error(`[WebhookService-Send] 模板未找到或无权访问 ID: ${templateIdToFetch}, 用户: ${userId}`);
                    throw { message: `发送失败：配置 "${webhookConfig.name}" (ID: ${webhookConfig.id}) 未关联有效或可访问的模板 (模板ID: ${templateIdToFetch})。`, statusCode: 404, isOperational: true };
                }
                console.log(`[WebhookService-Send] 已通过storageService获取模板: ${effectiveRawTemplate.name}`);
            }


            console.log(`[WebhookService-Send] 找到Webhook配置: ${webhookConfig.name}, 使用模板: ${effectiveRawTemplate.name} (类型: ${effectiveRawTemplate.type})`);

            const recipientOrPhone = clientPayload.phone || webhookConfig.phone || (effectiveRawTemplate.type === 'workweixin' ? '@all' : '');
            const userMessageText = clientPayload.plainBody || webhookConfig.plainBody || '';

            requestToSend = await buildRequestPayload(webhookConfig, effectiveRawTemplate, recipientOrPhone, userMessageText);
            historyEntry.request = requestToSend.webhookSnapshot; // 用生成的快照填充历史记录
        }

        console.log(`[WebhookService-Send] 请求已准备发送。类型: ${requestToSend.templateType}, 名称: ${requestToSend.name}`);
        if (requestToSend.templateType === 'generic') console.log(`[WebhookService-Send] Generic URL (用于axios): "${requestToSend.url}"`);

        // 实际发送逻辑
        if (requestToSend.templateType === 'workweixin') {
            const { corpid, corpsecret, agentid, touser, msgtype } = requestToSend.workweixinConfig;
            const messageContent = requestToSend.body; // 这是企业微信的 userMessageText
            console.log(`[WebhookService-Send] 企业微信: 尝试获取token，CorpID: ${corpid}`);
            const accessToken = await workweixinService.getWorkWeixinToken(corpid, corpsecret); // corpsecret 在这里是加密的
            console.log(`[WebhookService-Send] 企业微信: Token已获取。准备发送消息。消息类型: ${msgtype}, 接收者: ${touser}`);
            const sendMessageUrl = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${accessToken}`;
            const agentIdInt = parseInt(agentid, 10);
            if (isNaN(agentIdInt)) {
                console.error(`[WebhookService-Send] 企业微信 AgentID 无效: ${agentid}`);
                throw new Error(`企业微信 AgentID "${agentid}" 无效。`);
            }

            let messagePayload;
            if (msgtype === 'text') {
                messagePayload = { touser, msgtype: "text", agentid: agentIdInt, text: { content: messageContent }, safe: 0 };
            } else if (msgtype === 'markdown') {
                messagePayload = { touser, msgtype: "markdown", agentid: agentIdInt, markdown: { content: messageContent } };
            } else {
                console.error(`[WebhookService-Send] 不支持的企业微信消息类型: ${msgtype}`);
                throw { message: `不支持的企业微信消息类型: ${msgtype}`, statusCode: 400, isOperational: true };
            }
            
            historyEntry.request.urlForDisplay = `qyapi.weixin.qq.com/.../message/send?access_token=USED_TOKEN`; // 用于历史记录显示
            historyEntry.request.actualSentBody = messagePayload; // 存储实际发送的负载

            console.log(`[WebhookService-Send] 企业微信: 正在发送消息到 ${sendMessageUrl}。Payload:`, JSON.stringify(messagePayload, null, 2));
            const response = await axios.post(sendMessageUrl, messagePayload, { timeout: 15000 });
            console.log('[WebhookService-Send] 企业微信: API响应:', response.data);

            if (response.data && response.data.errcode === 0) {
                historyEntry.status = 'success';
                historyEntry.response = { status: response.status, data: response.data };
            } else {
                historyEntry.status = 'failure';
                historyEntry.error = { message: `企业微信 API 错误: ${response.data.errmsg || '未知错误'}`, code: response.data.errcode, data: response.data };
            }
        } else { // 通用 Webhook
            const { method, headers, body } = requestToSend;
            let urlForAxios = String(requestToSend.url || '').trim(); // requestToSend.url 对于通用类型已经是解析后的URL
            console.log(`[WebhookService-Send] 通用: Axios将使用的URL (原始, 来自 requestToSend.url): "${requestToSend.url}"`);
            console.log(`[WebhookService-Send] 通用: Axios将使用的URL (trim后): "${urlForAxios}"`);

            if (!urlForAxios) {
                 console.error(`[WebhookService-Send] 严重错误: 通用请求的URL字符串处理后为空。`);
                 throw new Error(`发送请求的URL无效或为空。`);
            }
            try { // 预校验URL
                new URL(urlForAxios);
                console.log(`[WebhookService-Send] URL使用 'new URL("${urlForAxios}")' 验证成功。`);
            } catch (urlError) {
                console.error(`[WebhookService-Send] 严重错误: 'new URL("${urlForAxios}")' 构造函数失败:`, urlError.message);
                let charCodes = ''; for (let i = 0; i < urlForAxios.length; i++) { charCodes += urlForAxios.charCodeAt(i) + ' '; }
                console.error(`[WebhookService-Send] URL字符编码: ${charCodes.trim()}`);
                throw new Error(`预检URL无效: "${urlForAxios}" - ${urlError.message}`);
            }

            historyEntry.request.urlForDisplay = urlForAxios; // 用于历史记录显示
            historyEntry.request.actualSentBody = body; // 存储实际发送的负载

            const axiosConfig = {
                method: method || 'POST',
                url: urlForAxios,
                headers: (headers || []).reduce((acc, cur) => { if (cur.key) acc[cur.key] = cur.value; return acc; }, {}),
                data: body, // body 此时是 constructBodyFromSnapshot 生成的字符串
                timeout: 15000
            };

            // 尝试将请求体解析为JSON（如果它看起来像JSON），以便Axios正确处理Content-Type: application/json
            // constructBodyFromSnapshot 应该已经生成了一个字符串。如果它意图是JSON，那么它应该是一个JSON字符串。
            // 如果data是对象，Axios通常会设置Content-Type: application/json。如果data是字符串，它可能默认为text/plain。
            // 如果body是JSON字符串，我们可以解析它，以便Axios将其作为JSON对象发送。
            let parsedBody = body;
            if (typeof body === 'string') {
                try {
                    const tempParsed = JSON.parse(body);
                    // 仅当解析结果是对象或数组时才使用解析后的值，而不是原始类型（如数字/布尔/null，如果JSON.parse允许的话）
                    if (typeof tempParsed === 'object' && tempParsed !== null) {
                        parsedBody = tempParsed;
                    }
                } catch (e) { /* 如果不是有效的JSON，则忽略，按字符串发送 */ }
            }
            axiosConfig.data = parsedBody;


            console.log(`[WebhookService-Send] 通用: 正在执行Axios请求。配置:`, JSON.stringify(axiosConfig, null, 2));
            const response = await axios(axiosConfig);
            console.log('[WebhookService-Send] 通用: API响应。状态:', response.status, '数据:', response.data);

            historyEntry.status = 'success';
            historyEntry.response = { status: response.status, statusText: response.statusText, headers: response.headers, data: response.data };
        }
    } catch (error) {
        const requestUrlForError = requestToSend?.url || (requestToSend?.templateType === 'workweixin' ? '企业微信API' : 'N/A');
        if (error.message && error.message.toLowerCase().includes('invalid url') && requestToSend && requestToSend.templateType === 'generic') {
            console.error(`[WebhookService-Send] 捕获到无效URL错误。使用的URL是: "${requestToSend.url}"`, error.stack);
        } else {
            console.error(`[WebhookService-Send] 发送 Webhook (配置ID: ${webhookConfigIdForHistory}, 用户: ${userId}, 尝试的URL/目标: ${requestUrlForError}) 失败:`, error.message);
        }
        // 如果是Axios错误，记录更多详情
        if (error.isAxiosError) {
            console.error('[WebhookService-Send] Axios错误详情:', {
                message: error.message,
                code: error.code,
                config: error.config ? { method: error.config.method, url: error.config.url, headers: error.config.headers, data: error.config.data } : undefined,
                request: error.request ? 'Request object present' : 'No request object',
                response: error.response ? { status: error.response.status, statusText: error.response.statusText, headers: error.response.headers, data: error.response.data } : 'No response object'
            });
        } else {
            console.error('[WebhookService-Send] 非Axios错误详情:', error.stack);
        }


        historyEntry.status = 'failure';
        if (error.response) { // 带服务器响应的Axios错误
            historyEntry.error = { message: error.message, code: error.code, status: error.response.status, data: error.response.data };
        } else if (error.request) { // Axios错误，请求已发出但未收到响应
            historyEntry.error = { message: error.message, code: error.code || 'NO_RESPONSE', requestDetails: "请求已发出但未收到响应" };
        } else { // 其他错误
            historyEntry.error = { message: error.message, code: error.code || 'UNKNOWN_ERROR', name: error.name };
        }
        if (error.isOperational) { // 自定义操作性错误
            historyEntry.error.statusCode = error.statusCode || 400;
        }
    } finally {
        const entryToStore = JSON.parse(JSON.stringify(historyEntry));
        // 从历史记录请求快照中清理敏感数据（如果意外包含）
        if (entryToStore.request && entryToStore.request.templateType === 'workweixin' && entryToStore.request.workweixinConfig) {
            delete entryToStore.request.workweixinConfig.corpsecret; // 确保加密的secret不在历史记录中
            // corpid和agentid在requestToSend.workweixinConfig中已解密，然后复制到快照。
            // 对于历史记录，这些保持解密状态可能更利于显示/调试，或者如果策略要求，可以重新加密。
            // 当前storageService.getHistory如果它们被加密了，会再次解密它们。
            // 假设requestToSend中的快照已经包含了所需的解密后的corpid/agentid（如果历史显示需要）。
        }
        // 对于通用类型，快照中的rawTemplate.url已经是加密的。实际调用时使用decryptedTemplateUrl。
        console.log(`[WebhookService-Send] 准备存储历史条目，ID: ${entryToStore.id}, Webhook关联ID: ${webhookConfigIdForHistory}`);
        await storageService.addHistoryEntry(webhookConfigIdForHistory, entryToStore, userId);
        console.log(`[WebhookService-Send] 历史条目已存储。`);
    }

    // 准备给客户端的结果，移除敏感数据
    const resultForClient = { ...historyEntry };
    if (resultForClient.request && resultForClient.request.workweixinConfig) {
        delete resultForClient.request.workweixinConfig.corpsecret; // 发送给客户端前移除secret
    }
    return resultForClient;
}


module.exports = {
    sendWebhookRequest,
    constructBodyFromSnapshot, // 如果taskService直接使用，则导出 (目前是这样)
};
