import React, { useState, useEffect } from 'react';
import { CheckSquare, AlertCircle, UserCircle, FileBarChart, Calculator, Upload, ArrowRightLeft } from 'lucide-react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';

const globalAppId = typeof __app_id !== 'undefined' ? __app_id : 'gov-project-saas';

export default function Dashboard({ user, selectedProject, setActiveTab, setSelectedTask }) {
  const [tasks, setTasks] = useState([]);

  useEffect(() => {
    if (!user || !selectedProject) { setTasks([]); return; }
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
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* 數據統計區 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {[
          { label: '進行中工項', value: inProgressCount, icon: CheckSquare, color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-500/10' },
          { label: '逾期任務', value: overdueCount, icon: AlertCircle, color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-500/10' },
          { label: '本月空缺天數', value: '0', icon: UserCircle, color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-500/10' },
          { label: '待歸檔文件', subLabel: '(已設定需產出文件之工項)', value: reqDocPendingCount, icon: FileBarChart, color: 'text-orange-500', bg: 'bg-orange-50 dark:bg-orange-500/10' },
        ].map((stat, i) => (
          <div key={i} className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-100 dark:border-slate-700/50 shadow-sm transition-colors">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-0.5">{stat.label}</p>
                {stat.subLabel && <p className="text-[10px] text-slate-400 mb-1">{stat.subLabel}</p>}
                <h3 className="text-3xl font-bold text-slate-800 dark:text-white mt-1">{stat.value}</h3>
              </div>
              <div className={`p-3 rounded-xl ${stat.bg} ${stat.color}`}><stat.icon size={24} /></div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 警示清單 */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-2xl border border-red-100 dark:border-red-900/30 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700/50 flex justify-between items-center bg-red-50/50 dark:bg-red-900/10">
            <h3 className="font-semibold text-red-700 dark:text-red-400 flex items-center">
              <AlertCircle size={18} className="mr-2" />合規異常與逾期警示 (自動檢核)
            </h3>
          </div>
          <div className="p-2">
            <div className="flex items-start space-x-4 p-4 hover:bg-slate-50 dark:hover:bg-slate-700/30 rounded-xl transition-colors">
              <div className="mt-1 w-2 h-2 rounded-full bg-orange-500 shadow-sm"></div>
              <div className="flex-1">
                <p className="text-sm font-medium text-slate-800 dark:text-slate-200">【規政代理異常】李助理連續請假 3 天，尚未指派職務代理人！</p>
                <p className="text-xs text-slate-500 mt-1">今天 09:30</p>
              </div>
              <button className="text-xs px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 font-medium">補件</button>
            </div>
            {overdueTasks.map(task => (
              <div key={task.id} className="flex items-start space-x-4 p-4 hover:bg-slate-50 dark:hover:bg-slate-700/30 rounded-xl transition-colors">
                <div className="mt-1 w-2 h-2 rounded-full bg-red-500 shadow-sm"></div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-200">【工項逾期】{task.title} 已逾期。</p>
                  <p className="text-xs text-slate-500 mt-1">期限: {task.due}</p>
                </div>
                <button onClick={() => handleTaskView(task)} className="text-xs px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 font-medium">查看</button>
              </div>
            ))}
          </div>
        </div>

        {/* 快捷鍵 */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/50 shadow-sm">
          <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700/50">
            <h3 className="font-semibold text-slate-800 dark:text-white">系統快速捷徑</h3>
          </div>
          <div className="p-4 space-y-3">
            {[
              { id: 'reimbursement', icon: Calculator, color: 'text-indigo-600', title: '進入核銷作業專區', desc: '產出考勤、異動與成果報告' },
              { id: 'archive', icon: Upload, color: 'text-emerald-600', title: '快速上傳歸檔文件', desc: '直連 Google Drive 空間' },
              { id: 'tasks', icon: ArrowRightLeft, color: 'text-amber-600', title: '批次交接離職人員工項', desc: '轉派未完成任務給代理人' }
            ].map(btn => (
              <button key={btn.id} onClick={() => setActiveTab(btn.id)} className="w-full flex items-center p-3 rounded-xl border border-slate-200 hover:border-indigo-500 hover:shadow-sm transition-all bg-slate-50 dark:bg-slate-700/30">
                <div className={`p-2 bg-white dark:bg-slate-800 rounded-lg shadow-sm mr-3 ${btn.color}`}><btn.icon size={18} /></div>
                <div className="text-left">
                  <span className={`block text-sm font-medium text-slate-700 dark:text-slate-200 hover:${btn.color}`}>{btn.title}</span>
                  <span className="block text-[10px] text-slate-500">{btn.desc}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
