import React, { useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { BookOpen, ChevronRight, Sparkles } from 'lucide-react';
import StudentCBT from './pages/StudentCBT';

export default function App() {
  const [sessionUserType, setSessionUserType] = useState<'chooser' | 'student_portal'>('chooser');
  const navigate = useNavigate();
  const tapCountRef = useRef(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSecretTap = () => {
    tapCountRef.current += 1;
    if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    tapTimerRef.current = setTimeout(() => {
      tapCountRef.current = 0;
    }, 1200);
    if (tapCountRef.current >= 4) {
      tapCountRef.current = 0;
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
      navigate({ to: '/auth' });
    }
  };

  if (sessionUserType === 'student_portal') {
    return <StudentCBT />;
  }

  return (
    <div className="min-h-screen bg-[#0F172A] text-white flex flex-col justify-between font-sans h-screen select-none relative overflow-hidden">
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl animate-pulse"></div>
      <div className="absolute bottom-10 right-1/4 w-96 h-96 bg-cyan-700/10 rounded-full blur-3xl animate-pulse"></div>

      <header className="px-6 py-5 flex items-center justify-between border-b border-slate-900 shrink-0 relative z-10 bg-slate-950/40 backdrop-blur-md">
        <div className="flex items-center space-x-3">
          <button
            type="button"
            onClick={handleSecretTap}
            aria-label="Logo"
            className="w-10 h-10 rounded-xl bg-cyan-500/15 border border-cyan-500/35 flex items-center justify-center text-cyan-400 cursor-default"
          >
            <Sparkles className="w-5 h-5" />
          </button>
          <div className="text-left font-sans">
            <h1 className="text-sm font-black tracking-wider text-white leading-tight uppercase">CryoBytePrime</h1>
          </div>
        </div>
        <span className="text-[10px] bg-slate-900 border border-slate-800 px-2.5 py-1 rounded-xl font-mono text-zinc-400">v4.0.0</span>
      </header>

      <main className="grow flex flex-col items-center justify-center px-6 relative z-10 py-8">
        <div className="max-w-xl text-center space-y-8 animate-fade-in">
          <div className="space-y-3 max-w-lg mx-auto">
            <h2 className="text-3xl font-extrabold tracking-tight leading-none bg-gradient-to-r from-cyan-400 via-sky-300 to-cyan-200 bg-clip-text text-transparent uppercase">
              CryoBytePrime CBT
            </h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              Continuous assessment system and real-time attendance management suite.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 max-w-xs mx-auto">
            <button
              onClick={() => setSessionUserType('student_portal')}
              className="p-5 bg-slate-900/60 hover:bg-slate-850 border border-slate-800 rounded-3xl text-left transition-all group cursor-pointer hover:border-cyan-500/50 hover:shadow-lg hover:shadow-cyan-500/5 relative"
            >
              <div className="w-10 h-10 rounded-xl bg-cyan-500/10 flex items-center justify-center border border-cyan-500/30 text-cyan-400 mb-3.5">
                <BookOpen className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-white group-hover:text-cyan-300">Take CBT Exam</h3>
              <p className="text-[11px] text-slate-450 mt-1 leading-normal">Enter your course email and serial ID to access the test gate.</p>
              <ChevronRight className="w-4 h-4 text-slate-500 absolute right-4 bottom-4 group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        </div>
      </main>

      <footer className="py-5 text-center border-t border-slate-900/60 shrink-0 text-[10.5px] text-slate-500 font-mono tracking-widest uppercase">
        CRYO BYTE PRIME COHORT EVALUATIONS SYSTEM © 2026
      </footer>
    </div>
  );
}