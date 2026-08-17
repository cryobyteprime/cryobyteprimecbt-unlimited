import { createFileRoute } from '@tanstack/react-router';
import AdminPortal from '@/components/AdminPortal';

export const Route = createFileRoute('/_authenticated/admin')({
  component: AdminPortal,
  head: () => ({
    meta: [
      { title: 'Admin Dashboard — CryoByte Prime' },
      { name: 'description', content: 'Manage exams, attendance sessions, students, results and live exam monitoring in the CryoByte Prime admin console.' },
      { property: 'og:title', content: 'Admin Dashboard — CryoByte Prime' },
      { property: 'og:description', content: 'Manage exams, attendance sessions, students, results and live exam monitoring in the CryoByte Prime admin console.' },
      { property: 'og:url', content: 'https://cryobyteprimecbt-unlimited.lovable.app/admin' },
      { name: 'twitter:title', content: 'Admin Dashboard — CryoByte Prime' },
      { name: 'twitter:description', content: 'Manage exams, attendance, results and live exam monitoring in the CryoByte Prime admin console.' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
});