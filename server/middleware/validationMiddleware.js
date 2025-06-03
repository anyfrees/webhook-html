// server/middleware/validationMiddleware.js

const { body, validationResult } = require('express-validator');

/**
 * Middleware to validate user registration input.
 * Checks for username, email (optional, example), and password.
 */
const validateRegisterInput = [
    // Username validation: not empty, min length
    body('username')
        .trim()
        .notEmpty().withMessage('用户名不能为空。')
        .isLength({ min: 3 }).withMessage('用户名长度至少为3个字符。')
        .escape(), // Sanitize to prevent XSS

    // Email validation (example, if you decide to add email)
    // body('email')
    //     .optional({ checkFalsy: true }) // Allow empty or null
    //     .isEmail().withMessage('请输入有效的电子邮件地址。')
    //     .normalizeEmail(), // Sanitize email

    // Password validation: not empty, min length
    body('password')
        .notEmpty().withMessage('密码不能为空。')
        .isLength({ min: 6 }).withMessage('密码长度至少为6个字符。'),
        // You might want to add more password complexity rules here
        // .matches(/\d/).withMessage('密码必须包含一个数字')
        // .matches(/[a-zA-Z]/).withMessage('密码必须包含一个字母'),

    // Middleware to handle validation results
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            // If there are validation errors, return a 400 response with the errors
            return res.status(400).json({
                message: '输入验证失败。',
                errors: errors.array().map(err => ({
                    field: err.param || err.path, // param is for older versions, path for newer
                    message: err.msg,
                    value: err.value
                }))
            });
        }
        // If validation passes, proceed to the next middleware or route handler
        next();
    }
];

/**
 * Middleware to validate user login input.
 * Checks for username and password.
 */
const validateLoginInput = [
    body('username')
        .trim()
        .notEmpty().withMessage('用户名不能为空。')
        .escape(),

    body('password')
        .notEmpty().withMessage('密码不能为空。'),

    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                message: '输入验证失败。',
                errors: errors.array().map(err => ({
                    field: err.param || err.path,
                    message: err.msg,
                    value: err.value
                }))
            });
        }
        next();
    }
];

/**
 * Middleware to validate webhook configuration input.
 * This is a placeholder and needs to be customized based on your webhook object structure.
 */
const validateWebhookConfigInput = [
    body().isArray().withMessage('Webhook 配置必须是一个数组。'), // Assuming the top level is an array of webhooks
    body('*.id').optional().isUUID().withMessage('Webhook ID 必须是有效的 UUID (如果提供)。'), // For existing webhooks
    body('*.name').trim().notEmpty().withMessage('Webhook 名称不能为空。').escape(),
    body('*.templateId').isUUID().withMessage('必须选择一个有效的地址模板 ID。'),
    // Add more specific validations for other fields like 'phone', 'plainBody', 'headers'
    // Example for headers:
    body('*.headers').optional().isArray().withMessage('请求头必须是一个数组 (如果提供)。'),
    body('*.headers.*.key').if(body('*.headers').exists()).notEmpty().withMessage('请求头 Key 不能为空。').trim().escape(),
    body('*.headers.*.value').if(body('*.headers').exists()).trim().escape(), // Value can be empty

    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                message: 'Webhook 配置验证失败。',
                errors: errors.array().map(err => ({
                    field: err.param || err.path,
                    message: err.msg,
                    value: err.value
                }))
            });
        }
        next();
    }
];

/**
 * Middleware to validate template input.
 * Customize based on your template object structure.
 */
const validateTemplateInput = [
    body().isArray().withMessage('模板数据必须是一个数组。'),
    body('*.id').optional().isUUID().withMessage('模板 ID 必须是有效的 UUID (如果提供)。'),
    body('*.name').trim().notEmpty().withMessage('模板名称不能为空。').escape(),
    body('*.type').isIn(['generic', 'workweixin']).withMessage('模板类型无效，必须是 "generic" 或 "workweixin"。'),

    // Generic template fields
    body('*.url')
        .if(body('*.type').equals('generic'))
        .trim()
        .notEmpty().withMessage('通用模板的 URL 不能为空。')
        .isURL({ protocols: ['http', 'https'], require_protocol: true, require_tld: false }) // Allow localhost without TLD
        .withMessage('请输入有效的 URL (例如 http://example.com)。'),
    body('*.method')
        .if(body('*.type').equals('generic'))
        .isIn(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).withMessage('无效的 HTTP 方法。'),
    body('*.bodyTemplate').optional({ checkFalsy: true }).isString().withMessage('请求体模板必须是字符串。'), // No .escape() for bodyTemplate as it can be JSON

    // WorkWeixin specific fields
    body('*.workweixin_corpid')
        .if(body('*.type').equals('workweixin'))
        .trim().notEmpty().withMessage('企业微信模板的 CorpID 不能为空。').escape(),
    body('*.workweixin_agentid')
        .if(body('*.type').equals('workweixin'))
        .trim().notEmpty().withMessage('企业微信模板的 AgentID 不能为空。').escape(),
    // corpsecret is handled separately due to its sensitivity and encryption
    body('*.workweixin_msgtype')
        .if(body('*.type').equals('workweixin'))
        .isIn(['text', 'markdown']).withMessage('企业微信消息类型无效。'),

    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                message: '模板数据验证失败。',
                errors: errors.array().map(err => ({
                    field: err.param || err.path,
                    message: err.msg,
                    value: err.value
                }))
            });
        }
        next();
    }
];


/**
 * Middleware to validate task creation input.
 */
const validateTaskInput = [
    body('originalWebhookId')
        .notEmpty().withMessage('原始 Webhook 配置 ID 不能为空。')
        .isUUID().withMessage('原始 Webhook 配置 ID 必须是有效的 UUID。'),
    body('scheduledTime')
        .notEmpty().withMessage('计划发送时间不能为空。')
        .isISO8601().withMessage('计划发送时间必须是有效的 ISO8601 日期时间字符串。')
        .custom((value) => {
            if (new Date(value) <= new Date()) {
                throw new Error('计划发送时间必须是将来的时间。');
            }
            return true;
        }),
    body('webhookSnapshot').isObject().withMessage('Webhook 快照不能为空且必须是一个对象。'),
    body('webhookSnapshot.name').notEmpty().withMessage('Webhook 快照中的名称不能为空。').escape(),
    // Add more specific validations for webhookSnapshot content if necessary
    body('templateType').isIn(['generic', 'workweixin']).withMessage('任务的模板类型无效。'),

    // Conditional validation for workweixinConfig if templateType is 'workweixin'
    body('workweixinConfig')
        .if(body('templateType').equals('workweixin'))
        .isObject().withMessage('企业微信配置不能为空 (当模板类型为 workweixin 时)。'),
    body('workweixinConfig.corpid')
        .if(body('templateType').equals('workweixin'))
        .notEmpty().withMessage('企业微信配置中的 CorpID 不能为空。').escape(),
    body('workweixinConfig.agentid')
        .if(body('templateType').equals('workweixin'))
        .notEmpty().withMessage('企业微信配置中的 AgentID 不能为空。').escape(),
    // corpsecret for tasks is typically derived from the template at creation time and stored encrypted.
    // It's not usually sent from the client when creating a task, or if it is, it's for lookup.

    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                message: '定时任务数据验证失败。',
                errors: errors.array().map(err => ({
                    field: err.param || err.path,
                    message: err.msg,
                    value: err.value
                }))
            });
        }
        next();
    }
];


module.exports = {
    validateRegisterInput,
    validateLoginInput,
    validateWebhookConfigInput,
    validateTemplateInput,
    validateTaskInput,
    // Export other validation middlewares as you create them
};
