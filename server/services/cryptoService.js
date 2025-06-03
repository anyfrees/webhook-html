// server/services/cryptoService.js

const crypto = require('crypto'); // Node.js 内置加密模块
const dotenv = require('dotenv'); // 用于加载 .env 文件中的环境变量
const path = require('path');

// 加载环境变量
// 确保 .env 文件在项目根目录，或者通过其他方式设置环境变量
// 使用 path.resolve 确保路径正确，特别是当此服务被不同深度的其他模块调用时
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

// 从环境变量中获取应用的主加密密钥
// 这个密钥用于加密和解密存储在文件或数据库中的敏感信息
const APP_SECRET_STRING = process.env.APP_SECRET_STRING;

// 校验 APP_SECRET_STRING 是否已设置且足够安全
if (!APP_SECRET_STRING) {
    console.error("CRITICAL ERROR (CryptoService): APP_SECRET_STRING environment variable is not set! Application cannot run securely.");
    // 在生产环境中，如果密钥未设置，应该阻止应用启动
    throw new Error("APP_SECRET_STRING is not defined in environment variables. This is a critical security risk.");
} else if (APP_SECRET_STRING.length < 32) { // 建议至少32字节 (256位) 的密钥长度以匹配 AES-256
    console.warn(`SECURITY WARNING (CryptoService): The configured APP_SECRET_STRING is less than 32 bytes long (${APP_SECRET_STRING.length} bytes). A longer, random string is strongly recommended for production to ensure AES-256 security.`);
}


// 使用 SHA-256 哈希从 APP_SECRET_STRING 生成固定长度的加密密钥 (256位/32字节)
// 这是因为 AES-256 需要一个32字节的密钥
const APP_ENCRYPTION_KEY = crypto.createHash('sha256').update(String(APP_SECRET_STRING)).digest();

const ALGORITHM = 'aes-256-cbc'; // 加密算法
const IV_LENGTH = 16; // AES 的初始化向量 (IV) 长度固定为16字节 (128位)

/**
 * Encrypts text using AES-256-CBC algorithm.
 * The output format is "iv_hex:encrypted_text_hex".
 * @param {string | number | null | undefined} textToEncrypt - The text or number to encrypt.
 * @returns {string} The encrypted hex string ("iv:encryptedText"), or the original input if it's null, undefined, or an empty string.
 * @throws {Error} If a critical encryption error occurs (currently logs error and returns original text).
 */
function encryptText(textToEncrypt) {
    if (textToEncrypt === null || typeof textToEncrypt === 'undefined') {
        return textToEncrypt; // Return null or undefined as is
    }
    const textString = String(textToEncrypt);
    if (textString.trim() === '') {
        return textString; // Return empty string as is
    }

    // Basic check to avoid re-encrypting already encrypted-like data
    if (textString.includes(':')) {
        const parts = textString.split(':');
        // Check if the first part looks like a hex-encoded IV of correct length
        if (parts.length === 2 && parts[0].length === IV_LENGTH * 2 && /^[0-9a-fA-F]+$/.test(parts[0])) {
            // console.warn(`[CryptoService] Data appears to be already encrypted, skipping encryption: ${textString.substring(0, 40)}...`);
            return textString;
        }
    }

    try {
        const iv = crypto.randomBytes(IV_LENGTH); // Generate a random Initialization Vector
        const cipher = crypto.createCipheriv(ALGORITHM, APP_ENCRYPTION_KEY, iv);
        let encrypted = cipher.update(textString, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return iv.toString('hex') + ':' + encrypted;
    } catch (error) {
        console.error('[CryptoService] Error during text encryption:', error.message, error.stack);
        // Depending on the security policy, you might want to throw the error
        // or return the original text to prevent application interruption,
        // but this could lead to unencrypted data being stored if not handled carefully.
        // For now, returning original text with a log.
        return textString;
    }
}

/**
 * Decrypts text that was encrypted using AES-256-CBC.
 * Expects the encrypted text in "iv_hex:encrypted_text_hex" format.
 * @param {string | null | undefined} encryptedTextWithIv - The encrypted text.
 * @returns {string} The decrypted text, or the original input if it's null, undefined, not in the expected format, or if decryption fails.
 * @throws {Error} If a critical decryption error occurs (currently logs error and returns original text).
 */
function decryptText(encryptedTextWithIv) {
    if (encryptedTextWithIv === null || typeof encryptedTextWithIv === 'undefined') {
        return encryptedTextWithIv;
    }
    const textString = String(encryptedTextWithIv);
    if (textString.trim() === '') {
        return textString;
    }

    if (!textString.includes(':')) {
        // console.warn(`[CryptoService] Decryption input format incorrect (missing ':'): ${textString.substring(0, 40)}... Returning original.`);
        return textString; // Not the expected format, likely not encrypted by this service
    }

    const parts = textString.split(':');
    if (parts.length !== 2 || parts[0].length !== IV_LENGTH * 2 || !/^[0-9a-fA-F]+$/.test(parts[0])) {
        // console.warn(`[CryptoService] Decryption input format incorrect (IV invalid): ${textString.substring(0, 40)}... Returning original.`);
        return textString; // IV format incorrect
    }

    try {
        const iv = Buffer.from(parts[0], 'hex');
        const encryptedText = Buffer.from(parts[1], 'hex');
        const decipher = crypto.createDecipheriv(ALGORITHM, APP_ENCRYPTION_KEY, iv);
        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (error) {
        // Common reasons for decryption failure: wrong key, corrupted data, or data was not actually encrypted with this key/method.
        // console.warn(`[CryptoService] Failed to decrypt text (key mismatch, data corruption, or not encrypted?): ${error.message} - Input: ${textString.substring(0,40)}... Returning original.`);
        // Returning original text on failure can be a security risk if the caller expects decrypted data.
        // Consider throwing an error or returning a specific marker for decryption failure.
        return textString;
    }
}

module.exports = {
    encryptText,
    decryptText,
    // Constants can be exported if needed by other modules for specific checks, though generally not recommended.
    // ALGORITHM,
    // IV_LENGTH,
};
