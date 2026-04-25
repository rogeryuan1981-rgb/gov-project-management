import React, { useState, useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './lib/firebase';

// 引入所有拆分後的模組
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import Dashboard from './components/Dashboard';
import TaskBoard from './components/TaskBoard';
import HRModule from './components/HRModule';
import ArchiveModule from './components/ArchiveModule';
import ReportsModule from './components/ReportsModule';

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
          
          {/* 模組動態切換區 (Router) */}
          <div className="flex-1 overflow-auto p-4 md:p-8">
            <div className="max-w-6xl mx-auto pb-12">
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
  );
}
