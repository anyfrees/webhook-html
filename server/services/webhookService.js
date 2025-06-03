// server/services/webhookService.js

const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const storageService = require('./storageService');
const workweixinService = require('./workweixinService');
const { encryptText, decryptText } = require('./cryptoService');

function constructBodyFromSnapshot(webhookSnapshot) {
    if (!webhookSnapshot) return '';
    let body = webhookSnapshot.bodyTemplate || '';
    const phone = webhookSnapshot.phoneNumber || '';
    const message = webhookSnapshot.plainBody || '';
    body = body.replace(/{phoneNumber}/g, (phone || "").replace(/"/g, '\\"'));
    body = body.replace(/{phone}/g, (phone || "").replace(/"/g, '\\"'));
    const escapedMessage = (message || "").replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
    body = body.replace(/{userMessage}/g, escapedMessage);
    return body;
}

async function buildRequestPayload(webhookConfig, rawTemplate, recipientOrPhone, userMessageText) {
    if (!rawTemplate) {
        console.error('[WebhookService-BuildPayload] 错误：地址模板无效。');
        throw new Error('构建请求失败：地址模板无效。');
    }
    const decryptedTemplateUrl = decryptText(rawTemplate.url);
    const decryptedCorpid = rawTemplate.type === 'workweixin' ? decryptText(rawTemplate.corpid) : undefined;
    const decryptedAgentid = rawTemplate.type === 'workweixin' ? decryptText(rawTemplate.agentid) : undefined;

    if (rawTemplate.type === 'workweixin') {
        if (!decryptedCorpid || !decryptedAgentid || !rawTemplate.corpsecret) {
            throw new Error('构建请求失败：所选企业微信模板缺少 CorpID, AgentID 或加密的 CorpSecret。');
        }
        return {
            id: webhookConfig.id, name: webhookConfig.name, templateType: 'workweixin',
            workweixinConfig: {
                corpid: decryptedCorpid, corpsecret: rawTemplate.corpsecret, agentid: decryptedAgentid,
                touser: recipientOrPhone, msgtype: rawTemplate.workweixin_msgtype || 'text',
            },
            body: userMessageText,
            webhookSnapshot: {
                name: webhookConfig.name, templateId: rawTemplate.id, plainBody: userMessageText,
                touser: recipientOrPhone, workweixin_msgtype: rawTemplate.workweixin_msgtype || 'text',
                url: rawTemplate.url,
            }
        };
    } else { // Generic Webhook
        if (!decryptedTemplateUrl || decryptedTemplateUrl.trim() === '') {
            throw new Error('构建请求失败：所选地址模板没有有效的URL。');
        }
        let finalUrl = decryptedTemplateUrl;
        finalUrl = finalUrl.replace(/{phoneNumber}/g, (recipientOrPhone || "").replace(/"/g, '\\"'));
        finalUrl = finalUrl.replace(/{phone}/g, (recipientOrPhone || "").replace(/"/g, '\\"'));
        console.log(`[WebhookService-BuildPayload] Generic - Final URL after placeholder replacement: "${finalUrl}"`);

        const combinedHeaders = [...(rawTemplate.headers || [])];
        (webhookConfig.headers || []).forEach(specificHeader => {
            const index = combinedHeaders.findIndex(h => h.key.toLowerCase() === specificHeader.key.toLowerCase());
            if (index > -1) combinedHeaders[index] = specificHeader;
            else combinedHeaders.push(specificHeader);
        });
        let finalBody = rawTemplate.bodyTemplate || `{"msg":"{userMessage}"}`;
        finalBody = constructBodyFromSnapshot({
            bodyTemplate: finalBody, phoneNumber: recipientOrPhone, plainBody: userMessageText
        });
        return {
            id: webhookConfig.id, name: webhookConfig.name, templateType: 'generic',
            method: rawTemplate.method || 'POST', url: finalUrl, headers: combinedHeaders, body: finalBody,
            webhookSnapshot: {
                name: webhookConfig.name, templateId: rawTemplate.id, method: rawTemplate.method || 'POST',
                headers: combinedHeaders, plainBody: userMessageText, phoneNumber: recipientOrPhone,
                bodyTemplate: rawTemplate.bodyTemplate, url: rawTemplate.url
            }
        };
    }
}

async function sendWebhookRequest(clientPayload, userId) {
    const historyEntryId = uuidv4();
    const webhookConfigId = clientPayload.originalWebhookId || clientPayload.id;
    console.log(`[WebhookService-Send] Initiating send for config ID: ${webhookConfigId}, User: ${userId}, Type: ${clientPayload.isScheduledTaskRun ? 'Scheduled' : 'Immediate'}`);
    
    // ***** DEBUG: Print the entire clientPayload as received by this function *****
    console.log(`[WebhookService-Send] Received clientPayload:`, JSON.stringify(clientPayload, null, 2));
    // ***** END DEBUG *****

    if(clientPayload.isScheduledTaskRun) console.log(`[WebhookService-Send] Scheduled task payload (initial, after stringify):`, JSON.stringify(clientPayload, null, 2).substring(0, 1000) + "...");


    let historyEntry = {
        id: historyEntryId, webhookId: webhookConfigId, userId: userId,
        status: 'pending', timestamp: new Date().toISOString(),
        request: {}, response: null, error: null
    };
    let requestToSend;

    try {
        if (clientPayload.isScheduledTaskRun && clientPayload.webhookSnapshot) {
            console.log(`[WebhookService-Send] Processing scheduled task: ${clientPayload.webhookSnapshot.name}`);
            requestToSend = {
                id: clientPayload.originalWebhookId,
                name: clientPayload.webhookSnapshot.name,
                templateType: clientPayload.templateType,
                webhookSnapshot: { ...clientPayload.webhookSnapshot, url: encryptText(decryptText(clientPayload.webhookSnapshot.url)) }
            };

            if (clientPayload.templateType === 'workweixin') {
                if (!clientPayload.workweixinConfig) throw new Error("定时任务的企业微信配置缺失。");
                requestToSend.workweixinConfig = clientPayload.workweixinConfig;
                requestToSend.body = clientPayload.webhookSnapshot.plainBody;
            } else { // Generic scheduled task
                requestToSend.url = clientPayload.url; // Read from clientPayload.url
                console.log(`[WebhookService-Send] Scheduled Generic Task - Attempting to use URL from clientPayload.url: "${requestToSend.url}" (Type: ${typeof requestToSend.url})`);
                if (!requestToSend.url || typeof requestToSend.url !== 'string' || requestToSend.url.trim() === '') {
                    throw new Error(`定时任务的 URL 无效或为空: "${requestToSend.url}"`);
                }
                requestToSend.method = clientPayload.webhookSnapshot.method;
                requestToSend.headers = clientPayload.webhookSnapshot.headers;
                requestToSend.body = constructBodyFromSnapshot(clientPayload.webhookSnapshot);
            }
            historyEntry.request = requestToSend.webhookSnapshot;
        } else {
            console.log(`[WebhookService-Send] Processing immediate send for config: ${webhookConfigId}`);
            const rawWebhooks = await storageService.getRawWebhooksForUser(userId);
            const webhookConfig = rawWebhooks.find(wh => wh.id === webhookConfigId);
            if (!webhookConfig) throw { message: `发送失败：未找到 ID 为 ${webhookConfigId} 的 Webhook 配置。`, statusCode: 404, isOperational: true };

            const templateIdToFetch = clientPayload.templateId || webhookConfig.templateId;
            const rawTemplate = await storageService.getRawTemplateByIdForUser(templateIdToFetch, userId);
            if (!rawTemplate) throw { message: `发送失败：配置 "${webhookConfig.name}" (ID: ${webhookConfigId}) 未关联有效模板 (模板ID: ${templateIdToFetch})。`, statusCode: 404, isOperational: true };

            const recipientOrPhone = clientPayload.phone || webhookConfig.phone || (rawTemplate.type === 'workweixin' ? '@all' : '');
            const userMessageText = clientPayload.plainBody || webhookConfig.plainBody || '';

            requestToSend = await buildRequestPayload(webhookConfig, rawTemplate, recipientOrPhone, userMessageText);
            historyEntry.request = requestToSend.webhookSnapshot;
        }

        console.log(`[WebhookService-Send] Request to send prepared. Type: ${requestToSend.templateType}, Name: ${requestToSend.name}`);
        if (requestToSend.templateType === 'generic') console.log(`[WebhookService-Send] Generic URL (before axios): "${requestToSend.url}"`);

        if (requestToSend.templateType === 'workweixin') {
            const { corpid, corpsecret, agentid, touser, msgtype } = requestToSend.workweixinConfig;
            const messageContent = requestToSend.body;
            const accessToken = await workweixinService.getWorkWeixinToken(corpid, corpsecret);
            const sendMessageUrl = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${accessToken}`;
            const agentIdInt = parseInt(agentid, 10);
            let messagePayload;
            if (msgtype === 'text') messagePayload = { touser, msgtype: "text", agentid: agentIdInt, text: { content: messageContent }, safe: 0 };
            else if (msgtype === 'markdown') messagePayload = { touser, msgtype: "markdown", agentid: agentIdInt, markdown: { content: messageContent } };
            else throw { message: `不支持的企业微信消息类型: ${msgtype}`, statusCode: 400, isOperational: true };
            historyEntry.request.urlForDisplay = `qyapi.weixin.qq.com/.../message/send?access_token=USED_TOKEN`;
            historyEntry.request.actualSentBody = messagePayload;
            const response = await axios.post(sendMessageUrl, messagePayload, { timeout: 15000 });
            if (response.data && response.data.errcode === 0) {
                historyEntry.status = 'success'; historyEntry.response = { status: response.status, data: response.data };
            } else {
                historyEntry.status = 'failure'; historyEntry.error = { message: `企业微信 API 错误: ${response.data.errmsg || '未知错误'}`, code: response.data.errcode, data: response.data };
            }
        } else {
            const { method, headers, body } = requestToSend;
            let urlForAxios = String(requestToSend.url || '').trim();
            console.log(`[WebhookService-Send] Generic URL for Axios (raw, from requestToSend.url): "${requestToSend.url}"`);
            console.log(`[WebhookService-Send] Generic URL for Axios (trimmed): "${urlForAxios}"`);
            if (!urlForAxios) {
                 console.error(`[WebhookService-Send] CRITICAL: URL string is empty after processing for generic request.`);
                 throw new Error(`发送请求的URL无效或为空。`);
            }
            try {
                new URL(urlForAxios);
                console.log(`[WebhookService-Send] URL validation with 'new URL("${urlForAxios}")' successful.`);
            } catch (urlError) {
                console.error(`[WebhookService-Send] CRITICAL: 'new URL("${urlForAxios}")' constructor FAILED:`, urlError.message);
                let charCodes = '';
                for (let i = 0; i < urlForAxios.length; i++) { charCodes += urlForAxios.charCodeAt(i) + ' '; }
                console.error(`[WebhookService-Send] Character codes for URL: ${charCodes.trim()}`);
                throw new Error(`预检URL无效: "${urlForAxios}" - ${urlError.message}`);
            }
            historyEntry.request.urlForDisplay = urlForAxios;
            historyEntry.request.actualSentBody = body;
            const axiosConfig = {
                method: method || 'POST', url: urlForAxios,
                headers: (headers || []).reduce((acc, cur) => { if (cur.key) acc[cur.key] = cur.value; return acc; }, {}),
                data: body, timeout: 15000
            };
            try { if (typeof body === 'string' && (body.trim().startsWith('{') || body.trim().startsWith('['))) axiosConfig.data = JSON.parse(body); } catch (e) { /* ignore */ }
            console.log(`[WebhookService-Send] Executing generic Axios request with config:`, axiosConfig);
            const response = await axios(axiosConfig);
            historyEntry.status = 'success';
            historyEntry.response = { status: response.status, statusText: response.statusText, headers: response.headers, data: response.data };
        }
    } catch (error) {
        const requestUrlForError = requestToSend && requestToSend.templateType === 'generic' ? requestToSend.url : (requestToSend && requestToSend.templateType === 'workweixin' ? 'Enterprise WeChat API' : 'N/A');
        if (error.message && error.message.toLowerCase().includes('invalid url') && requestToSend && requestToSend.templateType === 'generic') {
            console.error(`[WebhookService-Send] Caught Invalid URL error. URL used was: "${requestToSend.url}"`, error.stack);
        } else {
            console.error(`[WebhookService-Send] 发送 Webhook (ID: ${webhookConfigId}, 用户: ${userId}, URL/Target attempted: ${requestUrlForError}) 失败:`, error.message, error.stack);
        }
        historyEntry.status = 'failure';
        if (error.response) {
            historyEntry.error = { message: error.message, code: error.code, status: error.response.status, data: error.response.data };
        } else if (error.request) {
            historyEntry.error = { message: error.message, code: error.code, requestDetails: "请求已发出但未收到响应" };
        } else {
            historyEntry.error = { message: error.message, code: error.code || 'UNKNOWN_ERROR', name: error.name };
        }
        if (error.isOperational) {
            historyEntry.error.statusCode = error.statusCode || 400;
        }
    } finally {
        const entryToStore = JSON.parse(JSON.stringify(historyEntry));
        if (entryToStore.request && entryToStore.request.templateType === 'workweixin' && entryToStore.request.workweixinConfig) {
            delete entryToStore.request.workweixinConfig;
        }
        await storageService.addHistoryEntry(webhookConfigId, entryToStore, userId);
    }
    const resultForClient = { ...historyEntry };
    if (resultForClient.request && resultForClient.request.workweixinConfig) {
        delete resultForClient.request.workweixinConfig.corpsecret;
    }
    return resultForClient;
}

module.exports = {
    sendWebhookRequest,
    constructBodyFromSnapshot,
};
