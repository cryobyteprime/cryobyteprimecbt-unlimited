import { createFileRoute } from '@tanstack/react-router';
import AdminPortal from '@/components/AdminPortal';

export const Route = createFileRoute('/_authenticated/admin')({
  component: AdminPortal,
});