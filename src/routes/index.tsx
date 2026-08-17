import { createFileRoute } from "@tanstack/react-router";
import App from "../App";

export const Route = createFileRoute("/")({
  component: App,
  ssr: false,
  head: () => ({
    meta: [
      { title: "CryoByte Prime — Attendance & CBT Exam Portal" },
      { name: "description", content: "Take your CBT exam and track cohort attendance with CryoByte Prime: serial-ID verified sign-in, live exam scheduling and real-time monitoring." },
      { property: "og:title", content: "CryoByte Prime — Attendance & CBT Exam Portal" },
      { property: "og:description", content: "Take your CBT exam and track cohort attendance with CryoByte Prime: serial-ID verified sign-in, live exam scheduling and real-time monitoring." },
      { property: "og:url", content: "https://cryobyteprimecbt-unlimited.lovable.app/" },
      { name: "twitter:title", content: "CryoByte Prime — Attendance & CBT Exam Portal" },
      { name: "twitter:description", content: "Take your CBT exam and track cohort attendance with CryoByte Prime." },
    ],
    links: [{ rel: "canonical", href: "https://cryobyteprimecbt-unlimited.lovable.app/" }],
  }),
});