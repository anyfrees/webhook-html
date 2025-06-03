// server/services/workweixinService.js

const axios = require('axios');
const crypto = require('crypto');
const { decryptText } = require('./cryptoService');

const workweixinTokenCache = new Map();
const TOKEN_EXPIRY_BUFFER_MS = 10 * 60 * 1000; // 10 minutes

async function getWorkWeixinToken(corpid, encryptedCorpSecret) {
    console.log(`[WorkWeixinService] getWorkWeixinToken 调用。CorpID: ${corpid}, 是否提供了加密密钥: ${!!encryptedCorpSecret}`);
    if (!corpid || !encryptedCorpSecret) {
        console.error('[WorkWeixinService] 获取 Token 失败: CorpID 或加密的 CorpSecret 为空。');
        throw new Error('获取企业微信 Token 需要有效的 CorpID 和 CorpSecret。');
    }

    let plainCorpSecret;
    try {
        plainCorpSecret = decryptText(encryptedCorpSecret);
        console.log(`[WorkWeixinService] 解密后的 CorpSecret (长度: ${plainCorpSecret?.length})。是否与加密值相同: ${plainCorpSecret === encryptedCorpSecret}`);
    } catch (decryptionError) {
        console.error(`[WorkWeixinService] CorpSecret 解密过程中抛出错误。CorpID: ${corpid}`, decryptionError);
        throw new Error('CorpSecret 解密失败，无法获取 Token。');
    }


    if (!plainCorpSecret || plainCorpSecret === encryptedCorpSecret || plainCorpSecret.trim() === '') {
        console.error(`[WorkWeixinService] CorpSecret 解密失败、结果为空或与加密值相同。CorpID: ${corpid}. 原始加密值: ${encryptedCorpSecret}, 解密后: ${plainCorpSecret}`);
        throw new Error('CorpSecret 解密失败、格式不正确或解密后为空，无法获取 Token。');
    }

    const secretHashForCacheKey = crypto.createHash('md5').update(plainCorpSecret).digest('hex');
    const cacheKey = `wxwork_token_${corpid}_${secretHashForCacheKey}`;

    const cachedEntry = workweixinTokenCache.get(cacheKey);
    if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
        console.log(`[WorkWeixinService] 使用缓存的 Token (CacheKey 前缀: ${cacheKey.substring(0,25)}...)`);
        return cachedEntry.token;
    }

    console.log(`[WorkWeixinService] 正在为 CorpID: ${corpid} (CacheKey 前缀: ${cacheKey.substring(0,25)}...) 获取新的企业微信 Token...`);
    try {
        // 重要：不应在日志中完整记录 plainCorpSecret
        console.log(`[WorkWeixinService] 请求新Token API。参数: corpid=${corpid}, corpsecret=${plainCorpSecret ? plainCorpSecret.substring(0, Math.min(5, plainCorpSecret.length)) + '...' : 'N/A'}`);
        const response = await axios.get('https://qyapi.weixin.qq.com/cgi-bin/gettoken', {
            params: {
                corpid: corpid,
                corpsecret: plainCorpSecret
            },
            timeout: 10000
        });
        console.log('[WorkWeixinService] gettoken API 响应:', response.data);

        if (response.data && response.data.access_token) {
            const token = response.data.access_token;
            const expiresInSeconds = response.data.expires_in || 7200;
            const expiresAt = Date.now() + (expiresInSeconds * 1000) - TOKEN_EXPIRY_BUFFER_MS;

            workweixinTokenCache.set(cacheKey, { token, expiresAt });
            console.log(`[WorkWeixinService] CorpID: ${corpid} 的新 Token 获取成功并已缓存。有效期至: ${new Date(expiresAt).toLocaleString()}`);
            return token;
        } else {
            const errorMsg = `获取企业微信 Token 失败: ${response.data.errmsg || '未知 API 错误'} (错误码: ${response.data.errcode})`;
            console.error(errorMsg, "响应数据:", response.data);
            throw new Error(errorMsg);
        }
    } catch (error) {
        let detailedErrorMessage = error.message;
        if (error.isAxiosError) { // 更详细的 Axios 错误信息
            if (error.response) {
                detailedErrorMessage = `企业微信 API 请求错误: ${error.response.data?.errmsg || JSON.stringify(error.response.data)} (状态码: ${error.response.status})`;
            } else if (error.request) {
                detailedErrorMessage = `企业微信 API 请求错误: 未收到响应 (请求已发出)。`;
            }
            console.error(`[WorkWeixinService] 获取 Token 时发生网络或 API 错误 (CorpID: ${corpid}):`, detailedErrorMessage, "Axios config:", error.config);
        } else {
            console.error(`[WorkWeixinService] 获取 Token 时发生非Axios错误 (CorpID: ${corpid}):`, error.message, error.stack);
        }
        throw new Error(`获取企业微信 Token 时发生错误: ${detailedErrorMessage}`);
    }
}

module.exports = {
    getWorkWeixinToken
};