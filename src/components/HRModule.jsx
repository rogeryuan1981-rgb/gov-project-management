import React from 'react';
import { Users, CheckCircle2, AlertCircle, Upload, Plus } from 'lucide-react';

export default function HRModule() {
  const mockUsers = [
    { id: 1, name: '王主任', role: '專案主任', isResident: true, hireDate: '2024-01-01', status: 'active', proxyAlert: false },
    { id: 2, name: '林組長', role: '專案小組長', isResident: true, hireDate: '2024-02-15', status: 'active', proxyAlert: false },
    { id: 3, name: '李助理', role: '專案助理', isResident: true, hireDate: '2025-03-01', status: 'active', proxyAlert: true },
    { id: 4, name: '陳專員', role: '專業人員', isResident: false, hireDate: '2025-06-10', status: 'active', proxyAlert: false },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center space-x-4">
          <div className="p-3 bg-indigo-50 rounded-xl text-indigo-600"><Users size={24} /></div>
          <div><p className="text-sm text-slate-500">系統建檔總人數</p><p className="text-2xl font-bold">17</p></div>
        </div>
        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center space-x-4">
          <div className="p-3 bg-emerald-50 rounded-xl text-emerald-600"><CheckCircle2 size={24} /></div>
          <div><p className="text-sm text-slate-500">目前駐點人力配置</p><p className="text-2xl font-bold">15/15 <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">合規</span></p></div>
        </div>
        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-orange-200 shadow-sm flex items-center space-x-4">
          <div className="p-3 bg-orange-50 rounded-xl text-orange-600"><AlertCircle size={24} /></div>
          <div><p className="text-sm text-slate-500">規政代理異常待補件</p><p className="text-2xl font-bold text-orange-600">1</p></div>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
          <h3 className="font-semibold text-slate-800 dark:text-white">人員名冊與合規紀錄</h3>
          <div className="flex space-x-3">
            <button className="flex items-center space-x-2 px-4 py-2 border border-slate-200 text-sm font-medium rounded-lg hover:bg-slate-50"><Upload size={16} /><span>匯入考勤</span></button>
            <button className="flex items-center space-x-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700"><Plus size={16} /><span>新增人員</span></button>
          </div>
        </div>
        <table className="w-full text-left">
          <thead className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200">
            <tr>
              <th className="py-3 px-6 text-xs font-semibold text-slate-500 uppercase">姓名/職稱</th>
              <th className="py-3 px-6 text-xs font-semibold text-slate-500 uppercase">狀態</th>
              <th className="py-3 px-6 text-xs font-semibold text-slate-500 uppercase text-center">駐點身分</th>
              <th className="py-3 px-6 text-xs font-semibold text-slate-500 uppercase">到職日</th>
              <th className="py-3 px-6 text-xs font-semibold text-slate-500 uppercase">合規稽核標記</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {mockUsers.map(user => (
              <tr key={user.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                <td className="py-3 px-6 font-medium text-slate-900 dark:text-slate-200">{user.name} <span className="block text-xs text-slate-500">{user.role}</span></td>
                <td className="py-3 px-6"><span className="px-2 py-1 bg-emerald-50 text-emerald-600 rounded text-xs">在職</span></td>
                <td className="py-3 px-6 text-center">{user.isResident ? <CheckCircle2 size={16} className="mx-auto text-indigo-500" /> : '-'}</td>
                <td className="py-3 px-6 text-sm">{user.hireDate}</td>
                <td className="py-3 px-6">{user.proxyAlert ? <span className="text-orange-600 text-xs font-medium"><AlertCircle size={12} className="inline mr-1"/>缺代理人</span> : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
