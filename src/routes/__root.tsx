import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import "../index.css";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1.0" },
      { title: "CRYOBYTEPRIME — Attendance & CBT" },
      { name: "description", content: "Student attendance tracking and Computer Based Testing portal." },
      { property: "og:title", content: "CRYOBYTEPRIME — Attendance & CBT" },
      { name: "twitter:title", content: "CRYOBYTEPRIME — Attendance & CBT" },
      { property: "og:description", content: "Student attendance tracking and Computer Based Testing portal." },
      { name: "twitter:description", content: "Student attendance tracking and Computer Based Testing portal." },
      { property: "og:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/3ORfMgc2bTbdq54urGZLlCDa6Op2/social-images/social-1781677132319-CryoBytePrime_WhatsApp.webp" },
      { name: "twitter:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/3ORfMgc2bTbdq54urGZLlCDa6Op2/social-images/social-1781677132319-CryoBytePrime_WhatsApp.webp" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "CryoByte Prime" },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Organization",
              name: "CryoByte Prime",
              url: "https://cryobyteprimecbt-unlimited.lovable.app",
            },
            {
              "@type": "WebSite",
              name: "CryoByte Prime — Attendance & CBT",
              url: "https://cryobyteprimecbt-unlimited.lovable.app",
              publisher: { "@type": "Organization", name: "CryoByte Prime" },
            },
          ],
        }),
      },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=JetBrains+Mono:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap",
      },
    ],
  }),
  shellComponent: RootDocument,
  notFoundComponent: () => <div className="p-8">Page not found</div>,
});

function RootDocument() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  );
}