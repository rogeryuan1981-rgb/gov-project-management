import React from 'react';
import { Users, CheckCircle2, AlertCircle, Upload, Plus } from 'lucide-react';

export default function HRModule({ user, selectedProject }) {
  // 這裡暫時使用假資料展示，未來可替換為從 Firebase 讀取
  const mockUsers = [
    { id: 1, name: '王主任', role: '專案主任', isResident: true, hireDate: '2024-01-01', status: 'active', proxyAlert: false },
    { id: 2, name: '林組長', role: '專案小組長', isResident: true, hireDate: '2024-02-15', status: 'active', proxyAlert: false },
    { id: 3, name: '李助理', role: '專案助理', isResident: true, hireDate: '2025-03-01', status: 'active', proxyAlert: true },
    { id: 4, name: '陳專員', role: '專業人員', isResident: false, hireDate: '2025-06-10', status: 'active', proxyAlert: false },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-300 max-w-6xl mx-auto">
      {/* 上方統計區塊 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700/50 shadow-sm flex items-center space-x-5 transition-colors">
          <div className="p-3.5 bg-indigo-50 dark:bg-indigo-500/10 rounded-xl text-indigo-600 dark:text-indigo-400">
            <Users size={28} />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-500 dark:text-slate-400 mb-1">系統建檔總人數</p>
            <p className="text-3xl font-black text-slate-800 dark:text-white">
              17 <span className="text-sm font-medium text-slate-500">人</span>
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
              15<span className="text-lg text-slate-400 dark:text-slate-500 mx-1">/15</span> 
              <span className="text-xs font-bold px-2.5 py-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 rounded-md ml-2 border border-emerald-200 dark:border-emerald-500/30">合規</span>
            </p>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-orange-200 dark:border-orange-500/30 shadow-sm flex items-center space-x-5 transition-colors">
          <div className="p-3.5 bg-orange-50 dark:bg-orange-500/10 rounded-xl text-orange-600 dark:text-orange-400">
            <AlertCircle size={28} />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-500 dark:text-slate-400 mb-1">規政代理異常待補件</p>
            <p className="text-3xl font-black text-orange-600 dark:text-orange-400">
              1 <span className="text-sm font-medium text-orange-500">件</span>
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
              {mockUsers.map(u => (
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
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
