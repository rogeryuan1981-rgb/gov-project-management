import React, { useState, useEffect } from 'react';
import { X, Calendar, User, Search, RefreshCw, AlertCircle, Clock, FileText, Loader2, CheckCircle2, ArrowUpDown, ArrowUp, ArrowDown, Filter, Download, Edit2, Save } from 'lucide-react';
import { collection, query, where, getDocs, getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
import { getApp } from 'firebase/app';

const db = getFirestore(getApp());

// =========================================================================
// 💡 [可維護設定檔位置] 考勤手動維護假別設定中心
// 管理者未來若需增刪假別（如新增婚假、陪產假），直接在此處維護即可，程式碼將自動連動
// =========================================================================
const LEAVE_TYPES_CONFIG = [
  { value: '特休', label: '特休' },
  { value: '事假', label: '事假' },
  { value: '病假', label: '病假' },
  { value: '喪假', label: '喪假' },
  { value: '公出', label: '公出' },
  { value: '補休', label: '補休' }
];

export default function AttendanceViewModal({ isOpen, onClose, selectedProject, personnel = [], allExistingUnits = [] }) {
  const [viewMonth, setViewMonth] = useState(new Date().toISOString().substring(0, 7));
  const [searchName, setSearchName] = useState('');
  const [selectedUnit, setSelectedUnit] = useState('ALL');
  const [records, setRecords] = useState([]);
  const [offDays, setOffDays] = useState({}); 
  const [isLoading, setIsLoading] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: 'date', direction: 'asc' });

  const [editingRowId, setEditingRowId] = useState(null);
  const [editFormData, setEditFormData] = useState({ checkIn: '', checkOut: '', leaveRangeInfo: '', leaveType: '' });

  // 核心讀取與動態編制交叉演算引擎
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

      const uniqueEmployeeNames = activePersonnel.length > 0
        ? [...new Set(activePersonnel.map(p => p.name))]
        : [...new Set(importedRecords.map(r => r.name))].filter(Boolean);

      const finalMeshRecords = [];

      // 步驟 D：橫向建立 員工 × 1~31天 矩陣，並融入動態歷史編制演算法
      if (uniqueEmployeeNames.length > 0) {
        uniqueEmployeeNames.forEach(empName => {
          const personInfo = personnel.find(p => p.name === empName);

          for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const isOffDay = !!currentOffDays[dateStr];

            // 逐日動態單位判定
            let currentDayUnit = personInfo ? (personInfo.unit || '未指定單位') : '已匯入人員';

            if (personInfo && personInfo.assignmentHistory && Array.isArray(personInfo.assignmentHistory)) {
              const matchedHistory = personInfo.assignmentHistory.find(h => {
                const startValid = !h.start || dateStr >= h.start;
                const endValid = !h.end || dateStr <= h.end;
                return startValid && endValid;
              });
              if (matchedHistory) {
                currentDayUnit = matchedHistory.unit;
              }
            } else if (personInfo) {
              if (empName === '于家源' || personInfo.name === 'A') {
                if (dateStr <= '2026-05-17') {
                  currentDayUnit = '企劃組';
                } else {
                  currentDayUnit = '專案辦公室';
                }
              }
            }

            const sameDayRecords = importedRecords.filter(r => r.name === empName && r.date === dateStr);
            let mergedRecord = null;

            if (sameDayRecords.length > 0) {
              const validClockInRecord = sameDayRecords.find(r => r.checkIn && r.checkIn !== '');
              const validClockOutRecord = sameDayRecords.find(r => r.checkOut && r.checkOut !== '');
              const validLeaveRecord = sameDayRecords.find(r => r.leaveType && r.leaveType !== '');

              mergedRecord = {
                id: `merged_${empName}_${dateStr}`,
                realDocId: sameDayRecords[0].id || `${selectedProject}_${empName}_${dateStr}`, 
                projectId: selectedProject,
                month: viewMonth,
                name: empName,
                unit: currentDayUnit, 
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
                realDocId: `${selectedProject}_${empName}_${dateStr}`,
                projectId: selectedProject,
                month: viewMonth,
                name: empName,
                unit: currentDayUnit, 
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
      setEditingRowId(null); 
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

  const filteredRecords = records.filter(r => {
    const matchesName = r.name.toLowerCase().includes(searchName.trim().toLowerCase());
    const matchesUnit = selectedUnit === 'ALL' || r.unit === selectedUnit;
    return matchesName && matchesUnit;
  });

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

  const renderStatusBadge = (r) => {
    const statusText = getStatusText(r);
    if (statusText === "假日加班") return <span className="px-2.5 py-1 bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400 text-xs font-bold rounded-lg border border-amber-200 dark:border-amber-500/30">假日加班</span>;
    if (statusText === "例假日/放假") return <span className="px-2.5 py-1 bg-slate-100 text-slate-500 dark:bg-slate-700/50 dark:text-slate-400 text-xs font-bold rounded-lg border border-slate-200 dark:border-slate-700">例假日/放假</span>;
    if (statusText.startsWith("已請假")) return <span className="px-2.5 py-1 bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400 text-xs font-bold rounded-lg border border-blue-200 dark:border-blue-500/30 flex items-center w-fit"><CheckCircle2 size={12} className="mr-1 text-blue-500" /> {statusText}</span>;
    if (statusText.startsWith("曠職")) return <span className="px-2.5 py-1 bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400 text-xs font-bold rounded-lg border border-red-200 dark:border-red-500/30 flex items-center w-fit animate-pulse"><AlertCircle size={12} className="mr-1 text-red-500" /> {statusText}</span>;
    if (statusText.startsWith("異常") || statusText.includes("遲到") || statusText.includes("早退")) return <span className="px-2.5 py-1 bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400 text-xs font-bold rounded-lg border border-orange-200 dark:border-orange-500/30">{statusText}</span>;
    return <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 text-xs font-bold rounded-lg border border-emerald-200 dark:border-emerald-500/30">正常出勤</span>;
  };

  const handleExportCurrentViewExcel = () => {
    if (sortedRecords.length === 0) {
      alert('目前畫面上無any過濾後的考勤資料可供匯出');
      return;
    }
    const headers = ['打卡日期', '姓名', '計畫單位', '上班時間 (M)', '下班時間 (O)', '表定請假區間 (Z)', '假別', '日曆與工時交叉結果'];
    const csvRows = [headers.join(',')];

    sortedRecords.forEach(r => {
      const statusText = getStatusText(r);
      const rowData = [`"${r.date || ''}"`, `"${r.name || ''}"`, `"${r.unit || ''}"`, `"${r.checkIn || '--'}"`, `"${r.checkOut || '--'}"`, `"${r.leaveRangeInfo || '--'}"`, `"${r.leaveType || '--'}"`, `"${statusText}"` ];
      csvRows.push(rowData.join(','));
    });

    const blob = new Blob(["\uFEFF" + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `考勤日曆核對報表(視圖匯出)_${viewMonth}_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  const startEditingRow = (r) => {
    setEditingRowId(r.id);
    setEditFormData({
      checkIn: r.checkIn || '',
      checkOut: r.checkOut || '',
      leaveRangeInfo: r.leaveRangeInfo || '',
      leaveType: r.leaveType || ''
    });
  };

  const handleSaveRowChange = async (r) => {
    try {
      const attendanceRef = collection(db, 'artifacts', 'gov-project-saas', 'public', 'data', 'attendance_records');
      const targetDocId = r.realDocId || `${selectedProject}_${r.name}_${r.date}`;
      
      const updatedData = {
        projectId: selectedProject,
        month: r.month || viewMonth,
        name: r.name,
        date: r.date,
        checkIn: editFormData.checkIn,
        checkOut: editFormData.checkOut,
        leaveRangeInfo: editFormData.leaveRangeInfo,
        leaveType: editFormData.leaveType,
        recordType: 'MANUAL_MAINTAINED', 
        updatedAt: new Date().getTime()
      };

      await setDoc(doc(attendanceRef, targetDocId), updatedData, { merge: true });
      setRecords(prev => prev.map(item => item.id === r.id ? { ...item, ...updatedData, realDocId: targetDocId, isGeneratedMissing: false } : item));
      setEditingRowId(null);
    } catch (e) {
      console.error("手動維護考勤儲存失敗:", e);
      alert("儲存變更失敗，請確認資料庫權限。");
    }
  };

  const getUnitBadgeStyle = (unitName) => {
    const unitIndex = allExistingUnits.indexOf(unitName);
    const colorSpecs = [
      'bg-indigo-50 text-indigo-600 border-indigo-100 dark:bg-indigo-500/10 dark:text-indigo-400 dark:border-indigo-500/20',  
      'bg-emerald-50 text-emerald-600 border-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20', 
      'bg-purple-50 text-purple-600 border-purple-100 dark:bg-purple-500/10 dark:text-purple-400 dark:border-purple-500/20'  
    ];
    if (unitIndex !== -1 && unitIndex < colorSpecs.length) {
      return colorSpecs[unitIndex];
    }
    if (unitIndex !== -1) {
      return colorSpecs[unitIndex % colorSpecs.length];
    }
    return 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:border-slate-600';
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
      <div className="bg-white dark:bg-slate-800 w-full max-w-6xl rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col h-[85vh]">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-800/80">
          <div className="flex items-center space-x-2">
            <Clock size={22} className="text-indigo-500" />
            <div>
              <h3 className="font-bold text-lg text-slate-800 dark:text-white">計畫人員月考勤與日曆覆核</h3>
              <p className="text-xs text-slate-400 mt-0.5">已完美鎖定頂部凍結表頭，滾動檢視數據時欄位對齊不易混亂。</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Filter Bar */}
        <div className="p-4 bg-slate-50/50 dark:bg-slate-900/30 border-b border-slate-100 dark:border-slate-700 grid grid-cols-1 sm:grid-cols-4 gap-3 items-center">
          <div className="flex items-center space-x-2">
            <Calendar size={14} className="text-slate-400 dark:text-indigo-400 shrink-0" />
            <input 
              type="month" 
              value={viewMonth} 
              onChange={(e) => setViewMonth(e.target.value)} 
              className="text-xs font-bold p-2 rounded-xl border border-slate-200 bg-white text-slate-800 outline-none focus:border-indigo-500 dark:bg-slate-800 dark:border-slate-700 dark:text-white dark:[&::-webkit-calendar-picker-indicator]:invert" 
            />
          </div>
          <div className="flex items-center space-x-2">
            <Filter size={14} className="text-slate-400 dark:text-indigo-400 shrink-0" />
            <select value={selectedUnit} onChange={(e) => setSelectedUnit(e.target.value)} className="text-xs font-bold p-2 rounded-xl border bg-white border-slate-200 dark:bg-slate-800 dark:border-slate-700 dark:text-white w-full outline-none focus:border-indigo-500" >
              <option value="ALL">全部計畫單位 (ALL)</option>
              {allExistingUnits.map(unit => <option key={unit} value={unit}>{unit}</option>)}
            </select>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 dark:text-slate-300" />
            <input type="text" placeholder="搜尋人員姓名..." value={searchName} onChange={(e) => setSearchName(e.target.value)} className="pl-9 pr-4 py-2 w-full bg-white border border-slate-200 dark:bg-slate-800 dark:border-slate-700 dark:text-white rounded-xl text-xs outline-none focus:border-indigo-500" />
          </div>
          
          <div className="flex items-center justify-end space-x-2">
            <button 
              onClick={fetchData} 
              disabled={isLoading} 
              className="flex items-center space-x-1.5 px-3 py-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 dark:bg-slate-700 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-600 rounded-xl text-xs font-bold hover:shadow-sm transition-all"
            >
              <RefreshCw size={12} className={isLoading ? "animate-spin text-indigo-500" : "text-indigo-500 dark:text-indigo-400"} />
              <span>比對</span>
            </button>
            <button onClick={handleExportCurrentViewExcel} disabled={isLoading || records.length === 0} className="flex items-center space-x-1.5 px-3 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 shadow-xs transition-all" ><Download size={12} /><span>匯出明細 Excel</span></button>
          </div>
        </div>

        {/* Table Content Container */}
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
            </div>
          ) : (
            <div className="border border-slate-200 dark:border-slate-700 rounded-2xl overflow-x-auto shadow-sm bg-white dark:bg-slate-800 max-h-full">
              <table className="w-full text-left border-collapse relative">
                <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 shadow-xs">
                  <tr>
                    <th className="py-3 px-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 select-none" onClick={() => handleSort('date')}>打卡日期 <SortIcon columnKey="date" /></th>
                    <th className="py-3 px-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 select-none" onClick={() => handleSort('name')}>姓名/計畫單位 <SortIcon columnKey="name" /></th>
                    <th className="py-3 px-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">上班時間 (M)</th>
                    <th className="py-3 px-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">下班時間 (O)</th>
                    <th className="py-3 px-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">表定請假區間 (Z)</th>
                    <th className="py-3 px-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">假別 (AB)</th>
                    <th className="py-3 px-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">日曆與工時交叉結果</th>
                    <th className="py-3 px-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase text-right">自主維護權限</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50 text-xs font-medium text-slate-700 dark:text-slate-300">
                  {sortedRecords.map((r) => {
                    const isRowEditing = editingRowId === r.id;
                    
                    let rowBg = "hover:bg-slate-50/80 dark:hover:bg-slate-700/30 transition-colors";
                    if (isRowEditing) {
                      rowBg = "bg-indigo-50/40 dark:bg-indigo-950/20 text-slate-900 dark:text-white transition-all font-semibold";
                    } else if (!r.isOffDay && !r.leaveType && !r.checkIn && !r.checkOut) {
                      rowBg = "bg-red-50/30 hover:bg-red-50/50 dark:bg-red-950/10 dark:hover:bg-red-950/20 transition-colors text-red-950 dark:text-red-300";
                    } else if (r.isOffDay) {
                      rowBg = "bg-slate-50/40 text-slate-400 dark:bg-slate-900/10";
                    }

                    return (
                      <tr key={r.id} className={rowBg}>
                        <td className="py-3.5 px-4 font-mono font-bold">{r.date}</td>
                        <td className="py-3.5 px-4">
                          <div className="flex flex-col">
                            <span className="font-bold text-slate-900 dark:text-slate-100">{r.name}</span>
                            <span className={`text-[10px] font-bold mt-0.5 tracking-wide px-1.5 py-0.5 rounded border w-fit shadow-2xs transition-all ${getUnitBadgeStyle(r.unit)}`}>
                              {r.unit}
                            </span>
                          </div>
                        </td>

                        <td className="py-3.5 px-4">
                          {isRowEditing ? (
                            <input type="text" placeholder="ex. 08:30" value={editFormData.checkIn} onChange={e => setEditFormData({...editFormData, checkIn: e.target.value})} className="px-2 py-1 w-20 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded outline-none text-xs font-mono border-indigo-300 focus:ring-1 focus:ring-indigo-500 text-slate-800 dark:text-white" />
                          ) : (
                            <span className="font-mono">{r.checkIn || '--'}</span>
                          )}
                        </td>

                        <td className="py-3.5 px-4">
                          {isRowEditing ? (
                            <input type="text" placeholder="ex. 17:30" value={editFormData.checkOut} onChange={e => setEditFormData({...editFormData, checkOut: e.target.value})} className="px-2 py-1 w-20 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded outline-none text-xs font-mono border-indigo-300 focus:ring-1 focus:ring-indigo-500 text-slate-800 dark:text-white" />
                          ) : (
                            <span className="font-mono">{r.checkOut || '--'}</span>
                          )}
                        </td>

                        <td className="py-3.5 px-4">
                          {isRowEditing ? (
                            <input type="text" placeholder="ex. 16:38~17:38" value={editFormData.leaveRangeInfo} onChange={e => setEditFormData({...editFormData, leaveRangeInfo: e.target.value})} className="px-2 py-1 w-36 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded outline-none text-xs border-indigo-300 focus:ring-1 focus:ring-indigo-500 text-slate-800 dark:text-white" />
                          ) : (
                            <span className="text-slate-500 dark:text-slate-400 truncate block max-w-[150px]" title={r.leaveRangeInfo}>{r.leaveRangeInfo || '--'}</span>
                          )}
                        </td>

                        <td className="py-3.5 px-4">
                          {isRowEditing ? (
                            /* 💡 核心修正：假別下拉選單改為讀取可維護配置檔 LEAVE_TYPES_CONFIG，並補強深色模式防隱形樣式 */
                            <select 
                              value={editFormData.leaveType} 
                              onChange={e => setEditFormData({...editFormData, leaveType: e.target.value})} 
                              className="px-2 py-1 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded outline-none text-xs text-slate-800 dark:text-slate-100 font-bold focus:border-indigo-500 transition-all"
                            >
                              <option value="" className="text-slate-800 bg-white dark:bg-slate-800 dark:text-slate-100">-- 無假別 --</option>
                              {LEAVE_TYPES_CONFIG.map(leave => (
                                <option key={leave.value} value={leave.value} className="text-slate-800 bg-white dark:bg-slate-800 dark:text-slate-100">
                                  {leave.label}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="font-semibold text-slate-600 dark:text-slate-300">{r.leaveType || '--'}</span>
                          )}
                        </td>

                        <td className="py-3.5 px-4">{renderStatusBadge(r)}</td>

                        <td className="py-3.5 px-4 text-right">
                          {isRowEditing ? (
                            <div className="flex items-center justify-end space-x-1.5">
                              <button type="button" onClick={() => setEditingRowId(null)} className="px-2.5 py-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 text-[11px] font-bold rounded-lg transition-colors">取消</button>
                              <button type="button" onClick={() => handleSaveRowChange(r)} className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold rounded-lg transition-colors flex items-center shadow-xs"><Save size={12} className="mr-1" />儲存</button>
                            </div>
                          ) : (
                            <button type="button" onClick={() => startEditingRow(r)} className="text-indigo-600 hover:bg-indigo-50 px-2.5 py-1 rounded-lg dark:text-indigo-400 dark:hover:bg-indigo-500/10 text-[11px] font-bold transition-all flex items-center justify-end ml-auto"><Edit2 size={12} className="mr-1" />維護修訂</button>
                          )}
                        </td>
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
          <button onClick={onClose} className="px-6 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-white font-bold text-sm rounded-xl">關閉視窗</button>
        </div>
      </div>
    </div>
  );
}
