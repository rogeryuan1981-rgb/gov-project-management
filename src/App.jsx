import React, { useState, useEffect, Component } from 'react';
import { onAuthStateChanged, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth } from './lib/firebase.js';
import { LogIn, ShieldCheck, Loader2 } from 'lucide-react';

import Sidebar from './components/Sidebar.jsx';
import Header from './components/Header.jsx';
import Dashboard from './components/Dashboard.jsx';
import TaskBoard from './components/TaskBoard.jsx';
import HRModule from './components/HRModule.jsx';
import ArchiveModule from './components/ArchiveModule.jsx';
import ReportsModule from './components/ReportsModule.jsx';

// 錯誤邊界元件 - 捕捉並顯示 UI 崩潰資訊
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6 text-white text-center">
          <div className="max-w-md w-full p-8 bg-slate-800 rounded-3xl border border-red-500/30 shadow-2xl">
            <h2 className="text-2xl font-bold text-red-400 mb-4">系統啟動失敗</h2>
            <div className="text-xs bg-black/50 p-4 rounded-xl overflow-auto mb-6 text-red-300 font-mono text-left max-h-40">
              {this.state.error?.toString()}
            </div>
            <button 
              onClick={() => window.location.reload()} 
              className="px-8 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-full font-bold transition-all active:scale-95"
            >
              重新整理頁面
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [darkMode, setDarkMode] = useState(true); 
  const [activeTab, setActiveTab] = useState('dashboard');
  const [selectedProject, setSelectedProject] = useState('');
  const [selectedTask, setSelectedTask] = useState(null);
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  // 監聽 Firebase 登入狀態
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("登入失敗:", error);
    }
  };

  // 1. 驗證中畫面
  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="flex flex-col items-center">
          <Loader2 className="animate-spin text-indigo-500 mb-4" size={48} />
          <p className="text-slate-500 text-sm animate-pulse">正在驗證存取權限...</p>
        </div>
      </div>
    );
  }

  // 2. 未登入：顯示登入牆 (Login Wall)
  if (!user) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-[2.5rem] p-10 shadow-2xl text-center relative overflow-hidden">
          {/* 背景裝飾光暈 */}
          <div className="absolute -top-24 -left-24 w-48 h-48 bg-indigo-500/10 blur-[80px]"></div>
          <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-purple-500/10 blur-[80px]"></div>

          <div className="relative">
            <div className="w-20 h-20 bg-gradient-to-br from-indigo-500/20 to-purple-500/20 rounded-3xl flex items-center justify-center mx-auto mb-8 border border-white/10 shadow-inner">
              <ShieldCheck size={40} className="text-indigo-400" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2 tracking-tight">標案專案管理系統</h1>
            <p className="text-slate-400 text-sm mb-12">機密資訊系統，請使用授權帳號登入</p>
            
            <button 
              onClick={handleLogin}
              className="w-full py-4 bg-white hover:bg-slate-100 text-slate-900 rounded-2xl font-bold flex items-center justify-center space-x-3 transition-all transform active:scale-95 shadow-lg shadow-white/5"
            >
              <LogIn size={20} />
              <span>使用 Google 帳號登入</span>
            </button>
            
            <div className="mt-12 pt-8 border-t border-slate-800/50">
              <p className="text-[10px] text-slate-600 uppercase tracking-[0.2em] font-medium">Authorized Access Only</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 3. 已登入：進入主系統
  return (
    <ErrorBoundary>
      <div className={darkMode ? 'dark' : ''}>
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex font-sans transition-colors duration-300">
          
          {/* 左側選單 */}
          <Sidebar 
            activeTab={activeTab} 
            setActiveTab={setActiveTab} 
            selectedProject={selectedProject} 
            setSelectedProject={setSelectedProject} 
            setSelectedTask={setSelectedTask} 
            user={user} 
          />
          
          <main className="flex-1 flex flex-col h-screen overflow-hidden">
            {/* 上方標題與工具列 */}
            <Header 
              darkMode={darkMode} 
              setDarkMode={setDarkMode} 
              user={user} 
              selectedTask={selectedTask} 
              setSelectedTask={setSelectedTask} 
              activeTab={activeTab} 
            />
            
            {/* 內容區塊 */}
            <div className="flex-1 overflow-auto p-6 md:p-10">
              <div className="max-w-6xl mx-auto pb-20">
                {activeTab === 'dashboard' && (
                  <Dashboard user={user} selectedProject={selectedProject} setActiveTab={setActiveTab} setSelectedTask={setSelectedTask} />
                )}
                
                {activeTab === 'tasks' && (
                  <TaskBoard user={user} selectedProject={selectedProject} selectedTask={selectedTask} setSelectedTask={setSelectedTask} />
                )}
                
                {activeTab === 'hr' && (
                  <HRModule user={user} selectedProject={selectedProject} />
                )}
                
                {activeTab === 'archive' && (
                  <ArchiveModule user={user} selectedProject={selectedProject} />
                )}
                
                {activeTab === 'reimbursement' && (
                  <ReportsModule user={user} selectedProject={selectedProject} />
                )}
              </div>
            </div>
          </main>
        </div>
      </div>
    </ErrorBoundary>
  );
}
