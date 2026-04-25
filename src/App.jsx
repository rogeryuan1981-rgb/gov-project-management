import React, { useState, useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './lib/firebase';

// 引入拆分後的 Components
import Sidebar from './components/Sidebar';
import Header from './components/Header';

// 預留後續模組的引入位置 (目前先註解，等我們建立好檔案後再打開)
// import Dashboard from './components/Dashboard';
// import TaskBoard from './components/TaskBoard';
// import HRModule from './components/HRModule';
// import ArchiveModule from './components/ArchiveModule';
// import ReportsModule from './components/ReportsModule';

export default function App() {
  const [darkMode, setDarkMode] = useState(false);
  const [activeTab, setActiveTab] = useState('tasks');
  const [selectedProject, setSelectedProject] = useState('');
  const [selectedTask, setSelectedTask] = useState(null);
  const [user, setUser] = useState(null);

  // 系統載入時監聽 Firebase 登入狀態
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  return (
    <div className={darkMode ? 'dark' : ''}>
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 flex font-sans transition-colors duration-200">
        
        {/* 左側導覽列模組 */}
        <Sidebar 
          activeTab={activeTab} 
          setActiveTab={setActiveTab}
          selectedProject={selectedProject}
          setSelectedProject={setSelectedProject}
          setSelectedTask={setSelectedTask}
          user={user}
        />
        
        <main className="flex-1 flex flex-col h-screen overflow-hidden">
          
          {/* 上方標題與登入模組 */}
          <Header 
            darkMode={darkMode}
            setDarkMode={setDarkMode}
            user={user}
            selectedTask={selectedTask}
            setSelectedTask={setSelectedTask}
            activeTab={activeTab}
          />
          
          {/* 主畫面內容動態切換區 */}
          <div className="flex-1 overflow-auto p-4 md:p-8">
            <div className="max-w-6xl mx-auto pb-12">
              
              {/* 這裡未來會替換成對應的組件，目前先放開發中提示 */}
              <div className="flex flex-col items-center justify-center py-32 text-slate-400 dark:text-slate-500 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl">
                <p className="text-lg font-medium mb-2">🚀 核心版面建置完成！</p>
                <p className="text-sm">目前所在的頁籤：<span className="font-bold text-indigo-500">{activeTab}</span></p>
                <p className="text-xs mt-4">請通知 AI 繼續產出 Dashboard 或 TaskBoard 模組程式碼。</p>
              </div>

              {/* 未來會長這樣：
              {activeTab === 'dashboard' && <Dashboard user={user} selectedProject={selectedProject} setActiveTab={setActiveTab} />}
              {activeTab === 'tasks' && <TaskBoard user={user} selectedProject={selectedProject} selectedTask={selectedTask} setSelectedTask={setSelectedTask} />}
              ...
              */}

            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
