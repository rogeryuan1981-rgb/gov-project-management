import React, { useState, useEffect } from 'react';
import { LayoutDashboard, CheckSquare, Users, FolderArchive, Settings, ChevronDown, Plus, Check, X, Calculator } from 'lucide-react';
import { collection, onSnapshot, addDoc } from 'firebase/firestore';
import { db } from '../lib/firebase.js';

const globalAppId = typeof __app_id !== 'undefined' ? __app_id : 'gov-project-saas';

export default function Sidebar({ activeTab, setActiveTab, selectedProject, setSelectedProject, setSelectedTask, user }) {
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);
  const [projects, setProjects] = useState([]);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');

  useEffect(() => {
    if (!user) return;
    const projectsRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'projects');
    const unsubscribe = onSnapshot(projectsRef, (snapshot) => {
      const loadedProjects = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      loadedProjects.sort((a, b) => a.createdAt - b.createdAt);
      setProjects(loadedProjects);
      if (loadedProjects.length > 0 && !selectedProject) setSelectedProject(loadedProjects[0].name);
    });
    return () => unsubscribe();
  }, [user, selectedProject, setSelectedProject]);

  const handleCreateProject = async () => {
    if (!newProjectName.trim() || !user) return;
    try {
      const projectsRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'projects');
      await addDoc(projectsRef, { name: newProjectName.trim(), createdAt: new Date().getTime() });
      setSelectedProject(newProjectName.trim());
      setNewProjectName('');
      setIsCreatingProject(false);
      setIsProjectDropdownOpen(false);
    } catch (error) {
      console.error("建立專案失敗:", error);
    }
  };

  const menuItems = [
    { id: 'dashboard', icon: LayoutDashboard, label: '總覽儀表板' },
    { id: 'tasks', icon: CheckSquare, label: '工項與進度追蹤' },
    { id: 'hr', icon: Users, label: '人事合規紀錄' },
    { id: 'archive', icon: FolderArchive, label: '雲端歸檔空間' },
    { id: 'reimbursement', icon: Calculator, label: '核銷作業專區' },
  ];

  return (
    <aside className="w-64 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col z-20">
      <div className="h-16 flex items-center px-6 border-b border-slate-200 dark:border-slate-800 relative">
        <div className="flex items-center space-x-2 text-indigo-700 dark:text-indigo-400 cursor-pointer w-full hover:opacity-80 transition-opacity" onClick={() => { setIsProjectDropdownOpen(!isProjectDropdownOpen); setIsCreatingProject(false); }}>
          <div className="w-8 h-8 rounded-lg bg-indigo-600 dark:bg-indigo-500 text-white flex items-center justify-center font-bold">P</div>
          <div className="flex-1 truncate font-bold text-slate-900 dark:text-white text-sm">{selectedProject || '請新建專案'}</div>
          <ChevronDown size={16} className={`transition-transform text-slate-800 dark:text-slate-300 ${isProjectDropdownOpen ? 'rotate-180' : ''}`} />
        </div>
        
        {isProjectDropdownOpen && (
          <div className="absolute top-14 left-4 right-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-50 overflow-hidden">
            <div className="max-h-48 overflow-y-auto py-1">
              {projects.map((proj) => (
                <button key={proj.id} onClick={() => { setSelectedProject(proj.name); setIsProjectDropdownOpen(false); }} className={`w-full text-left px-4 py-3 text-sm hover:bg-slate-100 dark:hover:bg-slate-700 font-medium ${selectedProject === proj.name ? 'text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-500/20 font-bold' : 'text-slate-800 dark:text-slate-200'}`}>
                  {proj.name}
                </button>
              ))}
            </div>
            <div className="border-t border-slate-100 dark:border-slate-700 p-2 bg-slate-50 dark:bg-slate-800/80">
              {isCreatingProject ? (
                <div className="flex items-center space-x-2 px-2 py-1">
                  <input type="text" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} placeholder="輸入名稱..." autoFocus onKeyDown={(e) => e.key === 'Enter' && handleCreateProject()} className="flex-1 text-sm px-2 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-900 dark:text-white outline-none" />
                  <button onClick={handleCreateProject} className="p-1.5 text-white bg-indigo-600 hover:bg-indigo-700 rounded-md"><Check size={16} /></button>
                  <button onClick={() => { setIsCreatingProject(false); setNewProjectName(''); }} className="p-1.5 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md"><X size={16} /></button>
                </div>
              ) : (
                <button onClick={() => setIsCreatingProject(true)} className="w-full flex items-center justify-center space-x-2 px-2 py-2.5 text-sm text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-lg font-bold"><Plus size={16} /><span>新建專案</span></button>
              )}
            </div>
          </div>
        )}
      </div>
      <nav className="flex-1 overflow-y-auto py-4">
        <ul className="space-y-1 px-3">
          {menuItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <li key={item.id}>
                <button 
                  onClick={() => { setActiveTab(item.id); setSelectedTask(null); }} 
                  className={`w-full flex items-center space-x-3 px-4 py-3.5 rounded-xl transition-colors duration-200 ${
                    isActive 
                      ? 'bg-indigo-50 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 font-bold shadow-sm' 
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium'
                  }`}
                >
                  <item.icon size={20} className={isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400'} />
                  <span>{item.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="p-4 border-t border-slate-200 dark:border-slate-800">
        <button 
          onClick={() => setActiveTab('settings')}
          className={`w-full flex items-center space-x-3 px-4 py-3.5 rounded-xl transition-colors duration-200 ${
            activeTab === 'settings' 
              ? 'bg-indigo-50 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 font-bold shadow-sm' 
              : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium'
          }`}
        >
          <Settings size={20} className={activeTab === 'settings' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400'} />
          <span>系統設定與日誌</span>
        </button>
      </div>
    </aside>
  );
}
