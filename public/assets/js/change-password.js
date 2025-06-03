// public/assets/js/change-password.js

document.addEventListener('DOMContentLoaded', () => {
    const changePasswordForm = document.getElementById('changePasswordForm');
    const responseMessageDiv = document.getElementById('responseMessage');
    const infoMessageDiv = document.getElementById('infoMessage');
    const currentPasswordInput = document.getElementById('currentPassword');

    // 检查是否因为强制修改密码而来此页面
    // 可以通过 URL 参数、sessionStorage 或检查之前的登录响应来判断
    // 简单起见，我们假设如果用户直接访问此页面，也可能是强制修改
    // 后端 authMiddleware 会确保只有已登录用户能访问 /api/auth/change-password
    // 登录时，如果 mustChangePassword 为 true，login.js 会重定向到这里
    // renderer.js 中的 apiRequest 也会在收到特定错误时重定向到这里

    // 尝试从 sessionStorage 获取是否是强制修改的标志 (由 login.js 或 renderer.js 设置)
    const isForcedChange = sessionStorage.getItem('forcePasswordChange') === 'true';
    if (isForcedChange) {
        if (infoMessageDiv) infoMessageDiv.style.display = 'block';
        if (currentPasswordInput) {
            // 对于首次登录的 admin，可以预填或提示
            // currentPasswordInput.value = 'admin'; // 或者留空让用户输入
            currentPasswordInput.placeholder = '默认密码为 "admin"';
        }
        sessionStorage.removeItem('forcePasswordChange'); // 清除标志
    }


    if (changePasswordForm) {
        changePasswordForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            clearMessages();

            const currentPassword = currentPasswordInput.value; // 可能为空
            const newPassword = document.getElementById('newPassword').value;
            const confirmNewPassword = document.getElementById('confirmNewPassword').value;

            if (!newPassword || !confirmNewPassword) {
                displayMessage('新密码和确认密码不能为空。', 'error');
                return;
            }
            if (newPassword.length < 6) {
                displayMessage('新密码长度至少为6个字符。', 'error');
                return;
            }
            if (newPassword !== confirmNewPassword) {
                displayMessage('新密码和确认密码不匹配。', 'error');
                return;
            }

            try {
                const payload = { newPassword, confirmNewPassword };
                // 只有当用户输入了当前密码时才发送它
                // 对于首次强制修改的 admin，如果他们留空，后端逻辑应能处理
                if (currentPassword) {
                    payload.currentPassword = currentPassword;
                }

                const response = await fetch('/api/auth/change-password', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        // Token cookie 会自动发送
                    },
                    body: JSON.stringify(payload),
                });

                const data = await response.json();

                if (response.ok) {
                    displayMessage(data.message || '密码修改成功！请重新登录。', 'success');
                    // 密码修改成功后，后端通常会使旧 token 失效或要求重新登录
                    // 清理可能存在的本地用户状态并重定向到登录页
                    setTimeout(() => {
                        window.location.href = '/login.html';
                    }, 2000); // 延迟2秒跳转，让用户看到成功消息
                } else {
                    displayMessage(data.message || '修改密码失败，请重试。', 'error', data.errors);
                }
            } catch (error) {
                console.error('修改密码请求期间发生错误:', error);
                displayMessage('修改密码请求失败，请检查您的网络连接或稍后再试。', 'error');
            }
        });
    }

    function displayMessage(message, type = 'error', errorsArray = null) {
        responseMessageDiv.textContent = ''; // 清空
        responseMessageDiv.className = 'message-area'; // 重置类名
        if (type === 'error') {
            responseMessageDiv.classList.add('error-message');
        } else if (type === 'success') {
            responseMessageDiv.classList.add('success-message');
        }

        let fullMessage = message;
        if (errorsArray && errorsArray.length > 0) {
            fullMessage += '\n' + errorsArray.map(e => `- ${e.field ? e.field + ': ' : ''}${e.message}`).join('\n');
        }
        responseMessageDiv.textContent = fullMessage;
        responseMessageDiv.style.display = 'block';
    }

    function clearMessages() {
        responseMessageDiv.textContent = '';
        responseMessageDiv.style.display = 'none';
    }
});
