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
    const defaultHeaders = {};
    if (!(options.body instanceof FormData)) { // FormData sets its own Content-Type
        defaultHeaders['Content-Type'] = 'application/json';
    }
    options.headers = { ...defaultHeaders, ...options.headers };
    options.credentials = 'include'; // Ensures cookies (like HttpOnly auth token) are sent

    const response = await fetch(url, options);
    let responseData; // Will hold parsed JSON or error object
    const contentType = response.headers.get("content-type");

    if (response.status === 401) { // Unauthorized
        console.warn('API 请求未授权，可能需要重新登录。URL:', url);
        currentUser = null;
        if (userInfoSpan) userInfoSpan.textContent = '';
        sessionStorage.setItem('redirectTo', window.location.pathname + window.location.search);
        window.location.href = '/login.html?reason=session_expired';
        throw new Error('会话已过期或未授权，请重新登录。'); // Stop further processing
    }

    // Handle successful file download (octet-stream)
    if (response.ok && contentType && contentType.includes("application/octet-stream")) {
        return response; // Return raw Response object for blob processing by the caller
    }

    // For all other responses (JSON or text, success or error)
    let bodyText = '';
    try {
        // response.text() is a standard Fetch API method, should always exist on a Response object
        bodyText = await response.text();
        if (contentType && contentType.includes("application/json")) {
            responseData = JSON.parse(bodyText);
        } else {
            // If not JSON, treat the text as the message, especially for errors
            responseData = { message: bodyText || `服务器返回状态 ${response.status} 但响应体为空。` };
        }
    } catch (e) { // Catch errors from response.text() or JSON.parse()
        console.error("解析响应体时出错:", e, "原始文本:", bodyText);
        // If parsing fails, construct a meaningful error message
        if (!response.ok) {
            const error = new Error(`HTTP 错误 ${response.status}: ${response.statusText || '无法解析错误响应体'}`);
            error.status = response.status;
            error.data = { message: bodyText || `服务器返回状态 ${response.status} 但响应体解析失败。` };
            throw error;
        }
        // If response.ok but parsing failed (e.g. malformed JSON from an endpoint that should return JSON)
        responseData = { success: false, message: "服务器响应成功但内容格式错误。" };
        // This will then be caught by the !response.ok check below if success isn't explicitly true
    }

    if (!response.ok) {
        const errorMessage = responseData?.message || responseData?.error?.message || `请求失败，状态码: ${response.status}`;
        console.error(`API 请求失败 (${url}):`, errorMessage, responseData);

        if (response.status === 403 && responseData && responseData.error === 'PasswordChangeRequired') {
            console.warn('[apiRequest] 需要修改密码，重定向到修改密码页面。');
            sessionStorage.setItem('forcePasswordChange', 'true');
            window.location.href = '/change-password.html';
            throw new Error(responseData.message || '需要修改密码。'); // Stop further processing
        }

        const error = new Error(errorMessage);
        error.data = responseData;
        error.status = response.status;
        throw error;
    }
    
    // If response.ok and it wasn't an octet-stream, it's either parsed JSON or a text message wrapped in an object
    return responseData;
}

// --- 工具函数 ---
function formatDate(isoString) {
    if (!isoString) return 'N/A';
    return new Date(isoString).toLocaleString('zh-CN', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
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
        if (urlObj.search || urlObj.pathname.length > 10 || url.length > 60) {
            const masked = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname.substring(0,15)}... (已保存)`;
            return { text: masked, title: masked };
        }
        return { text: url, title: url };
    } catch (e) {
        if (url.length > 60) {
            const masked = url.substring(0, 30) + '... (格式可能无效)';
            return { text: masked, title: masked };
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
    if (!currentUser && !isAboutViewFlag && viewName !== 'login' && viewName !== 'change-password') {
        console.warn("showView called before currentUser is set, or trying to access restricted view.");
        return;
    }

    if (!isAboutViewFlag) {
        if (viewName === 'templates' && currentUser && currentUser.role !== 'admin') {
            console.warn("普通用户尝试访问模板视图，已阻止。");
            customAlert("权限不足，无法访问地址模板管理。");
            viewName = currentView === 'templates' ? 'sender' : currentView;
        }
        if (viewName === 'user-management' && currentUser && currentUser.role !== 'admin') {
            console.warn("普通用户尝试访问用户管理视图，已阻止。");
            customAlert("权限不足，无法访问用户管理。");
            viewName = currentView === 'user-management' ? 'sender' : currentView;
        }
        currentView = viewName;
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
            v.nav.classList.add('bg-transparent', `hover:bg-${v.color}-700`);
        }
    });

    if(welcomeScreen) welcomeScreen.classList.add('hidden'); welcomeScreen.classList.remove('flex');
    if(aboutView) aboutView.classList.add('hidden'); aboutView.classList.remove('flex');
    if(webhookEditorEl) webhookEditorEl.classList.add('hidden'); webhookEditorEl.classList.remove('flex');
    if(templateEditorEl) templateEditorEl.classList.add('hidden'); templateEditorEl.classList.remove('flex');
    if(userManagementView) userManagementView.classList.add('hidden'); userManagementView.classList.remove('flex');


    if (isAboutViewFlag) {
        if (aboutView) {
            aboutView.classList.remove('hidden');
            aboutView.classList.add('flex');
             Object.values(mainViews).forEach(v => {
                if (v.nav) {
                    v.nav.classList.remove(`bg-${v.color}-500`, 'text-white', `hover:bg-${v.color}-600`);
                    v.nav.classList.add('bg-transparent', `hover:bg-${v.color}-700`);
                }
            });
        }
    } else if (mainViews[viewName]) {
        const selectedMainView = mainViews[viewName];
        if (selectedMainView.main && selectedMainView.sidebar && selectedMainView.nav) {
            if ((viewName === 'templates' || viewName === 'user-management') && currentUser && currentUser.role !== 'admin') {
                 // Non-admin: do not show these views or sidebars
            } else {
                if (selectedMainView.main) { selectedMainView.main.classList.remove('hidden'); selectedMainView.main.classList.add('flex'); }
                if (selectedMainView.sidebar) { selectedMainView.sidebar.classList.remove('hidden'); selectedMainView.sidebar.classList.add('flex'); }
            }
            selectedMainView.nav.classList.add(`bg-${selectedMainView.color}-500`, 'text-white', `hover:bg-${selectedMainView.color}-600`);
            selectedMainView.nav.classList.remove('bg-transparent', `hover:bg-${selectedMainView.color}-700`);
        }

        if (viewName === 'sender') {
            if (selectedWebhookId && webhooks.some(w => w.id === selectedWebhookId)) {
                showEditor('webhook-editor');
            } else {
                showWelcomeScreen('发送配置', '请从左侧列表选择一个，或点击“新建配置”。');
            }
        } else if (viewName === 'templates' && currentUser && currentUser.role === 'admin') {
            if (selectedTemplateId && webhookUrlTemplates.some(t => t.id === selectedTemplateId)) {
                showEditor('template-editor');
            } else {
                showWelcomeScreen('地址模板', '请从左侧列表选择一个，或点击“新建模板”。');
            }
        } else if (viewName === 'user-management' && currentUser && currentUser.role === 'admin') {
            showEditor('user-management-editor');
            fetchAndRenderUsers();
        } else if ((viewName === 'templates' || viewName === 'user-management') && currentUser && currentUser.role !== 'admin'){
             showWelcomeScreen('发送配置', '权限不足。请从左侧列表选择一个发送配置。');
             currentView = 'sender';
             const senderNav = mainViews.sender.nav;
             if (senderNav) {
                senderNav.classList.add(`bg-${mainViews.sender.color}-500`, 'text-white', `hover:bg-${mainViews.sender.color}-600`);
                senderNav.classList.remove('bg-transparent', `hover:bg-${mainViews.sender.color}-700`);
                if(mainViews.sender.sidebar) {mainViews.sender.sidebar.classList.remove('hidden'); mainViews.sender.sidebar.classList.add('flex');}
                if(mainViews.sender.main) {mainViews.sender.main.classList.remove('hidden'); mainViews.sender.main.classList.add('flex');}
             }
        }
    } else {
         showWelcomeScreen('项目', '从左侧选择一个项目，或创建一个新的。');
    }
}
function showEditor(editorId) {
    if(webhookEditorEl) { webhookEditorEl.classList.add('hidden'); webhookEditorEl.classList.remove('flex'); }
    if(templateEditorEl) { templateEditorEl.classList.add('hidden'); templateEditorEl.classList.remove('flex'); }
    if(userManagementView) { userManagementView.classList.add('hidden'); userManagementView.classList.remove('flex');}
    if (aboutView) { aboutView.classList.add('hidden'); aboutView.classList.remove('flex'); }


    if (editorId === 'webhook-editor' && webhookEditorEl) {
        webhookEditorEl.classList.remove('hidden');
        webhookEditorEl.classList.add('flex');
    } else if (editorId === 'template-editor' && templateEditorEl && currentUser && currentUser.role === 'admin') {
        templateEditorEl.classList.remove('hidden');
        templateEditorEl.classList.add('flex');
    } else if (editorId === 'user-management-editor' && userManagementView && currentUser && currentUser.role === 'admin') {
        userManagementView.classList.remove('hidden');
        userManagementView.classList.add('flex');
    }
     else if ((editorId === 'template-editor' || editorId === 'user-management-editor') && (!currentUser || currentUser.role !== 'admin')) {
        console.warn("非管理员尝试访问受限编辑器。");
        customAlert("权限不足。");
        showWelcomeScreen('操作', '权限不足。');
        return;
    }
    if(welcomeScreen) { welcomeScreen.classList.add('hidden'); welcomeScreen.classList.remove('flex'); }
}
function showWelcomeScreen(viewContextName, message) {
    if(welcomeTitle) welcomeTitle.textContent = `没有选择${viewContextName}`;
    if(welcomeMessage) welcomeMessage.textContent = message;
    if(welcomeScreen) { welcomeScreen.classList.remove('hidden'); welcomeScreen.classList.add('flex'); }
    if(webhookEditorEl) { webhookEditorEl.classList.add('hidden'); webhookEditorEl.classList.remove('flex'); }
    if(templateEditorEl) { templateEditorEl.classList.add('hidden'); templateEditorEl.classList.remove('flex'); }
    if(userManagementView) { userManagementView.classList.add('hidden'); userManagementView.classList.remove('flex');}
    if (aboutView) { aboutView.classList.add('hidden'); aboutView.classList.remove('flex'); }
}

// --- 模板管理 ---
function updateTemplateEditorUIForType(currentType) {
    const isWorkWeixin = currentType === 'workweixin';
    if(workweixinFieldsContainer) workweixinFieldsContainer.classList.toggle('hidden', !isWorkWeixin);
    if(templateUrlContainer) templateUrlContainer.classList.toggle('hidden', isWorkWeixin);
    if(templateHeadersListEl && templateHeadersListEl.parentElement) {
        templateHeadersListEl.parentElement.classList.toggle('hidden', isWorkWeixin);
    }
    if (isWorkWeixin) {
        if(templateBodyLabel) templateBodyLabel.textContent = "消息内容模板 (企业微信):";
        if(templateBodyInput) templateBodyInput.placeholder = "例如: 您的消息: {userMessage}";
    } else {
        if(templateBodyLabel) templateBodyLabel.textContent = "请求体模板 (通用JSON, 可用 {phoneNumber} 和 {userMessage}):";
        if(templateBodyInput) templateBodyInput.placeholder = '例如: {"msgtype":"text","text":{"content":"{userMessage}"},"touser":"{phoneNumber}"}';
        if(templateUrlInput) templateUrlInput.placeholder = 'https://api.example.com/send/KEY_HERE?target={phoneNumber}';
        if(templateMethodSelect) templateMethodSelect.value = 'POST';
        if(templateHeadersListEl && (!selectedTemplateId || webhookUrlTemplates.find(t => t.id === selectedTemplateId)?.type !== 'generic')) {
             renderHeaders([], templateHeadersListEl, 'template-header-key', 'template-header-value', 'remove-template-header-btn', 'teal');
        }
    }
}
function renderTemplateList() {
    if(!templateListEl) return;
    templateListEl.innerHTML = '';
    if (!currentUser || currentUser.role !== 'admin') {
        templateListEl.innerHTML = '<li class="text-center text-gray-500 py-4">权限不足</li>';
        return;
    }
    if (webhookUrlTemplates.length === 0) {
        templateListEl.innerHTML = '<li class="text-center text-gray-500 py-4">无可用模板</li>';
        return;
    }
    webhookUrlTemplates.forEach(template => {
        const li = document.createElement('li');
        li.dataset.id = template.id;
        const typeIndicator = template.type === 'workweixin' ? '[企微] ' : '';
        li.className = `flex justify-between items-center px-3 py-2 my-1 rounded text-sm cursor-pointer hover:bg-gray-700/80 transition-colors ${template.id === selectedTemplateId ? 'bg-teal-600 shadow-md' : 'bg-gray-700/50'}`;
        li.innerHTML = `<span class="truncate text-gray-100">${typeIndicator}${template.name || '未命名模板'}</span><button data-delete-id="${template.id}" class="delete-template-btn text-gray-400 hover:text-red-500 ml-2 text-xs focus:outline-none p-1 rounded hover:bg-red-500/20 transition-colors">&#x2715;</button>`;
        templateListEl.appendChild(li);
    });
}
function renderTemplateEditor() {
    if (!currentUser || currentUser.role !== 'admin') {
        showWelcomeScreen('地址模板', '权限不足，无法编辑模板。');
        return;
    }
    const template = webhookUrlTemplates.find(t => t.id === selectedTemplateId);
    if (!template && selectedTemplateId === null && templateEditorEl && !templateEditorEl.classList.contains('hidden')) {
        if(!templateNameInput) { console.error("templateNameInput is null in renderTemplateEditor for new template"); return; }
        templateNameInput.value = `新模板 ${webhookUrlTemplates.length + 1}`;
        const currentDropdownType = templateTypeSelect ? templateTypeSelect.value : 'generic';
        if(templateTypeSelect) templateTypeSelect.value = currentDropdownType;
        updateTemplateEditorUIForType(currentDropdownType);
        if (currentDropdownType === 'workweixin') {
            if(workweixinCorpidInput) workweixinCorpidInput.value = '';
            if(workweixinCorpsecretInput) workweixinCorpsecretInput.value = '';
            if(workweixinCorpsecretInput) workweixinCorpsecretInput.placeholder = '输入新的应用密钥';
            if(workweixinAgentidInput) workweixinAgentidInput.value = '';
            if(workweixinMsgtypeSelect) workweixinMsgtypeSelect.value = 'text';
            if(templateBodyInput) templateBodyInput.value = '{userMessage}';
        } else {
            if(templateUrlInput) templateUrlInput.value = '';
            if(templateUrlInput) templateUrlInput.placeholder = 'https://api.example.com/send/KEY_HERE?target={phoneNumber}';
            if(templateMethodSelect) templateMethodSelect.value = 'POST';
            if(templateBodyInput) templateBodyInput.value = JSON.stringify({ msgtype: "text", text: { content: "{userMessage}" } }, null, 2);
            if(templateHeadersListEl) renderHeaders([], templateHeadersListEl, 'template-header-key', 'template-header-value', 'remove-template-header-btn', 'teal');
        }
        return;
    }
    if (!template) {
        showWelcomeScreen('地址模板', '请从左侧重新选择或新建一个模板。');
        return;
    }
    showEditor('template-editor');
    if(templateNameInput) templateNameInput.value = template.name || '';
    const templateTypeToRender = template.type || 'generic';
    if(templateTypeSelect) templateTypeSelect.value = templateTypeToRender;
    updateTemplateEditorUIForType(templateTypeToRender);
    if (templateTypeToRender === 'workweixin') {
        if(workweixinCorpidInput) workweixinCorpidInput.value = template.workweixin_corpid || '';
        if(workweixinCorpsecretInput) workweixinCorpsecretInput.value = '';
        if(workweixinCorpsecretInput) workweixinCorpsecretInput.placeholder = template.workweixin_corpsecret === '********' ? '密钥已保存，输入新密钥以替换' : '输入新的应用密钥';
        if(workweixinAgentidInput) workweixinAgentidInput.value = template.workweixin_agentid || '';
        if(workweixinMsgtypeSelect) workweixinMsgtypeSelect.value = template.workweixin_msgtype || 'text';
        if(templateBodyInput) templateBodyInput.value = template.bodyTemplate || '{userMessage}';
    } else {
        if(templateUrlInput) {
            templateUrlInput.value = template.url || '';
            templateUrlInput.placeholder = 'https://api.example.com/send/KEY_HERE?target={phoneNumber}';
        }
        if(templateMethodSelect) templateMethodSelect.value = template.method || 'POST';
        if(templateBodyInput) templateBodyInput.value = template.bodyTemplate || JSON.stringify({ msgtype: "text", text: { content: "{userMessage}" } }, null, 2);
        if(templateHeadersListEl) renderHeaders(template.headers, templateHeadersListEl, 'template-header-key', 'template-header-value', 'remove-template-header-btn', 'teal');
    }
}
async function handleNewTemplate() {
    if (currentUser && currentUser.role !== 'admin') { customAlert("权限不足"); return; }
    if (selectedTemplateId) await saveCurrentTemplateChanges();
    selectedTemplateId = null;
    if(templateTypeSelect) templateTypeSelect.value = 'generic';
    showEditor('template-editor');
    renderTemplateEditor();
}
async function handleSelectTemplate(templateId) {
    if (currentUser && currentUser.role !== 'admin') { customAlert("权限不足"); return; }
    if (selectedTemplateId === templateId && currentView === 'templates' && templateEditorEl && !templateEditorEl.classList.contains('hidden')) {
        return;
    }
    if (selectedTemplateId) await saveCurrentTemplateChanges();
    selectedTemplateId = templateId;
    showView('templates');
}
async function saveCurrentTemplateChanges() {
    if (currentUser && currentUser.role !== 'admin') { customAlert("权限不足"); return; }
    if (!templateEditorEl || templateEditorEl.classList.contains('hidden')) {
        return;
    }
    if (!templateNameInput || !templateTypeSelect || !workweixinCorpidInput || !workweixinCorpsecretInput || !workweixinAgentidInput || !workweixinMsgtypeSelect || !templateBodyInput || !templateUrlInput || !templateMethodSelect || !templateHeadersListEl) {
        console.error("[saveCurrentTemplateChanges] 一个或多个模板编辑器DOM元素未找到!");
        await customAlert("保存模板时发生错误：编辑器元素丢失。");
        return;
    }

    let templateToSave;
    let isNewTemplate = !selectedTemplateId;
    if (isNewTemplate) {
        templateToSave = { id: null };
    } else {
        const existingTemplate = webhookUrlTemplates.find(t => t.id === selectedTemplateId);
        if (!existingTemplate) { console.error("错误: 尝试保存不存在的模板。"); return; }
        templateToSave = { ...existingTemplate };
    }
    templateToSave.name = templateNameInput.value.trim() || (isNewTemplate ? `新模板 ${webhookUrlTemplates.length + 1}` : '未命名模板');
    templateToSave.type = templateTypeSelect.value;
    if (templateToSave.type === 'workweixin') {
        templateToSave.url = "WORKWEIXIN_APP_MESSAGE_API";
        templateToSave.method = "POST";
        templateToSave.workweixin_corpid = workweixinCorpidInput.value.trim();
        const secretInputVal = workweixinCorpsecretInput.value.trim();
        if (secretInputVal) {
            templateToSave.workweixin_corpsecret = secretInputVal;
        } else if (!isNewTemplate && templateToSave.workweixin_corpsecret === '********') {
            // Keep '********'
        } else {
            templateToSave.workweixin_corpsecret = undefined;
        }
        templateToSave.workweixin_agentid = workweixinAgentidInput.value.trim();
        templateToSave.workweixin_msgtype = workweixinMsgtypeSelect.value;
        templateToSave.bodyTemplate = templateBodyInput.value.trim() || "{userMessage}";
        templateToSave.headers = [];
    } else {
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
        delete templateToSave.workweixin_agentid;
        delete templateToSave.workweixin_msgtype;
    }
    try {
        let templatesPayload;
        if (isNewTemplate) {
            templatesPayload = [...webhookUrlTemplates, templateToSave];
        } else {
            templatesPayload = webhookUrlTemplates.map(t => t.id === selectedTemplateId ? templateToSave : t);
        }
        const response = await apiRequest('/api/templates', { method: 'POST', body: JSON.stringify(templatesPayload) });
        if (response.success && response.templates) {
            webhookUrlTemplates = response.templates;
            if (isNewTemplate) {
                const newName = templateToSave.name;
                const newType = templateToSave.type;
                const newlySavedTemplate = webhookUrlTemplates.find(t => t.name === newName && t.type === newType && !templatesPayload.some(op => op.id === t.id && op.name === newName && op.id !== null));
                selectedTemplateId = newlySavedTemplate ? newlySavedTemplate.id : null;
            }
            await customAlert('模板已保存！');
        } else { throw new Error(response.message || '保存模板失败'); }
    } catch (error) {
        console.error("保存模板失败:", error);
        await customAlert(`保存模板失败: ${error.message}`);
    } finally {
        renderTemplateList();
        renderTemplateEditor();
    }
}
async function handleDeleteTemplate(templateIdToDelete) {
    if (currentUser && currentUser.role !== 'admin') { customAlert("权限不足"); return; }
    const template = webhookUrlTemplates.find(t => t.id === templateIdToDelete);
    if (!template) return;
    const usedBy = webhooks.filter(wh => wh.templateId === templateIdToDelete);
    let confirmMessage = `确定要删除模板 "${template.name}" 吗？`;
    if (usedBy.length > 0) { confirmMessage += `\n\n警告：有 ${usedBy.length} 个发送配置正在使用此模板，删除后它们的地址将失效！`; }
    if (await customConfirm(confirmMessage, `删除模板 "${template.name}"`)) {
        try {
            const updatedTemplates = webhookUrlTemplates.filter(t => t.id !== templateIdToDelete);
            const response = await apiRequest('/api/templates', { method: 'POST', body: JSON.stringify(updatedTemplates) });
            if (response.success && response.templates) {
                webhookUrlTemplates = response.templates;
                await customAlert('模板已删除。');
                if (selectedTemplateId === templateIdToDelete) {
                    selectedTemplateId = null;
                    if (webhookUrlTemplates.length > 0) await handleSelectTemplate(webhookUrlTemplates[0].id);
                    else showView('templates');
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
                    const webhookUpdateResponse = await apiRequest('/api/webhooks', { method: 'POST', body: JSON.stringify(updatedWebhooks) });
                    if(webhookUpdateResponse.success && webhookUpdateResponse.webhooks){
                        webhooks = webhookUpdateResponse.webhooks;
                        renderWebhookList();
                        if(currentView === 'sender' && selectedWebhookId) renderWebhookEditor();
                    }
                }
            } else { throw new Error(response.message || '删除模板失败'); }
        } catch (error) {
            console.error("删除模板失败:", error);
            await customAlert(`删除模板失败: ${error.message}`);
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
    if(!webhookListEl) return;
    webhookListEl.innerHTML = '';
    if (webhooks.length === 0) {
        webhookListEl.innerHTML = '<li class="text-center text-gray-500 py-4">无发送配置</li>';
        return;
    }
    webhooks.forEach(wh => {
        const li = document.createElement('li');
        li.dataset.id = wh.id;
        li.className = `flex justify-between items-center px-3 py-2 my-1 rounded text-sm cursor-pointer hover:bg-gray-700/80 transition-colors ${wh.id === selectedWebhookId ? 'bg-indigo-600 shadow-md' : 'bg-gray-700/50'}`;
        li.innerHTML = `<span class="truncate text-gray-100">${wh.name || '未命名配置'}</span><button data-delete-id="${wh.id}" class="delete-webhook-btn text-gray-400 hover:text-red-500 ml-2 text-xs focus:outline-none p-1 rounded hover:bg-red-500/20 transition-colors">&#x2715;</button>`;
        webhookListEl.appendChild(li);
    });
}
function renderWebhookEditor() {
    const webhook = webhooks.find(wh => wh.id === selectedWebhookId);
    if (!webhook) {
        showWelcomeScreen('发送配置', '请从左侧重新选择。');
        return;
    }
    showEditor('webhook-editor');
    if(webhookNameInput) webhookNameInput.value = webhook.name || '';
    if(templateSelect) {
        templateSelect.innerHTML = '<option value="">-- 请选择一个地址模板 --</option>';
        console.log("[renderWebhookEditor] Populating templateSelect with:", webhookUrlTemplates);
        if (webhookUrlTemplates && webhookUrlTemplates.length > 0) {
            webhookUrlTemplates.forEach(template => {
                const option = document.createElement('option');
                option.value = template.id;
                const typePrefix = template.type === 'workweixin' ? '[企微] ' : '';
                option.textContent = typePrefix + template.name;
                if (template.id === webhook.templateId) {
                    option.selected = true;
                    console.log(`[renderWebhookEditor] Selecting template: ${template.name} for webhook ${webhook.name}`);
                }
                templateSelect.appendChild(option);
            });
        } else {
            console.warn("[renderWebhookEditor] webhookUrlTemplates is empty or undefined.");
        }
    }
    const selectedTemplate = webhookUrlTemplates.find(t => t.id === webhook.templateId);
    const isWW = selectedTemplate && selectedTemplate.type === 'workweixin';

    if(phoneNumberSection) phoneNumberSection.classList.toggle('hidden', !isWW && !isPhoneNumberRequired(selectedTemplate));
    if(recipientLabel) recipientLabel.textContent = isWW ? "接收者 (touser/@all):" : "手机号码:";
    if(phoneNumberInput) {
        phoneNumberInput.value = webhook.phone || (isWW ? '@all' : '');
        phoneNumberInput.placeholder = isWW ? "例: UserID1|UserID2 或 @all" : "请输入目标手机号码";
    }
    if(webhookBodyTextarea) {
        webhookBodyTextarea.value = webhook.plainBody || '';
        webhookBodyTextarea.placeholder = isWW ? "输入企业微信消息内容..." : "输入纯文本消息 (将替换模板中的 {userMessage})";
    }

    updateSelectedTemplateUrlDisplay(webhook.templateId, isWW);
    renderHeaders(webhook.headers, headersListEl, 'header-key-input', 'header-value-input', 'remove-header-btn', 'indigo');
    const webhookAddHeaderBtnContainer = document.getElementById('add-header-btn').parentElement;
    if (webhookAddHeaderBtnContainer) {
      webhookAddHeaderBtnContainer.classList.toggle('hidden', isWW);
    }

    renderHistoryLog(selectedWebhookId);
    renderScheduledTaskList();
    setActiveTab(currentActiveTab, true);
}
function updateSelectedTemplateUrlDisplay(templateId, isWorkWeixinTemplate = false) {
    if (!selectedTemplateUrlContainer) return;
    const urlDisplayEl = document.getElementById('selected-template-url-display');
    const toggleBtn = document.getElementById('toggle-url-visibility-btn');
    if (!urlDisplayEl || !toggleBtn) return;
    if (!templateId) { selectedTemplateUrlContainer.classList.add('hidden'); return; }
    const template = webhookUrlTemplates.find(t => t.id === templateId);
    if (!template) { selectedTemplateUrlContainer.classList.add('hidden'); return; }

    const fullUrl = template.url || '';
    const displayInfo = getDisplayableUrl(fullUrl, isWorkWeixinTemplate);

    urlDisplayEl.textContent = displayInfo.text;
    urlDisplayEl.title = displayInfo.title;
    urlDisplayEl.dataset.fullUrl = fullUrl;

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
    if (selectedWebhookId) await saveCurrentWebhookChanges();
    const newWebhook = {
        id: null, name: `新发送配置 ${webhooks.length + 1}`,
        templateId: webhookUrlTemplates.length > 0 ? webhookUrlTemplates[0].id : null,
        phone: '', plainBody: "来自 Webhook Sender 的测试消息", headers: []
    };
    const payload = [...webhooks, newWebhook];
    try {
        const response = await apiRequest('/api/webhooks', { method: 'POST', body: JSON.stringify(payload) });
        if (response.success && response.webhooks) {
            webhooks = response.webhooks;
            const addedWebhook = webhooks.find(wh =>
                wh.name === newWebhook.name &&
                wh.templateId === newWebhook.templateId &&
                !webhooks.slice(0, webhooks.length -1).some(oldWh => oldWh.name === wh.name && oldWh.templateId === wh.templateId)
            ) || webhooks[webhooks.length -1];
            await handleSelectWebhook(addedWebhook.id);
        } else { throw new Error(response.message || "创建新配置失败"); }
    } catch (error) {
        console.error("创建新配置失败:", error);
        await customAlert(`创建新配置失败: ${error.message}`);
    }
}
async function handleSelectWebhook(webhookId) {
    if (selectedWebhookId === webhookId && currentView === 'sender' && webhookEditorEl && !webhookEditorEl.classList.contains('hidden')) return;
    if (selectedWebhookId) await saveCurrentWebhookChanges();
    selectedWebhookId = webhookId;
    currentActiveTab = 'body';
    showView('sender');
}
async function saveCurrentWebhookChanges() {
    if (!selectedWebhookId || !webhookEditorEl || webhookEditorEl.classList.contains('hidden')) return;
    const index = webhooks.findIndex(wh => wh.id === selectedWebhookId);
    if (index === -1) {
        console.error(`[saveCurrentWebhookChanges] Webhook with ID ${selectedWebhookId} not found in local cache.`);
        return;
    }
    if (!webhookNameInput || !templateSelect || !phoneNumberInput || !webhookBodyTextarea || !headersListEl) {
        console.error("[saveCurrentWebhookChanges] One or more webhook editor DOM elements not found!");
        await customAlert("保存发送配置时发生错误：编辑器元素丢失。");
        return;
    }

    const webhookToUpdate = { ...webhooks[index] };
    webhookToUpdate.name = webhookNameInput.value.trim();
    webhookToUpdate.templateId = templateSelect.value || null;
    webhookToUpdate.phone = phoneNumberInput.value.trim();
    webhookToUpdate.plainBody = webhookBodyTextarea.value;
    console.log(`[saveCurrentWebhookChanges] Saving webhook ID: ${selectedWebhookId}, New Template ID: ${webhookToUpdate.templateId}`);

    const selectedTemplate = webhookUrlTemplates.find(t => t.id === webhookToUpdate.templateId);
    if (selectedTemplate && selectedTemplate.type === 'workweixin') {
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
    const payload = webhooks.map(wh => wh.id === selectedWebhookId ? webhookToUpdate : wh);
    try {
        const response = await apiRequest('/api/webhooks', { method: 'POST', body: JSON.stringify(payload) });
        if (response.success && response.webhooks) {
            webhooks = response.webhooks;
            console.log(`[saveCurrentWebhookChanges] Webhook config saved successfully. Updated webhooks:`, webhooks);
        } else {
            throw new Error(response.message || "保存配置失败");
        }
    } catch (error) {
        console.error("保存配置失败:", error);
        await customAlert(`保存配置失败: ${error.message}`);
    } finally {
        renderWebhookList();
    }
}
async function handleDeleteWebhook(webhookIdToDelete) {
    if (await customConfirm('确定要删除这个发送配置吗？', '删除发送配置')) {
        try {
            const updatedWebhooks = webhooks.filter(wh => wh.id !== webhookIdToDelete);
            const response = await apiRequest('/api/webhooks', { method: 'POST', body: JSON.stringify(updatedWebhooks) });
            if (response.success && response.webhooks) {
                webhooks = response.webhooks;
                await customAlert('发送配置已删除。');
                if (selectedWebhookId === webhookIdToDelete) {
                    selectedWebhookId = null;
                    history[webhookIdToDelete] = [];
                    if (webhooks.length > 0) await handleSelectWebhook(webhooks[0].id);
                    else showView('sender');
                }
            } else { throw new Error(response.message || '删除配置失败'); }
        } catch (error) {
            console.error("删除配置失败:", error);
            await customAlert(`删除配置失败: ${error.message}`);
        } finally {
            renderWebhookList();
        }
    }
}

// --- 核心功能 (发送, 定时, 标签页, 任务) ---
async function buildClientSideRequestPayload(webhookConfig, template, recipientOrPhone, userMessageText) {
    if (!template) { await customAlert('构建请求失败：地址模板无效。'); return null; }
    const payloadForApi = {
        id: webhookConfig.id, templateId: template.id,
        phone: recipientOrPhone, plainBody: userMessageText,
        headers: webhookConfig.headers || []
    };
    return payloadForApi;
}
async function handleSendNow() {
    if (!selectedWebhookId || isSending) return;
    const webhookConfig = webhooks.find(wh => wh.id === selectedWebhookId);
    if (!webhookConfig) { await customAlert('未找到选定的发送配置！'); return; }
    const template = webhookUrlTemplates.find(t => t.id === webhookConfig.templateId);
    if (!template) { await customAlert('发送配置未关联有效的地址模板！'); return; }
    const recipientOrPhone = phoneNumberInput.value.trim();
    const messageContent = webhookBodyTextarea.value.trim();
    if (template.type === 'workweixin') {
        if (!recipientOrPhone) { await customAlert('企业微信模板需要接收者 (touser/@all)，请输入。'); phoneNumberInput.focus(); return; }
        if (!messageContent && (template.workweixin_msgtype === 'text' || template.workweixin_msgtype === 'markdown')) {
             await customAlert('请输入消息内容。'); webhookBodyTextarea.focus(); return;
        }
    } else {
        if (!template.url || template.url.trim() === '') { await customAlert('无法发送：所选地址模板没有有效的URL。'); return; }
        if (isPhoneNumberRequired(template) && !recipientOrPhone) { await customAlert('当前模板需要手机号码，请输入。'); phoneNumberInput.focus(); return; }
    }
    let confirmed = false;
    if (template.type === 'generic' && isPhoneNumberRequired(template) && recipientOrPhone) {
        const confirmMessage = `确定要向 "${recipientOrPhone}" 发送消息吗？\n配置: ${webhookConfig.name}\n内容: ${messageContent.substring(0,30)}...`;
        confirmed = await customConfirm(confirmMessage, '发送确认');
    } else confirmed = true;
    if (!confirmed) return;

    isSending = true;
    if(sendNowBtn) { sendNowBtn.textContent = '发送中...'; sendNowBtn.disabled = true; }
    const payloadForApi = await buildClientSideRequestPayload(webhookConfig, template, recipientOrPhone, messageContent);
    if (!payloadForApi) {
        isSending = false;
        if(sendNowBtn) { sendNowBtn.textContent = '立即发送'; sendNowBtn.disabled = false; }
        return;
    }
    try {
        const resultEntry = await apiRequest('/api/send-now', { method: 'POST', body: JSON.stringify(payloadForApi) });
        if (!history[resultEntry.webhookId]) history[resultEntry.webhookId] = [];
        history[resultEntry.webhookId].unshift(resultEntry);
        if (history[resultEntry.webhookId].length > 50) history[resultEntry.webhookId] = history[resultEntry.webhookId].slice(0, 50);
        setActiveTab('history', true);
    } catch (error) {
        console.error('发送失败 (API调用):', error);
        await customAlert(`发送失败: ${error.message || '未知错误'}`);
    } finally {
        isSending = false;
        if(sendNowBtn) { sendNowBtn.textContent = '立即发送'; sendNowBtn.disabled = false; }
    }
}
async function handleSaveTask() {
    if (!selectedWebhookId) { await customAlert("请先选择一个发送配置。"); return; }
    const webhookConfig = webhooks.find(wh => wh.id === selectedWebhookId);
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
        if (isPhoneNumberRequired(template) && !recipientOrPhone) { await customAlert('当前模板需要手机号码，请输入。'); phoneNumberInput.focus(); return; }
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
            url: template.url, // Plaintext original template URL for snapshot
            touser: recipientOrPhone,
            workweixin_msgtype: template.workweixin_msgtype
        },
    };
    if (template.type === 'workweixin') {
        taskPayloadForApi.workweixinConfig = { // These are plaintext from template, backend will encrypt for storage
            corpid: template.workweixin_corpid,
            agentid: template.workweixin_agentid,
            touser: recipientOrPhone,
            msgtype: template.workweixin_msgtype
            // corpsecret is not sent from client; backend retrieves encrypted one from template storage
        };
    } else { // Generic
        // finalUrl is the URL with placeholders replaced, used by backend task runner
        let finalUrl = template.url.replace(/{phoneNumber}|{phone}/g, (recipientOrPhone || "").replace(/"/g, '\\"'));
        taskPayloadForApi.finalUrl = finalUrl; // Plaintext final URL, backend will encrypt for storage
    }

    try {
        const response = await apiRequest('/api/schedule-task', {
            method: 'POST',
            body: JSON.stringify(taskPayloadForApi)
        });
        if (response.success && response.taskId) {
            await customAlert(`定时任务已保存！\nID: ${response.taskId}\n计划时间: ${formatDate(taskPayloadForApi.scheduledTime)}`);
            if(scheduleDatetimeInput) scheduleDatetimeInput.value = '';
            if (response.scheduledTasks) {
                scheduledTasks = response.scheduledTasks;
            } else {
                const data = await apiRequest('/api/data'); // Re-fetch all data
                if (data) scheduledTasks = data.scheduledTasks || [];
            }
            renderScheduledTaskList();
        } else {
            throw new Error(response.message || '保存定时任务失败');
        }
    } catch (error) {
        console.error("保存定时任务失败:", error);
        await customAlert(`保存定时任务失败: ${error.message}`);
    }
}
function renderHeaders(headers, listEl, keyClass, valueClass, removeClass, focusColor = 'indigo') {
    if (!listEl) return;
    listEl.innerHTML = '';
    (headers || []).forEach((header, index) => {
        const div = document.createElement('div');
        div.className = 'flex items-center space-x-2 mb-2 header-item';
        div.innerHTML = `<input type="text" value="${header.key || ''}" placeholder="Key" class="${keyClass} w-1/3 bg-[#1a1d24] border border-gray-600 rounded px-3 py-1.5 text-white focus:outline-none focus:border-${focusColor}-500 focus:ring-1 focus:ring-${focusColor}-500"><input type="text" value="${header.value || ''}" placeholder="Value" class="${valueClass} flex-grow bg-[#1a1d24] border border-gray-600 rounded px-3 py-1.5 text-white focus:outline-none focus:border-${focusColor}-500 focus:ring-1 focus:ring-${focusColor}-500"><button data-header-index="${index}" class="${removeClass} text-red-500 hover:text-red-400 focus:outline-none p-1 rounded hover:bg-red-500/20 transition-colors">&#x2715;</button>`;
        listEl.appendChild(div);
    });
}
function setActiveTab(tabName, forceRender = false) {
    if (currentActiveTab === tabName && !forceRender && editorTabs && editorTabs.length > 0) {
        const currentActiveButton = Array.from(editorTabs).find(tab => tab.dataset.tab === tabName);
        if (currentActiveButton && currentActiveButton.classList.contains('text-white')) return;
    }
    currentActiveTab = tabName;
    if(editorTabs) {
        editorTabs.forEach(tab => {
            const isTabActive = tab.dataset.tab === tabName;
            tab.classList.toggle('border-indigo-500', isTabActive);
            tab.classList.toggle('text-white', isTabActive);
            tab.classList.toggle('text-gray-400', !isTabActive);
            tab.classList.toggle('border-transparent', !isTabActive);
        });
    }
    const paneMap = { body: tabContentBody, headers: tabContentHeaders, schedule: tabContentSchedule, history: tabContentHistory };
    Object.values(paneMap).forEach(pane => { if (pane) pane.classList.add('hidden'); });
    if (paneMap[tabName]) {
        paneMap[tabName].classList.remove('hidden');
        paneMap[tabName].classList.add('flex', 'flex-col');
        if (['body', 'headers', 'history', 'schedule'].includes(tabName) ) {
            paneMap[tabName].classList.add('flex-grow');
        }
        if (tabName === 'history') renderHistoryLog(selectedWebhookId);
        if (tabName === 'schedule') renderScheduledTaskList();
    }
}
async function handleCancelTask(taskId) {
    if (await customConfirm("确定要取消这个定时任务吗？", "取消定时任务")) {
        try {
            const response = await apiRequest(`/api/schedule-task/${taskId}`, { method: 'DELETE' });
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
            console.error("取消任务失败:", error);
            await customAlert(`取消任务失败: ${error.message}`);
        }
    }
}
function renderHistoryLog(webhookIdToRender) {
    if (!historyLogListEl || !webhookIdToRender) {
        if(historyLogListEl) historyLogListEl.innerHTML = '<p class="text-center text-gray-400 py-8 text-sm">请先选择一个发送配置以查看历史。</p>';
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
        let sClass = 'text-yellow-400', sText = '发送中...';
        if (entry.status === 'success') {
            sClass = 'text-green-400';
            sText = `成功 (${entry.response?.status || (entry.response?.data?.errcode === 0 ? '企微OK' : 'N/A')})`;
        } else if (entry.status === 'failure') {
            sClass = 'text-red-400';
            sText = `失败 (${entry.error?.code || entry.error?.status || (entry.error?.data?.errcode) || 'N/A'})`;
        }

        const webhookForName = webhooks.find(wh => wh.id === entry.webhookId);
        const taskName = webhookForName?.name || entry.request?.name || 'N/A';
        const plainBodyContent = entry.request?.plainBody || '(未记录纯文本或非文本)';
        const messagePreview = typeof plainBodyContent === 'string' ? (plainBodyContent.length > 20 ? plainBodyContent.substring(0, 20) + '...' : plainBodyContent) : '(非文本内容)';
        
        const requestSnapshot = entry.request || {};
        const responseSnapshot = entry.response || entry.error || {};
        
        let urlToDisplayInHistory = "URL 未知";
        let urlTitleForHistory = "URL 未知";

        if (requestSnapshot.urlForDisplay) {
            const displayable = getDisplayableUrl(requestSnapshot.urlForDisplay, requestSnapshot.templateType === 'workweixin');
            urlToDisplayInHistory = displayable.text;
            urlTitleForHistory = displayable.title;
        } else if (requestSnapshot.webhookSnapshot && requestSnapshot.webhookSnapshot.decryptedOriginalUrl) {
            const displayable = getDisplayableUrl(requestSnapshot.webhookSnapshot.decryptedOriginalUrl, requestSnapshot.templateType === 'workweixin');
            urlToDisplayInHistory = displayable.text;
            urlTitleForHistory = displayable.title;
        } else if (requestSnapshot.templateType === 'workweixin') {
            const displayable = getDisplayableUrl(null, true);
            urlToDisplayInHistory = displayable.text;
            urlTitleForHistory = displayable.title;
        }

        div.innerHTML = `
            <div class="flex justify-between items-center cursor-pointer history-log-header">
                <div class="flex items-center flex-grow min-w-0">
                    <span class="font-semibold text-sm ${sClass} flex-shrink-0">● ${sText}</span>
                    <span class="ml-2 text-xs text-gray-400 truncate" style="max-width: 200px;" title="${typeof plainBodyContent === 'string' ? plainBodyContent : '(非文本内容)'}">${messagePreview}</span>
                </div>
                <div class="flex items-center flex-shrink-0 ml-2">
                    <span class="text-xs text-gray-500">${formatDate(entry.timestamp)}</span>
                    <span class="text-xs text-gray-500 transform transition-transform duration-200 history-arrow ml-2">&#x25BC;</span>
                </div>
            </div>
            <div class="history-details mt-3 pt-3 border-t border-gray-700 hidden bg-black/20 p-2 rounded max-h-96 overflow-y-auto">
                <p class="text-xs text-gray-400 mb-1">任务名称: <span class="text-gray-200">${taskName}</span></p>
                <h4 class="font-semibold mb-1 text-gray-300 text-xs mt-2">发送的纯文本内容:</h4>
                <pre class="text-xs text-gray-400 whitespace-pre-wrap mb-2 bg-[#1e2128] p-1.5 rounded">${typeof plainBodyContent === 'string' ? plainBodyContent : '(非文本内容)'}</pre>
                <h4 class="font-semibold mb-1 text-gray-300 text-xs mt-2">请求详情 (部分):</h4>
                <pre class="text-xs text-gray-400 whitespace-pre-wrap mb-2 bg-[#1e2128] p-1.5 rounded" title="${urlTitleForHistory}">URL: ${urlToDisplayInHistory}\nMethod: ${requestSnapshot.method || 'N/A'}\nHeaders: ${JSON.stringify(requestSnapshot.headers, null, 2)}\nActual Sent Body: ${typeof requestSnapshot.actualSentBody === 'object' ? JSON.stringify(requestSnapshot.actualSentBody, null, 2) : requestSnapshot.actualSentBody || '(空)'}</pre>
                <h4 class="font-semibold mb-1 text-gray-300 text-xs mt-2">响应/错误详情:</h4>
                <pre class="text-xs text-gray-400 whitespace-pre-wrap bg-[#1e2128] p-1.5 rounded">${JSON.stringify(responseSnapshot, null, 2)}</pre>
            </div>`;
        historyLogListEl.appendChild(div);
    });
}
function renderScheduledTaskList() {
    if (!scheduledTaskListEl) return;
    scheduledTaskListEl.innerHTML = '';
    if (scheduledTasks.length === 0) {
        scheduledTaskListEl.innerHTML = '<p class="text-center text-gray-400 py-8 text-sm">当前没有待执行的定时任务</p>';
        return;
    }
    [...scheduledTasks].sort((a, b) => new Date(a.scheduledTime) - new Date(b.scheduledTime)).forEach(task => {
        const div = document.createElement('div');
        div.className = 'bg-[#1a1d24] p-3 rounded shadow-sm border border-gray-700/50 flex justify-between items-center mb-2';
        const taskInfo = document.createElement('div');
        taskInfo.className = 'flex-grow mr-2 min-w-0';
        const configName = task.webhookSnapshot?.name || '未知配置';
        
        const displayableUrlInfo = getDisplayableUrl(task.finalUrl, task.templateType === 'workweixin');
        const displayIdentifier = `URL: ${displayableUrlInfo.text}`;
        const titleForIdentifier = displayableUrlInfo.title;

        let contentPreview = task.webhookSnapshot?.plainBody || '(空)';
        const fullContentPreview = contentPreview;
        if (contentPreview.length > 30) { contentPreview = contentPreview.substring(0,30) + '...'; }

        taskInfo.innerHTML = `
            <p class="text-sm text-gray-200 font-semibold truncate" title="基于配置: ${configName}">发送到: <span class="font-normal">${configName}</span></p>
            <p class="text-xs text-indigo-300 truncate" title="${titleForIdentifier}">目标: <span class="font-normal text-gray-400">${displayIdentifier}</span></p>
            <p class="text-xs text-gray-400">计划时间: ${formatDate(task.scheduledTime)}</p>
            <p class="text-xs text-gray-500 truncate" title="${fullContentPreview}">内容: ${contentPreview}</p>`;
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
    if (!currentUser || currentUser.role !== 'admin' || !userListContainer) return;
    userListContainer.innerHTML = '<p class="text-center text-gray-500">正在加载用户列表...</p>';
    try {
        const users = await apiRequest('/api/users');
        usersList = users || [];
        renderUserList();
    } catch (error) {
        console.error("获取用户列表失败:", error);
        userListContainer.innerHTML = `<p class="text-center text-red-400">加载用户列表失败: ${error.message}</p>`;
    }
}
function renderUserList() {
    if (!userListContainer || !currentUser || currentUser.role !== 'admin') return;
    userListContainer.innerHTML = '';

    if (usersList.length === 0) {
        userListContainer.innerHTML = '<p class="text-center text-gray-500 py-4">没有其他用户。</p>';
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
                : ''
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
            if (await customConfirm(`确定要删除用户 "${usernameToDelete}" (ID: ${userIdToDelete}) 吗？此操作不可撤销。`, "删除用户确认")) {
                handleDeleteUser(userIdToDelete);
            }
        });
    });
}
async function handleShowAddUserForm() {
    if (addUserForm) {
        addUserForm.classList.remove('hidden');
        if(newUsernameInput) newUsernameInput.value = '';
        if(newPasswordInput) newPasswordInput.value = '';
        if(newUserRoleSelect) newUserRoleSelect.value = 'user';
    }
}
async function handleHideAddUserForm() {
    if (addUserForm) {
        addUserForm.classList.add('hidden');
    }
}
async function handleAddUserFormSubmit(event) {
    event.preventDefault();
    if (!newUsernameInput || !newPasswordInput || !newUserRoleSelect) return;

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
            await customAlert(`用户 "${username}" 创建成功！`);
            handleHideAddUserForm();
            await fetchAndRenderUsers();
        } else {
            throw new Error(response.message || "创建用户失败");
        }
    } catch (error) {
        console.error("创建用户失败:", error);
        await customAlert(`创建用户失败: ${error.data?.message || error.message}`);
    }
}
async function handleDeleteUser(userIdToDelete) {
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
        await customAlert(`删除用户失败: ${error.data?.message || error.message}`);
    }
}

// --- 应用初始化 ---
async function initApp() {
    console.log("[App] 初始化 Web 应用...");
    window.getUUID = function() {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            return crypto.randomUUID();
        } else {
            console.warn("crypto.randomUUID not available, using simple fallback for UUID.");
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });
        }
    };
    try {
        const userData = await apiRequest('/api/auth/me');
        if (userData && userData.id) {
            currentUser = userData;
            if (userInfoSpan) userInfoSpan.textContent = `用户: ${currentUser.username} (${currentUser.role})`;
            console.log(`[App] 用户已认证: ${currentUser.username} (ID: ${currentUser.id}, Role: ${currentUser.role})`);
            if (currentUser.mustChangePassword) {
                console.warn('[App] 用户需要修改密码，重定向到修改密码页面。');
                sessionStorage.setItem('forcePasswordChange', 'true');
                window.location.href = '/change-password.html';
                return;
            }
        } else {
            console.warn('[App] 未能获取用户信息或用户未认证，重定向到登录页。');
            window.location.href = '/login.html';
            return;
        }
    } catch (error) {
        console.error('[App] 认证检查或初始数据加载时发生错误:', error.message);
        if (error.message.includes('会话已过期') || error.message.includes('未授权') || error.message.includes('需要修改密码')) {
            // Handled by apiRequest redirection
        } else if (!window.location.pathname.endsWith('/login.html') && !window.location.pathname.endsWith('/change-password.html')) {
            window.location.href = '/login.html?reason=app_init_failed';
        }
        return;
    }

    // 根据角色调整UI显隐
    if (currentUser && currentUser.role !== 'admin') {
        if (navTemplateViewBtn) navTemplateViewBtn.classList.add('hidden');
        if (sidebarContentTemplates) sidebarContentTemplates.classList.add('hidden');
        if (templateManagerView) templateManagerView.classList.add('hidden');
        if (newTemplateBtn) newTemplateBtn.classList.add('hidden');
        if (saveTemplateBtn) saveTemplateBtn.classList.add('hidden');
        if (addTemplateHeaderBtnInTemplates) addTemplateHeaderBtnInTemplates.classList.add('hidden');
        if (navUserManagementBtn) navUserManagementBtn.classList.add('hidden');
        if (sidebarContentUserManagement) sidebarContentUserManagement.classList.add('hidden');
        if (userManagementView) userManagementView.classList.add('hidden');
    } else if (currentUser && currentUser.role === 'admin') {
        if (navTemplateViewBtn) navTemplateViewBtn.classList.remove('hidden');
        if (navUserManagementBtn) navUserManagementBtn.classList.remove('hidden');
    }

    if (logoutButton) {
        logoutButton.addEventListener('click', async () => {
            try {
                await apiRequest('/api/auth/logout', { method: 'POST' });
                currentUser = null;
                if (userInfoSpan) userInfoSpan.textContent = '';
                window.location.href = '/login.html';
            } catch (error) {
                console.error("登出失败:", error);
                await customAlert(`登出失败: ${error.message}`);
            }
        });
    }
    if(navSenderViewBtn) navSenderViewBtn.addEventListener('click', () => showView('sender'));
    if(navTemplateViewBtn && currentUser.role === 'admin') {
        navTemplateViewBtn.addEventListener('click', () => showView('templates'));
    }
    if(navUserManagementBtn && currentUser.role === 'admin') {
        navUserManagementBtn.addEventListener('click', async () => {
            showView('user-management');
            // fetchAndRenderUsers will be called by showView if viewName is 'user-management'
        });
    }
    if(aboutButton) aboutButton.addEventListener('click', () => showView(currentView, true));
    if(closeAboutViewBtn) closeAboutViewBtn.addEventListener('click', () => showView(currentView));

    if(templateTypeSelect && currentUser.role === 'admin') {
        templateTypeSelect.addEventListener('change', () => {
            renderTemplateEditor();
        });
    }
    if(newTemplateBtn && currentUser.role === 'admin') newTemplateBtn.addEventListener('click', handleNewTemplate);
    if(templateListEl && currentUser.role === 'admin') {
        templateListEl.addEventListener('click', async e => {
            const deleteBtn = e.target.closest('.delete-template-btn');
            const listItem = e.target.closest('li[data-id]');
            if (deleteBtn) { e.stopPropagation(); await handleDeleteTemplate(deleteBtn.dataset.deleteId); }
            else if (listItem) { await handleSelectTemplate(listItem.dataset.id); }
        });
    }
    if(saveTemplateBtn && currentUser.role === 'admin') saveTemplateBtn.addEventListener('click', saveCurrentTemplateChanges);
    if (templateUrlInput && currentUser.role === 'admin') {
        templateUrlInput.addEventListener('focus', () => {});
        templateUrlInput.addEventListener('blur', () => {});
    }
    if(addTemplateHeaderBtnInTemplates && currentUser.role === 'admin') {
        addTemplateHeaderBtnInTemplates.addEventListener('click', async () => {
             const template = webhookUrlTemplates.find(t => t.id === selectedTemplateId);
             const isNewGeneric = !selectedTemplateId && templateTypeSelect && templateTypeSelect.value === 'generic';
             if(template && template.type === 'generic') {
                if(!template.headers) template.headers = [];
                template.headers.push({key: '', value: ''});
                renderTemplateEditor();
            } else if (isNewGeneric) {
                await customAlert("请先保存模板，再添加请求头，或在已有通用模板上操作。");
            }
        });
    }
    if(templateHeadersListEl && currentUser.role === 'admin') {
        templateHeadersListEl.addEventListener('click', async e => {
            const btn = e.target.closest('.remove-template-header-btn');
            if (btn) {
                const index = parseInt(btn.dataset.headerIndex, 10);
                const template = webhookUrlTemplates.find(t => t.id === selectedTemplateId);
                if (template && template.type === 'generic' && template.headers && index < template.headers.length) {
                    template.headers.splice(index, 1);
                    renderTemplateEditor();
                }
            }
        });
    }

    if(newWebhookBtn) newWebhookBtn.addEventListener('click', handleNewWebhook);
    if(webhookListEl) webhookListEl.addEventListener('click', async e => {
        const deleteBtn = e.target.closest('.delete-webhook-btn');
        const listItem = e.target.closest('li[data-id]');
        if (deleteBtn) { e.stopPropagation(); await handleDeleteWebhook(deleteBtn.dataset.deleteId); }
        else if (listItem) { await handleSelectWebhook(listItem.dataset.id); }
    });
    if(templateSelect) templateSelect.addEventListener('change', async () => {
        if (selectedWebhookId) {
            const webhook = webhooks.find(wh => wh.id === selectedWebhookId);
            if (webhook) {
                const oldTemplateId = webhook.templateId;
                webhook.templateId = templateSelect.value || null;
                console.log(`[templateSelect change] Webhook ID: ${selectedWebhookId}, Old Template ID: ${oldTemplateId}, New Template ID: ${webhook.templateId}`);
                await saveCurrentWebhookChanges();
                console.log(`[templateSelect change] After saveCurrentWebhookChanges, webhooks array:`, webhooks);
                renderWebhookEditor();
            }
        }
    });

    if(sendNowBtn) sendNowBtn.addEventListener('click', handleSendNow);
    if(editorTabs) editorTabs.forEach(tab => tab.addEventListener('click', () => setActiveTab(tab.dataset.tab)));
    if(addHeaderBtn) addHeaderBtn.addEventListener('click', async () => {
         const webhook = webhooks.find(wh => wh.id === selectedWebhookId);
         const template = webhook ? webhookUrlTemplates.find(t => t.id === webhook.templateId) : null;
         if(webhook && (!template || template.type === 'generic')) {
            if(!webhook.headers) webhook.headers = [];
            webhook.headers.push({key: '', value: ''});
            renderHeaders(webhook.headers, headersListEl, 'header-key-input', 'header-value-input', 'remove-header-btn', 'indigo');
        }
    });
    if(headersListEl) headersListEl.addEventListener('click', async e => {
        const btn = e.target.closest('.remove-header-btn');
        if (btn) {
            const index = parseInt(btn.dataset.headerIndex, 10);
            const webhook = webhooks.find(wh => wh.id === selectedWebhookId);
            const template = webhook ? webhookUrlTemplates.find(t => t.id === webhook.templateId) : null;
            if (webhook && (!template || template.type === 'generic') && webhook.headers && index < webhook.headers.length) {
                webhook.headers.splice(index, 1);
                renderHeaders(webhook.headers, headersListEl, 'header-key-input', 'header-value-input', 'remove-header-btn', 'indigo');
            }
        }
    });
    if(historyLogListEl) historyLogListEl.addEventListener('click', e => {
        const header = e.target.closest('.history-log-header');
        if (header && header.nextElementSibling) {
            header.nextElementSibling.classList.toggle('hidden');
            const arrow = header.querySelector('.history-arrow');
            if(arrow) arrow.classList.toggle('rotate-180');
        }
    });
    if(saveTaskBtn) saveTaskBtn.addEventListener('click', handleSaveTask);
    if(scheduledTaskListEl) scheduledTaskListEl.addEventListener('click', async (e) => {
        const cancelButton = e.target.closest('.cancel-task-btn');
        if (cancelButton && cancelButton.dataset.taskId) {
            await handleCancelTask(cancelButton.dataset.taskId);
        }
    });
    
    if (refreshScheduledTasksBtn) {
        refreshScheduledTasksBtn.addEventListener('click', async () => {
            if (isSending) {
                await customAlert("正在执行其他操作，请稍后再试。");
                return;
            }
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
                await customAlert(`刷新任务列表失败: ${error.message}`);
            } finally {
                isSending = false;
                refreshScheduledTasksBtn.disabled = false;
                refreshScheduledTasksBtn.innerHTML = originalBtnContent;
            }
        });
    }
    // 用户管理表单事件 (仅管理员)
    if (currentUser && currentUser.role === 'admin') {
        if(showAddUserFormBtnMain) showAddUserFormBtnMain.addEventListener('click', handleShowAddUserForm);
        if(cancelAddUserBtn) cancelAddUserBtn.addEventListener('click', handleHideAddUserForm);
        if(addUserForm) addUserForm.addEventListener('submit', handleAddUserFormSubmit);
        if(refreshUserListBtn) refreshUserListBtn.addEventListener('click', fetchAndRenderUsers);
    }

    try {
        const data = await apiRequest('/api/data');
        if (data) {
            webhooks = data.webhooks || [];
            webhookUrlTemplates = data.webhookUrlTemplates || [];
            history = data.history || {};
            scheduledTasks = data.scheduledTasks || [];
            console.log("[App] 初始数据已从服务器加载。");
        } else {
            throw new Error("未能从服务器加载初始数据 (空响应)。");
        }
    } catch (error) {
        console.error("[App] 加载初始数据失败:", error.message);
        if (!error.message.includes('会话已过期') &&
            !error.message.includes('未授权') &&
            !error.message.includes('需要修改密码')) {
            await customAlert(`加载应用数据失败: ${error.message}. 请尝试刷新页面。`);
        }
        return;
    }

    renderWebhookList();
    if (currentUser && currentUser.role === 'admin') {
        renderTemplateList();
    }

    if (webhooks.length > 0) {
        await handleSelectWebhook(webhooks[0].id);
    } else if (currentUser.role === 'admin' && webhookUrlTemplates.length > 0) {
        showView('templates');
        await handleSelectTemplate(webhookUrlTemplates[0].id);
    } else {
        showView('sender');
        showWelcomeScreen('发送配置', '请从左侧列表选择一个，或点击“新建配置”。');
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
