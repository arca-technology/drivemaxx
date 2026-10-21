try { document.documentElement.dataset.theme = localStorage.getItem('drive-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); } catch {}
const form = document.getElementById('login-form');
const error = document.getElementById('login-error');
const submit = document.getElementById('login-submit');
form.addEventListener('submit', async event => {
  event.preventDefault();
  const username = document.getElementById('login-user').value.trim();
  const password = document.getElementById('login-password').value;
  error.hidden = true;
  if (!username || !password) { error.textContent = 'Informe usuário e senha.'; error.hidden = false; return; }
  submit.disabled = true; submit.textContent = 'Entrando…';
  try {
    const response = await fetch('/auth/app-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Não foi possível entrar. Tente novamente.');
    location.replace('/');
  } catch (reason) {
    error.textContent = reason.message; error.hidden = false;
    submit.disabled = false; submit.textContent = 'Entrar';
  }
});
if (new URLSearchParams(location.search).get('login') === 'invalid') { error.textContent = 'Usuário ou senha inválidos.'; error.hidden = false; history.replaceState(null, '', '/'); }
document.getElementById('login-user').focus();
