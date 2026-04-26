import React, { useState, useEffect } from 'react';
import { Users, CheckCircle2, AlertCircle, Upload, Plus } from 'lucide-react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase.js';

const globalAppId = typeof __app_id !== 'undefined' ? __app_id : 'gov-project-saas';

export default function HRModule({ user, selectedProject }) {
  const [personnel, setPersonnel] = useState([]);

  // 監聽 Firebase 資料庫中的人事資料 (依照選取的專案過濾)
  useEffect(() => {
    if (!user || !selectedProject) return;

    const hrRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'personnel');
    
    const unsubscribe = onSnapshot(hrRef, (snapshot) => {
      const loadedData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const projectPersonnel = loadedData.filter(p => p.projectName === selectedProject);
      
      // 依到職日排序 (新的在前面)
      projectPersonnel.sort((a, b) => new Date(b.hireDate) - new Date(a.hireDate));
      setPersonnel(projectPersonnel);
    }, (error) => {
      console.error("Firestore personnel listen error:", error);
    });

    return () => unsubscribe();
  }, [user, selectedProject]);

  // 基於真實資料的統計計算
  const totalUsers = personnel.length;
  const residentCount = personnel.filter(p => p.isResident && p.status === 'active').length;
  const proxyAlertCount = personnel.filter(p => p.proxyAlert && p.status === 'active').length;

  return (
    <div className="space-y-6 animate-in fade-in duration-300 max-w-6xl mx-auto">
      {/* 上方統計區塊 (真實數據) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700/50 shadow-sm flex items-center space-x-5 transition-colors">
          <div className="p-3.5 bg-indigo-50 dark:bg-indigo-500/10 rounded-xl text-indigo-600 dark:text-indigo-400">
            <Users size={28} />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-500 dark:text-slate-400 mb-1">系統建檔總人數</p>
            <p className="text-3xl font-black text-slate-800 dark:text-white">
              {totalUsers} <span className="text-sm font-medium text-slate-500">人</span>
            </p>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700/50 shadow-sm flex items-center space-x-5 transition-colors">
          <div className="p-3.5 bg-emerald-50 dark:bg-emerald-500/10 rounded-xl text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 size={28} />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-500 dark:text-slate-400 mb-1">目前駐點人力配置</p>
            <p className="text-3xl font-black text-slate-800 dark:text-white flex items-baseline">
              {residentCount} 
              <span className="text-xs font-bold px-2.5 py-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 rounded-md ml-3 border border-emerald-200 dark:border-emerald-500/30">
                實際在職
              </span>
            </p>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700/50 shadow-sm flex items-center space-x-5 transition-colors">
          <div className={`p-3.5 rounded-xl ${proxyAlertCount > 0 ? 'bg-orange-50 dark:bg-orange-500/10 text-orange-600 dark:text-orange-400' : 'bg-slate-50 dark:bg-slate-700/50 text-slate-400 dark:text-slate-500'}`}>
            <AlertCircle size={28} />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-500 dark:text-slate-400 mb-1">規政代理異常待補件</p>
            <p className={`text-3xl font-black ${proxyAlertCount > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-slate-800 dark:text-white'}`}>
              {proxyAlertCount} <span className={`text-sm font-medium ${proxyAlertCount > 0 ? 'text-orange-500' : 'text-slate-500'}`}>件</span>
            </p>
          </div>
        </div>
      </div>

      {/* 人員名冊表格 */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/50 shadow-sm overflow-hidden transition-colors">
        <div className="p-5 border-b border-slate-200 dark:border-slate-700/50 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/80">
          <h3 className="font-bold text-slate-800 dark:text-white">人員名冊與合規紀錄</h3>
          <div className="flex space-x-3">
            <button className="flex items-center space-x-2 px-4 py-2 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-sm font-bold">
              <Upload size={16} />
              <span>匯入考勤 Excel</span>
            </button>
            <button className="flex items-center space-x-2 px-4 py-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 shadow-sm font-bold text-sm transition-colors">
              <Plus size={16} />
              <span>新增人員</span>
            </button>
          </div>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="py-4 px-6 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">姓名/職稱</th>
                <th className="py-4 px-6 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">狀態</th>
                <th className="py-4 px-6 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-center">駐點身分</th>
                <th className="py-4 px-6 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">到職日</th>
                <th className="py-4 px-6 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">合規稽核標記</th>
                <th className="py-4 px-6 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
              {/* 若真實資料為空，顯示空白狀態 */}
              {personnel.length === 0 ? (
                <tr>
                  <td colSpan="6" className="py-16 text-center">
                    <div className="flex flex-col items-center justify-center">
                      <Users size={48} className="text-slate-300 dark:text-slate-600 mb-4" />
                      <p className="text-slate-700 dark:text-slate-300 font-medium mb-1">此專案目前尚無人事建檔資料</p>
                      <p className="text-slate-500 text-sm">請點擊右上方「新增人員」或「匯入考勤 Excel」建立真實資料。</p>
                    </div>
                  </td>
                </tr>
              ) : (
                personnel.map(u => (
                  <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors group">
                    <td className="py-4 px-6">
                      <div className="flex flex-col">
                        <span className="font-bold text-slate-900 dark:text-slate-200">{u.name}</span>
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-1">{u.role}</span>
                      </div>
                    </td>
                    <td className="py-4 px-6">
                      {u.status === 'active' 
                        ? <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 rounded-md text-xs font-bold border border-emerald-200 dark:border-emerald-500/30">在職</span>
                        : <span className="px-2.5 py-1 bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400 rounded-md text-xs font-bold border border-slate-200 dark:border-slate-600">離職</span>
                      }
                    </td>
                    <td className="py-4 px-6 text-center">
                      {u.isResident ? <CheckCircle2 size={18} className="mx-auto text-indigo-500 dark:text-indigo-400" /> : <span className="text-slate-300 dark:text-slate-600 font-bold">-</span>}
                    </td>
                    <td className="py-4 px-6 text-sm font-medium text-slate-600 dark:text-slate-300">{u.hireDate}</td>
                    <td className="py-4 px-6">
                      {u.proxyAlert ? (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400 text-xs font-bold border border-orange-200 dark:border-orange-500/30">
                          <AlertCircle size={14} className="mr-1.5" /> 缺代理人
                        </span>
                      ) : (
                        <span className="text-slate-300 dark:text-slate-600 text-sm font-bold">-</span>
                      )}
                    </td>
                    <td className="py-4 px-6 text-right">
                      <button className="text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300 text-sm font-bold transition-colors opacity-0 group-hover:opacity-100">
                        編輯
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
