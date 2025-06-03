// server/services/workweixinService.js

const axios = require('axios');
const crypto = require('crypto'); // Node.js 内置加密模块
// 从我们创建的 cryptoService.js 导入解密函数
const { decryptText } = require('./cryptoService');

// 企业微信 Access Token 缓存
// 缓存结构: Map<cacheKey, { token: string, expiresAt: number }>
// cacheKey 通常是 corpid 和 corpsecret (解密后) 的组合或其哈希值，以确保唯一性
const workweixinTokenCache = new Map();
// Token 过期时间通常为 7200 秒 (2小时)
// 设置一个缓冲期，例如提前 5-10 分钟刷新 Token，以避免在临界点使用已过期的 Token
const TOKEN_EXPIRY_BUFFER_MS = 10 * 60 * 1000; // 提前10分钟刷新token

/**
 * 获取企业微信 Access Token。
 * 会先检查缓存，如果缓存中没有或已临近过期，则调用 API 获取新的 Token。
 * @param {string} corpid - 企业ID (明文)
 * @param {string} encryptedCorpSecret - 加密后的应用密钥 (格式 "iv_hex:encryptedSecret_hex")
 * @returns {Promise<string>} Access Token
 * @throws {Error} 如果获取 Token 失败或配置无效 (例如 corpsecret 解密失败)
 */
async function getWorkWeixinToken(corpid, encryptedCorpSecret) {
    if (!corpid || !encryptedCorpSecret) {
        console.error('[WorkWeixinService] 获取 Token 失败: CorpID 或加密的 CorpSecret 为空。');
        throw new Error('获取企业微信 Token 需要有效的 CorpID 和 CorpSecret。');
    }

    // 1. 解密 CorpSecret
    const plainCorpSecret = decryptText(encryptedCorpSecret);

    // 检查解密是否成功。如果 decryptText 在失败时返回原始加密字符串，
    // 并且原始加密字符串不是一个有效的（非常短的）密钥，则认为解密失败。
    if (!plainCorpSecret || plainCorpSecret === encryptedCorpSecret) {
        // 注意：如果 plainCorpSecret 碰巧与 encryptedCorpSecret 相同（极不可能对于有效密钥），
        // 这里的逻辑也可能错误地判断为解密失败。更健壮的检查是 cryptoService.decryptText 失败时抛出错误。
        // 假设 decryptText 在失败时返回原始值，且原始加密值必然包含 ":"
        console.error(`[WorkWeixinService] CorpSecret 解密失败或格式不正确。Corpid: ${corpid}`);
        throw new Error('CorpSecret 解密失败或格式不正确，无法获取 Token。');
    }

    // 2. 生成缓存键 (Cache Key)
    // 使用 corpid 和解密后的 plainCorpSecret 的哈希作为缓存键，以确保唯一性并避免直接缓存密钥
    const secretHashForCacheKey = crypto.createHash('md5').update(plainCorpSecret).digest('hex');
    const cacheKey = `wxwork_token_${corpid}_${secretHashForCacheKey}`;

    // 3. 检查缓存
    const cachedEntry = workweixinTokenCache.get(cacheKey);
    if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
        // console.log(`[WorkWeixinService] 使用缓存的 Token (CacheKey: ${cacheKey.substring(0,25)}...)`);
        return cachedEntry.token;
    }

    // 4. 如果缓存无效或不存在，则调用 API 获取新 Token
    console.log(`[WorkWeixinService] 正在为 CorpID: ${corpid} (CacheKey: ${cacheKey.substring(0,25)}...) 获取新的企业微信 Token...`);
    try {
        const response = await axios.get('https://qyapi.weixin.qq.com/cgi-bin/gettoken', {
            params: {
                corpid: corpid,
                corpsecret: plainCorpSecret // 使用解密后的密钥
            },
            timeout: 10000 // 设置10秒超时
        });

        if (response.data && response.data.access_token) {
            const token = response.data.access_token;
            // 企业微信返回的 expires_in 是秒数
            const expiresInSeconds = response.data.expires_in || 7200; // 默认为7200秒 (2小时)
            const expiresAt = Date.now() + (expiresInSeconds * 1000) - TOKEN_EXPIRY_BUFFER_MS;

            workweixinTokenCache.set(cacheKey, { token, expiresAt });
            console.log(`[WorkWeixinService] CorpID: ${corpid} 的新 Token 获取成功并已缓存。有效期至: ${new Date(expiresAt).toLocaleString()}`);
            return token;
        } else {
            // API 返回了数据，但没有 access_token 或有错误码
            const errorMsg = `获取企业微信 Token 失败: ${response.data.errmsg || '未知 API 错误'} (错误码: ${response.data.errcode})`;
            console.error(errorMsg, "响应数据:", response.data);
            throw new Error(errorMsg);
        }
    } catch (error) {
        let detailedErrorMessage = error.message;
        if (error.response) { // Axios error with a response from server
            detailedErrorMessage = `企业微信 API 请求错误: ${error.response.data.errmsg || JSON.stringify(error.response.data)} (状态码: ${error.response.status})`;
        } else if (error.request) { // Axios error, request made but no response received
            detailedErrorMessage = `企业微信 API 请求错误: 未收到响应 (请求已发出)。`;
        }
        // 其他错误 (例如网络问题，axios配置问题等) 会保留原始 error.message

        console.error(`[WorkWeixinService] 获取 Token 时发生网络或 API 错误 (CorpID: ${corpid}):`, detailedErrorMessage, error.stack);
        throw new Error(`获取企业微信 Token 时发生错误: ${detailedErrorMessage}`);
    }
}

module.exports = {
    getWorkWeixinToken
};
