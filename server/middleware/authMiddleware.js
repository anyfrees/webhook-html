// server/middleware/authMiddleware.js

const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const path = require('path');
// 不需要 storageService 来获取角色，角色信息应该在 JWT payload 中

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET && process.env.NODE_ENV !== 'test') {
    console.error("CRITICAL ERROR (AuthMiddleware): JWT_SECRET environment variable is not set! Authentication will not work.");
}

function authMiddleware(req, res, next) {
    const token = req.cookies.token;

    if (!token) {
        return res.status(401).json({
            message: '未授权: 访问被拒绝，请先登录。',
            error: 'NoTokenProvided',
            action: 'login_required'
        });
    }

    if (!JWT_SECRET) {
        console.error("[AuthMiddleware] CRITICAL: JWT_SECRET is not configured. Cannot verify token.");
        return res.status(500).json({
            message: '服务器配置错误: 无法验证用户身份。',
            error: 'ServerConfigurationError'
        });
    }

    try {
        const decodedPayload = jwt.verify(token, JWT_SECRET);
        // decodedPayload 应该包含 userId, username, role, mustChangePassword
        req.user = decodedPayload;

        if (req.user.mustChangePassword === true) {
            const allowedPathSuffixes = ['/api/auth/change-password', '/api/auth/logout'];
            const isPathAllowed = allowedPathSuffixes.some(suffix => req.originalUrl.endsWith(suffix));
            const relativeAllowedPaths = ['/change-password', '/logout']; // For routes within authRoutes itself
            const isRelativePathAllowed = relativeAllowedPaths.includes(req.path);

            if (!isPathAllowed && !isRelativePathAllowed) {
                console.warn(`[AuthMiddleware] 用户 ${req.user.username} (ID: ${req.user.userId}) 尝试访问 ${req.originalUrl} (req.path: ${req.path}) 但需要强制修改密码。`);
                return res.status(403).json({
                    message: '访问受限: 您必须先修改您的初始密码。',
                    error: 'PasswordChangeRequired',
                    action: 'change_password_required'
                });
            }
        }

        next();
    } catch (error) {
        console.error('[AuthMiddleware] Token 验证失败:', error.name, '-', error.message);
        let clientError = {
            message: '未授权: 无效的凭证。',
            error: 'InvalidToken',
            action: 'login_required'
        };
        if (error.name === 'TokenExpiredError') {
            clientError.message = '未授权: 会话已过期，请重新登录。';
            clientError.error = 'TokenExpired';
        } else if (error.name === 'JsonWebTokenError') {
            clientError.message = '未授权: 提供的凭证无效或已损坏。';
        } else {
            clientError.message = '服务器内部错误: 验证用户身份时发生问题。';
            clientError.error = 'TokenVerificationFailed';
            res.clearCookie('token');
            return res.status(500).json(clientError);
        }
        res.clearCookie('token');
        return res.status(401).json(clientError);
    }
}

module.exports = authMiddleware;
