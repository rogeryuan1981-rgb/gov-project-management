import React, { useState, useEffect } from 'react';
import { CheckSquare, AlertCircle, UserCircle, FileBarChart, Calculator, Upload, ArrowRightLeft } from 'lucide-react';
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

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {[
          { label: '進行中工項', value: tasks.filter(t=>t.status==='in-progress').length, icon: CheckSquare, color: 'text-blue-500', bg: 'bg-blue-50' },
          { label: '逾期任務', value: tasks.filter(t=>t.status==='overdue').length, icon: AlertCircle, color: 'text-red-500', bg: 'bg-red-50' },
          { label: '本月空缺天數', value: '0', icon: UserCircle, color: 'text-emerald-500', bg: 'bg-emerald-50' },
          { label: '待歸檔文件', value: tasks.filter(t=>t.reqDoc && t.status!=='completed').length, icon: FileBarChart, color: 'text-orange-500', bg: 'bg-orange-50' },
        ].map((stat, i) => (
          <div key={i} className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-100 shadow-sm flex justify-between items-center">
            <div><p className="text-sm text-slate-500">{stat.label}</p><h3 className="text-3xl font-bold">{stat.value}</h3></div>
            <div className={`p-3 rounded-xl ${stat.bg} ${stat.color}`}><stat.icon size={24} /></div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-2xl border border-red-100 shadow-sm">
          <div className="px-6 py-4 border-b border-slate-100 bg-red-50/50"><h3 className="font-semibold text-red-700">合規異常與逾期警示</h3></div>
          <div className="p-4 text-sm text-slate-600">
            {tasks.filter(t=>t.status==='overdue').map(t=>(<p key={t.id} className="py-2 text-red-600">⚠️ {t.title} 已逾期</p>))}
            {tasks.filter(t=>t.status==='overdue').length === 0 && <p>目前無逾期工項。</p>}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 shadow-sm p-4 space-y-3">
          <h3 className="font-semibold mb-2">快速捷徑</h3>
          <button onClick={() => setActiveTab('reimbursement')} className="w-full text-left p-3 rounded-xl border hover:border-indigo-500 text-sm">核銷作業專區</button>
          <button onClick={() => setActiveTab('archive')} className="w-full text-left p-3 rounded-xl border hover:border-emerald-500 text-sm">雲端歸檔上傳</button>
        </div>
      </div>
    </div>
  );
}
