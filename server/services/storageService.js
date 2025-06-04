// server/services/storageService.js

const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const { encryptText, decryptText } = require('./cryptoService');

const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const WEBHOOKS_FILE = path.join(DATA_DIR, 'webhooks.json');
const TEMPLATES_FILE = path.join(DATA_DIR, 'templates.json');
const TASKS_FILE = path.join(DATA_DIR, 'scheduledTasks.json');
const HISTORY_DIR = path.join(DATA_DIR, 'history');

// --- 文件和目录初始化 ---

async function initializeDefaultUser() {
    try {
        const users = await readFileData(USERS_FILE, []);
        if (users.length === 0) {
            console.log('[StorageService] 未找到用户，正在创建默认 admin 用户...');
            const defaultAdminUsername = 'admin';
            const defaultAdminPassword = 'admin';
            const hashedPassword = await bcrypt.hash(defaultAdminPassword, 10);
            const defaultUser = {
                id: uuidv4(),
                username: defaultAdminUsername,
                password: hashedPassword,
                role: 'admin',
                mustChangePassword: true,
                createdAt: new Date().toISOString(),
                failedLoginAttempts: 0, // 新增
                lockoutUntil: null,     // 新增
                lockoutLevel: 0         // 新增 (0: not locked, 1: 10m, 2: 30m, etc.)
            };
            users.push(defaultUser);
            await writeFileData(USERS_FILE, users);
            console.log(`[StorageService] 默认 admin 用户已创建，角色: admin, 密码: "${defaultAdminPassword}" (首次登录需修改)。`);
        } else {
            let usersModified = false;
            const updatedUsers = users.map(user => {
                let modifiedUser = { ...user };
                if (!modifiedUser.role) {
                    usersModified = true;
                    modifiedUser.role = modifiedUser.username === 'admin' ? 'admin' : 'user';
                }
                if (typeof modifiedUser.mustChangePassword === 'undefined') {
                    usersModified = true;
                    modifiedUser.mustChangePassword = modifiedUser.username === 'admin'; 
                }
                // 初始化新的登录尝试和锁定字段 (如果不存在)
                if (typeof modifiedUser.failedLoginAttempts === 'undefined') {
                    usersModified = true;
                    modifiedUser.failedLoginAttempts = 0;
                }
                if (typeof modifiedUser.lockoutUntil === 'undefined') { // lockoutUntil 可以是 null
                    usersModified = true;
                    modifiedUser.lockoutUntil = null;
                }
                if (typeof modifiedUser.lockoutLevel === 'undefined') {
                    usersModified = true;
                    modifiedUser.lockoutLevel = 0;
                }
                return modifiedUser;
            });
            if (usersModified) {
                console.log('[StorageService] 为现有用户添加或修正了 role/mustChangePassword/loginAttempt 字段。');
                await writeFileData(USERS_FILE, updatedUsers);
            }
        }
    } catch (error) {
        console.error('[StorageService] 初始化默认用户或更新现有用户字段失败:', error);
    }
}

async function ensureDataDirectories() {
    try {
        await fs.mkdir(DATA_DIR, { recursive: true });
        await fs.mkdir(HISTORY_DIR, { recursive: true });
        await initializeDefaultUser(); // 会处理 users.json 和新字段
        
        let webhooks = await readFileData(WEBHOOKS_FILE, []);
        let webhooksModified = false;
        webhooks = webhooks.map(wh => {
            const newWh = {...wh};
            if (newWh.hasOwnProperty('templateId') && !newWh.hasOwnProperty('templateIds')) {
                newWh.templateIds = newWh.templateId ? [newWh.templateId] : [];
                delete newWh.templateId;
                webhooksModified = true;
            } else if (!newWh.hasOwnProperty('templateIds')) {
                newWh.templateIds = [];
                 webhooksModified = true;
            }
            return newWh;
        });
        if (webhooksModified) {
            console.log('[StorageService] 为现有 Webhook 配置迁移/添加了 templateIds 字段。');
            await writeFileData(WEBHOOKS_FILE, webhooks);
        }


        let templates = await readFileData(TEMPLATES_FILE, []);
        let templatesModified = false;
        templates = templates.map(t => {
            if (typeof t.isGlobal === 'undefined') {
                t.isGlobal = (t.userId === 'admin'); 
                templatesModified = true;
            }
            if (typeof t.allowedUserIds === 'undefined') {
                t.allowedUserIds = []; 
                templatesModified = true;
            }
            return t;
        });
        if (templatesModified) {
            console.log('[StorageService] 为现有模板添加了 isGlobal/allowedUserIds 字段。');
            await writeFileData(TEMPLATES_FILE, templates);
        }

        await readFileData(TASKS_FILE, []);
    } catch (err) {
        console.error(`创建数据目录或初始化文件失败:`, err);
        throw new Error(`无法创建数据目录或初始化文件: ${err.message}`);
    }
}

ensureDataDirectories().catch(err => {
    console.error("storageService 初始化失败，应用可能无法正常运行：", err);
});

async function readFileData(filePath, defaultValue = []) {
    try {
        const fileContent = await fs.readFile(filePath, 'utf-8');
        if (fileContent.trim() === '') {
            return defaultValue;
        }
        return JSON.parse(fileContent);
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log(`[StorageService] 文件 '${filePath}' 不存在，将使用默认值创建。`);
            await writeFileData(filePath, defaultValue);
            return defaultValue;
        }
        console.error(`读取文件 '${filePath}' 失败:`, error);
        return defaultValue;
    }
}

async function writeFileData(filePath, data) {
    const tempFilePath = `${filePath}.${uuidv4()}.tmp`;
    try {
        await fs.writeFile(tempFilePath, JSON.stringify(data, null, 2), 'utf-8');
        await fs.rename(tempFilePath, filePath);
    } catch (error) {
        console.error(`写入文件 '${filePath}' 失败:`, error);
        try {
            await fs.unlink(tempFilePath);
        } catch (unlinkError) {
            if (unlinkError.code !== 'ENOENT') {
                 console.warn(`[StorageService] 删除临时文件 '${tempFilePath}' 失败:`, unlinkError);
            }
        }
        throw error;
    }
}

// --- 用户数据管理 ---
async function getUsers() {
    const users = await readFileData(USERS_FILE, []);
    // 确保不返回密码和敏感的登录尝试信息给普通列表查询
    return users.map(user => {
        const { password, failedLoginAttempts, lockoutUntil, lockoutLevel, ...userWithoutSensitive } = user;
        return userWithoutSensitive;
    });
}

async function findUserByUsername(username, includeSensitiveLoginData = false) {
    const users = await readFileData(USERS_FILE, []); 
    const user = users.find(u => u.username === username);
    if (user) {
        if (includeSensitiveLoginData) { // 用于登录过程，需要所有字段
            return user;
        }
        // 默认不返回密码和登录尝试信息
        const { password, failedLoginAttempts, lockoutUntil, lockoutLevel, ...userWithoutSensitive } = user;
        return userWithoutSensitive;
    }
    return null;
}

async function findUserById(userId, includePasswordAndLoginData = false) {
    const users = await readFileData(USERS_FILE, []);
    const user = users.find(u => u.id === userId);
    if (user) {
        if (includePasswordAndLoginData) return user; 
        const { password, failedLoginAttempts, lockoutUntil, lockoutLevel, ...userWithoutSensitive } = user;
        return userWithoutSensitive;
    }
    return null;
}

async function createUser(userData) {
    const users = await readFileData(USERS_FILE, []);
    if (users.some(user => user.username === userData.username)) {
        throw new Error('用户名已存在 (storageService)');
    }
    const newUser = {
        id: userData.id || uuidv4(),
        username: userData.username,
        password: userData.password,
        role: userData.role || 'user',
        mustChangePassword: userData.mustChangePassword !== undefined ? userData.mustChangePassword : true,
        createdAt: userData.createdAt || new Date().toISOString(),
        failedLoginAttempts: 0,         // 新增
        lockoutUntil: null,             // 新增
        lockoutLevel: 0                 // 新增
    };
    users.push(newUser);
    await writeFileData(USERS_FILE, users);
    const { password, failedLoginAttempts, lockoutUntil, lockoutLevel, ...userToReturn } = newUser;
    return userToReturn;
}

async function updateUser(userId, updates) {
    const users = await readFileData(USERS_FILE, []);
    const userIndex = users.findIndex(user => user.id === userId);
    if (userIndex === -1) {
        console.warn(`[StorageService] 尝试更新用户失败：未找到用户 ID ${userId}`);
        return null;
    }
    // 确保只更新传入的字段，并添加 updatedAt
    const updatedUser = { 
        ...users[userIndex], 
        ...updates, 
        updatedAt: new Date().toISOString() 
    };
    users[userIndex] = updatedUser;
    await writeFileData(USERS_FILE, users);
    
    // 返回不含密码和敏感登录尝试信息的用户对象
    const { password, failedLoginAttempts, lockoutUntil, lockoutLevel, ...updatedUserWithoutSensitive } = users[userIndex];
    return updatedUserWithoutSensitive;
}

// --- Webhook 配置数据管理 ---
async function getRawWebhooksForUser(userId) {
    const allWebhooks = await readFileData(WEBHOOKS_FILE, []);
    return allWebhooks
        .filter(wh => wh.userId === userId)
        .map(wh => {
            if (wh.hasOwnProperty('templateId') && !wh.hasOwnProperty('templateIds')) {
                const migratedWh = { ...wh, templateIds: wh.templateId ? [wh.templateId] : [] };
                delete migratedWh.templateId;
                return migratedWh;
            }
            if (!wh.hasOwnProperty('templateIds')) {
                return { ...wh, templateIds: [] };
            }
            return wh;
        });
}

async function getWebhooks(userId) {
    const rawWebhooks = await getRawWebhooksForUser(userId);
    return rawWebhooks.map(wh => ({ ...wh }));
}

async function saveWebhooks(webhooksToSave, userId) {
    const allWebhooks = await readFileData(WEBHOOKS_FILE, []);
    const otherUsersWebhooks = allWebhooks.filter(wh => wh.userId !== userId);
    
    const newUsersWebhooks = webhooksToSave.map(wh => {
        const newWh = {
            ...wh,
            id: wh.id || uuidv4(),
            userId: userId,
        };
        newWh.templateIds = Array.isArray(wh.templateIds) ? wh.templateIds : [];
        delete newWh.templateId; 
        return newWh;
    });
    await writeFileData(WEBHOOKS_FILE, [...otherUsersWebhooks, ...newUsersWebhooks]);
}


// --- 地址模板数据管理 (包含共享逻辑) ---
async function getAllRawTemplates() {
    return readFileData(TEMPLATES_FILE, []);
}

async function getRawTemplatesCreatedByUser(userId) {
    const allTemplates = await getAllRawTemplates();
    return allTemplates.filter(t => t.userId === userId);
}

async function getRawGlobalTemplates() {
    const allTemplates = await getAllRawTemplates();
    return allTemplates.filter(t => t.isGlobal === true);
}

async function getAccessibleTemplatesForUserDisplay(requestingUserId, requestingUserRole) {
    console.log(`[StorageService] getAccessibleTemplatesForUserDisplay - UserID: ${requestingUserId}, Role: ${requestingUserRole}`);
    const allRaw = await getAllRawTemplates();
    let accessibleRaw = [];

    if (requestingUserRole === 'admin') {
        accessibleRaw = allRaw;
        console.log(`[StorageService] Admin '${requestingUserId}' 获取到所有 ${accessibleRaw.length} 个模板。`);
    } else { 
        accessibleRaw = allRaw.filter(t => 
            t.isGlobal === true || 
            (Array.isArray(t.allowedUserIds) && t.allowedUserIds.includes(requestingUserId))
        );
        console.log(`[StorageService] 普通用户 '${requestingUserId}' 获取到 ${accessibleRaw.length} 个可访问模板 (全局或特定授权)。`);
    }

    return accessibleRaw.map(t => {
        const decryptedTemplate = {
            ...t,
            url: (t.type === 'generic' && t.url) ? decryptText(t.url) : t.url,
            workweixin_corpid: (t.type === 'workweixin' && t.corpid) ? decryptText(t.corpid) : undefined,
            workweixin_corpsecret: (t.type === 'workweixin' && t.corpsecret) ? '********' : undefined,
            workweixin_agentid: (t.type === 'workweixin' && t.agentid) ? decryptText(t.agentid) : undefined,
            workweixin_msgtype: (t.type === 'workweixin') ? t.workweixin_msgtype : undefined,
            isGlobal: !!t.isGlobal,
            allowedUserIds: t.allowedUserIds || [] 
        };
        if (t.type !== 'workweixin') {
            delete decryptedTemplate.workweixin_corpid;
            delete decryptedTemplate.workweixin_corpsecret;
            delete decryptedTemplate.workweixin_agentid;
            delete decryptedTemplate.workweixin_msgtype;
        }
        return decryptedTemplate;
    });
}

async function getRawTemplateByIdForUserAccess(templateId, requestingUserId, requestingUserRole) {
    console.log(`[StorageService] getRawTemplateByIdForUserAccess - TemplateID: ${templateId}, UserID: ${requestingUserId}, Role: ${requestingUserRole}`);
    const allTemplates = await getAllRawTemplates();
    const template = allTemplates.find(t => t.id === templateId);

    if (!template) {
        console.warn(`[StorageService] 模板 ID '${templateId}' 未在所有模板中找到。`);
        return null;
    }

    if (requestingUserRole === 'admin') {
        console.log(`[StorageService] 管理员 '${requestingUserId}' 允许访问模板 ID '${templateId}'。`);
        return template; 
    } else { 
        if (template.isGlobal === true || (Array.isArray(template.allowedUserIds) && template.allowedUserIds.includes(requestingUserId))) {
            console.log(`[StorageService] 普通用户 '${requestingUserId}' 允许访问模板 ID '${templateId}' (全局或特定授权)。`);
            return template; 
        }
    }
    console.warn(`[StorageService] 用户 '${requestingUserId}' (角色: ${requestingUserRole}) 无权访问模板 ID '${templateId}'。`);
    return null;
}

async function saveTemplates(templatesToSaveFromAdmin, adminUserId) {
    console.log(`[StorageService] saveTemplates - AdminID: ${adminUserId} 正在处理 ${templatesToSaveFromAdmin.length} 个模板。`);
    const allCurrentRawTemplatesInStorage = await getAllRawTemplates();

    const processedClientTemplates = templatesToSaveFromAdmin.map(tClient => {
        const existingRawTemplate = allCurrentRawTemplatesInStorage.find(tc => tc.id === tClient.id);
        const templateId = tClient.id || uuidv4();

        let encryptedUrl = tClient.url;
        if (tClient.type === 'generic' && tClient.url) {
            encryptedUrl = encryptText(tClient.url);
        }

        let storageCorpid = undefined;
        if (tClient.type === 'workweixin' && tClient.workweixin_corpid) {
            storageCorpid = encryptText(tClient.workweixin_corpid);
        }

        let storageAgentid = undefined;
        if (tClient.type === 'workweixin' && tClient.workweixin_agentid) {
            storageAgentid = encryptText(tClient.workweixin_agentid);
        }
        
        let finalEncryptedSecret;
        if (tClient.type === 'workweixin') {
            if (tClient.hasOwnProperty('workweixin_corpsecret_new')) {
                if (tClient.workweixin_corpsecret_new && tClient.workweixin_corpsecret_new !== '********') {
                    finalEncryptedSecret = encryptText(tClient.workweixin_corpsecret_new);
                } else {
                    finalEncryptedSecret = encryptText("");
                }
            } else if (existingRawTemplate && existingRawTemplate.corpsecret) {
                finalEncryptedSecret = existingRawTemplate.corpsecret;
            } else {
                finalEncryptedSecret = encryptText("");
            }
        } else {
            finalEncryptedSecret = undefined;
        }

        const { workweixin_corpsecret_new, workweixin_corpid, workweixin_agentid, ...restOfTClient } = tClient;

        const templateForStorage = {
            ...restOfTClient,
            id: templateId,
            userId: existingRawTemplate ? existingRawTemplate.userId : adminUserId,
            url: encryptedUrl,
            corpid: storageCorpid,
            corpsecret: finalEncryptedSecret,
            agentid: storageAgentid,
            workweixin_msgtype: (tClient.type === 'workweixin') ? tClient.workweixin_msgtype : undefined,
            isGlobal: !!tClient.isGlobal,
            allowedUserIds: Array.isArray(tClient.allowedUserIds) ? tClient.allowedUserIds : [],
            lastModifiedBy: adminUserId,
            updatedAt: new Date().toISOString(),
            createdAt: existingRawTemplate ? existingRawTemplate.createdAt : new Date().toISOString()
        };

        if (templateForStorage.type !== 'workweixin') {
            delete templateForStorage.corpid;
            delete templateForStorage.corpsecret;
            delete templateForStorage.agentid;
            delete templateForStorage.workweixin_msgtype;
        } else {
            delete templateForStorage.headers;
            templateForStorage.isGlobal = true; 
            templateForStorage.allowedUserIds = [];
        }
        if (templateForStorage.isGlobal) { 
            templateForStorage.allowedUserIds = [];
        }
        return templateForStorage;
    });

    const finalTemplatesToSave = [...allCurrentRawTemplatesInStorage];
    processedClientTemplates.forEach(processedT => {
        const index = finalTemplatesToSave.findIndex(existingT => existingT.id === processedT.id);
        if (index > -1) {
            finalTemplatesToSave[index] = processedT;
        } else {
            finalTemplatesToSave.push(processedT);
        }
    });

    await writeFileData(TEMPLATES_FILE, finalTemplatesToSave);
}


// --- 发送历史记录数据管理 ---
function getHistoryFilePath(webhookId, userId) {
    const validWebhookId = String(webhookId).replace(/[^a-z0-9_-]/gi, '_');
    const validUserId = String(userId).replace(/[^a-z0-9_-]/gi, '_');
    return path.join(HISTORY_DIR, `history_${validUserId}_${validWebhookId}.json`);
}

async function getHistory(webhookId, userId) {
    if (!webhookId || !userId) return [];
    const historyFilePath = getHistoryFilePath(webhookId, userId);
    const entries = await readFileData(historyFilePath, []);

    return entries.map(entry => {
        const entryDec = JSON.parse(JSON.stringify(entry)); 
        if (entryDec.request && entryDec.request.webhookSnapshot && entryDec.request.webhookSnapshot.url) {
             if (entryDec.request.templateType !== 'workweixin'){ 
                entryDec.request.webhookSnapshot.decryptedOriginalUrl = decryptText(entryDec.request.webhookSnapshot.url);
             } else {
                entryDec.request.webhookSnapshot.decryptedOriginalUrl = "企业微信接口 (自动处理)";
             }
        }
        if (entryDec.request && entryDec.request.templateType === 'workweixin') {
            if (entryDec.request.workweixinConfig) { 
                if(entryDec.request.workweixinConfig.corpid) entryDec.request.workweixinConfig.corpid = decryptText(entryDec.request.workweixinConfig.corpid);
                if(entryDec.request.workweixinConfig.agentid) entryDec.request.workweixinConfig.agentid = decryptText(entryDec.request.workweixinConfig.agentid);
                delete entryDec.request.workweixinConfig.corpsecret; 
            }
        }
        return entryDec;
    });
}

async function addHistoryEntry(webhookId, entryData, userId) {
    if (!webhookId || !userId) return;
    const historyFilePath = getHistoryFilePath(webhookId, userId);
    const entries = await readFileData(historyFilePath, []);
    const entryWithUser = { ...entryData, userId: userId, id: entryData.id || uuidv4() };
    entries.unshift(entryWithUser);
    await writeFileData(historyFilePath, entries.slice(0, 50));
}

// --- 定时任务数据管理 ---
async function getAllRawScheduledTasks(userId) {
    const allTasks = await readFileData(TASKS_FILE, []);
    if (userId) {
        return allTasks.filter(task => task.userId === userId);
    }
    return allTasks;
}

async function getScheduledTasks(userId) {
    const rawTasks = await getAllRawScheduledTasks(userId);
    return rawTasks.map(t => {
        const tDec = {
            ...t,
            finalUrl: (t.templateType === 'generic' && t.finalUrl) ? decryptText(t.finalUrl) : undefined,
            webhookSnapshot: t.webhookSnapshot ? {
                ...t.webhookSnapshot,
                url: (t.webhookSnapshot.url && t.templateType !== 'workweixin') ? decryptText(t.webhookSnapshot.url) : t.webhookSnapshot.url,
            } : undefined
        };

        if (t.templateType === 'workweixin' && t.workweixinConfig) {
            tDec.workweixinConfig = {
                corpid: t.workweixinConfig.corpid ? decryptText(t.workweixinConfig.corpid) : undefined,
                corpsecret: '********',
                agentid: t.workweixinConfig.agentid ? decryptText(t.workweixinConfig.agentid) : undefined,
                touser: t.workweixinConfig.touser,
                msgtype: t.workweixinConfig.msgtype,
            };
        }
        if (tDec.finalUrl === undefined) delete tDec.finalUrl;
        if (tDec.webhookSnapshot && tDec.webhookSnapshot.url === undefined) delete tDec.webhookSnapshot.url;
        if (tDec.workweixinConfig) {
            if (tDec.workweixinConfig.corpid === undefined) delete tDec.workweixinConfig.corpid;
            if (tDec.workweixinConfig.agentid === undefined) delete tDec.workweixinConfig.agentid;
        }

        return tDec;
    });
}

async function saveScheduledTasks(tasksToSave, userId) {
    if (userId) {
        const allTasks = await readFileData(TASKS_FILE, []);
        const otherUsersTasks = allTasks.filter(task => task.userId !== userId);
        const newUsersTasks = tasksToSave.map(task => ({
            ...task,
            id: task.id || uuidv4(),
            userId: userId
        }));
        await writeFileData(TASKS_FILE, [...otherUsersTasks, ...newUsersTasks]);
    } else {
        await writeFileData(TASKS_FILE, tasksToSave.map(task => ({...task, id: task.id || uuidv4() })));
    }
}

module.exports = {
    getUsers, 
    findUserByUsername, // Modified to accept includeSensitiveLoginData
    findUserById,       // Modified to accept includePasswordAndLoginData
    createUser, 
    updateUser,
    getWebhooks, saveWebhooks, getRawWebhooksForUser,
    
    getAccessibleTemplatesForUserDisplay,
    saveTemplates,
    getRawTemplateByIdForUserAccess,

    getHistory, addHistoryEntry,
    getScheduledTasks, getAllRawScheduledTasks, saveScheduledTasks,
};