import React, { useState, useEffect } from 'react';
import { CheckSquare, AlertCircle, FileBarChart, Calculator, Upload, ArrowRightLeft } from 'lucide-react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';

const globalAppId = typeof __app_id !== 'undefined' ? __app_id : 'gov-project-saas';

export default function Dashboard({ user, selectedProject, setActiveTab, setSelectedTask }) {
  const [tasks, setTasks] = useState([]);

  useEffect(() => {
    if (!user || !selectedProject) return;
    const tasksRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'tasks');
    const unsubscribe = onSnapshot(tasksRef, (snapshot) => {
      const allTasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setTasks(allTasks.filter(t => t.projectName === selectedProject));
    });
    return () => unsubscribe();
  }, [user, selectedProject]);

  const inProgressCount = tasks.filter(t => t.status === 'in-progress').length;
  const overdueCount = tasks.filter(t => t.status === 'overdue').length;
  const reqDocPendingCount = tasks.filter(t => t.reqDoc && t.status !== 'completed').length;
  const overdueTasks = tasks.filter(t => t.status === 'overdue');

  const handleTaskView = (task) => {
    setSelectedTask(task);
    setActiveTab('tasks');
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300 max-w-5xl mx-auto">
      {/* 數據統計區 - 改為 3 欄配置，移除空缺天數 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          { label: '進行中工項', value: inProgressCount, icon: CheckSquare, color: 'text-blue-500 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/30' },
          { label: '逾期任務', value: overdueCount, icon: AlertCircle, color: 'text-red-500 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-900/30' },
          { label: '待歸檔文件', subLabel: '(已設定需產出文件)', value: reqDocPendingCount, icon: FileBarChart, color: 'text-orange-500 dark:text-orange-400', bg: 'bg-orange-50 dark:bg-orange-900/30' },
        ].map((stat, i) => (
          <div key={i} className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-100 dark:border-slate-700/80 shadow-sm flex items-center justify-between transition-colors">
            <div>
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-0.5">{stat.label}</p>
              {stat.subLabel && <p className="text-[10px] text-slate-400 dark:text-slate-500 mb-1">{stat.subLabel}</p>}
              <h3 className="text-3xl font-bold text-slate-800 dark:text-white mt-1">{stat.value}</h3>
            </div>
            <div className={`p-4 rounded-xl ${stat.bg} ${stat.color}`}>
              <stat.icon size={28} />
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 警示清單 - 優化暗色模式的對比度 */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/80 shadow-sm overflow-hidden flex flex-col">
          <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700/80 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50">
            <h3 className="font-semibold text-slate-800 dark:text-slate-200 flex items-center">
              <AlertCircle size={18} className="mr-2 text-red-500 dark:text-red-400" />
              合規異常與逾期警示
            </h3>
          </div>
          <div className="p-2 flex-1">
            <div className="flex items-start space-x-4 p-4 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-xl transition-colors">
              <div className="mt-1.5 w-2 h-2 rounded-full bg-orange-500 shadow-sm flex-shrink-0"></div>
              <div className="flex-1">
                <p className="text-sm font-medium text-slate-800 dark:text-slate-200">【規政代理異常】李助理連續請假 3 天，尚未指派職務代理人！</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">今天 09:30</p>
              </div>
              <button className="text-xs px-3 py-1.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-500/20 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-500/30 font-medium transition-colors">補件</button>
            </div>
            
            {overdueTasks.map(task => (
              <div key={task.id} className="flex items-start space-x-4 p-4 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-xl transition-colors">
                <div className="mt-1.5 w-2 h-2 rounded-full bg-red-500 shadow-sm flex-shrink-0"></div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-200">【工項逾期】{task.title} 已逾期。</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">期限: {task.due}</p>
                </div>
                <button onClick={() => handleTaskView(task)} className="text-xs px-3 py-1.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-500/20 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-500/30 font-medium transition-colors">查看</button>
              </div>
            ))}
            
            {overdueTasks.length === 0 && (
              <div className="flex flex-col items-center justify-center py-10 text-slate-400 dark:text-slate-500">
                <CheckSquare size={32} className="mb-3 opacity-30" />
                <p className="text-sm">目前無逾期工項，保持得很好！</p>
              </div>
            )}
          </div>
        </div>

        {/* 快捷鍵 */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/80 shadow-sm flex flex-col">
          <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700/80 bg-slate-50 dark:bg-slate-800/50">
            <h3 className="font-semibold text-slate-800 dark:text-slate-200">系統快速捷徑</h3>
          </div>
          <div className="p-4 space-y-3 flex-1">
            {[
              { id: 'reimbursement', icon: Calculator, color: 'text-indigo-600 dark:text-indigo-400', title: '進入核銷作業專區', desc: '產出考勤、異動與成果報告' },
              { id: 'archive', icon: Upload, color: 'text-emerald-600 dark:text-emerald-400', title: '快速上傳歸檔文件', desc: '直連 Google Drive 空間' },
              { id: 'tasks', icon: ArrowRightLeft, color: 'text-amber-600 dark:text-amber-400', title: '批次交接離職人員工項', desc: '轉派未完成任務給代理人' }
            ].map(btn => (
              <button key={btn.id} onClick={() => setActiveTab(btn.id)} className="w-full flex items-center p-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-indigo-500 dark:hover:border-indigo-500/50 hover:shadow-sm transition-all bg-white dark:bg-slate-800/50 group">
                <div className={`p-2.5 bg-slate-50 dark:bg-slate-900/50 rounded-lg shadow-sm mr-3 ${btn.color} group-hover:scale-105 transition-transform`}>
                  <btn.icon size={18} />
                </div>
                <div className="text-left">
                  <span className={`block text-sm font-medium text-slate-700 dark:text-slate-200 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors`}>{btn.title}</span>
                  <span className="block text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">{btn.desc}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
