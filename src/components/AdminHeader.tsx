import React, { useState } from 'react';
import {
  Menu, X, Users, Calendar, BarChart3, FileEdit, HelpCircle, FileText,
  Database, Lock, Power, Layers, Bell, ShieldCheck, Trophy, ShieldAlert
} from 'lucide-react';
import { permissions, type AppRole } from '../lib/auth';
import WipeDataButton from './WipeDataButton';

interface AdminHeaderProps {
  currentPage: string;
  onPageChange: (page: string) => void;
  roles: AppRole[];
  pendingRequestsCount: number;
  pendingDeletionsCount: number;
  adminEmail: string;
  onLogout: () => void;
}

export default function AdminHeader({
  currentPage,
  onPageChange,
  roles,
  pendingRequestsCount,
  pendingDeletionsCount,
  adminEmail,
  onLogout
}: AdminHeaderProps) {
  const [isOpen, setIsOpen] = useState(false);

  const allItems = [
    { id: 'dashboard', label: 'Dashboard', icon: BarChart3, allowed: true },
    { id: 'attendance', label: 'Attendance Sessions', icon: Calendar, allowed: permissions.takeAttendance(roles) },
    { id: 'report', label: 'Attendance Reports', icon: FileText, allowed: permissions.viewReports(roles) },
    { id: 'edit-requests', label: 'Edit Requests', icon: FileEdit, allowed: permissions.manageAttendance(roles), badge: pendingRequestsCount },
    { id: 'students', label: 'Manage Students', icon: Users, allowed: permissions.manageStudents(roles) },
    { id: 'questionbank', label: 'Question Bank', icon: HelpCircle, allowed: permissions.manageExams(roles) },
    { id: 'results', label: 'Exam Results', icon: Layers, allowed: permissions.viewReports(roles) },
    { id: 'leaderboard', label: 'Top Performers', icon: Trophy, allowed: permissions.viewReports(roles) },
    { id: 'monitoring', label: 'Exam Monitoring', icon: ShieldAlert, allowed: permissions.viewReports(roles) },
    { id: 'auditlog', label: 'Audit Log', icon: Database, allowed: permissions.viewAuditLog(roles), badge: pendingDeletionsCount ? '!' : undefined },
    { id: 'users', label: 'Users & Roles', icon: ShieldCheck, allowed: permissions.manageUsers(roles) },
    { id: 'settings', label: 'Settings & Security', icon: Lock, allowed: permissions.manageSettings(roles) },
  ];
  const menuItems = allItems.filter((i) => i.allowed);

  const roleLabel = roles.includes('superadmin') ? 'Superadmin'
    : roles.includes('admin') ? 'Admin'
    : roles.includes('staff') ? 'Staff' : 'No role';

  const getPageLabel = (id: string) => {
    return menuItems.find(item => item.id === id)?.label || 'Menu';
  };

  const handleNavClick = (id: string) => {
    onPageChange(id);
    setIsOpen(false);
  };

  return (
    <header className="bg-[#0F172A] border-b border-slate-800 text-white select-none w-full relative z-30 font-sans">
      {/* Target headers for test and verification */}
      <div id="admin-header-main" className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-16 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <div className="flex min-w-0 items-center space-x-3">
          <div className="w-10 h-10 shrink-0 bg-cyan-500 rounded-lg flex items-center justify-center text-white font-bold text-xl shadow-lg shadow-cyan-500/20">
            C
          </div>
          <div className="min-w-0">
            <h1 className="text-sm sm:text-base font-bold tracking-tight text-white leading-tight truncate">CRYO BYTE PRIME</h1>
            <p className="hidden sm:block text-[10px] text-slate-450 tracking-wider font-mono truncate">CBT COURSE BUILDER &amp; EVALUATIONS</p>
          </div>
        </div>

        {/* Action Controls & Dropdown Trigger */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Real role badge (read-only) */}
          <div className="hidden md:flex items-center space-x-2 bg-slate-800/80 px-2.5 py-1.5 rounded-xl border border-slate-700/50">
            <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-xs font-semibold text-cyan-400">{roleLabel}</span>
            <span className="text-[10px] text-slate-500 font-mono truncate max-w-[180px]">{adminEmail}</span>
          </div>

          {/* Quick Stats Notification Badge */}
          {(pendingRequestsCount > 0 || pendingDeletionsCount > 0) && (
            <div className="relative p-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400">
              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-amber-500 animate-ping"></span>
              <Bell className="w-4 h-4" />
            </div>
          )}

          {/* Core Trigger Button (Hamburger) - Requirement B1 */}
          <button
            id="admin-menu-trigger"
            onClick={() => setIsOpen(!isOpen)}
            className="flex items-center space-x-2 bg-slate-800 hover:bg-slate-750 border border-slate-700/50 px-3 py-2 rounded-xl text-sm font-semibold transition-all group cursor-pointer min-w-0"
          >
            {isOpen ? <X className="w-4 h-4 text-rose-450" /> : <Menu className="w-4 h-4 text-cyan-400 animate-pulse" />}
            <span className="text-xs text-slate-300 group-hover:text-white truncate max-w-[140px] sm:max-w-none">
              <span className="hidden sm:inline">Menu: </span><strong className="text-cyan-400 font-bold">{getPageLabel(currentPage)}</strong>
            </span>
            <span className="hidden sm:inline text-[10px] text-slate-550">▼</span>
          </button>

          {/* Log out */}
          <button 
            onClick={onLogout} 
            className="p-2 rounded-xl bg-rose-950/20 border border-rose-900/40 text-rose-400 hover:bg-rose-950/30 transition-colors cursor-pointer"
            title="Sign out of Admin Session"
          >
            <Power className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Role Switcher sub-bar on mobile only */}
      <div className="md:hidden flex items-center justify-between px-4 py-2 bg-[#0F172A] border-t border-slate-800 text-xs text-slate-300">
        <div className="flex items-center space-x-1">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"></span>
          <span className="truncate text-slate-300">{adminEmail}</span>
        </div>
        <span className="text-[11px] font-bold text-cyan-400 flex items-center space-x-1">
          <ShieldCheck className="w-3 h-3" /><span>{roleLabel}</span>
        </span>
      </div>

      {/* Expandable in-flow dropdown panel (Requirement B1: Pushes content down, never overlays) */}
      {isOpen && (
        <div id="admin-menu-dropdown" className="bg-[#0F172A] border-t border-slate-800 animate-fade-in py-6 px-4 sm:px-6 lg:px-8">
          <div className="max-w-7xl mx-auto">
            <h3 className="text-[10px] tracking-wider text-slate-500 font-bold uppercase mb-4">
              CBT Course Builder Modules & Access Gates
            </h3>
            
            {/* 3-column grid on desktop, 1-column on mobile */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {menuItems.map((item) => {
                const Icon = item.icon;
                const isActive = currentPage === item.id;
                
                return (
                  <button
                    key={item.id}
                    onClick={() => handleNavClick(item.id)}
                    className={`flex items-center justify-between w-full p-4 rounded-xl text-left border transition-all cursor-pointer ${
                      isActive 
                        ? 'bg-slate-800/80 border-cyan-500/80 text-cyan-400 shadow-lg shadow-cyan-500/10' 
                        : 'bg-slate-900/30 border-slate-800 text-slate-300 hover:bg-slate-800/50 hover:border-slate-700/80'
                    }`}
                  >
                    <div className="flex items-center space-x-3.5">
                      <Icon className={`w-4.5 h-4.5 ${isActive ? 'text-cyan-450' : 'text-slate-400'}`} />
                      <span className="text-sm font-medium">{item.label}</span>
                    </div>
                    {item.badge !== undefined && (
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        typeof item.badge === 'number' && item.badge > 0
                          ? 'bg-amber-500 text-slate-950 font-black animate-pulse'
                          : 'bg-slate-800 text-slate-400'
                      }`}>
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            
            {/* Quick Helper for OAuth info */}
            <div className="mt-5 pt-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
              <span className="flex items-center space-x-1.5">
                <span className="w-2 h-2 rounded-full bg-cyan-500 animate-ping"></span>
                <span>Active Core Sandbox Storage Connected</span>
              </span>
              <div className="flex items-center gap-2 flex-wrap">
                {roles.includes('superadmin') && (
                  <WipeDataButton
                    page={currentPage}
                    adminEmail={adminEmail}
                    variant="compact"
                    onWiped={() => { try { window.location.reload(); } catch {} }}
                  />
                )}
                <span className="bg-slate-900 px-2.5 py-1 rounded-md text-[10px] font-mono border border-slate-850">
                  DB STATE: OFFLINE-FIRST SEED READY
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
