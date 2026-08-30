import type { FC, PropsWithChildren } from 'hono/jsx';

type LayoutProps = PropsWithChildren<{ title: string }>;

const swScript = `
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').catch(function () {});
  });
}
`;

export const Layout: FC<LayoutProps> = ({ title, children }) => (
  <html lang="de">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      <title>{title} · SmartWallet</title>
      <meta name="theme-color" content="#b65535" />
      <link rel="manifest" href="/manifest.webmanifest" />
      <link rel="icon" href="/assets/icon-192.png" type="image/png" />
      <link rel="apple-touch-icon" href="/assets/icon-192.png" />
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      <meta name="apple-mobile-web-app-title" content="SmartWallet" />
      <link rel="stylesheet" href="/assets/app.css" />
      <script src="/assets/app.js" defer></script>
    </head>
    <body class="min-h-screen bg-gradient-to-br from-slate-100 via-indigo-50 to-slate-100 text-slate-800 antialiased">
      {children}
      {/* Globale Toast-Benachrichtigung (Client-JS steuert Sichtbarkeit, Farbe und role) */}
      <div
        id="toast"
        role="status"
        aria-live="polite"
        class="fixed bottom-24 left-1/2 z-[60] hidden -translate-x-1/2 rounded-lg px-4 py-2.5 text-sm font-medium text-white shadow-lg md:bottom-6"
      ></div>
      <script dangerouslySetInnerHTML={{ __html: swScript }} />
    </body>
  </html>
);
