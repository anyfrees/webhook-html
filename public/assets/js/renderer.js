// public/assets/js/renderer.js

// --- 全局状态变量 ---
let webhooks = [];
let webhookUrlTemplates = [];
let history = {};
let scheduledTasks = [];
let currentUser = null; // { id, username, role, mustChangePassword }

let currentView = 'sender'; // 'sender' or 'templates' or 'user-management'
let selectedWebhookId = null;
let selectedTemplateId = null;
let isSending = false;
let currentActiveTab = 'body'; // 'body', 'headers', 'schedule', 'history'
let usersList = []; // For admin user management

// --- DOM 元素引用 ---
const userInfoSpan = document.getElementById('userInfo');
const logoutButton = document.getElementById('logoutButton');
const aboutButton = document.getElementById('aboutButton');

const navSenderViewBtn = document.getElementById('nav-sender-view');
const navTemplateViewBtn = document.getElementById('nav-template-view');
const navUserManagementBtn = document.getElementById('nav-user-management-view');

const sidebarContentSender = document.getElementById('sidebar-content-sender');
const sidebarContentTemplates = document.getElementById('sidebar-content-templates');
const sidebarContentUserManagement = document.getElementById('sidebar-content-user-management');


const senderView = document.getElementById('sender-view');
const templateManagerView = document.getElementById('template-manager-view');
const aboutView = document.getElementById('about-view');
const welcomeScreen = document.getElementById('welcome-screen');
const welcomeTitle = document.getElementById('welcome-title');
const welcomeMessage = document.getElementById('welcome-message');
const userManagementView = document.getElementById('user-management-view');
const userListContainer = document.getElementById('user-list-container');
const showAddUserFormBtnMain = document.getElementById('show-add-user-form-btn-main');
const addUserForm = document.getElementById('add-user-form');
const cancelAddUserBtn = document.getElementById('cancel-add-user-btn');
const newUsernameInput = document.getElementById('new-username');
const newPasswordInput = document.getElementById('new-password');
const newUserRoleSelect = document.getElementById('new-user-role');
const refreshUserListBtn = document.getElementById('refreshUserListBtn');


const webhookListEl = document.getElementById('webhook-list');
const newWebhookBtn = document.getElementById('new-webhook-btn');
const webhookEditorEl = document.getElementById('webhook-editor');
const webhookNameInput = document.getElementById('webhook-name');
const sendNowBtn = document.getElementById('send-now-btn');
const templateSelect = document.getElementById('template-select');
const selectedTemplateUrlContainer = document.getElementById('selected-template-url-container');
const phoneNumberInput = document.getElementById('phone-number-input');
const phoneNumberSection = document.getElementById('phone-number-section');
const recipientLabel = document.getElementById('recipient-label');

const editorTabs = document.querySelectorAll('.editor-tab');
const tabContentBody = document.getElementById('tab-content-body');
const webhookBodyTextarea = document.getElementById('webhook-body');
const tabContentHeaders = document.getElementById('tab-content-headers');
const headersListEl = document.getElementById('headers-list');
const addHeaderBtn = document.getElementById('add-header-btn');
const tabContentSchedule = document.getElementById('tab-content-schedule');
const scheduleDatetimeInput = document.getElementById('schedule-datetime');
const saveTaskBtn = document.getElementById('save-task-btn');
const scheduledTaskListEl = document.getElementById('scheduled-task-list');
const tabContentHistory = document.getElementById('tab-content-history');
const historyLogListEl = document.getElementById('history-log-list');

const templateListEl = document.getElementById('template-list');
const newTemplateBtn = document.getElementById('new-template-btn');
const templateEditorEl = document.getElementById('template-editor');
const templateNameInput = document.getElementById('template-name-input');
const saveTemplateBtn = document.getElementById('save-template-btn');
const templateTypeSelect = document.getElementById('template-type-select');
const workweixinFieldsContainer = document.getElementById('workweixin-fields-container');
const workweixinCorpidInput = document.getElementById('workweixin-corpid-input');
const workweixinCorpsecretInput = document.getElementById('workweixin-corpsecret-input');
const workweixinAgentidInput = document.getElementById('workweixin-agentid-input');
const workweixinMsgtypeSelect = document.getElementById('workweixin-msgtype-select');
const templateBodyLabel = document.getElementById('template-body-label');
const templateUrlContainer = document.getElementById('template-url-container');
const templateMethodSelect = document.getElementById('template-method-select');
const templateUrlInput = document.getElementById('template-url-input');
const templateHeadersListEl = document.getElementById('template-headers-list');
const addTemplateHeaderBtnInTemplates = document.querySelector('#template-editor button#add-template-header-btn');
const templateBodyInput = document.getElementById('template-body-input');

const closeAboutViewBtn = document.getElementById('close-about-view-btn');
const refreshScheduledTasksBtn = document.getElementById('refreshScheduledTasksBtn');


const eyeIconSVG = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>`;
const eyeSlashIconSVG = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>`;

// --- API 辅助函数 ---
async function apiRequest(url, options = {}) {
    console.log(`[apiRequest] 请求URL: ${url}, 方法: ${options.method || 'GET'}`);
    const defaultHeaders = {};
    if (!(options.body instanceof FormData)) {
        defaultHeaders['Content-Type'] = 'application/json';
    }
    options.headers = { ...defaultHeaders, ...options.headers };
    options.credentials = 'include';

    try {
        const response = await fetch(url, options);
        let responseData;
        const contentType = response.headers.get("content-type");

        if (response.status === 401) {
            console.warn(`[apiRequest] 401 未授权，URL: ${url}. 重定向到登录页.`);
            currentUser = null;
            if (userInfoSpan) userInfoSpan.textContent = '';
            sessionStorage.setItem('redirectTo', window.location.pathname + window.location.search);
            window.location.href = '/login.html?reason=session_expired';
            throw new Error('会话已过期或未授权，请重新登录。');
        }

        if (response.ok && contentType && contentType.includes("application/octet-stream")) {
            console.log(`[apiRequest] 文件下载响应，URL: ${url}.`);
            return response;
        }

        let bodyText = '';
        try {
            bodyText = await response.text();
            if (contentType && contentType.includes("application/json")) {
                responseData = JSON.parse(bodyText);
            } else {
                responseData = { message: bodyText || `服务器返回状态 ${response.status} 但响应体为空。` };
            }
        } catch (e) {
            console.error("[apiRequest] 解析响应体时出错:", e, "原始文本:", bodyText, "响应状态:", response.status);
            if (!response.ok) {
                const error = new Error(`HTTP 错误 ${response.status}: ${response.statusText || '无法解析错误响应体'}`);
                error.status = response.status;
                error.data = { message: bodyText || `服务器返回状态 ${response.status} 但响应体解析失败。` };
                throw error;
            }
            responseData = { success: response.ok, message: response.ok ? "服务器响应成功但内容格式错误。" : `服务器响应格式错误: ${response.status}` };
        }


        if (!response.ok) {
            const errorMessage = responseData?.message || responseData?.error?.message || `请求失败，状态码: ${response.status}`;
            console.error(`[apiRequest] API错误，URL ${url}:`, errorMessage, "响应数据:", responseData);

            if (response.status === 403 && responseData && responseData.error === 'PasswordChangeRequired') {
                console.warn('[apiRequest] 需要修改密码，重定向到修改密码页面。');
                sessionStorage.setItem('forcePasswordChange', 'true');
                window.location.href = '/change-password.html';
                throw new Error(responseData.message || '需要修改密码。');
            }

            const error = new Error(errorMessage);
            error.data = responseData;
            error.status = response.status;
            throw error;
        }
        console.log(`[apiRequest] 成功，URL: ${url}. 响应数据:`, responseData);
        return responseData;
    } catch (error) {
        console.error(`[apiRequest] CATCH块，URL: ${url}. 错误:`, error, "选项:", options);
        if (error.message.includes('会话已过期') || error.message.includes('需要修改密码')) {
            // Redirection already handled or will be handled by caller
        } else {
             const displayError = new Error(error.data?.message || error.message || '请求时发生未知网络或客户端错误。');
             displayError.data = error.data;
             displayError.status = error.status;
             throw displayError;
        }
        throw error;
    }
}

// --- 工具函数 ---
function formatDate(isoString) {
    if (!isoString) return 'N/A';
    try {
        return new Date(isoString).toLocaleString('zh-CN', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (e) {
        console.warn(`[formatDate] 无效的日期字符串: ${isoString}`);
        return '日期无效';
    }
}
function getDisplayableUrl(url, isWorkWeixin = false) {
    if (isWorkWeixin) {
        return { text: "企业微信接口 (自动处理)", title: "企业微信接口 (自动处理)" };
    }
    if (!url || typeof url !== 'string' || url.trim() === '') return { text: 'URL未设置', title: 'URL未设置' };
    try {
        if (url.includes("/... (已保存)") || url.includes("... (格式可能无效)")) {
             return { text: url, title: url };
        }
        const urlObj = new URL(url);
        if (urlObj.search || urlObj.pathname.length > 15 || url.length > 60) {
            const masked = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname.substring(0,15)}... (已保存)`;
            return { text: masked, title: url };
        }
        return { text: url, title: url };
    } catch (e) {
        const attemptHttp = !url.startsWith('http://') && !url.startsWith('https://') ? `http://${url}` : null;
        if (attemptHttp) {
            try {
                const urlObj = new URL(attemptHttp);
                 if (urlObj.search || urlObj.pathname.length > 15 || url.length > 60) {
                    const masked = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname.substring(0,15)}... (格式可能无效)`;
                    return { text: masked, title: url };
                }
                return { text: url, title: url };
            } catch (e2) { /* fallback */ }
        }
        if (url.length > 60) {
            const masked = url.substring(0, 30) + '... (格式可能无效)';
            return { text: masked, title: url };
        }
        return { text: url, title: url };
    }
}

// --- 自定义对话框管理 ---
const dialogOverlay = document.getElementById('custom-dialog-overlay');
const dialogTitleEl = document.getElementById('dialog-title');
const dialogMessageEl = document.getElementById('dialog-message');
const dialogButtonsEl = document.getElementById('dialog-buttons');
function showDialog(title, message, buttons) {
    return new Promise(resolve => {
        if (!dialogOverlay || !dialogTitleEl || !dialogMessageEl || !dialogButtonsEl) {
            console.error("对话框元素未在DOM中找到。");
            resolve(window.confirm(`${title}\n\n${message}`));
            return;
        }
        dialogTitleEl.textContent = title;
        dialogMessageEl.textContent = message;
        dialogButtonsEl.innerHTML = '';
        buttons.forEach(btnInfo => {
            const button = document.createElement('button');
            button.textContent = btnInfo.text;
            button.className = `px-4 py-2 rounded text-sm font-semibold text-white focus:outline-none shadow-md hover:shadow-lg transition-shadow ${btnInfo.class}`;
            button.onclick = () => {
                dialogOverlay.classList.add('hidden');
                dialogOverlay.classList.remove('flex');
                resolve(btnInfo.value);
            };
            dialogButtonsEl.appendChild(button);
        });
        dialogOverlay.classList.remove('hidden');
        dialogOverlay.classList.add('flex');
    });
}
function customConfirm(message, title = '请确认') {
    const buttons = [
        { text: '取消', value: false, class: 'bg-gray-600 hover:bg-gray-700' },
        { text: '确定', value: true, class: 'bg-red-600 hover:bg-red-700' }
    ];
    return showDialog(title, message, buttons);
}
function customAlert(message, title = '提示') {
    const buttons = [
        { text: '好的', value: true, class: 'bg-indigo-500 hover:bg-indigo-600' }
    ];
    return showDialog(title, message, buttons);
}

// --- 视图管理 ---
function showView(viewName, isAboutViewFlag = false) {
    console.log(`[showView] 尝试显示视图: ${viewName}, 是否关于视图: ${isAboutViewFlag}, 当前用户角色: ${currentUser?.role}`);
    if (!currentUser && !isAboutViewFlag && viewName !== 'login' && viewName !== 'change-password') {
        console.warn("[showView] 用户未设置或尝试访问受限视图，中止。");
        if (!window.location.pathname.endsWith('login.html') && !window.location.pathname.endsWith('change-password.html')) {
            window.location.href = '/login.html?reason=no_user_session';
        }
        return;
    }

    let targetViewName = viewName;
    if (!isAboutViewFlag) {
        if (targetViewName === 'templates' && currentUser && currentUser.role !== 'admin') {
            console.warn("[showView] 普通用户尝试访问模板视图，已阻止。");
            customAlert("权限不足，无法访问地址模板管理。");
            targetViewName = currentView === 'templates' ? 'sender' : currentView;
        }
        if (targetViewName === 'user-management' && currentUser && currentUser.role !== 'admin') {
            console.warn("[showView] 普通用户尝试访问用户管理视图，已阻止。");
            customAlert("权限不足，无法访问用户管理。");
            targetViewName = currentView === 'user-management' ? 'sender' : currentView;
        }
        currentView = targetViewName;
    }

    const mainViews = {
        sender: { main: senderView, sidebar: sidebarContentSender, nav: navSenderViewBtn, color: 'indigo' },
        templates: { main: templateManagerView, sidebar: sidebarContentTemplates, nav: navTemplateViewBtn, color: 'teal' },
        'user-management': { main: userManagementView, sidebar: sidebarContentUserManagement, nav: navUserManagementBtn, color: 'purple' }
    };

    Object.values(mainViews).forEach(v => {
        if (v.main) { v.main.classList.add('hidden'); v.main.classList.remove('flex'); }
        if (v.sidebar) { v.sidebar.classList.add('hidden'); v.sidebar.classList.remove('flex'); }
        if (v.nav) {
            v.nav.classList.remove(`bg-${v.color}-500`, 'text-white', `hover:bg-${v.color}-600`);
            v.nav.classList.add('bg-transparent', `text-gray-300`, `hover:bg-gray-700`, `hover:text-white`);
        }
    });

    if(welcomeScreen) welcomeScreen.classList.add('hidden'); welcomeScreen.classList.remove('flex');
    if(aboutView) aboutView.classList.add('hidden'); aboutView.classList.remove('flex');
    if(webhookEditorEl) webhookEditorEl.classList.add('hidden'); webhookEditorEl.classList.remove('flex');
    if(templateEditorEl) templateEditorEl.classList.add('hidden'); templateEditorEl.classList.remove('flex');


    if (isAboutViewFlag) {
        if (aboutView) {
            aboutView.classList.remove('hidden');
            aboutView.classList.add('flex');
            console.log("[showView] 显示 '关于' 视图。");
        }
    } else if (mainViews[targetViewName]) {
        const selectedViewConfig = mainViews[targetViewName];
        console.log(`[showView] 配置主视图: ${targetViewName}`);
        if (selectedViewConfig.main) { selectedViewConfig.main.classList.remove('hidden'); selectedViewConfig.main.classList.add('flex'); }
        if (selectedViewConfig.sidebar) { selectedViewConfig.sidebar.classList.remove('hidden'); selectedViewConfig.sidebar.classList.add('flex'); }
        if (selectedViewConfig.nav) {
            selectedViewConfig.nav.classList.add(`bg-${selectedViewConfig.color}-500`, 'text-white', `hover:bg-${selectedViewConfig.color}-600`);
            selectedViewConfig.nav.classList.remove('bg-transparent', `text-gray-300`, `hover:bg-gray-700`);
        }

        if (targetViewName === 'sender') {
            renderWebhookList(); // 确保列表在视图切换时也刷新以反映正确的选中状态
            if (selectedWebhookId && webhooks.some(w => w.id === selectedWebhookId)) {
                showEditor('webhook-editor');
            } else {
                showWelcomeScreen('发送配置', '请从左侧列表选择一个，或点击“新建配置”。');
            }
        } else if (targetViewName === 'templates' && currentUser && currentUser.role === 'admin') {
            renderTemplateList(); // 确保列表在视图切换时也刷新
            if (selectedTemplateId && webhookUrlTemplates.some(t => t.id === selectedTemplateId)) {
                showEditor('template-editor');
            } else {
                showWelcomeScreen('地址模板', '请从左侧列表选择一个，或点击“新建模板”。');
            }
        } else if (targetViewName === 'user-management' && currentUser && currentUser.role === 'admin') {
            // 用户管理视图通常直接显示列表，不需要额外的编辑器切换
            fetchAndRenderUsers();
        }
    } else {
         console.log(`[showView] 未知视图 '${targetViewName}', 显示默认欢迎屏幕。`);
         showWelcomeScreen('项目', '从左侧选择一个项目，或创建一个新的。');
    }
}
function showEditor(editorId) {
    console.log(`[showEditor] 尝试显示编辑器: ${editorId}`);
    if(welcomeScreen) { welcomeScreen.classList.add('hidden'); welcomeScreen.classList.remove('flex'); }
    if(aboutView) { aboutView.classList.add('hidden'); aboutView.classList.remove('flex'); }

    const editors = {
        'webhook-editor': webhookEditorEl,
        'template-editor': templateEditorEl,
    };

    Object.values(editors).forEach(editor => {
        if (editor && editor.id !== editorId) {
             editor.classList.add('hidden');
             editor.classList.remove('flex');
        }
    });

    if (editorId === 'webhook-editor' && webhookEditorEl) {
        webhookEditorEl.classList.remove('hidden');
        webhookEditorEl.classList.add('flex');
        console.log("[showEditor] Webhook 编辑器已显示。");
    } else if (editorId === 'template-editor' && templateEditorEl) {
        if (currentUser && currentUser.role === 'admin') {
            templateEditorEl.classList.remove('hidden');
            templateEditorEl.classList.add('flex');
            console.log("[showEditor] 模板编辑器已显示。");
        } else {
            console.warn("[showEditor] 非管理员尝试访问模板编辑器。");
            customAlert("权限不足，无法编辑模板。");
            showWelcomeScreen('地址模板', '权限不足，无法编辑模板。');
        }
    }
}
function showWelcomeScreen(viewContextName, message) {
    console.log(`[showWelcomeScreen] 显示欢迎屏幕: ${viewContextName} - ${message}`);
    if(welcomeTitle) welcomeTitle.textContent = `没有选择${viewContextName}`;
    if(welcomeMessage) welcomeMessage.textContent = message;
    if(welcomeScreen) { welcomeScreen.classList.remove('hidden'); welcomeScreen.classList.add('flex'); }

    if(webhookEditorEl) { webhookEditorEl.classList.add('hidden'); webhookEditorEl.classList.remove('flex'); }
    if(templateEditorEl) { templateEditorEl.classList.add('hidden'); templateEditorEl.classList.remove('flex'); }
    if (userManagementView && currentView !== 'user-management') {
        userManagementView.classList.add('hidden'); userManagementView.classList.remove('flex');
    }
    if (aboutView) { aboutView.classList.add('hidden'); aboutView.classList.remove('flex'); }
}

// --- 模板管理 ---
function updateTemplateEditorUIForType(currentType) {
    console.log(`[updateTemplateEditorUIForType] 更新UI，类型: ${currentType}`);
    const isWorkWeixin = currentType === 'workweixin';
    if(workweixinFieldsContainer) workweixinFieldsContainer.classList.toggle('hidden', !isWorkWeixin);
    if(templateUrlContainer) templateUrlContainer.classList.toggle('hidden', isWorkWeixin);

    const templateHeadersSectionWrapper = document.getElementById('template-headers-list')?.parentElement;
    if(templateHeadersSectionWrapper){
         templateHeadersSectionWrapper.classList.toggle('hidden', isWorkWeixin);
    }

    if (isWorkWeixin) {
        if(templateBodyLabel) templateBodyLabel.textContent = "消息内容模板 (企业微信):";
        if(templateBodyInput) templateBodyInput.placeholder = "例如: 您的消息: {userMessage}，支持 Markdown (需选择对应类型)";
    } else {
        if(templateBodyLabel) templateBodyLabel.textContent = "请求体模板 (通用JSON, 可用 {phoneNumber} 和 {userMessage}):";
        if(templateBodyInput) templateBodyInput.placeholder = '例如: {"msgtype":"text","text":{"content":"{userMessage}"},"touser":"{phoneNumber}"}';
        if(templateUrlInput) templateUrlInput.placeholder = 'https://api.example.com/send?key=YOUR_KEY&to={phoneNumber}';
        if(templateMethodSelect) templateMethodSelect.value = 'POST';
    }
}
function renderTemplateList() {
    console.log("[renderTemplateList] 开始渲染模板列表。");
    if(!templateListEl) { console.error("[renderTemplateList] templateListEl 未找到!"); return; }
    templateListEl.innerHTML = '';
    if (!currentUser || currentUser.role !== 'admin') {
        templateListEl.innerHTML = '<li class="text-center text-gray-500 py-4">权限不足</li>';
        console.log("[renderTemplateList] 用户无权限查看模板。");
        return;
    }
    if (!webhookUrlTemplates || webhookUrlTemplates.length === 0) {
        templateListEl.innerHTML = '<li class="text-center text-gray-500 py-4">无可用模板</li>';
        console.log("[renderTemplateList] 无可用模板。");
        return;
    }
    webhookUrlTemplates.forEach(template => {
        const li = document.createElement('li');
        li.dataset.id = template.id;
        let prefix = template.type === 'workweixin' ? '[企微] ' : '[通用] ';
        if (template.isGlobal) {
            prefix = `[全局] ${prefix}`;
        }
        const isActive = template.id === selectedTemplateId;
        li.className = `sidebar-list-item ${isActive ? 'sidebar-list-item-active-teal text-white' : 'sidebar-list-item-inactive'}`;
        li.innerHTML = `<span class="truncate" title="${prefix}${template.name || '未命名模板'}">${prefix}${template.name || '未命名模板'}</span><button data-delete-id="${template.id}" class="delete-btn-icon">&#x2715;</button>`;
        templateListEl.appendChild(li);
    });
    console.log("[renderTemplateList] 模板列表渲染完成。数量:", webhookUrlTemplates.length);
}
function renderTemplateEditor() {
    console.log(`[renderTemplateEditor] 开始渲染模板编辑器。已选模板ID: ${selectedTemplateId}`);
    if (!currentUser || currentUser.role !== 'admin' || !templateEditorEl) {
        console.warn("[renderTemplateEditor] 用户无权限或编辑器元素不存在。");
        showWelcomeScreen('地址模板', '权限不足，无法编辑模板。');
        return;
    }
    const template = webhookUrlTemplates.find(t => t.id === selectedTemplateId);
    const isNewTemplateMode = selectedTemplateId === null;

    if (!template && !isNewTemplateMode) {
        console.warn("[renderTemplateEditor] 未找到选定模板，且非新建模式。");
        showWelcomeScreen('地址模板', '请从左侧重新选择或新建一个模板。');
        return;
    }

    showEditor('template-editor');

    const name = isNewTemplateMode ? `新模板 ${webhookUrlTemplates.length + 1}` : template.name;
    const type = isNewTemplateMode ? (templateTypeSelect ? templateTypeSelect.value : 'generic') : template.type;
    const isGlobal = isNewTemplateMode ? false : !!template.isGlobal;

    console.log(`[renderTemplateEditor] 编辑器名称: ${name}, 类型: ${type}, 是否全局: ${isGlobal}`);

    if(templateNameInput) templateNameInput.value = name || '';
    if(templateTypeSelect) templateTypeSelect.value = type || 'generic';
    updateTemplateEditorUIForType(type || 'generic');

    const isGlobalCheckboxContainer = document.getElementById('template-is-global-container');
    const isGlobalCheckbox = document.getElementById('template-is-global-checkbox');
    if (isGlobalCheckboxContainer && isGlobalCheckbox) {
        isGlobalCheckboxContainer.classList.remove('hidden');
        isGlobalCheckbox.checked = isGlobal;
    }


    if (type === 'workweixin') {
        if(workweixinCorpidInput) workweixinCorpidInput.value = isNewTemplateMode ? '' : template.workweixin_corpid || '';
        if(workweixinCorpsecretInput) {
            workweixinCorpsecretInput.value = '';
            workweixinCorpsecretInput.placeholder = isNewTemplateMode ? '输入新的应用密钥' : (template.workweixin_corpsecret === '********' ? '密钥已保存，输入新密钥以替换' : '输入新的应用密钥');
        }
        if(workweixinAgentidInput) workweixinAgentidInput.value = isNewTemplateMode ? '' : template.workweixin_agentid || '';
        if(workweixinMsgtypeSelect) workweixinMsgtypeSelect.value = isNewTemplateMode ? 'text' : template.workweixin_msgtype || 'text';
        if(templateBodyInput) templateBodyInput.value = isNewTemplateMode ? '{userMessage}' : template.bodyTemplate || '{userMessage}';
    } else { // Generic
        if(templateUrlInput) {
            templateUrlInput.value = isNewTemplateMode ? '' : template.url || '';
            templateUrlInput.placeholder = 'https://api.example.com/send?key=YOUR_KEY&to={phoneNumber}';
        }
        if(templateMethodSelect) templateMethodSelect.value = isNewTemplateMode ? 'POST' : template.method || 'POST';
        if(templateBodyInput) templateBodyInput.value = isNewTemplateMode ? JSON.stringify({ msgtype: "text", text: { content: "{userMessage}" } }, null, 2) : template.bodyTemplate || '';
        renderHeaders(isNewTemplateMode ? [] : template.headers, templateHeadersListEl, 'template-header-key', 'template-header-value', 'remove-template-header-btn', 'teal');
    }
    console.log("[renderTemplateEditor] 模板编辑器渲染完成。");
}
async function handleNewTemplate() {
    console.log("[handleNewTemplate] 新建模板请求。");
    if (!currentUser || currentUser.role !== 'admin') { customAlert("权限不足"); return; }
    if (selectedTemplateId) {
        console.log("[handleNewTemplate] 当前已选模板，先保存更改。");
        await saveCurrentTemplateChanges(true);
    }
    selectedTemplateId = null;
    if(templateTypeSelect) templateTypeSelect.value = 'generic';
    renderTemplateList(); // 确保列表刷新以取消旧选中项的样式
    showEditor('template-editor');
    renderTemplateEditor();
}
async function handleSelectTemplate(templateId) {
    console.log(`[handleSelectTemplate] 选择模板ID: ${templateId}`);
    if (!currentUser || currentUser.role !== 'admin') { customAlert("权限不足"); return; }
    if (selectedTemplateId === templateId && currentView === 'templates' && templateEditorEl && !templateEditorEl.classList.contains('hidden')) {
        console.log("[handleSelectTemplate] 模板已选择且编辑器可见，无操作。");
        return;
    }
    if (selectedTemplateId) {
        console.log(`[handleSelectTemplate] 当前已选模板 ${selectedTemplateId}，先保存更改。`);
        await saveCurrentTemplateChanges(true);
    }
    selectedTemplateId = templateId;
    renderTemplateList(); // **关键修复**: 选择后重新渲染列表以更新选中样式
    renderTemplateEditor();
    showView('templates'); // 确保视图正确 (showView 也会调用 renderTemplateList)
}
async function saveCurrentTemplateChanges(isSwitchingOrNew = false) {
    // ... (保持不变，确保日志和错误处理) ...
    console.log(`[saveCurrentTemplateChanges] 保存模板更改。已选模板ID: ${selectedTemplateId}, isSwitchingOrNew: ${isSwitchingOrNew}`);
    if (!currentUser || currentUser.role !== 'admin') { customAlert("权限不足"); return; }
    if (!templateEditorEl || templateEditorEl.classList.contains('hidden') || (!selectedTemplateId && !isSwitchingOrNew && (!templateNameInput || !templateNameInput.value.startsWith("新模板")))) {
        console.log("[saveCurrentTemplateChanges] 编辑器未显示或不满足保存条件，中止。");
        return;
    }
    if (!templateNameInput || !templateTypeSelect || !workweixinCorpidInput || !workweixinCorpsecretInput || !workweixinAgentidInput || !workweixinMsgtypeSelect || !templateBodyInput || !templateUrlInput || !templateMethodSelect || !templateHeadersListEl) {
        console.error("[saveCurrentTemplateChanges] 一个或多个模板编辑器DOM元素未找到!");
        if (!isSwitchingOrNew) await customAlert("保存模板时发生错误：编辑器元素丢失。");
        return;
    }

    let templateToSave = {};
    const isNewTemplate = !selectedTemplateId;
    console.log(`[saveCurrentTemplateChanges] isNewTemplate: ${isNewTemplate}`);

    if (!isNewTemplate) {
        const existingTemplate = webhookUrlTemplates.find(t => t.id === selectedTemplateId);
        if (!existingTemplate) {
            console.error(`[saveCurrentTemplateChanges] 错误: 尝试保存不存在的模板 (ID: ${selectedTemplateId})。`);
            if (!isSwitchingOrNew) await customAlert("保存模板失败：找不到原始模板。");
            return;
        }
        templateToSave = { ...existingTemplate };
    } else {
        templateToSave.id = null;
    }


    templateToSave.name = templateNameInput.value.trim() || (isNewTemplate ? `新模板 ${webhookUrlTemplates.length + 1}` : '未命名模板');
    templateToSave.type = templateTypeSelect.value;

    const isGlobalCheckbox = document.getElementById('template-is-global-checkbox');
    if (isGlobalCheckbox) {
        templateToSave.isGlobal = isGlobalCheckbox.checked;
    } else {
        templateToSave.isGlobal = false;
    }
    console.log(`[saveCurrentTemplateChanges] 待保存模板: 名称=${templateToSave.name}, 类型=${templateToSave.type}, 全局=${templateToSave.isGlobal}`);

    if (templateToSave.type === 'workweixin') {
        templateToSave.url = "WORKWEIXIN_APP_MESSAGE_API";
        templateToSave.method = "POST";
        templateToSave.workweixin_corpid = workweixinCorpidInput.value.trim();
        templateToSave.workweixin_agentid = workweixinAgentidInput.value.trim();
        templateToSave.workweixin_msgtype = workweixinMsgtypeSelect.value;
        templateToSave.bodyTemplate = templateBodyInput.value.trim() || "{userMessage}";
        templateToSave.headers = [];

        const secretInputVal = workweixinCorpsecretInput.value.trim();
        if (secretInputVal) {
            templateToSave.workweixin_corpsecret_new = secretInputVal;
            console.log("[saveCurrentTemplateChanges] WorkWeixin: 新密钥已提供。");
        } else if (isNewTemplate) {
            templateToSave.workweixin_corpsecret_new = "";
            console.log("[saveCurrentTemplateChanges] WorkWeixin: 新建模板，密钥为空。");
        }
        delete templateToSave.workweixin_corpsecret;

    } else { // Generic template
        templateToSave.url = templateUrlInput.value.trim();
        templateToSave.method = templateMethodSelect.value;
        templateToSave.bodyTemplate = templateBodyInput.value.trim();
        templateToSave.headers = [];
        if(templateHeadersListEl) {
            templateHeadersListEl.querySelectorAll('.header-item').forEach(div => {
                const keyInput = div.querySelector('.template-header-key');
                const valueInput = div.querySelector('.template-header-value');
                if (keyInput && valueInput) {
                    const key = keyInput.value.trim();
                    const value = valueInput.value.trim();
                    if (key) templateToSave.headers.push({ key, value });
                }
            });
        }
        delete templateToSave.workweixin_corpid;
        delete templateToSave.workweixin_corpsecret;
        delete templateToSave.workweixin_corpsecret_new;
        delete templateToSave.workweixin_agentid;
        delete templateToSave.workweixin_msgtype;
    }
    console.log("[saveCurrentTemplateChanges] 最终待发送的templateToSave对象:", JSON.stringify(templateToSave));

    try {
        let templatesPayload;
        if (isNewTemplate) {
            templatesPayload = [...webhookUrlTemplates, templateToSave];
        } else {
            templatesPayload = webhookUrlTemplates.map(t => t.id === selectedTemplateId ? templateToSave : t);
        }
        console.log("[saveCurrentTemplateChanges] 发送给后端的templatesPayload:", JSON.stringify(templatesPayload));

        const response = await apiRequest('/api/templates', { method: 'POST', body: JSON.stringify(templatesPayload) });
        console.log("[saveCurrentTemplateChanges] 后端响应:", response);

        if (response.success && response.templates) {
            webhookUrlTemplates = response.templates;

            if (isNewTemplate && response.savedTemplate && response.savedTemplate.id) {
                selectedTemplateId = response.savedTemplate.id;
                console.log(`[saveCurrentTemplateChanges] 新模板已保存，ID设置为: ${selectedTemplateId}`);
            } else if (isNewTemplate) {
                const newName = templateToSave.name;
                const newType = templateToSave.type;
                const newIsGlobal = templateToSave.isGlobal;
                const newlyCreatedAndReturnedTemplate = response.templates.find(t =>
                    t.name === newName && t.type === newType && t.isGlobal === newIsGlobal &&
                    !webhookUrlTemplates.some(oldT => oldT.id === t.id && oldT !== t)
                ) || response.templates.find(t => t.name === newName && t.type === newType && t.isGlobal === newIsGlobal);
                if (newlyCreatedAndReturnedTemplate) {
                    selectedTemplateId = newlyCreatedAndReturnedTemplate.id;
                     console.log(`[saveCurrentTemplateChanges] 新模板已保存 (回退查找)，ID设置为: ${selectedTemplateId}`);
                } else {
                    console.warn("[saveCurrentTemplateChanges] 无法可靠地识别新建模板以自动选择。");
                    selectedTemplateId = null;
                }
            }
            if (!isSwitchingOrNew) {
                await customAlert('模板已保存！');
            }
        } else {
            throw new Error(response.message || '保存模板失败 (来自后端)');
        }
    } catch (error) {
        console.error("[saveCurrentTemplateChanges] 保存模板失败 (catch块):", error);
        if (!isSwitchingOrNew) await customAlert(`保存模板失败: ${error.data?.message || error.message || error}`);
    } finally {
        renderTemplateList();
        if (selectedTemplateId || (isNewTemplate && selectedTemplateId)) {
            renderTemplateEditor();
        } else if (isNewTemplate && !selectedTemplateId) {
            showWelcomeScreen('地址模板', '模板创建可能未完全成功，请检查列表或重试。');
        } else {
            showWelcomeScreen('地址模板', '请从左侧列表选择一个，或点击“新建模板”。');
        }
    }
}
async function handleDeleteTemplate(templateIdToDelete) {
    // ... (保持不变) ...
    console.log(`[handleDeleteTemplate] 删除模板ID: ${templateIdToDelete}`);
    if (!currentUser || currentUser.role !== 'admin') { customAlert("权限不足"); return; }
    const template = webhookUrlTemplates.find(t => t.id === templateIdToDelete);
    if (!template) { console.warn(`[handleDeleteTemplate] 未找到模板 ID ${templateIdToDelete}`); return; }

    const usedBy = webhooks.filter(wh => wh.templateId === templateIdToDelete);
    let confirmMessage = `确定要删除模板 "${template.name}" 吗？`;
    if (usedBy.length > 0) {
        confirmMessage += `\n\n警告：此模板被 ${usedBy.length} 个发送配置 (${usedBy.map(wh=>wh.name).join(', ')}) 使用。删除后，这些配置的地址模板将失效，您需要为它们重新选择模板。`;
    }

    if (await customConfirm(confirmMessage, `删除模板 "${template.name}"`)) {
        console.log(`[handleDeleteTemplate] 用户确认删除模板 ID: ${templateIdToDelete}`);
        try {
            const updatedTemplatesPayload = webhookUrlTemplates.filter(t => t.id !== templateIdToDelete);
            const response = await apiRequest('/api/templates', { method: 'POST', body: JSON.stringify(updatedTemplatesPayload) });
            console.log("[handleDeleteTemplate] 后端删除响应:", response);

            if (response.success && response.templates) {
                webhookUrlTemplates = response.templates;
                await customAlert('模板已删除。');

                if (selectedTemplateId === templateIdToDelete) {
                    selectedTemplateId = null;
                    if (webhookUrlTemplates.length > 0) {
                        console.log("[handleDeleteTemplate] 已删除当前选中模板，选择第一个可用模板。");
                        await handleSelectTemplate(webhookUrlTemplates[0].id);
                    } else {
                        console.log("[handleDeleteTemplate] 已删除当前选中模板，无其他模板可选。");
                        showView('templates');
                        renderTemplateEditor();
                    }
                }

                let webhooksModified = false;
                const updatedWebhooks = webhooks.map(wh => {
                    if (wh.templateId === templateIdToDelete) {
                        webhooksModified = true;
                        return { ...wh, templateId: null };
                    }
                    return wh;
                });

                if (webhooksModified) {
                    console.log("[handleDeleteTemplate] 更新受影响的发送配置。");
                    const webhookUpdateResponse = await apiRequest('/api/webhooks', { method: 'POST', body: JSON.stringify(updatedWebhooks) });
                    if(webhookUpdateResponse.success && webhookUpdateResponse.webhooks){
                        webhooks = webhookUpdateResponse.webhooks;
                        renderWebhookList();
                        if(currentView === 'sender' && selectedWebhookId && updatedWebhooks.find(wh => wh.id === selectedWebhookId)?.templateId === null) {
                            renderWebhookEditor();
                        }
                    }
                }
            } else {
                throw new Error(response.message || '删除模板失败 (来自后端)');
            }
        } catch (error) {
            console.error("[handleDeleteTemplate] 删除模板失败 (catch块):", error);
            await customAlert(`删除模板失败: ${error.data?.message || error.message || error}`);
        } finally {
            renderTemplateList();
        }
    }
}

// --- 发送配置管理 ---
function isPhoneNumberRequired(template) {
    if (!template || template.type === 'workweixin') return false;
    const placeholder1 = "{phoneNumber}";
    const placeholder2 = "{phone}";
    const urlRequires = (template.url && (template.url.includes(placeholder1) || template.url.includes(placeholder2)));
    const bodyRequires = (template.bodyTemplate && (template.bodyTemplate.includes(placeholder1) || template.bodyTemplate.includes(placeholder2)));
    return urlRequires || bodyRequires;
}
function renderWebhookList() {
    console.log("[renderWebhookList] 开始渲染发送配置列表。");
    if(!webhookListEl) { console.error("[renderWebhookList] webhookListEl 未找到!"); return; }
    webhookListEl.innerHTML = '';
    if (webhooks.length === 0) {
        webhookListEl.innerHTML = '<li class="text-center text-gray-500 py-4">无发送配置</li>';
        console.log("[renderWebhookList] 无发送配置。");
        return;
    }
    webhooks.forEach(wh => {
        const li = document.createElement('li');
        li.dataset.id = wh.id;
        const isActive = wh.id === selectedWebhookId;
        li.className = `sidebar-list-item ${isActive ? 'sidebar-list-item-active-indigo text-white' : 'sidebar-list-item-inactive'}`;
        li.innerHTML = `<span class="truncate">${wh.name || '未命名配置'}</span><button data-delete-id="${wh.id}" class="delete-btn-icon">&#x2715;</button>`;
        webhookListEl.appendChild(li);
    });
    console.log("[renderWebhookList] 发送配置列表渲染完成。数量:", webhooks.length);
}
function renderWebhookEditor() {
    console.log(`[renderWebhookEditor] 开始渲染发送配置编辑器。已选配置ID: ${selectedWebhookId}`);
    const webhook = webhooks.find(wh => wh.id === selectedWebhookId);
    if (!webhook) {
        console.warn("[renderWebhookEditor] 未找到选定配置。");
        showWelcomeScreen('发送配置', '请从左侧重新选择一个发送配置。');
        return;
    }
    showEditor('webhook-editor');
    if(webhookNameInput) webhookNameInput.value = webhook.name || '';

    if(templateSelect) {
        templateSelect.innerHTML = '<option value="">-- 请选择一个地址模板 --</option>';
        console.log("[renderWebhookEditor] 填充模板选择器，模板数量:", webhookUrlTemplates?.length);
        if (webhookUrlTemplates && webhookUrlTemplates.length > 0) {
            webhookUrlTemplates.forEach(template => {
                const option = document.createElement('option');
                option.value = template.id;
                let prefix = template.type === 'workweixin' ? '[企微] ' : '[通用] ';
                if (template.isGlobal && currentUser.role === 'admin') {
                    prefix = `[全局] ${prefix}`;
                } else if (template.isGlobal && currentUser.role !== 'admin') {
                     prefix = `${prefix}`;
                }
                option.textContent = prefix + template.name;
                if (template.id === webhook.templateId) {
                    option.selected = true;
                    console.log(`[renderWebhookEditor] 模板 '${template.name}' 已为配置 '${webhook.name}' 选中。`);
                }
                templateSelect.appendChild(option);
            });
        } else {
             const option = document.createElement('option');
             option.value = "";
             option.textContent = (currentUser.role === 'admin') ? "无可用模板 (或全局模板)，请先创建" : "无可用共享模板";
             option.disabled = true;
             templateSelect.appendChild(option);
             console.log("[renderWebhookEditor] 无可用模板。");
        }
    }

    const selectedTemplate = webhookUrlTemplates.find(t => t.id === webhook.templateId);
    const isWW = selectedTemplate && selectedTemplate.type === 'workweixin';
    console.log(`[renderWebhookEditor] 选定模板: ${selectedTemplate?.name}, 是否企业微信: ${isWW}`);

    const requiresPhone = selectedTemplate ? isPhoneNumberRequired(selectedTemplate) : false;
    if(phoneNumberSection) phoneNumberSection.classList.toggle('hidden', !isWW && !requiresPhone);
    if(recipientLabel) recipientLabel.textContent = isWW ? "接收者 (touser/@all):" : "手机号码/目标参数:";
    if(phoneNumberInput) {
        phoneNumberInput.value = webhook.phone || (isWW ? '@all' : '');
        phoneNumberInput.placeholder = isWW ? "例: UserID1|UserID2 或 @all" : (requiresPhone ? "请输入目标手机号码" : "参数 (如不通过URL提供)");
    }
    if(webhookBodyTextarea) {
        webhookBodyTextarea.value = webhook.plainBody || '';
        webhookBodyTextarea.placeholder = isWW ? "输入企业微信消息内容..." : "输入纯文本消息 (将替换模板中的 {userMessage})";
    }

    updateSelectedTemplateUrlDisplay(webhook.templateId);

    const webhookHeadersContainer = document.getElementById('add-header-btn')?.parentElement;
    if(webhookHeadersContainer){
      webhookHeadersContainer.classList.toggle('hidden', isWW);
    }
    if (!isWW && headersListEl) {
        renderHeaders(webhook.headers, headersListEl, 'header-key-input', 'header-value-input', 'remove-header-btn', 'indigo');
    } else if (isWW && headersListEl) {
        headersListEl.innerHTML = '';
    }


    renderHistoryLog(selectedWebhookId);
    renderScheduledTaskList();
    setActiveTab(currentActiveTab, true);
    console.log("[renderWebhookEditor] 发送配置编辑器渲染完成。");
}
function updateSelectedTemplateUrlDisplay(templateId) {
    console.log(`[updateSelectedTemplateUrlDisplay] 更新URL显示，模板ID: ${templateId}, 当前用户角色: ${currentUser?.role}`);
    if (!selectedTemplateUrlContainer) { console.warn("[updateSelectedTemplateUrlDisplay] selectedTemplateUrlContainer 元素未找到。"); return; }
    const urlDisplayEl = document.getElementById('selected-template-url-display');
    const toggleBtn = document.getElementById('toggle-url-visibility-btn');

    if (!urlDisplayEl || !toggleBtn) { console.warn("[updateSelectedTemplateUrlDisplay] URL显示或切换按钮元素未找到。"); return; }

    if (!currentUser || typeof currentUser.role === 'undefined') {
        console.warn("[updateSelectedTemplateUrlDisplay] currentUser 或 currentUser.role 未定义，无法判断权限。默认隐藏URL。");
        selectedTemplateUrlContainer.classList.add('hidden');
        return;
    }

    if (currentUser.role !== 'admin') {
        selectedTemplateUrlContainer.classList.add('hidden');
        console.log("[updateSelectedTemplateUrlDisplay] 非管理员，隐藏模板URL。");
        return;
    }

    if (!templateId) { selectedTemplateUrlContainer.classList.add('hidden'); return; }

    const template = webhookUrlTemplates.find(t => t.id === templateId);
    if (!template) { selectedTemplateUrlContainer.classList.add('hidden'); console.warn(`[updateSelectedTemplateUrlDisplay] 未找到模板ID ${templateId}`); return; }

    const isWorkWeixinTemplate = template.type === 'workweixin';
    const fullUrl = template.url || ''; 

    const displayInfo = getDisplayableUrl(fullUrl, isWorkWeixinTemplate);
    console.log(`[updateSelectedTemplateUrlDisplay] URL显示信息 (管理员): `, displayInfo);

    urlDisplayEl.textContent = displayInfo.text;
    urlDisplayEl.title = displayInfo.title; 
    urlDisplayEl.dataset.fullUrl = isWorkWeixinTemplate ? "WORKWEIXIN_API" : fullUrl; 

    if (isWorkWeixinTemplate || displayInfo.text === fullUrl) { 
        toggleBtn.classList.add('hidden');
        urlDisplayEl.dataset.isMasked = 'false';
    } else { 
        const isCurrentlyMasked = displayInfo.text !== fullUrl;
        urlDisplayEl.dataset.isMasked = isCurrentlyMasked.toString();
        toggleBtn.innerHTML = isCurrentlyMasked ? eyeIconSVG : eyeSlashIconSVG;
        toggleBtn.classList.remove('hidden');
    }
    selectedTemplateUrlContainer.classList.remove('hidden'); 
}
async function handleNewWebhook() {
    console.log("[handleNewWebhook] 新建发送配置请求。");
    if (selectedWebhookId) {
        console.log("[handleNewWebhook] 当前已选配置，先保存更改。");
        await saveCurrentWebhookChanges(true);
    }

    if ((!webhookUrlTemplates || webhookUrlTemplates.length === 0)) {
        await customAlert("没有可用的地址模板。请联系管理员创建全局模板，或者（如果您是管理员）请先创建模板。");
        if (currentUser.role === 'admin') showView('templates');
        return;
    }

    const newWebhookData = {
        id: null,
        name: `新发送配置 ${webhooks.length + 1}`,
        templateId: webhookUrlTemplates.length > 0 ? webhookUrlTemplates[0].id : null,
        phone: '',
        plainBody: "来自 Webhook Sender 的测试消息",
        headers: []
    };
    const payload = [...webhooks, newWebhookData];

    try {
        const response = await apiRequest('/api/webhooks', { method: 'POST', body: JSON.stringify(payload) });
        console.log("[handleNewWebhook] 后端响应:", response);
        if (response.success && response.webhooks) {
            webhooks = response.webhooks;

            let addedWebhook = response.webhooks.find(wh =>
                wh.name === newWebhookData.name &&
                wh.templateId === newWebhookData.templateId &&
                !payload.slice(0, payload.length -1).map(w => w.id).includes(wh.id)
            );
             if (!addedWebhook && response.webhooks.length > webhooks.length -1 ) {
                 const oldWebhookIds = webhooks.slice(0, webhooks.length - (response.webhooks.length - (webhooks.length -1) ) ).map(w => w.id); // Corrected logic for old IDs
                 addedWebhook = response.webhooks.find(wh => !oldWebhookIds.includes(wh.id) && wh.name === newWebhookData.name);
            }


            if (addedWebhook && addedWebhook.id) {
                console.log(`[handleNewWebhook] 新建配置已创建并找到，ID: ${addedWebhook.id}`);
                await handleSelectWebhook(addedWebhook.id);
            } else {
                console.warn("[handleNewWebhook] 无法可靠地识别新建配置以自动选择。");
                renderWebhookList(); // 确保列表在未选中新项时也刷新
                showWelcomeScreen('发送配置', '新配置已创建，请从列表选择。');
            }
        } else {
            throw new Error(response.message || "创建新配置失败 (来自后端)");
        }
    } catch (error) {
        console.error("[handleNewWebhook] 创建新配置失败 (catch块):", error);
        await customAlert(`创建新配置失败: ${error.data?.message || error.message || error}`);
    }
}
async function handleSelectWebhook(webhookId) {
    console.log(`[handleSelectWebhook] 选择发送配置ID: ${webhookId}`);
    if (selectedWebhookId === webhookId && currentView === 'sender' && webhookEditorEl && !webhookEditorEl.classList.contains('hidden')) {
        console.log("[handleSelectWebhook] 配置已选择且编辑器可见，无操作。");
        return;
    }
    if (selectedWebhookId) { // 如果之前有选中的，先保存它
        console.log(`[handleSelectWebhook] 当前已选配置 ${selectedWebhookId}，先保存更改。`);
        await saveCurrentWebhookChanges(true); // isSwitching = true
    }
    selectedWebhookId = webhookId; // 更新全局选中的ID
    renderWebhookList(); // **关键修复**: 选择后重新渲染列表以更新选中样式
    renderWebhookEditor(); // 渲染新选中项的编辑器内容
    showView('sender'); // 确保视图正确 (showView 也会调用 renderWebhookList)
}
async function saveCurrentWebhookChanges(isSwitching = false) {
    console.log(`[saveCurrentWebhookChanges] 保存发送配置更改。已选配置ID: ${selectedWebhookId}, isSwitching: ${isSwitching}`);
     if (!selectedWebhookId || !webhookEditorEl || webhookEditorEl.classList.contains('hidden')) {
        console.log("[saveCurrentWebhookChanges] 无选中配置或编辑器未显示，不保存。");
        return;
    }
    const index = webhooks.findIndex(wh => wh.id === selectedWebhookId);
    if (index === -1) {
        console.error(`[saveCurrentWebhookChanges] 未在本地缓存中找到配置ID ${selectedWebhookId}。`);
        if (!isSwitching) await customAlert("保存配置失败：找不到原始配置。");
        return;
    }
    if (!webhookNameInput || !templateSelect || !phoneNumberInput || !webhookBodyTextarea || !headersListEl) {
        console.error("[saveCurrentWebhookChanges] 一个或多个发送配置编辑器DOM元素未找到!");
        if (!isSwitching) await customAlert("保存发送配置时发生错误：编辑器元素丢失。");
        return;
    }

    const webhookToUpdate = { ...webhooks[index] };
    webhookToUpdate.name = webhookNameInput.value.trim() || '未命名配置';
    webhookToUpdate.templateId = templateSelect.value || null;
    webhookToUpdate.phone = phoneNumberInput.value.trim();
    webhookToUpdate.plainBody = webhookBodyTextarea.value;
    console.log(`[saveCurrentWebhookChanges] 待保存配置: 名称=${webhookToUpdate.name}, 模板ID=${webhookToUpdate.templateId}`);

    const selectedTemplateForSave = webhookUrlTemplates.find(t => t.id === webhookToUpdate.templateId);
    if (selectedTemplateForSave && selectedTemplateForSave.type === 'workweixin') {
        webhookToUpdate.headers = [];
    } else {
        webhookToUpdate.headers = [];
        if (headersListEl) {
            headersListEl.querySelectorAll('.header-item').forEach(div => {
                const keyInput = div.querySelector('.header-key-input');
                const valueInput = div.querySelector('.header-value-input');
                if (keyInput && valueInput) {
                    const key = keyInput.value.trim();
                    const value = valueInput.value.trim();
                    if (key) webhookToUpdate.headers.push({ key, value });
                }
            });
        }
    }
    console.log("[saveCurrentWebhookChanges] 最终待发送的webhookToUpdate对象:", JSON.stringify(webhookToUpdate));

    const payload = webhooks.map(wh => wh.id === selectedWebhookId ? webhookToUpdate : wh);
    console.log("[saveCurrentWebhookChanges] 发送给后端的webhooks payload:", JSON.stringify(payload));

    try {
        const response = await apiRequest('/api/webhooks', { method: 'POST', body: JSON.stringify(payload) });
         console.log("[saveCurrentWebhookChanges] 后端响应:", response);
        if (response.success && response.webhooks) {
            webhooks = response.webhooks;
            if (!isSwitching) await customAlert('发送配置已保存！');
        } else {
            throw new Error(response.message || "保存配置失败 (来自后端)");
        }
    } catch (error) {
        console.error("[saveCurrentWebhookChanges] 保存配置失败 (catch块):", error);
        if (!isSwitching) await customAlert(`保存配置失败: ${error.data?.message || error.message || error}`);
    } finally {
        renderWebhookList(); // 总是重新渲染列表以反映任何更改（例如名称）
        if (!isSwitching && selectedWebhookId) { // 如果不是切换操作，且仍有选中项，则重绘编辑器
            renderWebhookEditor();
        }
    }
}
async function handleDeleteWebhook(webhookIdToDelete) {
    console.log(`[handleDeleteWebhook] 删除发送配置ID: ${webhookIdToDelete}`);
     if (await customConfirm('确定要删除这个发送配置吗？其发送历史也将被清除。', '删除发送配置')) {
        console.log(`[handleDeleteWebhook] 用户确认删除配置 ID: ${webhookIdToDelete}`);
        try {
            const updatedWebhooks = webhooks.filter(wh => wh.id !== webhookIdToDelete);
            const response = await apiRequest('/api/webhooks', { method: 'POST', body: JSON.stringify(updatedWebhooks) });
            console.log("[handleDeleteWebhook] 后端删除响应:", response);

            if (response.success && response.webhooks) {
                webhooks = response.webhooks;
                delete history[webhookIdToDelete];

                await customAlert('发送配置已删除。');

                if (selectedWebhookId === webhookIdToDelete) {
                    selectedWebhookId = null;
                    if (webhooks.length > 0) {
                         console.log("[handleDeleteWebhook] 已删除当前选中配置，选择第一个可用配置。");
                        await handleSelectWebhook(webhooks[0].id); // 这会触发列表和编辑器的重新渲染
                    } else {
                        console.log("[handleDeleteWebhook] 已删除当前选中配置，无其他配置可选。");
                        renderWebhookList(); // 确保列表显示为空
                        showWelcomeScreen('发送配置', '请从左侧列表选择一个，或点击“新建配置”。');
                    }
                } else {
                    renderWebhookList(); // 如果删除的不是当前选中的，只需刷新列表
                }
            } else {
                throw new Error(response.message || '删除配置失败 (来自后端)');
            }
        } catch (error) {
            console.error("[handleDeleteWebhook] 删除配置失败 (catch块):", error);
            await customAlert(`删除配置失败: ${error.data?.message || error.message || error}`);
        }
    }
}

// --- 核心功能 (发送, 定时, 标签页, 任务) ---
// ... (buildClientSideRequestPayload, handleSendNow, handleSaveTask, renderHeaders, setActiveTab, handleCancelTask, renderHistoryLog, renderScheduledTaskList 保持不变) ...
async function buildClientSideRequestPayload(webhookConfig, template, recipientOrPhone, userMessageText) {
    console.log(`[buildClientSideRequestPayload] 构建客户端负载。配置: ${webhookConfig?.name}, 模板: ${template?.name}`);
    if (!template) {
        await customAlert('构建请求失败：地址模板无效或未选择。');
        return null;
    }
    const payloadForApi = {
        originalWebhookId: webhookConfig.id,
        templateId: template.id,
        phone: recipientOrPhone,
        plainBody: userMessageText,
        headers: webhookConfig.headers || [],
        webhookSnapshot: {
            name: webhookConfig.name,
            templateId: template.id,
            method: template.method,
            headers: webhookConfig.headers,
            plainBody: userMessageText,
            phoneNumber: recipientOrPhone,
            bodyTemplate: template.bodyTemplate,
            url: template.url,
            touser: recipientOrPhone,
            workweixin_msgtype: template.workweixin_msgtype
        },
        templateType: template.type
    };

     if (template.type === 'workweixin') {
        payloadForApi.workweixinConfig = {
            corpid: template.workweixin_corpid,
            agentid: template.workweixin_agentid,
            touser: recipientOrPhone,
            msgtype: template.workweixin_msgtype
        };
        payloadForApi.webhookSnapshot.url = "WORKWEIXIN_APP_MESSAGE_API";
        delete payloadForApi.webhookSnapshot.method;
        delete payloadForApi.webhookSnapshot.headers;
        delete payloadForApi.webhookSnapshot.bodyTemplate;
    } else {
        payloadForApi.webhookSnapshot.url = template.url;
    }
    console.log(`[buildClientSideRequestPayload] 构建完成的负载:`, JSON.stringify(payloadForApi));
    return payloadForApi;
}
async function handleSendNow() {
    console.log("[handleSendNow] 尝试立即发送。");
    if (!selectedWebhookId) { await customAlert('请先选择一个发送配置。'); return; }
    if (isSending) { console.warn("[handleSendNow] 正在发送中，请稍候。"); return; }
    const webhookConfig = webhooks.find(wh => wh.id === selectedWebhookId);
    if (!webhookConfig) { await customAlert('未找到选定的发送配置！'); return; }
    console.log(`[handleSendNow] 使用配置: ${webhookConfig.name}`);

    const template = webhookUrlTemplates.find(t => t.id === webhookConfig.templateId);
    if (!template) { await customAlert('发送配置未关联有效的地址模板！请选择一个模板。'); return; }
     console.log(`[handleSendNow] 使用模板: ${template.name}, 类型: ${template.type}`);

    const recipientOrPhone = phoneNumberInput.value.trim();
    const messageContent = webhookBodyTextarea.value.trim();

    if (template.type === 'workweixin') {
        if (!recipientOrPhone) { await customAlert('企业微信模板需要接收者 (touser/@all)，请输入。'); phoneNumberInput.focus(); return; }
        if (!messageContent && (template.workweixin_msgtype === 'text' || template.workweixin_msgtype === 'markdown')) {
             await customAlert('请输入消息内容。'); webhookBodyTextarea.focus(); return;
        }
    } else {
        if (!template.url || template.url.trim() === '') { await customAlert('无法发送：所选地址模板没有有效的URL。'); return; }
        if (isPhoneNumberRequired(template) && !recipientOrPhone) {
            await customAlert('当前模板需要手机号码/目标参数，请输入。');
            phoneNumberInput.focus();
            return;
        }
    }

    let confirmed = false;
    if (template.type === 'generic' && isPhoneNumberRequired(template) && recipientOrPhone) {
        const confirmMessage = `确定要向 "${recipientOrPhone}" 发送消息吗？\n配置: ${webhookConfig.name}\n内容: ${messageContent.substring(0,30)}...`;
        confirmed = await customConfirm(confirmMessage, '发送确认');
    } else if (template.type === 'workweixin' && recipientOrPhone.toLowerCase() === '@all' && messageContent) {
        confirmed = await customConfirm(`确定要向所有人 (@all) 发送此企业微信消息吗？\n配置: ${webhookConfig.name}\n内容: ${messageContent.substring(0,30)}...`, '发送给所有人确认');
    } else {
        confirmed = true;
    }

    if (!confirmed) { console.log("[handleSendNow] 用户取消发送。"); return; }

    isSending = true;
    if(sendNowBtn) { sendNowBtn.textContent = '发送中...'; sendNowBtn.disabled = true; }

    const payloadForApiSendNow = {
        id: webhookConfig.id,
        templateId: template.id,
        phone: recipientOrPhone,
        plainBody: messageContent,
        headers: webhookConfig.headers
    };
    console.log("[handleSendNow] 发送给 /api/send-now 的负载:", JSON.stringify(payloadForApiSendNow));

    try {
        const resultEntry = await apiRequest('/api/send-now', { method: 'POST', body: JSON.stringify(payloadForApiSendNow) });
        console.log("[handleSendNow] /api/send-now 响应:", resultEntry);
        if (!history[resultEntry.webhookId]) history[resultEntry.webhookId] = [];
        history[resultEntry.webhookId].unshift(resultEntry);
        if (history[resultEntry.webhookId].length > 50) {
            history[resultEntry.webhookId] = history[resultEntry.webhookId].slice(0, 50);
        }
        setActiveTab('history', true);
    } catch (error) {
        console.error('[handleSendNow] 发送失败 (catch块):', error);
        await customAlert(`发送失败: ${error.data?.message || error.message || '未知错误'}`);
    } finally {
        isSending = false;
        if(sendNowBtn) { sendNowBtn.textContent = '立即发送'; sendNowBtn.disabled = false; }
        console.log("[handleSendNow] 发送流程结束。");
    }
}
async function handleSaveTask() {
    console.log("[handleSaveTask] 尝试保存定时任务。");
    if (!selectedWebhookId) { await customAlert("请先选择一个发送配置。"); return; }
    const webhookConfig = webhooks.find(wh => wh.id === selectedWebhookId);
    if (!webhookConfig) { await customAlert("未找到选中的发送配置。"); return; }

    const template = webhookUrlTemplates.find(t => t.id === webhookConfig.templateId);
    if (!template) { await customAlert("请为此发送配置选择一个有效的地址模板。"); return; }

    const scheduledDateTimeValue = scheduleDatetimeInput.value;
    if (!scheduledDateTimeValue) { await customAlert("请选择一个发送日期和时间。"); scheduleDatetimeInput.focus(); return; }
    const scheduledTime = new Date(scheduledDateTimeValue);
    if (isNaN(scheduledTime.getTime()) || scheduledTime <= new Date()) {
        await customAlert("请选择一个有效的未来时间点。"); scheduleDatetimeInput.focus(); return;
    }

    const recipientOrPhone = phoneNumberInput.value.trim();
    const messageContent = webhookBodyTextarea.value.trim();

    if (template.type === 'workweixin') {
        if (!recipientOrPhone) { await customAlert('企业微信模板需要接收者 (touser/@all) 以创建定时任务。'); phoneNumberInput.focus(); return; }
        if (!messageContent && (template.workweixin_msgtype === 'text' || template.workweixin_msgtype === 'markdown')) {
             await customAlert('请输入消息内容以创建定时任务。'); webhookBodyTextarea.focus(); return;
        }
    } else {
        if (!template.url || template.url.trim() === '') { await customAlert('无法创建定时任务：所选地址模板没有有效的URL。'); return; }
        if (isPhoneNumberRequired(template) && !recipientOrPhone) {
             await customAlert('当前模板需要手机号码/目标参数才能创建定时任务，请输入。'); phoneNumberInput.focus(); return;
        }
    }

    const taskPayloadForApi = {
        originalWebhookId: selectedWebhookId,
        scheduledTime: scheduledTime.toISOString(),
        templateType: template.type,
        webhookSnapshot: {
            name: webhookConfig.name,
            templateId: template.id,
            method: template.method,
            headers: webhookConfig.headers,
            plainBody: messageContent,
            phoneNumber: recipientOrPhone,
            bodyTemplate: template.bodyTemplate,
            url: template.url,
            touser: recipientOrPhone,
            workweixin_msgtype: template.workweixin_msgtype
        },
        finalUrl: null,
        workweixinConfig: null
    };

    if (template.type === 'generic') {
        let finalUrl = template.url;
        finalUrl = finalUrl.replace(/{phoneNumber}|{phone}/g, (recipientOrPhone || "").replace(/"/g, '\\"'));
        taskPayloadForApi.finalUrl = finalUrl.trim();
        delete taskPayloadForApi.webhookSnapshot.touser;
        delete taskPayloadForApi.webhookSnapshot.workweixin_msgtype;
    } else {
        taskPayloadForApi.workweixinConfig = {
            corpid: template.workweixin_corpid,
            agentid: template.workweixin_agentid,
            touser: recipientOrPhone,
            msgtype: template.workweixin_msgtype
        };
        taskPayloadForApi.webhookSnapshot.url = "WORKWEIXIN_APP_MESSAGE_API";
        delete taskPayloadForApi.webhookSnapshot.method;
        delete taskPayloadForApi.webhookSnapshot.headers;
        delete taskPayloadForApi.webhookSnapshot.bodyTemplate;
        delete taskPayloadForApi.webhookSnapshot.phoneNumber;
    }
    console.log("[handleSaveTask] 发送给 /api/schedule-task 的负载:", JSON.stringify(taskPayloadForApi));

    try {
        const response = await apiRequest('/api/schedule-task', {
            method: 'POST',
            body: JSON.stringify(taskPayloadForApi)
        });
        console.log("[handleSaveTask] /api/schedule-task 响应:", response);
        if (response.success && response.taskId) {
            await customAlert(`定时任务已保存！\nID: ${response.taskId}\n计划时间: ${formatDate(taskPayloadForApi.scheduledTime)}`);
            if(scheduleDatetimeInput) scheduleDatetimeInput.value = '';
            if (response.scheduledTasks) {
                scheduledTasks = response.scheduledTasks;
            } else {
                const data = await apiRequest('/api/data');
                if (data) scheduledTasks = data.scheduledTasks || [];
            }
            renderScheduledTaskList();
        } else {
            throw new Error(response.message || '保存定时任务失败');
        }
    } catch (error) {
        console.error("[handleSaveTask] 保存定时任务失败 (catch块):", error);
        await customAlert(`保存定时任务失败: ${error.data?.message || error.message || error}`);
    }
}
function renderHeaders(headersArray, listEl, keyClass, valueClass, removeClass, focusColor = 'indigo') {
    if (!listEl) return;
    listEl.innerHTML = '';
    (headersArray || []).forEach((header, index) => {
        const div = document.createElement('div');
        div.className = 'flex items-center space-x-2 mb-2 header-item';
        div.innerHTML = `
            <input type="text" value="${header.key || ''}" placeholder="Key" class="${keyClass} w-1/3 bg-[#1a1d24] border border-gray-600 rounded px-3 py-1.5 text-white focus:outline-none focus:border-${focusColor}-500 focus:ring-1 focus:ring-${focusColor}-500">
            <input type="text" value="${header.value || ''}" placeholder="Value" class="${valueClass} flex-grow bg-[#1a1d24] border border-gray-600 rounded px-3 py-1.5 text-white focus:outline-none focus:border-${focusColor}-500 focus:ring-1 focus:ring-${focusColor}-500">
            <button data-header-index="${index}" class="${removeClass} text-red-500 hover:text-red-400 focus:outline-none p-1 rounded hover:bg-red-500/20 transition-colors">&#x2715;</button>
        `;
        listEl.appendChild(div);
    });
}
function setActiveTab(tabName, forceRender = false) {
    console.log(`[setActiveTab] ENTER. Tab: ${tabName}, forceRender: ${forceRender}, currentActiveTab: ${currentActiveTab}, currentView: ${currentView}`);

    if (currentActiveTab === tabName && !forceRender && editorTabs && editorTabs.length > 0) {
        const currentActiveButton = Array.from(editorTabs).find(tab => tab.dataset.tab === tabName);
        const activeColorCheck = currentView === 'templates' ? 'teal' : 'indigo';
        if (currentActiveButton && currentActiveButton.classList.contains('text-white') && currentActiveButton.classList.contains(`border-${activeColorCheck}-500`)) {
            console.log(`[setActiveTab] Tab ${tabName} already active and styled. Exiting.`);
            return;
        }
    }
    currentActiveTab = tabName;
    const activeColor = currentView === 'templates' ? 'teal' : 'indigo';

    if (editorTabs) {
        editorTabs.forEach(tab => {
            const isTabActive = tab.dataset.tab === tabName;
            tab.classList.toggle(`border-${activeColor}-500`, isTabActive);
            tab.classList.toggle('text-white', isTabActive);
            tab.classList.toggle('text-gray-400', !isTabActive);
            tab.classList.toggle('border-transparent', !isTabActive);
        });
    } else {
        console.warn("[setActiveTab] editorTabs NodeList is null or empty.");
    }

    console.log("[setActiveTab] About to define localPaneMap. DOM elements check:");
    console.log({ tabContentBody, tabContentHeaders, tabContentSchedule, tabContentHistory });

    const localPaneMap = {
        body: tabContentBody,
        headers: tabContentHeaders,
        schedule: tabContentSchedule,
        history: tabContentHistory
    };

    if (!localPaneMap) {
        console.error("[setActiveTab] CRITICAL: localPaneMap is somehow undefined immediately after declaration!");
        return;
    }
    console.log("[setActiveTab] localPaneMap defined:", localPaneMap);

    Object.keys(localPaneMap).forEach(key => {
        const pane = localPaneMap[key];
        if (pane && typeof pane.classList !== 'undefined') {
            pane.classList.add('hidden');
        } else {
            console.warn(`[setActiveTab] Pane for key '${key}' is invalid or missing classList. Value:`, pane);
        }
    });
    console.log("[setActiveTab] All panes hidden (attempted).");

    if (localPaneMap.hasOwnProperty(tabName)) {
        const activePane = localPaneMap[tabName];
        if (activePane && typeof activePane.classList !== 'undefined') {
            activePane.classList.remove('hidden');
            activePane.classList.add('flex', 'flex-col');
            console.log(`[setActiveTab] Active pane for tab '${tabName}' made visible.`);

            if (['body', 'headers', 'schedule', 'history'].includes(tabName)) {
                activePane.classList.add('flex-grow');
            }

            if (tabName === 'history') {
                console.log("[setActiveTab] Rendering history log for selected webhook:", selectedWebhookId);
                renderHistoryLog(selectedWebhookId);
            }
            if (tabName === 'schedule') {
                console.log("[setActiveTab] Rendering scheduled task list.");
                renderScheduledTaskList();
            }
        } else {
            console.error(`[setActiveTab] Active pane for tab '${tabName}' is invalid or missing classList. Value:`, activePane);
        }
    } else {
        console.warn(`[setActiveTab] Tab name "${tabName}" is not a valid key in localPaneMap.`);
    }
    console.log(`[setActiveTab] EXIT for tab ${tabName}.`);
}
async function handleCancelTask(taskId) {
    console.log(`[handleCancelTask] 取消定时任务ID: ${taskId}`);
    if (await customConfirm("确定要取消这个定时任务吗？", "取消定时任务")) {
        console.log(`[handleCancelTask] 用户确认取消任务 ID: ${taskId}`);
        try {
            const response = await apiRequest(`/api/schedule-task/${taskId}`, { method: 'DELETE' });
            console.log("[handleCancelTask] 后端取消响应:", response);
            if (response.success) {
                await customAlert("定时任务已取消。");
                if (response.scheduledTasks) {
                    scheduledTasks = response.scheduledTasks;
                } else {
                    const data = await apiRequest('/api/data');
                    if (data) scheduledTasks = data.scheduledTasks || [];
                }
                renderScheduledTaskList();
            } else {
                throw new Error(response.message || "取消任务失败");
            }
        } catch (error) {
            console.error("[handleCancelTask] 取消任务失败 (catch块):", error);
            await customAlert(`取消任务失败: ${error.data?.message || error.message || error}`);
        }
    }
}
function renderHistoryLog(webhookIdToRender) {
    console.log(`[renderHistoryLog] 渲染历史记录，配置ID: ${webhookIdToRender}`);
    if (!historyLogListEl) { console.warn("[renderHistoryLog] historyLogListEl is null"); return; }
    if (!webhookIdToRender) {
        historyLogListEl.innerHTML = '<p class="text-center text-gray-400 py-8 text-sm">请先选择一个发送配置以查看历史。</p>';
        return;
    }
    historyLogListEl.innerHTML = '';
    const logs = history[webhookIdToRender] || [];
    if (logs.length === 0) {
        historyLogListEl.innerHTML = '<p class="text-center text-gray-400 py-8 text-sm">还没有发送记录</p>';
        return;
    }
    logs.forEach(entry => {
        const div = document.createElement('div');
        div.className = 'bg-[#1a1d24] p-3 rounded shadow-sm border border-gray-700/50';
        let sClass = 'text-yellow-400', sText = '发送中... (状态未知)';
        if (entry.status === 'success') {
            sClass = 'text-green-400';
            sText = `成功 (${entry.response?.status || (entry.response?.data?.errcode === 0 ? '企微OK' : 'N/A')})`;
        } else if (entry.status === 'failure') {
            sClass = 'text-red-400';
            let errorCode = entry.error?.code || entry.error?.status || (entry.error?.data?.errcode);
            if (errorCode === undefined && entry.error?.name === 'AxiosError' && !entry.error?.response) errorCode = "NET_ERR";
            sText = `失败 (${errorCode || 'N/A'})`;
        }

        const taskName = entry.request?.name || 'N/A';
        const plainBodyContent = entry.request?.plainBody || entry.request?.body || '(未记录纯文本或非文本)';
        const messagePreview = typeof plainBodyContent === 'string' ? (plainBodyContent.length > 20 ? plainBodyContent.substring(0, 20) + '...' : plainBodyContent) : '(非文本内容)';

        const requestSnapshot = entry.request || {};
        const responseSnapshot = entry.response || entry.error || {};

        let urlToDisplayInHistory = "URL 未知";
        let urlTitleForHistory = "URL 未知";

        let actualUrlForTitle = "";
        if (requestSnapshot.urlForDisplay) {
            actualUrlForTitle = requestSnapshot.urlForDisplay;
        } else if (requestSnapshot.webhookSnapshot && requestSnapshot.webhookSnapshot.decryptedOriginalUrl) {
            actualUrlForTitle = requestSnapshot.webhookSnapshot.decryptedOriginalUrl;
        } else if (requestSnapshot.templateType === 'workweixin') {
            actualUrlForTitle = "企业微信接口 (自动处理)";
        }

        if (currentUser && currentUser.role !== 'admin' && requestSnapshot.templateType !== 'workweixin') {
            urlToDisplayInHistory = "[URL对普通用户隐藏]";
            urlTitleForHistory = "[URL对普通用户隐藏]";
        } else {
            const displayable = getDisplayableUrl(actualUrlForTitle, requestSnapshot.templateType === 'workweixin');
            urlToDisplayInHistory = displayable.text;
            if (currentUser && currentUser.role !== 'admin' && requestSnapshot.templateType !== 'workweixin') {
                 urlTitleForHistory = displayable.text;
            } else {
                 urlTitleForHistory = displayable.title;
            }
        }


        div.innerHTML = `
            <div class="flex justify-between items-center cursor-pointer history-log-header">
                <div class="flex items-center flex-grow min-w-0">
                    <span class="font-semibold text-sm ${sClass} flex-shrink-0 mr-2">● ${sText}</span>
                    <span class="text-xs text-gray-300 truncate" style="max-width: 200px;" title="${typeof plainBodyContent === 'string' ? plainBodyContent : '(非文本内容)'}">${messagePreview}</span>
                </div>
                <div class="flex items-center flex-shrink-0 ml-2">
                    <span class="text-xs text-gray-500">${formatDate(entry.timestamp)}</span>
                    <span class="text-xs text-gray-500 transform transition-transform duration-200 history-arrow ml-2">&#x25BC;</span>
                </div>
            </div>
            <div class="history-details mt-3 pt-3 border-t border-gray-700 hidden bg-black/20 p-2 rounded max-h-96 overflow-y-auto">
                <p class="text-xs text-gray-400 mb-1">配置名称: <span class="text-gray-200">${taskName}</span></p>
                <h4 class="font-semibold mb-1 text-gray-300 text-xs mt-2">原始发送内容 (PlainBody):</h4>
                <pre class="text-xs text-gray-400 whitespace-pre-wrap mb-2 bg-[#1e2128] p-1.5 rounded">${typeof plainBodyContent === 'string' ? plainBodyContent : '(非文本内容)'}</pre>
                <h4 class="font-semibold mb-1 text-gray-300 text-xs mt-2">请求详情 (快照):</h4>
                <pre class="text-xs text-gray-400 whitespace-pre-wrap mb-2 bg-[#1e2128] p-1.5 rounded" title="${urlTitleForHistory}">URL: ${urlToDisplayInHistory}\nMethod: ${requestSnapshot.method || 'N/A'}\nHeaders: ${JSON.stringify(requestSnapshot.headers, null, 2)}\nActual Sent Body: ${typeof requestSnapshot.actualSentBody === 'object' ? JSON.stringify(requestSnapshot.actualSentBody, null, 2) : (requestSnapshot.actualSentBody || '(空或非JSON)')}</pre>
                <h4 class="font-semibold mb-1 text-gray-300 text-xs mt-2">响应/错误详情:</h4>
                <pre class="text-xs text-gray-400 whitespace-pre-wrap bg-[#1e2128] p-1.5 rounded">${JSON.stringify(responseSnapshot, null, 2)}</pre>
            </div>`;
        historyLogListEl.appendChild(div);
    });
}
function renderScheduledTaskList() {
    console.log("[renderScheduledTaskList] 开始渲染定时任务列表。");
    if (!scheduledTaskListEl) return;
    scheduledTaskListEl.innerHTML = '';

    const userTasks = scheduledTasks.filter(task => task.userId === currentUser.id);

    if (userTasks.length === 0) {
        scheduledTaskListEl.innerHTML = '<p class="text-center text-gray-400 py-8 text-sm">当前没有待执行的定时任务</p>';
        return;
    }

    [...userTasks].sort((a, b) => new Date(a.scheduledTime) - new Date(b.scheduledTime)).forEach(task => {
        const div = document.createElement('div');
        div.className = 'bg-[#1a1d24] p-3 rounded shadow-sm border border-gray-700/50 flex justify-between items-center mb-2';

        const taskInfo = document.createElement('div');
        taskInfo.className = 'flex-grow mr-2 min-w-0';

        const configName = task.webhookSnapshot?.name || '基于未知配置';
        const originalWhId = task.originalWebhookId || '未知ID';

        let displayIdentifier = "目标未知";
        let titleForIdentifier = "目标未知";

        if (task.templateType === 'workweixin') {
            const touser = task.webhookSnapshot?.touser || task.workweixinConfig?.touser || "未指定接收者";
            displayIdentifier = `企微接收: ${touser}`;
            titleForIdentifier = `企业微信任务，接收者: ${touser}`;
        } else if (task.finalUrl) {
            if (currentUser && currentUser.role !== 'admin') {
                const displayable = getDisplayableUrl(task.finalUrl, false);
                displayIdentifier = `URL: ${displayable.text}`;
                titleForIdentifier = displayable.text;
            } else {
                const displayableUrlInfo = getDisplayableUrl(task.finalUrl, false);
                displayIdentifier = `URL: ${displayableUrlInfo.text}`;
                titleForIdentifier = displayableUrlInfo.title;
            }
        }


        let contentPreview = task.webhookSnapshot?.plainBody || '(无内容)';
        const fullContentPreview = contentPreview;
        if (contentPreview.length > 30) { contentPreview = contentPreview.substring(0,30) + '...'; }

        taskInfo.innerHTML = `
            <p class="text-sm text-gray-200 font-semibold truncate" title="基于配置: ${configName} (ID: ${originalWhId})">发送到: <span class="font-normal">${configName}</span></p>
            <p class="text-xs text-indigo-300 truncate" title="${titleForIdentifier}">目标: <span class="font-normal text-gray-400">${displayIdentifier}</span></p>
            <p class="text-xs text-gray-400">计划时间: ${formatDate(task.scheduledTime)}</p>
            <p class="text-xs text-gray-500 truncate" title="${fullContentPreview}">内容: ${contentPreview}</p>
        `;

        const cancelButton = document.createElement('button');
        cancelButton.dataset.taskId = task.id;
        cancelButton.className = 'cancel-task-btn bg-red-600 hover:bg-red-700 text-white text-xs font-bold py-1 px-3 rounded focus:outline-none transition-colors flex-shrink-0';
        cancelButton.textContent = '取消';

        div.appendChild(taskInfo);
        div.appendChild(cancelButton);
        scheduledTaskListEl.appendChild(div);
    });
}

// --- 用户管理功能 (管理员) ---
async function fetchAndRenderUsers() {
    console.log("[fetchAndRenderUsers] 获取并渲染用户列表。");
    if (!currentUser || currentUser.role !== 'admin' || !userListContainer) return;
    userListContainer.innerHTML = '<p class="text-center text-gray-500">正在加载用户列表...</p>';
    try {
        const users = await apiRequest('/api/users');
        usersList = users || [];
        renderUserList();
    } catch (error) {
        console.error("获取用户列表失败:", error);
        userListContainer.innerHTML = `<p class="text-center text-red-400">加载用户列表失败: ${error.data?.message || error.message}</p>`;
    }
}
function renderUserList() {
    console.log("[renderUserList] 开始渲染用户列表。");
    if (!userListContainer || !currentUser || currentUser.role !== 'admin') return;
    userListContainer.innerHTML = '';

    if (usersList.length === 0) {
        userListContainer.innerHTML = '<p class="text-center text-gray-500 py-4">系统中没有其他用户。</p>';
        return;
    }

    const ul = document.createElement('ul');
    ul.className = 'space-y-2';
    usersList.forEach(user => {
        const li = document.createElement('li');
        li.className = 'bg-[#2f3241] p-3 rounded shadow-sm flex justify-between items-center';
        li.innerHTML = `
            <div>
                <p class="text-sm font-semibold text-gray-100">${user.username} <span class="text-xs text-gray-400">(${user.role})</span></p>
                <p class="text-xs text-gray-500">ID: ${user.id}</p>
                ${user.mustChangePassword ? '<p class="text-xs text-yellow-400">需修改密码</p>' : ''}
            </div>
            <div>
                ${currentUser.id !== user.id && user.username !== 'admin' ?
                `<button data-user-id="${user.id}" data-username="${user.username}" class="delete-user-btn text-red-500 hover:text-red-400 text-xs py-1 px-2 rounded hover:bg-red-500/20">删除</button>`
                : (currentUser.id === user.id ? '<span class="text-xs text-gray-600">(当前用户)</span>' : (user.username === 'admin' ? '<span class="text-xs text-gray-600">(系统管理员)</span>' : ''))
                }
            </div>
        `;
        ul.appendChild(li);
    });
    userListContainer.appendChild(ul);

    ul.querySelectorAll('.delete-user-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const userIdToDelete = e.target.dataset.userId;
            const usernameToDelete = e.target.dataset.username;
            if (await customConfirm(`确定要删除用户 "${usernameToDelete}" (ID: ${userIdToDelete}) 吗？此操作不可撤销，且会删除该用户的所有相关数据！`, "删除用户确认")) {
                handleDeleteUser(userIdToDelete);
            }
        });
    });
}
async function handleShowAddUserForm() {
    console.log("[handleShowAddUserForm] 显示添加用户表单。");
    if (!currentUser || currentUser.role !== 'admin') return;
    if (addUserForm) {
        addUserForm.classList.remove('hidden');
        if(newUsernameInput) newUsernameInput.value = '';
        if(newPasswordInput) newPasswordInput.value = '';
        if(newUserRoleSelect) newUserRoleSelect.value = 'user';
    }
}
async function handleHideAddUserForm() {
    console.log("[handleHideAddUserForm] 隐藏添加用户表单。");
    if (addUserForm) {
        addUserForm.classList.add('hidden');
    }
}
async function handleAddUserFormSubmit(event) {
    console.log("[handleAddUserFormSubmit] 提交添加用户表单。");
    event.preventDefault();
    if (!currentUser || currentUser.role !== 'admin' || !newUsernameInput || !newPasswordInput || !newUserRoleSelect) return;

    const username = newUsernameInput.value.trim();
    const password = newPasswordInput.value.trim();
    const role = newUserRoleSelect.value;

    if (!username || !password) {
        await customAlert("用户名和密码不能为空。");
        return;
    }
    if (password.length < 6) {
        await customAlert("密码长度至少为6位。");
        return;
    }

    try {
        const response = await apiRequest('/api/users', {
            method: 'POST',
            body: JSON.stringify({ username, password, role })
        });
        if (response.success || response.user) {
            await customAlert(`用户 "${username}" 创建成功！新用户首次登录时需要修改密码。`);
            handleHideAddUserForm();
            await fetchAndRenderUsers();
        } else {
            throw new Error(response.message || "创建用户失败");
        }
    } catch (error) {
        console.error("创建用户失败:", error);
        await customAlert(`创建用户失败: ${error.data?.message || error.message || error}`);
    }
}
async function handleDeleteUser(userIdToDelete) {
    console.log(`[handleDeleteUser] 删除用户ID: ${userIdToDelete}`);
    if (!currentUser || currentUser.role !== 'admin') return;
    try {
        const response = await apiRequest(`/api/users/${userIdToDelete}`, { method: 'DELETE' });
        if (response.success) {
            await customAlert(response.message || "用户已删除。");
            await fetchAndRenderUsers();
        } else {
            throw new Error(response.message || "删除用户失败");
        }
    } catch (error) {
        console.error("删除用户失败:", error);
        await customAlert(`删除用户失败: ${error.data?.message || error.message || error}`);
    }
}


// --- 应用初始化 ---
async function initApp() {
    console.log("[App] initApp: 开始初始化...");
    window.getUUID = function() { return crypto.randomUUID(); };

    try {
        const userData = await apiRequest('/api/auth/me');
        console.log("[App] initApp: /api/auth/me 响应:", userData);
        if (userData && userData.id) {
            currentUser = userData;
            console.log("[App] initApp: 当前用户已获取:", JSON.stringify(currentUser));
            if (userInfoSpan) userInfoSpan.textContent = `用户: ${currentUser.username} (${currentUser.role})`;
            if (currentUser.mustChangePassword) {
                console.warn('[App] initApp: 用户需要修改密码，重定向。');
                sessionStorage.setItem('forcePasswordChange', 'true');
                window.location.href = '/change-password.html';
                return;
            }
        } else {
            console.warn('[App] initApp: 未能获取用户信息或用户未认证，重定向到登录页。');
            window.location.href = '/login.html';
            return;
        }
    } catch (error) {
        console.error('[App] initApp: 认证检查时发生错误:', error.message);
        if (!window.location.pathname.endsWith('/login.html') && !window.location.pathname.endsWith('/change-password.html')) {
             if (!error.message.includes('会话已过期') && !error.message.includes('需要修改密码')) {
                window.location.href = '/login.html?reason=app_init_failed_auth_check';
             }
        }
        return;
    }

    console.log("[App] initApp: 用户已认证，继续UI设置。");
    if (currentUser && currentUser.role !== 'admin') {
        if (navTemplateViewBtn) navTemplateViewBtn.classList.add('hidden');
        if (navUserManagementBtn) navUserManagementBtn.classList.add('hidden');
        if (newTemplateBtn) newTemplateBtn.classList.add('hidden');
        const globalCheckboxContainer = document.getElementById('template-is-global-container');
        if(globalCheckboxContainer) globalCheckboxContainer.classList.add('hidden');

    } else if (currentUser && currentUser.role === 'admin') {
        if (navTemplateViewBtn) navTemplateViewBtn.classList.remove('hidden');
        if (navUserManagementBtn) navUserManagementBtn.classList.remove('hidden');
         const globalCheckboxContainer = document.getElementById('template-is-global-container');
        if(globalCheckboxContainer) globalCheckboxContainer.classList.remove('hidden');
    }
    console.log("[App] initApp: UI角色调整完成。");

    console.log("[App] initApp: 开始附加主事件监听器...");
    if (logoutButton) {
        logoutButton.addEventListener('click', async () => {
            console.log('[Event] 登出按钮点击。');
            try {
                await apiRequest('/api/auth/logout', { method: 'POST' });
                console.log('[Event] 登出API请求成功。');
                currentUser = null;
                if (userInfoSpan) userInfoSpan.textContent = '';
                window.location.href = '/login.html';
            } catch (error) {
                console.error("[Event] 登出失败:", error);
                await customAlert(`登出失败: ${error.data?.message || error.message || error}`);
            }
        });
    }
    if(navSenderViewBtn) navSenderViewBtn.addEventListener('click', () => { console.log('[Event] 点击导航: 发送配置'); showView('sender'); });
    if(navTemplateViewBtn) {
        navTemplateViewBtn.addEventListener('click', () => {
            console.log('[Event] 点击导航: 地址模板');
            if (currentUser.role === 'admin') {
                showView('templates');
            } else {
                customAlert("普通用户无权管理地址模板。您可以在新建发送配置时选择管理员共享的模板。");
                showView(currentView === 'templates' ? 'sender' : currentView);
            }
        });
    }
    if(navUserManagementBtn) {
         navUserManagementBtn.addEventListener('click', () => {
            console.log('[Event] 点击导航: 用户管理');
            if (currentUser.role === 'admin') {
                showView('user-management');
            } else {
                customAlert("权限不足。");
            }
        });
    }
    if(aboutButton) aboutButton.addEventListener('click', () => { console.log('[Event] 点击关于按钮'); showView(currentView, true); });
    if(closeAboutViewBtn) closeAboutViewBtn.addEventListener('click', () => { console.log('[Event] 点击关闭关于按钮'); showView(currentView); });

    if (currentUser.role === 'admin') {
        if(templateTypeSelect) templateTypeSelect.addEventListener('change', () => { console.log('[Event] 模板类型更改'); renderTemplateEditor(); });
        if(newTemplateBtn) newTemplateBtn.addEventListener('click', handleNewTemplate);
        if(templateListEl) templateListEl.addEventListener('click', async e => {
            console.log('[Event] 点击模板列表项。目标:', e.target);
            const deleteBtn = e.target.closest('.delete-template-btn');
            const listItem = e.target.closest('li[data-id]');
            if (deleteBtn) { e.stopPropagation(); console.log(`[Event] 点击删除模板按钮，ID: ${deleteBtn.dataset.deleteId}`); await handleDeleteTemplate(deleteBtn.dataset.deleteId); }
            else if (listItem) { console.log(`[Event] 点击选择模板列表项，ID: ${listItem.dataset.id}`); await handleSelectTemplate(listItem.dataset.id); }
        });
        if(saveTemplateBtn) saveTemplateBtn.addEventListener('click', () => { console.log('[Event] 点击保存模板按钮'); saveCurrentTemplateChanges(false);});
        if(addTemplateHeaderBtnInTemplates) addTemplateHeaderBtnInTemplates.addEventListener('click', () => {
            console.log('[Event] 点击模板编辑器中的添加请求头按钮');
            const currentTemplateId = selectedTemplateId;
            const template = currentTemplateId ? webhookUrlTemplates.find(t => t.id === currentTemplateId) : null;
            const isNewGeneric = !currentTemplateId && templateTypeSelect && templateTypeSelect.value === 'generic';

            if (template && template.type === 'generic') {
                if(!template.headers) template.headers = [];
                template.headers.push({key: '', value: ''});
                renderTemplateEditor();
            } else if (isNewGeneric) {
                const headersContainer = document.getElementById('template-headers-list');
                if (headersContainer) {
                     const div = document.createElement('div');
                     div.className = 'flex items-center space-x-2 mb-2 header-item';
                     div.innerHTML = `<input type="text" value="" placeholder="Key" class="template-header-key w-1/3 bg-[#1a1d24] border border-gray-600 rounded px-3 py-1.5 text-white focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"><input type="text" value="" placeholder="Value" class="template-header-value flex-grow bg-[#1a1d24] border border-gray-600 rounded px-3 py-1.5 text-white focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"><button class="remove-template-header-btn text-red-500 hover:text-red-400 focus:outline-none p-1 rounded hover:bg-red-500/20 transition-colors">&#x2715;</button>`;
                     headersContainer.appendChild(div);
                }
            } else if (template && template.type !== 'generic') {
                customAlert("请求头仅适用于通用类型模板。");
            } else {
                 customAlert("请先选择或保存一个通用类型模板。");
            }
        });
        if(templateHeadersListEl) templateHeadersListEl.addEventListener('click', e => {
            const btn = e.target.closest('.remove-template-header-btn');
            if (btn) {
                console.log('[Event] 点击模板编辑器中的移除请求头按钮');
                const index = parseInt(btn.dataset.headerIndex, 10);
                const template = webhookUrlTemplates.find(t => t.id === selectedTemplateId);
                if (template && template.type === 'generic' && template.headers && !isNaN(index) && index >= 0 && index < template.headers.length) {
                    template.headers.splice(index, 1);
                    renderTemplateEditor();
                } else if (!template && selectedTemplateId === null && templateTypeSelect && templateTypeSelect.value === 'generic') {
                    const itemToRemove = btn.closest('.header-item');
                    if (itemToRemove) itemToRemove.remove();
                }
            }
        });
    }

    if(newWebhookBtn) newWebhookBtn.addEventListener('click', handleNewWebhook);
    if(webhookListEl) webhookListEl.addEventListener('click', async e => {
        console.log('[Event] 点击发送配置列表项。目标:', e.target);
        const deleteBtn = e.target.closest('.delete-webhook-btn');
        const listItem = e.target.closest('li[data-id]');
        if (deleteBtn) { e.stopPropagation(); console.log(`[Event] 点击删除发送配置按钮，ID: ${deleteBtn.dataset.deleteId}`); await handleDeleteWebhook(deleteBtn.dataset.deleteId); }
        else if (listItem) { console.log(`[Event] 点击选择发送配置列表项，ID: ${listItem.dataset.id}`); await handleSelectWebhook(listItem.dataset.id); }
    });
    if(templateSelect) templateSelect.addEventListener('change', async () => {
        console.log('[Event] 发送配置中的模板选择器更改。');
        if (selectedWebhookId) {
            const webhook = webhooks.find(wh => wh.id === selectedWebhookId);
            if (webhook) {
                webhook.templateId = templateSelect.value || null;
                await saveCurrentWebhookChanges(true);
                renderWebhookEditor();
            }
        }
    });
    const urlVisibilityToggle = document.getElementById('toggle-url-visibility-btn');
    if (urlVisibilityToggle) {
        urlVisibilityToggle.addEventListener('click', () => {
             console.log('[Event] 点击URL可见性切换按钮。');
            const urlDisplay = document.getElementById('selected-template-url-display');
            if (!urlDisplay) return;
            const isMasked = urlDisplay.dataset.isMasked === 'true';
            const fullUrl = urlDisplay.dataset.fullUrl;
            const template = webhookUrlTemplates.find(t => t.id === templateSelect.value);
            const isWW = template && template.type === 'workweixin';

            if (isMasked) {
                urlDisplay.textContent = fullUrl;
                urlDisplay.dataset.isMasked = 'false';
                urlVisibilityToggle.innerHTML = eyeSlashIconSVG;
            } else {
                const displayInfo = getDisplayableUrl(fullUrl, isWW);
                urlDisplay.textContent = displayInfo.text;
                urlDisplay.dataset.isMasked = 'true';
                urlVisibilityToggle.innerHTML = eyeIconSVG;
            }
        });
    }


    if(sendNowBtn) sendNowBtn.addEventListener('click', handleSendNow);
    if(editorTabs) editorTabs.forEach(tab => tab.addEventListener('click', () => { console.log(`[Event] 点击编辑器标签页: ${tab.dataset.tab}`); setActiveTab(tab.dataset.tab);}));
    if(addHeaderBtn) addHeaderBtn.addEventListener('click', () => {
        console.log('[Event] 点击发送配置编辑器中的添加请求头按钮');
        const webhook = webhooks.find(wh => wh.id === selectedWebhookId);
        const template = webhook ? webhookUrlTemplates.find(t => t.id === webhook.templateId) : null;
        if(webhook && (!template || template.type === 'generic')) {
           if(!webhook.headers) webhook.headers = [];
           webhook.headers.push({key: '', value: ''});
           renderHeaders(webhook.headers, headersListEl, 'header-key-input', 'header-value-input', 'remove-header-btn', 'indigo');
       } else if (webhook && template && template.type === 'workweixin') {
           customAlert("企业微信类型配置不支持自定义请求头。");
       }
    });
    if(headersListEl) headersListEl.addEventListener('click', e => {
         const btn = e.target.closest('.remove-header-btn');
         if (btn) {
            console.log('[Event] 点击发送配置编辑器中的移除请求头按钮');
            const index = parseInt(btn.dataset.headerIndex, 10);
            const webhook = webhooks.find(wh => wh.id === selectedWebhookId);
            if (webhook && webhook.headers && !isNaN(index) && index >= 0 && index < webhook.headers.length) {
                webhook.headers.splice(index, 1);
                renderHeaders(webhook.headers, headersListEl, 'header-key-input', 'header-value-input', 'remove-header-btn', 'indigo');
            }
         }
    });
    if(historyLogListEl) historyLogListEl.addEventListener('click', e => {
        console.log('[Event] 点击历史记录列表项。目标:', e.target);
        const header = e.target.closest('.history-log-header');
        if (header && header.nextElementSibling) {
            console.log('[Event] 切换历史记录详情可见性。');
            header.nextElementSibling.classList.toggle('hidden');
            const arrow = header.querySelector('.history-arrow');
            if(arrow) arrow.classList.toggle('rotate-180');
        } else {
            console.log('[Event] 未找到历史记录头部或详情元素。');
        }
    });
    if(saveTaskBtn) saveTaskBtn.addEventListener('click', handleSaveTask);
    if(scheduledTaskListEl) scheduledTaskListEl.addEventListener('click', async (e) => {
        const cancelButton = e.target.closest('.cancel-task-btn');
        if (cancelButton && cancelButton.dataset.taskId) {
            console.log(`[Event] 点击取消定时任务按钮，ID: ${cancelButton.dataset.taskId}`);
            await handleCancelTask(cancelButton.dataset.taskId);
        }
    });
    if (refreshScheduledTasksBtn) refreshScheduledTasksBtn.addEventListener('click', async () => {
        console.log('[Event] 点击刷新定时任务列表按钮');
        if (isSending) { await customAlert("正在执行其他操作，请稍后再试。"); return; }
        console.log("刷新计划任务列表...");
        const originalBtnContent = refreshScheduledTasksBtn.innerHTML;
        refreshScheduledTasksBtn.disabled = true;
        refreshScheduledTasksBtn.textContent = "刷新中...";
        try {
            const data = await apiRequest('/api/data');
            if (data && data.scheduledTasks) {
                scheduledTasks = data.scheduledTasks;
                renderScheduledTaskList();
                await customAlert('任务列表已刷新。');
            } else {
                scheduledTasks = [];
                renderScheduledTaskList();
                await customAlert('任务列表已刷新 (可能为空)。');
            }
        } catch (error) {
            console.error("刷新任务列表失败:", error);
            await customAlert(`刷新任务列表失败: ${error.data?.message || error.message}`);
        } finally {
            isSending = false;
            refreshScheduledTasksBtn.disabled = false;
            refreshScheduledTasksBtn.innerHTML = originalBtnContent;
        }
    });

    if (currentUser.role === 'admin') {
        if(showAddUserFormBtnMain) showAddUserFormBtnMain.addEventListener('click', handleShowAddUserForm);
        const showAddUserFormBtnSidebar = document.getElementById('show-add-user-form-btn');
        if(showAddUserFormBtnSidebar) showAddUserFormBtnSidebar.addEventListener('click', handleShowAddUserForm);
        if(cancelAddUserBtn) cancelAddUserBtn.addEventListener('click', handleHideAddUserForm);
        if(addUserForm) addUserForm.addEventListener('submit', handleAddUserFormSubmit);
        if(refreshUserListBtn) refreshUserListBtn.addEventListener('click', fetchAndRenderUsers);
    }
    console.log("[App] initApp: 主事件监听器附加完成。");

    try {
        console.log("[App] initApp: 开始加载初始数据...");
        const data = await apiRequest('/api/data');
        if (data) {
            webhooks = data.webhooks || [];
            webhookUrlTemplates = data.webhookUrlTemplates || [];
            history = data.history || {};
            scheduledTasks = data.scheduledTasks || [];
            console.log(`[App] initApp: 初始数据已从服务器加载。模板数量: ${webhookUrlTemplates.length}, 发送配置数量: ${webhooks.length}`);
        } else {
            throw new Error("未能从服务器加载初始数据 (空响应)。");
        }
    } catch (error) {
        console.error("[App] initApp: 加载初始数据失败:", error.message);
        if (!error.message.includes('会话已过期') && !error.message.includes('需要修改密码')) {
            await customAlert(`加载应用数据失败: ${error.message}. 请尝试刷新页面。`);
        }
        return;
    }

    renderWebhookList();
    if (currentUser.role === 'admin') {
        renderTemplateList();
    }
    console.log("[App] initApp: 列表渲染完成。");

    if (webhooks.length > 0) {
        console.log("[App] initApp: 有发送配置，选择第一个。");
        await handleSelectWebhook(webhooks[0].id);
    } else if (currentUser.role === 'admin' && webhookUrlTemplates.length > 0) {
        console.log("[App] initApp: 无发送配置但有模板 (管理员)，切换到模板视图并选择第一个。");
        showView('templates');
        await handleSelectTemplate(webhookUrlTemplates[0].id);
    } else if (currentUser.role === 'admin') {
        console.log("[App] initApp: 无发送配置也无模板 (管理员)，切换到模板视图。");
        showView('templates');
        showWelcomeScreen('地址模板', '请从左侧列表选择一个，或点击“新建模板”。');
    }
    else {
        console.log("[App] initApp: 无发送配置 (普通用户)。");
        showView('sender');
        showWelcomeScreen('发送配置', '请从左侧列表选择一个，或点击“新建配置”。');
    }
    console.log(`[App] initApp: 初始化完成。当前视图: ${currentView}, 已选配置ID: ${selectedWebhookId}, 已选模板ID: ${selectedTemplateId}`);
}

// Initialize the application
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
