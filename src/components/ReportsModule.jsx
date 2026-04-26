import React, { useState } from 'react';
import { Calculator, FileText, Users, CheckSquare, Download, Calendar, AlertCircle, CheckCircle2 } from 'lucide-react';

export default function ReportsModule({ user, selectedProject }) {
  // 狀態：儲存使用者選擇的報表區間
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [message, setMessage] = useState(null); // 用於自訂提示訊息 { type: 'error' | 'success', text: '' }

  // 顯示自訂訊息的輔助函式
  const showMessage = (type, text) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  // 處理匯出按鈕點擊 (此處為前端操作介面，實際匯出邏輯需搭配對應套件)
  const handleExport = (reportName) => {
    if (!selectedProject) {
      showMessage('error', '請先選擇一個專案，才能進行報表匯出！');
      return;
    }
    if (!startDate || !endDate) {
      showMessage('error', '請先設定欲產出報表的「開始日期」與「結束日期」！');
      return;
    }
    
    // 實際環境中，這裡會呼叫 API 或執行資料整理匯出
    console.log(`準備匯出 ${reportName}，專案：${selectedProject}，區間：${startDate} 至 ${endDate}`);
    showMessage('success', `系統已接收指令，準備匯出：${reportName} (${startDate} ~ ${endDate})`);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-in fade-in duration-300">
      
      {/* 提示訊息區塊 */}
      {message && (
        <div className={`p-4 rounded-xl border flex items-center shadow-sm animate-in slide-in-from-top-2 ${
          message.type === 'error' 
            ? 'bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-400'
            : 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400'
        }`}>
          {message.type === 'error' ? <AlertCircle size={20} className="mr-3 flex-shrink-0" /> : <CheckCircle2 size={20} className="mr-3 flex-shrink-0" />}
          <span className="text-sm font-bold">{message.text}</span>
        </div>
      )}

      {/* 頂部設定區塊 */}
      <div className="bg-white dark:bg-slate-800 p-6 md:p-8 rounded-3xl border border-slate-200 dark:border-slate-700/80 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-white flex items-center">
            <Calculator className="mr-3 text-indigo-500" size={24} />
            核銷作業報表中心
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">請先設定欲產出報表的日期區間，再點擊下方對應的報表匯出按鈕。</p>
        </div>
        
        <div className="flex items-center space-x-3 bg-slate-50 dark:bg-slate-900/50 p-3 rounded-2xl border border-slate-200 dark:border-slate-700 w-full md:w-auto transition-colors">
          <Calendar className="text-slate-400 dark:text-slate-500" size={18} />
          <input 
            type="date" 
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="bg-transparent text-sm font-bold text-slate-700 dark:text-slate-200 outline-none w-full cursor-pointer" 
          />
          <span className="text-slate-400 font-bold">至</span>
          <input 
            type="date" 
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="bg-transparent text-sm font-bold text-slate-700 dark:text-slate-200 outline-none w-full cursor-pointer" 
          />
        </div>
      </div>

      {/* 報表下載選項 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* 報表 1 */}
        <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-200 dark:border-slate-700/80 shadow-sm flex flex-col h-full group hover:border-indigo-300 dark:hover:border-indigo-500/50 transition-colors">
          <div className="p-4 bg-blue-50 dark:bg-blue-500/10 rounded-2xl w-fit mb-5 group-hover:scale-110 transition-transform">
            <FileText className="text-blue-600 dark:text-blue-400" size={28} />
          </div>
          <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-2">1. 人員考勤匯總表</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 flex-1 mb-8 leading-relaxed">
            包含所選區間內的出勤總天數、各類假別明細、規政代理人簽核紀錄與超休警示。
          </p>
          <button 
            onClick={() => handleExport('人員考勤匯總表 (Excel)')} 
            className="w-full flex justify-center items-center space-x-2 py-3 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl transition-all active:scale-95 shadow-sm"
          >
            <Download size={16} /> <span>匯出 Excel</span>
          </button>
        </div>

        {/* 報表 2 */}
        <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-200 dark:border-slate-700/80 shadow-sm flex flex-col h-full group hover:border-indigo-300 dark:hover:border-indigo-500/50 transition-colors">
          <div className="p-4 bg-emerald-50 dark:bg-emerald-500/10 rounded-2xl w-fit mb-5 group-hover:scale-110 transition-transform">
            <Users className="text-emerald-600 dark:text-emerald-400" size={28} />
          </div>
          <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-2">2. 異動與空缺紀錄表</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 flex-1 mb-8 leading-relaxed">
            詳列期間內的人員到離職與調職軌跡，並自動精算計畫駐點人力之「空缺天數」。
          </p>
          <button 
            onClick={() => handleExport('異動與空缺紀錄表 (PDF)')} 
            className="w-full flex justify-center items-center space-x-2 py-3 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl transition-all active:scale-95 shadow-sm"
          >
            <Download size={16} /> <span>匯出 PDF</span>
          </button>
        </div>

        {/* 報表 3 */}
        <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-200 dark:border-slate-700/80 shadow-sm flex flex-col h-full group hover:border-indigo-300 dark:hover:border-indigo-500/50 transition-colors">
          <div className="p-4 bg-amber-50 dark:bg-amber-500/10 rounded-2xl w-fit mb-5 group-hover:scale-110 transition-transform">
            <CheckSquare className="text-amber-600 dark:text-amber-400" size={28} />
          </div>
          <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-2">3. 期中/期末成果初稿</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 flex-1 mb-8 leading-relaxed">
            擷取區間內已完成之工項列表、會議清單及甘特圖，作為撰寫正式報告之基底。
          </p>
          <button 
            onClick={() => handleExport('期中/期末成果初稿 (Word)')} 
            className="w-full flex justify-center items-center space-x-2 py-3 border-2 border-indigo-100 dark:border-indigo-500/30 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 text-sm font-bold rounded-xl transition-all active:scale-95"
          >
            <Download size={16} /> <span>產出 Word 初稿</span>
          </button>
        </div>

      </div>
    </div>
  );
}
