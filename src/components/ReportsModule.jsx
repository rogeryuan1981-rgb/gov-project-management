import React from 'react';
import { Calculator, FileText, Users, CheckSquare, Download } from 'lucide-react';

export default function ReportsModule() {
  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-in fade-in duration-300">
      <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 shadow-sm flex justify-between items-center">
        <div>
          <h2 className="text-lg font-bold flex items-center"><Calculator className="mr-2 text-indigo-500" />核銷作業報表中心</h2>
          <p className="text-sm text-slate-500">請先設定欲產出報表的日期區間</p>
        </div>
        <div className="flex items-center space-x-2 bg-slate-50 p-2 rounded-xl border border-slate-200">
          <input type="date" className="bg-transparent text-sm outline-none px-2" defaultValue="2026-01-01" />
          <span>至</span>
          <input type="date" className="bg-transparent text-sm outline-none px-2" defaultValue="2026-06-30" />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col">
          <FileText className="text-blue-600 mb-4" size={24} />
          <h3 className="font-bold mb-2">1. 人員考勤匯總表</h3>
          <p className="text-sm text-slate-500 flex-1 mb-6">包含所選區間內的出勤天數、規政代理人簽核紀錄與超休警示。</p>
          <button className="w-full flex justify-center py-2.5 bg-indigo-600 text-white text-sm rounded-xl"><Download size={16} className="mr-2"/>匯出 Excel</button>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col">
          <Users className="text-emerald-600 mb-4" size={24} />
          <h3 className="font-bold mb-2">2. 異動與空缺紀錄表</h3>
          <p className="text-sm text-slate-500 flex-1 mb-6">詳列人員到離職軌跡，並自動精算計畫駐點人力之「空缺天數」。</p>
          <button className="w-full flex justify-center py-2.5 bg-indigo-600 text-white text-sm rounded-xl"><Download size={16} className="mr-2"/>匯出 PDF</button>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col">
          <CheckSquare className="text-amber-600 mb-4" size={24} />
          <h3 className="font-bold mb-2">3. 期中期末初稿</h3>
          <p className="text-sm text-slate-500 flex-1 mb-6">擷取區間內已完成之工項列表、會議清單及甘特圖。</p>
          <button className="w-full flex justify-center py-2.5 border border-indigo-200 text-indigo-600 text-sm rounded-xl"><Download size={16} className="mr-2"/>產出 Word 初稿</button>
        </div>
      </div>
    </div>
  );
}
