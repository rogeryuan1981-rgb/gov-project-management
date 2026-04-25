import React, { useState, useEffect, Component } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './lib/firebase';

import Sidebar from './components/Sidebar';
import Header from './components/Header';
import Dashboard from './components/Dashboard';
import TaskBoard from './components/TaskBoard';
import HRModule from './components/HRModule';
import ArchiveModule from './components/ArchiveModule';
import ReportsModule from './components/ReportsModule';

// ==========================================
// 錯誤邊界 (Error Boundary) - 防止系統白畫面崩潰
// ==========================================
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("UI 崩潰錯誤捕捉:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="bg-white p-8 rounded-2xl shadow-xl max-w-2xl w-full border-t-4 border-red-500">
            <h2 className="text-2xl font-bold text-red-600 mb-4">系統發生未預期錯誤 (畫面崩潰)</h2>
            <p className="text-slate-600 mb-4">
              這通常是因為 <strong className="text-slate-800">資料庫連線失敗</strong> 或 <strong className="text-slate-800">Vercel 環境變數遺失</strong> 所導致。詳細錯誤訊息如下：
            </p>
            <div className="bg-slate-100 p-4 rounded-lg overflow-auto text-sm text-red-500 font-mono mb-6 max-h-64 whitespace-pre-wrap">
              {this.state.error && this.state.error.toString()}
            </div>
            <div className="flex space-x-4">
              <button onClick={() => window.location.reload()} className="px-5 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition-colors font-medium">
                重新載入頁面
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [darkMode, setDarkMode] = useState(false);
  const [activeTab, setActiveTab] = useState('tasks');
  const [selectedProject, setSelectedProject] = useState('');
  const [selectedTask, setSelectedTask] = useState(null);
  const [user, setUser] = useState(null);

  useEffect(() => {
    // 加上 try-catch 防止 Firebase auth 未正確初始化時崩潰
    try {
      const unsubscribe = onAuthStateChanged(auth, setUser);
      return () => unsubscribe();
    } catch (error) {
      console.error("Firebase 監聽認證狀態失敗:", error);
    }
  }, []);

  return (
    <ErrorBoundary>
      <div className={darkMode ? 'dark' : ''}>
        <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 flex font-sans">
          <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} selectedProject={selectedProject} setSelectedProject={setSelectedProject} setSelectedTask={setSelectedTask} user={user} />
          <main className="flex-1 flex flex-col h-screen overflow-hidden">
            <Header darkMode={darkMode} setDarkMode={setDarkMode} user={user} selectedTask={selectedTask} setSelectedTask={setSelectedTask} activeTab={activeTab} />
            <div className="flex-1 overflow-auto p-4 md:p-8">
              <div className="max-w-6xl mx-auto pb-12">
                {activeTab === 'dashboard' && <Dashboard user={user} selectedProject={selectedProject} setActiveTab={setActiveTab} setSelectedTask={setSelectedTask} />}
                {activeTab === 'tasks' && <TaskBoard user={user} selectedProject={selectedProject} selectedTask={selectedTask} setSelectedTask={setSelectedTask} />}
                {activeTab === 'hr' && <HRModule user={user} selectedProject={selectedProject} />}
                {activeTab === 'archive' && <ArchiveModule user={user} selectedProject={selectedProject} />}
                {activeTab === 'reimbursement' && <ReportsModule user={user} selectedProject={selectedProject} />}
              </div>
            </div>
          </main>
        </div>
      </div>
    </ErrorBoundary>
  );
}
