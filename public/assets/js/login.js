// public/assets/js/login.js

document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const errorMessageDiv = document.getElementById('errorMessage');
    const togglePasswordButton = document.getElementById('togglePassword');

    // 检查是否有重定向原因，并显示相应消息
    const urlParams = new URLSearchParams(window.location.search);
    const reason = urlParams.get('reason');
    const forcePasswordChange = sessionStorage.getItem('forcePasswordChange');

    if (reason === 'session_expired' && errorMessageDiv) {
        errorMessageDiv.textContent = '您的会话已过期，请重新登录。';
        errorMessageDiv.classList.remove('hidden');
    } else if (reason === 'password_changed' && errorMessageDiv) {
         errorMessageDiv.textContent = '密码修改成功，请使用新密码登录。';
        errorMessageDiv.classList.remove('hidden');
    } else if (reason === 'app_init_failed_auth_check' && errorMessageDiv && !forcePasswordChange) {
        errorMessageDiv.textContent = '无法验证您的身份，请重新登录。';
        errorMessageDiv.classList.remove('hidden');
    }
    // 清除 sessionStorage 中的重定向信息，避免重复显示
    sessionStorage.removeItem('redirectTo'); // 登录后跳转的路径
    // sessionStorage.removeItem('forcePasswordChange'); // 这个在改密页面处理


    if (togglePasswordButton && passwordInput) {
        togglePasswordButton.addEventListener('click', function () {
            const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
            passwordInput.setAttribute('type', type);
            // 可选: 更改按钮图标 (例如，眼睛开/关)
            this.textContent = type === 'password' ? '显示' : '隐藏';
        });
    }


    if (loginForm) {
        loginForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (errorMessageDiv) {
                errorMessageDiv.classList.add('hidden');
                errorMessageDiv.textContent = '';
            }

            const username = usernameInput.value.trim();
            const password = passwordInput.value; // 不需要 trim 密码

            if (!username || !password) {
                if (errorMessageDiv) {
                    errorMessageDiv.textContent = '用户名和密码不能为空。';
                    errorMessageDiv.classList.remove('hidden');
                }
                return;
            }

            const loginButton = loginForm.querySelector('button[type="submit"]');
            if(loginButton) {
                loginButton.disabled = true;
                loginButton.textContent = '登录中...';
            }

            try {
                const response = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ username, password }),
                });

                const data = await response.json();

                if (response.ok && data.user) {
                    console.log('登录成功:', data.user);
                    if (data.user.mustChangePassword) {
                        sessionStorage.setItem('forcePasswordChange', 'true');
                        sessionStorage.setItem('usernameForPasswordChange', data.user.username); // 可以传递用户名
                        window.location.href = '/change-password.html';
                    } else {
                        // 检查是否有之前存储的重定向路径
                        const redirectTo = sessionStorage.getItem('redirectToAfterLogin');
                        sessionStorage.removeItem('redirectToAfterLogin'); // 清除，避免下次使用
                        window.location.href = redirectTo || '/'; // 默认跳转到首页
                    }
                } else {
                    // 处理登录失败，包括账户锁定信息
                    let displayMessage = data.message || '登录失败，请检查您的凭据。';
                    if (data.error === 'AccountLocked') {
                        // 后端应该在 data.message 中包含解锁时间等详细信息
                        // 例如: "您的账户已被锁定，请于 YYYY-MM-DD HH:mm:ss 后再试。"
                        // 或者后端可以返回一个结构化的错误，包含 lockoutUntil 时间戳
                        if (data.lockoutUntil) {
                            const lockoutEndDate = new Date(data.lockoutUntil);
                            const now = new Date();
                            if (lockoutEndDate > now) {
                                const minutesRemaining = Math.ceil((lockoutEndDate.getTime() - now.getTime()) / (1000 * 60));
                                displayMessage = `您的账户已被锁定。请在约 ${minutesRemaining} 分钟后重试。 (解锁时间: ${lockoutEndDate.toLocaleString('zh-CN')})`;
                            } else {
                                // 如果 lockoutUntil 已经过去，理论上后端不应该返回 AccountLocked，但作为保险
                                displayMessage = "账户暂时无法登录，请稍后再试。";
                            }
                        }
                    } else if (data.errors && Array.isArray(data.errors)) {
                        displayMessage = data.errors.map(err => err.msg || err.message).join(' ');
                    }
                    
                    if (errorMessageDiv) {
                        errorMessageDiv.textContent = displayMessage;
                        errorMessageDiv.classList.remove('hidden');
                    }
                    console.error('登录失败:', data);
                }
            } catch (error) {
                if (errorMessageDiv) {
                    errorMessageDiv.textContent = '登录请求失败，请检查网络连接或稍后再试。';
                    errorMessageDiv.classList.remove('hidden');
                }
                console.error('登录请求异常:', error);
            } finally {
                if(loginButton) {
                    loginButton.disabled = false;
                    loginButton.textContent = '登录';
                }
            }
        });
    } else {
        console.error('登录表单未在DOM中找到。');
    }
});