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

/**
 * 初始化默认管理员用户 (如果不存在)
 */
async function initializeDefaultUser() {
    try {
        const users = await readFileData(USERS_FILE, []);
        if (users.length === 0) {
            console.log('[StorageService] 未找到用户，正在创建默认 admin 用户...');
            const defaultAdminUsername = 'admin';
            const defaultAdminPassword = 'admin'; // 初始密码
            const hashedPassword = await bcrypt.hash(defaultAdminPassword, 10);

            const defaultUser = {
                id: uuidv4(),
                username: defaultAdminUsername,
                password: hashedPassword,
                role: 'admin', // 角色为管理员
                mustChangePassword: true, // 首次登录需要修改密码
                createdAt: new Date().toISOString()
            };
            users.push(defaultUser);
            await writeFileData(USERS_FILE, users);
            console.log(`[StorageService] 默认 admin 用户已创建，角色: admin, 密码: "${defaultAdminPassword}" (首次登录需修改)。`);
        } else {
            // 确保现有用户有 role 字段
            let usersModified = false;
            const updatedUsers = users.map(user => {
                if (!user.role) {
                    usersModified = true;
                    // 如果旧数据中 admin 用户没有角色，也设置为 admin
                    return { ...user, role: user.username === 'admin' ? 'admin' : 'user' };
                }
                return user;
            });
            if (usersModified) {
                console.log('[StorageService] 为现有用户添加了默认角色。');
                await writeFileData(USERS_FILE, updatedUsers);
            }
        }
    } catch (error) {
        console.error('[StorageService] 初始化默认用户或更新现有用户角色失败:', error);
    }
}

/**
 * 确保数据目录存在，并初始化默认用户
 */
async function ensureDataDirectories() {
    try {
        await fs.mkdir(DATA_DIR, { recursive: true });
        await fs.mkdir(HISTORY_DIR, { recursive: true });
        // 初始化默认用户，确保 users.json 文件存在且有内容
        await initializeDefaultUser();
        // 确保其他数据文件存在（如果它们在首次读取时不存在，readFileData会创建它们）
        await readFileData(WEBHOOKS_FILE, []);
        await readFileData(TEMPLATES_FILE, []);
        await readFileData(TASKS_FILE, []);

    } catch (err) {
        console.error(`创建数据目录或初始化文件失败:`, err);
        // 这是一个严重错误，可能导致应用无法正常运行
        throw new Error(`无法创建数据目录或初始化文件: ${err.message}`);
    }
}

// 应用启动时执行目录和文件检查/初始化
ensureDataDirectories().catch(err => {
    console.error("storageService 初始化失败，应用可能无法正常运行：", err);
    // 在生产环境中，可以考虑 process.exit(1) 来阻止应用在数据存储有问题时启动
});


// --- 文件读写辅助函数 ---

/**
 * 读取JSON文件数据
 * @param {string} filePath 文件路径
 * @param {any} defaultValue 文件不存在或为空时返回的默认值
 * @returns {Promise<any>} 解析后的数据或默认值
 */
async function readFileData(filePath, defaultValue = []) {
    try {
        const fileContent = await fs.readFile(filePath, 'utf-8');
        if (fileContent.trim() === '') { // 处理空文件的情况
            return defaultValue;
        }
        return JSON.parse(fileContent);
    } catch (error) {
        if (error.code === 'ENOENT') { // 文件不存在
            console.log(`[StorageService] 文件 '${filePath}' 不存在，将使用默认值创建。`);
            await writeFileData(filePath, defaultValue); // 创建文件并写入默认值
            return defaultValue;
        }
        // 对于JSON解析错误或其他读取错误
        console.error(`读取文件 '${filePath}' 失败:`, error);
        // 根据策略，这里可以抛出错误，或者返回默认值并记录更严重的警告
        // 暂时返回默认值以尝试保持应用运行，但应监控此类错误
        // throw error; // 或者更强硬地抛出错误
        return defaultValue; // 谨慎返回默认值
    }
}

/**
 * 原子写入JSON文件数据
 * @param {string} filePath 文件路径
 * @param {any} data 要写入的数据
 */
async function writeFileData(filePath, data) {
    const tempFilePath = `${filePath}.${uuidv4()}.tmp`; // 临时文件名
    try {
        await fs.writeFile(tempFilePath, JSON.stringify(data, null, 2), 'utf-8');
        await fs.rename(tempFilePath, filePath); // 原子重命名
    } catch (error) {
        console.error(`写入文件 '${filePath}' 失败:`, error);
        // 尝试删除临时文件（如果存在）
        try {
            await fs.unlink(tempFilePath);
        } catch (unlinkError) {
            // 忽略删除临时文件时的错误，主要错误是写入失败
            if (unlinkError.code !== 'ENOENT') {
                 console.warn(`[StorageService] 删除临时文件 '${tempFilePath}' 失败:`, unlinkError);
            }
        }
        throw error; // 重新抛出原始写入错误
    }
}

// --- 用户数据管理 ---

/**
 * 获取所有用户信息 (不含密码)
 * @returns {Promise<Array<Object>>} 用户列表
 */
async function getUsers() {
    const users = await readFileData(USERS_FILE, []);
    return users.map(user => {
        const { password, ...userWithoutPassword } = user;
        return userWithoutPassword;
    });
}

/**
 * 根据用户名查找用户 (不含密码)
 * @param {string} username 用户名
 * @returns {Promise<Object|null>} 用户对象或null
 */
async function findUserByUsername(username) {
    const users = await readFileData(USERS_FILE, []); // users.json 包含密码
    const user = users.find(u => u.username === username);
    if (user) {
        const { password, ...userWithoutPassword } = user; // 移除密码
        return userWithoutPassword;
    }
    return null;
}

/**
 * 根据用户ID查找用户
 * @param {string} userId 用户ID
 * @param {boolean} includePassword 是否包含密码哈希 (仅用于内部认证)
 * @returns {Promise<Object|null>} 用户对象或null
 */
async function findUserById(userId, includePassword = false) {
    const users = await readFileData(USERS_FILE, []); // users.json 包含密码
    const user = users.find(u => u.id === userId);
    if (user) {
        if (includePassword) return user; // 返回包含密码哈希的完整对象
        const { password, ...userWithoutPassword } = user; // 移除密码
        return userWithoutPassword;
    }
    return null;
}

/**
 * 创建新用户
 * @param {Object} userData 用户数据 (应包含 username, password (已哈希), role, mustChangePassword)
 * @returns {Promise<Object>} 创建后的用户信息 (不含密码)
 */
async function createUser(userData) {
    const users = await readFileData(USERS_FILE, []);
    if (users.some(user => user.username === userData.username)) {
        throw new Error('用户名已存在 (storageService)');
    }
    const newUser = {
        id: userData.id || uuidv4(),
        username: userData.username,
        password: userData.password, // 调用者应传入已哈希的密码
        role: userData.role || 'user',
        mustChangePassword: userData.mustChangePassword !== undefined ? userData.mustChangePassword : false,
        createdAt: userData.createdAt || new Date().toISOString()
    };
    users.push(newUser);
    await writeFileData(USERS_FILE, users);
    const { password, ...userToReturn } = newUser; // 返回不含密码的用户信息
    return userToReturn;
}

/**
 * 更新用户信息
 * @param {string} userId 用户ID
 * @param {Object} updates 要更新的字段
 * @returns {Promise<Object|null>} 更新后的用户信息 (不含密码) 或 null
 */
async function updateUser(userId, updates) {
    const users = await readFileData(USERS_FILE, []);
    const userIndex = users.findIndex(user => user.id === userId);
    if (userIndex === -1) {
        console.warn(`[StorageService] 尝试更新用户失败：未找到用户 ID ${userId}`);
        return null;
    }
    // 合并更新，确保不意外删除字段，并更新时间戳
    users[userIndex] = { ...users[userIndex], ...updates, updatedAt: new Date().toISOString() };
    await writeFileData(USERS_FILE, users);
    const { password, ...updatedUserWithoutPassword } = users[userIndex];
    return updatedUserWithoutPassword;
}

// --- Webhook 配置数据管理 ---

/**
 * 获取指定用户的所有原始Webhook配置
 * @param {string} userId 用户ID
 * @returns {Promise<Array<Object>>} Webhook配置列表
 */
async function getRawWebhooksForUser(userId) {
    const allWebhooks = await readFileData(WEBHOOKS_FILE, []);
    return allWebhooks.filter(wh => wh.userId === userId);
}

/**
 * 获取指定用户的Webhook配置 (用于客户端显示，目前与原始数据相同)
 * @param {string} userId 用户ID
 * @returns {Promise<Array<Object>>} Webhook配置列表
 */
async function getWebhooks(userId) {
    const rawWebhooks = await getRawWebhooksForUser(userId);
    // 未来如果Webhook配置本身包含需解密的字段，在这里处理
    return rawWebhooks.map(wh => ({ ...wh }));
}

/**
 * 保存指定用户的Webhook配置列表 (会覆盖该用户的所有旧配置)
 * @param {Array<Object>} webhooksToSave 要保存的Webhook配置列表
 * @param {string} userId 用户ID
 */
async function saveWebhooks(webhooksToSave, userId) {
    const allWebhooks = await readFileData(WEBHOOKS_FILE, []);
    // 筛选出其他用户的Webhook配置
    const otherUsersWebhooks = allWebhooks.filter(wh => wh.userId !== userId);
    // 为当前用户的新配置列表确保ID和userId
    const newUsersWebhooks = webhooksToSave.map(wh => ({
        ...wh,
        id: wh.id || uuidv4(), // 如果是新配置，生成ID
        userId: userId,        // 确保userId正确
    }));
    // 合并并保存
    await writeFileData(WEBHOOKS_FILE, [...otherUsersWebhooks, ...newUsersWebhooks]);
}


// --- 地址模板数据管理 (包含共享逻辑) ---

/**
 * 获取所有原始模板（用于内部处理，不区分用户，包含所有加密字段）
 * @returns {Promise<Array<Object>>} 所有模板的列表
 */
async function getAllRawTemplates() {
    return readFileData(TEMPLATES_FILE, []);
}

/**
 * 获取指定用户创建的原始模板
 * @param {string} userId 创建者用户ID
 * @returns {Promise<Array<Object>>} 该用户创建的模板列表
 */
async function getRawTemplatesCreatedByUser(userId) {
    const allTemplates = await getAllRawTemplates();
    return allTemplates.filter(t => t.userId === userId);
}

/**
 * 获取所有被标记为全局的原始模板
 * @returns {Promise<Array<Object>>} 所有全局模板的列表
 */
async function getRawGlobalTemplates() {
    const allTemplates = await getAllRawTemplates();
    return allTemplates.filter(t => t.isGlobal === true);
}

/**
 * 获取用户可访问的模板列表 (解密敏感字段，用于客户端显示)
 * 管理员可以看到自己创建的 + 所有全局的。
 * 普通用户只能看到全局的。
 * @param {string} requestingUserId 请求用户ID
 * @param {string} requestingUserRole 请求用户角色 ('admin' 或 'user')
 * @returns {Promise<Array<Object>>} 用户可访问的模板列表
 */
async function getAccessibleTemplatesForUserDisplay(requestingUserId, requestingUserRole) {
    console.log(`[StorageService] getAccessibleTemplatesForUserDisplay - UserID: ${requestingUserId}, Role: ${requestingUserRole}`);
    let templatesToReturnRaw = [];

    if (requestingUserRole === 'admin') {
        const adminOwnRaw = await getRawTemplatesCreatedByUser(requestingUserId);
        const globalRaw = await getRawGlobalTemplates();
        
        const combinedMap = new Map(); // 使用Map去重
        adminOwnRaw.forEach(t => combinedMap.set(t.id, t));
        globalRaw.forEach(t => combinedMap.set(t.id, t)); // 如果ID已存在，会被覆盖，这通常是期望的（全局设置优先或最新）
                                                       // 或者，如果希望管理员自己的版本优先，应先添加全局，再添加管理员自己的
        templatesToReturnRaw = Array.from(combinedMap.values());
        console.log(`[StorageService] Admin '${requestingUserId}' 获取到 ${templatesToReturnRaw.length} 个模板 (自己的+全局)。`);
    } else {
        templatesToReturnRaw = await getRawGlobalTemplates();
        console.log(`[StorageService] 普通用户 '${requestingUserId}' 获取到 ${templatesToReturnRaw.length} 个全局模板。`);
    }

    return templatesToReturnRaw.map(t => {
        const decryptedTemplate = {
            ...t, // 包含 id, name, type, userId, isGlobal, bodyTemplate, method, headers (for generic)
            url: (t.type === 'generic' && t.url) ? decryptText(t.url) : t.url, // workweixin的url是占位符，不解密
            // 从存储的 'corpid', 'agentid' 解密到 'workweixin_corpid', 'workweixin_agentid'
            workweixin_corpid: (t.type === 'workweixin' && t.corpid) ? decryptText(t.corpid) : undefined,
            workweixin_corpsecret: (t.type === 'workweixin' && t.corpsecret) ? '********' : undefined, // 总是屏蔽真实密钥
            workweixin_agentid: (t.type === 'workweixin' && t.agentid) ? decryptText(t.agentid) : undefined,
            workweixin_msgtype: (t.type === 'workweixin') ? t.workweixin_msgtype : undefined,
            isGlobal: !!t.isGlobal // 确保是布尔值
        };
        // 清理未定义的 workweixin 字段，如果模板不是 workweixin 类型
        if (t.type !== 'workweixin') {
            delete decryptedTemplate.workweixin_corpid;
            delete decryptedTemplate.workweixin_corpsecret;
            delete decryptedTemplate.workweixin_agentid;
            delete decryptedTemplate.workweixin_msgtype;
        }
        return decryptedTemplate;
    });
}

/**
 * 根据ID获取单个原始模板，会校验用户是否有权访问
 * (用于后端服务，例如 webhookService 在发送时获取模板详情)
 * @param {string} templateId 模板ID
 * @param {string} requestingUserId 请求用户ID
 * @param {string} requestingUserRole 请求用户角色
 * @returns {Promise<Object|null>} 原始模板对象或null
 */
async function getRawTemplateByIdForUserAccess(templateId, requestingUserId, requestingUserRole) {
    console.log(`[StorageService] getRawTemplateByIdForUserAccess - TemplateID: ${templateId}, UserID: ${requestingUserId}, Role: ${requestingUserRole}`);
    const allTemplates = await getAllRawTemplates(); // 获取所有未解密的模板
    const template = allTemplates.find(t => t.id === templateId);

    if (!template) {
        console.warn(`[StorageService] 模板 ID '${templateId}' 未在所有模板中找到。`);
        return null;
    }

    // 权限检查
    if (requestingUserRole === 'admin') {
        // 管理员可以访问任何模板（因为他们可以将其设为全局或编辑任何模板）
        // 或者更严格：管理员可以访问自己创建的，或者任何全局模板
        if (template.userId === requestingUserId || template.isGlobal === true) {
            console.log(`[StorageService] 管理员 '${requestingUserId}' 允许访问模板 ID '${templateId}' (创建者或全局)。`);
            return template; // 返回原始、加密的模板对象
        }
    } else { // 普通用户
        if (template.isGlobal === true) {
            console.log(`[StorageService] 普通用户 '${requestingUserId}' 允许访问全局模板 ID '${templateId}'。`);
            return template; // 返回原始、加密的模板对象
        }
    }
    console.warn(`[StorageService] 用户 '${requestingUserId}' (角色: ${requestingUserRole}) 无权访问模板 ID '${templateId}'。`);
    return null;
}


/**
 * 保存模板列表 (此函数通常由管理员调用)
 * @param {Array<Object>} templatesToSaveFromAdmin 客户端提交的模板列表 (包含isGlobal, workweixin_corpid等明文字段)
 * @param {string} adminUserId 操作管理员的用户ID
 */
async function saveTemplates(templatesToSaveFromAdmin, adminUserId) {
    console.log(`[StorageService] saveTemplates - AdminID: ${adminUserId} 正在处理 ${templatesToSaveFromAdmin.length} 个模板。`);
    const allCurrentRawTemplatesInStorage = await getAllRawTemplates();

    // 将客户端提交的模板数据转换为待存储的格式 (加密敏感字段)
    const processedClientTemplates = templatesToSaveFromAdmin.map(tClient => {
        const existingRawTemplate = allCurrentRawTemplatesInStorage.find(tc => tc.id === tClient.id);
        const templateId = tClient.id || uuidv4(); // 新模板则生成ID

        let encryptedUrl = tClient.url; // workweixin的url是占位符，generic的需要加密
        if (tClient.type === 'generic' && tClient.url) {
            encryptedUrl = encryptText(tClient.url);
        }

        // 客户端传来的 workweixin_corpid, workweixin_agentid 是明文，需要加密存储到 corpid, agentid
        let storageCorpid = undefined;
        if (tClient.type === 'workweixin' && tClient.workweixin_corpid) {
            storageCorpid = encryptText(tClient.workweixin_corpid);
        }

        let storageAgentid = undefined;
        if (tClient.type === 'workweixin' && tClient.workweixin_agentid) {
            storageAgentid = encryptText(tClient.workweixin_agentid);
        }
        
        let finalEncryptedSecret; // 用于存储的 corpsecret
        if (tClient.type === 'workweixin') {
            // 客户端通过 workweixin_corpsecret_new 传递新密钥意图
            if (tClient.hasOwnProperty('workweixin_corpsecret_new')) {
                if (tClient.workweixin_corpsecret_new && tClient.workweixin_corpsecret_new !== '********') {
                    finalEncryptedSecret = encryptText(tClient.workweixin_corpsecret_new);
                } else { // 用户明确清空或新建时未提供
                    finalEncryptedSecret = encryptText("");
                }
            } else if (existingRawTemplate && existingRawTemplate.corpsecret) {
                // 如果客户端没有传递 _new，且是现有模板，则保留旧的加密密钥
                finalEncryptedSecret = existingRawTemplate.corpsecret;
            } else { // 新建模板且客户端没有传递 _new (理论上客户端应处理)
                finalEncryptedSecret = encryptText("");
            }
        } else {
            finalEncryptedSecret = undefined;
        }

        // 从 tClient 中移除前端特定字段，准备存储对象
        const { workweixin_corpsecret_new, workweixin_corpid, workweixin_agentid, ...restOfTClient } = tClient;

        const templateForStorage = {
            ...restOfTClient, // 包含 name, type, bodyTemplate, method, headers, isGlobal
            id: templateId,
            userId: existingRawTemplate ? existingRawTemplate.userId : adminUserId, // 保留原创建者，新模板归属当前管理员
            url: encryptedUrl, // 加密后的URL (或WW占位符)
            corpid: storageCorpid, // 加密后的corpid (仅WW)
            corpsecret: finalEncryptedSecret, // 加密后的corpsecret (仅WW)
            agentid: storageAgentid, // 加密后的agentid (仅WW)
            workweixin_msgtype: (tClient.type === 'workweixin') ? tClient.workweixin_msgtype : undefined,
            isGlobal: !!tClient.isGlobal,
            lastModifiedBy: adminUserId,
            updatedAt: new Date().toISOString(),
            createdAt: existingRawTemplate ? existingRawTemplate.createdAt : new Date().toISOString()
        };

        // 清理非对应类型的字段
        if (templateForStorage.type !== 'workweixin') {
            delete templateForStorage.corpid;
            delete templateForStorage.corpsecret;
            delete templateForStorage.agentid;
            delete templateForStorage.workweixin_msgtype;
        } else { // 清理通用模板独有的 headers (如果之前类型转换残留)
            // bodyTemplate 和 method 对于WW也有意义 (bodyTemplate是消息内容，method是POST)
            // headers 对WW无意义
            delete templateForStorage.headers;
        }
        return templateForStorage;
    });

    // 合并逻辑：用处理后的客户端模板更新或添加到现有模板列表中
    // allCurrentRawTemplatesInStorage 是文件中的完整列表
    // processedClientTemplates 是从客户端提交并处理过的模板列表
    const finalTemplatesToSave = [...allCurrentRawTemplatesInStorage];

    processedClientTemplates.forEach(processedT => {
        const index = finalTemplatesToSave.findIndex(existingT => existingT.id === processedT.id);
        if (index > -1) {
            finalTemplatesToSave[index] = processedT; // 更新现有
        } else {
            finalTemplatesToSave.push(processedT); // 添加新的
        }
    });

    await writeFileData(TEMPLATES_FILE, finalTemplatesToSave);
}


// --- 发送历史记录数据管理 ---

/**
 * 获取指定Webhook配置的发送历史文件路径
 * @param {string} webhookId Webhook配置ID
 * @param {string} userId 用户ID
 * @returns {string} 历史文件路径
 */
function getHistoryFilePath(webhookId, userId) {
    const validWebhookId = String(webhookId).replace(/[^a-z0-9_-]/gi, '_');
    const validUserId = String(userId).replace(/[^a-z0-9_-]/gi, '_');
    return path.join(HISTORY_DIR, `history_${validUserId}_${validWebhookId}.json`);
}

/**
 * 获取指定Webhook配置的发送历史 (解密敏感信息，用于客户端显示)
 * @param {string} webhookId Webhook配置ID
 * @param {string} userId 用户ID
 * @returns {Promise<Array<Object>>} 发送历史列表
 */
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
            // 注意：这里 workweixinConfig 可能不存在于旧的历史记录中
            if (entryDec.request.workweixinConfig) {
                if(entryDec.request.workweixinConfig.corpid) entryDec.request.workweixinConfig.corpid = decryptText(entryDec.request.workweixinConfig.corpid);
                if(entryDec.request.workweixinConfig.agentid) entryDec.request.workweixinConfig.agentid = decryptText(entryDec.request.workweixinConfig.agentid);
                delete entryDec.request.workweixinConfig.corpsecret;
            }
        }
        return entryDec;
    });
}

/**
 * 添加一条发送历史记录
 * @param {string} webhookId Webhook配置ID
 * @param {Object} entryData 历史记录条目数据
 * @param {string} userId 用户ID
 */
async function addHistoryEntry(webhookId, entryData, userId) {
    if (!webhookId || !userId) return;
    const historyFilePath = getHistoryFilePath(webhookId, userId);
    const entries = await readFileData(historyFilePath, []);
    const entryWithUser = { ...entryData, userId: userId, id: entryData.id || uuidv4() };
    entries.unshift(entryWithUser);
    await writeFileData(historyFilePath, entries.slice(0, 50)); // 保留最近50条
}

// --- 定时任务数据管理 ---

/**
 * 获取所有原始定时任务 (可按用户ID过滤)
 * @param {string} [userId] 用户ID (可选)
 * @returns {Promise<Array<Object>>} 定时任务列表
 */
async function getAllRawScheduledTasks(userId) {
    const allTasks = await readFileData(TASKS_FILE, []);
    if (userId) {
        return allTasks.filter(task => task.userId === userId);
    }
    return allTasks;
}

/**
 * 获取指定用户的定时任务列表 (解密敏感信息，用于客户端显示)
 * @param {string} userId 用户ID
 * @returns {Promise<Array<Object>>} 定时任务列表
 */
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
                corpsecret: '********', // 总是屏蔽
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

/**
 * 保存定时任务列表
 * @param {Array<Object>} tasksToSave 要保存的任务列表
 * @param {string} [userId] 用户ID (如果提供，则只更新该用户的任务)
 */
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
    } else { // 如果不提供userId，则认为是系统级操作，直接覆盖所有任务（谨慎使用）
        await writeFileData(TASKS_FILE, tasksToSave.map(task => ({...task, id: task.id || uuidv4() })));
    }
}


module.exports = {
    getUsers, findUserByUsername, findUserById, createUser, updateUser,
    getWebhooks, saveWebhooks, getRawWebhooksForUser,
    
    getAccessibleTemplatesForUserDisplay,
    saveTemplates, // 管理员保存模板时调用
    // getRawTemplatesCreatedByUser, // 主要内部使用或特定场景
    // getRawGlobalTemplates, // 主要内部使用
    getRawTemplateByIdForUserAccess, // 后端服务获取模板详情时调用

    getHistory, addHistoryEntry,
    getScheduledTasks, getAllRawScheduledTasks, saveScheduledTasks,
};
