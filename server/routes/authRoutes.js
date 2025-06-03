// server/routes/authRoutes.js

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const storageService = require('../services/storageService');
const authMiddleware = require('../middleware/authMiddleware');

const { body, validationResult } = require('express-validator');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'your_very_strong_jwt_secret_for_dev_only_in_authroutes_v3';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';
const COOKIE_MAX_AGE = 1 * 60 * 60 * 1000;

if (JWT_SECRET === 'your_very_strong_jwt_secret_for_dev_only_in_authroutes_v3' && process.env.NODE_ENV !== 'test') {
    console.warn("警告 (authRoutes.js): JWT_SECRET 未在环境变量中安全设置! 请使用一个强随机字符串。");
}

// --- 注册路由 ---
router.post('/register', [
    body('username').trim().notEmpty().withMessage('用户名不能为空。').isLength({ min: 3 }).withMessage('用户名长度至少为3个字符。').escape(),
    body('password').notEmpty().withMessage('密码不能为空。').isLength({ min: 6 }).withMessage('密码长度至少为6个字符。')
], async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ message: '输入验证失败。', errors: errors.array() });
    }
    try {
        const { username, password } = req.body;
        const existingUser = await storageService.findUserByUsername(username); // findUserByUsername now returns user without password
        if (existingUser) {
            return res.status(409).json({ message: '用户名已存在' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUserInput = { // Data to pass to createUser
            username,
            password: hashedPassword,
            // role will be 'user' by default in storageService.createUser
            // mustChangePassword will be false by default in storageService.createUser
        };
        const createdUser = await storageService.createUser(newUserInput); // createUser returns user without password
        res.status(201).json({
            message: '用户注册成功',
            user: { id: createdUser.id, username: createdUser.username, role: createdUser.role }
        });
    } catch (error) {
        console.error("注册过程中发生错误:", error);
        next(error);
    }
});

// --- 登录路由 ---
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
        // findUserById/findUserByUsername in storageService should return the full user object for password comparison
        const userWithPassword = await storageService.findUserById(
            (await storageService.findUserByUsername(username))?.id, // Get ID first
            true // Request to include password hash
        );

        if (!userWithPassword) {
            return res.status(401).json({ message: '认证失败：用户名或密码无效' });
        }

        const isMatch = await bcrypt.compare(plainPassword, userWithPassword.password);
        if (!isMatch) {
            return res.status(401).json({ message: '认证失败：用户名或密码无效' });
        }

        const payload = {
            userId: userWithPassword.id,
            username: userWithPassword.username,
            role: userWithPassword.role || 'user', // Ensure role is in JWT
            mustChangePassword: !!userWithPassword.mustChangePassword
        };

        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: COOKIE_MAX_AGE
        });

        res.json({
            message: '登录成功',
            user: {
                id: userWithPassword.id,
                username: userWithPassword.username,
                role: userWithPassword.role || 'user',
                mustChangePassword: !!userWithPassword.mustChangePassword
            }
        });

    } catch (error) {
        console.error("登录过程中发生错误:", error);
        next(error);
    }
});

// --- 修改密码路由 ---
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

        const userWithPassword = await storageService.findUserById(userId, true); // Get user with password
        if (!userWithPassword) {
            return res.status(404).json({ message: '未找到用户。' });
        }

        if (!userWithPassword.mustChangePassword) {
            if (!currentPassword) {
                return res.status(400).json({ message: '请输入当前密码以进行修改。' });
            }
            const isMatch = await bcrypt.compare(currentPassword, userWithPassword.password);
            if (!isMatch) {
                return res.status(401).json({ message: '当前密码不正确。' });
            }
        } else {
            if (currentPassword && userWithPassword.username === 'admin') {
                 const isDefaultAdminPasswordMatch = await bcrypt.compare('admin', userWithPassword.password);
                 if (!isDefaultAdminPasswordMatch && currentPassword !== 'admin') {
                    const isCurrentPasswordMatch = await bcrypt.compare(currentPassword, userWithPassword.password);
                    if(!isCurrentPasswordMatch) {
                        return res.status(401).json({ message: '当前密码不正确 (首次修改)。' });
                    }
                 }
            } else if (currentPassword && userWithPassword.username !== 'admin') { // Non-admin forced change, still verify current if provided
                const isMatch = await bcrypt.compare(currentPassword, userWithPassword.password);
                if (!isMatch) {
                    return res.status(401).json({ message: '当前密码不正确。' });
                }
            }
        }

        const isNewPasswordSameAsOld = await bcrypt.compare(newPassword, userWithPassword.password);
        if (isNewPasswordSameAsOld) {
            return res.status(400).json({ message: '新密码不能与旧密码相同。' });
        }

        const hashedNewPassword = await bcrypt.hash(newPassword, 10);
        const updates = {
            password: hashedNewPassword,
            mustChangePassword: false,
        };

        await storageService.updateUser(userId, updates);
        res.clearCookie('token');
        res.json({ message: '密码修改成功，请重新登录。' });

    } catch (error) {
        console.error("修改密码过程中发生错误:", error);
        next(error);
    }
});

// --- 登出路由 ---
router.post('/logout', (req, res) => {
    res.cookie('token', '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        expires: new Date(0)
    });
    res.status(200).json({ message: '登出成功' });
});

// --- 获取当前登录用户信息路由 ---
router.get('/me', authMiddleware, (req, res) => {
    if (req.user) {
        // req.user is from JWT payload, which now includes role
        const { userId, username, role, mustChangePassword } = req.user;
        res.json({
            id: userId,
            username: username,
            role: role || 'user', // Default to 'user' if somehow missing
            mustChangePassword: !!mustChangePassword
        });
    } else {
        // This case should ideally be caught by authMiddleware itself
        res.status(401).json({ message: '未授权，无法获取用户信息' });
    }
});

module.exports = router;
