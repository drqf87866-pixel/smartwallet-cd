import type { FC } from 'hono/jsx';
import { Layout } from './layout';

const script = `
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorBox = document.getElementById('login-error');
  errorBox.classList.add('hidden');
  const btn = document.getElementById('login-btn');
  btn.disabled = true;
  btn.textContent = 'Anmelden …';
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: document.getElementById('email').value,
        password: document.getElementById('password').value,
      }),
    });
    if (res.ok) {
      window.location.href = '/dashboard';
      return;
    }
    const data = await res.json().catch(() => ({}));
    errorBox.textContent = data.error || 'Anmeldung fehlgeschlagen';
    errorBox.classList.remove('hidden');
  } catch (err) {
    errorBox.textContent = 'Netzwerkfehler – bitte erneut versuchen';
    errorBox.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Anmelden';
  }
});
`;

export const LoginView: FC = () => (
  <Layout title="Anmelden">
    <main class="flex min-h-screen items-center justify-center p-6">
      <div class="w-full max-w-sm">
        <div class="mb-6 text-center">
          <div class="text-4xl">💳</div>
          <h1 class="mt-2 font-serif text-3xl font-semibold tracking-tight">SmartWallet</h1>
          <p class="mt-1 text-sm italic text-slate-500">Gemeinsam haushalten, klar getrennt.</p>
        </div>

        <form
          id="login-form"
          novalidate
          class="space-y-4 rounded-2xl bg-white p-6 shadow-xl shadow-indigo-100"
        >
          <div id="login-error" role="alert" class="hidden rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600"></div>
          <div>
            <label for="email" class="mb-1 block text-sm font-medium text-slate-700">E-Mail</label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autocomplete="email"
              placeholder="anna@smartwallet.app"
              class="input"
            />
          </div>
          <div>
            <label for="password" class="mb-1 block text-sm font-medium text-slate-700">Passwort</label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autocomplete="current-password"
              placeholder="••••••••"
              class="input"
            />
          </div>
          <button
            id="login-btn"
            type="submit"
            class="w-full rounded-lg bg-indigo-600 px-4 py-2.5 font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
          >
            Anmelden
          </button>
        </form>

        <p class="mt-4 text-center text-sm text-slate-500">
          Noch kein Konto?{' '}
          <a href="/register" class="font-medium text-indigo-600 hover:underline">
            Jetzt registrieren
          </a>
        </p>
        <p class="mt-2 text-center text-xs text-slate-500">
          Passwort vergessen? Der Ersteller deines Haushalts kann es dir in den
          Einstellungen zurücksetzen.
        </p>
        <p class="mt-2 text-center text-xs text-slate-500">
          Demo-Zugänge (lokal nach Seed): anna@smartwallet.app oder ben@smartwallet.app · Passwort: demo1234
        </p>
      </div>

      <script dangerouslySetInnerHTML={{ __html: script }} />
    </main>
  </Layout>
);
