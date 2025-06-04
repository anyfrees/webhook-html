// server/routes/authRoutes.js

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const storageService = require('../services/storageService');
const authMiddleware = require('../middleware/authMiddleware'); 
const { body, validationResult, param } = require('express-validator');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'your_very_strong_jwt_secret_for_dev_only_in_authroutes_v3';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h'; 
const COOKIE_MAX_AGE = 1 * 60 * 60 * 1000; 

// 登录尝试限制和锁定配置
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATIONS_MINUTES = [10, 30, 60, 1440]; // 对应 lockoutLevel 1, 2, 3, 4+

if (JWT_SECRET === 'your_very_strong_jwt_secret_for_dev_only_in_authroutes_v3' && process.env.NODE_ENV !== 'test') {
    console.warn("警告 (authRoutes.js): JWT_SECRET 未在环境变量中安全设置! 请使用一个强随机字符串。");
}

function isAdmin(req, res, next) {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ message: '权限不足: 此操作需要管理员权限。', error: 'Forbidden' });
    }
}

router.post('/login', [
    body('username').trim().notEmpty().withMessage('用户名不能为空。').escape(),
    body('password').notEmpty().withMessage('密码不能为空。')
], async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ message: '输入验证失败。', errors: errors.array() });
    }
    try {
        const { username, password: plainPassword } = req.body;
        // 获取用户时，需要包含所有字段，包括密码和登录尝试信息
        const userWithSensitiveData = await storageService.findUserByUsername(username, true);

        if (!userWithSensitiveData) {
            return res.status(401).json({ message: '认证失败：用户名或密码无效。' });
        }

        // 检查账户是否被锁定
        if (userWithSensitiveData.lockoutUntil) {
            const lockoutEndDate = new Date(userWithSensitiveData.lockoutUntil);
            const now = new Date();
            if (lockoutEndDate > now) {
                const minutesRemaining = Math.ceil((lockoutEndDate.getTime() - now.getTime()) / (1000 * 60));
                return res.status(403).json({ 
                    message: `您的账户已被锁定。请在约 ${minutesRemaining} 分钟后重试。 (解锁时间: ${lockoutEndDate.toLocaleString('zh-CN')})`,
                    error: 'AccountLocked', // 特殊错误类型，供前端识别
                    lockoutUntil: userWithSensitiveData.lockoutUntil
                });
            } else {
                // 锁定时间已过，理论上应该自动解锁 (通过清除 lockoutUntil)
                // 但为保险起见，如果到这里 lockoutUntil 仍然存在但已过期，登录成功后会清除它
            }
        }

        const isMatch = await bcrypt.compare(plainPassword, userWithSensitiveData.password);
        
        if (!isMatch) {
            let failedAttempts = (userWithSensitiveData.failedLoginAttempts || 0) + 1;
            let lockoutUntil = userWithSensitiveData.lockoutUntil;
            let lockoutLevel = userWithSensitiveData.lockoutLevel || 0;
            let message = '认证失败：用户名或密码无效。';

            if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
                lockoutLevel++;
                const durationIndex = Math.min(lockoutLevel - 1, LOCKOUT_DURATIONS_MINUTES.length - 1);
                const lockoutDuration = LOCKOUT_DURATIONS_MINUTES[durationIndex];
                lockoutUntil = new Date(Date.now() + lockoutDuration * 60 * 1000).toISOString();
                failedAttempts = 0; // 锁定后重置尝试次数
                
                message = `密码错误次数过多，您的账户已被锁定 ${lockoutDuration} 分钟。请于 ${new Date(lockoutUntil).toLocaleString('zh-CN')} 后再试。`;
                console.log(`[AuthRoutes] 用户 ${username} 因登录失败次数过多而被锁定，级别 ${lockoutLevel}, 直至 ${lockoutUntil}`);
            }

            await storageService.updateUser(userWithSensitiveData.id, {
                failedLoginAttempts: failedAttempts,
                lockoutUntil: lockoutUntil,
                lockoutLevel: lockoutLevel
            });
            return res.status(401).json({ message: message, error: lockoutUntil ? 'AccountLocked' : 'InvalidCredentials', lockoutUntil: lockoutUntil });
        }

        // 登录成功，重置失败尝试和锁定状态
        const updatesForSuccessfulLogin = {
            failedLoginAttempts: 0,
            lockoutUntil: null,
            lockoutLevel: 0
        };
        // 只有当这些字段实际发生变化时才更新，以减少不必要的写操作
        let needsUpdate = false;
        if (userWithSensitiveData.failedLoginAttempts > 0 || userWithSensitiveData.lockoutUntil || userWithSensitiveData.lockoutLevel > 0) {
            needsUpdate = true;
        }
        if(userWithSensitiveData.mustChangePassword === undefined) { // 确保旧数据兼容
             updatesForSuccessfulLogin.mustChangePassword = false; // 登录成功且之前没有此字段，视为不需要改密
             needsUpdate = true;
        }

        if (needsUpdate) {
            await storageService.updateUser(userWithSensitiveData.id, updatesForSuccessfulLogin);
        }


        const payload = {
            userId: userWithSensitiveData.id,
            username: userWithSensitiveData.username,
            role: userWithSensitiveData.role || 'user',
            mustChangePassword: !!userWithSensitiveData.mustChangePassword 
        };

        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax', 
            maxAge: COOKIE_MAX_AGE
        });

        res.json({
            message: '登录成功。',
            user: { // 返回给前端的用户信息，不应包含密码或锁定详情
                id: userWithSensitiveData.id,
                username: userWithSensitiveData.username,
                role: userWithSensitiveData.role || 'user',
                mustChangePassword: !!userWithSensitiveData.mustChangePassword
            }
        });

    } catch (error) {
        console.error("登录过程中发生错误:", error);
        next(error);
    }
});

const validateChangePasswordInput = [
    body('currentPassword').optional({ checkFalsy: true }).isString().withMessage('当前密码必须是字符串。'),
    body('newPassword').notEmpty().withMessage('新密码不能为空。').isLength({ min: 6 }).withMessage('新密码长度至少为6个字符。'),
    body('confirmNewPassword').custom((value, { req }) => {
        if (value !== req.body.newPassword) {
            throw new Error('确认新密码与新密码不匹配。');
        }
        return true;
    })
];

router.post('/change-password', authMiddleware, validateChangePasswordInput, async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ message: '输入验证失败。', errors: errors.array() });
    }

    try {
        const { currentPassword, newPassword } = req.body;
        const userId = req.user.userId; 

        const userWithPassword = await storageService.findUserById(userId, true); // 获取完整用户数据
        if (!userWithPassword) {
            return res.status(404).json({ message: '未找到用户。' });
        }

        if (!userWithPassword.mustChangePassword) {
            if (!currentPassword) {
                return res.status(400).json({ message: '请输入当前密码以进行修改。', errors: [{ field: 'currentPassword', message: '请输入当前密码。' }] });
            }
            const isMatch = await bcrypt.compare(currentPassword, userWithPassword.password);
            if (!isMatch) {
                return res.status(401).json({ message: '当前密码不正确。', errors: [{ field: 'currentPassword', message: '当前密码不正确。' }] });
            }
        } else {
            if (userWithPassword.username === 'admin' && currentPassword) { 
                 const isDefaultAdminPasswordMatch = await bcrypt.compare('admin', userWithPassword.password);
                 let providedCurrentPasswordIsCorrect = false;
                 if (currentPassword === 'admin' && isDefaultAdminPasswordMatch) {
                    providedCurrentPasswordIsCorrect = true;
                 } else if (!isDefaultAdminPasswordMatch) {
                    providedCurrentPasswordIsCorrect = await bcrypt.compare(currentPassword, userWithPassword.password);
                 }

                if (!providedCurrentPasswordIsCorrect) {
                    return res.status(401).json({ message: '当前密码不正确。', errors: [{ field: 'currentPassword', message: '当前密码不正确 (首次修改时)。' }] });
                }
            } else if (userWithPassword.username !== 'admin' && currentPassword) { 
                const isMatch = await bcrypt.compare(currentPassword, userWithPassword.password);
                if (!isMatch) {
                    return res.status(401).json({ message: '当前密码不正确。', errors: [{ field: 'currentPassword', message: '当前密码不正确。' }]});
                }
            }
        }


        const isNewPasswordSameAsOld = await bcrypt.compare(newPassword, userWithPassword.password);
        if (isNewPasswordSameAsOld) {
            return res.status(400).json({ message: '新密码不能与旧密码相同。', errors: [{ field: 'newPassword', message: '新密码不能与旧密码相同。' }] });
        }

        const hashedNewPassword = await bcrypt.hash(newPassword, 10);
        const updates = {
            password: hashedNewPassword,
            mustChangePassword: false, 
            // 新增：修改密码成功后，自动解锁账户并重置尝试次数
            failedLoginAttempts: 0,
            lockoutUntil: null,
            lockoutLevel: 0
        };

        await storageService.updateUser(userId, updates);

        res.cookie('token', '', { httpOnly: true, expires: new Date(0), sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
        res.json({ message: '密码修改成功，请重新登录。' });

    } catch (error) {
        console.error("修改密码过程中发生错误:", error);
        next(error);
    }
});


router.post('/admin/change-user-password/:userId', authMiddleware, isAdmin, [
    param('userId').isUUID().withMessage('用户ID格式无效。'),
    body('newPassword').notEmpty().withMessage('新密码不能为空。').isLength({ min: 6 }).withMessage('新密码长度至少为6个字符。')
], async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ message: '输入验证失败。', errors: errors.array() });
    }

    try {
        const targetUserId = req.params.userId;
        const { newPassword } = req.body;
        const adminUsername = req.user.username; 

        const targetUser = await storageService.findUserById(targetUserId, true); 
        if (!targetUser) {
            return res.status(404).json({ message: '目标用户未找到。' });
        }

        if (targetUser.id === req.user.userId) {
            return res.status(400).json({ message: '管理员请使用常规的修改密码功能修改自己的密码。' });
        }

        const isNewPasswordSameAsOld = await bcrypt.compare(newPassword, targetUser.password);
        if (isNewPasswordSameAsOld) {
            return res.status(400).json({ message: '新密码不能与该用户当前的密码相同。', errors: [{ field: 'newPassword', message: '新密码不能与用户旧密码相同。' }] });
        }

        const hashedNewPassword = await bcrypt.hash(newPassword, 10);
        const updates = {
            password: hashedNewPassword,
            mustChangePassword: true, 
            // 新增：管理员修改密码后，自动解锁账户并重置尝试次数
            failedLoginAttempts: 0,
            lockoutUntil: null,
            lockoutLevel: 0
        };

        await storageService.updateUser(targetUserId, updates);
        console.log(`[AuthRoutes] 管理员 '${adminUsername}' (ID: ${req.user.userId}) 修改了用户 '${targetUser.username}' (ID: ${targetUserId}) 的密码并解锁了账户。用户下次登录时需再次修改。`);
        res.json({ message: `用户 ${targetUser.username} 的密码已修改，账户已解锁。该用户在下次登录时将被要求设置新密码。` });

    } catch (error) {
        console.error(`管理员修改用户密码过程中发生错误 (用户ID: ${req.params.userId}):`, error);
        next(error);
    }
});


router.post('/logout', (req, res) => {
    res.cookie('token', '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        expires: new Date(0) 
    });
    res.status(200).json({ message: '登出成功。' });
});

router.get('/me', authMiddleware, (req, res) => {
    if (req.user) {
        const { userId, username, role, mustChangePassword } = req.user;
        res.json({
            id: userId,
            username: username,
            role: role || 'user', 
            mustChangePassword: !!mustChangePassword
        });
    } else {
        res.status(401).json({ message: '未授权，无法获取用户信息。' });
    }
});

module.exports = router;