import React, { useState, useEffect } from 'react';
import { LayoutDashboard, CheckSquare, Users, FolderArchive, Settings, ChevronDown, Plus, Check, X, Calculator, Clock } from 'lucide-react';
import { collection, onSnapshot, addDoc, getFirestore } from 'firebase/firestore';
import { getApp, getApps, initializeApp } from 'firebase/app';

// 避免編譯器路徑錯誤，使用行內安全初始化 Firebase
const firebaseConfig = typeof __firebase_config !== 'undefined' && __firebase_config ? JSON.parse(__firebase_config) : {};
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app);

const globalAppId = typeof __app_id !== 'undefined' ? __app_id : 'gov-project-saas';

export default function Sidebar({ activeTab, setActiveTab, selectedProject, setSelectedProject, setSelectedTask, user }) {
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);
  const [projects, setProjects] = useState([]);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  
  // 新建專案的表單狀態
  const [newProjectName, setNewProjectName] = useState('');
  
  // 取得當年度作為預設值
  const currentYear = new Date().getFullYear();
  const [newProjectStartDate, setNewProjectStartDate] = useState(`${currentYear}-01-01`);
  const [newProjectEndDate, setNewProjectEndDate] = useState(`${currentYear}-12-31`);

  // 監聽專案清單
  useEffect(() => {
    if (!user) return;
    const projectsRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'projects');
    const unsubscribe = onSnapshot(projectsRef, (snapshot) => {
      const loadedProjects = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      loadedProjects.sort((a, b) => a.createdAt - b.createdAt);
      setProjects(loadedProjects);

      // 改以專案的唯一 ID (UID) 作為 selectedProject
      if (loadedProjects.length > 0 && !selectedProject) {
        setSelectedProject(loadedProjects[0].id);
      }
    });
    return () => unsubscribe();
  }, [user, selectedProject, setSelectedProject]);

  // 新增專案與其執行區間
  const handleCreateProject = async () => {
    if (!newProjectName.trim() || !user) {
      alert("請輸入專案名稱");
      return;
    }
    if (!newProjectStartDate || !newProjectEndDate) {
      alert("請設定專案的開始與結束日期");
      return;
    }

    try {
      const projectsRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'projects');
      const docRef = await addDoc(projectsRef, {
        name: newProjectName.trim(),
        startDate: newProjectStartDate, // 一併寫入開始日期
        endDate: newProjectEndDate,     // 一併寫入結束日期
        createdAt: new Date().getTime()
      });
      
      // 建立後將選取的專案設為該專案的唯一 ID
      setSelectedProject(docRef.id);
      setNewProjectName('');
      setNewProjectStartDate(`${currentYear}-01-01`); // 重置回預設
      setNewProjectEndDate(`${currentYear}-12-31`);   // 重置回預設
      setIsCreatingProject(false);
      setIsProjectDropdownOpen(false);
    } catch (error) {
      console.error("建立專案失敗:", error);
    }
  };

  // 💡 核心規劃調整：將「人事合規」與「考勤管理」在主選單陣列中徹底獨立解耦
  const menuItems = [
    { id: 'dashboard', icon: LayoutDashboard, label: '總覽儀表板' },
    { id: 'tasks', icon: CheckSquare, label: '工項與進度追蹤' },
    { id: 'hr', icon: Users, label: '人事合規紀錄' },
    { id: 'attendance', icon: Clock, label: '計畫考勤管理' }, // 💥 全新獨立考勤模組頂層入口
    { id: 'archive', icon: FolderArchive, label: '雲端歸檔空間' },
    { id: 'reimbursement', icon: Calculator, label: '核銷作業專區' },
  ];

  // 取得當慢選取專案的名稱以供顯示 (透過 UID 反查)
  const currentProjectName = projects.find(p => p.id === selectedProject)?.name || '請新建或選擇專案';

  return (
    <aside className="w-64 bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 flex flex-col z-20 transition-colors">
      <div className="h-16 flex items-center px-6 border-b border-slate-200 dark:border-slate-700 relative">
        <div 
          className="flex items-center space-x-2 text-indigo-600 dark:text-indigo-400 cursor-pointer hover:opacity-80 w-full"
          onClick={() => {
            setIsProjectDropdownOpen(!isProjectDropdownOpen);
            setIsCreatingProject(false);
          }}
        >
          <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center font-bold shadow-inner">P</div>
          <div className="flex-1 truncate font-semibold text-slate-800 dark:text-slate-100 text-sm">
            {currentProjectName}
          </div>
          <ChevronDown size={16} className={`transition-transform duration-200 ${isProjectDropdownOpen ? 'rotate-180' : ''}`} />
        </div>
        
        {isProjectDropdownOpen && (
          <div className="absolute top-14 left-4 right-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-50 overflow-hidden">
            <div className="max-h-48 overflow-y-auto py-1">
              {projects.length === 0 && !isCreatingProject && (
                <div className="px-4 py-3 text-sm text-slate-500 text-center">尚無專案，請先新建</div>
              )}
              {projects.map((proj) => (
                <button
                  key={proj.id}
                  onClick={() => { setSelectedProject(proj.id); setIsProjectDropdownOpen(false); }}
                  className={`w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors ${selectedProject === proj.id ? 'text-indigo-600 dark:text-indigo-400 font-medium bg-indigo-50/50 dark:bg-indigo-500/10' : 'text-slate-700 dark:text-slate-300'}`}
                >
                  {proj.name}
                </button>
              ))}
            </div>
            
            {/* 新建專案表單區塊 */}
            <div className="border-t border-slate-100 dark:border-slate-700 p-2 bg-slate-50 dark:bg-slate-800/80">
              {isCreatingProject ? (
                <div className="flex flex-col space-y-3 px-2 py-2">
                  <div>
                    <label className="text-[10px] text-slate-500 dark:text-slate-400 font-bold mb-1 block">專案名稱</label>
                    <input 
                      type="text" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)}
                      placeholder="輸入專案名稱..." autoFocus
                      className="w-full text-sm px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div className="flex items-center space-x-2">
                    <div className="flex-1">
                      <label className="text-[10px] text-slate-500 dark:text-slate-400 font-bold mb-1 block">計畫開始日期</label>
                      <input 
                        type="date" value={newProjectStartDate} onChange={e=>setNewProjectStartDate(e.target.value)} 
                        className="w-full text-xs px-1.5 py-1.5 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 outline-none"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="text-[10px] text-slate-500 dark:text-slate-400 font-bold mb-1 block">計畫結束日期</label>
                      <input 
                        type="date" value={newProjectEndDate} onChange={e=>setNewProjectEndDate(e.target.value)} 
                        className="w-full text-xs px-1.5 py-1.5 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 outline-none"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end space-x-2 pt-1 border-t border-slate-200 dark:border-slate-700">
                    <button onClick={() => { setIsCreatingProject(false); setNewProjectName(''); }} className="px-2.5 py-1.5 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-md transition-colors text-xs font-bold flex items-center">
                      <X size={14} className="mr-1" /> 取消
                    </button>
                    <button onClick={handleCreateProject} className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md transition-colors text-xs font-bold flex items-center shadow-sm">
                      <Check size={14} className="mr-1" /> 建立專案
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setIsCreatingProject(true)} className="w-full flex items-center justify-center space-x-2 px-2 py-2 text-sm text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 rounded-lg font-medium transition-colors">
                  <Plus size={16} /><span>新建專案空間</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto py-4">
        <ul className="space-y-1 px-3">
          {menuItems.map((item) => (
            <li key={item.id}>
              <button
                onClick={() => { setActiveTab(item.id); setSelectedTask(null); }}
                className={`w-full flex items-center space-x-3 px-3 py-2.5 rounded-xl transition-all duration-200 ${
                  activeTab === item.id ? 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-medium' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50'
                }`}
              >
                <item.icon size={20} /><span>{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="p-4 border-t border-slate-200 dark:border-slate-700">
        <button onClick={() => { setActiveTab('settings'); setSelectedTask(null); }} className={`w-full flex items-center space-x-3 px-3 py-2 rounded-xl transition-colors ${activeTab === 'settings' ? 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-medium' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50'}`}>
          <Settings size={20} /><span>系統設定與日誌</span>
        </button>
      </div>
    </aside>
  );
}
