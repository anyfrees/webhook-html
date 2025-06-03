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
                role: 'admin', // 添加角色字段
                mustChangePassword: true,
                createdAt: new Date().toISOString()
            };
            users.push(defaultUser);
            await writeFileData(USERS_FILE, users);
            console.log(`[StorageService] 默认 admin 用户已创建，角色: admin, 密码: "${defaultAdminPassword}" (首次登录需修改)。`);
        } else {
            // 确保现有用户有 role 字段，如果没有则默认为 'user' (除了admin)
            let usersModified = false;
            const updatedUsers = users.map(user => {
                if (!user.role) {
                    usersModified = true;
                    if (user.username === 'admin') {
                        return { ...user, role: 'admin' };
                    }
                    return { ...user, role: 'user' };
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

async function ensureDataDirectories() {
    try {
        await fs.mkdir(DATA_DIR, { recursive: true });
        await fs.mkdir(HISTORY_DIR, { recursive: true });
        await initializeDefaultUser();
    } catch (err) {
        console.error(`创建数据目录或初始化默认用户失败:`, err);
        throw new Error(`无法创建数据目录或初始化默认用户: ${err.message}`);
    }
}
ensureDataDirectories().catch(err => {
    console.error("storageService 初始化失败：", err);
    process.exit(1);
});

async function readFileData(filePath, defaultValue = []) {
    try {
        const fileContent = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(fileContent);
    } catch (error) {
        if (error.code === 'ENOENT') {
            await writeFileData(filePath, defaultValue);
            return defaultValue;
        }
        console.error(`读取文件 '${filePath}' 失败:`, error);
        throw error;
    }
}

async function writeFileData(filePath, data) {
    const tempFilePath = `${filePath}.${uuidv4()}.tmp`;
    try {
        await fs.writeFile(tempFilePath, JSON.stringify(data, null, 2), 'utf-8');
        await fs.rename(tempFilePath, filePath);
    } catch (error) {
        console.error(`写入文件 '${filePath}' 失败:`, error);
        try { await fs.unlink(tempFilePath); } catch (unlinkError) { /* ignore */ }
        throw error;
    }
}

// --- 用户数据管理 ---
async function getUsers() {
    return readFileData(USERS_FILE, []);
}

async function findUserByUsername(username) {
    const users = await getUsers();
    // 返回包含角色的完整用户信息 (除了密码)
    const user = users.find(u => u.username === username);
    if (user) {
        const { password, ...userWithoutPassword } = user;
        return userWithoutPassword;
    }
    return null;
}

async function findUserById(userId, includePassword = false) {
    const users = await getUsers();
    const user = users.find(u => u.id === userId);
    if (user) {
        if (includePassword) return user; // 用于密码比较等场景
        const { password, ...userWithoutPassword } = user;
        return userWithoutPassword;
    }
    return null;
}

async function createUser(userData) {
    const users = await getUsers();
    if (users.some(user => user.username === userData.username)) {
        throw new Error('用户名已存在 (storageService)');
    }
    const newUser = {
        ...userData, // 应该包含 username, password (hashed)
        id: userData.id || uuidv4(),
        role: userData.role || 'user', // 新注册用户默认为 'user'
        mustChangePassword: userData.mustChangePassword !== undefined ? userData.mustChangePassword : false,
        createdAt: userData.createdAt || new Date().toISOString()
    };
    users.push(newUser);
    await writeFileData(USERS_FILE, users);
    const { password, ...userToReturn } = newUser;
    return userToReturn;
}

async function updateUser(userId, updates) {
    const users = await getUsers();
    const userIndex = users.findIndex(user => user.id === userId);
    if (userIndex === -1) {
        console.warn(`[StorageService]尝试更新用户失败：未找到用户 ID ${userId}`);
        return null;
    }
    // 确保不会意外地将 role 设置为 undefined
    const currentRole = users[userIndex].role;
    users[userIndex] = { ...users[userIndex], ...updates, updatedAt: new Date().toISOString() };
    if (updates.role === undefined && currentRole) { // 如果更新中没有 role，保留旧 role
        users[userIndex].role = currentRole;
    }

    await writeFileData(USERS_FILE, users);
    const { password, ...updatedUserWithoutPassword } = users[userIndex];
    return updatedUserWithoutPassword;
}

// --- Webhook 配置数据管理 (保持不变，权限检查在 API 层) ---
async function getRawWebhooksForUser(userId) {
    const allWebhooks = await readFileData(WEBHOOKS_FILE, []);
    return allWebhooks.filter(wh => wh.userId === userId);
}
async function getWebhooks(userId) {
    const rawWebhooks = await getRawWebhooksForUser(userId);
    return rawWebhooks.map(wh => ({ ...wh }));
}
async function saveWebhooks(webhooksToSave, userId) {
    const allWebhooks = await readFileData(WEBHOOKS_FILE, []);
    const otherUsersWebhooks = allWebhooks.filter(wh => wh.userId !== userId);
    const newUsersWebhooks = webhooksToSave.map(wh => ({
        ...wh,
        id: wh.id || uuidv4(),
        userId: userId,
    }));
    await writeFileData(WEBHOOKS_FILE, [...otherUsersWebhooks, ...newUsersWebhooks]);
}

// --- 地址模板数据管理 (权限检查在 API 层) ---
async function getAllRawTemplatesForUser(userId) {
    const allTemplates = await readFileData(TEMPLATES_FILE, []);
    return allTemplates.filter(t => t.userId === userId);
}
async function getRawTemplateByIdForUser(templateId, userId) {
    const userTemplates = await getAllRawTemplatesForUser(userId);
    return userTemplates.find(t => t.id === templateId) || null;
}
async function getTemplates(userId) {
    const rawTemplates = await getAllRawTemplatesForUser(userId);
    return rawTemplates.map(t => ({
        ...t,
        url: decryptText(t.url),
        workweixin_corpid: (t.type === 'workweixin' && t.corpid) ? decryptText(t.corpid) : undefined,
        workweixin_corpsecret: (t.type === 'workweixin' && t.corpsecret) ? '********' : undefined,
        workweixin_agentid: (t.type === 'workweixin' && t.agentid) ? decryptText(t.agentid) : undefined,
    }));
}
async function saveTemplates(templatesToSave, userId) {
    const allTemplates = await readFileData(TEMPLATES_FILE, []);
    const otherUsersTemplates = allTemplates.filter(t => t.userId !== userId);
    const userCurrentRawTemplates = allTemplates.filter(t => t.userId === userId);

    const newUsersTemplates = templatesToSave.map(tNew => {
        const tCurrentRaw = userCurrentRawTemplates.find(tc => tc.id === tNew.id);
        let finalEncryptedSecret = tNew.workweixin_corpsecret;
        if (tNew.type === 'workweixin') {
            if (finalEncryptedSecret === '********' && tCurrentRaw && tCurrentRaw.corpsecret) {
                finalEncryptedSecret = tCurrentRaw.corpsecret;
            } else if (finalEncryptedSecret && finalEncryptedSecret !== '********') {
                finalEncryptedSecret = encryptText(finalEncryptedSecret);
            } else {
                finalEncryptedSecret = undefined;
            }
        } else {
            finalEncryptedSecret = undefined;
        }
        return {
            ...tNew, id: tNew.id || uuidv4(), userId: userId,
            url: encryptText(tNew.url),
            corpid: (tNew.type === 'workweixin' && tNew.workweixin_corpid) ? encryptText(tNew.workweixin_corpid) : undefined,
            corpsecret: finalEncryptedSecret,
            agentid: (tNew.type === 'workweixin' && tNew.workweixin_agentid) ? encryptText(tNew.workweixin_agentid) : undefined,
        };
    });
    await writeFileData(TEMPLATES_FILE, [...otherUsersTemplates, ...newUsersTemplates]);
}

// --- 发送历史记录数据管理 (保持不变) ---
function getHistoryFilePath(webhookId, userId) {
    return path.join(HISTORY_DIR, `history_${userId}_${webhookId}.json`);
}
async function getHistory(webhookId, userId) {
    const historyFilePath = getHistoryFilePath(webhookId, userId);
    const entries = await readFileData(historyFilePath, []);
    return entries.map(entry => {
        const entryDec = JSON.parse(JSON.stringify(entry));
        if (entryDec.request && entryDec.request.webhookSnapshot) {
            entryDec.request.webhookSnapshot.decryptedOriginalUrl = decryptText(entryDec.request.webhookSnapshot.url);
        }
        if (entryDec.request && entryDec.request.templateType === 'workweixin') {
            if (entryDec.request.workweixinConfig) {
                entryDec.request.workweixinConfig.corpid = decryptText(entryDec.request.workweixinConfig.corpid);
                entryDec.request.workweixinConfig.agentid = decryptText(entryDec.request.workweixinConfig.agentid);
                delete entryDec.request.workweixinConfig.corpsecret;
            }
        }
        return entryDec;
    });
}
async function addHistoryEntry(webhookId, entryData, userId) {
    const historyFilePath = getHistoryFilePath(webhookId, userId);
    const entries = await readFileData(historyFilePath, []);
    const entryWithUser = { ...entryData, userId: userId, id: entryData.id || uuidv4() };
    entries.unshift(entryWithUser);
    await writeFileData(historyFilePath, entries.slice(0, 50));
}

// --- 定时任务数据管理 (保持不变) ---
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
            finalUrl: decryptText(t.finalUrl),
            webhookSnapshot: t.webhookSnapshot ? {
                ...t.webhookSnapshot,
                url: decryptText(t.webhookSnapshot.url),
            } : undefined
        };
        if (t.templateType === 'workweixin' && t.workweixinConfig) {
            tDec.workweixinConfig = {
                corpid: decryptText(t.workweixinConfig.corpid),
                corpsecret: '********',
                agentid: decryptText(t.workweixinConfig.agentid),
                touser: t.workweixinConfig.touser,
                msgtype: t.workweixinConfig.msgtype,
            };
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
    getUsers, findUserByUsername, findUserById, createUser, updateUser,
    getWebhooks, saveWebhooks, getRawWebhooksForUser,
    getTemplates, saveTemplates, getAllRawTemplatesForUser, getRawTemplateByIdForUser,
    getHistory, addHistoryEntry,
    getScheduledTasks, getAllRawScheduledTasks, saveScheduledTasks,
};
