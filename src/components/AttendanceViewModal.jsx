import React, { useState, useEffect } from 'react';
import { X, Calendar, User, Search, RefreshCw, AlertCircle, Clock, FileText, Loader2 } from 'lucide-react';
import { collection, query, where, getDocs, getFirestore } from 'firebase/firestore';
import { getApp } from 'firebase/app';

const db = getFirestore(getApp());

export default function AttendanceViewModal({ isOpen, onClose, selectedProject }) {
  const [viewMonth, setViewMonth] = useState(new Date().toISOString().substring(0, 7));
  const [searchName, setSearchName] = useState('');
  const [records, setRecords] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  // 讀取 Firestore 中的即時考勤資料
  const fetchAttendanceRecords = async () => {
    if (!selectedProject) return;
    setIsLoading(true);
    try {
      const attendanceRef = collection(db, 'artifacts', 'gov-project-saas', 'public', 'data', 'attendance_records');
      // 依據專案與選定月份進行查詢
      const q = query(
        attendanceRef, 
        where('projectId', '==', selectedProject),
        where('month', '==', viewMonth)
      );
      
      const querySnapshot = await getDocs(q);
      const loadedRecords = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      // 依據日期與姓名排序
      loadedRecords.sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return a.name.localeCompare(b.name);
      });
      
      setRecords(loadedRecords);
    } catch (error) {
      console.error("讀取考勤紀錄失敗:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchAttendanceRecords();
    }
  }, [isOpen, viewMonth, selectedProject]);

  if (!isOpen) return null;

  // 前端搜尋過濾 (姓名)
  const filteredRecords = records.filter(r => 
    r.name.toLowerCase().includes(searchName.trim().toLowerCase())
  );

  // 輔助函式：根據打卡與請假狀態決定 Badge 視覺
  const renderStatusBadge = (r) => {
    if (r.leaveType) {
      return (
        <span className="px-2.5 py-1 bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400 text-xs font-bold rounded-lg border border-blue-200 dark:border-blue-500/30">
          假別: {r.leaveType}
        </span>
      );
    }
    if (!r.checkIn && !r.checkOut) {
      return (
        <span className="px-2.5 py-1 bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400 text-xs font-bold rounded-lg border border-red-200 dark:border-red-500/30 flex items-center w-fit">
          <AlertCircle size={12} className="mr-1" /> 未打卡
        </span>
      );
    }
    if (!r.checkIn || !r.checkOut) {
      return (
        <span className="px-2.5 py-1 bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400 text-xs font-bold rounded-lg border border-orange-200 dark:border-orange-500/30">
          異常: 缺卡
        </span>
      );
    }
    return (
      <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 text-xs font-bold rounded-lg border border-emerald-200 dark:border-emerald-500/30">
        正常出勤
      </span>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
      <div className="bg-white dark:bg-slate-800 w-full max-w-4xl rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col h-[85vh]">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-800/80">
          <div className="flex items-center space-x-2">
            <Clock size={22} className="text-indigo-500" />
            <div>
              <h3 className="font-bold text-lg text-slate-800 dark:text-white">檢視已匯入考勤明細</h3>
              <p className="text-xs text-slate-400 mt-0.5">即時查詢資料庫中儲存的同仁刷卡與差假明細</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* 核心過濾工具列（Filter Bar） */}
        <div className="p-4 bg-slate-50/50 dark:bg-slate-900/30 border-b border-slate-100 dark:border-slate-700 grid grid-cols-1 sm:grid-cols-3 gap-3 items-center">
          <div className="flex items-center space-x-2">
            <Calendar size={14} className="text-slate-400 shrink-0" />
            <input 
              type="month" 
              value={viewMonth}
              onChange={(e) => setViewMonth(e.target.value)}
              className="text-xs font-bold p-2 rounded-xl border dark:bg-slate-800 dark:border-slate-700 w-full outline-none focus:border-indigo-500"
            />
          </div>
          
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" />
            <input 
              type="text"
              placeholder="搜尋人員姓名 (ex. 于家源)"
              value={searchName}
              onChange={(e) => setSearchName(e.target.value)}
              className="pl-9 pr-4 py-2 w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs outline-none focus:border-indigo-500"
            />
          </div>

          <div className="flex justify-end">
            <button 
              onClick={fetchAttendanceRecords}
              disabled={isLoading}
              className="flex items-center space-x-1.5 px-4 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-300 hover:shadow-sm transition-all disabled:opacity-50"
            >
              <RefreshCw size={12} className={isLoading ? "animate-spin" : ""} />
              <span>重新整理</span>
            </button>
          </div>
        </div>

        {/* 考勤資料數據表格區 */}
        <div className="overflow-x-auto flex-1 p-6">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-full space-y-2">
              <Loader2 size={36} className="text-indigo-500 animate-spin" />
              <span className="text-xs text-slate-400">正在從雲端讀取出勤足跡...</span>
            </div>
          ) : filteredRecords.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-12">
              <FileText size={48} className="text-slate-300 dark:text-slate-600 mb-3" />
              <p className="text-sm font-bold text-slate-700 dark:text-slate-300">該月份無符合條件的考勤資料</p>
              <p className="text-xs text-slate-400 mt-1">請確認上方月份選擇，或點擊「匯入考勤 Excel」上傳 CSV 報表。</p>
            </div>
          ) : (
            <div className="border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden shadow-sm bg-white dark:bg-slate-800">
              <table className="w-full text-left border-collapse">
                <thead className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th className="py-3 px-4 text-xs font-bold text-slate-500 uppercase">打卡日期</th>
                    <th className="py-3 px-4 text-xs font-bold text-slate-500 uppercase">姓名</th>
                    <th className="py-3 px-4 text-xs font-bold text-slate-500 uppercase">上班時間</th>
                    <th className="py-3 px-4 text-xs font-bold text-slate-500 uppercase">下班時間</th>
                    <th className="py-3 px-4 text-xs font-bold text-slate-500 uppercase">請假/差假區間</th>
                    <th className="py-3 px-4 text-xs font-bold text-slate-500 uppercase">系統狀態</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50 text-xs font-medium text-slate-700 dark:text-slate-300">
                  {filteredRecords.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-700/30 transition-colors">
                      <td className="py-3.5 px-4 font-mono font-bold text-slate-900 dark:text-slate-100">{r.date}</td>
                      <td className="py-3.5 px-4 font-bold flex items-center">
                        <User size={12} className="mr-1.5 text-indigo-400" /> {r.name}
                      </td>
                      <td className="py-3.5 px-4 font-mono">{r.checkIn || '--'}</td>
                      <td className="py-3.5 px-4 font-mono">{r.checkOut || '--'}</td>
                      <td className="py-3.5 px-4 text-slate-500 max-w-[200px] truncate" title={r.leaveRangeInfo}>
                        {r.leaveRangeInfo || '--'}
                      </td>
                      <td className="py-3.5 px-4">{renderStatusBadge(r)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 flex justify-end">
          <button onClick={onClose} className="px-6 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 font-bold text-slate-700 dark:text-slate-200 text-sm rounded-xl transition-colors">
            關閉視窗
          </button>
        </div>
      </div>
    </div>
  );
}
