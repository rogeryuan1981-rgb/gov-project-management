import React, { useState, useEffect } from 'react';
import { CheckSquare, AlertCircle, FileBarChart, Calculator, Upload, ArrowRightLeft, Users, Star, UserX } from 'lucide-react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase.js';

const globalAppId = typeof __app_id !== 'undefined' ? __app_id : 'gov-project-saas';

// 對應系統中所有可加入最愛的模組設定
const AVAILABLE_MODULES = [
  { id: 'tasks', icon: ArrowRightLeft, color: 'text-amber-600 dark:text-amber-400', title: '工項與進度追蹤', desc: '快速轉派或檢視待辦清單' },
  { id: 'hr', icon: Users, color: 'text-pink-600 dark:text-pink-400', title: '人事建檔與編制', desc: '人員名冊與人力需求' },
  { id: 'attendance', icon: UserX, color: 'text-orange-600 dark:text-orange-400', title: '考勤紀錄與規政代理', desc: '代理異常補件與考勤' },
  { id: 'archive', icon: Upload, color: 'text-emerald-600 dark:text-emerald-400', title: '雲端歸檔空間', desc: '直連 Google Drive 空間' },
  { id: 'reimbursement', icon: Calculator, color: 'text-indigo-600 dark:text-indigo-400', title: '核銷作業專區', desc: '產出考勤、異動與成果報告' },
];

export default function Dashboard({ user, selectedProject, setActiveTab, setSelectedTask, favoriteIds }) {
  const [tasks, setTasks] = useState([]);
  const [personnel, setPersonnel] = useState([]);
  const [requirements, setRequirements] = useState([]);

  const today = new Date().toISOString().split('T')[0];

  // 監聽專案下的所有任務、人事與需求狀態
  useEffect(() => {
    if (!user || !selectedProject) return;

    const tasksRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'tasks');
    const personnelRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'personnel');
    const reqRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'manpower_reqs');

    const unsubTasks = onSnapshot(tasksRef, (snapshot) => {
      const allTasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setTasks(allTasks.filter(t => t.projectId === selectedProject || t.projectName === selectedProject));
    });

    const unsubPersonnel = onSnapshot(personnelRef, (snapshot) => {
      const allPersonnel = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setPersonnel(allPersonnel.filter(p => p.projectId === selectedProject));
    });

    const unsubReq = onSnapshot(reqRef, (snapshot) => {
      const allReqs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setRequirements(allReqs.filter(r => r.projectId === selectedProject));
    });

    return () => { unsubTasks(); unsubPersonnel(); unsubReq(); };
  }, [user, selectedProject]);

  // 動態判定在職狀態邏輯
  const checkIsActive = (contractEnd) => {
    if (!contractEnd) return true;
    return contractEnd >= today;
  };

  // ================= 數據計算 =================
  const inProgressCount = tasks.filter(t => t.status === 'in-progress').length;
  const overdueTasks = tasks.filter(t => t.status === 'overdue');
  const reqDocPendingCount = tasks.filter(t => t.reqDoc && t.status !== 'completed').length;

  const proxyAlerts = personnel.filter(p => p.proxyAlert && checkIsActive(p.contractEnd));
  
  let totalVacancyDays = 0;
  const todayMs = new Date(today).getTime();

  requirements.forEach(req => {
    const reqStartMs = new Date(req.startDate).getTime();
    const reqEndMs = Math.min(new Date(req.endDate).getTime(), todayMs);
    if (reqStartMs > reqEndMs) return;

    const segments = [];
    personnel.forEach(p => {
      const personContractEndMs = p.contractEnd ? new Date(p.contractEnd).getTime() : todayMs;
      (p.history || []).forEach(h => {
        if (h.unit === req.unit && h.role === req.position) {
          const sMs = new Date(h.startDate).getTime();
          let eMs = h.endDate ? new Date(h.endDate).getTime() : todayMs;
          eMs = Math.min(eMs, personContractEndMs);
          if (sMs <= eMs) segments.push({ sMs, eMs });
        }
      });
    });

    for (let time = reqStartMs; time <= reqEndMs; time += 86400000) {
      let activeCount = 0;
      segments.forEach(seg => { if (seg.sMs <= time && time <= seg.eMs) activeCount++; });
      if (activeCount < req.count) totalVacancyDays += (req.count - activeCount);
    }
  });

  // 過濾出使用者設定的最愛模組
  const favoriteModules = AVAILABLE_MODULES.filter(m => favoriteIds?.includes(m.id));

  const handleTaskView = (task) => {
    setSelectedTask(task);
    setActiveTab('tasks');
  };

  const hasAnyAlerts = overdueTasks.length > 0 || proxyAlerts.length > 0 || totalVacancyDays > 0;

  return (
    <div className="space-y-6 animate-in fade-in duration-300 max-w-6xl mx-auto">
      {/* 上方數據統計區 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        {[
          { label: '進行中工項', value: inProgressCount, icon: CheckSquare, color: 'text-blue-500 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/30' },
          { label: '工項逾期', value: overdueTasks.length, icon: AlertCircle, color: 'text-red-500 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-900/30' },
          { label: '職位異常空缺', value: `${totalVacancyDays} 天`, icon: UserX, color: 'text-pink-500 dark:text-pink-400', bg: 'bg-pink-50 dark:bg-pink-900/30' },
          { label: '待歸檔文件', subLabel: '(依工項設定)', value: reqDocPendingCount, icon: FileBarChart, color: 'text-orange-500 dark:text-orange-400', bg: 'bg-orange-50 dark:bg-orange-900/30' },
        ].map((stat, i) => (
          <div key={i} className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-100 dark:border-slate-700/80 shadow-sm flex items-center justify-between transition-colors">
            <div>
              <p className="text-sm font-bold text-slate-600 dark:text-slate-400 mb-0.5">{stat.label}</p>
              {stat.subLabel && <p className="text-[10px] text-slate-400 dark:text-slate-500 mb-1">{stat.subLabel}</p>}
              <h3 className="text-2xl md:text-3xl font-black text-slate-900 dark:text-white mt-1">{stat.value}</h3>
            </div>
            <div className={`p-3 rounded-xl ${stat.bg} ${stat.color} flex-shrink-0`}>
              <stat.icon size={24} />
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 合規異常與逾期警示區塊 */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/80 shadow-sm overflow-hidden flex flex-col">
          <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700/80 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50">
            <h3 className="font-bold text-slate-800 dark:text-slate-200 flex items-center">
              <AlertCircle size={18} className="mr-2 text-red-500 dark:text-red-400" />
              專案合規異常與警示清單
            </h3>
          </div>
          <div className="p-2 flex-1">
            
            {/* 1. 編制空缺異常 */}
            {totalVacancyDays > 0 && (
              <div className="flex items-start space-x-4 p-4 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-xl transition-colors">
                <div className="mt-1.5 w-2 h-2 rounded-full bg-red-500 shadow-sm flex-shrink-0"></div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-200">【編制空缺異常】專案目前累計 {totalVacancyDays} 天職位空缺未補齊！</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">請盡速確認人力需求設定與人員在職狀態，以免影響核銷。</p>
                </div>
                <button 
                  onClick={() => setActiveTab('hr')} 
                  className="text-xs px-4 py-2 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-500/20 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-500/30 font-bold transition-colors"
                >
                  前往
                </button>
              </div>
            )}

            {/* 2. 規政代理異常 */}
            {proxyAlerts.map(p => (
              <div key={p.id} className="flex items-start space-x-4 p-4 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-xl transition-colors">
                <div className="mt-1.5 w-2 h-2 rounded-full bg-orange-500 shadow-sm flex-shrink-0"></div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-200">【規政代理異常】{p.name} 缺乏職務代理人紀錄！</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">單位: {p.unit} | 職位: {p.role}</p>
                </div>
                <button 
                  onClick={() => setActiveTab('hr')} 
                  className="text-xs px-4 py-2 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-500/20 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-500/30 font-bold transition-colors"
                >
                  處理
                </button>
              </div>
            ))}

            {/* 3. 工項逾期異常 */}
            {overdueTasks.map(task => (
              <div key={task.id} className="flex items-start space-x-4 p-4 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-xl transition-colors">
                <div className="mt-1.5 w-2 h-2 rounded-full bg-red-500 shadow-sm flex-shrink-0"></div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-200">【工項逾期】{task.title} 已逾期未完成！</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">負責人: {task.assignee} | 期限: {task.due}</p>
                </div>
                <button 
                  onClick={() => handleTaskView(task)} 
                  className="text-xs px-4 py-2 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-500/20 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-500/30 font-bold transition-colors"
                >
                  查看
                </button>
              </div>
            ))}
            
            {/* 無任何異常時的空狀態 */}
            {!hasAnyAlerts && (
              <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-500">
                <div className="p-4 bg-emerald-50 dark:bg-emerald-500/10 rounded-full mb-4">
                  <CheckSquare size={32} className="text-emerald-500 dark:text-emerald-400" />
                </div>
                <p className="text-sm font-bold text-slate-600 dark:text-slate-300">太棒了！目前專案進度與編制皆無異常。</p>
                <p className="text-xs text-slate-500 mt-2">請繼續保持良好的進度與人力控管。</p>
              </div>
            )}
          </div>
        </div>

        {/* 我的最愛區塊 */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/80 shadow-sm flex flex-col">
          <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700/80 bg-slate-50 dark:bg-slate-800/50 flex justify-between items-center">
            <h3 className="font-bold text-slate-800 dark:text-slate-200 flex items-center">
              <Star size={16} className="mr-2 text-amber-500" />
              我的最愛功能
            </h3>
          </div>
          <div className="p-4 space-y-3 flex-1 overflow-auto">
            {favoriteModules.length > 0 ? (
              favoriteModules.map(btn => (
                <button 
                  key={btn.id} 
                  onClick={() => setActiveTab(btn.id)} 
                  className="w-full flex items-center p-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-indigo-500 dark:hover:border-indigo-500/50 hover:shadow-md transition-all bg-white dark:bg-slate-800/50 group"
                >
                  <div className={`p-2.5 bg-slate-50 dark:bg-slate-900/50 rounded-lg shadow-sm mr-3 ${btn.color} group-hover:scale-110 transition-transform`}>
                    <btn.icon size={18} />
                  </div>
                  <div className="text-left">
                    <span className={`block text-sm font-bold text-slate-800 dark:text-slate-200 group-hover:text-indigo-700 dark:group-hover:text-indigo-400 transition-colors`}>
                      {btn.title}
                    </span>
                    <span className="block text-[10px] font-medium text-slate-500 dark:text-slate-400 mt-0.5">
                      {btn.desc}
                    </span>
                  </div>
                </button>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <Star size={24} className="text-slate-300 dark:text-slate-600 mb-3" />
                <p className="text-sm font-bold text-slate-600 dark:text-slate-400">尚無最愛功能</p>
                <p className="text-xs text-slate-500 mt-2">請至「系統設定」勾選您常用的模組。</p>
                <button 
                  onClick={() => setActiveTab('settings')} 
                  className="mt-4 px-4 py-2 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                >
                  前往設定
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
