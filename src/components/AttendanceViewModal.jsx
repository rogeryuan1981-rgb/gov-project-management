import React, { useState, useEffect } from 'react';
import { X, Calendar, User, Search, RefreshCw, AlertCircle, Clock, FileText, Loader2, CheckCircle2, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { collection, query, where, getDocs, getFirestore, doc, getDoc } from 'firebase/firestore';
import { getApp } from 'firebase/app';

const db = getFirestore(getApp());

export default function AttendanceViewModal({ isOpen, onClose, selectedProject, personnel = [] }) {
  const [viewMonth, setViewMonth] = useState(new Date().toISOString().substring(0, 7));
  const [searchName, setSearchName] = useState('');
  const [records, setRecords] = useState([]);
  const [offDays, setOffDays] = useState({}); 
  const [isLoading, setIsLoading] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: 'date', direction: 'asc' });

  // 核心讀取與交叉互補演算引擎
  const fetchData = async () => {
    if (!selectedProject) return;
    setIsLoading(true);
    try {
      // 步驟 A：讀取工作日曆放假設定
      const calendarDocRef = doc(db, 'artifacts', 'gov-project-saas', 'public', 'data', 'calendars', selectedProject);
      const calendarSnap = await getDoc(calendarDocRef);
      let currentOffDays = {};
      if (calendarSnap.exists()) {
        currentOffDays = calendarSnap.data().offDays || {};
        setOffDays(currentOffDays);
      }

      // 步驟 B：讀取該月份已匯入的所有考勤紀錄
      const attendanceRef = collection(db, 'artifacts', 'gov-project-saas', 'public', 'data', 'attendance_records');
      const q = query(
        attendanceRef, 
        where('projectId', '==', selectedProject),
        where('month', '==', viewMonth)
      );
      
      const querySnapshot = await getDocs(q);
      const importedRecords = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // 步驟 C：動態計算當月天數足跡
      const year = parseInt(viewMonth.split('-')[0], 10);
      const month = parseInt(viewMonth.split('-')[1], 10);
      const daysInMonth = new Date(year, month, 0).getDate();

      // 抓取計畫編制人員名冊作為基礎矩陣基準
      const projectEmployees = personnel
        .filter(p => {
          if (p.hireDate && p.hireDate > `${year}-${String(month).padStart(2, '0')}-${daysInMonth}`) return false;
          if (p.contractEnd && p.contractEnd < `${year}-${String(month).padStart(2, '0')}-01`) return false;
          return true;
        })
        .map(p => p.name);

      const finalEmployeeList = projectEmployees.length > 0 
        ? projectEmployees 
        : [...new Set(importedRecords.map(r => r.name))].filter(Boolean);

      const finalMeshRecords = [];

      // 步驟 D：橫向調閱名冊、考勤紀錄，實作跨表互補機制
      if (finalEmployeeList.length > 0) {
        finalEmployeeList.forEach(empName => {
          for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const isOffDay = !!currentOffDays[dateStr];

            const sameDayRecords = importedRecords.filter(r => r.name === empName && r.date === dateStr);
            let mergedRecord = null;

            if (sameDayRecords.length > 0) {
              const validClockInRecord = sameDayRecords.find(r => r.checkIn && r.checkIn !== '');
              const validClockOutRecord = sameDayRecords.find(r => r.checkOut && r.checkOut !== '');
              const validLeaveRecord = sameDayRecords.find(r => r.leaveType && r.leaveType !== '');

              mergedRecord = {
                id: `merged_${empName}_${dateStr}`,
                projectId: selectedProject,
                month: viewMonth,
                name: empName,
                date: dateStr,
                checkIn: validClockInRecord ? validClockInRecord.checkIn : (sameDayRecords[0].checkIn || ""),
                checkOut: validClockOutRecord ? validClockOutRecord.checkOut : (sameDayRecords[0].checkOut || ""),
                leaveRangeInfo: validLeaveRecord ? validLeaveRecord.leaveRangeInfo : (sameDayRecords[0].leaveRangeInfo || ""),
                leaveType: validLeaveRecord ? validLeaveRecord.leaveType : (sameDayRecords[0].leaveType || ""),
                recordType: 'MUTUAL_COMPLEMENT',
                isOffDay
              };
            }

            if (mergedRecord) {
              finalMeshRecords.push(mergedRecord);
            } else {
              finalMeshRecords.push({
                id: `generated_${empName}_${dateStr}`,
                projectId: selectedProject,
                month: viewMonth,
                name: empName,
                date: dateStr,
                checkIn: '',
                checkOut: '',
                leaveRangeInfo: '',
                leaveType: '',
                isOffDay,
                isGeneratedMissing: true 
              });
            }
          }
        });
      }
      
      setRecords(finalMeshRecords);
    } catch (error) {
      console.error("日曆與跨表互補交叉演算失敗:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchData();
    }
  }, [isOpen, viewMonth, selectedProject, personnel]);

  if (!isOpen) return null;

  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const SortIcon = ({ columnKey }) => {
    if (sortConfig.key !== columnKey) {
      return <ArrowUpDown size={14} className="inline ml-1 text-slate-300 dark:text-slate-600" />;
    }
    return sortConfig.direction === 'asc' 
      ? <ArrowUp size={14} className="inline ml-1 text-indigo-500" /> 
      : <ArrowDown size={14} className="inline ml-1 text-indigo-500" />;
  };

  const filteredRecords = records.filter(r => 
    r.name.toLowerCase().includes(searchName.trim().toLowerCase())
  );

  const sortedRecords = [...filteredRecords].sort((a, b) => {
    if (!sortConfig.key) return 0;
    let aValue = a[sortConfig.key] || '';
    let bValue = b[sortConfig.key] || '';
    if (aValue === bValue) {
      if (sortConfig.key === 'date') return a.name.localeCompare(b.name);
      return a.date.localeCompare(b.date);
    }
    return sortConfig.direction === 'asc' ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
  });

  // ================= 輔助演算法：將 "HH:MM" 轉為當天分鐘數 =================
  const timeToMinutes = (timeStr) => {
    if (!timeStr || !timeStr.includes(':')) return null;
    const parts = timeStr.split(':');
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  };

  // ================= 核心升級：精準彈性工時與遞延異常判定引擎 =================
  const renderStatusBadge = (r) => {
    // 狀況一：非工作日 (國定假日 / 例假日)
    if (r.isOffDay) {
      if (r.checkIn || r.checkOut) {
        return (
          <span className="px-2.5 py-1 bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400 text-xs font-bold rounded-lg border border-amber-200 dark:border-amber-500/30">
            假日加班
          </span>
        );
      }
      return (
        <span className="px-2.5 py-1 bg-slate-100 text-slate-500 dark:bg-slate-700/50 dark:text-slate-400 text-xs font-bold rounded-lg border border-slate-200 dark:border-slate-700">
          例假日/放假
        </span>
      );
    }

    // 狀況二：應上班日，若有表定請假紀錄 (沖銷成功優先判定)
    if (r.leaveType) {
      return (
        <span className="px-2.5 py-1 bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400 text-xs font-bold rounded-lg border border-blue-200 dark:border-blue-500/30 flex items-center w-fit">
          <CheckCircle2 size={12} className="mr-1 text-blue-500" /> 已請假 ({r.leaveType})
        </span>
      );
    }

    // 狀況三：應上班日，完全查無任何刷卡打卡足跡 (曠職)
    if (!r.checkIn && !r.checkOut) {
      return (
        <span className="px-2.5 py-1 bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400 text-xs font-bold rounded-lg border border-red-200 dark:border-red-500/30 flex items-center w-fit animate-pulse">
          <AlertCircle size={12} className="mr-1 text-red-500" /> 曠職 (應上班未打卡)
        </span>
      );
    }

    // 狀況四：應上班日，只有單邊打卡紀錄 (缺卡異常)
    if (!r.checkIn || !r.checkOut) {
      return (
        <span className="px-2.5 py-1 bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400 text-xs font-bold rounded-lg border border-orange-200 dark:border-orange-500/30">
          異常: 缺打卡
        </span>
      );
    }

    // 狀況五：應上班日，兩邊皆有打卡數據 $\rightarrow$ 執行「彈性工時遞延演算法」
    const inMins = timeToMinutes(r.checkIn);
    const outMins = timeToMinutes(r.checkOut);

    if (inMins !== null && outMins !== null) {
      const minStartMins = 8 * 60;      // 08:00
      const maxStartMins = 9 * 60;      // 09:00
      const noonStartMins = 12 * 60 + 30; // 12:30
      const noonEndMins = 13 * 60 + 30;   // 13:30

      let isLate = false;
      let lateMinutes = 0;
      let isEarlyLeave = false;
      let earlyLeaveMinutes = 0;

      // A. 判定是否遲到 (晚於 09:00 算遲到)
      if (inMins > maxStartMins) {
        isLate = true;
        lateMinutes = inMins - maxStartMins;
      }

      // B. 計算合法的最早下班時間基準點
      let requiredWorkMins = 8 * 60 + 60; // 8小時工時 + 1小時午休 = 9小時 = 540分鐘
      let legalMinOutMins = 0;

      if (isLate) {
        // 如果遲到，工時最晚遞延上限只卡死在 09:00，因此下班底線一律是 18:00 (1080分鐘)
        legalMinOutMins = 18 * 60; 
      } else {
        // 彈性區間內 (08:00 ~ 09:00)：上班時間直接遞延 9 小時即為合法下班點
        // 若低於 08:00 來 (如07:50)，最早下班底線依然卡死在 17:00 (08:00 + 9小時)
        const effectiveInMins = Math.max(inMins, minStartMins);
        legalMinOutMins = effectiveInMins + requiredWorkMins;
      }

      // C. 判定是否早退
      if (outMins < legalMinOutMins) {
        isEarlyLeave = true;
        earlyLeaveMinutes = legalMinOutMins - outMins;
      }

      // D. 綜合異常警示輸出
      if (isLate && isEarlyLeave) {
        return (
          <span className="px-2.5 py-1 bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400 text-xs font-bold rounded-lg border border-red-200 dark:border-red-500/30">
            遲到 {lateMinutes} 分 / 早退 {earlyLeaveMinutes} 分
          </span>
        );
      }
      if (isLate) {
        return (
          <span className="px-2.5 py-1 bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400 text-xs font-bold rounded-lg border border-orange-200 dark:border-orange-500/30">
            遲到 {lateMinutes} 分鐘
          </span>
        );
      }
      if (isEarlyLeave) {
        return (
          <span className="px-2.5 py-1 bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400 text-xs font-bold rounded-lg border border-orange-200 dark:border-orange-500/30">
            早退 {earlyLeaveMinutes} 分鐘
          </span>
        );
      }
    }

    // 通過以上所有考驗，判定正常出勤
    return (
      <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 text-xs font-bold rounded-lg border border-emerald-200 dark:border-emerald-500/30">
        正常出勤
      </span>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
      <div className="bg-white dark:bg-slate-800 w-full max-w-5xl rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col h-[85vh]">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-800/80">
          <div className="flex items-center space-x-2">
            <Clock size={22} className="text-indigo-500" />
            <div>
              <h3 className="font-bold text-lg text-slate-800 dark:text-white">計畫人員月考勤與日曆覆核</h3>
              <p className="text-xs text-slate-400 mt-0.5">目前已全面導入：彈性遞延工時常態比對機制（彈性區間 08:00~09:00、扣除 12:30~13:30 午休時間）。</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Filter Bar */}
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
              placeholder="搜尋人員姓名..."
              value={searchName}
              onChange={(e) => setSearchName(e.target.value)}
              className="pl-9 pr-4 py-2 w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs outline-none focus:border-indigo-500"
            />
          </div>

          <div className="flex justify-end">
            <button 
              onClick={fetchData}
              disabled={isLoading}
              className="flex items-center space-x-1.5 px-4 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-300 hover:shadow-sm transition-all disabled:opacity-50"
            >
              <RefreshCw size={12} className={isLoading ? "animate-spin" : ""} />
              <span>重新比對日曆</span>
            </button>
          </div>
        </div>

        {/* Table Content */}
        <div className="overflow-y-auto flex-1 p-6 bg-slate-50/30 dark:bg-slate-900/10">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-full space-y-2">
              <Loader2 size={36} className="text-indigo-500 animate-spin" />
              <span className="text-xs text-slate-400">正在執行彈性遞延與跨表整合交集演算...</span>
            </div>
          ) : sortedRecords.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-12">
              <FileText size={48} className="text-slate-300 dark:text-slate-600 mb-3" />
              <p className="text-sm font-bold text-slate-700 dark:text-slate-300">目前計畫尚未建立任何人員建檔</p>
              <p className="text-xs text-slate-400 mt-1">請先關閉此視窗，在「人事建檔與編制」頁籤中新增計畫人員。</p>
            </div>
          ) : (
            <div className="border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden shadow-sm bg-white dark:bg-slate-800">
              <table className="w-full text-left border-collapse">
                <thead className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th 
                      className="py-3 px-4 text-xs font-bold text-slate-500 uppercase cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 select-none"
                      onClick={() => handleSort('date')}
                    >
                      打卡日期 <SortIcon columnKey="date" />
                    </th>
                    <th 
                      className="py-3 px-4 text-xs font-bold text-slate-500 uppercase cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 select-none"
                      onClick={() => handleSort('name')}
                    >
                      姓名 <SortIcon columnKey="name" />
                    </th>
                    <th className="py-3 px-4 text-xs font-bold text-slate-500 uppercase">上班時間 (M)</th>
                    <th className="py-3 px-4 text-xs font-bold text-slate-500 uppercase">下班時間 (O)</th>
                    <th className="py-3 px-4 text-xs font-bold text-slate-500 uppercase">表定請假區間 (Z)</th>
                    <th className="py-3 px-4 text-xs font-bold text-slate-500 uppercase">日曆與工時交叉結果</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50 text-xs font-medium text-slate-700 dark:text-slate-300">
                  {sortedRecords.map((r) => {
                    let rowBg = "hover:bg-slate-50/80 dark:hover:bg-slate-700/30 transition-colors";
                    if (!r.isOffDay && !r.leaveType && !r.checkIn && !r.checkOut) {
                      rowBg = "bg-red-50/30 hover:bg-red-50/50 dark:bg-red-950/10 dark:hover:bg-red-950/20 transition-colors text-red-950 dark:text-red-300";
                    } else if (r.isOffDay) {
                      rowBg = "bg-slate-50/40 text-slate-400 dark:bg-slate-900/10 transition-colors";
                    }

                    return (
                      <tr key={r.id} className={rowBg}>
                        <td className="py-3.5 px-4 font-mono font-bold">{r.date}</td>
                        <td className="py-3.5 px-4 font-bold">{r.name}</td>
                        <td className="py-3.5 px-4 font-mono">{r.checkIn || '--'}</td>
                        <td className="py-3.5 px-4 font-mono">{r.checkOut || '--'}</td>
                        <td className="py-3.5 px-4 max-w-[200px] truncate" title={r.leaveRangeInfo}>
                          {r.leaveRangeInfo || '--'}
                        </td>
                        <td className="py-3.5 px-4">{renderStatusBadge(r)}</td>
                      </tr>
                    );
                  })}
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
