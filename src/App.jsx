import React, { useState, useEffect, useRef } from 'react';
import { 
  LayoutDashboard, CheckSquare, Users, FolderArchive, Settings, Moon, Sun, 
  Bell, LogOut, ChevronDown, ChevronRight, AlertCircle, FileText, Download, UserCircle, 
  FileBarChart, Plus, Search, Filter, Upload, Folder, File as FileIcon, 
  MoreVertical, Calendar, ArrowRightLeft, CheckCircle2, Calculator, ArrowLeft, Loader2,
  FileSpreadsheet
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, doc, setDoc, addDoc, query } from 'firebase/firestore';

// 整合您專屬的 Firebase 金鑰設定
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {
  apiKey: "AIzaSyC_z-5x_2RPq-l2HIPvGOtnocvj0C4p2HY",
  authDomain: "my-boardgame-list-7feea.firebaseapp.com",
  projectId: "my-boardgame-list-7feea",
  storageBucket: "my-boardgame-list-7feea.firebasestorage.app",
  messagingSenderId: "743607720954",
  appId: "1:743607720954:web:3562ac5f77c9b923482243"
};

// 在組件外部初始化 Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const globalAppId = typeof __app_id !== 'undefined' ? __app_id : 'gov-project-saas';

export default function App() {
  const [darkMode, setDarkMode] = useState(false);
  const [activeTab, setActiveTab] = useState('tasks');
  const [selectedProject, setSelectedProject] = useState('115年度國健署預防保健專案');
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);
  
  // Firebase Auth 連線狀態
  const [user, setUser] = useState(null);

  // 工項狀態 (從 Firebase 動態讀取)
  const [tasks, setTasks] = useState([]);
  const [selectedTask, setSelectedTask] = useState(null);
  
  // 檔案上傳相關狀態與 Ref
  const fileInputRef = useRef(null);
  const [isImporting, setIsImporting] = useState(false);

  // 系統載入時自動執行 Firebase 連線驗證
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) {
        console.error("Firebase Auth Error:", error);
      }
    };
    initAuth();
    
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // 監聽 Firebase 資料庫中的工項 (依照選取的專案過濾)
  useEffect(() => {
    if (!user) return;

    const tasksRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'tasks');
    
    const unsubscribe = onSnapshot(tasksRef, (snapshot) => {
      const allTasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const projectTasks = allTasks.filter(t => t.projectName === selectedProject);
      
      projectTasks.sort((a, b) => new Date(a.due) - new Date(b.due));
      setTasks(projectTasks);

      if (selectedTask) {
        const updatedSelectedTask = projectTasks.find(t => t.id === selectedTask.id);
        if (updatedSelectedTask) setSelectedTask(updatedSelectedTask);
      }
    }, (error) => {
      console.error("Firestore listen error:", error);
    });

    return () => unsubscribe();
  }, [user, selectedProject]);

  // 單筆新增任務
  const handleAddTask = async () => {
    if (!user) return;
    const tasksRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'tasks');
    const newTask = {
      projectName: selectedProject,
      epic: '新模組：請點擊編輯',
      title: '未命名工項',
      assignee: '未指派',
      due: new Date().toISOString().split('T')[0],
      status: 'pending',
      reqDoc: false,
      currentProgress: '尚未開始',
      subTasks: []
    };
    try {
      await addDoc(tasksRef, newTask);
    } catch (e) {
      console.error("Error adding task:", e);
    }
  };

  // 觸發隱藏的 input file
  const triggerFileInput = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  // 處理 CSV 檔案解析與寫入 Firebase
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setIsImporting(true);
    try {
      const text = await file.text();
      // 簡易 CSV 解析 (按換行切割)
      const rows = text.split('\n').filter(row => row.trim().length > 0);
      const tasksRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'tasks');

      // 假設第一行是標題 (主模組, 任務名稱, 負責人, 期限, 狀態, 當前進度)
      // 從第二行開始讀取 (i = 1)
      const isHeader = rows[0].includes('主模組') || rows[0].includes('epic');
      const startIndex = isHeader ? 1 : 0;

      let importCount = 0;
      for (let i = startIndex; i < rows.length; i++) {
        // 簡易逗號切割 (未處理引號內有逗號的複雜 CSV 情況，MVP 階段夠用)
        const cols = rows[i].split(',').map(c => c.trim());
        
        if (cols.length >= 2) {
          const newTask = {
            projectName: selectedProject,
            epic: cols[0] || '未分類模組',
            title: cols[1] || '未命名任務',
            assignee: cols[2] || '未指派',
            due: cols[3] || new Date().toISOString().split('T')[0],
            status: cols[4] || 'pending',
            currentProgress: cols[5] || '尚未開始',
            reqDoc: cols[6] === '是' || cols[6] === 'true' || false,
            subTasks: []
          };
          await addDoc(tasksRef, newTask);
          importCount++;
        }
      }
      
      // 顯示成功訊息 (由於在此沙盒不建議使用 alert，我們以 Console log 替代，畫面會自動更新)
      console.log(`成功匯入 ${importCount} 筆工項資料`);
    } catch (error) {
      console.error("CSV 匯入失敗:", error);
    } finally {
      setIsImporting(false);
      e.target.value = ''; // 重置 input 以便下次能選同一個檔案
    }
  };

  // 匯出 CSV 範例格式
  const downloadSampleCSV = () => {
    const csvContent = "主模組(Epic),任務名稱,負責人,預計完成日(YYYY-MM-DD),狀態(pending/in-progress/completed/overdue),當前進度,是否需產出文件(是/否)\n模組一：辦公室建置,成立專案辦公室,王主任,2026-05-01,in-progress,尋找場地中,是\n模組二：費用核撥,每月 REA 檢核,林組長,2026-05-15,pending,尚未開始,否";
    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: "text/csv;charset=utf-8;" }); // 加上 BOM 讓 Excel 讀取不亂碼
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", "工項匯入範例格式.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Mock Data (供其他非工項模組暫時使用)
  const projects = ['115年度國健署預防保健專案', '116年度擴充案', '健康促進聯合訪視計畫'];
  
  const mockUsers = [
    { id: 1, name: '王主任', role: '專案主任', isResident: true, hireDate: '2024-01-01', status: 'active', proxyAlert: false },
    { id: 2, name: '林組長', role: '專案小組長', isResident: true, hireDate: '2024-02-15', status: 'active', proxyAlert: false },
    { id: 3, name: '李助理', role: '專案助理', isResident: true, hireDate: '2025-03-01', status: 'active', proxyAlert: true },
    { id: 4, name: '陳專員', role: '專業人員', isResident: false, hireDate: '2025-06-10', status: 'active', proxyAlert: false },
  ];

  const mockFolders = [
    { name: '1. 會議紀錄', count: 12, date: '2026-04-20' },
    { name: '2. 公文與發文', count: 8, date: '2026-04-18' },
    { name: '3. 核銷單據與憑證', count: 45, date: '2026-04-25' },
    { name: '4. 期中期末報告', count: 2, date: '2026-03-15' },
    { name: '5. 查考參考文獻', count: 15, date: '2026-04-01' },
  ];

  // ================= 狀態標籤 Helper =================
  const getStatusBadge = (status) => {
    const styles = {
      'overdue': 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400 border-red-200 dark:border-red-500/30',
      'in-progress': 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400 border-blue-200 dark:border-blue-500/30',
      'pending': 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-600',
      'completed': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/30'
    };
    const labels = { 'overdue': '已逾期', 'in-progress': '進行中', 'pending': '待處理', 'completed': '已完成' };
    
    return (
      <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${styles[status]}`}>
        {labels[status]}
      </span>
    );
  };

  // ================= 渲染側邊欄 =================
  const renderSidebar = () => (
    <aside className="w-64 bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 flex flex-col transition-colors duration-200 z-20">
      <div className="h-16 flex items-center px-6 border-b border-slate-200 dark:border-slate-700 relative">
        <div 
          className="flex items-center space-x-2 text-indigo-600 dark:text-indigo-400 cursor-pointer hover:opacity-80 w-full"
          onClick={() => setIsProjectDropdownOpen(!isProjectDropdownOpen)}
        >
          <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center font-bold shadow-inner">
            P
          </div>
          <div className="flex-1 truncate font-semibold text-slate-800 dark:text-slate-100 text-sm">
            {selectedProject}
          </div>
          <ChevronDown size={16} className={`transition-transform duration-200 ${isProjectDropdownOpen ? 'rotate-180' : ''}`} />
        </div>
        
        {isProjectDropdownOpen && (
          <div className="absolute top-14 left-4 right-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-50 overflow-hidden">
            <div className="max-h-48 overflow-y-auto py-1">
              {projects.map((proj, idx) => (
                <button
                  key={idx}
                  onClick={() => { setSelectedProject(proj); setIsProjectDropdownOpen(false); }}
                  className={`w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors ${selectedProject === proj ? 'text-indigo-600 dark:text-indigo-400 font-medium bg-indigo-50/50 dark:bg-indigo-500/10' : 'text-slate-700 dark:text-slate-300'}`}
                >
                  {proj}
                </button>
              ))}
            </div>
            <div className="border-t border-slate-100 dark:border-slate-700 p-2 bg-slate-50 dark:bg-slate-800/80">
              <button 
                onClick={() => setIsProjectDropdownOpen(false)}
                className="w-full flex items-center justify-center space-x-2 px-2 py-2 text-sm text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 rounded-lg transition-colors font-medium"
              >
                <Plus size={16} />
                <span>新建專案空間</span>
              </button>
            </div>
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto py-4">
        <ul className="space-y-1 px-3">
          {[
            { id: 'dashboard', icon: LayoutDashboard, label: '總覽儀表板' },
            { id: 'tasks', icon: CheckSquare, label: '工項與進度追蹤' },
            { id: 'hr', icon: Users, label: '人事合規紀錄' },
            { id: 'archive', icon: FolderArchive, label: '雲端歸檔空間' },
            { id: 'reimbursement', icon: Calculator, label: '核銷作業專區' },
          ].map((item) => (
            <li key={item.id}>
              <button
                onClick={() => {
                  setActiveTab(item.id);
                  setSelectedTask(null);
                }}
                className={`w-full flex items-center space-x-3 px-3 py-2.5 rounded-xl transition-all duration-200 ${
                  activeTab === item.id
                    ? 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-medium'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <item.icon size={20} />
                <span>{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="p-4 border-t border-slate-200 dark:border-slate-700">
        <button className="w-full flex items-center space-x-3 px-3 py-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-colors">
          <Settings size={20} />
          <span>系統設定與日誌</span>
        </button>
      </div>
    </aside>
  );

  // ================= 渲染上方 Header =================
  const renderHeader = () => (
    <header className="h-16 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between px-8 sticky top-0 z-10 transition-colors duration-200">
      <h1 className="text-xl font-bold text-slate-800 dark:text-white flex items-center">
        {selectedTask ? (
          <>
            <button 
              onClick={() => setSelectedTask(null)}
              className="mr-3 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 transition-colors"
            >
              <ArrowLeft size={20} />
            </button>
            <span>工項詳細資料</span>
          </>
        ) : (
          <>
            {activeTab === 'dashboard' && '總覽儀表板'}
            {activeTab === 'tasks' && '工項與進度追蹤'}
            {activeTab === 'hr' && '人事合規與代理紀錄'}
            {activeTab === 'archive' && 'Google Drive 雲端歸檔空間'}
            {activeTab === 'reimbursement' && '核銷作業與報表中心'}
          </>
        )}
      </h1>
      
      <div className="flex items-center space-x-4">
        <button className="p-2 rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors relative">
          <Bell size={20} />
          <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white dark:border-slate-800"></span>
        </button>
        
        <button 
          onClick={() => setDarkMode(!darkMode)}
          className="p-2 rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
        >
          {darkMode ? <Sun size={20} /> : <Moon size={20} />}
        </button>

        <div className="h-8 w-px bg-slate-200 dark:bg-slate-700 mx-2"></div>

        <div className="flex items-center space-x-3 cursor-pointer group">
          <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center text-white font-bold shadow-sm group-hover:shadow-md transition-shadow">
            管
          </div>
          <div className="hidden md:block">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">系統管理員 (您)</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {user ? `已連線 Firebase (${user.uid.slice(0, 6)})` : 'Firebase 連線中...'}
            </p>
          </div>
          <LogOut size={18} className="text-slate-400 hover:text-red-500 ml-2" />
        </div>
      </div>
    </header>
  );

  // ================= 內容 1: Dashboard =================
  const renderDashboard = () => {
    const inProgressCount = tasks.filter(t => t.status === 'in-progress').length;
    const overdueCount = tasks.filter(t => t.status === 'overdue').length;

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {[
            { label: '進行中工項', value: inProgressCount, icon: CheckSquare, color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-500/10' },
            { label: '逾期任務', value: overdueCount, icon: AlertCircle, color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-500/10' },
            { label: '本月空缺天數', value: '0', icon: UserCircle, color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-500/10' },
            { label: '待歸檔文件', subLabel: '(已設定需產出文件之工項)', value: tasks.filter(t => t.reqDoc && t.status !== 'completed').length, icon: FileBarChart, color: 'text-orange-500', bg: 'bg-orange-50 dark:bg-orange-500/10' },
          ].map((stat, i) => (
            <div key={i} className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-100 dark:border-slate-700/50 shadow-sm transition-colors">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-0.5">{stat.label}</p>
                  {stat.subLabel && <p className="text-[10px] text-slate-400 dark:text-slate-500 mb-1">{stat.subLabel}</p>}
                  <h3 className="text-3xl font-bold text-slate-800 dark:text-white mt-1">{stat.value}</h3>
                </div>
                <div className={`p-3 rounded-xl ${stat.bg} ${stat.color}`}>
                  <stat.icon size={24} />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-2xl border border-red-100 dark:border-red-900/30 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700/50 flex justify-between items-center bg-red-50/50 dark:bg-red-900/10">
              <h3 className="font-semibold text-red-700 dark:text-red-400 flex items-center">
                <AlertCircle size={18} className="mr-2" />
                合規異常與逾期警示 (自動檢核)
              </h3>
            </div>
            <div className="p-2">
              <div className="flex items-start space-x-4 p-4 hover:bg-slate-50 dark:hover:bg-slate-700/30 rounded-xl transition-colors">
                <div className="mt-1 w-2 h-2 rounded-full bg-orange-500 shadow-sm"></div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-200">【規政代理異常】李助理連續請假 3 天，尚未指派職務代理人！</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">今天 09:30</p>
                </div>
                <button className="text-xs px-3 py-1.5 bg-indigo-50 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-500/30 font-medium">補件</button>
              </div>
              
              {tasks.filter(t => t.status === 'overdue').map(task => (
                <div key={task.id} className="flex items-start space-x-4 p-4 hover:bg-slate-50 dark:hover:bg-slate-700/30 rounded-xl transition-colors">
                  <div className="mt-1 w-2 h-2 rounded-full bg-red-500 shadow-sm"></div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200">【工項逾期】{task.title} 已逾期。</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">期限: {task.due}</p>
                  </div>
                  <button onClick={() => { setActiveTab('tasks'); setSelectedTask(task); }} className="text-xs px-3 py-1.5 bg-indigo-50 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-500/30 font-medium">查看</button>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/50 shadow-sm">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700/50">
              <h3 className="font-semibold text-slate-800 dark:text-white">系統快速捷徑</h3>
            </div>
            <div className="p-4 space-y-3">
              <button onClick={() => setActiveTab('reimbursement')} className="w-full flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-slate-600 hover:border-indigo-500 dark:hover:border-indigo-400 hover:shadow-sm transition-all group bg-slate-50 dark:bg-slate-700/30">
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-white dark:bg-slate-800 rounded-lg text-indigo-600 dark:text-indigo-400 shadow-sm">
                    <Calculator size={18} />
                  </div>
                  <div className="text-left">
                    <span className="block text-sm font-medium text-slate-700 dark:text-slate-200 group-hover:text-indigo-600 dark:group-hover:text-indigo-400">進入核銷作業專區</span>
                    <span className="block text-[10px] text-slate-500">產出考勤、異動與成果報告</span>
                  </div>
                </div>
              </button>
              <button onClick={() => setActiveTab('archive')} className="w-full flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-slate-600 hover:border-indigo-500 dark:hover:border-indigo-400 hover:shadow-sm transition-all group bg-slate-50 dark:bg-slate-700/30">
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-white dark:bg-slate-800 rounded-lg text-emerald-600 dark:text-emerald-400 shadow-sm">
                    <Upload size={18} />
                  </div>
                  <div className="text-left">
                    <span className="block text-sm font-medium text-slate-700 dark:text-slate-200 group-hover:text-emerald-600 dark:group-hover:text-emerald-400">快速上傳歸檔文件</span>
                    <span className="block text-[10px] text-slate-500">直連 Google Drive 空間</span>
                  </div>
                </div>
              </button>
              <button onClick={() => setActiveTab('tasks')} className="w-full flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-slate-600 hover:border-indigo-500 dark:hover:border-indigo-400 hover:shadow-sm transition-all group bg-slate-50 dark:bg-slate-700/30">
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-white dark:bg-slate-800 rounded-lg text-amber-600 dark:text-amber-400 shadow-sm">
                    <ArrowRightLeft size={18} />
                  </div>
                  <div className="text-left">
                    <span className="block text-sm font-medium text-slate-700 dark:text-slate-200 group-hover:text-amber-600 dark:group-hover:text-amber-400">批次交接離職人員工項</span>
                    <span className="block text-[10px] text-slate-500">轉派未完成任務給代理人</span>
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ================= 內容 2: Tasks (扁平總覽與全貌視圖) =================
  const renderTaskDetail = (task) => (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="bg-white dark:bg-slate-800 p-6 md:p-8 rounded-2xl border border-slate-200 dark:border-slate-700/50 shadow-sm relative overflow-hidden">
        <div className="absolute top-0 left-0 w-1.5 h-full bg-indigo-500"></div>
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-indigo-600 dark:text-indigo-400 mb-1">{task.epic}</p>
            <h2 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center">
              {task.title}
              {task.status === 'overdue' && <AlertCircle size={20} className="ml-3 text-red-500" />}
            </h2>
            <p className="text-slate-500 dark:text-slate-400 mt-2 flex items-center">
              <span className="bg-slate-100 dark:bg-slate-700 px-2.5 py-1 rounded-md text-sm font-medium mr-3">當前進度：{task.currentProgress}</span>
            </p>
          </div>
          <div className="flex items-center space-x-3">
            <button className="px-4 py-2 bg-indigo-50 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400 font-medium text-sm rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-500/30 transition-colors">編輯工項</button>
            <button className="px-4 py-2 bg-indigo-600 text-white font-medium text-sm rounded-lg hover:bg-indigo-700 shadow-sm transition-colors">更新進度</button>
          </div>
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8 pt-6 border-t border-slate-100 dark:border-slate-700/50">
          <div>
            <p className="text-xs text-slate-400 dark:text-slate-500 mb-1">負責人</p>
            <div className="flex items-center space-x-2">
              <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-600 flex items-center justify-center text-xs text-slate-600 dark:text-slate-300">
                {task.assignee ? task.assignee[0] : '?'}
              </div>
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{task.assignee}</span>
            </div>
          </div>
          <div>
            <p className="text-xs text-slate-400 dark:text-slate-500 mb-1">預計完成日</p>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center"><Calendar size={14} className="mr-1.5 text-slate-400" />{task.due}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400 dark:text-slate-500 mb-1">文件產出規定</p>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{task.reqDoc ? '✅ 需產出並歸檔' : '無特別規定'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400 dark:text-slate-500 mb-1">總狀態</p>
            <div>{getStatusBadge(task.status)}</div>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/50 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-700/50 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/80">
          <h3 className="font-semibold text-slate-800 dark:text-white">子任務拆解清單</h3>
          <button className="text-sm text-indigo-600 dark:text-indigo-400 font-medium hover:underline flex items-center"><Plus size={16} className="mr-1"/> 新增子任務</button>
        </div>
        <table className="w-full text-left">
          <thead className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
            <tr>
              <th className="py-3 px-6 text-xs font-semibold text-slate-500 dark:text-slate-400">子任務名稱</th>
              <th className="py-3 px-6 text-xs font-semibold text-slate-500 dark:text-slate-400">負責人</th>
              <th className="py-3 px-6 text-xs font-semibold text-slate-500 dark:text-slate-400">期限</th>
              <th className="py-3 px-6 text-xs font-semibold text-slate-500 dark:text-slate-400">狀態</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
            {task.subTasks && task.subTasks.length > 0 ? task.subTasks.map(sub => (
              <tr key={sub.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                <td className="py-3 px-6 text-sm font-medium text-slate-800 dark:text-slate-200">{sub.title}</td>
                <td className="py-3 px-6 text-sm text-slate-600 dark:text-slate-400">{sub.assignee}</td>
                <td className="py-3 px-6 text-sm text-slate-600 dark:text-slate-400">{sub.due}</td>
                <td className="py-3 px-6">{getStatusBadge(sub.status)}</td>
              </tr>
            )) : (
              <tr>
                <td colSpan="4" className="py-4 px-6 text-sm text-slate-500 text-center">目前無子任務</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/50 shadow-sm p-6">
        <h3 className="font-semibold text-slate-800 dark:text-white mb-4 flex items-center">
          <FolderArchive size={18} className="mr-2 text-slate-400" /> 此工項之相關歸檔文件
        </h3>
        <div className="border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl p-8 flex flex-col items-center justify-center text-center">
          <FileText size={32} className="text-slate-300 dark:text-slate-600 mb-2" />
          <p className="text-sm text-slate-500">目前尚無關聯文件。在此拖曳上傳，系統將自動同步至 Google Drive。</p>
          <button className="mt-4 px-4 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-sm font-medium rounded-lg hover:shadow-sm transition-all">選擇檔案上傳</button>
        </div>
      </div>
    </div>
  );

  const renderTasks = () => {
    if (selectedTask) {
      return renderTaskDetail(selectedTask);
    }

    return (
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/50 shadow-sm overflow-hidden flex flex-col h-full min-h-[600px] animate-in fade-in duration-300">
        {/* 工具列 */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-700/50 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/80">
          <div className="flex space-x-2">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" />
              <input type="text" placeholder="搜尋工項..." className="pl-9 pr-4 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white transition-all w-64" />
            </div>
            <button className="p-2 border border-slate-200 dark:border-slate-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300">
              <Filter size={18} />
            </button>
          </div>
          <div className="flex space-x-3">
            {/* 隱藏的 File Input */}
            <input 
              type="file" 
              ref={fileInputRef} 
              className="hidden" 
              accept=".csv" 
              onChange={handleFileUpload} 
            />
            <button 
              onClick={triggerFileInput} 
              disabled={isImporting}
              className="flex items-center space-x-2 px-4 py-2 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-500/30 font-medium text-sm transition-colors"
            >
              {isImporting ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />}
              <span>匯入 CSV</span>
            </button>
            <button onClick={handleAddTask} className="flex items-center space-x-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shadow-sm font-medium text-sm transition-colors">
              <Plus size={16} />
              <span>新增任務</span>
            </button>
          </div>
        </div>

        {/* 資料表 */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 dark:bg-slate-800/80 sticky top-0 z-10">
              <tr>
                <th className="py-3 px-6 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-200 dark:border-slate-700">主模組 (Epic)</th>
                <th className="py-3 px-6 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-200 dark:border-slate-700">任務名稱</th>
                <th className="py-3 px-6 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-200 dark:border-slate-700">負責人</th>
                <th className="py-3 px-6 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-200 dark:border-slate-700">目前執行節點</th>
                <th className="py-3 px-6 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-200 dark:border-slate-700 text-center">狀態</th>
                <th className="py-3 px-6 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-200 dark:border-slate-700 text-right">詳情</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50 bg-white dark:bg-slate-800">
              {tasks.length === 0 ? (
                <tr>
                  <td colSpan="6" className="py-16 text-center">
                    <div className="flex flex-col items-center justify-center">
                      <FolderArchive size={48} className="text-slate-300 dark:text-slate-600 mb-4" />
                      <p className="text-slate-700 dark:text-slate-300 font-medium mb-1">此專案目前尚無從 Firebase 讀取到的工項資料</p>
                      <p className="text-slate-500 dark:text-slate-400 text-sm mb-6 max-w-md">您可以手動點擊右上方「新增任務」，或直接匯入團隊已整理好的 CSV 工作清單。</p>
                      
                      <div className="flex space-x-4">
                        <button 
                          onClick={downloadSampleCSV} 
                          className="px-4 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 font-medium text-sm rounded-lg hover:shadow-sm transition-all flex items-center"
                        >
                          <Download size={16} className="mr-2" />
                          下載範例格式
                        </button>
                        <button 
                          onClick={triggerFileInput} 
                          disabled={isImporting}
                          className="px-4 py-2 bg-indigo-50 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400 font-medium text-sm rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-500/30 transition-colors flex items-center"
                        >
                          {isImporting ? <Loader2 size={16} className="animate-spin mr-2" /> : <FileSpreadsheet size={16} className="mr-2" />}
                          匯入 CSV 工項清單
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                tasks.map(task => (
                  <tr 
                    key={task.id} 
                    onClick={() => setSelectedTask(task)}
                    className="hover:bg-indigo-50/50 dark:hover:bg-indigo-500/10 transition-colors cursor-pointer group"
                  >
                    <td className="py-4 px-6 text-sm text-slate-500 dark:text-slate-400">{task.epic}</td>
                    <td className="py-4 px-6 text-sm font-bold text-slate-800 dark:text-slate-200 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                      <div className="flex items-center">
                        {task.status === 'overdue' && <AlertCircle size={14} className="mr-1.5 text-red-500" />}
                        {task.title}
                      </div>
                    </td>
                    <td className="py-4 px-6 text-sm">
                      <div className="flex items-center space-x-2">
                        <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-600 flex items-center justify-center text-xs text-slate-600 dark:text-slate-300">
                          {task.assignee ? task.assignee[0] : '?'}
                        </div>
                        <span className="text-slate-700 dark:text-slate-300">{task.assignee}</span>
                      </div>
                    </td>
                    <td className="py-4 px-6 text-sm">
                      <span className="bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 px-2.5 py-1 rounded-md">
                        {task.currentProgress}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-center">{getStatusBadge(task.status)}</td>
                    <td className="py-4 px-6 text-right">
                      <button className="text-indigo-600 dark:text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity font-medium text-sm flex items-center justify-end w-full">
                        查看全貌 <ChevronRight size={16} className="ml-1" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // ================= 內容 3: HR =================
  const renderHR = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700/50 shadow-sm flex items-center space-x-4">
          <div className="p-3 bg-indigo-50 dark:bg-indigo-500/10 rounded-xl text-indigo-600 dark:text-indigo-400"><Users size={24} /></div>
          <div>
            <p className="text-sm text-slate-500 dark:text-slate-400">系統建檔總人數</p>
            <p className="text-2xl font-bold text-slate-800 dark:text-white">17 <span className="text-sm font-normal text-slate-500">人</span></p>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700/50 shadow-sm flex items-center space-x-4">
          <div className="p-3 bg-emerald-50 dark:bg-emerald-500/10 rounded-xl text-emerald-600 dark:text-emerald-400"><CheckCircle2 size={24} /></div>
          <div>
            <p className="text-sm text-slate-500 dark:text-slate-400">目前駐點人力配置</p>
            <p className="text-2xl font-bold text-slate-800 dark:text-white">15<span className="text-lg text-slate-400">/15</span> <span className="text-xs font-medium px-2 py-0.5 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 rounded-full ml-2">合規</span></p>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-orange-200 dark:border-orange-500/30 shadow-sm flex items-center space-x-4">
          <div className="p-3 bg-orange-50 dark:bg-orange-500/10 rounded-xl text-orange-600 dark:text-orange-400"><AlertCircle size={24} /></div>
          <div>
            <p className="text-sm text-slate-500 dark:text-slate-400">規政代理異常待補件</p>
            <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">1 <span className="text-sm font-normal text-orange-500">件</span></p>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/50 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-700/50 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/80">
          <h3 className="font-semibold text-slate-800 dark:text-white">人員名冊與合規紀錄</h3>
          <div className="flex space-x-3">
            <button className="flex items-center space-x-2 px-4 py-2 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-sm font-medium">
              <Upload size={16} />
              <span>匯入考勤 Excel</span>
            </button>
            <button className="flex items-center space-x-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shadow-sm font-medium text-sm transition-colors">
              <Plus size={16} />
              <span>新增人員</span>
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="py-3 px-6 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">姓名/職稱</th>
                <th className="py-3 px-6 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">狀態</th>
                <th className="py-3 px-6 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase text-center">駐點身分</th>
                <th className="py-3 px-6 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">到職日</th>
                <th className="py-3 px-6 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">合規稽核標記</th>
                <th className="py-3 px-6 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
              {mockUsers.map(user => (
                <tr key={user.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                  <td className="py-3 px-6">
                    <div className="flex flex-col">
                      <span className="font-medium text-slate-900 dark:text-slate-200">{user.name}</span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">{user.role}</span>
                    </div>
                  </td>
                  <td className="py-3 px-6">
                    {user.status === 'active' 
                      ? <span className="px-2 py-1 bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400 rounded text-xs">在職</span>
                      : <span className="px-2 py-1 bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400 rounded text-xs">離職</span>
                    }
                  </td>
                  <td className="py-3 px-6 text-center">
                    {user.isResident ? <CheckCircle2 size={16} className="mx-auto text-indigo-500" /> : <span className="text-slate-300 dark:text-slate-600">-</span>}
                  </td>
                  <td className="py-3 px-6 text-sm text-slate-600 dark:text-slate-300">{user.hireDate}</td>
                  <td className="py-3 px-6">
                    {user.proxyAlert && (
                      <span className="inline-flex items-center px-2 py-1 rounded bg-orange-50 text-orange-600 dark:bg-orange-500/10 dark:text-orange-400 text-xs font-medium border border-orange-200 dark:border-orange-500/30">
                        <AlertCircle size={12} className="mr-1" /> 缺代理人
                      </span>
                    )}
                    {!user.proxyAlert && <span className="text-slate-300 dark:text-slate-600 text-sm">-</span>}
                  </td>
                  <td className="py-3 px-6 text-right">
                    <button className="text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300 text-sm font-medium">編輯</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  // ================= 內容 4: Archive (獨立的雲端歸檔) =================
  const renderArchive = () => (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700/50 shadow-sm">
        <h2 className="text-lg font-bold text-slate-800 dark:text-white flex items-center mb-4">
          <Upload className="mr-2 text-indigo-500" />
          檔案上傳與自動歸檔
        </h2>
        
        {/* 新增：歸檔目標選擇器 */}
        <div className="mb-6 bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl border border-slate-100 dark:border-slate-700">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Step 1: 選擇歸檔目標目錄</label>
          <select className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-2.5 outline-none">
            <option value="">-- 請選擇文件類別 --</option>
            {mockFolders.map((f, i) => <option key={i} value={f.name}>{f.name}</option>)}
          </select>
          <p className="mt-2 text-xs text-slate-500">系統將依據選擇的類別，自動上傳至 Google Drive 的對應年份資料夾。</p>
        </div>

        {/* 拖曳區域 */}
        <div className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-xl p-10 flex flex-col items-center justify-center text-center hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors cursor-pointer group">
          <div className="p-4 bg-indigo-50 dark:bg-indigo-500/10 rounded-full mb-3 group-hover:scale-110 transition-transform">
            <FolderArchive size={32} className="text-indigo-500" />
          </div>
          <p className="text-base font-medium text-slate-700 dark:text-slate-200">Step 2: 點擊或拖曳檔案至此</p>
          <p className="text-sm text-slate-500 mt-1">支援 PDF, Word, Excel 格式，系統將自動套用標準檔名</p>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-bold text-slate-800 dark:text-white flex items-center mb-4 mt-8">
          <Folder className="mr-2 text-slate-400" />
          Drive 目錄捷徑預覽
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {mockFolders.map((folder, idx) => (
            <div key={idx} className="flex flex-col p-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:border-indigo-300 dark:hover:border-indigo-500/50 transition-all cursor-pointer shadow-sm group">
              <div className="flex items-center mb-2">
                <Folder size={24} className="text-indigo-400 mr-2 group-hover:text-indigo-500" />
                <h4 className="font-medium text-slate-800 dark:text-slate-200 text-sm truncate">{folder.name}</h4>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 pl-8">{folder.count} 個檔案</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  // ================= 內容 5: Reimbursement (獨立的核銷專區) =================
  const renderReimbursement = () => (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* 新增：日期區間選擇器 */}
      <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700/50 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-800 dark:text-white flex items-center">
            <Calculator className="mr-2 text-indigo-500" />
            核銷作業報表中心
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">請先設定欲產出報表的日期區間 (如：半年/單月)</p>
        </div>
        
        <div className="flex items-center space-x-2 bg-slate-50 dark:bg-slate-900/50 p-2 rounded-xl border border-slate-200 dark:border-slate-700">
          <input type="date" className="bg-transparent text-sm text-slate-700 dark:text-slate-200 outline-none px-2" defaultValue="2026-01-01" />
          <span className="text-slate-400">至</span>
          <input type="date" className="bg-transparent text-sm text-slate-700 dark:text-slate-200 outline-none px-2" defaultValue="2026-06-30" />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700/50 shadow-sm flex flex-col h-full">
          <div className="p-3 bg-blue-50 dark:bg-blue-500/10 rounded-xl w-fit mb-4">
            <FileText className="text-blue-600 dark:text-blue-400" size={24} />
          </div>
          <h3 className="font-bold text-slate-800 dark:text-white mb-2">1. 人員考勤匯總表</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 flex-1 mb-6">包含所選區間內的出勤總天數、各類假別明細、規政代理人簽核紀錄與超休警示。</p>
          <button className="w-full flex justify-center items-center space-x-2 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-xl transition-colors">
            <Download size={16} /> <span>匯出 Excel</span>
          </button>
        </div>

        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700/50 shadow-sm flex flex-col h-full">
          <div className="p-3 bg-emerald-50 dark:bg-emerald-500/10 rounded-xl w-fit mb-4">
            <Users className="text-emerald-600 dark:text-emerald-400" size={24} />
          </div>
          <h3 className="font-bold text-slate-800 dark:text-white mb-2">2. 異動與空缺紀錄表</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 flex-1 mb-6">詳列期間內的人員到離職與調職軌跡，並自動精算計畫駐點人力之「空缺天數」。</p>
          <button className="w-full flex justify-center items-center space-x-2 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-xl transition-colors">
            <Download size={16} /> <span>匯出 PDF</span>
          </button>
        </div>

        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700/50 shadow-sm flex flex-col h-full">
          <div className="p-3 bg-amber-50 dark:bg-amber-500/10 rounded-xl w-fit mb-4">
            <CheckSquare className="text-amber-600 dark:text-amber-400" size={24} />
          </div>
          <h3 className="font-bold text-slate-800 dark:text-white mb-2">3. 期中/期末成果初稿</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 flex-1 mb-6">擷取區間內已完成之工項列表、會議清單及甘特圖，作為撰寫正式報告之基底。</p>
          <button className="w-full flex justify-center items-center space-x-2 py-2.5 border border-indigo-200 dark:border-indigo-500/30 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 text-sm font-medium rounded-xl transition-colors">
            <Download size={16} /> <span>產出 Word 初稿</span>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className={darkMode ? 'dark' : ''}>
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 flex font-sans transition-colors duration-200">
        {renderSidebar()}
        
        <main className="flex-1 flex flex-col h-screen overflow-hidden">
          {renderHeader()}
          
          <div className="flex-1 overflow-auto p-4 md:p-8">
            <div className="max-w-6xl mx-auto pb-12">
              {activeTab === 'dashboard' && renderDashboard()}
              {activeTab === 'tasks' && renderTasks()}
              {activeTab === 'hr' && renderHR()}
              {activeTab === 'archive' && renderArchive()}
              {activeTab === 'reimbursement' && renderReimbursement()}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}