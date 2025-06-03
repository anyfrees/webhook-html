// public/assets/js/login.js

document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    const errorMessageDiv = document.getElementById('errorMessage');

    // 检查是否因为会话过期等原因被重定向到登录页，并显示提示信息
    const urlParams = new URLSearchParams(window.location.search);
    const reason = urlParams.get('reason');
    if (reason === 'session_expired') {
        displayError('您的会话已过期，请重新登录。');
    } else if (reason === 'password_changed') {
        // 从 change-password.js 跳转过来时，可以显示一个成功修改密码并要求重新登录的消息
        // 但通常 change-password.js 会直接显示成功消息，然后跳转
        // 这里可以留空或添加一个通用提示
    }


    if (loginForm) {
        loginForm.addEventListener('submit', async (event) => {
            event.preventDefault(); // 阻止表单默认提交行为

            // 清除之前的错误信息
            clearMessages();

            const usernameInput = document.getElementById('username');
            const passwordInput = document.getElementById('password');

            const username = usernameInput.value.trim();
            const password = passwordInput.value.trim();

            if (!username || !password) {
                displayError('用户名和密码均不能为空。');
                return;
            }

            // 可选：添加一个简单的加载状态提示
            const submitButton = loginForm.querySelector('button[type="submit"]');
            const originalButtonText = submitButton.textContent;
            submitButton.textContent = '登录中...';
            submitButton.disabled = true;

            try {
                const response = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ username, password }),
                });

                const data = await response.json(); // 尝试解析JSON，即使响应不ok

                if (response.ok && data.user) {
                    // 登录成功
                    console.log('登录成功:', data);
                    // 服务器会在 cookie 中设置 token

                    if (data.user.mustChangePassword === true) {
                        // 如果需要强制修改密码
                        console.log('需要强制修改密码，正在重定向到修改密码页面...');
                        // 设置一个标志，以便 change-password.js 知道是强制修改
                        sessionStorage.setItem('forcePasswordChange', 'true');
                        window.location.href = '/change-password.html';
                    } else {
                        // 正常登录，重定向到主应用页面
                        window.location.href = '/index.html';
                    }
                } else {
                    // 登录失败，显示错误信息
                    console.error('登录失败:', data);
                    let errMsg = '登录失败，请检查您的凭据。';
                    if (data && data.message) {
                        errMsg = data.message;
                    } else if (response.status === 401) {
                        errMsg = '用户名或密码无效。';
                    }
                    displayError(errMsg);
                }
            } catch (error) {
                console.error('登录请求期间发生网络错误或服务器解析错误:', error);
                displayError('登录请求失败，请检查您的网络连接或稍后再试。');
            } finally {
                submitButton.textContent = originalButtonText;
                submitButton.disabled = false;
            }
        });
    }

    function displayError(message) {
        if (errorMessageDiv) {
            errorMessageDiv.textContent = message;
            errorMessageDiv.style.display = 'block';
        }
    }
    function clearMessages() {
        if (errorMessageDiv) {
            errorMessageDiv.textContent = '';
            errorMessageDiv.style.display = 'none';
        }
    }
});
