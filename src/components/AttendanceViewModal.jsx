import React, { useState, useEffect } from 'react';
import { X, Calendar, User, Search, RefreshCw, AlertCircle, Clock, FileText, Loader2, CheckCircle2, ArrowUpDown, ArrowUp, ArrowDown, Filter, Download } from 'lucide-react';
import { collection, query, where, getDocs, getFirestore, doc, getDoc } from 'firebase/firestore';
import { getApp } from 'firebase/app';

const db = getFirestore(getApp());

export default function AttendanceViewModal({ isOpen, onClose, selectedProject, personnel = [], allExistingUnits = [] }) {
  const [viewMonth, setViewMonth] = useState(new Date().toISOString().substring(0, 7));
  const [searchName, setSearchName] = useState('');
  const [selectedUnit, setSelectedUnit] = useState('ALL');
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
      const activePersonnel = personnel.filter(p => {
        if (p.hireDate && p.hireDate > `${year}-${String(month).padStart(2, '0')}-${daysInMonth}`) return false;
        if (p.contractEnd && p.contractEnd < `${year}-${String(month).padStart(2, '0')}-01`) return false;
        return true;
      });

      const finalEmployeeList = activePersonnel.length > 0 
        ? activePersonnel.map(p => ({ name: p.name, unit: p.unit || '未指定單位' }))
        : [...new Set(importedRecords.map(r => r.name))].filter(Boolean).map(name => ({ name, unit: '已匯入人員' }));

      const finalMeshRecords = [];

      // 步驟 D：橫向調閱名冊、考勤紀錄，實作跨表互補機制
      if (finalEmployeeList.length > 0) {
        finalEmployeeList.forEach(emp => {
          for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const isOffDay = !!currentOffDays[dateStr];

            // 跨表數據互補演算法
            const sameDayRecords = importedRecords.filter(r => r.name === emp.name && r.date === dateStr);
            let mergedRecord = null;

            if (sameDayRecords.length > 0) {
              const validClockInRecord = sameDayRecords.find(r => r.checkIn && r.checkIn !== '');
              const validClockOutRecord = sameDayRecords.find(r => r.checkOut && r.checkOut !== '');
              const validLeaveRecord = sameDayRecords.find(r => r.leaveType && r.leaveType !== '');

              mergedRecord = {
                id: `merged_${emp.name}_${dateStr}`,
                projectId: selectedProject,
                month: viewMonth,
                name: emp.name,
                unit: emp.unit, 
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
                id: `generated_${emp.name}_${dateStr}`,
                projectId: selectedProject,
                month: viewMonth,
                name: emp.name,
                unit: emp.unit, 
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

  const timeToMinutes = (timeStr) => {
    if (!timeStr || !timeStr.includes(':')) return null;
    const parts = timeStr.split(':');
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  };

  // 核心演算法：多維度條件篩選 (搜尋框 + 單位下拉選單)
  const filteredRecords = records.filter(r => {
    const matchesName = r.name.toLowerCase().includes(searchName.trim().toLowerCase());
    const matchesUnit = selectedUnit === 'ALL' || r.unit === selectedUnit;
    return matchesName && matchesUnit;
  });

  // 動態即時排序
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

  // 輔助函式：取得純文字格式的交叉判定狀態 (專供 Excel 匯出包裝使用)
  const getStatusText = (r) => {
    if (r.isOffDay) return (r.checkIn || r.checkOut) ? "假日加班" : "例假日/放假";
    if (r.leaveType) return `已請假 (${r.leaveType})`;
    if (!r.checkIn && !r.checkOut) return "曠職 (應上班未打卡)";
    if (!r.checkIn || !r.checkOut) return "異常: 缺打卡";

    const inMins = timeToMinutes(r.checkIn);
    const outMins = timeToMinutes(r.checkOut);
    if (inMins !== null && outMins !== null) {
      const maxStartMins = 9 * 60;      
      let isLate = inMins > maxStartMins;
      let lateMinutes = isLate ? inMins - maxStartMins : 0;
      let legalMinOutMins = isLate ? 18 * 60 : Math.max(inMins, 8 * 60) + (9 * 60);
      let isEarlyLeave = outMins < legalMinOutMins;
      let earlyLeaveMinutes = isEarlyLeave ? legalMinOutMins - outMins : 0;

      if (isLate && isEarlyLeave) return `遲到 ${lateMinutes} 分 / 早退 ${earlyLeaveMinutes} 分`;
      if (isLate) return `遲到 ${lateMinutes} 分鐘`;
      if (isEarlyLeave) return `早退 ${earlyLeaveMinutes} 分鐘`;
    }
    return "正常出勤";
  };

  // 交叉判定 Badges 視覺化輸出 (網頁畫面板塊)
  const renderStatusBadge = (r) => {
    const statusText = getStatusText(r);
    if (statusText === "假日加班") {
      return <span className="px-2.5 py-1 bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400 text-xs font-bold rounded-lg border border-amber-200 dark:border-amber-500/30">假日加班</span>;
    }
    if (statusText === "例假日/放假") {
      return <span className="px-2.5 py-1 bg-slate-100 text-slate-500 dark:bg-slate-700/50 dark:text-slate-400 text-xs font-bold rounded-lg border border-slate-200 dark:border-slate-700">例假日/放假</span>;
    }
    if (statusText.startsWith("已請假")) {
      return <span className="px-2.5 py-1 bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400 text-xs font-bold rounded-lg border border-blue-200 dark:border-blue-500/30 flex items-center w-fit"><CheckCircle2 size={12} className="mr-1 text-blue-500" /> {statusText}</span>;
    }
    if (statusText.startsWith("曠職")) {
      return <span className="px-2.5 py-1 bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400 text-xs font-bold rounded-lg border border-red-200 dark:border-red-500/30 flex items-center w-fit animate-pulse"><AlertCircle size={12} className="mr-1 text-red-500" /> {statusText}</span>;
    }
    if (statusText.startsWith("異常") || statusText.includes("遲到") || statusText.includes("早退")) {
      return <span className="px-2.5 py-1 bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400 text-xs font-bold rounded-lg border border-orange-200 dark:border-orange-500/30">{statusText}</span>;
    }
    return <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 text-xs font-bold rounded-lg border border-emerald-200 dark:border-emerald-500/30">正常出勤</span>;
  };

  // 目前檢視內容 Excel (CSV) 實時匯出引擎
  const handleExportCurrentViewExcel = () => {
    if (sortedRecords.length === 0) {
      alert('目前畫面上無任何過濾後的考勤資料可供匯出');
      return;
    }

    const headers = ['打卡日期', '姓名', '計畫單位', '上班時間 (M)', '下班時間 (O)', '表定請假區間 (Z)', '假別', '日曆與工時交叉結果'];
    const csvRows = [headers.join(',')];

    sortedRecords.forEach(r => {
      const statusText = getStatusText(r);
      const rowData = [
        `"${r.date || ''}"`,
        `"${r.name || ''}"`,
        `"${r.unit || ''}"`,
        `"${r.checkIn || '--'}"`,
        `"${r.checkOut || '--'}"`,
        `"${r.leaveRangeInfo || '--'}"`,
        `"${r.leaveType || '--'}"`,
        `"${statusText}"`
      ];
      csvRows.push(rowData.join(','));
    });

    const blob = new Blob(["\uFEFF" + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `考勤日曆核對報表(視圖匯出)_${viewMonth}_${new Date().toISOString().split('T')[0]}.csv`;
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
              <p className="text-xs text-slate-400 mt-0.5">系統已自動啟用跨表互補機制，可自由過濾與排序，並支援一鍵下載目前視圖的 Excel 核對報表。</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* 過濾工具列 */}
        <div className="p-4 bg-slate-50/50 dark:bg-slate-900/30 border-b border-slate-100 dark:border-slate-700 grid grid-cols-1 sm:grid-cols-4 gap-3 items-center">
          <div className="flex items-center space-x-2">
            <Calendar size={14} className="text-slate-400 shrink-0" />
            <input 
              type="month" 
              value={viewMonth}
              onChange={(e) => setViewMonth(e.target.value)}
              className="text-xs font-bold p-2 rounded-xl border dark:bg-slate-800 dark:border-slate-700 w-full outline-none focus:border-indigo-500"
            />
          </div>

          <div className="flex items-center space-x-2">
            <Filter size={14} className="text-slate-400 shrink-0" />
            <select
              value={selectedUnit}
              onChange={(e) => setSelectedUnit(e.target.value)}
              className="text-xs font-bold p-2 rounded-xl border bg-white dark:bg-slate-800 dark:border-slate-700 w-full outline-none focus:border-indigo-500"
            >
              <option value="ALL">全部計畫單位 (ALL)</option>
              {allExistingUnits.map(unit => (
                <option key={unit} value={unit}>{unit}</option>
              ))}
            </select>
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

          <div className="flex items-center justify-end space-x-2">
            <button 
              onClick={fetchData}
              disabled={isLoading}
              className="flex items-center space-x-1.5 px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-300 hover:shadow-sm transition-all disabled:opacity-50"
            >
              <RefreshCw size={12} className={isLoading ? "animate-spin" : ""} />
              <span>比對</span>
            </button>
            <button 
              onClick={handleExportCurrentViewExcel}
              disabled={isLoading || records.length === 0}
              className="flex items-center space-x-1.5 px-3 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 shadow-sm transition-all disabled:opacity-50"
            >
              <Download size={12} />
              <span>匯出明細 Excel</span>
            </button>
          </div>
        </div>

        {/* Table Content */}
        <div className="overflow-y-auto flex-1 p-6 bg-slate-50/30 dark:bg-slate-900/10">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-full space-y-2">
              <Loader2 size={36} className="text-indigo-500 animate-spin" />
              <span className="text-xs text-slate-400">正在整合目前排序與過濾視圖，校對工時狀態中...</span>
            </div>
          ) : sortedRecords.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-12">
              <FileText size={48} className="text-slate-300 dark:text-slate-600 mb-3" />
              <p className="text-sm font-bold text-slate-700 dark:text-slate-300">目前查無符合該單位或條件的人員紀錄</p>
              <p className="text-xs text-slate-400 mt-1">請調整上方的計畫單位或搜尋關鍵字。</p>
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
                      姓名/計畫單位 <SortIcon columnKey="name" />
                    </th>
                    <th className="py-3 px-4 text-xs font-bold text-slate-500 uppercase">上班時間 (M)</th>
                    <th className="py-3 px-4 text-xs font-bold text-slate-500 uppercase">下班時間 (O)</th>
                    <th className="py-3 px-4 text-xs font-bold text-slate-500 uppercase">表定請假區間 (Z)</th>
                    <th className="py-3 px-4 text-xs font-bold text-slate-500 uppercase">日曆與彈性工時交叉結果</th>
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
                        <td className="py-3.5 px-4">
                          <div className="flex flex-col">
                            <span className="font-bold text-slate-900 dark:text-slate-100">{r.name}</span>
                            <span className="text-[10px] font-bold text-indigo-500 dark:text-indigo-400 mt-0.5 tracking-wide bg-indigo-50 dark:bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-100 dark:border-indigo-500/20 w-fit">
                              {r.unit}
                            </span>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 font-mono">{r.checkIn || '--'}</td>
                        <td className="py-3.5 px-4 font-mono">{r.checkOut || '--'}</td>
                        <td className="py-3.5 px-4 max-w-[200px] truncate border-slate-100" title={r.leaveRangeInfo}>
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
