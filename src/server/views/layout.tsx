import type { Child } from "hono/jsx";

export function Layout({ title, children }: { title?: string; children: Child }) {
  const pageTitle = title ? `${title} - Aletheia` : "Aletheia - Certificate Transparency Monitor";

  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{pageTitle}</title>
        <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet" />
        <script src="https://unpkg.com/htmx.org@2.0.4"></script>
        <script src="https://unpkg.com/htmx-ext-sse@2.2.2/sse.js"></script>
        <style>{`
          body { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace; }
          .htmx-indicator { opacity: 0; transition: opacity 200ms ease-in; }
          .htmx-request .htmx-indicator, .htmx-request.htmx-indicator { opacity: 1; }
        `}</style>
      </head>
      <body class="bg-gray-900 text-gray-100 min-h-screen">
        <nav class="bg-gray-800 border-b border-gray-700 px-6 py-3">
          <div class="max-w-7xl mx-auto flex items-center justify-between">
            <a href="/" class="flex items-center space-x-2 hover:opacity-80">
              <img src="/logo.png" alt="Aletheia" class="h-8 w-8" />
              <span class="text-xl font-bold text-green-400">Aletheia</span>
            </a>
            <div class="flex items-center space-x-4 text-sm text-gray-400">
              <a href="/" class="hover:text-gray-200">Home</a>
              <a href="/stats" class="hover:text-gray-200">Stats</a>
              <a href="/api/stats" class="hover:text-gray-200">API</a>
            </div>
          </div>
        </nav>
        <main class="max-w-7xl mx-auto px-6 py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
