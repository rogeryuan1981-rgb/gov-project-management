import React, { useState, useEffect } from 'react';
import { LayoutDashboard, CheckSquare, Users, FolderArchive, Settings, ChevronDown, Plus, Check, X, Calculator } from 'lucide-react';
import { collection, onSnapshot, addDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';

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
    <aside className="w-64 bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 flex flex-col z-20">
      <div className="h-16 flex items-center px-6 border-b border-slate-200 dark:border-slate-700 relative">
        <div className="flex items-center space-x-2 text-indigo-600 dark:text-indigo-400 cursor-pointer w-full" onClick={() => { setIsProjectDropdownOpen(!isProjectDropdownOpen); setIsCreatingProject(false); }}>
          <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center font-bold">P</div>
          <div className="flex-1 truncate font-semibold text-slate-800 dark:text-slate-100 text-sm">{selectedProject || '請新建專案'}</div>
          <ChevronDown size={16} className={`transition-transform ${isProjectDropdownOpen ? 'rotate-180' : ''}`} />
        </div>
        
        {isProjectDropdownOpen && (
          <div className="absolute top-14 left-4 right-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-50 overflow-hidden">
            <div className="max-h-48 overflow-y-auto py-1">
              {projects.map((proj) => (
                <button key={proj.id} onClick={() => { setSelectedProject(proj.name); setIsProjectDropdownOpen(false); }} className={`w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 ${selectedProject === proj.name ? 'text-indigo-600 bg-indigo-50/50 dark:bg-indigo-500/10' : 'text-slate-700 dark:text-slate-300'}`}>
                  {proj.name}
                </button>
              ))}
            </div>
            <div className="border-t border-slate-100 dark:border-slate-700 p-2 bg-slate-50 dark:bg-slate-800/80">
              {isCreatingProject ? (
                <div className="flex items-center space-x-2 px-2 py-1">
                  <input type="text" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} placeholder="輸入名稱..." autoFocus onKeyDown={(e) => e.key === 'Enter' && handleCreateProject()} className="flex-1 text-sm px-2 py-1.5 border border-slate-300 rounded-md bg-white dark:bg-slate-700 outline-none" />
                  <button onClick={handleCreateProject} className="p-1 text-indigo-600"><Check size={18} /></button>
                  <button onClick={() => { setIsCreatingProject(false); setNewProjectName(''); }} className="p-1 text-slate-500"><X size={18} /></button>
                </div>
              ) : (
                <button onClick={() => setIsCreatingProject(true)} className="w-full flex items-center justify-center space-x-2 px-2 py-2 text-sm text-indigo-600 hover:bg-indigo-100 rounded-lg font-medium"><Plus size={16} /><span>新建專案</span></button>
              )}
            </div>
          </div>
        )}
      </div>
      <nav className="flex-1 overflow-y-auto py-4">
        <ul className="space-y-1 px-3">
          {menuItems.map((item) => (
            <li key={item.id}>
              <button onClick={() => { setActiveTab(item.id); setSelectedTask(null); }} className={`w-full flex items-center space-x-3 px-3 py-2.5 rounded-xl ${activeTab === item.id ? 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600' : 'text-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700/50'}`}>
                <item.icon size={20} /><span>{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="p-4 border-t border-slate-200 dark:border-slate-700">
        <button className="w-full flex items-center space-x-3 px-3 py-2 text-slate-600 hover:bg-slate-50 rounded-xl"><Settings size={20} /><span>系統設定</span></button>
      </div>
    </aside>
  );
}
