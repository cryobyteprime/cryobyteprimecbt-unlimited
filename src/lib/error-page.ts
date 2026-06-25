export function renderErrorPage(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Server error</title>
<style>body{font-family:system-ui;padding:2rem;max-width:640px;margin:auto;color:#1e293b}
h1{font-size:1.5rem;margin-bottom:.5rem}p{color:#475569}</style></head>
<body><h1>Something went wrong</h1><p>An unexpected server error occurred. Please reload the page.</p></body></html>`;
}